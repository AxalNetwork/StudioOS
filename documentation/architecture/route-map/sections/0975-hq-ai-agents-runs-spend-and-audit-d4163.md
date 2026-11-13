### HQ › AI agents: Overview, Runs, Spend and Audit (D4163, #4163)

- **Worker:** `routes/admin_ai_agents.ts`, mounted at `/api/admin/ai-agents` by the route registry, Super Admin only (`requireSuperAdmin`). Served by `services/agents/adminReads.ts` and `services/agents/adminAudit.ts`.
  - `GET /overview` (SA0): agents active and teams, skills published (From Axal / companies'), runs this week and over 30 days, spend this month against the platform budget, proposals accepted %, runs failed %, Needs attention, spend by area over 30 days.
  - `GET /runs` (SA7): the run log, newest first, 50 a page; filters `agent`, `skill`, `area`, `team=company:<id>|project:<id>`, `status=succeeded|failed|refused|running|cancelled`, `from`, `to`, `cursor`.
  - `GET /runs/:uid` (SA7): steps, inputs as record references, output, cost against the hold, errors.
  - `GET /spend?by=agent|skill|company|model` (SA7b): this month against the budget, the projection at the last 7 days' pace, the teams at their cap.
  - `GET /audit` and `GET /audit.csv` (SA8): every admin action on the panel; filters `admin`, `action`, `area`, `from`, `to`.
- **Store:** `ai_admin_audit` (migration `202611022046_ai_admin_audit.sql`), append-only; H1–H4 write it through `recordAiAdminAction` / `aiAdminAuditStatement`. No route updates or deletes it.
- **Rules:** a figure with no data is `null` ("Not recorded"), never 0; the platform budget is H4's (#4162) and reads `null` until it is set. People are named, never by email, and any email in a step summary or a proposal payload is replaced.
- **Refusals:** 401 signed out; 403 for anyone but a Super Admin; 400 `invalid_filter` / `invalid_by`; 404 for an unknown run.
- **Client:** `lib/api/adminAiAgents.js` (`adminAiAgentsApi`). The HQ › AI agents screens (S21's PR, `pages/hq/aiAgents/`) switch their `H5` adapter onto it when they land.
