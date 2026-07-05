/**
 * Signals — normalized decision-engine schema (TypeScript mirror of sql/migrations/134_signals.sql).
 *
 * This is a FOUNDER DECISION ENGINE, not a trading terminal. Every type here
 * exists to answer "what should I build next, for whom, where, and why is the
 * signal credible?" — never "what is the share price doing today".
 *
 * The nine entities the product spec asks for map onto these types:
 *   Company          → NormalizedCompany
 *   Market           → MarketContext (embedded on Signal.market)
 *   Signal           → Signal
 *   EvidenceItem     → EvidenceItem
 *   Source           → SignalSource
 *   Region           → REGIONS registry + Signal.region/country
 *   Niche            → Signal.niche (+ sector/industry)
 *   CustomerSegment  → Signal.target_customers
 *   BuildOpportunity → BuildOpportunity (embedded on Signal.build)
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies. Kept as const arrays so both the ranking engine and
// the /filters endpoint derive their facets from a single source of truth.
// ---------------------------------------------------------------------------

/** The nine founder-actionable signal archetypes from the product spec. */
export const SIGNAL_TYPES = [
  'emerging_niche_demand',
  'geographic_expansion',
  'underserved_segment',
  'regulatory_pressure',
  'workflow_digitization',
  'midcap_momentum',
  'vertical_software',
  'category_creation',
  'consolidation_signal',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  emerging_niche_demand: 'Emerging niche demand',
  geographic_expansion: 'Geographic expansion opportunity',
  underserved_segment: 'Underserved customer segment',
  regulatory_pressure: 'Regulation / compliance pressure',
  workflow_digitization: 'Workflow digitization opportunity',
  midcap_momentum: 'Mid-cap momentum in a sector',
  vertical_software: 'Vertical-specific software opportunity',
  category_creation: 'New category creation / fragmentation',
  consolidation_signal: 'Repeated acquisition / consolidation',
};

/** Market-cap bands. Ordered small→large; the ranker rewards diversity and
 *  deliberately does NOT reward "biggest company wins". */
export const MARKET_CAP_BANDS = [
  'nano', // < $50M
  'micro', // $50M – $300M
  'small', // $300M – $2B
  'mid', // $2B – $10B
  'large', // $10B – $200B
  'mega', // > $200B
] as const;
export type MarketCapBand = (typeof MARKET_CAP_BANDS)[number];

/** Employee / company-size bands (headcount proxy for maturity). */
export const EMPLOYEE_BANDS = [
  '1-50',
  '51-200',
  '201-1k',
  '1k-5k',
  '5k-20k',
  '20k+',
] as const;
export type EmployeeBand = (typeof EMPLOYEE_BANDS)[number];

/** Public-company maturity / growth-stage proxy (derived from cap + headcount
 *  + revenue-growth cues, never from a paid rating). */
export const MATURITY_STAGES = [
  'emerging', // young public co, high growth
  'scaling',
  'established',
  'incumbent', // slow-growth mega/large incumbent
] as const;
export type MaturityStage = (typeof MATURITY_STAGES)[number];

