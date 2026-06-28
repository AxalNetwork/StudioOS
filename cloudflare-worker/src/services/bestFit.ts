/**
 * Task #19 — Best-Fit matching service.
 *
 * Generalizes the per-surface matching in routes/cofounder.ts + routes/mentors.ts
 * into a single "match the current user against every counterparty type" engine,
 * built purely on the reusable primitives in services/matchingVectors.ts.
 *
 * Consumed by:
 *   - GET /api/matches/summary  (counts + teasers free, full detail tier-gated)
 *   - the admin best-fit report builder (Task #19 WS5)
 *
 * Counterparty taxonomy (5 types). The users.role CHECK only permits
 * admin|founder|partner|investor, and mentors live in a separate `mentors`
 * directory (no role). There is no distinct "coach" role or table, so we split
 * the mentor directory by price — a data-backed distinction rather than a
 * fabricated pool:
 *   cofounder → users.role = 'founder'
 *   investor  → users.role = 'investor'
 *   partner   → users.role = 'partner'
 *   mentor    → mentors.is_active = 1 AND COALESCE(hourly_rate_usd,0) = 0  (free office hours)
 *   coach     → mentors.is_active = 1 AND hourly_rate_usd > 0              (paid coaching)
 *
 * Role-based pools are gated by matching consent (user_settings.matching_opt_in);
 * the mentor directory is itself an opt-in listing, so being is_active = 1 is the
 * consent signal there.
 */
import type { Env } from '../types';
import {
  loadUserVectors,
  loadUserVectorsBatch,
  confidenceAdjustedAlignment,
  skillComplementarity,
  computeWatchOuts,
  type UserVectors,
} from './matchingVectors';
import { filterOptedInUserIds } from './matchingConsent';
import {
  loadAllLatestFit,
  loadAxalValues,
  type FitResult,
  type AxalValueRow,
  type FitPersona,
} from './axalFit';
import { buildAssessment, type Assessment } from './ventureRisk';

export type CounterpartyType = 'cofounder' | 'investor' | 'partner' | 'mentor' | 'coach';
export type MatchBand = 'strong' | 'good' | 'fair' | 'low';

export const COUNTERPARTY_TYPES: readonly CounterpartyType[] = [
  'cofounder', 'investor', 'partner', 'mentor', 'coach',
] as const;

const TYPE_LABEL: Record<CounterpartyType, string> = {
  cofounder: 'Co-founder',
  investor: 'Investor',
  partner: 'Operating Partner',
  mentor: 'Mentor',
  coach: 'Coach',
};

const ROLE_FOR: Partial<Record<CounterpartyType, string>> = {
  cofounder: 'founder',
  investor: 'investor',
  partner: 'partner',
};

export interface CounterpartyMatch {
  user_id: number;
  uid: string | null;
  name: string | null;
  match_score: number;           // 0..100 composite
  band: MatchBand;
  values_alignment: number;      // -1..1 (2dp)
  skill_complementarity: number; // 0..100
  overlap: number;               // shared value dimensions
  reasons: string[];
  gaps: string[];
  watch_outs: string[];
}

export interface CounterpartyResult {
  type: CounterpartyType;
  label: string;
  count: number;                 // candidates with a computed score
  matches: CounterpartyMatch[];  // ranked desc, capped at `limit`, full identity
}

interface CandRow { user_id: number; uid: string | null; name: string | null; }

export function matchBand(score: number): MatchBand {
  if (score >= 70) return 'strong';
  if (score >= 50) return 'good';
  if (score >= 30) return 'fair';
  return 'low';
}

/** Composite 0..100: 50% values alignment (opposition floored at 0) + 50% skill complementarity. */
function compositeScore(valuesAlignment: number, skillComplementarity100: number): number {
  const alignPct = Math.max(0, valuesAlignment); // opposition / no-overlap → 0
  return Math.round(alignPct * 50 + (skillComplementarity100 / 100) * 50);
}

