# pages/hq/decks — HQ › Decks (D4155, #4155)

The deck studio's admin screens, a Platform tab after Promo codes, from the
owner's canvas (`design/incoming/HQ Decks Page.dc.html`, boards HD1–HD6).

| File | What it is |
| --- | --- |
| `hqDecksModel.js` | The page's words and rules, pure: the tabs and `viewFor`, `BUILD` (K1–K5, #4188–#4192, each `live: false` until it lands; all five are live), a report as an HD1 row, the resolve rule (an outcome and a note of at least 10 characters), the flag labels (the deck features by the reply's `labels`), scopes, reach and HD2b's change (`flagChange`, armed by a reason), the sector × stage grid with HD4b's template preview and Save and Reset rules, and HD5's norm rows, ranges and Add and Retire rules. Tested by `frontend/test/hq_decks_d4155.test.mjs`, `frontend/test/hq_decks_flags_4189.test.mjs` and `frontend/test/hq_decks_norms_4192.test.mjs`. |
| `HqDecksPage.jsx` | HD1–HD5 at `/admin/platform/decks` and its sub-paths (HQ only). Live: the reports queue and Resolve (D1540), the feature flags with each toggle's reason step (D1509, K2 #4189, client `lib/api/adminFeatureFlags.js`), the default templates with the Super Admin's Change and Reset (D905, K4 #4191), and HQ's stage norms with Add, Edit and Retire (K5 #4192, client `lib/api/hqDeckStageNorms.js`). Every other control is drawn disabled with the task that switches it on. |

## Rules

- **Every request needs a mounted Worker route.** `lib/api/adminFeatureFlags.js`
  reads and writes `/api/admin/feature-flags`; its `set` refuses a missing reason
  before anything is sent.
- **No audited change the Worker does not record.** Every change on this page
  asks for a reason, in the page, and nothing is written until Save; a control
  whose route takes no reason stays off (`BUILD[key].live`).
- **"Not recorded" is never 0, and people are never shown by email.**
- **Words live in the model.** Wiring a task changes no copy.
