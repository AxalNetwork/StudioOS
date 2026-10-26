/**
 * D1229 (#3237, part 1 of #2384) — one person's KYC case beyond its status:
 * the people queue's read, the case's history, its notices to the member, the
 * figures, and the hand-off from an expired `kyc_v1` obligation.
 *
 * THE STATUS STAYS ON `users.kyc_status`, in six words the canvas names
 * (`frontend/src/pages/admin/kyc/kycModel.js` `STATUS_WORD`): not_started
 * (Not started), pending (Waiting), needs_info (Needs information), approved
 * (Approved), rejected (Rejected) and expired (Expired). Only `approved` opens
 * full access, as before: every gate in the Worker tests for it alone.
 *
 * EVERY STATEMENT IS STATIC. The queue's filters and sort are bound values
 * read by fixed `(? IS NULL OR …)` and `CASE` clauses, so nothing a request
 * sends becomes SQL text.
 *
 * NOTHING IDENTIFYING IS LOGGED. A log line names the member by id; notes,
 * reasons and identity values never go to the console.
 *
 * Migration 614 holds the stores: `users.kyc_assignee_id` and
 * `kyc_assigned_at`, `kyc_case_events`, `kyc_notes` and `kyc_documents`.
 */
import type { Env } from '../types';
import { notify } from './notify';

export const KYC_STATUSES = ['not_started', 'pending', 'needs_info', 'approved', 'rejected', 'expired'] as const;
export type KycStatus = typeof KYC_STATUSES[number];

/** Statuses a member may submit, or submit again, from. */
export const SUBMITTABLE: readonly string[] = ['not_started', 'rejected', 'needs_info', 'expired'];

export const DOCUMENT_KINDS = ['id_front', 'id_back', 'proof_of_address', 'selfie', 'other'] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];
export const MAX_DOCUMENTS = 5;
export const NOTE_MAX = 2000;

export const QUEUE_SORTS = ['submitted', 'name', 'status', 'reviewed'] as const;
export const QUEUE_FLAGS = ['pep', 'auto_failed', 'no_document'] as const;
export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

export type EventKind = 'submitted' | 'approved' | 'rejected' | 'needs_info' | 'recheck' | 'expired' | 'assigned' | 'unassigned';

/** One row of the case's history. `submittedAt` is the submission a decision answers. */
export async function recordEvent(
  env: Env,
  e: { userId: number; kind: EventKind; actorId: number | null; note?: string | null; submittedAt?: string | null },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO kyc_case_events (user_id, kind, actor_user_id, note, submitted_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(e.userId, e.kind, e.actorId, e.note ? String(e.note).slice(0, NOTE_MAX) : null, e.submittedAt ?? null).run();
}

// ---------------------------------------------------------------------------
// The member's notices
// ---------------------------------------------------------------------------

type NoticeKind = 'approved' | 'rejected' | 'needs_info' | 'recheck' | 'expired';

/** The notice each decision sends the member, in-app and by email. */
export function noticeFor(kind: NoticeKind, message?: string | null): { type: string; title: string; body: string } {
  const said = message ? String(message).trim() : '';
  switch (kind) {
    case 'approved':
      return { type: 'kyc_approved', title: 'Your identity is verified', body: 'Axal compliance approved your identity check. Full access is open.' };
    case 'rejected':
      return { type: 'kyc_rejected', title: 'Your identity check was not approved', body: `Axal compliance could not approve your identity check. Reason: ${said || 'Not recorded'}. You can correct it and submit again.` };
    case 'needs_info':
      return { type: 'kyc_needs_info', title: 'Axal compliance needs more information', body: `To finish your identity check, Axal compliance asks: ${said || 'Not recorded'}. Open Identity verification to answer.` };
    case 'recheck':
      return { type: 'kyc_recheck', title: 'Verify your identity again', body: `Axal compliance asks you to verify your identity again: ${said || 'Not recorded'}. Full access waits until it is approved.` };
    case 'expired':
      return { type: 'kyc_expired', title: 'Your identity check has expired', body: 'Your identity check is more than 24 months old. Verify again to keep full access.' };
  }
}

/** Never fails the decision it follows: `notify` swallows its own failures, and so does this. */
export async function noticeMember(env: Env, userId: number, kind: NoticeKind, message?: string | null): Promise<void> {
  try {
    const n = noticeFor(kind, message);
    await notify(env, { userId, type: n.type, title: n.title, body: n.body, link: '/kyc', channels: ['in_app', 'email'], category: 'security' });
  } catch {
    console.warn(`[kycCase] notice ${kind} not sent`);
  }
}

// ---------------------------------------------------------------------------
// The people queue (KYC1, KYC2)
// ---------------------------------------------------------------------------

export type QueueQuery = {
  status: 'all' | KycStatus;
  q: string | null;
  idType: string | null;
  country: string | null;
  flag: typeof QUEUE_FLAGS[number] | null;
  /** 'none', 'me' resolved to an id by the caller, or an admin's id. */
  assignee: string | null;
  sort: typeof QUEUE_SORTS[number];
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

/** The query from the request's search params; anything unknown falls back, never into SQL. */
export function parseQueueQuery(p: Record<string, string | undefined>, me: number): QueueQuery {
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[], dflt: T): T => (allowed as readonly string[]).includes(String(v)) ? v as T : dflt;
  const text = (v: string | undefined, max = 80) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
  const status = pick(p.status, ['all', ...KYC_STATUSES] as const, 'all');
  const sort = pick(p.sort, QUEUE_SORTS, 'submitted');
  const dir = pick(p.dir, ['asc', 'desc'] as const, sort === 'reviewed' ? 'desc' : 'asc');
  const page = Math.max(1, Math.floor(Number(p.page)) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(p.page_size)) || PAGE_SIZE_DEFAULT));
  let assignee = text(p.assignee, 12);
  if (assignee === 'me') assignee = String(me);
  else if (assignee && assignee !== 'none' && !/^[1-9]\d*$/.test(assignee)) assignee = null;
  const country = text(p.country, 3);
  return {
    status, sort, dir, page, pageSize, assignee,
    q: text(p.q),
    idType: text(p.id_type, 24),
    country: country ? country.toUpperCase() : null,
    flag: (QUEUE_FLAGS as readonly string[]).includes(String(p.flag)) ? p.flag as QueueQuery['flag'] : null,
  };
}

