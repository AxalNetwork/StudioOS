/**
 * D1232 (#3240) — KYC & KYB part 4: the renewals read (KYC9), the renewal
 * periods (KYC17c), the studio audit read (KYC10) and its export (KYC17d).
 * `routes/kyc_governance.ts` gates each one; nothing here checks a role.
 *
 * NAMES AND ACTIONS ONLY. The audit never returns an `activity_logs.details`
 * sentence as written: a rejection's reason is free text an admin typed, and
 * the identity rows name a field. Each row is rebuilt from the parts this code
 * can read with certainty (the case's account id, the field's key, a row
 * count, whether a document was purged) and nothing else, so no document, no
 * shown value and no typed reason reaches a reader or the export.
 *
 * THE CASE IS PARSED FROM `details`. `routes/kyc.ts` writes `user_id=<n>` into
 * each case row's sentence and leaves `activity_logs.entity_id` empty, so the
 * read takes the number from there. A row whose sentence carries none (the
 * queue read) has no case, and says so.
 */
import type { Env } from '../types';
import {
  DEFAULT_PERIOD_MONTHS, OBLIGATION_LABELS, RENEWAL_PERIOD_KEYS, RENEWAL_THRESHOLDS,
  renewalPeriods, type RenewalPeriodKey,
} from './trust';

const DAY_MS = 86_400_000;
const sqlTs = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const parseTs = (s: unknown) => Date.parse(String(s || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || '')) ? '' : 'Z'));

// ---------------------------------------------------------------------------
// KYC9 — renewals
// ---------------------------------------------------------------------------

/** The checks the Renewals tab lists, as the read's IN list names them. Accreditation stays off this page (#2384 owner question 5). */
const KIND_OF: Record<string, 'person' | 'business'> = { kyc_v1: 'person', kyb_v1: 'business' };

export const RECHECKS_UNREADABLE = 'The re-checks could not be read. This is not a claim that none is waiting.';

/**
 * Re-checks asked and not yet answered (D1229's `kyc_case_events`): for each
 * person, the latest `recheck`, open while no submission came after it.
 * Returns each open ask by person, or null when the events cannot be read.
 */
async function openRechecks(env: Env): Promise<Map<number, string> | null> {
  try {
    const res = await env.DB.prepare(
      `SELECT r.user_id, r.asked FROM (
         SELECT user_id, MAX(datetime(created_at)) AS asked FROM kyc_case_events WHERE kind = 'recheck' GROUP BY user_id
       ) r
       WHERE NOT EXISTS (SELECT 1 FROM kyc_case_events s WHERE s.user_id = r.user_id AND s.kind = 'submitted' AND datetime(s.created_at) >= r.asked)`,
    ).all<{ user_id: number; asked: string }>();
    return new Map((res.results || []).map((x) => [Number(x.user_id), String(x.asked)]));
  } catch {
    return null;
  }
}
export const SCREENING_UNREADABLE = 'The screening record could not be read. This is not a claim that everyone was screened.';

/**
 * Approved people whose latest sanctions screening is over 12 months old, and
 * those never screened. Every screening run writes a `sanctions_screenings`
 * row (`services/sanctions.ts`); a run that failed writes none, which is why
 * "never screened" is its own count and never folded into "screened".
 */
async function screeningAge(env: Env, now: Date) {
  const year = new Date(now.getTime());
  year.setUTCFullYear(year.getUTCFullYear() - 1);
  try {
    const row = await env.DB.prepare(
      `SELECT SUM(CASE WHEN s.last_run IS NOT NULL AND s.last_run < datetime(?) THEN 1 ELSE 0 END) AS stale,
              SUM(CASE WHEN s.last_run IS NULL THEN 1 ELSE 0 END) AS never
         FROM users u
         LEFT JOIN (SELECT user_id, MAX(datetime(run_at)) AS last_run FROM sanctions_screenings GROUP BY user_id) s ON s.user_id = u.id
        WHERE u.kyc_status = 'approved'`,
    ).bind(sqlTs(year)).first<{ stale: number | null; never: number | null }>();
    return { recorded: true, count: Number(row?.stale ?? 0), never_screened: Number(row?.never ?? 0) };
  } catch {
    return { recorded: false, unreadable: true, reason: SCREENING_UNREADABLE };
  }
}

