/**
 * D5017 (#5017) — the Country pricing panel's rules, pure so the tests read
 * them without a page. What the panel shows (labels, "Not recorded" for an
 * unknown figure, never 0), and the apply body it sends (the exact
 * recommendation, the terms revision it read, the reason, and an override only
 * when a figure differs).
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { bpsPercent } from '../../../lib/bps.js';
import { codeAmount, parseMinor } from '../../../lib/money.js';

/** The five figures, in the order the panel lists them. `kind` decides the unit. */
export const PRICING_FIGURES = Object.freeze([
  { key: 'initial_fee_cents', label: 'Initial fee', kind: 'cents', term: null },
  { key: 'annual_fee_cents', label: 'Annual fee', kind: 'cents', term: 'annual_fee_cents' },
  { key: 'royalty_bps', label: 'Royalty', kind: 'bps', term: 'revenue_share_bps' },
  // D5953: the accepted minimum royalty is written into the schedule's minimum guarantee (§4.4).
  { key: 'minimum_royalty_cents', label: 'Minimum royalty', kind: 'cents', term: 'minimum_guarantee_cents' },
  { key: 'regulatory_surcharge_cents', label: 'Regulatory surcharge', kind: 'cents', term: null },
]);


export { NOT_RECORDED };

export const BASIS_LABELS = Object.freeze({
  primary_country: 'One pricing country',
  basket_weighted: 'Weighted basket of the territory',
  hq_override: 'HQ-set figures',
});

export const REVIEW_KIND_LABELS = Object.freeze({
  unchanged: 'No change recommended',
  increase: 'Recommended increase',
  decrease: 'Recommended decrease',
  incomplete: 'Incomplete source data',
});

export const REVIEW_STATE_LABELS = Object.freeze({
  open: 'Open', kept: 'Kept current terms', applied: 'Applied', overridden: 'Overridden', postponed: 'Postponed',
});

/** A figure as a person reads it. Null is "Not recorded", never zero. */
export function figure(value, kind, currency) {
  if (value === null || value === undefined) return NOT_RECORDED;
  if (kind === 'bps') return bpsPercent(Number(value)) ?? NOT_RECORDED;
  return codeAmount(Number(value), currency, { locale: undefined });
}

/** A signed difference, or null when either side is unknown. */
export function difference(rec, cur, kind, currency) {
  if (rec === null || rec === undefined || cur === null || cur === undefined) return null;
  const d = Number(rec) - Number(cur);
  if (d === 0) return 'No difference';
  const abs = figure(Math.abs(d), kind, currency);
  return `${d > 0 ? '+' : '−'}${abs}`;
}

/** An index in millionths as a multiplier, "1.120×"; unknown is "Not recorded". */
export function indexLabel(ppm) {
  if (ppm === null || ppm === undefined) return NOT_RECORDED;
  return `${(Number(ppm) / 1_000_000).toFixed(3)}×`;
}

/** How fresh a country's inputs are: the oldest as-of date among recorded inputs, and what is missing or provisional. */
export function freshness(country) {
  if (!country?.recorded) return { label: NOT_RECORDED, missing: [], provisional: [] };
  const inputs = Object.entries(country.inputs || {});
  const missing = inputs.filter(([, v]) => v.status === 'not_recorded').map(([k]) => k);
  const provisional = inputs.filter(([, v]) => v.status === 'provisional').map(([k]) => k);
  const dates = inputs.filter(([, v]) => v.status !== 'not_recorded' && v.as_of).map(([, v]) => v.as_of).sort();
  return { label: dates.length ? `Oldest input as of ${dates[0]}` : NOT_RECORDED, missing, provisional };
}

/** Money typed in the licence currency's units ("42000.50") to whole minor units of THAT currency (D5373), or null when blank, or NaN when not money for it. */
export function centsFrom(text, currency) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const r = parseMinor(s, String(currency ?? '').toUpperCase());
  return r.ok ? r.minor : Number.NaN;
}

/**
 * The apply body. Every accepted figure the form left blank takes the
 * recommendation's; one typed differently makes this an override, which needs
 * its reason. Returns `{ ok, body }` or `{ ok: false, errors }`.
 */
