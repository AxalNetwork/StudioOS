# services/agents — team agents (D1496)

An agent is a record on one company or one project (migration 712's
`team_agents`): a role from this catalogue, an offered model, a sponsor and a
monthly cap. Its output is always an `ai_rail_proposals` row; nothing it does
is automatic. The routes are `cloudflare-worker/src/routes/team_agents.ts`, mounted at `/api/teams`.

| File | What it does |
| --- | --- |
| `catalogue.ts` | The modules an agent can work in (the cycles' own slugs plus Studio, Research and Network), the rail options each module offers (from `../ai/railMatrix.json`), the read keys, the hard floor (`ALWAYS_ASKS_FLOOR`) and the eleven roles with their default rule books. |
| `skills.ts` | D1612 (#3951): the skill library's rules. `checkDraft` (name, purpose, steps, read-only tool names, output kind, /studio taxonomy tags with levels, roles), `toSkillMd` and `parseSkillMd` (a strict reader of a pasted Agent Skills Markdown file, untrusted data), `attachRefusal` (the agent's role, its sponsor's approved tools, a retired skill) and `skillsRadar` (the 8 axes on a person's 0–5 scale; "Not recorded" where no skill tags an axis). The routes are `cloudflare-worker/src/routes/team_skills.ts`; `team_skills_d1612.test.ts` covers it. |
| `rulebook.ts` | `checkRules`: a rule book's closed shape and its floor (`rule_floor` before `invalid_rules`); `diffRules`: what a scope changed from the default. |
| `teams.ts` | The reads the routes and the run share: an agent's scope, the read and manage gates, the rule book in force, the month's spend (`{ available: false }`, never 0, when unknown) and the audit row. |
| `agentRun.ts` | Part 2 (#3842): the only way an agent runs, as its sponsor, within its rule book and its monthly cap; its output is a proposal with `agent_id`. Also its quote. #3846 (E2): a run's uid makes a retried step take one hold and leave at most one proposal; a lost one ends `step_lost`. |
| `queue.ts` | Part 3 (#3843): the approvals queue. A scope's agents' proposals, read by the agent's scope (never by `user_id`), decided once by the scope's manager or the agent's sponsor through `decideRailAs`, with `decided_by_user_id` and a `proposal_decided` event. A cost or a count it cannot read is `{ available: false }`, never 0. |
| `agentTools.ts` | Part 5 (#3844): the sponsor's approved read tools (D852). `checkGrants` (the sponsor's own connected server, approved and pinned read tools only), `grantsView` (the profile's tools with their server and status), `cleanReads` (granted, at most five) and `readTools` (each through `callCustomTool` in `meteredCall`, cut to 8 KB, wrapped by `toolResultsForModel`; a gone or drifted server answers `disconnected`). |
| `goals.ts` | D1529 (#3845, E1 of #3742): a scope's goals. A project goal rolls up only to its own company's goal and links only its own OKR. Also `sumCosts`, which never sums an unknown as 0. |
| `tasks.ts` | D1529: a scope's tasks, for a person, an agent within its rule book, or no one; dependencies within one scope and without a cycle; ready derived; cost `{ available: false }` until E3. |
| `workBoard.ts` | D1614 W1 (#3969): project board fields and cards over `scope_tasks` (migration 762), transactional moves with actor events, close reasons, per-project numbering, scoped dependency checks (E1's cycle walk; 409 `task_blocked`) and the `unblocked` notice. E3's run store is read through the `WorkRunReader` seam, "no recorded runs" until #3847 supplies one. |

**The rule for adding here.** `catalogue.ts` and `rulebook.ts` stay pure: no
binding, no fetch. A read of the database goes in `teams.ts`, and a gate is
written there once. A new module key must be a slug a cycle already has; a new
rule book section is one entry in `rulebook.ts`'s `SECTIONS`; the floor only
grows. An agent runs only through `agentRun.ts`, and its proposals are decided through `queue.ts`.
`team_agents_d1496.test.ts` covers the registry, the run and the queue, and
`scope_goals_tasks_d1529.test.ts` covers goals and tasks.

## `skills/` (#3953, D1612)

The Axal starter skill library: twelve HQ skills, one SKILL.md file each, in
#3951's format (frontmatter `name`, `description`, `roles`, `tools`, `output`,
`taxonomy`, `version`, then numbered steps), and one golden evaluation case
per skill in `skills/cases/<slug>.json` for part D (#3954). Content only:
A1 (#3951) seeds them into `agent_skills` and `agent_skill_versions`.
`cloudflare-worker/test/agent_skill_library_d1612.test.ts` holds every file to the catalogue.
