/**
 * Task #19 — Axal VC Fit & Values v2 decision engine.
 *
 * The v2 methodology combines the three profile layers that the existing engine
 * already produces — Values (services/axalFit.ts, now 6 with `ambition`),
 * Archetypes (services/archetypeScoring.ts, now 6 with Scout + Steward), and
 * Skills/capability (the per-persona weighted rubric in axal_fit_scores) — into
 * a single weighted 6-outcome decision, with evidence, contradiction validation,
 * and a confidence score.
 *
 * It is purely ADDITIVE: nothing here is written back to the profile tables, and
 * it reads only data v1 already computes, so it never breaks v1. It is
 * live-computed on read (no new table / migration) from the latest persisted
 * signals.
 *
 * Split like axalFit.ts:
 *   - a PURE core (OUTCOME_SPECS + computeFitV2Decision) unit-tested without
 *     auth or D1 (test/fitV2Decision.test.ts); and
 *   - a thin DB-aware orchestrator (loadFitV2Report) that gathers the layers
 *     from D1 and runs the pure core per persona.
 */
import type { Env } from '../types';
import {
  loadAxalValuesV2, loadAllLatestFit, bandFromScore, BAND_LABEL,
  type FitBand, type FitPersona, type FitV2ValueRow,
} from './axalFit.ts';
import { classifyArchetypeV2, loadPersonaTraitScores, type ArchetypeClassification } from './archetypeScoring.ts';

// ---------------------------------------------------------------------------
// The 6 weighted decision outcomes. Weights are RELATIVE — normalized by the
// sum of the outcomes that actually have signal, so a partially-profiled user
// still gets a calibrated 0..100 (mirrors scoreRubric in axalFit.ts).
// ---------------------------------------------------------------------------
export type OutcomeKey =
  | 'values_alignment'
  | 'drive_ambition'
  | 'capability'
  | 'archetype_clarity'
  | 'integrity_trust'
  | 'collaboration';

export interface OutcomeSpec {
  key: OutcomeKey;
  label: string;
  weight: number;
  description: string;
}

export const OUTCOME_SPECS: OutcomeSpec[] = [
  { key: 'values_alignment', label: 'Values alignment', weight: 22, description: 'Fit against the six Axal behavioral values.' },
  { key: 'drive_ambition', label: 'Drive & ambition', weight: 16, description: 'Ambition to build something lasting, backed by resilience.' },
  { key: 'capability', label: 'Capability', weight: 20, description: 'Role capability from the weighted fit rubric.' },
  { key: 'archetype_clarity', label: 'Archetype clarity', weight: 12, description: 'How clearly a role archetype emerges from the signal.' },
  { key: 'integrity_trust', label: 'Integrity & trust', weight: 20, description: 'Integrity and stewardship, net of any red flags.' },
  { key: 'collaboration', label: 'Collaboration', weight: 10, description: 'Shares credit, puts mission ahead of ego.' },
];

// ---------------------------------------------------------------------------
// Pure scoring core.
// ---------------------------------------------------------------------------
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
const clamp01 = (n: number) => clamp(n, 0, 1);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OutcomeResult {
  key: OutcomeKey;
  label: string;
  score: number;     // 0..100 (0 when no signal)
  weight: number;
  answered: boolean;
  contributes: string[]; // human-readable evidence
}

export interface ValidationNote {
  key: string;
  label: string;
  severity: 'info' | 'warn' | 'flag';
  note: string;
}

export interface FitV2PersonaDecision {
  persona: FitPersona;
  overall_score: number;   // 0..100
  band: FitBand;
  band_label: string;
  outcomes: OutcomeResult[];
  archetype: { slug: string; label: string; tagline: string; confidence: number } | null;
  confidence: number;      // 0..1
  coverage: number;        // 0..1 — share of outcome weight with signal
  validation: ValidationNote[];
  narrative: string;
  computed_at: string;
}

export interface FitV2DecisionInput {
  persona: FitPersona;
  values: FitV2ValueRow[];          // 6 rows (score 0..1, confidence 0..1)
  fitScore: number | null;          // 0..100 rubric total, or null
  redFlags: string[];               // fired red-flag keys from the persona fit
  archetype: ArchetypeClassification | null;
  computed_at: string;
}

