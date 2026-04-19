export function scoreMarket(tam: number, urgency: number, trend: number) {
  let sizeScore = 3;
  if (tam >= 1_000_000_000) sizeScore = 10;
  else if (tam >= 500_000_000) sizeScore = 8;
  else if (tam >= 100_000_000) sizeScore = 7;
  else if (tam >= 50_000_000) sizeScore = 5;

  const urgencyScore = Math.min(Math.max(urgency, 0), 10);
  const trendScore = Math.min(Math.max(trend, 0), 5);
  const total = Math.min(sizeScore + urgencyScore + trendScore, 25);
  return { size: r(sizeScore), urgency: r(urgencyScore), trend: r(trendScore), total: r(total) };
}

export function scoreTeam(expertise: number, execution: number, network: number) {
  const e = Math.min(Math.max(expertise, 0), 8);
  const x = Math.min(Math.max(execution, 0), 8);
  const n = Math.min(Math.max(network, 0), 4);
  const total = Math.min(e + x + n, 20);
  return { expertise: r(e), execution: r(x), network: r(n), total: r(total) };
}

export function scoreProduct(mvpTimeDays: number, complexity: number, dependencies: number) {
  let mvpScore = 1;
  if (mvpTimeDays <= 14) mvpScore = 7;
  else if (mvpTimeDays <= 30) mvpScore = 6;
  else if (mvpTimeDays <= 60) mvpScore = 4;
  else if (mvpTimeDays <= 90) mvpScore = 2;

  const c = Math.min(Math.max(5 - complexity, 0), 5);
  const d = Math.min(Math.max(3 - dependencies, 0), 3);
  const total = Math.min(mvpScore + c + d, 15);
  return { mvp_time: r(mvpScore), complexity: r(c), dependency: r(d), total: r(total) };
}

export function scoreCapital(costToMvp: number, timeToRevenueMonths: number, burnRisk: number) {
  let costScore = 1;
  if (costToMvp < 25_000) costScore = 7;
  else if (costToMvp < 50_000) costScore = 6;
  else if (costToMvp < 100_000) costScore = 5;
  else if (costToMvp < 200_000) costScore = 3;

  let revenueScore = 0;
  if (timeToRevenueMonths <= 3) revenueScore = 5;
  else if (timeToRevenueMonths <= 6) revenueScore = 4;
  else if (timeToRevenueMonths <= 12) revenueScore = 3;
  else if (timeToRevenueMonths <= 18) revenueScore = 1;

  const burn = Math.min(Math.max(3 - burnRisk, 0), 3);
  const total = Math.min(costScore + revenueScore + burn, 15);
  return { cost_mvp: r(costScore), time_revenue: r(revenueScore), burn_traction: r(burn), total: r(total) };
}

export function scoreFit(alignment: number, synergy: number) {
  const a = Math.min(Math.max(alignment, 0), 10);
  const s = Math.min(Math.max(synergy, 0), 5);
  const total = Math.min(a + s, 15);
  return { alignment: r(a), synergy: r(s), total: r(total) };
}

export function scoreDistribution(channels: number, virality: number) {
  const c = Math.min(Math.max(channels, 0), 5);
  const v = Math.min(Math.max(virality, 0), 5);
  const total = Math.min(c + v, 10);
  return { channels: r(c), virality: r(v), total: r(total) };
}

export function classifyTier(score: number): string {
  if (score >= 85) return 'TIER_1';
  if (score >= 70) return 'TIER_2';
  return 'REJECT';
}

export function tierLabel(tier: string): string {
  const labels: Record<string, string> = {
    TIER_1: 'Tier 1 — Immediate Spinout',
    TIER_2: 'Tier 2 — Conditional / Refine in Week 1',
    REJECT: 'Reject — Incubate Later',
  };
  return labels[tier] || tier;
}

