# frontend/src/pages/raise/useoffunds — the Use of funds tool

The founder's Use of funds tool at `/raise/use-of-funds` (D1173, #2455). It is built to the owner's "Use of funds" canvas: `design/incoming/Raise Use Of Funds Page.dc.html` and `design/incoming/Use of funds · Boards.dc.html` (UF1–UF22).

| File | What it is |
|---|---|
| `UseOfFundsTool.jsx` | The tool's tab bar (`UseOfFundsTabBar`), Home's tab bar and blocks (`UseOfFundsHomeNav`, `UseOfFundsHome`), and its tab pages (`UseOfFundsTabPage`). D1177: Home, Allocation, Milestones and hires, Runway, Plan vs actual and History draw D1176's reads; D1178: Scenarios and the two pages under a tab (`sub`: Runway › Forecast, Scenarios compared). |
| `UseOfFundsParts.jsx` | D1177: the plan read (`usePlan`), the cards, tiles and source pills, the admin's banner, three small charts each with a table view, and the dialogs: Edit split, Add milestone, Where this plan is used and Choose the round size (all but Add milestone, a create that stays centred, are the shared `Sheet`, D1317). |
| `ScenariosForecast.jsx` | D1178 (#3105): Runway › Forecast (UF8) with Edit drivers (the shared `Sheet`, D1317), Scenarios (UF9) with New, Edit, Make this the base and Delete, Scenarios compared (UF10, UF11). |
| `UseOfFundsMovedRedirect.jsx` | D1178: lands the old financial model's addresses on Forecast with the venture and the moved notice. Its own file, so the redirect never loads the page. D1180: with `count`, it also counts a forward the address bar cannot (`/raise/capital?mode=workspace`, the retired Capital workspace's model tab). |
| `scenariosForecastModel.js` | Pure: D1178's addresses and moved notice, the ten drivers and their sources, the forecast's tiles, series and sensitivity, each scenario's card and body, and the comparison table. |
| `useOfFundsModel.js` | Pure: the addresses, the canvas's seven tabs, `isUseOfFundsTab`, the venture-only query, the forecast's link with the venture kept, and D1177's derivations: tiles, section rows, the split check, runway today against its candidates and the forecast, the ties, Needs you, plan vs actual and History. |

## Where the tool lives

The tool is the Use of funds module, not a page beside it.
- Home is CycleRoute's module page, which already draws the split card, the Categories records and Mercury's spend by category.
- The tab words (`/allocation`, `/milestones`, `/runway`, `/scenarios`, `/actuals`, `/history`) arrive on the module's record route, `/raise/:slug/:id`. CycleRoute draws `UseOfFundsTabPage` for them instead of a record (`isUseOfFundsTab`).
- A section's own page is still its key (`/product`, `/go-to-market`, …), and `/new` is still Edit split.
- Two pages sit under a tab and are routes of their own (D1178): `/runway/forecast` and `/scenarios/compare`. CycleRoute takes them as `uofSub`. No tab is a route.
- The old financial model's addresses, `/raise/capital/model` and `/build/financials`, land on Forecast with the venture and a moved notice.

## The rules for adding here

- **Every row comes from a mounted read.** A read that fails says so where its block would be. A value nobody recorded says "Not recorded", never 0.
- **Runway today is never the forecast.** The forecast is a model the founder sets. Runway today takes Mercury first, then a metrics snapshot.
- **Every forecast figure is Modelled.** No Capital score is drawn.
- **Eadwyn never fills an amount, a share, a runway or a driver.** It reads, explains and checks.
