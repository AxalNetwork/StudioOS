/**
 * Task #44 — Gamified Assessment scoring engine (design §4, §5, §8).
 *
 * `computeAssessment()` is a PURE function: responses + item definitions →
 * { valueVector, skillVector, confidence, flags }. No I/O, no DB, no Date.now —
 * deterministic so the same answers always produce the same result (and the
 * same HMAC). The route layer (routes/assessment.ts) loads the rows, calls this,
 * then persists + signs.
 *
 * Result signing (§8) reuses the existing score-integrity helper
 * (services/scoreIntegrity.ts::signHmac) so the assessment + diligence engines
 * share one secret (SCORING_HMAC_SECRET || JWT_SECRET) and one algorithm
 * (HMAC-SHA256). signResult/verifyResult sign a deterministic, sorted-key
 * canonical serialization so JSON key ordering can never change the hash.
 */
import type { Env } from '../types';
import { signHmac } from './scoreIntegrity';
import { RADAR_AXES } from './skillsTaxonomySchema';

export const ASSESSMENT_INTEGRITY_VERSION = 1;

// The 8 canonical radar axes are the skill-vector keys; any measured slug not in
// this set is a value dimension. Sourcing the set from RADAR_AXES means the
// engine classifies loads without needing the taxonomy tables present (cold D1 /
// focused unit tests), and stays in lockstep with the canonical taxonomy.
export const SKILL_AXIS_SLUGS: ReadonlySet<string> = new Set(RADAR_AXES.map((a) => a.slug));

// ── Public shapes ──────────────────────────────────────────────────────────

export interface ScoringItem {
  id: number;
  slug?: string;
  mechanic: string;
  options: any;   // parsed options_json
  measures: any;  // parsed measures_json: { values?: string[]; skills?: string[] }
  loads?: any;    // parsed loads_json (magnitude hints; unused in the base engine)
  config: any;    // parsed config_json
}

export interface ScoringResponse {
  item_id: number;
  mechanic?: string | null;
  response: any;            // parsed response_json (the player's answer)
  response_value?: number | null;
  latency_ms?: number | null;
  confidence_wager?: number | null;
}

export interface AssessmentFlag {
  type: 'contradiction' | 'low_confidence' | 'low_coverage';
  dimension?: string;
  detail: string;
}

export interface ScoreOutput {
  valueVector: Record<string, number>;
  skillVector: Record<string, number>;
  confidence: Record<string, number>;
  flags: AssessmentFlag[];
}

// ── Helpers ──────────────────────────────────────────────────────────────--

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function isSkillAxis(slug: string): boolean {
  return SKILL_AXIS_SLUGS.has(slug);
}

/** Pull the chosen single-option key out of a response payload (dilemma/sjt/speed). */
function chosenKey(resp: any): string | null {
  if (resp == null) return null;
  if (typeof resp === 'string') return resp;
  const v = resp.choice ?? resp.key ?? resp.option ?? resp.selected ?? resp.value;
  return v == null ? null : String(v);
}

/** Find the option/card/bucket array for the mechanic, tolerating shape drift. */
function optionList(options: any): any[] {
  if (!options || typeof options !== 'object') return [];
  if (Array.isArray(options.options)) return options.options;
  if (Array.isArray(options.cards)) return options.cards;
  if (Array.isArray(options.buckets)) return options.buckets;
  if (Array.isArray(options)) return options;
  return [];
}

