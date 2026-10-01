/**
 * Task #45 — Archetype scoring engine.
 *
 * Classifies a user into a role-specific archetype from a compact, diagnostic
 * set of behavioural self-ratings (0–5) tagged `measures.archetype_trait`. This
 * is the conversational counterpart to the gamified assessment track: it works
 * from the SAME advisor answers that feed Axal Fit, so an archetype appears as
 * soon as the conversation has signal — no separate game required (that was the
 * "Archetype missing…" gap on the Profile & Fit page).
 *
 * Split like services/axalFit.ts:
 *   - a PURE core (ARCHETYPE_TRAITS / ARCHETYPES + classifyArchetype /
 *     archetypeConfidence) unit-tested without auth or D1; and
 *   - a thin DB-aware orchestrator (computeArchetype / recomputeUserArchetype /
 *     loadLatestArchetype) that loads answered trait scores from field_sources
 *     and appends to `profile_archetypes`.
 *
 * Classification is nearest-centroid (Euclidean over the shared, answered
 * traits) — the same deterministic method as assignArchetype() in
 * assessmentScoring.ts, kept here so the conversational path has zero DB
 * dependency on the seeded assessment_archetypes rows (which may be un-applied
 * on a cold D1).
 */
import type { Env } from '../types';
import { fitMeasuresIndex, type FitPersona } from './advisor/questionBank.ts';
import { bindingKey } from '../util/schemaBootstrap';

// ---------------------------------------------------------------------------
// The 4 shared trait axes. Every archetype centroid is a point in this 0..5
// space; every `archetype_trait` question loads exactly one axis.
// ---------------------------------------------------------------------------
export const ARCHETYPE_TRAITS = ['builder', 'visionary', 'connector', 'operator'] as const;
export type ArchetypeTrait = (typeof ARCHETYPE_TRAITS)[number];

export interface TraitSpec { key: ArchetypeTrait; label: string; description: string }

export const TRAIT_SPECS: Record<ArchetypeTrait, TraitSpec> = {
  builder: { key: 'builder', label: 'Builder', description: 'Hands-on maker; bias to shipping and craft.' },
  visionary: { key: 'visionary', label: 'Visionary', description: 'Strategy, narrative, and long-range direction.' },
  connector: { key: 'connector', label: 'Connector', description: 'People, network, and collaboration.' },
  operator: { key: 'operator', label: 'Operator', description: 'Process, systems, and disciplined execution.' },
};

export type TraitScores = Partial<Record<ArchetypeTrait, number>>; // 0..5 each

export interface ArchetypeDefinition {
  slug: string;
  label: string;
  tagline: string;
  centroid: Record<ArchetypeTrait, number>; // 0..5 per trait
}

// ---------------------------------------------------------------------------
// Per-persona archetype sets. Centroids are hand-authored to sit at distinct
// corners of the trait space so a user with real signal lands cleanly on one.
// Founder reuses the `fo_*` slugs the frontend already has copy for
// (assessmentMeta.js) so the Archetype card renders without new metadata.
// ---------------------------------------------------------------------------
const C = (builder: number, visionary: number, connector: number, operator: number): Record<ArchetypeTrait, number> =>
  ({ builder, visionary, connector, operator });

const FOUNDER_ARCHETYPES: ArchetypeDefinition[] = [
  { slug: 'fo_missionary', label: 'The Missionary', tagline: 'Mission first, built to last.', centroid: C(2, 5, 5, 3) },
  { slug: 'fo_rocketeer', label: 'The Rocketeer', tagline: 'Fast, bold, built to break out.', centroid: C(4, 4, 4, 2) },
  { slug: 'fo_architect', label: 'The Architect', tagline: 'Craft, structure, and durable systems.', centroid: C(5, 2, 2, 5) },
  { slug: 'fo_maverick', label: 'The Maverick', tagline: 'Independent, instinctive, unafraid.', centroid: C(5, 4, 1, 2) },
];

const INVESTOR_ARCHETYPES: ArchetypeDefinition[] = [
  { slug: 'inv_thesis_backer', label: 'Thesis-Driven Backer', tagline: 'Conviction before the crowd.', centroid: C(2, 5, 2, 4) },
  { slug: 'inv_network_amplifier', label: 'Network Amplifier', tagline: 'Opens doors, compounds relationships.', centroid: C(2, 3, 5, 2) },
  { slug: 'inv_hands_on_partner', label: 'Hands-On Partner', tagline: 'Rolls up sleeves beside the founder.', centroid: C(4, 3, 4, 4) },
  { slug: 'inv_disciplined_allocator', label: 'Disciplined Allocator', tagline: 'Rigorous, patient, process-led.', centroid: C(1, 3, 2, 5) },
];

