# pages/hq/decks — HQ › Decks (D4155, #4155)

The deck studio's admin screens, a Platform tab after Promo codes, from the
owner's canvas (`design/incoming/HQ Decks Page.dc.html`, boards HD1–HD6).

| File | What it is |
| --- | --- |
| `hqDecksModel.js` | The page's words and rules, pure: the tabs and `viewFor`, `BUILD` (K1–K5, #4188–#4192, each `live: false` until it lands; all five are live), a report as an HD1 row, the resolve rule (an outcome and a note of at least 10 characters), the flag labels (the deck features by the reply's `labels`), scopes, reach and HD2b's change (`flagChange`, armed by a reason), the sector × stage grid with HD4b's template preview and Save and Reset rules, HD5's norm rows, ranges and Add and Retire rules, and a report's images with the takedown rule (a reason of 10 to 1,000 characters, D4375). Tested by `frontend/test/hq_deck_image_takedown_4375.test.mjs`, `frontend/test/hq_decks_d4155.test.mjs`, `frontend/test/hq_decks_flags_4189.test.mjs` and `frontend/test/hq_decks_norms_4192.test.mjs`. |
| `HqDecksPage.jsx` | HD1–HD5 at `/admin/platform/decks` and its sub-paths (HQ only). Live: the reports queue and Resolve (D1540), the feature flags with each toggle's reason step (D1509, K2 #4189, client `lib/api/adminFeatureFlags.js`), the default templates with the Super Admin's Change and Reset (D905, K4 #4191), HQ's stage norms with Add, Edit and Retire (K5 #4192, client `lib/api/hqDeckStageNorms.js`), and Take down image on each image a report names (D4375, `deckReportsApi.takedownImage`). Every other control is drawn disabled with the task that switches it on. |
| `deckGridModel.js` | D1537 (#3786, deck v2 B10): the Grid health and Funnel tabs' words and figures, pure. Percents, dollars, seconds and hours, each Not recorded without a figure; the grid rows, the error-budget card, the KPI tiles, the quote bands and the accept rows. Tested by `frontend/test/hq_deck_grid_d1537.test.mjs`. |
| `DeckGridTab.jsx` | D1537: Grid health (`/admin/platform/decks/grid`, also opened from `/admin/ai/deck-grid`) and Funnel (`/admin/platform/decks/funnel`), on AI models' HQ admin pattern; no canvas draws them. Client `lib/api/adminDeckGrid.js`. |

## Rules

- **Every request needs a mounted Worker route.** `lib/api/adminFeatureFlags.js`
  reads and writes `/api/admin/feature-flags`; its `set` refuses a missing reason
  before anything is sent.
- **No audited change the Worker does not record.** Every change on this page
  asks for a reason, in the page, and nothing is written until Save; a control
  whose route takes no reason stays off (`BUILD[key].live`).
- **"Not recorded" is never 0, and people are never shown by email.**
- **Words live in the model.** Wiring a task changes no copy.
