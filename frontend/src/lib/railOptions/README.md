# lib/railOptions — every option a profile's boards offer the rail

D720 §11 (#1874): a board's rail lists the options on that board that run a
model, so each option can get the models that fit its work (D764 PR 3, #2089).
Each file here is one profile's list. A row names the canvas board (`page`,
from `design/incoming/airail-every-page-data/canvas.json`), its `key`
(`<verb>:<object>`, unique on its page), the `label` the member sees, one of
the canvas's fourteen task `kind`s, its `handler` (`form`, `upload`, `draft`,
`transcribe` or `none`) and its `source` in the code.

| File | Profile |
| --- | --- |
| `founder.js` | Founder (D771, #2097). Its parity test is `frontend/test/railOptions_founder_d771.test.mjs`. |
| `investor.js` | Investor, the 27 boards I1–I27 (D772, #2098). Its parity test is `frontend/test/rail_options_investor_d772.test.mjs`. |
| `advisor.js` | Advisor (D773, #2099). Its parity test is `frontend/test/rail_options_d773.test.mjs`. |
| `partner.js` | Operating partner (D773, #2099). Its parity test is `frontend/test/rail_options_d773.test.mjs`. |
| `superAdmin.js` | Super Admin, the 37 boards H1–H37 (D775, #2101), with `SUPER_ADMIN_BOARDS`: each board's route, files and rail file, or why it has no rail yet. Its parity test is `frontend/test/rail_options_super_admin_d775.test.mjs`. |
| `admin.js` | Admin, the 39 boards S1–S39 with their routes and rails (D774, #2100). No control on them runs a model, so it has no option row; `ADMIN_QUIET_CONTROLS` names the uploads and the report and why. Its parity test is `frontend/test/rail_options_admin_d774.test.mjs`. |
| `index.js` | `railOptionFor(pageKey, { file, control })` (D772, #2098): the key and label a zone several profiles share names on the member's page, read from the four member inventories above. Its tests are in `frontend/test/rail_pages_investor_d772.test.mjs`. |

## Rules

- **The list follows the code.** Each profile's test reads the files its
  boards render: every draft band and model-running call found there must be a
  row, and every row's control must exist.
- **An option that runs no model is not a row:** a CRUD write, a client-side
  CSV export, a heuristic the Worker computes.
- **Nothing here calls the rail.** Each row's control calls `useRailOption`
  (D768, #2092) while the member has it open: a draft band through
  `ZoneDraft`'s `railOption` prop, set to the row's key. Each profile's
  rollout adds those calls one section at a time; its test is
  `frontend/test/rail_pages_investor_d772.test.mjs` for the investor.
- **A shared zone passes no literal key.** `AskZone`, `LibraryZone` and
  `DiligenceRoom` pass their own path and control to `railOptionFor`, so
  each profile keeps its own keys.
