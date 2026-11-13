/**
 * D4163 (#4163, H5 of #4137) — the admin audit of HQ › AI agents: one
 * append-only row per Super Admin action (`ai_admin_audit`, migration
 * 202611022046), written by `recordAiAdminAction` from H1–H4's routes and read
 * by `GET /api/admin/ai-agents/audit` and its CSV.
 *
 * Every row names its admin by name (never by email), carries a reason, and
 * keeps the value before and after. Nothing here updates or deletes a row; the
 * table's triggers refuse it too.
 */
import type { Env } from '../../types';

export const AUDIT_AREAS = ['roster', 'skills', 'company_skills', 'policy'] as const;
export type AuditArea = typeof AUDIT_AREAS[number];
export const REASON_MAX = 500;
export const AUDIT_PAGE = 50;
export const AUDIT_CSV_MAX = 5000;

export type AiAdminAction = {
  adminUserId: number;
  action: string;
  area: AuditArea;
  subject: string;
  before?: unknown;
  after?: unknown;
  reason: string;
};

/** Why an action cannot be audited (and so cannot happen), or null. */
export function auditProblem(a: Partial<AiAdminAction>): string | null {
  if (!Number.isSafeInteger(a.adminUserId) || (a.adminUserId as number) <= 0) return 'an admin';
  if (typeof a.action !== 'string' || !/^[a-z][a-z0-9_.]{0,63}$/.test(a.action)) return 'an action name';
  if (!(AUDIT_AREAS as readonly string[]).includes(a.area as string)) return 'a panel area';
  if (typeof a.subject !== 'string' || !a.subject.trim() || a.subject.length > 200) return 'a subject';
  if (typeof a.reason !== 'string' || !a.reason.trim()) return 'a reason';
  if (a.reason.trim().length > REASON_MAX) return `a reason of at most ${REASON_MAX} characters`;
  return null;
}

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/**
 * The statement that records one action, for a caller to run in the same
 * `DB.batch` as its change, so the change and its audit land together or not
 * at all. Throws on an action that cannot be audited.
 */
export function aiAdminAuditStatement(env: Env, a: AiAdminAction) {
  const problem = auditProblem(a);
  if (problem) throw new Error(`An HQ › AI agents action needs ${problem}.`);
  return env.DB.prepare(
    'INSERT INTO ai_admin_audit (admin_user_id, action, area, subject, before_json, after_json, reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(a.adminUserId, a.action, a.area, a.subject.trim(), json(a.before), json(a.after), a.reason.trim());
}

/** Record one action on its own. Prefer `aiAdminAuditStatement` inside the change's batch. */
export async function recordAiAdminAction(env: Env, a: AiAdminAction): Promise<number> {
  const r = await aiAdminAuditStatement(env, a).run();
  return Number(r.meta?.last_row_id ?? 0);
}

export type AuditFilters = { admin?: number | null; action?: string | null; area?: AuditArea | null; from?: string | null; to?: string | null; before?: number | null };
export type AuditRow = {
  id: number; at: string; admin: { id: number; name: string | null }; action: string; area: AuditArea;
  subject: string; before: unknown; after: unknown; reason: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const parse = (s: string | null): unknown => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };

/** The filters a query string asks for, or the name of the one that is wrong. */
export function auditFiltersOf(q: Record<string, string | undefined>): AuditFilters | { error: string } {
  const out: AuditFilters = {};
  if (q.admin) { const n = Number(q.admin); if (!Number.isSafeInteger(n) || n <= 0) return { error: 'admin' }; out.admin = n; }
  if (q.action) { if (!/^[a-z][a-z0-9_.]{0,63}$/.test(q.action)) return { error: 'action' }; out.action = q.action; }
  if (q.area) { if (!(AUDIT_AREAS as readonly string[]).includes(q.area)) return { error: 'area' }; out.area = q.area as AuditArea; }
  if (q.from) { if (!DATE.test(q.from)) return { error: 'from' }; out.from = q.from; }
  if (q.to) { if (!DATE.test(q.to)) return { error: 'to' }; out.to = q.to; }
  if (q.cursor) { const n = Number(q.cursor); if (!Number.isSafeInteger(n) || n <= 0) return { error: 'cursor' }; out.before = n; }
  return out;
}

/** Audit rows, newest first, with the admin named; `limit` rows after the cursor. */
export async function readAudit(env: Env, f: AuditFilters, limit = AUDIT_PAGE): Promise<{ rows: AuditRow[]; next_cursor: number | null }> {
  const two = (v: unknown) => [v ?? null, v ?? null];
  // Every filter is a nullable parameter, so the SQL text never changes.
  const rs = await env.DB.prepare(
    `SELECT a.id, a.at, a.admin_user_id, u.name AS admin_name, a.action, a.area, a.subject, a.before_json, a.after_json, a.reason
       FROM ai_admin_audit a LEFT JOIN users u ON u.id = a.admin_user_id
      WHERE (? IS NULL OR a.admin_user_id = ?)
        AND (? IS NULL OR a.action = ?)
        AND (? IS NULL OR a.area = ?)
        AND (? IS NULL OR a.at >= ?)
        AND (? IS NULL OR a.at < datetime(?, '+1 day'))
        AND (? IS NULL OR a.id < ?)
      ORDER BY a.id DESC LIMIT ?`,
  ).bind(
    ...two(f.admin), ...two(f.action), ...two(f.area),
    ...two(f.from ? `${f.from} 00:00:00` : null), ...two(f.to ? `${f.to} 00:00:00` : null),
    ...two(f.before), limit + 1,
  ).all<any>();
  const all = rs.results ?? [];
  const page = all.slice(0, limit);
  return {
    rows: page.map((r) => ({
      id: Number(r.id), at: String(r.at), admin: { id: Number(r.admin_user_id), name: r.admin_name ?? null },
      action: String(r.action), area: r.area, subject: String(r.subject),
      before: parse(r.before_json), after: parse(r.after_json), reason: String(r.reason),
    })),
    next_cursor: all.length > limit ? Number(page[page.length - 1].id) : null,
  };
}

const cell = (v: unknown): string => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // A leading = + - @ is a formula to a spreadsheet: quote it as text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const AUDIT_CSV_HEADER = ['When (UTC)', 'Admin', 'Action', 'Area', 'Subject', 'Before', 'After', 'Reason'];

/** The audit as CSV, the admin by name; never an email. */
export function auditCsv(rows: readonly AuditRow[]): string {
  const lines = [AUDIT_CSV_HEADER.map(cell).join(',')];
  for (const r of rows) lines.push([r.at, r.admin.name ?? 'Not recorded', r.action, r.area, r.subject, r.before, r.after, r.reason].map(cell).join(','));
  return lines.join('\r\n') + '\r\n';
}
