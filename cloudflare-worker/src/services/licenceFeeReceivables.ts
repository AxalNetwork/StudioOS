/**
 * D5036 (#5036) — licence-fee revenue as the invoice ledger records it: invoiced, collected, outstanding, overdue and
 * void, per native currency, beside the contracted run-rate the Revenue page used to call "this quarter".
 *
 * FOUR CONCEPTS, NEVER ONE. The Revenue summary kept one figure for licence fees: a quarter of every active annual
 * fee. That is what the licences are CONTRACTED to bring in at their current terms (a run-rate), not what HQ invoiced,
 * and not what it was paid. This service reads `licence_fee_invoices` (migration 513, D802) and reports, apart:
 *
 *   invoiced      the amount of every non-void invoice ISSUED in the period;
 *   collected     what HQ recorded receiving against those invoices, to date (`paid_cents` is HQ-entered, D.8, and a
 *                 running total with no payment dates of its own, so cash is attributed to the invoice's issue period,
 *                 never to a payment date the ledger does not hold);
 *   outstanding   invoiced less collected, for the period's invoices; and, apart, every open invoice of ANY period as
 *                 at today (the receivable), with the overdue part (due date passed, balance left) listed one by one;
 *   void          counted and totalled apart, and in none of the figures above: a void invoice is neither revenue nor
 *                 a receivable.
 *
 * THE GAP IS SHOWN. A billable licence (active or suspended, D802's `BILLABLE_STATUSES`) whose current licence year
 * has started and holds no invoice is listed as "expected, not invoiced", with the fee it would carry. A year whose
 * only invoice is void is listed too, because D802 refuses a second invoice for it. A billable licence that cannot be
 * invoiced at all (no fee, no start date) is listed with why, never folded into a zero.
 *
 * D5954 (#5954) — THE INITIAL INVOICE COUNTS. A licence's one-off initial invoice (`kind = 'initial'`, migration
 * 202611141106) is an invoice like any other in invoiced, collected, outstanding, overdue and void. It holds no licence
 * year, so it never fills the "expected, not invoiced" gap of the first year it shares a start day with.
 *
 * NO CROSS-CURRENCY TOTAL. Every figure is integer minor units in the invoice's own currency, in one bucket per
 * currency. There is no FX policy, so nothing is added across buckets.
 */
import type { Env } from '../types';
import { BILLABLE_STATUSES, licenceYear } from './licenceFeeInvoices';

export type Period = { start: string; end: string; label: string };

/** One currency's figures for the invoices issued in the period. */
export type PeriodBucket = {
  currency: string;
  invoices: number;
  invoiced_cents: number;
  collected_cents: number;
  outstanding_cents: number;
  overdue_invoices: number;
  overdue_cents: number;
  void_invoices: number;
  void_cents: number;
};

/** One currency's open receivable as at today, whatever period issued it. */
export type ReceivableBucket = {
  currency: string;
  open_invoices: number;
  outstanding_cents: number;
  overdue_invoices: number;
  overdue_cents: number;
};

