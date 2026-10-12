# 19 — Landing-throughput model: how many changes/day can one trunk absorb?

Model: `sim/analytic.py` (closed form) + `sim/landing_sim.py` (discrete-event sim), driven by `sim/sweep.py`, tabulated by `sim/report.py` (full tables `sim/out/tables.md`, charts `sim/out/fig1..6*.png`). Rerun on 2026-10-12, `python3 -I`; the 627 runs took ~2.5 min wall on 4 cores. Sim = mean of 3 seeds up to 50k/day, 1 seed at 500k/day.

## Headline numbers

All at CI duration T = 15 min, intrinsic failure rate p = 10%, flake rate 1% per full-suite run, and semantic-conflict rate s = 1e-5 per concurrent pair, unless stated.

| | |
|---|---|
| Serial merge-queue ceiling | (1-p_e)/T = **3.6/h = 86/day** |
| "Require up to date" rebase-retry ceiling | 1/T = **4/h = 96/day**, at 73 CI runs per landed change when saturated |
| Speculative queue ceiling, any depth | (1-p_e)/(p_e·T) = **32.7/h = 785/day** |
| Batch of 4 at p = 10% passes clean | (0.9)^4 = **66%**; at B = 16, **18.5%** |
| Speculative N = 32: CI runs per landed change | **4.0** (75% of CI compute wasted) |
| One lane with test-impact analysis (TIA, K = 100) | ~**300/h ≈ 7,000/day** |
| Partitioned, K = 100, uniform | **21,200/h** in sim (analytic 21,600) |
| Partitioned, K = 1000, Zipf(1) skew | **2,209/h = 53k/day**: the hottest lane (13.4% of traffic) sets the cap |
| Optimistic pushrebase at 50k/day | trunk red **≥ 5%** once s > **4e-8** (at 5k/day: 5.3e-6) |
| Only configuration stable at 500k/day | partitioned K = 1000, uniform, **perfect build graph** (0% hidden cross-partition dependencies) |

## 1. Assumptions

- **Arrivals:** Poisson, at λ = 50, 5,000, 50,000 and 500,000 changes/day (2.1, 208, 2,083 and 20,833/h). Each change's base is 30 min stale when first submitted (W0).
- **Failures:**
  - Each attempt is intrinsically bad with probability p, independently.
  - A flake fails a full-suite run with probability 1%. With TIA it scales as 1-(1-flake)^f, where f is the fraction of tests run.
  - After a real failure, conflict or revert, the agent reworks for 20 min, makes a fresh draw of p, and rebases onto current trunk. After a flake it resubmits in 2 min.
- **Semantic conflicts:**
  - Each pair of concurrent changes is incompatible with probability s_repo. Each change passes alone; together they fail.
  - Partitioning concentrates these pairs inside partitions: s_same = s·K·(1-leak). It does not reduce the total number of conflicting pairs.
  - `leak` is the fraction of conflicting pairs that cross partitions. These are dependencies the build graph cannot see, and only post-land CI catches them.
- **TIA:** run time = 1 min + (T-1)·min(1, 3m/K), where m is the number of partitions the change touches and K the number of partitions. At K = 100 that is 1.42 min. 5% of changes span 2 partitions (3 in E9).
- **Pushrebase:**
  - The server rebases and lands unless a same-file textual overlap appears (rate 2.5e-4 per pair).
  - Post-land full CI runs back to back. Culprit finding probes 8-wide in rounds of T, then the culprit is reverted.
  - A red partition blocks presubmits and queue runs that touch it.
- **Runners:** unlimited, except in E5.
- **Instability:** flagged when the backlog grows by more than max(20, 5% of arrivals) during the run. Throughput shown for an UNSTABLE run is whatever got through.

Strategy key:

| Code | Strategy |
|---|---|
| S1 | Serial rebase-retry ("require branch up to date") |
| S2 | Serial merge queue |
| S3 | Batch + bisect (Bors) |
| S4 | Speculative merge queue (Zuul / GitHub merge queue), depth N |
| S5 | Partitioned lanes + TIA |
| S6 | Optimistic pushrebase + post-land revert |

