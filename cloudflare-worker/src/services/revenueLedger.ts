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
 * `supported`; without one it is `manual`. `verified` is written only by the
 * Stripe charge sync (D587, `POST …/entries/import-stripe`): one entry per
 * succeeded charge on the founder's own connected account, `source = 'stripe'`,
 * `source_ref` the charge id. A synced entry's amount, date and customer cannot
 * be edited afterwards, so `verified` always means what Stripe reported.
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
      source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'stripe', 'mercury')),
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
    // Migration 400 (D587): a Stripe charge is on a project's ledger once.
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_entries_stripe_charge
      ON revenue_entries(project_id, source_ref) WHERE source = 'stripe'`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_entries_mercury_txn
      ON revenue_entries(source_ref) WHERE source = 'mercury'`,
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
  if (row.source === 'mercury') return 'supported';
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

/** The customer a synced entry records when the charge names no Stripe customer. */
export const STRIPE_NO_CUSTOMER = 'Stripe charge';

/** The fields of a synced entry its PATCH may not change (D587). */
export const MERCURY_LOCKED_FIELDS = ['amount_cents', 'amount', 'received_on'] as const;

export const STRIPE_LOCKED_FIELDS = ['customer', 'amount_cents', 'amount', 'received_on'] as const;

export interface ChargeIn {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  customer: string | null;
  invoice: boolean;
}

export type ChargeEntry =
  | { kind: 'entry'; entry: { source_ref: string; customer: string; amount_cents: number; revenue_type: RevenueType; received_on: string } }
  | { kind: 'skip'; reason: 'fully_refunded' }
  | { kind: 'refuse'; code: string; message: string };

/**
 * D587 — one Stripe charge → one ledger entry, or why not. Pure.
 *
 * - The amount is net of refunds; a fully refunded charge writes nothing.
 * - The date is the charge's own, as a UTC calendar date.
 * - The customer is the Stripe customer id, or "Stripe charge" when there is
 *   none: no name, email, address or card is ever stored (the owner's call).
 * - The type is `recurring` when the charge paid an invoice, else `one_time`.
 *   That is a reading of Stripe's record, not something Stripe states, so the
 *   founder may still change the type.
 * - A non-USD charge is refused with a code and our sentence, as the CSV
 *   import refuses one.
 */
export function chargeToEntry(ch: ChargeIn): ChargeEntry {
  if (String(ch.currency || '').toLowerCase() !== LEDGER_CURRENCY) {
    return { kind: 'refuse', code: 'currency_unsupported', message: 'Only US dollar charges can be recorded for now.' };
  }
  const net = Number(ch.amount) - Number(ch.amount_refunded || 0);
  if (!Number.isSafeInteger(net) || !Number.isSafeInteger(Number(ch.amount))) {
    return { kind: 'refuse', code: 'invalid_amount', message: 'Stripe reported an amount the ledger cannot read exactly.' };
  }
  if (net <= 0) return { kind: 'skip', reason: 'fully_refunded' };
  if (net > MAX_AMOUNT_CENTS) {
    return { kind: 'refuse', code: 'invalid_amount', message: 'The charge is larger than one ledger entry can hold.' };
  }
  const created = Number(ch.created);
  if (!Number.isFinite(created) || created <= 0) {
    return { kind: 'refuse', code: 'invalid_received_on', message: 'Stripe reported no date for the charge.' };
  }
  const customer = typeof ch.customer === 'string' && /^cus_[A-Za-z0-9]+$/.test(ch.customer) ? ch.customer : STRIPE_NO_CUSTOMER;
  return {
    kind: 'entry',
    entry: {
      source_ref: String(ch.id),
      customer,
      amount_cents: net,
      revenue_type: ch.invoice ? 'recurring' : 'one_time',
      received_on: new Date(created * 1000).toISOString().slice(0, 10),
    },
  };
}

/** What the route knows of one Mercury bank line (D713). Booleans only: no name reaches this function. */
export interface MercuryCreditFacts {
  transaction_id: string;
  amount_cents: number;
  posted_on: string | null;
  posted: boolean;
  internal: boolean;
  voided: boolean;
  /** The counterparty names an Axal entity (`providers/mercury.ts` `namesAxalEntity`). */
  axal_counterparty: boolean;
  /** The counterparty names Stripe (`namesStripe`). */
  stripe_counterparty: boolean;
}

export interface MercuryCreditContext {
  /** The project holds a `stripe` row, or the founder has an active Stripe connection. */
  stripeActive: boolean;
  /** The line is already a row on this project's ledger. */
  importedHere: boolean;
  /** The line is already a row on another project's ledger: one bank line is one row on the platform. */
  importedElsewhere: boolean;
}

export const MERCURY_CREDIT_REASONS = ['pending', 'internal_transfer', 'axal_entity', 'stripe_payout', 'already_imported', 'imported_elsewhere', 'invalid_amount'] as const;
export type MercuryCreditReason = (typeof MERCURY_CREDIT_REASONS)[number];

export type MercuryCreditEntry =
  | { kind: 'entry'; entry: { source_ref: string; amount_cents: number; received_on: string } }
  | { kind: 'skip' }
  | { kind: 'refuse'; reason: MercuryCreditReason };

/** A counterparty that names Stripe, as a word. */
export function namesStripe(counterparty: string | null | undefined): boolean {
  return /(^|[^a-z0-9])stripe([^a-z0-9]|$)/i.test(String(counterparty ?? ''));
}

/**
 * D713 decision 6 — one Mercury bank line → one ledger entry, or why not. Pure.
 *
 * - A debit, or a cancelled or failed line, is not a candidate at all (`skip`).
 * - Each other refusal is listed with its reason and cannot be imported:
 *   `pending`, `internal_transfer`, `axal_entity` (capital or a partner deal,
 *   not customer revenue), `stripe_payout` (each Stripe sale would count twice),
 *   `already_imported` (on this project) and `imported_elsewhere` (on another).
 * - Amount and date are Mercury's: integer cents from `parse.ts`, and the
 *   posted date. The customer and the type are the founder's, set by the route.
 */
export function mercuryCreditToEntry(f: MercuryCreditFacts, ctx: MercuryCreditContext): MercuryCreditEntry {
  if (f.voided || !(Number(f.amount_cents) > 0)) return { kind: 'skip' };
  if (!f.posted || !f.posted_on) return { kind: 'refuse', reason: 'pending' };
  if (f.internal) return { kind: 'refuse', reason: 'internal_transfer' };
  if (f.axal_counterparty) return { kind: 'refuse', reason: 'axal_entity' };
  if (f.stripe_counterparty && ctx.stripeActive) return { kind: 'refuse', reason: 'stripe_payout' };
  if (ctx.importedHere) return { kind: 'refuse', reason: 'already_imported' };
  if (ctx.importedElsewhere) return { kind: 'refuse', reason: 'imported_elsewhere' };
  if (!Number.isSafeInteger(f.amount_cents) || f.amount_cents > MAX_AMOUNT_CENTS) return { kind: 'refuse', reason: 'invalid_amount' };
  return { kind: 'entry', entry: { source_ref: f.transaction_id, amount_cents: f.amount_cents, received_on: f.posted_on } };
}
