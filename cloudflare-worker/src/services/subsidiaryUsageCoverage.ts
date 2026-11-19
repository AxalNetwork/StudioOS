/**
 * How far HQ's usage-report ledger answers "revenue per subsidiary" (D456).
 *
 * `subsidiary_usage_reports` holds what each branch SAID about a quarter — not
 * a revenue total HQ can sum. Since D5947 a branch reports a measured figure
 * for a stream its own database can total (subscriptions, from its financial
 * ledger) and NULL with a state for the rest; a branch receiving no Stripe
 * webhooks still reports every stream unmeasured. This read names, per
 * licence, whether the quarter was reported and WHICH streams carried a
 * measurable amount, with each stream's state, source and as-of time — never
 * a total, and never an amount added across streams or currencies.
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
  /** D5947 — the streams that carried an amount, by name. */
  measurable_streams: string[];
  /** D5947 — every reported stream with what the branch said about it. No amount: this is coverage. */
  streams: UsageStreamCoverage[];
  reported_at: string | null;
};

export type UsageStreamCoverage = {
  stream: string;
  measurable: boolean;
  /** The figure's own currency; meaningless when `measurable` is false. */
  currency: string;
  /** NULL when a build before D5947 reported the row (migration 202611161359). */
  state: string | null;
  reason: string | null;
  source: string | null;
  source_as_of: string | null;
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

/** Kept, word for word, for a period in which no licence reported a measurable stream (D266). */
export const REVENUE_PER_SUBSIDIARY_REASON =
  'Each branch reports its quarter to HQ every morning (D266), and every stream in that report '
  + 'arrives unmeasured: branch databases record no revenue amounts, so there is no figure to total '
  + 'or show per subsidiary.';

/** D5947 — once any licence reported a measured stream, the sentence above is no longer true. */
export const REVENUE_PER_SUBSIDIARY_PARTLY_MEASURED_REASON =
  'Each branch reports its quarter to HQ every morning (D266). A stream is measured only where the '
  + 'branch\'s own database records amounts (subscriptions, from its financial ledger, D5947); each '
  + 'licence names the streams that were, and the rest arrive unmeasured. No figure is totalled across '
  + 'streams, subsidiaries or currencies.';

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

    // `*`, not a column list: the D5947 columns are read when the migration has run and are
    // NULL (a pre-D5947 report) when it has not, rather than failing the whole coverage read.
    const reports = await env.DB.prepare(
      `SELECT * FROM subsidiary_usage_reports WHERE period = ? ORDER BY licence_uid, stream`,
    ).bind(period).all<{
      licence_uid: string; stream: string; gross_cents: number | null; currency: string | null; reported_at: string;
      state?: string | null; reason?: string | null; source?: string | null; source_as_of?: string | null;
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
      const streams: UsageStreamCoverage[] = rows.map((r) => ({
        stream: String(r.stream),
        measurable: r.gross_cents !== null,
        currency: String(r.currency ?? ''),
        state: r.state ?? null,
        reason: r.reason ?? null,
        source: r.source ?? null,
        source_as_of: r.source_as_of ?? null,
      }));
      const measurableStreams = streams.filter((x) => x.measurable).map((x) => x.stream);
      const streamsMeasurable = measurableStreams.length;
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
        measurable_streams: measurableStreams,
        streams,
        reported_at: reportedAt,
      };
    });

    return {
      available: true,
      period,
      by_licence,
      revenue_reason: by_licence.some((l) => l.streams_measurable > 0)
        ? REVENUE_PER_SUBSIDIARY_PARTLY_MEASURED_REASON
        : REVENUE_PER_SUBSIDIARY_REASON,
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
  // D5947: this licence measured something, so "every stream arrived unmeasured" would be false here.
  const rest = row.streams_reported > row.streams_measurable ? '; the other streams arrived unmeasured' : '';
  return `Report received for ${coverage.period}; measured: ${row.measurable_streams.join(', ')}. `
    + `Each figure is in its own currency and none is totalled${rest}.`;
}