## 2. Closed-form results

p_e is the effective failure probability: p_e = 1-(1-p)(1-flake)^f(1-c), where c is the conflict probability. At p = 2%, 10% and 25%, p_e = 3.0%, 10.9% and 25.8%.

**Serial (S1/S2).**
- S1 throughput is 1/T no matter how many agents contend: every landing invalidates every run that is in flight.
- S2 throughput is (1-p_e)/T. Mean wait follows M/D/1 with ρ = λT/(1-p_e).
- At T = 15, 60 and 2 min, the S2 ceiling is 3.6, 0.9 and 27/h.

**Batch + bisect (S3).** A batch of B passes clean with probability (1-p)^B. The expected number of rounds is given by a recursive bisection formula. Values below are p_e at T = 15 (best B in bold):

| p | (1-p)^4 | (1-p)^16 | (1-p)^64 | B=1 | B=4 | B=8 | B=16 | runs/land at best B |
|---|---|---|---|---|---|---|---|---|
| 2% | 0.92 | 0.72 | 0.27 | 3.9/h | 10.6 | 13.2 | **13.9** | 0.29 |
| 5% | 0.82 | 0.44 | 0.04 | 3.8 | 7.9 | **8.4** | 8.1 | 0.47 |
| 10% | 0.66 | 0.19 | 0.001 | 3.6 | **5.6** | 5.3 | 5.0 | 0.72 |
| 25% | 0.32 | 0.01 | 0 | 3.0 | 2.8 | 2.6 | 2.5 | 1.28 (B=2) |

Batching is a compute saver, not a throughput lever. Its gain over serial is at most 3.6× at p = 2% and about 1× at p ≥ 25%.

**Speculative queue (S4).**
- Per generation of depth N, the queue lands Σ_{i=1..N}(1-p_e)^i changes, so capacity = (1/T)·(1-p_e)(1-(1-p_e)^N)/p_e.
- As N → ∞ this approaches the ceiling **(1-p_e)/(p_e·T)**. This is the hard limit for any single lane that discovers failures only by running CI on the combined state.
- Waste = 1 - 1/(runs per landed change), with runs per landed change = N/Σ(1-p_e)^i.

| p | N=8 cap / runs per land / waste | N=32 | N=128 | ceiling | N for 90% of ceiling |
|---|---|---|---|---|---|
| 2% | 28.0/h · 1.14 · 13% | 80.8 · 1.58 · 37% | 127.5 · 4.0 · 75% | 130/h | 77 |
| 10% | 19.7 · 1.62 · 38% | 31.9 · 4.0 · 75% | 32.7 · 15.7 · 94% | 32.7/h | 20 |
| 25% | 10.5 · 3.1 · 67% | 11.5 · 11.1 · 91% | 11.5 · 44 · 98% | 11.5/h | 8 |

Going deeper than about ln 10/p_e only burns compute.

**Partitioned + TIA (S5).** Aggregate capacity = lane ceiling at T_lane ÷ the traffic share of the hottest lane. The hottest lane's share under Zipf skew:

| K | α = 0.8 | α = 1.0 | α = 1.2 |
|---|---|---|---|
| 100 | 12.3% | 19.3% | 27.8% |
| 1,000 | 6.5% | 13.4% | 23.1% |
| 10,000 | 3.7% | 10.2% | 20.8% |

Under skew, the cap stops scaling with K.

**Optimistic pushrebase (S6).**
- Trunk breaks at rate λ·(1-e^{-s·λ·T_pre}), which is quadratic in λ. T_pre is the presubmit duration.
- A break is detected and reverted after D = interval/2 + T + rounds·T + 1 min. D is 38, 54, 68 and 84 min at 50, 5k, 50k and 500k changes/day.
- The trunk is red a fraction P(red) = 1-e^{-rate·D} of the time.
- The largest s that keeps P(red) ≤ 5% is **7e-2, 5.3e-6, 4.1e-8 and 3.4e-10** at those four loads: each 10× in load costs about 100× in tolerable s.

