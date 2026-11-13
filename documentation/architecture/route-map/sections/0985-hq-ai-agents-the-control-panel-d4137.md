## HQ › AI agents — the control panel (D4137, #4137)

`/hq/ai-agents` and its sub-paths, Super Admin only (`hqOnly`), from
`design/incoming/HQ AI Agents Page.dc.html` (SA0–SA9). A sidebar row after
Platform.

| Address | Board | Backend today |
| --- | --- | --- |
| `/hq/ai-agents` | SA0 Overview | `GET /api/admin/ai-agents/overview` (H5, #4163: the KPI tiles, Needs attention, spend by area over 30 days) and the cohort card (D4423, #4457: `GET`/`POST /api/admin/ai-agents/cohort`, `DELETE /cohort/:uid`). A figure with no data reads "Not recorded". |
| `/hq/ai-agents/roster`, `/roster/:agent` | SA1, SA2, SA2b | `GET /api/admin/ai-agents/roster`, `GET`/`PATCH /roster/:key` and `PUT /roster/:key/defaults` (H1, #4158). Every write takes a reason. |
| `/hq/ai-agents/skills` | SA3 From Axal | `GET /api/admin/ai-agents/skills` (H2, #4160): status, version, agents, golden cases, last eval. Tick skills for **Publish…**, **Re-run evals** and **Retire…**: `POST /skills/bulk` with a reason, each skill done or refused on its own (#4739). |
| `/hq/ai-agents/skills/:skillUid/edit` | SA4 | `GET /api/admin/ai-agents/skills/:uid` (the draft, review, golden cases, evals, versions, retirement, and `reviewers`). Review: `POST /:uid/review`, `/review/approve`, `/review/request-changes`. Golden cases: `PUT /:uid/cases`. `POST /:uid/evals`, `GET /:uid/diff?from=&to=`, `POST /:uid/retire` (#4739). Creating and editing a draft stay on `/teams/skills`. |
| `/hq/ai-agents/skills/companies` | SA5 | `GET /api/admin/ai-agents/company-skills`, `GET /:uid`, `POST /:uid/flag`, `/suspend`, `/clear` (H3, #4161). |
| `/hq/ai-agents/operations`, `/spend`, `/audit` | SA7, SA7b, SA8 | `GET /api/admin/ai-agents/runs`, `/runs/:uid`, `/spend?by=`, `/audit`, `/audit.csv` (H5, #4163). Spend links to Platform › AI usage. |
| `/hq/ai-agents/operations/policies` | SA6, SA6b | `GET /api/admin/ai-agents/policy` (H4, #4162) with its controls (#4739): models by area `PUT /policy/models`, locks `POST /policy/locks` and `DELETE /policy/locks/:model`, caps `PUT /policy/caps`, read tools `PUT /policy/tools`, and the pause `POST /policy/pause` and `/resume`. The agent engine's own halt sits beside the pause: `GET`/`POST /api/admin/agents/halt` (#3851). Every write takes a reason and is audited with it. |

Every refusal on this panel shows the sentence `pages/hq/aiAgents/refusals.js` keeps for its code, never the error's own text. The bell's agent alerts open Operations (dead-letter and gateway) or Policies (a halt set or cleared), and a skill-evaluation notice opens the skill's editor (#4739).
