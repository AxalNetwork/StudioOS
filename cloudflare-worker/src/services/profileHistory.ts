/**
 * D357 — Profiling v2 history store: snapshots, hysteresis state and the
 * recompute entry point (documentation/architecture/PROFILING_V2.md §7, §8).
 *
 * A profile is RECOMPUTED, never edited. `buildProfile` is a pure function of
 * (fit items, the answer ledger, evidence weights, the evaluation date) under
 * ENGINE_VERSION; `recomputeProfile` reads the ledger, builds the profile for
 * every persona the person has answered, and APPENDS a snapshot only when it
 * differs materially from their last one (§7.6). Nothing here updates or
 * deletes a snapshot; migration 362's trigger refuses an UPDATE outright.
 *
 * Entry points for later sessions:
 *   - recomputeProfile(env, userId, { trigger, asOf?, evidence? })
 *       Session 13 batches it nightly ('scheduled' / 'evidence') and on an
 *       engine bump ('engine_bump'); the advisor /answer route calls it with
 *       'answer'. It returns, per persona, whether a snapshot was written and
 *       whether the DISPLAYED archetype changed — the event Session 13's
 *       notification fires on.
 *   - evidence: Session 8's per-axis evidence weights (§7.4 window already
 *       applied). Absent → every axis reads from the self-rating alone.
 *   - loadHistory / loadLatestSnapshot — the "me" reads (routes/profile_history.ts).
 *
 * A person's history is theirs: every read here takes the caller's id and
 * nothing else.
 */
import type { Env } from '../types';
import type { FitPersona } from './advisor/questionBank.ts';
import {
  ENGINE_VERSION,
  PROFILE_V2_PARAMS,
  ARCHETYPE_TRAITS,
  answerTimeMs,
  ageWeight,
  dayOf,
  endOfDayMs,
  latestAnswers,
  replayDisplayed,
  scoringItemsFor,
  type LedgerAnswer,
  type ScoringItem,
} from './archetypeScoring.ts';
import { RADAR_AXES } from './skillsTaxonomySchema.ts';

export const TRIGGERS = ['answer', 'evidence', 'scheduled', 'engine_bump'] as const;
export type SnapshotTrigger = (typeof TRIGGERS)[number];
const PERSONAS: FitPersona[] = ['founder', 'investor', 'partner', 'advisor', 'coach'];
const AXES: string[] = RADAR_AXES.map((a) => a.slug);
const DAY_MS = 86_400_000;

/** §5.2 — at this evidence weight a self-rated axis reads "corroborated". */
export const CORROBORATED_AT = 3;
/** §7.6 — the smallest change in a 0..5 score that is material. */
export const MATERIAL_DELTA = 0.25;

/** Per radar axis, Session 8's windowed evidence weight. */
export type EvidenceWeights = Partial<Record<string, number>>;
export type SkillState = 'not_recorded' | 'self_rated_only' | 'some_evidence' | 'corroborated' | 'evidence_only';

export interface SkillAxis {
  /** Age-weighted mean of the self-ratings on this axis, 0..5; null when never rated. */
  self: number | null;
  /** Session 8's evidence weight; null when no evidence was supplied. */
  evidence: number | null;
  /** Decision b: evidence corroborates, it never moves the level — blended is the self level. */
  blended: number | null;
  state: SkillState;
}