## 3. Simulation tables

### E1 — Single-trunk saturated capacity (landed/h; sim [analytic] / CI min per landed change)

| T | p | S1 race | S2 serial | S3 B=4 | S4 N=8 | S4 N=32 | S4 N=128 | S4b N=32,B=4 |
|---|---|---|---|---|---|---|---|---|
| 2 | 2% | 30 [30] / 106 | 29 / 2 | 94 [80] / 1 | 212 [210] / 2 | 564 [606] / 3 | 748 [956] / 10 | 395 / 5 |
| 2 | 10% | 30 / 149 | 27 / 2 | 45 [42] / 1 | 142 [148] / 3 | 220 [239] / 8 | 226 [245] / 33 | 94 / 20 |
| 15 | 2% | 4.0 / 790 | 3.9 / 15 | 12 [11] / 5 | 27 [28] / 17 | 75 [81] / 25 | 106 [128] / 70 | 54 / 35 |
| 15 | 10% | 4.1 / 1,099 | 3.6 / 17 | 5.5 [5.6] / 11 | 19.6 [19.7] / 24 | 29.3 [31.9] / 63 | 30.3 [32.7] / 245 | 11.5 / 164 |
| 15 | 25% | 4.1 / 2,200 | 3.1 / 20 | 3.1 [2.8] / 19 | 10.1 [10.5] / 47 | 10.6 [11.5] / 176 | 12.2 [11.5] / 613 | 4.4 / 430 |
| 60 | 10% | 1.0 / 4,690 | 0.9 / 67 | 1.4 / 42 | 4.7 [4.9] / 101 | 7.3 [8.0] / 256 | 7.5 [8.2] / 988 | 3.0 / 634 |
| 60 | 25% | 1.0 / 8,028 | 0.7 / 81 | 0.7 / 82 | 2.6 / 182 | 2.8 / 678 | 2.9 / 2,604 | 1.2 / 1,552 |

- The sim agrees with the closed form within ±10% for S1, S2 and S4 at N ≤ 32. For S4 at N = 128, the closed form overstates capacity at low p: its synchronous-generation approximation is optimistic by up to 22%.
- **Batched speculation (S4b) is worse than plain speculation** in the sim: 11.5 vs 29.3/h. Each bisection round restarts everything queued behind the batch. The closed-form "lower bound" for S4b (27.3/h) is therefore not a bound.

### E2 — Open-system scaling (T = 15, p = 10%, flake 1%, s = 1e-5, W0 = 30 min, leak 1% where TIA is on)

Cells: landed/h · p95 submit→land latency · CI min per landed change · % of time any part of trunk is red / share-weighted red. "UNST" = unstable.

