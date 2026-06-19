/**
 * Task #9 — Venture Risk scoring service.
 *
 * The 10-layer Venture Risk rating system. Each company is rated across ten
 * risk layers — Founder, Market, Competition, Timing, Financing, Marketing,
 * Distribution, Technology, Product, Hiring — each with a "what investors must
 * believe" thesis and a "proof signal".
 *
 * Scoring is HYBRID:
 *   - an AUTO score per layer, computed live from existing platform data
 *     (the latest non-sandbox score_snapshot sub-scores + the project row), and
 *   - an ANALYST override/annotation persisted in `venture_risk_overrides`
 *     (one row per project_id+layer_key; see migration 114).
 *
 * Scores are a 0..100 "de-risk confidence": HIGHER = more proof = LOWER risk.
 * The risk BAND inverts that — a high score is a LOW risk band:
 *   score >= 67 → low (emerald), >= 34 → medium (amber), else high (red).
 *
 * This module is the aggregation layer: it unifies signals the platform already
 * computes (services/scoring.ts sub-scores) into the 10-layer framework. The
 * DB-touching functions take `Env`; the scoring helpers are pure so they can be
 * unit-tested without auth/D1.
 */
import type { Env } from '../types';

export type LayerKey =
  | 'founder'
  | 'market'
  | 'competition'
  | 'timing'
  | 'financing'
  | 'marketing'
  | 'distribution'
  | 'technology'
  | 'product'
  | 'hiring';

export type RiskBand = 'low' | 'medium' | 'high';
export type BandColor = 'emerald' | 'amber' | 'red';

export type LayerMeta = {
  key: LayerKey;
  label: string;
  /** What investors must believe for this layer to be de-risked. */
  thesis: string;
  /** The proof signal that retires the risk. */
  proof_signal: string;
};

export const LAYERS: readonly LayerMeta[] = [
  {
    key: 'founder',
    label: 'Founder Risk',
    thesis: 'This team can actually execute on this specific opportunity.',
    proof_signal: 'Domain expertise, prior execution, founder-market fit.',
  },
  {
    key: 'market',
    label: 'Market Risk',
    thesis: 'Enough customers have this problem and will pay to solve it.',
    proof_signal: 'Validated demand, paying customers, observable market pull.',
  },
  {
    key: 'competition',
    label: 'Competition Risk',
    thesis: 'We can win and keep customers despite the alternatives.',
    proof_signal: 'Differentiation, defensibility, switching costs.',
  },
  {
    key: 'timing',
    label: 'Timing Risk',
    thesis: 'The market is ready for this now, not in five years.',
    proof_signal: 'Behavior shifts, enabling technology, momentum.',
  },
  {
    key: 'financing',
    label: 'Financing Risk',
    thesis: 'We can raise enough capital to reach the next milestone.',
    proof_signal: 'Runway, capital efficiency, a credible funding strategy.',
  },
  {
    key: 'marketing',
    label: 'Marketing Risk',
    thesis: 'We can repeatedly generate demand at an acceptable cost.',
    proof_signal: 'Repeatable acquisition, efficient CAC, growth signals.',
  },
  {
    key: 'distribution',
    label: 'Distribution Risk',
    thesis: 'We can reach customers at scale through viable channels.',
    proof_signal: 'Channels, partnerships, a working go-to-market motion.',
  },
  {
    key: 'technology',
    label: 'Technology Risk',
    thesis: 'The product can actually be built and will scale.',
    proof_signal: 'Technical feasibility, performance, engineering capability.',
  },
  {
    key: 'product',
    label: 'Product Risk',
    thesis: 'Users genuinely want — and keep using — what we build.',
    proof_signal: 'Retention, engagement, usage growth.',
  },
  {
    key: 'hiring',
    label: 'Hiring Risk',
    thesis: 'We can attract and retain the team needed to scale.',
    proof_signal: 'Talent density, hiring track record, leadership depth.',
  },
];

export const LAYER_KEYS: readonly LayerKey[] = LAYERS.map((l) => l.key);

export function isLayerKey(v: unknown): v is LayerKey {
  return typeof v === 'string' && (LAYER_KEYS as readonly string[]).includes(v);
}

