"""Intent claims: advisory overlap warnings between live threads, and base_moved (stale + at-risk) signals.

A claim is "path-or-glob" (the whole file) or "path-or-glob::symbol". Two claims overlap when their paths
overlap and either one claims the whole file or both name the same symbol. Nothing here blocks a landing.
"""
from .policy import glob_match

LIVE_EXCLUDED = {"landed", "aborted"}


def parse(claim):
    path, _, sym = claim.partition("::")
    return path, sym or None


def paths_overlap(a, b):
    return a == b or glob_match(a, b) or glob_match(b, a)


def claims_overlap(a, b):
    (pa, sa), (pb, sb) = parse(a), parse(b)
    return paths_overlap(pa, pb) and (sa is None or sb is None or sa == sb)


def touches(claims, paths):
    """Claimed path patterns that match any changed path (symbols are ignored: file-level is the safe side)."""
    return sorted({c for c in claims for p in paths if glob_match(parse(c)[0], p)})


class ClaimRegistry:
    """The Lander-side registry (LanderDO stand-in): who claims what among threads that have not landed."""

    def __init__(self, forge):
        self.forge, self.events = forge, []

    def live(self, exclude=None):
        return [t for t in self.forge.threads.values() if t is not exclude and t.state not in LIVE_EXCLUDED]

    def emit(self, ev, th=None):
        self.events.append(ev)
        if th is not None:
            th.inbox.append(ev)
        return ev

    def register(self, th):
        """Called when a thread is spawned: report overlaps with every other live thread immediately."""
        out = []
        for other in self.live(exclude=th):
            pairs = [(a, b) for a in th.intent["claims"] for b in other.intent["claims"] if claims_overlap(a, b)]
            if pairs:
                ev = self.emit({"type": "overlap_warning", "threads": [other.id, th.id], "claims": pairs,
                                "advisory": True})
                th.inbox.append(ev), other.inbox.append(ev)
                self.forge.log("claims", f"OVERLAP WARNING (advisory): {th.id} \"{th.intent['title']}\" and "
                                         f"{other.id} \"{other.intent['title']}\" both claim {pairs}")
                out.append(ev)
        return out

    def main_moved(self, landed_th, new_main, paths):
        """Called after every landing: tell each live thread that is behind and whose claims intersect the change."""
        out = []
        for th in self.live(exclude=landed_th):
            hit = touches(th.intent["claims"], paths)
            if th.base != new_main and hit:
                ev = self.emit({"type": "base_moved", "threadId": th.id, "oldBase": th.base, "newMain": new_main,
                                "landedChange": landed_th.change_id, "files": paths, "claimsHit": hit}, th)
                th.say("forge", f"base_moved: main is now {new_main[:8]} ({landed_th.change_id} changed {paths}); "
                                f"your base {th.base[:8]} is stale and your claims {hit} are at risk. Re-sync early.")
                self.forge.log("lander", f"base_moved -> {th.id} ({th.state}): stale base {th.base[:8]}, "
                                         f"claims {hit} intersect landed files")
                out.append(ev)
        return out
