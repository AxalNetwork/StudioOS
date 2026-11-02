### HQ › AI agents › Roster (D4158, #4158)

- **Worker:** `routes/admin_ai_agents_roster.ts`, mounted at `/api/admin/ai-agents/roster` by the route registry, Super Admin only (`requireSuperAdmin`). Served by `services/agents/rosterAdmin.ts`.
  - `GET /roster` (SA1): the 16 personas, each with `status` (`offered` | `hidden` | `retired`), `defaults` (`model`, `start_cap_usd`, `max_cap_usd`) and 30-day `usage` (`teams`, `runs`, `spend_usd`, `accepted_pct`, `failed_pct`), and `counts` by status.
  - `GET /roster/:key` (SA2): the same, with `teams` (company › project, by name), the five most-used `skills` and the `history` (its audit rows).
  - `PATCH /roster/:key` (SA2, SA2b): `status`, or the identity fields `name`, `tagline`, `story`, `goal`, `avatar`; a rename needs `trademark_checked: true`.
  - `PUT /roster/:key/defaults` (SA2): `{ model, start_cap_usd, max_cap_usd }`.
- **Store:** `ai_persona_settings` (migration `202611022304_ai_persona_settings.sql`), one row per changed persona. Each write also adds one `ai_admin_audit` row in the same batch.
- **Rules:** every write takes a `reason` of at least 10 characters. Values, risk and natural fit are never writable. Hidden: out of `GET /api/teams/personas`, and a new team cannot add it; teams that have it keep it. Retired: also its live agents are paused (`persona_retired`) and cannot be resumed by the team while it stays retired; open proposals stay decidable. The maximum cap holds on the team routes' add and cap change. A usage figure no store holds is `null`, never 0. No email.
- **Refusals:** 401 signed out; 403 anyone but a Super Admin; 400 `values_fixed`, `reason_required`, `reason_too_long`, `trademark_unchecked`, `invalid_field`, `invalid_status`, `invalid_cap`, `start_above_max`, `no_change`, `invalid_body`; 404 `not_found`; 409 `name_taken`; 422 `model_not_offered`, `cap_above_platform`. On the team routes: 409 `persona_unavailable` (add), 409 `persona_retired` (resume), 422 `cap_above_max`.
- **Client:** `lib/api/adminAiAgents.js` (`roster`, `rosterAgent`, `rosterUpdate`, `rosterDefaults`); the Roster tab of `pages/hq/aiAgents/`.
