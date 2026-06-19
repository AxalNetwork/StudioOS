// Venture Risk Rating — the "10 Layers of Venture Risk" scoring engine.
//
// Hybrid model: an AUTO pass derives proof signals from existing platform data
// (projects, score_snapshots, founder_risk_pulls, metrics_snapshots, deals,
// market_intel_indexes, discovery_interviews, documents, rounds), then the
// route merges sticky per-layer ANALYST overrides over the result.
//
// Convention (matches founder_risk_profiles): per-layer `risk` is 0..100 where
// LOWER = safer. Bands: low 0-33 · medium 34-66 · high 67-100. The aggregate
// `derisk_score` = 100 - overall_risk (higher = more derisked), which is what
// the UI gauge shows under the "every funding round removes risk" framing.
import type { Env } from '../types';

export type SignalStatus = 'met' | 'partial' | 'missing' | 'unknown';

export interface ProofSignal {
  key: string;
  label: string;
  status: SignalStatus;
  value: string | null; // human-readable evidence value (e.g. "$120k", "62%")
  weight: number;
  evidence: string; // one-line explanation of where the signal came from
}

export interface RiskLayer {
  key: string;
  label: string;
  belief: string; // "Investors must believe…"
  proof: string; // the proof-signal headline from the framework
  risk: number; // 0..100, lower = safer (post-override)
  band: 'low' | 'medium' | 'high';
  confidence: number; // 0..100 — share of signal weight backed by real data
  status: 'open' | 'mitigating' | 'cleared';
  overridden: boolean;
  override?: {
    band: string | null;
    score: number | null;
    status: string;
    note: string | null;
    owner_user_id: number | null;
    updated_at: string | null;
  } | null;
  rationale: string;
  signals: ProofSignal[];
}

export interface VentureRiskAssessment {
  project_id: number;
  project_name: string;
  stage: string;
  overall_risk: number;
  overall_band: 'low' | 'medium' | 'high';
  derisk_score: number;
  derisk_pct: number;
  layers: RiskLayer[];
  source: 'auto' | 'analyst';
  saved: boolean;
  computed_at: string | null;
}

// Layer metadata — fixed order matches the framework infographic (1..10).
export const LAYERS: Array<{ key: string; label: string; belief: string; proof: string }> = [
  { key: 'founder',      label: 'Founder Risk',      belief: 'This team can execute.',                     proof: 'Domain expertise, execution history, founder–market fit.' },
  { key: 'market',       label: 'Market Risk',       belief: 'Customers will pay for this solution.',      proof: 'Validated demand, paying customers, market pull.' },
  { key: 'competition',  label: 'Competition Risk',  belief: 'The company can win despite alternatives.',  proof: 'Differentiation, defensibility, switching costs.' },
  { key: 'timing',       label: 'Timing Risk',       belief: 'The market is ready right now.',             proof: 'Behavior shifts, technology adoption, market momentum.' },
  { key: 'financing',    label: 'Financing Risk',    belief: 'The company can reach the next milestone.',  proof: 'Strong runway, capital efficiency, funding strategy.' },
  { key: 'marketing',    label: 'Marketing Risk',    belief: 'Demand can be generated repeatably.',        proof: 'Repeatable acquisition channels, efficient CAC.' },
  { key: 'distribution', label: 'Distribution Risk', belief: 'Customers can be reached at scale.',         proof: 'Partnerships, channels, scalable go-to-market.' },
  { key: 'technology',   label: 'Technology Risk',   belief: 'The solution can actually be built.',        proof: 'Technical feasibility, product performance, engineering capability.' },
  { key: 'product',      label: 'Product Risk',      belief: 'Users genuinely want the product.',          proof: 'Retention, engagement, usage growth.' },
  { key: 'hiring',       label: 'Hiring Risk',       belief: 'The team can scale with the company.',       proof: 'Talent density, hiring track record, leadership depth.' },
];

