/**
 * Signals — ranking + confidence engine.
 *
 * PRODUCT PRINCIPLE (do not drift from this): the ranking favours PRACTICAL
 * startup opportunities — a founder should be able to act on the top card. It
 * deliberately does NOT reward:
 *   • the largest companies (mega-cap-only signals are penalised), or
 *   • the noisiest headlines (news evidence has a low source weight and, on its
 *     own, cannot float a signal to the top — cross-source agreement is what
 *     the ranker pays for).
 *
 * Two scores are surfaced on every card:
 *   confidence_score (0..100) — HOW CREDIBLE is the signal? Driven by source
 *     quality, cross-source agreement, and freshness.
 *   rank_score (0..100)       — HOW ACTIONABLE / worth-surfacing is it? The
 *     blended sort key. Confidence is one input; buildability + cap diversity +
 *     customer-pain also matter.
 *
 * Everything is transparent: computeRankScore returns a `breakdown` so the UI
 * (and docs) can explain exactly why a card ranks where it does.
 */
import type { Signal, NormalizedCompany, MarketCapBand, EvidenceItem } from './types';
import { sourceQuality, sourceHalflife } from './sources';

const DAY_MS = 86400000;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function ageDays(iso: string): number {
  const t = Date.parse(iso);
  if (!isFinite(t)) return 365;
  return Math.max(0, (Date.now() - t) / DAY_MS);
}

/** Per-evidence freshness via exponential half-life decay: 0.5^(age/halflife). */
function evidenceFreshness(ev: EvidenceItem): number {
  const half = sourceHalflife(ev.source_key);
  return clamp01(Math.pow(0.5, ageDays(ev.observed_at) / Math.max(1, half)));
}

/**
 * Freshness score (0..100). Blends the FRESHEST evidence (recency of the latest
 * datum) with the AVERAGE (a signal backed by many recent items beats one lucky
 * fresh headline). 70/30 toward the freshest.
 */
export function computeFreshness(signal: Signal): number {
  const evs = signal.evidence_items || [];
  if (!evs.length) return 0;
  const fresh = evs.map(evidenceFreshness);
  const max = Math.max(...fresh);
  const avg = fresh.reduce((a, b) => a + b, 0) / fresh.length;
  return Math.round((0.7 * max + 0.3 * avg) * 100);
}

/** Distinct evidence KINDS present — the cross-source-agreement primitive. */
function distinctKinds(evs: EvidenceItem[]): number {
  return new Set(evs.map((e) => e.kind)).size;
}

/**
 * Confidence score (0..100). A signal is credible when MULTIPLE INDEPENDENT,
 * HIGH-QUALITY, RECENT sources agree.
 *   quality       — evidence-weight-averaged source quality
 *   agreement     — how many distinct source kinds corroborate (saturating)
 *   freshness     — recency (reuses computeFreshness)
 * A single-source signal is capped so it can never read as "high confidence".
 */
export function computeConfidence(signal: Signal): number {
  const evs = signal.evidence_items || [];
  if (!evs.length) return 0;

  // Evidence-weighted source quality.
  let wSum = 0;
  let qSum = 0;
  for (const e of evs) {
    const w = e.weight ?? sourceQuality(e.source_key);
    wSum += w;
    qSum += w * sourceQuality(e.source_key);
  }
  const quality = wSum > 0 ? qSum / wSum : 0;

  // Cross-source agreement — 1 kind = 0.35, 2 = 0.7, 3 = 0.9, 4+ = 1.0.
  const kinds = distinctKinds(evs);
  const agreementTable = [0, 0.35, 0.7, 0.9, 1.0];
  const agreement = agreementTable[Math.min(kinds, 4)];

  const freshness = computeFreshness(signal) / 100;

  let score = 100 * (0.45 * quality + 0.35 * agreement + 0.2 * freshness);

  // Single-source hard cap: cannot exceed 55 no matter how fresh/high-quality.
  if (kinds <= 1) score = Math.min(score, 55);

  return Math.round(clamp01(score / 100) * 100);
}

// --- Rank-score sub-factors ------------------------------------------------

/** Effective evidence volume with diminishing returns, weighted by source
 *  quality so 5 low-weight headlines < 2 filings. Saturates ~ 6 quality-units. */
function evidenceVolume(evs: EvidenceItem[]): number {
  const effective = evs.reduce((a, e) => a + (e.weight ?? sourceQuality(e.source_key)), 0);
  return clamp01(effective / 4); // 4 quality-units ≈ a well-evidenced signal
}

/** Market-cap DIVERSITY across the supporting companies. A signal spanning
 *  micro→mid caps is more "there's room to build here" than one that is only
 *  three mega-caps. Rewards spread; a single band scores low. */
function capDiversity(companies: NormalizedCompany[]): number {
  const bands = companies.map((c) => c.market_cap_band).filter(Boolean) as MarketCapBand[];
  if (!bands.length) return 0.4; // unknown — neutral-ish
  const distinct = new Set(bands).size;
  return clamp01((distinct - 1) / 3 + 0.25); // 1 band→0.25, 4+→1.0
}

/** PRACTICALITY bias — reward signals anchored in buildable bands (micro/small/
 *  mid) and penalise mega-cap-only stories. This is the "not the biggest
 *  companies" guard, applied at the signal's representative band + supporters. */
