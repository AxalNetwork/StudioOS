## Deck v2 B2 — image crop, focus and filters (D1534, #3778 phase 1)

pd27 "Image crop, focus and filters", reached from a selected image's toolbar and from pd4's lightbox. No new route: crop and filter are the image block's own fields, saved with the deck.

| Board | What | Backend |
| --- | --- | --- |
| pd27 | Crop: focus point, Zoom and move a window locked to the block's aspect; "Replace image keeps the crop." | The block's `crop` (`slideModel.ts` `cropOf`, `imageLook.ts`) |
| pd27 | Filters: Original, Warm, Cool, Mono, Soft, Vivid, Fade, Brand tint; "Coming later" (Erase, Expand, Vary, Remove background, Upscale) greyed | The block's `filter`; the same rule in the editor, print page (PDF, PowerPoint download) and editable PowerPoint |
| pd27, pd4 | Upload: "Alt text is needed before this image can be inserted"; a flagged upload says so | `POST /api/decks/:id/images/upload` and `/import`: 422 `alt_required`; `image.screen` |
