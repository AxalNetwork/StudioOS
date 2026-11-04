/**
 * D1497 (#3727) — THE SEAM between the Team screens and the agent routes.
 *
 * Every agent, rule book, approval, agent setting and run the Team page draws
 * comes through this file and nowhere else. A read answers `{ available:
 * true, value }` or `{ available: false, reason }` (with `locked`, `refused`
 * or `unreadable` saying why); a write answers the same way. Nothing here may
 * claim "no agents" on its own: `{ available: true, value: { agents: [] } }`
 * is a fact only the Worker states.
 *
 * WIRED (#3840, D1496, part 1): `roles`, `listAgents`, `addAgent`, `agent`,
 * `updateAgent`, `removeAgent`, `rulebook` and `saveRulebook` (and D4387's
 * `sponsorCandidates` and `changeSponsor`, through `throughSponsor`) call
 * `teamAgentsApi` (`frontend/src/lib/api/teamAgents.js`, added by #3840 with
 * its routes in `cloudflare-worker/src/routes/team_agents.ts`). Every one of
 * those routes answers 404 `team_agents_off` while `TEAM_AGENTS_ENABLED` is
 * off, which `through` draws as "AI agents aren’t switched on yet."
 *
 * WIRED (#3727 integration): #3842's runQuote/runAgent, #3843's queue,
 * queueItem/decide and #3844's toolChoices use their merged clients too.
 * The adapter preserves their DTOs; Approvals maps the Worker's queue fields
 * onto TM7. Feature switches and permission refusals remain server-owned.
 *
 * HOW #3840'S REFUSALS ARE DRAWN (`through`):
 *   404 `team_agents_off`        unavailable: the switched-off state
 *   403 `plan_required`          the plan lock (TM9c4). Only `POST …/agents`
 *                                sends it; the list says `plan_ok` instead,
 *                                and the page reads that (`agentOff`)
 *   403 `not_member`/`not_manager` a refusal in words
 *   422 `rule_floor`             `{ section }`: the floor item the edit dropped
 *                                is worked out from the rules sent and outlined
 *                                (TM4c); `may_do_automatically` says nothing is
 *                                automatic
 *   400/409/422 with a code      a refusal in words (`invalid_cap`,
 *                                `invalid_name`, `invalid_rules`, `role_taken`,
 *                                `removed`, `rulebook_changed`,
 *                                `model_not_offered`, `tool_not_approved`)
 *   anything else                unreadable (TM9c1), never empty
 *
 * NO CLIENT METHOD IS ADDED HERE OR IN `lib/api` FOR A ROUTE THAT DOES NOT
 * EXIST: the drift test (`scripts/check-api-drift.mjs`) resolves every one.
 * People and invitations are not behind this seam: they landed with #3841 in
 * `lib/api/teams.js` (`teamsApi`) and the screens call it directly.
 */
import { teamAgentsApi } from '../../lib/api/teamAgents.js';
import { FLOOR, RULEBOOK_SECTIONS, refusalWords } from './teamModel.js';
import { fromWorkerLibrary, fromWorkerSkillPage, skillRefusalWords } from './skillsModel.js';

export const AGENTS_OFF_REASON = 'AI agents aren’t switched on yet.';

/** The switched-off answer: every #3840 route while `TEAM_AGENTS_ENABLED` is off, and every unbuilt function below. */
export const unavailable = (reason = AGENTS_OFF_REASON) => ({ available: false, reason });

const off = async () => unavailable();

/** The first floor item `rules.always_asks_human` dropped, or null. */
export function droppedFloorItem(rules) {
  const asks = Array.isArray(rules?.always_asks_human) ? rules.always_asks_human : [];
  return (FLOOR.find(([k]) => !asks.includes(k)) || [])[0] || null;
}

/**
 * A client call, as the page reads it. `{ available: true, value }` on
 * success; otherwise unavailable, locked by plan, refused or unreadable.
 * `sent` is what a write sent, so a refusal can point at the part of it that
 * was refused (the rule book's dropped floor item).
 */
