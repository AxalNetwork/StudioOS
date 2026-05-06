import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getLiveQuotes, getMarketHeadlines } from '../services/market-data';

const marketIntel = new Hono<{ Bindings: Env }>();

// All market-intel endpoints require an authenticated session.
marketIntel.use('*', async (c, next) => {
  await requireAuth(c);
  await next();
});

const MARKET_PULSE = [
  { sector: 'Agentic B2B', multiple: 22.4, sentiment: 'Aggressive', technographic_signal: 'High churn in legacy CRM; 40% migration to AI-first middleware.', hiring_surge: 'DevOps/SRE hiring up 18% in mid-market SaaS.', gap_opportunity: 'Unified API for autonomous agent billing.' },
  { sector: 'Bio-Automation', multiple: 14.1, sentiment: 'Wait-and-See', technographic_signal: 'Early adoption of Lab-OS standards.', hiring_surge: 'Biology-specialized LLM researchers.', gap_opportunity: 'Compliance-as-a-service for decentralized clinical trials.' },
  { sector: 'AI Infrastructure', multiple: 28.7, sentiment: 'Aggressive', technographic_signal: 'Enterprise GPU cluster adoption up 65% YoY.', hiring_surge: 'ML Ops engineers up 32% across Fortune 500.', gap_opportunity: 'Edge inference orchestration layer for real-time AI.' },
  { sector: 'Fintech / DeFi', multiple: 16.3, sentiment: 'Cautious', technographic_signal: 'Banks migrating to API-first core banking.', hiring_surge: 'Compliance + crypto-native product managers.', gap_opportunity: 'Regulated stablecoin treasury management API.' },
  { sector: 'Data / Analytics', multiple: 19.8, sentiment: 'Aggressive', technographic_signal: 'Data lakehouse adoption replacing legacy warehouses.', hiring_surge: 'Data engineers and analytics engineers up 25%.', gap_opportunity: 'Real-time data quality monitoring for AI pipelines.' },
  { sector: 'Cybersecurity', multiple: 24.2, sentiment: 'Aggressive', technographic_signal: 'Zero-trust adoption accelerating in mid-market.', hiring_surge: 'AppSec and identity engineers up 40%.', gap_opportunity: 'AI-powered threat detection for API-first architectures.' },
  { sector: 'Autonomous Robotics', multiple: 26.3, sentiment: 'Aggressive', technographic_signal: 'Vision-language models enabling 40%+ YoY increase in warehouse and last-mile automation pilots.', hiring_surge: 'Robotics software + perception engineers up 31%.', gap_opportunity: 'Unified agentic control layer for heterogeneous robot fleets.' },
  { sector: 'Climate Intelligence', multiple: 17.9, sentiment: 'Aggressive', technographic_signal: 'Post-IRA extension surge in carbon accounting and Scope 3 automation platforms.', hiring_surge: 'Sustainability AI engineers up 37%.', gap_opportunity: 'Real-time MRV API for enterprise net-zero compliance.' },
  { sector: 'Quantum Infrastructure', multiple: 12.4, sentiment: 'Wait-and-See', technographic_signal: 'Error-corrected logical qubits crossing 100+ threshold.', hiring_surge: 'Quantum algorithm researchers up 24%.', gap_opportunity: 'Cloud-accessible quantum optimization layer for supply-chain and portfolio risk modeling.' },
];

const MACRO_DATA = {
  sectors: [
    { name: 'AI / ML', avg_pe: 45.2, yoy_growth: 34.5, ipo_window: 'Open', trend: 'up' },
    { name: 'SaaS', avg_pe: 32.1, yoy_growth: 18.2, ipo_window: 'Selective', trend: 'stable' },
    { name: 'Fintech', avg_pe: 28.7, yoy_growth: 12.4, ipo_window: 'Cautious', trend: 'stable' },
    { name: 'Blockchain', avg_pe: 38.5, yoy_growth: 28.1, ipo_window: 'Opening', trend: 'up' },
    { name: 'Biotech', avg_pe: 22.3, yoy_growth: 8.6, ipo_window: 'Selective', trend: 'down' },
    { name: 'Climate Tech', avg_pe: 30.4, yoy_growth: 22.3, ipo_window: 'Open', trend: 'up' },
    { name: 'Cybersecurity', avg_pe: 41.8, yoy_growth: 25.6, ipo_window: 'Open', trend: 'up' },
    { name: 'Semiconductors', avg_pe: 52.3, yoy_growth: 41.2, ipo_window: 'Open', trend: 'up' },
    { name: 'Enterprise AI Software', avg_pe: 38.9, yoy_growth: 29.4, ipo_window: 'Selective', trend: 'up' },
  ],
  interest_rate_impact: 'Moderate — rates stabilized, favoring growth equity.',
  exit_environment: 'Improving. Strategic M&A picking up in AI/Infrastructure.',
  updated_at: '2026-03-27',
};

