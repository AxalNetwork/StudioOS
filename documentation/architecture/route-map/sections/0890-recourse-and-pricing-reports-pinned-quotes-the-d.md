### Recourse and pricing: reports, pinned quotes, the daily ceiling (D1540, #3791)

`routes/deck_reports.ts`, mounted at `/api/decks` beside `deck_quotes.ts` (before `decks`) and at `/api/admin/deck-reports`; stores `deck_proposal_reports` and `deck_run_quotes` (migration 733); the quote and ceiling rules in `services/decks/runQuotes.ts`. Client: `lib/api/deckReports.js` (`deckReportsApi`); the Report control on `AreaResults.jsx`'s proposal cards.

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/decks/proposals/:uid/report` `{ reason, note? }` | the member whose deck rail proposal it is; never a support session (403 `support_session_refused`) | 201 `{ report }`. `reason` is `wrong_figure`, `poor_writing`, `wrong_place`, `bad_image`, `unsafe` or `other`; `note` at most 280 characters. 409 `already_reported` (with `report`) on a second report; 404 `not_found` for any uid that is not the caller's deck proposal. Refunds nothing. |
| `GET /api/admin/deck-reports?status=open\|resolved\|all` | an HQ admin (`requireHqAdmin`; a branch is refused) | `{ reports: [...] }`, newest first, at most 200, each with the proposal's status and payload and the run's `charged_microusd` (null when not recorded). Audited. |
| `POST /api/admin/deck-reports/:uid/resolve` `{ outcome: addressed\|no_fault, note? }` | an HQ admin | `{ report }`; 409 `already_resolved`; 404 `not_found`. Audited. |

On existing routes: `POST /api/decks/new/quote` answers `quote_uid` and `pricing_version` for an outline or build quote (a card's quote is not pinned). `POST /api/decks/outline` and `/generate` take `quote_uid`: the run settles at no more than the quoted `hold_microusd` (`RunOptions.pinMicrousd`), and `cost.quote` says the quoted figure and both price versions; a quote that was used, lapsed (2 hours) or priced another run answers 409 `quote_stale` and runs nothing. With the owner's `DECK_DAILY_CEILING_MICROUSD` set, `/outline`, `/generate` and `/proposals/:id/regenerate-card` answer 429 `deck_ceiling_reached` ("Generation is paused for today. Manual editing still works.") before any hold when today's deck spend plus the run would pass it; unset, there is no ceiling.
