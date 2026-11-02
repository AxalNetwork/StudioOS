// D1529 (#3845, E1 of #3742) — the agent engine's goals, tasks and dependencies
// on a company or a project. S1's canvas calls these: TM6b ("Assign this task
// to…" from a module task row), TM6c ("Working here"), and later the TM10–TM11
// boards (E8).
// Worker: routes/agent_engine.ts, migration 727. Every route answers 404
// `agent_engine_off` until AGENT_ENGINE is on (and TEAM_AGENTS_ENABLED).
//   GET    /api/teams/:scope/:id/goals              → { goals: [{ uid, title, why, metric, target_date, stage, parent: { uid, title } | null,
//                                                       okr_id, status, priority, progress: { done, total }, cost: { available, value_microusd } }] }
//   POST   /api/teams/:scope/:id/goals              { title, why?, metric?, target_date?, stage?, parent_goal_uid?, okr_id?, priority? } → 201 { goal }
//   PATCH  /api/teams/goals/:uid                    the same fields, and status → { goal }
//                                                   400 invalid_goal; 422 parent_not_in_company | okr_not_in_project
//   GET    /api/teams/:scope/:id/tasks?goal=&assignee=person|agent|none&status=&module=
//                                                   → { tasks: [{ uid, title, module, option, kind, goal, assignee: { kind, person?, agent? },
//                                                       context_project, status, blocked_reason, ready, depends_on: [uid], due_at, attempts, cost }] }
//   POST   /api/teams/:scope/:id/tasks              { title, detail?, goal_uid?, module?, option?, kind?, context_project_id?,
//                                                     assignee?: { kind: 'person' | 'agent' | 'none', uid? }, priority?, due_at? } → 201 { task }
//   PATCH  /api/teams/tasks/:uid                    the same fields, status, blocked_reason → { task } (a person assignee: status only)
//                                                   409 agent_not_live; 422 module_not_allowed | option_not_allowed | assignee_not_member | project_not_in_company
//   PUT    /api/teams/tasks/:uid/deps               { depends_on: [uid] } → { task }; 422 dependency_cycle | cross_scope
// D1528 (#3847, #3742 E3): the runtime. A person starts an agent's ready task after seeing its cost;
// the run's proposal waits in #3727's approvals queue.
//   GET    /api/teams/tasks/:uid/quote             → { quote: { available, value_microusd } }
//   POST   /api/teams/tasks/:uid/start             → 202 { run }; 409 agent_busy | scope_busy | queue_full | not_ready; 403 engine_paused | scope_paused
//   GET    /api/teams/agents/:uid/runs             → { runs: [Run] }
//   GET    /api/teams/runs/:uid                    → { run, steps: [{ name, status, at, summary }], cost }
//   POST   /api/teams/runs/:uid/cancel             → { run }; 409 not_running
//   GET    /api/teams/:scope/:id/engine            → { engine: 'off'|'paused'|'canary'|'on', halted, scope_paused, max_parallel_runs, autonomy: 'manual'|'self_start' }
//   PUT    /api/teams/:scope/:id/engine            { paused?, max_parallel_runs? } → the same; 400 invalid_engine
// Run = { uid, agent: { uid, role_key, first_name, last_name }, task: { uid, title }, attempt, status, step, refusal,
//         proposal_uid, started_at, ended_at, cost: { available, value_microusd } }. With the engine `paused` the page
// says "Agents are paused on the platform. You can still run them yourself."
// `:scope` is 'company' (its uid) or 'project' (its id). A person is { uid, name },
// never an email. `cost` is { available: false } until E3 records task runs: the
// page says "Not recorded", never $0.
//
// D1530 (#3848, E4): the planner (TM10), the wizard and templates (TM15), the capabilities (TM16).
//   GET    /api/teams/goals/:uid/plan/quote         → { quote: { available, value_microusd }, by: 'agent' | 'eadwyn' }
//   POST   /api/teams/goals/:uid/plan               → 201 { proposal: { uid, by, plan: { items: [{ title, module,
//                                                       suggested_assignee: { role_key } | { person: true }, depends_on: [index], due_in_days }],
//                                                       dropped: [sentence] } } }; 422 plan_invalid; the run's refusals in their own words
//   POST   /api/teams/goals/:uid/plan/accept        { proposal, remove?: [index], titles?: { index: title } } → 201 { tasks } (one batch)
//                                                   404 not_found; 409 plan_decided; 400 invalid_plan
//   GET    /api/teams/:scope/:id/suggested-team?goal= → { stage, suggestions: [{ role_key, why, template, already_on_team,
//                                                       est_month_microusd: { available, value } }] }
//   GET    /api/teams/templates                     → { templates: [{ key, role_key, name, model_tier, suggested_cap_microusd, duties: [key] }] }
//   GET    /api/teams/capabilities                  → { modules, reads, options, floor }
// Custom roles (TM16's create and edit) wait for migration 728 (#3847).
import { request } from '../api.js';

const enc = encodeURIComponent;
const base = (scope, id) => `/teams/${enc(scope)}/${enc(id)}`;