export function runFullScore(data: Record<string, number>) {
  const market = scoreMarket(data.tam || 0, data.market_urgency || 0, data.market_trend || 0);
  const team = scoreTeam(data.team_expertise || 0, data.team_execution || 0, data.team_network || 0);
  const product = scoreProduct(data.mvp_time_days || 90, data.product_complexity || 3, data.product_dependencies || 2);
  const capital = scoreCapital(data.cost_to_mvp || 100000, data.time_to_revenue_months || 12, data.burn_risk || 2);
  const fit = scoreFit(data.fit_alignment || 0, data.fit_synergy || 0);
  const distribution = scoreDistribution(data.distribution_channels || 0, data.distribution_virality || 0);

  let total = market.total + team.total + product.total + capital.total + fit.total + distribution.total;
  const aiAdj = data.ai_adjustment || 0;
  total = Math.min(Math.max(total + aiAdj, 0), 100);
  const tier = classifyTier(total);

  return {
    total_score: r(total),
    tier,
    tier_label: tierLabel(tier),
    breakdown: { market, team, product, capital, fit, distribution },
    ai_adjustment: aiAdj,
    max_possible: 100,
  };
}

function r(n: number) { return Math.round(n * 10) / 10; }

// ──────────────────────────────────────────────────────────────────────────
// v2 — "The Brain" 100-point scoring (Diligence & Scoring Engine redesign)
// Categories: A Market 25 / B Team 20 / C Product 20 / D Traction 15 /
//             E Capital 10 / F Fit&Moat 10  +  AI Bonus -10..+10
// All sub-factor inputs are bounded; the engine never trusts client values.
// ──────────────────────────────────────────────────────────────────────────

export type ScoreV2Input = {
  // A. Market (25)
  tam_usd?: number;          // 0..∞   → 0..10 size points
  market_urgency?: number;   // 0..10
  market_trend?: number;     // 0..5
  // B. Team (20)
  team_expertise?: number;   // 0..8
  team_execution?: number;   // 0..8
  team_network?: number;     // 0..4
  // C. Product/Tech (20)
  mvp_time_days?: number;    // 0..∞   (lower=better) → 0..8
  product_complexity?: number; // 0..5 (lower=better) → 0..6
  tech_defensibility?: number; // 0..6
  // D. Traction (15)
  active_users?: number;     // 0..∞   → 0..6
  monthly_revenue_usd?: number; // 0..∞ → 0..6
  growth_signals?: number;   // 0..3
  // E. Capital (10)
  cost_to_mvp_usd?: number;  // 0..∞   (lower=better) → 0..5
  runway_months?: number;    // 0..∞   → 0..5
  // F. Fit & Moat (10)
  strategic_alignment?: number; // 0..5
  moat_strength?: number;       // 0..5
  // AI Bonus
  ai_adjustment?: number;       // -10..+10
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(Number.isFinite(n) ? n : 0, lo), hi);

function bandScore(value: number, bands: Array<[number, number]>, fallback = 0): number {
  // bands sorted descending by threshold; first match wins.
  for (const [threshold, points] of bands) if (value >= threshold) return points;
  return fallback;
}

function scoreMarketV2(tam: number, urgency: number, trend: number) {
  const size = bandScore(tam, [
    [1_000_000_000, 10],
    [500_000_000, 8],
    [100_000_000, 6],
    [50_000_000, 4],
    [10_000_000, 2],
  ]);
  const u = clamp(urgency, 0, 10);
  const t = clamp(trend, 0, 5);
  return { size: r(size), urgency: r(u), trend: r(t), total: r(Math.min(size + u + t, 25)) };
}

function scoreTeamV2(expertise: number, execution: number, network: number) {
  const e = clamp(expertise, 0, 8), x = clamp(execution, 0, 8), n = clamp(network, 0, 4);
  return { expertise: r(e), execution: r(x), network: r(n), total: r(Math.min(e + x + n, 20)) };
}

function scoreProductV2(mvpDays: number, complexity: number, defensibility: number) {
  const mvp = bandScore(-mvpDays, [[-7, 8], [-21, 7], [-45, 5], [-90, 3], [-180, 1]], 0);
  const c = clamp(6 - complexity * 1.2, 0, 6);
  const d = clamp(defensibility, 0, 6);
  return { mvp_speed: r(mvp), complexity: r(c), defensibility: r(d), total: r(Math.min(mvp + c + d, 20)) };
}

