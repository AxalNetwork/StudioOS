/**
 * D4162 (#4162, H4 of #4137) — HQ › AI agents › Operations › Policies (SA6,
 * SA6b, SA9d), mounted at `/api/admin/ai-agents/policy`. Super Admin only.
 *
 *   GET    /                         the policy: models per area, locks, caps, read tools, guardrails, the kill switch
 *   PUT    /models  { areas: { <area>: { suggested: [≤3], default } }, reason }
 *   POST   /locks   { model, reason }          lock a model off platform-wide
 *   DELETE /locks/:model  { reason }           unlock it
 *   PUT    /caps    { platform_budget_microusd?, default_team_cap_microusd?, max_team_cap_microusd?, per_run_ceiling_microusd?, reason }
 *   PUT    /capacity { elastic_runs_ceiling?, lanes_ceiling?, reason }   D7074: what a team's capacity may reach; null stops offering it.
 *                    409 lanes_need_run_ceiling: sub-agents need the per-run ceiling.
 *   PUT    /tools   { tools: [<connector>.<read tool>], reason }   a write tool is 422 write_tool
 *   POST   /pause   { reason, confirm: 'PAUSE' }   the kill switch on
 *   POST   /resume  { reason }                      the kill switch off
 *
 * D8070 (#8070), capability RBAC (`services/agentCapabilities.ts`):
 *   GET    /capabilities                                       the matrix: catalogue, policy, each live agent's grants
 *   POST   /capabilities/grant  { agent_uid, capabilities: [name | <domain>.*], reason ≤ 200 }
 *                    a wildcard expands here into one row per name; 403 capability_ungrantable for a reserved name,
 *                    400 capability_unknown, 403 capability_not_offered outside the ceiling, 404 agent_not_found
 *   POST   /capabilities/revoke { agent_uid, capability, reason ≤ 200 }   404 not_granted. A live run finishes; the next is refused.
 *   PUT    /capabilities/ceiling { capabilities: [..] | null, reason }    null offers every grantable name
 *   PUT    /capabilities/enforcement { enforced: boolean, reason }        off: only the reserved names are refused
 *
 * D8071 (#8071), execution budgets (`services/agentBudgets.ts`):
 *   GET    /budgets                                            every agent's caps and use this period, the platform's workspace
 *                                                               figures, and the runs halted for budget
 *   PUT    /budgets/agents/:uid  { tokens_cap?, minutes_cap?, prs_per_day_cap?, retries_per_task_cap?, reason }   null is no cap
 *   PUT    /budgets/tasks/:uid   { tokens_cap?, minutes_cap?, retries_cap?, reason }   null is the agent's cap
 *   PUT    /budgets/workspace    { scope_kind, scope_id, agents_cap?, live_agents_cap?, ai_spend_cap_cents?, compute_spend_cap_cents?, reason }
 *                    null is the platform figure; 409 above_platform_ceiling past it; 404 scope_not_found
 *   PUT    /budgets/platform     { agents_cap?, live_agents_cap?, ai_spend_cap_cents?, compute_spend_cap_cents?, reason }   null is no ceiling
 *
 * Every write takes a reason and writes H5's admin audit row (before, after,
 * reason) in the same batch as the change (`aiAdminAuditStatement`), so the
 * change and its audit land together or not at all.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { aiAdminAuditStatement } from '../services/agents/adminAudit';
import {
  PAUSE_WORD, areaModelsOf, capacityCeilingsOf, capsOf, guardrailCounts, readPolicy, readToolsOf, reasonProblem, type Policy, type Problem,
} from '../services/agents/aiPolicy';
import { modelById } from '../services/ai/catalogue';
import {
  CAPABILITY_REASON_MAX, capabilityMatrix, capabilityOf, capabilityReason, ceilingOf, expandCapabilities, grantStatement, liveGrants,
  readCapabilityPolicy, revokeStatement,
} from '../services/agentCapabilities';
import {
  aboveCeiling, agentBudgetView, agentCaps, agentCapsOf, haltedRuns, platformWorkspaceCaps, taskCapsOf, workspaceCapsOf, workspaceOwnCaps,
} from '../services/agentBudgets';

const r = new Hono<{ Bindings: Env }>();

const say = (c: any, p: Problem, status = 400) => refuse(c, p.status ?? status, { code: p.code, message: p.message });
const body = async (c: any) => (await c.req.json().catch(() => null)) ?? {};

/** The policy or the refusal that it cannot be read. */
async function policyOr(c: any): Promise<Policy | Response> {
  const p = await readPolicy(c.env);
  return p ?? refuse(c, 503, { code: 'policy_unreadable', message: 'The AI policy could not be read. Nothing was changed.' });
}

