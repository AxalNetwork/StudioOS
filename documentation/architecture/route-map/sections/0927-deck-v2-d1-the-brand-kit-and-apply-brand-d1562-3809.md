### Deck v2 D1: the brand kit and Apply brand (D1562, #3809)

`routes/deck_brand_kit.ts`, mounted at `/api/decks` ahead of `decks` (its `mount` export). Rules in `services/decks/brandKit.ts` (fonts in `brandFonts.ts`); the store is `deck_brand_kits` (migration 737). Client: `lib/api/deckBrandKit.js` (`deckBrandKitApi.save`, `deckBrandKitApi.applyBrand`), used by the Brand kit sheet in `pages/raise/pitch/DeckSheets.jsx`.

| Route | Who | What it answers |
| --- | --- | --- |
| `PUT /api/decks/brand-kit?project_id=` | the venture's deck writers (`projectOwned`, write) | `{ project_id, deck: { fonts, palette, image_style, references, logo_uid, updated_at } }`. The kit is replaced whole; malformed parts are dropped. 422 `font_not_offered` for a font not in `BRAND_FONTS`; 422 `image_not_kept` (with `image_uid`) for a reference or logo that is not a kept deck image of this venture; 400; 403. |
| `POST /api/decks/:id/apply-brand` | the venture's deck writers | `{ deck, adjustments, one_undo_step: true }`: one new version with theme `brand`, the font pair, the logo corner and the art direction. Never a model, never a charge. 409 `no_brand_kit`; 409 `contrast`; 503 `unreadable` (the kit or the cards could not be read; nothing written); 403; 404. |
| `GET /api/decks/brand-kit?project_id=` (D898, `decks.ts`) | whoever may read the venture | now also `kit.deck` (the stored kit, or null), `font_options` and `pick` (the theme a one-click run applies first, with its reason, or null). |
