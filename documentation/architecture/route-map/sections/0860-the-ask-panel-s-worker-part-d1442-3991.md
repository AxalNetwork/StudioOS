### The Ask panel's Worker part (D1442, #3991)

`routes/eadwyn.ts` and `routes/ai_rail_proposals.ts`; migration 694. Clients: `eadwynApi.quote` (`lib/api/eadwyn.js`) and `railProposalsApi.list({ page, run })` (`lib/api/railProposals.js`), read by the Ask panel's seam (`ui/askPanelAdapter.js`, D1443). **UPDATE 2026-11-07 (#4737):** `waiting` counts only the rows whose `rail_option` is a run chip, the cards the panel lists, so a page's form and module rows draw no "N waiting"; a `sessions:block` card is accepted on `/practice/sessions` (`POST /api/advisors/me/slots/block`, then `POST /api/ai/rail/proposals/:uid/decide`), never decided by the panel alone.

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/eadwyn/conversations/:uid/quote` | the conversation's member; not a support session, not an Explorer | `{ ai: true, hold_microusd, model, model_label }`, or `{ ai: false, reason, message }` when the run would be refused. Built by the same `askRunOptions` as `/ask` and priced by `quoteRun`: runs, holds and writes nothing. 400 `question_required`, 403 `support_session_refused` / `no_profile`, 404, 409 `company_changed`. |
| `POST /api/eadwyn/conversations`, `POST /api/eadwyn/conversations/:uid/ask` | as before | Now 403 `support_session_refused` for an impersonated token and 403 `no_profile` for an Explorer, before any read, run or hold. |
| `GET /api/ai/rail/proposals?page=&run=` | the caller | `page=<rail page>` as an alternative to `option=` (at least one, else 400 `option_or_page_required`); `run=<usage_log_id>` narrows to one run (400 `invalid_run`). The caller's rows only, newest first, at most 50. |

