#!/usr/bin/env python3
"""
landing_sim.py -- discrete-event simulator of trunk-landing strategies.

Strategies (Params.strategy):
  "race"       S1  every agent rebases, runs full CI (T), merges only if trunk has not moved
                   since its CI started (GitHub branch protection "require branches to be up to date").
                   Invalidation is noticed when the run finishes (agent retry loop).
  "queue"      S2-S5 merge-queue engine with
                   N = speculation depth (1 = classic serial queue),
                   B = batch size with bisection on failure (Bors-NG style),
                   K domains (build-graph partitions); partitioned=True gives one lane per domain
                   (changes touching several domains sit in all their lanes and land atomically);
                   tia=True runs only affected tests (duration T_fix + (T-T_fix)*min(1, g*m/K)).
  "pushrebase" S6  server-side rebase (Mononoke-style). Agent runs a presubmit on fresh trunk, then the
                   server lands it unless a textual (same-file) conflict appeared during the presubmit.
                   Post-land CI (full suite, back-to-back), parallel culprit finding, auto-revert.

Semantic-conflict model (count-based, consistent across retests):
  s_repo  = probability that a random pair of concurrent changes is semantically incompatible
            (each passes alone, together they fail).  Conflicting pairs are concentrated inside a
            build-graph partition: same-domain pair probability s_same = s_repo*K*(1-leak);
            cross-domain pair probability s_x = s_repo*K*leak/(K-1) (dependencies the build graph /
            TIA cannot see).  So the *total* number of conflicting pairs does not depend on how
            finely you partition -- partitioning only changes which pairs get tested together.
  Each attempt j draws G_j ~ Geometric(s_same) per domain: j fails whenever the number of
  same-domain changes that are in its tested state but were not in its base reaches G_j.
  Base = trunk at (first submit - W0) for a first attempt, = trunk at failure time for a rework.

Outputs per run: throughput, latency (first-ready -> final land) p50/p95, CI runner-minutes per
landed change, fraction of time trunk is red (any domain) and share-weighted red fraction,
breaks/reverts, stability flag.
"""
from __future__ import annotations

import bisect
import heapq
import itertools
import math
import random
from collections import deque
from dataclasses import dataclass, asdict, field


@dataclass
class Params:
    strategy: str = "queue"
    lam_day: float = 5000.0     # logical changes per day (open system)
    T: float = 15.0             # full CI duration, minutes
    p: float = 0.10             # P(attempt is intrinsically bad: fails CI on its own)
    flake: float = 0.01         # P(full-suite run fails spuriously); scales with fraction of tests run
    s_repo: float = 1e-4        # semantic-conflict probability per pair of concurrent changes (repo-wide)
    leak: float = 0.0           # fraction of conflicting pairs that straddle partitions (invisible to TIA)
    K: int = 1                  # number of build-graph domains
    partitioned: bool = False   # one landing lane per domain
    tia: bool = False           # run only affected tests
    g: float = 3.0              # reverse-dependency fan-out: affected fraction f = min(1, g*m/K)
    T_fix: float = 1.0          # fixed per-run overhead (min) when TIA is on
    zipf: float = 0.0           # domain popularity skew (0 = uniform)
    x_cross: float = 0.0        # P(change touches m_cross domains instead of 1)
    m_cross: int = 2
    N: int = 1                  # speculation depth (units under test concurrently per lane)
    B: int = 1                  # max batch size (bisect on failure)
    R: int = 10**9              # max concurrent CI runners (shared pool)
    W0: float = 30.0            # base staleness at first submit (min)
    A_fix: float = 20.0         # agent rework time after a real failure / conflict / revert (min)
    A_flake: float = 2.0        # resubmit delay after a spurious failure (min)
    retry_fail: bool = False    # re-run a failed queue run once before ejecting
    jitter: float = 0.05        # +/- run-duration jitter
    presubmit: bool = True      # pushrebase: agent runs presubmit on fresh trunk before landing
    c_text_repo: float = 2.5e-4 # textual (same-file) overlap probability per random pair
    post_interval: float = 0.0  # postsubmit run start interval (0 => T, back-to-back)
    cf_fanout: int = 8          # culprit finding: parallel probes per round
    blast: bool = True          # red domain blocks presubmits / queue runs touching it
    saturate: bool = False      # keep the queue full (measure max throughput)
    contenders: int = 50        # race strategy: contender population when saturating
    sim_hours: float = 8.0
    warm_hours: float = 2.0
    max_pending: int = 40000
    seed: int = 1