/** One change and its audit row, in one batch. */
async function write(c: any, admin: number, action: string, subject: string, before: unknown, after: unknown, reason: string, change: D1PreparedStatement[]) {
  await c.env.DB.batch([
    // Row 1 is the policy; a database that lost it (or never had it) gets it back here, never a second row.
    c.env.DB.prepare('INSERT INTO ai_agent_policy (id) VALUES (1) ON CONFLICT(id) DO NOTHING'),
    ...change,
    aiAdminAuditStatement(c.env, { adminUserId: admin, action, area: 'policy', subject, before, after, reason }),
  ]);
}

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const p = await policyOr(c);
  if (p instanceof Response) return p;
  return c.json({ policy: p, guardrails: await guardrailCounts(c.env) });
});

r.put('/models', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const m = areaModelsOf(b.areas); if (!m.ok) return say(c, m.problem);
  const p = await policyOr(c); if (p instanceof Response) return p;
  await write(c, Number(admin.id), 'policy.models', 'policy:models', p.area_models, m.value, b.reason, [
    c.env.DB.prepare("UPDATE ai_agent_policy SET area_models_json = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1").bind(JSON.stringify(m.value), Number(admin.id)),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

r.post('/locks', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  if (typeof b.model !== 'string' || !modelById(b.model)) return say(c, { code: 'unknown_model', message: 'Name a model from the catalogue.' });
  const p = await policyOr(c); if (p instanceof Response) return p;
  if (p.locks.some((l) => l.model === b.model)) return say(c, { code: 'already_locked', message: 'That model is already locked off.' }, 409);
  await write(c, Number(admin.id), 'policy.lock', `model:${b.model}`, null, { model: b.model, locked: true }, b.reason, [
    c.env.DB.prepare('INSERT INTO ai_model_locks (model, reason, locked_by) VALUES (?, ?, ?)').bind(b.model, String(b.reason).trim(), Number(admin.id)),
  ]);
  return c.json({ policy: await readPolicy(c.env) }, 201);
});

r.delete('/locks/:model', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const model = decodeURIComponent(c.req.param('model'));
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const p = await policyOr(c); if (p instanceof Response) return p;
  const lock = p.locks.find((l) => l.model === model);
  if (!lock) return say(c, { code: 'not_locked', message: 'That model is not locked.' }, 404);
  await write(c, Number(admin.id), 'policy.unlock', `model:${model}`, { model, locked: true, reason: lock.reason }, null, b.reason, [
    c.env.DB.prepare('DELETE FROM ai_model_locks WHERE model = ?').bind(model),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

r.put('/caps', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const p = await policyOr(c); if (p instanceof Response) return p;
  const before = { platform_budget_microusd: p.platform_budget_microusd, default_team_cap_microusd: p.default_team_cap_microusd, max_team_cap_microusd: p.max_team_cap_microusd, per_run_ceiling_microusd: p.per_run_ceiling_microusd };
  const caps = capsOf(b, before); if (!caps.ok) return say(c, caps.problem);
  const v = caps.value;
  // D7074: clearing the per-run ceiling while sub-agents are offered would leave their budget check with no bound.
  if (v.per_run_ceiling_microusd == null && p.lanes_ceiling != null && p.lanes_ceiling > 1) {
    return say(c, { code: 'lanes_need_run_ceiling', status: 409, message: 'Sub-agents are offered, and they need the per-run ceiling. Stop offering sub-agents first.' });
  }
  await write(c, Number(admin.id), 'policy.caps', 'policy:caps', before, v, b.reason, [
    c.env.DB.prepare(`UPDATE ai_agent_policy SET platform_budget_microusd = ?, default_team_cap_microusd = ?, max_team_cap_microusd = ?, per_run_ceiling_microusd = ?,
        updated_by = ?, updated_at = datetime('now') WHERE id = 1`)
      .bind(v.platform_budget_microusd, v.default_team_cap_microusd, v.max_team_cap_microusd, v.per_run_ceiling_microusd, Number(admin.id)),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

// D7074 (#7074): what the platform offers a team's capacity. Null (the start) offers neither.
r.put('/capacity', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const p = await policyOr(c); if (p instanceof Response) return p;
  const before = { elastic_runs_ceiling: p.elastic_runs_ceiling, lanes_ceiling: p.lanes_ceiling };
  const next = capacityCeilingsOf(b, before, p.per_run_ceiling_microusd); if (!next.ok) return say(c, next.problem);
  const v = next.value;
  await write(c, Number(admin.id), 'policy.capacity', 'policy:capacity', before, v, b.reason, [
    c.env.DB.prepare("UPDATE ai_agent_policy SET elastic_runs_ceiling = ?, lanes_ceiling = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1")
      .bind(v.elastic_runs_ceiling, v.lanes_ceiling, Number(admin.id)),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

r.put('/tools', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const t = readToolsOf(b.tools); if (!t.ok) return say(c, t.problem);
  const p = await policyOr(c); if (p instanceof Response) return p;
  await write(c, Number(admin.id), 'policy.tools', 'policy:tools', p.read_tools, t.value, b.reason, [
    c.env.DB.prepare("UPDATE ai_agent_policy SET read_tools_json = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1").bind(JSON.stringify(t.value), Number(admin.id)),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

r.post('/pause', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  if (b.confirm !== PAUSE_WORD) return say(c, { code: 'confirm_required', message: `Type ${PAUSE_WORD} to pause every AI agent on the platform.` });
  const p = await policyOr(c); if (p instanceof Response) return p;
  if (p.paused.on) return say(c, { code: 'already_paused', message: 'AI agents are already paused.' }, 409);
  await write(c, Number(admin.id), 'policy.pause', 'platform', { paused: false }, { paused: true }, b.reason, [
    c.env.DB.prepare(`UPDATE ai_agent_policy SET paused = 1, paused_at = datetime('now'), paused_by = ?, paused_reason = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1 AND paused = 0`)
      .bind(Number(admin.id), String(b.reason).trim(), Number(admin.id)),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

r.post('/resume', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const p = await policyOr(c); if (p instanceof Response) return p;
  if (!p.paused.on) return say(c, { code: 'not_paused', message: 'AI agents are not paused.' }, 409);
  await write(c, Number(admin.id), 'policy.resume', 'platform', { paused: true, since: p.paused.since, reason: p.paused.reason }, { paused: false }, b.reason, [
    // D4703 (#4703): only the pause this page read. A resume from an older tab
    // cannot clear a pause set after it (the switch release's rule, part 1).
    c.env.DB.prepare(`UPDATE ai_agent_policy SET paused = 0, paused_at = NULL, paused_by = NULL, paused_reason = NULL, updated_by = ?, updated_at = datetime('now') WHERE id = 1 AND paused = 1 AND paused_at = ?`)
      .bind(Number(admin.id), p.paused.since),
  ]);
  return c.json({ policy: await readPolicy(c.env) });
});

// ── D8070: capability RBAC ───────────────────────────────────────────────────────────────────────────────────────

const noReason = (c: any) => say(c, { code: 'reason_required', message: `Give a reason of 1 to ${CAPABILITY_REASON_MAX} characters.` });
const unreadable = (c: any) => refuse(c, 503, { code: 'capability_unreadable', message: 'The agent capability policy could not be read. Nothing was changed.' });
const capabilityProblem = (c: any, p: { code: string; capability: string }) => p.code === 'capability_ungrantable'
  ? refuse(c, 403, { code: p.code, message: `${p.capability} is done by a person. No agent can be granted it.`, extra: { capability: p.capability } })
  : refuse(c, 400, { code: 'capability_unknown', message: 'Name capabilities from the catalogue, such as research.read or research.*.', extra: { capability: p.capability } });

async function liveAgent(c: any, uid: unknown) {
  if (typeof uid !== 'string' || !/^[a-f0-9]{32}$/.test(uid)) return null;
  return c.env.DB.prepare("SELECT id, uid FROM team_agents WHERE uid = ? AND status <> 'removed'").bind(uid).first() as Promise<{ id: number; uid: string } | null>;
}

r.get('/capabilities', async (c) => {
  await requireSuperAdmin(c);
  try { return c.json(await capabilityMatrix(c.env)); } catch { return unreadable(c); }
});

r.post('/capabilities/grant', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const reason = capabilityReason(b.reason); if (!reason) return noReason(c);
  const names = expandCapabilities(b.capabilities); if (!names.ok) return capabilityProblem(c, names);
  const agent = await liveAgent(c, b.agent_uid);
  if (!agent) return refuse(c, 404, { code: 'agent_not_found', message: 'There is no such agent.' });
  const policy = await readCapabilityPolicy(c.env); if (!policy) return unreadable(c);
  const outside = policy.ceiling ? names.value.find((n) => !policy.ceiling!.includes(n)) : undefined;
  if (outside) return refuse(c, 403, { code: 'capability_not_offered', message: `The platform does not offer ${outside} to agents this month.`, extra: { capability: outside } });
  const before = await liveGrants(c.env, agent.id);
  const added = names.value.filter((n) => !before.includes(n));
  if (!added.length) return c.json(await capabilityMatrix(c.env));
  await write(c, Number(admin.id), 'policy.capability_grant', `agent:${agent.uid}`, before, [...before, ...added].sort(), reason,
    added.map((n) => grantStatement(c.env, agent.id, n, Number(admin.id), reason)));
  return c.json(await capabilityMatrix(c.env), 201);
});

r.post('/capabilities/revoke', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const reason = capabilityReason(b.reason); if (!reason) return noReason(c);
  const cap = typeof b.capability === 'string' ? capabilityOf(b.capability) : null;
  if (!cap) return capabilityProblem(c, { code: 'capability_unknown', capability: String(b.capability ?? '') });
  const agent = await liveAgent(c, b.agent_uid);
  if (!agent) return refuse(c, 404, { code: 'agent_not_found', message: 'There is no such agent.' });
  const before = await liveGrants(c.env, agent.id);
  if (!before.includes(cap.name)) return refuse(c, 404, { code: 'not_granted', message: `This agent does not hold ${cap.name}.` });
  await write(c, Number(admin.id), 'policy.capability_revoke', `agent:${agent.uid}`, before, before.filter((n) => n !== cap.name), reason,
    [revokeStatement(c.env, agent.id, cap.name, Number(admin.id), reason)]);
  return c.json(await capabilityMatrix(c.env));
});

r.put('/capabilities/ceiling', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const reason = capabilityReason(b.reason); if (!reason) return noReason(c);
  const next = ceilingOf(b.capabilities); if (!next.ok) return capabilityProblem(c, next);
  const policy = await readCapabilityPolicy(c.env); if (!policy) return unreadable(c);
  await write(c, Number(admin.id), 'policy.capability_ceiling', 'policy:capabilities', policy.ceiling, next.value, reason, [
    c.env.DB.prepare("UPDATE ai_agent_policy SET capability_ceiling_json = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1")
      .bind(next.value == null ? null : JSON.stringify(next.value), Number(admin.id)),
  ]);
  return c.json(await capabilityMatrix(c.env));
});

r.put('/capabilities/enforcement', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const reason = capabilityReason(b.reason); if (!reason) return noReason(c);
  if (typeof b.enforced !== 'boolean') return say(c, { code: 'invalid_enforced', message: 'Say true to enforce capabilities, or false to stop.' });
  const policy = await readCapabilityPolicy(c.env); if (!policy) return unreadable(c);
  if (policy.enforced === b.enforced) return say(c, { code: b.enforced ? 'already_enforced' : 'not_enforced', message: b.enforced ? 'Capabilities are already enforced.' : 'Capabilities are not enforced.' }, 409);
  await write(c, Number(admin.id), 'policy.capability_enforcement', 'policy:capabilities', { enforced: policy.enforced }, { enforced: b.enforced }, reason, [
    c.env.DB.prepare("UPDATE ai_agent_policy SET capabilities_enforced = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1")
      .bind(b.enforced ? 1 : 0, Number(admin.id)),
  ]);
  return c.json(await capabilityMatrix(c.env));
});

// ── D8071: execution budgets ─────────────────────────────────────────────────────────────────────────────────────

const budgetUnreadable = (c: any) => refuse(c, 503, { code: 'budget_unreadable', message: 'The agent budgets could not be read. Nothing was changed.' });

async function budgetsView(c: any) {
  const agents = (await c.env.DB.prepare(
    "SELECT id, uid, role_key, scope_kind FROM team_agents WHERE status <> 'removed' ORDER BY id LIMIT 500",
  ).all()).results as { id: number; uid: string; role_key: string; scope_kind: string }[] ?? [];
  const rows = await Promise.all(agents.map(async (a) => ({ agent_uid: a.uid, role_key: a.role_key, scope_kind: a.scope_kind, ...await agentBudgetView(c.env, a.id) })));
  return { platform: await platformWorkspaceCaps(c.env), agents: rows, halted: await haltedRuns(c.env, null) };
}

r.get('/budgets', async (c) => {
  await requireSuperAdmin(c);
  try { return c.json(await budgetsView(c)); } catch { return budgetUnreadable(c); }
});

r.put('/budgets/agents/:uid', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const agent = await liveAgent(c, c.req.param('uid'));
  if (!agent) return refuse(c, 404, { code: 'agent_not_found', message: 'There is no such agent.' });
  let cur;
  try { cur = await agentCaps(c.env, agent.id); } catch { return budgetUnreadable(c); }
  const before = { tokens_cap: cur.tokens_cap, minutes_cap: cur.minutes_cap, prs_per_day_cap: cur.prs_per_day_cap, retries_per_task_cap: cur.retries_per_task_cap };
  const next = agentCapsOf(b, before); if (!next.ok) return say(c, next.problem);
  const v = next.value;
  await write(c, Number(admin.id), 'policy.budget_agent', `agent:${agent.uid}`, before, v, b.reason, [
    c.env.DB.prepare(`INSERT INTO agent_budgets (agent_id, tokens_cap, minutes_cap, prs_per_day_cap, retries_per_task_cap, set_by, set_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(agent_id) DO UPDATE SET tokens_cap = excluded.tokens_cap, minutes_cap = excluded.minutes_cap,
          prs_per_day_cap = excluded.prs_per_day_cap, retries_per_task_cap = excluded.retries_per_task_cap, set_by = excluded.set_by, set_at = CURRENT_TIMESTAMP`)
      .bind(agent.id, v.tokens_cap, v.minutes_cap, v.prs_per_day_cap, v.retries_per_task_cap, Number(admin.id)),
  ]);
  return c.json({ agent_uid: agent.uid, ...await agentBudgetView(c.env, agent.id) });
});

r.put('/budgets/tasks/:uid', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const uid = c.req.param('uid');
  const task = /^[a-f0-9]{32}$/.test(uid)
    ? await c.env.DB.prepare('SELECT id, uid, budget_tokens_cap, budget_minutes_cap, budget_retries_cap FROM scope_tasks WHERE uid = ?').bind(uid).first<Record<string, any>>()
    : null;
  if (!task) return refuse(c, 404, { code: 'task_not_found', message: 'There is no such task.' });
  const before = { budget_tokens_cap: task.budget_tokens_cap ?? null, budget_minutes_cap: task.budget_minutes_cap ?? null, budget_retries_cap: task.budget_retries_cap ?? null };
  const next = taskCapsOf(b, before); if (!next.ok) return say(c, next.problem);
  const v = next.value;
  await write(c, Number(admin.id), 'policy.budget_task', `task:${task.uid}`, before, v, b.reason, [
    c.env.DB.prepare('UPDATE scope_tasks SET budget_tokens_cap = ?, budget_minutes_cap = ?, budget_retries_cap = ? WHERE id = ?')
      .bind(v.budget_tokens_cap, v.budget_minutes_cap, v.budget_retries_cap, task.id),
  ]);
  return c.json({ task_uid: task.uid, caps: { tokens: v.budget_tokens_cap, minutes: v.budget_minutes_cap, retries: v.budget_retries_cap } });
});

r.put('/budgets/workspace', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  const kind = b.scope_kind === 'company' || b.scope_kind === 'project' ? b.scope_kind as 'company' | 'project' : null;
  const id = Number.isSafeInteger(b.scope_id) && b.scope_id > 0 ? Number(b.scope_id) : null;
  if (!kind || !id) return say(c, { code: 'invalid_scope', message: 'Name the workspace: scope_kind company or project, and its scope_id.' });
  const exists = await c.env.DB.prepare(kind === 'company' ? 'SELECT 1 AS ok FROM company_profiles WHERE id = ?' : 'SELECT 1 AS ok FROM projects WHERE id = ?').bind(id).first();
  if (!exists) return refuse(c, 404, { code: 'scope_not_found', message: 'There is no such workspace.' });
  const scope = { kind, id };
  let before, platform;
  try { [before, platform] = await Promise.all([workspaceOwnCaps(c.env, scope), platformWorkspaceCaps(c.env)]); } catch { return budgetUnreadable(c); }
  const next = workspaceCapsOf(b, before); if (!next.ok) return say(c, next.problem);
  const v = next.value;
  const above = aboveCeiling(v, platform);
  if (above) return refuse(c, 409, { code: 'above_platform_ceiling', message: `${above} is above the platform figure. Raise the figure on Policies first.`, extra: { field: above } });
  const [companyId, projectId] = kind === 'company' ? [id, null] : [null, id];
  await write(c, Number(admin.id), 'policy.budget_workspace', `${kind}:${id}`, before, v, b.reason, [
    c.env.DB.prepare('INSERT OR IGNORE INTO agent_scope_settings (scope_kind, company_id, project_id, updated_by) VALUES (?, ?, ?, ?)')
      .bind(kind, companyId, projectId, Number(admin.id)),
    c.env.DB.prepare(`UPDATE agent_scope_settings SET agents_cap = ?, live_agents_cap = ?, ai_spend_cap_cents = ?, compute_spend_cap_cents = ?,
        updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`)
      .bind(v.agents_cap, v.live_agents_cap, v.ai_spend_cap_cents, v.compute_spend_cap_cents, Number(admin.id), kind, companyId ?? 0, projectId ?? 0),
  ]);
  return c.json({ scope_kind: kind, scope_id: id, caps: v, platform });
});

r.put('/budgets/platform', async (c) => {
  const admin = await requireSuperAdminWriteBar(c);
  const b = await body(c);
  const why = reasonProblem(b.reason); if (why) return say(c, why);
  let before;
  try { before = await platformWorkspaceCaps(c.env); } catch { return budgetUnreadable(c); }
  const next = workspaceCapsOf(b, before); if (!next.ok) return say(c, next.problem);
  const v = next.value;
  await write(c, Number(admin.id), 'policy.budget_platform', 'policy:budgets', before, v, b.reason, [
    c.env.DB.prepare(`UPDATE ai_agent_policy SET workspace_agents_cap = ?, workspace_live_agents_cap = ?, workspace_ai_spend_cap_cents = ?,
        workspace_compute_spend_cap_cents = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1`)
      .bind(v.agents_cap, v.live_agents_cap, v.ai_spend_cap_cents, v.compute_spend_cap_cents, Number(admin.id)),
  ]);
  return c.json({ platform: await platformWorkspaceCaps(c.env) });
});

export const mount: RouteMount = { path: '/api/admin/ai-agents/policy', router: r };
export default r;
