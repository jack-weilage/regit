#!/usr/bin/env python3
"""Throughput benchmark for the serial Lander: python3 prototype/bench.py [--n 10,50,100] [--slow-n 10,50] [--cas 200]

Each run seeds a fresh toy trunk in a temp dir, spawns N threads from the same base, each adding its own
new module plus its own tiny test (disjoint paths), submits them all, then drains the Lander queue. It
reports wall-clock time, landings/minute and a per-landing breakdown. A "slow" variant adds a seed test
that sleeps 0.5 s, so every test run (own-tree proof and combined re-test) pays it. Finally it times the
bare git CAS step (update-ref with old value) plus a notes write, with no rebase or tests.

Single machine, local disk, one sequential Lander lane (no partitioning, no batching). Stdlib + git only.
"""
import argparse
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from forge import Forge, ScriptedAgent  # noqa: E402
from forge import toy  # noqa: E402
from forge.evidence import canon  # noqa: E402
from forge.gitx import git, run  # noqa: E402

SLOW_TEST = ("import time\nimport unittest\n\n\nclass SlowTest(unittest.TestCase):\n"
             "    def test_slow(self):\n        time.sleep(0.5)\n")


def feature(i):
    mod = f"shop/feat_{i:03d}.py"
    test = f"tests/test_feat_{i:03d}.py"
    src = f'"""Feature {i}."""\n\n\ndef feat_{i:03d}(x):\n    return x + {i}\n'
    tst = (f"import unittest\n\nfrom shop.feat_{i:03d} import feat_{i:03d}\n\n\n"
           f"class Feat{i:03d}Test(unittest.TestCase):\n"
           f"    def test_feat(self):\n        self.assertEqual(feat_{i:03d}(1), {i + 1})\n")
    return [mod, test], ScriptedAgent([(f"Add {mod}", toy.write(mod, src)), (f"Add {test}", toy.write(test, tst))])


def instrument(f):
    """Time each landing's phases by wrapping Lander.land and the evidence store (no source changes)."""
    stats = {"landings": [], "combined_reuses": 0, "submit_reuses": 0, "submit_s": 0.0}
    cur = {}
    ev, lander = f.evidence, f.lander
    orig_test, orig_land = ev.test_commit, lander.land

    def test_commit(repo, commit):
        t0 = time.perf_counter()
        h, res, reused = orig_test(repo, commit)
        t1 = time.perf_counter()
        if Path(repo) == lander.wd and cur:  # combined re-test inside a landing
            cur.update(test0=t0, test1=t1, reused=reused)
            stats["combined_reuses"] += reused
        else:  # own-tree proof at submit
            stats["submit_reuses"] += reused
        return h, res, reused

    def land(th):
        cur.clear()
        cur["t0"] = time.perf_counter()
        out = orig_land(th)
        t_end = time.perf_counter()
        if "test0" in cur:
            stats["landings"].append({"outcome": out, "rebase": cur["test0"] - cur["t0"],
                                      "test": cur["test1"] - cur["test0"], "finish": t_end - cur["test1"],
                                      "total": t_end - cur["t0"], "reused": cur["reused"]})
        cur.clear()
        return out

    ev.test_commit, lander.land = test_commit, land
    return stats


