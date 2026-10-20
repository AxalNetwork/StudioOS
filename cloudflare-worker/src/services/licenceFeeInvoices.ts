/**
 * D802 (#2238) — the annual licence-fee invoices HQ issues a territory licensee
 * (migration 513).
 *
 * ONE INVOICE PER LICENCE YEAR. The year runs from the licence's anniversary,
 * `territory_licences.starts_on`: the year an invoice covers is the one that
 * holds the day it is issued, or the first year when the licence has not
 * started yet. A second invoice for a year is refused, a voided one included.
 *
 * THE AMOUNT IS THE LEDGER'S, FROZEN. `annual_fee_cents` and `currency` are
 * read at issue and stored, with the printed figures and their digest, so the
 * PDF is the same tomorrow after the fee is re-termed.
 *
 * THE PDF is D716's invoice paper (`noticePaperInput`, `paperModel`,
 * `renderLegalPdf`) for the generated-document type
 * `territory_licence_fee_invoice` (`fundNotices.territoryLicenceInvoice`). The
 * sender is Holdings, the platform IP's licensor until D797 (#2230) records
 * another; its payment block is D798's `territory_licence_fee` purpose, masked.
 * An invoice is never issued without payment instructions: a missing account
 * refuses the issue.
 *
 * PAID IS HQ-ENTERED (D.8), as on a statement: a running total, never above
 * the amount, with a note. Nothing reconciles it against a bank.
 */
import type { Env } from '../types';
import type { LicenceRow } from '../routes/admin_licences';
import { figuresDigest, noticePaperInput, territoryLicenceInvoice, type NoticeFigures } from './fundNotices';
import { licenceFeeReference, licensorRefusal } from './licenceAccount';
import { paperModel } from './legalPaper';
import { renderLegalPdf } from './legalPaperRender';

/** Days from issue to due when D797's `payment_terms_days` is not recorded. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;
/** The statuses a licence can be invoiced in. A draft has not started; a terminated licence owes no new year. */
export const BILLABLE_STATUSES = ['active', 'suspended'] as const;

export class FeeInvoiceRefusal extends Error {
  status: 400 | 404 | 409;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: 400 | 404 | 409, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The anniversary of `start` in `year`; 29 February falls on the 28th in a common year. */
function anniversary(start: string, year: number): Date {
  const [, , m, d] = DAY.exec(start)!.map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return new Date(Date.UTC(year, m - 1, Math.min(d, last)));
}

/**
 * The licence year that holds `today`, or the first year when `today` is
 * before the start: `{ label: "2026–27", start, end, key: "2026-27" }`. `end`
 * is the day before the next anniversary.
 */
export function licenceYear(startsOn: string, today: string): { label: string; key: string; start: string; end: string } {
  if (!DAY.test(startsOn) || !DAY.test(today)) throw new TypeError('A licence year needs the start date and today as YYYY-MM-DD.');
  const first = Number(startsOn.slice(0, 4));
  let year = Math.max(first, Number(today.slice(0, 4)));
  while (year > first && iso(anniversary(startsOn, year)) > today) year -= 1;
  const start = iso(anniversary(startsOn, year));
  const next = anniversary(startsOn, year + 1);
  const end = iso(new Date(next.getTime() - 86_400_000));
  const yy = String((year + 1) % 100).padStart(2, '0');
  return { label: `${year}–${yy}`, key: `${year}-${yy}`, start, end };
}

/** `today` plus `days`, as YYYY-MM-DD. */
export function addDays(today: string, days: number): string {
  return iso(new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000));
}

/** D797's payment terms when recorded, else 30 days. */
export function paymentTermsDays(terms: { paymentTermsDays?: number | null } = {}): number {
  const d = terms.paymentTermsDays;
  return Number.isSafeInteger(d) && (d as number) >= 0 ? (d as number) : DEFAULT_PAYMENT_TERMS_DAYS;
}

export type FeeInvoiceRow = {
  id: number; uid: string; licence_uid: string; period_label: string; period_start: string; period_end: string;
  amount_cents: number; currency: string; reference: string; issued_at: string; due_at: string;
  status: 'issued' | 'paid' | 'void'; paid_cents: number; paid_at: string | null; paid_note: string | null;
  void_note: string | null; figures_json: string; figures_sha256: string;
  issued_by_user_id: number | null; recorded_by_user_id: number | null; created_at: string; updated_at: string;
};

const money = (r: FeeInvoiceRow) => ({
  amount_cents: Number(r.amount_cents), currency: r.currency, paid_cents: Number(r.paid_cents),
  outstanding_cents: r.status === 'void' ? 0 : Math.max(0, Number(r.amount_cents) - Number(r.paid_cents)),
});

