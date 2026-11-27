### Deck v2 A14: share scoping for every Grid element (D1507, #3758)

- **No new route.** The share read (`decks.ts` `GET /api/decks/share/:token`) and the investor's grant read (`deck_grants.ts`) send every block through `services/decks/shareInclude.ts` `blockKept`, with the venture's recorded quote consents read by `shareGatesFor`.
- **Gates:** by the block's element (`ELEMENT_GATES`, every id of `elementModels.ELEMENTS`) or else its kind (`BLOCK_KIND_GATES`). Figures need `include.figures`; the team grid and bios `include.team_photos`; the cap table `include.cap_table`, then totals only; an interview quote its session's recorded consent; a logo wall or a HubSpot logo a recorded permission (none is recorded yet). Bank slots and internal scores never go out.
- **Share dialog:** `frontend/src/pages/raise/pitch/shareModel.js` adds two include rows, "Cap-table totals" and "Team photos", both off. `POST /api/decks/:id/share` accepts `include.cap_table` and `include.team_photos`.

