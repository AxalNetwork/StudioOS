### Teams › Skills: a company's own skill analytics (D8912, #8912)

A company administrator's read of their own company's coverage and executions. It is `routes/team_skill_analytics.ts`, a self-mounting router ahead of the `/api/teams` routers, behind the same `TEAM_AGENTS_ENABLED` switch (404 `team_agents_off`). There is no client method and no screen yet: the page is not drawn.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/skills/analytics?company=<uid>` | An Owner, Admin or Founder of that company, or its primary admin (`canEditAsMember`) | `{ company: { uid, name }, coverage, published_evaluation, executions, filters? }`; the HQ read's filters, with `scope=company` |

The company is the caller's verified editor seat: no seat, another company or an unknown uid is 404 `not_found`, a member without an editor seat is 403 `not_company_admin`, a missing or repeated `company` is 400 `company_required`. The measures are the HQ read's (`services/agents/skillCoverage.ts`, `skillExecutions.ts`) with `subject: 'company'`, over reads narrowed to the company in SQL. `published_evaluation` is unavailable until #4533. It writes nothing. See `SKILL_ANALYTICS_METRICS.md` § Where it is served.
