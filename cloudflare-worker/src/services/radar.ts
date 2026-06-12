/**
 * Task #13 — Radar / Spider-Graph Service.
 *
 * Centralized computation for the 8-axis radar used across user profiles,
 * spin-out deck, co-founder match preview, and partner coverage.
 *
 * Reads blended skill scores (Task #11) and the canonical taxonomy axes
 * (Task #10) to produce deterministic, normalized radar data.
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import { computeBlendedSkills } from './skillProfileSchema';
import { RADAR_AXES } from './skillsTaxonomySchema';

export interface RadarAxisResult {
  slug: string;
  label: string;
  weight: number;
  score: number;        // 0–100, normalized weighted mean of blended skills
  raw_score: number;    // 0–5, un-normalized
  skill_count: number;  // how many skills in this axis contributed
}

export interface RadarTeamResult {
  slug: string;
  label: string;
  score: number;       // 0–100, weighted mean of team blended scores
  coverage: number;      // 0–100, max(member scores) per axis
  raw_coverage: number;  // 0–5, max raw
  member_count: number;  // how many members had data in this axis
}

export interface RadarResult {
  axes: RadarAxisResult[];
  overall: number;       // 0–100, mean of all axis scores
  has_data: boolean;
  // Team-only fields (null when computing for a single user).
  team?: RadarTeamResult[];
  gap_axes?: string[];   // axis slugs where coverage < 60
}

function normalizeTo100(score: number): number {
  // Raw skill scores are 0–5; normalize to 0–100.
  return Math.max(0, Math.min(100, Math.round((score / 5) * 100)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the radar for one or more users.
 *
 * For a single user:
 *   - Each axis score = weighted mean of blended skill scores in that category
 *   - Normalized 0–100
 *
 * For teams (≥2 users):
 *   - Also returns per-axis coverage = max(member scores)
 *   - gap_axes = slugs where coverage < 60
 *
 * Deterministic: identical input → identical output.
 * When no profile data exists, returns has_data=false with zero-filled axes.
 */
export async function computeRadar(env: Env, userIds: number[]): Promise<RadarResult> {
  const sql = getSQL(env);

  // Load all active skills with their category for the mapping.
  const skillsRows = await sql`
    SELECT id, slug, category_slug, display_order
    FROM skills WHERE is_active = 1 ORDER BY category_slug, display_order`;

  // Build skill_id → category_slug map.
  const skillToCat = new Map<number, string>();
  for (const s of skillsRows) {
    skillToCat.set(Number(s.id), s.category_slug);
  }

  // Gather blended skills for each user.
  const userBlended: Map<number, Map<number, number>> = new Map(); // userId → skillId → blended
  for (const uid of userIds) {
    const blended = await computeBlendedSkills(env, uid);
    const bySkill = new Map<number, number>();
    for (const b of blended) {
      bySkill.set(b.skill_id, b.blended);
    }
    userBlended.set(uid, bySkill);
  }

  // Compute per-axis per-user raw scores.
  const axisScoresByUser = new Map<number, Map<string, number[]>>(); // userId → axis → raw scores
  for (const [uid, bySkill] of userBlended) {
    const byAxis = new Map<string, number[]>();
    for (const [skillId, blended] of bySkill) {
      const cat = skillToCat.get(skillId);
      if (!cat) continue;
      const arr = byAxis.get(cat) || [];
      arr.push(blended);
      byAxis.set(cat, arr);
    }
    axisScoresByUser.set(uid, byAxis);
  }

  // Build the radar axes.
  const axes: RadarAxisResult[] = [];
  const teamResults: RadarTeamResult[] = [];
  const gapAxes: string[] = [];
  let overallSum = 0;
  let overallCount = 0;

  for (const axis of RADAR_AXES) {
    // Single user: mean of their axis skills.
    if (userIds.length === 1) {
      const byAxis = axisScoresByUser.get(userIds[0]) || new Map();
      const scores = byAxis.get(axis.slug) || [];
      if (scores.length === 0) {
        axes.push({
          slug: axis.slug,
          label: axis.label,
          weight: axis.weight,
          score: 0,
          raw_score: 0,
          skill_count: 0,
        });
      } else {
        const raw = round2(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
        const norm = normalizeTo100(raw);
        axes.push({
          slug: axis.slug,
          label: axis.label,
          weight: axis.weight,
          score: norm,
          raw_score: raw,
          skill_count: scores.length,
        });
        overallSum += norm;
        overallCount++;
      }
    } else {
      // Team: compute per-member raw scores, then mean and coverage.
      const memberScores: number[] = [];
      const memberRaw: number[] = [];
      let memberCount = 0;
      for (const uid of userIds) {
        const byAxis = axisScoresByUser.get(uid) || new Map();
        const scores = byAxis.get(axis.slug) || [];
        if (scores.length > 0) {
          const raw = round2(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);
          memberScores.push(normalizeTo100(raw));
          memberRaw.push(raw);
          memberCount++;
        }
      }
      const teamScore = memberScores.length > 0
        ? round2(memberScores.reduce((a, b) => a + b, 0) / memberScores.length)
        : 0;
      const coverage = memberRaw.length > 0 ? Math.max(...memberRaw) : 0;
      const normCoverage = normalizeTo100(coverage);
      teamResults.push({
        slug: axis.slug,
        label: axis.label,
        score: teamScore,
        coverage: normCoverage,
        raw_coverage: coverage,
        member_count: memberCount,
      });
      if (normCoverage < 60) {
        gapAxes.push(axis.slug);
      }
      overallSum += teamScore;
      overallCount++;
    }
  }

  const overall = overallCount > 0 ? round2(overallSum / overallCount) : 0;
  const hasData = userIds.length === 1
    ? axes.some((a) => a.skill_count > 0)
    : teamResults.some((t) => t.member_count > 0);

  if (userIds.length === 1) {
    return { axes, overall, has_data: hasData };
  }

  return {
    axes: teamResults.map((t) => ({
      slug: t.slug,
      label: t.label,
      weight: 1.0,
      score: t.score,
      raw_score: t.raw_coverage,
      skill_count: t.member_count,
    })),
    overall,
    has_data: hasData,
    team: teamResults,
    gap_axes: gapAxes,
  };
}

/**
 * Cache-key helper for the radar KV cache.
 * Deterministic hash of the user set + taxonomy version.
 */
export async function radarCacheKey(userIds: number[], taxonomyVersion: string): Promise<string> {
  const ids = [...userIds].sort((a, b) => a - b).join(',');
  const data = `${ids}:${taxonomyVersion}`;
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const arr = new Uint8Array(buf);
  let hex = '';
  for (const b of arr) hex += b.toString(16).padStart(2, '0');
  return `radar:${hex.slice(0, 16)}`;
}
