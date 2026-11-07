# Security control matrix and risk register — 2026-11-06 (#4571, Security S2)

- **Source:** `main` at `af28b98dbb72a3a09fced76e11c348f2b87308da` (2026-11-06T20:29Z), read on 2026-11-06.
- **Method:** this session read the repository only. It had no Cloudflare dashboard or API access and no GitHub settings access, so it did not read account, zone, Access, WAF, ruleset or secret settings.
- **What was NOT done:** no production IAM, secret, WAF, Access, D1, bucket, logging or deployment setting was read or changed. No customer object was read. Every test named here is synthetic.
- **This is a snapshot.** Like every file in this folder, it is not maintained after its date (see the folder README). Recheck a row against the code before acting on it.
- **Restricted material stays out.** The owner's second-pass audit (`d85951ca90`) keeps its detailed inventory, any credential-like value and any exploit detail out of this public repository. This file does the same. An exploitable finding goes to a private GitHub Security Advisory, never an issue, PR or this file.

**Status words**

| Word | Meaning |
| --- | --- |
| **VERIFIED (repo)** | The repository shows it, and a test named in the row holds it. |
| **OBSERVED (repo)** | The repository shows it, but no test holds it. |
| **UNVERIFIED** | It lives in a dashboard or setting this session could not read. That is not the same as secure: it is unknown. |

## 1. Control matrix

### 1.1 GitHub: Actions, repository and supply chain

