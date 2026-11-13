/**
 * D5020 (#5020) — one structured log line per country-pricing incident, so the
 * Worker's logs tell the four kinds apart instead of folding them into a 409 or
 * a 200: a recommendation that could not be calculated, a market whose data is
 * incomplete, a stale revision that lost, and a branch push that did not land
 * after HQ committed.
 *
 * `console.warn` is what `wrangler tail` and the tail consumer read; the line
 * carries ids and codes only, never a person's name, email or a figure.
 */
export const INCIDENT_KINDS = [
  'recommendation_calculation_failed',
  'market_data_incomplete',
  'stale_revision_conflict',
  'branch_push_partial',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** The PricingError codes that mean "someone else's write landed first". */
export const STALE_CODES = new Set(['terms_conflict', 'basis_conflict', 'review_conflict', 'profile_conflict', 'snapshot_stale', 'pricing_basis_stale']);

export function pricingIncident(kind: IncidentKind, detail: Record<string, string | number | boolean | null | string[]>): void {
  try {
    console.warn(JSON.stringify({ event: 'country_pricing_incident', kind, ...detail }));
  } catch { /* logging never fails a request */ }
}
