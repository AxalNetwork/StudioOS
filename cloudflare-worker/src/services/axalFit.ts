/**
 * Task #19 — Axal Fit scoring engine.
 *
 * Encodes the methodology for the Conversational Profiling + Best-Fit Matching
 * feature: per-persona weighted rubrics, the 5 Axal behavioral values, red-flag
 * probes, and the 0..100 decision rule with bands.
 *
 * Split intentionally into:
 *   - a PURE core (RUBRICS / AXAL_VALUES / RED_FLAGS + scoreRubric /
 *     bandFromScore / signalQuality / detectRedFlags / narrativeFit) that is
 *     unit-tested without auth or D1 (test/axalFit.test.ts); and
 *   - a thin DB-aware orchestrator (computeFit / recomputeUserFit) that loads
 *     the answered fit signals from D1, runs the pure core, and appends the
 *     result to `axal_fit_scores`.
 *
 * The skill/value vectors + archetype are NOT recomputed here — they remain the
 * job of services/assessmentScoring.ts. axalFit only adds the rubric + the 5
 * Axal values + the decision rule on top of those existing signals.
 */
import type { Env } from '../types';
import { fitMeasuresIndex, type FitPersona, type FitMeasures } from './advisor/questionBank.ts';

export type { FitPersona } from './advisor/questionBank.ts';

// ---------------------------------------------------------------------------
// The 5 Axal behavioral values (asked of every persona).
// ---------------------------------------------------------------------------
export const AXAL_VALUES = [
  'integrity',
  'stewardship',
  'curiosity',
  'resilience',
  'collaboration',
] as const;
export type AxalValueKey = (typeof AXAL_VALUES)[number];

export interface AxalValueSpec {
  key: AxalValueKey;
  label: string;
  description: string;
}

export const VALUE_SPECS: Record<AxalValueKey, AxalValueSpec> = {
  integrity: {
    key: 'integrity',
    label: 'Integrity',
    description: 'Does what they said they would; owns mistakes instead of shifting blame.',
  },
  stewardship: {
    key: 'stewardship',
    label: 'Stewardship',
    description: 'Treats capital, people, and reputation as a trust to protect, not extract.',
  },
  curiosity: {
    key: 'curiosity',
    label: 'Curiosity',
    description: 'Seeks out what they do not know; updates beliefs on new evidence.',
  },
  resilience: {
    key: 'resilience',
    label: 'Resilience',
    description: 'Recovers from setbacks and keeps execution moving under pressure.',
  },
  collaboration: {
    key: 'collaboration',
    label: 'Collaboration',
    description: 'Builds with others; shares credit; puts the mission ahead of ego.',
  },
};

// ---------------------------------------------------------------------------
// Red flags (7). Probed via `measures.red_flag = { key, at_or_below }` on
// specific fit questions: when an answer's 0..5 score is at or below the
// threshold, the flag fires.
// ---------------------------------------------------------------------------
export const RED_FLAGS = [
  'overconfidence',
  'blame_shifting',
  'inconsistent_stories',
  'poor_follow_through',
  'ego_over_collaboration',
  'transactional',
  'weak_ethics',
] as const;
export type RedFlagKey = (typeof RED_FLAGS)[number];

export interface RedFlagSpec {
  key: RedFlagKey;
  label: string;
  description: string;
}

export const RED_FLAG_SPECS: Record<RedFlagKey, RedFlagSpec> = {
  overconfidence: {
    key: 'overconfidence',
    label: 'Overconfidence',
    description: 'Certainty out of proportion to evidence; low coachability.',
  },
  blame_shifting: {
    key: 'blame_shifting',
    label: 'Blame-shifting',
    description: 'Attributes failures to others or circumstance; weak ownership.',
  },
  inconsistent_stories: {
    key: 'inconsistent_stories',
    label: 'Inconsistent stories',
    description: 'Narrative shifts across the conversation; signals unreliability.',
  },
  poor_follow_through: {
    key: 'poor_follow_through',
    label: 'Poor follow-through',
    description: 'Starts more than they finish; commitments do not land.',
  },
  ego_over_collaboration: {
    key: 'ego_over_collaboration',
    label: 'Ego over collaboration',
    description: 'Prioritizes personal credit over the team or mission.',
  },
  transactional: {
    key: 'transactional',
    label: 'Transactional',
    description: 'Relationships framed purely as exchange; low stewardship.',
  },
  weak_ethics: {
    key: 'weak_ethics',
    label: 'Weak ethics',
    description: 'Comfortable cutting ethical corners under pressure.',
  },
};

