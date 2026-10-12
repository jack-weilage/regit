### Table E1 - saturated capacity of a single trunk (changes/hour; sim mean of 3 seeds, [analytic])

flake=1%/run, s_repo=1e-5, W0=30 min, unlimited runners. Second number per cell = CI runner-minutes per landed change.

| T | p | S1 race n=50 | S2 serial | S3 bors B=4 | S3 bors B=16 | S4 spec N=8 | S4 spec N=32 | S4 spec N=128 | S4b spec N=32 B=4 | analytic ceiling N=inf |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 2% | 30.4 [30.0] / 106m | 29.1 [29.1] / 2m | 93.8 [79.6] / 1m | 130.5 [104.0] / 0m | 211.9 [210.0] / 2m | 563.9 [605.8] / 3m | 747.6 [956.4] / 10m | 394.8 [913.4] / 5m | 976.7 |
| 2 | 10% | 30.4 [30.0] / 149m | 26.7 [26.7] / 2m | 44.8 [41.7] / 1m | 40.3 [37.7] / 1m | 141.7 [147.8] / 3m | 219.6 [239.1] / 8m | 225.9 [245.2] / 33m | 94.2 [204.5] / 20m | 245.2 |
| 2 | 25% | 30.6 [30.0] / 308m | 22.3 [22.3] / 3m | 22.1 [21.3] / 3m | 17.2 [18.4] / 4m | 72.1 [78.5] / 7m | 83.0 [86.5] / 23m | 94.0 [86.5] / 79m | 33.8 [52.4] / 56m | 86.5 |
| 15 | 2% | 4.0 [4.0] / 790m | 3.9 [3.9] / 15m | 12.1 [10.6] / 5m | 19.5 [13.9] / 3m | 27.3 [28.0] / 17m | 74.7 [80.8] / 25m | 106.0 [127.5] / 70m | 54.4 [121.8] / 35m | 130.2 |
| 15 | 10% | 4.1 [4.0] / 1099m | 3.6 [3.6] / 17m | 5.5 [5.6] / 11m | 5.4 [5.0] / 11m | 19.6 [19.7] / 24m | 29.3 [31.9] / 63m | 30.3 [32.7] / 245m | 11.5 [27.3] / 164m | 32.7 |
| 15 | 25% | 4.1 [4.0] / 2200m | 3.1 [3.0] / 20m | 3.1 [2.8] / 19m | 2.5 [2.5] / 24m | 10.1 [10.5] / 47m | 10.6 [11.5] / 176m | 12.2 [11.5] / 613m | 4.4 [7.0] / 430m | 11.5 |
| 60 | 2% | 1.0 [1.0] / 3170m | 1.0 [1.0] / 62m | 2.9 [2.7] / 20m | 4.8 [3.5] / 13m | 6.9 [7.0] / 68m | 18.8 [20.2] / 99m | 28.4 [31.9] / 260m | 14.3 [30.4] / 135m | 32.6 |
| 60 | 10% | 1.0 [1.0] / 4690m | 0.9 [0.9] / 67m | 1.4 [1.4] / 42m | 1.3 [1.3] / 47m | 4.7 [4.9] / 101m | 7.3 [8.0] / 256m | 7.5 [8.2] / 988m | 3.0 [6.8] / 634m | 8.2 |
| 60 | 25% | 1.0 [1.0] / 8028m | 0.7 [0.7] / 81m | 0.7 [0.7] / 82m | 0.7 [0.6] / 90m | 2.6 [2.6] / 182m | 2.8 [2.9] / 678m | 2.9 [2.9] / 2604m | 1.2 [1.7] / 1552m | 2.9 |

### Table E2 - open-system scaling (T=15 min, p=10%, flake=1%, s_repo=1e-5, W0=30 min, leak=1% where TIA)

Cells: landed/hour (offered) | p50 / p95 latency submit->final land | CI min per landed | % time trunk red. UNSTABLE = queue grows without bound (throughput shown is what got through during the run).


