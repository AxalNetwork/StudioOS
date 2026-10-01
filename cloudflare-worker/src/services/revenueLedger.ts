import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';
import { isCalendarDate, addDaysISO } from './section83b';

/**
 * The Spin-Out Lab revenue ledger (D363, migration 311).
 *
 * One row per payment a founder records against their startup: customer,
 * amount in integer cents, type, the date it was received, and how well it is
 * evidenced. Everything here is pure except the schema bootstrap, so the rules
 * run under node --test without a database.
 *
 * VERIFICATION IS THE WORKER'S. A request never sets it: `verificationFor`
 * derives it from the row. An attached proof document makes an entry
 * `supported`; without one it is `manual`. `verified` is reserved for entries
 * written by a Stripe charge sync, and none exists yet — the Stripe import
 * (routes/progress.ts) records MRR and customer counts, not charges — so no
 * path writes `verified` today, and the page says so.
 */

export const REVENUE_TYPES = ['recurring', 'pilot', 'one_time', 'deposit'] as const;
export type RevenueType = (typeof REVENUE_TYPES)[number];

export const VERIFICATIONS = ['verified', 'supported', 'manual'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

/** Only USD is accepted until the ledger can keep currencies apart in its sums. */
export const LEDGER_CURRENCY = 'usd';

/** The largest single entry accepted: $100,000,000.00. A typo guard, not policy. */
export const MAX_AMOUNT_CENTS = 10_000_000_000;

/** Rows accepted in one CSV import request. */
export const MAX_IMPORT_ROWS = 500;

const READY = new WeakMap<object, boolean>();

/**
 * D235 safety net for migration 311's declared objects. The migration is the
 * declaration; this only heals a cold isolate on a database the runner has not
 * reached. Cached per binding, never a module-level boolean.
 */
export async function ensureRevenueEntriesSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS revenue_entries (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      uid               TEXT NOT NULL UNIQUE,
      project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      customer          TEXT NOT NULL,
      amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
      currency          TEXT NOT NULL DEFAULT 'usd',
      revenue_type      TEXT NOT NULL CHECK (revenue_type IN ('recurring', 'pilot', 'one_time', 'deposit')),
      received_on       TEXT NOT NULL,
      source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'stripe')),
      source_ref        TEXT,
      verification      TEXT NOT NULL DEFAULT 'manual' CHECK (verification IN ('verified', 'supported', 'manual')),
      proof_document_id INTEGER REFERENCES documents(id),
      notes             TEXT,
      import_batch      TEXT,
      created_by        INTEGER REFERENCES users(id),
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_revenue_entries_project
      ON revenue_entries(project_id, received_on DESC)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch (e) {
      const msg = (e as Error).message || '';
      if (!/already exists/i.test(msg)) throw e;
    }
  }
  READY.set(bindingKey(env), true);
}

/**
 * A decimal money string → integer cents, or null.
 *
 * Parsed as TEXT, never through a float: "1,200.50" → 120050, "$490" → 49000,
 * "0.1" → 10. A third decimal place, a negative, a zero, anything past
 * MAX_AMOUNT_CENTS or anything that is not a number is null — a CSV cell the
 * ledger cannot read exactly is refused, not rounded into a figure.
 */
export function parseAmountToCents(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    raw = String(raw);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/**
 * A type as a person or a CSV writes it → the stored value, or null.
 * Accepts the canvas's labels ("Recurring", "Pilot", "One-time", "Deposit").
 */
export function normalizeRevenueType(raw: unknown): RevenueType | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'onetime') return 'one_time';
  if (s === 'paid_pilot') return 'pilot';
  return (REVENUE_TYPES as readonly string[]).includes(s) ? (s as RevenueType) : null;
}

/** The verification the Worker assigns. A request cannot choose it. */
export function verificationFor(row: { source: string; proof_document_id: number | null | undefined }): Verification {
  if (row.source === 'stripe') return 'verified';
  return row.proof_document_id != null ? 'supported' : 'manual';
}

