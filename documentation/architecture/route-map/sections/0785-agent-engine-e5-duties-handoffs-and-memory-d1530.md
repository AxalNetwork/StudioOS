### Agent engine E5: duties, handoffs and memory (D1530, #3849)

These routes use the same router (`routes/agent_engine.ts`) and flags as E1. They are backed by:
- `services/agents/duties.ts`;
- `services/agents/handoffs.ts`;
- `services/agents/memory.ts`.

There is no migration: migration 728 holds `agent_duties`, `agent_handoffs` and `agent_memory_notes`.

The client methods are on `agentEngineApi`: `duties`, `addDuty`, `updateDuty`, `removeDuty`, `handoffs`, `memory`, `addMemoryFact`, `forgetMemory` and `forgetAllMemory`.

How the pieces run:
- **Duties.** The 5-minute agent sweep claims due duties (`sweepAgentDuties`, claim before act).
- **Handoffs.** A handoff is proposed by a run's output and decided in #3727's approvals queue (`propose:handoff`). It is not a route.
- **The account export.** `GET /api/settings/data-export` now carries `agents`: `exportAgentData`, the agents, rule books, memory notes and run history the member can see.

| Route | Gate | What it does |
| --- | --- | --- |
| `GET /api/teams/agents/:uid/duties` | read | `{ duties: [{ uid, template, title, module, option, cadence, weekday, day_of_month, hour_utc, next_due_at, last_outcome, status, est_month: { available, value_microusd } }] }`. The estimate is one run's quote times the schedule's runs, `available: false` when unknown, never 0. |
| `POST /api/teams/agents/:uid/duties` | manage | Takes `{ template, cadence?, weekday?, day_of_month?, hour_utc?, title? }`; 201 `{ duty }`. 422 `template_not_in_role` (another role's template, or one the rule book no longer allows); 409 `duty_exists` or `too_many_duties`; 400 `invalid_duty`. |
| `PATCH /api/teams/duties/:uid` | manage | `{ duty }`: the schedule, the title, or `status` `active` / `paused`. The next slot is worked out again. |
| `DELETE /api/teams/duties/:uid` | manage | `{ ok }`. |
| `GET /api/teams/:scope/:id/handoffs` | read | `{ chains: [{ uid, steps: [{ uid, depth, from: { role_key }, to: { role_key }, title, status, refusal, decided_by: { uid, name } \| null, task_created }], refused: [{ reason }] }] }`. 403 `not_member`. |
| `GET /api/teams/agents/:uid/memory` | read | `{ notes: [{ uid, kind, body, by, at, expires_at }], retention: { days_after_removal: 90, run_summaries_days: 180, text } }`. |
| `POST /api/teams/agents/:uid/memory` | manage | A fact: `{ body }` → 201 `{ note }`. 422 `note_too_long` (over 1,000 characters); 400 `invalid_note`. |
| `DELETE /api/teams/memory/:uid` | manage | "Forget this": `{ ok }`. |
| `DELETE /api/teams/agents/:uid/memory` | manage | "Forget everything": `{ ok, forgotten }`. |