**50 changes/day (offered 2.1/h)**

| strategy | landed/h | p50 | p95 | CI min/landed | trunk red % (any / share-weighted) | rejections (bad/conflict/flake/textual/blocked/stale) |
|---|---|---|---|---|---|---|
| S1 race (require up-to-date) | 2.1 | 30m | 87m | 33.8 | 0.0 / 0.00 | 486/0/86/0/0/5071 |
| S2 serial queue | 2.0 | 24m | 80m | 16.9 | 0.0 / 0.00 | 539/0/33/0/0/0 |
| S3 batch B=4 + bisect | 2.0 | 18m | 77m | 15.5 | 0.0 / 0.00 | 533/0/33/0/0/0 |
| S4 speculative N=32 | 2.1 | 15m | 50m | 17.5 | 0.0 / 0.00 | 542/0/45/0/0/0 |
| S4b speculative N=32, batch 4 | 2.1 | 15m | 50m | 17.5 | 0.0 / 0.00 | 542/0/45/0/0/0 |
| S5a TIA only (1 lane, K=100) | 2.1 | 1m | 23m | 29.7 | 0.0 / 0.00 | 513/0/3/0/0/0 |
| S5 partitioned K=10 | 2.1 | 5m | 30m | 34.5 | 0.0 / 0.00 | 497/0/17/0/0/0 |
| S5 partitioned K=100 | 2.2 | 1m | 23m | 29.5 | 0.0 / 0.00 | 523/0/0/0/0/0 |
| S5 partitioned K=1000 | 2.1 | 1m | 22m | 29.8 | 0.0 / 0.00 | 494/0/2/0/0/0 |
| S5p partitioned K=1000, perfect build graph | 2.1 | 1m | 22m | 1.2 | 0.0 / 0.00 | 540/0/0/0/0/0 |
| S5z partitioned K=1000 Zipf(1) | 2.1 | 1m | 22m | 29.9 | 0.0 / 0.00 | 550/2/0/0/0/0 |
| S6 pushrebase + presubmit | 2.1 | 15m | 50m | 45.7 | 0.0 / 0.00 | 567/0/41/0/0/0 |
| S6t pushrebase + TIA presubmit K=100 | 2.2 | 1m | 23m | 29.5 | 0.0 / 0.00 | 508/0/3/0/0/0 |
| S6b push to trunk, no presubmit | 2.1 | 0s | 59m | 41.7 | 13.2 / 13.18 | 0/0/0/0/0/0 |

**5,000 changes/day (offered 208.3/h)**

| strategy | landed/h | p50 | p95 | CI min/landed | trunk red % (any / share-weighted) | rejections (bad/conflict/flake/textual/blocked/stale) |
|---|---|---|---|---|---|---|
| S1 race (require up-to-date) | 4.2 **UNSTABLE** | - | - | 79,736 | 0.0 / 0.00 | 3397/24/28377/0/0/2804371 |
| S2 serial queue | 3.6 **UNSTABLE** | - | - | 16.7 | 0.0 / 0.00 | 53/0/10/0/0/0 |
| S3 batch B=4 + bisect | 6.2 **UNSTABLE** | - | - | 9.7 | 0.0 / 0.00 | 91/0/0/0/0/0 |
| S4 speculative N=32 | 27.8 **UNSTABLE** | - | - | 67.0 | 0.0 / 0.00 | 474/22/55/0/0/0 |
| S4b speculative N=32, batch 4 | 11.3 **UNSTABLE** | - | - | 167.3 | 0.0 / 0.00 | 206/1/3/0/0/0 |
| S5a TIA only (1 lane, K=100) | 208.2 | 2m | 25m | 2.9 | 0.0 / 0.00 | 3359/47/12/0/0/0 |
| S5 partitioned K=10 | 209.4 | 6m | 34m | 7.6 | 1.4 / 0.14 | 3337/60/85/0/0/0 |
| S5 partitioned K=100 | 208.1 | 1m | 23m | 1.9 | 0.8 / 0.01 | 3361/39/13/0/0/0 |
| S5 partitioned K=1000 | 208.6 | 1m | 22m | 1.5 | 0.0 / 0.00 | 3396/29/3/0/0/0 |
| S5p partitioned K=1000, perfect build graph | 209.2 | 1m | 22m | 1.2 | 0.0 / 0.00 | 3282/29/0/0/0/0 |
| S5z partitioned K=1000 Zipf(1) | 208.8 | 1m | 22m | 1.5 | 0.0 / 0.00 | 3522/998/0/0/0/0 |
| S6 pushrebase + presubmit | 208.3 | 15m | 72m | 23.1 | 14.6 / 14.61 | 3366/41/311/502/9639/0 |
| S6t pushrebase + TIA presubmit K=100 | 209.2 | 1m | 23m | 1.9 | 0.6 / 0.01 | 3324/28/12/36/34/0 |
| S6b push to trunk, no presubmit | 209.1 | 0s | 74m | 4.9 | 100.0 / 100.00 | 0/0/0/0/0/0 |

