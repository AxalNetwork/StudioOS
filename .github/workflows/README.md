# GitHub Actions workflows

One-line description and required secrets for every workflow in this
directory. Update this file whenever a workflow is added, removed, or
changes its secret requirements — it's the missing "what does this
workflow need to be green" doc that caused the all-red board in
Task #48.

| Workflow file | What it does | Triggers | Required repo secrets |
|---|---|---|---|
| `channel-worker-contracts.yml` | Focused D684 messaging, foundation and frontend reply contracts with mocked provider I/O; supplements the root build and full drift gate | PR to `main` touching channel Worker contracts | none (`contents: read`) |
| `round-call-worker-contracts.yml` | Focused D653/D686 round-call policy, real request/mutation and Raise history contracts with local SQLite and in-app fixture notices; supplements root build and full drift | PR to `main` touching round-call Worker contracts | none (`contents: read`) |
| `mcp-worker-contracts.yml` | Focused D666/D669 MCP OAuth, real local request/mutation and D681 deployment/branch-isolation contracts; supplements root build and full drift | PR to `main` touching MCP or deployment contracts | none (`contents: read`; local SQLite/KV fixtures) |
| `record-page-contracts.yml` | D696 renderer, action dispatch and persona export with mutation/restoration, static guards, root build then full drift with explicit exit code | PR to `main` touching record/persona contracts | none (`contents: read`) |
| `form-lightbox-contracts.yml` | D695 canonical/legacy form and responsive page contracts with modal effects and mutation/restoration; guards, root build then full drift | PR to `main` touching form/lightbox contracts | none (`contents: read`) |
| `release-draft.yml` | Maintains daily drafts from the complete first-parent history of main; active month totals, monthly zero-based week (0–4) and active day (1–31) counters, UTC. Published daily tags/releases stay fixed; missing days are backfilled and only matching drafts refresh | push to `main`; manual dispatch | none (`GITHUB_TOKEN` with `contents: write`) |
| `release-published.yml` | When the owner publishes a release, dispatches `cloudflare-worker-deploy.yml` on `main`, so the build picks up the new tag and the version beside the logo shows it; never deploys the tag's own commit | release published | none (`GITHUB_TOKEN` with `actions: write`) |
| `meeting-bot-image.yml` | D886 B8 (#2586): tests the meeting-bot image helper and builds the scratch fixture, plus B2's real image once its Dockerfile exists, without publishing; an owner-triggered run on `main` publishes to GHCR (see "Meeting bot image skeleton" below) | PR to `main` touching the meeting bot or its helper; manual dispatch | none (`GITHUB_TOKEN` with `packages: write` on the manual run only) |
| `ci.yml` | Frontend build, worker typecheck, API↔Worker drift, dev-backend import smoke, npm + pip audits | push/PR to `main` | none (uses `GITHUB_TOKEN` only) |
| `meeting-worker-contracts.yml` | Mocked meeting reliability, mutation/restoration and hosted-attach contracts, alongside the full drift gate | PR to `main` touching meeting Worker code or tests | none (`contents: read`) |
| `build-worker-contracts.yml` | Focused D686 connector, Workspace mapping and local Wrangler D1 tests with mocked provider I/O; supplements the root build and full drift gate | PR to `main` touching the Build Worker contracts | none (`contents: read`; local scratch D1 only) |
| `claude-code.yml` | Runs the Claude Code GitHub Action against an `@claude` mention, or a manual dispatch carrying an optional one-shot `prompt`. Short-circuits with a readable error if its secret is missing rather than a generic 401 | `issue_comment` [created], `pull_request_review_comment` [created], `pull_request_review` [submitted], `issues` [opened, assigned], manual dispatch | `ANTHROPIC_API_KEY` (billed via the Anthropic API, not a Claude.ai subscription — the org has subscription access to Claude Code disabled) |
| `claude-review.yml` | **Advisory** pull-request review through the Anthropic Messages API, meant to replace GitHub Code Quality's AI findings and Copilot Autofix with a measured, capped spend (`documentation/operations/CLAUDE_REVIEW.md`). `selftest` runs the reviewer's tests on every PR with no secrets. `review` is **skipped until `vars.CLAUDE_REVIEW_ENABLED == 'true'`**, and skipped for forks and Dependabot. It runs the BASE commit's reviewer (`scripts/claude-review/review.mjs`) over the PR head checked out as data. It sends only the diff and bounded excerpts, validates the JSON answer against the diff, writes the job summary (findings, tokens, estimated cost), adds annotations only if `CLAUDE_REVIEW_ANNOTATIONS=true`, and records each review as an artifact whose name carries its month, cost and input key (the monthly budget and duplicate check read the artifact list). Not a required check; never approves, pushes or fails on a finding | PR to `main` [opened, reopened, synchronize, ready_for_review] | A credential: preferably workload identity federation, as the variables `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_WORKSPACE_ID` (runbook §4a: no stored key; the job's OIDC token is exchanged per run), else the secret `ANTHROPIC_API_KEY`. Either bills Console API credits, never a Claude subscription. Also the variable `ANTHROPIC_MODEL`; optional `ANTHROPIC_MODEL_HIGH_RISK` and `CLAUDE_REVIEW_*` (runbook §3). `GITHUB_TOKEN` read-only (`contents`, `pull-requests`, `actions`) plus `id-token: write` |
| `codeql.yml` | CodeQL static analysis for TypeScript + Python. **Uploads to code scanning (D718)**, so its alerts are in the Security tab, where Copilot Autofix can propose fixes. `scripts/sarif-summary.py` also lists the findings in the job summary, for the agents that cannot read the code-scanning API. Findings never fail the job | push/PR to `main`, weekly cron | none. Keep the "Default setup" CodeQL toggled OFF in Settings → Code security & analysis (otherwise GitHub auto-runs a second "Code Quality: Push on main" CodeQL that conflicts). If uploads are refused (the repository private again, or code scanning off), turn Code Security on, or put back D672's `upload: never`. |
| `migration-immutability.yml` | Fails when a migration already on the base is edited, deleted, renamed or retyped — the runner never re-runs an applied file, so such an edit reaches only databases built from the files afterwards, and they then disagree with production. Eight applied migrations drifted this way before it existed (D269). Runs `scripts/migration-immutability-gate.mjs` against a pull request's base branch, and on a push to main against the commit main pointed at before the push, because six of the eight arrived by direct push. Its own workflow rather than a `ci.yml` job: `ci.yml` cancels an in-progress run on main when the next push lands, and a cancelled push's range would never be checked, so here only pull-request runs cancel. There is no bypass | push/PR to `main` | none (uses `GITHUB_TOKEN` only, `contents: read`) |
| `changelog-gate.yml` | Fails a pull request that edits `CHANGELOG.md`, unless it carries the `changelog` label. Task PRs never edit the file: every one that added an entry at the top conflicted with every other open PR on the same lines, so Session 1 writes it from merged PRs in its own labelled PR (AGENTS.md, "CHANGELOG.md is Session 1's"; the owner, 2026-10-19). Runs `scripts/changelog-gate.mjs` against the PR's own base branch, whatever it is, so a PR stacked on another PR is held to the same rule. `labeled` and `unlabeled` re-run it | every PR (opened, synchronize, reopened, labeled, unlabeled) | none (uses `GITHUB_TOKEN` only, `contents: read`) |
| `gitleaks.yml` | Full-history secret scan with project allowlist | push/PR to `main` | none. Uses the free OSS CLI, not the paid `gitleaks/gitleaks-action`. |
| `semgrep.yml` | Static analysis with public OSS rule packs (`p/default`, `p/security-audit`, `p/secrets`). **Findings do not fail this job** — the stripped SARIF is uploaded to code scanning (D718) and `scripts/sarif-summary.py` lists them in the job summary (D672), and ~40 stand. A scanner that could not run *does* fail it, and then nothing is reported, because a crashed semgrep still writes a resultless SARIF that would read as a clean scan (D170). Scanner pinned by digest; the rule packs are still fetched live | push/PR to `main`, weekly cron | none. To switch on Semgrep AppSec Platform integration (paid), set `SEMGREP_APP_TOKEN` and change `semgrep scan` to `semgrep ci`. |
| `backup-d1.yml` | Daily D1 export to R2 backup bucket | daily cron | `CLOUDFLARE_API_TOKEN` (scopes: **D1 export/read + R2 object write**), `CLOUDFLARE_ACCOUNT_ID`. Both must be **repository** secrets — these jobs declare no `environment:`, so environment-scoped secrets are invisible to them. |
| `dr-drill.yml` | Monthly disaster-recovery dry-run | monthly cron | same as `backup-d1.yml`. |
| `beta-readiness-reaudit.yml` | Monthly beta-readiness checklist re-audit | monthly cron | none. |
| `lfs-budget.yml` | Projects month-end Git LFS bandwidth from the account's shared-storage billing API and posts a Slack alert if the projection exceeds a threshold percent of the 250 GB plan | daily cron `0 9 * * *`, manual dispatch with an optional `budget_threshold_pct` (default `80`) | `GITHUB_TOKEN` (automatic, `contents: read`, used to read the billing API), `SLACK_OPS_WEBHOOK_URL` (alert only fires if set; its absence over threshold is a warning, not a failure). |
| `post-deploy-smoke.yml` | Live SPA smoke check — key routes on both Worker custom domains, `axal.vc` + `app.axal.vc`, return the rendered SPA shell (200 + `<div id="root">` + `/assets/*.js`) **with the static security headers `docs/_headers` sets** (HSTS, nosniff, `X-Frame-Options`, `Referrer-Policy`), not a blank page or JSON 404. This probe is the evidence a host updated, and its header checks are the live answer to `documentation/architecture/UNRESOLVED_ITEMS.md` U10. A second, warning-only step runs `scripts/check-ai-credits-live.mjs` (D755): the public plans-and-packs read and `/plans-and-pricing` | manual dispatch, 6-hourly cron | none (plain public HTTPS). |
| `magic-link-insert-probe.yml` | The magic-link question without a mailbox: request a link, then look in production D1. Three verdicts — `start_latency`, `token_row_written` and `mail_send_recorded`. The second is exactly where the outage died (the failing attempt wrote no row, so it never reached the INSERT that is `/magic/start`'s first act). The third reads `email_send_log`, which the `waitUntil` send writes before enqueueing and the queue consumer marks `sent` only once Gmail accepted the message — so a row stuck at `queued` is the silent-send failure, and **without this verdict the probe would pass on a login that answers 202 and delivers nothing**. It still does **not** prove the mail ARRIVED (acceptance is not an inbox, and it never follows the link), and says so in every report; `magic-link-probe.yml` remains the only check that can close #168. Cron `0 */4 * * *`, **deliberately 30 minutes offset** from that probe: both request a link for the same address, and if this one fired inside the mailbox probe's polling window the mailbox probe would accept THIS probe's email as its own and pass without proving its own mail arrived. Each run writes one row to production `magic_link_tokens` (expires in 15 min, never used) and sends one real email | manual dispatch, 4-hourly cron at :00 | `MAGIC_PROBE_EMAIL` — **the only new one**, and a real email is sent to it every run, so it must be an inbox you own (a `+alias` of the sending account is cheapest); plus `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, which **already exist** as repository secrets and need D1 read. Until `MAGIC_PROBE_EMAIL` is set the job fails COULD NOT RUN, which is distinct from a failing sign-in and says so. |
| `magic-link-probe.yml` | Live magic-link **round trip** against production: POST `/api/auth/magic/start`, read the link out of a real inbox, follow it, assert a sign-in. Three verdicts reported separately — `start_latency`, `mail_delivered`, `sign_in_completed` — because D74 moved the email send to `waitUntil`, so `/magic/start` can answer `202` in 200ms while the mail never arrives, and a single pass/fail would read that as healthy. **Only exit 0 is green: a failed round trip AND an unconfigured run both fail the job**, deliberately (`documentation/architecture/DECISIONS.md` D78) | manual dispatch, 4-hourly cron at :30 | `MAGIC_PROBE_EMAIL` (a **dedicated** test account on production — the probe signs in as it, so never a real person's address), `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (`gmail.readonly` suffices; these read the RECEIVING mailbox, and a `+alias` of the sending account delivers to that same inbox). Until all four are set the job fails with NOT CONFIGURED and task #168 stays unverified. |
| `cloudflare-worker-deploy.yml` | Builds the production SPA, applies pending D1 migrations through `scripts/migrate-d1.mjs`, then deploys the `studioos` Worker — the API plus its `[assets]` copy of `docs/` — that serves **both** `axal.vc` and `app.axal.vc` as whole-host Workers Custom Domains, on every push to `main`. The run's closing `Deployed studioos triggers: axal.vc (custom domain), app.axal.vc (custom domain)` line is what settles who serves the hosts; a run that fails before `wrangler deploy` leaves both hosts on the previous build | push to `main`, manual dispatch | `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit **and** D1:Edit), `CLOUDFLARE_ACCOUNT_ID` |
| `d1-migrate.yml` | Operator access to the same migration runner: `dry-run`, `adopt-and-baseline` (a foreign-shaped `schema_migrations` is renamed aside, then baselined), `verify-marked`, `apply` — every mode bracketed by a read-only plan. Against production by default; a `branch` code targets that subsidiary's database instead, generating its Worker config first (the config is gitignored, and `adopt-and-baseline` is refused for a branch). See `documentation/operations/DEPLOY.md` §1.2 and §4(d) | manual dispatch | `CLOUDFLARE_API_TOKEN` (D1:Edit), `CLOUDFLARE_ACCOUNT_ID` |
| `branch-provision.yml` | Makes a subsidiary exist (D109): creates its D1, KV, R2, queues and Vectorize index, writes `infra/branches/<code>.json`, generates and checks the branch Worker config, builds the database from the baseline, puts the secrets, seeds the licence principal, deploys `studioos-<code>` to `<code>.axal.vc`, smokes it, and opens the PR carrying HQ's `BRANCH_<CODE>` service binding. **Has never run** — it needs the widened Cloudflare token and `GITHUB_ACCESS_TOKEN` (`actions: write`) from `DECISIONS.md` D.11; the first run should use a throwaway code. Every dispatched value reaches the job as an env var and is charset-validated before use, and every wrangler call names the generated config so none can fall through to HQ's apex routes. See `documentation/operations/DEPLOY.md` §6 | manual dispatch | `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, KV, R2, Queues, Vectorize, Zone DNS — all :Edit), `CLOUDFLARE_ACCOUNT_ID`, `BRANCH_SECRET_BUNDLE` |
| `pr-preview.yml` | One Worker per pull request — `studioos-pr-<number>` on workers.dev — built from the PR's frontend and deployed from `wrangler.pr-preview.toml` (no bindings: the SPA build only, `/api/*` a 404, no production data in reach), its URL kept in one sticky comment; deleted when the PR closes. Its `login-e2e` job then runs `frontend/tests/e2e/google_popup_signin.spec.js` (D722, "Continue with Google" through Google's window on /login) against that preview in Playwright's Chromium; the spec stubs Google's script and every `/api/auth/google/*` route, so the job holds no secret. The same job runs `frontend/tests/e2e/integrations.spec.js` (D753, #1992: the Connectors hub, its filter menu, one connector's page and the 390px check), which stubs every `/api/*` call it makes. Same-repository PRs only, never Dependabot. Why not Workers preview URLs: none exist for a Worker that implements a Durable Object (`documentation/architecture/DECISIONS.md` D36) | PR opened / synchronize / reopened / closed | `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit — the deploy token already has it), `CLOUDFLARE_ACCOUNT_ID` |
| `copilot-setup-steps.yml` | Prepares a GitHub Copilot coding-agent session. GitHub runs its one job — which must be named `copilot-setup-steps` — before every session, and reads the file only from the default branch, so a change reaches Copilot after it merges. Its steps are ci.yml's `test:drift` job's: the same action pins, the same node, the same three installs in the same order. `frontend/test/copilot_setup_steps.test.mjs` fails when the two drift apart | before every Copilot session; manual dispatch; push/PR touching this file | none (the job only reads; Copilot is given its own token) |
| `labels-sync.yml` | Creates or updates every label `.github/labels.yml` declares, with `gh label create --force`: the four `state:*` labels, `needs-decision` and `slot:S01`–`slot:S26`, which the agents' task protocol in `AGENTS.md` runs on (D503). Every entry is checked before the first write, so a malformed one changes nothing. It **never deletes** a label: an entry taken out of the file leaves its label as it was. No third-party action — yq reads the file and gh writes the labels, both preinstalled on `ubuntu-latest`; the token and repository arrive through `env:`, and no `${{ }}` expression sits inside `run:` | push to `main` touching `.github/labels.yml`, manual dispatch | none (uses `GITHUB_TOKEN` only, `contents: read` + `issues: write`) |
| `research-import.yml` | Runs one research importer (`wikidata`, `sec-edgar`, `companies-house`), or fetches a short list of public pages (`urls`), on a GitHub-hosted runner, because the agents' sandboxes cannot reach those data hosts, and pushes what it wrote to a new branch, `data/<source>-<run id>`. It never writes to a database, never touches `main` and opens no pull request: the branch is reviewed like any other, and the deploy applies a migration only after its PR merges. It refuses a migration number already taken. Every dispatched value reaches the job as an env var and is checked before use, no `${{ }}` sits inside `run:`, and a URL's host must be on its `ALLOWED_HOSTS` list. A fetched page is kept as its text plus the links that may lead to its terms; a CSV is kept as it came; `fetch-log.txt` records each URL, its time and its outcome. Guarded by `frontend/test/research_import_workflow.test.mjs` | manual dispatch, or a `research-import` `repository_dispatch` event whose `client_payload` carries the same three fields: an agent whose GitHub access cannot start a workflow, as the Claude GitHub App cannot, can still send one, because it needs write access to the repository's contents only | none (uses `GITHUB_TOKEN` only, `contents: write` to push the branch) |

## When a workflow starts failing

1. Open the failing run in the GitHub UI **immediately** — the per-job
   log API only retains blobs for ~15 minutes; after that you only have
   the in-browser log view.
2. If the job died in 1-3 seconds with empty step logs, the cause is
   usually one of:
   - A required secret is missing from the repo settings (see table above).
   - The repo or org disabled GitHub Actions, or hit a billing/spending limit.
   - An "Allowed actions" policy blocks a referenced action.
   - The runner image is broken (rare, GitHub status page will say so).
3. If the job ran but a step failed, look at the first `##[error]` line.
4. **`backup-d1.yml` / `dr-drill.yml` — missing or wrong Cloudflare secret**
   The "Preflight — assert required secrets are set" step fails immediately
   with:
   ```
   Required repo secret(s) are missing or empty: CLOUDFLARE_API_TOKEN
   ```
   or (if the secret is set but wrangler still rejects it mid-run):
   ```
   ✘ [ERROR] In a non-interactive environment, it's necessary to set a
   CLOUDFLARE_API_TOKEN environment variable for wrangler to work.
   ```
   Fix: go to **Settings → Secrets and variables → Actions → New repository
   secret** and add/update both `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` as **repository** secrets (not environment-scoped —
   these jobs declare no `environment:`, so environment-scoped secrets are
   invisible). The token must have **D1 export/read + R2 object write** scopes;
   a `Workers Scripts: Edit`-only token is not sufficient.
5. For dependency-audit failures, run `npm audit --omit=dev --audit-level=critical`
   locally in `frontend/` or `cloudflare-worker/`, and
   `pip-audit -r requirements.txt` for Python.
6. For gitleaks failures, run `gitleaks detect --config=.gitleaks.toml --source=.`
   locally and either fix the leak or add it to the allowlist in
   `.gitleaks.toml`.

## Action version pinning policy

Every action is pinned to a **full commit SHA with a trailing `# vN`
comment**, regardless of publisher — `actions/checkout@3d3c42e5… # v7`,
`github/codeql-action/analyze@cdf488f5… # v4`. (This paragraph used to say
major-version tags for GitHub-published actions; that had not been the
practice here for some time.) The comment says which release the SHA is,
the SHA says what actually runs.

**Container images under `container:` follow the same rule, by digest plus
a trailing `# <version>` comment** — `mirror.gcr.io/semgrep/semgrep@sha256:34ab619b… #
1.176.1`. A moving tag is a floating ref: `:latest` is banned here for the
same reason `@main` is, and it had already changed a Semgrep finding count
with no repo change twice before it was pinned (D170). The registry may
change and the digest may not: Semgrep's image is pulled through
`mirror.gcr.io` because Docker Hub rate-limited the shared runners
(GOTCHAS.md, "Static analysis").

Do NOT use floating refs like `@main`, `:latest`, or unreleased majors
(e.g. `@v5` for `actions/checkout` doesn't exist as of 2026-05-21).

## Meeting bot image skeleton (#2586, D886 B8)

`meeting-bot-image.yml` tests the image helper and builds a clearly labelled
scratch fixture on relevant pull requests. When B2 supplies a Dockerfile it
also builds that real image without publishing. A missing runtime is not a
successful runtime build: only the fixture is certified until B2 lands.

An owner-triggered run on main builds the actual B2 image first, then uses
the job-scoped `GITHUB_TOKEN` with `packages: write` to publish to GHCR under
`ghcr.io/axalnetwork/studioos/meeting-bot:sha-<full-commit>`. The digest is
recorded in the job summary. PR jobs have read permission only and do not
log into a registry. No new registry credential is needed. The SHA tag is
a version label, not a claim that a mutable registry tag cannot be replaced;
future deployments must pin the published digest.

This is the independent pipeline part only. #2578 still owns the host,
instance measurements and creation of D886; #2580 owns the runtime image;
#2579 owns BotRuntime. Worker binding/config changes, start/stop/heartbeat,
and an image-build gate before migrations in **both** deploy paths wait for
those contracts. The current Worker deploy is deliberately not changed or
blocked by a missing bot image. Nothing here turns on meeting capture.

Sources read 22 October 2026:
[GitHub image publishing](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images),
[Docker build command](https://docs.docker.com/reference/cli/docker/buildx/build/).
