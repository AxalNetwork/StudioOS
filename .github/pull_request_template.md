<!--
Thanks for sending a PR. Please fill in the sections below — the CI gates
(drift check, gitleaks, CodeQL) will block merge regardless, but the human
checklist catches the things linters can't.
-->

## What & why

<!-- One paragraph: what changes, why now, what user-visible behaviour shifts. -->

## Scope

- [ ] Production worker (`cloudflare-worker/`) — ⚠️ ships to axal.vc
- [ ] Frontend SPA (`frontend/`) — ⚠️ ships to Cloudflare Pages
- [ ] Replit-dev backend (`backend/`) — ✅ never deployed, dev only
- [ ] CI / infra (`.github/`, `wrangler.toml`, scripts)
- [ ] Docs only (`README.md`, `CLAUDE.md`, `replit.md`)

## API drift

- [ ] No new `/api/*` calls in `frontend/src/lib/api.js` **OR** all new calls
      are mounted on a worker route in `cloudflare-worker/src/index.ts`
- [ ] If a path is intentionally pending, added to `KNOWN_DRIFT_ALLOWLIST` in
      `scripts/check-api-drift.mjs` with a task id

## Security checklist

- [ ] No secrets / tokens / private keys added to the repo (gitleaks will
      catch most, but eyeball it too)
- [ ] No new `dangerouslySetInnerHTML` without a sanitiser
- [ ] Auth-changing routes still gate on `requireAuth` / `_check_project_*`
      access helpers
- [ ] Rate-limit bucket assigned for any new public endpoint

## Production readiness (worker changes only)

- [ ] D1 schema change? Migration file added under `cloudflare-worker/sql/`
- [ ] New `wrangler` secret? Documented in `PRODUCTION.md` § 4
- [ ] New binding (KV/R2/Queue/Vectorize)? Re-declared under
      `[env.production.*]` in `wrangler.toml` (Wrangler v2 doesn't inherit)

## Manual verification

<!-- Paste curl output, screenshot, or a list of the steps you ran locally. -->

## Rollback plan

<!-- One line. e.g. "wrangler rollback <prev-deploy-id>" or "git revert <sha>". -->
