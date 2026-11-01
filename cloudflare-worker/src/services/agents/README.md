# services/agents — team agents (D1496)

An agent is a record on one company or one project (migration 712's
`team_agents`): a role from this catalogue, an offered model, a sponsor and a
monthly cap. Its output is always an `ai_rail_proposals` row; nothing it does
is automatic. The routes are `routes/team_agents.ts`, mounted at `/api/teams`.

| File | What it does |
| --- | --- |
| `catalogue.ts` | The modules an agent can work in (the cycles' own slugs plus Studio, Research and Network), the rail options each module offers (from `ai/railMatrix.json`), the read keys, the hard floor (`ALWAYS_ASKS_FLOOR`) and the eleven roles with their default rule books. |
| `rulebook.ts` | `checkRules`: a rule book's closed shape and its floor (`rule_floor` before `invalid_rules`); `diffRules`: what a scope changed from the default. |
| `teams.ts` | The reads the routes and the run share: an agent's scope, the read and manage gates, the rule book in force, the month's spend (`{ available: false }`, never 0, when unknown) and the audit row. |
| `agentRun.ts` | Part 2 (#3842): the only way an agent runs, as its sponsor, within its rule book and its monthly cap; its output is a proposal with `agent_id`. Also its quote. |
| `agentTools.ts` | Part 5 (#3844): the sponsor's approved read tools (D852). `checkGrants` (the sponsor's own connected server, approved and pinned read tools only), `grantsView` (the profile's tools with their server and status), `cleanReads` (granted, at most five) and `readTools` (each through `callCustomTool` in `meteredCall`, cut to 8 KB, wrapped by `toolResultsForModel`; a gone or drifted server answers `disconnected`). |

**The rule for adding here.** `catalogue.ts` and `rulebook.ts` stay pure: no
binding, no fetch. A read of the database goes in `teams.ts`, and a gate is
written there once. A new module key must be a slug a cycle already has; a new
rule book section is one entry in `rulebook.ts`'s `SECTIONS`; the floor only
grows. An agent runs only through `agentRun.ts`. Part 3 adds the queue.
`team_agents_d1496.test.ts` covers every file here.

## `skills/` (#3953, D1612)

The Axal starter skill library: twelve HQ skills, one SKILL.md file each, in
#3951's format (frontmatter `name`, `description`, `roles`, `tools`, `output`,
`taxonomy`, `version`, then numbered steps), and one golden evaluation case
per skill in `skills/cases/<slug>.json` for part D (#3954). Content only:
A1 (#3951) seeds them into `agent_skills` and `agent_skill_versions`.
`test/agent_skill_library_d1612.test.ts` holds every file to the catalogue.
