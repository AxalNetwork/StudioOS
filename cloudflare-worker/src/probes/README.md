# cloudflare-worker/src/probes — throwaway Worker entries for hosted checks

A file here is the `main` of a **throwaway** Worker that a dispatch-only
workflow deploys to workers.dev, uses once and deletes. Production's `main` is
`src/index.ts`, which never imports anything from this folder, and no route,
cron or production config names a file here.

| File | What it is |
| --- | --- |
| `gatewayLiveCheck.ts` | D4870 part 2 (#4870): one synthetic call on `openai/gpt-5-mini` through the owner's AI Gateway, built as `aiProviders.ts` `callGateway` builds it, then that call's log entry read with `logCarriesNoPayload` and its cost. Deployed as `studioos-s4870-<run>` by `scripts/gateway-live-check.mjs`. |

## The rule for adding one

A probe answers on a preview Worker only (`ENVIRONMENT = "preview"`), behind a
per-run token, with states, counts and amounts: never a prompt, an answer, a
log head or a secret. Its driver writes a flat config (no `[env.*]`, no route,
no binding it does not need), refuses one that could reach production, and
deletes the Worker in `finally`.