// Band thresholds (de-risk confidence → risk band).
export const LOW_RISK_MIN = 67; // score >= 67 → low risk
export const MED_RISK_MIN = 34; // score >= 34 → medium risk

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function r1(n: number): number {
  return Math.round(clampScore(n) * 10) / 10;
}

export function scoreToBand(score: number): RiskBand {
  const s = clampScore(score);
  if (s >= LOW_RISK_MIN) return 'low';
  if (s >= MED_RISK_MIN) return 'medium';
  return 'high';
}

export function bandColor(band: RiskBand): BandColor {
  return band === 'low' ? 'emerald' : band === 'medium' ? 'amber' : 'red';
}

/** Descending-threshold lookup: first band whose threshold is met wins. */
export function bandScore(value: number, bands: Array<[number, number]>, fallback = 0): number {
  for (const [threshold, points] of bands) if (value >= threshold) return points;
  return fallback;
}

/** Normalize a bounded sub-score to a 0..100 percentage of its max. */
function pct(value: number | null | undefined, max: number): number {
  if (value == null || !Number.isFinite(value) || max <= 0) return 0;
  return clampScore((value / max) * 100);
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// score_snapshots sub-score denominators mirror services/scoring.ts:
//   market/25 · team/20 · product/15 · capital/15 · fit/15 · distribution/10.

export type SnapshotInputs = {
  market_total?: number | null;
  team_total?: number | null;
  product_total?: number | null;
  capital_total?: number | null;
  fit_total?: number | null;
  distribution_total?: number | null;
  market_trend?: number | null;
  market_urgency?: number | null;
};

export type ProjectInputs = {
  revenue?: number | null;
  users_count?: number | null;
  growth_signals?: string | null;
  why_now?: string | null;
  funding_needed?: number | null;
  total_funding?: number | null;
  cost_to_mvp?: number | null;
  employee_count?: string | null;
};

export type RiskInputs = {
  snapshot: SnapshotInputs | null;
  project: ProjectInputs | null;
};

export type AutoLayer = {
  /** 0..100 de-risk confidence (higher = lower risk). */
  score: number;
  /** False when no platform signal feeds this layer yet. */
  has_data: boolean;
  /** Human-readable descriptions of the signals that fed the score. */
  signals: string[];
};

/** Parse a leading integer out of the free-text employee_count (e.g. "11-50"). */
export function parseHeadcount(v: string | null | undefined): number | null {
  if (v == null) return null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * Compute the auto score for all 10 layers from current platform data. Pure:
 * deterministic in its inputs, no I/O. Layers with no feeding signal report
 * `has_data: false` and a score of 0 (explicit "unknown", not a silent guess).
 */
export function computeAutoLayers(inputs: RiskInputs): Record<LayerKey, AutoLayer> {
  const snap = inputs.snapshot;
  const proj = inputs.project;
  const hasSnap = !!snap;
  const hasText = (v: string | null | undefined) => !!(v && v.trim().length > 0);
  const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : 0);

  // Founder — execution capacity from the team sub-score (/20).
  const founderSignals: string[] = [];
  let founder = 0;
  if (hasSnap) {
    founder = pct(snap!.team_total, 20);
    founderSignals.push('Team execution sub-score');
  }

  // Market — validated demand from the market sub-score (/25) + paying revenue.
  const marketSignals: string[] = [];
  let market = 0;
  if (hasSnap) {
    market = pct(snap!.market_total, 25);
    marketSignals.push('Market sub-score');
  }
  if (num(proj?.revenue) > 0) {
    market = clampScore(Math.max(market, 50) + 10);
    marketSignals.push('Paying revenue');
  }
  const marketHas = hasSnap || num(proj?.revenue) > 0;

  // Competition — differentiation / moat from the fit sub-score (/15).
  const competitionSignals: string[] = [];
  let competition = 0;
  if (hasSnap) {
    competition = pct(snap!.fit_total, 15);
    competitionSignals.push('Fit & moat sub-score');
  }

  // Timing — market trend (/5) + urgency (/10) + an explicit why-now.
  const timingSignals: string[] = [];
  let timing = 0;
  let timingHas = false;
  if (hasSnap) {
    timing = (pct(snap!.market_trend, 5) + pct(snap!.market_urgency, 10)) / 2;
    timingHas = true;
    timingSignals.push('Market trend & urgency');
  }
  if (hasText(proj?.why_now)) {
    timing = clampScore(timing + 15);
    timingHas = true;
    timingSignals.push('Why-now narrative');
  }

  // Financing — capital efficiency from the capital sub-score (/15).
  const financingSignals: string[] = [];
  let financing = 0;
  if (hasSnap) {
    financing = pct(snap!.capital_total, 15);
    financingSignals.push('Capital sub-score');
  }

  // Marketing — repeatable demand gen: urgency pull + growth signals.
  const marketingSignals: string[] = [];
  let marketing = 0;
  let marketingHas = false;
  if (hasSnap) {
    marketing = pct(snap!.market_urgency, 10);
    marketingHas = true;
    marketingSignals.push('Market urgency');
  }
  if (hasText(proj?.growth_signals)) {
    marketing = clampScore(Math.max(marketing, 40) + 20);
    marketingHas = true;
    marketingSignals.push('Growth signals');
  }

  // Distribution — channels / virality from the distribution sub-score (/10).
  const distributionSignals: string[] = [];
  let distribution = 0;
  if (hasSnap) {
    distribution = pct(snap!.distribution_total, 10);
    distributionSignals.push('Distribution sub-score');
  }

  // Technology — buildability from the product/tech sub-score (/15).
  const technologySignals: string[] = [];
  let technology = 0;
  if (hasSnap) {
    technology = pct(snap!.product_total, 15);
    technologySignals.push('Product/tech sub-score');
  }

  // Product — real usage: active users + revenue + growth signals.
  const productSignals: string[] = [];
  const userPts = bandScore(num(proj?.users_count), [
    [10000, 100],
    [1000, 80],
    [100, 55],
    [10, 30],
  ], num(proj?.users_count) > 0 ? 15 : 0);
  const revPts = bandScore(num(proj?.revenue), [
    [50000, 100],
    [10000, 80],
    [1000, 55],
    [100, 30],
  ], num(proj?.revenue) > 0 ? 15 : 0);
  const productHas =
    proj != null && (num(proj.users_count) > 0 || num(proj.revenue) > 0 || hasText(proj.growth_signals));
  let product = 0;
  if (productHas) {
    const parts: number[] = [];
    if (num(proj?.users_count) > 0) {
      parts.push(userPts);
      productSignals.push('Active users');
    }
    if (num(proj?.revenue) > 0) {
      parts.push(revPts);
      productSignals.push('Revenue');
    }
    if (hasText(proj?.growth_signals)) {
      parts.push(60);
      productSignals.push('Growth signals');
    }
    product = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  }

  // Hiring — ability to scale the team: headcount + team sub-score.
  const hiringSignals: string[] = [];
  const headcount = parseHeadcount(proj?.employee_count);
  const hiringHas = hasSnap || headcount != null;
  let hiring = 0;
  {
    const parts: number[] = [];
    if (hasSnap) {
      parts.push(pct(snap!.team_total, 20));
      hiringSignals.push('Team sub-score');
    }
    if (headcount != null) {
      parts.push(
        bandScore(headcount, [
          [50, 100],
          [20, 80],
          [10, 60],
          [3, 40],
        ], headcount > 0 ? 25 : 10),
      );
      hiringSignals.push('Headcount');
    }
    hiring = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  }

  const mk = (score: number, has: boolean, signals: string[]): AutoLayer => ({
    score: r1(score),
    has_data: has,
    signals,
  });

  return {
    founder: mk(founder, hasSnap, founderSignals),
    market: mk(market, marketHas, marketSignals),
    competition: mk(competition, hasSnap, competitionSignals),
    timing: mk(timing, timingHas, timingSignals),
    financing: mk(financing, hasSnap, financingSignals),
    marketing: mk(marketing, marketingHas, marketingSignals),
    distribution: mk(distribution, hasSnap, distributionSignals),
    technology: mk(technology, hasSnap, technologySignals),
    product: mk(product, productHas, productSignals),
    hiring: mk(hiring, hiringHas, hiringSignals),
  };
}

// ── Analyst overrides + merge ────────────────────────────────────────────────

export type OverrideInput = {
  layer_key: LayerKey;
  analyst_score?: number | null;
  analyst_band?: RiskBand | null;
  analyst_note?: string | null;
  status?: string | null;
  updated_by?: number | null;
  updated_at?: string | null;
};

export type MergedLayer = LayerMeta & {
  auto_score: number;
  auto_band: RiskBand;
  auto_has_data: boolean;
  analyst_score: number | null;
  analyst_band: RiskBand | null;
  analyst_note: string | null;
  status: string | null;
  /** Effective score = analyst override when present, else auto. */
  score: number;
  band: RiskBand;
  color: BandColor;
  is_overridden: boolean;
  signals: string[];
  updated_by: number | null;
  updated_at: string | null;
};

/** Merge the auto layers with analyst overrides (override wins). Pure. */
export function mergeLayers(
  auto: Record<LayerKey, AutoLayer>,
  overrides: Map<LayerKey, OverrideInput>,
): MergedLayer[] {
  return LAYERS.map((meta) => {
    const a = auto[meta.key];
    const o = overrides.get(meta.key) ?? null;
    const autoBand = scoreToBand(a.score);
    const hasScoreOverride = o != null && o.analyst_score != null && Number.isFinite(o.analyst_score);
    const analystScore = hasScoreOverride ? clampScore(o!.analyst_score as number) : null;
    const effectiveScore = analystScore != null ? analystScore : a.score;
    const effectiveBand: RiskBand = o?.analyst_band
      ? o.analyst_band
      : analystScore != null
        ? scoreToBand(analystScore)
        : autoBand;
    const isOverridden =
      !!o &&
      (hasScoreOverride ||
        o.analyst_band != null ||
        (o.analyst_note != null && o.analyst_note !== '') ||
        (o.status != null && o.status !== '' && o.status !== 'open'));
    return {
      ...meta,
      auto_score: a.score,
      auto_band: autoBand,
      auto_has_data: a.has_data,
      analyst_score: analystScore,
      analyst_band: o?.analyst_band ?? null,
      analyst_note: o?.analyst_note ?? null,
      status: o?.status ?? null,
      score: r1(effectiveScore),
      band: effectiveBand,
      color: bandColor(effectiveBand),
      is_overridden: isOverridden,
      signals: a.signals,
      updated_by: o?.updated_by ?? null,
      updated_at: o?.updated_at ?? null,
    };
  });
}

/** Overall de-risking score = mean of the effective per-layer scores. Pure. */
export function overallFromLayers(
  layers: MergedLayer[],
): { score: number; band: RiskBand; color: BandColor } {
  if (!layers.length) {
    const band = scoreToBand(0);
    return { score: 0, band, color: bandColor(band) };
  }
  const mean = layers.reduce((acc, l) => acc + l.score, 0) / layers.length;
  const score = Math.round(mean * 10) / 10;
  const band = scoreToBand(score);
  return { score, band, color: bandColor(band) };
}

// ── DB access ─────────────────────────────────────────────────────────────────

export interface ProjectRow extends ProjectInputs {
  id: number;
  name: string;
  sector: string | null;
  stage: string | null;
}

type OverrideRow = {
  layer_key: string;
  analyst_score: number | null;
  analyst_band: string | null;
  analyst_note: string | null;
  status: string | null;
  updated_by: number | null;
  updated_at: string | null;
};

const PROJECT_COLUMNS =
  'id, name, sector, stage, revenue, users_count, growth_signals, why_now, ' +
  'funding_needed, total_funding, cost_to_mvp, employee_count';

export async function loadProject(env: Env, projectId: number): Promise<ProjectRow | null> {
  return env.DB.prepare(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(projectId)
    .first<ProjectRow>()
    .catch(() => null);
}

export async function loadSnapshot(env: Env, projectId: number): Promise<SnapshotInputs | null> {
  return env.DB.prepare(
    `SELECT market_total, team_total, product_total, capital_total, fit_total,
            distribution_total, market_trend, market_urgency
       FROM score_snapshots
      WHERE project_id = ? AND is_sandbox = 0
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<SnapshotInputs>()
    .catch(() => null);
}

export async function loadOverrides(env: Env, projectId: number): Promise<Map<LayerKey, OverrideInput>> {
  const res = await env.DB.prepare(
    `SELECT layer_key, analyst_score, analyst_band, analyst_note, status, updated_by, updated_at
       FROM venture_risk_overrides WHERE project_id = ?`,
  )
    .bind(projectId)
    .all<OverrideRow>()
    .catch(() => null);
  const map = new Map<LayerKey, OverrideInput>();
  for (const row of res?.results ?? []) {
    if (!isLayerKey(row.layer_key)) continue;
    const band = row.analyst_band;
    map.set(row.layer_key, {
      layer_key: row.layer_key,
      analyst_score: row.analyst_score,
      analyst_band: band === 'low' || band === 'medium' || band === 'high' ? band : null,
      analyst_note: row.analyst_note,
      status: row.status,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    });
  }
  return map;
}

export async function upsertOverride(
  env: Env,
  projectId: number,
  layerKey: LayerKey,
  body: {
    analyst_score?: number | null;
    analyst_band?: RiskBand | null;
    analyst_note?: string | null;
    status?: string | null;
  },
  userId: number | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO venture_risk_overrides
       (project_id, layer_key, analyst_score, analyst_band, analyst_note, status, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(project_id, layer_key) DO UPDATE SET
       analyst_score = excluded.analyst_score,
       analyst_band  = excluded.analyst_band,
       analyst_note  = excluded.analyst_note,
       status        = excluded.status,
       updated_by    = excluded.updated_by,
       updated_at    = datetime('now')`,
  )
    .bind(
      projectId,
      layerKey,
      body.analyst_score ?? null,
      body.analyst_band ?? null,
      body.analyst_note ?? null,
      body.status ?? 'open',
      userId,
    )
    .run();
}

export async function deleteOverride(env: Env, projectId: number, layerKey: LayerKey): Promise<void> {
  await env.DB.prepare('DELETE FROM venture_risk_overrides WHERE project_id = ? AND layer_key = ?')
    .bind(projectId, layerKey)
    .run();
}

// ── Assembled views ──────────────────────────────────────────────────────────

export type Assessment = {
  project_id: number;
  project_name: string;
  overall_score: number;
  overall_band: RiskBand;
  overall_color: BandColor;
  layers: MergedLayer[];
  computed_at: string;
};

export async function buildAssessment(env: Env, projectId: number): Promise<Assessment | null> {
  const project = await loadProject(env, projectId);
  if (!project) return null;
  const [snapshot, overrides] = await Promise.all([
    loadSnapshot(env, projectId),
    loadOverrides(env, projectId),
  ]);
  const layers = mergeLayers(computeAutoLayers({ snapshot, project }), overrides);
  const overall = overallFromLayers(layers);
  return {
    project_id: projectId,
    project_name: project.name ?? '',
    overall_score: overall.score,
    overall_band: overall.band,
    overall_color: overall.color,
    layers,
    computed_at: new Date().toISOString(),
  };
}

export type MatrixCellLayer = {
  score: number;
  band: RiskBand;
  color: BandColor;
  is_overridden: boolean;
  has_data: boolean;
};

export type MatrixRow = {
  project_id: number;
  name: string;
  sector: string | null;
  stage: string | null;
  overall_score: number;
  overall_band: RiskBand;
  overall_color: BandColor;
  layers: Record<LayerKey, MatrixCellLayer>;
};

export async function buildMatrix(env: Env, limit = 200): Promise<MatrixRow[]> {
  const res = await env.DB.prepare(
    `SELECT ${PROJECT_COLUMNS} FROM projects
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<ProjectRow>()
    .catch(() => null);
  const projects = res?.results ?? [];
  const rows: MatrixRow[] = [];
  for (const p of projects) {
    const [snapshot, overrides] = await Promise.all([
      loadSnapshot(env, p.id),
      loadOverrides(env, p.id),
    ]);
    const auto = computeAutoLayers({ snapshot, project: p });
    const merged = mergeLayers(auto, overrides);
    const overall = overallFromLayers(merged);
    const layerMap = {} as Record<LayerKey, MatrixCellLayer>;
    for (const l of merged) {
      layerMap[l.key] = {
        score: l.score,
        band: l.band,
        color: l.color,
        is_overridden: l.is_overridden,
        has_data: l.auto_has_data || l.is_overridden,
      };
    }
    rows.push({
      project_id: p.id,
      name: p.name ?? '',
      sector: p.sector ?? null,
      stage: p.stage ?? null,
      overall_score: overall.score,
      overall_band: overall.band,
      overall_color: overall.color,
      layers: layerMap,
    });
  }
  return rows;
}
