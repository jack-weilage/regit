#!/usr/bin/env python3
"""report.py -- aggregate out/results.json into markdown tables (out/tables.md) and PNG charts."""
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import analytic as A  # noqa: E402

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT = os.path.join(HERE, "out")
COL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3de"
plt.rcParams.update({
    "figure.facecolor": SURF, "axes.facecolor": SURF, "savefig.facecolor": SURF,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.spines.top": False, "axes.spines.right": False, "lines.linewidth": 2,
    "font.size": 10, "axes.titlesize": 11, "axes.titleweight": "bold", "legend.frameon": False,
})
DEMAND = [(5000, "5k/day"), (50000, "50k/day"), (500000, "500k/day")]

R = json.load(open(os.path.join(OUT, "results.json")))


def agg(exp):
    g = defaultdict(list)
    for r in R:
        if r["exp"] == exp:
            g[(r["label"], r["lam_day"], r["T"], r["p"])].append(r)
    out = {}
    for k, rs in g.items():
        m = {}
        for key in ("throughput_h", "lat_p50", "lat_p95", "ci_min_per_land", "red_frac", "red_share",
                    "breaks_h", "ttd_mean", "offered_h"):
            vals = [x[key] for x in rs if x[key] is not None and not (isinstance(x[key], float) and math.isnan(x[key]))]
            m[key] = sum(vals) / len(vals) if vals else float("nan")
            m[key + "_min"] = min(vals) if vals else float("nan")
            m[key + "_max"] = max(vals) if vals else float("nan")
        m["unstable"] = any(x["unstable"] for x in rs)
        rej = defaultdict(int)
        att = 0
        for x in rs:
            for a, b in x["rej"].items():
                rej[a] += b
        m["rej"] = dict(rej)
        m["landed"] = sum(x["landed"] for x in rs)
        m["n"] = len(rs)
        m["raw"] = rs[0]
        out[k] = m
    return out


def f(x, d=1):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return "-"
    if abs(x) >= 10000:
        return f"{x:,.0f}"
    return f"{x:.{d}f}"


def fm(x):
    """minutes -> compact"""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "-"
    if x < 1:
        return f"{x*60:.0f}s"
    if x < 120:
        return f"{x:.0f}m"
    return f"{x/60:.1f}h"


lines = []
P = lines.append

# ------------------------------------------------------------------ E1 table
e1 = agg("E1")
labs = ["S1 race n=50", "S2 serial", "S3 bors B=4", "S3 bors B=16", "S4 spec N=8", "S4 spec N=32",
        "S4 spec N=128", "S4b spec N=32 B=4"]
P("### Table E1 - saturated capacity of a single trunk (changes/hour; sim mean of 3 seeds, [analytic])\n")
P("flake=1%/run, s_repo=1e-5, W0=30 min, unlimited runners. Second number per cell = CI runner-minutes per landed change.\n")
P("| T | p | " + " | ".join(labs) + " | analytic ceiling N=inf |")
P("|---|---|" + "---|" * (len(labs) + 1))
for T in (2.0, 15.0, 60.0):
    for p in (0.02, 0.10, 0.25):
        pe = A.p_eff(p, 0.01)
        ana = {"S1 race n=50": A.race_capacity(T), "S2 serial": A.serial_capacity(T, pe),
               "S3 bors B=4": A.bors_capacity(T, pe, 4), "S3 bors B=16": A.bors_capacity(T, pe, 16),
               "S4 spec N=8": A.spec_capacity(T, pe, 8), "S4 spec N=32": A.spec_capacity(T, pe, 32),
               "S4 spec N=128": A.spec_capacity(T, pe, 128),
               "S4b spec N=32 B=4": A.spec_batched_capacity(T, pe, 32, 4)}
        cells = []
        for lab in labs:
            m = e1.get((lab, 5000.0, T, p))
            if not m:
                cells.append("-")
                continue
            cells.append(f"{f(m['throughput_h'])} [{f(ana[lab])}] / {f(m['ci_min_per_land'],0)}m")
        P(f"| {T:g} | {p:.0%} | " + " | ".join(cells) + f" | {f(A.spec_ceiling(T, pe))} |")
P("")