/** Load the candidate pool for one counterparty type, excluding the viewer. */
async function loadCandidates(
  env: Env,
  type: CounterpartyType,
  viewerId: number,
): Promise<CandRow[]> {
  if (type === 'mentor' || type === 'coach') {
    const rateCond = type === 'coach'
      ? 'COALESCE(m.hourly_rate_usd, 0) > 0'
      : 'COALESCE(m.hourly_rate_usd, 0) = 0';
    try {
      const res = await env.DB.prepare(
        `SELECT m.user_id AS user_id, u.uid AS uid, COALESCE(u.name, m.display_name) AS name
           FROM mentors m
           JOIN users u ON u.id = m.user_id
          WHERE m.is_active = 1 AND m.user_id IS NOT NULL AND m.user_id != ? AND ${rateCond}`,
      ).bind(viewerId).all<CandRow>();
      return (res.results || []).map((r) => ({
        user_id: Number(r.user_id), uid: r.uid ?? null, name: r.name ?? null,
      }));
    } catch { return []; }
  }

  const roleName = ROLE_FOR[type];
  if (!roleName) return [];
  let rows: CandRow[] = [];
  try {
    const res = await env.DB.prepare(
      `SELECT id AS user_id, uid, name FROM users
        WHERE role = ? AND COALESCE(is_active, 1) = 1 AND id != ?`,
    ).bind(roleName, viewerId).all<CandRow>();
    rows = (res.results || []).map((r) => ({
      user_id: Number(r.user_id), uid: r.uid ?? null, name: r.name ?? null,
    }));
  } catch { return []; }
  // Privacy: role-based pools require explicit matching consent.
  const optedIn = await filterOptedInUserIds(env, rows.map((r) => r.user_id));
  return rows.filter((r) => optedIn.has(r.user_id));
}

export interface ComputeMatchesOpts {
  /** Max full matches returned per type (default 5, capped 25). */
  limit?: number;
}

/**
 * Compute ranked matches for `viewerId` against every counterparty type.
 * Returns FULL match objects (identity included); callers gate identity fields
 * by tier. Candidates with no values/skills signal are skipped.
 */
export async function computeCounterpartyMatches(
  env: Env,
  viewerId: number,
  viewerVectors: UserVectors,
  opts: ComputeMatchesOpts = {},
): Promise<CounterpartyResult[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 25));

  const perType = await Promise.all(
    COUNTERPARTY_TYPES.map(async (type) => ({
      type, cands: await loadCandidates(env, type, viewerId),
    })),
  );

  const allIds = [...new Set(perType.flatMap((p) => p.cands.map((c) => c.user_id)))];
  const vecMap = await loadUserVectorsBatch(env, allIds);

  const results: CounterpartyResult[] = [];
  for (const { type, cands } of perType) {
    const scored: CounterpartyMatch[] = [];
    for (const cand of cands) {
      const cv = vecMap.get(cand.user_id) || { values: {}, skills: {} };
      const hasSignal = Object.keys(cv.values).length > 0 || Object.keys(cv.skills).length > 0;
      if (!hasSignal) continue;

      const val = confidenceAdjustedAlignment(viewerVectors.values, cv.values);
      const comp = skillComplementarity(viewerVectors.skills, cv.skills);
      const watch = computeWatchOuts(
        viewerVectors.values, cv.values, viewerVectors.skills, cv.skills,
      );
      const matchScore = compositeScore(val.score, comp.score);
      scored.push({
        user_id: cand.user_id,
        uid: cand.uid,
        name: cand.name,
        match_score: matchScore,
        band: matchBand(matchScore),
        values_alignment: Math.round(val.score * 100) / 100,
        skill_complementarity: comp.score,
        overlap: val.overlapCount,
        reasons: comp.reasons,
        gaps: comp.gaps,
        watch_outs: watch,
      });
    }
    scored.sort((a, b) =>
      b.match_score - a.match_score || b.values_alignment - a.values_alignment);
    results.push({
      type,
      label: TYPE_LABEL[type],
      count: scored.length,
      matches: scored.slice(0, limit),
    });
  }
  return results;
}

// --------- Admin best-fit report (Task #19 WS5) ---------
//
// Assembles a single subject's full profile for the admin consultation view +
// the persisted snapshot: skills / 15-dim values / 5 Axal values / archetype /
// per-persona fit / cross-counterparty matches / spin-out risk. Built from the
// same reusable primitives as the rest of the feature — no new scoring here.

export interface BestFitReportSubject {
  user_id: number;
  uid: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
}

export interface BestFitReport {
  subject: BestFitReportSubject;
  archetype: { slug: string; label: string | null } | null;
  primary_persona: FitPersona | null;
  skills: Record<string, number>;   // 8-axis skill vector, self level 0..5
  values: Record<string, number>;   // 15-dim value lean, score
  axal_values: AxalValueRow[];      // 5 behavioral values
  fit: FitResult[];                 // per-persona weighted-rubric results
  matches: CounterpartyResult[];    // 5 counterparty types (reasons / gaps / watch-outs)
  gaps_to_fill: string[];           // skill axes the subject is weakest on
  venture: Assessment | null;       // spin-out risk (when the subject owns a project)
  computed_at: string;
}

