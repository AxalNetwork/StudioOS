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
| `admin.js` | Admin, the 39 boards S1–S39 with their routes and rails (D774, #2100). No control on them runs a model, so it has no option row; `ADMIN_QUIET_CONTROLS` names the uploads and the report and why. Its parity test is `frontend/test/rail_options_admin_d774.test.mjs`. |

## Rules

- **The list follows the code.** Each profile's test reads the files its
  boards render: every draft band and model-running call found there must be a
  row, and every row's control must exist.
- **An option that runs no model is not a row:** a CRUD write, a client-side
  CSV export, a heuristic the Worker computes.
- **Nothing here calls the rail.** The `useRailOption` calls arrive with D768's
  page map (#2092), one PR per section.
