/**
 * Task #45 — Profiling module registry (the new question-bank architecture).
 *
 * The Profile & Fit page draws five surfaces from the conversational profiling
 * bank: a Skills radar, a Work-values profile, an Archetype, an Axal Fit score,
 * and Best-Fit matches. Before this task the "Profiling completion" card counted
 * the whole fit.* bank as one flat denominator (e.g. mentor 2 + 1 + 14 = 17) and
 * had no Archetype module at all — so the card read "0 / 17 answered" and the
 * Archetype card read "missing" no matter how far the conversation went.
 *
 * This module replaces that shallow count with an explicit, extensible model:
 *
 *   - Four MODULES: skills · work_values · archetype · axal_fit.
 *   - Each module has a `floor` = the number of answered questions needed to
 *     reach confidence, and a `targetCoverage` = the number of DISTINCT axes /
 *     dimensions / traits / rubric categories we want represented. The card's
 *     denominator is `min(floor, questions available in this bank)` — a real
 *     "required to be confident" number, never a fabricated total.
 *   - Completion is per-module + overall; a module is `confident` once it has
 *     enough answers, and the profile is `complete` once every applicable
 *     module is confident. The user is never forced through the whole bank.
 *
 * Everything here is PURE (no D1, no auth) so it unit-tests cleanly and the
 * route layer / write-router can share the exact same math the UI renders.
 */
import type { Question } from './questionBank.ts';
import {
  FIT_ID_RE,
  PROFILING_SECTION_LABELS,
  PROFILING_SECTION_ORDER,
  profilingSectionForQuestion,
  type ProfilingSectionKey,
} from './questionBank.ts';

export interface ProfilingModuleSpec {
  key: ProfilingSectionKey;
  label: string;
  /**
   * Answers needed to call the module "confident". The card denominator is
   * `min(floor, available)` so a persona whose bank is thinner than the floor
   * still shows an honest, reachable target instead of an impossible one.
   */
  floor: number;
  /**
   * Distinct axes / dimensions / traits / rubric categories we want covered.
   * Reported for transparency and used to steer adaptive follow-ups toward the
   * gaps; it does NOT gate `confident` (a thin bank could never satisfy it).
   */
  targetCoverage: number;
  /** One-line rationale surfaced in the module tooltip / docs. */
  rationale: string;
}

/**
 * The four modules, in render order. Floors are deliberately modest — the whole
 * point is a conversational profile, not a survey. Reaching every floor lands a
 * user around ~20 answered questions total across the four modules, enough to
 * draw a real radar, a values wheel, classify an archetype, and compute a
 * calibrated Axal Fit — without a 200-question slog.
 */
export const PROFILING_MODULES: Record<ProfilingSectionKey, ProfilingModuleSpec> = {
  skills: {
    key: 'skills',
    label: PROFILING_SECTION_LABELS.skills,
    floor: 5,
    targetCoverage: 5, // ≥5 of the 8 radar axes gives the spider a real shape
    rationale: 'Cover enough of the 8 radar axes to draw a credible skills profile.',
  },
  work_values: {
    key: 'work_values',
    label: PROFILING_SECTION_LABELS.work_values,
    floor: 4,
    targetCoverage: 4, // ≥4 value dimensions → a meaningful values wheel
    rationale: 'Enough value dimensions to plot a values wheel, not a single lean.',
  },
  archetype: {
    key: 'archetype',
    label: PROFILING_SECTION_LABELS.archetype,
    floor: 3,
    targetCoverage: 3, // ≥3 of the 4 trait axes → a confident classification
    rationale: 'Enough trait signal to classify the user into a role archetype.',
  },
  axal_fit: {
    key: 'axal_fit',
    label: PROFILING_SECTION_LABELS.axal_fit,
    floor: 8,
    targetCoverage: 6, // most rubric categories + a few of the 5 Axal values
    rationale: 'Cover the rubric + Axal values to compute a calibrated Fit band.',
  },
};

/** The module a fit question belongs to (single-bucket, priority ordered). */
export function moduleForQuestion(q: Question): ProfilingSectionKey {
  return profilingSectionForQuestion(q);
}

/**
 * The distinct "coverage key" a question contributes to inside its module:
 *   skills → skill_axis · work_values → value_dim · archetype → archetype_trait
 *   axal_fit → rubric_category, else axal_value.
 * Returns null when the question carries no coverage tag (counts toward the
 * answered floor but not toward distinct coverage).
 */
export function coverageKeyForQuestion(q: Question): string | null {
  const m = q.measures;
  if (!m) return null;
  switch (moduleForQuestion(q)) {
    case 'skills': return m.skill_axis ?? null;
    case 'work_values': return m.value_dim ?? null;
    case 'archetype': return m.archetype_trait ?? null;
    case 'axal_fit': return m.rubric_category ?? m.axal_value ?? null;
  }
}

export interface ModuleCompletion {
  key: ProfilingSectionKey;
  label: string;
  /** Questions in this module answered by the user. */
  answered: number;
  /** Honest denominator = min(floor, available in bank). */
  required: number;
  /** Total questions this bank offers for the module (adaptive headroom). */
  available: number;
  /** Distinct coverage keys answered vs the module's target. */
  coverage: number;
  target_coverage: number;
  /** 0..100, capped — answered/required. */
  percent: number;
  /** answered ≥ required. */
  confident: boolean;
}