function loadsOf(opt: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (opt && typeof opt.loads === 'object' && opt.loads) {
    for (const [k, v] of Object.entries(opt.loads)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

/**
 * Resolve a single response into this item's NET weighted load per dimension
 * (one entry per dimension, mechanic-weighting already applied), plus any
 * explicit skill self_level hints (sjt seniority_hint). Pure.
 */
function resolveItem(item: ScoringItem, resp: ScoringResponse): {
  loads: Record<string, number>;
  seniority: Record<string, number>;
} {
  const loads: Record<string, number> = {};
  const seniority: Record<string, number> = {};
  const opts = optionList(item.options);
  const add = (m: Record<string, number>, factor: number) => {
    for (const [k, v] of Object.entries(m)) {
      loads[k] = (loads[k] || 0) + v * factor;
    }
  };

  switch (item.mechanic) {
    case 'dilemma': {
      const key = chosenKey(resp.response);
      const opt = opts.find((o) => String(o.key) === key);
      if (opt) add(loadsOf(opt), 1);
      break;
    }
    case 'sjt': {
      const key = chosenKey(resp.response);
      const opt = opts.find((o) => String(o.key) === key);
      if (opt) {
        add(loadsOf(opt), 1);
        // seniority_hint (config) maps a chosen sjt option to a skill self_level.
        const hint = item.config?.seniority_hint;
        if (hint && hint.skill != null && hint.self_level != null) {
          const lvl = clamp(Number(hint.self_level) || 0, 0, 5);
          seniority[String(hint.skill)] = Math.max(seniority[String(hint.skill)] || 0, lvl);
        }
      }
      break;
    }
    case 'speed': {
      const key = chosenKey(resp.response);
      const opt = opts.find((o) => String(o.key) === key);
      if (!opt) break; // timeout / no pick → contributes nothing
      // Latency weighting: fast = full weight, near-timeout → toward 0.
      const timer = Number(item.config?.timer_ms ?? item.options?.timer_ms ?? 0);
      let w = 1;
      if (timer > 0 && resp.latency_ms != null && Number.isFinite(Number(resp.latency_ms))) {
        w = clamp(1 - Number(resp.latency_ms) / timer, 0, 1);
      }
      add(loadsOf(opt), w);
      break;
    }
    case 'card_sort': {
      // Rank scaling: rank 1 = 1.0, rank 2 = 0.6, rank 3 = 0.36 … (0.6^idx).
      const picked: string[] = Array.isArray(resp.response?.picked)
        ? resp.response.picked
        : Array.isArray(resp.response?.cards)
          ? resp.response.cards
          : Array.isArray(resp.response)
            ? resp.response
            : [];
      picked.forEach((cardKey, idx) => {
        const card = opts.find((o) => String(o.key) === String(cardKey));
        if (card) add(loadsOf(card), Math.pow(0.6, idx));
      });
      break;
    }
    case 'allocation': {
      // Each bucket contributes proportionally to its share of the total.
      const alloc: Record<string, number> = (resp.response?.allocation && typeof resp.response.allocation === 'object')
        ? resp.response.allocation
        : (resp.response && typeof resp.response === 'object' ? resp.response : {});
      let total = Number(item.config?.total ?? item.options?.total ?? 0);
      if (!(total > 0)) {
        total = Object.values(alloc).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
      }
      if (total > 0) {
        for (const bucket of opts) {
          const pts = Number(alloc[bucket.key]) || 0;
          if (pts !== 0) add(loadsOf(bucket), pts / total);
        }
      }
      break;
    }
    default:
      // reflection (and unknown mechanics) carry no scoring loads.
      break;
  }

  return { loads, seniority };
}

// ── Core scoring ─────────────────────────────────────────────────────────--

/**
 * Compute the value/skill vectors, per-dimension confidence, and flags from a
 * set of responses + their item definitions. Pure & deterministic.
 *
 * Value score (§4.2): mean of contributing per-item deltas, clamped [−2,+2]. A
 * dimension with no responses is absent (absence ≠ neutrality).
 * Confidence (§4.3): min(1, n_mechanics/2) × agreement factor.
 * Contradiction (§4.4): a dimension measured by ≥2 mechanics whose deltas
 * disagree gets a `contradiction` flag and ×0.5 confidence.
 * Skill vector (§4.6): summed weighted skill loads, floored by sjt seniority
 * hints, clamped [0,5].
 */
export function computeAssessment(
  items: ScoringItem[],
  responses: ScoringResponse[],
): ScoreOutput {
  const itemById = new Map<number, ScoringItem>();
  for (const it of items) itemById.set(it.id, it);

  // Per value dimension: the list of per-item contributions + the mechanics seen.
  const valueContribs = new Map<string, number[]>();
  const valueMechanics = new Map<string, Set<string>>();
  // Per skill axis: summed weighted loads + max seniority hint.
  const skillSum = new Map<string, number>();
  const skillSeniority = new Map<string, number>();

  for (const resp of responses) {
    const item = itemById.get(resp.item_id);
    if (!item) continue;
    const { loads, seniority } = resolveItem(item, resp);

    for (const [slug, delta] of Object.entries(loads)) {
      if (isSkillAxis(slug)) {
        skillSum.set(slug, (skillSum.get(slug) || 0) + delta);
      } else {
        const arr = valueContribs.get(slug) || [];
        arr.push(delta);
        valueContribs.set(slug, arr);
        const mset = valueMechanics.get(slug) || new Set<string>();
        mset.add(item.mechanic);
        valueMechanics.set(slug, mset);
      }
    }
    for (const [slug, lvl] of Object.entries(seniority)) {
      skillSeniority.set(slug, Math.max(skillSeniority.get(slug) || 0, lvl));
    }
  }

  const valueVector: Record<string, number> = {};
  const confidence: Record<string, number> = {};
  const flags: AssessmentFlag[] = [];
  const AGREE_TOL = 0.25;

  for (const [slug, contribs] of valueContribs) {
    if (contribs.length === 0) continue;
    const mean = contribs.reduce((a, b) => a + b, 0) / contribs.length;
    valueVector[slug] = round2(clamp(mean, -2, 2));

    const nMech = (valueMechanics.get(slug) || new Set()).size;
    let conf = Math.min(1, nMech / 2);

    const hasPos = contribs.some((d) => d > AGREE_TOL);
    const hasNeg = contribs.some((d) => d < -AGREE_TOL);
    const disagree = hasPos && hasNeg;
    if (nMech >= 2 && disagree) {
      conf *= 0.5;
      flags.push({
        type: 'contradiction',
        dimension: slug,
        detail: `Conflicting signals across ${nMech} mechanics for ${slug}; confidence reduced.`,
      });
    }
    confidence[slug] = round2(clamp(conf, 0, 1));
    if (confidence[slug] < 0.5) {
      flags.push({
        type: 'low_confidence',
        dimension: slug,
        detail: `Only ${nMech} mechanic(s) measured ${slug}.`,
      });
    }
  }

  const skillVector: Record<string, number> = {};
  const axes = new Set<string>([...skillSum.keys(), ...skillSeniority.keys()]);
  for (const slug of axes) {
    const raw = skillSum.get(slug) || 0;
    const sen = skillSeniority.get(slug) || 0;
    const level = round2(clamp(Math.max(raw, sen), 0, 5));
    if (level > 0) skillVector[slug] = level;
  }

  return { valueVector, skillVector, confidence, flags };
}

// ── Archetype assignment (§5) ───────────────────────────────────────────────

export interface ArchetypeDef {
  slug: string;
  label: string;
  badge_slug?: string | null;
  centroid: { values?: Record<string, number>; skills?: Record<string, number> };
  display_order?: number;
}

export interface ArchetypeAssignment {
  slug: string;
  label: string;
  badge_slug: string | null;
  distance: number;
}

/**
 * Pick the nearest archetype centroid by Euclidean distance over the shared
 * dimensions (missing dimensions skipped; distance normalized by the count
 * compared). Ties break by display_order then slug. Deterministic.
 */
export function assignArchetype(
  archetypes: ArchetypeDef[],
  vectors: { valueVector: Record<string, number>; skillVector: Record<string, number> },
): ArchetypeAssignment | null {
  let best: ArchetypeAssignment | null = null;
  let bestOrder = Number.POSITIVE_INFINITY;

  const ordered = [...archetypes].sort((a, b) => {
    const oa = a.display_order ?? 0;
    const ob = b.display_order ?? 0;
    if (oa !== ob) return oa - ob;
    return a.slug.localeCompare(b.slug);
  });

  for (const arch of ordered) {
    const cv = arch.centroid?.values || {};
    const cs = arch.centroid?.skills || {};
    let sumSq = 0;
    let count = 0;
    for (const [k, v] of Object.entries(cv)) {
      if (k in vectors.valueVector) {
        const d = vectors.valueVector[k] - Number(v);
        sumSq += d * d;
        count++;
      }
    }
    for (const [k, v] of Object.entries(cs)) {
      if (k in vectors.skillVector) {
        const d = vectors.skillVector[k] - Number(v);
        sumSq += d * d;
        count++;
      }
    }
    if (count === 0) continue; // no shared dims → not comparable
    const distance = Math.sqrt(sumSq / count);
    const order = arch.display_order ?? 0;
    if (
      best === null ||
      distance < best.distance - 1e-9 ||
      (Math.abs(distance - best.distance) <= 1e-9 && order < bestOrder)
    ) {
      best = { slug: arch.slug, label: arch.label, badge_slug: arch.badge_slug ?? null, distance: round2(distance) };
      bestOrder = order;
    }
  }
  return best;
}

// ── XP / level (§6) ─────────────────────────────────────────────────────────

/** Level derived from cumulative XP: floor(sqrt(xp/100)) + 1. */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

// ── Integrity signing (§8) ───────────────────────────────────────────────--

export interface ResultCanonicalInput {
  userId: number;
  sessionId: number;
  track: string;
  valueVector: Record<string, number>;
  skillVector: Record<string, number>;
  archetypeSlug: string | null;
  integrityVersion?: number;
}

/** Deterministic JSON with recursively sorted object keys. */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function canonicalResult(input: ResultCanonicalInput): string {
  return stableStringify({
    userId: input.userId,
    sessionId: input.sessionId,
    track: input.track,
    valueVector: input.valueVector,
    skillVector: input.skillVector,
    archetypeSlug: input.archetypeSlug ?? null,
    integrityVersion: input.integrityVersion ?? ASSESSMENT_INTEGRITY_VERSION,
  });
}

export async function signResult(env: Env, input: ResultCanonicalInput): Promise<string> {
  return signHmac(env, canonicalResult(input));
}

export async function verifyResult(
  env: Env,
  input: ResultCanonicalInput,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) return false;
  const expected = await signResult(env, input);
  if (expected.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}
