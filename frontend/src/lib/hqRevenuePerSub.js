/**
 * Per-subsidiary revenue on HQ — reported vs measurable, never a total (D456).
 * Mirrors `services/subsidiaryUsageCoverage.ts` on the client.
 */

export const REVENUE_PER_SUBSIDIARY_FALLBACK =
  'Each branch reports its quarter to HQ every morning (D266), and every stream in that report '
  + 'arrives unmeasured: branch databases record no revenue amounts, so there is no figure to show.';

/** @param {import('../lib/api').unknown} coverage @param {string} licenceUid */
export function revenueAbsenceForLicence(coverage, licenceUid) {
  if (!coverage) return REVENUE_PER_SUBSIDIARY_FALLBACK;
  if (!coverage.available) return coverage.reason || REVENUE_PER_SUBSIDIARY_FALLBACK;
  const row = (coverage.by_licence || []).find((x) => x.licence_uid === licenceUid);
  if (!row) return coverage.revenue_reason || REVENUE_PER_SUBSIDIARY_FALLBACK;
  if (!row.reported) {
    return `This subsidiary has not reported ${coverage.period} to HQ yet, so there is no revenue figure to show.`;
  }
  if (!row.streams_measurable) {
    return `Report received for ${coverage.period}; every stream arrived unmeasured, because this branch's database records no revenue amounts.`;
  }
  return coverage.revenue_reason || REVENUE_PER_SUBSIDIARY_FALLBACK;
}

/** Human label for the usage-coverage table — not a currency amount. */
export function usageCoverageLabel(row, period) {
  if (!row.reported) return `Not reported for ${period}`;
  if (!row.streams_measurable) return `Reported · all streams unmeasured`;
  return `Reported · ${row.streams_measurable} measurable stream${row.streams_measurable === 1 ? '' : 's'}`;
}
