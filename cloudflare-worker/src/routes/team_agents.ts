/**
 * D1496 (#3840, part 1 of #3727) — team agents: the registry and the rule
 * books. Mounted at `/api/teams`.
 *
 *   GET    /roles                              the catalogue: eleven roles and their default rule books
 *   GET    /:scope/:id/agents?include=projects&module=
 *   POST   /:scope/:id/agents                  add one (manage + paid plan)
 *   GET    /agents/:uid                        its profile: rule book, matrix, spend, proposals, events
 *   PATCH  /agents/:uid                        pause, resume, cap, name (manage)
 *   DELETE /agents/:uid                        remove: rows kept, open proposals withdrawn (manage)
 *   GET    /:scope/:id/rulebooks/:role         default, effective, versions, diff, floor
 *   PUT    /:scope/:id/rulebooks/:role         a new version, within the floor (manage)
 *
 * `:scope` is `company` (by uid) or `project` (by numeric id). Every route is
 * 404 `team_agents_off` unless `TEAM_AGENTS_ENABLED` is "true".
 *
 * GATES. Read: a company's `user_company_links` row (or HQ's admin); a
 * project's `canAccessProject`. Manage: the company's `canEdit`; the
 * project's `isProjectManager`, called and never reimplemented, so the
 * company branch #3697 part 2 adds reaches agents unchanged. Plan (owner Q6 =
 * A): adding an agent needs a founder on a paid plan, the D852 rule; HQ's
 * admin passes.
 *
 * NEVER AN EMAIL, NEVER A NUMERIC USER ID. A person is `{ uid, name }`.
 * Spend is `{ available: false }` when its read fails or a run's charge is
 * unrecorded, never 0 (the page says "Not recorded").
 *
 * Nothing here runs a model: part 2 adds the run, part 3 the queue.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { userMeetsTier } from '../middleware/requireTier';
import { modelRefusal } from '../services/aiRouter';
import { canAccessProject, isProjectManager } from '../services/projectAccess';
import { canEdit } from './company';
import { isAdmin, mapError, newUid } from './_t13t14t15_helpers';
import { ALWAYS_ASKS_FLOOR, MODULES, ROLES, moduleOf, optionsIn, roleOf, type Rules } from '../services/agents/catalogue';
import { checkRules, diffRules } from '../services/agents/rulebook';

type C = Context<{ Bindings: Env }>;
type Scope = { kind: 'company'; id: number; uid: string; name: string } | { kind: 'project'; id: number; name: string; founder_id: number | null; company_id: number | null };
type AgentRow = {
  id: number; uid: string; scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  role_key: string; first_name: string | null; last_name: string | null; model_id: string; tool_grants_json: string;
  sponsor_user_id: number; monthly_cap_microusd: number; status: 'active' | 'paused' | 'removed'; paused_reason: string | null;
  created_at: string; updated_at: string; removed_at: string | null;
};
type Spend = { available: false } | { available: true; value_microusd: number };

export const teamAgentsEnabled = (env: Env) => env.TEAM_AGENTS_ENABLED === 'true';
export const NAME_MAX = 40;
export const CAP_MAX_MICROUSD = 1_000_000_000_000;
const PROPOSAL_STATUSES = ['proposed', 'accepted', 'edited', 'discarded', 'withdrawn'] as const;

const router = new Hono<{ Bindings: Env }>();

router.use('*', async (c, next) => {
  if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
  await next();
});

const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  refuse(c, status, { code, message, extra });
const notFound = (c: C) => say(c, 404, 'not_found', 'There is no such team.');

// ── Scope and gates ─────────────────────────────────────────────────────────

async function loadScope(env: Env, kind: string, id: string): Promise<Scope | null> {
  if (kind === 'company') {
    const row = await env.DB.prepare('SELECT id, uid, company_name, archived_at FROM company_profiles WHERE uid = ?')
      .bind(id).first<{ id: number; uid: string; company_name: string; archived_at: string | null }>();
    return row && !row.archived_at ? { kind: 'company', id: row.id, uid: row.uid, name: row.company_name } : null;
  }
  if (kind === 'project' && /^[1-9][0-9]{0,15}$/.test(id)) {
    const row = await env.DB.prepare('SELECT id, name, founder_id, company_id FROM projects WHERE id = ?')
      .bind(Number(id)).first<{ id: number; name: string; founder_id: number | null; company_id: number | null }>();
    return row ? { kind: 'project', ...row } : null;
  }
  return null;
}

async function scopeOfAgent(env: Env, a: AgentRow): Promise<Scope | null> {
  if (a.scope_kind === 'company') {
    const row = await env.DB.prepare('SELECT uid FROM company_profiles WHERE id = ?').bind(a.company_id).first<{ uid: string }>();
    return row ? loadScope(env, 'company', row.uid) : null;
  }
  return loadScope(env, 'project', String(a.project_id));
}

async function canRead(env: Env, s: Scope, user: User): Promise<boolean> {
  if (s.kind === 'company') {
    if (isAdmin(user)) return true;
    const link = await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?')
      .bind(s.id, user.id).first<{ ok: number }>();
    return !!link;
  }
  return canAccessProject(env, user, s);
}

async function canManage(env: Env, s: Scope, user: User): Promise<boolean> {
  if (s.kind === 'company') return canEdit(env, { id: s.id } as any, user);
  return isProjectManager(user, s);
}

/** Owner Q6 = A: a founder on a paid plan (the D852 rule), or HQ's admin. */
export function planOk(user: User): boolean {
  if (isAdmin(user)) return true;
  return String(user.role) === 'founder' && userMeetsTier(user, 'growth');
}

