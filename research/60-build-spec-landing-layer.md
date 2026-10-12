# 60 — Build spec: the landing layer of a thread-native forge on Cloudflare

Written 2026-10-12 for a 2-day build (Oct 13–14). Entries close **2026-10-14 11:59 PM PDT** [23]. Team: 1–2 people.

**Legend.** `[23]` means the API name, limit or behaviour is confirmed in file 23. `[A#]` is an assumption to test, listed in §14 with its test and fallback. Untagged items are design decisions. Other numbers cite corpus files (19 throughput, 29 previews, 41–46 designs, 51/52 red teams, 98 digest).

---

## 1. What the demo must prove

The headline follows red team 51: not "we resolve conflicts", but **"we catch collisions that merge cleanly, hand them back with the winner's intent, and only land what the forge itself proved."**

1. Several Claude Code agents work at once, each in its own Artifacts fork and Sandbox.
2. Only the **Lander** can write `main`. Token custody enforces this, since Artifacts has no branch protection [23].
3. The forge produces the proof, signed and hashed: tests, a pinned preview deployment, and a Browser Run screenshot.
4. Per-path policy routes each change to lane `auto`, `flag` or `decide`.
5. A change that merges cleanly but fails the combined re-test is handed back to its thread, which re-derives it and proves it again.
6. The requester cannot approve their own Decision card.
7. Any line on `main` resolves to its thread and then to its message.

Out of scope, named in the video as the scaling path [19]: speculative batching, partitioned lanes, test-impact analysis, mutation testing, best-of-N.

---

## 2. Architecture

```
Human ──HTTPS/SSE (Access)──┐        Agent in container ──git push t-* / forge.internal (intercepted)──┐
                            ▼                                                                      ▼
Worker "forge": UI+API · GitGateway/AIGateway/AgentAPI entrypoints
                ThreadDO (per thread, agent container) · RunnerDO (per proof run) · LanderDO (per repo, trunk lease)
                PushWorkflow ◄ cf.artifacts.repo.pushed      LandWorkflow ◄ LanderDO
   ▼ Artifacts app + t-*   ▼ D1 index   ▼ R2 evidence   ▼ Browser Run   ▼ Worker "shop" previews
```

| Component | Product | Exact binding / API |
|---|---|---|
| Trunk repo `app` | Artifacts | `env.ARTIFACTS.create("app",{setDefaultBranch:"main"})` or `.import({source:{url},target:{name:"app"}})` [23] |
| Thread workspace | Artifacts fork | `using app = await env.ARTIFACTS.get("app"); await app.fork(\`t-${id}\`,{defaultBranchOnly:true})`. `get()` throws while the repo is `forking`, so poll `list()` [23] |
| Credentials | Artifacts tokens | Fork: `createToken("write",86400)` (TTL unit assumed to be seconds, as in REST). Trunk: `app.createToken("write",900)` minted **per landing lease**, held only by LanderDO. `revokeToken` on release, land or abandon [23] |
| Git remote | Artifacts git | `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/forge-demo/<repo>.git` with `Authorization: Bearer art_v1_…`. Push is receive-pack v1 only [23] |
| Thread | DO (SQLite) + Container | `ThreadDO`: `ctx.container.start({image:ctx.container.images.agent, enableInternet:false, instance:"standard-1", env})`, `exec`, `setInactivityTimeout`, a 60 s alarm [23] |
| Agent | Claude Code, Sandbox SDK 1.0 | `node:24-trixie-slim`, `@anthropic-ai/claude-code@2.1.280`, `sandbox-shim`. Command `claude --print --output-format stream-json --verbose --dangerously-skip-permissions`; env `IS_SANDBOX=1` [23] |
| Secrets out of sandbox | Egress intercept | `interceptOutboundHttps(host, ctx.exports.X)` for `<acct>.artifacts.cloudflare.net`→GitGateway, `gateway.ai.cloudflare.com`→AIGateway (strip `x-api-key`, add `cf-aig-authorization`), `forge.internal`→AgentAPI. Set `GIT_SSL_CAINFO`/`NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt` [23]. Artifacts behaviour is [A3] |
| Push → proof | Workflows + events | `triggers.events` `cf.artifacts.repo.pushed`, filtered by namespace → `forge-push` [23]. Event shape is [A5] |
| Verifier | DO + Container | `RunnerDO`: same image, read-only interceptors |
| Preview | Workers Previews | In RunnerDO: `npx wrangler preview --name p-<thr8>-<sha7> --worker-name shop --json` → `.preview.urls[0]` [23]. Deployment URL is [A1] |
| Browser proof | Browser Run | `@cloudflare/playwright` 1.3.6 `launch(env.BROWSER,{recording:true})`, `page.screenshot()`, `?debugId=` [23] |
| Evidence / index | R2 / D1 | Content-addressed R2 keys (limit of 1 write/s per key) [23]. One D1 for the demo; one per repo at scale |
| Lander | DO + Container + Workflow | `LANDER.idFromName("app")` holds lease, queue and alarm [23]. `LandWorkflow` runs the steps |
| Prod deploy (optional) | Workers Builds | `app` → Worker `shop`, `main` only [23]. Never per thread (6 concurrent builds) |

