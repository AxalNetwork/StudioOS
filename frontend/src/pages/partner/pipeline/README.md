# frontend/src/pages/partner/pipeline — the partner Pipeline bucket

The Pipeline root and its five zones, each the body of one `/pipeline/*` address on the Partner shell.
`frontend/src/workspaces/partner/PartnerBucketRoutes.jsx` maps each address to its file. The investor shell's
`/pipeline/screening`, `/pipeline/commit` and `/pipeline/transactions` share the prefix and live elsewhere.

| File | What it is |
| --- | --- |
| `LeadsZone.jsx` | `/pipeline/leads` to boards PP03, PP03b and PP03m (#5935): five views, a strip whose zeros carry a population, cards with the fit reasons before the score and Why this score?, and a pass dialog with a required reason. Draft proposal (D4838 part 10) opens the sheet with the lead's draft. |
| `PipelineCommandCentre.jsx` | `/pipeline` itself since D4838: the first-run setup path (PP01) or the command centre (PP02): Needs attention, four metrics with their basis, the lifecycle strip, Recent movement (D5942's recorded lifecycle feed, newest first: D4838 part 9, #5943) and Risks. It also hands the Eadwyn rail its next steps. |
| `commandCentre.js` | D4838: the pure rules the root reads. They cover setup steps from the record, when first run applies, metrics that print a zero only over a population, attention and risks from recorded fields, the lifecycle strip and the rail's steps. Since D4838 part 9 (#5943) it also holds the feed's event words (`EVENT_WORDS`, `activityRows`), shared with the opportunity sheet's Activity tab, and `movementView`. |
| `ProposalsZone.jsx` | `/pipeline/proposals` since D4838 PP04: a follow-up list (client, value, state, last activity, next action), a phone card per proposal, and a sheet with each quote's versions and its outcome with a loss reason. |
| `proposalsFollowUp.js` | D4838 PP04: the pure rules the Proposals list reads. They cover last activity, next action, the sheet's tabs and the strip, and they never count an open. |
| `leadsModel.js` | #5935: the pure rules Leads draws by: fit state, reasons, Why this score?, Recent, the strip, the pass reasons (the Worker's `PASS_REASONS`). |
| `NegotiationsZone.jsx` | `/pipeline/negotiations` since D5938: the board of recorded stages (PP05), a stage selector over one list on a phone (PP05m), a card moved by buttons, and the Eadwyn counter drawn "Not sent" only while a draft exists. |
| `NegotiationTermsSheet.jsx` | D5938: one negotiation's terms sheet (PP05b): We proposed, They proposed and Current position, a difference marked with ≠ and words, and the stage, ball and open question. |
| `RetainersZone.jsx` | `/pipeline/retainers`: cadence, monthly equivalent, usage against retained hours and renewal. |
| `AnalyticsZone.jsx` | `/pipeline/analytics`: win rate, cycle, weighted forecast and loss reasons, by window and by shape. |
| `OpportunitySheet.jsx` | D4838 PP08 (#5934): the shared opportunity sheet. It shows one lead, proposal, negotiation and engagement, joined by id, on `frontend/src/ui/Sheet.jsx`. Tabs appear only for records that exist, and Activity comes from D5942's recorded feed. A zone opens it with whichever id it holds. |
| `LeadProposalDraft.jsx` | D4838 part 10 (#5936, PP03c): a lead's proposal draft in the opportunity sheet's Overview, opened by Leads' Draft proposal: Save draft, Edit, Discard (confirmed in place) and an Eadwyn start scoped to that lead, its cost shown before the run. Every label says not sent; nothing here sends. |
| `usePipelineZone.js` | D4685: the shared read/write loop. A background refresh keeps open editors, and a write resolves `true` only once the server accepted it. An optional `key` (PP08) makes a changed record a first read again. |
| `PartialRead.jsx` | #4701: the note a zone draws when a list's first page answered and a later one did not. |
| `retainersModel.js` | D4838 part 6 (#5939): the Retainers zone's pure rules (PP06): the attention band's three sets taken with `commandCentre.js`'s own predicates, utilization in words, health, the monthly equivalent, the KPI strip and the sheet's tabs. |

**Adding to Pipeline.** A zone reads only mounted Worker routes and draws loading, empty, "Not recorded" with its
reason and "Unreadable" with a retry. It prints a figure only over a population that exists. A rule two surfaces
share goes in a pure module like `commandCentre.js`, so a test can run it.
