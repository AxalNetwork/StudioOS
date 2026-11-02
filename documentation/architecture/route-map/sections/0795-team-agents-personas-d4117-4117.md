### Team agents: the 16 personas (D4117, #4117, Roster R1 of #4116)

Worker route in `routes/team_agents.ts`, backed by `services/agents/personas.ts` (code, frozen; no table) and migration `202611021724_team_agents_persona.sql` (`team_agents.persona_key`, one live agent per persona per Team).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/personas` | signed in | `{ personas: [Persona], values: [{ key, label, description }], areas }`: the 16 personas in the roster's order, the 6 Axal values in `FIT_V2_VALUES` order with `axalFit.ts`'s words, and the 8 areas in the SkillRadar's order. No route writes a persona. |

`Persona` is `{ key, name, gender, tagline, goal, personality, story, risk (1–5), values: { integrity, stewardship, curiosity, resilience, collaboration, ambition } (0..1), top_values, natural_fit: [area, area], avatar: '/agents/<key>.webp' }`.

Every agent DTO (`Agent` and the queue's `Item.agent`) carries `persona` (that object, or null for a role the backfill had no persona for) and no job title: `role_name` is gone, and `role_key` stays only to key the rule book. `POST /api/teams/:scope/:id/agents` takes `persona_key` (the role's default persona when omitted); 400 `invalid_persona`; 409 `persona_on_team` (`{ persona_key }`) when that persona is live on the Team; `role_taken` still answers first when the role is taken.