export interface ProfilingCompletion {
  applicable: boolean;
  modules: ModuleCompletion[];
  /** Answers that count toward any module floor (Σ min(answered, required)). */
  answered: number;
  /** Σ required across modules. */
  required: number;
  /** 0..100 across modules, weighted by each module's required count. */
  percent: number;
  /** Every applicable module is confident. */
  complete: boolean;
}

/** Only the fit.* questions of a bank participate in profiling completion. */
function fitQuestions(bank: Question[]): Question[] {
  return bank.filter((q) => FIT_ID_RE.test(q.id));
}

/**
 * Compute per-module + overall profiling completion for a bank given the set of
 * answered question ids. Confidence is `answered ≥ required` where
 * `required = min(floor, available)`, so the denominators are real and
 * reachable. Overall percent is required-weighted so a big module (Axal Fit)
 * pulls proportionally more than a small one (Archetype).
 */
export function computeProfilingCompletion(
  bank: Question[],
  answered: Set<string>,
): ProfilingCompletion {
  const fit = fitQuestions(bank);
  const byModule = new Map<ProfilingSectionKey, Question[]>();
  for (const k of PROFILING_SECTION_ORDER) byModule.set(k, []);
  for (const q of fit) byModule.get(moduleForQuestion(q))!.push(q);

  const modules: ModuleCompletion[] = [];
  let answeredScore = 0;
  let requiredScore = 0;

  for (const key of PROFILING_SECTION_ORDER) {
    const qs = byModule.get(key)!;
    if (qs.length === 0) continue; // module not offered by this bank
    const spec = PROFILING_MODULES[key];
    const available = qs.length;
    const required = Math.min(spec.floor, available);
    const answeredIds = qs.filter((q) => answered.has(q.id));
    const answeredCount = answeredIds.length;
    const coverKeys = new Set<string>();
    for (const q of answeredIds) {
      const ck = coverageKeyForQuestion(q);
      if (ck) coverKeys.add(ck);
    }
    const percent = required > 0 ? Math.min(100, Math.round((answeredCount / required) * 100)) : 100;
    modules.push({
      key,
      label: spec.label,
      answered: answeredCount,
      required,
      available,
      coverage: coverKeys.size,
      target_coverage: Math.min(spec.targetCoverage, available),
      percent,
      confident: answeredCount >= required,
    });
    // Overall uses capped contribution so over-answering one module can't mask
    // a neglected one.
    answeredScore += Math.min(answeredCount, required);
    requiredScore += required;
  }

  const applicable = modules.length > 0;
  const percent = requiredScore > 0 ? Math.round((answeredScore / requiredScore) * 100) : 0;
  return {
    applicable,
    modules,
    answered: answeredScore,
    required: requiredScore,
    percent,
    complete: applicable && modules.every((m) => m.confident),
  };
}

// ---------------------------------------------------------------------------
// Adaptive selection.
//
// The whole design goal: ask the RIGHT questions, not ALL of them. Given a
// bank + what's already answered, `selectAdaptiveProfiling` returns the fit
// questions still worth asking, ORDERED so the advisor:
//   1. skips modules that are already confident (no busywork);
//   2. within the remaining modules, prefers questions that cover an axis /
//      dimension / trait not yet answered (fill the gaps, don't pile onto a
//      covered axis);
//   3. breaks ties by the module's distance from confidence (most-behind first)
//      then original bank order (stable, deterministic).
// The route's re-ranker still gets the final say on phrasing/flow; this just
// trims + prioritises the candidate pool it sees.
// ---------------------------------------------------------------------------
export interface AdaptiveOptions {
  /** Keep questions from already-confident modules too (default false). */
  includeConfidentModules?: boolean;
}

export function selectAdaptiveProfiling(
  bank: Question[],
  answered: Set<string>,
  opts: AdaptiveOptions = {},
): Question[] {
  const completion = computeProfilingCompletion(bank, answered);
  const moduleState = new Map<ProfilingSectionKey, ModuleCompletion>();
  for (const m of completion.modules) moduleState.set(m.key, m);

  // Distinct coverage keys already answered, per module.
  const coveredByModule = new Map<ProfilingSectionKey, Set<string>>();
  for (const q of fitQuestions(bank)) {
    if (!answered.has(q.id)) continue;
    const mod = moduleForQuestion(q);
    const ck = coverageKeyForQuestion(q);
    if (!ck) continue;
    let s = coveredByModule.get(mod);
    if (!s) { s = new Set(); coveredByModule.set(mod, s); }
    s.add(ck);
  }

  const unanswered = fitQuestions(bank).filter((q) => !answered.has(q.id));
  const scored = unanswered
    .map((q, idx) => {
      const mod = moduleForQuestion(q);
      const state = moduleState.get(mod);
      const confident = state?.confident ?? false;
      const ck = coverageKeyForQuestion(q);
      const covered = ck ? (coveredByModule.get(mod)?.has(ck) ?? false) : false;
      // Distance-from-confidence: how many more answers this module needs.
      const deficit = state ? Math.max(0, state.required - state.answered) : 0;
      return { q, idx, mod, confident, fillsGap: ck != null && !covered, deficit };
    })
    .filter((s) => opts.includeConfidentModules || !s.confident)
    .sort((a, b) => {
      // 1. gap-filling questions first
      if (a.fillsGap !== b.fillsGap) return a.fillsGap ? -1 : 1;
      // 2. modules furthest from confidence first
      if (a.deficit !== b.deficit) return b.deficit - a.deficit;
      // 3. stable bank order
      return a.idx - b.idx;
    });

  return scored.map((s) => s.q);
}
