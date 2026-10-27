/**
 * D1303 (#3400, part 4 of #2377) — All accounts' smaller writes, mounted at
 * `/api/admin/accounts` (any admin, `requireAdmin`):
 *
 *   POST   /resend-verification   { user_ids, dry_run? }   ACC7 J: the
 *          verification email again, to at most RESEND_CAP accounts. A
 *          verified, deactivated or missing account is skipped and counted;
 *          another administrator's is the Super Admin's and is skipped for a
 *          plain Admin. `dry_run` answers the dialog's counts and sends nothing.
 *   GET    /views                  ACC3: the caller's own saved views and the
 *          studio's
 *   POST   /views                  { name, scope: 'admin' | 'studio', query }
 *   PUT    /views/:uid             { name?, query? }
 *   DELETE /views/:uid             the creator; a studio view also a Super Admin
 *   POST   /export                 ACC7 K: { reason, user_ids? | q?, columns? }
 *          a CSV of the list's own fields. The `admin_audit_log` row is
 *          written BEFORE the file is made, and no row means no file.
 *
 * A studio is its own database (D106): "every admin of this studio" is every
 * admin on this deployment. None of these is a suspended branch's freeze
 * (`lib/branchFreeze.js`): the export is a read, which the freeze never gates;
 * the single resend was never gated, so the bulk one is not; and a saved view
 * is an admin's own setting. Nothing logged holds a name, an email or a note:
 * counts and ids.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin } from '../auth';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { hashEmail } from '../util/hashEmail';
import { likeNeedle } from '../util/likeSearch';
import { resendVerification } from '../services/verificationResend';
import { ensureAdminAuditLogTable } from './admin';

/** The most accounts one bulk resend reaches. */
export const RESEND_CAP = 50;
/** Saved views: per admin, and their name, query and value sizes. */
export const VIEWS_PER_ADMIN = 30;
/** The list's filter, sort and column keys a view may hold (D1300's list read). */
export const VIEW_KEYS = [
  'profile', 'sub_account', 'status', 'email', 'identity', 'access', 'plan', 'country', 'joined', 'joined_from', 'joined_to',
  'last_active', 'persona', 'programme', 'trust', 'q', 'sort', 'columns', 'page_size',
] as const;
/** Export: a reason, at most this many selected accounts, at most this many rows. */
export const EXPORT_REASON_MIN = 10;
export const EXPORT_REASON_MAX = 500;
export const EXPORT_SELECTED_MAX = 500;
export const EXPORT_ROW_CAP = 10_000;

/** The list's own fields, as the export names them. No field the list does not show. */
export const EXPORT_COLUMNS: ReadonlyArray<{ key: string; head: string }> = [
  { key: 'name', head: 'Name' }, { key: 'email', head: 'Email' }, { key: 'uid', head: 'Account ID' }, { key: 'profile', head: 'Profile' },
  { key: 'status', head: 'Status' }, { key: 'email_verified', head: 'Email' }, { key: 'identity', head: 'Identity check' },
  { key: 'access', head: 'Limited access' }, { key: 'joined', head: 'Joined (UTC)' },
];

const PROFILE_WORDS: Record<string, string> = {
  founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', exploring: 'Explorer', admin: 'Admin',
};
const IDENTITY_WORDS: Record<string, string> = {
  not_started: 'Not started', pending: 'Waiting', needs_info: 'Needs information', approved: 'Approved', rejected: 'Rejected', expired: 'Expired',
};

class Refusal extends Error {
  status: number; code: string; sentence: string; extra: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code); this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

const r = new Hono<{ Bindings: Env }>();
r.onError((error: any, c) => {
  if (error instanceof Response) return error;
  if (error instanceof Refusal) return refuse(c, error.status, { code: error.code, message: error.sentence, extra: error.extra });
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'accounts_refused', message: 'This account cannot do that in Accounts.' });
  return refuse(c, 503, { code: 'accounts_unreadable', message: 'Accounts could not be read or saved. Try again.', raw: error });
});
r.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store'); });

const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};
/** Distinct positive whole-number ids, or null when the list is not one. */
function idsOf(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = new Set<number>();
  for (const v of raw) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    out.add(n);
  }
  return [...out];
}

// ---------------------------------------------------------------- bulk resend

