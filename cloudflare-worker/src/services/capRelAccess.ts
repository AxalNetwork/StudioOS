/** D1191: Capital relationships, scoped to this deployment's D1. */
import type { Env, User } from '../types';
import { ownsVenture, type ProjectRef } from '../routes/_founder_validate_helpers';
import { ensureProjectMembershipSchema, getProjectMembershipRole } from './projectAccess';

const role = (user: Pick<User, 'role'>) => String(user.role || '').trim().toLowerCase();
export const capitalStaff = (user: Pick<User, 'role'>) => role(user) === 'admin';
export const capitalInvestor = (user: Pick<User, 'role'>) => role(user) === 'investor';
export const capitalOwner = (project: ProjectRef, user: User) => !capitalStaff(user) && !capitalInvestor(user) && ownsVenture(project, user);
export const CAPITAL_SUPPORT_ACTION = 'capital_relationships_support_read';
export function capitalRequestPath(path: string): string {
  try { return decodeURIComponent(path); } catch { return ''; }
}
/** Every other capital request is refused, including future private GETs. */
export function capitalStaffRequestAllowed(method: string, rawPath: string): boolean {
  const path = capitalRequestPath(rawPath);
  return (method === 'GET' && path === '/api/cycles/raise/modules/capital-relationships') ||
    (method === 'POST' && path === '/api/cycles/raise/capital-relationships/support-read');
}
const failed = (result: { success?: boolean }) => result.success === false;

export class CapitalAccessError extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(sentence); this.status = status; this.code = code; this.sentence = sentence;
  }
}

/** Never inherit projectAccess's global admin bypass or an advisor's read grant. */
export async function capitalCanWork(env: Env, project: ProjectRef, user: User): Promise<boolean> {
  if (capitalStaff(user) || capitalInvestor(user)) return false;
  try {
    const local = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(project.id).first<ProjectRef>();
    if (!local) return false;
    if (capitalOwner(local, user)) return true;
    const role = await getProjectMembershipRole(env, local.id, user.id);
    return role === 'owner' || role === 'cofounder';
  } catch {
    throw new CapitalAccessError(503, 'capital_access_unreadable', 'Venture access could not be checked. Try again.');
  }
}

/** Explicit membership grants do not use the co-founder's unrelated company. */
export async function capitalMemberProjectIds(env: Env, user: User): Promise<number[]> {
  if (capitalStaff(user) || capitalInvestor(user)) return [];
  try {
    await ensureProjectMembershipSchema(env);
    const rows = await env.DB.prepare(
      "SELECT DISTINCT p.id FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = ? AND m.status = 'accepted' AND m.role IN ('owner','cofounder') AND p.deleted_at IS NULL",
    ).bind(user.id).all<{ id: number }>();
    if (failed(rows) || !Array.isArray(rows.results)) throw new Error('Unavailable');
    return rows.results.map(row => Number(row.id));
  } catch {
    throw new CapitalAccessError(503, 'capital_access_unreadable', 'Venture access could not be checked. Try again.');
  }
}

export function capitalPage(raw: unknown): number {
  const value = Number(raw ?? 1);
  return Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : 1;
}

const STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed', 'passed'];

/** Summary SQL never selects investor names, contacts, notes or amounts. */
export async function capitalSummary(env: Env, projectId: number) {
  try {
    const rows = await env.DB.prepare('SELECT stage, COUNT(*) AS n FROM raise_prospects WHERE project_id = ? GROUP BY stage')
      .bind(projectId).all<{ stage: string; n: number }>();
    if (failed(rows) || !Array.isArray(rows.results)) throw new Error('Unavailable');
    const stages = STAGES.map(stage => ({ stage, count: rows.results.filter(row => row.stage === stage).reduce((n, row) => n + Number(row.n), 0) }));
    return { mode: 'summary' as const, read_only: true, state: 'ok' as const, total: rows.results.reduce((n, row) => n + Number(row.n), 0),
      stages, status_not_recorded: rows.results.filter(row => !STAGES.includes(row.stage)).reduce((n, row) => n + Number(row.n), 0), reason: null };
  } catch {
    return { mode: 'summary' as const, read_only: true, state: 'unreadable' as const, total: null, stages: [], status_not_recorded: null,
      reason: 'The pipeline summary could not be read. Try again.' };
  }
}

