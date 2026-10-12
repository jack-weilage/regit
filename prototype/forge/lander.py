"""Forge objects (intents, threads, decisions, proof) and the Lander, the single writer of trunk main.

Maps to spec 60: Forge ~ the `forge` Worker + PushWorkflow + D1 index; Thread ~ ThreadDO with its
Artifacts fork; Lander ~ LanderDO + LandWorkflow; trunk.git ~ the Artifacts repo `app`.
"""
import json
import os
import re
from collections import deque
from pathlib import Path

from . import policy as pol
from .evidence import EvidenceStore, canon
from .gitx import git, new_id, now, run, short, who

# Token custody stand-in (Artifacts has no branch protection): only a holder of the trunk
# token may move main or the forge notes. Threads can push only to their own forks.
HOOK = """#!/bin/sh
while read old new ref; do
  case "$ref" in refs/heads/main|refs/notes/forge)
    if [ "$FORGE_LANDER_TOKEN" != "$(cat forge-lander-token)" ]; then
      echo "forge: $ref is writable only by the Lander" >&2; exit 1
    fi;;
  esac
done
"""


class Forbidden(Exception):
    """A 403 from the Decision answer endpoint (approver_is_requester, not_in_group, not_open)."""


class ScriptedAgent:
    """Deterministic stand-in for a Claude Code turn: steps of (message text, patch fn on the work tree)."""
    name = "scripted-agent@0.1"

    def __init__(self, steps, rederive=None):
        self.steps, self._rederive = steps, rederive

    def work(self, th, steps=None):
        for text, patch in steps or self.steps:
            msg = th.say("agent", text)
            patch(th.fork)
            th.checkpoint(msg)

    def rederive(self, th, packet):
        """Default re-derivation: re-apply my own intent on the new base (never merge hunks)."""
        if self._rederive:
            return self._rederive(self, th, packet)
        won = "; ".join(w["intent"]["title"] for w in packet["winners"])
        th.say("agent", f"Collided with landed [{won}]. Re-applying my intent on new main "
                        f"{short(packet['newBase'])}, keeping theirs intact.")
        self.work(th)


class Thread:
    def __init__(self, forge, intent, agent):
        self.forge, self.intent, self.agent = forge, intent, agent
        self.id, self.change_id = new_id("thr"), new_id("chg")
        self.sponsor, self.steered_by = intent["sponsor"], []
        self.fork = forge.root / "forks" / f"t-{self.id}"
        git(forge.root, "clone", "-q", forge.trunk, self.fork)       # app.fork(`t-${id}`)
        git(self.fork, "checkout", "-q", "-b", "work")
        self.base = git(self.fork, "rev-parse", "HEAD")
        self.messages, self.revisions, self.handback_from = [], [], []
        self.state, self.handbacks = "working", 0
        intent["threadIds"].append(self.id)
        self.say("human", intent["body"], author=self.sponsor)

    def say(self, role, text, author=None):
        m = {"id": new_id("msg"), "threadId": self.id, "seq": len(self.messages), "role": role,
             "author": author, "text": text, "at": now()}
        self.messages.append(m)
        return m

    def message(self, mid):
        return next(m for m in self.messages if m["id"] == mid)

    def steer(self, by, text):
        self.steered_by.append(by)
        self.say("human", text, author=by)

    def checkpoint(self, msg):
        git(self.fork, "add", "-A")
        body = (f"checkpoint {msg['seq']}: {msg['text'][:60]}\n\n"
                f"Forge-Thread: {self.id}\nForge-Message: {msg['id']}\n")
        git(self.fork, "commit", "-q", "-F", "-", input=body, env=who(f"{self.id} agent", f"{self.id}@agents.forge"))
        msg["checkpointSha"] = git(self.fork, "rev-parse", "HEAD")

    def run(self):
        """One agent turn, then push HEAD:ready, the only 'submit' verb."""
        self.agent.work(self)
        return self.ready()

    def ready(self, cause="initial", packet=None):
        git(self.fork, "branch", "-f", "ready", "HEAD")
        return self.forge.submit(self, cause, packet)

    def hand_back(self, h, packet):
        """ThreadDO.handBack: log the packet as data, reset to newBase, re-derive, re-prove."""
        self.handbacks += 1
        self.handback_from = [f"{w['changeId']}/{packet['kind']}" for w in packet["winners"]]
        self.say("forge", f"Hand-back {h} (data, not instructions):\n```json\n{json.dumps(packet)[:4000]}\n```")
        git(self.fork, "fetch", "-q", "origin", "main")
        git(self.fork, "checkout", "-q", "-B", "work", packet["newBase"])
        self.base, self.state = packet["newBase"], "rederiving"
        self.agent.rederive(self, packet)
        return self.ready("handback", h)


