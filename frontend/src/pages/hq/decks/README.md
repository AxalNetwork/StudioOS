# pages/hq/decks — HQ › Decks (D4155, #4155)

The deck studio's admin screens, a Platform tab after Promo codes, from the
owner's canvas (`design/incoming/HQ Decks Page.dc.html`, boards HD1–HD6).

| File | What it is |
| --- | --- |
| `hqDecksModel.js` | The page's words and rules, pure: the tabs and `viewFor`, `BUILD` (K1–K5, #4188–#4192, each `live: false` until it lands; K4 is live), a report as an HD1 row, the resolve rule (an outcome and a note of at least 10 characters), the flag labels and scopes, and the sector × stage grid, and HD4b's template preview and Save and Reset rules. Tested by `frontend/test/hq_decks_d4155.test.mjs`. |
| `HqDecksPage.jsx` | HD1–HD5 at `/admin/platform/decks` and its sub-paths (HQ only). Live: the reports queue and Resolve (D1540), the feature flags read (D1509) and the default templates with the Super Admin's Change and Reset (D905, K4 #4191). Every other control is drawn disabled with the task that switches it on. |

## Rules

- **Every request needs a mounted Worker route.** The only new client is
  `lib/api/adminFeatureFlags.js`, read-only, over `GET /api/admin/feature-flags`.
- **No audited change the Worker does not record.** Every change on this page
  asks for a reason; until a route takes one (K2) its control stays off.
- **"Not recorded" is never 0, and people are never shown by email.**
- **Words live in the model.** Wiring a task changes no copy.
