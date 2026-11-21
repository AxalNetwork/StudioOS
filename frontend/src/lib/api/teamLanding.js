// D5624 (#5624) — a team's Landing settings: repository, landing tiers and T2
// signers, repair, path owners, per-repository concurrency, compute budget and
// executors. Worker: routes/team_landing.ts; contract:
// merge-control/contract/landingPolicy.ts. 404 `team_landing_off` until
// TEAM_LANDING is "true" and the agent engine is on.
//   GET /api/teams/:scope/:id/landing → { landing, version, updated_at, defaults, caps, can_manage }
//   PUT /api/teams/:scope/:id/landing   { <fields to change>, version? } → the same;
//                                       400 invalid_landing { field }; 403 not_manager; 409 landing_changed
// A field that is null is unset (the defaults apply); sending null resets one.
import { request } from '../api.js';

const base = (scope, id) => `/teams/${encodeURIComponent(scope)}/${encodeURIComponent(id)}/landing`;

export const teamLandingApi = {
  readLanding: (scope, id) => request(base(scope, id)),
  saveLanding: (scope, id, fields) => request(base(scope, id), { method: 'PUT', body: JSON.stringify(fields) }),
};
