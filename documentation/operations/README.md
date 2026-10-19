# documentation/operations — runbooks

**A runbook is the steps an operator follows to change or recover production.**
Each file here answers one "how do I…" question, and is kept true as the system
changes. What production *is* lives in `documentation/architecture/`; these
files say how to act on it.

| File | Use it to |
| --- | --- |
| `DEPLOY.md` | Ship the Worker and the SPA to production, and roll a deploy back. |
| `D1_RECOVERY.md` | Recover D1 when the data is wrong and a Worker rollback will not help. |
| `INCIDENT_RESPONSE.md` | Respond to an incident: severities, response times and who is paged. |
| `CLAUDE_REVIEW.md` | Run, tune and cost the advisory pull-request review on the Anthropic API. |
| `TICKET_GITHUB_SYNC.md` | Recover support tickets that were saved in D1 but never reached GitHub. |
| `TELEGRAM.md` | Set up the Telegram Business interview bot, check it on a real phone, rotate its secrets and switch it off (D756). |
| `WHATSAPP.md` | Switch WhatsApp Business on, check it on a real phone and roll it back (D754). |
| `S1_HANDOFF_2026-10-18.md` | Take over S1, the coordinator session. A dated handoff, true on its date. |

## Adding one

Name the system and the action in the title. Give secret and variable names
only: no value belongs in a runbook, in the repo or in an issue. Add a row here
and a link in `documentation/README.md`.
