#!/usr/bin/env python3
"""End-to-end demo of the landing layer: python3 prototype/demo.py [--keep]"""
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from forge import Forge  # noqa: E402
from forge import toy  # noqa: E402
from forge.evidence import run_suite  # noqa: E402
from forge.gitx import git, short  # noqa: E402


def log(actor, text):
    print(f"  [{actor:<7}] {text}")


def banner(title):
    print(f"\n=== {title} " + "=" * max(0, 74 - len(title)))


def show_why(f, path, needle):
    lines = git(f.trunk, "show", f"main:{path}").splitlines()
    n = next(i for i, ln in enumerate(lines, 1) if needle in ln)
    w = f.why(path, n)
    print(f"  why {path}:{n}  `{w['text'].strip()}`")
    if not w["landing"]:
        print("    -> seed commit (no thread)")
        return w
    lnd = w["landing"]
    print(f"    commit   {short(w['commit'])}  landing {lnd['id']} lane={lnd['lane']} rev={lnd['rev']} "
          f"evidence={lnd['evidenceManifest'][:19]}")
    print(f"    thread   {w['thread']}  intent {w['intent']['id']} \"{w['intent']['title']}\" ({w['intent']['sponsor']})")
    print(f"    message  {w['message']['id']} [{w['message']['role']}] \"{w['message']['text']}\"")
    print(f"    note     {w['note']}")
    return w


def main():
    keep = "--keep" in sys.argv
    root = Path(tempfile.mkdtemp(prefix="forge-demo-"))
    ok = True
    try:
        f = Forge(root, toy.SEED, log=log)
        print(f"Forge in {root}\n  trunk={f.trunk.name} main={short(f.main_sha())}; Lander holds the only trunk token")

        banner("Scene 1: disjoint changes (both auto-land)")
        s1 = toy.scene_disjoint(f)
        ok &= s1["results"] == ["landed", "landed"]

        banner("Scene 2: textual conflict -> hand-back -> re-derive from intent")
        s2 = toy.scene_textual(f)
        ok &= s2["results"] == ["landed", "handed_back:textual", "landed"]

        banner("Scene 3 (headline): merges cleanly, green alone, RED together")
        before = [x["landedSha"] for x in f.landings if x["outcome"] == "landed"]
        s3 = toy.scene_semantic(f)
        ok &= s3["results"] == ["landed", "handed_back:semantic", "landed"]

        banner("Scene 4: decide lane (protected shop/billing/**)")
        s4 = toy.scene_decide(f)
        print(f"  answers: {s4['answers']}")
        ok &= s4["push_rc"] != 0 and s4["results"] == ["landed"] and s4["answers"][-1][1] == "approved"

        banner("blame -> thread -> message")
        w1 = show_why(f, "shop/promo.py", "return apply_code(")
        w2 = show_why(f, "shop/pricing.py", '"WELCOME5"')
        ok &= w1["thread"] == s3["threads"][1].id and w2["thread"] == s2["threads"][1].id

        banner("git log --show-notes=forge -1 (plain git still shows the provenance)")
        lnd = next(x for x in f.landings if x["threadId"] == s3["threads"][1].id and x["outcome"] == "landed")
        print("\n".join("  | " + ln for ln in git(f.trunk, "log", "-1", "--show-notes=forge", lnd["landedSha"]).splitlines()))

        banner("Invariants")
        landed = [x for x in f.landings if x["outcome"] == "landed"]
        handed = [x for x in f.landings if x["outcome"] == "handed_back"]
        chain = git(f.trunk, "rev-list", "--first-parent", "main").split()
        every_green = all(f.evidence.statement(f.evidence.by_tree[x["treeSha"]])["predicate"]["result"]["pass"] for x in landed)
        final = run_suite(f.trunk, "main")
        sigs = [p.stem for p in (root / "evidence" / "ev").glob("*.json")]
        verified = sum(f.evidence.verify("sha256:" + s) for s in sigs if "payload" in (root / "evidence" / "ev" / f"{s}.json").read_text())
        checks = {
            "every landed tree had a passing signed combined test (main never red)": every_green,
            "main history == landed commits only (+ seed)": len(chain) == len(landed) + 1
                and set(chain[:-1]) == {x["landedSha"] for x in landed},
            "semantic loser never reached main before re-derivation": s3["threads"][1].revisions[0]["headSha"] not in chain
                and before[-1] in chain,
            "final main passes a fresh independent test run": final["pass"],
            "approver != requester enforced": s4["answers"][0] == ("carol@demo.dev", "403 approver_is_requester"),
        }
        for name, val in checks.items():
            print(f"  [{'PASS' if val else 'FAIL'}] {name}")
        ok &= all(checks.values())
        print(f"\n  landings={len(landed)} hand-backs={len(handed)} ({', '.join(x['kind'] for x in handed)}) "
              f"decisions={len(f.decisions)}")
        print(f"  test runs={f.evidence.runs} evidence reuses={f.evidence.reuses} "
              f"signed envelopes verified={verified} final main={short(f.main_sha())} ({final['ran']} tests green)")
        print(f"\nDEMO {'OK' if ok else 'FAILED'}" + (f"  (kept: {root})" if keep else ""))
    finally:
        if not keep:
            shutil.rmtree(root, ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