**50,000 changes/day (offered 2,083.3/h)**

| strategy | landed/h | p50 | p95 | CI min/landed | trunk red % (any / share-weighted) | rejections (bad/conflict/flake/textual/blocked/stale) |
|---|---|---|---|---|---|---|
| S1 race (require up-to-date) | 4.2 **UNSTABLE** | - | - | 206,661 | 0.0 / 0.00 | 8088/16/17231/0/0/1721821 |
| S2 serial queue | 3.6 **UNSTABLE** | - | - | 16.5 | 0.0 / 0.00 | 15/0/0/0/0/0 |
| S3 batch B=4 + bisect | 5.9 **UNSTABLE** | - | - | 10.9 | 0.0 / 0.00 | 22/0/0/0/0/0 |
| S4 speculative N=32 | 32.3 **UNSTABLE** | - | - | 59.6 | 0.0 / 0.00 | 128/0/9/0/0/0 |
| S4b speculative N=32, batch 4 | 12.5 **UNSTABLE** | - | - | 161.7 | 0.0 / 0.00 | 59/0/1/0/0/0 |
| S5a TIA only (1 lane, K=100) | 292.8 **UNSTABLE** | - | - | 6.3 | 4.8 / 0.05 | 1183/183/1/0/0/0 |
| S5 partitioned K=10 | 277.2 **UNSTABLE** | - | - | 9.6 | 0.0 / 0.00 | 1142/174/36/0/0/0 |
| S5 partitioned K=100 | 2085.5 | 1m | 23m | 1.7 | 14.3 / 0.17 | 8322/889/19/0/0/0 |
| S5 partitioned K=1000 | 2090.7 | 1m | 22m | 1.2 | 18.5 / 0.02 | 8206/819/0/0/0/0 |
| S5p partitioned K=1000, perfect build graph | 2081.9 | 1m | 22m | 1.2 | 0.0 / 0.00 | 8232/849/2/0/0/0 |
| S5z partitioned K=1000 Zipf(1) | 751.5 **UNSTABLE** | - | - | 3.0 | 20.7 / 0.80 | 3957/4419/2/0/0/0 |
| S6 pushrebase + presubmit | 1915.9 **UNSTABLE** | - | - | 110.9 | 85.5 / 85.47 | 8418/1888/920/32139/344921/0 |
| S6t pushrebase + TIA presubmit K=100 | 2067.2 | 1m | 23m | 2.1 | 78.9 / 1.55 | 8267/715/29/1114/11104/0 |
| S6b push to trunk, no presubmit | 2117.9 | 0s | 90m | 0.7 | 100.0 / 100.00 | 0/0/0/0/0/0 |

**500,000 changes/day (offered 20,833.3/h)**

