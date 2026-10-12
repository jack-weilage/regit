#!/usr/bin/env python3
"""
analytic.py -- closed-form / semi-closed-form landing-throughput model.
All rates are per hour unless noted; T in minutes.
"""
from __future__ import annotations

import math
from functools import lru_cache

DAY = 24.0


def p_eff(p, flake=0.0, conflict=0.0, f=1.0):
    """P(a queue run of one change fails): intrinsic bad, spurious (flake scaled by test fraction f),
    or semantic conflict with something already in the tested state."""
    return 1.0 - (1.0 - p) * (1.0 - flake) ** f * (1.0 - conflict)


def conflict_reject(s_repo, lam_h, window_h):
    """P(a change semantically conflicts with >=1 change that landed inside its exposure window).
    Pairs ~ lam*window; partitioning does NOT change this (conflicting pairs are physical)."""
    return 1.0 - math.exp(-s_repo * lam_h * window_h)


# ---------------------------------------------------------------- S1 race (require up to date)
def race_capacity(T):
    """At most one landing per CI duration, whatever the contender count (all runs started before a
    landing are invalidated)."""
    return 60.0 / T


def race_runs_per_land(n_contenders, pe):
    """With n contenders racing, each landing costs ~n runs (every contender reran)."""
    return max(1.0, n_contenders) / max(1e-9, 1.0 - pe ** max(1, n_contenders))


# ---------------------------------------------------------------- S2 serial queue
def serial_capacity(T, pe):
    return 60.0 * (1.0 - pe) / T


def md1_wait(lam_h, T, pe):
    """M/D/1 mean waiting time (min) for the serial queue; attempts arrive at lam/(1-pe)."""
    rho = lam_h / (1.0 - pe) * T / 60.0
    if rho >= 1:
        return math.inf
    return rho * T / (2 * (1 - rho))


# ---------------------------------------------------------------- S3 batch + bisection (Bors)
@lru_cache(maxsize=None)
def _rounds(n, b):
    """Expected sequential CI rounds to clear a group of n changes containing exactly b bad ones,
    Bors-style: test the group; on failure split in halves and process each half in turn."""
    if b == 0 or n == 1:
        return 1.0
    h = n // 2
    tot = 0.0
    # hypergeometric split of b bad changes into halves of size h and n-h
    for b1 in range(max(0, b - (n - h)), min(b, h) + 1):
        pr = math.comb(h, b1) * math.comb(n - h, b - b1) / math.comb(n, b)
        tot += pr * (_rounds(h, b1) + _rounds(n - h, b - b1))
    return 1.0 + tot


def bors_rounds(B, pe):
    return sum(math.comb(B, b) * pe ** b * (1 - pe) ** (B - b) * _rounds(B, b) for b in range(B + 1))


def bors_capacity(T, pe, B):
    """Renewal-reward: B(1-pe) changes land per E[rounds]*T minutes."""
    return 60.0 * B * (1.0 - pe) / (T * bors_rounds(B, pe))


def bors_runs_per_land(B, pe):
    return bors_rounds(B, pe) / (B * (1.0 - pe))


def bors_best(T, pe, Bs=(1, 2, 4, 8, 16, 32, 64, 128)):
    return max(((bors_capacity(T, pe, B), B) for B in Bs))


# ---------------------------------------------------------------- S4 speculative queue
def spec_landed_per_round(N, pe):
    """Changes landed per CI 'generation' of depth N: sum_{i=1..N} (1-pe)^i."""
    if pe <= 0:
        return float(N)
    return (1 - pe) * (1 - (1 - pe) ** N) / pe


def spec_capacity(T, pe, N):
    return 60.0 / T * spec_landed_per_round(N, pe)


def spec_ceiling(T, pe):
    """N -> infinity.  THE hard ceiling for any single-lane gated queue whose failures are only
    discovered by a CI run of the combined state: (1-pe)/(pe*T)."""
    return 60.0 * (1 - pe) / (pe * T) if pe > 0 else math.inf


def spec_runs_per_land(N, pe):
    """Runs consumed per landed change (synchronous-generation approximation)."""
    return N / spec_landed_per_round(N, pe)


def spec_batched_capacity(T, pe, N, B):
    """Speculative queue of batches (GitHub merge queue 'group size' > 1).  Lower bound:
    counts only batches that pass first time (good changes from failed batches land later
    via bisection, which consumes the same pipeline)."""
    q = (1 - pe) ** B
    units = q * (1 - q ** N) / (1 - q) if q < 1 else N
    return 60.0 / T * B * units