// One base the three reads share: every user with their KYC JSON made safe to
// read (a malformed blob reads as `{}`, never an error) and the filters other
// than status. Bound in order: q, q, id type, country, flag (x4), assignee (x3).
const BASE = `
  WITH c AS (
    SELECT u.id, u.name, u.email, u.role,
           COALESCE(u.kyc_status, 'not_started') AS status,
           u.kyc_submitted_at, u.kyc_reviewed_at, u.kyc_reviewed_by,
           u.kyc_assignee_id, u.kyc_assigned_at,
           CASE WHEN json_valid(u.kyc_data) THEN u.kyc_data ELSE '{}' END AS j
      FROM users u
  ),
  f AS (
    SELECT c.*,
           json_extract(c.j, '$.id_type') AS id_type,
           upper(json_extract(c.j, '$.country')) AS country,
           json_extract(c.j, '$.pep_self_disclosed') AS pep,
           json_extract(c.j, '$.provider_result.result') AS auto_result,
           CASE WHEN json_extract(c.j, '$.id_document.file_key') IS NOT NULL
                  OR json_extract(c.j, '$.id_document_base64') IS NOT NULL
                  OR EXISTS (SELECT 1 FROM kyc_documents d WHERE d.user_id = c.id AND d.removed_at IS NULL)
                THEN 1 ELSE 0 END AS has_document
      FROM c
  ),
  g AS (
    SELECT * FROM f
     WHERE (? IS NULL OR lower(COALESCE(name, '')) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')
       AND (? IS NULL OR id_type = ?)
       AND (? IS NULL OR country = ?)
       AND (? IS NULL
            OR (? = 'pep' AND pep IN (1, 'true'))
            OR (? = 'auto_failed' AND auto_result = 'fail')
            OR (? = 'no_document' AND has_document = 0))
       AND (? IS NULL OR (? = 'none' AND kyc_assignee_id IS NULL) OR kyc_assignee_id = CAST(? AS INTEGER))
  )`;

function baseBinds(q: QueueQuery): unknown[] {
  // The search is text: `%`, `_` and the escape itself are escaped, never patterns.
  const like = q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
  return [like, like, like, q.idType, q.idType, q.country, q.country, q.flag, q.flag, q.flag, q.flag, q.assignee, q.assignee, q.assignee];
}

// "all" is every case someone has opened: not_started is only read when asked for.
const STATUS_MATCH = `((? = 'all' AND status <> 'not_started') OR status = ?)`;

