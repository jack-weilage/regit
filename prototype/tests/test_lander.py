"""Lander invariants: CAS, main never red, approver != requester, evidence reuse, hand-back, custody, blame."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forge import Forbidden, Forge, ScriptedAgent  # noqa: E402
from forge import policy as pol  # noqa: E402
from forge import toy  # noqa: E402
from forge.evidence import run_suite  # noqa: E402
from forge.gitx import git, run  # noqa: E402


class LanderInvariants(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="forge-test-"))
        self.f = Forge(self.tmp, toy.SEED)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def landed(self):
        return [x for x in self.f.landings if x["outcome"] == "landed"]

    def assert_main_never_red(self):
        for x in self.landed():  # every landed tree carries passing, verified, signed combined-test evidence
            h = self.f.evidence.by_tree[x["treeSha"]]
            self.assertTrue(self.f.evidence.verify(h))
            self.assertTrue(self.f.evidence.statement(h)["predicate"]["result"]["pass"])
        chain = git(self.f.trunk, "rev-list", "--first-parent", "main").split()
        self.assertEqual(set(chain[:-1]), {x["landedSha"] for x in self.landed()})
        self.assertTrue(run_suite(self.f.trunk, "main")["pass"])

    def test_cas_primitive_rejects_stale_old_value(self):
        main = self.f.main_sha()
        toy.scene_disjoint(self.f)
        new_main = self.f.main_sha()
        self.assertNotEqual(run(self.f.trunk, "update-ref", "refs/heads/main", main, main + "^").returncode, 0)
        self.assertEqual(self.f.main_sha(), new_main)

    def test_cas_retries_when_main_moves_underneath(self):
        moved = []

        def rogue_writer(base, cand):  # another writer moves main between re-test and CAS, once
            if moved:
                return
            other = self.tmp / "rogue"
            git(self.tmp, "clone", "-q", self.f.trunk, other)
            (other / "docs").mkdir(exist_ok=True)
            (other / "docs" / "rogue.md").write_text("moved\n")
            git(other, "add", "-A")
            git(other, "commit", "-q", "-m", "out-of-band")
            git(other, "push", "-q", "origin", "HEAD:main", env=self.f.lander._env)
            moved.append(git(other, "rev-parse", "HEAD"))

        self.f.lander.before_cas = rogue_writer
        res = toy.scene_disjoint(self.f)["results"]
        self.assertEqual(res, ["landed", "landed"])
        first = self.landed()[0]
        self.assertEqual(first["baseSha"], moved[0])  # re-rebased onto the moved main, re-tested, then CAS'd
        self.assertEqual(git(self.f.trunk, "rev-parse", first["landedSha"] + "^"), moved[0])

    def test_semantic_conflict_caught_and_main_never_red(self):
        s = toy.scene_semantic(self.f)
        self.assertEqual(s["results"], ["landed", "handed_back:semantic", "landed"])
        winner, loser = s["threads"]
        hb = next(x for x in self.f.landings if x["outcome"] == "handed_back")
        self.assertEqual(hb["baseSha"], self.landed()[0]["landedSha"])  # main stayed at the winner
        chain = git(self.f.trunk, "rev-list", "main").split()
        self.assertNotIn(loser.revisions[0]["headSha"], chain)
        self.assertEqual([r["cause"] for r in loser.revisions], ["initial", "handback"])
        msg = git(self.f.trunk, "log", "-1", "--format=%B", "main")
        self.assertIn(f"Forge-Handback: {winner.change_id}/semantic", msg)
        self.assertIn("Forge-Revision: 2", msg)
        self.assert_main_never_red()

    def test_textual_conflict_hands_back_winner_intent_and_diff(self):
        s = toy.scene_textual(self.f)
        self.assertEqual(s["results"], ["landed", "handed_back:textual", "landed"])
        winner, loser = s["threads"]
        hb = next(x for x in self.f.landings if x["outcome"] == "handed_back")
        packet = self.f.evidence.get(hb["packet"])
        self.assertEqual(packet["kind"], "textual")
        self.assertEqual(packet["failing"]["conflictFiles"], ["shop/pricing.py"])
        self.assertEqual(packet["winners"][0]["intent"]["title"], winner.intent["title"])
        self.assertIn('+    if code == "HALF":', packet["winners"][0]["diff"])
        self.assertEqual(packet["loser"]["threadId"], loser.id)
        self.assertTrue(any(m["role"] == "forge" and hb["packet"] in m["text"] for m in loser.messages))
        main_py = git(self.f.trunk, "show", "main:shop/pricing.py")
        self.assertIn("HALF", main_py)
        self.assertIn("WELCOME5", main_py)
        self.assert_main_never_red()

    def test_decide_lane_requires_approver_other_than_requester(self):
        s = toy.scene_decide(self.f)
        self.assertEqual(s["answers"], [("carol@demo.dev", "403 approver_is_requester"),
                                        ("dana@demo.dev", "403 not_in_group"), ("erin@demo.dev", "approved")])
        self.assertEqual(s["results"], ["landed"])
        self.assertIn(f"Forge-Decision: {s['decision']['id']}", git(self.f.trunk, "log", "-1", "--format=%B", "main"))

    def test_steerer_is_ineligible_and_unapproved_change_waits(self):
        th = self.f.spawn(self.f.intent("Billing tweak", "x", "bob@demo.dev"), ScriptedAgent(
            [("edit", toy.edit("shop/billing/invoice.py", "(protected path)", "(protected path, v2)"))]))
        th.steer("erin@demo.dev", "please also keep the format")
        main = self.f.main_sha()
        self.assertEqual(th.run(), "awaiting_decision")
        dec = next(iter(self.f.decisions.values()))
        with self.assertRaises(Forbidden) as e:
            self.f.answer(dec["id"], "erin@demo.dev")
        self.assertEqual(str(e.exception), "approver_is_requester")
        self.assertEqual(self.f.lander.drain(), [])
        self.assertEqual(self.f.main_sha(), main)

    def test_evidence_reused_for_same_tree_and_signature_checked(self):
        s = toy.scene_disjoint(self.f)
        a, b = s["threads"]
        lnd_a = self.landed()[0]
        manifest = {m["kind"]: m["hash"] for m in self.f.evidence.get(lnd_a["evidenceManifest"])["manifest"]}
        self.assertEqual(manifest["combined-tests"], manifest["tests"])  # base unchanged: same tree, reused
        self.assertEqual(self.f.evidence.reuses, 1)
        self.assertEqual(self.f.evidence.runs, 3)  # a, b alone, then {a + b} combined
        h = a.revisions[0]["tests"]
        self.assertTrue(self.f.evidence.verify(h))
        path = self.tmp / "evidence" / "ev" / (h.split(":")[1] + ".json")
        path.write_text(path.read_text().replace('"payloadType"', '"payloadType" ', 1))
        self.assertFalse(self.f.evidence.verify(h))  # tampered evidence fails verification and is never reused
        runs = self.f.evidence.runs
        self.f.evidence.test_commit(a.fork, a.revisions[0]["headSha"])
        self.assertEqual(self.f.evidence.runs, runs + 1)

    def test_only_the_lander_can_write_main_or_notes(self):
        th = self.f.spawn(self.f.intent("x", "y", "bob@demo.dev"), ScriptedAgent(
            [("doc", toy.write("docs/x.md", "x\n"))]))
        th.agent.work(th)
        main = self.f.main_sha()
        self.assertNotEqual(run(th.fork, "push", "origin", "HEAD:refs/heads/main").returncode, 0)
        git(th.fork, "notes", "--ref=forge", "add", "-m", "forged", "HEAD")
        self.assertNotEqual(run(th.fork, "push", "origin", "refs/notes/forge").returncode, 0)
        self.assertEqual(self.f.main_sha(), main)

    def test_blame_resolves_line_to_thread_and_message(self):
        s = toy.scene_semantic(self.f)
        loser = s["threads"][1]
        lines = git(self.f.trunk, "show", "main:tests/test_promo.py").splitlines()
        n = next(i for i, ln in enumerate(lines, 1) if "bundle_total([" in ln)
        w = self.f.why("tests/test_promo.py", n)
        self.assertEqual(w["thread"], loser.id)
        self.assertEqual(w["message"]["text"], "Add tests for bundle pricing")
        self.assertEqual(w["message"]["seq"], max(m["seq"] for m in loser.messages))  # the re-derived message
        self.assertEqual(w["note"]["thread"], loser.id)

    def test_policy_strictest_lane_wins_and_is_read_from_base(self):
        p = pol.parse(toy.POLICY)
        ev = lambda *paths: pol.evaluate(p, list(paths), "base")  # noqa: E731
        self.assertEqual(ev("docs/a.md")["lane"], "auto")
        self.assertEqual(ev("shop/catalog.py", "tests/test_x.py")["lane"], "flag")
        d = ev("shop/catalog.py", "shop/billing/invoice.py")
        self.assertEqual((d["lane"], d["decidePaths"]), ("decide", ["shop/billing/invoice.py"]))
        self.assertEqual(d["approvers"]["eligible"], ["carol@demo.dev", "erin@demo.dev"])
        self.assertEqual(ev("weird/file.txt")["lane"], "flag")  # default
        self.assertEqual(ev(".forge/policy.yaml")["lane"], "decide")
        self.assertEqual(p["limits"]["max_handbacks"], 2)
        # a change that loosens the policy is still judged by main's policy
        th = self.f.spawn(self.f.intent("Loosen gate", "x", "bob@demo.dev"), ScriptedAgent(
            [("loosen", toy.edit(".forge/policy.yaml", "lane: decide                     # the gate", "lane: auto # the gate"))]))
        self.assertEqual(th.run(), "awaiting_decision")


if __name__ == "__main__":
    unittest.main()
