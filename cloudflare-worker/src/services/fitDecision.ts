/**
 * Fit v2 — the three-layer decision engine.
 *
 * Scores Values, Archetypes, and Skills INDEPENDENTLY from the answered v2
 * bank, then combines them into a six-outcome decision:
 *
 *   insufficient_evidence | misaligned | low_fit | conditional_fit |
 *   specialist_fit | high_fit
 *
 * Design contract (mirrors axalFit.ts):
 *   - Pure core (no auth, no DB) + a thin D1 orchestrator at the bottom.
 *   - Deterministic and explainable: no LLM in the scoring path; every number
 *     traces to an item response and a template weight.
 *   - Calibrated, not absolute: normalization runs over ANSWERED weights, so
 *     partial profiles score honestly and report low coverage/confidence
 *     instead of being dragged to zero.
 *   - Culture fit (values vs the Axal baseline) and role fit (template-weighted
 *     skills + rubric) are ALWAYS computed and reported separately.
 *   - Confidence gates the rubric; it never inflates a score.
 *
 * v1 (axalFit.ts / archetypeScoring.ts) keeps running unchanged; this engine
 * only ever writes the append-only fit_decisions table.
 *
 * Raw-answer store: field_sources.evidence_text keyed by question_id — both
 * the conversational advisor (routes/advisor.ts) and the staged flow
 * (routes/fit.ts) persist the raw v2 answer string there.
 *
 * See design/AXAL_VC_FIT_V2_METHODOLOGY.md for the human-readable spec.
 */
import type { Env } from '../types';
import type { Question, FitV2Kind } from './advisor/questionBank.ts';
import { fitV2BankFor } from './advisor/questionBank.ts';
import {
  FIT_ROLE_TEMPLATES,
  FIT_V2_SKILLS,
  FIT_V2_TRAITS,
  FIT_V2_VALUES,
  FIT_V2_SKILL_LABELS,
  FIT_V2_TRAIT_SPECS,
  FIT_V2_VALUE_SPECS,
  type FitRoleContext,
  type FitRoleTemplate,
  type FitV2SkillSlug,
  type FitV2Trait,
  type FitV2ValueKey,
} from './fitRoles.ts';
import { ensureFitV2Schema } from './fitV2Schema.ts';

export const FIT_BANK_VERSION = 'v2.0';
export const FIT_ENGINE_VERSION = 'v2.0';

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export type FitOutcome =
  | 'high_fit' | 'conditional_fit' | 'specialist_fit'
  | 'low_fit' | 'misaligned' | 'insufficient_evidence';

export const FIT_OUTCOME_LABEL: Record<FitOutcome, string> = {
  high_fit: 'High Fit',
  conditional_fit: 'Conditional Fit',
  specialist_fit: 'Specialist Fit',
  low_fit: 'Low Fit',
  misaligned: 'Misaligned',
  insufficient_evidence: 'Insufficient Evidence',
};

/**
 * Every gate in one place so the calibration panel can render (and later
 * edit) them. Scores are 0..100, confidence/coverage 0..1, skills 0..5.
 */
export const FIT_V2_THRESHOLDS = {
  insufficient_confidence: 0.35,   // below → insufficient_evidence
  insufficient_value_dims: 3,      // fewer scored value dims → insufficient_evidence
  insufficient_skill_coverage: 0.4,
  misaligned_culture: 40,          // culture below → misaligned
  high_culture: 75,
  high_role: 75,
  high_confidence: 0.6,
  specialist_role: 75,
  specialist_culture_floor: 40,
  specialist_culture_ceiling: 60,
  specialist_spike: 4.5,           // top-2 weighted skills at/above (0..5)
  specialist_breadth: 2.5,         // mean of answered skills below (0..5)
  conditional_culture: 60,
  conditional_role: 55,
  musthave_validated: 3,           // must-have skill floor (0..5)
  value_gap: 0.25,                 // baseline shortfall that counts as a gap (0..1)
  contradiction_delta: 2,          // |a − expected(b)| at/above fires (0..5 scale)
  flag_cap_one: 'conditional_fit' as FitOutcome,   // 1 non-ethics flag caps here
  flag_cap_many: 'low_fit' as FitOutcome,          // ≥2 flags cap here
  unvalidated_skill_cap: 3.5,      // self-claimed skill without evidence caps here (0..5)
} as const;

// Ethics-class red flags force `misaligned` regardless of scores. Keys are the
// v1 RED_FLAGS vocabulary (pinned by test against axalFit.RED_FLAGS).
export const ETHICS_FLAGS = ['weak_ethics'] as const;

// Fired by the engine (not a probe) when ≥2 validation pairs contradict —
// reuses the v1 red-flag key so admin surfaces render it with existing copy.
export const CONTRADICTION_FLAG = 'inconsistent_stories';

// ---------------------------------------------------------------------------
// Axal values baseline — the culture-fit target profile (0..1 per value).
// Shortfalls below baseline penalize; exceeding it never does. Integrity and
// stewardship are double-weighted: they are the two values Axal treats as
// non-negotiable.
// ---------------------------------------------------------------------------

export const AXAL_VALUES_BASELINE: Record<FitV2ValueKey, number> = {
  integrity: 0.9,
  stewardship: 0.85,
  curiosity: 0.75,
  resilience: 0.75,
  collaboration: 0.8,
  ambition: 0.7,
};

export const AXAL_VALUES_WEIGHT: Record<FitV2ValueKey, number> = {
  integrity: 2,
  stewardship: 2,
  curiosity: 1,
  resilience: 1,
  collaboration: 1,
  ambition: 1,
};

// ---------------------------------------------------------------------------
// v2 archetypes — nearest-centroid over the 6 trait axes (0..5 space).
// Centroids are shaped, not one-hot: real operators score moderately on
// adjacent axes, and the classifier reports primary + secondary + margin
// rather than a box.
// ---------------------------------------------------------------------------