export function buildApply({ view, form, reviewUid = null }) {
  const errors = {};
  const snap = view?.recommendation;
  if (!snap) return { ok: false, errors: { form: 'Refresh the recommendation first.' } };
  const accepted = {};
  const currency = view?.terms?.currency ?? snap.currency;
  for (const f of PRICING_FIGURES) {
    const raw = form?.accepted?.[f.key];
    if (raw === undefined || String(raw).trim() === '') continue;
    const v = f.kind === 'bps' ? (/^\d+$/.test(String(raw).trim()) ? Number(raw) : Number.NaN) : centsFrom(raw, currency);
    if (!Number.isFinite(v) || v < 0 || (f.kind === 'bps' && v > 10000)) { errors[f.key] = f.kind === 'bps' ? 'must be whole basis points from 0 to 10000' : 'must be an amount like 42000 or 42000.50'; continue; }
    if (v !== snap.recommended?.[f.key]) accepted[f.key] = v;
  }
  const reason = String(form?.reason ?? '').trim();
  if (reason.length < 3) errors.reason = 'Say why, in at least 3 characters. It is kept in the licence\'s history.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form?.effective_from ?? ''))) errors.effective_from = 'Pick the date the pricing takes effect.';
  const override = Object.keys(accepted).length > 0 || !snap.available || snap.basis === 'hq_override';
  const overrideReason = String(form?.override_reason ?? '').trim();
  if (override && overrideReason.length < 3) errors.override_reason = 'These figures differ from the recommendation, so say why you are overriding it.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    override,
    body: {
      snapshot_uid: snap.uid,
      expected_terms_revision: Number(view.terms?.terms_revision ?? 0),
      ...(Object.keys(accepted).length ? { accepted } : {}),
      effective_from: form.effective_from,
      reason,
      ...(override ? { override_reason: overrideReason } : {}),
      ...(form.acknowledge ? { acknowledge_agreement_mismatch: true } : {}),
      ...(form.pricing_review_on ? { pricing_review_on: form.pricing_review_on } : {}),
      ...(reviewUid ? { review_uid: reviewUid } : {}),
    },
  };
}

/**
 * Whether applying would change a contractual figure (the annual fee, royalty or, D5953, the minimum guarantee) — the
 * case that needs the agreement acknowledged. A minimum royalty that is not recorded writes nothing, so changes nothing.
 */
export function changesContract(view, form) {
  const snap = view?.recommendation;
  if (!snap) return false;
  const fee = String(form?.accepted?.annual_fee_cents ?? '').trim() ? centsFrom(form.accepted.annual_fee_cents) : snap.recommended?.annual_fee_cents;
  const roy = String(form?.accepted?.royalty_bps ?? '').trim() ? Number(form.accepted.royalty_bps) : snap.recommended?.royalty_bps;
  const min = String(form?.accepted?.minimum_royalty_cents ?? '').trim()
    ? centsFrom(form.accepted.minimum_royalty_cents, view.terms?.currency ?? snap.currency) : snap.recommended?.minimum_royalty_cents;
  const minChanges = min !== null && min !== undefined && view.terms?.minimum_guarantee_cents !== undefined && min !== view.terms.minimum_guarantee_cents;
  return fee !== view.terms?.annual_fee_cents || roy !== view.terms?.revenue_share_bps || minChanges;
}

/** A basket form ({ FR: '6000', BE: '4000' }) to whole basis points, with its total. */
export function basketOf(form, territory) {
  const weights = {};
  let total = 0;
  for (const c of territory || []) {
    const n = Number(String(form?.[c] ?? '').trim());
    weights[c] = Number.isInteger(n) ? n : Number.NaN;
    total += Number.isInteger(n) ? n : 0;
  }
  return { weights, total, ok: total === 10000 && Object.values(weights).every((n) => Number.isInteger(n) && n > 0) };
}

/**
 * D5956 (#5956), boards L47 and L48 — where each of the five figures goes when the review is applied, before → after:
 * the annual fee and the royalty to the core terms, the minimum royalty to the schedule's § 4.4 minimum guarantee
 * (D5953), the initial fee and the surcharge to the one-off initial invoice issued from Billing (D5954). A figure the
 * recommendation does not record changes nothing ("Not recorded · no change"), never 0. Once the initial invoice is
 * issued, its two figures are recorded on the decision only; while the invoices cannot be read, that is unknown.
 * `invoices` is `{ status: 'loading'|'ready'|'unreadable', data }` from `GET /:uid/fee-invoices`.
 */
export const DESTINATIONS = Object.freeze({
  annual_fee_cents: 'Core terms',
  royalty_bps: 'Core terms',
  minimum_royalty_cents: 'Schedule § 4.4 minimum guarantee',
  initial_fee_cents: 'One-off initial invoice, issued from Billing',
  regulatory_surcharge_cents: 'One-off initial invoice, billed once with the initial fee',
});