export async function through(call, sent = null) {
  try {
    return { available: true, value: await call() };
  } catch (e) {
    const status = e?.status ?? e?.response?.status ?? null;
    const code = e?.code || e?.data?.code || e?.data?.error || null;
    if (status === 404 && (code === 'team_agents_off' || code === 'custom_mcp_off')) return unavailable(code === 'custom_mcp_off' ? 'Connected read-only tools aren’t switched on yet.' : AGENTS_OFF_REASON);
    if (status === 403 && code === 'plan_required') return { available: false, locked: 'plan', reason: refusalWords('plan_required') };
    if (status === 403) return { available: false, refused: true, code, reason: refusalWords(code) === refusalWords('') ? (e?.message || refusalWords(code)) : refusalWords(code) };
    if (status === 422 && code === 'rule_floor') {
      // #3840 names the section; the floor item outlined is the first one the rules sent dropped (TM4c).
      if (e?.data?.section === 'may_do_automatically') return { available: false, refused: true, code, highlight: null, reason: refusalWords('auto_floor') };
      const item = droppedFloorItem(sent?.rules);
      const label = (FLOOR.find(([k]) => k === item) || [])[1];
      return { available: false, refused: true, code, highlight: item, reason: refusalWords('rule_floor', label) };
    }
    if (status === 422 && code === 'invalid_rules') {
      const label = (RULEBOOK_SECTIONS.find(([k]) => k === e?.data?.section) || [])[1];
      return { available: false, refused: true, code, reason: refusalWords(code, label) };
    }
    if (status === 409 && code === 'not_open') {
      // Who decided it, and when and how when the Worker says (TM7b2: "Accepted 31 Oct 09:40 by …").
      const d = e?.data || {};
      const decided = d.decided_by || d.status ? { by: d.decided_by, at: d.decided_at || d.decided_by?.at || null, decision: d.decision || d.status || d.decided_by?.decision || null } : null;
      return { available: false, refused: true, code, decided, reason: refusalWords(code, d.decided_by?.name) };
    }
    if ((status === 400 || status === 402 || status === 409 || status === 422 || status === 503) && code) return { available: false, refused: true, code, reason: refusalWords(code) === refusalWords('') ? (e?.message || refusalWords(code)) : refusalWords(code, e?.data?.decided_by?.name) };
    return { available: false, unreadable: true, reason: 'could not be read' };
  }
}

// ---------------------------------------------------------------- #3840 part 1: wired

/** `GET /api/teams/roles` → `{ roles: [{ key, name, mission, works_in: [{ key, label }], default_rules }] }`. No model list. */
export const roles = () => through(() => teamAgentsApi.roles());
/** D4119: `GET /api/teams/personas` (D4117) → `{ personas, values, areas }`, the 16 fixed personas for the gallery. */
export const personas = () => through(() => teamAgentsApi.personas());
/** `GET /api/teams/:scope/:id/agents?include=&module=` → `{ can_manage, plan_ok, agents }`. */
export const listAgents = (scope, id, opts = {}) => through(() => teamAgentsApi.listAgents(scope, id, opts));
/** `POST /api/teams/:scope/:id/agents` → 201 `{ agent }`. */
export const addAgent = (scope, id, body) => through(() => teamAgentsApi.addAgent(scope, id, body));
/** `GET /api/teams/agents/:uid` → `{ agent, can_manage, rulebook, matrix, cap_microusd, month_spend, proposals, events }`. */
export const agent = (uid) => through(() => teamAgentsApi.agent(uid));
/** `PATCH /api/teams/agents/:uid` `{ status?, monthly_cap_microusd?, first_name?, last_name? }` → `{ agent }`. */
export const updateAgent = (uid, patch) => through(() => teamAgentsApi.updateAgent(uid, patch));
/** `DELETE /api/teams/agents/:uid` → `{ ok: true }`: open proposals withdrawn, history kept. */
export const removeAgent = (uid) => through(() => teamAgentsApi.removeAgent(uid));
/**
 * D4387 (#4387): the sponsor change. A refusal is drawn in the Worker's own
 * words, each code its own sentence (`sponsor_not_member`, `sponsor_plan_required`,
 * `sponsor_no_tokens`, `sponsor_tools` with its `tools` count, …); an answer
 * with no code is unreadable, never a success.
 */
export async function throughSponsor(call) {
  try {
    return { available: true, value: await call() };
  } catch (e) {
    const status = e?.status ?? e?.response?.status ?? null;
    const code = e?.code || e?.data?.code || e?.data?.error || null;
    if (status === 404 && code === 'team_agents_off') return unavailable();
    if (code && [400, 403, 404, 409, 422, 503].includes(status) && e?.message) {
      return { available: false, refused: true, code, reason: e.message, tools: Number(e?.data?.tools) || null };
    }
    return { available: false, unreadable: true, reason: 'could not be read' };
  }
}
/** `GET /api/teams/agents/:uid/sponsors` → `{ sponsor, candidates: [{ uid, name, current, can_sponsor, code, reason }] }`. */
export const sponsorCandidates = (uid) => throughSponsor(() => teamAgentsApi.sponsorCandidates(uid));
/** `PUT /api/teams/agents/:uid/sponsor` `{ sponsor_uid, reason, drop_tools? }` → `{ agent }`. */
export const changeSponsor = (uid, body) => throughSponsor(() => teamAgentsApi.changeSponsor(uid, body));
/** `GET /api/teams/:scope/:id/rulebooks/:role` → `{ role_key, default, effective, version, versions, diff, floor }`. */
export const rulebook = (scope, id, role) => through(() => teamAgentsApi.rulebook(scope, id, role));
/** `PUT /api/teams/:scope/:id/rulebooks/:role` `{ rules }` → `{ effective, version }`. */
export const saveRulebook = (scope, id, role, rules) => through(() => teamAgentsApi.saveRulebook(scope, id, role, rules), { rules });

// ---------------------------------------------------------------- #3842 part 2

/** `GET /api/teams/agents/:uid/run/quote` → the hold shown before a run. */
export const runQuote = (uid, opts = {}) => through(() => teamAgentsApi.runQuote(uid, opts));
/** `POST /api/teams/agents/:uid/run`. */
export const runAgent = (uid, body) => through(() => teamAgentsApi.runAgent(uid, body));