/** The caller is an authenticated local admin; the binding is the studio. */
export async function capitalStudioSummary(env: Env, projectId: number | null, page = 1) {
  const rows = projectId == null
    ? await env.DB.prepare('SELECT id, uid, name FROM projects WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?').bind(26, (page - 1) * 25).all<{ id: number; uid: string; name: string }>()
    : await env.DB.prepare('SELECT id, uid, name FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).all<{ id: number; uid: string; name: string }>();
  if (failed(rows) || !Array.isArray(rows.results)) throw new CapitalAccessError(503, 'capital_summary_unreadable', 'The studio ventures could not be read. Try again.');
  if (projectId != null && rows.results.length === 0) throw new CapitalAccessError(404, 'project_not_found', 'Project not found');
  return { mode: 'summary', read_only: true, page, page_size: 25, has_more: rows.results.length > 25,
    ventures: await Promise.all(rows.results.slice(0, 25).map(async project => ({ project, ...(await capitalSummary(env, project.id)) }))) };
}

/** Fail closed, before private SQL. This row is visible in the founder's /activity. */
export async function recordCapitalSupport(env: Env, user: User, project: ProjectRef, rawReason: unknown): Promise<number> {
  if (!capitalStaff(user)) throw new CapitalAccessError(403, 'admin_required', 'Admin role required');
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (!reason || reason.length > 500) throw new CapitalAccessError(400, 'support_reason_required', 'Give a support reason between 1 and 500 characters. The founder will see it.');
  try {
    const owners = await env.DB.prepare("SELECT id FROM users WHERE founder_id = ? AND (role = 'founder' OR (spinout_lab_active = 1 AND LOWER(TRIM(role)) NOT IN ('admin','investor'))) AND is_active = 1")
      .bind(project.founder_id).all<{ id: number }>();
    if (failed(owners) || !Array.isArray(owners.results)) throw new Error('Unavailable');
    if (owners.results.length !== 1) throw new CapitalAccessError(409, 'support_owner_unresolved', 'Support access cannot be recorded for this venture owner.');
    const ownerId = Number(owners.results[0].id);
    const row = await env.DB.prepare(
      "INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor) VALUES (?, ?, 'raise.capital-relationships', NULL, ?, ?, ?)",
    ).bind(project.id, ownerId, CAPITAL_SUPPORT_ACTION, JSON.stringify({ admin_user_id: user.id, reason, read_only: true }), `user:${user.id}`).run();
    if (row.success !== true || row.meta.changes !== 1) throw new Error('Unavailable');
    // Secondary staff governance copy is best-effort. The founder row above
    // is mandatory; never log a database exception containing bound details.
    try {
      await env.DB.prepare('INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, filters_json) VALUES (?, ?, ?, ?)')
        .bind(user.id, CAPITAL_SUPPORT_ACTION, ownerId, JSON.stringify({ project_id: project.id, reason, read_only: true })).run();
    } catch { /* The mandatory founder audit is already persisted. */ }
    return Number(row.meta.last_row_id);
  } catch (error) {
    if (error instanceof CapitalAccessError) throw error;
    throw new CapitalAccessError(503, 'support_read_unavailable', 'Support access could not be recorded. Try again.');
  }
}

/** No grants or session changes: every private staff response needs a fresh reason. */
export async function capitalSupportDetails(env: Env, projectId: number, page: number, prospectId: number | null) {
  const rows = prospectId == null
    ? await env.DB.prepare('SELECT * FROM raise_prospects WHERE project_id = ? ORDER BY id LIMIT ? OFFSET ?').bind(projectId, 26, (page - 1) * 25).all()
    : await env.DB.prepare('SELECT * FROM raise_prospects WHERE project_id = ? AND id = ?').bind(projectId, prospectId).all();
  if (failed(rows) || !Array.isArray(rows.results)) throw new CapitalAccessError(503, 'capital_read_unreadable', 'The pipeline could not be read. Try again.');
  if (prospectId != null && rows.results.length === 0) throw new CapitalAccessError(404, 'prospect_not_found', 'Investor not found');
  const round = await env.DB.prepare("SELECT * FROM raise_rounds WHERE project_id = ? AND status = 'active'").bind(projectId).first();
  return { mode: 'support', read_only: true, items: rows.results.slice(0, 25), round, page, page_size: 25, has_more: rows.results.length > 25, actions: [] };
}

export async function capitalSupportHistory(env: Env, projectId: number, page: number) {
  const rows = await env.DB.prepare(
    "SELECT a.id, a.details, a.created_at, u.name AS reader_name FROM activity_logs a LEFT JOIN users u ON a.actor = 'user:' || u.id WHERE a.project_id = ? AND a.action = ? ORDER BY a.id DESC LIMIT ? OFFSET ?",
  ).bind(projectId, CAPITAL_SUPPORT_ACTION, 26, (page - 1) * 25).all<{ id: number; details: string; created_at: string; reader_name: string | null }>();
  if (failed(rows) || !Array.isArray(rows.results)) throw new CapitalAccessError(503, 'support_history_unreadable', 'Support reads could not be read. Try again.');
  return { page, page_size: 25, has_more: rows.results.length > 25, reads: rows.results.slice(0, 25).map(row => {
    let reason: string | null = null;
    try { const details = JSON.parse(row.details); reason = typeof details.reason === 'string' ? details.reason : null; } catch { /* Historical invalid detail stays unrecorded. */ }
    return { id: row.id, reader: { name: row.reader_name }, reason, created_at: row.created_at, read_only: true };
  }) };
}