| Strategy | 50/day (2.1/h) | 5,000/day (208/h) | 50,000/day (2,083/h) | 500,000/day (20,833/h) |
|---|---|---|---|---|
| S1 rebase-retry | 2.1 · 87m · 34 · 0 | 4.2 UNST · 79,736 CI-min | 4.2 UNST | 4.0 UNST |
| S2 serial queue | 2.0 · 80m · 17 · 0 | 3.6 UNST | 3.6 UNST | 4.0 UNST |
| S3 batch 4 + bisect | 2.0 · 77m · 16 · 0 | 6.2 UNST | 5.9 UNST | 4.0 UNST |
| S4 speculative N=32 | 2.1 · 50m · 18 · 0 | 27.8 UNST | 32.3 UNST | 28.0 UNST |
| S4b spec N=32, B=4 | 2.1 · 50m · 18 · 0 | 11.3 UNST | 12.5 UNST | 4.0 UNST |
| S5a TIA, one lane (K=100) | 2.1 · 23m · 30 · 0 | 208 · 25m · 2.9 · 0 | 293 UNST | 330 UNST |
| S5 partitioned K=10 | 2.1 · 30m · 35 · 0 | 209 · 34m · 7.6 · 1.4/0.14 | 277 UNST | 258 UNST |
| S5 partitioned K=100 | 2.2 · 23m · 30 · 0 | 208 · 23m · 1.9 · 0.8/0.01 | **2,086 · 23m · 1.7 · 14/0.17** | 3,692 UNST (75/3.0) |
| S5 partitioned K=1000 | 2.1 · 22m · 30 · 0 | 209 · 22m · 1.5 · 0 | **2,091 · 22m · 1.2 · 19/0.02** | 18,446 UNST (100/2.4) |
| S5p K=1000, leak = 0 | 2.1 · 22m · 1.2 · 0 | 209 · 22m · 1.2 · 0 | 2,082 · 22m · 1.2 · 0 | **20,484 · 23m · 1.4 · 0** |
| S5z K=1000, Zipf(1) | 2.1 · 22m · 30 · 0 | 209 · 22m · 1.5 · 0 | 752 UNST | 2,278 UNST |
| S6 pushrebase, full presubmit | 2.1 · 50m · 46 · 0 | 208 · 72m · 23 · **14.6** | 1,916 UNST · 85% red | 4,454 UNST · 87% red |
| S6t pushrebase, TIA presubmit | 2.2 · 23m · 30 · 0 | 209 · 23m · 1.9 · 0.6/0.01 | 2,067 · 23m · 2.1 · 79/1.6 | 5,940 UNST · 100/87 |
| S6b push, no presubmit | 2.1 · 59m · 42 · **13.2** | 209 · 100% red | 2,118 · 100% red | 22,182 · 100% red |

At 50/day, the TIA rows cost about 30 CI min per landed change. Most of that is post-land full-suite CI that runs whether or not changes arrive; with leak = 0 (S5p) it drops to 1.2.

### E3 — Partition capacity and skew (s = 0)

| Case | Sim landed/h | Analytic | Backlog start → end |
|---|---|---|---|
| Saturated K=10 | 560 | 584 | flat |
| Saturated K=100 | 21,198 | 21,632 | flat |
| Saturated K=1000 | 290,162 | 295,116 | — |
| Zipf(1) K=1000 at 60% / 80% / 100% / 125% of analytic cap | 1,318 / 1,731 / 2,186 / 2,692 | 2,209 | 81→91 / 104→97 / 248→297 / **361→1,185** (p95 103m) |

At 125% the sim's stability flag reads "stable", but the backlog tripled in 10 h: this case is overloaded.

### E4 — Optimistic landing: % of time trunk is red vs s (pushrebase + full presubmit, T = 15)

| s_repo | 50/day sim [analytic] | 5,000/day | 50,000/day |
|---|---|---|---|
| 1e-7 | 0 [0] | 0 [0.1] | 22 [12] |
| 1e-6 | 0 [0] | 1.4 [1.0] | 60 [71] |
| 1e-5 | 0 [0] | 12.9 [9.2] | 100 [100] |
| 1e-4 | 0 [0.01] | 64 [62] | 100 |
| 1e-3 | 0.1 [0.07] | 100 | 100 |

Mean time from land to revert: 40, 54 and 69 min at the three loads.

Without a presubmit (s = 0), the red fraction:

| Load | p = 2% | p = 10% | p = 25% |
|---|---|---|---|
| 50/day | 1.9% | 15.5% | 41% |
| 5,000/day | 99% | 100% | 100% |

### E5 — CI runner pool

| Configuration | Runners R | Result |
|---|---|---|
| Partitioned K=100, 50k/day | 25 | 611/h UNST |
| | 50 | 1,170/h UNST |
| | ≥100 | 2,094/h, p95 23m |
| Speculative N=32, 500/day | 2 / 4 / 8 | 6.8 / 12.1 / 19.0 UNST |
| | 16 | 20.5/h, 28.8 CI min per landed change |
| | unlimited | 20.3/h, 38.8 CI min per landed change |

- The partitioned queue needs about λ × CI-min per landed change ≈ 59 runners busy on average, plus headroom.
- Capping a speculative queue's runners at about its average need cuts compute by 26% with no throughput loss.

### E6 — Flakiness (speculative N=32, saturated, landed/h)