// ---------------------------------------------------------------------------
// Per-persona weighted rubrics. Weights are RELATIVE — normalized by the sum
// of ANSWERED weights at score time, so a partially-answered rubric still
// produces a calibrated 0..100. Advisor and Coach share one rubric.
// ---------------------------------------------------------------------------
export type RubricCategoryScores = Record<string, number>; // category -> 0..5

const ADVISOR_COACH_RUBRIC: Record<string, number> = {
  domain_expertise: 25,
  teaching_ability: 20,
  listening: 15,
  founder_empathy: 15,
  reliability: 15,
  values_alignment: 10,
};

export const RUBRICS: Record<FitPersona, Record<string, number>> = {
  founder: {
    vision_clarity: 15,
    execution_ability: 20,
    domain_insight: 15,
    coachability: 15,
    resilience: 15,
    communication: 10,
    team_dynamics: 10,
    values_fit: 10,
  },
  investor: {
    thesis_fit: 20,
    capital_quality: 15,
    governance_style: 15,
    reputation: 20,
    decision_quality: 15,
    values_fit: 15,
  },
  partner: {
    strategic_alignment: 20,
    trustworthiness: 20,
    network_quality: 15,
    execution_support: 15,
    collaboration_style: 15,
    reputation: 15,
  },
  advisor: ADVISOR_COACH_RUBRIC,
  coach: ADVISOR_COACH_RUBRIC,
};

export const FIT_PERSONAS = Object.keys(RUBRICS) as FitPersona[];

export function isFitPersona(x: string): x is FitPersona {
  return Object.prototype.hasOwnProperty.call(RUBRICS, x);
}

// ---------------------------------------------------------------------------
// Bands.
// ---------------------------------------------------------------------------
export type FitBand = 'strong_yes' | 'yes_caution' | 'hold' | 'no';

export const BAND_LABEL: Record<FitBand, string> = {
  strong_yes: 'Strong yes',
  yes_caution: 'Yes, with caution',
  hold: 'Hold — more diligence',
  no: 'No',
};

export function bandFromScore(score: number): FitBand {
  if (score >= 85) return 'strong_yes';
  if (score >= 70) return 'yes_caution';
  if (score >= 55) return 'hold';
  return 'no';
}

// ---------------------------------------------------------------------------
// Pure scoring core.
// ---------------------------------------------------------------------------
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
const clamp01 = (n: number) => clamp(n, 0, 1);

export interface RubricCategoryResult {
  score: number;   // 0..5 (0 when unanswered)
  weight: number;  // relative weight from RUBRICS
  answered: boolean;
}

export interface RubricScoreResult {
  total_score: number;                                 // 0..100 over answered categories
  per_category: Record<string, RubricCategoryResult>;
  answered_weight: number;                             // Σ weights of answered categories
  total_weight: number;                                // Σ all rubric weights
  coverage: number;                                    // answered_weight / total_weight, 0..1
}

/**
 * total = Σ(weight × score/5) over ANSWERED categories ÷ Σ(answered weights) × 100.
 * Unanswered categories are excluded from the denominator (they don't drag the
 * score down) but are reported with answered:false + reflected in `coverage`.
 */
