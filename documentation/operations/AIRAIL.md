# Eadwyn AI rail: models per page, adding a model, billing, consumption

The runbook for the Eadwyn AI rail on every page (D720, #1874). It answers
four questions:
- how a page gets its models;
- how to add a model when Cloudflare publishes one;
- how members are billed;
- where a member's consumption is shown.

Secret and variable names only. No value belongs in this file, in the repo, or
in an issue.

**A draft (D781 PR 1, #2106).** D720's tasks are landing one by one. Each
section says what is true on `main` today and what changes when the named task
lands. D781's closing PR rewrites it to what shipped.

| Part | Task | On `main`? |
| --- | --- | --- |
| Every Workers AI model in one catalogue (`services/ai/catalogue.ts`), priced in each unit | D760 (#2017) | no |
| Router shapes and `rail_<kind>` tasks | D761 (#2018) | no |
| Members pay the billed price (`AI_BILLING`, `AI_MARKUP`) | D762 (#2019) | no |
| Llama Guard 3 8B checks every run's input and output inside `run()` | D763 (#2020) | **yes** (#2058) |
| The model matrix (`railMatrix.json`, `GET /api/ai/rail`) | D764 (#2089) | no |
| The page map (`frontend/src/lib/railPages.js`) | D768 (#2092) | no |
| The rail draws the canvas, with the switch on every page | D769 (#2088) | no |
| Each board draws the rail with its page key | D771–D775 (#2097–#2101) | no |
| Each account's consumption, by page | D776 (#2093) | no |
| The every-page guard | D781 (#2106) | the ratchet, in this PR |

## 1. How a page gets its models

**Today.**
- **The router.** `ROUTE` in `cloudflare-worker/src/services/aiRouter.ts` names each task's primary model, its fallbacks and the alternates a member may pick. Prices come from `PRICE_USD_PER_1M_TOKENS` and the audio-minute tables beside it.
- **The rail.** `frontend/src/ui/railModels.js` maps the page's section and module to one of the canvas's fourteen kinds of work (`TASK_KIND`), and each kind to its suggested models (`SUGGESTED`).
  - A model is drawn only when the router carries it (`CANVAS_MODEL_IDS`).
  - "Default" is drawn only on the router's primary for the card's task, read from `GET /api/ai/pricing` (D400).
  - Off Validate, most pages fall back to `DEFAULT_JOBS`.
- **The member's choices.** The mode and the picks are stored per section in `ai_rail_preferences` (migration 465) through `/api/ai/rail-preferences`.

**After D764, D768 and D769.**
- **One page map.** `railPages.js` maps each route to its page key, `<Profile> · <Section>` or `<Profile> · <Section> · <Module>`, in the canvas's names. Boards that share a route have an alias row.
- **One matrix.** `scripts/build-rail-matrix.mjs` writes `cloudflare-worker/src/services/ai/railMatrix.json` from the canvas data and `scripts/lib/railMatrixOverrides.json`. A test holds the committed file equal to the script's output.
  - Each page key has one row, and its options have their own rows.
  - `models[0]` is the default.
- **The rail asks the Worker.** It reads `GET /api/ai/rail?page=<key>[&option=<key>]` for the page's or the open option's models, with the member's pick.
  - The tables in `railModels.js` retire.
- **The switch.** "Turn off AI assistance on this page" is on every page. The Worker refuses a run on a page the member turned off as `assist_off`. Saving is never refused.
- **The guard.** `frontend/test/airail_every_page_d781.test.mjs` fails on any canvas page that has no page-map entry, no matrix row or no switch, unless the page is on its list of pages still to fix. It also fails on a listed page that is already done.

## 2. Adding a model Cloudflare publishes

**Today.**
1. Add its price to `PRICE_USD_PER_1M_TOKENS`, or to the audio-minute tables, in `aiRouter.ts`. Use Cloudflare's published rate exactly.
2. Name it in `ROUTE`, as a primary, a fallback or an alternate, for the tasks it fits.
3. Give it a name and a line in `MODEL_COPY` (`railModels.js`). `ai_router_prices.test.mjs` and the rail's tests hold them together.

**After D760 and D764.**
1. **The catalogue.** Add one row to `cloudflare-worker/src/services/ai/catalogue.ts`:
   - id, name, kind, capabilities and context window;
   - status, and the paid-only and partner flags;
   - its raw unit prices as decimal strings, exactly as Cloudflare prints them;
   - its canvas group and its docs URL.

   A model is offered only when it is GA or partner and has a price.
2. **The matrix.** Name it in `scripts/lib/railMatrixOverrides.json` for the pages and options it fits, then run `node scripts/build-rail-matrix.mjs` and commit `railMatrix.json`.
   - The matrix test refuses a model the catalogue does not offer, or one that cannot do the option's work.
3. **Gated models.**
   - A partner model (Deepgram, Leonardo, Black Forest Labs) is offered only while `AI_PARTNER_MODELS = "on"`.
   - A paid-only model is demoted below the row's first non-paid model of the same shape until `AI_PAID_MODELS = "on"`.

   The owner sets both after accepting the terms and confirming Workers Paid.
4. **The deploy check.** `scripts/check-ai-catalogue-live.mjs` runs before the D1 migrations in the deploy workflow.
   - It fails the deploy only when a model is confirmed missing from the account's live list and the push changed `catalogue.ts` or `railMatrix.json`.
   - Everything else is a warning.

## 3. Billing

**Today.** Members pay Cloudflare's cost (D629).
- A run is quoted, held and settled from the router's price tables.
- The `admin` licence covers Admin and Super Admin runs.
- One dollar of top-up buys one dollar of AI use (D755, `AI_TOKEN_PACKS.md`).

**After D762.**
- **`AI_BILLING`** is a production variable that decides what members pay:
  - unset or `cost`: Cloudflare's cost, as today;
  - `charged`: cost × `AI_MARKUP`.
- **`AI_MARKUP = 1.25`** is written once, in `cloudflare-worker/src/services/ai/pricing.ts`.
- **One price everywhere.** The rail, `/api/ai/rates`, `/api/ai/pricing`, `/api/ai/catalogue`, the quote, the hold, the settlement and the receipts all use the billed figure. So the price drawn is the price charged.
- **Exceptions:** the `admin` licence always pays cost, and the organisation cap and the kill switch stay on cost.
- **Recorded:** `ai_usage_logs.est_cost_usd` stays Cloudflare's cost, beside the charge (`charged_microusd`).
- **When the owner sets `charged`,** `/plans-and-pricing` and the top-up doors add "Model prices are Cloudflare's published rates plus 25%." No copy mentions the 25% before that.

## 4. Where a member's consumption is shown

**Today.**
- **`/account/usage`** (D641, D642): the allowance and paid balance, the days, where it was spent, the models and the receipts. It reads `GET /api/ai-budget/me`, `GET /api/ai-budget/history` and `GET /api/ai/rates`.
- **The rail's Usage box:** the member's month and today, `GET /api/ai/me/spend`.
  - `?surface=<path>` narrows it to one page (D552).
- **HQ** (Super Admin):
  - **AI allowances,** `/admin/platform/allowances`: plan amounts and held runs.
  - **One member's ledger:** `GET /api/ai-budget/members/:userId`.

**After D776 (#2093).** Each account's consumption is shown by page and by option. The new run rows are `GET /api/ai-budget/runs`. On HQ › AI allowances, HQ reads how members are charged and the models offered (`GET /api/ai/catalogue/hq`), and one member's month and each run (`GET /api/ai-budget/members/:userId/runs`, logged on every read).
