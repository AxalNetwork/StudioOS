# AI Workers Module

Edge AI primitives consumed by the job queue (`src/services/queueWorker.ts`).
Each function takes the `env` plus a typed payload, runs a Llama 3.1 8B
inference, and returns structured JSON. Since D765 (#2090) every job's model
call goes through `systemRun.ts`: the router's `system_job` route as `userId 0`,
so a job no member started is logged at cost and charged to no member (D720 §6).
`persona-router.ts` is a member's press (`POST /api/personas/classify`) and
still calls Workers AI directly until D766 converts it.

These run inside the main worker (no separate deploy needed) — keeping latency
low and avoiding service-binding overhead. They are written as pure modules so
they can later be lifted into a dedicated worker with zero refactor.

| File | Purpose |
| ---- | ------- |
| `systemRun.ts` | D765: the one model call the jobs share, as a system call through the router |
| `scoring.ts` | Deal-flow scoring across market / team / product / capital |
| `traction.ts` | Periodic traction review on metrics_snapshots |
| `equity.ts` | Spin-out equity allocation recommendation |