const PRIVATE_ROUNDS = [
  { company: 'xAI',        sector: 'AI Infrastructure',     amount: '$6B',    valuation: '$45B', stage: 'Series C' },
  { company: 'Anthropic',  sector: 'AI Infrastructure',     amount: '$3.5B',  valuation: '$61B', stage: 'Series E' },
  { company: 'Anduril',    sector: 'Defense / Cybersecurity', amount: '$1.5B', valuation: '$14B', stage: 'Series E' },
  { company: 'Scale AI',   sector: 'Data / Analytics',      amount: '$1B',    valuation: '$14B', stage: 'Series F' },
  { company: 'Groq',       sector: 'AI Infrastructure',     amount: '$300M',  valuation: '$2.8B', stage: 'Series D' },
  { company: 'Perplexity', sector: 'AI Search',             amount: '$250M',  valuation: '$3B',  stage: 'Series D' },
];

const HIGH_CONVICTION = [
  { sector: 'Agentic B2B',          play_type: 'Replacement Play', multiple: 22.4, sentiment: 'Aggressive',
    reasoning: 'High churn in legacy CRM; 40% migration to AI-first middleware.',
    gap_opportunity: 'Unified API for autonomous agent billing.' },
  { sector: 'AI Infrastructure',    play_type: 'Efficiency Play',  multiple: 28.7, sentiment: 'Aggressive',
    reasoning: 'High 28.7x multiple + aggressive sentiment = launch at 1/10th cost via studio.',
    gap_opportunity: 'Edge inference orchestration layer for real-time AI.' },
  { sector: 'Data / Analytics',     play_type: 'Exit Play',        multiple: 19.8, sentiment: 'Aggressive',
    reasoning: 'Sector multiples at 19.8x — favorable exit timing.',
    gap_opportunity: 'Real-time data quality monitoring for AI pipelines.' },
  { sector: 'Cybersecurity',        play_type: 'Efficiency Play',  multiple: 24.2, sentiment: 'Aggressive',
    reasoning: 'High 24.2x multiple + aggressive sentiment = launch at 1/10th cost via studio.',
    gap_opportunity: 'AI-powered threat detection for API-first architectures.' },
  { sector: 'Autonomous Robotics',  play_type: 'Efficiency Play',  multiple: 26.3, sentiment: 'Aggressive',
    reasoning: 'High 26.3x multiple + aggressive sentiment = launch at 1/10th cost via studio.',
    gap_opportunity: 'Unified agentic control layer for heterogeneous robot fleets.' },
  { sector: 'Climate Intelligence', play_type: 'Exit Play',        multiple: 17.9, sentiment: 'Aggressive',
    reasoning: 'Post-IRA tailwinds + 17.9x multiples — favorable exit timing for MRV plays.',
    gap_opportunity: 'Real-time MRV API for enterprise net-zero compliance.' },
];

const STUDIO_BENCHMARKS = {
  avg_time_to_inc_days: 11, founder_match_rate: 88, api_reusability_score: 65,
  current_dry_powder: '$4.5M', avg_time_to_first_check_days: 28, conversion_idea_to_funded: 23,
  active_batch_size: 8, portfolio_companies: 12, decision_gate_pass_rate: 72,
  avg_time_to_spinout_days: 68, avg_founder_equity_at_spinout: 68, followon_funding_rate: 75,
  avg_valuation_first_round: '$9.2M', cost_per_spinout: '$185k', deployment_velocity: 35,
};

marketIntel.get('/market-pulse', async (c) => {
  const updated_at = new Date().toISOString();
  let headlines: any[] = [];
  let sources: string[] = [];
  let cached = false;
  try {
    const h = await getMarketHeadlines(c.env);
    headlines = h.headlines;
    sources = h.sources;
    cached = h.cached;
  } catch { /* fall through to seed-only */ }
  return c.json({
    signals: MARKET_PULSE,
    headlines,
    headlines_sources: sources,
    headlines_cached: cached,
    updated_at,
    total_sectors: MARKET_PULSE.length,
  });
});

marketIntel.get('/macro', async (c) => {
  let live_quotes: any[] = [];
  let quotes_updated_at: string | null = null;
  let cached = false;
  try {
    const q = await getLiveQuotes(c.env);
    live_quotes = q.quotes;
    quotes_updated_at = q.updated_at;
    cached = q.cached;
  } catch { /* fall through to seed-only */ }
  return c.json({ ...MACRO_DATA, live_quotes, quotes_updated_at, quotes_cached: cached });
});
marketIntel.get('/private-rounds', (c) => c.json({ rounds: PRIVATE_ROUNDS, total: PRIVATE_ROUNDS.length, updated_at: new Date().toISOString() }));
marketIntel.get('/studio-benchmarks', (c) => c.json(STUDIO_BENCHMARKS));

marketIntel.get('/competitive-intelligence', (c) => {
  return c.json({
    high_conviction_plays: HIGH_CONVICTION,
    studio_benchmarks: STUDIO_BENCHMARKS,
    market_pulse: MARKET_PULSE,
    updated_at: new Date().toISOString(),
  });
});

export { MARKET_PULSE, STUDIO_BENCHMARKS };
export default marketIntel;