const scopeCols = (s: Scope): [number | null, number | null] => (s.kind === 'company' ? [s.id, null] : [null, s.id]);

// ── Rule books ──────────────────────────────────────────────────────────────

type BookRow = { version: number; rules_json: string; created_at: string; by_uid: string | null; by_name: string | null };

async function bookRows(env: Env, s: Scope, roleKey: string): Promise<BookRow[]> {
  const [companyId, projectId] = scopeCols(s);
  const r = await env.DB.prepare(
    `SELECT b.version, b.rules_json, b.created_at, u.uid AS by_uid, u.name AS by_name
       FROM team_rulebooks b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.scope_kind = ? AND IFNULL(b.company_id, 0) = ? AND IFNULL(b.project_id, 0) = ? AND b.role_key = ?
      ORDER BY b.version DESC`,
  ).bind(s.kind, companyId ?? 0, projectId ?? 0, roleKey).all<BookRow>();
  return r.results ?? [];
}

/** The rule book in force: the highest version, else the catalogue's default (version 0). */
async function effectiveBook(env: Env, s: Scope, roleKey: string): Promise<{ rules: Rules; version: number }> {
  const role = roleOf(roleKey);
  const [top] = await bookRows(env, s, roleKey);
  if (top) {
    try { return { rules: JSON.parse(top.rules_json), version: top.version }; } catch { /* a corrupt row falls back to the default */ }
  }
  return { rules: role!.default_rules, version: 0 };
}

// ── Agents ──────────────────────────────────────────────────────────────────