r.post('/resend-verification', async (c) => {
  const admin = await requireAdmin(c);
  const b = await body(c);
  const ids = idsOf(b.user_ids);
  if (!ids || !ids.length) throw new Refusal(400, 'accounts_required', 'Choose the accounts to send the verification email to.');
  if (ids.length > RESEND_CAP) {
    throw new Refusal(400, 'too_many_accounts', `Send to at most ${RESEND_CAP} accounts at a time. Nothing was sent.`, { cap: RESEND_CAP });
  }
  const rows = (await c.env.DB.prepare(
    'SELECT id, email, name, role, is_active, email_verified FROM users WHERE id IN (SELECT value FROM json_each(?))',
  ).bind(JSON.stringify(ids)).all<{ id: number; email: string; name: string | null; role: string; is_active: number; email_verified: number }>()).results || [];
  const byId = new Map(rows.map((x) => [Number(x.id), x]));
  const superAdmin = isSuperAdmin(admin as any);
  const skipped = { verified: [] as number[], deactivated: [] as number[], administrator: [] as number[], not_found: [] as number[] };
  const eligible: typeof rows = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) skipped.not_found.push(id);
    else if (Number(t.email_verified)) skipped.verified.push(id);
    else if (!Number(t.is_active)) skipped.deactivated.push(id);
    else if (String(t.role).toLowerCase() === 'admin' && t.id !== admin.id && !superAdmin) skipped.administrator.push(id);
    else eligible.push(t);
  }
  const counts = {
    asked: ids.length, to_send: eligible.length,
    skipped: { verified: skipped.verified.length, deactivated: skipped.deactivated.length, administrator: skipped.administrator.length, not_found: skipped.not_found.length },
  };
  if (b.dry_run === true) return c.json({ ok: true, dry_run: true, ...counts, skipped_ids: skipped });
  if (!eligible.length) throw new Refusal(409, 'nothing_to_send', 'Every account chosen is verified, deactivated or not yours to email. Nothing was sent.', { ...counts, skipped_ids: skipped });
  let emailed = 0;
  for (const t of eligible) {
    const res = await resendVerification(c.env, admin as any, { id: Number(t.id), email: t.email, name: t.name });
    if (res.emailed) emailed += 1;
  }
  // One summary row for the bulk send, beside each account's own row: counts and ids, never an address.
  try {
    await c.env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)').bind(
      'admin_bulk_resent_verification',
      `Admin re-sent verification to ${eligible.length} accounts (emailed=${emailed}); skipped verified=${counts.skipped.verified} deactivated=${counts.skipped.deactivated} administrator=${counts.skipped.administrator} not_found=${counts.skipped.not_found}`,
      await hashEmail(admin.email), admin.id,
    ).run();
  } catch { console.warn('[accounts] bulk resend summary row not written'); }
  return c.json({ ok: true, sent: eligible.length, emailed, not_emailed: eligible.length - emailed, ...counts, skipped_ids: skipped });
});

// ---------------------------------------------------------------- saved views

/** A view's query: the list's own keys, each a short string or a short list of them. */
function cleanQuery(raw: unknown): Record<string, string | string[]> {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal(400, 'invalid_query', 'A view holds the list’s filters as named values.');
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(VIEW_KEYS as readonly string[]).includes(k)) throw new Refusal(400, 'invalid_query', `${k.slice(0, 40)} is not one of the list’s filters.`);
    if (typeof v === 'string') {
      if (v.length > 200) throw new Refusal(400, 'invalid_query', `Keep ${k} to 200 characters.`);
      if (v.trim()) out[k] = v.trim();
    } else if (Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 80)) {
      if (v.length) out[k] = v.map((x) => String(x).trim()).filter(Boolean);
    } else {
      throw new Refusal(400, 'invalid_query', `${k} must be a value or a short list of values.`);
    }
  }
  return out;
}
const cleanName = (raw: unknown) => {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > 60) throw new Refusal(400, 'invalid_name', 'Name the view, in at most 60 characters.');
  return name;
};

type ViewRow = { id: number; uid: string; name: string; scope: 'admin' | 'studio'; owner_user_id: number; owner_name: string | null; query_json: string; created_at: string; updated_at: string };
const viewDto = (v: ViewRow, me: { id: number }, superAdmin: boolean) => {
  let query: unknown = {};
  try { query = JSON.parse(v.query_json); } catch { query = {}; }
  const mine = Number(v.owner_user_id) === Number(me.id);
  return {
    uid: v.uid, name: v.name, scope: v.scope, query, mine,
    owner: { name: v.owner_name ?? null }, can_change: mine || (v.scope === 'studio' && superAdmin),
    created_at: v.created_at, updated_at: v.updated_at,
  };
};

