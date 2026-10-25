/**
 * D1075 (#2967) — a member's security report: Help's "Security" category,
 * read by HQ's Super Admins and by the member who sent it, by nobody else.
 *
 * WHY NOT A TICKET ROW. A ticket is mirrored to GitHub issues on a public
 * repository and posted to Slack, every admin reads every ticket, and
 * `tickets.category` has a CHECK naming the eight categories (migration 333).
 * A security report must never reach any of those. It has its own table
 * (migration 584), and `parseTicketCategory` refuses `security` so the ticket
 * route cannot be used to file one by mistake.
 *
 * WHAT IS ENCRYPTED. What happened and how to reproduce it (`columnCipher.ts`,
 * bound to the report's uid). The page or feature named is plain, so HQ's
 * list can show it. Nothing from a report is logged: logs hold counts.
 *
 * HQ ONLY. On a branch the route refuses with the other ways to report
 * (`HQ_ONLY_LINE`): a branch's own administrators would be its readers there.
 */
import type { Env } from '../types';
import { decryptColumn, encryptColumn } from './columnCipher';

export const SECURITY_REPORT_STATUSES = ['open', 'acknowledged', 'resolved', 'closed'] as const;
export type SecurityReportStatus = (typeof SECURITY_REPORT_STATUSES)[number];

/** At most this many reports from one member in 24 hours. */
export const REPORTS_PER_DAY = 5;

export const HQ_ONLY_LINE = 'Report it by email to security@axal.vc, or with a private advisory on our code repository.';

export const SECURITY_REPORT_REFUSALS = {
  affected_required: 'Say what is affected: a page or a feature, up to 200 characters.',
  what_required: 'Describe what happened, up to 5,000 characters.',
  how_too_long: 'How to reproduce it is at most 5,000 characters.',
  too_many: `You have sent ${REPORTS_PER_DAY} reports in the last 24 hours. Email security@axal.vc for anything more.`,
  hq_only: `Security reports go to Axal VC HQ. ${HQ_ONLY_LINE}`,
  bad_status: `status must be one of ${SECURITY_REPORT_STATUSES.join(', ')}.`,
  not_found: 'There is no such report.',
} as const;
export type SecurityReportRefusal = keyof typeof SECURITY_REPORT_REFUSALS;

const TABLE = 'security_reports';

export function parseReport(raw: unknown):
  { ok: true; value: { affected: string; what: string; how: string | null } } | { ok: false; code: SecurityReportRefusal } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const affected = typeof b.affected === 'string' ? b.affected.trim() : '';
  if (!affected || affected.length > 200) return { ok: false, code: 'affected_required' };
  const what = typeof b.what_happened === 'string' ? b.what_happened.trim() : '';
  if (!what || what.length > 5000) return { ok: false, code: 'what_required' };
  const how = typeof b.how_to_reproduce === 'string' ? b.how_to_reproduce.trim() : '';
  if (how.length > 5000) return { ok: false, code: 'how_too_long' };
  return { ok: true, value: { affected, what, how: how || null } };
}

/** Files one report. Refuses past the daily cap. */
export async function fileReport(env: Env, userId: number, r: { affected: string; what: string; how: string | null }):
  Promise<{ ok: true; uid: string } | { ok: false; code: 'too_many' }> {
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${TABLE} WHERE user_id = ? AND created_at > datetime('now', '-1 day')`,
  ).bind(userId).first<{ n: number }>();
  if (Number(recent?.n ?? 0) >= REPORTS_PER_DAY) return { ok: false, code: 'too_many' };
  const uid = `sec_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const what = await encryptColumn(env, TABLE, 'what', uid, r.what);
  const how = r.how ? await encryptColumn(env, TABLE, 'how', uid, r.how) : null;
  await env.DB.prepare(
    `INSERT INTO ${TABLE} (uid, user_id, affected, what_enc, how_enc) VALUES (?, ?, ?, ?, ?)`,
  ).bind(uid, userId, r.affected, what, how).run();
  return { ok: true, uid };
}

