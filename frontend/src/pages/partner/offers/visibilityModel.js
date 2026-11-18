/**
 * #4843 (D4843, Offers v2 board OF-05): Visibility answers "Where does our work come from?".
 * Pure, so `frontend/test/offers_visibility_of05_4843.test.mjs` loads it alone.
 *
 * What the read carries (`GET /api/partner-offers/surfaces`, migration 209): each surface's
 * engagement count and won value (the agreed price of the engagements that name it), the
 * firm's engagement total and how many name no surface. Views have no impression pipeline,
 * and no read carries a time series, so Views is Not measured and Trend Not recorded, each
 * with its reason one press away rather than a paragraph on the page.
 */

export const KIND_LABEL = Object.freeze({
  directory: 'Directory', referral: 'Referral', outbound: 'Outbound', content: 'Content', event: 'Event', other: 'Other',
});

export const VIEWS_WHY = 'No impression is recorded anywhere in the product, so a view count would be invented rather than measured.';
export const TREND_WHY = 'A trend needs engagements counted over time, and no read carries a time series yet.';
export const FOOT = 'Won = the agreed price of attributed engagements. Conversion isn’t shown because views aren’t measured.';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** Surfaces, most engagements first, then by name: the ordering the page claims. */
export function sourceRows(items) {
  return (Array.isArray(items) ? items : [])
    .map((s) => ({
      id: s.id, name: s.name || 'Unnamed surface', kind: KIND_LABEL[s.kind] || s.kind || 'Other',
      engagements: num(s.engagement_count), won: s.won_value == null ? null : Number(s.won_value), retired: !s.is_active,
      viewsWhy: s.views_note || VIEWS_WHY,
    }))
    .sort((a, b) => b.engagements - a.engagements || String(a.name).localeCompare(String(b.name)));
}

/**
 * The table's caption, "14 engagements · 10 attributed", from the read's own total and
 * unattributed count. With no total recorded the caption says nothing it cannot read.
 */
export function captionOf(d) {
  if (d?.engagement_total == null) return null;
  const total = num(d.engagement_total);
  const attributed = Math.max(total - num(d.unattributed_count), 0);
  return `${total} engagement${total === 1 ? '' : 's'} · ${attributed} attributed`;
}

/**
 * The missing-source notice, as an action: shown only when engagements name no surface, and
 * only offering Review attribution when there is a surface to attribute them to.
 */
export function missingSource(d, surfaces) {
  const n = num(d?.unattributed_count);
  if (n <= 0) return null;
  const canFix = (Array.isArray(surfaces) ? surfaces : []).some((s) => s.is_active);
  return {
    title: `${n} engagement${n === 1 ? ' has' : 's have'} no source recorded`,
    line: canFix ? 'They aren’t counted against any surface below.' : 'They aren’t counted against any surface. Add a surface to attribute them.',
    canFix,
  };
}