/** HQ's view of an invoice: everything but the frozen figures. */
export function hqInvoiceView(r: FeeInvoiceRow, licenceUid: string) {
  return {
    uid: r.uid, licence_uid: r.licence_uid, period_label: r.period_label, period_start: r.period_start, period_end: r.period_end,
    ...money(r), reference: r.reference, issued_at: r.issued_at, due_at: r.due_at, status: r.status,
    paid_at: r.paid_at, paid_note: r.paid_note, void_note: r.void_note,
    pdf_url: r.status === 'void' ? null : `/api/admin/licences/${encodeURIComponent(licenceUid)}/fee-invoices/${encodeURIComponent(r.uid)}/pdf`,
  };
}

/** The Administrator's view: no HQ notes, and a PDF link on their own route. */
export function licenseeInvoiceView(r: FeeInvoiceRow) {
  return {
    uid: r.uid, period_label: r.period_label, period_start: r.period_start, period_end: r.period_end,
    ...money(r), reference: r.reference, issued_at: r.issued_at, due_at: r.due_at, status: r.status, paid_at: r.paid_at,
    pdf_url: r.status === 'void' ? null : `/api/licence/mine/fee-invoices/${encodeURIComponent(r.uid)}/pdf`,
  };
}

/** A licence's invoices, newest year first. */
export async function listFeeInvoices(env: Env, licenceUid: string): Promise<FeeInvoiceRow[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM licence_fee_invoices WHERE licence_uid = ? ORDER BY period_start DESC, id DESC',
  ).bind(licenceUid).all<FeeInvoiceRow>();
  return rows.results || [];
}

/** One invoice WITHIN its licence; another licence's uid is not found. */
export async function feeInvoiceOf(env: Env, licenceUid: string, invoiceUid: string): Promise<FeeInvoiceRow | null> {
  return await env.DB.prepare('SELECT * FROM licence_fee_invoices WHERE uid = ? AND licence_uid = ?')
    .bind(invoiceUid, licenceUid).first<FeeInvoiceRow>();
}

const isUniqueConflict = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));

/**
 * Issue the invoice for the licence year that holds `today`. `terms` is what
 * D797's schedule records, when known (the licensor and the payment terms).
 */
export async function issueFeeInvoice(
  env: Env, licence: LicenceRow, actorId: number, today: string,
  terms: { licensorIpEntity?: string | null; paymentTermsDays?: number | null } = {},
): Promise<FeeInvoiceRow> {
  if (!(BILLABLE_STATUSES as readonly string[]).includes(licence.status)) {
    throw new FeeInvoiceRefusal(409, 'licence_not_billable', `A ${licence.status.replace('_', ' ')} licence is not invoiced. Only an active or suspended licence is.`);
  }
  const amount = licence.annual_fee_cents;
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) {
    throw new FeeInvoiceRefusal(409, 'no_annual_fee', 'This licence records no annual fee, so there is nothing to invoice. Set the fee on its terms first.');
  }
  if (!licence.starts_on || !DAY.test(licence.starts_on)) {
    throw new FeeInvoiceRefusal(409, 'no_start_date', 'This licence records no start date, so its licence year cannot be told. Set the start date first.');
  }
  const licensor = licensorRefusal(terms.licensorIpEntity);
  if (licensor) throw new FeeInvoiceRefusal(409, licensor.refusal_code, licensor.refusal);

  const year = licenceYear(licence.starts_on, today);
  const existing = await env.DB.prepare('SELECT uid, status FROM licence_fee_invoices WHERE licence_uid = ? AND period_start = ?')
    .bind(licence.uid, year.start).first<{ uid: string; status: string }>();
  if (existing) {
    throw new FeeInvoiceRefusal(409, 'invoice_exists', `The ${year.label} licence year is already invoiced.`, { invoice_uid: existing.uid, status: existing.status });
  }
  const reference = licenceFeeReference(licence.licence_ref, year.key);
  const due = addDays(today, paymentTermsDays(terms));
  const built = await territoryLicenceInvoice(env, {
    licence_uid: licence.uid, licence_ref: licence.licence_ref,
    licensee_name: (licence.legal_entity_name || licence.brand_name || '').trim(),
    period_label: year.label, period_start: year.start, period_end: year.end,
    amount_cents: amount as number, currency: licence.currency, due_date: due, reference,
  }, today);
  if (built.refusal) throw new FeeInvoiceRefusal(409, built.refusal.code, built.refusal.message);
  const figuresJson = JSON.stringify(built.figures);
  const digest = await figuresDigest(built.figures);
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO licence_fee_invoices
         (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency, reference,
          issued_at, due_at, status, figures_json, figures_sha256, issued_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
    ).bind(uid, licence.uid, year.label, year.start, year.end, amount, licence.currency, reference,
      today, due, figuresJson, digest, actorId).run();
  } catch (e) {
    if (!isUniqueConflict(e)) throw e;
    throw new FeeInvoiceRefusal(409, 'invoice_exists', `The ${year.label} licence year is already invoiced.`);
  }
  return (await feeInvoiceOf(env, licence.uid, uid))!;
}