| # | Control | Evidence | Status |
| --- | --- | --- | --- |
| G1 | Every third-party action pinned to a full commit SHA | 37 workflows, every `uses:` | **VERIFIED (repo)**, `workflow_security_4571` WF-1 |
| G2 | Container images pinned by digest | `semgrep.yml` is pinned; `ci.yml` and `deck-visual.yml` use a Playwright tag | **Finding SC-03**, WF-2 |
| G3 | Every workflow declares its token permissions; none is `write-all` | 36 at the top level; `deck-visual.yml` on its one job | **VERIFIED (repo)**, WF-3 |
| G4 | No `pull_request_target` or `workflow_run` (a fork's PR never gets secrets or a write token) | Triggers of all 37 workflows; `claude-review.yml` documents its choice of `pull_request` | **VERIFIED (repo)**, WF-4 |
| G5 | Outsider-written text never expanded inside `run:` or `script:` | `claude-review.yml` passes the PR body and branch through `env:` | **VERIFIED (repo)**, WF-5 |
| G6 | A comment-triggered workflow holding a write token says who may start it | `claude-code.yml`: `contents`, `issues`, `pull-requests` and `id-token: write`; its `if:` checks for `@claude` only | **Finding SC-02**, WF-6 |
| G7 | Repository rulesets, required checks, required reviews, who can push to `main` | The merge queue's required checks are documented (#4107, `merge_queue_ci_4107`). The settings themselves are not readable here. | **UNVERIFIED** |
| G8 | Deployment approval | `cloudflare-worker-deploy.yml` deploys on every push to `main`. It names no GitHub `environment:`, so no reviewer gate exists beyond what lands on `main`. | **OBSERVED (repo)**, SC-06 |
| G9 | Secret scope and rotation | Workflows read repository-level secrets (for example `CLOUDFLARE_API_TOKEN`, which the deploy and both magic-link probes use). Each token's scopes and rotation dates are not readable here. | **UNVERIFIED**, SC-07 |
| G10 | Code owners | `.github/CODEOWNERS` names the owner as the reviewer for everything, and notes that a security team does not exist yet | **OBSERVED (repo)** |
| G11 | Dependency updates | `.github/dependabot.yml`: weekly for actions, npm, bun and pip | **OBSERVED (repo)** |
| G12 | Scanners | CodeQL, Semgrep (image pinned by digest) and Gitleaks (`.gitleaksignore`, 268 lines) run on PRs. There are 7 `nosemgrep` suppressions in `src`. Recent results were not readable here. A scanner being present is not a zero-findings result. | **OBSERVED (repo)**; results **UNVERIFIED** |

### 1.2 Cloudflare: edge, identity and runtime

| # | Control | Evidence | Status |
| --- | --- | --- | --- |
| C1 | Account and zone IAM: members, roles, API tokens and their scopes | Not readable here | **UNVERIFIED** |
| C2 | WAF, bot and rate-limit rules at the edge | The audited insert-probe run (42271609418) was challenged at the edge (R2-09). The rules themselves were not read. | **UNVERIFIED** |
| C3 | Cloudflare Access on staff surfaces | The worker mounts `requireCfAccess()` on the KYC and KYB document routes only (`topology.ts` `CF_ACCESS_PATHS`). Production has the two settings unset (GOTCHAS (h)), so the middleware is a no-op there today. | **OBSERVED (repo)**; edge apps **UNVERIFIED**; SC-01, SC-05 |
| C4 | Application authorization behind Access | Every KYC and KYB document route runs `requireAdmin` itself. The middleware fails closed on a missing, foreign, wrong-audience or unverifiable assertion, and on an unreachable JWKS. | **VERIFIED (repo)**, `edge_and_download_controls_4571` B and C |
| C5 | Security headers, TLS and HSTS on the SPA | `frontend/public/_headers`, checked on every shell route by `scripts/check-spa-live.mjs` (CLAUDE.md, U10) | **VERIFIED (repo + smoke)**; TLS mode and minimum version **UNVERIFIED** |
| C6 | Observability retention | `wrangler.toml` `[observability]`: logs and traces persisted, invocation logs on, sampling 1. What a persisted invocation or trace record keeps of a request URL is not readable here. | **OBSERVED (repo)**; content **UNVERIFIED**; SC-04 (R2-01) |

### 1.3 Storage and data

| # | Control | Evidence | Status |
| --- | --- | --- | --- |
| S1 | R2 buckets private; bytes only through the Worker | `routes/files.ts` documents the bucket as private. Bucket public-access and custom-domain settings are not readable here. | **OBSERVED (repo)**; bucket settings **UNVERIFIED** |
| S2 | Signed downloads | `signedDownload.ts`:<br>• TTL clamped to 300 s;<br>• HMAC-signed;<br>• single-use through KV, failing closed on a KV error;<br>• one object per token;<br>• one generic 403 for every refusal. | **VERIFIED (repo)**, `edge_and_download_controls_4571` A1–A4; SC-08 |
| S3 | D1, KV, DO, Queue and Workflow binding scope; preview/production isolation | Bindings are declared per environment in `wrangler.toml` (production block, guarded by `check-wrangler-binding-parity`). Real isolation is #4566's. | **OBSERVED (repo)**; isolation **UNVERIFIED** |
| S4 | Backups and restore | `backup-d1.yml`, `dr-drill.yml` | **OBSERVED (repo)**; restore evidence is #4558 and #4591's |

### 1.4 Deployment and migrations

| # | Control | Evidence | Status |
| --- | --- | --- | --- |
| D1 | Migrations before deploy | The deploy job runs `scripts/migrate-d1.mjs --remote` before `wrangler deploy`. The runner is forward-only with a ledger and aborts loudly on the first failure. | **OBSERVED (repo)** (`migration-immutability`, deploy tests) |
| D2 | Concurrent deploys | `concurrency` with `cancel-in-progress: false`: a running deploy is never cancelled | **OBSERVED (repo)** |
| D3 | Rollback | There is no down-migration. A Worker rollback (`wrangler rollback`) runs old code against the new schema, which is safe only for additive migrations. | **OBSERVED (repo)**; SC-09; procedure in §3 |

## 2. Risk register

**Severity scale:** Low means defence in depth, with no unauthorised access shown. Medium means a control is absent or unverifiable on a path that matters. No High finding was found in the repository. Nothing here is a claim of compromise.

| ID | Severity | Asset | Finding | Preconditions and impact | Remediation (owner action marked) | Retest |
| --- | --- | --- | --- | --- | --- | --- |
| SC-01 | Low | KYC per-document route | `GET /api/kyc/admin/:userId/documents/:docId` serves document bytes but is not in `CF_ACCESS_PATHS`. Its sibling `/document` is. | Matters only once Access is configured: the route would then be RBAC-only while its sibling is double-gated. `requireAdmin` holds either way. | **Owner:** approve the route matrix (R2-02). Then add the mount **and** the Access-app path together (GOTCHAS (h): a worker mount without the app path returns 403 to every admin). | `edge_and_download_controls_4571` C1 fails until the list changes |
| SC-02 | Low | `claude-code.yml` | A comment containing `@claude` starts a job holding write tokens and a paid API key. The workflow does not check who commented; it relies on the action's own write-permission check. | Anyone can comment on a public repository. Each such comment runs a job and the key-check step, even if the action then declines. | Gate the job on `author_association` in OWNER, MEMBER or COLLABORATOR: a separate reviewed PR. | WF-6, with the file taken off `UNGATED_COMMENT_TRIGGERS` |
| SC-03 | Low | CI | The Playwright container in `ci.yml` and `deck-visual.yml` is pinned by tag, not digest. | A re-pushed tag changes CI's browser without a diff. CI runs with read tokens, so the effect is integrity of results, not access. | Pin `mcr.microsoft.com/playwright@sha256:…` with the tag as a comment, when baselines are next redrawn. | WF-2 |
| SC-04 | Medium (R2-01) | Platform logs and traces | Invocation logs and traces are persisted at full sampling. Whether a stored record keeps a request's query string is unverified. Token-bearing route families exist (the issue names them). | If query strings are kept, a reader of the logs could see short-lived tokens. Signed downloads carry the token in the path and are single-use with a 300 s TTL, which bounds that case. | **Owner:** inventory fields, retention and readers privately. Prove with synthetic markers in the #4566 preview. Then reviewed suppression or field-allowlist changes. | Preview evidence, not a unit test |
| SC-05 | Low | Access middleware | With one of the two settings unset, the middleware is a silent no-op, so production readiness cannot tell "not wanted" from "half-configured". | Today both are unset by decision (GOTCHAS (h)). | After SC-01's matrix, have production readiness refuse a half configuration on Access-required routes, with an explicit preview exemption. | B1 records today's behaviour |
| SC-06 | Medium | Deploy | No GitHub Environment gates production: whatever reaches `main` deploys, with repository-level secrets. | Depends on G7's rules (unverified). A workflow on `main` can read the deploy token. | **Owner:** decide on a `production` environment with required reviewers and environment-scoped secrets. Cost: a manual approval per deploy. | Settings read by the owner |
| SC-07 | Medium | Cloudflare API token | One repository secret serves the deploy (D1 write, Worker deploy) and the probes (D1 read). | A probe workflow holds a token broad enough to deploy, if its scope is what the deploy needs. | **Owner:** split into least-privilege tokens (a deploy token, and a D1-read token for probes), record each one's scopes and rotation date privately, and rotate the shared one. | Token list read by the owner |
| SC-08 | Low | Signed downloads | (a) The HMAC key falls back to `JWT_SECRET` when `KEK_R2` is unset, so one key serves two purposes. (b) Single-use needs the `TOKENS` binding; without it a token replays until it expires. (c) `/api/files/dl` does not check the audience. | (a) The messages differ in shape, and no cross-use was found. (b) Production binds `TOKENS` (`wrangler.toml`). (c) A token is still bound to one object. | Set `KEK_R2` (**owner**). Consider refusing to mint without `TOKENS` in production. | A1–A4 |
| SC-09 | Medium | Migrations and rollback | Forward-only migrations with no down path. A partial failure stops the deploy (good), but rolling back the Worker after a non-additive migration is unsafe. | Restore rehearsal is #4558 and #4591's. | §3 procedure. Review each migration for additivity (`migration-immutability` already guards edits to applied files). | Tabletop in the #4566 preview |

## 3. Migration and deploy tabletop (synthetic, for #4566's preview)

| Scenario | What happens today (repo) | Owner procedure |
| --- | --- | --- |
| A migration fails part-way | The runner aborts and names the file, and the deploy step does not run. D1 has no transactions across statements, so a multi-statement file can leave part of its change applied. | Read the ledger (`schema_migrations`) and the live schema. Fix forward with a new idempotent migration; never edit an applied file. |
| Migrations applied, then `wrangler deploy` fails | The old Worker serves the new schema. Additive migrations are safe; a drop or rename is not. | Re-run the deploy, which is idempotent. If it fails again, apply the fix forward. |
| Two pushes to `main` close together | `cancel-in-progress: false`, so the runs queue and the second applies only its own pending files. | None. Confirm in the run log. |
| Bad Worker release | `wrangler rollback` returns to the previous Worker version. The schema stays. | Roll back only if every migration since that version is additive. Otherwise fix forward. Then run the post-deploy smoke. |
| Restore | Out of scope here. | #4558 (backup and restore), #4591 (schema reproducibility). |

## 4. Owner-only checklist (no change was made by this ticket)

| Action | Permission | Cost | Recovery | Validation |
| --- | --- | --- | --- | --- |
| Approve the route-by-route Access matrix (SC-01, SC-05, R2-02) | Repo owner | Review time | None | C1 updated with the approved list |
| Split the Cloudflare API token, record scopes and rotation (SC-07) | Cloudflare account admin | None | Keep the old token until both workflows pass on the new ones, then revoke | One deploy and one probe run green on the new tokens |
| Add a `production` GitHub Environment with reviewers and scoped secrets (SC-06) | Repo admin | A manual approval per deploy | Remove the environment requirement | A deploy waits for approval |
| Set `KEK_R2` (SC-08a) | Cloudflare secret write | None | Unset it (tokens minted under the old key stop verifying within 5 min) | A signed download works after the change |
| Logs and traces inventory with synthetic markers (SC-04) | Cloudflare observability read, #4566 preview | Preview time | Not applicable | Markers absent from stored logs and traces |
| Authenticated synthetic probe journey (R2-09) | Owner-approved synthetic account | One email a run | Disable the workflow | `outcome:` reads VERIFIED_END_TO_END |

## 5. R2-09: what the probes now report

Both magic-link probes print one `outcome:` for every run (`scripts/lib/probeOutcome.mjs`):

| Outcome | Meaning |
| --- | --- |
| `EDGE_CHALLENGED` | The edge answered. |
| `APPLICATION_REFUSED` | The Worker refused. |
| `REFUSED_UNATTRIBUTED` | The response does not say who refused. |
| `APPLICATION_FAILED` | The request was accepted, then a check that ran failed. |
| `ACCEPTED_NOT_VERIFIED` | The insert probe's best result: it never sees the inbox or a session. |
| `VERIFIED_END_TO_END` | The mailbox probe only, when the link arrived and completed a sign-in. |

A skipped check never counts as a pass. The probes' exit codes are unchanged. Nothing in this change relaxes an edge rule or allows CI IP ranges.
