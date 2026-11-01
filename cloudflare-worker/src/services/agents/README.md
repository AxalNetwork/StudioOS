# services/agents — team agents (D1496)

An agent is a record on one company or one project (migration 712's
`team_agents`): a role from this catalogue, an offered model, a sponsor and a
monthly cap. Its output is always an `ai_rail_proposals` row; nothing it does
is automatic. The routes are `routes/team_agents.ts`, mounted at `/api/teams`.

| File | What it does |
| --- | --- |
| `catalogue.ts` | The modules an agent can work in (the cycles' own slugs plus Studio, Research and Network), the rail options each module offers (from `ai/railMatrix.json`), the read keys, the hard floor (`ALWAYS_ASKS_FLOOR`) and the eleven roles with their default rule books. |
| `skills.ts` | D1612 (#3951): the skill library's rules. `checkDraft` (name, purpose, steps, read-only tool names, output kind, /studio taxonomy tags with levels, roles), `toSkillMd` and `parseSkillMd` (a strict reader of a pasted Agent Skills Markdown file, untrusted data), `attachRefusal` (the agent's role, its sponsor's approved tools, a retired skill) and `skillsRadar` (the 8 axes on a person's 0–5 scale; "Not recorded" where no skill tags an axis). The routes are `routes/team_skills.ts`; `team_skills_d1612.test.ts` covers it. |
| `rulebook.ts` | `checkRules`: a rule book's closed shape and its floor (`rule_floor` before `invalid_rules`); `diffRules`: what a scope changed from the default. |

**The rule for adding here.** Pure files only: no binding, no fetch. A new
module key must be a slug a cycle already has; a new rule book section is one
entry in `rulebook.ts`'s `SECTIONS`; the floor only grows. Part 2 adds the run
(`agentRun.ts`), part 3 the queue. `team_agents_d1496.test.ts` covers both
files.