`wrangler.jsonc` (forge) needs Wrangler ≥ 4.145.0 [23]:

```jsonc
{
  "name": "forge", "main": "src/index.ts",
  "compatibility_date": "2026-10-01", "compatibility_flags": ["nodejs_compat"],
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "forge-demo" }],
  "durable_objects": { "bindings": [
    { "name": "THREAD", "class_name": "ThreadDO" },
    { "name": "RUNNER", "class_name": "RunnerDO" },
    { "name": "LANDER", "class_name": "LanderDO" } ] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["ThreadDO", "RunnerDO", "LanderDO"] }],
  "containers": [   // same entry for RunnerDO and LanderDO
    { "class_name": "ThreadDO", "scheduling_policy": "durable_object", "images": { "agent": { "dockerfile": "./images/agent.Dockerfile" } } } ],
  "workflows": [
    { "binding": "PUSH_WF", "name": "forge-push", "class_name": "PushWorkflow" },
    { "binding": "LAND_WF", "name": "forge-land", "class_name": "LandWorkflow" } ],
  "triggers": { "events": [{ "type": "cf.artifacts.repo.pushed", "filter": { "namespace": "forge-demo" },
                             "target": { "scriptName": "forge", "workflowName": "forge-push" } }] },
  "d1_databases": [{ "binding": "DB", "database_name": "forge-index", "database_id": "<id>" }],
  "r2_buckets": [{ "binding": "EVIDENCE", "bucket_name": "forge-evidence" }],
  "browser": { "binding": "BROWSER" }            // key name: [A14]
}
```

Key shapes for `artifacts`, `containers` and `triggers.events` come from [23]. The `durable_objects`, `migrations`, `workflows`, `d1_databases` and `r2_buckets` blocks are standard Wrangler that file 23 does not restate: check them with `wrangler types` in hour 0. The demo app `shop` keeps state **only in DO SQLite**, which is isolated per Preview [23]. It has no D1, KV, Queues, Workflows, cron or service bindings, because those reach production from a Preview [23, 29].

---

## 3. Principals and token custody

| Principal | Holds | Can | Cannot |
|---|---|---|---|
| Human | Access session | Intents, steering, Decisions (not their own) | Push |
| Agent (ThreadDO container) | **Nothing**; GitGateway injects the fork token | Push `t-<id>`, read `app`, call `forge.internal` | Write `app`, answer Decisions, mint evidence |
| RunnerDO | Read tokens; preview API token [A4] | Test, deploy previews, return results for signing | Write `app` |
| LanderDO | Trunk token per lease | Write `main`, `refs/notes/forge` | Approve |

GitGateway allows upload-pack (`info/refs?service=git-upload-pack`, `POST git-upload-pack`) on `app.git` and the caller's fork, and receive-pack **only** on `t-<ownThreadId>.git`. Everything else gets a 403. This extends Cloudflare's allow-clone, deny-push pattern [23]; per-thread identity is [A8]. Agent-to-agent messages are data, never authority (42).

---

## 4. Data schemas