# ------------------------------------------------------------------ E2 table
e2 = agg("E2")
order = ["S1 race (require up-to-date)", "S2 serial queue", "S3 batch B=4 + bisect", "S4 speculative N=32",
         "S4b speculative N=32, batch 4", "S5a TIA only (1 lane, K=100)", "S5 partitioned K=10",
         "S5 partitioned K=100", "S5 partitioned K=1000", "S5p partitioned K=1000, perfect build graph",
         "S5z partitioned K=1000 Zipf(1)",
         "S6 pushrebase + presubmit", "S6t pushrebase + TIA presubmit K=100", "S6b push to trunk, no presubmit"]
P("### Table E2 - open-system scaling (T=15 min, p=10%, flake=1%, s_repo=1e-5, W0=30 min, leak=1% where TIA)\n")
P("Cells: landed/hour (offered) | p50 / p95 latency submit->final land | CI min per landed | % time trunk red. "
  "UNSTABLE = queue grows without bound (throughput shown is what got through during the run).\n")
for lam in (50, 5000, 50000, 500000):
    P(f"\n**{lam:,} changes/day (offered {lam/24:,.1f}/h)**\n")
    P("| strategy | landed/h | p50 | p95 | CI min/landed | trunk red % (any / share-weighted) | rejections (bad/conflict/flake/textual/blocked/stale) |")
    P("|---|---|---|---|---|---|---|")
    for lab in order:
        m = e2.get((lab, float(lam), 15.0, 0.10))
        if not m:
            continue
        st = " **UNSTABLE**" if m["unstable"] else ""
        rj = m["rej"]
        rjs = "/".join(str(rj.get(k, 0)) for k in ("bad", "conflict", "flake", "textual", "blocked", "stale"))
        lat50 = "-" if m["unstable"] else fm(m["lat_p50"])
        lat95 = "-" if m["unstable"] else fm(m["lat_p95"])
        P(f"| {lab} | {f(m['throughput_h'])}{st} | {lat50} | {lat95} | {f(m['ci_min_per_land'])} | "
          f"{m['red_frac']*100:.1f} / {m['red_share']*100:.2f} | {rjs} |")
P("")

# ------------------------------------------------------------------ E3
e3 = agg("E3")
P("### Table E3 - partitioned trunk capacity (T=15, p=10%, N=8 per lane, TIA g=3, T_fix=1 min, s=0)\n")
P("| case | sim landed/h | analytic | stable? | p95 |")
P("|---|---|---|---|---|")
for (lab, lam, T, p), m in sorted(e3.items(), key=lambda kv: kv[0][0]):
    K = int(lab.split("K=")[1].split()[0])
    alpha = 1.0 if "zipf" in lab else 0.0
    cap = A.partitioned_capacity(15, 0.10, K, 8, flake=0.01, alpha=alpha)[0]
    P(f"| {lab} (offered {lam/24:,.0f}/h) | {f(m['throughput_h'])} | {f(cap)} | {'no' if m['unstable'] else 'yes'} | "
      f"{'-' if m['unstable'] else fm(m['lat_p95'])} |")
P("")

# ------------------------------------------------------------------ E4
e4 = agg("E4")
P("### Table E4 - optimistic landing (pushrebase + full presubmit, K=1, T=15, agents keep landing while red)\n")
P("| load | s_repo | % time red (sim, 3 seeds) | analytic | breaks/h | mean land->revert |")
P("|---|---|---|---|---|---|")
e4rows = []
for (lab, lam, T, p), m in sorted(e4.items(), key=lambda kv: (kv[0][1], float(kv[0][0].split("s=")[1]))):
    s = float(lab.split("s=")[1])
    lamh = lam / 24
    D = A.pushrebase_detect_time(15, lamh)
    an = A.p_red(A.pushrebase_break_rate(lamh, s, 15), D)
    e4rows.append((lam, s, m["red_frac"], an, m))
    P(f"| {lam:,.0f}/day | {s:g} | {m['red_frac']*100:.2f} | {an*100:.2f} | {f(m['breaks_h'],2)} | {fm(m['ttd_mean'])} |")
