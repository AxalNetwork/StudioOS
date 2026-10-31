/**
 * D1497 (#3727) — THE SEAM between the Team screens and the agent routes.
 *
 * Every agent, rule book, approval, agent setting and run the Team page draws
 * comes through this file and nowhere else. None of those routes exists on
 * this base, so every read answers `{ available: false, reason }` and every
 * write refuses the same way. The screens draw the canvas's own unavailable
 * state from it: "AI agents aren't switched on yet. That is not the same as
 * having none." Nothing here may claim "no agents" (`{ available: true,
 * value: [] }` is a fact only the Worker can state).
 *
 * WHERE THE BUILDERS SWAP IN THE REAL CLIENT. Each body below is one line.
 * When a route lands, its PR adds the method to `frontend/src/lib/api/teamAgents.js`
 * (D527, re-exported by one line in `api.js`) and replaces only the matching
 * body here with `through(() => teamAgentsApi.<method>(…))`:
 *
 *   #3840 (part 1)  roles · listAgents · addAgent · agent · updateAgent ·
 *                   removeAgent · rulebook · saveRulebook
 *   #3842 (part 2)  runQuote · runAgent
 *   #3843 (part 3)  queue · queueItem · decide
 *   #3844 (part 5)  toolChoices
 *
 * `through` already maps the Worker's refusals onto what the page draws, so a
 * swap changes no screen: 404 `team_agents_off` is unavailable, 403
 * `plan_required` is the plan lock (TM9c4), a 403 is a refusal in words, and
 * anything else is unreadable (TM9c1), never empty.
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 * People and invitations are not behind this seam: they landed with #3841 in
 * `lib/api/teams.js` (`teamsApi`) and the screens call it directly. Agents get
 * their own module, `teamAgents.js`, not a method on `teamsApi`.
 */
import { FLOOR, refusalWords } from './teamModel.js';

export const AGENTS_OFF_REASON = 'AI agents aren’t switched on yet.';

/** The one answer every agent read gives on this base. */
export const unavailable = (reason = AGENTS_OFF_REASON) => ({ available: false, reason });

const off = async () => unavailable();

/**
 * A client call, as the page reads it. `{ available: true, value }` on
 * success; otherwise unavailable, locked by plan, refused or unreadable.
 */
export async function through(call) {
  try {
    return { available: true, value: await call() };
  } catch (e) {
    const status = e?.status ?? e?.response?.status ?? null;
    const code = e?.code || e?.data?.code || e?.data?.error || null;
    if (status === 404 && code === 'team_agents_off') return unavailable();
    if (status === 403 && code === 'plan_required') return { available: false, locked: 'plan', reason: refusalWords('plan_required') };
    if (status === 403) return { available: false, refused: true, reason: refusalWords(code) };
    if (status === 422 && code === 'rule_floor') {
      // The floor item the change dropped, when the Worker names it, is outlined in the sheet (TM4c).
      const item = e?.data?.item || null;
      const label = (FLOOR.find(([k]) => k === item) || [])[1];
      return { available: false, refused: true, highlight: item, reason: refusalWords('rule_floor', label) };
    }
    if (status === 409 && code === 'not_open') {
      // Who decided it, and when and how when the Worker says (TM7b2: "Accepted 31 Oct 09:40 by …").
      const d = e?.data || {};
      const decided = d.decided_by ? { by: d.decided_by, at: d.decided_at || d.decided_by.at || null, decision: d.decision || d.decided_by.decision || null } : null;
      return { available: false, refused: true, code, decided, reason: refusalWords(code, d.decided_by?.name) };
    }
    if (status === 409 || status === 422) return { available: false, refused: true, code, reason: refusalWords(code, e?.data?.decided_by?.name) };
    return { available: false, unreadable: true, reason: 'could not be read' };
  }
}

// ---------------------------------------------------------------- #3840 part 1

/** `GET /api/teams/roles` → `{ roles: [{ key, name, mission, works_in, default_rules }] }`. */
export const roles = off;
/** `GET /api/teams/:scope/:id/agents?include=&module=` → `{ can_manage, plan_ok, agents }`. */
export const listAgents = (/* scope, id, { include, module } */) => off();
/** `POST /api/teams/:scope/:id/agents`. */
export const addAgent = (/* scope, id, body */) => off();
/** `GET /api/teams/agents/:uid` → the profile: matrix, budget, proposals, events. */
export const agent = (/* uid */) => off();
/** `PATCH /api/teams/agents/:uid` → `{ status?, monthly_cap_microusd?, first_name?, last_name? }`. */
export const updateAgent = (/* uid, patch */) => off();
/** `DELETE /api/teams/agents/:uid`. */
export const removeAgent = (/* uid */) => off();
/** `GET /api/teams/:scope/:id/rulebooks/:role`. */
export const rulebook = (/* scope, id, role */) => off();
/** `PUT /api/teams/:scope/:id/rulebooks/:role`. */
export const saveRulebook = (/* scope, id, role, rules */) => off();

// ---------------------------------------------------------------- #3842 part 2

/** `GET /api/teams/agents/:uid/run/quote` → the hold shown before a run. */
export const runQuote = (/* uid, { module, option } */) => off();
/** `POST /api/teams/agents/:uid/run`. */
export const runAgent = (/* uid, body */) => off();

// ---------------------------------------------------------------- #3843 part 3

/** `GET /api/teams/:scope/:id/queue` → `{ items, decided, counts }`; `counts` is a block, never 0 for unread. */
export const queue = (/* scope, id, filters */) => off();
/** `GET /api/teams/queue/:proposalUid`. */
export const queueItem = (/* proposalUid */) => off();
/** `POST /api/teams/queue/:proposalUid/decide` → 409 `not_open` carries `decided_by`. */
export const decide = (/* proposalUid, { decision, payload } */) => off();

// ---------------------------------------------------------------- #3844 part 5

/** `GET /api/teams/tools` → the sponsor's approved read tools. */
export const toolChoices = off;
