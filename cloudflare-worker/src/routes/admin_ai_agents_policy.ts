/**
 * D4162 (#4162, H4 of #4137) — HQ › AI agents › Operations › Policies (SA6,
 * SA6b, SA9d), mounted at `/api/admin/ai-agents/policy`. Super Admin only.
 *
 *   GET    /                         the policy: models per area, locks, caps, read tools, guardrails, the kill switch
 *   PUT    /models  { areas: { <area>: { suggested: [≤3], default } }, reason }
 *   POST   /locks   { model, reason }          lock a model off platform-wide
 *   DELETE /locks/:model  { reason }           unlock it
 *   PUT    /caps    { platform_budget_microusd?, default_team_cap_microusd?, max_team_cap_microusd?, per_run_ceiling_microusd?, reason }
 *   PUT    /tools   { tools: [<connector>.<read tool>], reason }   a write tool is 422 write_tool
 *   POST   /pause   { reason, confirm: 'PAUSE' }   the kill switch on
 *   POST   /resume  { reason }                      the kill switch off
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
  PAUSE_WORD, areaModelsOf, capsOf, guardrailCounts, readPolicy, readToolsOf, reasonProblem, type Policy, type Problem,
} from '../services/agents/aiPolicy';
import { modelById } from '../services/ai/catalogue';

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
  await write(c, Number(admin.id), 'policy.caps', 'policy:caps', before, v, b.reason, [
    c.env.DB.prepare(`UPDATE ai_agent_policy SET platform_budget_microusd = ?, default_team_cap_microusd = ?, max_team_cap_microusd = ?, per_run_ceiling_microusd = ?,
        updated_by = ?, updated_at = datetime('now') WHERE id = 1`)
      .bind(v.platform_budget_microusd, v.default_team_cap_microusd, v.max_team_cap_microusd, v.per_run_ceiling_microusd, Number(admin.id)),
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

export const mount: RouteMount = { path: '/api/admin/ai-agents/policy', router: r };
export default r;