type InvoiceRow = {
  uid: string; licence_uid: string; reference: string; period_label: string; issued_at: string; due_at: string;
  status: string; amount_cents: number; paid_cents: number; currency: string;
};
type LicenceRow = {
  uid: string; licence_ref: string; brand_name: string; status: string;
  annual_fee_cents: number | null; currency: string | null; starts_on: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The day an ISO timestamp or date falls on; '' when it is not one. */
const dayOf = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

/** What is still owed on one invoice: zero for a void one, never negative. */
export function outstandingOf(r: { status: string; amount_cents: number; paid_cents: number }): number {
  if (r.status === 'void') return 0;
  return Math.max(0, Number(r.amount_cents) - Number(r.paid_cents));
}

/** Overdue: not void, a balance left, and the due date before `today`. */
export function isOverdue(r: { status: string; amount_cents: number; paid_cents: number; due_at: string }, today: string): boolean {
  return outstandingOf(r) > 0 && dayOf(r.due_at) !== '' && dayOf(r.due_at) < today;
}

/** The period figures, one bucket per currency, from the invoices ISSUED in it. Pure, so a test can feed it rows. */
export function periodBuckets(rows: InvoiceRow[], today: string): PeriodBucket[] {
  const by = new Map<string, PeriodBucket>();
  for (const r of rows) {
    const currency = String(r.currency || '').toUpperCase();
    let b = by.get(currency);
    if (!b) {
      b = { currency, invoices: 0, invoiced_cents: 0, collected_cents: 0, outstanding_cents: 0, overdue_invoices: 0, overdue_cents: 0, void_invoices: 0, void_cents: 0 };
      by.set(currency, b);
    }
    const amount = Number(r.amount_cents);
    if (r.status === 'void') {
      b.void_invoices += 1;
      b.void_cents += amount;
      continue;
    }
    b.invoices += 1;
    b.invoiced_cents += amount;
    b.collected_cents += Number(r.paid_cents);
    const owed = outstandingOf(r);
    b.outstanding_cents += owed;
    if (isOverdue(r, today)) { b.overdue_invoices += 1; b.overdue_cents += owed; }
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The open receivable as at `today`, one bucket per currency. Pure. */
export function receivableBuckets(rows: InvoiceRow[], today: string): ReceivableBucket[] {
  const by = new Map<string, ReceivableBucket>();
  for (const r of rows) {
    const owed = outstandingOf(r);
    if (owed <= 0) continue;
    const currency = String(r.currency || '').toUpperCase();
    let b = by.get(currency);
    if (!b) { b = { currency, open_invoices: 0, outstanding_cents: 0, overdue_invoices: 0, overdue_cents: 0 }; by.set(currency, b); }
    b.open_invoices += 1;
    b.outstanding_cents += owed;
    if (isOverdue(r, today)) { b.overdue_invoices += 1; b.overdue_cents += owed; }
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export type ExpectedGap = {
  licence_uid: string; licence_ref: string; brand_name: string; status: string;
  period_label: string; period_start: string; amount_cents: number; currency: string;
  /** `not_invoiced`: no invoice for the current year. `void_not_reissued`: its only invoice is void, and D802 refuses another. */
  gap: 'not_invoiced' | 'void_not_reissued';
};
export type CannotInvoice = { licence_uid: string; licence_ref: string; brand_name: string; status: string; reason: 'no_annual_fee' | 'no_start_date' };

/**
 * The billable licences whose current licence year has started and is not invoiced, and those that cannot be invoiced
 * at all. Pure over the licence rows and each licence's invoiced periods (`period_start` → status).
 */
export function expectedGaps(licences: LicenceRow[], invoiced: Map<string, Map<string, string>>, today: string):
  { gaps: ExpectedGap[]; cannot_invoice: CannotInvoice[]; not_started: number } {
  const gaps: ExpectedGap[] = [];
  const cannot: CannotInvoice[] = [];
  let notStarted = 0;
  for (const l of licences) {
    if (!(BILLABLE_STATUSES as readonly string[]).includes(l.status)) continue;
    const who = { licence_uid: l.uid, licence_ref: l.licence_ref, brand_name: l.brand_name, status: l.status };
    const fee = l.annual_fee_cents;
    if (!Number.isSafeInteger(fee) || (fee as number) <= 0) { cannot.push({ ...who, reason: 'no_annual_fee' }); continue; }
    if (!l.starts_on || !DAY.test(l.starts_on)) { cannot.push({ ...who, reason: 'no_start_date' }); continue; }
    if (l.starts_on > today) { notStarted += 1; continue; }
    const year = licenceYear(l.starts_on, today);
    const status = invoiced.get(l.uid)?.get(year.start);
    if (status && status !== 'void') continue;
    gaps.push({
      ...who, period_label: year.label, period_start: year.start, amount_cents: fee as number,
      currency: String(l.currency || '').toUpperCase(), gap: status === 'void' ? 'void_not_reissued' : 'not_invoiced',
    });
  }
  return { gaps, cannot_invoice: cannot, not_started: notStarted };
}

/** The most overdue invoices listed one by one; the buckets carry the full count. */
export const OVERDUE_LIST_LIMIT = 50;

/**
 * The invoice-backed licence revenue for `period`, as at `today` (YYYY-MM-DD). Never throws: an unreadable ledger is
 * `{ available: false, reason }`, which the page draws as Unreadable, never as zero.
 */
export async function licenceFeeReceivables(env: Env, period: Period, today: string) {
  try {
    const issued = await env.DB.prepare(
      `SELECT uid, licence_uid, reference, period_label, issued_at, due_at, status, amount_cents, paid_cents, currency
         FROM licence_fee_invoices
        WHERE issued_at >= ? AND issued_at < ?`,
    ).bind(period.start, period.end).all<InvoiceRow>();
    const open = await env.DB.prepare(
      `SELECT i.uid, i.licence_uid, i.reference, i.period_label, i.issued_at, i.due_at, i.status, i.amount_cents,
              i.paid_cents, i.currency, i.kind, l.licence_ref, l.brand_name
         FROM licence_fee_invoices i
         LEFT JOIN territory_licences l ON l.uid = i.licence_uid
        WHERE i.status != 'void' AND i.paid_cents < i.amount_cents
        ORDER BY i.due_at ASC, i.id ASC`,
    ).all<InvoiceRow & { kind: string | null; licence_ref: string | null; brand_name: string | null }>();
    // Licence years only: an initial invoice (D5954) shares the first year's start day but is not that year's invoice.
    const periods = await env.DB.prepare("SELECT licence_uid, period_start, status FROM licence_fee_invoices WHERE kind = 'annual'")
      .all<{ licence_uid: string; period_start: string; status: string }>();
    const licences = await env.DB.prepare(
      `SELECT uid, licence_ref, brand_name, status, annual_fee_cents, currency, starts_on
         FROM territory_licences WHERE status IN ('active', 'suspended') ORDER BY licence_ref`,
    ).all<LicenceRow>();

    const invoiced = new Map<string, Map<string, string>>();
    for (const p of periods.results || []) {
      if (!invoiced.has(p.licence_uid)) invoiced.set(p.licence_uid, new Map());
      invoiced.get(p.licence_uid)!.set(p.period_start, p.status);
    }
    const openRows = open.results || [];
    const overdue = openRows.filter((r) => isOverdue(r, today));
    const expected = expectedGaps(licences.results || [], invoiced, today);

    return {
      available: true as const,
      source: 'licence_fee_invoices',
      period,
      as_of: today,
      basis: {
        invoiced: 'The amount of every invoice issued in the period, void invoices excluded.',
        collected: 'What HQ recorded receiving against those invoices, to date. Payments are entered by HQ and are not reconciled against a bank; they are counted in the period the invoice was issued.',
        outstanding: 'Invoiced less collected, for the invoices issued in the period.',
        receivable: 'Every open invoice as at today, whatever period issued it. Overdue means the due date has passed and a balance is left.',
        void: 'Void invoices are counted apart and are in no other figure.',
      },
      by_currency: periodBuckets(issued.results || [], today),
      receivable_by_currency: receivableBuckets(openRows, today),
      overdue: overdue.slice(0, OVERDUE_LIST_LIMIT).map((r) => ({
        uid: r.uid, licence_uid: r.licence_uid, licence_ref: r.licence_ref ?? null, brand_name: r.brand_name ?? null,
        kind: r.kind === 'initial' ? 'initial' : 'annual', reference: r.reference, period_label: r.period_label, issued_at: dayOf(r.issued_at), due_at: dayOf(r.due_at),
        days_overdue: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dayOf(r.due_at)}T00:00:00Z`)) / 86_400_000),
        outstanding_cents: outstandingOf(r), currency: String(r.currency || '').toUpperCase(),
      })),
      overdue_total: overdue.length,
      expected_not_invoiced: expected.gaps,
      cannot_invoice: expected.cannot_invoice,
      not_started: expected.not_started,
    };
  } catch {
    return { available: false as const, reason: 'The licence-fee invoice ledger could not be read.' };
  }
}