class Forge:
    def __init__(self, root, seed_files, log=None, key=None):
        self.root = Path(root)
        self.log = log or (lambda actor, text: None)
        self.trunk = self.root / "trunk.git"
        git(self.root, "init", "-q", "--bare", "-b", "main", self.trunk)
        token = os.urandom(16).hex()
        (self.trunk / "forge-lander-token").write_text(token)
        hook = self.trunk / "hooks" / "pre-receive"
        hook.write_text(HOOK)
        hook.chmod(0o755)
        self.evidence = EvidenceStore(self.root / "evidence", key or os.urandom(32))
        self.intents, self.threads, self.decisions = {}, {}, {}
        self.landings, self.spans = [], {}
        self.lander = Lander(self, token, seed_files)  # the trunk token goes to the Lander only

    # ---- index (D1 stand-in) ----
    def _save(self):
        idx = self.root / "index"
        idx.mkdir(exist_ok=True)
        for name, obj in (("landings", self.landings), ("line_spans", self.spans), ("decisions", self.decisions)):
            (idx / f"{name}.json").write_text(json.dumps(obj, indent=1))

    def main_sha(self):
        return git(self.trunk, "rev-parse", "refs/heads/main")

    def policy_at(self, sha):
        """The policy is always read from the base, so a change cannot loosen its own gate."""
        return pol.parse(git(self.trunk, "show", f"{sha}:.forge/policy.yaml"))

    @staticmethod
    def scope_digest(repo, a, b, paths):
        diff = run(repo, "diff", a, b, "--", *paths).stdout if paths else ""
        pid = run(repo, "patch-id", "--stable", input=diff).stdout.split() if diff else []
        return pid[0] if pid else "empty"

    # ---- intents and threads ----
    def intent(self, title, body, sponsor, claims=()):
        i = {"id": new_id("int"), "title": title, "body": body, "sponsor": sponsor,
             "claims": list(claims), "threadIds": []}
        self.intents[i["id"]] = i
        return i

    def spawn(self, intent, agent):
        th = Thread(self, intent, agent)
        self.threads[th.id] = th
        self.log("forge", f"{th.id} ({intent['sponsor']}) forked trunk@{short(th.base)} -> {th.fork.name}: "
                          f"\"{intent['title']}\" claims={intent['claims']}")
        return th

    # ---- proof (PushWorkflow stand-in): the forge, never the agent, produces evidence ----
    def submit(self, th, cause="initial", packet=None):
        head = git(th.fork, "rev-parse", "refs/heads/ready")
        paths = git(th.fork, "diff", "--name-only", th.base, head).split()
        h, res, reused = self.evidence.test_commit(th.fork, head)
        main = self.main_sha()
        p = pol.evaluate(self.policy_at(main), paths, main)
        rev = {"rev": len(th.revisions) + 1, "headSha": head, "baseSha": th.base, "changedPaths": paths,
               "treeSha": git(th.fork, "rev-parse", f"{head}^{{tree}}"), "tests": h, "cause": cause,
               "packetHash": packet, "policy": p, "handbackFrom": list(th.handback_from) if packet else []}
        th.revisions.append(rev)
        self.log("runner", f"{th.id} rev {rev['rev']} ({cause}): tests on its own tree {short(rev['treeSha'])} -> "
                           f"{'PASS' if res['pass'] else 'FAIL'} ({res['ran']} ran), signed {h[:19]}"
                           f"{' [reused]' if reused else ''}")
        if not res["pass"]:
            th.state = "proof_failed"
            return "proof_failed"
        self.log("policy", f"{th.id}: {paths} -> lane {p['lane'].upper()} (rules {p['matchedRules']}, policy@main {short(main)})")
        if p["lane"] == "decide":
            self.open_decision(th, rev, self.scope_digest(th.fork, th.base, head, p["decidePaths"]))
            return "awaiting_decision"
        th.state = "queued"
        self.lander.enqueue(th)
        return "queued"

    # ---- decisions ----
    def open_decision(self, th, rev, digest, kind="land.approve"):
        p = rev["policy"]
        a = p.get("approvers") or {"count": 1, "from": [], "eligible": []}
        d = {"id": new_id("dec"), "kind": kind, "changeId": th.change_id, "rev": rev["rev"], "threadId": th.id,
             "requester": th.sponsor, "ineligible": sorted({th.sponsor, *th.steered_by}),
             "eligible": a["eligible"], "question": f"Land \"{th.intent['title']}\"?",
             "reason": f"{', '.join(p['decidePaths']) or 'collision'} matched a decide rule; needs {a['count']} of {a['from']}",
             "binding": {"treeSha": rev["treeSha"], "scopeDigest": digest}, "status": "open"}
        self.decisions[d["id"]] = d
        th.state = "blocked" if kind == "conflict.escalate" else "awaiting_decision"
        self._save()
        self.log("decide", f"{d['id']} OPEN ({kind}) for {th.id}: {d['reason']}; requester {d['requester']} is ineligible")
        return d

    def answer(self, dec_id, by, choice="approve", note=""):
        """POST /api/decisions/:id/answer. The server enforces approver != requester, whatever the UI shows."""
        d = self.decisions[dec_id]
        if d["status"] != "open":
            raise Forbidden("not_open")
        if by in d["ineligible"]:
            raise Forbidden("approver_is_requester")
        if by not in d["eligible"]:
            raise Forbidden("not_in_group")
        d["status"] = {"approve": "approved", "reject": "rejected", "send_back": "sent_back"}[choice]
        d["answer"] = {"by": by, "choice": choice, "note": note, "at": now()}
        d["answer"]["sig"] = self.evidence.mac(canon([dec_id, d["answer"], d["binding"]]))
        th = self.threads[d["threadId"]]
        self.log("decide", f"{dec_id} {d['status'].upper()} by {by}")
        if choice == "approve":
            th.state = "queued"
            self.lander.enqueue(th)
        else:
            th.state = "working"
        self._save()
        return d

    def approved_decision(self, th, digest):
        for d in self.decisions.values():
            if d["changeId"] == th.change_id and d["status"] == "approved":
                if d["binding"]["scopeDigest"] == digest:
                    return d
                d["status"] = "stale"  # approved hunks changed under rebase: the approval does not carry
        return None

    # ---- blame -> thread -> message ----
    def why(self, path, line):
        out = run(self.trunk, "blame", "--porcelain", "-L", f"{line},{line}", "main", "--", path).stdout
        sha, orig = out.split()[0], int(out.split()[1])
        landing = next((x for x in self.landings if x["landedSha"] == sha), None)
        span = next((s for s in self.spans.get(sha, []) if s["path"] == path and s["start"] <= orig <= s["end"]), None)
        th = self.threads.get(landing["threadId"]) if landing else None
        note = run(self.trunk, "notes", "--ref=forge", "show", sha).stdout.strip()
        return {"path": path, "line": line, "text": out.splitlines()[-1][1:], "commit": sha, "landing": landing,
                "thread": th.id if th else None, "intent": th.intent if th else None,
                "message": th.message(span["message"]) if th and span else None,
                "note": json.loads(note) if note else None}