| Flake rate | 0% | 1% | 5% | 10% | 20% |
|---|---|---|---|---|---|
| No retry | 31.8 | 30.0 | 25.3 | 19.0 | 9.8 |
| Retry once before ejecting | 17.9 | 14.8 | 13.0 | 15.4 | 13.0 |

- Going from 0% to 10% flake costs 40% of capacity.
- Retrying a failure before ejecting the change halves capacity: every truly bad change now blocks the lane for 2T. Retry only pays above about 15% flake, where p_flake > p.

### E7 — Semantic conflicts × base staleness (partitioned K=100, 50k/day)

| s_repo | W0 = 5 min | 30 min | 120 min |
|---|---|---|---|
| 1e-6 | 2,082 · 0% red | 2,082 · 0% | 2,071 · 0% |
| 1e-5 | 2,087 · 0% | 2,094 · 6.8% | 2,069 · 91% |
| 3e-5 | 2,071 · 12% | 2,075 · 61% | 2,002 · 93%, p95 86m |
| 1e-4 | 2,094 · 50% | 1,751 UNST | 1,345 UNST |
| 3e-4 | 1,276 UNST | 919 UNST | 552 UNST |

Conflict rejections per landed change rise from 0.003 (s = 1e-5, W0 = 5) to 1.5 (s = 3e-4, W0 = 120).

### E8 — Latency vs load (p50 / p95; T = 15, p = 10%)

| Strategy | Load (changes/day) → p50 / p95 |
|---|---|
| Serial queue | 24/day: 15m/52m · 48: 22m/77m · 72: 45m/2.9h · 80: 98m/6.1h |
| Rebase-retry | 48/day: 30m/90m · 96: 18.5h/80h · 160: UNST |
| Speculative N=32 | 200/day: 15m/53m · 550: 29m/107m · 650: 58m/3.1h · 750: UNST |
| Partitioned K=100 | 5k–50k/day: 1m/23m · 100k: UNST (2,668/h landed) · 200k: 2,906/h · **400k: 80/h** |

### E9 — Changes spanning several partitions (K=100, 50k/day, each spanning change touches 3 partitions)

| Share of changes spanning partitions | 0% | 5% | 20% | 50% |
|---|---|---|---|---|
| Landed/h | 2,075 | 2,070 | 1,283 UNST | 799 UNST |

## 4. Which strategy is required at which scale (T = 15, p = 10%)

| Load | Minimum viable strategy | Why the cheaper ones fail |
|---|---|---|
| **50/day** | Serial merge queue: utilization 58%, p95 80 min. Speculation or TIA cuts p95 to 50 or 23 min. | Rebase-retry works but doubles CI (34 vs 17 min per change) and degrades fast: p95 is 80 h at 96/day. Push without presubmit leaves trunk red 13% of the time. |
| **5,000/day** | One lane with TIA (S5a), or partitioning with K ≥ 10. Pushrebase with a TIA presubmit also works. | No full-suite single lane can do it. The speculative ceiling is 785/day; reaching 5k needs T ≤ 2.4 min or p_e ≤ 1.9%. Pushrebase with full presubmit lands everything but keeps trunk red 14.6% of the time, which is acceptable only if s ≤ 5e-6. |
| **50,000/day** | Partitioned + TIA with K ≥ 100 and roughly uniform load, s ≤ 3e-5, W0 ≤ 30 min, ≤ 5% of changes spanning partitions, and ≥ 60 runners. | One TIA lane caps at ~7k/day and K = 10 at ~13k/day. Zipf(1) K = 1000 caps at 53k/day analytically and is unstable in the sim once conflicts are added. Pushrebase leaves trunk 85% red. |
| **500,000/day** | Partitioned K ≥ 1000, uniform, and **no hidden cross-partition dependencies**. This is the only stable row. | 1% leak gives 100% any-red and an unstable queue. Zipf skew: 2.3k/h. Every optimistic scheme is red 87–100% of the time. Push without presubmit "lands" 22k/h on a permanently red trunk. |

