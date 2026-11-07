# Distribution — the existing Grow module, with its own tabs (D4484)

The DS1–DS12 series is primary; MK fills its gaps. The licence-union sidebar,
app header, AIRail and footer stay with the app. No company switcher lives here.
Campaign drafting (D4488) uses the shared Ask panel and D780 proposals. The
campaign wizard owns its manual fields and Save action; the Ask components
return accepted proposals without saving campaign fields, sending messages or
starting ads.

| File | Purpose |
| --- | --- |
| `DistributionTabs.jsx` | Module header, New campaign, project-scoped Waiting Ask and the nine accessible, horizontally scrolling tabs. The Inbox owner supplies a successfully read count; null means no badge. |
| `distributionModel.js` | Tab order, project-scoped paths and the budget-derived Ask state. Unknown budget data never means out of tokens. |
| `DistributionParts.jsx` | Cards, KPI, source chips, dot pills, Not recorded, a wrapper over AskProposal, notes, tables, progress, hold lines and loading/coming-soon states. These components make no reads or writes. |
| `OverviewTab.jsx` | D4485: six KPI cards, campaign cards, ISO week, real connection status and writer-scoped update-ask replies; retains legacy tools below. |
| `overviewModel.js` | D4485: pure null-safe figures, source labels, campaign results and budget/week formatting. |
| `overview.css` | D4485: DS1 six-column/two-column desktop layout, responsive phone cards and scrolling week. |
| `distribution.css` | Scoped DS light/dark tokens, spacing and phone tab overflow. |
| `CampaignsTab.jsx` | Campaign filters, attention rows and route-driven detail, over the existing campaign API (D4487). |
| `CampaignCard.jsx` | Recorded funnel, budget and linked-item counts, sorted by state (D4487). |
| `CampaignSheet.jsx` | The 480px detail with explicit Activate/Pause/Resume/End and Archive confirmations (D4487). |
| `NewCampaignPage.jsx` | Six full-page steps; Schedule saves a plan, never activates or publishes (D4487). |
| `CampaignSteps.jsx` | Goal, audience, channels, dates/budgets, manual assets and review; slots for #4488 and Prospects (D4487). |
| `campaignModel.js` | Pure labels, ordering, missing-value rules, amounts, validation and review rows (D4487). |
| `campaignPlan.js` | Manual campaign/linked-draft save with retained identifiers for partial retries (D4487). |
| `campaigns.css` | Responsive light/dark campaign layouts and 44px controls (D4487). |
| `DistributionAskIntent.jsx` | D4488: sources, quote before run, proposal preview and local form acceptance. |
| `WaitingForYou.jsx` | D4488: venture-scoped header count, loading/empty/error states and individual or safe bulk decisions. |
| `distributionAskModel.js` | D4488: labels, actual listed counts, exact safe kinds and recorded hold/charge copy. |
| `InboxTab.jsx` | D4494: scoped reply threads, personal unread read, Needs-you row and the composer; only final confirmation sends. |
| `NewsletterTab.jsx` | D4495: the Newsletter tab's not-connected state only (Connect Beehiiv disabled, 'Not offered yet'; Opens, Clicks and Unsubscribes Not recorded); makes no request until the Beehiiv connector (#2407) exists. |
| `inboxModel.js` | D4494: recorded reply labels, local proposal text, Calendar link and existing mail confirmation/send boundary. |
| `inbox.css` | D4494: DS8 thread columns, phone stacking and directional message bubbles using shared tokens. |
| `ChannelsTab.jsx` | D4486: venture channel readings, existing Add/Edit forms and Ask, read-only connection cards, settings confirmation and existing tool doors. |
| `channelsModel.js` | D4486: columns, category choices, independent state pills, UTC activity labels, safe settings actions and missing readings. |
| `AdsTab.jsx` | D4490: budget planner, spend gaps, platform availability and creative drafts; mounted on the Ads tab by #4741, its own creatives Ask reusing #4488/#4512's quote/run/accept contract. |
| `adsModel.js` | D4490: slider amounts, totals and monthly chart gaps. |
| `ads.css` | D4490: responsive Ads columns using the Distribution tokens. |
| `CampaignDraftAsk.jsx` | Assets Ask with explicit formats and ad placements (D4488). |
| `campaignAskModel.js` | Functional acceptance into local fields without changing manual money or dates (D4488). |
| `CalendarTab.jsx` | D4489: month/week calendar and preserved plan dialogs. Plans only; publishing uses the existing PublishSheet, and Notion pieces are edited in Notion. |
| `PieceSheet.jsx` | D4489: plan details, time editing and explicit publishing entry. |
| `PostPreview.jsx` | D4489: unscaled platform frames. |
| `calendarModel.js` | D4489: Monday-first dates, overflow, status and platform widths. |
| `ProspectsTab.jsx` | D4492: customer pipeline, import, quiet hours and hashed suppression management. Takes projectId, ventureName and the shell's canWrite. |
| `ProspectSheet.jsx` | D4492: the individual contact email, recorded permissions and activity; explicit status/consent edits. |
| `AddProspectSheet.jsx` | D4492: manual capture, proof and a blank-note Ask; none on consent. |
| `prospectsModel.js` | D4492: seven stages, source labels, truthful counts and fixed refusal fallback. |
| `ProspectConsentSummary.jsx` | D4492: Audience slot and reusable summary hook/Review reachable label for the wizard handoff. |
| `ProspectsPage.jsx` | D4492: mounted tab, server-derived write permission and the campaign wizard’s import door. |
| `distributionStates.js` | D4496: pure recorded cross-tab state selection and phone/tablet KPI subsets. |
| `DistributionStates.jsx` | D4496: fixed notes, retry controls, token warning and existing HQ access banner. |
| `distributionStates.css` | D4496: shared state theme, phone/tablet targets and responsive Overview treatment. |
| `useDistributionLayout.js` | D4496: reactive phone/tablet layout using the shared media hook. |
| `useDistributionAccess.js` | D4496: existing form-options writer permission, fail closed while unknown. |
| `SequenceBuilder.jsx` | D4493: the sequence card under Prospects: steps, blocked steps with fixed reasons, the founder's own voice note, due drafts sent only by the composer's confirmed press, enrolment, the sequence Ask, the Needs-you row and the shared due read. |
| `ConsentByStep.jsx` | D4493: MK7b's per-prospect, per-step recorded consent table and its caption. |
| `sequenceModel.js` | D4493: pure pills, fixed blocked reasons, 'There is no SMS step.', AI voice Not offered, subtitles, due counts and the hold line. |
| `sequences.css` | D4493: sequence layout on the shared Distribution tokens, phone stacking. |
| `ResultsTab.jsx` | D4491: read-only funnels, Campaigns, Attribution and Spend per channel with source chips, the window, the MRR note, skeleton and read-error card. |
| `resultsModel.js` | D4491: Not recorded reasons, money and cost-per-lead rounding, funnel widths and the window label. |

