/**
 * D1496 — a team agent's scope, its gates, its rule book in force and its
 * month's spend: the reads `routes/team_agents.ts` (part 1), `agentRun.ts`
 * (part 2) and #3742's engine share, so a gate is written once.
 *
 * `:scope` is `company` (by uid) or `project` (by numeric id).
 *
 * GATES. Read: a company's `user_company_links` row (or HQ's admin); a
 * project's `canAccessProject`. Manage: the company's `canEdit`; the
 * project's `isProjectManager`, called and never reimplemented, so the
 * company branch #3697 part 2 adds reaches agents unchanged.
 *
 * Spend is `{ available: false }` when its read fails or a run's charge is
 * unrecorded, never 0.
 */
import type { Env, User } from '../../types';
import { canAccessProject, isProjectManager } from '../projectAccess';
import { canEdit } from '../companyAccess';
import { isAdmin } from '../../routes/_t13t14t15_helpers';
import { roleOf, type Rules } from './catalogue';

export type Scope = { kind: 'company'; id: number; uid: string; name: string } | { kind: 'project'; id: number; name: string; founder_id: number | null; company_id: number | null };
export type AgentRow = {
  id: number; uid: string; scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  role_key: string; first_name: string | null; last_name: string | null; model_id: string; tool_grants_json: string;
  sponsor_user_id: number; monthly_cap_microusd: number; status: 'active' | 'paused' | 'removed'; paused_reason: string | null;
  created_at: string; updated_at: string; removed_at: string | null;
};
export type Spend = { available: false } | { available: true; value_microusd: number };

export async function loadScope(env: Env, kind: string, id: string): Promise<Scope | null> {
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

export async function scopeOfAgent(env: Env, a: Pick<AgentRow, 'scope_kind' | 'company_id' | 'project_id'>): Promise<Scope | null> {
  if (a.scope_kind === 'company') {
    const row = await env.DB.prepare('SELECT uid FROM company_profiles WHERE id = ?').bind(a.company_id).first<{ uid: string }>();
    return row ? loadScope(env, 'company', row.uid) : null;
  }
  return loadScope(env, 'project', String(a.project_id));
}

export async function canRead(env: Env, s: Scope, user: User): Promise<boolean> {
  if (s.kind === 'company') {
    if (isAdmin(user)) return true;
    const link = await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE company_id = ? AND user_id = ?')
      .bind(s.id, user.id).first<{ ok: number }>();
    return !!link;
  }
  return canAccessProject(env, user, s);
}

export async function canManage(env: Env, s: Scope, user: User): Promise<boolean> {
  if (s.kind === 'company') return canEdit(env, { id: s.id }, user);
  return isProjectManager(user, s);
}

export const scopeCols = (s: Scope): [number | null, number | null] => (s.kind === 'company' ? [s.id, null] : [null, s.id]);

// ── Rule books ──────────────────────────────────────────────────────────────

export type BookRow = { version: number; rules_json: string; created_at: string; by_uid: string | null; by_name: string | null };

export async function bookRows(env: Env, s: Scope, roleKey: string): Promise<BookRow[]> {
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
export async function effectiveBook(env: Env, s: Scope, roleKey: string): Promise<{ rules: Rules; version: number }> {
  const role = roleOf(roleKey);
  const [top] = await bookRows(env, s, roleKey);
  if (top) {
    try { return { rules: JSON.parse(top.rules_json), version: top.version }; } catch { /* a corrupt row falls back to the default */ }
  }
  return { rules: role!.default_rules, version: 0 };
}

// ── Agents ──────────────────────────────────────────────────────────────────

/** The first instant of the current UTC month, as `ai_usage_logs.created_at` writes it. */
export function monthStart(now = new Date()): string {
  const start = new Date(now); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 19).replace('T', ' ');
}

/** The agent's charges this UTC month: the sum of its runs' `charged_microusd`. */
export async function monthSpend(env: Env, agentId: number): Promise<Spend> {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS runs, SUM(charged_microusd) AS charged,
              SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded
         FROM ai_usage_logs WHERE agent_id = ? AND created_at >= ?`,
    ).bind(agentId, monthStart()).first<{ runs: number; charged: number | null; unrecorded: number | null }>();
    if (!row) return { available: false };
    // A run whose charge is not recorded makes the month's sum unknown, not smaller.
    if (Number(row.unrecorded) > 0) return { available: false };
    return { available: true, value_microusd: row.runs ? Number(row.charged) : 0 };
  } catch {
    return { available: false };
  }
}

export async function agentByUid(env: Env, uid: string): Promise<AgentRow | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM team_agents WHERE uid = ?').bind(uid).first<AgentRow>();
}

/** One audit row. `usageLogId` and `proposalUid` are a run's (part 2). */
export async function logEvent(env: Env, agentId: number, actor: number | null, kind: string, detail?: unknown, run?: { usageLogId?: number | null; proposalUid?: string | null }) {
  await env.DB.prepare('INSERT INTO team_agent_events (agent_id, actor_user_id, kind, usage_log_id, proposal_uid, detail_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(agentId, actor, kind, run?.usageLogId ?? null, run?.proposalUid ?? null, detail === undefined ? null : JSON.stringify(detail)).run();
}