| strategy | landed/h | p50 | p95 | CI min/landed | trunk red % (any / share-weighted) | rejections (bad/conflict/flake/textual/blocked/stale) |
|---|---|---|---|---|---|---|
| S1 race (require up-to-date) | 4.0 **UNSTABLE** | - | - | 610,103 | 0.0 / 0.00 | 6116/3/3307/0/0/325237 |
| S2 serial queue | 4.0 **UNSTABLE** | - | - | 15.0 | 0.0 / 0.00 | 1/0/0/0/0/0 |
| S3 batch B=4 + bisect | 4.0 **UNSTABLE** | - | - | 15.0 | 0.0 / 0.00 | 1/0/0/0/0/0 |
| S4 speculative N=32 | 28.0 **UNSTABLE** | - | - | 66.3 | 0.0 / 0.00 | 10/0/1/0/0/0 |
| S4b speculative N=32, batch 4 | 4.0 **UNSTABLE** | - | - | 466.4 | 0.0 / 0.00 | 5/0/1/0/0/0 |
| S5a TIA only (1 lane, K=100) | 329.5 **UNSTABLE** | - | - | 5.9 | 0.0 / 0.00 | 114/4/0/0/0/0 |
| S5 partitioned K=10 | 257.5 **UNSTABLE** | - | - | 9.5 | 0.0 / 0.00 | 94/4/1/0/0/0 |
| S5 partitioned K=100 | 3692.0 **UNSTABLE** | - | - | 3.6 | 75.4 / 2.96 | 1794/1218/3/0/0/0 |
| S5 partitioned K=1000 | 18,446 **UNSTABLE** | - | - | 1.7 | 100.0 / 2.36 | 6973/6054/3/0/0/0 |
| S5p partitioned K=1000, perfect build graph | 20,484 | 1m | 23m | 1.4 | 0.0 / 0.00 | 7412/6446/0/0/0/0 |
| S5z partitioned K=1000 Zipf(1) | 2278.0 **UNSTABLE** | - | - | 2.4 | 74.8 / 0.05 | 1340/900/0/0/0/0 |
| S6 pushrebase + presubmit | 4454.0 **UNSTABLE** | - | - | 398.3 | 87.5 / 87.47 | 6333/3859/400/25622/195179/0 |
| S6t pushrebase + TIA presubmit K=100 | 5940.0 **UNSTABLE** | - | - | 88.0 | 100.0 / 86.96 | 7141/3925/11/12328/730360/0 |
| S6b push to trunk, no presubmit | 22,182 | 0s | 103m | 0.1 | 100.0 / 100.00 | 0/0/0/0/0/0 |

### Table E3 - partitioned trunk capacity (T=15, p=10%, N=8 per lane, TIA g=3, T_fix=1 min, s=0)

| case | sim landed/h | analytic | stable? | p95 |
|---|---|---|---|---|
| sat K=10 (offered 208/h) | 560.5 | 584.4 | yes | 38m |
| sat K=100 (offered 208/h) | 21,198 | 21,632 | yes | 25m |
| sat K=1000 (offered 208/h) | 290,162 | 295,116 | yes | 4m |
| zipf1 K=1000 x0.6 (offered 1,325/h) | 1317.5 | 2209.1 | yes | 22m |
| zipf1 K=1000 x0.8 (offered 1,767/h) | 1730.8 | 2209.1 | yes | 22m |
| zipf1 K=1000 x1.0 (offered 2,208/h) | 2185.8 | 2209.1 | yes | 36m |
| zipf1 K=1000 x1.25 (offered 2,760/h) | 2691.5 | 2209.1 | yes | 103m |

### Table E4 - optimistic landing (pushrebase + full presubmit, K=1, T=15, agents keep landing while red)

