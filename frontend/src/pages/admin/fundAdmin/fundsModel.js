/**
 * D1161 (#3068, part 4 of #2388) — the Funds tab (FND3) and the one-fund page
 * (FND4): what they say and check, with no React.
 *
 * NEVER A RATE THE FUND DID NOT RECORD. A carry or fee that no read gives
 * reads "Not recorded", never 20% or 2%; New fund asks for both, so a blank
 * never becomes the store's default.
 */
import { money } from './fundAdminModel.js';

export const FUND_REASON_MIN = 10;
export const FUND_REASON_MAX = 500;
export const FUND_NAME_MAX = 200;

/** `vc_funds.status`, in the Worker's words, as `[key, label]`. */
export const FUND_STATUSES = Object.freeze([
  ['fundraising', 'Fundraising'],
  ['active', 'Active'],
  ['closed', 'Closed'],
  ['wound_down', 'Wound down'],
]);
export const statusLabel = (s) => FUND_STATUSES.find(([k]) => k === s)?.[1] ?? 'Status not recorded';

export const SORTS = Object.freeze([
  ['vintage', 'Vintage'],
  ['name', 'Name'],
  ['size', 'Fund size'],
]);

/** Service providers (FND4), as the columns migration 163 names them. */
export const PROVIDERS = Object.freeze([
  ['fund_admin', 'Fund administrator'],
  ['auditor', 'Auditor'],
  ['legal_counsel', 'Legal counsel'],
  ['custodian', 'Custodian'],
  ['valuation_policy', 'Valuation policy'],
]);
export const PROVIDER_MAX = 200;

export const NOT_RECORDED = 'Not recorded';
export const NO_CARRY = 'No carry recorded for this fund.';
export const NO_FEE = 'No management fee recorded for this fund.';
export const NO_GP = 'No general partner of record';
export const NEW_FUND_INFO = 'An LPA draft is generated for the fund. The fund has no general partner of record until a Super Admin sets one.';
export const WATERFALL = 'Not recorded: the distribution job has no hurdle or tiers.';
export const WATERFALL_LINE = 'Carry is withheld on profit at the fund’s carry rate. There is no editor.';
export const ECONOMICS_NOTE = 'A change asks a reason, then your authenticator code.';
export const REGENERATE_INFO = 'A new LPA draft replaces the current draft. Signed LPAs are kept.';
export const OUTSIDE_LINE = 'Managed from its own fund page.';
export const FUNDS_EMPTY = 'No fund is recorded yet. New fund creates the first.';
export const FUNDS_FOOT = 'No carry or fee recorded says Not recorded, never 20% or 2%.';

/** A stored fraction (0.2) as a percent ("20.00%"), or null when none was recorded. Zero is a recorded rate. */
export function rateText(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? `${(n * 100).toFixed(2)}%` : null;
}

/** A fund's size in cents as dollars. The store writes 0 when none was given, so 0 is not a size. */
export function sizeText(cents) {
  const n = Number(cents);
  return cents != null && Number.isSafeInteger(n) && n > 0 ? money(n) : null;
}

