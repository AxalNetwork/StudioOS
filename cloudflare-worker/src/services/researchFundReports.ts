/**
 * D7169 (#7169) — the quarterly reports a founder records in a private fund
 * dossier (`research_fund_reports`, migration 230): field validation, the
 * create-only insert and the partial update with a revision check. The routes
 * in `routes/research.ts` gate the caller and map each outcome to a response.
 *
 * WHY A PARTIAL UPDATE. The old POST upserted every column from the body, so
 * resubmitting a quarter to add one return cleared its NAV, IRR, TVPI and
 * note. Now POST only creates (a saved period answers `period_exists`) and
 * PATCH changes what the body names: an absent field keeps its saved value,
 * `null` clears it to Not recorded.
 *
 * WHY A REVISION. Two tabs editing the same quarter used to end with the
 * second save silently winning. PATCH takes the row's `updated_at` as
 * If-Match and answers `report_changed` with the current row when it moved,
 * so the page can show both versions field by field.
 *
 * WHY FIELD ERRORS. A non-number used to be stored as null without a word, so
 * a typo erased a figure. Every field is checked and a refusal names each
 * field with its own sentence.
 *
 * Units, unchanged from migration 230: money in USD cents, the return and
 * the IRR in basis points, TVPI in hundredths (1.4× is 140; the migration's
 * comment calls it basis points, the form has always stored hundredths). A
 * per-report currency is a proposed dependency, not built.
 */

export type ReportRow = {
  uid: string;
  period: string;
  report_date: string | null;
  fund_size_cents: number | null;
  nav_cents: number | null;
  quarterly_return_bps: number | null;
  net_irr_bps: number | null;
  tvpi_bps: number | null;
  source_url: string | null;
  report_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type FieldError = { field: string; detail: string };

type Db = {
  prepare: (sql: string) => {
    bind: (...args: unknown[]) => {
      first: <T = unknown>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results?: T[] }>;
      run: () => Promise<{ meta?: { changes?: number } }>;
    };
  };
};

/** The integer fields, their range and the sentence for a value outside it. */
const NUMBERS: Record<string, { min: number; max: number; what: string }> = {
  fund_size_cents: { min: 0, max: 1e17, what: 'Fund size must be a whole number of US cents, zero or more.' },
  nav_cents: { min: 0, max: 1e17, what: 'NAV must be a whole number of US cents, zero or more.' },
  // A quarter cannot lose more than everything: −100.00% is −10000 bps.
  quarterly_return_bps: { min: -10000, max: 1000000, what: 'Quarterly return must be whole basis points between −10000 (−100%) and 1000000.' },
  net_irr_bps: { min: -10000, max: 1000000, what: 'Net IRR must be whole basis points between −10000 (−100%) and 1000000.' },
  tvpi_bps: { min: 0, max: 100000, what: 'TVPI must be whole hundredths of a multiple (1.4× is 140), zero or more.' },
};
export const NUMBER_FIELDS = Object.keys(NUMBERS);
const TEXTS: Record<string, number> = { report_url: 500, notes: 2000 };

const PERIOD = /^\d{4}-Q[1-4]$/;
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k);

const isHttpUrl = (s: string) => {
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
};

const isIsoDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/**
 * Checks the fields a body names and returns the values to write. `create`
 * requires a period and a source URL; `patch` writes only the keys present.
 * Unknown keys are ignored. Nothing is coerced: a string where a number
 * belongs is an error, never a null.
 */