const PARTNER_ARCHETYPES: ArchetypeDefinition[] = [
  { slug: 'pt_strategic_connector', label: 'Strategic Connector', tagline: 'Aligns the right people to the plan.', centroid: C(2, 4, 5, 3) },
  { slug: 'pt_embedded_operator', label: 'Embedded Operator', tagline: 'In the trenches, delivering.', centroid: C(5, 2, 3, 4) },
  { slug: 'pt_growth_catalyst', label: 'Growth Catalyst', tagline: 'Turns momentum into scale.', centroid: C(4, 4, 4, 2) },
  { slug: 'pt_systems_builder', label: 'Systems Builder', tagline: 'Puts durable machinery in place.', centroid: C(4, 2, 2, 5) },
];

const ADVISOR_ARCHETYPES: ArchetypeDefinition[] = [
  { slug: 'mt_sage_guide', label: 'Sage Guide', tagline: 'Wisdom and perspective when it counts.', centroid: C(2, 5, 4, 3) },
  { slug: 'mt_hands_on_coach', label: 'Hands-On Coach', tagline: 'Beside you, session by session.', centroid: C(4, 2, 5, 3) },
  { slug: 'mt_accountability_anchor', label: 'Accountability Anchor', tagline: 'Keeps commitments honest.', centroid: C(3, 2, 4, 5) },
  { slug: 'mt_craft_master', label: 'Craft Master', tagline: 'Deep expertise, generously shared.', centroid: C(5, 3, 2, 4) },
];

export const ARCHETYPES: Record<FitPersona, ArchetypeDefinition[]> = {
  founder: FOUNDER_ARCHETYPES,
  investor: INVESTOR_ARCHETYPES,
  partner: PARTNER_ARCHETYPES,
  advisor: ADVISOR_ARCHETYPES,
  coach: ADVISOR_ARCHETYPES, // coach shares the advisor archetype set (as with the rubric)
};

export function archetypesForPersona(persona: FitPersona): ArchetypeDefinition[] {
  return ARCHETYPES[persona] ?? [];
}

// ---------------------------------------------------------------------------
// Task #19 — Axal Fit & Values v2. Two additional cross-persona archetypes
// (Scout, Steward) layered on top of each persona's v1 set, giving the v2
// decision engine a 6-archetype space. Additive: the v1 `ARCHETYPES` map,
// `classifyArchetype`, and their unit test are untouched — only the v2 path
// (classifyArchetypeV2 + services/fitV2Decision.ts) reads these.
// ---------------------------------------------------------------------------
const SCOUT_DEF: ArchetypeDefinition = {
  slug: 'scout', label: 'The Scout',
  tagline: 'Finds the opening before the map is drawn.',
  centroid: C(1, 5, 4, 1), // visionary + connector explorer; low process, low hands-on build
};
const STEWARD_DEF: ArchetypeDefinition = {
  slug: 'steward', label: 'The Steward',
  tagline: 'Protects what matters and compounds it patiently.',
  centroid: C(4, 1, 3, 5), // operator + builder; reliable, low-ego, durable
};

export const ARCHETYPES_V2: Record<FitPersona, ArchetypeDefinition[]> = {
  founder: [...FOUNDER_ARCHETYPES, SCOUT_DEF, STEWARD_DEF],
  investor: [...INVESTOR_ARCHETYPES, SCOUT_DEF, STEWARD_DEF],
  partner: [...PARTNER_ARCHETYPES, SCOUT_DEF, STEWARD_DEF],
  advisor: [...ADVISOR_ARCHETYPES, SCOUT_DEF, STEWARD_DEF],
  coach: [...ADVISOR_ARCHETYPES, SCOUT_DEF, STEWARD_DEF],
};

export function archetypesForPersonaV2(persona: FitPersona): ArchetypeDefinition[] {
  return ARCHETYPES_V2[persona] ?? [];
}

// ---------------------------------------------------------------------------
// Pure classification.
// ---------------------------------------------------------------------------
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ArchetypeClassification {
  slug: string;
  label: string;
  tagline: string;
  distance: number;          // Euclidean distance to the winning centroid
  runner_up_slug: string | null;
  margin: number;            // runner_up.distance − winner.distance (bigger = cleaner)
  traits_covered: number;    // distinct traits with a score
  confidence: number;        // 0..1
  trait_scores: TraitScores; // echoed for the scorecard
}

