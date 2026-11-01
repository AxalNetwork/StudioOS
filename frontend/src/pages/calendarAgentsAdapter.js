/**
 * D1613 (#3723) — THE SEAM between the Calendar's AI agent sessions (boards
 * CAL8 to CAL11) and #3957's routes. Every session read and write the Calendar
 * draws comes through this file and nowhere else, in the Team seam's shape
 * (`pages/team/agentsAdapter.js`): `{ available: true, value }` or
 * `{ available: false, reason }`.
 *
 * NOTHING IS WIRED YET. #3957 (on #3849's `agent_duties`) adds the routes; its
 * builder adds each client method in the same PR as its route and replaces
 * only the matching one-line body with `through(() => <api>.<method>(…))`:
 *
 *   schedulable()                 GET    the agents the viewer may schedule, by company then project
 *   agentSkills(uid)              GET    that agent's role skills (#3956's agent skills read)
 *   estimate(uid, body)           POST   the per-session and month estimate, and the cap used
 *   schedule(uid, body)           POST   /api/agents/:uid/duties with #3957's new fields
 *   session(id)                   GET    one session: state, schedule, sponsor, last runs, `can`
 *   reschedule(id, body)          PATCH  the session's time or repeat
 *   pause(id)                     PATCH  pause the schedule (the agent is untouched)
 *   cancel(id)                    DELETE the session
 *   runNow(id)                    POST   one manual run, with its hold shown first
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 */
import { AGENTS_OFF_REASON, through, unavailable } from './team/agentsAdapter.js';

export { AGENTS_OFF_REASON, through };

const off = async () => unavailable();

export const schedulable = () => off();
export const agentSkills = (/* uid */) => off();
export const estimate = (/* uid, body */) => off();
export const schedule = (/* uid, body */) => off();
export const session = (/* id */) => off();
export const reschedule = (/* id, body */) => off();
export const pause = (/* id */) => off();
export const cancel = (/* id */) => off();
export const runNow = (/* id */) => off();
