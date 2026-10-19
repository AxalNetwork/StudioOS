# Eadwyn AI rail: models per page, adding a model, billing, consumption

The runbook for the Eadwyn AI rail on every page (D720, #1874). It answers
four questions:
- how a page gets its models;
- how to add a model when Cloudflare publishes one;
- how members are billed;
- where a member's consumption is shown.

Secret and variable names only. No value belongs in this file, in the repo, or
in an issue.

**What is on `main`** (D781 part 2, #2106). Each section below describes the
code as it is. What is still open is in the last table; D781's closing PR
brings this file up to it.

| Part | Task | On `main`? |
| --- | --- | --- |
| Every Workers AI model in one catalogue (`services/ai/catalogue.ts`), priced in each unit | D760 (#2017) | yes |
| Router shapes and `rail_<kind>` tasks | D761 (#2018) | yes |
| Each run records its charge beside its cost; HQ's token margin | D762 (#2019), PR 1 | yes |
| Members pay the billed price: `billingMode` reads `AI_BILLING` | D762 (#2019) | no |
| Llama Guard 3 8B checks every run's input and output inside `run()` | D763 (#2020) | yes |
| The model matrix (`railMatrix.json`, `GET /api/ai/rail`) | D764 (#2089) | yes |
| The run path records each run's page, option and record | D765 (#2090), D770 (#2095) | yes |
| The page map (`frontend/src/lib/railPages.js`) | D768 (#2092) | yes |
| The switch on every rail | D769 (#2088), PR 1 | yes |
| A member's consumption by page and option | D776 (#2093), PR 1 | yes |
| The every-page guard: three parts per canvas page, and the render check | D781 (#2106) | yes |

## 1. How a page gets its models

- **The page map.** `frontend/src/lib/railPages.js` (D768) gives every route its page key, `<Profile> · <Section>` or `<Profile> · <Section> · <Module>`, in the canvas's names. A second route that answers the same key has an alias row that says why. A canvas board with no route of its own is in `RAIL_BOARD_ALIASES`. `RailPageProvider` (`ui/railCrumbs.js`), at the app shell, reads the key from the route and gives it to every rail below it, and the rail's `<aside>` carries it as `data-page-key`.
- **The matrix.** `scripts/build-rail-matrix.mjs` writes `cloudflare-worker/src/services/ai/railMatrix.json` from the canvas data and `scripts/lib/railMatrixOverrides.json`. `cloudflare-worker/test/rail_matrix_d764.test.ts` holds the committed file equal to the script's output. Each page key has one row, its options have their own rows, and `models[0]` is the default.
- **The Worker's read.** `GET /api/ai/rail?page=<key>[&option=<key>]` answers a page's models with their prices, the member's pick and mode, and the billing mode. `PUT /api/ai/rail/pick` and `PUT /api/ai/rail/mode` store the pick and the switch. The contract is in `documentation/architecture/ROUTE_MAP.md`, "Eadwyn AI rail Worker contract".
- **What the rail draws today.** `WorkerRail.jsx` still draws its model cards from `frontend/src/ui/railModels.js` (`jobsFor`, `railSuggestions`), and stores picks and the mode through `/api/ai/rail-preferences`, keyed by its `workspace`. Moving the cards to `GET /api/ai/rail` is D769's (#2088).
- **The switch.** "Turn off AI assistance on this page" is drawn on every rail. A run on a page the member turned off is refused 403 `assist_off`, "AI assistance is off on this page." Saving is never refused.
- **The guards.**
  - `frontend/test/airail_every_page_d781.test.mjs` fails on any canvas page with no page-map key, no matrix row or no switch.
  - The six `frontend/test/airail_render_*_d781.test.mjs` files render the real App at every route in the page map, as a member of its profile. They fail on a route that does not draw exactly one rail with its page key, unless the route is listed in `RENDER_NOT_YET` (`frontend/test/_airailRender.mjs`). A listed route that passes must be deleted from the list, so the list only shrinks.

## 2. Adding a model Cloudflare publishes

1. **The catalogue.** Add one row to `cloudflare-worker/src/services/ai/catalogue.ts`:
   - id, name, kind, capabilities and context window;
   - status, and the `paid_only` and `partner` flags;
   - its raw unit prices as decimal strings, exactly as Cloudflare prints them, and their neuron figures;
   - its docs URL.

   A model is offered only when it is GA or partner and has a price. `cloudflare-worker/test/ai_catalogue_d760.test.mjs` pins every price to what was read.
2. **The router.** If a task runs it, name it in `ROUTE` (`cloudflare-worker/src/services/aiRouter.ts`) as a primary, a fallback or an alternate.
3. **The matrix.** Name it in `scripts/lib/railMatrixOverrides.json` for the pages and options it fits, run `node scripts/build-rail-matrix.mjs`, and commit `railMatrix.json`. The matrix test refuses a model the catalogue does not offer, or one that cannot do the option's work.
4. **The rail's card.** Until D769 moves the cards to the Worker's read, a model drawn on the rail also needs its name and line in `MODEL_COPY` (`frontend/src/ui/railModels.js`).
5. **Gated models.**
   - A partner model new to the platform (Deepgram, Leonardo, Black Forest Labs) is offered only while `AI_PARTNER_MODELS = "on"`.
   - A paid-only model is demoted below the row's first non-paid model of the same shape until `AI_PAID_MODELS = "on"`.

   The owner sets both after accepting the terms and confirming Workers Paid.

## 3. Billing

- **What a member pays.** `billingMode` (`cloudflare-worker/src/services/ai/pricing.ts`) decides whether a run settles at Cloudflare's cost or at the billed price, cost × `AI_MARKUP` (1.25). On `main` it answers `cost` whatever `AI_BILLING` says. D762's billing PR (#2019) makes it read the variable. `AI_BILLING = "charged"` is already set in both vars blocks of `wrangler.toml`, so that PR's deploy is when members start paying the billed price.
- **One price everywhere.** `/api/ai/rates`, `/api/ai/pricing`, `/api/ai/catalogue` and `/api/ai/rail` quote each model at `cost` and `billed` for the caller's licence, and `billing` says which one a run settles at.
- **Exceptions.** The `admin` licence always pays cost. The organisation cap, the KV spend buckets and the kill switch count Cloudflare's cost, because Cloudflare's bill is what they protect.
- **Recorded.** `ai_usage_logs.est_cost_usd` is what the run cost Cloudflare, and `charged_microusd` is what the member paid (migration 493). A run is paid from the member's allowance first, then their tokens, through D629's hold. One dollar of tokens buys one dollar of AI use (D755, `AI_TOKEN_PACKS.md`).
- **The allowance.** Today each licence's daily and monthly allowance comes from HQ › AI allowances (`ai_licence_caps`), then the `WORKERS_AI_BUDGET_USD_DAY` and `_MONTH` variables, then $5 a day and $50 a month (`AI_CAP_DEFAULTS`). D783 (#2124) replaces this: a plan includes 25% of its price as AI allowance each month, no plan means no allowance, and there is no daily cap.
- **The copy.** `/plans-and-pricing` says "Each run is paid from your AI allowance first, then from your tokens." under "How AI is priced". The owner's price sentence, "Model prices are Cloudflare's published rates plus 25%.", joins it once #2019 charges that price. D783's allowance lines come with #2124.

## 4. Where a member's consumption is shown

- **`/account/usage`** (D641, D642): the allowance and paid balance, the days, where it was spent, the models and the receipts. Its charged tab reads `GET /api/ai-budget/runs?group=option` (D776): the member's runs this month by page and by option, with what each was charged and how much of it came from the allowance and how much from tokens.
- **The rail's Usage box:** the member's allowance and balance, from `GET /api/ai-budget/me` and `GET /api/ai-budget/top-up`.
- **HQ** (Super Admin):
  - **AI allowances,** `/admin/platform/allowances`: plan amounts and held runs.
  - **One member's ledger:** `GET /api/ai-budget/members/:userId`.
  - **Revenue's token line:** the quarter's token spend, its share of Cloudflare's cost, and the margin (D762 §6).

## Still open

| Part | Task |
| --- | --- |
| Routes that do not yet draw one rail with their page key (`RENDER_NOT_YET`) | #2097–#2101, and the off-canvas pages |
| The rail draws its cards from `GET /api/ai/rail` | D769 (#2088) |
| `billingMode` reads `AI_BILLING`; the price sentence on `/plans-and-pricing` | D762 (#2019) |
| HQ › AI allowances: how members are charged, the models offered, one member's month | D776 (#2093), PR 2 |
| A plan's allowance is 25% of its price, and there is no daily cap | D783 (#2124) |