const PAGE_SQL = `${BASE}
  SELECT g.id, g.name, g.email, g.role, g.status, g.kyc_submitted_at, g.kyc_reviewed_at,
         g.id_type, g.country, g.pep, g.auto_result, g.has_document,
         g.kyc_assignee_id, g.kyc_assigned_at, a.name AS assignee_name,
         g.kyc_reviewed_by, r.name AS reviewer_name,
         CASE WHEN g.status IN ('pending', 'needs_info') AND g.kyc_submitted_at IS NOT NULL
              THEN CAST(julianday('now') - julianday(g.kyc_submitted_at) AS INTEGER) END AS wait_days
    FROM g
    LEFT JOIN users a ON a.id = g.kyc_assignee_id
    LEFT JOIN users r ON r.id = g.kyc_reviewed_by
   WHERE ${STATUS_MATCH}
   ORDER BY
     CASE WHEN ? = 'submitted' AND ? = 'asc' THEN g.kyc_submitted_at IS NULL END ASC,
     CASE WHEN ? = 'submitted' AND ? = 'asc' THEN g.kyc_submitted_at END ASC,
     CASE WHEN ? = 'submitted' AND ? = 'desc' THEN g.kyc_submitted_at END DESC,
     CASE WHEN ? = 'name' AND ? = 'asc' THEN lower(COALESCE(g.name, g.email)) END ASC,
     CASE WHEN ? = 'name' AND ? = 'desc' THEN lower(COALESCE(g.name, g.email)) END DESC,
     CASE WHEN ? = 'status' AND ? = 'asc' THEN g.status END ASC,
     CASE WHEN ? = 'status' AND ? = 'desc' THEN g.status END DESC,
     CASE WHEN ? = 'reviewed' AND ? = 'asc' THEN g.kyc_reviewed_at END ASC,
     CASE WHEN ? = 'reviewed' AND ? = 'desc' THEN g.kyc_reviewed_at END DESC,
     g.id ASC
   LIMIT ? OFFSET ?`;

const TOTAL_SQL = `${BASE} SELECT COUNT(*) AS n FROM g WHERE ${STATUS_MATCH}`;
const COUNTS_SQL = `${BASE} SELECT status, COUNT(*) AS n FROM g GROUP BY status`;

export type QueueRow = {
  id: number; name: string | null; email: string; role: string; status: string;
  submitted_at: string | null; reviewed_at: string | null; wait_days: number | null;
  id_type: string | null; country: string | null; flags: string[];
  assignee: { id: number; name: string | null } | null; assigned_at: string | null;
  reviewer: { id: number; name: string | null } | null;
};

/** One page of the queue, its total under the same filters, and the count per status. */
export async function readQueue(env: Env, q: QueueQuery): Promise<{
  rows: QueueRow[]; total: number; page: number; page_size: number; counts: Record<string, number>;
}> {
  const base = baseBinds(q);
  const sortBinds: unknown[] = [];
  for (let i = 0; i < 9; i += 1) sortBinds.push(q.sort, q.dir);
  const [page, total, counts] = await Promise.all([
    env.DB.prepare(PAGE_SQL).bind(...base, q.status, q.status, ...sortBinds, q.pageSize, (q.page - 1) * q.pageSize).all<any>(),
    env.DB.prepare(TOTAL_SQL).bind(...base, q.status, q.status).first<{ n: number }>(),
    env.DB.prepare(COUNTS_SQL).bind(...base).all<{ status: string; n: number }>(),
  ]);
  const byStatus: Record<string, number> = Object.fromEntries(KYC_STATUSES.map((s) => [s, 0]));
  for (const r of counts.results || []) byStatus[r.status] = (byStatus[r.status] || 0) + Number(r.n);
  const rows: QueueRow[] = (page.results || []).map((r: any) => {
    const flags: string[] = [];
    if (r.pep === 1 || r.pep === 'true') flags.push('pep');
    if (r.auto_result === 'fail') flags.push('auto_failed');
    if (!r.has_document && r.status !== 'not_started') flags.push('no_document');
    return {
      id: r.id, name: r.name ?? null, email: r.email, role: r.role, status: r.status,
      submitted_at: r.kyc_submitted_at ?? null, reviewed_at: r.kyc_reviewed_at ?? null,
      wait_days: r.wait_days == null ? null : Number(r.wait_days),
      id_type: r.id_type ?? null, country: r.country ?? null, flags,
      assignee: r.kyc_assignee_id ? { id: r.kyc_assignee_id, name: r.assignee_name ?? null } : null,
      assigned_at: r.kyc_assigned_at ?? null,
      reviewer: r.kyc_reviewed_by ? { id: r.kyc_reviewed_by, name: r.reviewer_name ?? null } : null,
    };
  });
  return { rows, total: Number(total?.n ?? 0), page: q.page, page_size: q.pageSize, counts: byStatus };
}

// ---------------------------------------------------------------------------
// The figures (KYC3)
// ---------------------------------------------------------------------------

export const WAIT_BANDS = ['under_1_day', '1_to_3_days', '3_to_7_days', 'over_7_days', 'not_recorded'] as const;

