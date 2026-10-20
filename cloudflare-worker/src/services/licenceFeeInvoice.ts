// D802 (#2238) — HQ's annual licence-fee invoice to a territory licensee.
//
// THE PERIOD. A licence's fee year runs from an anniversary of its `starts_on`
// to the day before the next one, and is labelled by its two years ("2026–27").
// `feePeriod` is the one place that arithmetic lives; the route, the paper and
// the tests all read it.
//
// THE PAPER is D716's invoice layout (`noticePaperInput`'s shape: addressee,
// key figures, one table, the warning and the masked payment block), built
// here rather than as an eighth fund-notice type: a territory licensee is not
// a fund party, and the fund-notice store, its issue flow and its LP reads
// must not learn to hold one.
//
//   - The sender is the licensor for platform IP the terms name (D797's
//     `licensor_ip_entity`), Holdings when the terms record none.
//   - The payment block is D798's `territory_licence_fee` purpose, masked to
//     the account's last four digits (`paymentBlock`). A licensor that is not
//     that purpose's payee prints D798's refusal sentence instead of any
//     account (`licensorRefusal`), so an invoice never pairs one entity's name
//     with another's bank.
//   - The reference is `AXAL-LIC-<licence_ref>-<period>` (`licenceFeeReference`).
//
// NOTE: authored to load under `node --experimental-strip-types` (the worker
// test gate) — no `enum`s, no TS parameter properties.

import type { Env } from '../types';
import { AXAL_ENTITIES, buildAddresseeBlock, type AxalEntityKey } from './legalDocFormat';
import { paymentBlock } from './fundNotices';
import { licenceFeeReference, licensorRefusal } from './licenceAccount';
import { PAY_WARNING, PAYMENT_PURPOSES } from './payInstructions';
import { RECEIVING_BRACKET } from './fundStructure';
import { paperModel, type NoticePayment, type PaperInput } from './legalPaper';
import { renderLegalPdf } from './legalPaperRender';

export const TERRITORY_INVOICE_KEY = 'territory_licence_fee_invoice' as const;
export const TERRITORY_INVOICE_TITLE = 'Territory Licence Fee Invoice';
/** D797's `payment_terms_days`, when the terms record none. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `date` plus `days`, as YYYY-MM-DD, in UTC. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** The anniversary of `start` in `year`; a 29 February start falls on 28 February in a common year. */
function anniversary(start: string, year: number): string {
  const [, m, d] = start.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, m - 1, Math.min(d, last))));
}

export type FeePeriod = { period_start: string; period_end: string; period_label: string };

/**
 * The fee year that holds `on` (YYYY-MM-DD): from the latest anniversary of
 * `startsOn` on or before it to the day before the next one. A date before the
 * licence starts gives its first year. Null when `startsOn` is not a date.
 */
export function feePeriod(startsOn: string | null | undefined, on: string): FeePeriod | null {
  if (!isDate(startsOn) || !isDate(on)) return null;
  let year = Number(on.slice(0, 4));
  if (on < startsOn) year = Number(startsOn.slice(0, 4));
  else if (anniversary(startsOn, year) > on) year -= 1;
  const start = anniversary(startsOn, year);
  const end = addDays(anniversary(startsOn, year + 1), -1);
  return { period_start: start, period_end: end, period_label: `${year}–${String((year + 1) % 100).padStart(2, '0')}` };
}

/**
 * The reference a licensee quotes on the transfer: `AXAL-LIC-<licence_ref>-<period>`,
 * with the period's dash as an ASCII hyphen ("2026-27"), because a bank's
 * reference field is not where an en dash survives.
 */
export function feeInvoiceReference(licenceRef: string, periodLabel: string): string {
  return licenceFeeReference(licenceRef, String(periodLabel ?? '').replace(/\u2013/g, '-'));
}

