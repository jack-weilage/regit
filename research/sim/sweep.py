#!/usr/bin/env python3
"""sweep.py -- run all simulation experiments in parallel; writes out/results.json"""
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from landing_sim import simulate  # noqa: E402

BASE = dict(T=15.0, p=0.10, flake=0.01, s_repo=1e-5, W0=30.0, A_fix=20.0)
SEEDS = (1, 2, 3)

STRATS = {
    "S1 race (require up-to-date)": dict(strategy="race"),
    "S2 serial queue": dict(N=1, B=1),
    "S3 batch B=4 + bisect": dict(N=1, B=4),
    "S4 speculative N=32": dict(N=32),
    "S4b speculative N=32, batch 4": dict(N=32, B=4),
    "S5a TIA only (1 lane, K=100)": dict(N=32, K=100, tia=True, leak=0.01),
    "S5 partitioned K=10": dict(N=8, K=10, partitioned=True, tia=True, x_cross=0.05, leak=0.01),
    "S5 partitioned K=100": dict(N=8, K=100, partitioned=True, tia=True, x_cross=0.05, leak=0.01),
    "S5 partitioned K=1000": dict(N=8, K=1000, partitioned=True, tia=True, x_cross=0.05, leak=0.01),
    "S5p partitioned K=1000, perfect build graph": dict(N=8, K=1000, partitioned=True, tia=True,
                                                       x_cross=0.05, leak=0.0),
    "S5z partitioned K=1000 Zipf(1)": dict(N=8, K=1000, partitioned=True, tia=True, x_cross=0.05,
                                           leak=0.01, zipf=1.0),
    "S6 pushrebase + presubmit": dict(strategy="pushrebase"),
    "S6t pushrebase + TIA presubmit K=100": dict(strategy="pushrebase", K=100, tia=True, leak=0.01),
    "S6b push to trunk, no presubmit": dict(strategy="pushrebase", presubmit=False),
}

HOURS = {50: (720, 72), 5000: (48, 6), 50000: (12, 2), 500000: (3, 1)}