P("")
e4b = agg("E4b")
P("No-presubmit push to trunk (s=0; only intrinsically bad changes break trunk):\n")
P("| case | % time red | breaks/h | land->revert |")
P("|---|---|---|---|")
for (lab, lam, T, p), m in sorted(e4b.items()):
    P(f"| {lab} | {m['red_frac']*100:.1f} | {f(m['breaks_h'],2)} | {fm(m['ttd_mean'])} |")
P("")

# ------------------------------------------------------------------ E5 - E9 generic
for exp, title in (("E5", "Runner-pool limits"), ("E6", "Flakiness and retry (speculative N=32, saturated, T=15, p=10%)"),
                   ("E7", "Semantic conflicts and base staleness (partitioned K=100, 50k/day)"),
                   ("E8", "Latency vs load (T=15, p=10%)"), ("E9", "Cross-partition changes (K=100, 50k/day, m=3)")):
    e = agg(exp)
    P(f"### Table {exp} - {title}\n")
    P("| case | offered/h | landed/h | p50 | p95 | CI min/landed | red % | conflict rejects / landed |")
    P("|---|---|---|---|---|---|---|---|")
    for (lab, lam, T, p), m in sorted(e.items(), key=lambda kv: (kv[0][0].split()[0], kv[0][1], kv[0][0])):
        st = " UNSTABLE" if m["unstable"] else ""
        off = "sat" if m["raw"]["saturate"] else f(lam / 24)
        cr = m["rej"].get("conflict", 0) / max(1, m["landed"])
        P(f"| {lab} | {off} | {f(m['throughput_h'])}{st} | {'-' if m['unstable'] or m['raw']['saturate'] else fm(m['lat_p50'])} | "
          f"{'-' if m['unstable'] or m['raw']['saturate'] else fm(m['lat_p95'])} | {f(m['ci_min_per_land'])} | {m['red_frac']*100:.1f} | {cr:.3f} |")
    P("")

open(os.path.join(OUT, "tables.md"), "w").write("\n".join(lines))
print("wrote tables.md")


# ================================================================== charts
def demand_lines(ax, per="day", xmax=None):
    for v, lab in DEMAND:
        y = v if per == "day" else v / 24
        ax.axhline(y, color=INK2, lw=0.8, ls=(0, (2, 3)), zorder=1)
        ax.annotate(lab + " demand", xy=(1.0, y), xycoords=("axes fraction", "data"), xytext=(-4, 3),
                    textcoords="offset points", ha="right", va="bottom", fontsize=8, color=INK2)


# Fig 1: capacity vs p, small multiples by T
fig, axes = plt.subplots(1, 3, figsize=(13, 4.4), sharey=True)
ps = [0.005 + i * 0.0025 for i in range(119)]
series = [
    ("S1 race / require up-to-date", lambda T, pe: A.race_capacity(T), "S1 race n=50"),
    ("S2 serial queue", lambda T, pe: A.serial_capacity(T, pe), "S2 serial"),
    ("S3 batch+bisect (best B)", lambda T, pe: A.bors_best(T, pe)[0], None),
    ("S4 speculative N=32", lambda T, pe: A.spec_capacity(T, pe, 32), "S4 spec N=32"),
    ("S4 speculative N=inf (ceiling)", lambda T, pe: A.spec_ceiling(T, pe), None),
]
for ax, T in zip(axes, (2.0, 15.0, 60.0)):
    for i, (name, fn, simlab) in enumerate(series):
        ys = [fn(T, A.p_eff(p, 0.01)) * 24 for p in ps]
        ax.plot([p * 100 for p in ps], ys, color=COL[i], ls="--" if "ceiling" in name else "-", label=name)
        if simlab:
            pts = [(p * 100, e1[(simlab, 5000.0, T, p)]["throughput_h"] * 24) for p in (0.02, 0.10, 0.25)
                   if (simlab, 5000.0, T, p) in e1]
            ax.scatter([a for a, _ in pts], [b for _, b in pts], s=40, color=COL[i], edgecolor=SURF, linewidth=2, zorder=5)
    if (("S3 bors B=4", 5000.0, T, 0.10)) in e1:
        pts = [(p * 100, max(e1[(l, 5000.0, T, p)]["throughput_h"] for l in ("S3 bors B=4", "S3 bors B=16")) * 24)
               for p in (0.02, 0.10, 0.25)]
        ax.scatter([a for a, _ in pts], [b for _, b in pts], s=40, color=COL[2], edgecolor=SURF, linewidth=2, zorder=5)
    ax.set_yscale("log")
    ax.set_ylim(10, 2e6)
    ax.set_title(f"CI duration T = {T:g} min")
    ax.set_xlabel("per-change failure probability p (%)")
    demand_lines(ax)
