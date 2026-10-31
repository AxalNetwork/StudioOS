// D1496 (#3840, part 1 of #3727) — team agents: the role catalogue, a company's
// or a project's agents, and their rule books. S1's Team page calls these
// through `pages/team/agentsAdapter.js`. Parts 2 (run) and 3 (queue) add their
// methods here.
// Worker: routes/team_agents.ts, migration 712. Every route answers 404
// `team_agents_off` until TEAM_AGENTS_ENABLED is on.
//   GET    /api/teams/roles                               → { roles: [{ key, name, mission, works_in: [{ key, label }], default_rules }] }
//   GET    /api/teams/:scope/:id/agents?include=&module=  → { can_manage, plan_ok, agents: [Agent] }
//   POST   /api/teams/:scope/:id/agents                   { role_key, first_name?, last_name?, model_id, tool_grants?, monthly_cap_microusd }
//                                                         → 201 { agent }; 403 not_manager | plan_required; 409 role_taken;
//                                                           422 model_not_offered | tool_not_approved
//   GET    /api/teams/agents/:uid                         → { agent, can_manage, rulebook, matrix, cap_microusd, month_spend, proposals, events }
//   PATCH  /api/teams/agents/:uid                         { status?, monthly_cap_microusd?, first_name?, last_name? } → { agent }
//   DELETE /api/teams/agents/:uid                         → { ok: true }
//   GET    /api/teams/:scope/:id/rulebooks/:role          → { role_key, default, effective, version, versions, diff, floor }
//   PUT    /api/teams/:scope/:id/rulebooks/:role          { rules } → { effective, version }; 422 rule_floor | invalid_rules
// `:scope` is 'company' (its uid) or 'project' (its id). A person is { uid, name },
// never an email. `month_spend` is { available: false } when it cannot be read:
// the page says "Not recorded", never 0.
import { request } from '../api.js';

const enc = encodeURIComponent;
const base = (scope, id) => `/teams/${enc(scope)}/${enc(id)}`;

export const teamAgentsApi = {
  roles: () => request('/teams/roles'),
  listAgents: (scope, id, { include, module } = {}) => {
    const q = new URLSearchParams();
    if (include) q.set('include', include);
    if (module) q.set('module', module);
    const qs = q.toString();
    return request(`${base(scope, id)}/agents${qs ? `?${qs}` : ''}`);
  },
  addAgent: (scope, id, body) => request(`${base(scope, id)}/agents`, { method: 'POST', body: JSON.stringify(body) }),
  agent: (uid) => request(`/teams/agents/${enc(uid)}`),
  updateAgent: (uid, patch) => request(`/teams/agents/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeAgent: (uid) => request(`/teams/agents/${enc(uid)}`, { method: 'DELETE' }),
  rulebook: (scope, id, role) => request(`${base(scope, id)}/rulebooks/${enc(role)}`),
  saveRulebook: (scope, id, role, rules) => request(`${base(scope, id)}/rulebooks/${enc(role)}`, { method: 'PUT', body: JSON.stringify({ rules }) }),
};