def geom(rng, s):
    """Number of Bernoulli(s) trials up to and including the first success."""
    if s <= 0:
        return math.inf
    if s >= 1:
        return 1
    return int(math.log(1.0 - rng.random()) / math.log1p(-s)) + 1


class Change:
    __slots__ = ("id", "doms", "t_first", "base", "bad", "G", "Gx", "Gt", "t0", "attempts", "pending")


class Unit:
    __slots__ = ("members", "lanes", "run", "passed", "retried", "doms", "held")

    def __init__(self, members, lanes):
        self.members = members
        self.lanes = lanes
        self.run = None
        self.passed = False
        self.retried = False
        self.held = None   # own failure observed, waiting until every unit ahead has passed
        ds = set()
        for m in members:
            ds.update(m.doms)
        self.doms = tuple(ds)


class Run:
    __slots__ = ("kind", "obj", "start", "end", "dur", "cancelled", "reason", "version", "f", "queued")

    def __init__(self, kind, obj, dur, f):
        self.kind = kind
        self.obj = obj
        self.dur = dur
        self.f = f
        self.start = None
        self.end = None
        self.cancelled = False
        self.reason = None
        self.version = None
        self.queued = False


class Lane:
    __slots__ = ("units", "waiting")

    def __init__(self):
        self.units = []
        self.waiting = deque()


class Break:
    __slots__ = ("change", "dom", "t_land", "handled")