export function scoreRubric(persona: FitPersona, categoryScores: RubricCategoryScores): RubricScoreResult {
  const rubric = RUBRICS[persona] ?? {};
  const per_category: Record<string, RubricCategoryResult> = {};
  let answered_weight = 0;
  let total_weight = 0;
  let weighted_sum = 0;
  for (const [cat, weight] of Object.entries(rubric)) {
    total_weight += weight;
    const raw = categoryScores[cat];
    const answered = Number.isFinite(raw);
    if (answered) {
      const s = clamp(raw, 0, 5);
      answered_weight += weight;
      weighted_sum += weight * (s / 5);
      per_category[cat] = { score: s, weight, answered: true };
    } else {
      per_category[cat] = { score: 0, weight, answered: false };
    }
  }
  const total_score = answered_weight > 0 ? (weighted_sum / answered_weight) * 100 : 0;
  const coverage = total_weight > 0 ? answered_weight / total_weight : 0;
  return { total_score, per_category, answered_weight, total_weight, coverage };
}

/** signal_quality = 0.6×coverage + 0.4×mean value-confidence, clamped to 0..1. */
export function signalQuality(coverage: number, meanConfidence: number): number {
  return clamp01(0.6 * clamp01(coverage) + 0.4 * clamp01(meanConfidence));
}

export interface RedFlagProbe {
  key: RedFlagKey;
  score: number;        // the answer's 0..5 score
  at_or_below: number;  // threshold from measures.red_flag.at_or_below
}

/** A flag fires when an answered probe's score is at or below its threshold. */
export function detectRedFlags(probes: RedFlagProbe[]): RedFlagKey[] {
  const flagged = new Set<RedFlagKey>();
  for (const p of probes) {
    if (Number.isFinite(p.score) && p.score <= p.at_or_below) flagged.add(p.key);
  }
  return RED_FLAGS.filter((k) => flagged.has(k));
}

/** Deterministic one-paragraph narrative for the scorecard. */
export function narrativeFit(
  persona: FitPersona,
  rubric: RubricScoreResult,
  band: FitBand,
  redFlags: RedFlagKey[],
): string {
  const answered = Object.entries(rubric.per_category).filter(([, v]) => v.answered);
  if (answered.length === 0) {
    return `Not enough signal yet to assess ${persona} fit — continue the advisor conversation to build the scorecard.`;
  }
  const sorted = [...answered].sort((a, b) => b[1].score - a[1].score);
  const strengths = sorted.slice(0, 2).map(([k]) => k.replace(/_/g, ' '));
  const gaps = sorted.slice(-2).map(([k]) => k.replace(/_/g, ' '));
  const pct = Math.round(rubric.coverage * 100);
  let s = `${BAND_LABEL[band]} on ${persona} fit (${Math.round(rubric.total_score)}/100, ${pct}% covered).`;
  if (strengths.length) s += ` Strongest: ${strengths.join(', ')}.`;
  if (gaps.length && rubric.total_score < 85) s += ` Watch: ${gaps.join(', ')}.`;
  if (redFlags.length) s += ` Red flags: ${redFlags.map((f) => f.replace(/_/g, ' ')).join(', ')}.`;
  return s;
}

// ---------------------------------------------------------------------------
// DB-aware orchestration.
// ---------------------------------------------------------------------------
export interface FitResult {
  persona: FitPersona;
  total_score: number;        // 0..100 (rounded to 1 dp)
  band: FitBand;
  band_label: string;
  rubric: Record<string, RubricCategoryResult>;
  red_flags: RedFlagKey[];
  signal_quality: number;     // 0..1
  coverage: number;           // 0..1
  mean_confidence: number;    // 0..1
  narrative_fit: string;
  computed_at: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Read answered fit-question raw 0..5 scores from field_sources. */
async function loadAnsweredScores(
  env: Env,
  userId: number,
  questionIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (questionIds.length === 0) return out;
  try {
    const placeholders = questionIds.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT question_id, evidence_text FROM field_sources
        WHERE user_id = ? AND question_id IN (${placeholders})`,
    )
      .bind(userId, ...questionIds)
      .all<{ question_id: string; evidence_text: string | null }>();
    for (const r of rows.results || []) {
      const n = Number(String(r.evidence_text ?? '').trim());
      if (Number.isFinite(n)) out.set(r.question_id, clamp(n, 0, 5));
    }
  } catch (e) {
    console.error('[axalFit] loadAnsweredScores:', (e as Error).message);
  }
  return out;
}

/** Mean confidence across the user's 5 Axal values (0 when none recorded). */
async function loadAxalMeanConfidence(env: Env, userId: number): Promise<number> {
  try {
    const row = await env.DB.prepare(
      `SELECT AVG(confidence) AS c FROM axal_values WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ c: number | null }>();
    return clamp01(Number(row?.c ?? 0));
  } catch (e) {
    console.error('[axalFit] loadAxalMeanConfidence:', (e as Error).message);
    return 0;
  }
}