axes[0].set_ylabel("max sustainable landings / day (log)")
axes[0].legend(loc="upper right", fontsize=8, bbox_to_anchor=(1.0, 0.86))
fig.suptitle("Single-trunk landing capacity: lines = closed form, dots = simulation (flake 1%)", x=0.01, ha="left",
             fontsize=12, fontweight="bold")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "fig1_capacity_single_trunk.png"), dpi=140)
plt.close(fig)

# Fig 2: speculation depth -> throughput and compute (two panels, no dual axis)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4))
Ns = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
for i, p in enumerate((0.02, 0.10, 0.25)):
    pe = A.p_eff(p, 0.01)
    a1.plot(Ns, [A.spec_capacity(15, pe, N) for N in Ns], color=COL[i], marker="o", ms=4, label=f"p = {p:.0%}")
    a1.axhline(A.spec_ceiling(15, pe), color=COL[i], lw=0.8, ls=(0, (2, 3)))
    a2.plot(Ns, [A.spec_runs_per_land(N, pe) * 15 for N in Ns], color=COL[i], marker="o", ms=4, label=f"p = {p:.0%}")
for a in (a1, a2):
    a.set_xscale("log", base=2)
    a.set_xlabel("speculation depth N (concurrent CI runs)")
a1.set_yscale("log")
a2.set_yscale("log")
a1.set_title("Throughput saturates at (1-p)/(p*T)")
a1.set_ylabel("landed changes / hour (T = 15 min)")
a2.set_title("...while CI compute per landed change keeps growing")
a2.set_ylabel("CI runner-minutes per landed change")
a1.legend()
fig.tight_layout()
fig.savefig(os.path.join(OUT, "fig2_speculation_depth.png"), dpi=140)
plt.close(fig)

# Fig 3: pushrebase red fraction vs s_repo
fig, ax = plt.subplots(figsize=(7.5, 4.4))
ss = [10 ** (-9 + i * 0.05) for i in range(141)]
for i, lam in enumerate((50, 5000, 50000, 500000)):
    lamh = lam / 24
    D = A.pushrebase_detect_time(15, lamh)
    ax.plot(ss, [A.p_red(A.pushrebase_break_rate(lamh, s, 15), D) * 100 for s in ss], color=COL[i],
            label=f"{lam:,}/day")
    pts = [(s, m["red_frac"] * 100) for (l, s, m_, a, m) in [(r[0], r[1], r[2], r[3], r[4]) for r in e4rows] if l == lam]
    if pts:
        ax.scatter([a for a, _ in pts], [b for _, b in pts], s=40, color=COL[i], edgecolor=SURF, linewidth=2, zorder=5)
ax.axhline(5, color=INK2, lw=0.8, ls=(0, (2, 3)))
ax.annotate("5% red", xy=(1e-9, 5), xytext=(2, 3), textcoords="offset points", fontsize=8, color=INK2)
ax.set_xscale("log")
ax.set_xlabel("s_repo: P(a pair of concurrent changes is semantically incompatible)")
ax.set_ylabel("% of time trunk is red")
ax.set_title("Optimistic landing (pushrebase + presubmit, T = 15 min)")
ax.legend(title="landing load", loc="upper left")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "fig3_optimistic_landing_red.png"), dpi=140)
plt.close(fig)

# Fig 4: partitioned capacity vs K by skew
fig, ax = plt.subplots(figsize=(7.5, 4.4))
Ks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
for i, al in enumerate((0.0, 0.8, 1.0, 1.2)):
    ax.plot(Ks, [A.partitioned_capacity(15, 0.10, K, 8, flake=0.01, alpha=al)[0] * 24 for K in Ks], color=COL[i],
            marker="o", ms=4, label="uniform" if al == 0 else f"Zipf alpha = {al}")