// Overall-aggregation weight per layer, tilted by company stage. Per-signal
// weights (inside each layer) are separate and live with the signal.
const LAYER_WEIGHTS: Record<'early' | 'growth', Record<string, number>> = {
  early:  { founder: 1.4, market: 1.3, product: 1.2, timing: 1.1, technology: 1.0, competition: 0.9, financing: 0.9, marketing: 0.8, distribution: 0.7, hiring: 0.7 },
  growth: { distribution: 1.3, hiring: 1.2, financing: 1.2, marketing: 1.2, market: 1.1, product: 1.0, competition: 1.0, founder: 0.9, technology: 0.8, timing: 0.7 },
};

function stageBucket(stage: string | null | undefined): 'early' | 'growth' {
  const s = String(stage || '').toLowerCase();
  if (['series_a', 'series_b', 'series_c', 'growth', 'later', 'active'].includes(s)) return 'growth';
  return 'early';
}

export function bandFromScore(score: number): 'low' | 'medium' | 'high' {
  if (score <= 33) return 'low';
  if (score <= 66) return 'medium';
  return 'high';
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function sig(key: string, label: string, status: SignalStatus, value: string | null, weight: number, evidence: string): ProofSignal {
  return { key, label, status, value, weight, evidence };
}

// Met/partial/missing from a free-text project field that always exists but may
// be blank — blank means "looked, not articulated" → missing (not unknown).
function textStatus(t: string | null | undefined, strong = 120, weak = 40): SignalStatus {
  const len = (t || '').trim().length;
  if (len >= strong) return 'met';
  if (len >= weak) return 'partial';
  return 'missing';
}

// Met/partial/missing from a 0..max sub-score on score_snapshots; absent → unknown.
function ratioStatus(total: number | null, max: number): SignalStatus {
  if (total == null) return 'unknown';
  const r = max > 0 ? total / max : 0;
  if (r >= 0.7) return 'met';
  if (r >= 0.4) return 'partial';
  return 'missing';
}

async function safeFirst<T = Record<string, unknown>>(env: Env, sql: string, binds: unknown[]): Promise<T | null> {
  try {
    return await env.DB.prepare(sql).bind(...binds).first<T>();
  } catch {
    return null; // table may not exist on a minimal DB — degrade to "unknown"
  }
}

// Aggregate a layer's signals into a 0..100 risk + a data-confidence figure.
function scoreSignals(signals: ProofSignal[]): { risk: number; confidence: number; earned: number; totalW: number } {
  let totalW = 0;
  let knownW = 0;
  let earned = 0;
  for (const s of signals) {
    totalW += s.weight;
    if (s.status !== 'unknown') {
      knownW += s.weight;
      earned += s.weight * (s.status === 'met' ? 1 : s.status === 'partial' ? 0.5 : 0);
    }
  }
  // Mostly-unknown layer → lean cautious (medium-high) rather than falsely safe.
  const risk = knownW === 0 ? 60 : Math.round(100 * (1 - earned / knownW));
  const confidence = totalW === 0 ? 0 : Math.round((100 * knownW) / totalW);
  return { risk, confidence, earned, totalW };
}

function rationaleFor(signals: ProofSignal[]): string {
  const gaps = signals
    .filter((s) => s.status === 'missing' || s.status === 'unknown')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((s) => s.label);
  if (gaps.length === 0) return 'All key proof signals present.';
  return `Needs: ${gaps.join(', ')}.`;
}

/**
 * Compute the full 10-layer auto assessment for a project. Returns null if the
 * project doesn't exist (or is soft-deleted). The route layer is responsible
 * for merging analyst overrides and persisting snapshots.
 */
export async function computeVentureRisk(env: Env, projectId: number): Promise<VentureRiskAssessment | null> {
  const project = await safeFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL',
    [projectId],
  );
  if (!project) return null;

  // ---- Load signal sources (all optional/defensive) ----
  const score = await safeFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM score_snapshots WHERE project_id = ? AND is_sandbox = 0 ORDER BY created_at DESC LIMIT 1',
    [projectId],
  );
  const founderId = num(project.founder_id);
  const founder = founderId != null
    ? await safeFirst<Record<string, unknown>>(env, 'SELECT * FROM founders WHERE id = ?', [founderId])
    : null;
  const founderRisk = founderId != null
    ? await safeFirst<{ score: number | null }>(env, 'SELECT score FROM founder_risk_pulls WHERE founder_id = ? ORDER BY created_at DESC LIMIT 1', [founderId])
    : null;
  const metrics = await (async () => {
    try {
      const r = await env.DB.prepare(
        'SELECT mrr, active_users, snapshot_date FROM metrics_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 2',
      ).bind(projectId).all();
      return (r.results ?? []) as Array<{ mrr: number | null; active_users: number | null; snapshot_date: string }>;
    } catch {
      return [];
    }
  })();
  const discovery = await safeFirst<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?', [projectId]);
  const dealAgg = await safeFirst<{ deals: number; partners: number }>(
    env,
    'SELECT COUNT(*) AS deals, COUNT(DISTINCT partner_id) AS partners FROM deals WHERE project_id = ?',
    [projectId],
  );
  const docAgg = await safeFirst<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM documents WHERE project_id = ?', [projectId]);
  const marketIdx = project.sector
    ? await safeFirst<{ delta_pct: number | null }>(env, 'SELECT delta_pct FROM market_intel_indexes WHERE sector = ? ORDER BY period_key DESC LIMIT 1', [project.sector])
    : null;
  const financialModel = await safeFirst<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM financial_models WHERE project_id = ?', [projectId]);
  const roundsAgg = await safeFirst<{ n: number; total: number }>(env, 'SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM rounds WHERE project_id = ?', [projectId]);

  // Convenience accessors
  const revenue = num(project.revenue);
  const users = num(project.users_count);
  const tam = num(project.tam);
  const fundingNeeded = num(project.funding_needed);
  const costToMvp = num(project.cost_to_mvp);
  const totalFunding = num(project.total_funding);
  const sTotal = (k: string) => (score ? num(score[k]) : null);

  // ---- Build per-layer signal sets ----
  const built: Record<string, ProofSignal[]> = {};

  // 1 — Founder
  {
    const fr = founderRisk?.score;
    const frStatus: SignalStatus = fr == null ? 'unknown' : fr <= 40 ? 'met' : fr <= 66 ? 'partial' : 'missing';
    const yrs = num(founder?.experience_years);
    const yrStatus: SignalStatus = yrs == null ? 'unknown' : yrs >= 8 ? 'met' : yrs >= 3 ? 'partial' : 'missing';
    built.founder = [
      sig('founder_risk_profile', 'Founder risk profile', frStatus, fr == null ? null : `risk ${fr}`, 2.0, 'founder_risk_pulls (PitchBook/LinkedIn pull)'),
      sig('domain_expertise', 'Domain expertise', yrStatus, yrs == null ? null : `${yrs} yrs`, 1.5, 'founders.experience_years'),
      sig('execution_track', 'Execution track record', ratioStatus(sTotal('team_total'), 20), score ? `${sTotal('team_total')}/20` : null, 1.0, 'score_snapshots.team_total'),
    ];
  }

  // 2 — Market
  {
    const payStatus: SignalStatus = users != null && users > 0 ? 'met' : revenue != null && revenue > 0 ? 'met' : users == null && revenue == null ? 'unknown' : 'missing';
    const revStatus: SignalStatus = revenue == null ? 'unknown' : revenue > 0 ? 'met' : 'missing';
    const tamStatus: SignalStatus = tam == null ? 'missing' : tam > 0 ? 'met' : 'missing';
    const trendStatus: SignalStatus = marketIdx?.delta_pct == null ? 'unknown' : marketIdx.delta_pct > 0 ? 'met' : 'missing';
    built.market = [
      sig('paying_customers', 'Paying / active customers', payStatus, users != null ? `${users} users` : revenue != null ? `$${revenue}` : null, 2.0, 'projects.users_count / revenue'),
      sig('revenue', 'Revenue', revStatus, revenue == null ? null : `$${revenue}`, 1.5, 'projects.revenue'),
      sig('tam_defined', 'TAM defined', tamStatus, tam == null ? null : `$${tam}`, 1.0, 'projects.tam'),
      sig('market_trend', 'Market momentum', trendStatus, marketIdx?.delta_pct == null ? null : `${marketIdx.delta_pct}%`, 1.0, 'market_intel_indexes.delta_pct'),
    ];
  }

  // 3 — Competition
  {
    const hasCb = !!(project.crunchbase_data_json && String(project.crunchbase_data_json).length > 2);
    built.competition = [
      sig('landscape_mapped', 'Competitive landscape mapped', hasCb ? 'met' : 'missing', hasCb ? 'Crunchbase' : null, 1.5, 'projects.crunchbase_data_json'),
      sig('differentiation', 'Differentiation articulated', textStatus(project.solution as string), null, 1.5, 'projects.solution'),
      sig('defensibility', 'Strategic fit / defensibility', ratioStatus(sTotal('fit_total'), 15), score ? `${sTotal('fit_total')}/15` : null, 1.0, 'score_snapshots.fit_total'),
    ];
  }

  // 4 — Timing
  {
    built.timing = [
      sig('why_now', 'Why-now articulated', textStatus(project.why_now as string, 80, 20), null, 2.0, 'projects.why_now'),
      sig('momentum', 'Market momentum', marketIdx?.delta_pct == null ? 'unknown' : marketIdx.delta_pct > 0 ? 'met' : 'missing', marketIdx?.delta_pct == null ? null : `${marketIdx.delta_pct}%`, 1.0, 'market_intel_indexes.delta_pct'),
      sig('recent_round', 'Recent funding signal', project.last_funding_round ? 'met' : 'missing', (project.last_funding_round as string) || null, 0.5, 'projects.last_funding_round'),
    ];
  }

  // 5 — Financing
  {
    const need = fundingNeeded ?? costToMvp;
    let runwayStatus: SignalStatus;
    let runwayVal: string | null = null;
    if (need == null && totalFunding == null) runwayStatus = 'unknown';
    else if (need == null) { runwayStatus = (totalFunding ?? 0) > 0 ? 'partial' : 'unknown'; runwayVal = totalFunding != null ? `$${totalFunding} raised` : null; }
    else {
      const have = totalFunding ?? 0;
      runwayStatus = have >= need ? 'met' : have >= 0.5 * need ? 'partial' : 'missing';
      runwayVal = `$${have} / $${need}`;
    }
    built.financing = [
      sig('runway', 'Runway to next milestone', runwayStatus, runwayVal, 2.0, 'projects.total_funding vs funding_needed/cost_to_mvp'),
      sig('capital_efficiency', 'Capital efficiency', ratioStatus(sTotal('capital_total'), 15), score ? `${sTotal('capital_total')}/15` : null, 1.0, 'score_snapshots.capital_total'),
      sig('funding_strategy', 'Funding strategy', (roundsAgg?.n ?? 0) > 0 || (financialModel?.n ?? 0) > 0 || textStatus(project.use_of_funds as string, 40, 10) === 'met' ? 'met' : textStatus(project.use_of_funds as string, 40, 10) === 'partial' ? 'partial' : 'missing', (roundsAgg?.n ?? 0) > 0 ? `${roundsAgg?.n} rounds` : null, 1.0, 'rounds / financial_models / projects.use_of_funds'),
    ];
  }

  // 6 — Marketing
  {
    let growthStatus: SignalStatus = 'unknown';
    let growthVal: string | null = null;
    if (metrics.length >= 2) {
      const cur = num(metrics[0].active_users) ?? num(metrics[0].mrr);
      const prev = num(metrics[1].active_users) ?? num(metrics[1].mrr);
      if (cur != null && prev != null) {
        const g = (cur - prev) / Math.max(prev, 1);
        growthStatus = g > 0.05 ? 'met' : g >= 0 ? 'partial' : 'missing';
        growthVal = `${Math.round(g * 100)}% MoM`;
      }
    } else if (metrics.length === 1) {
      growthStatus = 'partial';
    }
    built.marketing = [
      sig('repeatable_growth', 'Repeatable growth', growthStatus, growthVal, 2.0, 'metrics_snapshots (MoM)'),
      sig('growth_signals', 'Acquisition signals', textStatus(project.growth_signals as string, 40, 10), null, 1.0, 'projects.growth_signals'),
      sig('user_base', 'User base', users == null ? 'unknown' : users > 100 ? 'met' : users > 0 ? 'partial' : 'missing', users == null ? null : `${users}`, 1.0, 'projects.users_count'),
    ];
  }

  // 7 — Distribution
  {
    const partnerships = (dealAgg?.deals ?? 0) > 0 || (dealAgg?.partners ?? 0) > 0;
    built.distribution = [
      sig('channels', 'Distribution channels', ratioStatus(sTotal('distribution_total'), 10), score ? `${sTotal('distribution_total')}/10` : null, 1.5, 'score_snapshots.distribution_total'),
      sig('partnerships', 'Partnerships / deal flow', partnerships ? 'met' : 'missing', partnerships ? `${dealAgg?.deals} deals` : null, 1.5, 'deals / partners'),
      sig('virality', 'Virality / network effects', ratioStatus(sTotal('distribution_virality'), 5), null, 1.0, 'score_snapshots.distribution_virality'),
    ];
  }

  // 8 — Technology
  {
    built.technology = [
      sig('feasibility', 'Build feasibility', ratioStatus(sTotal('product_total'), 15), score ? `${sTotal('product_total')}/15` : null, 1.5, 'score_snapshots.product_total'),
      sig('solution_depth', 'Solution defined', textStatus(project.solution as string, 120, 40), null, 1.0, 'projects.solution'),
      sig('artifacts', 'Engineering artifacts', (docAgg?.n ?? 0) > 0 ? 'met' : 'missing', (docAgg?.n ?? 0) > 0 ? `${docAgg?.n} docs` : null, 0.5, 'documents'),
    ];
  }

  // 9 — Product
  {
    const dc = discovery?.n ?? 0;
    const discStatus: SignalStatus = dc >= 3 ? 'met' : dc >= 1 ? 'partial' : 'missing';
    let retentionStatus: SignalStatus = 'unknown';
    if (metrics.length >= 1) {
      const au = num(metrics[0].active_users);
      retentionStatus = au != null && au > 0 ? 'met' : metrics.length >= 1 ? 'partial' : 'unknown';
    }
    built.product = [
      sig('retention', 'Retention / engagement', retentionStatus, metrics[0]?.active_users != null ? `${metrics[0].active_users} active` : null, 1.5, 'metrics_snapshots.active_users'),
      sig('discovery', 'Customer discovery', discStatus, `${dc} interviews`, 1.5, 'discovery_interviews'),
      sig('usage_growth', 'Usage', users == null ? 'unknown' : users > 0 ? 'met' : 'missing', users == null ? null : `${users}`, 1.0, 'projects.users_count'),
    ];
  }

  // 10 — Hiring
  {
    const ec = project.employee_count as string | null;
    let teamStatus: SignalStatus = 'unknown';
    if (ec) {
      const m = String(ec).match(/\d+/);
      const n = m ? Number(m[0]) : null;
      teamStatus = n == null ? 'partial' : n >= 11 ? 'met' : n >= 2 ? 'partial' : 'missing';
    }
    built.hiring = [
      sig('team_density', 'Team density', teamStatus, ec || null, 1.5, 'projects.employee_count'),
      sig('leadership_depth', 'Leadership depth', ratioStatus(sTotal('team_total'), 20), score ? `${sTotal('team_total')}/20` : null, 1.0, 'score_snapshots.team_total'),
      sig('network', 'Hiring network', ratioStatus(sTotal('team_network'), 7), null, 1.0, 'score_snapshots.team_network'),
    ];
  }

  // ---- Assemble layers (auto pass; overrides applied by the route) ----
  const bucket = stageBucket(project.stage as string);
  const weights = LAYER_WEIGHTS[bucket];
  let sumEarned = 0;
  let sumTotalW = 0;
  let weightedRisk = 0;
  let weightSum = 0;

  const layers: RiskLayer[] = LAYERS.map((meta) => {
    const signals = built[meta.key] || [];
    const { risk, confidence, earned, totalW } = scoreSignals(signals);
    sumEarned += earned;
    sumTotalW += totalW;
    const w = weights[meta.key] ?? 1;
    weightedRisk += w * risk;
    weightSum += w;
    return {
      key: meta.key,
      label: meta.label,
      belief: meta.belief,
      proof: meta.proof,
      risk,
      band: bandFromScore(risk),
      confidence,
      status: 'open',
      overridden: false,
      override: null,
      rationale: rationaleFor(signals),
      signals,
    };
  });

  const overall_risk = weightSum > 0 ? Math.round(weightedRisk / weightSum) : 60;
  const derisk_pct = sumTotalW > 0 ? Math.round((100 * sumEarned) / sumTotalW) : 0;

  return {
    project_id: projectId,
    project_name: String(project.name ?? ''),
    stage: String(project.stage ?? ''),
    overall_risk,
    overall_band: bandFromScore(overall_risk),
    derisk_score: 100 - overall_risk,
    derisk_pct,
    layers,
    source: 'auto',
    saved: false,
    computed_at: null,
  };
}