r.get('/views', async (c) => {
  const admin = await requireAdmin(c);
  const rows = (await c.env.DB.prepare(
    `SELECT v.id, v.uid, v.name, v.scope, v.owner_user_id, u.name AS owner_name, v.query_json, v.created_at, v.updated_at
       FROM account_saved_views v LEFT JOIN users u ON u.id = v.owner_user_id
      WHERE (v.scope = 'admin' AND v.owner_user_id = ?) OR v.scope = 'studio'
      ORDER BY v.scope, lower(v.name)`,
  ).bind(admin.id).all<ViewRow>()).results || [];
  const superAdmin = isSuperAdmin(admin as any);
  return c.json({ ok: true, views: rows.map((v) => viewDto(v, admin, superAdmin)), limit: VIEWS_PER_ADMIN });
});

/** A view the caller may change: their own, or a studio view for a Super Admin; anyone else's is the same 404 as none. */
async function changeableView(env: Env, admin: any, uid: string): Promise<ViewRow> {
  if (!/^[0-9a-f]{32}$/.test(uid)) throw new Refusal(404, 'not_found', 'No such view.');
  const v = await env.DB.prepare(
    `SELECT v.id, v.uid, v.name, v.scope, v.owner_user_id, u.name AS owner_name, v.query_json, v.created_at, v.updated_at
       FROM account_saved_views v LEFT JOIN users u ON u.id = v.owner_user_id WHERE v.uid = ?`,
  ).bind(uid).first<ViewRow>();
  if (!v || (v.scope === 'admin' && Number(v.owner_user_id) !== Number(admin.id))) throw new Refusal(404, 'not_found', 'No such view.');
  if (Number(v.owner_user_id) !== Number(admin.id) && !isSuperAdmin(admin)) {
    throw new Refusal(403, 'not_yours', 'A studio view is changed by the admin who saved it, or a Super Admin.');
  }
  return v;
}

const nameTaken = () => new Refusal(409, 'name_taken', 'A view with this name already exists. Choose another name.');
const isUnique = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message || e));