ax.set_xscale("log")
ax.set_yscale("log")
demand_lines(ax)
ax.set_xlabel("number of independent build-graph partitions K")
ax.set_ylabel("max landings / day (hottest lane saturates)")
ax.set_title("Partitioned trunk + TIA: skew, not K, sets the ceiling (T=15, p=10%)")
ax.legend(loc="upper left")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "fig4_partition_skew.png"), dpi=140)
plt.close(fig)

# Fig 5: levers (single-lane speculative baseline)
pe0 = A.p_eff(0.10, 0.01)
base = A.spec_capacity(15, pe0, 32)
levers = [
    ("CI time 15 -> 7.5 min", A.spec_capacity(7.5, pe0, 32)),
    ("CI time 15 -> 2 min", A.spec_capacity(2, pe0, 32)),
    ("failure rate 10% -> 5%", A.spec_capacity(15, A.p_eff(0.05, 0.01), 32)),
    ("failure rate 10% -> 2%", A.spec_capacity(15, A.p_eff(0.02, 0.01), 32)),
    ("speculation depth 32 -> 512", A.spec_capacity(15, pe0, 512)),
    ("batching (B=4, N=1, Bors)", A.bors_capacity(15, pe0, 4)),
    ("partition K=100 + TIA, uniform", A.partitioned_capacity(15, 0.10, 100, 32, 0.01)[0]),
    ("partition K=100 + TIA, Zipf(1)", A.partitioned_capacity(15, 0.10, 100, 32, 0.01, alpha=1.0)[0]),
    ("partition K=1000 + TIA, Zipf(1)", A.partitioned_capacity(15, 0.10, 1000, 32, 0.01, alpha=1.0)[0]),
    ("K=1000 Zipf(1) + p 2% + N 64", A.partitioned_capacity(15, 0.02, 1000, 64, 0.01, alpha=1.0)[0]),
]
fig, ax = plt.subplots(figsize=(8.5, 4.6))
names = [l for l, _ in levers][::-1]
vals = [v / base for _, v in levers][::-1]
ax.barh(names, vals, color=COL[0], height=0.6)
for y, v in enumerate(vals):
    ax.annotate(f"x{v:,.1f}  ({v*base*24:,.0f}/day)", xy=(v, y), xytext=(4, 0), textcoords="offset points",
                va="center", fontsize=8, color=INK)
ax.set_xscale("log")
ax.axvline(1, color=INK2, lw=0.8)
ax.set_xlim(0.1, 3000)
ax.set_xlabel(f"capacity multiplier vs baseline (speculative N=32, T=15, p=10%: {base:.0f}/h = {base*24:,.0f}/day)")
ax.set_title("Which lever matters (closed form)")
ax.grid(axis="y", visible=False)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "fig5_levers.png"), dpi=140)
plt.close(fig)

# Fig 6: latency vs load (E8)
e8 = agg("E8")
fig, ax = plt.subplots(figsize=(7.5, 4.4))
for i, (pref, name) in enumerate((("race", "S1 race"), ("serial", "S2 serial queue"), ("spec32", "S4 speculative N=32"),
                                  ("partK100", "S5 partitioned K=100 + TIA"))):
    pts = sorted((lam, m) for (lab, lam, T, p), m in e8.items() if lab.startswith(pref))
    st = [(lam, m) for lam, m in pts if not m["unstable"]]
    if st:
        ax.plot([l for l, _ in st], [m["lat_p95"] for _, m in st], color=COL[i], marker="o", ms=5, label=name + " p95")
        ax.plot([l for l, _ in st], [m["lat_p50"] for _, m in st], color=COL[i], ls=":", lw=1.5)
    un = [lam for lam, m in pts if m["unstable"]]
    if un:
        ax.scatter(un, [3000] * len(un), marker="x", color=COL[i], s=40)
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("offered changes / day")
ax.set_ylabel("minutes from submit to land (solid p95, dotted p50)")
ax.set_title("Latency vs load (T=15, p=10%); x = unstable")
ax.legend(fontsize=8)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "fig6_latency_vs_load.png"), dpi=140)
plt.close(fig)
print("charts written")