/**
 * Nearest-centroid classification over the traits actually answered. Missing
 * traits are skipped (absence ≠ zero), and distance is normalized by the number
 * of traits compared so a user who answered 3 traits isn't punished vs one who
 * answered 4. Ties break by the archetype's order in the set (deterministic).
 */
export function classifyArchetype(
  persona: FitPersona,
  traitScores: TraitScores,
): ArchetypeClassification | null {
  const defs = archetypesForPersona(persona);
  if (defs.length === 0) return null;
  const answeredTraits = ARCHETYPE_TRAITS.filter((t) => Number.isFinite(traitScores[t] as number));
  if (answeredTraits.length === 0) return null;

  const ranked = defs
    .map((def) => {
      let sumSq = 0;
      for (const t of answeredTraits) {
        const d = clamp(traitScores[t] as number, 0, 5) - def.centroid[t];
        sumSq += d * d;
      }
      return { def, distance: Math.sqrt(sumSq / answeredTraits.length) };
    })
    .sort((a, b) => a.distance - b.distance);

  const winner = ranked[0];
  const runnerUp = ranked[1] ?? null;
  const margin = runnerUp ? round2(runnerUp.distance - winner.distance) : 0;
  const coverage = answeredTraits.length / ARCHETYPE_TRAITS.length;
  // Confidence blends how much of the trait space we saw with how cleanly the
  // winner separated from the runner-up (margin normalized against the 0..5
  // trait range). Both clamped to 0..1.
  const separation = clamp(margin / 2.5, 0, 1);
  const confidence = round2(clamp(0.6 * coverage + 0.4 * separation, 0, 1));

  const echoed: TraitScores = {};
  for (const t of answeredTraits) echoed[t] = round2(clamp(traitScores[t] as number, 0, 5));

  return {
    slug: winner.def.slug,
    label: winner.def.label,
    tagline: winner.def.tagline,
    distance: round2(winner.distance),
    runner_up_slug: runnerUp ? runnerUp.def.slug : null,
    margin,
    traits_covered: answeredTraits.length,
    confidence,
    trait_scores: echoed,
  };
}

/**
 * Task #19 — v2 nearest-centroid classification over the 6-archetype v2 set
 * (persona v1 set + Scout + Steward). Identical method to classifyArchetype;
 * only the centroid set differs. Kept separate so the v1 classifier + its unit
 * test stay frozen.
 */
export function classifyArchetypeV2(
  persona: FitPersona,
  traitScores: TraitScores,
): ArchetypeClassification | null {
  const defs = archetypesForPersonaV2(persona);
  if (defs.length === 0) return null;
  const answeredTraits = ARCHETYPE_TRAITS.filter((t) => Number.isFinite(traitScores[t] as number));
  if (answeredTraits.length === 0) return null;

  const ranked = defs
    .map((def) => {
      let sumSq = 0;
      for (const t of answeredTraits) {
        const d = clamp(traitScores[t] as number, 0, 5) - def.centroid[t];
        sumSq += d * d;
      }
      return { def, distance: Math.sqrt(sumSq / answeredTraits.length) };
    })
    .sort((a, b) => a.distance - b.distance);

  const winner = ranked[0];
  const runnerUp = ranked[1] ?? null;
  const margin = runnerUp ? round2(runnerUp.distance - winner.distance) : 0;
  const coverage = answeredTraits.length / ARCHETYPE_TRAITS.length;
  const separation = clamp(margin / 2.5, 0, 1);
  const confidence = round2(clamp(0.6 * coverage + 0.4 * separation, 0, 1));

  const echoed: TraitScores = {};
  for (const t of answeredTraits) echoed[t] = round2(clamp(traitScores[t] as number, 0, 5));

  return {
    slug: winner.def.slug,
    label: winner.def.label,
    tagline: winner.def.tagline,
    distance: round2(winner.distance),
    runner_up_slug: runnerUp ? runnerUp.def.slug : null,
    margin,
    traits_covered: answeredTraits.length,
    confidence,
    trait_scores: echoed,
  };
}

/**
 * Task #19 — load a persona's answered archetype-trait 0..5 scores (means per
 * trait) from field_sources. Exposed so services/fitV2Decision.ts can classify
 * with the v2 archetype set without re-implementing the loaders.
 */
export async function loadPersonaTraitScores(
  env: Env,
  userId: number,
  persona: FitPersona,
): Promise<TraitScores> {
  const entries = traitQuestionsFor(persona);
  if (entries.length === 0) return {};
  const answered = await loadAnsweredScores(env, userId, entries.map((e) => e.question_id));
  return aggregateTraits(entries, answered);
}

