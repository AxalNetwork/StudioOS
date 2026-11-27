# GVPN OS

**Global Venture Partner Network** operating system — the platform where founders, partners, LPs, and capital connect across borders. Includes **Spin-Out Lab**, a niche 30-day venture sprint product that takes a startup from intake → AI scoring → legal formation → fundraising → portfolio monitoring.

Internal codename: Axal StudioOS. Operated by **Axal VC Management LLC**
(Delaware). Brand and platform IP owned by **Axal VC Holdings LLC**
(Delaware). **Axal VC Spin-Out Lab Fund I LP** (Delaware) is managed by **Axal VC
GP LLC** (Delaware) — the GP signs no platform contracts and is not the
operating entity. See [`documentation/architecture/LEGAL_ENTITIES.md`](documentation/architecture/LEGAL_ENTITIES.md) for the
canonical entity map.

> **Architecture in one sentence:** The `studioos` Cloudflare Worker (`cloudflare-worker/`) serves both `axal.vc` and `app.axal.vc` as whole-host custom domains — the React SPA (`frontend/`, built into `docs/`) from its `[assets]` binding and the API at `/api/*` — with one build behind both hosts; D1 is the canonical user store; there is no Cloudflare Pages deployment any more (the mirror was retired on 2026-09-03); and the FastAPI in `backend/` exists only as a Replit dev convenience and is **never deployed**. Read [`CLAUDE.md`](./CLAUDE.md) before contributing. The `app.axal.vc` cutover runbook at [`documentation/architecture/MIGRATE_TO_CUSTOM_DOMAIN.md`](./documentation/architecture/MIGRATE_TO_CUSTOM_DOMAIN.md) is a dated record of the 2026-05 migration, not the current topology.

## Repo layout

| Path                | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `frontend/`         | React 19 + Vite 8 + Tailwind 4 SPA — built into `docs/`, served by the Worker on both hosts |
| `cloudflare-worker/`| **Production API** — Hono on Cloudflare Workers, D1, KV, R2, Queues, Vectorize, Durable Objects |
| `engineering-notifications/` | D5664: inactive independent GitHub metadata capture and reconciliation proposal. |
| `engineering-slack/` | D5665: inactive independent Slack batching and durable delivery proposal. |
| `backend/`          | FastAPI (Python) — **Replit-dev-only**, not deployed to production    |
| `attached_assets/`  | Design specs, screenshots, methodology docs, legal templates          |
| `docs/`             | Built frontend bundle (Vite output) — the Worker's `[assets]` directory; its `_headers` sets the static security headers |
| [LICENSE](./LICENSE) | The existing proprietary project notice, also stated below. |

## Local development on Replit

Two workflows are configured:

- **Backend API** — `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload`
- **Start application** — `cd frontend && npm run dev` (Vite on port 5000, proxies `/api` → 8000)

Required secret: `JWT_SECRET` (the dev backend fails fast at import time if unset).

Optional secrets: `GITHUB_ACCESS_TOKEN`, `GMAIL_*`, `STRIPE_*`, `SUMSUB_*` — see `documentation/architecture/PRODUCTION.md`.

## Deploy

See `documentation/architecture/PRODUCTION.md` for the production Cloudflare deploy checklist, secrets, and post-deploy steps. See [`CLAUDE.md`](./CLAUDE.md) for the architecture rules every PR must respect.

## Claude Code setup

Claude Code bills Anthropic API credits — **not** the Claude.ai
subscription, which is disabled at the org level for this account.

- **Replit / local shell**: add `ANTHROPIC_API_KEY` to Replit Secrets
  (lock icon → New secret), or export it. Verify with
  `bash scripts/check-anthropic-key.sh` (or `npm run claude:check`).
- **GitHub Actions**: `.github/workflows/claude-code.yml` runs on `@claude`
  mentions from owners, members and collaborators, and on manual dispatch.
  It stores no key: it exchanges the job's GitHub OIDC token for a
  short-lived Anthropic token through workload identity federation
  (D5530). Set the repository variables `CLAUDE_CODE_FEDERATION_RULE_ID`
  and `CLAUDE_CODE_ORGANIZATION_ID` (setup:
  `documentation/operations/CLAUDE_REVIEW.md` §4b). Its first step fails
  with a readable message if they are missing.

## License

Proprietary — platform IP owned by Axal VC Holdings LLC and licensed
to Axal VC Management LLC for operation.
| `agent-compute/` | D4557: separate default-off general compute host and bounded Container runtime. |
| `workspace-engine/` | D5566: separate default-off coding sandbox host (preview-only candidate), its container image and local image evidence. |

D5676: `cloudflare-archive-observer/` is the independent disabled metadata observer for `cloudflare-worker-tail/`; no raw archive body enters notification receipts.