async function monthSpend(env: Env, agentId: number): Promise<Spend> {
  try {
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS runs, SUM(charged_microusd) AS charged,
              SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded
         FROM ai_usage_logs WHERE agent_id = ? AND created_at >= ?`,
    ).bind(agentId, start.toISOString().slice(0, 19).replace('T', ' ')).first<{ runs: number; charged: number | null; unrecorded: number | null }>();
    if (!row) return { available: false };
    // A run whose charge is not recorded makes the month's sum unknown, not smaller.
    if (Number(row.unrecorded) > 0) return { available: false };
    return { available: true, value_microusd: row.runs ? Number(row.charged) : 0 };
  } catch {
    return { available: false };
  }
}

async function lastActivity(env: Env, agentId: number): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT MAX(created_at) AS at FROM team_agent_events WHERE agent_id = ?').bind(agentId).first<{ at: string | null }>();
    return row?.at ?? null;
  } catch { return null; }
}

async function personOf(env: Env, userId: number | null): Promise<{ uid: string; name: string } | null> {
  if (!userId) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(userId).first<{ uid: string; name: string }>();
  return u ? { uid: u.uid, name: u.name } : null;
}

function toolsOf(json: string): { integration_uid: string; tool: string }[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t) => t && typeof t.integration_uid === 'string' && typeof t.tool === 'string')
      .map((t) => ({ integration_uid: t.integration_uid, tool: t.tool })) : [];
  } catch { return []; }
}

async function agentDto(env: Env, a: AgentRow) {
  const project = a.scope_kind === 'project'
    ? await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?').bind(a.project_id).first<{ id: number; name: string }>()
    : null;
  return {
    uid: a.uid,
    role_key: a.role_key,
    role_name: roleOf(a.role_key)?.name ?? a.role_key,
    first_name: a.first_name,
    last_name: a.last_name,
    model_id: a.model_id,
    tools: toolsOf(a.tool_grants_json),
    sponsor: await personOf(env, a.sponsor_user_id),
    status: a.status,
    paused_reason: a.paused_reason,
    monthly_cap_microusd: a.monthly_cap_microusd,
    month_spend: await monthSpend(env, a.id),
    last_activity_at: await lastActivity(env, a.id),
    scope_kind: a.scope_kind,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

async function agentByUid(env: Env, uid: string): Promise<AgentRow | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM team_agents WHERE uid = ?').bind(uid).first<AgentRow>();
}

async function logEvent(env: Env, agentId: number, actor: number | null, kind: string, detail?: unknown) {
  await env.DB.prepare('INSERT INTO team_agent_events (agent_id, actor_user_id, kind, detail_json) VALUES (?, ?, ?, ?)')
    .bind(agentId, actor, kind, detail === undefined ? null : JSON.stringify(detail)).run();
}

/** A name part: trimmed, at most 40 characters, no control characters; '' and null clear it. `undefined` = not sent. */
export function namePart(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(t)) return { ok: false };
  return { ok: true, value: t || null };
}

const validCap = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= CAP_MAX_MICROUSD;

async function readBody(c: C): Promise<Record<string, any> | null> {
  try { const b = await c.req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get('/roles', async (c) => {
  try {
    await requireAuth(c);
    return c.json({
      roles: ROLES.map((r) => ({
        key: r.key, name: r.name, mission: r.mission,
        works_in: r.default_rules.works_in.map((k) => ({ key: k, label: moduleOf(k)?.label ?? k })),
        default_rules: r.default_rules,
        ...(r.disclaimer_key ? { disclaimer_key: r.disclaimer_key } : {}),
      })),
    });
  } catch (e) { return mapError(c, e); }
});

router.get('/agents/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid'));
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s) return say(c, 404, 'not_found', 'There is no such agent.');
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    const book = await effectiveBook(c.env, s, a.role_key);
    const matrix = MODULES.map((m) => {
      const read = book.rules.works_in.includes(m.key);
      const offered = new Set(optionsIn(m.key));
      return { module: m.key, label: m.label, read, propose: read && book.rules.may_propose.some((o) => offered.has(o)), auto: false };
    });
    let proposals: Record<string, number> | null = null;
    try {
      const r = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM ai_rail_proposals WHERE agent_id = ? GROUP BY status')
        .bind(a.id).all<{ status: string; n: number }>();
      proposals = Object.fromEntries(PROPOSAL_STATUSES.map((st) => [st, 0]));
      for (const row of r.results ?? []) if (row.status in proposals) proposals[row.status] = Number(row.n);
    } catch { proposals = null; }
    const ev = await c.env.DB.prepare(
      `SELECT e.kind, e.created_at, e.detail_json, u.uid AS actor_uid, u.name AS actor_name
         FROM team_agent_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.agent_id = ? ORDER BY e.id DESC LIMIT 50`,
    ).bind(a.id).all<{ kind: string; created_at: string; detail_json: string | null; actor_uid: string | null; actor_name: string | null }>();
    const agent = await agentDto(c.env, a);
    return c.json({
      agent,
      can_manage: await canManage(c.env, s, user),
      rulebook: { effective: book.rules, version: book.version },
      matrix,
      cap_microusd: a.monthly_cap_microusd,
      month_spend: agent.month_spend,
      proposals,
      events: (ev.results ?? []).map((e) => ({
        kind: e.kind,
        actor: e.actor_uid ? { uid: e.actor_uid, name: e.actor_name } : null,
        at: e.created_at,
        detail: e.detail_json ? JSON.parse(e.detail_json) : null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

router.patch('/agents/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid'));
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s) return say(c, 404, 'not_found', 'There is no such agent.');
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can change its agents.');
    if (a.status === 'removed') return say(c, 409, 'removed', 'This agent was removed.');
    const b = await readBody(c);
    if (!b) return say(c, 400, 'invalid_body', 'Send what to change.');
    const next = { status: a.status, paused_reason: a.paused_reason, cap: a.monthly_cap_microusd, first_name: a.first_name, last_name: a.last_name };
    const events: [string, unknown?][] = [];
    if ('status' in b) {
      if (b.status !== 'active' && b.status !== 'paused') return say(c, 400, 'invalid_status', 'An agent is active or paused.');
      if (b.status !== a.status) {
        next.status = b.status; next.paused_reason = b.status === 'paused' ? 'manual' : null;
        events.push([b.status === 'paused' ? 'paused' : 'resumed', b.status === 'paused' ? { reason: 'manual' } : undefined]);
      }
    }
    if ('monthly_cap_microusd' in b) {
      if (!validCap(b.monthly_cap_microusd)) return say(c, 400, 'invalid_cap', 'The monthly cap is a whole number of micro-dollars above zero.');
      if (b.monthly_cap_microusd !== a.monthly_cap_microusd) {
        next.cap = b.monthly_cap_microusd;
        events.push(['cap_changed', { from_microusd: a.monthly_cap_microusd, to_microusd: b.monthly_cap_microusd }]);
      }
    }
    for (const k of ['first_name', 'last_name'] as const) {
      if (!(k in b)) continue;
      const n = namePart(b[k]);
      if (!n.ok) return say(c, 400, 'invalid_name', `A name is at most ${NAME_MAX} characters.`);
      next[k] = n.value;
    }
    await c.env.DB.prepare(
      `UPDATE team_agents SET status = ?, paused_reason = ?, monthly_cap_microusd = ?, first_name = ?, last_name = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(next.status, next.paused_reason, next.cap, next.first_name, next.last_name, a.id).run();
    for (const [kind, detail] of events) await logEvent(c.env, a.id, user.id, kind, detail);
    const fresh = await c.env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(a.id).first<AgentRow>();
    return c.json({ agent: await agentDto(c.env, fresh!) });
  } catch (e) { return mapError(c, e); }
});