| load | s_repo | % time red (sim, 3 seeds) | analytic | breaks/h | mean land->revert |
|---|---|---|---|---|---|
| 50/day | 1e-08 | 0.00 | 0.00 | 0.00 | - |
| 50/day | 1e-07 | 0.00 | 0.00 | 0.00 | - |
| 50/day | 1e-06 | 0.00 | 0.00 | 0.00 | - |
| 50/day | 1e-05 | 0.00 | 0.00 | 0.00 | - |
| 50/day | 0.0001 | 0.00 | 0.01 | 0.00 | - |
| 50/day | 0.001 | 0.10 | 0.07 | 0.00 | 40m |
| 5,000/day | 1e-08 | 0.00 | 0.01 | 0.00 | - |
| 5,000/day | 1e-07 | 0.00 | 0.10 | 0.00 | - |
| 5,000/day | 1e-06 | 1.42 | 0.96 | 0.02 | 54m |
| 5,000/day | 1e-05 | 12.88 | 9.22 | 0.18 | 52m |
| 5,000/day | 0.0001 | 63.78 | 61.90 | 1.17 | 53m |
| 5,000/day | 0.001 | 100.00 | 99.99 | 11.71 | 54m |
| 50,000/day | 1e-08 | 0.00 | 1.23 | 0.00 | - |
| 50,000/day | 1e-07 | 21.96 | 11.65 | 0.20 | 69m |
| 50,000/day | 1e-06 | 60.33 | 71.02 | 0.93 | 69m |
| 50,000/day | 1e-05 | 100.00 | 100.00 | 10.70 | 69m |
| 50,000/day | 0.0001 | 100.00 | 100.00 | 119.13 | 69m |
| 50,000/day | 0.001 | 100.00 | 100.00 | 1295.80 | 69m |

No-presubmit push to trunk (s=0; only intrinsically bad changes break trunk):

| case | % time red | breaks/h | land->revert |
|---|---|---|---|
| nopre lam=50 p=0.02 | 1.9 | 0.03 | 38m |
| nopre lam=50 p=0.1 | 15.5 | 0.26 | 39m |
| nopre lam=50 p=0.25 | 41.3 | 0.83 | 39m |
| nopre lam=5000 p=0.02 | 98.6 | 5.05 | 54m |
| nopre lam=5000 p=0.1 | 100.0 | 23.31 | 54m |
| nopre lam=5000 p=0.25 | 100.0 | 71.79 | 54m |

### Table E5 - Runner-pool limits

| case | offered/h | landed/h | p50 | p95 | CI min/landed | red % | conflict rejects / landed |
|---|---|---|---|---|---|---|---|
| part K=100 50k/d R=100 | 2083.3 | 2094.4 | 1m | 23m | 1.7 | 6.8 | 0.015 |
| part K=100 50k/d R=1000000000 | 2083.3 | 2094.4 | 1m | 23m | 1.7 | 6.8 | 0.015 |
| part K=100 50k/d R=200 | 2083.3 | 2094.4 | 1m | 23m | 1.7 | 6.8 | 0.015 |
| part K=100 50k/d R=25 | 2083.3 | 610.7 UNSTABLE | - | - | 2.8 | 42.7 | 0.037 |
| part K=100 50k/d R=50 | 2083.3 | 1169.6 UNSTABLE | - | - | 2.8 | 49.7 | 0.040 |
| spec N=32 500/d R=1000000000 | 20.8 | 20.3 | 32m | 106m | 38.8 | 0.0 | 0.000 |
| spec N=32 500/d R=16 | 20.8 | 20.5 | 27m | 91m | 28.8 | 0.0 | 0.001 |
| spec N=32 500/d R=2 | 20.8 | 6.8 UNSTABLE | - | - | 17.7 | 0.0 | 0.002 |
| spec N=32 500/d R=32 | 20.8 | 20.3 | 32m | 106m | 38.8 | 0.0 | 0.000 |
| spec N=32 500/d R=4 | 20.8 | 12.1 UNSTABLE | - | - | 19.8 | 0.0 | 0.001 |
| spec N=32 500/d R=8 | 20.8 | 19.0 UNSTABLE | - | - | 25.2 | 0.0 | 0.000 |