def tree_speculation_runs(N, k_hedged):
    """Uber SubmitQueue-style speculation on both outcomes for the k riskiest changes: up to 2^k
    builds per position.  Throughput ~ N/T only if k covers the failures in the window."""
    return N * 2 ** k_hedged


# ---------------------------------------------------------------- S5 partitioned + TIA
def tia_duration(T, K, m=1, g=3.0, T_fix=1.0):
    T_fix = min(T_fix, T)
    f = min(1.0, g * m / K)
    return T_fix + (T - T_fix) * f, f


def zipf_max_share(K, alpha):
    if alpha <= 0:
        return 1.0 / K
    H = sum(1.0 / (i + 1) ** alpha for i in range(K))
    return 1.0 / H


def partitioned_capacity(T, p, K, N, flake=0.0, alpha=0.0, g=3.0, T_fix=1.0, conflict=0.0):
    """Aggregate capacity = lane ceiling / share of the hottest lane."""
    Tl, f = tia_duration(T, K, 1, g, T_fix)
    pe = p_eff(p, flake, conflict, f)
    lane = spec_capacity(Tl, pe, N)
    return lane / zipf_max_share(K, alpha), lane, Tl, pe


def runner_bound(R, T_run, runs_per_land):
    """Throughput cannot exceed R runners / (minutes of CI per landed change)."""
    return R * 60.0 / (T_run * runs_per_land)


# ---------------------------------------------------------------- S6 pushrebase (optimistic)
def pushrebase_detect_time(T, lam_h, interval=None, fanout=8, revert=1.0):
    """Mean minutes from bad land to revert: wait for next postsubmit start (interval/2), run (T),
    culprit finding (ceil(log_{F+1}(changes in range)) rounds of T), revert."""
    interval = interval or T
    n = max(1, lam_h * interval / 60.0)
    rounds = max(1, math.ceil(math.log(n + 1) / math.log(fanout + 1)))
    return interval / 2 + T + rounds * T + revert


def pushrebase_break_rate(lam_h, s_repo, T_pre, p_escape=0.0):
    """Breakages per hour: escapes of intrinsically bad changes + semantic conflicts with changes that
    landed during the presubmit (the only window presubmit cannot see).  Quadratic in lam."""
    sem = 1.0 - math.exp(-s_repo * lam_h * T_pre / 60.0)
    return lam_h * (p_escape + (1 - p_escape) * sem)


def p_red(break_rate_h, D_min):
    """Fraction of time trunk is red: Poisson breakages, each red for D (M/G/inf busy probability)."""
    return 1.0 - math.exp(-break_rate_h * D_min / 60.0)


def s_unsafe(lam_h, T_pre, D_min, target=0.05):
    """Largest repo-wide pairwise semantic-conflict rate keeping P(red) <= target."""
    # r*D = -ln(1-target); r ~ lam^2 * s * T_pre
    return -math.log(1 - target) / ((lam_h ** 2) * (T_pre / 60.0) * (D_min / 60.0))


def ref_ceiling(t_ref_s, commits_per_update=1):
    """Single-ref compare-and-swap critical section: updates/h * commits per update."""
    return 3600.0 / t_ref_s * commits_per_update


if __name__ == "__main__":
    print("Hard ceilings (changes/hour), pe = effective per-change failure probability")
    print(f"{'T':>4} {'pe':>5} | {'race':>7} {'serial':>7} {'bors*':>12} {'specN32':>8} {'spec_inf':>8}")
    for T in (2, 15, 60):
        for pe in (0.02, 0.10, 0.25):
            bc, bB = bors_best(T, pe)
            print(f"{T:>4} {pe:>5} | {race_capacity(T):7.1f} {serial_capacity(T, pe):7.1f} "
                  f"{bc:8.1f}(B={bB:<3}) {spec_capacity(T, pe, 32):8.1f} {spec_ceiling(T, pe):8.1f}")
    print()
    for K in (1, 10, 100, 1000):
        for a in (0, 1.0):
            cap, lane, Tl, pe = partitioned_capacity(15, 0.10, K, 8, flake=0.01, alpha=a)
            print(f"K={K:5d} zipf={a}: lane T={Tl:5.2f} pe={pe:.3f} lane={lane:7.1f}/h  aggregate={cap:10.1f}/h"
                  f" = {cap*24:,.0f}/day")
    print()
    for lam_day in (50, 5000, 50000, 500000):
        lam = lam_day / DAY
        D = pushrebase_detect_time(15, lam)
        print(f"pushrebase lam={lam_day}/d D={D:.0f}min s*(5% red)={s_unsafe(lam, 15, D):.2e}")