export const agentEngineApi = {
  goals: (scope, id) => request(`${base(scope, id)}/goals`),
  createGoal: (scope, id, body) => request(`${base(scope, id)}/goals`, { method: 'POST', body: JSON.stringify(body) }),
  updateGoal: (uid, patch) => request(`/teams/goals/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  tasks: (scope, id, { goal, assignee, status, module } = {}) => {
    const q = new URLSearchParams();
    if (goal) q.set('goal', goal);
    if (assignee) q.set('assignee', assignee);
    if (status) q.set('status', status);
    if (module) q.set('module', module);
    const qs = q.toString();
    return request(`${base(scope, id)}/tasks${qs ? `?${qs}` : ''}`);
  },
  createTask: (scope, id, body) => request(`${base(scope, id)}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (uid, patch) => request(`/teams/tasks/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  setTaskDeps: (uid, dependsOn) => request(`/teams/tasks/${enc(uid)}/deps`, { method: 'PUT', body: JSON.stringify({ depends_on: dependsOn }) }),
  taskQuote: (uid) => request(`/teams/tasks/${enc(uid)}/quote`),
  startTask: (uid) => request(`/teams/tasks/${enc(uid)}/start`, { method: 'POST' }),
  agentRuns: (agentUid) => request(`/teams/agents/${enc(agentUid)}/runs`),
  run: (uid) => request(`/teams/runs/${enc(uid)}`),
  cancelRun: (uid) => request(`/teams/runs/${enc(uid)}/cancel`, { method: 'POST' }),
  engine: (scope, id) => request(`${base(scope, id)}/engine`),
  setEngine: (scope, id, body) => request(`${base(scope, id)}/engine`, { method: 'PUT', body: JSON.stringify(body) }),
  planQuote: (goalUid) => request(`/teams/goals/${enc(goalUid)}/plan/quote`),
  draftPlan: (goalUid) => request(`/teams/goals/${enc(goalUid)}/plan`, { method: 'POST', body: JSON.stringify({}) }),
  acceptPlan: (goalUid, proposal, { remove, titles } = {}) =>
    request(`/teams/goals/${enc(goalUid)}/plan/accept`, { method: 'POST', body: JSON.stringify({ proposal, ...(remove ? { remove } : {}), ...(titles ? { titles } : {}) }) }),
  suggestedTeam: (scope, id, { goal } = {}) => request(`${base(scope, id)}/suggested-team${goal ? `?goal=${enc(goal)}` : ''}`),
  templates: () => request('/teams/templates'),
  capabilities: () => request('/teams/capabilities'),
  // D1530 (#3849, E5 of #3742): duties (TM12), the handoff trail (TM13) and an agent's memory (TM5a).
  //   GET    /api/teams/agents/:uid/duties   → { duties: [{ uid, template, title, module, option, cadence, weekday, day_of_month,
  //                                              hour_utc, next_due_at, last_outcome, status, est_month: { available, value_microusd } }] }
  //   POST   /api/teams/agents/:uid/duties   { template, cadence?, weekday?, day_of_month?, hour_utc?, title? } → 201 { duty };
  //                                          422 template_not_in_role; 409 duty_exists | too_many_duties
  //   PATCH  /api/teams/duties/:uid          { cadence?, weekday?, day_of_month?, hour_utc?, title?, status?: 'active'|'paused' } → { duty }
  //   DELETE /api/teams/duties/:uid          → { ok }
  //   GET    /api/teams/:scope/:id/handoffs  → { chains: [{ uid, steps: [{ uid, depth, from: { role_key }, to: { role_key }, title, status,
  //                                              refusal, decided_by: { uid, name } | null, task_created }], refused: [{ reason }] }] }
  //   GET    /api/teams/agents/:uid/memory   → { notes: [{ uid, kind, body, by: { uid, name } | null, at, expires_at }],
  //                                              retention: { days_after_removal, run_summaries_days, text } }
  //   POST   /api/teams/agents/:uid/memory   { body } → 201 { note }; 422 note_too_long
  //   DELETE /api/teams/memory/:uid          → { ok } ("Forget this")
  //   DELETE /api/teams/agents/:uid/memory   → { ok, forgotten } ("Forget everything")
  duties: (agentUid) => request(`/teams/agents/${enc(agentUid)}/duties`),
  addDuty: (agentUid, body) => request(`/teams/agents/${enc(agentUid)}/duties`, { method: 'POST', body: JSON.stringify(body) }),
  updateDuty: (uid, patch) => request(`/teams/duties/${enc(uid)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeDuty: (uid) => request(`/teams/duties/${enc(uid)}`, { method: 'DELETE' }),
  handoffs: (scope, id) => request(`${base(scope, id)}/handoffs`),
  memory: (agentUid) => request(`/teams/agents/${enc(agentUid)}/memory`),
  addMemoryFact: (agentUid, body) => request(`/teams/agents/${enc(agentUid)}/memory`, { method: 'POST', body: JSON.stringify(body) }),
  forgetMemory: (noteUid) => request(`/teams/memory/${enc(noteUid)}`, { method: 'DELETE' }),
  forgetAllMemory: (agentUid) => request(`/teams/agents/${enc(agentUid)}/memory`, { method: 'DELETE' }),
};