/** Coarse buyer/customer type — who a founder would actually sell to. */
export const CUSTOMER_TYPES = [
  'smb',
  'mid_market',
  'enterprise',
  'consumer',
  'developer',
  'public_sector',
  'healthcare_provider',
  'financial_institution',
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/** Region registry (the "Region" entity). Countries roll up to a region. */
export const REGIONS = [
  'North America',
  'Latin America',
  'Europe',
  'MENA',
  'Sub-Saharan Africa',
  'South Asia',
  'Southeast Asia',
  'East Asia',
  'Oceania',
] as const;
export type Region = (typeof REGIONS)[number];

/** Evidence categories — the "evidence chips" the card renders. Each maps to a
 *  source KIND so the UI can show WHAT kind of public data backs a signal. */
export const EVIDENCE_KINDS = [
  'fundamentals', // market cap, revenue, headcount from a profile API
  'market_data', // price/volume trend used only as context, never as the lead
  'news', // recent company / sector headlines
  'filing', // 10-K / 20-F / annual report / IR deck language
  'registry', // public corporate registry / incorporation data
  'earnings', // earnings-call / guidance language
  'hiring', // public job-posting velocity (workflow-demand proxy)
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// ---------------------------------------------------------------------------
// Source registry — every adapter registers one SignalSource. `quality_weight`
// (0..1) and `freshness_halflife_days` feed the confidence score. Swapping a
// free adapter for a premium one later means changing the adapter, not the
// consuming code (see services/signals/sources.ts).
// ---------------------------------------------------------------------------
export interface SignalSource {
  key: string; // stable id, e.g. 'sec_edgar'
  name: string; // human label, e.g. 'SEC EDGAR (full-text)'
  kind: EvidenceKind; // the evidence family this source produces
  tier: 'free' | 'free_tier' | 'premium'; // pricing posture
  quality_weight: number; // 0..1 — trust in this source's factual accuracy
  freshness_halflife_days: number; // how fast this source's data decays
  homepage?: string;
  enabled: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Company — normalized public-company profile. Fields intentionally exclude
// live price/candlestick data: only slow-moving descriptive facts a founder
// cares about (who they serve, how big, where, how mature).
// ---------------------------------------------------------------------------
export interface NormalizedCompany {
  symbol: string;
  name: string;
  exchange?: string;
  country?: string;
  region?: Region;
  sector?: string;
  industry?: string;
  market_cap?: number; // USD
  market_cap_band?: MarketCapBand;
  employee_count?: number;
  employee_band?: EmployeeBand;
  ceo?: string;
  description?: string;
  customer_type?: CustomerType;
  maturity_stage?: MaturityStage;
  source_key?: string; // which adapter produced this row
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Evidence — one supporting data point behind a signal. `weight` (0..1) scales
// with source quality; `observed_at` drives freshness decay.
// ---------------------------------------------------------------------------
export interface EvidenceItem {
  id?: string;
  kind: EvidenceKind;
  title: string;
  detail?: string;
  source_key: string; // FK → SignalSource.key
  url?: string;
  weight?: number; // 0..1; defaults to the source's quality_weight
  observed_at: string; // ISO timestamp of the underlying datum
}

/** Practical startup translation of a signal — the "Build angle" section. */
export interface BuildOpportunity {
  headline: string; // one-line product pitch
  wedge: string; // the specific entry wedge / first workflow
  icp: string; // ideal customer profile in plain language
  gtm?: string; // suggested go-to-market motion
  moat?: string; // why it can defend
  risks?: string; // honest "why this might not work"
}

/** Slow-moving market context. Kept deliberately light — trend DIRECTION only,
 *  never OHLC candlesticks. */
export interface MarketContext {
  tam_note?: string; // qualitative TAM framing from public sources
  growth_direction?: 'accelerating' | 'steady' | 'decelerating' | 'mixed';
  cap_band_spread?: MarketCapBand[]; // which bands the supporting cos span
}

// ---------------------------------------------------------------------------
// Signal — the ranked card. This is the heart of the engine.
// ---------------------------------------------------------------------------
export interface Signal {
  id: string;
  type: SignalType;
  title: string;
  thesis: string; // one-sentence thesis
  why_now: string; // "why now" narrative

  region: Region;
  country: string;
  sector: string;
  industry?: string;
  niche: string;

  market_cap_band: MarketCapBand; // representative band for the signal
  target_customers: CustomerType[];
  maturity_stage?: MaturityStage;

  related_companies: string[]; // company symbols supporting the signal
  evidence_items: EvidenceItem[];

  founder_opportunity: string; // founder-mode call to action
  advisor_note: string; // advisor/mentor-mode framing
  build: BuildOpportunity;
  market?: MarketContext;

  // Scores are 0..100 for display. Computed by the ranking engine; any values
  // present on seed rows are treated as hints and recomputed.
  confidence_score: number;
  freshness_score: number;
  rank_score?: number; // final blended ranking score (engine-computed)

  source_attribution: string[]; // distinct source keys backing the signal
  tags?: string[];
  updated_at: string;
}

/** Query filters accepted by GET /api/signals. All optional; omitted = no filter. */
export interface SignalFilters {
  region?: string;
  country?: string;
  sector?: string;
  industry?: string;
  niche?: string;
  market_cap_band?: string;
  employee_band?: string;
  customer_type?: string;
  maturity_stage?: string;
  type?: string;
  q?: string; // free-text search across title/thesis/niche
  mode?: 'founder' | 'advisor'; // affects ordering + copy, not the data
  limit?: number;
}

/** KPI-strip payload for the dashboard header. */
export interface SignalKpis {
  active_signals: number;
  top_regions: Array<{ region: string; count: number }>;
  top_sectors: Array<{ sector: string; count: number }>;
  avg_confidence: number;
  freshest_updated_at: string | null;
  last_refreshed_at: string;
}