export interface ProfileV2 {
  persona: FitPersona;
  engine_version: string;
  displayed_slug: string | null;
  computed_slug: string | null;
  secondary_slug: string | null;
  confidence: number | null;
  margin: number | null;
  traits: Record<string, number>;
  skills: Record<string, SkillAxis>;
  values: Record<string, number>;
  axal_values: Record<string, number>;
  hysteresis: { pending: { slug: string; since: string } | null; displayed_since: string | null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** JSON with keys sorted at every level, so equal profiles are equal bytes. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** §5.2 — the state of one axis. */
export function skillState(self: number | null, evidence: number | null): SkillState {
  const ev = evidence ?? 0;
  if (self === null) return ev > 0 ? 'evidence_only' : 'not_recorded';
  if (ev >= CORROBORATED_AT) return 'corroborated';
  return ev > 0 ? 'some_evidence' : 'self_rated_only';
}

/** Age-weighted mean of the latest 0..5 answers per key (skill axis, value dim, Axal value). */
function agedMeans(
  items: readonly ScoringItem[],
  latest: Map<string, LedgerAnswer>,
  atMs: number,
  keyOf: (i: ScoringItem) => string | undefined,
): Record<string, number> {
  const acc: Record<string, { sum: number; w: number }> = {};
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const a = latest.get(item.question_id);
    if (!a) continue;
    const n = Number(String(a.value).trim());
    if (!Number.isInteger(n) || n < 0 || n > 5) continue;
    const t = answerTimeMs(a.answered_at);
    if (!Number.isFinite(t)) continue;
    const w = ageWeight((atMs - t) / DAY_MS);
    const b = acc[key] ?? (acc[key] = { sum: 0, w: 0 });
    b.sum += n * w;
    b.w += w;
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(acc).sort()) if (acc[k].w > 0) out[k] = round2(acc[k].sum / acc[k].w);
  return out;
}

/**
 * The whole v2 profile for one persona on `asOfDay` (evaluated at the end of
 * that UTC day, like the nightly run). Pure.
 */
export function buildProfile(
  persona: FitPersona,
  items: readonly ScoringItem[],
  ledger: readonly LedgerAnswer[],
  asOfDay: string,
  evidence?: EvidenceWeights | null,
): ProfileV2 {
  const atMs = endOfDayMs(asOfDay);
  const latest = latestAnswers(ledger, atMs);
  const display = replayDisplayed(persona, items, ledger, asOfDay);
  const c = display.classification;
  const traits: Record<string, number> = {};
  if (c) for (const t of ARCHETYPE_TRAITS) if (c.traits[t] !== undefined) traits[t] = c.traits[t] as number;

  const selfByAxis = agedMeans(items, latest, atMs, (i) => i.measures.skill_axis);
  const skills: Record<string, SkillAxis> = {};
  for (const axis of AXES) {
    const self = selfByAxis[axis] ?? null;
    const raw = evidence ? evidence[axis] : undefined;
    const ev = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? round2(raw) : null;
    skills[axis] = { self, evidence: ev, blended: self, state: skillState(self, ev) };
  }
  return {
    persona,
    engine_version: ENGINE_VERSION,
    displayed_slug: display.displayed,
    computed_slug: display.computed,
    secondary_slug: c?.secondary ?? null,
    confidence: c ? c.confidence : null,
    margin: c ? c.margin : null,
    traits,
    skills,
    values: agedMeans(items, latest, atMs, (i) => i.measures.value_dim),
    axal_values: agedMeans(items, latest, atMs, (i) => i.measures.axal_value),
    hysteresis: { pending: display.pending, displayed_since: display.displayed_since },
  };
}

/** A stored snapshot, read back. */
export interface SnapshotRow {
  id: number;
  persona: FitPersona;
  engine_version: string;
  trigger: SnapshotTrigger;
  displayed_slug: string | null;
  computed_slug: string | null;
  secondary_slug: string | null;
  confidence: number | null;
  margin: number | null;
  traits: Record<string, number>;
  skills: Record<string, SkillAxis>;
  values: Record<string, number>;
  axal_values: Record<string, number>;
  hysteresis: ProfileV2['hysteresis'] | null;
  computed_at: string;
}

function changed(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((k in a) !== (k in b)) return true;
    if (Math.abs(a[k] - b[k]) >= MATERIAL_DELTA) return true;
  }
  return false;
}

/**
 * §7.6 — does `next` differ materially from the last snapshot? Hysteresis
 * bookkeeping (a challenger's streak) and sub-threshold drift from ageing are
 * not material.
 */