```ts
type ULID = string; type Sha = string; type Email = string;

interface Intent { id: `int_${ULID}`; title: string; body: string; acceptance: string[];
  sponsor: Email; createdAt: string; threadIds: string[]; }          // 1 intent : N threads

interface Thread { id: `thr_${ULID}`; intentId: string; sponsor: Email; steeredBy: Email[];
  agent: { harness: "claude-code"; version: "2.1.280"; model: string };
  forkRepo: `t-${string}`; baseSha: Sha; state: ThreadState; changeId: string;
  proofRounds: number; handbacks: number; claims: string[] /* path globs */; }

interface ThreadMessage { id: `msg_${ULID}`; threadId: string; seq: number;
  role: "human" | "agent" | "forge"; author?: Email; text: string;          // in ThreadDO SQLite
  checkpointSha?: Sha; toolUseIds?: string[]; at: string; }

interface Change { id: `chg_${ULID}`; threadId: string; intentId: string; title: string;
  revisions: ChangeRevision[]; state: "drafting" | "proving" | "ready" | "queued" | "landed" | "blocked"; }

interface ChangeRevision { rev: number; headSha: Sha; baseSha: Sha; treeSha: Sha;
  changedPaths: string[]; evidenceManifest?: `sha256:${string}`; policy?: PolicyResult;
  cause: "initial" | "proof_failed" | "handback"; packetHash?: string; }

interface PolicyResult { lane: "auto" | "flag" | "decide"; matchedRules: string[];
  required: EvidenceKind[]; missing: EvidenceKind[]; policyBaseSha: Sha;
  approvers?: { count: number; from: string[] }; }

type EvidenceKind = "tests" | "combined-tests" | "preview" | "screenshot" | "recording";

interface Decision { id: `dec_${ULID}`; kind: "land.approve" | "post.review" | "conflict.escalate";
  changeId: string; rev: number; requester: Email;           // the thread's sponsor
  ineligible: Email[];                                       // requester + steeredBy
  question: string; reason: string /* policy rule text */;
  binding: { treeSha: Sha; scopeDigest: string; evidenceManifest: string };
  options: ("approve" | "reject" | "send_back")[];
  status: "open" | "approved" | "rejected" | "sent_back" | "stale";
  answer?: { by: Email; choice: string; note?: string; at: string; sig: string }; }

interface LandingRecord { id: `lnd_${ULID}`; changeId: string; rev: number; threadId: string;
  attemptId: string; baseSha: Sha; landedSha: Sha; treeSha: Sha;
  outcome: "landed" | "handed_back" | "aborted"; lane: PolicyResult["lane"];
  evidenceManifest: string; decisionIds: string[]; handbackFrom?: string[]; at: string; }

interface ConflictPacket { v: 1; kind: "textual" | "semantic";
  loser: { changeId: string; rev: number; threadId: string };
  winners: { changeId: string; threadId: string; intent: { title: string; body: string };
             landedSha: Sha; diff: string /* ≤48 KB */; evidenceManifest: string }[];
  failing: { conflictFiles?: string[]; testReportTail?: string /* ≤8 KB */ };
  newBase: Sha; instruction: "rederive"; }
```

D1 tables mirror these objects, plus `evidence(hash, change_id, rev, kind, producer, r2_key)`, `line_spans(landed_sha, path, start, end, thread_id, message_id)` and `claims(thread_id, glob)`. Thread logs live in ThreadDO SQLite; the queue and lease live in LanderDO SQLite.

---

## 5. Policy file

The policy lives at `.forge/policy.yaml` and is **always read from the base**: `repo.readFile({ref:"main", path:".forge/policy.yaml"})` [23]. A change therefore cannot loosen its own gate (41, 42, 46). It is evaluated twice: by PushWorkflow against `main` at proof time, and by the Lander against the lease base (`main` at landing).

```yaml
version: 1
default: { lane: flag, require: [tests, combined-tests] }
rules:
  - match: ["docs/**", "**/*.md"]
    lane: auto
    require: [tests, combined-tests]
  - match: ["src/ui/**", "public/**"]
    lane: auto
    require: [tests, combined-tests, preview, screenshot]
    screens: ["/", "/cart"]                # routes Browser Run captures
  - match: ["src/api/**"]
    lane: flag                             # lands now; opens a post.review card
    require: [tests, combined-tests, preview]
  - match: ["src/billing/**"]
    lane: decide
    require: [tests, combined-tests, preview, screenshot]
    approvers: { count: 1, from: ["@payments"] }
  - match: [".forge/**", "test/**", "wrangler.jsonc", ".claude/**"]
    lane: decide                           # tests, gates and agent config are governed separately (41, 42)
    require: [tests, combined-tests]
    approvers: { count: 1, from: ["@maintainers"] }
groups: { "@payments": ["carol@demo.dev"], "@maintainers": ["dana@demo.dev", "carol@demo.dev"] }
limits: { max_proof_rounds: 2, max_handbacks: 2, lease_seconds: 900 }
```

**Evaluation.** Match every changed path against every rule (picomatch). The strictest lane wins (`decide` > `flag` > `auto`) and `require` lists are unioned. An approver must be in `from` and not in `Decision.ineligible`. Evidence from `producer: "agent"` never satisfies `require`.

---

## 6. State machines

**Thread** (`ThreadState`):

```
created ─► provisioning ─► working ⇄ idle
working ─(push refs/heads/ready)─► proving
proving ─ok, lane auto|flag─► queued
proving ─ok, lane decide──► awaiting_decision ─approve─► queued
                            awaiting_decision ─reject/send_back─► working
proving ─fail, rounds < max─► working (forge report logged)
proving ─fail, rounds = max─► blocked (escalation Decision)
queued ─► landing ─► landed (container destroyed, fork token revoked)
landing ─collision, handbacks < max─► rederiving ─► working
landing ─collision, handbacks = max─► blocked
any ─agent POSTs /agent/v1/blocked─► blocked     (honest exit; 42, 43)
any ─human─► abandoned
```