/**
 * Aggregate answered fit signals into per-category 0..5 scores (mean across the
 * questions tagged with that rubric_category) + the red-flag probes.
 */
function aggregateSignals(
  entries: { question_id: string; measures: FitMeasures }[],
  answered: Map<string, number>,
): { categoryScores: RubricCategoryScores; probes: RedFlagProbe[] } {
  const sums: Record<string, { sum: number; count: number }> = {};
  const probes: RedFlagProbe[] = [];
  for (const e of entries) {
    const score = answered.get(e.question_id);
    if (score == null) continue;
    const cat = e.measures.rubric_category;
    if (cat) {
      const acc = sums[cat] ?? (sums[cat] = { sum: 0, count: 0 });
      acc.sum += score;
      acc.count += 1;
    }
    const rf = e.measures.red_flag;
    if (rf && isRedFlagKey(rf.key)) {
      probes.push({ key: rf.key, score, at_or_below: rf.at_or_below });
    }
  }
  const categoryScores: RubricCategoryScores = {};
  for (const [cat, { sum, count }] of Object.entries(sums)) {
    if (count > 0) categoryScores[cat] = sum / count;
  }
  return { categoryScores, probes };
}

function isRedFlagKey(x: string): x is RedFlagKey {
  return (RED_FLAGS as readonly string[]).includes(x);
}

/**
 * Compute the Axal Fit for one persona from the user's answered fit signals.
 * Pure scoring is delegated to scoreRubric/detectRedFlags/etc.; this only loads
 * and (optionally) persists. Pass `{ persist: true }` to append an
 * `axal_fit_scores` history row (done by recomputeUserFit after each batch).
 */
export async function computeFit(
  env: Env,
  userId: number,
  persona: FitPersona,
  opts?: { persist?: boolean },
): Promise<FitResult> {
  const entries = fitMeasuresIndex().filter((e) => e.persona === persona);
  const answered = await loadAnsweredScores(env, userId, entries.map((e) => e.question_id));
  const { categoryScores, probes } = aggregateSignals(entries, answered);

  const rubric = scoreRubric(persona, categoryScores);
  const redFlags = detectRedFlags(probes);
  const meanConfidence = await loadAxalMeanConfidence(env, userId);
  const sq = signalQuality(rubric.coverage, meanConfidence);
  const band = bandFromScore(rubric.total_score);
  const narrative = narrativeFit(persona, rubric, band, redFlags);

  const result: FitResult = {
    persona,
    total_score: round1(rubric.total_score),
    band,
    band_label: BAND_LABEL[band],
    rubric: rubric.per_category,
    red_flags: redFlags,
    signal_quality: round1(sq * 100) / 100,
    coverage: round1(rubric.coverage * 100) / 100,
    mean_confidence: round1(meanConfidence * 100) / 100,
    narrative_fit: narrative,
    computed_at: new Date().toISOString(),
  };

  if (opts?.persist) await persistFit(env, userId, result);
  return result;
}

async function persistFit(env: Env, userId: number, r: FitResult): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO axal_fit_scores
         (user_id, persona, total_score, band, rubric_json, red_flags_json,
          signal_quality, narrative_fit, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        userId,
        r.persona,
        r.total_score,
        r.band,
        JSON.stringify(r.rubric),
        JSON.stringify(r.red_flags),
        r.signal_quality,
        r.narrative_fit,
        r.computed_at,
      )
      .run();
  } catch (e) {
    console.error('[axalFit] persistFit:', (e as Error).message);
  }
}

