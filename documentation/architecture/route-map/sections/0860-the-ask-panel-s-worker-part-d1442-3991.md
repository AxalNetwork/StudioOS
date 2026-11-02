### The Ask panel's Worker part (D1442, #3991)

`routes/eadwyn.ts` and `routes/ai_rail_proposals.ts`; migration 694. Clients: `eadwynApi.quote` (`lib/api/eadwyn.js`) and `railProposalsApi.list({ page, run })` (`lib/api/railProposals.js`), read by the Ask panel's seam (`ui/askPanelAdapter.js`, D1443) once it is on main.

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/eadwyn/conversations/:uid/quote` | the conversation's member; not a support session, not an Explorer | `{ ai: true, hold_microusd, model, model_label }`, or `{ ai: false, reason, message }` when the run would be refused. Built by the same `askRunOptions` as `/ask` and priced by `quoteRun`: runs, holds and writes nothing. 400 `question_required`, 403 `support_session_refused` / `no_profile`, 404, 409 `company_changed`. |
| `POST /api/eadwyn/conversations`, `POST /api/eadwyn/conversations/:uid/ask` | as before | Now 403 `support_session_refused` for an impersonated token and 403 `no_profile` for an Explorer, before any read, run or hold. |
| `GET /api/ai/rail/proposals?page=&run=` | the caller | `page=<rail page>` as an alternative to `option=` (at least one, else 400 `option_or_page_required`); `run=<usage_log_id>` narrows to one run (400 `invalid_run`). The caller's rows only, newest first, at most 50. |