**Landing attempt** (one `LandWorkflow` instance, id = `attemptId`):

```
queued ─► leased ─► rebasing ─conflict─► handback
                    rebasing ─clean─► policy_recheck ─decision stale─► awaiting_decision (release)
                    policy_recheck ─ok─► retesting ─fail─► handback
                    retesting ─pass─► cas ─moved─► rebasing (≤3 times, then aborted)
                    cas ─ok─► noting ─► recorded ─► released
handback ─► released
lease expiry (alarm) ─► aborted ─► released
```

---

## 7. Flows and the landing algorithm

### 7.1 Agent turn (ThreadDO)

1. The constructor calls `setInactivityTimeout(1_800_000)`, because the value is lost when the DO restarts [23].
2. `runTurn` execs `claude --print … > /work/.forge/turn-N.jsonl 2>&1`. Output goes to a file, not a pipe, to avoid SIGPIPE [23].
3. An alarm every 60 s keeps the DO active (container activity does not count [23]), tails the file to SSE, and at the end checks `is_error` in the final `result` event, because Claude Code exits 0 on model failure [23].
4. The harness commits `checkpoint N` with trailers `Forge-Thread` and `Forge-Message: msg_…`, then pushes `HEAD:refs/heads/work`. If the agent created `/work/.forge/ready`, it also pushes `HEAD:refs/heads/ready`.

### 7.2 Proof (PushWorkflow, on `cf.artifacts.repo.pushed`)

```ts
run(ev, step):
  const { repo, ref, after } = parsePushEvent(ev)                      // [A5]
  if (repo === "app") return step.do("base-advanced", ...)            // Should
  if (!repo.startsWith("t-")) return
  const th = await step.do("load", () => db.threadByFork(repo))
  if (ref === "refs/heads/work") return step.do("claims", () => updateClaims(th, after))
  if (ref !== "refs/heads/ready") return
  const rev = await step.do("revision", () => db.newRevision(th.changeId, after))    // idempotent on sha
  const runner = env.RUNNER.get(env.RUNNER.idFromName(`v:${th.changeId}:${after}`))
  const prep  = await step.do("prepare", () => runner.prepare(th.forkRepo, after))      // clone, npm ci
  const tests = await step.do("tests",   () => runner.test())                            // vitest json
  const prev  = await step.do("preview", () => runner.preview(`p-${th.id.slice(-8)}-${after.slice(0,7)}`))
  const shots = await step.do("browser", () => captureScreens(env.BROWSER, prev.deploymentUrl, policyScreens))
  const ev    = await step.do("sign",    () => signAll([tests, prev, shots], {change, rev, after, base: prep.base}))
  const pol   = await step.do("policy",  () => evalPolicy(readPolicy("main"), prep.changedPaths, ev))
  if (!tests.pass || pol.missing.length) return step.do("fail", () => THREAD(th).proofFailed(ev))
  if (pol.lane === "decide") return step.do("decide", () => createDecision("land.approve", th, pol, ev))
  await step.do("enqueue", () => LANDER("app").enqueue(th.changeId, rev))
```

### 7.3 Landing (LanderDO + LandWorkflow)

`LanderDO` keeps three tables: `queue(attempt_id, change_id, rev, enq_at)`, `lease(attempt_id, base_sha, until, token_id)` and `head(sha)`.
- `enqueue()` inserts a row and, when there is no lease, calls `env.LAND_WF.create({id: attemptId, params})`.
- `acquire()` grants the lease only to the queue head. It sets `base` to `head.sha`, checked against `app.log({ref:"main",limit:1})`, mints the trunk token and calls `setAlarm(until)`.
- `release()` revokes the token and starts the next attempt.
- `alarm()` aborts expired leases. Alarms are at-least-once [23], so `release()` must be idempotent.

