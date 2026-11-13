### HQ › AI agents › Company skills: moderation (D4161, #4161, H3 of #4137)

Worker routes in `routes/admin_company_skills.ts`, mounted by itself (#4105) at `/api/admin/ai-agents/company-skills`. The service is `services/agents/skillModeration.ts`, and the table is migration `202611022055_agent_skill_moderation.sql`. Every route is Super Admin only (403 otherwise). HQ reads, flags and suspends a company's skill and never writes it; the only table written is `agent_skill_moderation`. The client is `frontend/src/lib/api/adminCompanySkills.js`. The page (H6) is not on main yet.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/ai-agents/company-skills?status=published\|in_review\|flagged\|suspended&q=&page=` | Super Admin | `{ skills: [Row], page, per_page: 25, total }`, suspended first, then flagged. 400 `status_invalid`, `page_invalid`. Nothing yet is `skills: []`. |
| `GET /api/admin/ai-agents/company-skills/:uid` | Super Admin | `{ skill: Row & { purpose, steps, output_kind, skill_md, read_only: true }, moderation: Moderation \| null, history: [Moderation] }`. 404 `not_found` (also for an HQ skill). |
| `POST /api/admin/ai-agents/company-skills/:uid/flag` | Super Admin | `{ reason }` → `{ status: 'flagged', moderation }`. The skill keeps running; the company's editors are told. 409 `already_flagged`, `already_suspended`. |
| `POST /api/admin/ai-agents/company-skills/:uid/suspend` | Super Admin | `{ reason }` → `{ status: 'suspended', moderation }`. The run gate refuses it, and attach answers 409 `skill_suspended`; the editors are told. 409 `already_suspended`. |
| `POST /api/admin/ai-agents/company-skills/:uid/clear` | Super Admin | `{ reason }` → `{ status, moderation: null }`. 409 `nothing_to_clear`. |

`Row` is `{ uid, name, company: { uid, name }, project: null, author: { uid, name } | null, area: { slug, label } | null, tools, status, version | null }`. `Moderation` is `{ action, reason, version | null, by: { uid, name }, at, cleared: { at, how: 'hq' | 'republished', reason, by } | null }`.

Every action needs a reason of 10 to 500 characters (400 `reason_required`). Each one writes the admin audit row (`logAdminAction`) with the reason and the status before and after. When the company publishes a new version, the open flag or suspension closes (`republished`), but the versions a suspension covered stay off at the run gate.
