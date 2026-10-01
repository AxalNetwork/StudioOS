/**
 * How far HQ's usage-report ledger answers "revenue per subsidiary" (D456).
 *
 * `subsidiary_usage_reports` holds what each branch SAID about a quarter — not
 * a revenue total HQ can sum. Every stream today arrives with `gross_cents`
 * null (D266), and reporting "unmeasurable" is a truer state than "not
 * reported". This read names, per licence, whether the current quarter was
 * reported and whether any stream carried a measurable amount — never a total.
 */
import type { Env } from '../types';
import { quarterKey } from './statements';

export type LicenceUsageCoverage = {
  licence_uid: string;
  licence_ref: string;
  brand_name: string;
  /** True when at least one stream row exists for the period. */
  reported: boolean;
  streams_reported: number;
  streams_measurable: number;
  reported_at: string | null;
};

export type SubsidiaryUsageCoverage =
  | {
    available: true;
    period: string;
    by_licence: LicenceUsageCoverage[];
    /** Said once so every consumer uses the same sentence. */
    revenue_reason: string;
  }
  | { available: false; reason: string };

export const REVENUE_PER_SUBSIDIARY_REASON =
  'Each branch reports its quarter to HQ every morning (D266), and every stream in that report '
  + 'arrives unmeasured: branch databases record no revenue amounts, so there is no figure to total '
  + 'or show per subsidiary.';

/** MTD at platform scope inherits the same absence — nothing attributes spend to a licence. */
export const MTD_REVENUE_REASON =
  'Month-to-date revenue per subsidiary is not recorded on HQ: branches report quarters, not MTD, '
  + 'and every reported stream arrives unmeasured (D266).';

/**
 * Coverage for one calendar quarter (`YYYY-Qn`). Defaults to the quarter `now`
 * falls in — the same grain statements draw on.
 */
export async function subsidiaryUsageCoverage(
  env: Env,
  now: Date = new Date(),
): Promise<SubsidiaryUsageCoverage> {
  const period = quarterKey(now);
  try {
    const licences = await env.DB.prepare(
      `SELECT uid, licence_ref, brand_name FROM territory_licences
        WHERE status != 'terminated'
        ORDER BY licence_ref`,
    ).all<{ uid: string; licence_ref: string; brand_name: string }>();

    const reports = await env.DB.prepare(
      `SELECT licence_uid, stream, gross_cents, reported_at
         FROM subsidiary_usage_reports
        WHERE period = ?`,
    ).bind(period).all<{
      licence_uid: string; stream: string; gross_cents: number | null; reported_at: string;
    }>();

    const byLicence = new Map<string, typeof reports.results>();
    for (const row of reports.results || []) {
      const uid = String(row.licence_uid);
      const list = byLicence.get(uid) || [];
      list.push(row);
      byLicence.set(uid, list);
    }

    const by_licence: LicenceUsageCoverage[] = (licences.results || []).map((l) => {
      const rows = byLicence.get(String(l.uid)) || [];
      const streamsReported = rows.length;
      const streamsMeasurable = rows.filter((r) => r.gross_cents !== null).length;
      const reportedAt = rows.length
        ? rows.map((r) => r.reported_at).sort().slice(-1)[0]
        : null;
      return {
        licence_uid: String(l.uid),
        licence_ref: String(l.licence_ref),
        brand_name: String(l.brand_name),
        reported: streamsReported > 0,
        streams_reported: streamsReported,
        streams_measurable: streamsMeasurable,
        reported_at: reportedAt,
      };
    });

    return {
      available: true,
      period,
      by_licence,
      revenue_reason: REVENUE_PER_SUBSIDIARY_REASON,
    };
  } catch {
    return {
      available: false,
      reason: 'The subsidiary usage report ledger could not be read (migration 260).',
    };
  }
}

/** One licence's row from a loaded coverage payload, or null. */
export function usageForLicence(
  coverage: SubsidiaryUsageCoverage | null | undefined,
  licenceUid: string,
): LicenceUsageCoverage | null {
  if (!coverage || !coverage.available) return null;
  return coverage.by_licence.find((x) => x.licence_uid === licenceUid) || null;
}

/** The sentence a subsidiary card should show for revenue — never a number. */
export function revenueAbsenceReason(
  coverage: SubsidiaryUsageCoverage | null | undefined,
  licenceUid: string,
): string {
  if (!coverage) return REVENUE_PER_SUBSIDIARY_REASON;
  if (!coverage.available) return coverage.reason;
  const row = usageForLicence(coverage, licenceUid);
  if (!row) return REVENUE_PER_SUBSIDIARY_REASON;
  if (!row.reported) {
    return `This subsidiary has not reported ${coverage.period} to HQ yet, so there is no revenue figure to show.`;
  }
  if (row.streams_measurable === 0) {
    return `Report received for ${coverage.period}; every stream arrived unmeasured, because this branch's database records no revenue amounts.`;
  }
  return REVENUE_PER_SUBSIDIARY_REASON;
}
