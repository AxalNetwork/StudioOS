### Team agents: changing the sponsor, and the cap resume (D4387, #4387)

Worker routes in `routes/team_agents.ts`, beside `PATCH /api/teams/agents/:uid` and behind the same flag and gates, checked by `services/agents/sponsor.ts`; migration `202611040924_team_agent_sponsor_changes.sql` adds the event kind `sponsor_changed`. The client is `teamAgentsApi.sponsorCandidates` and `teamAgentsApi.changeSponsor`, through `agentsAdapter`; the screen is `pages/team/SponsorSheet.jsx`, opened from TM9b's "Choose a new sponsor" and the profile's "Change sponsor".

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/teams/agents/:uid/sponsors` | manage | `{ sponsor: { uid, name } \| null, candidates: [{ uid, name, current, can_sponsor, code, reason }] }`: the team's members (at most 100) and, for each who cannot sponsor, the refusal's code and words. 403 `not_member` / `not_manager`; 404; 409 `removed`. |
| `PUT /api/teams/agents/:uid/sponsor` | manage | Takes `{ sponsor_uid, reason, drop_tools? }`; `{ agent }`. The new sponsor is on the team, an editor, on a paid Founder plan and has AI tokens. A `sponsor_changed` event names the caller, both sponsors and the reason; an agent paused `sponsor_left` resumes. 400 `reason_required` (10 to 500 characters); 409 `same_sponsor` / `removed` / `sponsor_changed_meanwhile`; 422 `sponsor_not_found` / `sponsor_not_member` / `sponsor_cannot_manage` / `sponsor_plan_required` / `sponsor_no_tokens` / `sponsor_tools` (with `tools`; send `drop_tools: true`); 503 `sponsor_balance_unreadable`. |

Every `Agent` also carries `resumes_at`: for an agent paused at its cap, the first day (UTC, `YYYY-MM-DD`) of the month after its pause, the day the agent sweep (`sweepAgents`, every 5 minutes while team agents are on) resumes it; `null` for every other agent. The sweep resumes `paused_reason = 'cap'` only, never a manual, HQ, platform or other pause.