/** Deterministic one-line narrative for the scorecard. */
export function narrativeArchetype(c: ArchetypeClassification): string {
  const strongest = (Object.entries(c.trait_scores) as [ArchetypeTrait, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => TRAIT_SPECS[k].label.toLowerCase());
  const pct = Math.round(c.confidence * 100);
  let s = `${c.label} — ${c.tagline} (${pct}% confidence, ${c.traits_covered}/${ARCHETYPE_TRAITS.length} traits).`;
  if (strongest.length) s += ` Leans ${strongest.join(' + ')}.`;
  return s;
}

// ---------------------------------------------------------------------------
// DB-aware orchestration.
// ---------------------------------------------------------------------------
export interface ArchetypeResult extends ArchetypeClassification {
  persona: FitPersona;
  computed_at: string;
}

const SCHEMA_READY = new WeakMap<object, boolean>();

/** Self-healing bootstrap — mirrors ensureAxalFitSchema. */
export async function ensureArchetypeSchema(env: Env): Promise<void> {
  if (SCHEMA_READY.get(bindingKey(env))) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS profile_archetypes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, persona TEXT NOT NULL, archetype_slug TEXT NOT NULL, archetype_label TEXT NOT NULL, traits_json TEXT, confidence REAL NOT NULL DEFAULT 0, distance REAL NOT NULL DEFAULT 0, narrative TEXT, computed_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_profile_archetypes_latest ON profile_archetypes (user_id, persona, computed_at)",
    );
    SCHEMA_READY.set(bindingKey(env), true);
  } catch (e) {
    console.warn('[archetypeScoring] ensure schema failed:', (e as Error).message);
  }
}

/** The archetype-trait question ids for a persona and the trait each loads. */
function traitQuestionsFor(persona: FitPersona): { question_id: string; trait: ArchetypeTrait; reverse?: boolean }[] {
  const out: { question_id: string; trait: ArchetypeTrait; reverse?: boolean }[] = [];
  for (const e of fitMeasuresIndex()) {
    if (e.persona !== persona) continue;
    const trait = e.measures.archetype_trait;
    if (trait && (ARCHETYPE_TRAITS as readonly string[]).includes(trait)) {
      out.push({ question_id: e.question_id, trait: trait as ArchetypeTrait, reverse: e.reverse === true });
    }
  }
  return out;
}

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
    console.error('[archetypeScoring] loadAnsweredScores:', (e as Error).message);
  }
  return out;
}

/** Mean each trait's answered 0..5 scores into a TraitScores vector. */
function aggregateTraits(
  entries: { question_id: string; trait: ArchetypeTrait; reverse?: boolean }[],
  answered: Map<string, number>,
): TraitScores {
  const sums: Partial<Record<ArchetypeTrait, { sum: number; count: number }>> = {};
  for (const e of entries) {
    const raw = answered.get(e.question_id);
    if (raw == null) continue;
    // D357 — a reverse-keyed probe (Profiling v2) is scored 5 − answer here
    // too, so v1's card never reads one backwards while Session 15 moves the
    // page onto v2.
    const score = e.reverse ? 5 - raw : raw;
    const acc = sums[e.trait] ?? (sums[e.trait] = { sum: 0, count: 0 });
    acc.sum += score;
    acc.count += 1;
  }
  const out: TraitScores = {};
  for (const t of ARCHETYPE_TRAITS) {
    const acc = sums[t];
    if (acc && acc.count > 0) out[t] = acc.sum / acc.count;
  }
  return out;
}

/**
 * Compute (and optionally persist) the archetype for one persona from the
 * user's answered trait signals. Returns null when there isn't a single trait
 * answered yet (so the card keeps its clean empty state).
 */
export async function computeArchetype(
  env: Env,
  userId: number,
  persona: FitPersona,
  opts?: { persist?: boolean },
): Promise<ArchetypeResult | null> {
  const entries = traitQuestionsFor(persona);
  if (entries.length === 0) return null;
  const answered = await loadAnsweredScores(env, userId, entries.map((e) => e.question_id));
  const traitScores = aggregateTraits(entries, answered);
  const cls = classifyArchetype(persona, traitScores);
  if (!cls) return null;

  const result: ArchetypeResult = { ...cls, persona, computed_at: new Date().toISOString() };
  if (opts?.persist) await persistArchetype(env, userId, result);
  return result;
}