export type RenewalFilter = 'all' | 'soon' | 'expired';

/**
 * Every KYC and KYB check that has expired or expires in the next 12 months:
 * expired first, then the soonest. A check with no date (never satisfied) is
 * not a renewal, and is left out. Counts and the month chart are over every
 * row; the filter, search and page narrow only the list.
 */
export async function kycRenewals(env: Env, opts: { filter?: RenewalFilter; q?: string; page?: number; pageSize?: number; now?: number } = {}) {
  const now = new Date(opts.now ?? Date.now());
  const horizon = new Date(now.getTime());
  horizon.setUTCMonth(horizon.getUTCMonth() + 12);
  const res = await env.DB.prepare(
    `SELECT lo.id, lo.user_id, lo.obligation_key, lo.status, lo.expires_at, u.name, u.role, u.kyc_status
       FROM legal_obligations lo
       JOIN users u ON u.id = lo.user_id
      WHERE lo.obligation_key IN ('kyc_v1', 'kyb_v1')
        AND lo.status IN ('satisfied', 'expired')
        AND lo.expires_at IS NOT NULL
        AND datetime(lo.expires_at) <= datetime(?)
      ORDER BY CASE WHEN datetime(lo.expires_at) < datetime(?) THEN 0 ELSE 1 END, datetime(lo.expires_at) ASC, lo.id ASC`,
  ).bind(sqlTs(horizon), sqlTs(now)).all<any>();
  const rows = res.results || [];

  // Which of the 30-, 14- and 7-day warnings went out for each row's current
  // date. `renewal_notices` keys a warning by the stored `expires_at`, so a
  // renewed deadline has none until the sweep warns again.
  const warned = new Map<string, string>();
  if (rows.length) {
    const notices = await env.DB.prepare(
      `SELECT subject_id, threshold_days, expires_at, notified_at FROM renewal_notices
        WHERE subject_kind = 'obligation' AND subject_id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(rows.map((r) => Number(r.id)))).all<any>();
    for (const n of notices.results || []) warned.set(`${n.subject_id}|${n.expires_at}|${n.threshold_days}`, String(n.notified_at));
  }

  const rechecks = await openRechecks(env);
  const items = rows.map((r) => {
    const t = parseTs(r.expires_at);
    const daysLeft = Number.isFinite(t) ? Math.floor((t - now.getTime()) / DAY_MS) : null;
    const expired = r.status === 'expired' || (Number.isFinite(t) && t < now.getTime());
    return {
      id: Number(r.id),
      who: { id: Number(r.user_id), name: r.name ?? null, role: r.role ?? null },
      kind: KIND_OF[r.obligation_key],
      check: r.obligation_key,
      what: OBLIGATION_LABELS[r.obligation_key],
      expires_at: r.expires_at,
      days_left: daysLeft,
      expired,
      warned: RENEWAL_THRESHOLDS.map((d) => ({ days: d, sent_at: warned.get(`${r.id}|${r.expires_at}|${d}`) ?? null })),
      obligation_status: r.status,
      // The person's KYC state, for a KYC row. A KYB row's case state is part 3's.
      kyc_status: r.obligation_key === 'kyc_v1' ? (r.kyc_status ?? null) : null,
      // A re-check asked of this person and not answered yet; null when none is open or the events are unreadable.
      recheck_asked_at: r.obligation_key === 'kyc_v1' ? (rechecks?.get(Number(r.user_id)) ?? null) : null,
    };
  });

  const soon = items.filter((i) => !i.expired && i.days_left !== null && i.days_left <= 30);
  const expired = items.filter((i) => i.expired);
  const months = Array.from({ length: 12 }, (_, k) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    return { month: d.toISOString().slice(0, 7), people: 0, businesses: 0 };
  });
  for (const i of items) {
    if (i.expired) continue;
    const m = months.find((x) => String(i.expires_at).startsWith(x.month));
    if (m) { if (i.kind === 'business') m.businesses += 1; else m.people += 1; }
  }

  const q = String(opts.q || '').trim().toLowerCase();
  const filter: RenewalFilter = opts.filter === 'soon' || opts.filter === 'expired' ? opts.filter : 'all';
  const listed = items
    .filter((i) => (filter === 'soon' ? soon.includes(i) : filter === 'expired' ? i.expired : true))
    .filter((i) => !q || String(i.who.name || '').toLowerCase().includes(q));
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);

  return {
    as_of: now.toISOString(),
    horizon: horizon.toISOString(),
    counts: {
      expire_30: { count: soon.length, next: soon[0]?.expires_at ?? null },
      expired: expired.length,
      all: items.length,
      rechecks: rechecks === null
        ? { recorded: false, unreadable: true, reason: RECHECKS_UNREADABLE }
        : { recorded: true, count: rechecks.size, oldest: [...rechecks.values()].sort()[0] ?? null },
      screened_over_12: await screeningAge(env, now),
    },
    months,
    filter,
    total: listed.length,
    page,
    page_size: pageSize,
    items: listed.slice((page - 1) * pageSize, page * pageSize),
  };
}

// ---------------------------------------------------------------------------
// KYC17c — renewal periods
// ---------------------------------------------------------------------------

export const PERIOD_LABELS: Record<RenewalPeriodKey, string> = {
  kyc_v1: 'Identity (KYC)', kyb_v1: 'Entity (KYB)', accreditation_v1: 'Accreditation evidence',
};
/** Where each period is used today. Accreditation has no satisfier yet, so its period is kept and not yet applied. */
const PERIOD_APPLIED: Record<RenewalPeriodKey, { applied: boolean; reason?: string }> = {
  kyc_v1: { applied: true },
  kyb_v1: { applied: true },
  accreditation_v1: { applied: false, reason: 'No route approves accreditation evidence yet, so this period is kept and not yet used.' },
};

export async function kycPeriodsRead(env: Env) {
  const periods = await renewalPeriods(env);
  const by = [...new Set(Object.values(periods).map((p) => p.updated_by).filter((x): x is number => x != null))];
  const names = new Map<number, string>();
  if (by.length) {
    const r = await env.DB.prepare('SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(by)).all<any>();
    for (const u of r.results || []) names.set(Number(u.id), u.name);
  }
  return RENEWAL_PERIOD_KEYS.map((key) => ({
    key,
    label: PERIOD_LABELS[key],
    months: periods[key].months,
    default_months: DEFAULT_PERIOD_MONTHS[key],
    set_by_hq: periods[key].set_by_hq,
    updated_at: periods[key].updated_at,
    updated_by: periods[key].updated_by == null ? null : (names.get(periods[key].updated_by!) ?? null),
    ...PERIOD_APPLIED[key],
  }));
}

/** A refusal of the periods asked for; `sentence` is ours, shown as written. */
export class PeriodInputError extends Error {
  sentence: string;
  constructor(sentence: string) { super('bad_periods'); this.sentence = sentence; }
}

/** The months asked for, each a whole number from 1 to 120, or the refusal. */
export function parsePeriods(body: unknown): Partial<Record<RenewalPeriodKey, number>> {
  const raw = (body as any)?.periods;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PeriodInputError('Send the periods to change, in months.');
  const out: Partial<Record<RenewalPeriodKey, number>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(RENEWAL_PERIOD_KEYS as readonly string[]).includes(k)) throw new PeriodInputError(`${k} is not a check whose period can be set.`);
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 120) throw new PeriodInputError('Each period is a whole number of months from 1 to 120.');
    out[k as RenewalPeriodKey] = v as number;
  }
  if (!Object.keys(out).length) throw new PeriodInputError('Send at least one period to change.');
  return out;
}

/**
 * Sets the periods that differ from the ones in force, in one batch with its
 * log row. Nothing else is written: no `legal_obligations.expires_at` moves.
 * Returns the changes as `from → to`, empty when nothing differed.
 */
export async function kycPeriodsWrite(env: Env, adminId: number, actor: string, asked: Partial<Record<RenewalPeriodKey, number>>) {
  const current = await renewalPeriods(env);
  const changes = Object.entries(asked)
    .filter(([k, m]) => current[k as RenewalPeriodKey].months !== m)
    .map(([k, m]) => ({ key: k as RenewalPeriodKey, from: current[k as RenewalPeriodKey].months, to: m as number }));
  if (!changes.length) return changes;
  const stmts = changes.map((ch) => env.DB.prepare(
    `INSERT INTO kyc_renewal_periods (obligation_key, months, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(obligation_key) DO UPDATE SET months = excluded.months, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(ch.key, ch.to, adminId));
  stmts.push(env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
    .bind('kyc_periods_changed', changes.map((ch) => `${ch.key} ${ch.from}->${ch.to} months`).join('; '), actor, adminId));
  await env.DB.batch(stmts);
  return changes;
}

// ---------------------------------------------------------------------------
// KYC10 / KYC17d — the audit read and its export
// ---------------------------------------------------------------------------

/**
 * The KYC actions the audit lists, each as the canvas words it, and whether it
 * is a look, a decision or a change to the case (assignment, a note). ONLY THE
 * ADMIN-SIDE ROWS: `kyc_approved`, `kyc_rejected` and `kyc_submitted` are the
 * member's own rows, and `kyc_expired` is the system's with the member in
 * `user_id`, so reading them would name a member as the admin. Part 3 adds its
 * actions here as it writes them.
 */
export const KYC_AUDIT_ACTIONS: Record<string, { word: string; kind: 'look' | 'decision' | 'change' }> = {
  kyc_queue_access: { word: 'Opened the list', kind: 'look' },
  kyc_record_access: { word: 'Opened a case', kind: 'look' },
  kyc_case_access: { word: 'Opened a case', kind: 'look' },
  kyc_figures_access: { word: 'Opened the figures', kind: 'look' },
  kyc_field_shown: { word: 'Showed a value', kind: 'look' },
  kyc_document_access: { word: 'Viewed a document', kind: 'look' },
  kyc_renewals_access: { word: 'Opened the renewals', kind: 'look' },
  kyc_audit_access: { word: 'Opened the audit', kind: 'look' },
  kyc_approved_by_admin: { word: 'Approved', kind: 'decision' },
  kyc_bypass_granted: { word: 'Granted without a check', kind: 'decision' },
  kyc_rejected_by_admin: { word: 'Rejected', kind: 'decision' },
  kyc_periods_changed: { word: 'Changed how long checks last', kind: 'decision' },
  kyc_sent_to_hq: { word: 'Sent to HQ', kind: 'decision' },
  kyc_hq_decided: { word: 'HQ decided', kind: 'decision' },
  kyc_needs_info_by_admin: { word: 'Asked for information', kind: 'decision' },
  kyc_recheck_by_admin: { word: 'Asked to verify again', kind: 'decision' },
  kyc_case_assigned: { word: 'Assigned', kind: 'change' },
  kyc_note_added: { word: 'Added a note', kind: 'change' },
};

/**
 * The case a row is about: the LAST `user_id=<n>` in its sentence, because an
 * assignment names the assignee first ("assigned user_id=A to the KYC case
 * for user_id=B").
 */
export function caseIdOf(details: unknown): number | null {
  const all = [...String(details || '').matchAll(/user_id=(\d+)/g)];
  const n = Number(all.at(-1)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const FIELD_LABELS: Record<string, string> = { date_of_birth: 'Date of birth', id_number: 'ID number', address: 'Address', phone: 'Phone' };

/** What a row may say beyond its action, rebuilt from parts this code wrote. Never the sentence itself. */
export function auditDetail(action: string, details: unknown): string | null {
  const d = String(details || '');
  const count = /count=(\d+)/.exec(d)?.[1];
  switch (action) {
    case 'kyc_queue_access': case 'kyc_renewals_access': case 'kyc_audit_access':
      return count ? `${count} ${count === '1' ? 'row' : 'rows'}` : null;
    case 'kyc_field_shown': {
      const f = /showed (\w+) on/.exec(d)?.[1];
      return f && FIELD_LABELS[f] ? FIELD_LABELS[f] : null;
    }
    case 'kyc_document_access':
      return /legacy D1 storage/.test(d) ? 'Document (older storage)' : 'Document';
    case 'kyc_rejected_by_admin': {
      const purged = /document purged: (true|false)/.exec(d)?.[1];
      return purged === 'true' ? 'Document deleted' : purged === 'false' ? 'No document on file' : null;
    }
    case 'kyc_bypass_granted':
      return 'No submission on file';
    case 'kyc_case_assigned':
      return /Admin unassigned the/.test(d) ? 'Unassigned' : null;
    case 'kyc_hq_decided': {
      const v = /^HQ (approved|rejected) the/.exec(d)?.[1];
      return v === 'approved' ? 'Approved' : v === 'rejected' ? 'Rejected' : null;
    }
    case 'kyc_periods_changed': {
      const parts = [...d.matchAll(/(kyc_v1|kyb_v1|accreditation_v1) (\d+)->(\d+) months/g)]
        .map(([, k, a, b]) => `${PERIOD_LABELS[k as RenewalPeriodKey]}: ${a} → ${b} months`);
      return parts.length ? parts.join('; ') : null;
    }
    default:
      return null;
  }
}

/** A refusal of the window or filter asked for; `sentence` is ours, shown as written. */
export class AuditQueryError extends Error {
  sentence: string;
  constructor(sentence: string) { super('bad_query'); this.sentence = sentence; }
}

/** The window asked for: ISO dates, `to` exclusive of the day after, at most 366 days; default the last 30. */
export function auditWindow(fromRaw?: string, toRaw?: string, now = Date.now()) {
  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN);
  const to = toRaw ? day(toRaw) + DAY_MS : now;
  const from = fromRaw ? day(fromRaw) : to - 30 * DAY_MS;
  if ((fromRaw && !Number.isFinite(from)) || (toRaw && !Number.isFinite(to))) throw new AuditQueryError('Dates are YYYY-MM-DD.');
  if (from >= to) throw new AuditQueryError('The start comes before the end.');
  if (to - from > 366 * DAY_MS) throw new AuditQueryError('Ask for at most a year at a time.');
  return { from: new Date(from), to: new Date(to) };
}

/** The most rows one read or export holds; a wider window is refused, never cut short. */
export const AUDIT_ROW_CAP = 20_000;

/** Every audit row in the window, newest first, rebuilt as names and actions. */
export async function kycAuditRows(env: Env, win: { from: Date; to: Date }) {
  const res = await env.DB.prepare(
    `SELECT l.id, l.action, l.details, l.created_at, l.user_id, u.name AS admin_name
       FROM activity_logs l
       LEFT JOIN users u ON u.id = l.user_id
      WHERE l.action IN (SELECT value FROM json_each(?))
        AND datetime(l.created_at) >= datetime(?) AND datetime(l.created_at) < datetime(?)
      ORDER BY datetime(l.created_at) DESC, l.id DESC
      LIMIT ?`,
  ).bind(JSON.stringify(Object.keys(KYC_AUDIT_ACTIONS)), sqlTs(win.from), sqlTs(win.to), AUDIT_ROW_CAP + 1).all<any>();
  const raw = res.results || [];
  if (raw.length > AUDIT_ROW_CAP) throw new AuditQueryError(`More than ${AUDIT_ROW_CAP.toLocaleString('en-US')} rows: ask for a shorter window.`);
  // The assignee of an assignment is named too ("Assigned to …"), as the first of its two ids.
  const assigneeOf = (r: any) => (r.action === 'kyc_case_assigned' ? Number(/assigned user_id=(\d+) to/.exec(String(r.details || ''))?.[1]) || null : null);
  const caseIds = [...new Set(raw.flatMap((r) => [caseIdOf(r.details), assigneeOf(r)]).filter((n): n is number => n != null))];
  const names = new Map<number, string | null>();
  if (caseIds.length) {
    const u = await env.DB.prepare('SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(caseIds)).all<any>();
    for (const x of u.results || []) names.set(Number(x.id), x.name ?? null);
  }
  return raw.map((r) => {
    const a = KYC_AUDIT_ACTIONS[r.action];
    const caseId = caseIdOf(r.details);
    const assignee = assigneeOf(r);
    return {
      id: Number(r.id),
      at: r.created_at,
      admin: { id: r.user_id == null ? null : Number(r.user_id), name: r.admin_name ?? null },
      action: r.action,
      word: a.word,
      kind: a.kind,
      case: caseId ? { id: caseId, name: names.get(caseId) ?? null } : null,
      detail: assignee ? `Assigned to ${names.get(assignee) ?? `account ${assignee}`}` : auditDetail(r.action, r.details),
    };
  });
}

/** The audit read (KYC10): filters, a page, the per-day looks and decisions, and the admins to filter by. */
export async function kycAudit(env: Env, opts: { from?: string; to?: string; action?: string; admin?: number | null; caseId?: number | null; q?: string; page?: number; pageSize?: number; now?: number }) {
  const win = auditWindow(opts.from, opts.to, opts.now);
  if (opts.action && !KYC_AUDIT_ACTIONS[opts.action]) throw new AuditQueryError(`${opts.action} is not an audited action.`);
  const all = await kycAuditRows(env, win);
  const days = new Map<string, { day: string; looks: number; decisions: number }>();
  for (let t = Date.UTC(win.from.getUTCFullYear(), win.from.getUTCMonth(), win.from.getUTCDate()); t < win.to.getTime(); t += DAY_MS) {
    const k = new Date(t).toISOString().slice(0, 10);
    days.set(k, { day: k, looks: 0, decisions: 0 });
  }
  for (const r of all) {
    const d = days.get(String(r.at).slice(0, 10));
    if (d) { if (r.kind === 'decision') d.decisions += 1; else if (r.kind === 'look') d.looks += 1; }
  }
  const admins = [...new Map(all.filter((r) => r.admin.id != null).map((r) => [r.admin.id, r.admin])).values()];
  const q = String(opts.q || '').trim().toLowerCase();
  const listed = all.filter((r) => (!opts.action || r.action === opts.action)
    && (opts.admin == null || r.admin.id === opts.admin)
    && (opts.caseId == null || r.case?.id === opts.caseId)
    && (!q || [r.admin.name, r.case?.name, r.word, r.detail].some((x) => String(x || '').toLowerCase().includes(q))));
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);
  return {
    from: win.from.toISOString(),
    to: win.to.toISOString(),
    per_day: [...days.values()],
    admins,
    actions: Object.entries(KYC_AUDIT_ACTIONS).map(([key, v]) => ({ key, ...v })),
    total: listed.length,
    page,
    page_size: pageSize,
    items: listed.slice((page - 1) * pageSize, page * pageSize),
  };
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The export's CSV: when, admin, action, case and detail. Names and actions only. */
export function auditCsv(rows: Awaited<ReturnType<typeof kycAuditRows>>): string {
  const head = ['When (UTC)', 'Admin', 'Action', 'Case', 'Detail'];
  const body = rows.map((r) => [r.at, r.admin.name ?? (r.admin.id == null ? '' : `Account ${r.admin.id}`), r.word, r.case ? (r.case.name ?? `Account ${r.case.id}`) : '', r.detail ?? '']);
  return [head, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const EXPORT_REASON_MIN = 10;
export const EXPORT_REASON_MAX = 500;