export function parseReportFields(body: unknown, mode: 'create' | 'patch'): { values: Record<string, unknown>; errors: FieldError[] } {
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  if (mode === 'create') {
    const period = typeof b.period === 'string' ? b.period.trim() : '';
    if (!PERIOD.test(period)) errors.push({ field: 'period', detail: 'Period must use YYYY-Q1 through YYYY-Q4.' });
    else values.period = period;
  }

  for (const [field, rule] of Object.entries(NUMBERS)) {
    if (!has(b, field)) continue;
    const v = b[field];
    if (v === null) { values[field] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push({ field, detail: `${rule.what} It was not a number.` }); continue; }
    if (!Number.isInteger(v) || v < rule.min || v > rule.max) { errors.push({ field, detail: rule.what }); continue; }
    values[field] = v;
  }

  if (has(b, 'source_url') || mode === 'create') {
    const v = b.source_url;
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) errors.push({ field: 'source_url', detail: 'A source URL is required for a quarterly report.' });
    else if (s.length > 500 || !isHttpUrl(s)) errors.push({ field: 'source_url', detail: 'The source URL must be a web address starting with https://, up to 500 characters.' });
    else values.source_url = s;
  }

  if (has(b, 'report_url')) {
    const v = b.report_url;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === null || s === '') values.report_url = null;
    else if (typeof s !== 'string' || s.length > TEXTS.report_url || !isHttpUrl(s)) errors.push({ field: 'report_url', detail: 'The report URL must be a web address starting with https://, up to 500 characters.' });
    else values.report_url = s;
  }

  if (has(b, 'notes')) {
    const v = b.notes;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === null || s === '') values.notes = null;
    else if (typeof s !== 'string') errors.push({ field: 'notes', detail: 'The note must be text.' });
    else if (s.length > TEXTS.notes) errors.push({ field: 'notes', detail: `The note is ${s.length} characters; the limit is ${TEXTS.notes}.` });
    else values.notes = s;
  }

  if (has(b, 'report_date')) {
    const v = b.report_date;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === null || s === '') values.report_date = null;
    else if (typeof s !== 'string' || !isIsoDate(s)) errors.push({ field: 'report_date', detail: 'The report date must be a calendar date written YYYY-MM-DD.' });
    else values.report_date = s;
  }

  return { values, errors };
}

/** The next revision stamp: now, or one millisecond past the last one if the clock has not moved. */
export function nextRevision(previous: string | null | undefined, now: Date = new Date()): string {
  const prev = previous ? Date.parse(previous) : NaN;
  const t = Number.isFinite(prev) && prev >= now.getTime() ? prev + 1 : now.getTime();
  return new Date(t).toISOString();
}

/** If-Match as sent: a bare stamp, or quoted, or weak (`W/"…"`). */
export function readIfMatch(header: string | null | undefined): string | null {
  if (!header) return null;
  const t = header.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1').trim();
  return t || null;
}

async function readReport(db: Db, ownerId: number, fundUid: string, where: { uid?: string; period?: string }) {
  if (where.uid) {
    return db.prepare(
      `SELECT uid, period, report_date, fund_size_cents, nav_cents, quarterly_return_bps, net_irr_bps, tvpi_bps,
              source_url, report_url, notes, created_at, updated_at
         FROM research_fund_reports WHERE uid = ? AND fund_uid = ? AND owner_user_id = ?`,
    ).bind(where.uid, fundUid, ownerId).first<ReportRow>();
  }
  return db.prepare(
    `SELECT uid, period, report_date, fund_size_cents, nav_cents, quarterly_return_bps, net_irr_bps, tvpi_bps,
              source_url, report_url, notes, created_at, updated_at
         FROM research_fund_reports WHERE period = ? AND fund_uid = ? AND owner_user_id = ?`,
  ).bind(where.period, fundUid, ownerId).first<ReportRow>();
}

export type CreateOutcome =
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'period_exists'; report: ReportRow }
  | { kind: 'created'; report: ReportRow };

