# Anthropic in dev/eval (Task #31)

As of Task #31, **production runs on Cloudflare Workers AI only**
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast` primary, `llama-3.1-8b`
fallback). Anthropic is gone from every production code path:

- `services/aiRouter.ts` exposes a single `provider: 'workers-ai'`
  contract. All routes (`publication`, `dd_synthesis`,
  `advisor_explain`, `advisor_turn`, …) call Workers AI.
- `routes/advisor.ts` `/explain` no longer has an unsafe-completion
  Anthropic retry. The SSE wire format is unchanged; `provider` events
  always report `workers-ai`.
- `services/publications.ts` headline synthesis runs on Workers AI.
  The methodology section of generated reports now credits "Cloudflare
  Workers AI (Llama 3.3 70B)" — no more claude-haiku.
- `routes/assistant.ts` (the dashboard personal chatbot) is the **only**
  remaining Anthropic caller. It is gated behind:
  - **Mount-time gate** (`src/index.ts`): the `/api/assistant/*` mount
    is fronted by a per-request middleware that returns `404 not_found`
    unless `STAGE !== 'production'` AND `ENABLE_ANTHROPIC_DEV === '1'`.
  - **Handler-level gate** (`anthropicDevAllowed()` in
    `routes/assistant.ts`): the `/message` handler re-checks the same
    invariant before touching the Anthropic API.

## Operator checklist (production cutover)

1. **Delete the production Anthropic secret** so a stray code path
   cannot regress to Anthropic without an explicit operator action:
   ```
   wrangler secret delete ANTHROPIC_API_KEY --env production
   ```
2. **Do not set `ENABLE_ANTHROPIC_DEV`** on the production worker.
   The mount gate will return 404 even if the secret is somehow
   re-introduced.
3. Verify with the CI guard:
   ```
   node scripts/ci/no-anthropic-in-prod.mjs
   ```
   Also runs automatically as part of `npm run test:drift` on every PR.

## Enabling Anthropic in dev / preview

1. `wrangler secret put ANTHROPIC_API_KEY --env dev` (or `preview`).
2. Add to `wrangler.toml` `[env.dev.vars]`:
   ```
   ENABLE_ANTHROPIC_DEV = "1"
   STAGE = "dev"
   ```
3. The `/api/assistant/*` routes will now mount and `/message` will
   stream Claude responses.

## Eval scripts

Long-form Anthropic eval / benchmark scripts belong under
`scripts/eval/`. They are not deployed to the worker bundle, never
import from `cloudflare-worker/src/`, and read `ANTHROPIC_API_KEY` from
the local environment. They are explicitly excluded from the
`no-anthropic-in-prod` CI guard (the guard only scans
`cloudflare-worker/src/**`).

When writing a new eval:

- Place it under `scripts/eval/<name>.mjs`.
- Refuse to run unless `process.env.ENABLE_ANTHROPIC_DEV === '1'`.
- Document the corpus, model, and expected pass criteria at the top
  of the file.

## CI guard contract

`scripts/ci/no-anthropic-in-prod.mjs` greps
`cloudflare-worker/src/**/*.ts` for `anthropic|claude-*|ANTHROPIC_API_KEY`
and fails the run unless the file is either:

- on the in-script `ALLOW_LIST`
  (`routes/assistant.ts`, `types.ts`, `index.ts` today), or
- carries the `// @anthropic-dev-only` marker comment.

Wired into `npm run test:drift` (which CI runs on every PR) and as a
dedicated step in the `drift` job of `.github/workflows/ci.yml`.

## Related

- [`SECURITY.md`](../../SECURITY.md) — scope statement for the Personal
  Advisor surface, including the production Workers-AI-only contract
  and the in-scope finding category for any bypass of the mount gate
  or the CI guard.
