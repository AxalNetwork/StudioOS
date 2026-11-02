### Team agents: the skill library (D1612, #3951, part A of #3945)

Worker routes in `routes/team_skills.ts`, mounted at `/api/teams` beside `team_agents.ts`, backed by `services/agents/skills.ts` and migration 759 (`agent_skills`, `agent_skill_versions`, `agent_skill_tags`, `agent_skill_roles`, `agent_skill_links`). Behind the same `TEAM_AGENTS_ENABLED` switch. Read: an HQ skill for every member, a company skill for its members (`user_company_links`) and HQ's admins; a draft only for its writers. Write: an HQ skill by a Super Admin, a company skill by its editors (`canEdit`). An agent's skills: its scope's managers (`canManage`). The client is part C (#3952).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/skills?company=&role=&category=&q=&sort=popular\|new\|az` | signed in; `company` must be the caller's | `{ roles: [{ key, label, skills, agents }], hq: [Skill], company: { uid, name, skills, can_write } \| null, can_write_hq }`. 400 `role_unknown`, `category_unknown`, `sort_invalid`; 404. |
| `GET /api/teams/skills/:uid` | read | `{ skill: Skill & { skill_md }, versions: [{ version, published_at, by }], agents: [{ company, agents, projects: [{ id, name, agents }] }] }`, only the agents the caller can read. |
| `POST /api/teams/skills` | write | `{ scope, company?, name, purpose, steps, tools, output_kind, tags, roles }` or `{ scope, company?, skill_md }`; 201 `{ skill }`, a draft. 400 with the field's code; 403 `not_editor`; 409 `slug_taken`. |
| `PATCH /api/teams/skills/:uid` | write | The draft's fields, read, merged and checked; or `{ status: 'retired' }`. |
| `POST /api/teams/skills/:uid/publish` | write | `{ skill }` with the new version and its `skill_md`. 409 `retired`, `publish_conflict`. |
| `POST /api/teams/skills/:uid/assign` | the agents' managers | A2 (#3956): `{ agent_uids }` (or `agents`); pins the current published version; partial: `{ added, refused: [{ agent_uid, code, tool? }], used_by }`, never refused as a whole for one agent. |
| `GET /api/teams/skills/:uid/agents` | read the skill | A2. `{ agents: [{ uid, name, role_key, pinned_version, scope: { kind, company_name, project_name } }] }`, only agents the caller can read. |
| `GET /api/teams/skills/:uid/assignable` | read the skill | A2. `{ agents: [{ uid, name, role_key, skill_count, assigned, blocked: { code, tool } \| null, scope }] }`: the current version's roles' agents the caller manages. |
| `GET /api/teams/agents/:uid/skills` | read | A2 (#3956): `{ can_manage, agent, skills: [{ uid, name, purpose, steps, pinned_version, current_version, status, update_available, tools: [{ key, label, approved }], taxonomy: [{ slug, label, level }] }], radar: { axes: [{ slug, label, level: 1-5 \| null }] } \| null, values: null }`. No skills is `radar: null`, never zeros. |
| `GET /api/teams/agents/:uid/skills/available` | read | A2. `{ skills: [SkillCard + { assigned, pinned_version, blocked: { code: 'tool_not_approved', tool } \| null }] }`: the role's published skills, most used first. |
| `PUT /api/teams/agents/:uid/skills` | manage | A2: `{ skills: [{ uid, version? }] }` replaces the list; the GET's shape. 403 `not_manager`; 404 `not_found`; 422 `role_mismatch` / `tool_not_approved` (`{ tool }`) / `version_not_published`; 409 `skill_retired` (one already pinned stays). Each with `skill_uid`. |
| `GET /api/teams/:scope/:id/coverage` | read | A2. `{ axes: [{ slug, label, people_level, agent_level }] }`: the team's people's highest self-rated level (`user_skills`, 0 is none) and its own agents' highest skill level, per axis; null where none. |

`Skill` is `{ uid, scope, slug, status, version, author, name, purpose, steps, tools, output_kind, output_label, roles: [{ key, label }], tags: [{ slug, label, category, level }], used_by, updated_at, can_write, draft? }`; a reader sees the published version, a writer also its `draft`. A radar axis no skill tags is `{ available: false, reason: 'Not recorded' }`, never 0.

