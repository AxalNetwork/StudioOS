### Calendar: AI agent work sessions (D1613 §6, #3957)

- **Worker:** on `agent_engine.ts`'s router, behind the engine's flag. Served by `services/agents/sessions.ts`, on E5's `agent_duties` (`kind = 'session'`, migration `202611022045_agent_duty_sessions.sql`).
  - `GET /api/teams/sessions/agents` lists the agents a member may schedule.
  - `POST /api/teams/agents/:uid/sessions/estimate` returns `{ per_session_cents, month_cents, cap_used_cents, cap_cents }`, null when unread.
  - `POST /api/teams/agents/:uid/duties` with `skill_id` makes a session.
  - `GET`, `PATCH` and `DELETE /api/teams/sessions/:uid`, and `POST /api/teams/sessions/:uid/run`.
  - Refusals: 422 `skill_not_in_role`, `target_not_readable`, `run_at_past` and `over_cap`; 409 `agent_paused`.
- **Calendar read:** the `agent_session` kind ("AI agents", page only, the team's members alone), with each session's slots and runs, its state and its proposals waiting.
- **Client:** `lib/api/agentEngine.js`; `pages/calendarAgentsAdapter.js` goes through it.