```ts
LandWorkflow.run({ changeId, rev, attemptId }, step):
  const L = LANDER("app")
  const lease = await step.do("lease", { retries: { limit: 120, delay: "5 seconds" } },
                              () => L.acquire(attemptId))                  // throws "busy" until head
  try {
    for (let cas = 0; cas < 3; cas++) {
      // 1. Rebase checkpoint chain onto main (lander container), compute line spans, squash.
      const r = await step.do(`rebase-${cas}`, () => L.rebase(attemptId, {
        fork: rev.forkRepo, sha: rev.headSha, base: lease.base }))
      //   git rebase --onto <base> <origBase> <sha>; blame spans (§9); git reset --soft <base>; git commit -F msg
      if (r.conflict) return await handBack("textual", r)
      // 2. Policy from CURRENT main; decision must still bind (tree / scope digest).
      const pol = evalPolicy(await readPolicy(lease.base), r.changedPaths, rev.evidence)
      if (pol.lane === "decide" && !decisionBinds(changeId, r.treeSha, r.scopeDigest))
        return await step.do("redecide", () => createDecision("land.approve", …))  // stale → new card
      // 3. Re-test EXACTLY the commit to be pushed (trunk + change): tested tree == landed tree.
      const t = await step.do(`retest-${cas}`, () => L.retest(attemptId, r.candidateSha))
      const ce = await step.do(`sign-combined-${cas}`, () => signEvidence("combined-tests", t, r))
      if (!t.pass) return await handBack("semantic", { ...r, report: t.tail })
      // 4. Compare-and-swap main from base to candidate.
      const c = await step.do(`cas-${cas}`, () => L.casPush(attemptId, lease.base, r.candidateSha))
      //   git push --force-with-lease=main:<base> origin <cand>:refs/heads/main  [A2]; verify via app.log()
      if (c.ok) {
        await step.do("note", () => L.pushNote(r.candidateSha, buildNote(…)))   // §9
        await step.do("record", () => recordLanding(…, r.spans, ce))         // D1 + ThreadDO.landed()
        await step.do("cleanup", () => cleanup(rev))   // wrangler preview delete --name …; revoke fork token
        return "landed"
      }
      lease.base = c.currentMain            // should never happen: Lander is the sole writer
    }
    return "aborted"
  } finally { await step.do("release", () => L.release(attemptId)) }

handBack(kind, r):
  const since   = db.landingsAfter(rev.baseSha)                         // newest first
  const overlap = since.filter(l => intersects(l.paths, r.conflictFiles ?? r.changedPaths))
  const winners = (overlap.length ? overlap : since).slice(0, 3)       // semantic: may share no path
  const packet: ConflictPacket = { v: 1, kind, loser, newBase: lease.base, instruction: "rederive",
    winners: winners.map(w => ({ …w, intent: db.intent(w), diff: L.show(w.landedSha, 48_000) })),
    failing: { conflictFiles: r.conflictFiles, testReportTail: r.report } }
  const h = await putContentAddressed(env.EVIDENCE, packet)
  db.bumpHandbacks(changeId)
  if (handbacks > limits.max_handbacks) return createDecision("conflict.escalate", …)  // both sponsors
  await THREAD(loser.threadId).handBack(h)
```

`ThreadDO.handBack(h)` does three things:
1. It logs the packet as a `forge` message, as fenced JSON (data, not instructions).
2. It resets the work tree to `newBase`.
3. It starts a turn: *"Your change collided with landed change chg_A (packet attached). Re-implement your intent on the new main, preserving chg_A's intent. Run tests. Touch `.forge/ready`."*

The result is a new revision with `cause:"handback"`, and it must earn evidence again (51).

**Decision binding.** `scopeDigest` is `git diff <base> <cand> -- <decide-lane paths> | git patch-id --stable`. A rebase that leaves the approved hunks byte-identical keeps the approval (42). Any other change marks the Decision `stale` and opens a new card.

**Throughput (said in the video).** A serial lane lands about (1 − p_e)/T. At T ≈ 2 min and p_e = 10%, that is about **27 per hour** [19]. Partitioned lanes plus test-impact analysis reach about 2,000/h at K = 100 [19].

---

## 8. Evidence schema and signing

Each item is an in-toto v1 Statement in a DSSE envelope, signed with the Worker secret `EVIDENCE_SIGNING_KEY` (Ed25519 [A6]). The public key is at `/.well-known/forge-evidence-key.json`.

```jsonc
{ "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "artifacts://forge-demo/t-thr123", "digest": { "gitCommit": "<sha>", "gitTree": "<tree>" } }],
  "predicateType": "https://forge.demo/evidence/v1",
  "predicate": {
    "kind": "screenshot", "changeId": "chg_…", "rev": 2, "threadId": "thr_…", "base": "<main sha>",
    "producer": { "role": "forge-runner", "runner": "RunnerDO:v:chg_…:<sha>", "image": "agent@sha256:…" },
    "result": { "pass": true, "summary": "2 routes captured" },
    "preview": { "name": "p-thr123-ab12cd3", "previewUrl": "https://p-…-shop.<sub>.workers.dev",
                 "deploymentUrl": "https://<deploymentId>-shop.<sub>.workers.dev", "deploymentId": "…" },
    "browser": { "sessionId": "…", "debugId": "ev-…", "recordingKey": null },
    "items": [{ "name": "cart.png", "mediaType": "image/png", "sha256": "…", "r2Key": "blob/<sha256>", "bytes": 81234 }],
    "isolation": { "durableObjects": "per-preview", "d1": "none", "serviceBindings": "none" } } }
```