def bench(n, slow=False):
    root = Path(tempfile.mkdtemp(prefix="forge-bench-"))
    try:
        seed = dict(toy.SEED)
        if slow:
            seed["tests/test_slow.py"] = SLOW_TEST
        t0 = time.perf_counter()
        f = Forge(root, seed)
        stats = instrument(f)
        threads = []
        for i in range(n):  # all fork from the same base before anything lands
            paths, agent = feature(i)
            threads.append(f.spawn(f.intent(f"Feature {i}", f"Add feat_{i:03d}.", "alice@demo.dev", paths), agent))
        t_spawn = time.perf_counter()
        for th in threads:
            th.agent.work(th)
            ts = time.perf_counter()
            assert th.ready() == "queued"
            stats["submit_s"] += time.perf_counter() - ts
        t_submit = time.perf_counter()
        results = f.lander.drain()
        t_drain = time.perf_counter()
        landed = results.count("landed")
        assert landed == n, results
        assert len(git(f.trunk, "rev-list", "--first-parent", "main").split()) == n + 1
        L = stats["landings"]
        mean = lambda k: statistics.mean(x[k] for x in L)  # noqa: E731
        drain = t_drain - t_submit
        return {"n": n, "slow": slow, "total": t_drain - t0, "spawn": t_spawn - t0, "work_submit": t_submit - t_spawn,
                "submit_proof": stats["submit_s"], "drain": drain, "per_min": 60 * landed / drain,
                "rebase": mean("rebase"), "test": mean("test"), "finish": mean("finish"), "per_landing": mean("total"),
                "reuses": stats["combined_reuses"] + stats["submit_reuses"], "combined_reuses": stats["combined_reuses"],
                "test_runs": f.evidence.runs, "first_test": L[0]["test"], "last_test": L[-1]["test"]}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def bench_cas(k):
    """Raw cost of the CAS step alone: `git update-ref main <new> <old>` plus a `git notes add` per landing."""
    root = Path(tempfile.mkdtemp(prefix="forge-cas-"))
    try:
        repo = root / "trunk.git"
        git(root, "init", "-q", "--bare", "-b", "main", repo)
        tree = git(repo, "hash-object", "-t", "tree", "-w", "--stdin", input="")
        commits = [git(repo, "commit-tree", tree, "-m", "seed")]
        for i in range(k):  # pre-build the chain so only the CAS + note is timed
            commits.append(git(repo, "commit-tree", tree, "-p", commits[-1], "-m", f"c{i}"))
        git(repo, "update-ref", "refs/heads/main", commits[0])
        cas, note = [], []
        for i in range(k):
            t0 = time.perf_counter()
            assert run(repo, "update-ref", "refs/heads/main", commits[i + 1], commits[i]).returncode == 0
            t1 = time.perf_counter()
            git(repo, "notes", "--ref=forge", "add", "-f", "-F", "-", commits[i + 1], input=canon({"v": 1, "i": i}))
            t2 = time.perf_counter()
            cas.append(t1 - t0)
            note.append(t2 - t1)
        stale = run(repo, "update-ref", "refs/heads/main", commits[1], commits[0]).returncode
        assert stale != 0, "CAS with a stale old value must be refused"
        return {"k": k, "cas_ms": 1000 * statistics.median(cas), "note_ms": 1000 * statistics.median(note),
                "both_ms": 1000 * statistics.median(a + b for a, b in zip(cas, note))}
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", default="10,50,100")
    ap.add_argument("--slow-n", default="10,50")
    ap.add_argument("--cas", type=int, default=200)
    a = ap.parse_args()
    runs = [(int(x), False) for x in a.n.split(",") if x] + [(int(x), True) for x in a.slow_n.split(",") if x]
    print("| suite | N | total s | drain s | landings/min | per landing s | rebase+policy s | combined test s "
          "(first->last) | squash+CAS+notes s | test runs | evidence reuses |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for n, slow in runs:
        r = bench(n, slow)
        print(f"| {'slow (+0.5 s)' if slow else 'fast'} | {n} | {r['total']:.1f} | {r['drain']:.1f} | {r['per_min']:.0f} | "
              f"{r['per_landing']:.2f} | {r['rebase']:.2f} | {r['test']:.2f} ({r['first_test']:.2f}->{r['last_test']:.2f}) | "
              f"{r['finish']:.2f} | {r['test_runs']} | {r['reuses']} ({r['combined_reuses']} combined) |", flush=True)
    c = bench_cas(a.cas)
    print(f"\nRaw CAS, {c['k']} landings on a bare repo (median): update-ref with old value {c['cas_ms']:.1f} ms, "
          f"notes add {c['note_ms']:.1f} ms, both {c['both_ms']:.1f} ms "
          f"(~{60000 / c['both_ms']:.0f} landings/min if nothing else ran)")


if __name__ == "__main__":
    main()
