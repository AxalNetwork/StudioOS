# frontend/src/pages/partner/pipeline — the partner Pipeline bucket

The Pipeline root and its five zones, each the body of one `/pipeline/*` address on the Partner shell.
`frontend/src/workspaces/partner/PartnerBucketRoutes.jsx` maps each address to its file. The investor shell's
`/pipeline/screening`, `/pipeline/commit` and `/pipeline/transactions` share the prefix and live elsewhere.

| File | What it is |
| --- | --- |
| `PipelineCommandCentre.jsx` | `/pipeline` itself since D4838: the first-run setup path (PP01) or the command centre (PP02): Needs attention, four metrics with their basis, the lifecycle strip, Recent movement (Not recorded) and Risks. It also hands the Eadwyn rail its next steps. |
| `commandCentre.js` | D4838: the pure rules the root reads. They cover setup steps from the record, when first run applies, metrics that print a zero only over a population, attention and risks from recorded fields, the lifecycle strip and the rail's steps. |
| `LeadsZone.jsx` | `/pipeline/leads`: open needs scored against the firm's own fit rules, with receipts, and a recorded pass reason. |
| `ProposalsZone.jsx` | `/pipeline/proposals` since D4838 PP04: a follow-up list (client, value, state, last activity, next action), a phone card per proposal, and a sheet with each quote's versions and its outcome with a loss reason. |
| `proposalsFollowUp.js` | D4838 PP04: the pure rules the Proposals list reads. They cover last activity, next action, the sheet's tabs and the strip, and they never count an open. |
| `NegotiationsZone.jsx` | `/pipeline/negotiations`: stage, ball, the open question and clause-level terms. |
| `RetainersZone.jsx` | `/pipeline/retainers`: cadence, monthly equivalent, usage against retained hours and renewal. |
| `AnalyticsZone.jsx` | `/pipeline/analytics`: win rate, cycle, weighted forecast and loss reasons, by window and by shape. |
| `usePipelineZone.js` | D4685: the shared read/write loop. A background refresh keeps open editors, and a write resolves `true` only once the server accepted it. |
| `PartialRead.jsx` | #4701: the note a zone draws when a list's first page answered and a later one did not. |

**Adding to Pipeline.** A zone reads only mounted Worker routes and draws loading, empty, "Not recorded" with its
reason and "Unreadable" with a retry. It prints a figure only over a population that exists. A rule two surfaces
share goes in a pure module like `commandCentre.js`, so a test can run it.