/** Integer minor units as "EUR 12,345.00", never through a float. */
export function moneyText(cents: number, currency: string): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError('cents must be a whole number');
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}${String(currency || '').toUpperCase()} ${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** D797's `licensor_ip_entity` as an entity key, Holdings when not recorded or not one of the four. */
export function invoiceSender(licensor: unknown): AxalEntityKey {
  return typeof licensor === 'string' && licensor in AXAL_ENTITIES ? (licensor as AxalEntityKey) : 'holdings';
}

export type InvoiceLicence = { licence_ref: string; legal_entity_name: string; brand_name?: string | null };
export type InvoiceRow = {
  uid: string; period_label: string; period_start: string; period_end: string;
  amount_cents: number; currency: string; issued_at: string; due_at: string; status: string;
};

/**
 * The invoice's paper input, and the refusal that stands in for its payment
 * block (null when the block printed an account). `licensor` is D797's
 * `licensor_ip_entity` as recorded, or null.
 */
export async function territoryInvoicePaper(
  env: Env, licence: InvoiceLicence, invoice: InvoiceRow, licensor: string | null,
): Promise<{ input: PaperInput; reference: string; refusal: { code: string; message: string } | null }> {
  const sender = invoiceSender(licensor);
  const reference = feeInvoiceReference(licence.licence_ref, invoice.period_label);
  const amount = moneyText(Number(invoice.amount_cents), invoice.currency);
  const period = `${invoice.period_start} to ${invoice.period_end}`;

  let payment: NoticePayment;
  let refusal: { code: string; message: string } | null = null;
  const refused = licensorRefusal(licensor);
  if (refused) {
    payment = { refusal: refused.refusal };
    refusal = { code: refused.refusal_code, message: refused.refusal };
  } else {
    const block = await paymentBlock(env, PAYMENT_PURPOSES.territory_licence_fee.payee, 'territory_licence_fee', reference, false);
    payment = 'refusal' in block.payment && block.payment.refusal
      ? { refusal: block.payment.refusal }
      : { lines: (block.payment as any).lines, reference: (block.payment as any).reference };
    refusal = block.refusal;
  }

  return {
    reference,
    refusal,
    input: {
      title: TERRITORY_INVOICE_TITLE,
      body: '',
      slug: TERRITORY_INVOICE_KEY,
      bodySha256: 'f'.repeat(64),
      merge: 'filled',
      documentKind: 'notice',
      axalEntityKey: sender,
      state: { kind: 'issued' },
      stamp: 'issued',
      audit: `Invoice ${invoice.uid} · ${reference}`,
      addressee: buildAddresseeBlock({ to: licence.legal_entity_name, from: sender }),
      keyFigures: [
        { label: 'Invoice date', value: invoice.issued_at.slice(0, 10) },
        { label: 'Licence', value: licence.licence_ref, mono: true },
        { label: 'Period', value: invoice.period_label },
        { label: 'Amount due', value: amount, mono: true },
        { label: 'Due date', value: invoice.due_at.slice(0, 10) },
        { label: 'Reference', value: reference, mono: true },
      ],
      tables: [{
        columns: [{ label: 'Item' }, { label: 'Period' }, { label: 'Amount', align: 'right' }],
        rows: [[`Annual territory licence fee, ${licence.licence_ref}`, period, amount], ['Total', '', amount]],
        total: true,
      }],
      warning: PAY_WARNING,
      payment,
      suppressExecutionBlock: true,
      inlineExecution: true,
      preserveBody: true,
    },
  };
}

/** The invoice with bracket figures and no account read, for the Templates catalog's thumbnail (D758). */
export function territoryInvoiceSpecimen(): PaperInput {
  const br = (l: string) => `[${l}]`;
  return {
    title: TERRITORY_INVOICE_TITLE,
    body: '',
    slug: TERRITORY_INVOICE_KEY,
    bodySha256: 'f'.repeat(64),
    merge: 'filled',
    documentKind: 'notice',
    axalEntityKey: 'holdings',
    state: { kind: 'specimen' },
    stamp: null,
    audit: 'Invoice id assigned when issued',
    addressee: buildAddresseeBlock({ to: '[Licensee]', from: 'holdings' }),
    keyFigures: ['Invoice date', 'Licence', 'Period', 'Amount due', 'Due date', 'Reference']
      .map((l) => (l === 'Amount due' || l === 'Reference' || l === 'Licence' ? { label: l, value: br(l), mono: true } : { label: l, value: br(l) })),
    tables: [{
      columns: [{ label: 'Item' }, { label: 'Period' }, { label: 'Amount', align: 'right' }],
      rows: [[br('Item'), br('Period'), br('Amount')], ['Total', '', br('Amount')]],
      total: true,
    }],
    warning: PAY_WARNING,
    payment: {
      lines: [
        { label: 'Beneficiary', value: br('Beneficiary') },
        { label: 'Bank', value: br('Bank') },
        { label: 'Routing number (ABA)', value: br('Routing number (ABA)'), mono: true },
        { label: 'Account', value: RECEIVING_BRACKET, mono: true },
      ],
      reference: br('Reference'),
    },
    suppressExecutionBlock: true,
    inlineExecution: true,
    preserveBody: true,
  };
}

// ---------------------------------------------------------------- the store

export type StoredInvoice = InvoiceRow & {
  licence_uid: string; paid_cents: number; paid_at: string | null; paid_note: string | null; void_reason: string | null;
};

/** One licence's invoices, newest period first; `pdfBase` prefixes each `pdf_url`. */
export async function listFeeInvoices(env: Env, licence: { uid: string; licence_ref: string }, pdfBase: string) {
  const q = await env.DB.prepare(
    `SELECT uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
            issued_at, due_at, status, paid_cents, paid_at, paid_note, void_reason
       FROM licence_fee_invoices WHERE licence_uid = ? ORDER BY period_start DESC, id DESC`,
  ).bind(licence.uid).all<StoredInvoice>();
  return (q.results || []).map((row) => ({
    ...row,
    payment_reference: feeInvoiceReference(licence.licence_ref, row.period_label),
    amount_cents: Number(row.amount_cents),
    paid_cents: Number(row.paid_cents),
    pdf_url: row.status === 'void' ? null : `${pdfBase}/${row.uid}/pdf`,
  }));
}

/** One invoice of one licence, or null: a uid from another licence reads as absent. */
export async function feeInvoiceOf(env: Env, licenceUid: string, invoiceUid: string): Promise<StoredInvoice | null> {
  return await env.DB.prepare(
    `SELECT uid, licence_uid, period_label, period_start, period_end, amount_cents, currency,
            issued_at, due_at, status, paid_cents, paid_at, paid_note, void_reason
       FROM licence_fee_invoices WHERE licence_uid = ? AND uid = ?`,
  ).bind(licenceUid, invoiceUid).first<StoredInvoice>();
}

/**
 * The invoice printed. A void invoice is not printed (409): a page that still
 * reads "Amount due" for a claim HQ withdrew is the one paper this must never
 * hand out. Rendered on demand through Browser Run with no fallback, as D716's
 * notices are, so a page without its layout is never passed off as the invoice.
 */
export async function feeInvoicePdf(
  env: Env, licence: InvoiceLicence, invoice: StoredInvoice, licensor: string | null,
): Promise<{ ok: true; bytes: Uint8Array; filename: string } | { ok: false; status: 409 | 503; code: string; message: string }> {
  if (invoice.status === 'void') {
    return { ok: false, status: 409, code: 'invoice_void', message: 'This invoice was voided, so it is not printed.' };
  }
  const paper = await territoryInvoicePaper(env, licence, invoice, licensor);
  const rendered = await renderLegalPdf(env, paperModel(paper.input), { pageSize: 'letter', cover: 'light', fallback: false });
  if (!rendered.ok) {
    return { ok: false, status: 503, code: 'invoice_render_unavailable', message: 'The invoice could not be drawn right now. Try again in a moment.' };
  }
  const filename = `${TERRITORY_INVOICE_KEY}-${paper.reference}.pdf`.replace(/[^A-Za-z0-9_.-]/g, '-');
  return { ok: true, bytes: rendered.bytes, filename };
}