router.delete('/agents/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const a = await agentByUid(c.env, c.req.param('uid'));
    const s = a && await scopeOfAgent(c.env, a);
    if (!a || !s) return say(c, 404, 'not_found', 'There is no such agent.');
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can remove its agents.');
    if (a.status === 'removed') return c.json({ ok: true });
    const withdrawn = await c.env.DB.prepare(
      "UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE agent_id = ? AND status = 'proposed'",
    ).bind(a.id).run();
    await c.env.DB.prepare(
      "UPDATE team_agents SET status = 'removed', paused_reason = NULL, removed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(a.id).run();
    await logEvent(c.env, a.id, user.id, 'removed', { proposals_withdrawn: Number(withdrawn.meta?.changes ?? 0) });
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

router.get('/:scope/:id/agents', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    const manage = await canManage(c.env, s, user);
    const [companyId, projectId] = scopeCols(s);
    const rows = (await c.env.DB.prepare(
      `SELECT * FROM team_agents WHERE status <> 'removed' AND scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? ORDER BY id`,
    ).bind(s.kind, companyId ?? 0, projectId ?? 0).all<AgentRow>()).results ?? [];
    // TM1e: a company's editors also see the live agents of the projects inside it (the owner's authority rule).
    if (s.kind === 'company' && c.req.query('include') === 'projects' && manage) {
      const more = (await c.env.DB.prepare(
        `SELECT a.* FROM team_agents a JOIN projects p ON p.id = a.project_id
          WHERE a.scope_kind = 'project' AND a.status <> 'removed' AND p.company_id = ? ORDER BY a.id`,
      ).bind(s.id).all<AgentRow>()).results ?? [];
      rows.push(...more);
    }
    let list = rows;
    const module = c.req.query('module');
    if (module) {
      const keep: AgentRow[] = [];
      for (const a of rows) {
        const own = a.scope_kind === 'company' ? s : await scopeOfAgent(c.env, a);
        if (own && (await effectiveBook(c.env, own, a.role_key)).rules.works_in.includes(module)) keep.push(a);
      }
      list = keep;
    }
    const agents = [];
    for (const a of list) agents.push(await agentDto(c.env, a));
    return c.json({ can_manage: manage, plan_ok: planOk(user), agents });
  } catch (e) { return mapError(c, e); }
});