function practicality(signal: Signal, companies: NormalizedCompany[]): number {
  const bandScore: Record<MarketCapBand, number> = {
    nano: 0.7, micro: 0.95, small: 1.0, mid: 0.85, large: 0.5, mega: 0.25,
  };
  const rep = bandScore[signal.market_cap_band] ?? 0.6;
  const supp = companies.map((c) => c.market_cap_band).filter(Boolean) as MarketCapBand[];
  const suppAvg = supp.length
    ? supp.reduce((a, b) => a + (bandScore[b] ?? 0.6), 0) / supp.length
    : rep;
  return clamp01(0.5 * rep + 0.5 * suppAvg);
}

/** Sector repetition — multiple supporters sharing the signal's sector is
 *  corroborating (a real pattern, not one company's quirk). Fraction of
 *  supporters in-sector, floored so a thin roster isn't zeroed. */
function sectorRepetition(signal: Signal, companies: NormalizedCompany[]): number {
  if (!companies.length) return 0.4;
  const inSector = companies.filter(
    (c) => (c.sector || '').toLowerCase() === signal.sector.toLowerCase(),
  ).length;
  return clamp01(0.3 + 0.7 * (inSector / companies.length));
}

/** Geographic concentration — supporters clustered in the signal's region make
 *  a geographic thesis sharper. Fraction of supporters in-region. */
function geoConcentration(signal: Signal, companies: NormalizedCompany[]): number {
  if (!companies.length) return 0.4;
  const inRegion = companies.filter((c) => c.region === signal.region).length;
  return clamp01(0.25 + 0.75 * (inRegion / companies.length));
}

/**
 * Customer-pain proxy inferred from PUBLIC data cues (no private data). Certain
 * evidence kinds imply acute, budgeted pain a founder can sell into:
 *   filing/earnings language  → strategic priority named in an SEC filing
 *   registry                  → new-entity / compliance-driven formation
 *   hiring                    → roles opening = manual workflow to automate
 * Regulatory-pressure & workflow-digitization signal types get a small bump
 * because their whole thesis is "someone is forced to spend".
 */
function customerPain(signal: Signal): number {
  const kinds = new Set((signal.evidence_items || []).map((e) => e.kind));
  let pain = 0.35;
  if (kinds.has('filing')) pain += 0.2;
  if (kinds.has('earnings')) pain += 0.15;
  if (kinds.has('hiring')) pain += 0.12;
  if (kinds.has('registry')) pain += 0.1;
  if (signal.type === 'regulatory_pressure' || signal.type === 'workflow_digitization') pain += 0.12;
  return clamp01(pain);
}

export interface RankBreakdown {
  evidence_volume: number;
  freshness: number;
  cross_source_agreement: number;
  cap_diversity: number;
  sector_repetition: number;
  geo_concentration: number;
  customer_pain: number;
  practicality: number;
}

// Weights sum to 1.0. Tuned so that: freshness + agreement + evidence dominate
// credibility, while practicality + pain + diversity encode "is this a startup
// opportunity" — the thing that separates this engine from a market screener.
const WEIGHTS: RankBreakdown = {
  evidence_volume: 0.14,
  freshness: 0.16,
  cross_source_agreement: 0.16,
  cap_diversity: 0.12,
  sector_repetition: 0.08,
  geo_concentration: 0.08,
  customer_pain: 0.13,
  practicality: 0.13,
};

/**
 * Blended rank score (0..100) + factor breakdown. `companies` is the roster of
 * NormalizedCompany rows for this signal's related symbols (may be partial;
 * missing rows just make the diversity/sector/geo factors fall back to neutral).
 */
export function computeRankScore(
  signal: Signal,
  companies: NormalizedCompany[],
): { score: number; breakdown: RankBreakdown } {
  const evs = signal.evidence_items || [];
  const kinds = distinctKinds(evs);
  const breakdown: RankBreakdown = {
    evidence_volume: evidenceVolume(evs),
    freshness: computeFreshness(signal) / 100,
    cross_source_agreement: clamp01(kinds / 4),
    cap_diversity: capDiversity(companies),
    sector_repetition: sectorRepetition(signal, companies),
    geo_concentration: geoConcentration(signal, companies),
    customer_pain: customerPain(signal),
    practicality: practicality(signal, companies),
  };
  let score = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof RankBreakdown)[]) {
    score += WEIGHTS[k] * breakdown[k];
  }
  return { score: Math.round(clamp01(score) * 100), breakdown };
}

export const RANK_WEIGHTS = WEIGHTS;

/**
 * Score + sort a list of signals. `mode` nudges ORDERING only (never the data):
 *   founder → tie-break toward higher practicality (build-ability first)
 *   advisor → tie-break toward higher confidence (defensible to recommend)
 */
export function rankSignals(
  signals: Signal[],
  companiesBySymbol: Record<string, NormalizedCompany>,
  mode: 'founder' | 'advisor' = 'founder',
): Array<Signal & { rank_breakdown: RankBreakdown }> {
  const scored = signals.map((s) => {
    const companies = (s.related_companies || [])
      .map((sym) => companiesBySymbol[sym])
      .filter(Boolean) as NormalizedCompany[];
    const { score, breakdown } = computeRankScore(s, companies);
    return {
      ...s,
      confidence_score: computeConfidence(s),
      freshness_score: computeFreshness(s),
      rank_score: score,
      rank_breakdown: breakdown,
    };
  });

  scored.sort((a, b) => {
    if (b.rank_score !== a.rank_score) return b.rank_score - a.rank_score;
    if (mode === 'advisor') return b.confidence_score - a.confidence_score;
    return b.rank_breakdown.practicality - a.rank_breakdown.practicality;
  });
  return scored;
}