1. **Hash.** Blobs go to R2 at `blob/<sha256>`, envelopes at `ev/<sha256(envelope)>`. Content addressing avoids the 1 write/s per key limit [23].
2. **Manifest.** The sorted `{kind, hash}` list for a revision is hashed into `evidenceManifest`, which goes into the trailer, the note and `Decision.binding`.
3. **Signing.** `sig = Ed25519(PAE("application/vnd.in-toto+json", payload))`, computed in the Worker after RunnerDO returns raw results. The key never enters a container.
4. **Verify.** `GET /api/evidence/:hash/verify` rechecks the hash, the signature and every item against R2, and drives the UI's "verified" badge.
5. **Agent-attached evidence** has `producer.role:"agent"`. It is advisory and policy ignores it, because agents fabricate checks (98 §14).
6. **Pinning.** Proof cites the deployment URL, never the moving preview URL [23]; [A1] gives the fallback. Screenshots stay in R2 because previews are evicted at 500 [23].

---

## 9. Git trailers, note, and blame → thread → message

**Landed commit.** The Lander squashes the rebased checkpoint chain into one commit:

```
Add discount badge to product card

Re-derived after collision with chg_01JA… (field rename price → amountCents).

Forge-Thread: thr_01JB7…
Forge-Change: chg_01JB8…
Forge-Revision: 2
Forge-Intent: int_01JB2…
Forge-Evidence: sha256:9f2c…e1
Forge-Policy: auto; rules=src/ui/**; base=4be1c0a
Forge-Decision: dec_01JB9…            (only when present)
Forge-Handback: chg_01JA4…/semantic   (only when present)
Forge-Sponsor: alice@demo.dev
Forge-Agent: claude-code@2.1.280 (<model id>)
```

`Forge-Change` is the stable change ID: it survives rebase and re-derivation, and evidence and decisions attach to (change, rev). Fork checkpoints carry `Forge-Thread` and `Forge-Message: msg_…`.

**Note** (≤ 2 KB) on `refs/notes/forge`: `git notes --ref=forge add -F note.json <landedSha> && git push origin refs/notes/forge`. Artifacts' git server supports notes; the binding does not [23].

```json
{"v":1,"thread":"thr_…","change":"chg_…","rev":2,"intent":"int_…","landing":"lnd_…",
 "evidence":"sha256:9f2c…","policy":{"lane":"auto","base":"4be1c0a","rules":["src/ui/**"]},
 "decisions":[],"handbacks":[{"from":"chg_01JA4…","kind":"semantic"}],
 "lines":"https://forge.<sub>.workers.dev/api/landings/lnd_…/lines"}
```

**Line spans.** Before squashing, the Lander runs `git blame --porcelain <base>..HEAD` on the changed files of the rebased chain. Each final line maps to a checkpoint and its `Forge-Message`, and contiguous runs go to D1 `line_spans` keyed by `landedSha`.

**Lookup** (`GET /api/blame?path&line`):
1. `LANDER.blame()` runs `git blame --porcelain -L n,n main -- path` in the warm clone, giving `(commit, origLine)`.
2. `line_spans` maps that to `(thread, message)`.
3. `ThreadDO.getMessage()` returns the message and its checkpoint diff.

Plain git still shows the thread and evidence via `git log --show-notes=forge`.

---

## 10. API surface

**Agents** call `https://forge.internal/…`, intercepted into `AgentAPI`. The DO stamps thread identity [A8]; agents hold no tokens.

| Method | Path | Purpose |
|---|---|---|
| GET | `/agent/v1/context` | Thread, intent, policy for the claimed paths, other threads' overlapping claims (intent titles only) |
| PUT | `/agent/v1/claims` | `{paths}`. Advisory, never a lock (98 §08: locks cut 20 agents to 2–3) |
| GET | `/agent/v1/handback` | Latest ConflictPacket |
| GET | `/agent/v1/why?path&line` | Blame → thread → message, for asking an earlier thread |
| POST | `/agent/v1/blocked` | `{reason}`: honest exit to a human |
| git | push `HEAD:refs/heads/ready` on the fork | Submit for proof. This is the only "submit" verb |

