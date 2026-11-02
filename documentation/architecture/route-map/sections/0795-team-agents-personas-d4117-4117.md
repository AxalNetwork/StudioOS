### Team agents: the 16 personas (D4117, #4117, Roster R1 of #4116)

Worker routes in `routes/team_agents.ts`, mounted at `/api/teams`. The catalogue is `services/agents/personas.ts` (code, no table), and an agent's persona is `team_agents.persona_key` (migration `202611021728_team_agents_persona.sql`). Behind `TEAM_AGENTS_ENABLED` like the rest of `/api/teams`. No client method yet: the gallery, the cards and the Add flow are R3's.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/personas` | signed in | `{ personas: [Persona], values: [{ key, label, description }], areas: [{ slug, label }] }`. The 16, in #4116's order; the six Axal values (`FIT_V2_VALUES`, `services/axalFit.ts`) with their words; the eight radar areas. Fixed: no route edits a persona. |
| `POST /api/teams/:scope/:id/agents` (changed) | as before | Also takes `persona_key`; absent, the role's default persona (`DEFAULT_PERSONA_BY_ROLE`). 400 `invalid_persona`; 409 `persona_on_team` when that persona is already live on this Team, counting an older agent's role default. `role_taken` is still checked first. |
| Every agent read (changed) | as before | `Agent` also carries `persona: Persona`, its own or its role's default. `role_name` is now the work the role covers ("Engineering", "Finance"), never a job title. |
| `GET /api/teams/agents/:uid` (changed) | as before | `matrix` comes from the agent's skills: the union of the rule books of the roles its pinned skills serve, or its own role's while it has none (`agentBook`, `services/agents/teams.ts`). The run, task fit and `module=` filter use the same book. |

`Persona` is `{ key, name, gender, tagline, personality, goal, story, risk (1–5), values: { integrity, stewardship, curiosity, resilience, collaboration, ambition } (0..1), natural_fit: [area, area], avatar: '/agents/<key>.webp' }`. There is no family name, no philosophy, no trade-off and no Schwartz value.
