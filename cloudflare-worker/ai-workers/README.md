# AI Workers Module

Edge AI primitives consumed by the job queue (`src/services/queueWorker.ts`).
Each function takes the `env.AI` binding (Cloudflare Workers AI) plus a typed
payload, runs a Llama 3.1 8B inference, and returns structured JSON.

These run inside the main worker (no separate deploy needed) — keeping latency
low and avoiding service-binding overhead. They are written as pure modules so
they can later be lifted into a dedicated worker with zero refactor.

| File | Purpose |
| ---- | ------- |
| `scoring.ts` | Deal-flow scoring across market / team / product / capital |
| `traction.ts` | Periodic traction review on metrics_snapshots |
| `equity.ts` | Spin-out equity allocation recommendation |