export interface EntryInput {
  customer?: unknown;
  amount_cents?: unknown;
  amount?: unknown;
  revenue_type?: unknown;
  received_on?: unknown;
  proof_document_id?: unknown;
  notes?: unknown;
  currency?: unknown;
}

export interface CleanEntry {
  customer: string;
  amount_cents: number;
  revenue_type: RevenueType;
  received_on: string;
  proof_document_id: number | null;
  notes: string | null;
}

export type EntryCheck = { ok: true; entry: CleanEntry } | { ok: false; code: string; message: string };

/**
 * Validate one entry, from the manual form or one CSV row. `amount_cents` must
 * already be an integer; `amount` (a CSV cell) is parsed as text. The date must
 * be a real calendar date no later than `todayIso` plus one day (a founder east
 * of UTC is already on tomorrow). Messages are our own sentences.
 */
export function validateEntry(input: EntryInput, todayIso: string): EntryCheck {
  const customer = String(input.customer ?? '').trim();
  if (!customer || customer.length > 200) {
    return { ok: false, code: 'invalid_customer', message: 'Enter the customer or company, up to 200 characters.' };
  }
  if (input.currency != null && String(input.currency).toLowerCase() !== LEDGER_CURRENCY) {
    return { ok: false, code: 'currency_unsupported', message: 'Only US dollar amounts can be recorded for now.' };
  }
  let cents: number | null = null;
  if (input.amount_cents !== undefined && input.amount_cents !== null) {
    const n = input.amount_cents;
    cents = typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT_CENTS ? n : null;
  } else {
    cents = parseAmountToCents(input.amount);
  }
  if (cents === null) {
    return { ok: false, code: 'invalid_amount', message: 'Enter a positive amount with at most two decimal places.' };
  }
  const type = normalizeRevenueType(input.revenue_type);
  if (!type) {
    return { ok: false, code: 'invalid_revenue_type', message: 'Choose recurring, pilot, one-time or deposit.' };
  }
  const date = String(input.received_on ?? '').trim();
  if (!isCalendarDate(date)) {
    return { ok: false, code: 'invalid_received_on', message: 'Enter the date received as YYYY-MM-DD.' };
  }
  if (date > addDaysISO(todayIso, 1)) {
    return { ok: false, code: 'received_on_in_future', message: 'The date received cannot be in the future.' };
  }
  let proof: number | null = null;
  if (input.proof_document_id !== undefined && input.proof_document_id !== null && input.proof_document_id !== '') {
    const p = Number(input.proof_document_id);
    if (!Number.isSafeInteger(p) || p <= 0) {
      return { ok: false, code: 'invalid_proof_document', message: 'That proof document is not one of this startup\'s documents.' };
    }
    proof = p;
  }
  const notes = input.notes == null ? null : String(input.notes).trim().slice(0, 1000) || null;
  return { ok: true, entry: { customer, amount_cents: cents, revenue_type: type, received_on: date, proof_document_id: proof, notes } };
}

export interface LedgerRow {
  id: number;
  uid: string;
  project_id: number;
  customer: string;
  amount_cents: number;
  currency: string;
  revenue_type: string;
  received_on: string;
  source: string;
  source_ref: string | null;
  verification: string;
  proof_document_id: number | null;
  notes: string | null;
  import_batch: string | null;
  created_at: string;
  updated_at: string;
}

/** The DTO the page reads. Amounts stay integer cents. */
export function entryDto(r: LedgerRow) {
  return {
    uid: r.uid,
    customer: r.customer,
    amount_cents: Number(r.amount_cents),
    currency: r.currency,
    revenue_type: r.revenue_type,
    received_on: String(r.received_on).slice(0, 10),
    source: r.source,
    source_ref: r.source_ref ?? null,
    verification: r.verification,
    proof_document_id: r.proof_document_id ?? null,
    notes: r.notes ?? null,
    import_batch: r.import_batch ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