export interface FitV2ArchetypeDef {
  slug: FitV2Trait;
  label: string;
  tagline: string;
  centroid: Record<FitV2Trait, number>;
}

const C = (
  builder: number, visionary: number, connector: number,
  operator: number, scout: number, steward: number,
): Record<FitV2Trait, number> => ({ builder, visionary, connector, operator, scout, steward });

export const FIT_V2_ARCHETYPES: FitV2ArchetypeDef[] = [
  { slug: 'builder', label: FIT_V2_TRAIT_SPECS.builder.label, tagline: FIT_V2_TRAIT_SPECS.builder.tagline, centroid: C(4.6, 3.2, 2.2, 2.8, 2.6, 2.2) },
  { slug: 'visionary', label: FIT_V2_TRAIT_SPECS.visionary.label, tagline: FIT_V2_TRAIT_SPECS.visionary.tagline, centroid: C(3.0, 4.6, 2.8, 2.0, 3.4, 2.0) },
  { slug: 'connector', label: FIT_V2_TRAIT_SPECS.connector.label, tagline: FIT_V2_TRAIT_SPECS.connector.tagline, centroid: C(2.2, 3.0, 4.6, 2.4, 2.8, 2.4) },
  { slug: 'operator', label: FIT_V2_TRAIT_SPECS.operator.label, tagline: FIT_V2_TRAIT_SPECS.operator.tagline, centroid: C(2.6, 2.0, 2.6, 4.6, 2.0, 3.2) },
  { slug: 'scout', label: FIT_V2_TRAIT_SPECS.scout.label, tagline: FIT_V2_TRAIT_SPECS.scout.tagline, centroid: C(2.4, 3.2, 2.8, 2.0, 4.6, 2.2) },
  { slug: 'steward', label: FIT_V2_TRAIT_SPECS.steward.label, tagline: FIT_V2_TRAIT_SPECS.steward.tagline, centroid: C(2.0, 2.2, 2.6, 3.2, 2.2, 4.6) },
];

// ---------------------------------------------------------------------------
// Normalization — one raw answer string → a typed, dimension-loaded response.
// Dimension keys are namespaced: value:<key> | trait:<key> | skill:<slug> |
// rubric:<category>. Bank option loads are authored with the same namespaced
// keys, so the accumulator below stays generic.
// ---------------------------------------------------------------------------

export interface NormalizedAnswer {
  kind: FitV2Kind;
  /** 0..5 primary score, when the kind produces one (likert / option score). */
  score: number | null;
  /** Ordered option keys (rank_order) or selected keys (choice kinds). */
  optionKeys: string[];
  /** Free text (behavioral_evidence). */
  text: string | null;
  /** dimension key → { sum, weight } accumulated by the caller. */
  loads: Array<{ dim: string; level: number; weight: number }>;
  flags: string[];
}

export function primaryDimension(q: Question): string | null {
  const v2 = q.fit_v2;
  if (!v2) return null;
  if (v2.value_key) return `value:${v2.value_key}`;
  if (v2.trait) return `trait:${v2.trait}`;
  if (v2.skill_v2) return `skill:${v2.skill_v2.slug}`;
  if (v2.rubric_v2) return `rubric:${v2.rubric_v2.category}`;
  return null;
}

/**
 * Parse + validate one raw answer against its bank item. Returns null when
 * the raw value cannot be interpreted for this kind (the caller treats it as
 * unanswered — never throws, because historic rows may predate bank edits).
 */
export function normalizeV2Answer(q: Question, raw: string): NormalizedAnswer | null {
  const v2 = q.fit_v2;
  if (!v2) return null;
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const dim = primaryDimension(q);
  const out: NormalizedAnswer = { kind: v2.kind, score: null, optionKeys: [], text: null, loads: [], flags: [] };

  const pushPrimary = (score: number, weight = 1) => {
    out.score = score;
    if (dim) out.loads.push({ dim, level: score, weight });
  };
  const applyOption = (key: string, weight = 1) => {
    const opt = v2.options_v2?.find((o) => o.key === key || o.label === key);
    if (!opt) return false;
    out.optionKeys.push(opt.key);
    if (typeof opt.score === 'number') {
      // Primary contribution rides the option's keyed score.
      out.score = out.score == null ? opt.score : out.score;
      if (dim) out.loads.push({ dim, level: opt.score, weight });
    }
    for (const [loadDim, level] of Object.entries(opt.loads || {})) {
      out.loads.push({ dim: loadDim, level, weight });
    }
    if (opt.flag) out.flags.push(opt.flag);
    return true;
  };

  switch (v2.kind) {
    case 'likert':
    case 'confidence_check': {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 5) return null;
      const score = v2.reverse_scored ? 5 - n : n;
      if (v2.kind === 'likert') pushPrimary(score);
      else out.score = score; // confidence checks never load a dimension
      return out;
    }
    case 'forced_choice':
    case 'sjt':
    case 'tradeoff': {
      return applyOption(trimmed) ? out : null;
    }
    case 'rank_order': {
      // Full ranking = comma-joined keys (staged flow). The chat surface
      // degrades to a single top pick — accept it at full weight so the
      // conversational answer still contributes instead of 422-ing.
      const keys = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length < 1) return null;
      const n = keys.length;
      let matched = 0;
      keys.forEach((k, idx) => {
        // Rank weight decays linearly: top pick 1.0 → last pick 0.0.
        const w = n > 1 ? (n - 1 - idx) / (n - 1) : 1;
        if (applyOption(k, w)) matched += 1;
      });
      return matched >= 1 ? out : null;
    }
    case 'multi_select': {
      const keys = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      let matched = 0;
      for (const k of keys) if (applyOption(k)) matched += 1;
      return matched > 0 ? out : null;
    }
    case 'behavioral_evidence': {
      const minLen = v2.evidence?.min_len ?? 80;
      if (trimmed.length < Math.min(minLen, 40)) return null;
      out.text = trimmed;
      return out;
    }
    default:
      return null;
  }
}