const DEST_ORDER = ['annual_fee_cents', 'royalty_bps', 'minimum_royalty_cents', 'initial_fee_cents', 'regulatory_surcharge_cents'];
const COUNTS = { annual_fee_cents: 'per licence year', royalty_bps: '% of revenue', minimum_royalty_cents: 'per licence year', initial_fee_cents: 'one-off', regulatory_surcharge_cents: 'one-off' };

/** The figure the form would apply: a typed override, else the recommendation's. NaN for typed text that is not a figure. */
export function afterValue(view, form, f) {
  const raw = form?.accepted?.[f.key];
  if (raw !== undefined && String(raw).trim() !== '') {
    if (f.kind === 'bps') return /^\d+$/.test(String(raw).trim()) ? Number(raw) : Number.NaN;
    return centsFrom(raw, view?.terms?.currency ?? view?.recommendation?.currency);
  }
  const v = view?.recommendation?.recommended?.[f.key];
  return v === undefined ? null : v;
}

export function applyDestinations({ view, form, invoices }) {
  const cur = view?.terms?.currency ?? view?.recommendation?.currency;
  const terms = view?.terms || {};
  const prior = view?.latest_decision?.accepted || {};
  const classes = (view?.countries || []).filter((c) => c?.country_code);
  const cls = classes.length === 1 ? (classes[0].regulatory_class || NOT_RECORDED)
    : classes.length ? classes.map((c) => `${c.country_code} ${c.regulatory_class || NOT_RECORDED}`).join(' · ') : NOT_RECORDED;
  const initial = invoices?.status === 'ready'
    ? (Array.isArray(invoices.data?.invoices) ? invoices.data.invoices.find((i) => i?.kind === 'initial') : null) || null
    : undefined; // undefined: unknown
  return DEST_ORDER.map((key) => {
    const f = PRICING_FIGURES.find((x) => x.key === key);
    const beforeRaw = key === 'annual_fee_cents' ? terms.annual_fee_cents
      : key === 'royalty_bps' ? terms.revenue_share_bps
        : key === 'minimum_royalty_cents' ? terms.minimum_guarantee_cents
          : prior[key];
    const before = beforeRaw === undefined ? null : beforeRaw;
    const after = afterValue(view, form, f);
    const label = key === 'regulatory_surcharge_cents' ? `Regulatory surcharge · class ${cls}` : f.label;
    const row = { key, label, counts: COUNTS[key], before: figure(before, f.kind, cur), after: Number.isNaN(after) ? NOT_RECORDED : figure(after, f.kind, cur), goesTo: DESTINATIONS[key], tone: 'goes' };
    if (after === null || after === undefined) {
      const keep = key === 'minimum_royalty_cents' ? (before === null ? 'Schedule § 4.4 is not changed' : `Schedule § 4.4 keeps ${figure(before, f.kind, cur)}`)
        : key === 'initial_fee_cents' ? 'Nothing for the initial invoice'
          : key === 'regulatory_surcharge_cents' ? 'Never written as €0'
            : 'The core terms keep their figure';
      return { ...row, after: NOT_RECORDED, goesTo: `Not recorded · no change · ${keep}`, tone: 'none' };
    }
    if (key === 'initial_fee_cents' || key === 'regulatory_surcharge_cents') {
      if (initial === undefined) return { ...row, goesTo: 'Invoices could not be read · whether one is issued is unknown', tone: 'unknown' };
      if (initial) {
        const kept = key === 'initial_fee_cents' ? initial.initial_fee_cents : initial.regulatory_surcharge_cents;
        return { ...row, tone: 'decision', goesTo: key === 'initial_fee_cents'
          ? `Recorded on the decision only · invoice ${initial.reference || 'already'} already issued`
          : `Recorded on the decision only · the issued invoice keeps ${figure(kept ?? null, 'cents', initial.currency || cur)}` };
      }
    }
    return row;
  });
}

/** After an apply: the receipt's link to Billing, when an initial fee is now recorded and no initial invoice exists yet. */
export function issueFromBillingNext({ view, form, invoices }) {
  const fee = afterValue(view, form, PRICING_FIGURES[0]);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  if (invoices?.status !== 'ready') return null;
  const list = Array.isArray(invoices.data?.invoices) ? invoices.data.invoices : [];
  if (list.some((i) => i?.kind === 'initial')) return null;
  return { text: 'Initial invoice: issue it from Billing', href: `/admin/licences/${encodeURIComponent(view.licence_uid)}/fee-invoices` };
}
