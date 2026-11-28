/**
 * D802 (#2238) — the words and figures of HQ's "Annual fee invoices" tab on a
 * licence (`LicenceFeeInvoices.jsx`). Pure, so
 * `frontend/test/licence_fee_invoices_d802.test.mjs` holds each rule.
 */

import { formatMinorOrCount, parseMinor, toMajorString } from '../../lib/money.js';

const SIGN = { USD: '$', EUR: '€', GBP: '£' };

/** "€12,000.00" in the invoice's own currency, at that currency's decimals (¥12,000, KWD 12.000); a currency with no sign here reads "CHF 1,234.56". */
export function money(cents, currency) {
  if (!Number.isSafeInteger(cents)) return 'Not recorded';
  const code = String(currency || '').toUpperCase();
  const major = toMajorString(cents, code);
  if (major === null) return formatMinorOrCount(cents, code);
  const neg = major.startsWith('-');
  const [whole, frac] = (neg ? major.slice(1) : major).split('.');
  const text = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac === undefined ? '' : `.${frac}`}`;
  const sign = SIGN[code];
  return `${neg ? '-' : ''}${sign ? `${sign}${text}` : `${code} ${text}`}`;
}

/** A typed total received, in the invoice's currency units: minor units of THAT currency, or null (D5373). Never negative; no more decimals than the currency has. */
export function parseAmount(text, currency) {
  const t = String(text ?? '').trim().replace(/^[$€£]/, '').replace(/,/g, '');
  const r = parseMinor(t, String(currency || '').toUpperCase());
  return r.ok ? r.minor : null;
}

export const STATUS_WORDS = Object.freeze({ issued: 'Issued', paid: 'Paid', void: 'Void' });
export const STATUS_TONE = Object.freeze({ issued: 'warn', paid: 'ok', void: 'neutral' });

/**
 * D5036 part 2 (#5036) — the status an invoice is drawn with. Overdue on the Worker's own rule (`isOverdue`,
 * services/licenceFeeReceivables.ts): not void, a balance left, and the due date before `today` (a UTC day), with
 * how many days past due. Otherwise the invoice's own status. A void invoice is never overdue.
 */
export function invoiceStatus(inv, today) {
  const owed = inv.status === 'void' ? 0 : Math.max(0, Number(inv.amount_cents) - Number(inv.paid_cents));
  const due = /^\d{4}-\d{2}-\d{2}/.test(String(inv.due_at || '')) ? String(inv.due_at).slice(0, 10) : '';
  if (owed > 0 && due && /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) && due < today) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
    return { word: 'Overdue', tone: 'danger', overdue: true, days };
  }
  return { word: STATUS_WORDS[inv.status] || inv.status, tone: STATUS_TONE[inv.status] || 'neutral', overdue: false, days: 0 };
}

/** The line above the list: the fee and the anniversary, or why nothing can be invoiced. */
export function feeLine(read) {
  if (!read || typeof read !== 'object') return null;
  if (!Number.isSafeInteger(read.annual_fee_cents) || read.annual_fee_cents <= 0) {
    return { ok: false, text: 'No annual fee is recorded on this licence, so nothing can be invoiced. Set it on Terms.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(read.starts_on || ''))) {
    return { ok: false, text: 'No start date is recorded on this licence, so its licence year cannot be told.' };
  }
  return { ok: true, text: `Annual fee ${money(read.annual_fee_cents, read.currency)}. Each licence year starts on the anniversary of ${read.starts_on}.` };
}

/** "€4,000.00 of €12,000.00", or "Nothing yet". */
export function paidLine(inv) {
  if (inv.status === 'void') return 'Void';
  return inv.paid_cents > 0 ? `${money(inv.paid_cents, inv.currency)} of ${money(inv.amount_cents, inv.currency)}` : 'Nothing yet';
}

/**
 * D4819 part 12 (#5923) — why a void invoice is void, from its `void_note`.
 * The Worker requires the note (D802); a row without one says so rather than
 * showing nothing.
 */
export function voidLine(inv) {
  const note = String(inv?.void_note ?? '').trim();
  return note ? `Reason: ${note}` : 'Reason not recorded';
}

/**
 * The foot of board L13. An invoice freezes the fee it was issued at
 * (`figures_json`), so a fee amended on Terms reaches the next invoice issued,
 * never one already issued.
 */
export const FEE_CHANGE_NOTE = 'Voiding needs a reason, which is kept with the invoice and in HQ’s audit log (licence History does not list invoices yet). An issued invoice keeps the fee it was issued at; an amended fee applies to the next invoice issued.';

/* ------------------------------------------------------------------ *
 * D5956 (#5956) — the one-off initial invoice (D5954, boards L41 to L45). One per licence, ever; a void one keeps the
 * slot. Its figures come from the latest pricing decision's accepted initial fee and regulatory surcharge, frozen at
 * issue. Not recorded, Unavailable and €0 are never drawn alike.
 * ------------------------------------------------------------------ */

/** The initial invoice (`kind: 'initial'`) apart from the annual licence-year list. */
export function splitInvoices(invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  return { initial: list.find((i) => i?.kind === 'initial') || null, annual: list.filter((i) => i?.kind !== 'initial') };
}

/** Only an active or suspended licence is invoiced (the Worker's BILLABLE_STATUSES). */
export const INITIAL_BILLABLE = Object.freeze(['active', 'suspended']);

/** "1 Dec 2026" from "2026-12-01"; anything else is returned as given. */
export function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** The surcharge's class from the pricing read's countries: one class, each country's for a basket, Not recorded when unknown. */
export function regulatoryClassLabel(countries) {
  const list = Array.isArray(countries) ? countries.filter((c) => c && c.country_code) : [];
  if (!list.length) return 'class Not recorded';
  const cls = (c) => (c.recorded && c.regulatory_class ? c.regulatory_class : 'Not recorded');
  if (list.length === 1) return `class ${cls(list[0])}`;
  return `class ${list.map((c) => `${c.country_code} ${cls(c)}`).join(' · ')}`;
}

const NR = 'Not recorded';
const posInt = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * What the initial invoice card draws. `invoicesRead` and `pricingRead` are `{ status: 'loading'|'ready'|'unreadable',
 * data }` (the two reads load apart). Returns the state, its chip, the lines, the total, the metadata, whether Issue is
 * offered (`canIssue`; the Worker still decides) and, when it is off, the sentence why.
 */
export function initialInvoiceCard({ licence, invoicesRead, pricingRead, today }) {
  const lic = licence || {};
  const pricing = pricingRead?.status === 'ready' ? pricingRead.data : null;
  const classLabel = regulatoryClassLabel(pricing?.countries);
  const base = { lines: [], total: null, nrSurcharge: false, meta: [], canIssue: false, issueShown: false, why: '', invoice: null, decisionUid: null, currency: null, record: false, voidable: false };

  if (invoicesRead?.status === 'loading') return { ...base, state: 'loading', chip: { word: 'Loading', tone: 'neutral' } };
  if (invoicesRead?.status !== 'ready') {
    return { ...base, state: 'invunread', chip: { word: 'Unavailable', tone: 'neutral' }, issueShown: true,
      why: 'Issue is off until the invoices are read: one may already be issued, and a second can never be.' };
  }
  const { initial } = splitInvoices(invoicesRead.data?.invoices);
  if (initial) return issuedCard(initial, classLabel, today, base);

  if (pricingRead?.status === 'loading') return { ...base, state: 'loading', chip: { word: 'Loading', tone: 'neutral' } };
  if (pricingRead?.status !== 'ready') {
    return { ...base, state: 'decunread', chip: { word: 'Unavailable', tone: 'neutral' },
      why: 'The pricing decision could not be read. Its figures are unknown, not zero. Issue stays off.' };
  }
  const decision = pricing?.latest_decision || null;
  if (!decision) {
    return { ...base, state: 'nodecision', chip: { word: 'None', tone: 'neutral' },
      why: 'No pricing has been accepted for this licence, so there is no initial fee to invoice.' };
  }
  const accepted = decision.accepted || {};
  const currency = decision.currency || pricing?.terms?.currency || null;
  const fee = posInt(accepted.initial_fee_cents) ? accepted.initial_fee_cents : null;
  const surcharge = posInt(accepted.regulatory_surcharge_cents) ? accepted.regulatory_surcharge_cents : null;
  const lines = draftLines(fee, surcharge, currency, classLabel);
  const out = {
    ...base, chip: { word: 'Not issued', tone: 'neutral' }, decisionUid: decision.uid || null, currency,
    lines, nrSurcharge: surcharge === null, total: fee === null ? null : money(fee + (surcharge ?? 0), currency),
    meta: [['Reference', 'Given at issue'], ['Issued', 'Not issued'], ['Due', 'From the licence’s payment terms (30 days when none is recorded)'], ['Payee', 'The licence’s licensor (Terms schedule)']],
  };
  if (!INITIAL_BILLABLE.includes(lic.status)) return { ...out, state: 'notbill', why: 'Only an active or suspended licence is invoiced.' };
  const starts = /^\d{4}-\d{2}-\d{2}$/.test(String(lic.starts_on || '')) ? lic.starts_on : null;
  if (!starts) {
    return { ...out, state: 'nostart', issueShown: true, meta: out.meta.map(([k, v]) => (k === 'Due' ? [k, '—'] : [k, v])),
      why: 'Start date Not recorded · set it on Terms. The licence year and the due date cannot be told without it.' };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) && starts > today) {
    return { ...out, state: 'notstarted', issueShown: true, why: `Can be issued from ${dayLabel(starts)}, the licence’s start date.` };
  }
  if (fee === null || fee === 0) {
    return { ...out, state: 'nrfee', issueShown: true, total: null,
      why: 'The accepted pricing has no initial fee, so nothing can be invoiced. Record it by applying or overriding on Pricing & Market.' };
  }
  return { ...out, state: surcharge === null ? 'nrsur' : 'ready', issueShown: true, canIssue: true };
}

function draftLines(fee, surcharge, currency, classLabel) {
  const lines = [{ key: 'fee', label: 'Initial licence fee', note: 'one-off · at licence start', amount: fee === null ? NR : money(fee, currency) }];
  // D5954: a surcharge that is not recorded prints no line (never €0); one recorded as zero prints none either.
  if (surcharge !== null && surcharge > 0) lines.push({ key: 'surcharge', label: `Regulatory surcharge · ${classLabel}`, note: 'one-off · billed once with the initial fee', amount: money(surcharge, currency) });
  return lines;
}

/** The issued initial invoice state shared by HQ Billing and the licensee Statements tab. */
export function initialInvoiceState(inv, today) {
  const status = invoiceStatus(inv, today);
  if (inv.status === 'void') return { state: 'void', chip: { word: 'Void', tone: 'neutral' } };
  if (inv.status === 'paid') return { state: 'paid', chip: { word: 'Paid', tone: 'ok' } };
  if (status.overdue) {
    const days = `${status.days} ${status.days === 1 ? 'day' : 'days'}`;
    return { state: 'overdue', chip: { word: `Overdue · ${days}`, tone: 'danger' } };
  }
  if (Number(inv.paid_cents) > 0) return { state: 'part', chip: { word: 'Part paid', tone: 'warn' } };
  return { state: 'issued', chip: { word: 'Issued', tone: 'warn' } };
}

function issuedCard(inv, classLabel, today, base) {
  const { state, chip } = initialInvoiceState(inv, today);
  const paid = Number(inv.paid_cents) || 0;
  const amount = Number(inv.amount_cents);
  const voided = state === 'void';
  const fee = posInt(inv.initial_fee_cents) ? inv.initial_fee_cents : null;
  const surcharge = posInt(inv.regulatory_surcharge_cents) ? inv.regulatory_surcharge_cents : null;
  const lines = draftLines(fee, surcharge, inv.currency, classLabel);
  const day = (v) => (v ? dayLabel(String(v).slice(0, 10)) : NR);
  const meta = [
    ['Reference', inv.reference || NR],
    ['Issued', day(inv.issued_at)],
    ['Due', day(inv.due_at)],
    ['Paid so far', voided ? '—' : `${money(paid, inv.currency)} of ${money(amount, inv.currency)}`],
    ['PDF', voided ? 'Hidden · a void invoice prints nothing' : inv.pdf_url ? `${inv.reference || 'invoice'}.pdf` : NR],
  ];
  const why = voided ? `${voidLine(inv)}. An initial invoice has been issued for this licence; no second one can be issued.`
    : state === 'paid' ? 'Paid in full. Nothing more is recorded; Void is not offered.'
      : state === 'part' || (state === 'overdue' && paid > 0) ? 'Void is not offered: only an invoice with nothing paid can be voided.' : '';
  return {
    ...base, state, chip, invoice: inv, lines, nrSurcharge: surcharge === null, currency: inv.currency,
    total: Number.isSafeInteger(amount) ? money(amount, inv.currency) : NR, meta, why,
    decisionUid: inv.pricing_decision_uid || null,
    record: !voided && state !== 'paid', voidable: !voided && paid === 0,
  };
}

/** The card's foot: where the figures come from, and that they freeze at issue. */
export function initialFoot(card) {
  const from = card.decisionUid ? 'From the latest pricing decision · Terms › Pricing & Market' : 'From the pricing decision · Terms › Pricing & Market';
  return card.invoice
    ? `${from} · frozen at issue: later applies or market updates never change it.`
    : `${from} · the figures are frozen when the invoice is issued.`;
}