/**
 * Auto evidence-quality heuristic (0..2; 3 is reviewer-only):
 *   0 — too thin to count; 1 — a real example (length gate met);
 *   2 — specific: carries numbers/dates/named outcomes.
 * Reviewer evidence ratings (fit_reviews.evidence_ratings_json) override this
 * in the admin surfaces; the engine itself only ever auto-rates.
 */
export function rateEvidenceText(text: string, minLen = 80): 0 | 1 | 2 {
  const t = text.trim();
  if (t.length < minLen) return t.length >= 40 ? 1 : 0;
  const quantitative = /\d|%|\$|€|£/.test(t);
  const temporal = /\b(week|month|quarter|year|Q[1-4]|20\d\d)\b/i.test(t);
  return quantitative || temporal ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Layer computation
// ---------------------------------------------------------------------------

export interface FitV2RawAnswer { question_id: string; raw: string }

export interface DimensionScore { score: number; confidence: number; n: number }

export interface Contradiction {
  pair: [string, string];
  delta: number;
  dimension: string | null;
}

export interface FitV2Layers {
  /** 0..1 per v2 value key (only keys with any signal appear). */
  values: Partial<Record<FitV2ValueKey, DimensionScore>>;
  /** 0..5 per v2 trait. */
  traits: Partial<Record<FitV2Trait, { score: number; n: number }>>;
  /** 0..5 per priority-skill slug, evidence-capped. */
  skills: Partial<Record<FitV2SkillSlug, DimensionScore & { validated: boolean }>>;
  /** 0..5 per v2 rubric category. */
  rubric: Record<string, { score: number; n: number }>;
  flags: string[];
  contradictions: Contradiction[];
  confidenceChecks: Array<{ question_id: string; score: number }>;
  evidence: { items: number; scored: number; quality: number }; // quality 0..1
  coverage: { values: number; archetypes: number; skills: number; validation: number };
  answeredCount: number;
}

interface Acc { sum: number; weight: number; n: number }

/**
 * Pure: fold the answered bank into per-dimension scores + validation signal.
 * `bank` is the FULL v2 bank for the role context; anything answered counts,
 * anything missing lowers coverage — never the score itself.
 */
export function computeLayers(bank: Question[], answers: FitV2RawAnswer[]): FitV2Layers {
  const byId = new Map(bank.map((q) => [q.id, q] as const));
  const raw = new Map<string, string>();
  for (const a of answers) if (byId.has(a.question_id)) raw.set(a.question_id, a.raw);

  const acc = new Map<string, Acc>();
  const bump = (dim: string, level: number, weight: number) => {
    const a = acc.get(dim) || { sum: 0, weight: 0, n: 0 };
    a.sum += level * weight;
    a.weight += weight;
    a.n += 1;
    acc.set(dim, a);
  };

  const flags = new Set<string>();
  const normalized = new Map<string, NormalizedAnswer>();
  const confidenceChecks: FitV2Layers['confidenceChecks'] = [];
  const evidenceByDim = new Map<string, number>(); // dim → best auto quality 0..2
  let evidenceItems = 0;
  let evidenceScored = 0;
  let evidenceQualitySum = 0;

  for (const q of bank) {
    const r = raw.get(q.id);
    if (r == null) continue;
    const norm = normalizeV2Answer(q, r);
    if (!norm) continue;
    normalized.set(q.id, norm);

    if (norm.kind === 'confidence_check') {
      if (norm.score != null) confidenceChecks.push({ question_id: q.id, score: norm.score });
      continue;
    }
    if (norm.kind === 'behavioral_evidence') {
      evidenceItems += 1;
      const quality = rateEvidenceText(norm.text || '', q.fit_v2?.evidence?.min_len ?? 80);
      if (quality > 0) {
        evidenceScored += 1;
        evidenceQualitySum += quality;
        const dim = primaryDimension(q);
        if (dim) evidenceByDim.set(dim, Math.max(evidenceByDim.get(dim) || 0, quality));
      }
      continue;
    }
    for (const l of norm.loads) bump(l.dim, l.level, l.weight);
    for (const f of norm.flags) flags.add(f);
    // v1-style red-flag probes on numeric answers.
    const probe = q.measures?.red_flag;
    if (probe && norm.score != null && norm.score <= probe.at_or_below) flags.add(probe.key);
  }

  // --- values (0..1) -------------------------------------------------------
  const values: FitV2Layers['values'] = {};
  for (const key of FIT_V2_VALUES) {
    const a = acc.get(`value:${key}`);
    if (!a || a.weight <= 0) continue;
    const expected = bank.filter((q) => q.fit_v2?.value_key === key && q.fit_v2.kind !== 'behavioral_evidence').length || 1;
    const evidenceBonus = (evidenceByDim.get(`value:${key}`) || 0) > 0 ? 0.15 : 0;
    values[key] = {
      score: round2(clamp01(a.sum / a.weight / 5)),
      confidence: round2(clamp01(a.n / expected + evidenceBonus)),
      n: a.n,
    };
  }

  // --- traits (0..5) -------------------------------------------------------
  const traits: FitV2Layers['traits'] = {};
  for (const key of FIT_V2_TRAITS) {
    const a = acc.get(`trait:${key}`);
    if (!a || a.weight <= 0) continue;
    traits[key] = { score: round2(clamp(a.sum / a.weight, 0, 5)), n: a.n };
  }

  // --- skills (0..5, evidence-capped) --------------------------------------
  const skills: FitV2Layers['skills'] = {};
  for (const slug of FIT_V2_SKILLS) {
    const a = acc.get(`skill:${slug}`);
    if (!a || a.weight <= 0) continue;
    const expected = bank.filter((q) => q.fit_v2?.skill_v2?.slug === slug && q.fit_v2.kind !== 'behavioral_evidence').length || 1;
    const validated = (evidenceByDim.get(`skill:${slug}`) || 0) > 0
      // SJT / scenario items count as behavioral evidence for the skill too:
      // a keyed scenario answer is a decision pattern, not a self-rating.
      || bank.some((q) => q.fit_v2?.skill_v2?.slug === slug && q.fit_v2.kind === 'sjt' && normalized.has(q.id));
    const rawScore = clamp(a.sum / a.weight, 0, 5);
    skills[slug] = {
      score: round2(validated ? rawScore : Math.min(rawScore, FIT_V2_THRESHOLDS.unvalidated_skill_cap)),
      confidence: round2(clamp01(a.n / expected)),
      n: a.n,
      validated,
    };
  }

  // --- rubric (0..5) -------------------------------------------------------
  const rubric: FitV2Layers['rubric'] = {};
  for (const [dim, a] of acc.entries()) {
    if (!dim.startsWith('rubric:') || a.weight <= 0) continue;
    rubric[dim.slice('rubric:'.length)] = { score: round2(clamp(a.sum / a.weight, 0, 5)), n: a.n };
  }

  // --- contradictions ------------------------------------------------------
  const contradictions: Contradiction[] = [];
  for (const q of bank) {
    const pairId = q.fit_v2?.validation_pair;
    if (!pairId) continue;
    const partner = byId.get(pairId);
    if (!partner) continue;
    const a = normalized.get(q.id);
    const b = normalized.get(pairId);
    if (!a || !b || a.score == null || b.score == null) continue;
    // Validation items are authored reverse-keyed against their partner by
    // default; normalizeV2Answer has ALREADY un-reversed reverse_scored items,
    // so agreement means the two normalized scores land close together.
    const delta = Math.abs(a.score - b.score);
    if (delta >= FIT_V2_THRESHOLDS.contradiction_delta) {
      contradictions.push({ pair: [q.id, pairId], delta: round2(delta), dimension: primaryDimension(partner) });
    }
  }
  if (contradictions.length >= 2) flags.add(CONTRADICTION_FLAG);

  // --- coverage ------------------------------------------------------------
  const coverageOf = (module: string) => {
    const items = bank.filter((q) => q.fit_v2?.module === module && q.fit_v2.kind !== 'confidence_check');
    if (items.length === 0) return 0;
    return clamp01(items.filter((q) => normalized.has(q.id)).length / items.length);
  };
  const validationItems = bank.filter((q) => q.fit_v2?.module === 'validation');
  const validationAnswered = validationItems.filter((q) => normalized.has(q.id)).length;

  return {
    values,
    traits,
    skills,
    rubric,
    flags: Array.from(flags),
    contradictions,
    confidenceChecks,
    evidence: {
      items: evidenceItems,
      scored: evidenceScored,
      quality: round2(evidenceScored > 0 ? clamp01(evidenceQualitySum / evidenceScored / 2) : 0),
    },
    coverage: {
      values: round2(coverageOf('values')),
      archetypes: round2(coverageOf('archetypes')),
      skills: round2(coverageOf('skills')),
      validation: round2(validationItems.length ? validationAnswered / validationItems.length : 0),
    },
    answeredCount: normalized.size,
  };
}

// ---------------------------------------------------------------------------
// Layer scores → decision inputs
// ---------------------------------------------------------------------------

/**
 * Culture fit 0..100 vs the Axal baseline. Only shortfalls BELOW baseline
 * penalize (exceeding integrity is not a problem); integrity/stewardship are
 * double-weighted; weights renormalize over the values actually scored.
 */
export function cultureScore(values: FitV2Layers['values']): number | null {
  let weight = 0;
  let shortfall = 0;
  for (const key of FIT_V2_VALUES) {
    const v = values[key];
    if (!v) continue;
    const w = AXAL_VALUES_WEIGHT[key];
    weight += w;
    shortfall += w * Math.max(0, AXAL_VALUES_BASELINE[key] - v.score);
  }
  if (weight <= 0) return null;
  return round1(100 * clamp01(1 - shortfall / weight));
}

/**
 * Role fit 0..100: 0.6 × template-weighted skills + 0.4 × template-weighted
 * rubric, each normalized over ANSWERED weights (v1 scoreRubric pattern). If
 * a whole part is unanswered the other carries the score alone.
 */
export function roleScore(layers: FitV2Layers, tpl: FitRoleTemplate): number | null {
  let sw = 0; let ss = 0;
  for (const [slug, w] of Object.entries(tpl.skillWeights) as Array<[FitV2SkillSlug, number]>) {
    const s = layers.skills[slug];
    if (!s) continue;
    sw += w;
    ss += w * (s.score / 5);
  }
  let rw = 0; let rs = 0;
  for (const [cat, w] of Object.entries(tpl.rubricWeights)) {
    const r = layers.rubric[cat];
    if (!r) continue;
    rw += w;
    rs += w * (r.score / 5);
  }
  const skillsPart = sw > 0 ? ss / sw : null;
  const rubricPart = rw > 0 ? rs / rw : null;
  if (skillsPart == null && rubricPart == null) return null;
  if (skillsPart == null) return round1(100 * (rubricPart as number));
  if (rubricPart == null) return round1(100 * skillsPart);
  return round1(100 * (0.6 * skillsPart + 0.4 * rubricPart));
}

export interface ArchetypeV2Classification {
  primary: FitV2Trait;
  secondary: FitV2Trait | null;
  margin: number;
  confidence: number;
  traits: Partial<Record<FitV2Trait, number>>;
}

/** Nearest-centroid over answered trait axes; needs ≥3 axes of signal. */
export function classifyArchetypeV2(traits: FitV2Layers['traits']): ArchetypeV2Classification | null {
  const answered = FIT_V2_TRAITS.filter((t) => traits[t] != null);
  if (answered.length < 3) return null;
  const dists = FIT_V2_ARCHETYPES.map((a) => {
    let sum = 0;
    for (const t of answered) sum += (traits[t]!.score - a.centroid[t]) ** 2;
    return { slug: a.slug, d: Math.sqrt(sum / answered.length) };
  }).sort((x, y) => x.d - y.d);
  const margin = round2((dists[1]?.d ?? dists[0].d) - dists[0].d);
  const coverage = answered.length / FIT_V2_TRAITS.length;
  const separation = Math.min(1, margin / 1.5);
  const flat: Partial<Record<FitV2Trait, number>> = {};
  for (const t of answered) flat[t] = traits[t]!.score;
  return {
    primary: dists[0].slug,
    secondary: dists[1]?.slug ?? null,
    margin,
    confidence: round2(clamp01(0.6 * coverage + 0.4 * separation)),
    traits: flat,
  };
}

/**
 * Overall confidence 0..1 = layer coverage × internal consistency × evidence
 * factor. Self-report with zero evidence caps the evidence factor at 0.4, so
 * a fluent self-reporter cannot reach high confidence without examples.
 */
export function confidenceScore(l: FitV2Layers): number {
  const coverage =
    0.4 * l.coverage.values +
    0.3 * l.coverage.skills +
    0.2 * l.coverage.archetypes +
    0.1 * l.coverage.validation;
  const pairsAnswered = Math.max(1, l.contradictions.length + countAgreedPairs(l));
  const consistency = Math.max(0, 1 - (1.5 * l.contradictions.length) / pairsAnswered);
  const evidenceFactor = 0.4 + 0.6 * l.evidence.quality;
  return round2(clamp01(coverage * consistency * evidenceFactor));
}

// Contradictions carry only the failed pairs; approximate the answered-pair
// denominator by treating validation coverage as the agreed remainder.
function countAgreedPairs(l: FitV2Layers): number {
  return Math.max(0, Math.round(l.coverage.validation * 8) - l.contradictions.length);
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface FitGap { layer: 'values' | 'skills' | 'validation'; key: string; detail: string }

export interface FitDecisionInputs {
  culture: number | null;
  role: number | null;
  confidence: number;
  layers: FitV2Layers;
  tpl: FitRoleTemplate;
}

export interface FitDecisionCore {
  outcome: FitOutcome;
  reasons: string[];
  gaps: FitGap[];
}

const OUTCOME_RANK: Record<FitOutcome, number> = {
  insufficient_evidence: 0, misaligned: 1, low_fit: 2,
  conditional_fit: 3, specialist_fit: 4, high_fit: 5,
};

function capOutcome(outcome: FitOutcome, cap: FitOutcome): FitOutcome {
  return OUTCOME_RANK[outcome] > OUTCOME_RANK[cap] ? cap : outcome;
}

export function enumerateGaps(i: FitDecisionInputs): FitGap[] {
  const gaps: FitGap[] = [];
  for (const slug of i.tpl.mustHaveSkills) {
    const s = i.layers.skills[slug];
    if (!s) {
      gaps.push({ layer: 'skills', key: slug, detail: `${FIT_V2_SKILL_LABELS[slug]}: no signal yet.` });
    } else if (s.score < FIT_V2_THRESHOLDS.musthave_validated) {
      gaps.push({
        layer: 'skills', key: slug,
        detail: `${FIT_V2_SKILL_LABELS[slug]} at ${s.score.toFixed(1)}/5${s.validated ? '' : ' (unvalidated self-rating)'}.`,
      });
    }
  }
  for (const key of FIT_V2_VALUES) {
    const v = i.layers.values[key];
    if (!v) continue;
    const gap = AXAL_VALUES_BASELINE[key] - v.score;
    if (gap > FIT_V2_THRESHOLDS.value_gap) {
      gaps.push({
        layer: 'values', key,
        detail: `${FIT_V2_VALUE_SPECS[key].label} ${Math.round(gap * 100)} pts below the Axal baseline.`,
      });
    }
  }
  for (const c of i.layers.contradictions) {
    gaps.push({
      layer: 'validation', key: c.pair.join('↔'),
      detail: `Contradictory answers (${c.dimension || 'general'}, Δ${c.delta}).`,
    });
  }
  return gaps;
}

/**
 * The six-outcome rubric. Gate order is load-bearing:
 * evidence → ethics/misalignment → flag caps → high → specialist → conditional → low.
 */
export function decideOutcome(i: FitDecisionInputs): FitDecisionCore {
  const T = FIT_V2_THRESHOLDS;
  const reasons: string[] = [];
  const gaps = enumerateGaps(i);
  const scoredValueDims = Object.keys(i.layers.values).length;

  // 1 — insufficient evidence gate.
  if (
    i.confidence < T.insufficient_confidence ||
    scoredValueDims < T.insufficient_value_dims ||
    i.layers.coverage.skills < T.insufficient_skill_coverage ||
    i.culture == null || i.role == null
  ) {
    reasons.push(
      i.confidence < T.insufficient_confidence
        ? `Confidence ${i.confidence} is below the ${T.insufficient_confidence} floor.`
        : 'Too little of the bank is answered to score all three layers.',
    );
    return { outcome: 'insufficient_evidence', reasons, gaps };
  }

  // 2 — misalignment: culture floor or an ethics-class flag overrides skills.
  const ethicsFired = i.layers.flags.filter((f) => (ETHICS_FLAGS as readonly string[]).includes(f));
  const integrityContradiction = i.layers.contradictions.some((c) => c.dimension === 'value:integrity');
  if (i.culture < T.misaligned_culture || ethicsFired.length > 0 || integrityContradiction) {
    if (i.culture < T.misaligned_culture) reasons.push(`Culture fit ${i.culture} is below the ${T.misaligned_culture} floor.`);
    if (ethicsFired.length > 0) reasons.push(`Ethics-class red flag fired: ${ethicsFired.join(', ')}.`);
    if (integrityContradiction) reasons.push('Integrity answers contradict each other.');
    return { outcome: 'misaligned', reasons, gaps };
  }

  // 3 — red-flag caps (non-ethics).
  const nonEthicsFlags = i.layers.flags.filter((f) => !(ETHICS_FLAGS as readonly string[]).includes(f));
  const cap: FitOutcome = nonEthicsFlags.length >= 2 ? T.flag_cap_many
    : nonEthicsFlags.length === 1 ? T.flag_cap_one
    : 'high_fit';
  if (nonEthicsFlags.length > 0) {
    reasons.push(`Red flag${nonEthicsFlags.length > 1 ? 's' : ''} cap the outcome: ${nonEthicsFlags.join(', ')}.`);
  }

  // 4 — high fit.
  if (
    i.culture >= T.high_culture && i.role >= T.high_role &&
    i.confidence >= T.high_confidence && i.layers.contradictions.length === 0
  ) {
    reasons.push(`Culture ${i.culture} and role ${i.role} both clear the high-fit bars with confidence ${i.confidence}.`);
    return { outcome: capOutcome('high_fit', cap), reasons, gaps };
  }

  // 5 — specialist fit: elite, narrow capability with tolerable culture.
  const weighted = (Object.entries(i.layers.skills) as Array<[FitV2SkillSlug, { score: number }]>)
    .map(([slug, s]) => ({ slug, score: s.score, w: i.tpl.skillWeights[slug] ?? 0 }))
    .sort((a, b) => b.score * b.w - a.score * a.w);
  const answeredScores = weighted.map((x) => x.score);
  const breadth = answeredScores.length ? answeredScores.reduce((a, b) => a + b, 0) / answeredScores.length : 0;
  const topTwoSpike = weighted.length >= 2 && weighted[0].score >= T.specialist_spike && weighted[1].score >= T.specialist_spike;
  const specialistByBand = i.role >= T.specialist_role &&
    i.culture >= T.specialist_culture_floor && i.culture < T.specialist_culture_ceiling;
  const specialistBySpike = topTwoSpike && breadth < T.specialist_breadth && i.culture >= T.specialist_culture_ceiling;
  if (specialistByBand || specialistBySpike) {
    reasons.push(specialistByBand
      ? `Role fit ${i.role} is strong while culture fit ${i.culture} sits in the specialist band.`
      : `Elite spike (${weighted[0].slug}, ${weighted[1].slug}) over narrow breadth ${breadth.toFixed(1)}/5.`);
    return { outcome: capOutcome('specialist_fit', cap), reasons, gaps };
  }

  // 6 — conditional fit (incl. would-be high fit held back only by confidence).
  const wouldBeHigh = i.culture >= T.high_culture && i.role >= T.high_role;
  if ((i.culture >= T.conditional_culture && i.role >= T.conditional_role) || wouldBeHigh) {
    reasons.push(wouldBeHigh && i.confidence < T.high_confidence
      ? `Scores clear the high-fit bars but confidence ${i.confidence} is below ${T.high_confidence} — validate before committing.`
      : `Culture ${i.culture} and role ${i.role} clear the conditional bars with ${gaps.length} named gap${gaps.length === 1 ? '' : 's'}.`);
    return { outcome: capOutcome('conditional_fit', cap), reasons, gaps };
  }

  // 7 — low fit.
  reasons.push(`Culture ${i.culture} / role ${i.role} do not clear the conditional bars.`);
  return { outcome: capOutcome('low_fit', cap), reasons, gaps };
}

// ---------------------------------------------------------------------------
// Outcome playbook — decision-rubric copy served with results (kept in code so
// product + methodology doc can't drift apart).
// ---------------------------------------------------------------------------

export interface OutcomePlaybook {
  label: string;
  definition: string;
  next_action: string;
  environment: string;
  validate_next: string;
}

export const FIT_OUTCOME_PLAYBOOK: Record<FitOutcome, OutcomePlaybook> = {
  high_fit: {
    label: FIT_OUTCOME_LABEL.high_fit,
    definition: 'Strong on values, strong on role capability, and the evidence is consistent.',
    next_action: 'Move to references + a real work sample, then commit.',
    environment: 'High-trust, high-autonomy scope with real ownership.',
    validate_next: 'Reference-check the two highest-weighted skills to confirm the self-report.',
  },
  conditional_fit: {
    label: FIT_OUTCOME_LABEL.conditional_fit,
    definition: 'Values align; capability or evidence has named, addressable gaps.',
    next_action: 'Agree a development or validation plan against the listed gaps before expanding scope.',
    environment: 'Scoped engagement with a mentor/reviewer attached to the gap areas.',
    validate_next: 'Close the top gap: request concrete evidence or run a paid trial task.',
  },
  specialist_fit: {
    label: FIT_OUTCOME_LABEL.specialist_fit,
    definition: 'Elite in a narrow band; culture or breadth would strain a broad mandate.',
    next_action: 'Engage for the spike, explicitly not for a generalist role.',
    environment: 'Well-bounded scope where the spike is the job; keep interfaces tight.',
    validate_next: 'Pressure-test collaboration signals before embedding them in a team.',
  },
  low_fit: {
    label: FIT_OUTCOME_LABEL.low_fit,
    definition: 'Neither culture nor capability clears the bar for this role context.',
    next_action: 'Decline for this context; consider re-assessing against a different role.',
    environment: 'Not recommended for this context.',
    validate_next: 'Only revisit if a different role context is plausible.',
  },
  misaligned: {
    label: FIT_OUTCOME_LABEL.misaligned,
    definition: 'Values conflict with the Axal baseline or an ethics-class flag fired — skills cannot compensate.',
    next_action: 'Do not proceed. If the flag may be a misread, a partner reviews the raw answers first.',
    environment: 'None.',
    validate_next: 'Human review of the flagged answers before any further contact.',
  },
  insufficient_evidence: {
    label: FIT_OUTCOME_LABEL.insufficient_evidence,
    definition: 'Not enough answered, consistent, evidenced signal to score all three layers.',
    next_action: 'Complete the listed missing sections or attach evidence, then recompute.',
    environment: 'n/a — assessment incomplete.',
    validate_next: 'Whatever the coverage list names first.',
  },
};

// ---------------------------------------------------------------------------
// Narrative — deterministic, no LLM (narrativeFit pattern).
// ---------------------------------------------------------------------------

export function narrativeDecision(d: {
  outcome: FitOutcome; culture: number | null; role: number | null; confidence: number;
  archetype: ArchetypeV2Classification | null; gaps: FitGap[]; flags: string[]; roleLabel: string;
}): string {
  if (d.outcome === 'insufficient_evidence') {
    return `Not enough signal yet to score the ${d.roleLabel} decision — keep answering in the assessment or the Personal Advisor, or attach evidence to what you have.`;
  }
  const parts: string[] = [];
  parts.push(`${FIT_OUTCOME_LABEL[d.outcome]} for ${d.roleLabel}: culture ${d.culture}/100, role capability ${d.role}/100, confidence ${Math.round(d.confidence * 100)}%.`);
  if (d.archetype) {
    const spec = FIT_V2_TRAIT_SPECS[d.archetype.primary];
    parts.push(`Operates primarily as a ${spec.label}${d.archetype.secondary ? ` with a ${FIT_V2_TRAIT_SPECS[d.archetype.secondary].label} secondary` : ''}.`);
  }
  if (d.gaps.length > 0) parts.push(`Watch: ${d.gaps.slice(0, 3).map((g) => g.detail).join(' ')}`);
  if (d.flags.length > 0) parts.push(`Red flags: ${d.flags.join(', ')}.`);
  parts.push(FIT_OUTCOME_PLAYBOOK[d.outcome].next_action);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// D1 orchestration
// ---------------------------------------------------------------------------

export interface FitDecisionResult {
  id: number | null;
  uid: string | null;
  user_id: number;
  session_id: number | null;
  role_context: FitRoleContext;
  bank_version: string;
  engine_version: string;
  outcome: FitOutcome;
  culture_score: number;
  role_score: number;
  archetype_primary: string | null;
  archetype_secondary: string | null;
  archetype_margin: number;
  confidence: number;
  evidence_quality: number;
  coverage: FitV2Layers['coverage'];
  values: FitV2Layers['values'];
  skills: FitV2Layers['skills'];
  rubric: FitV2Layers['rubric'];
  gaps: FitGap[];
  flags: string[];
  contradictions: Contradiction[];
  reasons: string[];
  narrative: string;
  computed_by: number | null;
  computed_at: string | null;
}

/**
 * Load every stored v2 raw answer for the ids in `bank`. Both write paths
 * (conversational + staged) upsert field_sources with evidence_text = the raw
 * answer string for v2 ids, so one LIKE scan covers both; ids are then
 * filtered against the bank in JS to avoid parameter-list limits.
 */
export async function loadFitV2Answers(env: Env, userId: number, bank: Question[]): Promise<FitV2RawAnswer[]> {
  const ids = new Set(bank.map((q) => q.id));
  const rows = await env.DB.prepare(
    "SELECT question_id, evidence_text FROM field_sources WHERE user_id = ? AND question_id LIKE 'fit.%.v2\\_%' ESCAPE '\\'",
  ).bind(userId).all<{ question_id: string; evidence_text: string | null }>();
  const out: FitV2RawAnswer[] = [];
  for (const r of rows.results || []) {
    if (!ids.has(r.question_id) || r.evidence_text == null || r.evidence_text === '') continue;
    out.push({ question_id: r.question_id, raw: r.evidence_text });
  }
  return out;
}

/** Pure assembly used by computeFitDecision and unit tests. */
export function assembleDecision(
  userId: number,
  roleContext: FitRoleContext,
  bank: Question[],
  answers: FitV2RawAnswer[],
  opts: { sessionId?: number | null; computedBy?: number | null } = {},
): FitDecisionResult {
  const tpl = FIT_ROLE_TEMPLATES[roleContext];
  const layers = computeLayers(bank, answers);
  const culture = cultureScore(layers.values);
  const role = roleScore(layers, tpl);
  const confidence = confidenceScore(layers);
  const archetype = classifyArchetypeV2(layers.traits);
  const core = decideOutcome({ culture, role, confidence, layers, tpl });
  const narrative = narrativeDecision({
    outcome: core.outcome, culture, role, confidence, archetype,
    gaps: core.gaps, flags: layers.flags, roleLabel: tpl.label,
  });
  return {
    id: null,
    uid: null,
    user_id: userId,
    session_id: opts.sessionId ?? null,
    role_context: roleContext,
    bank_version: FIT_BANK_VERSION,
    engine_version: FIT_ENGINE_VERSION,
    outcome: core.outcome,
    culture_score: culture ?? 0,
    role_score: role ?? 0,
    archetype_primary: archetype?.primary ?? null,
    archetype_secondary: archetype?.secondary ?? null,
    archetype_margin: archetype?.margin ?? 0,
    confidence,
    evidence_quality: layers.evidence.quality,
    coverage: layers.coverage,
    values: layers.values,
    skills: layers.skills,
    rubric: layers.rubric,
    gaps: core.gaps,
    flags: layers.flags,
    contradictions: layers.contradictions,
    reasons: core.reasons,
    narrative,
    computed_by: opts.computedBy ?? null,
    computed_at: null,
  };
}

export async function computeFitDecision(
  env: Env,
  userId: number,
  roleContext: FitRoleContext,
  opts: { persist?: boolean; sessionId?: number | null; computedBy?: number | null } = {},
): Promise<FitDecisionResult> {
  await ensureFitV2Schema(env);
  const bank = fitV2BankFor(roleContext, { coreOnly: false });
  const answers = await loadFitV2Answers(env, userId, bank);
  const result = assembleDecision(userId, roleContext, bank, answers, opts);
  if (opts.persist) {
    const row = await env.DB.prepare(
      `INSERT INTO fit_decisions
         (user_id, session_id, role_context, bank_version, engine_version, outcome,
          culture_score, role_score, archetype_primary, archetype_secondary, archetype_margin,
          confidence, evidence_quality, coverage_json, values_json, skills_json, rubric_json,
          gaps_json, flags_json, contradictions_json, narrative, computed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, uid, computed_at`,
    ).bind(
      userId, result.session_id, roleContext, result.bank_version, result.engine_version, result.outcome,
      result.culture_score, result.role_score, result.archetype_primary, result.archetype_secondary, result.archetype_margin,
      result.confidence, result.evidence_quality,
      JSON.stringify(result.coverage), JSON.stringify(result.values), JSON.stringify(result.skills), JSON.stringify(result.rubric),
      JSON.stringify(result.gaps), JSON.stringify(result.flags), JSON.stringify(result.contradictions),
      result.narrative, result.computed_by,
    ).first<{ id: number; uid: string; computed_at: string }>();
    if (row) {
      result.id = row.id;
      result.uid = row.uid;
      result.computed_at = row.computed_at;
    }
  }
  return result;
}

interface DecisionRow {
  id: number; uid: string; user_id: number; session_id: number | null; role_context: string;
  bank_version: string; engine_version: string; outcome: string;
  culture_score: number; role_score: number;
  archetype_primary: string | null; archetype_secondary: string | null; archetype_margin: number;
  confidence: number; evidence_quality: number;
  coverage_json: string | null; values_json: string | null; skills_json: string | null; rubric_json: string | null;
  gaps_json: string | null; flags_json: string | null; contradictions_json: string | null;
  narrative: string | null; computed_by: number | null; computed_at: string;
}

export function decisionFromRow(r: DecisionRow): FitDecisionResult {
  const parse = <T,>(s: string | null, fallback: T): T => {
    if (!s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };
  return {
    id: r.id,
    uid: r.uid,
    user_id: r.user_id,
    session_id: r.session_id,
    role_context: r.role_context as FitRoleContext,
    bank_version: r.bank_version,
    engine_version: r.engine_version,
    outcome: r.outcome as FitOutcome,
    culture_score: r.culture_score,
    role_score: r.role_score,
    archetype_primary: r.archetype_primary,
    archetype_secondary: r.archetype_secondary,
    archetype_margin: r.archetype_margin,
    confidence: r.confidence,
    evidence_quality: r.evidence_quality,
    coverage: parse(r.coverage_json, { values: 0, archetypes: 0, skills: 0, validation: 0 }),
    values: parse(r.values_json, {}),
    skills: parse(r.skills_json, {}),
    rubric: parse(r.rubric_json, {}),
    gaps: parse(r.gaps_json, []),
    flags: parse(r.flags_json, []),
    contradictions: parse(r.contradictions_json, []),
    reasons: [],
    narrative: r.narrative || '',
    computed_by: r.computed_by,
    computed_at: r.computed_at,
  };
}

export async function loadLatestFitDecision(
  env: Env,
  userId: number,
  roleContext?: FitRoleContext,
): Promise<FitDecisionResult | null> {
  await ensureFitV2Schema(env);
  const row = roleContext
    ? await env.DB.prepare(
        'SELECT * FROM fit_decisions WHERE user_id = ? AND role_context = ? ORDER BY computed_at DESC, id DESC LIMIT 1',
      ).bind(userId, roleContext).first<DecisionRow>()
    : await env.DB.prepare(
        'SELECT * FROM fit_decisions WHERE user_id = ? ORDER BY computed_at DESC, id DESC LIMIT 1',
      ).bind(userId).first<DecisionRow>();
  return row ? decisionFromRow(row) : null;
}

export async function loadFitDecisionHistory(
  env: Env,
  userId: number,
  roleContext?: FitRoleContext,
  limit = 10,
): Promise<FitDecisionResult[]> {
  await ensureFitV2Schema(env);
  const rows = roleContext
    ? await env.DB.prepare(
        'SELECT * FROM fit_decisions WHERE user_id = ? AND role_context = ? ORDER BY computed_at DESC, id DESC LIMIT ?',
      ).bind(userId, roleContext, limit).all<DecisionRow>()
    : await env.DB.prepare(
        'SELECT * FROM fit_decisions WHERE user_id = ? ORDER BY computed_at DESC, id DESC LIMIT ?',
      ).bind(userId, limit).all<DecisionRow>();
  return (rows.results || []).map(decisionFromRow);
}

// ---------------------------------------------------------------------------
// Small numeric helpers (local — keep the module dependency-free).
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
