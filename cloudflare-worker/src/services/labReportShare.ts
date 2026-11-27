/**
 * D588 — what a scoring-report share link may show.
 *
 * Pure. The route freezes an official run into `snapshot_json` and calls
 * `redactLabReport` on the way out, so a narrower audience never receives
 * the dimension scores, and neither audience receives the raw inputs, the
 * notes, or who scored it.
 */

export const LAB_REPORT_KIND = 'scoring';

export const LAB_SHARE_AUDIENCES = ['summary', 'dimensions'] as const;
export type LabShareAudience = (typeof LAB_SHARE_AUDIENCES)[number];

export const LAB_SHARE_SCOPE: Record<LabShareAudience, { shows: string; hides: string }> = {
  summary: {
    shows: 'The latest official total score and its tier.',
    hides: 'Dimension scores, the inputs behind them, notes, and who scored it.',
  },
  dimensions: {
    shows: 'The latest official total, its tier, and the six dimension scores.',
    hides: 'The raw inputs, notes, and who scored it.',
  },
};

const DIMENSION_KEYS = [
  'market_size', 'market_urgency', 'market_trend', 'market_total',
  'team_expertise', 'team_execution', 'team_network', 'team_total',
  'product_mvp_time', 'product_complexity', 'product_dependency', 'product_total',
  'capital_cost_mvp', 'capital_time_revenue', 'capital_burn_traction', 'capital_total',
  'fit_alignment', 'fit_synergy', 'fit_total',
  'distribution_channels', 'distribution_virality', 'distribution_total',
] as const;

export type LabReportSnapshot = {
  total_score: number;
  tier: string;
  scored_at: string;
  dimensions: Record<string, number>;
};

export function isLabShareAudience(v: unknown): v is LabShareAudience {
  return v === 'summary' || v === 'dimensions';
}

/** The columns a share may freeze. Anything else on the row stays out. */
export function freezeOfficialScore(row: Record<string, unknown>): LabReportSnapshot {
  const dimensions: Record<string, number> = {};
  for (const key of DIMENSION_KEYS) {
    const n = Number(row[key]);
    if (Number.isFinite(n)) dimensions[key] = n;
  }
  return {
    total_score: Number(row.total_score),
    tier: String(row.tier ?? ''),
    scored_at: String(row.created_at ?? ''),
    dimensions,
  };
}

export function redactLabReport(snapshot: LabReportSnapshot, audience: LabShareAudience) {
  const scope = LAB_SHARE_SCOPE[audience];
  const body: Record<string, unknown> = {
    report_kind: LAB_REPORT_KIND,
    audience,
    shows: scope.shows,
    hides: scope.hides,
    total_score: snapshot.total_score,
    tier: snapshot.tier,
    scored_at: snapshot.scored_at,
  };
  if (audience === 'dimensions') body.dimensions = snapshot.dimensions;
  return body;
}
