# Distribution tabs

Grow's Distribution views live inside the existing cycle module. The shared
tab shell is #4484; each task adds its own tab here. No sidebar is copied.

| File | Purpose |
| --- | --- |
| `ChannelsTab.jsx` | D4486: venture channel readings, existing Add/Edit forms and Ask, read-only connection cards, settings confirmation and existing tool doors. |
| `channelsModel.js` | D4486: columns, category choices, independent state pills, UTC activity labels, safe settings actions and missing readings. |
# Distribution — the existing Grow module, with its own tabs (D4484)

The DS1–DS12 series is primary; MK fills its gaps. The licence-union sidebar,
app header, AIRail and footer stay with the app. No company switcher lives here.

| File | Purpose |
| --- | --- |
| `DistributionTabs.jsx` | Module header, New campaign, shared HeaderAsk and the nine accessible, horizontally scrolling tabs. The Inbox owner supplies a successfully read count; null means no badge. |
| `distributionModel.js` | Tab order, project-scoped paths and the budget-derived Ask state. Unknown budget data never means out of tokens. |
| `DistributionParts.jsx` | Cards, KPI, source chips, dot pills, Not recorded, a wrapper over AskProposal, notes, tables, progress, hold lines and loading/coming-soon states. These components make no reads or writes. |
| `distribution.css` | Scoped DS light/dark tokens, spacing and phone tab overflow. |

CycleRoute still owns the module page. Overview retains its channels table,
outreach draft, content calendar, update-ask replies, Mercury, Notion and tool
doors. Other tabs show Coming in this module soon until their tasks land.
A pending read uses LoadingSkeleton. No sample count or campaign is fabricated.

Routes are explicit in routes/growDistribution.jsx, including Campaigns/new
and Campaigns/:uid. No Distribution wildcard may shadow the existing Grow
record route. Campaign screens must use #4447/#4483's existing store, router
and grow client, with reads owned by their task; the shell reads no campaigns.
Proposals retain their host's decisions; nothing posts or sends on mount.
