### HQ › AI agents › From Axal: the skill lifecycle (D4160, #4160, H2 of #4137)

Worker routes in `routes/admin_hq_skills.ts`, mounted by itself (#4105) at `/api/admin/ai-agents/skills`. The services are `services/agents/skillLifecycle.ts` (the hash, review, golden cases, the bar, the diff) and `services/agents/skillPublish.ts` (the one publish). The tables are migration `202611022140_hq_skill_lifecycle.sql`. Every route is Super Admin only (403 otherwise).

Creating and editing an Axal skill stay on `/api/teams/skills` (D1612):
- every save there refuses a write-capable tool (400 `tool_not_read_only`, `{ tool }`);
- its publish refuses an Axal draft with no approval on the current text (409 `needs_approval`) or below 9 of 10 golden-case runs (409 `golden_cases_failing`, `{ pass, total }`);
- its `PATCH { status: 'retired' }` refuses an Axal skill (409 `replacement_required`).

The client is `frontend/src/lib/api/adminHqSkills.js`. The page (H6) is not on main yet.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/ai-agents/skills` | Super Admin | `{ skills: [{ uid, name, area, level, status: draft\|in_review\|published\|retired, version \| null, agents, tokens_per_run: null, golden: { pass, total, meets_bar }, last_eval }], pass_bar }` |
| `GET /api/admin/ai-agents/skills/:uid` | Super Admin | `{ skill, review: { open, approved, history }, cases, evals: { cases: [{ uid, name, results: [{ model, result, detail, run_at }] }], models, pass, total, meets_bar, last_run, pass_bar }, versions, retired }` |
| `GET /api/admin/ai-agents/skills/:uid/diff?from=vN&to=draft\|vM` | Super Admin | `{ from, to, frontmatter: [{ field, from, to }], steps: [{ op: same\|added\|removed, text }] }`; 400 `version_unknown` |
| `POST /api/admin/ai-agents/skills/:uid/review` | Super Admin | `{ reviewer_uid }` → 201 `{ status: 'in_review', review }`; 422 `reviewer_invalid`, `reviewer_is_author`; 409 `review_open`, `retired` |
| `POST /api/admin/ai-agents/skills/:uid/review/approve` | the named reviewer | `{ comment? }` → `{ status, review }`; 403 `self_approval`, `not_reviewer`; 409 `no_review`, `review_stale` |
| `POST /api/admin/ai-agents/skills/:uid/review/request-changes` | the named reviewer | `{ comment }` → `{ status, review }`; 400 `comment_required` |
| `PUT /api/admin/ai-agents/skills/:uid/cases` | Super Admin | `{ cases: [{ uid?, name, input: { records }, expect }], reason }` → `{ evals }`; 400 `reason_required`, `case_invalid`, `case_has_email` |
| `POST /api/admin/ai-agents/skills/:uid/evals` | Super Admin | `{ models? }` → `{ evals }`: each live case on each model through `run()`, charged to HQ; 400 `models_invalid`; 409 `no_cases` |
| `POST /api/admin/ai-agents/skills/:uid/retire` | Super Admin | `{ replacement_uid, reason }` → `{ status: 'retired', pinned_agents, replacement }`; 422 `replacement_required`, `replacement_invalid`; 409 `retired` |
| `POST /api/admin/ai-agents/skills/bulk` | Super Admin | `{ action: publish\|retire\|evals, uids (1–50), reason, replacement_uid?, models? }` → `{ action, results: [{ uid, ok, code?, message? }] }`, each item on its own |

Every change writes the admin audit row (`logAdminAction`) with the reason and the state before and after. A person is `{ uid, name }`, never an email.
