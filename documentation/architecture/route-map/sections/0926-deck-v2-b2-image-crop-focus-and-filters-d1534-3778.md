## Deck v2 B2 — image crop, focus and filters (D1534, #3778 phase 1)

pd27 "Image crop, focus and filters", reached from a selected image's toolbar and from pd4's lightbox. No new route: crop and filter are the image block's own fields, saved with the deck.

| Board | What | Backend |
| --- | --- | --- |
| pd27 | Crop: focus point, Zoom and move a window locked to the block's aspect; "Replace image keeps the crop." | The block's `crop` (`slideModel.ts` `cropOf`, `imageLook.ts`) |
| pd27 | Filters: Original, Warm, Cool, Mono, Soft, Vivid, Fade, Brand tint; "Coming later" (Erase, Expand, Vary, Remove background, Upscale) greyed | The block's `filter`; the same rule in the editor, print page (PDF, PowerPoint download) and editable PowerPoint |
| pd27, pd4 | Upload: "Alt text is needed before this image can be inserted"; a flagged upload says so | `POST /api/decks/:id/images/upload` and `/import`: 422 `alt_required`; `image.screen` |

### Phase 2: background removal through AI Gateway (D1534, #3778)

Bria RMBG 2.0 (`bria/remove-background`), off until `AI_PROVIDER_BRIA` is exactly `'on'` (the owner's steps on #1008). The result is a proposed child image (migration 766), kept or reverted as an edit's is. The client is `deckImageEditsApi` (`tools`, `liveTools`, `toolQuote`, `runTool`); `deckV2Adapter.imageEditAi` reads `liveTools`.

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/decks/images/tools` | signed in | `{ tools: [{ tool, on, model, model_label, usd_per_image, message }] }` for `remove_background` and `upscale` (Upscale has no model). |
| `POST /api/decks/images/:uid/tools/:tool/quote` | write access to the image's venture | `{ ai: true, tool, label, model, model_label, hold_microusd, balance }`, or `{ ai: false, reason, message }` when off. |
| `POST /api/decks/images/:uid/tools/:tool` | write access to the image's venture | `{ image, parent_uid, tool, cost }`: held, run once, settled at the quote. 503 `image_tool_off` / `image_tool_failed` (released); 402 for a ledger refusal (nothing held); 404 for another venture's image or an unknown tool. `Idempotency-Key` keys the hold. |
