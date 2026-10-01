import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

/**
 * Task #13 — Section 83(b) election tracker (worker / D1 parity).
 *
 * Founders have a hard 30-day deadline from the equity grant date to mail
 * their 83(b) election to the IRS. Missing it converts the grant to ordinary
 * income at vest — a common, avoidable, and permanent tax mistake. The dev
 * FastAPI backend (backend/app/api/routes/legal.py) is the authoritative
 * contract; this mirrors it on the production Worker so /spinout-lab/83b is
 * functional in prod. The DTO shape here MUST stay in lockstep with
 * `_tracker_dto` in the FastAPI backend (the frontend consumes both).
 */

const MIGRATED = new WeakMap<object, boolean>();

/**
 * Self-healing schema for the trackers table. Mirrors the `ensure*Schema`
 * pattern (services/incorporations.ts): module-level flag, idempotent
 * `CREATE TABLE IF NOT EXISTS`, swallow "already exists" so concurrent
 * callers don't 500. The unique index makes create idempotent at the DB
 * layer (project_id + user_id + grant_date).
 */
export async function ensureSection83bSchema(env: Env): Promise<void> {
  if (MIGRATED.get(bindingKey(env))) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS section_83b_trackers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uid             TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL,
      taxpayer_name   TEXT NOT NULL,
      grant_date      TEXT NOT NULL,
      deadline_date   TEXT NOT NULL,
      mailed_at       TEXT,
      receipt_doc_id  INTEGER REFERENCES documents(id),
      election_doc_id INTEGER REFERENCES documents(id),
      status          TEXT NOT NULL DEFAULT 'pending',
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_83b_project_user_grant
       ON section_83b_trackers(project_id, user_id, grant_date)`,
    `CREATE INDEX IF NOT EXISTS idx_83b_deadline ON section_83b_trackers(deadline_date)`,
    `CREATE INDEX IF NOT EXISTS idx_83b_user ON section_83b_trackers(user_id)`,
    // Migration 310 (D361) — the filing record. Declared there; these are the
    // D235 safety net for a cold isolate on a database the runner has not
    // reached yet. "duplicate column" is swallowed below, so on every
    // migrated database each is a no-op.
    'ALTER TABLE section_83b_trackers ADD COLUMN filing_method TEXT',
    'ALTER TABLE section_83b_trackers ADD COLUMN tracking_number TEXT',
    'ALTER TABLE section_83b_trackers ADD COLUMN irs_service_center TEXT',
    'ALTER TABLE section_83b_trackers ADD COLUMN company_ack_at TEXT',
    'ALTER TABLE section_83b_trackers ADD COLUMN tax_return_copy_at TEXT',
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  MIGRATED.set(bindingKey(env), true);
}

/** UTC midnight (ms) for an ISO `YYYY-MM-DD` date string. */
function dayMsUTC(isoDate: string): number {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** UTC midnight (ms) for today. */
function todayMsUTC(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** Add `n` whole days to an ISO `YYYY-MM-DD` date, returning `YYYY-MM-DD`. */
export function addDaysISO(isoDate: string, n: number): string {
  return new Date(dayMsUTC(isoDate) + n * 86400000).toISOString().slice(0, 10);
}

export interface Section83bRow {
  id: number;
  uid: string;
  project_id: number;
  user_id: number;
  taxpayer_name: string;
  grant_date: string;
  deadline_date: string;
  mailed_at: string | null;
  receipt_doc_id: number | null;
  election_doc_id: number | null;
  status: string;
  notes: string | null;
  // Migration 310 (D361). Null until the founder records them.
  filing_method?: string | null;
  tracking_number?: string | null;
  irs_service_center?: string | null;
  company_ack_at?: string | null;
  tax_return_copy_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Serialize a DB row into the DTO the frontend expects. Keep field names +
 * the checklist / irs_mailing_steps copy in lockstep with the FastAPI
 * `_tracker_dto`.
 */
export function tracker83bDto(t: Section83bRow) {
  const daysLeft = Math.round((dayMsUTC(t.deadline_date) - todayMsUTC()) / 86400000);
  const overdue = daysLeft < 0 && t.status !== 'mailed' && t.status !== 'confirmed';
  const mailed = t.status === 'mailed' || t.status === 'confirmed';
  return {
    id: t.id,
    uid: t.uid,
    project_id: t.project_id,
    user_id: t.user_id,
    taxpayer_name: t.taxpayer_name,
    grant_date: String(t.grant_date).slice(0, 10),
    deadline_date: String(t.deadline_date).slice(0, 10),
    days_left: daysLeft,
    overdue,
    mailed_at: t.mailed_at ?? null,
    receipt_doc_id: t.receipt_doc_id ?? null,
    election_doc_id: t.election_doc_id ?? null,
    status: t.status,
    notes: t.notes ?? null,
    filing_method: t.filing_method ?? null,
    tracking_number: t.tracking_number ?? null,
    irs_service_center: t.irs_service_center ?? null,
    company_ack_at: t.company_ack_at ?? null,
    tax_return_copy_at: t.tax_return_copy_at ?? null,
    created_at: t.created_at,
    updated_at: t.updated_at,
    checklist: [
      { key: 'draft', label: 'Generate the 83(b) election', done: t.election_doc_id != null },
      { key: 'sign', label: 'Print, sign, and date the election', done: mailed },
      { key: 'mail', label: 'Mail to the IRS service center via USPS Certified Mail', done: t.mailed_at != null },
      { key: 'receipt', label: 'Upload your certified-mail receipt (PS Form 3800)', done: t.receipt_doc_id != null },
      { key: 'copy_company', label: 'Send a signed copy to the Company', done: t.company_ack_at != null || t.status === 'confirmed' },
      { key: 'personal_records', label: 'Keep a copy in your personal tax records', done: t.status === 'confirmed' },
    ],
    irs_mailing_steps: [
      'Fill in your name, SSN, taxpayer address, and the property details.',
      'Sign and date the election in two places.',
      'Make 3 copies (IRS, Company, personal records).',
      'Mail the original to the IRS Service Center for your state of residence via USPS Certified Mail with Return Receipt Requested.',
      'Save the green PS Form 3800 receipt — that is your filing-date proof.',
      "Upload the receipt here and mark the tracker 'confirmed' once you receive the green card back.",
    ],
  };
}

// ---------------------------------------------------------------------------
// D361 — the filing record (migration 310).
// ---------------------------------------------------------------------------

/**
 * How the founder filed. Recorded, never suggested: the page offers the three
 * as choices with no default, and nothing here ranks them.
 */
export const FILING_METHODS = ['certified_mail', 'private_delivery', 'irs_online'] as const;
export type FilingMethod = (typeof FILING_METHODS)[number];

/** True for a real `YYYY-MM-DD` calendar date (2026-02-31 is not one). */
export function isCalendarDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export interface FilingPatchBody {
  mailed_on?: unknown;
  mailed_at?: unknown;
  filing_method?: unknown;
  tracking_number?: unknown;
  irs_service_center?: unknown;
  company_ack_on?: unknown;
  tax_return_copy_on?: unknown;
  status?: unknown;
}

export interface FilingPatchSet {
  mailed_at?: string;
  status?: string;
  filing_method?: string | null;
  tracking_number?: string | null;
  irs_service_center?: string | null;
  company_ack_at?: string | null;
  tax_return_copy_at?: string | null;
}

export type FilingPatchResult =
  | { ok: true; set: FilingPatchSet }
  | { ok: false; code: string; message: string };

const TRACKING_RE = /^[A-Za-z0-9 -]{1,40}$/;
const STATUSES = ['pending', 'mailed', 'confirmed', 'missed'];

/**
 * Validate the filing-record half of a PATCH against the stored tracker.
 *
 * Every date is one the founder supplies: a real calendar date, not before the
 * grant date (nothing about this election can precede the transfer), and not
 * after `todayIso` plus one day — the one day because `todayIso` is UTC and a
 * founder east of UTC is already on tomorrow's date when they mail. The clock
 * never supplies a date here; that was the defect (D360, D361).
 *
 * Returns only the columns the body touched, so an unrelated PATCH (notes, a
 * receipt id) changes nothing else. Messages are our own sentences.
 */
export function validateFilingPatch(
  body: FilingPatchBody,
  t: Pick<Section83bRow, 'grant_date' | 'status' | 'mailed_at'>,
  todayIso: string,
): FilingPatchResult {
  const set: FilingPatchSet = {};
  const grant = String(t.grant_date).slice(0, 10);
  const latest = addDaysISO(todayIso, 1);
  const bounded = (v: string) => v >= grant && v <= latest;

  const dateField = (
    raw: unknown, name: string, what: string,
  ): { ok: true; value: string | null } | { ok: false; code: string; message: string } => {
    if (raw === null || raw === '') return { ok: true, value: null };
    if (!isCalendarDate(raw)) {
      return { ok: false, code: `invalid_${name}`, message: `${what} must be a real date (YYYY-MM-DD).` };
    }
    if (!bounded(raw)) {
      return { ok: false, code: `${name}_out_of_range`, message: `${what} must fall between the stock transfer date and today.` };
    }
    return { ok: true, value: raw };
  };

  let mailedAt: string | null | undefined;
  if (body.mailed_on !== undefined) {
    if (body.mailed_on === null || body.mailed_on === '') {
      return { ok: false, code: 'mailed_on_required', message: 'Enter the date the election was mailed or submitted.' };
    }
    const r = dateField(body.mailed_on, 'mailed_on', 'The mailing date');
    if (!r.ok) return r;
    mailedAt = r.value;
  } else if (body.mailed_at !== undefined && body.mailed_at !== null) {
    // The pre-D361 field, an ISO datetime. Held to the same bounds by its date.
    const parsed = Date.parse(String(body.mailed_at));
    if (Number.isNaN(parsed)) {
      return { ok: false, code: 'invalid_mailed_at', message: 'The mailing date must be a date.' };
    }
    const day = new Date(parsed).toISOString().slice(0, 10);
    if (!bounded(day)) {
      return { ok: false, code: 'mailed_at_out_of_range', message: 'The mailing date must fall between the stock transfer date and today.' };
    }
    mailedAt = new Date(parsed).toISOString();
  }
  if (mailedAt) {
    set.mailed_at = mailedAt;
    if (t.status === 'pending') set.status = 'mailed';
  }

  if (body.filing_method !== undefined) {
    if (body.filing_method === null || body.filing_method === '') set.filing_method = null;
    else if ((FILING_METHODS as readonly string[]).includes(String(body.filing_method))) set.filing_method = String(body.filing_method);
    else return { ok: false, code: 'invalid_filing_method', message: 'Choose how the election was filed.' };
  }

  if (body.tracking_number !== undefined) {
    const v = body.tracking_number === null ? '' : String(body.tracking_number).trim();
    if (v === '') set.tracking_number = null;
    else if (TRACKING_RE.test(v)) set.tracking_number = v;
    else return { ok: false, code: 'invalid_tracking_number', message: 'A tracking number is up to 40 letters, digits, spaces or hyphens.' };
  }

  if (body.irs_service_center !== undefined) {
    const v = body.irs_service_center === null ? '' : String(body.irs_service_center).trim();
    if (v === '') set.irs_service_center = null;
    // eslint-disable-next-line no-control-regex
    else if (v.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v)) set.irs_service_center = v;
    else return { ok: false, code: 'invalid_irs_service_center', message: 'The service center is up to 120 characters on one line.' };
  }

  if (body.company_ack_on !== undefined) {
    const r = dateField(body.company_ack_on, 'company_ack_on', "The company's acknowledgment date");
    if (!r.ok) return r;
    set.company_ack_at = r.value;
  }

  if (body.tax_return_copy_on !== undefined) {
    const r = dateField(body.tax_return_copy_on, 'tax_return_copy_on', 'The tax-return copy date');
    if (!r.ok) return r;
    set.tax_return_copy_at = r.value;
  }

  if (body.status !== undefined && body.status !== null) {
    const s = String(body.status);
    if (!STATUSES.includes(s)) return { ok: false, code: 'invalid_status', message: 'That is not a tracker status.' };
    // "Confirmed" is the IRS delivery confirmation (the green card). It cannot
    // come before a mailing date is on record — in this PATCH or already.
    const mailedOnRecord = Boolean(set.mailed_at ?? t.mailed_at);
    if (s === 'confirmed' && !mailedOnRecord) {
      return { ok: false, code: 'confirm_before_mailed', message: 'Record the mailing date before confirming delivery.' };
    }
    set.status = s;
  }

  return { ok: true, set };
}
