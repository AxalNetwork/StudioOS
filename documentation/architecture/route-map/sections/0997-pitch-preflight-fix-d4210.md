### Pitch preflight: Ask Eadwyn to suggest a fix (D4210, #4210)

- **Worker:** D899's card tools in `routes/deck_assist.ts`. Their `POST /api/decks/:id/cards/:card/assist/quote` and `…/assist` also take `{ tool: 'preflight_fix', finding: { check, block, title? }, block, text }`.
- **Checks:** text only, `overflow`, `density`, `font` and `placeholder`. Any other check, including `sources`, `contrast` and `image`, is 422 `fix_not_offered`, and nothing runs.
- **Run:** the quote gives the hold. The run is charged as `deck:shorten`, no more than the hold. It proposes a shorter text for that one block as one `ai_rail_proposals` row, and writes nothing to the deck. Out of tokens is 402.
- **Never proposed:** a reply that is not shorter, adds a figure or drops one is 422 and charged. A bound figure is `never_fill`.
- **Client:** `deckAssistApi.quote` and `run` take the body as it is. The panel wiring waits on the preflight panel (#3661).