/** A text fact, trimmed, or null. */
export const fact = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "GP entity · GP name", or null when neither is recorded. */
export function gpText(f) {
  const parts = [fact(f?.gp_entity), fact(f?.gp_name)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A fund's LPA, as the list states it: on file when a document is linked. */
export const lpaOnFile = (f) => f?.lpa_doc_id != null;

/**
 * The funds list split by who runs it (FND3): the funds the overview names as
 * administered, and the rest, run by an outside GP. When the overview did not
 * read, every fund stays in the table and `known` is false, so the page says
 * it could not tell, never that no fund has an outside GP.
 */
export function splitFunds(list, overview) {
  const rows = Array.isArray(list) ? list : [];
  if (overview?.funds?.state !== 'ok' || !Array.isArray(overview.funds.items)) return { administered: rows, outside: [], known: false };
  const ids = new Set(overview.funds.items.map((f) => Number(f.fund_id)));
  return { administered: rows.filter((f) => ids.has(Number(f.id))), outside: rows.filter((f) => !ids.has(Number(f.id))), known: true };
}

/** Search, status and sort (FND3). A fund with no vintage or size sorts last. */
export function filterFunds(rows, { q = '', status = '', sort = 'vintage' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = (rows || []).filter((f) => (!status || f.status === status)
    && (!needle || [f.name, f.slug, f.gp_name, f.gp_entity].some((v) => String(v || '').toLowerCase().includes(needle))));
  const last = (v) => (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v));
  const byNum = (k, dir) => (a, b) => {
    const x = last(a[k]); const y = last(b[k]);
    if (x === y) return String(a.name || '').localeCompare(String(b.name || ''));
    if (x === null) return 1;
    if (y === null) return -1;
    return dir * (x - y);
  };
  const cmp = sort === 'name' ? (a, b) => String(a.name || '').localeCompare(String(b.name || ''))
    : sort === 'size' ? byNum('fund_size_cents', -1) : byNum('vintage_year', -1);
  return [...out].sort(cmp);
}

/** A percent typed in a form ("20", "2.5%") as a stored fraction, or null when it is not 0–100. */
export function percentToFraction(text) {
  const s = String(text ?? '').trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? Math.round(n * 100) / 10000 : null;
}

/** Dollars typed in a form ("$20,000,000.00") as integer cents, or null. */
export function dollarsToCents(text) {
  const s = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * New fund's form as the `POST /api/funds` body, or `{ error }`. Both rates
 * are required: a blank never stores 20% or 2%. Target size and vintage are
 * optional and sent only when given.
 */
export function checkNewFund(form) {
  const name = String(form?.name ?? '').trim();
  if (!name) return { error: 'Name the fund.' };
  if (name.length > FUND_NAME_MAX) return { error: `A fund name is at most ${FUND_NAME_MAX} characters.` };
  const body = { name, status: FUND_STATUSES.some(([k]) => k === form?.status) ? form.status : 'fundraising' };
  const vintage = String(form?.vintage ?? '').trim();
  if (vintage) {
    if (!/^\d{4}$/.test(vintage) || Number(vintage) < 1900 || Number(vintage) > 2100) return { error: 'A vintage year is four digits, such as 2027.' };
    body.vintage_year = Number(vintage);
  }
  const size = String(form?.size ?? '').trim();
  if (size) {
    const cents = dollarsToCents(size);
    if (cents === null || cents <= 0) return { error: 'Enter the target size in dollars, such as 20,000,000.00.' };
    body.fund_size_cents = cents;
  }
  const carry = percentToFraction(form?.carry);
  if (carry === null) return { error: 'Enter the carry as a percent from 0 to 100. It is never filled in for you.' };
  const fee = percentToFraction(form?.fee);
  if (fee === null) return { error: 'Enter the management fee as a percent from 0 to 100. It is never filled in for you.' };
  return { body: { ...body, carried_interest: carry, management_fee: fee } };
}

/** The Change dialog (FND4): both rates and a reason, as the PATCH body, or `{ error }`. Nothing changed is refused. */
export function checkEconomics(form, fund) {
  const carry = percentToFraction(form?.carry);
  if (carry === null) return { error: 'Enter the carry as a percent from 0 to 100.' };
  const fee = percentToFraction(form?.fee);
  if (fee === null) return { error: 'Enter the management fee as a percent from 0 to 100.' };
  const reason = String(form?.reason ?? '').trim();
  if (reason.length < FUND_REASON_MIN || reason.length > FUND_REASON_MAX) return { error: `Give a reason of ${FUND_REASON_MIN} to ${FUND_REASON_MAX} characters. It is kept on the audit record.` };
  const same = (a, b) => a != null && b != null && Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < 1e-9;
  if (same(fund?.carried_interest, carry) && same(fund?.management_fee, fee)) return { error: 'Neither rate changed.' };
  return { body: { carried_interest: carry, management_fee: fee, reason } };
}

/** A recorded rate as the form shows it ("20.00"), else blank. */
export const rateInput = (v) => (rateText(v) ?? '').replace(/%$/, '');

/** The service providers' form as a PATCH body: only the changed facts, a cleared one as null. */
export function providersBody(form, fund) {
  const body = {};
  for (const [k] of PROVIDERS) {
    const next = String(form?.[k] ?? '').trim();
    if (next.length > PROVIDER_MAX) return { error: `Each provider is at most ${PROVIDER_MAX} characters.` };
    if ((fact(fund?.[k]) ?? '') !== next) body[k] = next || null;
  }
  return Object.keys(body).length ? { body } : { error: 'Nothing changed.' };
}

/**
 * The LPA card (FND4) from `GET /api/funds/:id`: a document on file with its
 * version and status, none yet, or none until a GP of record is named.
 */
export function lpaCard(fund, lpa) {
  if (fund?.lpa_doc_id != null && lpa) {
    const version = Number.isSafeInteger(Number(lpa.version)) && Number(lpa.version) > 0 ? `Version ${lpa.version}` : 'Version not recorded';
    const status = fact(lpa.status);
    return { state: 'on_file', title: version, line: status ? `Status: ${status}` : 'Status not recorded', updated: lpa.updated_at || lpa.created_at || null };
  }
  if (fund?.lpa_doc_id != null) return { state: 'on_file', title: 'On file', line: 'The document’s details could not be read.', updated: null };
  if (fund?.gp_user_id == null) return { state: 'blocked', title: 'No LPA yet', line: 'No LPA is drafted until the fund has a general partner of record.', updated: null };
  return { state: 'pending', title: 'No LPA yet', line: 'A draft is generated in the background. Regenerate asks for a new one.', updated: null };
}

/** A refused LPA act, in our words. */
export function lpaRefusal(e, fallback) {
  if (e?.code === 'no_gp_of_record') return 'Name the fund’s general partner of record before an LPA is drafted.';
  if (e?.code === 'lpa_no_body') return 'No LPA text is stored for this fund yet.';
  return fallback;
}

/**
 * The one-fund tiles (FND4): the vintage and size from the fund, the call
 * figures from the overview's row for it. A fund the overview does not list
 * says its figures are not read here, never zeros.
 */
export function fundTiles(fund, item) {
  const m = (v) => (item && v != null && Number.isSafeInteger(Number(v)) ? money(Number(v)) : NOT_RECORDED);
  const note = item ? null : 'Not read for a fund the console does not administer.';
  const overdue = Number(item?.overdue_lines);
  return [
    { k: 'Vintage', v: fund?.vintage_year ?? NOT_RECORDED, note: statusLabel(fund?.status) },
    { k: 'Fund size', v: sizeText(fund?.fund_size_cents) ?? NOT_RECORDED },
    { k: 'Committed', v: m(item?.committed_cents), note },
    { k: 'Called', v: m(item?.called_cents), note },
    { k: 'Received', v: m(item?.received_cents), note },
    { k: 'Outstanding', v: m(item?.outstanding_cents), note: overdue > 0 ? `${overdue} ${overdue === 1 ? 'line' : 'lines'} overdue` : note, tone: overdue > 0 ? 'warn' : null },
  ];
}

/** `/admin/fund-admin/funds/:id`'s id, or null. */
export function fundIdFrom(pathname) {
  const m = /^\/admin\/fund-admin\/funds\/([1-9]\d*)\/?$/.exec(String(pathname || ''));
  return m ? Number(m[1]) : null;
}

/** Edit fund facts (FND4): name, vintage, size and status, as a PATCH of what changed, or `{ error }`. */
export function checkFacts(form, fund) {
  const out = checkNewFund({ ...form, carry: '0', fee: '0' });
  if (out.error) return out;
  const { carried_interest: _c, management_fee: _f, ...next } = out.body;
  if (!String(form?.vintage ?? '').trim()) next.vintage_year = null;
  // A blank size is left as stored: the column takes no empty value.
  const body = {};
  for (const [k, v] of Object.entries(next)) if (String(fund?.[k] ?? '') !== String(v ?? '')) body[k] = v;
  return Object.keys(body).length ? { body } : { error: 'Nothing changed.' };
}

/** A fund's facts as the Edit fund facts form shows them. */
export function factsForm(fund) {
  const cents = Number(fund?.fund_size_cents);
  return {
    name: fund?.name || '',
    vintage: fund?.vintage_year != null ? String(fund.vintage_year) : '',
    size: Number.isSafeInteger(cents) && cents > 0 ? (cents / 100).toFixed(2) : '',
    status: FUND_STATUSES.some(([k]) => k === fund?.status) ? fund.status : 'fundraising',
  };
}