function valueScore(values: FitV2ValueRow[], key: string): FitV2ValueRow | undefined {
  return values.find((v) => v.value_key === key);
}
/** A value counts as "signal" only once its confidence is above zero. */
function signalScore(v: FitV2ValueRow | undefined): number | null {
  if (!v || Number(v.confidence) <= 0) return null;
  return clamp01(Number(v.score) || 0);
}
function meanOf(nums: (number | null)[]): number | null {
  const present = nums.filter((n): n is number => n != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Compute the weighted 6-outcome v2 decision. Pure: no I/O. Outcomes with no
 * signal are excluded from the denominator (they don't drag the score down) but
 * are reported with answered:false.
 */
export function computeFitV2Decision(input: FitV2DecisionInput): FitV2PersonaDecision {
  const { persona, values, fitScore, redFlags, archetype } = input;

  const integrity = signalScore(valueScore(values, 'integrity'));
  const stewardship = signalScore(valueScore(values, 'stewardship'));
  const collaboration = signalScore(valueScore(values, 'collaboration'));
  const curiosity = signalScore(valueScore(values, 'curiosity'));
  const resilience = signalScore(valueScore(values, 'resilience'));
  const ambition = signalScore(valueScore(values, 'ambition'));
  const anyValue = [integrity, stewardship, collaboration, curiosity, resilience, ambition]
    .some((v) => v != null);

  const outcomes: OutcomeResult[] = [];
  const pushOutcome = (spec: OutcomeSpec, score01: number | null, contributes: string[]) => {
    const answered = score01 != null;
    outcomes.push({
      key: spec.key,
      label: spec.label,
      score: answered ? round1(clamp01(score01 as number) * 100) : 0,
      weight: spec.weight,
      answered,
      contributes,
    });
  };
  const spec = (k: OutcomeKey) => OUTCOME_SPECS.find((s) => s.key === k) as OutcomeSpec;

  // 1. Values alignment — mean of all 6 measured values.
  pushOutcome(
    spec('values_alignment'),
    anyValue ? meanOf([integrity, stewardship, collaboration, curiosity, resilience, ambition]) : null,
    anyValue ? ['Axal behavioral values'] : [],
  );

  // 2. Drive & ambition — ambition, backed by resilience.
  pushOutcome(
    spec('drive_ambition'),
    meanOf([ambition, resilience]),
    [ambition != null ? 'Ambition' : '', resilience != null ? 'Resilience' : ''].filter(Boolean),
  );

  // 3. Capability — the persona's weighted fit rubric total (already 0..100).
  pushOutcome(
    spec('capability'),
    fitScore != null ? clamp01(fitScore / 100) : null,
    fitScore != null ? ['Weighted fit rubric'] : [],
  );

  // 4. Archetype clarity — how cleanly a role archetype emerged.
  pushOutcome(
    spec('archetype_clarity'),
    archetype ? clamp01(archetype.confidence) : null,
    archetype ? [`Archetype: ${archetype.label}`] : [],
  );

  // 5. Integrity & trust — integrity + stewardship, net of red flags (−15 each).
  // When there is NO integrity/stewardship value signal, the outcome stays
  // unanswered (null) even if red flags fired — red flags never manufacture a
  // *positive* trust reading (that would inflate the score on sparse profiles);
  // they still surface as `flag` validation notes below.
  const baseIntegrity = meanOf([integrity, stewardship]);
  let integrityScore: number | null = baseIntegrity;
  if (integrityScore != null && redFlags.length > 0) {
    integrityScore = clamp01(integrityScore - 0.15 * redFlags.length);
  }
  pushOutcome(
    spec('integrity_trust'),
    integrityScore,
    [
      integrity != null ? 'Integrity' : '',
      stewardship != null ? 'Stewardship' : '',
      redFlags.length ? `${redFlags.length} red flag${redFlags.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean),
  );

  // 6. Collaboration.
  pushOutcome(
    spec('collaboration'),
    collaboration,
    collaboration != null ? ['Collaboration'] : [],
  );

  // Weighted overall over answered outcomes.
  let answeredWeight = 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const o of outcomes) {
    totalWeight += o.weight;
    if (o.answered) {
      answeredWeight += o.weight;
      weightedSum += o.weight * (o.score / 100);
    }
  }
  const overall = answeredWeight > 0 ? round1((weightedSum / answeredWeight) * 100) : 0;
  const coverage = totalWeight > 0 ? round2(answeredWeight / totalWeight) : 0;
  const band = bandFromScore(overall);

  // Confidence blends layer coverage with mean value confidence.
  const measuredValueConf = values.filter((v) => Number(v.confidence) > 0).map((v) => Number(v.confidence));
  const meanValueConf = measuredValueConf.length
    ? measuredValueConf.reduce((a, b) => a + b, 0) / measuredValueConf.length
    : 0;
  const confidence = round2(clamp01(0.5 * coverage + 0.5 * clamp01(meanValueConf)));

  // Validation — contradictions + red flags + thin signal.
  const validation: ValidationNote[] = [];
  if (ambition != null && ambition >= 0.8 && integrity != null && integrity <= 0.4) {
    validation.push({
      key: 'ambition_vs_integrity', label: 'Ambition outpaces integrity', severity: 'warn',
      note: 'High drive with a thin integrity signal — validate how they hold ethical lines under pressure.',
    });
  }
  if (ambition != null && ambition <= 0.3 && (fitScore ?? 0) >= 75) {
    validation.push({
      key: 'capability_vs_drive', label: 'Capable but low drive', severity: 'info',
      note: 'Strong capability but low stated ambition — check motivation and staying power.',
    });
  }
  for (const rf of redFlags) {
    validation.push({
      key: `red_flag:${rf}`, label: `Red flag: ${rf.replace(/_/g, ' ')}`, severity: 'flag',
      note: `A self-rating tripped the ${rf.replace(/_/g, ' ')} probe — diligence recommended.`,
    });
  }
  if (coverage < 0.4) {
    validation.push({
      key: 'thin_signal', label: 'Limited signal', severity: 'info',
      note: 'Not enough profiling yet — keep talking to the advisor to sharpen this decision.',
    });
  }

  const narrative = buildNarrative(persona, overall, band, outcomes, redFlags, coverage);

  return {
    persona,
    overall_score: overall,
    band,
    band_label: BAND_LABEL[band],
    outcomes,
    archetype: archetype
      ? { slug: archetype.slug, label: archetype.label, tagline: archetype.tagline, confidence: round2(archetype.confidence) }
      : null,
    confidence,
    coverage,
    validation,
    narrative,
    computed_at: input.computed_at,
  };
}

function buildNarrative(
  persona: FitPersona,
  overall: number,
  band: FitBand,
  outcomes: OutcomeResult[],
  redFlags: string[],
  coverage: number,
): string {
  const answered = outcomes.filter((o) => o.answered);
  if (answered.length === 0) {
    return `Not enough signal yet to build a v2 fit decision for ${persona} — continue the advisor conversation.`;
  }
  const sorted = [...answered].sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 2).map((o) => o.label.toLowerCase());
  const gaps = sorted.slice(-2).map((o) => o.label.toLowerCase());
  let s = `${BAND_LABEL[band]} on ${persona} v2 fit (${Math.round(overall)}/100, ${Math.round(coverage * 100)}% covered).`;
  if (strengths.length) s += ` Strongest: ${strengths.join(', ')}.`;
  if (gaps.length && overall < 85) s += ` Watch: ${gaps.join(', ')}.`;
  if (redFlags.length) s += ` Red flags: ${redFlags.map((f) => f.replace(/_/g, ' ')).join(', ')}.`;
  return s;
}

// ---------------------------------------------------------------------------
// DB-aware orchestration.
// ---------------------------------------------------------------------------
export interface FitV2Report {
  version: 2;
  values: FitV2ValueRow[];              // persona-agnostic (6 values, incl ambition)
  personas: FitV2PersonaDecision[];     // one per persona the user has fit signal for
  primary_persona: FitPersona | null;
  computed_at: string | null;
}

/**
 * Build the caller's full v2 report: the 6 values, plus a weighted 6-outcome
 * decision for each persona the user has a persisted fit score for. Live-
 * computed; never persists. Best-effort — returns an empty report on error.
 */
export async function loadFitV2Report(env: Env, userId: number): Promise<FitV2Report> {
  const empty: FitV2Report = { version: 2, values: [], personas: [], primary_persona: null, computed_at: null };
  try {
    const [values, fits] = await Promise.all([
      loadAxalValuesV2(env, userId),
      loadAllLatestFit(env, userId),
    ]);

    const personas: FitV2PersonaDecision[] = [];
    for (const fit of fits) {
      const traits = await loadPersonaTraitScores(env, userId, fit.persona);
      const archetype = classifyArchetypeV2(fit.persona, traits);
      personas.push(computeFitV2Decision({
        persona: fit.persona,
        values,
        fitScore: fit.total_score,
        redFlags: fit.red_flags || [],
        archetype,
        computed_at: fit.computed_at,
      }));
    }

    personas.sort((a, b) => b.overall_score - a.overall_score);
    const primary = personas[0] || null;
    const computed_at = personas.reduce<string | null>(
      (acc, p) => (p.computed_at && (!acc || p.computed_at > acc) ? p.computed_at : acc),
      null,
    );
    return {
      version: 2,
      values,
      personas,
      primary_persona: primary ? primary.persona : null,
      computed_at,
    };
  } catch (e) {
    console.error('[fitV2Decision] loadFitV2Report:', (e as Error).message);
    return empty;
  }
}