**Humans** go through Access. Live updates use SSE, because Worker-level Access breaks WebSockets [23].

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/intents` | Create an intent `{title, body, acceptance[]}`; sponsor = caller |
| POST | `/api/intents/:id/threads` | Spawn N threads `{n, prompt?}`: fork, ThreadDO, container, first turn |
| GET | `/api/threads`, `/api/threads/:id`, `/api/threads/:id/events` (SSE) | Board, detail, live log |
| POST | `/api/threads/:id/messages` | Steer; adds the caller to `steeredBy` |
| GET | `/api/changes/:id` | Revisions, evidence, policy, landings |
| GET | `/api/evidence/:hash`, `/:hash/blob/:name`, `/:hash/verify` | Evidence and its signature check |
| GET | `/api/decisions?for=me`, `/api/decisions/:id` | Inbox and card |
| POST | `/api/decisions/:id/answer` | `{choice, note}`. **403 `approver_is_requester`** if the caller is in `ineligible`; **403 `not_in_group`** if the caller is not an approver. Approval enqueues the change with the Lander |
| GET | `/api/lander`, `/api/landings`, `/api/landings/:id/lines` | Queue, lease, history |
| GET | `/api/blame?path&line` | Line → landing → thread → message |
| Pages | `/`, `/t/:id`, `/d/:id`, `/l/:id`, `/blame/*path` | Board, thread, Decision card, landing timeline, blame view |

**Decision card (`/d/:id`)**, top to bottom:
1. Question and policy reason ("`src/billing/**` requires 1 of @payments").
2. Intent and change title.
3. Evidence tiles: tests with hash and verified badge, screenshot, deployment URL link, recording (Should).
4. Diff stat, with the full diff collapsed.
5. Approve, Reject, Send back with a note.

Ineligible viewers see disabled buttons with the reason. The server enforces the rule regardless of the UI.

---

## 11. Two-day build plan

P1 owns runtime: sandboxes, git, Lander. P2 owns evidence, policy, Decisions, UI. A solo builder follows the cut lines.

| When (PDT) | P1 | P2 | Gate |
|---|---|---|---|
| **Oct 12 eve** | Confirm Workers Paid, Artifacts, and **eligibility (US/Canada, 18+)** [23]. Namespace `forge-demo`; import `shop` as `app` | Scaffold `shop` (DO SQLite, vitest, 2 routes) and the forge Worker | MIT LICENSE committed |
| **Day 1 08–10** | Spikes A3, A2, A8, A13, plus a notes push | Spikes A1, A4, A6, A9, A14, plus a Browser Run screenshot | 10:00: fallbacks chosen (§14) |
| 10–13 | ThreadDO: container, Claude Code turn, keep-alive alarm, checkpoint push | D1 schema, R2, signer, PushWorkflow trigger [A5] | Agent commit appears on its fork |
| 13–16 | RunnerDO: prepare, test, preview | Policy evaluator, browser step, manifest | `ready` push yields signed evidence |
| 16–19 | LanderDO lease and queue; LandWorkflow rebase, retest, CAS, note | Board and thread pages (SSE) | — |
| 19–22 | Hand-back packet; re-derive turn | Decision card, answer endpoint, approver rule | — |
| 22–24 | **Integration:** one thread lands end to end | Evidence tiles, verify badge | **Cut line 1:** if nothing lands, drop Browser Run and claims |
| **Day 2 08–11** | Rehearse the semantic collision 3×, the textual one once; blame spans | Landing timeline, blame view | Collision works in ≥ 2 of 3 runs |
| 11–13 | Should items | Polish; `npm run demo:seed` | **Cut line 2 (13:00): freeze** |
| 13–15 | README, setup and teardown scripts | Pre-record slow agent turns as fallback footage | — |
| 15–20 | Record, edit to 8–9 min | Record, upload; **submit by 21:00 PDT** | About 3 h of buffer |

**Scope tiers.**
- **Must:** ThreadDO with sandbox and Claude Code; fork per thread; push-triggered proof; signed tests, preview and screenshot; `auto` and `decide` lanes; serial Lander with CAS; semantic hand-back; trailers and note; Decision card with approver ≠ requester; board and thread pages; commit-level blame.
- **Should:** message-level line spans; claim-overlap warnings; `flag`-lane `post.review` cards; decision carry-forward by scope digest; recording replay; base-advanced notices.
- **Could:** Flagship dark-launch for the `flag` lane (`env.FLAGS.getBooleanValue("thread-<id>", false, ctx)` [23]); revert-as-change; best-of-N compare; ask-the-thread; snapshot sleep and wake (beta [23]).

---

## 12. Demo script (8–9 min) mapped to the rubric

Rubric: originality and quality 50%, concurrency, coordination and conflict 25%, UX 25% [23]. The rules ban attacks on competitor products [23], so keep the problem statement neutral.

| Time | Scene | What is on screen | Rubric |
|---|---|---|---|
| 0:00–0:45 | Problem | One sentence each on single-ref contention, agents not knowing about each other, and "proof the agent wrote about itself" | Originality |
| 0:45–2:00 | Intent "Shop v2" fans out to 3 threads | Board: 3 forks, 3 containers, live logs; claim-overlap warning if Should is built | Concurrency, UX |
| 2:00–3:30 | Thread A (rename `price` → `amountCents`) pushes `ready` | Tests, pinned deployment URL (click: the app runs), screenshot, hash, ✓ signature; lane `auto`; lease → CAS; trailers in `git log` | Originality, UX |
| 3:30–5:45 | **Collision.** Thread B (new `DiscountBadge.tsx` reading `price`) shares no file with A, so the rebase is clean | Timeline: clean rebase → combined re-test **fails** → hand-back packet with A's intent and diff → B re-derives on new `main` → rev 2 evidence → lands. Callout: "`main` never red; no hunk merging" | Conflict (25%), originality |
| 5:45–7:00 | Thread C touches `src/billing/**` | Decision card: Alice (requester) is refused; Carol approves in a second profile; lands with `Forge-Decision:` | Review, UX |
| 7:00–8:00 | Why | Blame a line of `DiscountBadge.tsx` → landing → thread B → exact message; then `git log --show-notes=forge` on a laptop clone | Context |
| 8:00–8:45 | What scales | Serial lane ≈ 27/h, 500-preview cap, one D1; next: partitioned lanes + test-impact analysis (≈ 2k/h at K = 100) [19] | Quality |

Seed `app` so the collision is deterministic. Keep a `scripted` agent mode behind the same harness as a fallback, and say on camera when footage is pre-recorded.

---

## 13. Platform gotchas and workarounds

| Gotcha | Workaround |
|---|---|
| **6 concurrent Workers Builds per account** [23] | No Builds for threads: `wrangler preview` runs in RunnerDO. Builds only for `main` → production |
| **No branch protection; repo-scoped `read`/`write` tokens** [23] | Fork per thread; trunk token minted per lease, held only by LanderDO |
| **Artifacts binding cannot write** (no commit, ref, merge, diff, notes) [23] | CLI git in the lander container does every write; binding does create, fork, tokens, `log`, `readFile` |
| **Previews reach production** via Workflows, Queue consumers, cron, routes, service bindings; D1/KV/R2 shared unless rebound [23] | Demo app uses DO SQLite only; evidence `isolation` block marks partial proof |
| **D1 not forkable**; Time Travel restores in place (29) | No D1 in the demo app; say so in the video |
| **Eligibility: US/Canada legal residents, 18+**; one entry; winner attends Oct 21 [23] | Verify before building; include LICENSE |
| Receive-pack v1 only; old-OID and `atomic` behaviour undocumented [23] | Spike [A2]. The LanderDO lease is the primary serializer |
| Deployment URL field undocumented; preview cap 500 with LRU eviction [23] | Unique preview name per run [A1]; screenshots in R2; `wrangler preview delete` on land |
| Container code isn't activity; timeout resets on DO restart; `start()` throws if running [23] | 60 s alarm; set timeout in constructor; check `running` |
| Claude Code exits 0 on model failure; pipes get SIGPIPE [23] | Read `is_error`; write output to a file |
| Worker-level Access breaks WebSockets [23] | SSE |
| Alarms are at-least-once [23] | Idempotent `release`/`landed`/`handBack` keyed by attempt ID or packet hash |
| Artifacts billing starts **Oct 14** [23] | Stay under the 10k included operations |

---

## 14. Assumptions to test (hour 0–2 spikes)

| ID | Assumption | Fallback if false |
|---|---|---|
| A1 | `wrangler preview --json` returns the deployment ID or URL | Unique `--name` per run, so the moving URL acts as pinned |
| A2 | Artifacts honours old-OID / `--force-with-lease` (test with two racing pushes) | The lease is the CAS; verify the push with `log()` |
| A3 | `interceptOutboundHttps` proxies git smart HTTP to Artifacts, including receive-pack | Short-TTL token in per-exec `env` only |
| A4 | Wrangler trusts `NODE_EXTRA_CA_CERTS` with `api.cloudflare.com` intercepted | Scoped token in the preview exec's env only, never the test exec's |
| A5 | The Workflow event carries repo, `ref` and `after` | Harness POSTs `/internal/pushed` after each push |
| A6 | WebCrypto Ed25519 in Workers | ECDSA P-256 |
| A7 | A multi-minute DO RPC on `exec` completes from a Workflow step | Done-file plus `step.sleep` polling |
| A8 | `ctx.exports.GitGateway({props:{threadId}})` gives per-container identity | Key on fork name in the URL; accept cross-fork risk (Lander lands only proved SHAs) |
| A9 | Browser Run recording is fetchable by session ID | Screenshots plus Playwright `trace.zip` |
| A10 | `ctx.access.getIdentity()` [23] works on the forge host | Two labelled demo users with signed cookies |
| A11 | The `durable_object` policy allows 6 concurrent instances (cap undocumented [23]) | One RunnerDO at a time via a semaphore |
| A12 | `npm ci --offline` works with `enableInternet:false` | Bake `node_modules` into the image |
| A13 | `fork()` becomes ready within seconds | Pre-create forks before recording |
| A14 | The `browser` binding key in `wrangler.jsonc` | Follow `wrangler types` |