/** Create-only: a period that already has a report is never overwritten. */
export async function createReport(db: Db, ownerId: number, fundUid: string, body: unknown, uid: string, now: string): Promise<CreateOutcome> {
  const { values, errors } = parseReportFields(body, 'create');
  if (errors.length) return { kind: 'invalid', errors };
  const v = (k: string) => (values[k] === undefined ? null : values[k]);
  const res = await db.prepare(
    `INSERT INTO research_fund_reports
       (uid, fund_uid, owner_user_id, period, report_date, fund_size_cents,
        nav_cents, quarterly_return_bps, net_irr_bps, tvpi_bps, source_url,
        report_url, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (fund_uid, owner_user_id, period) DO NOTHING`,
  ).bind(
    uid, fundUid, ownerId, values.period, v('report_date'), v('fund_size_cents'),
    v('nav_cents'), v('quarterly_return_bps'), v('net_irr_bps'), v('tvpi_bps'), v('source_url'),
    v('report_url'), v('notes'), now, now,
  ).run();
  const row = await readReport(db, ownerId, fundUid, { period: values.period as string });
  if (!res.meta?.changes) return { kind: 'period_exists', report: row as ReportRow };
  return { kind: 'created', report: row as ReportRow };
}

export type PatchOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'revision_required' }
  | { kind: 'report_changed'; report: ReportRow }
  | { kind: 'updated'; report: ReportRow; changed: string[] };

const WRITABLE = ['report_date', 'fund_size_cents', 'nav_cents', 'quarterly_return_bps', 'net_irr_bps', 'tvpi_bps', 'source_url', 'report_url', 'notes'] as const;

/**
 * Partial update against a revision. Absent keeps, null clears. The UPDATE
 * names the revision it read in its WHERE, so a write between the read and
 * the write is caught as `report_changed`, not overwritten.
 */
export async function patchReport(
  db: Db, ownerId: number, fundUid: string, reportUid: string, body: unknown, ifMatch: string | null, now: Date = new Date(),
): Promise<PatchOutcome> {
  const existing = await readReport(db, ownerId, fundUid, { uid: reportUid });
  if (!existing) return { kind: 'not_found' };
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const { values, errors } = parseReportFields(b, 'patch');
  if (has(b, 'period') && String(b.period ?? '').trim() !== existing.period) {
    errors.unshift({ field: 'period', detail: 'The period of a saved report cannot change. Delete it and add the other quarter.' });
  }
  if (errors.length) return { kind: 'invalid', errors };
  if (!ifMatch) return { kind: 'revision_required' };
  if (ifMatch !== existing.updated_at) return { kind: 'report_changed', report: existing };

  const changed = WRITABLE.filter((k) => values[k] !== undefined && values[k] !== existing[k]);
  if (!changed.length) return { kind: 'updated', report: existing, changed };
  const next = Object.fromEntries(WRITABLE.map((k) => [k, values[k] !== undefined ? values[k] : existing[k]]));
  const res = await db.prepare(
    `UPDATE research_fund_reports
        SET report_date = ?, fund_size_cents = ?, nav_cents = ?, quarterly_return_bps = ?,
            net_irr_bps = ?, tvpi_bps = ?, source_url = ?, report_url = ?, notes = ?, updated_at = ?
      WHERE uid = ? AND fund_uid = ? AND owner_user_id = ? AND updated_at = ?`,
  ).bind(
    next.report_date, next.fund_size_cents, next.nav_cents, next.quarterly_return_bps,
    next.net_irr_bps, next.tvpi_bps, next.source_url, next.report_url, next.notes, nextRevision(existing.updated_at, now),
    reportUid, fundUid, ownerId, existing.updated_at,
  ).run();
  const row = await readReport(db, ownerId, fundUid, { uid: reportUid });
  if (!row) return { kind: 'not_found' };
  if (!res.meta?.changes) return { kind: 'report_changed', report: row };
  return { kind: 'updated', report: row, changed: [...changed] };
}

/** One sentence for a refusal that names fields: the field's own when there is one, else a count. */
export function fieldErrorSentence(errors: FieldError[]): string {
  if (errors.length === 1) return errors[0].detail;
  return `${errors.length} fields need a fix: ${errors.map((e) => e.field).join(', ')}.`;
}