CycleRoute still owns the module page. Overview retains its charts,
This week calendar summary (with D4493's STEP items), update-ask replies, Mercury, Notion and tool
doors. The D4485 cards sit above that body. Campaigns is the D4487 tab. Inbox is the D4494 tab. Channels is the
mounted D4486 tab; its table replaces Overview’s legacy channel records.
Calendar is the D4489 tab, using the same scoped read as This week.
Prospects is the D4492 tab. Ads is the D4490 tab, mounted by #4741; its
creatives Ask reuses #4488/#4512's quote/run/accept contract, scoped to the
selected campaign (`target: 'campaign'`), so Accept writes the creative row
itself — AdsTab only re-reads afterwards. Newsletter and Results have no
built screen yet and still show Coming in this module soon until their
tasks land.
Prospects is the D4492 tab. Results is the D4491 tab: read only, it writes no MRR. Other tabs show Coming in this module soon until
their tasks land.
Import `ProspectsTab` for the shell's Prospects slot, with its verified venture
id and read/write state. The wizard may call `useProspectConsentSummary` once,
draw `ConsentSummaryView` in Audience and `reachableLabel` in Schedule. A
segment-specific count remains Not recorded until contact membership exists.
A pending read uses LoadingSkeleton. No sample count or campaign is fabricated.

Routes are explicit in routes/growDistribution.jsx, including Campaigns/new
and Campaigns/:uid. No Distribution wildcard may shadow the existing Grow
record route. Campaign screens must use #4447/#4483's existing store, router
and grow client, with reads owned by their task; the shell reads no campaigns.
Proposals retain their host's decisions; nothing posts or sends on mount.
