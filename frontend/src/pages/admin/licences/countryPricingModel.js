/**
 * D5017 (#5017) — the Country pricing panel's rules, pure so the tests read
 * them without a page. What the panel shows (labels, "Not recorded" for an
 * unknown figure, never 0), and the apply body it sends (the exact
 * recommendation, the terms revision it read, the reason, and an override only
 * when a figure differs).
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { bpsPercent } from '../../../lib/bps.js';

/** The five figures, in the order the panel lists them. `kind` decides the unit. */
export const PRICING_FIGURES = Object.freeze([
  { key: 'initial_fee_cents', label: 'Initial fee', kind: 'cents', term: null },
  { key: 'annual_fee_cents', label: 'Annual fee', kind: 'cents', term: 'annual_fee_cents' },
  { key: 'royalty_bps', label: 'Royalty', kind: 'bps', term: 'revenue_share_bps' },
  { key: 'minimum_royalty_cents', label: 'Minimum royalty', kind: 'cents', term: null },
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
  return `${currency || ''} ${(Number(value) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
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

/** Money typed in currency units ("42000.50") to whole cents, or null when blank, or NaN when not a number. */
export function centsFrom(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
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
  for (const f of PRICING_FIGURES) {
    const raw = form?.accepted?.[f.key];
    if (raw === undefined || String(raw).trim() === '') continue;
    const v = f.kind === 'bps' ? (/^\d+$/.test(String(raw).trim()) ? Number(raw) : Number.NaN) : centsFrom(raw);
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

/** Whether applying would change a contractual figure (the annual fee or royalty) — the case that needs the agreement acknowledged. */
export function changesContract(view, form) {
  const snap = view?.recommendation;
  if (!snap) return false;
  const fee = String(form?.accepted?.annual_fee_cents ?? '').trim() ? centsFrom(form.accepted.annual_fee_cents) : snap.recommended?.annual_fee_cents;
  const roy = String(form?.accepted?.royalty_bps ?? '').trim() ? Number(form.accepted.royalty_bps) : snap.recommended?.royalty_bps;
  return fee !== view.terms?.annual_fee_cents || roy !== view.terms?.revenue_share_bps;
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