def jobs():
    J = []
    # E1: saturated capacity, single trunk
    for T in (2.0, 15.0, 60.0):
        hrs = max(12.0, 300.0 * T / 60.0)
        for p in (0.02, 0.10, 0.25):
            cfgs = {
                "S1 race n=50": dict(strategy="race", contenders=50),
                "S2 serial": dict(N=1),
                "S3 bors B=4": dict(B=4), "S3 bors B=16": dict(B=16),
                "S4 spec N=8": dict(N=8), "S4 spec N=32": dict(N=32), "S4 spec N=128": dict(N=128),
                "S4b spec N=32 B=4": dict(N=32, B=4),
            }
            for lab, c in cfgs.items():
                if lab == "S4 spec N=128" and T == 60:
                    pass
                for sd in SEEDS:
                    J.append(("E1", lab, dict(BASE, T=T, p=p, saturate=True, sim_hours=hrs,
                                              warm_hours=hrs * 0.1, seed=sd, **c)))
    # E2: scale table, open system
    for lam, (h, w) in HOURS.items():
        for lab, c in STRATS.items():
            for sd in (SEEDS if lam <= 50000 else (1,)):
                J.append(("E2", lab, dict(BASE, lam_day=lam, sim_hours=h, warm_hours=w, seed=sd,
                                          max_pending=150000, **c)))
    # E3: partitioned capacity (saturated) + Zipf stability check
    for K, hrs in ((10, 12.0), (100, 3.0), (1000, 0.6)):
        J.append(("E3", f"sat K={K}", dict(BASE, N=8, K=K, partitioned=True, tia=True, saturate=True,
                                          sim_hours=hrs, warm_hours=hrs * 0.2, s_repo=0.0)))
    for frac in (0.6, 0.8, 1.0, 1.25):
        J.append(("E3", f"zipf1 K=1000 x{frac}", dict(BASE, N=8, K=1000, partitioned=True, tia=True,
                                                     zipf=1.0, lam_day=53000 * frac, sim_hours=12,
                                                     warm_hours=2, s_repo=0.0, max_pending=20000)))
    # E4: optimistic landing safety (pushrebase), red fraction vs s_repo and load
    for lam in (50, 5000, 50000):
        h, w = HOURS[lam]
        for s in (1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3):
            for sd in SEEDS:
                J.append(("E4", f"lam={lam} s={s:g}", dict(BASE, strategy="pushrebase", lam_day=lam, s_repo=s,
                                                          blast=False, sim_hours=h, warm_hours=w, seed=sd)))
    for lam in (50, 5000):
        h, w = HOURS[lam]
        for p in (0.02, 0.10, 0.25):
            J.append(("E4b", f"nopre lam={lam} p={p}", dict(BASE, strategy="pushrebase", presubmit=False,
                                                           lam_day=lam, p=p, s_repo=0.0, blast=False,
                                                           sim_hours=h, warm_hours=w)))
    # E5: runner limits
    for R in (25, 50, 100, 200, 10**9):
        J.append(("E5", f"part K=100 50k/d R={R}", dict(BASE, **STRATS["S5 partitioned K=100"], lam_day=50000,
                                                       R=R, sim_hours=12, warm_hours=2, max_pending=20000)))
    for R in (2, 4, 8, 16, 32, 10**9):
        J.append(("E5", f"spec N=32 500/d R={R}", dict(BASE, N=32, lam_day=500, R=R, sim_hours=96,
                                                      warm_hours=12, max_pending=20000)))
    # E6: flakiness & retry on a saturated speculative queue
    for fl in (0.0, 0.01, 0.05, 0.10, 0.20):
        for rt in (False, True):
            J.append(("E6", f"flake={fl} retry={rt}", dict(BASE, N=32, flake=fl, retry_fail=rt, saturate=True,
                                                          sim_hours=80, warm_hours=8)))
    # E7: semantic conflicts & base staleness on the partitioned queue at 50k/day
    for s in (1e-6, 1e-5, 3e-5, 1e-4, 3e-4):
        for W0 in (5.0, 30.0, 120.0):
            J.append(("E7", f"s={s:g} W0={W0:g}", dict(BASE, **STRATS["S5 partitioned K=100"], lam_day=50000,
                                                      s_repo=s, W0=W0, sim_hours=12, warm_hours=2,
                                                      max_pending=20000)))
    # E8: latency vs load (T=15, p=0.1)
    for lam in (12, 24, 48, 60, 72, 80):
        J.append(("E8", f"serial lam={lam}", dict(BASE, N=1, lam_day=lam, sim_hours=24 * 120, warm_hours=24 * 10)))
    for lam in (24, 48, 96, 160, 240, 320):
        J.append(("E8", f"race lam={lam}", dict(BASE, strategy="race", lam_day=lam, sim_hours=24 * 60,
                                               warm_hours=24 * 6, max_pending=5000)))
    for lam in (100, 200, 400, 550, 650, 750):
        J.append(("E8", f"spec32 lam={lam}", dict(BASE, N=32, lam_day=lam, sim_hours=24 * 20, warm_hours=48)))
    for lam in (5000, 20000, 50000, 100000, 200000, 400000):
        J.append(("E8", f"partK100 lam={lam}", dict(BASE, **STRATS["S5 partitioned K=100"], lam_day=lam,
                                                   sim_hours=max(4, 600000 / lam), warm_hours=1, max_pending=20000)))
    # E9: cross-partition fraction
    for x in (0.0, 0.05, 0.2, 0.5):
        J.append(("E9", f"x_cross={x}", dict(BASE, N=8, K=100, partitioned=True, tia=True, x_cross=x,
                                             m_cross=3, leak=0.01, lam_day=50000, sim_hours=12, warm_hours=2,
                                             max_pending=20000)))
    return J


def run_job(j):
    exp, lab, kw = j
    t = time.time()
    r = simulate(**kw)
    r["exp"], r["label"], r["wall_s"] = exp, lab, time.time() - t
    return r


if __name__ == "__main__":
    only = set(sys.argv[1:])
    J = [j for j in jobs() if not only or j[0] in only]
    out_path = os.path.join(HERE, "out", "results.json")
    prev = []
    if only and os.path.exists(out_path):
        prev = [r for r in json.load(open(out_path)) if r["exp"] not in only]
    print(f"{len(J)} jobs", flush=True)
    res = []
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        futs = [ex.submit(run_job, j) for j in J]
        for i, f in enumerate(as_completed(futs)):
            r = f.result()
            res.append(r)
            if r["wall_s"] > 20:
                print(f"  slow: {r['exp']} {r['label']} lam={r['lam_day']} {r['wall_s']:.0f}s", flush=True)
            if (i + 1) % 25 == 0:
                print(f"{i+1}/{len(J)} done ({time.time()-t0:.0f}s)", flush=True)
    json.dump(prev + res, open(out_path, "w"), default=str)
    print("wrote", out_path, f"{time.time()-t0:.0f}s")