router.post('/:scope/:id/agents', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    if (!s) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its agents.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can add agents.');
    if (!planOk(user)) return say(c, 403, 'plan_required', 'Agents come with a paid Founder plan.');
    const b = await readBody(c);
    if (!b) return say(c, 400, 'invalid_body', 'Send the role, the model and the monthly cap.');
    const role = typeof b.role_key === 'string' ? roleOf(b.role_key) : null;
    if (!role) return say(c, 400, 'invalid_role', 'Choose one of the roles.');
    if (!validCap(b.monthly_cap_microusd)) return say(c, 400, 'invalid_cap', 'The monthly cap is a whole number of micro-dollars above zero.');
    const first = namePart(b.first_name); const last = namePart(b.last_name);
    if (!first.ok || !last.ok) return say(c, 400, 'invalid_name', `A name is at most ${NAME_MAX} characters.`);
    if (typeof b.model_id !== 'string' || !b.model_id || modelRefusal(c.env, b.model_id)) {
      return say(c, 422, 'model_not_offered', 'That model is not offered. Choose one from the list.');
    }
    // Part 5 checks each grant against the sponsor's D852 approvals; until then any grant is refused (fail closed).
    if (b.tool_grants !== undefined && !(Array.isArray(b.tool_grants) && b.tool_grants.length === 0)) {
      return say(c, 422, 'tool_not_approved', 'Connected tools cannot be given to an agent yet.');
    }
    const [companyId, projectId] = scopeCols(s);
    const uid = newUid();
    try {
      await c.env.DB.prepare(
        `INSERT INTO team_agents (uid, scope_kind, company_id, project_id, role_key, first_name, last_name, model_id,
           tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      ).bind(uid, s.kind, companyId, projectId, role.key, first.value, last.value, b.model_id, user.id, b.monthly_cap_microusd, user.id).run();
    } catch (e: any) {
      if (/UNIQUE/i.test(String(e?.message))) return say(c, 409, 'role_taken', 'This team already has an agent in that role.');
      throw e;
    }
    const a = await c.env.DB.prepare('SELECT * FROM team_agents WHERE uid = ?').bind(uid).first<AgentRow>();
    await logEvent(c.env, a!.id, user.id, 'added', { role_key: role.key, model_id: b.model_id, monthly_cap_microusd: b.monthly_cap_microusd });
    return c.json({ agent: await agentDto(c.env, a!) }, 201);
  } catch (e) { return mapError(c, e); }
});

router.get('/:scope/:id/rulebooks/:role', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    const role = roleOf(c.req.param('role'));
    if (!s || !role) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its rule books.');
    const rows = await bookRows(c.env, s, role.key);
    const book = await effectiveBook(c.env, s, role.key);
    return c.json({
      role_key: role.key,
      default: role.default_rules,
      effective: book.rules,
      version: book.version,
      versions: rows.map((r) => ({ version: r.version, by: r.by_uid ? { uid: r.by_uid, name: r.by_name } : null, at: r.created_at })),
      diff: diffRules(role.default_rules, book.rules),
      floor: [...ALWAYS_ASKS_FLOOR],
    });
  } catch (e) { return mapError(c, e); }
});

router.put('/:scope/:id/rulebooks/:role', async (c) => {
  try {
    const user = await requireAuth(c);
    const s = await loadScope(c.env, c.req.param('scope'), c.req.param('id'));
    const role = roleOf(c.req.param('role'));
    if (!s || !role) return notFound(c);
    if (!(await canRead(c.env, s, user))) return say(c, 403, 'not_member', 'Only the team can see its rule books.');
    if (!(await canManage(c.env, s, user))) return say(c, 403, 'not_manager', 'Only the team’s editors can change a rule book.');
    const b = await readBody(c);
    const check = checkRules(b?.rules);
    if (!check.ok) return say(c, 422, check.code, check.message, { section: check.section });
    const [companyId, projectId] = scopeCols(s);
    const [top] = await bookRows(c.env, s, role.key);
    const version = (top?.version ?? 0) + 1;
    try {
      await c.env.DB.prepare(
        `INSERT INTO team_rulebooks (uid, scope_kind, company_id, project_id, role_key, version, rules_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newUid(), s.kind, companyId, projectId, role.key, version, JSON.stringify(check.rules), user.id).run();
    } catch (e: any) {
      if (/UNIQUE/i.test(String(e?.message))) return say(c, 409, 'rulebook_changed', 'Someone saved this rule book a moment ago. Reload it and try again.');
      throw e;
    }
    const live = await c.env.DB.prepare(
      `SELECT id FROM team_agents WHERE status <> 'removed' AND scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? AND role_key = ?`,
    ).bind(s.kind, companyId ?? 0, projectId ?? 0, role.key).first<{ id: number }>();
    if (live) await logEvent(c.env, live.id, user.id, 'rulebook_changed', { version });
    return c.json({ effective: check.rules, version });
  } catch (e) { return mapError(c, e); }
});

export default router;