/**
 * Recompute + persist fit for every persona the user has answered fit
 * questions for. Called from the advisor /answer path after a batch lands.
 * Best-effort: never throws into the answer envelope.
 */
export async function recomputeUserFit(env: Env, userId: number): Promise<FitResult[]> {
  try {
    const idx = fitMeasuresIndex();
    const ids = idx.map((e) => e.question_id);
    const answered = await loadAnsweredScores(env, userId, ids);
    const personas = new Set<FitPersona>();
    for (const e of idx) {
      if (answered.has(e.question_id)) personas.add(e.persona);
    }
    const out: FitResult[] = [];
    for (const persona of personas) {
      out.push(await computeFit(env, userId, persona, { persist: true }));
    }
    return out;
  } catch (e) {
    console.error('[axalFit] recomputeUserFit:', (e as Error).message);
    return [];
  }
}

/** Latest persisted fit per persona (the "current" score). */
export async function loadLatestFit(
  env: Env,
  userId: number,
  persona: FitPersona,
): Promise<FitResult | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT persona, total_score, band, rubric_json, red_flags_json,
              signal_quality, narrative_fit, computed_at
         FROM axal_fit_scores
        WHERE user_id = ? AND persona = ?
        ORDER BY computed_at DESC, id DESC
        LIMIT 1`,
    )
      .bind(userId, persona)
      .first<{
        persona: string;
        total_score: number;
        band: string;
        rubric_json: string | null;
        red_flags_json: string | null;
        signal_quality: number;
        narrative_fit: string | null;
        computed_at: string;
      }>();
    if (!row) return null;
    const rubric = safeParse<Record<string, RubricCategoryResult>>(row.rubric_json, {});
    const redFlags = safeParse<RedFlagKey[]>(row.red_flags_json, []);
    const band = row.band as FitBand;
    return {
      persona: row.persona as FitPersona,
      total_score: row.total_score,
      band,
      band_label: BAND_LABEL[band] ?? row.band,
      rubric,
      red_flags: redFlags,
      signal_quality: row.signal_quality,
      coverage: coverageFromRubric(rubric),
      mean_confidence: 0,
      narrative_fit: row.narrative_fit ?? '',
      computed_at: row.computed_at,
    };
  } catch (e) {
    console.error('[axalFit] loadLatestFit:', (e as Error).message);
    return null;
  }
}

/** Latest fit across all personas the user has a score for. */
export async function loadAllLatestFit(env: Env, userId: number): Promise<FitResult[]> {
  const out: FitResult[] = [];
  for (const persona of FIT_PERSONAS) {
    const f = await loadLatestFit(env, userId, persona);
    if (f) out.push(f);
  }
  return out;
}

export interface AxalValueRow {
  value_key: AxalValueKey;
  score: number;
  confidence: number;
}

/** Read the user's 5 Axal behavioral values (for the report + dashboard). */
export async function loadAxalValues(env: Env, userId: number): Promise<AxalValueRow[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT value_key, score, confidence FROM axal_values WHERE user_id = ?`,
    )
      .bind(userId)
      .all<{ value_key: string; score: number; confidence: number }>();
    const byKey = new Map<string, { score: number; confidence: number }>();
    for (const r of rows.results || []) byKey.set(r.value_key, { score: r.score, confidence: r.confidence });
    return AXAL_VALUES.map((key) => ({
      value_key: key,
      score: byKey.get(key)?.score ?? 0,
      confidence: byKey.get(key)?.confidence ?? 0,
    }));
  } catch (e) {
    console.error('[axalFit] loadAxalValues:', (e as Error).message);
    return AXAL_VALUES.map((key) => ({ value_key: key, score: 0, confidence: 0 }));
  }
}

function coverageFromRubric(rubric: Record<string, RubricCategoryResult>): number {
  let total = 0;
  let answered = 0;
  for (const v of Object.values(rubric)) {
    total += v.weight;
    if (v.answered) answered += v.weight;
  }
  return total > 0 ? round1((answered / total) * 100) / 100 : 0;
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