r.post('/views', async (c) => {
  const admin = await requireAdmin(c);
  const b = await body(c);
  const name = cleanName(b.name);
  if (b.scope !== 'admin' && b.scope !== 'studio') throw new Refusal(400, 'invalid_scope', 'Say who sees the view: only you, or every admin of this studio.');
  const query = cleanQuery(b.query);
  const own = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM account_saved_views WHERE owner_user_id = ?').bind(admin.id).first<{ n: number }>();
  if (Number(own?.n ?? 0) >= VIEWS_PER_ADMIN) throw new Refusal(409, 'too_many_views', `You can keep at most ${VIEWS_PER_ADMIN} views. Delete one first.`);
  const uid = crypto.randomUUID().replace(/-/g, '');
  try {
    await c.env.DB.prepare('INSERT INTO account_saved_views (uid, name, scope, owner_user_id, query_json) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, name, b.scope, admin.id, JSON.stringify(query)).run();
  } catch (e) { if (isUnique(e)) throw nameTaken(); throw e; }
  const v = await changeableView(c.env, admin, uid);
  return c.json({ ok: true, view: viewDto(v, admin, isSuperAdmin(admin as any)) }, 201);
});

r.put('/views/:uid', async (c) => {
  const admin = await requireAdmin(c);
  const v = await changeableView(c.env, admin, c.req.param('uid'));
  const b = await body(c);
  const name = b.name === undefined ? v.name : cleanName(b.name);
  const query = b.query === undefined ? JSON.parse(v.query_json) : cleanQuery(b.query);
  try {
    await c.env.DB.prepare(`UPDATE account_saved_views SET name = ?, query_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(name, JSON.stringify(query), v.id).run();
  } catch (e) { if (isUnique(e)) throw nameTaken(); throw e; }
  return c.json({ ok: true, view: viewDto(await changeableView(c.env, admin, v.uid), admin, isSuperAdmin(admin as any)) });
});

r.delete('/views/:uid', async (c) => {
  const admin = await requireAdmin(c);
  const v = await changeableView(c.env, admin, c.req.param('uid'));
  await c.env.DB.prepare('DELETE FROM account_saved_views WHERE id = ?').bind(v.id).run();
  return c.json({ ok: true, deleted: v.uid });
});

// ---------------------------------------------------------------- export

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

type ExportRow = { id: number; uid: string | null; email: string; name: string | null; role: string; is_active: number; email_verified: number; kyc_status: string | null; access_level: string | null; created_at: string };
const cellOf = (key: string, u: ExportRow): string => {
  switch (key) {
    case 'name': return u.name ?? '';
    case 'email': return u.email ?? '';
    case 'uid': return u.uid ?? '';
    case 'profile': return PROFILE_WORDS[String(u.role).toLowerCase()] ?? 'No profile';
    case 'status': return Number(u.is_active) ? 'Active' : 'Deactivated';
    case 'email_verified': return Number(u.email_verified) ? 'Verified' : 'Not verified';
    case 'identity': return IDENTITY_WORDS[String(u.kyc_status || 'not_started')] ?? 'Not started';
    case 'access': return u.access_level === 'limited' ? 'Limited access' : '';
    case 'joined': return u.created_at ?? '';
    default: return '';
  }
};

/** The CSV, in the order the columns were asked; a cell that starts with a formula character is neutralised. */
export function accountsCsv(rows: ExportRow[], columns: string[]): string {
  const heads = columns.map((k) => EXPORT_COLUMNS.find((x) => x.key === k)!.head);
  return [heads, ...rows.map((u) => columns.map((k) => cellOf(k, u)))].map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

r.post('/export', async (c) => {
  const admin = await requireAdmin(c);
  const b = await body(c);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < EXPORT_REASON_MIN || reason.length > EXPORT_REASON_MAX) {
    throw new Refusal(400, 'reason_required', `Say why, in ${EXPORT_REASON_MIN} to ${EXPORT_REASON_MAX} characters. The reason is recorded with the export.`);
  }
  const columns: string[] = b.columns === undefined ? EXPORT_COLUMNS.map((x) => x.key) : Array.isArray(b.columns) ? [...new Set<string>(b.columns.map((x: unknown) => String(x)))] : [];
  if (!columns.length || columns.some((k) => !EXPORT_COLUMNS.find((x) => x.key === k))) {
    throw new Refusal(400, 'invalid_columns', `Choose columns from: ${EXPORT_COLUMNS.map((x) => x.key).join(', ')}.`);
  }
  // Which accounts: the selected ones, or the list's search (name or email, as `GET /api/admin/users` reads it), or every one.
  let mode: 'selected' | 'search' | 'all'; let rows: ExportRow[];
  if (b.user_ids !== undefined) {
    const ids = idsOf(b.user_ids);
    if (!ids || !ids.length || ids.length > EXPORT_SELECTED_MAX) throw new Refusal(400, 'invalid_selection', `Select 1 to ${EXPORT_SELECTED_MAX} accounts to export.`);
    mode = 'selected';
    rows = (await c.env.DB.prepare(
      `SELECT id, uid, email, name, role, is_active, email_verified, kyc_status, access_level, created_at FROM users
        WHERE id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC`,
    ).bind(JSON.stringify(ids)).all<ExportRow>()).results || [];
  } else if (typeof b.q === 'string' && b.q.trim()) {
    const q = b.q.trim();
    if (q.length < 2 || q.length > 200) throw new Refusal(400, 'invalid_search', 'Search with 2 to 200 characters.');
    mode = 'search';
    const like = likeNeedle(q);
    rows = (await c.env.DB.prepare(
      `SELECT id, uid, email, name, role, is_active, email_verified, kyc_status, access_level, created_at FROM users
        WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(like, like, EXPORT_ROW_CAP + 1).all<ExportRow>()).results || [];
  } else {
    mode = 'all';
    rows = (await c.env.DB.prepare(
      `SELECT id, uid, email, name, role, is_active, email_verified, kyc_status, access_level, created_at FROM users
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(EXPORT_ROW_CAP + 1).all<ExportRow>()).results || [];
  }
  if (rows.length > EXPORT_ROW_CAP) throw new Refusal(413, 'too_many_rows', `More than ${EXPORT_ROW_CAP.toLocaleString('en-US')} accounts match. Narrow the search; nothing was exported.`);
  if (!rows.length) throw new Refusal(409, 'nothing_to_export', 'No account matches, so nothing was exported.');
  // The record of the export comes first: an export that cannot be recorded is not made.
  try {
    await ensureAdminAuditLogTable(c.env);
    await c.env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json) VALUES (?, 'accounts_export', 'accounts', 'csv', ?)`,
    ).bind(admin.id, JSON.stringify({ reason, mode, rows: rows.length, columns, ...(mode === 'search' ? { q: String(b.q).trim() } : {}) })).run();
  } catch {
    throw new Refusal(503, 'unrecorded', 'The export could not be recorded, so it was not made. Try again.');
  }
  const day = new Date().toISOString().slice(0, 10);
  return c.json({ ok: true, filename: `accounts_${day}.csv`, rows: rows.length, mode, columns, csv: accountsCsv(rows, columns) });
});

export default r;