### Table E6 - Flakiness and retry (speculative N=32, saturated, T=15, p=10%)

| case | offered/h | landed/h | p50 | p95 | CI min/landed | red % | conflict rejects / landed |
|---|---|---|---|---|---|---|---|
| flake=0.0 retry=False | sat | 31.8 | - | - | 58.5 | 0.0 | 0.001 |
| flake=0.0 retry=True | sat | 17.9 | - | - | 73.1 | 0.0 | 0.000 |
| flake=0.01 retry=False | sat | 30.0 | - | - | 61.9 | 0.0 | 0.000 |
| flake=0.01 retry=True | sat | 14.8 | - | - | 86.7 | 0.0 | 0.000 |
| flake=0.05 retry=False | sat | 25.3 | - | - | 73.3 | 0.0 | 0.001 |
| flake=0.05 retry=True | sat | 13.0 | - | - | 95.8 | 0.0 | 0.000 |
| flake=0.1 retry=False | sat | 19.0 | - | - | 98.0 | 0.0 | 0.001 |
| flake=0.1 retry=True | sat | 15.4 | - | - | 80.9 | 0.0 | 0.000 |
| flake=0.2 retry=False | sat | 9.8 | - | - | 190.6 | 0.0 | 0.000 |
| flake=0.2 retry=True | sat | 13.0 | - | - | 99.1 | 0.0 | 0.000 |

### Table E7 - Semantic conflicts and base staleness (partitioned K=100, 50k/day)

| case | offered/h | landed/h | p50 | p95 | CI min/landed | red % | conflict rejects / landed |
|---|---|---|---|---|---|---|---|
| s=0.0001 W0=120 | 2083.3 | 1344.7 UNSTABLE | - | - | 8.2 | 98.2 | 0.534 |
| s=0.0001 W0=30 | 2083.3 | 1750.6 UNSTABLE | - | - | 3.7 | 100.0 | 0.200 |
| s=0.0001 W0=5 | 2083.3 | 2093.7 | 1m | 24m | 1.9 | 49.5 | 0.042 |
| s=0.0003 W0=120 | 2083.3 | 552.2 UNSTABLE | - | - | 19.3 | 93.2 | 1.529 |
| s=0.0003 W0=30 | 2083.3 | 919.3 UNSTABLE | - | - | 12.0 | 100.0 | 0.896 |
| s=0.0003 W0=5 | 2083.3 | 1276.4 UNSTABLE | - | - | 6.5 | 100.0 | 0.413 |
| s=1e-05 W0=120 | 2083.3 | 2069.3 | 1m | 26m | 2.0 | 90.9 | 0.044 |
| s=1e-05 W0=30 | 2083.3 | 2094.4 | 1m | 23m | 1.7 | 6.8 | 0.015 |
| s=1e-05 W0=5 | 2083.3 | 2087.2 | 1m | 23m | 1.7 | 0.0 | 0.003 |
| s=1e-06 W0=120 | 2083.3 | 2071.0 | 1m | 23m | 1.7 | 0.0 | 0.005 |
| s=1e-06 W0=30 | 2083.3 | 2082.0 | 1m | 23m | 1.7 | 0.0 | 0.002 |
| s=1e-06 W0=5 | 2083.3 | 2081.9 | 1m | 23m | 1.7 | 0.0 | 0.000 |
| s=3e-05 W0=120 | 2083.3 | 2001.8 | 11m | 86m | 2.9 | 93.3 | 0.141 |
| s=3e-05 W0=30 | 2083.3 | 2075.1 | 1m | 23m | 1.9 | 61.3 | 0.041 |
| s=3e-05 W0=5 | 2083.3 | 2071.1 | 1m | 23m | 1.7 | 11.8 | 0.013 |

### Table E8 - Latency vs load (T=15, p=10%)

