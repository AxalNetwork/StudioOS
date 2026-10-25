# Cap table — the canvas against the code, 2026-10-24

S21's map for D1015 (#2432). The owner's "Cap table" canvas, CT1–CT24 with lettered boards (`design/incoming/Raise Cap Table Page.dc.html`, `Cap Table · Boards.dc.html`), read board by board against `origin/main` at `fd02f60e59`. True as of that date; re-check the code before acting on a line here.

Paths: `fe/` is `frontend/src/`, `wk/` is `cloudflare-worker/src/`.

## 1. What #2432 called broken, re-checked

| # | #2432's finding | Today | Where |
|---|---|---|---|
| 1 | A failed read can save sample numbers over the cap table | **Fixed** (#2645, `b4f4f52444`) | `fe/pages/CapTablePage.jsx` |
| 2 | Sample numbers drawn with no venture | **Fixed** (#2645, #2441 closed) | `CapTablePage.jsx` |
| 3 | Mercury's post-money SAFEs modelled as pre-money | **Fixed**: Accept passes `basis: 'post_money'` | `wk/services/mercury/raiseFeeds.ts` ~588; `wk/services/capTableWrites.ts` `safeEntry` ~401-416 |
| 4 | An outstanding SAFE gets nothing at an exit | **Fixed** (#2446) | `wk/services/captable.ts` header ~7-12 |
| 5 | The whole pool takes exit proceeds | **Fixed** (#2446): the unallocated pool does not participate | same |
| 6 | `PUT /:projectId/holders` deletes the register | **Fixed** (#2645, "prevent destructive holder replacement") | `wk/routes/captable.ts` |
| 7–10 | Any investor, Operating Partner or admin reads or rewrites any cap table; co-founders locked out | **Fixed** (#2651, #2436): investors refused, co-founders through `capRead`/`capWrite` from accepted membership | `wk/services/captableAccess.ts` |
| 11 | Pools and vesting per account, not per company | **Open** | `cap_table_option_pools`, `cap_table_vesting` (no `project_id`); `GET /equity-plan` |
| 12 | The CSV download skips the shared client | **Open** | `CapTablePage.jsx` |
| 13 | A missing amount prints "0" | **Open** | `CapTablePage.jsx` `fmtMoney` |
| — | "Model a round" opens the variants page with no venture | **Open** | `wk/services/records/raise.ts` ~709 |
| — | The Capital tabs drop the venture | **Open** | `fe/pages/CapitalWorkspacePage.jsx` ~57 |
| — | A new variant seeded with invented numbers; a blank pool saved as 0 | **Fixed**: "Record the cap table first", and a blank pool is left out | `fe/pages/CapTableVariantsPage.jsx` ~85, ~357-368 |
| — | Browser pop-ups on the old page | **Open**: two `confirm()` | `CapTablePage.jsx` ~306, ~382 |

## 2. The reads on `main`, and which board each serves

| Read | Gate | Shape | Boards |
|---|---|---|---|
| `GET /api/cycles/raise/modules/cap-table` | the module's | the Planned round card and the Holders records, both from the saved model's `inputs_json`/`result_json` (`wk/services/raiseCycle.ts` `loadCap`, `capTableCard`, `capRecords`); From Mercury | CT1 (as Overview today) |
| `GET /api/safe-issuances/project/:id` | `canAccessProject`, investors refused | `{ form, sendable, safes: [{ investor_name, amount_cents, valuation_cap_cents, discount: null, currency, status: { key, label } }] }` | CT3 (sent through StudioOS), CT10 later |
| `GET /api/captable/scenarios/by-project/:id/compare` | `canReadProject` | `{ canonical, variants }`, each `{ uid, name, inputs, result, updated_at }` | CT3 (the model's instruments and conversion lines), CT5 (the model's pool), CT6 (cards) |
| `GET /api/captable/409a/:projectId` | `ensureProjectReadAccess` | `{ ok, current, status: { state, reason, expires_on }, triggers }` | CT5's safe harbour |
| `GET /api/captable/equity-plan` | per **account** | pools, grants, vesting | **not drawn**: it mixes a founder's ventures (§1, 11) |
| `GET /api/captable/scenarios/:uid/shares`, `POST …/share` | per scenario | share links by audience | CT13 later |
| `GET /api/captable/scenarios/:uid/export.csv` | per scenario | the model's CSV | CT14 later |

## 3. On record against Modelled

The canvas never lets the two share a number without a tag. On `main`:
- **Nothing records what was issued.** The Holders list, the Planned round card, the Lab's copy and the deck all read the one canonical row of `cap_table_scenarios`, which is a model. Every figure they draw is **Modelled**.
- **One thing is on record:** a SAFE sent through StudioOS whose envelope is countersigned (`safe_issuances`, D578). Its discount is not stored (`discount: null`), and nothing writes it into the model.
- The Carta register (`cap_table_holders`, `cap_table_securities`) is per venture for holders and securities. Its pools and vesting are per account (§1, 11).

## 4. Board by board

| Board | Drawn by D1015 | Waits for |
|---|---|---|
| CT1 Overview | the module page as today, the tool's tab bar, and the Modelled line | the record (part 1), the class view, Needs you, the tiles and bars (part 5) |
| CT2 Holder drawer | today's record page at `/raise/cap-table/h-<n>` | part 5 |
| CT3 Instruments | SAFEs sent through StudioOS (On record when countersigned); the model's SAFEs and notes with basis, the pre-money check, interest, "Cannot convert", and the round's conversion lines (Modelled) | the convert-at card, the modelled columns, the chart and the over-100% notice (parts 3 and 6) |
| CT4 Instrument drawer | — | parts 3 and 6 |
| CT5 Option pool | the 409A in the Worker's words; the model's pool; "Grants and vesting: not read here yet" | per-venture pools and vesting (part 2), the burn-down (part 6) |
| CT6 Scenarios | the model ("Cap table · model") and each draft variant as cards, opening the simulator or the variant's page | the editor, multi-exit and top-up payer (parts 3 and 7) |
| CT7–CT9 Compared, dark, waterfall | — | parts 3 and 7, 11 |
| CT10 History | — (no tab) | part 1's history read, part 8 |
| CT11–CT12 Proposals, dialogs | — | parts 1 and 4, part 8 |
| CT13 Access | — (no tab) | part 4's grants, part 9 |
| CT14 Import and export | — (no tab) | part 4's export, part 9 |
| CT15 Investor view | — | part 10, with DEAL (#2421) |
| CT16–CT18 Co-founder, Advisor, OP, Admin | today's gates (#2651) | parts 4 and 9 |
| CT19–CT22, CT24 States | each read's own loading, unreadable and refused state | part 5 |
| CT23 Phone | CycleRoute's phone module page and `CycleBar` on each tab | part 11 |

## 5. Pins that move with the record

- `frontend/test/captable_equity_plan.test.mjs` (~153-160) fails if a discount or an MFN column appears. Part 1 stores them and updates that pin.
- `frontend/test/cap_table_variants_d632.test.mjs` pins the variants page that part 7 retires.
