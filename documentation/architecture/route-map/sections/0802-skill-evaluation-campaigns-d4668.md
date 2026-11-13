## HQ › AI agents › Skills — evaluation campaigns past the first 20 skills (D4668, #4668)

No new page. A global press of "Run the published versions' golden cases" is now a campaign that reaches every published Axal skill, at most 20 a press (`SKILLS_PER_RUN`). The single-skill press (`uid`) is unchanged.

| Address | What | Backend |
| --- | --- | --- |
| HQ › AI agents › Skills | The first global press starts a campaign and runs its first batch; `{ campaign }` runs the next. The response adds `evaluated` (skills, versions, cases, models this press ran) and `campaign` (status, total, done, skipped with reasons, pending, results). Refusals `models_fixed`, `campaign_not_found`, `campaign_busy`, `campaign_cancelled`, `models_unavailable` | `POST /api/admin/ai-agents/skills/evals/published { models?, uid?, campaign? }` |
| HQ › AI agents › Skills | A campaign's progress | `GET /api/admin/ai-agents/skills/evals/published/campaigns/:uid` |
| HQ › AI agents › Skills | Cancel a running campaign (final; what it ran stays); `campaign_complete` when it already finished | `POST /api/admin/ai-agents/skills/evals/published/campaigns/:uid/cancel` |
