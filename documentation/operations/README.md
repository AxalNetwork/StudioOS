# documentation/operations — runbooks

How to change, recover or check production. A runbook says what to run and
what to expect, never what the numbers are: every figure comes from a command
or a screen at the time it is run. Never put a token, a password or personal
data in one; the repository is public.

| File | When |
| --- | --- |
| `DEPLOY.md` | Shipping the Worker to production. |
| `D1_RECOVERY.md` | The data is wrong and a rollback will not help. |
| `INCIDENT_RESPONSE.md` | Something is on fire. |
| `CLAUDE_REVIEW.md` | The advisory pull-request review on the Anthropic API: its settings and its cost. |
| `TICKET_GITHUB_SYNC.md` | Support tickets saved in D1 but missing from GitHub. |
| `MERCURY_MEMBER_CHECKS.md` | D752's read-only live checks: four Mercury field names for S02 or S03, and the owner's walk-through with a test investor and founder (#1008 item 34). |
| `S1_HANDOFF_2026-10-18.md` | The S1 coordinator handoff of 2026-10-18, true on its date. |

**Adding one.** A new runbook gets a row here, says who may run it, and names
the test or guard that covers the same ground in CI.
