/**
 * D5018 (#5018) — program pricing on the Program grants pages, pure so the
 * tests read it without a page: one program's line (base → country-adjusted →
 * accepted, an override marked, the period), and the `pricing` object a grant
 * or change-terms write sends.
 *
 * A program with no reference price reads "Not recorded", never free or 0.
 */
import { NOT_RECORDED } from '../../../lib/absence.js';
import { formatMinorOrCount, parseMinor, plainAmount } from '../../../lib/money';

export { NOT_RECORDED };

/** Whole cents as money a person reads; null is "Not recorded". */
export function money(cents, currency) {
  if (cents === null || cents === undefined) return NOT_RECORDED;
  // D5373: at the currency's own decimals ("EUR 12,000.00", "JPY 12,000", "KWD 12.000"); an unusable code names the count.
  const cur = currency ? String(currency).toUpperCase() : '';
  const plain = plainAmount(Number(cents), cur);
  return plain === null ? formatMinorOrCount(Number(cents), cur) ?? NOT_RECORDED : `${cur} ${plain}`;
}

/** An index in millionths as a multiplier; unknown is "Not recorded". */
export const indexWord = (ppm) => (ppm === null || ppm === undefined ? NOT_RECORDED : `${(Number(ppm) / 1_000_000).toFixed(3)}×`);

/** One program's pricing line for the studio view. */
export function pricingLine(row) {
  const base = row?.base ? money(row.base.annual_fee_cents, row.base.currency) : NOT_RECORDED;
  const rec = row?.recommendation;
  const adjusted = rec?.available ? money(rec.recommended_annual_fee_cents, rec.currency) : NOT_RECORDED;
  const a = row?.accepted;
  return {
    key: row.program_key,
    name: row.name,
    base,
    baseWhy: row?.base ? `v${row.base.version}` : row?.base_reason || 'No reference price is recorded.',
    adjusted,
    adjustedWhy: rec?.available ? null : rec?.unavailable_reason || null,
    accepted: a ? money(a.annual_fee_cents, a.currency) : NOT_RECORDED,
    overridden: !!a?.overridden,
    overrideWhy: a?.override_reason || null,
    period: a ? `${a.effective_from} → ${a.effective_to || 'open'}` : '—',
  };
}

/** Money typed in the currency's units ("12000.50") as whole minor units of THAT currency (D5373); null for blank, NaN when not money for it. */
export function centsOf(text, currency) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const r = parseMinor(s, String(currency ?? '').toUpperCase());
  return r.ok ? r.minor : Number.NaN;
}

export const PRICE_MODES = Object.freeze({
  terms: 'Keep the fee in the terms',
  recommended: 'Accept the recommended price',
  override: 'Override the price',
});

/**
 * What a grant write sends for its price. `terms` sends no `pricing` (the fee
 * stays a term, and an unchanged fee records nothing). `recommended` and
 * `override` send `pricing` and drop `fee_cents` from the terms, so the two
 * never disagree. Returns `{ ok, pricing, dropFee }` or `{ ok: false, error }`.
 */
export function buildPricing({ mode, rec, form, snapshotUid, currency }) {
  if (!mode || mode === 'terms') return { ok: true, pricing: null, dropFee: false };
  const dates = {
    ...(form?.effective_from ? { effective_from: form.effective_from } : {}),
    ...(form?.effective_to ? { effective_to: form.effective_to } : {}),
  };
  if (form?.effective_from && form?.effective_to && form.effective_to <= form.effective_from) return { ok: false, error: 'The end of the price period must be after its start.' };
  const snap = snapshotUid ? { licence_snapshot_uid: snapshotUid } : {};
  if (mode === 'recommended') {
    if (!rec?.available) return { ok: false, error: 'There is no recommended price to accept. Override it with a reason, or keep the fee in the terms.' };
    return { ok: true, pricing: { ...snap, ...dates }, dropFee: true };
  }
  const fee = centsOf(form?.fee, currency ?? rec?.currency);
  if (fee === null || Number.isNaN(fee)) return { ok: false, error: 'Give the price, like 12000 or 12000.50.' };
  const why = String(form?.override_reason ?? '').trim();
  if (why.length < 3) return { ok: false, error: 'Say why the price differs from the recommendation.' };
  return { ok: true, pricing: { ...snap, accepted_annual_fee_cents: fee, override_reason: why, ...dates }, dropFee: true };
}