type Row = {
  uid: string; user_id: number; affected: string; what_enc: string; how_enc: string | null; status: SecurityReportStatus;
  created_at: string; updated_at: string; acknowledged_at: string | null; resolved_at: string | null;
  reporter_name?: string | null; reporter_email?: string | null;
};

async function shaped(env: Env, r: Row, withReporter: boolean) {
  const what = await decryptColumn(env, TABLE, 'what', r.uid, r.what_enc);
  const how = r.how_enc ? await decryptColumn(env, TABLE, 'how', r.uid, r.how_enc) : null;
  return {
    uid: r.uid, affected: r.affected, status: r.status,
    // A row the key cannot open says so; it is never shown as empty.
    what_happened: what, how_to_reproduce: r.how_enc ? how : null,
    unreadable: what === null || (!!r.how_enc && how === null),
    created_at: r.created_at, updated_at: r.updated_at, acknowledged_at: r.acknowledged_at, resolved_at: r.resolved_at,
    ...(withReporter ? { reporter: { user_id: r.user_id, name: r.reporter_name ?? null, email: r.reporter_email ?? null } } : {}),
  };
}

/** The member's own reports, newest first. */
export async function reportsOf(env: Env, userId: number) {
  const rows = (await env.DB.prepare(
    `SELECT uid, user_id, affected, what_enc, how_enc, status, created_at, updated_at, acknowledged_at, resolved_at
       FROM ${TABLE} WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
  ).bind(userId).all<Row>()).results || [];
  return Promise.all(rows.map((r) => shaped(env, r, false)));
}

/** Every report, for HQ's Super Admins: oldest open first, at most 500. */
export async function allReports(env: Env, status: SecurityReportStatus | null) {
  const rows = (await env.DB.prepare(
    `SELECT r.uid, r.user_id, r.affected, r.what_enc, r.how_enc, r.status, r.created_at, r.updated_at, r.acknowledged_at, r.resolved_at,
            u.name AS reporter_name, u.email AS reporter_email
       FROM ${TABLE} r LEFT JOIN users u ON u.id = r.user_id
      WHERE (? IS NULL OR r.status = ?)
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, r.created_at, r.id LIMIT 501`,
  ).bind(status, status).all<Row>()).results || [];
  return { items: await Promise.all(rows.slice(0, 500).map((r) => shaped(env, r, true))), complete: rows.length <= 500 };
}

/** Moves a report to a status, stamping when it was first acknowledged or resolved. */
export async function setStatus(env: Env, uid: string, status: SecurityReportStatus, by: number): Promise<boolean> {
  const done = await env.DB.prepare(
    `UPDATE ${TABLE} SET status = ?, updated_at = datetime('now'), answered_by = ?,
            acknowledged_at = CASE WHEN ? != 'open' AND acknowledged_at IS NULL THEN datetime('now') ELSE acknowledged_at END,
            resolved_at = CASE WHEN ? IN ('resolved', 'closed') AND resolved_at IS NULL THEN datetime('now') ELSE resolved_at END
      WHERE uid = ?`,
  ).bind(status, by, status, status, uid).run();
  return Number((done as any)?.meta?.changes ?? 0) === 1;
}

/** Tells each HQ Super Admin, in the bell, that a report came in: no words from it. */
export async function noticeSuperAdmins(env: Env, uid: string): Promise<number> {
  try {
    const admins = (await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>()).results || [];
    for (const a of admins) {
      await env.DB.prepare(
        `INSERT INTO notifications (user_id, kind, dedupe_key, title, body, link) VALUES (?, 'security_report', ?, ?, ?, ?)`,
      ).bind(a.user_id, `security_report:${uid}`, 'A security report came in', 'Open it in HQ › Security › Reports.', '/admin/security/reports').run();
    }
    return admins.length;
  } catch {
    console.warn('[security-reports] bell notice failed');
    return 0;
  }
}
