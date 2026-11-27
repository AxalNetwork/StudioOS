### Deck quality floor (D1517, #3769)

No new route. What changes on existing routes:
- `GET /api/decks/model` serves six themes in `themes`: `brand`, `neutral_light`, `neutral_dark`, `sand`, `ocean` and `forest`.
- A version's save accepts any of the six as `theme.kind`, and its refusal names the list.
- `POST /api/decks/new/quote` and the two build runs send each card's `headline_max_chars` and `body_max_chars` in their message.
- A built card's fit problems are fixed or dropped, never moved to the notes. `cards_unsound` 500 comes only from the slide model's own checks.
- The images plan (`deck_images.ts`, `imagePlan`) proposes art for any empty image area and names it in `areas`.