class Sim:
    def __init__(self, P: Params):
        self.P = P
        self.rng = random.Random(P.seed)
        self.now = 0.0
        self.ev = []
        self.seq = itertools.count()
        self.cid = itertools.count()
        K = P.K
        self.land_t = [[] for _ in range(K)]
        self.land_all = []
        w = [1.0 / (i + 1) ** P.zipf for i in range(K)] if P.zipf > 0 else [1.0] * K
        tot = sum(w)
        self.share = [x / tot for x in w]
        self.cum = list(itertools.accumulate(self.share))
        self.s_same = min(1.0, P.s_repo * K * (1 - P.leak)) if K > 1 else P.s_repo
        self.s_x = (P.s_repo * K * P.leak / (K - 1)) if K > 1 else 0.0
        self.c_same = min(1.0, P.c_text_repo * K)
        self.T_fix = min(P.T_fix, P.T)
        # runner pool
        self.free = P.R
        self.waitq = deque()
        # metrics
        self.w0 = P.warm_hours * 60.0
        self.w1 = P.sim_hours * 60.0
        self.ci_min = 0.0
        self.post_min = 0.0
        self.runs_started = 0
        self.runs_cancelled = 0
        self.lat = {}
        self.landed_w = 0
        self.reverted_w = 0
        self.arrived_w = 0
        self.created = 0
        self.landed_total = 0
        self.pending_at_w0 = None
        self.rej = {"bad": 0, "conflict": 0, "flake": 0, "textual": 0, "blocked": 0, "stale": 0}
        self.unstable = False
        # trunk health
        self.red = [0] * K
        self.n_red_any = 0
        self.red_share_now = 0.0
        self.red_time = 0.0
        self.red_share_time = 0.0
        self.breaks = []
        self.breaks_w = 0
        self.ttd = []        # land -> revert durations
        self.last_t = 0.0
        self.last_post_start_count = 0
        # strategy state
        self.version = 0
        self.contenders_active = 0
        if P.strategy == "queue":
            nl = K if P.partitioned else 1
            self.lanes = [Lane() for _ in range(nl)]
        self.post_on = (P.strategy == "pushrebase") or (P.leak > 0 and K > 1 and (P.tia or P.partitioned))

    # ------------------------------------------------------------------ utilities
    def push(self, t, kind, obj=None):
        heapq.heappush(self.ev, (t, next(self.seq), kind, obj))

    def acct(self, a, b):
        self.ci_min += max(0.0, min(b, self.w1) - max(a, self.w0))

    def in_w(self, t=None):
        t = self.now if t is None else t
        return self.w0 <= t <= self.w1

    def integrate(self, t):
        a, b = max(self.last_t, self.w0), min(t, self.w1)
        if b > a:
            if self.n_red_any > 0:
                self.red_time += b - a
            self.red_share_time += self.red_share_now * (b - a)
        self.last_t = t

    def sample_dom(self):
        if self.P.zipf <= 0:
            return self.rng.randrange(self.P.K)
        return min(bisect.bisect_left(self.cum, self.rng.random()), self.P.K - 1)

    def sample_doms(self, primary=None):
        d0 = self.sample_dom() if primary is None else primary
        doms = [d0]
        if self.P.K > 1 and self.P.x_cross > 0 and self.rng.random() < self.P.x_cross:
            want = min(self.P.m_cross, self.P.K)
            while len(doms) < want:
                d = self.sample_dom()
                if d not in doms:
                    doms.append(d)
        return tuple(doms)

    def landed_since(self, d, t):
        lt = self.land_t[d]
        return len(lt) - bisect.bisect_right(lt, t)

    def run_dur(self, ndoms):
        P = self.P
        if P.tia and P.K > 1:
            f = min(1.0, P.g * ndoms / P.K)
            d = self.T_fix + (P.T - self.T_fix) * f
        else:
            f, d = 1.0, P.T
        return d * (1.0 + P.jitter * (2 * self.rng.random() - 1)), f

    def flaky(self, f):
        return self.rng.random() < 1.0 - (1.0 - self.P.flake) ** f

    # ------------------------------------------------------------------ changes
    def new_change(self, t_first, base, primary=None):
        c = Change()
        c.id = next(self.cid)
        c.doms = self.sample_doms(primary)
        c.t_first = t_first
        c.attempts = 0
        c.pending = True
        self.created += 1
        if self.in_w(t_first):
            self.arrived_w += 1
        self.new_attempt(c, base)
        return c

    def new_attempt(self, c, base):
        rng = self.rng
        c.base = base
        c.bad = rng.random() < self.P.p
        c.G = [geom(rng, self.s_same) for _ in c.doms]
        c.Gx = geom(rng, self.s_x)
        c.Gt = [geom(rng, self.c_same) for _ in c.doms]
        c.attempts += 1

    def leaked(self, c):
        if self.s_x <= 0:
            return False
        tot = len(self.land_all) - bisect.bisect_right(self.land_all, c.base)
        same = sum(self.landed_since(d, c.base) for d in c.doms)
        return tot - same >= c.Gx

    def record_land(self, c):
        t = self.now
        for d in c.doms:
            self.land_t[d].append(t)
        self.land_all.append(t)
        self.landed_total += 1
        c.pending = False
        if self.in_w():
            self.landed_w += 1
            self.lat[c.id] = t - c.t_first

    # ------------------------------------------------------------------ runner pool
    def request(self, run):
        self.runs_started += 1
        if self.free > 0:
            self.free -= 1
            self.start(run)
        else:
            run.queued = True
            self.waitq.append(run)

    def start(self, run):
        run.queued = False
        run.start = self.now
        run.end = self.now + run.dur
        self.push(run.end, "run_done", run)

    def release(self):
        while self.waitq:
            r = self.waitq.popleft()
            if r.cancelled:
                continue
            self.start(r)
            return
        self.free += 1

    def cancel(self, run):
        if run.cancelled:
            return
        run.cancelled = True
        self.runs_cancelled += 1
        if run.start is not None:
            self.acct(run.start, self.now)
            self.release()

    # ------------------------------------------------------------------ trunk health
    def add_break(self, c, dom):
        b = Break()
        b.change, b.dom, b.t_land, b.handled = c, dom, self.now, False
        self.breaks.append(b)
        if self.in_w():
            self.breaks_w += 1
        if self.red[dom] == 0:
            self.red_share_now += self.share[dom]
        self.red[dom] += 1
        self.n_red_any += 1

    def post_start(self, _):
        P = self.P
        interval = P.post_interval or P.T
        n_range = max(1, self.landed_total - self.last_post_start_count)
        self.last_post_start_count = self.landed_total
        snap = [b for b in self.breaks if not b.handled]
        for b in snap:
            b.handled = True  # will be caught by this run (deterministic failure)
        if self.in_w():
            self.post_min += P.T
        self.push(self.now + P.T, "post_done", (snap, n_range))
        self.push(self.now + interval, "post_start")

    def post_done(self, arg):
        snap, n_range = arg
        if not snap:
            return
        P = self.P
        rounds = max(1, math.ceil(math.log(n_range + 1) / math.log(P.cf_fanout + 1)))
        if self.in_w():
            self.post_min += rounds * P.cf_fanout * P.T
        for b in snap:
            self.push(self.now + rounds * P.T + 1.0, "revert", b)

    def revert(self, b):
        self.breaks.remove(b)
        self.red[b.dom] -= 1
        if self.red[b.dom] == 0:
            self.red_share_now -= self.share[b.dom]
        self.n_red_any -= 1
        self.ttd.append(self.now - b.t_land)
        c = b.change
        if self.lat.pop(c.id, None) is not None:
            self.landed_w -= 1
            self.reverted_w += 1
        self.landed_total -= 1
        c.pending = True
        self.push(self.now + self.P.A_fix, "resubmit", (c, self.now))
        if self.P.strategy == "queue":
            self.schedule_all_for_dom(b.dom)

    def is_red(self, doms):
        return self.P.blast and any(self.red[d] for d in doms)

    # ------------------------------------------------------------------ main loop
    def pending(self):
        return self.created - self.landed_total

    def run(self):
        P = self.P
        if P.saturate:
            if P.strategy == "race":
                for _ in range(P.contenders):
                    self.race_new(self.now)
            elif P.strategy == "queue":
                for L in range(len(self.lanes)):
                    self.topup(L)
                self.schedule(range(len(self.lanes)))
        else:
            self.push(self.rng.expovariate(P.lam_day / 1440.0), "arrive")
        self.push(self.w0, "mark")
        if self.post_on:
            self.push(0.0, "post_start")
        H = {
            "arrive": self.on_arrive, "run_done": self.on_run_done, "resubmit": self.on_resubmit,
            "post_start": self.post_start, "post_done": self.post_done, "revert": self.revert,
            "mark": self.on_mark,
        }
        while self.ev:
            t, _, kind, obj = heapq.heappop(self.ev)
            if t > self.w1:
                break
            self.integrate(t)
            self.now = t
            H[kind](obj)
            if self.pending() > P.max_pending:
                self.unstable = True
                break
        end = min(self.now, self.w1) if self.unstable else self.w1
        self.integrate(end)
        # close accounting of runs still in flight
        for (_, _, kind, obj) in self.ev:
            if kind == "run_done" and not obj.cancelled and obj.start is not None:
                self.acct(obj.start, end)
        return self.results(end)

    def on_mark(self, _):
        self.pending_at_w0 = self.pending()

    def on_arrive(self, _):
        P = self.P
        c = self.new_change(self.now, self.now - P.W0)
        self.submit(c)
        self.push(self.now + self.rng.expovariate(P.lam_day / 1440.0), "arrive")

    def on_resubmit(self, arg):
        c, base = arg
        if base is not None:
            self.new_attempt(c, base)
        self.submit(c)

    def submit(self, c):
        s = self.P.strategy
        if s == "queue":
            self.q_enqueue(c)
        elif s == "race":
            self.race_start(c)
        else:
            self.pr_start(c)

    def reject(self, c, reason):
        self.rej[reason] += 1
        if reason in ("bad", "conflict", "textual"):
            delay = self.P.A_fix if reason != "textual" else 2.0
            base = self.now if reason != "textual" else None
            if reason == "textual":
                # agent rebases; semantic base unchanged, new textual window
                c.Gt = [geom(self.rng, self.c_same) for _ in c.doms]
            self.push(self.now + delay, "resubmit", (c, base))
        else:  # flake / blocked / stale: resubmit unchanged
            self.push(self.now + self.P.A_flake, "resubmit", (c, None))

    def on_run_done(self, run):
        if run.cancelled:
            return
        self.acct(run.start, self.now)
        self.release()
        k = run.kind
        if k == "q":
            self.q_done(run)
        elif k == "race":
            self.race_done(run)
        elif k == "pre":
            self.pr_pre_done(run)

    # ------------------------------------------------------------------ S1 race
    def race_new(self, t):
        c = self.new_change(t, t - self.P.W0)
        self.race_start(c)

    def race_start(self, c):
        dur, f = self.run_dur(len(c.doms))
        run = Run("race", c, dur, f)
        run.version = self.version
        # outcome against trunk at start (run is only useful if trunk unchanged at end)
        if c.bad:
            run.reason = "bad"
        elif any(self.landed_since(d, c.base) >= G for d, G in zip(c.doms, c.G)):
            run.reason = "conflict"
        elif self.flaky(f):
            run.reason = "flake"
        self.request(run)

    def race_done(self, run):
        c = run.obj
        if run.reason in ("bad", "conflict"):
            self.reject(c, run.reason)
            if self.P.saturate:
                self.race_new(self.now)
            return
        if run.reason == "flake":
            self.rej["flake"] += 1
            self.race_start(c)
            return
        if run.version != self.version:
            self.rej["stale"] += 1
            self.race_start(c)  # rebase + rerun
            return
        self.version += 1
        self.record_land(c)
        if self.P.saturate:
            self.race_new(self.now)

    # ------------------------------------------------------------------ S2-S5 queue
    def lane_ids(self, c):
        return c.doms if self.P.partitioned else (0,)

    def q_enqueue(self, c):
        if self.P.partitioned:
            u = Unit([c], tuple(c.doms))
            for L in u.lanes:
                self.lanes[L].units.append(u)
            self.schedule(u.lanes)
        else:
            self.lanes[0].waiting.append(c)
            self.schedule((0,))

    def topup(self, L):
        P = self.P
        lane = self.lanes[L]
        if P.partitioned:
            while len(lane.units) < P.N + 2:
                c = self.new_change(self.now, self.now - P.W0, primary=L)
                u = Unit([c], tuple(c.doms))
                for M in u.lanes:
                    self.lanes[M].units.append(u)
        else:
            need = P.B * (P.N + 1)
            while len(lane.waiting) < need:
                lane.waiting.append(self.new_change(self.now, self.now - P.W0))

    def schedule_all_for_dom(self, d):
        self.schedule((d,) if self.P.partitioned else (0,))

    def schedule(self, lane_ids):
        P = self.P
        N = P.N
        for L in lane_ids:
            lane = self.lanes[L]
            if P.saturate:
                self.topup(L)
            if not P.partitioned:
                while len(lane.units) < N and lane.waiting:
                    k = min(P.B, len(lane.waiting))
                    lane.units.append(Unit([lane.waiting.popleft() for _ in range(k)], (0,)))
            for i in range(min(N, len(lane.units))):
                u = lane.units[i]
                if u.run is not None or u.passed or u.held is not None:
                    continue
                if len(u.lanes) > 1:
                    ok = True
                    for M in u.lanes:
                        if M != L and self.lanes[M].units.index(u) >= N:
                            ok = False
                            break
                    if not ok:
                        continue
                if self.is_red(u.doms):
                    continue
                self.q_start(u)

    def ahead_count(self, u, d, j_idx):
        P = self.P
        cnt = 0
        if P.partitioned:
            lane = self.lanes[d]
            cnt = lane.units.index(u)  # every unit in lane d touches d (B=1 in partitioned mode)
        else:
            lane = self.lanes[0]
            if P.K == 1:
                for v in lane.units:
                    if v is u:
                        break
                    cnt += len(v.members)
            else:
                for v in lane.units:
                    if v is u:
                        break
                    for m in v.members:
                        if d in m.doms:
                            cnt += 1
        for m in u.members[:j_idx]:
            if d in m.doms:
                cnt += 1
        return cnt

    def q_eval(self, u, f):
        for j in u.members:
            if j.bad:
                return "bad"
        for idx, j in enumerate(u.members):
            for d, G in zip(j.doms, j.G):
                if G == math.inf:
                    continue
                if self.landed_since(d, j.base) + self.ahead_count(u, d, idx) >= G:
                    return "conflict"
        if self.flaky(f):
            return "flake"
        return None

    def q_start(self, u):
        dur, f = self.run_dur(len(u.doms))
        run = Run("q", u, dur, f)
        run.reason = self.q_eval(u, f)
        u.run = run
        self.request(run)

    def q_done(self, run):
        u = run.obj
        u.run = None
        if run.reason is None:
            u.passed = True
            self.try_land(u.lanes)
            self.resolve_held(u.lanes)
            self.schedule(u.lanes)
            return
        if self.P.retry_fail and not u.retried:
            u.retried = True
            self.q_start(u)
            return
        # A failure can only be attributed to u once everything ahead of it has passed
        # (otherwise a bad change ahead may be the cause; Zuul / GitHub merge queue semantics).
        u.held = run.reason
        self.resolve_held(u.lanes)

    def resolve_held(self, lane_ids):
        todo = list(lane_ids)
        while todo:
            L = todo.pop()
            lane = self.lanes[L]
            for v in lane.units:
                if v.passed:
                    continue
                if v.held is not None and all(
                        all(w.passed for w in self.lanes[M].units[:self.lanes[M].units.index(v)])
                        for M in v.lanes):
                    reason, v.held = v.held, None
                    self.q_fail(v, reason)
                    todo.extend(v.lanes)
                break

    def invalidate(self, v):
        if v.run is not None:
            self.cancel(v.run)
            v.run = None
        v.passed = False
        v.retried = False
        v.held = None

    def q_fail(self, u, reason):
        for L in u.lanes:
            lane = self.lanes[L]
            i = lane.units.index(u)
            for v in lane.units[i + 1:]:
                self.invalidate(v)
        if len(u.members) > 1:
            h = len(u.members) // 2
            u1, u2 = Unit(u.members[:h], u.lanes), Unit(u.members[h:], u.lanes)
            for L in u.lanes:
                lane = self.lanes[L]
                i = lane.units.index(u)
                lane.units[i:i + 1] = [u1, u2]
        else:
            for L in u.lanes:
                self.lanes[L].units.remove(u)
            self.reject(u.members[0], reason)
        self.schedule(u.lanes)

    def try_land(self, lane_ids):
        check = list(lane_ids)
        landed_lanes = set()
        while check:
            L = check.pop()
            lane = self.lanes[L]
            while lane.units and lane.units[0].passed:
                u = lane.units[0]
                if not all(self.lanes[M].units and self.lanes[M].units[0] is u for M in u.lanes):
                    break
                for M in u.lanes:
                    self.lanes[M].units.pop(0)
                    if M != L:
                        check.append(M)
                    landed_lanes.add(M)
                for c in u.members:
                    leak = self.leaked(c)
                    self.record_land(c)
                    if leak:
                        self.add_break(c, c.doms[0])
        if landed_lanes:
            self.schedule(landed_lanes)

    # ------------------------------------------------------------------ S6 pushrebase
    def pr_start(self, c):
        P = self.P
        c.t0 = self.now
        if not P.presubmit:
            self.pr_land(c)
            return
        dur, f = self.run_dur(len(c.doms))
        run = Run("pre", c, dur, f)
        if c.bad:
            run.reason = "bad"
        elif any(self.landed_since(d, c.base) >= G for d, G in zip(c.doms, c.G)):
            run.reason = "conflict"
        elif self.is_red(c.doms):
            run.reason = "blocked"
        elif self.flaky(f):
            run.reason = "flake"
        self.request(run)

    def pr_pre_done(self, run):
        c = run.obj
        if run.reason is not None:
            self.reject(c, run.reason)
            return
        self.pr_land(c)

    def pr_land(self, c):
        # textual conflict: same-file overlap with changes landed since the agent's rebase (t0)
        for d, Gt in zip(c.doms, c.Gt):
            if self.landed_since(d, c.t0) >= Gt:
                self.reject(c, "textual")
                return
        broke = False
        if not self.P.presubmit and c.bad:
            broke = True
        elif any(self.landed_since(d, c.base) >= G for d, G in zip(c.doms, c.G)):
            broke = True  # semantic conflict with a change that landed after the presubmit base
        elif self.leaked(c):
            broke = True
        self.record_land(c)
        if broke:
            self.add_break(c, c.doms[0])

    # ------------------------------------------------------------------ results
    def results(self, end):
        P = self.P
        hours = max(1e-9, (end - self.w0) / 60.0)
        lats = sorted(self.lat.values())

        def pct(q):
            if not lats:
                return float("nan")
            return lats[min(len(lats) - 1, int(q * len(lats)))]

        landed = self.landed_w
        growth = (self.pending() - (self.pending_at_w0 or 0))
        # unstable = backlog (queued + in rework) grows by more than 5% of the arrivals in the window
        unstable = self.unstable or (not P.saturate and self.arrived_w > 0 and
                                     growth > max(20, 0.05 * self.arrived_w))
        ci_total = self.ci_min + self.post_min
        out = asdict(P)
        out.update(
            throughput_h=landed / hours,
            offered_h=P.lam_day / 24.0,
            lat_p50=pct(0.5), lat_p95=pct(0.95), lat_mean=(sum(lats) / len(lats) if lats else float("nan")),
            ci_min_per_land=(ci_total / landed if landed else float("inf")),
            ci_gate_min_per_land=(self.ci_min / landed if landed else float("inf")),
            runs_started=self.runs_started, runs_cancelled=self.runs_cancelled,
            red_frac=self.red_time / (hours * 60.0), red_share=self.red_share_time / (hours * 60.0),
            breaks_h=self.breaks_w / hours, reverted_h=self.reverted_w / hours,
            ttd_mean=(sum(self.ttd) / len(self.ttd) if self.ttd else float("nan")),
            rej=dict(self.rej), unstable=unstable, pending_end=self.pending(), pending_w0=self.pending_at_w0,
            arrived_w=self.arrived_w,
            s_same=self.s_same, s_x=self.s_x, landed=landed, hours=hours,
        )
        return out


def simulate(**kw):
    return Sim(Params(**kw)).run()


if __name__ == "__main__":
    import json
    import sys
    kw = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    r = simulate(**kw)
    print(json.dumps({k: r[k] for k in ("strategy", "throughput_h", "lat_p50", "lat_p95",
                                        "ci_min_per_land", "red_frac", "unstable", "rej")}, indent=1))
