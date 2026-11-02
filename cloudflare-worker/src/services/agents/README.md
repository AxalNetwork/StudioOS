# services/agents — team agents (D1496)

An agent is a record on one company or one project (migration 712's
`team_agents`): a role from this catalogue, an offered model, a sponsor and a
monthly cap. Its output is always an `ai_rail_proposals` row; nothing it does
is automatic. The routes are `cloudflare-worker/src/routes/team_agents.ts`, mounted at `/api/teams`.

| File | What it does |
| --- | --- |
| `catalogue.ts` | The modules an agent can work in (the cycles' own slugs plus Studio, Research and Network), the rail options each module offers (from `../ai/railMatrix.json`), the read keys, the hard floor (`ALWAYS_ASKS_FLOOR`) and the eleven roles with their default rule books. |
| `skills.ts` | D1612 (#3951): the skill library's rules. `checkDraft` (name, purpose, steps, read-only tool names, output kind, /studio taxonomy tags with levels, roles), `toSkillMd` and `parseSkillMd` (a strict reader of a pasted Agent Skills Markdown file, untrusted data), `attachRefusal` (the agent's role, its sponsor's approved tools, a retired skill) and `skillsRadar` (the 8 axes on a person's 0–5 scale; "Not recorded" where no skill tags an axis). The routes are `cloudflare-worker/src/routes/team_skills.ts`; `team_skills_d1612.test.ts` covers it. |
| `skillLinks.ts` | D1612 A2 (#3956): an agent's skills. `attachCheck`, the one gate (`not_found`, `version_not_published`, `skill_retired`, `role_mismatch`, `tool_not_approved` with the tool), `checkSkillList` (PUT and add-agent), the radar (`axesOf`: highest level per axis, null where none; `agentRadar` null with no skills), `agentValues` (null until rule books carry values), and coverage's reads (`teamUserIds`, `peopleAxes`). |
| `rulebook.ts` | `checkRules`: a rule book's closed shape and its floor (`rule_floor` before `invalid_rules`); `diffRules`: what a scope changed from the default. |
| `teams.ts` | The reads the routes and the run share: an agent's scope, the read and manage gates, the rule book in force, the month's spend (`{ available: false }`, never 0, when unknown) and the audit row. |
| `agentRun.ts` | Part 2 (#3842): the only way an agent runs, as its sponsor, within its rule book and its monthly cap; its output is a proposal with `agent_id`. Also its quote. #3846 (E2): a run's uid makes a retried step take one hold and leave at most one proposal; a lost one ends `step_lost`. |
| `queue.ts` | Part 3 (#3843): the approvals queue. A scope's agents' proposals, read by the agent's scope (never by `user_id`), decided once by the scope's manager or the agent's sponsor through `decideRailAs`, with `decided_by_user_id` and a `proposal_decided` event. A cost or a count it cannot read is `{ available: false }`, never 0. |
| `agentTools.ts` | Part 5 (#3844): the sponsor's approved read tools (D852). `checkGrants` (the sponsor's own connected server, approved and pinned read tools only), `grantsView` (the profile's tools with their server and status), `cleanReads` (granted, at most five) and `readTools` (each through `callCustomTool` in `meteredCall`, cut to 8 KB, wrapped by `toolResultsForModel`; a gone or drifted server answers `disconnected`). |
| `goals.ts` | D1529 (#3845, E1 of #3742): a scope's goals. A project goal rolls up only to its own company's goal and links only its own OKR. Also `sumCosts`, which never sums an unknown as 0. |
| `tasks.ts` | D1529: a scope's tasks, for a person, an agent within its rule book, or no one; dependencies within one scope and without a cycle; ready derived; cost `{ available: false }` until E3. |
| `reads.ts` | D1528 (#3847, E3): the read functions a run's `context` step may call, one per rule book `reads` key, each `{ untrusted: true, data }` and at most 8 KB. A key with no function refuses the run `read_unavailable`. Built: the project and company summaries, the team roster and the four cycles' records. |
| `workBurnup.ts` | D1614 W2 (#3970): a project's burn-up, derived from `scope_task_events` on every read and stored nowhere. Each day is the end of that day in the member's time zone: scope, completed, open, not planned, duplicate, and completed by assignee kind. Days before the first item are `{ available: false }`, never zeros. |
| `planner.ts` | D1530 (#3848, E4 of #3742): the goal planner. `parsePlan` (at most 20 items; an unknown module or role drops its item with a note; a loop is `plan_invalid`), `planQuote` and `draftPlan` (the CEO agent through `agentRun`, else the manager's Eadwyn, on `propose:goal-plan`), and `acceptPlan` (claims the proposal once and writes every task, event and dependency in the same atomic `DB.batch`). `agent_planner_d1530.test.ts` covers it. |
| `templates.ts` | D1530: one role template per catalogue role (model tier, suggested cap, duties), the wizard's stage mapping, `suggestRoles` (rule-based, no model) and `monthEstimate` (unknown, never 0). |
| `duties.ts` | D1530 (#3849, E5): an agent's duties from its role's templates (`<role>.<duty>`). `addDuty` (422 `template_not_in_role`, 409 `duty_exists`), `nextDue` (the first slot after now, so a missed duty runs once), and `claimDuty` / `sweepDuties`: claim before act, then a `kind = 'duty'` task, or `skipped:agent_paused` / `skipped:no_tokens`. |
| `handoffs.ts` | D1530 (E5): `parseHandoff` (a run's `{"handoff": …}` line), `proposeHandoff` (`not_allowed`, `no_target`, `depth_exceeded`, `handoff_loop`, `chain_ended`; a `propose:handoff` proposal otherwise), `decideHandoff` (Accept makes the target's `kind = 'handoff'` task; Discard ends the chain), `handoffBlockFor` (the why and note as untrusted data) and `chainsOf` (TM13's trail). |
| `memory.ts` | D1530 (E5): notes (`addFact`, `forgetNote`, `forgetAll`), the retention (`RETENTION`: 90 days after removal, 180 days of run summaries; `onAgentRemoved`, `purgeExpired`), the erasure of a project, company or account (`eraseAgentData`) and `exportAgentData` for the account data export. |
| `evaluation.ts` | #3851 (E7): the cost reads (`runCostReader` for tasks, so goals sum them; `agentCosts`), each `{ available: false }` when a charge is unrecorded or the read fails, never 0; and the evaluation board TM14 (`evaluateScope`, `rateRole`): acceptance, edit and discard rates, median time to a decision, open past 3 days, expired, cost per accepted and refusals, per role. Read-only. |
| `alerts.ts` | #3851 (E7): the engine's alerts through `notify()`, each once per its window (a KV key): the cap at 80% and 100%, a task blocked after 3 discards, an approval waiting 3 days, DLQ arrivals, the halt set or cleared, and the `agents` gateway at 70%. `sweepAgentAlerts` runs on the agent sweep's minute. |
| `workBoard.ts` | D1614 W1 (#3969): project board fields and cards over `scope_tasks` (migration 762), transactional moves with actor events, close reasons, per-project numbering, scoped dependency checks (E1's cycle walk; 409 `task_blocked`) and the `unblocked` notice. E3's run store is read through the `WorkRunReader` seam, "no recorded runs" until #3847 supplies one. |
| `workItems.ts` | D1614 W7 (#3993): a project task's comments (cleaned Markdown, mentions through `notify()`), its timeline and derived participants, a person's review, agents' task drafts (proposals until Accept), labels and milestones. Migration 763. `work_items_3993.test.ts` covers it. |
| `workLabels.ts` | D1614 W7: the statements that keep `task_label_links` and W1's `labels_json` mirror in step inside W1's own batch. |

**The rule for adding here.** `catalogue.ts` and `rulebook.ts` stay pure: no
binding, no fetch. A read of the database goes in `teams.ts`, and a gate is
written there once. A new module key must be a slug a cycle already has; a new
rule book section is one entry in `rulebook.ts`'s `SECTIONS`; the floor only
grows. An agent runs only through `agentRun.ts`, and its proposals are decided through `queue.ts`. The engine's runtime (admission, the task Workflow, the agent queue) lives in `cloudflare-worker/src/agents/` (D1528) and calls `agentRun.ts`; a new read for the `context` step is one entry in `reads.ts`'s `READERS`.
`team_agents_d1496.test.ts` covers the registry, the run and the queue, and
`scope_goals_tasks_d1529.test.ts` covers goals and tasks.

## `skills/` (#3953, D1612)

The Axal starter skill library: twelve HQ skills, one SKILL.md file each, in
#3951's format (frontmatter `name`, `description`, `roles`, `tools`, `output`,
`taxonomy`, `version`, then numbered steps), and one golden evaluation case
per skill in `skills/cases/<slug>.json` for part D (#3954). Content only:
A1 (#3951) seeds them into `agent_skills` and `agent_skill_versions`.
`cloudflare-worker/test/agent_skill_library_d1612.test.ts` holds every file to the catalogue.
