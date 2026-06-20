// Best-Fit matching — "the range of potential matches" for a user, and the
// admin best-fit report. Reuses services/matchingVectors.ts and unifies the
// two vector sources: the canonical user_values/user_skills (the standalone
// flows) and the conversational Axal Fit answers (axal_fit_responses).
import type { Env } from '../types';
import {
  loadUserVectors, confidenceAdjustedAlignment, skillComplementarity, computeWatchOuts,
  type ValueEntry, type UserVectors,
} from './matchingVectors';
import { loadSkillVector, loadValueLean, loadAxalValues, loadLatestFit, type FitPersona } from './axalFit';

export type CounterpartyType = 'cofounder' | 'investor' | 'partner' | 'mentor';

// Each counterparty type → the user role(s) that supply candidates.
const TYPE_ROLES: Record<CounterpartyType, string[]> = {
  cofounder: ['founder'],
  investor: ['investor'],
  partner: ['partner'],
  mentor: ['mentor'],
};
const TYPE_LABEL: Record<CounterpartyType, string> = {
  cofounder: 'Co-founders', investor: 'Investors', partner: 'Partners', mentor: 'Mentors & coaches',
};

// Merge the canonical + conversational vectors into one set the matching math
// can consume. Conversational skill axes / value lean supplement the canonical
// stores so a user who only did the advisor conversation still matches.
export async function loadMatchVectors(env: Env, userId: number): Promise<UserVectors> {
  const [canonical, axalSkills, axalLean] = await Promise.all([
    loadUserVectors(env, userId),
    loadSkillVector(env, userId),
    loadValueLean(env, userId),
  ]);
  const skills: Record<string, number> = { ...canonical.skills, ...axalSkills };
  const values: Record<string, ValueEntry> = { ...canonical.values };
  for (const [dim, score] of Object.entries(axalLean)) {
    if (!(dim in values)) values[dim] = { score, confidence: 0.6 };
  }
  return { skills, values };
}

export interface Match {
  user_id: number;
  name: string;
  role: string;
  match_score: number; // 0..100
  reasons: string[];
  watch_outs: string[];
  gaps: string[];
}

// Score a viewer against a candidate: value alignment (−1..1 → 0..100) blended
// with skill complementarity (0..100).
export function matchPair(viewer: UserVectors, candidate: UserVectors, name: string, userId: number, role: string): Match {
  const align = confidenceAdjustedAlignment(viewer.values, candidate.values);
  const comp = skillComplementarity(viewer.skills, candidate.skills);
  const alignPct = ((align.score + 1) / 2) * 100;
  const match_score = Math.round(0.5 * alignPct + 0.5 * comp.score);
  const reasons = [...comp.reasons];
  if (align.overlapCount > 0) reasons.unshift(`values ${Math.round(alignPct)}% aligned (${align.overlapCount} dims)`);
  return {
    user_id: userId,
    name,
    role,
    match_score,
    reasons: reasons.slice(0, 4),
    watch_outs: computeWatchOuts(viewer.values, candidate.values, viewer.skills, candidate.skills),
    gaps: comp.gaps,
  };
}

const PER_TYPE_CANDIDATES = 8;

async function candidatesForRoles(env: Env, roles: string[], excludeUserId: number): Promise<Array<{ id: number; name: string; role: string }>> {
  try {
    const placeholders = roles.map(() => '?').join(',');
    const res = await env.DB.prepare(
      `SELECT id, name, role FROM users
        WHERE role IN (${placeholders}) AND id != ? AND COALESCE(is_active, 1) = 1
        ORDER BY id DESC LIMIT ?`,
    ).bind(...roles, excludeUserId, PER_TYPE_CANDIDATES * 3).all<{ id: number; name: string; role: string }>();
    return res.results || [];
  } catch {
    return [];
  }
}

export interface TypeSummary {
  type: CounterpartyType;
  label: string;
  count: number;
  top: Match[];
}

// The dashboard "range of matches": counts + top matches per counterparty type.
export async function matchSummary(env: Env, userId: number): Promise<{ viewerReady: boolean; types: TypeSummary[] }> {
  const viewer = await loadMatchVectors(env, userId);
  const viewerReady = Object.keys(viewer.skills).length > 0 || Object.keys(viewer.values).length > 0;
  const types: TypeSummary[] = [];

  for (const type of Object.keys(TYPE_ROLES) as CounterpartyType[]) {
    const candidates = await candidatesForRoles(env, TYPE_ROLES[type], userId);
    const scored: Match[] = [];
    for (const cand of candidates.slice(0, PER_TYPE_CANDIDATES)) {
      const cv = await loadMatchVectors(env, cand.id);
      if (Object.keys(cv.skills).length === 0 && Object.keys(cv.values).length === 0) continue;
      scored.push(matchPair(viewer, cv, cand.name, cand.id, cand.role));
    }
    scored.sort((a, b) => b.match_score - a.match_score);
    types.push({ type, label: TYPE_LABEL[type], count: scored.length, top: scored.slice(0, 3) });
  }
  return { viewerReady, types };
}

// The full admin best-fit report assembled on consultation booking.
export interface BestFitReport {
  user_id: number;
  persona: FitPersona;
  skill_vector: Record<string, number>;
  value_lean: Record<string, number>;
  axal_values: Array<{ key: string; label: string; score: number; confidence: number }>;
  fit: Record<string, unknown> | null;
  matches: TypeSummary[];
  gaps_to_fill: string[];
  spinout_assessment: unknown | null;
}

export async function buildReport(env: Env, userId: number, persona: FitPersona): Promise<BestFitReport> {
  const [skill_vector, value_lean, axal_values, fitRow, summary] = await Promise.all([
    loadSkillVector(env, userId),
    loadValueLean(env, userId),
    loadAxalValues(env, userId),
    loadLatestFit(env, userId, persona),
    matchSummary(env, userId),
  ]);

  // Gaps to fill: the weakest skill axes (capital/market/partner/etc.) — what a
  // co-founder, partner, or hire should cover.
  const gaps_to_fill = Object.entries(skill_vector)
    .filter(([, v]) => v < 2.5)
    .sort((a, b) => a[1] - b[1])
    .map(([axis]) => axis)
    .slice(0, 5);

  // Spin-out strategic assessment — reuse the 10-layer venture-risk engine when
  // the user owns a project. Best-effort.
  let spinout_assessment: unknown = null;
  try {
    const proj = await env.DB.prepare(
      `SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id
        WHERE u.id = ? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 1`,
    ).bind(userId).first<{ id: number }>();
    if (proj?.id) {
      const vr = await import('./ventureRisk');
      spinout_assessment = await vr.computeVentureRisk(env, proj.id);
    }
  } catch { /* no project / venture-risk unavailable */ }

  let fit: Record<string, unknown> | null = null;
  if (fitRow) {
    let rubric: unknown = []; let redFlags: unknown = [];
    try { rubric = JSON.parse(String(fitRow.rubric_json ?? '[]')); } catch { rubric = []; }
    try { redFlags = JSON.parse(String(fitRow.red_flags_json ?? '[]')); } catch { redFlags = []; }
    fit = {
      total_score: Number(fitRow.total_score ?? 0),
      band: String(fitRow.band ?? 'hold'),
      rubric, red_flags: redFlags,
      signal_quality: Number(fitRow.signal_quality ?? 0),
      narrative_fit: fitRow.narrative_fit ?? null,
    };
  }

  return {
    user_id: userId, persona, skill_vector, value_lean, axal_values, fit,
    matches: summary.types, gaps_to_fill, spinout_assessment,
  };
}
