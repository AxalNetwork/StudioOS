# documentation/operations — runbooks

What to do, step by step, when something has to be done to production. Each
file is one job, written so its owner can follow it without the code.

| File | When to open it |
| --- | --- |
| `DEPLOY.md` | Shipping production: the build, the D1 migrations and the deploy. |
| `D1_RECOVERY.md` | The data is wrong and a rollback will not help. |
| `INCIDENT_RESPONSE.md` | Something is on fire. |
| `CLAUDE_REVIEW.md` | The advisory pull-request review on the Anthropic API, and its settings. |
| `TICKET_GITHUB_SYNC.md` | Support tickets missing from GitHub: recovering the issues the ticket form should have opened. |
| `AI_TOKEN_PACKS.md` | AI token packs (D755): creating, adopting and archiving packs, refunds and disputes, an overdue credit, adjustments, reconcile, and the live purchase-and-refund check. |
| `S1_HANDOFF_2026-10-18.md` | A dated handoff between coordinators. True as of its date, not maintained. |

**Adding one.** A runbook is a new file here, named for the job in capitals,
with a row in this table and in `documentation/README.md`'s `operations/` row.
It names secrets and settings, never their values.
