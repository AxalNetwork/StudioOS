# Distribution — the existing Grow module, with its own tabs (D4484)

The DS1–DS12 series is primary; MK fills its gaps. The licence-union sidebar,
app header, AIRail and footer stay with the app. No company switcher lives here.
Campaign drafting (D4488) uses the shared Ask panel and D780 proposals. The
campaign wizard owns its manual fields and Save action; the Ask components
return accepted proposals without saving campaign fields, sending messages or
starting ads.

| File | Purpose |
| --- | --- |
| `DistributionTabs.jsx` | Module header, New campaign, shared HeaderAsk and the nine accessible, horizontally scrolling tabs. The Inbox owner supplies a successfully read count; null means no badge. |
| `distributionModel.js` | Tab order, project-scoped paths and the budget-derived Ask state. Unknown budget data never means out of tokens. |
| `DistributionParts.jsx` | Cards, KPI, source chips, dot pills, Not recorded, a wrapper over AskProposal, notes, tables, progress, hold lines and loading/coming-soon states. These components make no reads or writes. |
| `distribution.css` | Scoped DS light/dark tokens, spacing and phone tab overflow. |
| `DistributionAskIntent.jsx` | D4488: sources, quote before run, proposal preview and local form acceptance. |
| `WaitingForYou.jsx` | D4488: venture-scoped header count, loading/empty/error states and individual or safe bulk decisions. |
| `distributionAskModel.js` | D4488: labels, actual listed counts, exact safe kinds and recorded hold/charge copy. |
| `InboxTab.jsx` | D4494: scoped reply threads, personal unread read, Needs-you row and the composer; only final confirmation sends. |
| `inboxModel.js` | D4494: recorded reply labels, local proposal text, Calendar link and existing mail confirmation/send boundary. |
| `inbox.css` | D4494: DS8 thread columns, phone stacking and directional message bubbles using shared tokens. |
| `ChannelsTab.jsx` | D4486: venture channel readings, existing Add/Edit forms and Ask, read-only connection cards, settings confirmation and existing tool doors. |
| `channelsModel.js` | D4486: columns, category choices, independent state pills, UTC activity labels, safe settings actions and missing readings. |
| `AdsTab.jsx` | D4490: budget planner, spend gaps, platform availability and creative drafts; shell integration requested from #4484. |
| `adsModel.js` | D4490: slider amounts, totals and monthly chart gaps. |
| `ads.css` | D4490: responsive Ads columns using the Distribution tokens. |
| `CalendarTab.jsx` | D4489: month/week calendar and preserved plan dialogs. Plans only; publishing uses the existing PublishSheet, and Notion pieces are edited in Notion. |
| `PieceSheet.jsx` | D4489: plan details, time editing and explicit publishing entry. |
| `PostPreview.jsx` | D4489: unscaled platform frames. |
| `calendarModel.js` | D4489: Monday-first dates, overflow, status and platform widths. |

CycleRoute still owns the module page. Overview retains its channels table,
outreach draft, content calendar, update-ask replies, Mercury, Notion and tool
doors. Inbox is the D4494 tab. Channels is the D4486 tab on this shell. Calendar is the D4489 tab. Other
tabs show Coming in this module soon until their tasks land.
A pending read uses LoadingSkeleton. No sample count or campaign is fabricated.

Routes are explicit in routes/growDistribution.jsx, including Campaigns/new
and Campaigns/:uid. No Distribution wildcard may shadow the existing Grow
record route. Campaign screens must use #4447/#4483's existing store, router
and grow client, with reads owned by their task; the shell reads no campaigns.
Proposals retain their host's decisions; nothing posts or sends on mount.