/** Latest persisted archetype for the user (from their most recent assessment). */
async function loadUserArchetype(
  env: Env,
  userId: number,
): Promise<{ slug: string; label: string | null } | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT archetype_slug AS slug, archetype_label AS label
         FROM assessment_results
        WHERE user_id = ? AND archetype_slug IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
    ).bind(userId).first<{ slug: string; label: string | null }>();
    return row ? { slug: row.slug, label: row.label ?? null } : null;
  } catch {
    return null;
  }
}

async function loadSubject(env: Env, userId: number): Promise<BestFitReportSubject | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, uid, name, email, role FROM users WHERE id = ?`,
    ).bind(userId).first<{ id: number; uid: string | null; name: string | null; email: string | null; role: string | null }>();
    if (!row) return null;
    return {
      user_id: Number(row.id),
      uid: row.uid ?? null,
      name: row.name ?? null,
      email: row.email ?? null,
      role: row.role ?? null,
    };
  } catch (e) {
    console.error('[bestFit] loadSubject:', (e as Error).message);
    return null;
  }
}

/** The subject's most recent non-deleted project (for the spin-out assessment). */
async function findUserProjectId(env: Env, userId: number): Promise<number | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id FROM projects
        WHERE founder_id = (SELECT founder_id FROM users WHERE id = ?)
          AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId).first<{ id: number }>();
    return row ? Number(row.id) : null;
  } catch {
    return null;
  }
}

/** Skill axes the subject is weakest on (self level < 2.5), weakest first. */
function skillGaps(skills: Record<string, number>): string[] {
  return Object.entries(skills)
    .filter(([, lvl]) => Number(lvl) < 2.5)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([slug]) => slug);
}

/** Highest-scoring fit persona (the subject's primary lens). */
function pickPrimaryPersona(fit: FitResult[]): FitPersona | null {
  if (fit.length === 0) return null;
  return [...fit].sort((a, b) => b.total_score - a.total_score)[0].persona;
}

export interface BuildReportOpts {
  /** Max matches per counterparty type (default 5). */
  matchLimit?: number;
}

/**
 * Build the full admin best-fit report for `userId`. Returns null when the
 * subject user does not exist. Reads stored scores (kept fresh by the advisor
 * recompute hook) — it does not recompute or write, so it is safe on read.
 */
export async function buildBestFitReport(
  env: Env,
  userId: number,
  opts: BuildReportOpts = {},
): Promise<BestFitReport | null> {
  const subject = await loadSubject(env, userId);
  if (!subject) return null;

  const [vectors, axalValues, fit, archetype, projectId] = await Promise.all([
    loadUserVectors(env, userId),
    loadAxalValues(env, userId),
    loadAllLatestFit(env, userId),
    loadUserArchetype(env, userId),
    findUserProjectId(env, userId),
  ]);

  // Defensive: a cold/un-migrated D1 or a transient DB error in the match or
  // spin-out loaders should degrade to a partial report, not surface the
  // global 500 ("Internal server error"). Other loaders already self-catch.
  let matches: CounterpartyResult[] = [];
  try {
    matches = await computeCounterpartyMatches(env, userId, vectors, {
      limit: opts.matchLimit ?? 5,
    });
  } catch (e) {
    console.error('[bestFit] computeCounterpartyMatches:', (e as Error).message);
  }

  const values: Record<string, number> = {};
  for (const [slug, entry] of Object.entries(vectors.values)) values[slug] = entry.score;

  let venture: Assessment | null = null;
  if (projectId != null) {
    try {
      venture = await buildAssessment(env, projectId);
    } catch (e) {
      console.error('[bestFit] buildAssessment:', (e as Error).message);
    }
  }

  return {
    subject,
    archetype,
    primary_persona: pickPrimaryPersona(fit),
    skills: vectors.skills,
    values,
    axal_values: axalValues,
    fit,
    matches,
    gaps_to_fill: skillGaps(vectors.skills),
    venture,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Persist a report snapshot (consultation booking precompute). Returns the new
 * row's id + uid, or null if the insert returned nothing.
 */
export async function persistBestFitReport(
  env: Env,
  userId: number,
  report: BestFitReport,
  computedBy: number | null,
): Promise<{ id: number; uid: string } | null> {
  const row = await env.DB.prepare(
    `INSERT INTO axal_fit_reports (user_id, persona, report_json, computed_by)
     VALUES (?, ?, ?, ?)
     RETURNING id, uid`,
  )
    .bind(userId, report.primary_persona, JSON.stringify(report), computedBy)
    .first<{ id: number; uid: string }>();
  return row ? { id: Number(row.id), uid: row.uid } : null;
}
