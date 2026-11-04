# Distribution — the existing Grow module, with its own tabs (D4484)

The DS1–DS12 series is primary; MK fills its gaps. The licence-union sidebar,
app header, AIRail and footer stay with the app. No company switcher lives here.

| File | Purpose |
| --- | --- |
| `DistributionTabs.jsx` | Module header, New campaign, project-scoped Waiting Ask and the nine accessible, horizontally scrolling tabs. The Inbox owner supplies a successfully read count; null means no badge. |
| `distributionModel.js` | Tab order, project-scoped paths and the budget-derived Ask state. Unknown budget data never means out of tokens. |
| `DistributionParts.jsx` | Cards, KPI, source chips, dot pills, Not recorded, a wrapper over AskProposal, notes, tables, progress, hold lines and loading/coming-soon states. These components make no reads or writes. |
| `distribution.css` | Scoped DS light/dark tokens, spacing and phone tab overflow. |
| `CampaignsTab.jsx` | Campaign filters, attention rows and route-driven detail, over the existing campaign API (D4487). |
| `CampaignCard.jsx` | Recorded funnel, budget and linked-item counts, sorted by state (D4487). |
| `CampaignSheet.jsx` | The 480px detail with explicit Activate/Pause/Resume/End and Archive confirmations (D4487). |
| `NewCampaignPage.jsx` | Six full-page steps; Schedule saves a plan, never activates or publishes (D4487). |
| `CampaignSteps.jsx` | Goal, audience, channels, dates/budgets, manual assets and review; slots for #4488 and Prospects (D4487). |
| `campaignModel.js` | Pure labels, ordering, missing-value rules, amounts, validation and review rows (D4487). |
| `campaignPlan.js` | Manual campaign/linked-draft save with retained identifiers for partial retries (D4487). |
| `campaigns.css` | Responsive light/dark campaign layouts and 44px controls (D4487). |

CycleRoute still owns the module page. Overview retains its channels table,
outreach draft, content calendar, update-ask replies, Mercury, Notion and tool
doors. Other tabs show Coming in this module soon until their tasks land.
A pending read uses LoadingSkeleton. No sample count or campaign is fabricated.

Routes are explicit in routes/growDistribution.jsx, including Campaigns/new
and Campaigns/:uid. No Distribution wildcard may shadow the existing Grow
record route. Campaign screens must use #4447/#4483's existing store, router
and grow client, with reads owned by their task; the shell reads no campaigns.
Proposals retain their host's decisions; nothing posts or sends on mount.

| File | Purpose |
| --- | --- |
| `DistributionAskIntent.jsx` | Selected sources, quoted drafting and unsaved proposal preview (D4488). |
| `WaitingForYou.jsx` | Venture-scoped Waiting count, safe bulk and individual decisions (D4488). |
| `distributionAskModel.js` | Recorded hold/charge, labels and exact safe kinds (D4488). |
| `CampaignDraftAsk.jsx` | Assets Ask with explicit formats and ad placements (D4488). |
| `campaignAskModel.js` | Functional acceptance into local fields without changing manual money or dates (D4488). |
