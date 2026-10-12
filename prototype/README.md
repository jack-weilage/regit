# Landing-layer prototype

This is a local proof of mechanism for the landing layer in `research/60-build-spec-landing-layer.md`. It shows that the forge can catch a collision that merges cleanly as text, hand it back to the losing thread with the winner's intent, and land only what the forge itself proved. It uses Python 3's standard library and the git CLI. It needs no network and no LLM: the agents are scripted patch functions.

```
python3 prototype/demo.py            # all scenes, narrated, in a temp dir (add --keep to inspect it)
python3 -m unittest discover prototype/tests
```

The demo takes about 4 s and the 10 tests about 13 s. `demo.py` exits non-zero if any invariant fails.

## What the demo shows

The target project is a tiny `shop` package (pricing, catalog, billing/invoice) with unittest tests. It is seeded as trunk in a local bare repo, `trunk.git`. Each thread is a `git clone` fork with an intent (title, body, claimed paths), a message log and a `ScriptedAgent`. Every agent step writes a checkpoint commit with `Forge-Thread:` and `Forge-Message:` trailers, and the agent submits by moving `refs/heads/ready` on its fork.

| Scene | What happens | Result |
|---|---|---|
| 1. Disjoint | `catalog.py` and `docs/discounts.md`, forked from the same base | Both land in lane `auto`. The second is rebased and re-tested on the combined state. |
| 2. Textual | Two threads add a discount code at the same spot in `pricing.py` | The first lands. The second fails to rebase. The Lander does not merge hunks: it builds a hand-back packet with the winner's intent and diff. The loser resets to the new main, re-applies its intent and proves itself again. It lands as rev 2 in lane `flag`, because it adds a test, and gets a `post.review` card. |
| 3. Headline (semantic) | Thread E renames `discount()` to `apply_code()`. Thread F adds `shop/promo.py`, which calls `discount()`. The two touch no common file, and each passes its tests alone. | E lands. F rebases cleanly, but the combined re-test fails with an ImportError. Main stays at E and is never red. The `semantic` packet goes back to F. F's re-derive function reads the rename from the winner's diff in the packet and rebuilds on `apply_code()`. F proves itself again and lands with `Forge-Handback: chg_…/semantic`. |
| 4. Decide | Carol changes `shop/billing/**` | First, the thread's own `git push origin HEAD:main` is rejected by the trunk hook. A Decision opens. Carol, the requester, gets `403 approver_is_requester`. Dana, who is not in `@payments`, gets `403 not_in_group`. Erin approves, and the change lands with `Forge-Decision: dec_…`. |
| Why | `why(path, line)` on main | The lookup runs `git blame` and resolves the line to its landing record, thread, intent and the exact agent message that wrote it, plus the `refs/notes/forge` note. |

Example summary from a run: 7 landings, 2 hand-backs (one textual, one semantic), 1 Decision, 11 test runs, 6 evidence reuses and 11 signed envelopes verified. All five invariant checks pass.

## Lander algorithm (`forge/lander.py`, `Lander.land`)

The Lander processes a serial queue, which stands in for the lease, and is the only holder of the trunk token. For each change it:

1. Rebases the thread's checkpoint chain onto current `main`. A conflict produces a hand-back with kind `textual`.
2. Evaluates `.forge/policy.yaml` read from the base, so a change cannot loosen its own gate. The strictest lane wins and `require` lists are unioned. A `decide`-lane approval must bind the rebased hunks, using `git patch-id` over the decide paths as the scope digest. Otherwise a fresh Decision opens.
3. Re-tests the exact tree that will land, in a clean temporary worktree. A failure produces a hand-back with kind `semantic`, and main is not touched.
4. Squashes the chain into one commit carrying the spec §9 trailers: `Forge-Thread`, `-Change`, `-Revision`, `-Intent`, `-Evidence`, `-Policy`, and when they apply, `-Decision`, `-Handback`, `-Sponsor` and `-Agent`. The commit's author is the agent and its committer is the Lander.
5. Runs a compare-and-swap: `git update-ref refs/heads/main <cand> <base>`. If main moved, it re-rebases and re-tests, up to 3 times.
6. Writes a JSON note to `refs/notes/forge`, the landing record, and line spans that map each introduced line to its `Forge-Message`.

**Evidence** (`forge/evidence.py`). Each record is an in-toto-style Statement (subject `gitTree`, command, result, producer `forge-runner`) in a DSSE-style envelope. It is signed with the Lander's HMAC key and stored content-addressed at `evidence/ev/<sha256>.json`. When a tree has already been proven, its evidence is reused after the signature and hash are re-verified. For example, when main has not moved, the combined state equals the thread's own tree. A revision's `Forge-Evidence` is the hash of its `{tests, combined-tests}` manifest.

## Mapping to Cloudflare (spec §2)

| Prototype | Cloudflare product in the spec |
|---|---|
| `trunk.git` (bare repo) and the `forks/t-<thread>` clones | Artifacts repo `app` and `app.fork("t-<id>")` |
| `pre-receive` hook plus a token file that only `Lander` holds | Artifacts tokens: the trunk `write` token is minted per lease and held only by LanderDO. The GitGateway allows receive-pack only on the caller's own fork. |
| `Thread` (message log, fork, agent turn) | ThreadDO (SQLite) plus a Container running Claude Code (Sandbox SDK) |
| `Forge.submit` (proof on push of `ready`) | PushWorkflow triggered by `cf.artifacts.repo.pushed`, plus RunnerDO |
| `Lander` (queue, rebase, re-test, CAS, note) | LanderDO (lease, queue, alarm) plus LandWorkflow steps; CLI git in the lander container |
| `run_suite` in a clean temp worktree | RunnerDO container with read-only interceptors |
| `EvidenceStore` (HMAC, `evidence/ev/<sha256>`) | Ed25519 DSSE signing in the Worker (`EVIDENCE_SIGNING_KEY`) and R2 `ev/<sha256>` |
| `index/*.json` (landings, line_spans, decisions) | D1 `forge-index` |
| `Forge.answer` raising `Forbidden` | `POST /api/decisions/:id/answer` behind Cloudflare Access (identity from `ctx.access.getIdentity()`) |
| `Forge.why` | `GET /api/blame?path&line` and `/agent/v1/why` |

## Limits (honest)

- **Agents are deterministic scripts.** "Re-derive from intent" is a hand-written function. One version re-applies the agent's own patch on the new base; the semantic one reads the rename out of the packet's diff. Nothing here measures how well a real LLM agent re-derives.
- **Serial, single-process Lander.** There are no leases with expiry, alarms, speculative batching, partitioned lanes or test-impact analysis. The CAS race is exercised only in a unit test, by a hook that moves main between the re-test and the CAS.
- **Stand-ins for security.** HMAC replaces Ed25519, so verifiers need the key. A shell hook plus a token in an environment variable stands in for token custody. The trunk's own process does `update-ref` directly. Nothing is sandboxed: the tests run as the local user.
- **Evidence covers tests only.** There are no previews, screenshots or recordings, so a policy rule that requires them reports them as `missing` and the change does not land. `flag`-lane `post.review` cards are only logged. When several decide rules match, their approver groups are unioned, not each required.
- **Partial policy parser.** It handles the YAML subset that the spec's policy file uses, not full YAML. Globs follow picomatch's `**`, `*` and `?` semantics only.
- **Line spans are per landing.** They are not maintained across later rewrites. Blame resolves to whichever commit last touched the line.
- **The demo runs in about 4 s** because the test suite is tiny. Real combined re-tests are where the throughput limit (about 27 landings per hour per serial lane at T ≈ 2 min, spec §7.3) comes from.
