"""Intent claims: advisory overlap warnings at spawn, base_moved to stale + at-risk threads after a landing."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forge import Forge  # noqa: E402
from forge import claims as cl  # noqa: E402
from forge import toy  # noqa: E402
from forge.evidence import run_suite  # noqa: E402
from forge.gitx import git  # noqa: E402


class ClaimOverlap(unittest.TestCase):
    def test_overlap_rules_for_files_globs_and_symbols(self):
        self.assertTrue(cl.claims_overlap("shop/pricing.py", "shop/pricing.py::discount"))  # whole file covers symbol
        self.assertTrue(cl.claims_overlap("shop/catalog.py::PRODUCTS", "shop/catalog.py::PRODUCTS"))
        self.assertFalse(cl.claims_overlap("shop/catalog.py::PRODUCTS", "shop/catalog.py::price_of"))
        self.assertTrue(cl.claims_overlap("docs/**", "docs/faq.md"))
        self.assertFalse(cl.claims_overlap("docs/**", "shop/catalog.py"))
        self.assertEqual(cl.touches(["shop/catalog.py::PRODUCTS", "docs/**"], ["shop/catalog.py"]),
                         ["shop/catalog.py::PRODUCTS"])


class ClaimsInForge(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="forge-test-"))
        self.f = Forge(self.tmp, toy.SEED)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_overlap_warned_before_landing_and_base_moved_enables_early_resync(self):
        s = toy.scene_claims(self.f)
        h, i, j = s["threads"]
        evs = self.f.claims.events
        self.assertEqual([e["type"] for e in evs], ["overlap_warning", "base_moved"])
        self.assertEqual(set(evs[0]["threads"]), {h.id, i.id})  # warned at spawn, before any landing
        self.assertEqual((evs[1]["threadId"], evs[1]["landedChange"]), (i.id, h.change_id))  # j is behind but disjoint
        self.assertEqual(s["resynced"], {i.id: "rederived"})
        self.assertEqual(s["results"], ["landed", "landed", "landed"])
        self.assertEqual(i.handbacks, 0)
        self.assertFalse(any(x["outcome"] == "handed_back" for x in self.f.landings))
        cat = git(self.f.trunk, "show", "main:shop/catalog.py")
        self.assertIn('"kiwi"', cat)
        self.assertIn('"grape"', cat)
        self.assertTrue(run_suite(self.f.trunk, "main")["pass"])

    def test_overlap_is_advisory_and_disjoint_threads_get_no_events(self):
        self.assertEqual(toy.scene_disjoint(self.f)["results"], ["landed", "landed"])
        self.assertEqual(self.f.claims.events, [])
        s = toy.scene_textual(self.f)  # overlapping claims do not block: same outcome as without claims
        self.assertEqual(s["results"], ["landed", "handed_back:textual", "landed"])
        c, d = s["threads"]
        types = [(e["type"], e.get("threadId")) for e in self.f.claims.events]
        self.assertEqual(types, [("overlap_warning", None), ("base_moved", d.id)])


if __name__ == "__main__":
    unittest.main()
