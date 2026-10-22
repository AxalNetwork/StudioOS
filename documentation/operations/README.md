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
| `GITHUB_CONNECTOR_APP.md` | Register the StudioOS GitHub App for the GitHub connector (D655), put its Client ID and secret in production, check, rotate and remove them, and troubleshoot a failed connect. |
| `TICKET_GITHUB_SYNC.md` | Recover support tickets that were saved in D1 but never reached GitHub. |
| `TELEGRAM.md` | Set up the Telegram Business interview bot, check it on a real phone, rotate its secrets and switch it off (D756). |
| `WHATSAPP.md` | Switch WhatsApp Business on, check it on a real phone and roll it back (D754). |
| `MEETING_BOT.md` | Set up Eadwyn AI for Zoom, Google Meet and Teams; check notice, consent and retention; interpret failures; switch it off (D886). |
| `ZOOM_AND_MEET_TRANSCRIPTS.md` | Create and share the Zoom app, switch on Google Meet transcript import, run the live check, read each refusal and roll back (D757). |
| `AI_TOKEN_PACKS.md` | Run AI token packs (D755): create, adopt and archive packs, handle refunds and disputes, an overdue credit, adjustments and reconcile, and run the live purchase-and-refund check. |
| `AIRAIL.md` | Run the Eadwyn AI rail (D720): how a page gets its models, add a model Cloudflare publishes, how members are billed, and where a member's consumption is shown. A draft until D781 closes. |
| `MERCURY_MEMBER_CHECKS.md` | Run D752's read-only live checks: four Mercury field names for S02 or S03, and the owner's walk-through with a test investor and founder (#1008 item 34). |
| `MCP_API_RUNBOOK.md` | Switch member API keys for `/mcp` on, check them read-only, roll back, revoke a member's keys and read usage in aggregate (D850). |
| `REDIRECT_RETIREMENT.md` | Retire the SPA's internal redirects on 2027-01-19 (#2301): what is counted and kept, the D1 query for the last 30 days, and what to remove. |
| `S1_HANDOFF_2026-10-18.md` | Take over S1, the coordinator session. A dated handoff, true on its date. |

## Adding one

Name the system and the action in the title. Give secret and variable names
only: no value belongs in a runbook, in the repo or in an issue. Add a row here
and a link in `documentation/README.md`.