Also required at 500k/day, though not simulated: trunk-ref updates must take ≤ 173 ms each (3,600/20,833 s), or commits must be grouped into ref updates. At 50 ms per update, a single ref caps at 72k/h.

## 5. The dominant lever

Closed-form capacity multipliers relative to S4 at N = 32 (765/day):

| Lever | Multiplier | Capacity/day |
|---|---|---|
| Speculation depth 32 → 512 | 1.0× | 785 |
| Batch 4 + bisect instead of speculation | 0.2× | 133 |
| Failure rate 10% → 2% | 2.5× | 1,938 |
| CI time 15 → 7.5 min | 2.0× | 1,530 |
| CI time 15 → 2 min | 7.5× | 5,739 |
| Partition K = 100 + TIA, Zipf(1) | 60× | 45,600 |
| Partition K = 1000 + TIA, Zipf(1) | 118× | 89,900 |
| Partition K = 100 + TIA, uniform | 1,149× | 879,000 |

1. **Below ~1k/day, T and p_e are equal levers.** Capacity scales as (1-p_e)/(p_e·T), so halving either one doubles capacity. Flakes count inside p_e: 10% flake costs as much as 10% bad changes. Queue-engine features beyond basic speculation add nothing; more depth is pure waste, and batching hurts at p ≥ 10%.
2. **From 5k to 50k/day, the lever is how much of the repo each change must be tested against.** TIA plus a partitioned build graph cuts the lane time T and the load per lane together; nothing else delivers more than 10×. Skew, not K, sets the result: at Zipf(1), going from K = 100 to K = 1000 only doubles capacity.
3. **Above 50k/day, the binding terms are quadratic.**
   - Semantic-conflict exposure ∝ s·λ·W (E7): going from W0 = 30 to 5 min stabilizes s = 1e-4.
   - Hidden-dependency breaks ∝ s·leak·λ²·W: leak 1% → 0 is the difference between unstable and stable at 500k/day.
   - Optimistic landing tolerates s only up to ~1/(λ²·T·D) per pair.
   - Overload does not plateau, it collapses: at 400k/day the K = 100 queue lands 80/h, versus 2,906/h at 200k/day. Admission control is therefore mandatory.

So the forge's job at agent scale is to **know the dependency graph exactly and keep bases fresh**. Faster CI and smarter queues are second-order.

## 6. Limits of the model

- **Parameters are assumed, not measured.** s_repo, leak, W0, g = 3 and the 20-min rework time all drive the large-scale results. Real values for agent fleets are unknown, and s matters most: 10× in s moves the 50k/day verdict from stable to unstable.
- **Conflicts are independent pairwise draws.** Real conflicts cluster around hot files, shared APIs, and agents working on the same task. This makes skew and conflict effects worse than modelled.
- **TIA is idealized.** The affected fraction is min(1, 3m/K) with a 1-min floor, and leakage is uniform. Real build graphs have hub targets that put a large share of changes in every lane.
- **Failures are independent Bernoulli draws per attempt,** including after rework. There is no learning, no correlated agent errors, and no bad changes that pass CI and escape to production.
- **Lanes and queues are simplified.**
  - Partitioned lanes use B = 1 and do no cross-lane speculation.
  - Changes spanning partitions land atomically across all their lanes.
  - There is no priority or preemption, and no auto-resolution of conflicts.
- **Pushrebase is idealized.** Culprit finding probes 8-wide and the revert itself never conflicts. "Red" means any partition is red, and red partitions block work (blast). Real forges may let unaffected work proceed, so the share-weighted column is the gentler reading.
- **Bisection behaviour is implementation-specific.** S4b's poor result comes from this sim's bisection scheme. Production merge queues differ.
- **Sim validity limits.**
  - Sim horizons are 3 h with 1 seed at 500k/day.
  - The stability flag (backlog growth > 5% of arrivals) misses mild overload; the Zipf case at 125% load is an example.
  - Unstable throughput figures depend on the run length.
- **Out of scope:**
  - Human review time, merge-conflict resolution, and deploy coupling.
  - Ref-update CAS contention and CI cost in dollars.
  - Agent coding time; latency here is submit→land only.
