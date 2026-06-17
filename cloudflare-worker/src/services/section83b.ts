import type { Env } from '../types';

/**
 * Task #13 — Section 83(b) election tracker (worker / D1 parity).
 *
 * Founders have a hard 30-day deadline from the equity grant date to mail
 * their 83(b) election to the IRS. Missing it converts the grant to ordinary
 * income at vest — a common, avoidable, and permanent tax mistake. The dev
 * FastAPI backend (backend/app/api/routes/legal.py) is the authoritative
 * contract; this mirrors it on the production Worker so /incorporate/83b is
 * functional in prod. The DTO shape here MUST stay in lockstep with
 * `_tracker_dto` in the FastAPI backend (the frontend consumes both).
 */

let _migrated = false;

/**
 * Self-healing schema for the trackers table. Mirrors the `ensure*Schema`
 * pattern (services/incorporations.ts): module-level flag, idempotent
 * `CREATE TABLE IF NOT EXISTS`, swallow "already exists" so concurrent
 * callers don't 500. The unique index makes create idempotent at the DB
 * layer (project_id + user_id + grant_date).
 */
export async function ensureSection83bSchema(env: Env): Promise<void> {
  if (_migrated) return;
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
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e) {
      const msg = (e as Error).message || '';
      if (!/duplicate column|already exists/i.test(msg)) throw e;
    }
  }
  _migrated = true;
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
    created_at: t.created_at,
    updated_at: t.updated_at,
    checklist: [
      { key: 'draft', label: 'Generate the 83(b) election', done: t.election_doc_id != null },
      { key: 'sign', label: 'Print, sign, and date the election', done: mailed },
      { key: 'mail', label: 'Mail to the IRS service center via USPS Certified Mail', done: t.mailed_at != null },
      { key: 'receipt', label: 'Upload your certified-mail receipt (PS Form 3800)', done: t.receipt_doc_id != null },
      { key: 'copy_company', label: 'Send a signed copy to the Company', done: t.status === 'confirmed' },
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
