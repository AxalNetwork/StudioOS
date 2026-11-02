### Verdict (D693)

Verdict is Validate's seventh module (MV7). `GET /api/cycles/validate/overview` adds its card only for a viewer `canReadDecision` admits, and every Validate read sends `can_read_decisions`. `GET /api/cycles/validate/modules/verdict` is the Decisions table, and refuses a partner with 403 "Partners do not see decisions." before any read. `POST /api/cycles/validate/decisions?project=` (`cycle_verdict.ts`) records one decision, scoped to the venture or one hypothesis, withheld below five checked pieces of evidence. Each decision's record, activity, actions (add and close a commitment) and Record a decision's form-options are `services/records/verdict.ts`'s, gated by `canReadDecision` to read and `canWrite` to write. The summary CSV reads through the same `services/verdict.ts`. The old `GET|POST /api/founder/validate/decision/:pid` are removed (D704, #1666).

| Canvas | Live route | Component and Worker | Status |
| --- | --- | --- | --- |
| `Cycle Overview.dc.html` CO:542, CO:584, CO:610, CO:335, CO:368 (MV7) | `/validate/verdict` (a static line, its guard kept), `/validate/verdict/:id`, `/validate/verdict/new` · founder, admin | `pages/cycles/CycleRoute.jsx` (`slug="verdict"`), `adapters/validate.js`, `verdictForm.js`, `lib/decisionMemoPdf.js`; `cycle_validate.ts`, `cycle_verdict.ts`, `services/verdict.ts`, `services/records/verdict.ts` | CURRENT |