| case | offered/h | landed/h | p50 | p95 | CI min/landed | red % | conflict rejects / landed |
|---|---|---|---|---|---|---|---|
| partK100 lam=5000 | 208.3 | 207.3 | 1m | 23m | 1.9 | 0.0 | 0.001 |
| partK100 lam=20000 | 833.3 | 838.2 | 1m | 23m | 1.7 | 8.1 | 0.005 |
| partK100 lam=50000 | 2083.3 | 2086.8 | 1m | 23m | 1.7 | 6.2 | 0.013 |
| partK100 lam=100000 | 4166.7 | 2668.0 UNSTABLE | - | - | 2.5 | 86.5 | 0.040 |
| partK100 lam=200000 | 8333.3 | 2906.0 UNSTABLE | - | - | 2.9 | 100.0 | 0.074 |
| partK100 lam=400000 | 16,667 | 80.5 UNSTABLE | - | - | 12.6 | 100.0 | 6.655 |
| race lam=24 | 1.0 | 1.0 | 15m | 64m | 22.7 | 0.0 | 0.000 |
| race lam=48 | 2.0 | 2.0 | 30m | 90m | 33.4 | 0.0 | 0.000 |
| race lam=96 | 4.0 | 4.0 | 18.5h | 80.0h | 1628.0 | 0.0 | 0.001 |
| race lam=160 | 6.7 | 4.2 UNSTABLE | - | - | 28,985 | 0.0 | 0.020 |
| race lam=240 | 10.0 | 4.2 UNSTABLE | - | - | 41,346 | 0.0 | 0.031 |
| race lam=320 | 13.3 | 4.2 UNSTABLE | - | - | 45,872 | 0.0 | 0.037 |
| serial lam=12 | 0.5 | 0.5 | 15m | 51m | 17.0 | 0.0 | 0.000 |
| serial lam=24 | 1.0 | 1.0 | 15m | 52m | 16.8 | 0.0 | 0.000 |
| serial lam=48 | 2.0 | 2.0 | 22m | 77m | 16.8 | 0.0 | 0.000 |
| serial lam=60 | 2.5 | 2.5 | 29m | 116m | 16.8 | 0.0 | 0.000 |
| serial lam=72 | 3.0 | 3.0 | 45m | 2.9h | 16.9 | 0.0 | 0.000 |
| serial lam=80 | 3.3 | 3.3 | 98m | 6.1h | 16.8 | 0.0 | 0.000 |
| spec32 lam=100 | 4.2 | 4.1 | 15m | 50m | 18.1 | 0.0 | 0.000 |
| spec32 lam=200 | 8.3 | 8.4 | 15m | 53m | 19.9 | 0.0 | 0.000 |
| spec32 lam=400 | 16.7 | 16.5 | 20m | 71m | 25.9 | 0.0 | 0.000 |
| spec32 lam=550 | 22.9 | 22.9 | 29m | 107m | 35.8 | 0.0 | 0.000 |
| spec32 lam=650 | 27.1 | 27.0 | 58m | 3.1h | 48.3 | 0.0 | 0.000 |
| spec32 lam=750 | 31.2 | 28.2 UNSTABLE | - | - | 66.0 | 0.0 | 0.007 |

### Table E9 - Cross-partition changes (K=100, 50k/day, m=3)

| case | offered/h | landed/h | p50 | p95 | CI min/landed | red % | conflict rejects / landed |
|---|---|---|---|---|---|---|---|
| x_cross=0.0 | 2083.3 | 2075.3 | 1m | 23m | 1.7 | 30.8 | 0.012 |
| x_cross=0.05 | 2083.3 | 2069.7 | 1m | 23m | 1.8 | 3.6 | 0.014 |
| x_cross=0.2 | 2083.3 | 1283.3 UNSTABLE | - | - | 4.0 | 57.2 | 0.068 |
| x_cross=0.5 | 2083.3 | 798.8 UNSTABLE | - | - | 6.7 | 23.3 | 0.127 |
