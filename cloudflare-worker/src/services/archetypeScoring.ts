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

let _schemaReady = false;

/** Self-healing bootstrap — mirrors ensureAxalFitSchema. */
export async function ensureArchetypeSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS profile_archetypes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, persona TEXT NOT NULL, archetype_slug TEXT NOT NULL, archetype_label TEXT NOT NULL, traits_json TEXT, confidence REAL NOT NULL DEFAULT 0, distance REAL NOT NULL DEFAULT 0, narrative TEXT, computed_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_profile_archetypes_latest ON profile_archetypes (user_id, persona, computed_at)",
    );
    _schemaReady = true;
  } catch (e) {
    console.warn('[archetypeScoring] ensure schema failed:', (e as Error).message);
  }
}

/** The archetype-trait question ids for a persona and the trait each loads. */
function traitQuestionsFor(persona: FitPersona): { question_id: string; trait: ArchetypeTrait }[] {
  const out: { question_id: string; trait: ArchetypeTrait }[] = [];
  for (const e of fitMeasuresIndex()) {
    if (e.persona !== persona) continue;
    const trait = e.measures.archetype_trait;
    if (trait && (ARCHETYPE_TRAITS as readonly string[]).includes(trait)) {
      out.push({ question_id: e.question_id, trait: trait as ArchetypeTrait });
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
  entries: { question_id: string; trait: ArchetypeTrait }[],
  answered: Map<string, number>,
): TraitScores {
  const sums: Partial<Record<ArchetypeTrait, { sum: number; count: number }>> = {};
  for (const e of entries) {
    const score = answered.get(e.question_id);
    if (score == null) continue;
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
