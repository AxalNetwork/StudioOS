# services/advisor — the advisor state machine

Drives the conversational profiling flow: which question to ask next, what to do
with the answer, and when to stop.

| File | What it does |
| --- | --- |
| `stateMachine.ts` | The core. `nextTurn` loads state, ranks candidates, marks the question asked, and fires hooks on answer. Held to **≥ 80% branch coverage** by `scripts/check-statemachine-coverage.mjs`. |
| `questionBank.ts` | Assembles the bank for a persona. |
| `questionIds.gen.ts` | Generated id constants — do not hand-edit. |
| `rerank.ts` | Orders the candidates. |
| `writeRouter.ts` | Routes an answer to the column that stores it. |
| `no_write_allowlist.json` | Answers that are deliberately not persisted. |
| `guardrails.ts` | What the model may not do. |
| `tools.ts` | Tool definitions for the model. |
| `aiClient.ts` | The model call. |
| `profilingModules.ts` | Module definitions. |
| `rollout.ts` | Staged rollout gating. |
| `banks.manifest.json` | The bank registry. |
| `banks/` | The per-persona question banks — see its README. |

## Two rules learned the hard way

- **A question already answered is never re-asked**, and a question asked but
  not yet answered is not repeated in the same session. Both are pinned by
  tests, because both failed.
- **`writeRouter` must name a real column.** It once routed three advisor
  answers to columns on a table that has never existed: the write threw, fell
  back to an untyped sidecar, reported `saved`, and the read returned nothing —
  so the advisor was asked the same three questions every session, forever.
  Migration 182 and `check-sqlite-columns` exist because of it.