/** The median of a list; null when the list is empty. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function waitBand(days: number | null): typeof WAIT_BANDS[number] {
  if (days == null || !Number.isFinite(days)) return 'not_recorded';
  if (days < 1) return 'under_1_day';
  if (days < 3) return '1_to_3_days';
  if (days < 7) return '3_to_7_days';
  return 'over_7_days';
}

/**
 * Decisions per week over the last eight weeks, the median hours from a
 * submission to its decision over the last 90 days, and how long the people
 * still waiting have waited. Only recorded events count: a decision before
 * migration 614 has none, and a median over nothing is null with its reason.
 */
export async function readFigures(env: Env): Promise<{
  weeks: Array<{ week_start: string; approved: number; rejected: number; needs_info: number }>;
  median_hours_to_decision: number | null; median_reason: string | null; decisions_measured: number;
  wait_bands: Record<string, number>;
}> {
  const [weekly, durations, waiting] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at, 'weekday 0', '-6 days') AS week_start, kind, COUNT(*) AS n
         FROM kyc_case_events
        WHERE kind IN ('approved', 'rejected', 'needs_info') AND created_at >= datetime('now', '-56 days')
        GROUP BY week_start, kind`,
    ).all<{ week_start: string; kind: string; n: number }>(),
    env.DB.prepare(
      `SELECT (julianday(created_at) - julianday(submitted_at)) * 24 AS hours
         FROM kyc_case_events
        WHERE kind IN ('approved', 'rejected', 'needs_info') AND submitted_at IS NOT NULL
          AND created_at >= datetime('now', '-90 days')`,
    ).all<{ hours: number }>(),
    env.DB.prepare(
      `SELECT CASE WHEN kyc_submitted_at IS NULL THEN NULL
                   ELSE julianday('now') - julianday(kyc_submitted_at) END AS days
         FROM users WHERE kyc_status = 'pending'`,
    ).all<{ days: number | null }>(),
  ]);
  const weeks = new Map<string, { week_start: string; approved: number; rejected: number; needs_info: number }>();
  for (const r of weekly.results || []) {
    const w = weeks.get(r.week_start) || { week_start: r.week_start, approved: 0, rejected: 0, needs_info: 0 };
    (w as any)[r.kind] = Number(r.n);
    weeks.set(r.week_start, w);
  }
  const hours = (durations.results || []).map((r) => Number(r.hours)).filter((h) => Number.isFinite(h) && h >= 0);
  const med = median(hours);
  const bands: Record<string, number> = Object.fromEntries(WAIT_BANDS.map((b) => [b, 0]));
  for (const r of waiting.results || []) bands[waitBand(r.days == null ? null : Number(r.days))] += 1;
  return {
    weeks: [...weeks.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)),
    median_hours_to_decision: med == null ? null : Math.round(med * 10) / 10,
    median_reason: med == null ? 'No decision in the last 90 days has its submission time recorded.' : null,
    decisions_measured: hours.length,
    wait_bands: bands,
  };
}

// ---------------------------------------------------------------------------
// The expiry hand-off (trust.ts)
// ---------------------------------------------------------------------------

/**
 * An expired `kyc_v1` moves its person from approved to expired, records the
 * event, tells them, and re-opens the obligation as pending so the nightly
 * reconciliation satisfies it again once a new check is approved. A person
 * with a satisfied `kyc_v1` beside the expired one stays approved. Idempotent:
 * the UPDATE only moves an approved person, once.
 */
export async function expireKycFromObligations(env: Env): Promise<number> {
  const due = await env.DB.prepare(
    `SELECT u.id, u.kyc_submitted_at FROM users u
      WHERE u.kyc_status = 'approved'
        AND EXISTS (SELECT 1 FROM legal_obligations lo WHERE lo.user_id = u.id AND lo.obligation_key = 'kyc_v1' AND lo.status = 'expired')
        AND NOT EXISTS (SELECT 1 FROM legal_obligations lo WHERE lo.user_id = u.id AND lo.obligation_key = 'kyc_v1' AND lo.status = 'satisfied')`,
  ).all<{ id: number; kyc_submitted_at: string | null }>();
  let moved = 0;
  for (const r of due.results || []) {
    const res = await env.DB.prepare(`UPDATE users SET kyc_status = 'expired' WHERE id = ? AND kyc_status = 'approved'`).bind(r.id).run();
    if (!res.meta?.changes) continue;
    moved += 1;
    await env.DB.prepare(
      `UPDATE legal_obligations SET status = 'pending', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND obligation_key = 'kyc_v1' AND status = 'expired'`,
    ).bind(r.id).run();
    await recordEvent(env, { userId: r.id, kind: 'expired', actorId: null, submittedAt: r.kyc_submitted_at });
    await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
      .bind('kyc_expired', `KYC expired for user_id=${r.id}: kyc_v1 is past its 24 months`, 'system', r.id).run();
    await noticeMember(env, r.id, 'expired');
  }
  return moved;
}
