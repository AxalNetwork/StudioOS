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