/** What a PATCH records: a running paid total with its note, or a void with its reason. */
export function parseFeeInvoiceUpdate(body: unknown, inv: FeeInvoiceRow):
  { ok: true; kind: 'payment'; paid_cents: number; paid_note: string | null } | { ok: true; kind: 'void'; void_note: string }
  | { ok: false; status: 400 | 409; code: string; field: string; message: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (inv.status === 'void') return { ok: false, status: 409, code: 'invoice_void', field: 'status', message: 'This invoice is void; nothing more is recorded on it.' };
  if (b.status === 'void') {
    if ('paid_cents' in b) return { ok: false, status: 400, code: 'bad_request', field: 'paid_cents', message: 'Void an invoice, or record a payment on it, not both at once.' };
    if (Number(inv.paid_cents) > 0) return { ok: false, status: 409, code: 'paid_not_void', field: 'status', message: 'A payment is recorded on this invoice. Set the paid total to zero before voiding it.' };
    const note = typeof b.void_note === 'string' ? b.void_note.trim() : '';
    if (note.length < 10) return { ok: false, status: 400, code: 'void_note_required', field: 'void_note', message: 'Say why it is void, in at least 10 characters.' };
    return { ok: true, kind: 'void', void_note: note.slice(0, 500) };
  }
  const paid = b.paid_cents;
  if (typeof paid !== 'number' || !Number.isSafeInteger(paid) || paid < 0) {
    return { ok: false, status: 400, code: 'bad_amount', field: 'paid_cents', message: 'Give the total received so far as a whole number of cents, zero or more.' };
  }
  if (paid > Number(inv.amount_cents)) {
    return { ok: false, status: 409, code: 'over_amount', field: 'paid_cents', message: 'The total received cannot be more than the invoice amount.' };
  }
  const note = typeof b.paid_note === 'string' ? b.paid_note.trim().slice(0, 300) : '';
  return { ok: true, kind: 'payment', paid_cents: paid, paid_note: note || null };
}

/** Record what `parseFeeInvoiceUpdate` accepted. The status follows the paid total. */
export async function recordFeeInvoiceUpdate(
  env: Env, inv: FeeInvoiceRow, update: { kind: 'payment'; paid_cents: number; paid_note: string | null } | { kind: 'void'; void_note: string },
  actorId: number, now: string,
): Promise<FeeInvoiceRow> {
  if (update.kind === 'void') {
    await env.DB.prepare(
      `UPDATE licence_fee_invoices SET status = 'void', void_note = ?, recorded_by_user_id = ?, updated_at = ?
        WHERE uid = ? AND status != 'void' AND paid_cents = 0`,
    ).bind(update.void_note, actorId, now, inv.uid).run();
  } else {
    const status = update.paid_cents === Number(inv.amount_cents) ? 'paid' : 'issued';
    await env.DB.prepare(
      `UPDATE licence_fee_invoices SET paid_cents = ?, paid_note = ?, paid_at = ?, status = ?, recorded_by_user_id = ?, updated_at = ?
        WHERE uid = ? AND status != 'void'`,
    ).bind(update.paid_cents, update.paid_note, update.paid_cents > 0 ? now : null, status, actorId, now, inv.uid).run();
  }
  return (await feeInvoiceOf(env, inv.licence_uid, inv.uid))!;
}

/** The invoice's PDF, drawn from its frozen figures. A void invoice prints nothing. */
export async function feeInvoicePdf(env: Env, inv: FeeInvoiceRow):
  Promise<{ ok: true; bytes: Uint8Array; filename: string } | { ok: false; status: 409 | 503; code: string; message: string }> {
  if (inv.status === 'void') return { ok: false, status: 409, code: 'invoice_void', message: 'This invoice is void and is not printed.' };
  const figures = JSON.parse(inv.figures_json) as NoticeFigures;
  const model = paperModel(noticePaperInput(figures, { issued: { uid: inv.uid, stamp: 'issued', figures_sha256: inv.figures_sha256 } }));
  const rendered = await renderLegalPdf(env, model, { pageSize: 'a4', cover: 'light', fallback: false });
  if (!rendered.ok) return { ok: false, status: 503, code: 'invoice_unrenderable', message: 'The invoice could not be printed right now. Try again in a moment.' };
  return { ok: true, bytes: rendered.bytes, filename: `${inv.reference}.pdf`.replace(/[^A-Za-z0-9_.-]/g, '-') };
}
