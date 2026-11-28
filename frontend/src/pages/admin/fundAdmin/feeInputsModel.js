/**
 * D9107 (#9107): the Fees tab's four recording forms, pure — the inputs the
 * management fee is computed from (D709): a fee terms version, an LP's
 * admission date, the fund's net invested capital and an offset. Each form
 * turns what a person typed into the exact body its `fee.write` route takes,
 * or one sentence that says what to fix. Only what cannot be sent is checked
 * here (a rate or an amount that does not parse, no company chosen); every
 * other rule is the Worker's, and its sentence is shown in the dialog.
 *
 * Rates are typed as a percent and sent as basis points through
 * `lib/bps.js`; amounts are typed in dollars and sent as whole cents through
 * `lib/moneyInput.js`. Neither goes through a float.
 */
import { bpsPercent, bpsToPercentInput, percentToBps } from '../../../lib/bps';
import { amountToCents } from '../../../lib/moneyInput';
import { refusalText } from './fundAdminModel';

export const SOURCE_MAX = 500;
export const BASIS_AFTER = [['net_invested', 'Net invested capital'], ['committed', 'Commitments']];
export const AXAL_ENTITIES = [['holdings', 'Holdings'], ['management', 'Management'], ['gp', 'GP']];
export const EFFECTIVE_HINT = 'The first day of a quarter after every issued period.';
export const FIRST_VERSION_NOTE = 'This is the first version: it takes effect on the fee start date.';
export const DRAFT_NOTE = 'A recorded version is a draft until a Super Admin confirms it. Nothing here moves money.';
export const RATE_ERROR = 'Enter the annual rate as a percent from 0 to 100 with up to two decimals, such as 2.00.';
export const OFFSET_SHARE_ERROR = 'Enter the offset share as a percent from 0 to 100 with up to two decimals, such as 100.';
export const NET_AMOUNT_ERROR = 'Enter net invested capital in dollars, such as 1,200.50.';
export const OFFSET_AMOUNT_ERROR = 'Enter the offset in dollars, such as 1,200.50.';
export const COMPANY_ERROR = 'Choose the portfolio company the offset came from.';

const text = (v) => String(v ?? '').trim();
const percent = (v) => { const b = percentToBps(text(v)); return b != null && b <= 10000 ? b : null; };

/** The fund's confirmed versions, earliest first (the read is ordered by `effective_from`). */
export function confirmedTerms(terms) {
  return (Array.isArray(terms) ? terms : []).filter((t) => t?.status === 'confirmed')
    .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));
}

/**
 * The terms form's first values: the rate, offset share and basis from the
 * read's `defaults` (D709 decision 1); with a confirmed version, its fee start
 * date (which every version keeps) and investment-period end.
 */
export function termsForm(state) {
  const d = state?.defaults || {};
  const confirmed = confirmedTerms(state?.terms);
  const first = confirmed[0];
  const latest = confirmed[confirmed.length - 1];
  return {
    rate: bpsToPercentInput(d.annual_bps) ?? '',
    offset: bpsToPercentInput(d.offset_bps) ?? '',
    basis: BASIS_AFTER.some(([k]) => k === d.basis_after) ? d.basis_after : 'net_invested',
    start: first?.fee_start_date || '',
    periodEnd: latest?.investment_period_end || '',
    effective: '',
    lpa: '',
  };
}

/**
 * `POST /terms`'s body, or `{ error }`. With no confirmed version the date it
 * takes effect is left out, so the Worker takes the fee start date; with one,
 * the fee start date is the confirmed one and "Takes effect" is sent.
 */
export function termsBody(form, { hasConfirmed = false } = {}) {
  const annual = percent(form?.rate);
  if (annual == null) return { error: RATE_ERROR };
  const offset = percent(form?.offset);
  if (offset == null) return { error: OFFSET_SHARE_ERROR };
  const body = {
    annual_bps: annual,
    offset_bps: offset,
    basis_after: text(form?.basis),
    fee_start_date: text(form?.start),
    investment_period_end: text(form?.periodEnd),
    lpa_reference: text(form?.lpa),
  };
  if (hasConfirmed) body.effective_from = text(form?.effective);
  return { body };
}

/** `PUT /lps/:id/admission`'s body: a blank closing label is sent as null. */
export function admissionBody(form) {
  return { body: { admitted_on: text(form?.date), closing_label: text(form?.label) || null, source: text(form?.source) } };
}

/** `POST /net-invested`'s body, dollars to whole cents (0 is a figure somebody recorded). */
export function netInvestedBody(form) {
  const c = amountToCents(form?.amount);
  if (c.cents == null) return { error: c.error || NET_AMOUNT_ERROR };
  return { body: { as_of: text(form?.asOf), net_invested_cents: c.cents, source: text(form?.source) } };
}

/** `POST /offsets`'s body. */
export function offsetBody(form) {
  const project = Number(form?.project);
  if (!text(form?.project) || !Number.isSafeInteger(project) || project <= 0) return { error: COMPANY_ERROR };
  const c = amountToCents(form?.amount);
  if (c.cents == null) return { error: c.error || OFFSET_AMOUNT_ERROR };
  return { body: { project_id: project, axal_entity: text(form?.entity), amount_cents: c.cents, received_on: text(form?.receivedOn), description: text(form?.description), source: text(form?.source) } };
}

/**
 * A terms row as FND13 draws it. A later version whose rate is lower than the
 * confirmed one in effect before it reads "Step-down to 1.5% from 2027-01-01".
 */
export function termsLabel(t, terms) {
  const rate = bpsPercent(t?.annual_bps);
  if (!rate) return `Rate not recorded a year from ${t?.effective_from}`;
  const before = confirmedTerms(terms).filter((c) => c.uid !== t.uid && String(c.effective_from) < String(t.effective_from));
  const prior = before[before.length - 1];
  if (prior && Number(t.annual_bps) < Number(prior.annual_bps)) return `Step-down to ${rate} from ${t.effective_from}`;
  return `${rate} a year from ${t.effective_from}`;
}

/** The dates under a terms row. */
export function termsDates(t) {
  return `Fee start ${t?.fee_start_date || 'not recorded'} · investment period to ${t?.investment_period_end || 'not recorded'}`;
}

/**
 * Every sentence of a refusal. A fee route answers `refusals: [...]` beside
 * its `message`, and `request()` keeps the body on `e.data` (`lib/api.js`),
 * so each line is shown; any other refusal is its one message.
 */
export function refusalLines(e, fallback) {
  const list = Array.isArray(e?.data?.refusals) ? e.data.refusals.filter((s) => typeof s === 'string' && s.trim()) : [];
  return list.length ? [...new Set(list)] : [refusalText(e, fallback)];
}

/** The company picker's options: this fund's positions that name a company, one per company. */
export function companyOptions(positions) {
  const seen = new Map();
  for (const p of Array.isArray(positions?.items) ? positions.items : []) {
    if (p?.project_id == null || seen.has(Number(p.project_id))) continue;
    seen.set(Number(p.project_id), p.company_name || `Company #${p.project_id}`);
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

export const entityLabel = (k) => AXAL_ENTITIES.find(([key]) => key === k)?.[1] || 'Not recorded';
export const countedText = (o) => (o?.counted_in ? `Counted in ${o.counted_in}` : 'Not counted yet');