class Lander:
    """Single writer of trunk main: serial lease -> rebase -> policy from base -> combined re-test -> CAS -> note."""

    def __init__(self, forge, token, seed_files):
        self.forge, self.queue, self.before_cas = forge, deque(), None
        self._env = {"FORGE_LANDER_TOKEN": token, **who("Forge Lander", "lander@forge.dev")}
        self.wd = forge.root / "lander"  # the lander's warm clone
        git(forge.root, "clone", "-q", forge.trunk, self.wd)
        for rel, text in seed_files.items():
            (self.wd / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.wd / rel).write_text(text)
        self.g("add", "-A")
        self.g("commit", "-q", "-m", "seed: toy shop")
        self.g("push", "-q", "origin", "HEAD:refs/heads/main")

    def g(self, *args, input=None, env=None):
        return git(self.wd, *args, input=input, env={**self._env, **(env or {})})

    def enqueue(self, th):
        self.queue.append(th)
        self.forge.log("lander", f"queued {th.change_id} rev {th.revisions[-1]['rev']} ({th.id}); queue depth {len(self.queue)}")

    def drain(self):
        out = []
        while self.queue:
            out.append(self.land(self.queue.popleft()))
        return out

    def land(self, th):
        f, rev, att = self.forge, th.revisions[-1], new_id("att")
        th.state = "landing"
        self.g("fetch", "-q", th.fork, f"+refs/heads/ready:refs/forge/sub/{th.id}")
        for attempt in range(3):
            self.g("fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main")
            base = self.g("rev-parse", "origin/main")
            f.log("lander", f"{att} lease -> {th.change_id} rev {rev['rev']}; base main={short(base)}")
            # 1. Rebase the checkpoint chain onto main. A textual conflict is handed back, never resolved here.
            self.g("checkout", "-q", "--detach", rev["headSha"])
            if run(self.wd, "rebase", "-q", "--onto", base, rev["baseSha"], env=self._env).returncode:
                files = self.g("diff", "--name-only", "--diff-filter=U").split()
                self.g("rebase", "--abort")
                f.log("lander", f"rebase CONFLICT in {files}: no hunk merging; hand back")
                return self.hand_back(th, rev, att, "textual", base, conflict_files=files)
            rebased = self.g("rev-parse", "HEAD")
            paths = self.g("diff", "--name-only", base, rebased).split()
            # 2. Policy from the lease base; a decide-lane approval must still bind the rebased hunks.
            p = pol.evaluate(f.policy_at(base), paths, base)
            decision = None
            if p["lane"] == "decide":
                decision = f.approved_decision(th, f.scope_digest(self.wd, base, rebased, p["decidePaths"]))
                if not decision:
                    f.log("lander", "no approved Decision binds this scope; opening one and releasing the lease")
                    f.open_decision(th, rev, f.scope_digest(self.wd, base, rebased, p["decidePaths"]))
                    return "awaiting_decision"
            if p["missing"]:
                th.state = "blocked"
                f.log("lander", f"missing required evidence {p['missing']}; not landing")
                return "blocked"
            # 3. Re-test exactly the tree that will land: {main + change}.
            h, res, reused = f.evidence.test_commit(self.wd, rebased)
            tree = self.g("rev-parse", f"{rebased}^{{tree}}")
            f.log("runner", f"COMBINED re-test {{main {short(base)} + {th.change_id}}} tree {short(tree)} -> "
                            f"{'PASS' if res['pass'] else 'FAIL'} ({res['ran']} ran) {h[:19]}"
                            f"{' [reused: same tree already proven]' if reused else ''}")
            if not res["pass"]:
                f.log("lander", f"clean merge, red combination {res['failed']}: main stays {short(base)}; hand back")
                return self.hand_back(th, rev, att, "semantic", base, paths=paths, report=res["tail"])
            spans = self.line_spans(base, rebased, paths)
            manifest = f.evidence.put({"manifest": [{"kind": "combined-tests", "hash": h},
                                                    {"kind": "tests", "hash": rev["tests"]}]})
            # 4. Squash into one commit with trailers; author is the agent, committer the Lander.
            self.g("reset", "-q", "--soft", base)
            self.g("commit", "-q", "-F", "-", input=self.message(th, rev, p, manifest, decision),
                   env=who(f"{th.id} agent", f"{th.id}@agents.forge", committer=False))
            cand = self.g("rev-parse", "HEAD")
            assert self.g("rev-parse", f"{cand}^{{tree}}") == tree, "tested tree must equal landed tree"
            # 5. Compare-and-swap main from the lease base to the candidate.
            self.g("push", "-q", "origin", f"{cand}:refs/forge/attempts/{att}-{attempt}")
            if self.before_cas:
                self.before_cas(base, cand)
            if run(f.trunk, "update-ref", "refs/heads/main", cand, base).returncode == 0:
                f.log("lander", f"CAS refs/heads/main {short(base)} -> {short(cand)} OK")
                return self.finish(th, rev, att, base, cand, tree, p, manifest, decision, spans, paths)
            f.log("lander", f"CAS REFUSED: main is no longer {short(base)}; re-rebasing (try {attempt + 2}/3)")
        th.state = "aborted"
        return "aborted"

    def message(self, th, rev, p, manifest, decision):
        body = th.intent["body"]
        if rev["handbackFrom"]:
            body = f"Re-derived after collision with {', '.join(rev['handbackFrom'])}.\n\n{body}"
        t = [f"Forge-Thread: {th.id}", f"Forge-Change: {th.change_id}", f"Forge-Revision: {rev['rev']}",
             f"Forge-Intent: {th.intent['id']}", f"Forge-Evidence: {manifest}",
             f"Forge-Policy: {p['lane']}; rules={'|'.join(p['matchedRules'])}; base={short(p['policyBaseSha'])}"]
        t += [f"Forge-Decision: {decision['id']}"] if decision else []
        t += [f"Forge-Handback: {x}" for x in rev["handbackFrom"]]
        t += [f"Forge-Sponsor: {th.sponsor}", f"Forge-Agent: {th.agent.name}"]
        return f"{th.intent['title']}\n\n{body}\n\n" + "\n".join(t) + "\n"

    def line_spans(self, base, head, paths):
        """Map each line the change introduced to the Forge-Message of the checkpoint that wrote it."""
        spans, msg_of = [], {}
        for path in paths:
            if run(self.wd, "cat-file", "-e", f"{head}:{path}").returncode:
                continue  # deleted file
            out = run(self.wd, "blame", "--porcelain", f"{base}..{head}", "--", path).stdout
            cur, final, boundary = None, 0, set()
            for ln in out.splitlines():
                parts = ln.split()
                if ln.startswith("\t"):
                    if cur in boundary:
                        continue
                    if cur not in msg_of:
                        msg_of[cur] = self.g("log", "-1", "--format=%(trailers:key=Forge-Message,valueonly)", cur).strip()
                    last = spans[-1] if spans else None
                    if last and last["path"] == path and last["message"] == msg_of[cur] and last["end"] == final - 1:
                        last["end"] = final
                    else:
                        spans.append({"path": path, "start": final, "end": final, "message": msg_of[cur]})
                elif len(parts) >= 3 and re.fullmatch(r"[0-9a-f]{40}", parts[0]):
                    cur, final = parts[0], int(parts[2])
                elif parts[:1] == ["boundary"]:
                    boundary.add(cur)
        return spans

    def finish(self, th, rev, att, base, cand, tree, p, manifest, decision, spans, paths):
        f = self.forge
        lnd = {"id": new_id("lnd"), "changeId": th.change_id, "rev": rev["rev"], "threadId": th.id,
               "intentId": th.intent["id"], "attemptId": att, "baseSha": base, "landedSha": cand, "treeSha": tree,
               "outcome": "landed", "lane": p["lane"], "evidenceManifest": manifest,
               "decisionIds": [decision["id"]] if decision else [], "handbackFrom": rev["handbackFrom"],
               "paths": paths, "at": now()}
        note = {"v": 1, "thread": th.id, "change": th.change_id, "rev": rev["rev"], "intent": th.intent["id"],
                "landing": lnd["id"], "evidence": manifest,
                "policy": {"lane": p["lane"], "base": short(base), "rules": p["matchedRules"]},
                "decisions": lnd["decisionIds"],
                "handbacks": [{"from": x.split("/")[0], "kind": x.split("/")[1]} for x in rev["handbackFrom"]],
                "lines": f"index/line_spans.json#{cand}"}
        run(self.wd, "fetch", "-q", "origin", "+refs/notes/forge:refs/notes/forge", env=self._env)
        self.g("notes", "--ref=forge", "add", "-f", "-F", "-", cand, input=canon(note))
        self.g("push", "-q", "origin", "refs/notes/forge")
        f.landings.append(lnd)
        f.spans[cand] = spans
        th.state = "landed"
        f._save()
        f.log("lander", f"{lnd['id']} LANDED {th.change_id} rev {rev['rev']} as {short(cand)} [lane {p['lane']}]"
                        f"{' with ' + decision['id'] if decision else ''}; trailers + note on refs/notes/forge")
        if p["lane"] == "flag":
            f.log("policy", f"lane flag: landed now; post.review card opened for {th.change_id}")
        return "landed"

    def hand_back(self, th, rev, att, kind, base, conflict_files=None, paths=None, report=None):
        f = self.forge
        since = set(self.g("rev-list", f"{rev['baseSha']}..{base}").split())
        landed = [x for x in reversed(f.landings) if x["outcome"] == "landed" and x["landedSha"] in since]
        touch = set(conflict_files or paths or [])
        winners = ([x for x in landed if touch & set(x["paths"])] or landed)[:3]  # semantic: may share no path
        packet = {"v": 1, "kind": kind, "instruction": "rederive", "newBase": base,
                  "loser": {"changeId": th.change_id, "rev": rev["rev"], "threadId": th.id},
                  "winners": [{"changeId": w["changeId"], "threadId": w["threadId"],
                               "intent": {k: f.intents[w["intentId"]][k] for k in ("title", "body")},
                               "landedSha": w["landedSha"], "evidenceManifest": w["evidenceManifest"],
                               "diff": self.g("show", "--format=", w["landedSha"])[:48000]} for w in winners],
                  "failing": {"conflictFiles": conflict_files, "testReportTail": (report or "")[-8000:]}}
        h = f.evidence.put(packet)
        f.landings.append({"id": new_id("lnd"), "changeId": th.change_id, "rev": rev["rev"], "threadId": th.id,
                           "intentId": th.intent["id"], "attemptId": att, "baseSha": base, "landedSha": None,
                           "outcome": "handed_back", "kind": kind, "packet": h, "paths": paths or [], "at": now()})
        f._save()
        f.log("lander", f"hand-back ({kind}) packet {h[:19]} -> {th.id}: winners "
                        f"{[(w['changeId'], w['intent']['title']) for w in packet['winners']]}")
        if th.handbacks >= f.policy_at(base).get("limits", {}).get("max_handbacks", 2):
            f.open_decision(th, rev, "n/a", kind="conflict.escalate")
            return f"blocked:{kind}"
        th.hand_back(h, packet)
        return f"handed_back:{kind}"