function scoreTractionV2(users: number, mrr: number, growth: number) {
  const userPts = bandScore(users, [
    [10000, 6], [1000, 5], [100, 3], [10, 1],
  ]);
  const revPts = bandScore(mrr, [
    [50_000, 6], [10_000, 5], [1_000, 3], [100, 1],
  ]);
  const g = clamp(growth, 0, 3);
  return { users: r(userPts), revenue: r(revPts), growth: r(g), total: r(Math.min(userPts + revPts + g, 15)) };
}

function scoreCapitalV2(costMvp: number, runway: number) {
  const cost = bandScore(-costMvp, [[-25_000, 5], [-50_000, 4], [-100_000, 3], [-200_000, 1]], 0);
  const run = bandScore(runway, [[18, 5], [12, 4], [6, 3], [3, 1]]);
  return { cost: r(cost), runway: r(run), total: r(Math.min(cost + run, 10)) };
}

function scoreFitV2(alignment: number, moat: number) {
  const a = clamp(alignment, 0, 5), m = clamp(moat, 0, 5);
  return { alignment: r(a), moat: r(m), total: r(Math.min(a + m, 10)) };
}

export type ScoreV2Result = {
  total_score: number;
  total_before_ai: number;
  ai_adjustment: number;
  recommendation: 'Strong' | 'Promising' | 'Needs Work' | 'High Risk';
  recommendation_color: 'green' | 'yellow' | 'orange' | 'red';
  category_breakdown: {
    market: ReturnType<typeof scoreMarketV2> & { weight: 25 };
    team: ReturnType<typeof scoreTeamV2> & { weight: 20 };
    product: ReturnType<typeof scoreProductV2> & { weight: 20 };
    traction: ReturnType<typeof scoreTractionV2> & { weight: 15 };
    capital: ReturnType<typeof scoreCapitalV2> & { weight: 10 };
    fit: ReturnType<typeof scoreFitV2> & { weight: 10 };
  };
};

export function runScoreV2(data: ScoreV2Input): ScoreV2Result {
  const market = scoreMarketV2(data.tam_usd ?? 0, data.market_urgency ?? 0, data.market_trend ?? 0);
  const team = scoreTeamV2(data.team_expertise ?? 0, data.team_execution ?? 0, data.team_network ?? 0);
  const product = scoreProductV2(data.mvp_time_days ?? 90, data.product_complexity ?? 3, data.tech_defensibility ?? 0);
  const traction = scoreTractionV2(data.active_users ?? 0, data.monthly_revenue_usd ?? 0, data.growth_signals ?? 0);
  const capital = scoreCapitalV2(data.cost_to_mvp_usd ?? 100_000, data.runway_months ?? 6);
  const fit = scoreFitV2(data.strategic_alignment ?? 0, data.moat_strength ?? 0);

  const before = market.total + team.total + product.total + traction.total + capital.total + fit.total;
  const adj = clamp(data.ai_adjustment ?? 0, -10, 10);
  const total = clamp(before + adj, 0, 100);

  const rec = total >= 80 ? 'Strong'
            : total >= 65 ? 'Promising'
            : total >= 50 ? 'Needs Work'
            : 'High Risk';
  const color = total >= 80 ? 'green'
              : total >= 65 ? 'yellow'
              : total >= 50 ? 'orange'
              : 'red';

  return {
    total_score: r(total),
    total_before_ai: r(before),
    ai_adjustment: r(adj),
    recommendation: rec,
    recommendation_color: color,
    category_breakdown: {
      market: { ...market, weight: 25 },
      team: { ...team, weight: 20 },
      product: { ...product, weight: 20 },
      traction: { ...traction, weight: 15 },
      capital: { ...capital, weight: 10 },
      fit: { ...fit, weight: 10 },
    },
  };
}
