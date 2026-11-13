/**
 * D1613 (#3723) — THE SEAM between the Calendar's AI agent sessions (boards
 * CAL8 to CAL11) and #3957's routes. Every session read and write the Calendar
 * draws comes through this file and nowhere else, in the Team seam's shape
 * (`pages/team/agentsAdapter.js`): `{ available: true, value }` or
 * `{ available: false, reason }`.
 *
 * WIRED (#3957, on #3849's `agent_duties`): every method below goes through
 * `agentEngineApi` (`lib/api/agentEngine.js`), and `agentSkills` through
 * #3956's `teamAgentsApi.agentSkills` (the skills ASSIGNED to the agent, S1's
 * decision of 2026-11-02):
 *
 *   schedulable()                 GET    /api/teams/sessions/agents
 *   agentSkills(uid)              GET    /api/teams/agents/:uid/skills
 *   estimate(uid, body)           POST   /api/teams/agents/:uid/sessions/estimate
 *   schedule(uid, body)           POST   /api/teams/agents/:uid/duties with #3957's fields
 *   session(id)                   GET    /api/teams/sessions/:uid
 *   reschedule(id, body)          PATCH  /api/teams/sessions/:uid
 *   pause(id)                     PATCH  /api/teams/sessions/:uid { status: 'paused' }
 *   cancel(id)                    DELETE /api/teams/sessions/:uid
 *   runNow(id)                    POST   /api/teams/sessions/:uid/run
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 */
import { AGENTS_OFF_REASON, through } from './team/agentsAdapter.js';
import { agentEngineApi } from '../lib/api/agentEngine.js';
import { teamAgentsApi } from '../lib/api/teamAgents.js';

export { AGENTS_OFF_REASON, through };

export const schedulable = () => through(() => agentEngineApi.schedulableAgents());
export const agentSkills = (uid) => through(() => teamAgentsApi.agentSkills(uid));
export const estimate = (uid, body) => through(() => agentEngineApi.sessionEstimate(uid, body));
export const schedule = (uid, body) => through(() => agentEngineApi.scheduleSession(uid, body).then((r) => r?.session ?? r));
export const session = (id) => through(() => agentEngineApi.session(id).then((r) => r?.session ?? r));
export const reschedule = (id, body) => through(() => agentEngineApi.updateSession(id, body));
export const pause = (id) => through(() => agentEngineApi.updateSession(id, { status: 'paused' }));
export const cancel = (id) => through(() => agentEngineApi.cancelSession(id));
export const runNow = (id) => through(() => agentEngineApi.runSession(id));