async function persistArchetype(env: Env, userId: number, r: ArchetypeResult): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO profile_archetypes
         (user_id, persona, archetype_slug, archetype_label, traits_json, confidence, distance, narrative, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        userId,
        r.persona,
        r.slug,
        r.label,
        JSON.stringify(r.trait_scores),
        r.confidence,
        r.distance,
        narrativeArchetype(r),
        r.computed_at,
      )
      .run();
  } catch (e) {
    console.error('[archetypeScoring] persistArchetype:', (e as Error).message);
  }
}

/**
 * Recompute + persist the archetype for every persona the user has answered
 * trait questions for. Called from the advisor /answer path after a batch.
 * Best-effort: never throws into the answer envelope.
 */
export async function recomputeUserArchetype(env: Env, userId: number): Promise<ArchetypeResult[]> {
  try {
    await ensureArchetypeSchema(env);
    const personas = Object.keys(ARCHETYPES) as FitPersona[];
    const out: ArchetypeResult[] = [];
    for (const persona of personas) {
      const r = await computeArchetype(env, userId, persona, { persist: true });
      if (r) out.push(r);
    }
    return out;
  } catch (e) {
    console.error('[archetypeScoring] recomputeUserArchetype:', (e as Error).message);
    return [];
  }
}

/** Latest persisted archetype for a persona. */
export async function loadLatestArchetype(
  env: Env,
  userId: number,
  persona: FitPersona,
): Promise<ArchetypeResult | null> {
  try {
    await ensureArchetypeSchema(env);
    const row = await env.DB.prepare(
      `SELECT persona, archetype_slug, archetype_label, traits_json, confidence, distance, narrative, computed_at
         FROM profile_archetypes
        WHERE user_id = ? AND persona = ?
        ORDER BY computed_at DESC, id DESC
        LIMIT 1`,
    )
      .bind(userId, persona)
      .first<{
        persona: string;
        archetype_slug: string;
        archetype_label: string;
        traits_json: string | null;
        confidence: number;
        distance: number;
        narrative: string | null;
        computed_at: string;
      }>();
    if (!row) return null;
    let traits: TraitScores = {};
    try { traits = row.traits_json ? (JSON.parse(row.traits_json) as TraitScores) : {}; } catch { /* ignore */ }
    return {
      persona: row.persona as FitPersona,
      slug: row.archetype_slug,
      label: row.archetype_label,
      tagline: archetypesForPersona(row.persona as FitPersona).find((a) => a.slug === row.archetype_slug)?.tagline ?? '',
      distance: row.distance,
      runner_up_slug: null,
      margin: 0,
      traits_covered: Object.keys(traits).length,
      confidence: row.confidence,
      trait_scores: traits,
      computed_at: row.computed_at,
    };
  } catch (e) {
    console.error('[archetypeScoring] loadLatestArchetype:', (e as Error).message);
    return null;
  }
}