// ---------------------------------------------------------------- #3843 part 3

/** `GET /api/teams/:scope/:id/queue` → `{ items, counts, next_cursor }`; `counts` is a block, never 0 for unread. */
export const queue = (scope, id, filters = {}) => through(() => teamAgentsApi.queue(scope, id, filters));
/** `GET /api/teams/queue/:proposalUid`. */
export const queueItem = (proposalUid) => through(() => teamAgentsApi.queueItem(proposalUid));
/** `POST /api/teams/queue/:proposalUid/decide` → 409 `not_open` carries `decided_by`. */
export const decide = (proposalUid, body) => through(() => teamAgentsApi.decide(proposalUid, body));

// ---------------------------------------------------------------- #3844 part 5

/** `GET /api/teams/tools` → the sponsor's approved read tools. */
export const toolChoices = () => through(() => teamAgentsApi.toolChoices());

// ---------------------------------------------------------------- D1612 skills: A1 (#3951) and A2 (#3956)
//
// Team › Skills (boards SK0–SK9). Every body stays `off()` until its route
// lands; the builder replaces only the body with
// `throughSkill(() => teamAgentsApi.<method>(…))` and adds the method to
// `lib/api/teamAgents.js` in the same PR. The shapes are #3951's and #3956's.

/** `through`, with the skill refusals (A1, A2) in their own words. */
export async function throughSkill(call) {
  const out = await through(call);
  if (out.refused && out.code) return { ...out, reason: skillRefusalWords(out.code) };
  return out;
}

// A1 #3951 — the library
/** An answer's value through a pure shape, leaving every unavailable answer as it was. */
const shaped = (out, fn) => (out.available ? { ...out, value: fn(out.value) } : out);
/**
 * `GET /api/teams/skills?company=<uid>` (wired by #4224) → `{ can_edit, figures, skills }`.
 * Axal's skills, and the company's when `companyUid` is one the member belongs to.
 */
export const skillLibrary = async (companyUid) => shaped(await throughSkill(() => teamAgentsApi.skillLibrary(companyUid)), fromWorkerLibrary);
/** `GET /api/teams/skills/:uid` (wired by #4224) → `{ skill (with steps, markdown, versions), can_edit }`. */
export const skill = async (uid) => shaped(await throughSkill(() => teamAgentsApi.skill(uid)), fromWorkerSkillPage);
/** `POST /api/teams/:scope/:id/skills` → 201 `{ skill }`, a draft. */
export const createSkill = (/* scope, id, body */) => off();
/** `PATCH /api/teams/skills/:uid` → `{ skill }`. */
export const updateSkill = (/* uid, patch */) => off();
/** `POST /api/teams/skills/:uid/publish` → `{ skill, version }`. */
export const publishSkill = (/* uid, { note } */) => off();
/** `POST /api/teams/:scope/:id/skills/import { markdown }` → 201 `{ skill, problems }`, always a draft. */
export const importSkill = (/* scope, id, markdown */) => off();

// A2 #3956 — agents and skills: wired to `teamAgentsApi` with their routes (D1612 A2).
/** `GET /api/teams/agents/:uid/skills` → `{ can_manage, skills, radar, values }`. */
export const agentSkills = (uid) => throughSkill(() => teamAgentsApi.agentSkills(uid));
/** `PUT /api/teams/agents/:uid/skills { skills: [{ uid, version }] }` → the same shape. */
export const setAgentSkills = (uid, skills) => throughSkill(() => teamAgentsApi.setAgentSkills(uid, skills));
/** `GET /api/teams/agents/:uid/skills/available` → `{ skills }`, each with `blocked`. */
export const availableSkills = (uid) => throughSkill(() => teamAgentsApi.availableSkills(uid));
/** `GET /api/teams/skills/:uid/agents` → `{ agents }` the member can see. */
export const skillAgents = (uid) => throughSkill(() => teamAgentsApi.skillAgents(uid));
/** `GET /api/teams/skills/:uid/assignable` → `{ agents }`, each with `assigned` and `blocked`. */
export const assignable = (uid) => throughSkill(() => teamAgentsApi.assignable(uid));
/** `POST /api/teams/skills/:uid/assign { agent_uids }` → `{ added, refused }`. */
export const assignSkill = (uid, agentUids) => throughSkill(() => teamAgentsApi.assignSkill(uid, agentUids));
/** `GET /api/teams/:scope/:id/coverage` → `{ axes: [{ slug, label, people_level, agent_level }] }`. */
export const coverage = (scope, id) => throughSkill(() => teamAgentsApi.coverage(scope, id));
/** D4121 (#4121): the agent's cost per run with `add` skills added and `remove` taken off; `{ available: false }` when pricing cannot be read. */
export const costEstimate = (uid, change = {}) => throughSkill(() => teamAgentsApi.costEstimate(uid, change));
/** D4121: the same for an agent not yet added (AG3, the Add-an-agent Skills step). */
export const draftCostEstimate = (scope, id, draft) => throughSkill(() => teamAgentsApi.draftCostEstimate(scope, id, draft));