// Recompute the aggregate after per-layer overrides have mutated layer.risk.
export function recomputeAggregate(assessment: VentureRiskAssessment): void {
  const bucket = stageBucket(assessment.stage);
  const weights = LAYER_WEIGHTS[bucket];
  let weightedRisk = 0;
  let weightSum = 0;
  for (const l of assessment.layers) {
    const w = weights[l.key] ?? 1;
    weightedRisk += w * l.risk;
    weightSum += w;
  }
  assessment.overall_risk = weightSum > 0 ? Math.round(weightedRisk / weightSum) : 60;
  assessment.overall_band = bandFromScore(assessment.overall_risk);
  assessment.derisk_score = 100 - assessment.overall_risk;
}

export interface OverrideRow {
  layer_key: string;
  band: string | null;
  score: number | null;
  status: string | null;
  note: string | null;
  owner_user_id: number | null;
  updated_at: string | null;
}

// Merge sticky analyst overrides over an auto assessment (in place) and
// recompute the aggregate. Returns the same object for convenience.
export function applyOverrides(assessment: VentureRiskAssessment, overrides: OverrideRow[]): VentureRiskAssessment {
  const byKey = new Map(overrides.map((o) => [o.layer_key, o]));
  let analystTouched = false;
  for (const layer of assessment.layers) {
    const ov = byKey.get(layer.key);
    if (!ov) continue;
    analystTouched = true;
    if (ov.score != null && Number.isFinite(ov.score)) {
      layer.risk = clamp(Math.round(ov.score), 0, 100);
    }
    layer.band = (ov.band as 'low' | 'medium' | 'high') || bandFromScore(layer.risk);
    layer.status = (ov.status as RiskLayer['status']) || 'open';
    layer.overridden = true;
    layer.override = {
      band: ov.band,
      score: ov.score,
      status: ov.status || 'open',
      note: ov.note,
      owner_user_id: ov.owner_user_id,
      updated_at: ov.updated_at,
    };
  }
  if (analystTouched) {
    assessment.source = 'analyst';
    recomputeAggregate(assessment);
  }
  return assessment;
}

// Parse a persisted venture_risk_assessments row into the API shape.
export function serializeAssessment(row: Record<string, unknown>): VentureRiskAssessment {
  let layers: RiskLayer[] = [];
  try {
    layers = row.layers_json ? JSON.parse(String(row.layers_json)) : [];
  } catch {
    layers = [];
  }
  return {
    project_id: Number(row.project_id),
    project_name: String((row as any).project_name ?? ''),
    stage: String((row as any).stage ?? ''),
    overall_risk: Number(row.overall_risk ?? 0),
    overall_band: (String(row.overall_band ?? 'medium') as 'low' | 'medium' | 'high'),
    derisk_score: Number(row.derisk_score ?? 0),
    derisk_pct: Number(row.derisk_pct ?? 0),
    layers,
    source: (String(row.source ?? 'auto') as 'auto' | 'analyst'),
    saved: true,
    computed_at: String(row.created_at ?? '') || null,
  };
}