/** Latest archetype across all personas the user has one for (best confidence first). */
export async function loadAllLatestArchetype(env: Env, userId: number): Promise<ArchetypeResult[]> {
  const seen = new Set<FitPersona>();
  const out: ArchetypeResult[] = [];
  for (const persona of Object.keys(ARCHETYPES) as FitPersona[]) {
    if (seen.has(persona)) continue;
    seen.add(persona);
    const r = await loadLatestArchetype(env, userId, persona);
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

// ===========================================================================
// D357 — Profiling v2 scoring engine (documentation/architecture/
// PROFILING_V2.md §2, §3, §7). Pure: no D1, no clock. The DB-aware side —
// reading the ledger, snapshots, hysteresis state — is
// services/profileHistory.ts.
//
// What differs from v1 above, all per the spec:
//   * it reads a LEDGER of dated answers (latest per question at or before
//     the evaluation time), not field_sources' single latest row;
//   * each answer carries an ageing weight 0.5 ^ (age / 365 days);
//   * a reverse-keyed scale scores 5 − answer, a pick-one contributes its
//     chosen option's per-trait loadings;
//   * it reports a secondary archetype (runner-up within 0.5) and a blend;
//   * confidence also falls when a person's plain and reverse-keyed answers
//     on one trait contradict each other — "5 to everything" is not a profile.
// v1 (`classifyArchetype`, `computeArchetype`, `ARCHETYPES`) is unchanged
// and keeps serving its callers until Session 15 moves the card page.
// ===========================================================================

/** Stamped on every snapshot. Bump it when a rule below changes. */
export const ENGINE_VERSION = 'profiling-v2.1';

/** PROFILING_V2.md §7.0, plus this engine's confidence settings (D357). */
export const PROFILE_V2_PARAMS = {
  half_life_days: 365,
  reask_after_days: 182,
  hysteresis_days: 14,
  lead_margin: 0.25,
  secondary_margin: 0.5,
  /** confidence at or above this reads "confident". */
  confident_at: 0.6,
  /** a margin of this much (normalised distance) counts as full separation. */
  separation_full_at: 1.0,
} as const;

const DAY_MS = 86_400_000;

/**
 * The v2 centroid set. It is v1's, unchanged: PROFILING_V2.md §2.2 proposed
 * moving Systems Builder to (3, 2, 2, 5), and measured against the Session 6
 * personas that move classifies a hands-on Systems Builder (builder 4.3,
 * operator 4.6) as an Embedded Operator. D357 keeps the centroid; the close
 * pair is reported as a blend and separated by situational items instead.
 */
export const ARCHETYPES_PROFILE_V2: Record<FitPersona, ArchetypeDefinition[]> = {
  founder: FOUNDER_ARCHETYPES,
  investor: INVESTOR_ARCHETYPES,
  partner: PARTNER_ARCHETYPES,
  advisor: ADVISOR_ARCHETYPES,
  coach: ADVISOR_ARCHETYPES,
};

/** One answer in the ledger, as the person gave it. */
export interface LedgerAnswer {
  question_id: string;
  /** The raw answer: '0'..'5' for a scale (reverse-keyed or not), an option key for a pick-one. */
  value: string;
  /** ISO-8601, or SQLite's 'YYYY-MM-DD HH:MM:SS' (UTC). */
  answered_at: string;
}

/** What scoring needs to know about a fit question. */
export interface ScoringItem {
  question_id: string;
  measures: import('./advisor/questionBank.ts').FitMeasures;
  reverse?: boolean;
  choices?: import('./advisor/questionBank.ts').FitChoice[];
  /** Retired, with a replacement: stops counting once the replacement is answered (§3.2). */
  replaced_by?: string;
}

/** The persona's fit items, from the real banks. Tests pass their own. */
export function scoringItemsFor(persona: FitPersona): ScoringItem[] {
  return fitMeasuresIndex()
    .filter((e) => e.persona === persona)
    .map((e) => ({ question_id: e.question_id, measures: e.measures, reverse: e.reverse, choices: e.choices, replaced_by: e.replaced_by }));
}

/** Milliseconds since the epoch for a ledger timestamp; NaN when unreadable. */
export function answerTimeMs(at: string): number {
  const s = String(at ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return Date.parse(`${s.replace(' ', 'T')}Z`);
  return Date.parse(s);
}

/** The last millisecond of a UTC day 'YYYY-MM-DD' — the nightly evaluation point. */
export function endOfDayMs(day: string): number {
  return Date.parse(`${day}T23:59:59.999Z`);
}

export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** §7.2: an answer's weight halves every half_life_days. Never 0, never above 1. */
export function ageWeight(ageDays: number): number {
  if (!(ageDays > 0)) return 1;
  return 0.5 ** (ageDays / PROFILE_V2_PARAMS.half_life_days);
}

/**
 * §7.1: the latest answer to each question at or before `atMs`. Answers at
 * the same instant keep ledger order (the later row wins), so the result is a
 * pure function of the ledger as given.
 */
export function latestAnswers(ledger: readonly LedgerAnswer[], atMs: number): Map<string, LedgerAnswer> {
  const out = new Map<string, LedgerAnswer>();
  const best = new Map<string, number>();
  for (const a of ledger) {
    const t = answerTimeMs(a.answered_at);
    if (!Number.isFinite(t) || t > atMs) continue;
    const prev = best.get(a.question_id);
    if (prev === undefined || t >= prev) {
      best.set(a.question_id, t);
      out.set(a.question_id, a);
    }
  }
  return out;
}

export interface TraitScoringV2 {
  /** Age-weighted mean per trait; a trait nobody answered is absent, never 0. */
  traits: TraitScores;
  /** 0..1 — 1 unless plain and reverse-keyed answers on a trait disagree. */
  consistency: number;
  /** Answers that contributed. */
  answers_used: number;
}

/** Parse a 0..5 whole-number scale answer; null when it is not one. */
function scaleValue(raw: string): number | null {
  const n = Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
}

/**
 * Combine trait probes, reverse-keyed scales and pick-one loadings into one
 * trait vector at `atMs` (PROFILING_V2.md §2.5, §3.2, §7.2).
 */
export function scoreTraitsV2(
  items: readonly ScoringItem[],
  latest: Map<string, LedgerAnswer>,
  atMs: number,
): TraitScoringV2 {
  const acc: Partial<Record<ArchetypeTrait, { sum: number; w: number }>> = {};
  const plain: Partial<Record<ArchetypeTrait, { sum: number; w: number }>> = {};
  const reversed: Partial<Record<ArchetypeTrait, { sum: number; w: number }>> = {};
  const add = (bucket: typeof acc, t: ArchetypeTrait, v: number, w: number) => {
    const b = bucket[t] ?? (bucket[t] = { sum: 0, w: 0 });
    b.sum += v * w;
    b.w += w;
  };
  let used = 0;
  for (const item of items) {
    const a = latest.get(item.question_id);
    if (!a) continue;
    // A retired question keeps counting as it ages, until the person has
    // answered the question that replaced it (PROFILING_V2.md §3.2).
    if (item.replaced_by && latest.has(item.replaced_by)) continue;
    const t = answerTimeMs(a.answered_at);
    if (!Number.isFinite(t)) continue;
    const w = ageWeight((atMs - t) / DAY_MS);
    const trait = item.measures.archetype_trait as ArchetypeTrait | undefined;
    if (trait && (ARCHETYPE_TRAITS as readonly string[]).includes(trait)) {
      const v = scaleValue(a.value);
      if (v === null) continue;
      const scored = item.reverse ? 5 - v : v;
      add(acc, trait, scored, w);
      add(item.reverse ? reversed : plain, trait, scored, w);
      used += 1;
    } else if (item.measures.archetype_choice && item.choices) {
      const choice = item.choices.find((c) => c.key === a.value);
      if (!choice) continue;
      let loaded = false;
      for (const [k, l] of Object.entries(choice.loadings)) {
        if (!(ARCHETYPE_TRAITS as readonly string[]).includes(k) || !Number.isFinite(l)) continue;
        add(acc, k as ArchetypeTrait, clamp(l as number, 0, 5), w);
        loaded = true;
      }
      if (loaded) used += 1;
    }
  }
  const traits: TraitScores = {};
  for (const t of ARCHETYPE_TRAITS) {
    const b = acc[t];
    if (b && b.w > 0) traits[t] = b.sum / b.w;
  }
  const checks: number[] = [];
  for (const t of ARCHETYPE_TRAITS) {
    const p = plain[t];
    const r = reversed[t];
    if (p && r && p.w > 0 && r.w > 0) checks.push(1 - Math.abs(p.sum / p.w - r.sum / r.w) / 5);
  }
  const consistency = checks.length ? checks.reduce((x, y) => x + y, 0) / checks.length : 1;
  return { traits, consistency: clamp(consistency, 0, 1), answers_used: used };
}

export interface ClassificationV2 {
  persona: FitPersona;
  primary: string;
  primary_label: string;
  /** Runner-up within secondary_margin, else null. */
  secondary: string | null;
  /** True when a secondary is reported (the spec's blend rule). */
  blend: boolean;
  /** runner-up distance − winner distance (normalised). */
  margin: number;
  confidence: number;
  confident: boolean;
  consistency: number;
  traits_covered: number;
  /** Rounded to 2 dp, keys in ARCHETYPE_TRAITS order. */
  traits: TraitScores;
  /** Normalised distance to every archetype of the persona, by slug — unrounded; round when storing. */
  distances: Record<string, number>;
}

/**
 * Nearest centroid over the answered traits (normalised Euclidean, missing
 * traits skipped — absence is never 0), ties by set order. Confidence is
 * coverage × consistency × (0.4 + 0.6 × separation).
 */
export function classifyProfileV2(persona: FitPersona, scoring: TraitScoringV2): ClassificationV2 | null {
  const defs = ARCHETYPES_PROFILE_V2[persona] ?? [];
  const answered = ARCHETYPE_TRAITS.filter((t) => Number.isFinite(scoring.traits[t] as number));
  if (!defs.length || !answered.length) return null;
  const ranked = defs
    .map((def, order) => {
      let sumSq = 0;
      for (const t of answered) {
        const d = clamp(scoring.traits[t] as number, 0, 5) - def.centroid[t];
        sumSq += d * d;
      }
      return { def, order, distance: Math.sqrt(sumSq / answered.length) };
    })
    .sort((a, b) => a.distance - b.distance || a.order - b.order);
  const winner = ranked[0];
  const runner = ranked[1] ?? null;
  const margin = runner ? runner.distance - winner.distance : 0;
  const secondary = runner && margin < PROFILE_V2_PARAMS.secondary_margin ? runner.def.slug : null;
  const coverage = answered.length / ARCHETYPE_TRAITS.length;
  const separation = clamp(margin / PROFILE_V2_PARAMS.separation_full_at, 0, 1);
  const confidence = round2(clamp(coverage * scoring.consistency * (0.4 + 0.6 * separation), 0, 1));
  const traits: TraitScores = {};
  for (const t of answered) traits[t] = round2(clamp(scoring.traits[t] as number, 0, 5));
  const distances: Record<string, number> = {};
  for (const r of ranked) distances[r.def.slug] = r.distance;
  return {
    persona,
    primary: winner.def.slug,
    primary_label: winner.def.label,
    secondary,
    blend: secondary !== null,
    margin: round2(margin),
    confidence,
    confident: confidence >= PROFILE_V2_PARAMS.confident_at,
    consistency: round2(scoring.consistency),
    traits_covered: answered.length,
    traits,
    distances,
  };
}

/** Score and classify in one step at `atMs`. */
export function classifyLedgerV2(
  persona: FitPersona,
  items: readonly ScoringItem[],
  ledger: readonly LedgerAnswer[],
  atMs: number,
): ClassificationV2 | null {
  return classifyProfileV2(persona, scoreTraitsV2(items, latestAnswers(ledger, atMs), atMs));
}

export interface DisplayState {
  /** What the card shows (§7.5). */
  displayed: string | null;
  /** The nearest centroid on the evaluation day. */
  computed: string | null;
  /** A challenger that has not yet held for hysteresis_days, with the day it started winning. */
  pending: { slug: string; since: string } | null;
  /** The day the displayed archetype last changed (or was first set). */
  displayed_since: string | null;
  /** The classification on the evaluation day. */
  classification: ClassificationV2 | null;
}

/**
 * §7.5 — replay the daily evaluations from the first archetype answer to
 * `asOfDay` (end of each UTC day) and return the displayed archetype. The
 * first classification is displayed at once; a challenger replaces it on the
 * first day it has been the computed winner for hysteresis_days consecutive
 * days AND leads the displayed archetype by at least lead_margin that day.
 * Replay is the definition, so the result depends on the ledger and the date
 * only.
 */
export function replayDisplayed(
  persona: FitPersona,
  items: readonly ScoringItem[],
  ledger: readonly LedgerAnswer[],
  asOfDay: string,
): DisplayState {
  const ids = new Set(items.filter((i) => i.measures.archetype_trait || i.measures.archetype_choice).map((i) => i.question_id));
  const relevant = ledger
    .map((a, idx) => ({ a, idx, t: answerTimeMs(a.answered_at) }))
    .filter((x) => ids.has(x.a.question_id) && Number.isFinite(x.t))
    .sort((x, y) => x.t - y.t || x.idx - y.idx);
  const empty: DisplayState = { displayed: null, computed: null, pending: null, displayed_since: null, classification: null };
  if (!relevant.length) return empty;
  const endMs = endOfDayMs(asOfDay);
  let day = dayOf(relevant[0].t);
  if (endOfDayMs(day) > endMs) return empty;

  const latest = new Map<string, LedgerAnswer>();
  let cursor = 0;
  let displayed: string | null = null;
  let displayedSince: string | null = null;
  let streakSlug: string | null = null;
  let streakStart: string | null = null;
  let streak = 0;
  let last: ClassificationV2 | null = null;
  for (;;) {
    const atMs = endOfDayMs(day);
    while (cursor < relevant.length && relevant[cursor].t <= atMs) {
      latest.set(relevant[cursor].a.question_id, relevant[cursor].a);
      cursor += 1;
    }
    const c = classifyProfileV2(persona, scoreTraitsV2(items, latest, atMs));
    last = c;
    if (c) {
      if (c.primary === streakSlug) streak += 1;
      else { streakSlug = c.primary; streakStart = day; streak = 1; }
      if (displayed === null) { displayed = c.primary; displayedSince = day; }
      else if (
        c.primary !== displayed
        && streak >= PROFILE_V2_PARAMS.hysteresis_days
        && (c.distances[displayed] - c.distances[c.primary]) >= PROFILE_V2_PARAMS.lead_margin
      ) {
        displayed = c.primary;
        displayedSince = day;
      }
    }
    if (atMs >= endMs) break;
    day = dayOf(atMs + 1);
  }
  const pending = last && displayed && last.primary !== displayed && streakSlug === last.primary && streakStart
    ? { slug: last.primary, since: streakStart }
    : null;
  return { displayed, computed: last?.primary ?? null, pending, displayed_since: displayedSince, classification: last };
}
