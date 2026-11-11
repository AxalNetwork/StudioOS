## HQ deck image takedown (D4375, #4375)

The deck Grid runbook (`documentation/operations/DECK_GRID.md` §4) found that HQ could not remove a reported or unlawful deck image. HQ now can. The Worker side is `routes/admin_deck_images.ts` and `services/decks/imageTakedown.ts`, on migration 202611040745 (`deck_images.taken_down_at`, `taken_down_by`, `taken_down_reason`). The screen is HQ › Decks › Reports at `/admin/platform/decks`: each image a report names has Take down image (`lib/api/deckReports.js` `takedownImage`).

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/admin/deck-images/:uid/takedown` | an HQ admin or Super Admin (`requireHqAdmin`); anyone else is 403 | Takes `{ reason }`, 10 to 1,000 characters (400 `reason_required` or `reason_too_long`). Deletes the R2 object, marks the row with the admin, the time and the reason, tells the venture's founders with the reason, and writes the admin audit row `deck_image_taken_down`. Answers `{ image: { uid, project_id, taken_down_at, reason, r2_deleted } }`. A second takedown is 409 `already_taken_down`; an unknown uid is 404. |
| `GET /api/decks/images/:uid/file` (changed) | anyone with the URL | For a taken-down image, a neutral 1600 × 900 PNG ("Image removed by Axal HQ"), `no-store`, `x-axal-image-state: taken-down`, never the removed bytes. Every card, version, draft, proposal and export that names the image draws it from this URL: the editor, Present, the PDF, and the PowerPoint, .odp and HTML files. |
| `GET /api/admin/deck-reports` (changed) | HQ admin | Each report gains `images: [{ uid, url, taken_down }]`: the images its result and its card name, at most 6. |

A taken-down image is no longer the founder's to keep, discard, edit or use as the art reference. Those routes answer 410 `image_taken_down`. Uploading the same bytes again is 409 `image_taken_down`. The image library leaves it out, and the daily sweep never removes its row.
