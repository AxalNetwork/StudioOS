/**
 * Task #4 — Reusable vector loaders for matching surfaces.
 *
 * Reads canonical assessment output from user_values + user_skills,
 * returning slugs/axis keys the matching code can use directly.
 * Pure DB reads; no scoring math here.
 */
import type { Env } from '../types';

export interface ValueEntry {
  score: number;      // −2..+2
  confidence: number; // 0..1
}

export interface UserVectors {
  values: Record<string, ValueEntry>;
  skills: Record<string, number>; // axis slug → level 0..5
}

/** Load value-dimension scores + confidence keyed by dimension slug. */
export async function loadUserValueMap(
  env: Env,
  userId: number,
): Promise<Record<string, ValueEntry>> {
  const out: Record<string, ValueEntry> = {};
  try {
    const res = await env.DB.prepare(
      `SELECT vd.slug, uv.score, uv.confidence
         FROM user_values uv
         JOIN value_dimensions vd ON vd.id = uv.dimension_id
        WHERE uv.user_id = ?`,
    ).bind(userId).all<{ slug: string; score: number; confidence: number }>();
    for (const r of res.results || []) {
      out[r.slug] = {
        score: Number(r.score) || 0,
        confidence: Number(r.confidence) || 0,
      };
    }
  } catch {
    /* schema may be cold → empty map */
  }
  return out;
}

/** Load skill axis levels keyed by category slug (the 8 radar axes). */
export async function loadUserSkillMap(
  env: Env,
  userId: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const res = await env.DB.prepare(
      `SELECT sc.slug, MAX(us.self_level) AS level
         FROM user_skills us
         JOIN skills s ON s.id = us.skill_id
         JOIN skill_categories sc ON sc.slug = s.category_slug
        WHERE us.user_id = ?
        GROUP BY sc.slug`,
    ).bind(userId).all<{ slug: string; level: number }>();
    for (const r of res.results || []) {
      out[r.slug] = Number(r.level) || 0;
    }
  } catch {
    /* schema may be cold → empty map */
  }
  return out;
}

/** Load both vectors in one call. */
export async function loadUserVectors(
  env: Env,
  userId: number,
): Promise<UserVectors> {
  const [values, skills] = await Promise.all([
    loadUserValueMap(env, userId),
    loadUserSkillMap(env, userId),
  ]);
  return { values, skills };
}

// ── Matching math (pure) ───────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Cosine similarity over shared keys (0..1). */
export function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  let dot = 0, na = 0, nb = 0;
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] || 0;
    const bv = b[k] || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Confidence-adjusted cosine similarity over value dimensions.
 * Raw cosine on the score vectors, then multiplied by the mean confidence
 * of the overlapping dimensions. Low confidence → down-weighted alignment.
 */
export function confidenceAdjustedAlignment(
  aValues: Record<string | number, ValueEntry>,
  bValues: Record<string | number, ValueEntry>,
): { score: number; meanConfidence: number; overlapCount: number } {
  const aKeys = Object.keys(aValues);
  const shared = aKeys.filter((k) => k in bValues);
  if (shared.length === 0) return { score: 0, meanConfidence: 0, overlapCount: 0 };

  const scoreA: Record<string, number> = {};
  const scoreB: Record<string, number> = {};
  for (const k of shared) {
    scoreA[k] = aValues[k].score;
    scoreB[k] = bValues[k].score;
  }
  const rawCosine = cosineSimilarity(scoreA, scoreB);

  const meanConf =
    shared.reduce((sum, k) => sum + (aValues[k].confidence + bValues[k].confidence) / 2, 0) /
    shared.length;

  // Adjust: raw cosine × mean confidence, then re-normalise to 0..1
  const adjusted = rawCosine * meanConf;
  return {
    score: clamp(adjusted, -1, 1),
    meanConfidence: clamp(meanConf, 0, 1),
    overlapCount: shared.length,
  };
}

/**
 * Skill complementarity score: + when one fills the other's gaps.
 * For each axis where viewer is weak (< 2.5) and candidate is strong (> 3),
 * award points. Penalise when both are weak in the same axis (double gap).
 */
export function skillComplementarity(
  viewerSkills: Record<string, number>,
  candidateSkills: Record<string, number>,
): { score: number; reasons: string[]; gaps: string[] } {
  const axes = new Set<string>([...Object.keys(viewerSkills), ...Object.keys(candidateSkills)]);
  let score = 0;
  const reasons: string[] = [];
  const gaps: string[] = [];

  for (const axis of axes) {
    const v = viewerSkills[axis] || 0;
    const c = candidateSkills[axis] || 0;
    if (v < 2.5 && c > 3) {
      score += 12;
      reasons.push(`complementary ${axis}: you ${v.toFixed(1)}, them ${c.toFixed(1)}`);
    } else if (c < 2.5 && v > 3) {
      score += 8;
      reasons.push(`you cover ${axis} (${v.toFixed(1)}) vs their ${c.toFixed(1)}`);
    } else if (v < 2.5 && c < 2.5) {
      score -= 5;
      gaps.push(axis);
    }
  }
  return { score: clamp(score, 0, 100), reasons: reasons.slice(0, 4), gaps };
}

/**
 * Watch-outs: flags that should surface in the match UI.
 * e.g. opposite risk appetite, low confidence in a key dimension, both weak
 * in a critical skill.
 */
export function computeWatchOuts(
  aValues: Record<string, ValueEntry>,
  bValues: Record<string, ValueEntry>,
  aSkills: Record<string, number>,
  bSkills: Record<string, number>,
): string[] {
  const outs: string[] = [];

  // Low confidence on either side
  for (const k of Object.keys(aValues)) {
    if (aValues[k].confidence < 0.3) {
      outs.push(`Low confidence in your ${k} signal`);
      break; // one warning is enough
    }
  }

  // Strong opposition on bipolar founder spectrums
  const bipolar = [
    'founder_mission_vs_profit',
    'founder_speed_vs_quality',
    'founder_risk_appetite',
    'founder_growth_vs_sustain',
    'founder_autonomy_vs_structure',
  ];
  for (const dim of bipolar) {
    const av = aValues[dim]?.score;
    const bv = bValues[dim]?.score;
    if (av != null && bv != null && Math.abs(av - bv) >= 3.5) {
      outs.push(`Strong opposition on ${dim}`);
    }
  }

  // Double gap in critical skill
  const critical = ['product', 'engineering', 'gtm_sales', 'capital_network'];
  for (const axis of critical) {
    const av = aSkills[axis] || 0;
    const bv = bSkills[axis] || 0;
    if (av < 2 && bv < 2) {
      outs.push(`Both weak in ${axis}`);
    }
  }

  return outs.slice(0, 4);
}