export function isMaterialChange(prev: Pick<SnapshotRow, 'engine_version' | 'displayed_slug' | 'computed_slug' | 'secondary_slug' | 'traits' | 'skills' | 'values' | 'axal_values'> | null, next: ProfileV2): boolean {
  if (!prev) return true;
  if (prev.engine_version !== next.engine_version) return true;
  if (prev.displayed_slug !== next.displayed_slug) return true;
  if (prev.computed_slug !== next.computed_slug) return true;
  if (prev.secondary_slug !== next.secondary_slug) return true;
  if (changed(prev.traits, next.traits)) return true;
  if (changed(prev.values, next.values)) return true;
  if (changed(prev.axal_values, next.axal_values)) return true;
  for (const axis of AXES) {
    const p = prev.skills?.[axis];
    const n = next.skills[axis];
    if (!p) return true;
    if (p.state !== n.state) return true;
    if ((p.self === null) !== (n.self === null)) return true;
    if (p.self !== null && n.self !== null && Math.abs(p.self - n.self) >= MATERIAL_DELTA) return true;
  }
  return false;
}

/**
 * The person's fit answers, oldest first: one row per stored answer, dated by
 * when it was GIVEN (answered_at, migration 362) or, for rows from before
 * that column, when the row was created.
 */
export async function loadLedger(env: Env, userId: number): Promise<LedgerAnswer[]> {
  type Row = { question_id: string; raw_value: string | null; at: string | null };
  let rows: Row[];
  try {
    const res = await env.DB.prepare(
      `SELECT question_id, raw_value, COALESCE(answered_at, created_at) AS at
         FROM advisor_answers
        WHERE user_id = ? AND saved_status = 'saved' AND question_id LIKE 'fit.%'
        ORDER BY id`,
    ).bind(userId).all<Row>();
    rows = res.results || [];
  } catch {
    // A database that has not taken migration 362 yet: date by creation.
    const res = await env.DB.prepare(
      `SELECT question_id, raw_value, created_at AS at
         FROM advisor_answers
        WHERE user_id = ? AND saved_status = 'saved' AND question_id LIKE 'fit.%'
        ORDER BY id`,
    ).bind(userId).all<Row>();
    rows = res.results || [];
  }
  return rows
    .filter((r) => r.raw_value != null && r.at != null)
    .map((r) => ({ question_id: r.question_id, value: String(r.raw_value), answered_at: String(r.at) }));
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

type DbSnapshot = {
  id: number; persona: string; engine_version: string; trigger_kind: string;
  displayed_slug: string | null; computed_slug: string | null; secondary_slug: string | null;
  confidence: number | null; margin: number | null;
  traits_json: string; skills_json: string; values_json: string; axal_values_json: string;
  hysteresis_json: string | null; computed_at: string;
};

function fromDb(r: DbSnapshot): SnapshotRow {
  return {
    id: r.id,
    persona: r.persona as FitPersona,
    engine_version: r.engine_version,
    trigger: r.trigger_kind as SnapshotTrigger,
    displayed_slug: r.displayed_slug,
    computed_slug: r.computed_slug,
    secondary_slug: r.secondary_slug,
    confidence: r.confidence,
    margin: r.margin,
    traits: parseJson(r.traits_json, {}),
    skills: parseJson(r.skills_json, {}),
    values: parseJson(r.values_json, {}),
    axal_values: parseJson(r.axal_values_json, {}),
    hysteresis: parseJson(r.hysteresis_json, null),
    computed_at: r.computed_at,
  };
}

/** The caller's last snapshot for a persona, or null. */
export async function loadLatestSnapshot(env: Env, userId: number, persona: FitPersona): Promise<SnapshotRow | null> {
  const r = await env.DB.prepare(
    `SELECT id, persona, engine_version, trigger_kind, displayed_slug, computed_slug, secondary_slug,
            confidence, margin, traits_json, skills_json, values_json, axal_values_json, hysteresis_json, computed_at
       FROM profile_snapshots
      WHERE user_id = ? AND persona = ?
      ORDER BY id DESC
      LIMIT 1`,
  ).bind(userId, persona).first<DbSnapshot>();
  return r ? fromDb(r) : null;
}

/** The caller's snapshots, newest first; one persona or all of them. */
export async function loadHistory(env: Env, userId: number, persona?: FitPersona | null, limit = 200): Promise<SnapshotRow[]> {
  const cap = Math.max(1, Math.min(500, Math.floor(limit)));
  const res = persona
    ? await env.DB.prepare(
      `SELECT id, persona, engine_version, trigger_kind, displayed_slug, computed_slug, secondary_slug,
              confidence, margin, traits_json, skills_json, values_json, axal_values_json, hysteresis_json, computed_at
         FROM profile_snapshots
        WHERE user_id = ? AND persona = ?
        ORDER BY id DESC
        LIMIT ?`,
    ).bind(userId, persona, cap).all<DbSnapshot>()
    : await env.DB.prepare(
      `SELECT id, persona, engine_version, trigger_kind, displayed_slug, computed_slug, secondary_slug,
              confidence, margin, traits_json, skills_json, values_json, axal_values_json, hysteresis_json, computed_at
         FROM profile_snapshots
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    ).bind(userId, cap).all<DbSnapshot>();
  return (res.results || []).map(fromDb);
}

export interface RecomputeOptions {
  trigger: SnapshotTrigger;
  /** ISO time of the recompute; default now. The profile is evaluated at the end of this UTC day. */
  asOf?: string;
  /** Session 8's evidence weights per persona. */
  evidence?: (persona: FitPersona) => EvidenceWeights | null | Promise<EvidenceWeights | null>;
  /** Scoring items per persona; default the real banks. Tests pass their own. */
  itemsFor?: (persona: FitPersona) => ScoringItem[];
}

export interface RecomputeResult {
  persona: FitPersona;
  written: boolean;
  displayed_changed: boolean;
  profile: ProfileV2;
}

/**
 * Recompute one person under the current ENGINE_VERSION and append a
 * snapshot per persona whose profile changed materially. The single entry
 * point for every trigger (§7.8).
 */
export async function recomputeProfile(env: Env, userId: number, opts: RecomputeOptions): Promise<RecomputeResult[]> {
  if (!(TRIGGERS as readonly string[]).includes(opts.trigger)) throw new Error(`unknown trigger ${opts.trigger}`);
  const asOf = opts.asOf ?? new Date().toISOString();
  const asOfMs = answerTimeMs(asOf);
  if (!Number.isFinite(asOfMs)) throw new Error('asOf is not a timestamp');
  const asOfDay = dayOf(asOfMs);
  const ledger = await loadLedger(env, userId);
  const answeredPersonas = new Set(ledger.map((a) => a.question_id.split('.')[1]));
  const out: RecomputeResult[] = [];
  for (const persona of PERSONAS) {
    if (!answeredPersonas.has(persona)) continue;
    const items = (opts.itemsFor ?? scoringItemsFor)(persona);
    const ids = new Set(items.map((i) => i.question_id));
    const own = ledger.filter((a) => ids.has(a.question_id));
    if (!own.length) continue;
    const evidence = opts.evidence ? await opts.evidence(persona) : null;
    const profile = buildProfile(persona, items, own, asOfDay, evidence);
    const prev = await loadLatestSnapshot(env, userId, persona);
    const material = isMaterialChange(prev, profile);
    if (material) {
      await env.DB.prepare(
        `INSERT INTO profile_snapshots
           (user_id, persona, engine_version, trigger_kind, displayed_slug, computed_slug, secondary_slug,
            confidence, margin, traits_json, skills_json, values_json, axal_values_json, hysteresis_json, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        userId, persona, profile.engine_version, opts.trigger,
        profile.displayed_slug, profile.computed_slug, profile.secondary_slug,
        profile.confidence, profile.margin,
        canonicalJson(profile.traits), canonicalJson(profile.skills),
        canonicalJson(profile.values), canonicalJson(profile.axal_values),
        canonicalJson(profile.hysteresis), new Date(asOfMs).toISOString(),
      ).run();
    }
    out.push({
      persona,
      written: material,
      displayed_changed: !!prev && prev.displayed_slug !== profile.displayed_slug,
      profile,
    });
  }
  return out;
}

/** Has the person published their displayed archetype (decision c)? No row = no. */
export async function isArchetypePublished(env: Env, userId: number): Promise<boolean> {
  const r = await env.DB.prepare('SELECT published FROM profile_archetype_publish WHERE user_id = ?').bind(userId).first<{ published: number }>();
  return r?.published === 1;
}

export async function setArchetypePublished(env: Env, userId: number, published: boolean): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO profile_archetype_publish (user_id, published, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET published = excluded.published, updated_at = excluded.updated_at`,
  ).bind(userId, published ? 1 : 0).run();
}

export { PROFILE_V2_PARAMS };
