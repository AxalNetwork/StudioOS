/**
 * D663 follow-up (#1524) — a peer-group benchmark for every founder.
 *
 * D589 gave a Lab member the median of their cohort at their week, and their
 * percentile in it (`routes/scoring.ts` `/cohort-benchmark`). A founder
 * outside the Lab had nothing to compare with. This generalises the cohort
 * into a PEER GROUP:
 *
 *   · a Lab member's group is their cohort at their week, exactly as D589
 *     draws it, so the Lab page and Fundraising readiness give one answer;
 *   · anyone else's group is every venture at the same stage
 *     (`projects.stage`, never null: it defaults to `idea`).
 *
 * THE SAME RULES AS D589, FROM ONE PLACE. One score per founder, their latest
 * official run whose integrity hash verifies (`latestVerifiedByFounder`, used
 * by the cohort route too). Deleted projects, practice runs and flagged or
 * rejected runs are out. The founder's own other projects never fill the
 * group. Fewer than `COHORT_BENCHMARK_MIN` (five) is `too_little`, with the
 * size named: never a median of two.
 *
 * PRIVACY. What leaves this file is the group's kind, its label, its size and
 * its percentiles (25th, 50th, 75th), coarsened to the nearest 5 as D589
 * coarsens its median, and the founder's own score and percentile rank
 * coarsened to the nearest 10. No other venture's id, name, score or row is
 * returned.
 */
import type { Env } from '../types';
import { verifyScoreHash } from './scoreIntegrity';
import { COHORT_BENCHMARK_MIN, coarsenMedian, coarsenPercentile, percentileRank } from './cohortBenchmark';

export type OfficialRow = {
  project_id: number;
  founder_id: number | null;
  id: number;
  total_score: number;
  created_at: string;
  integrity_hash: string | null;
  integrity_version: string | null;
};

export type PlacedRun = { score: number; scoredAt: string; snapshotId: number; hash: string | null };

/** A founder's key: their founder id, or the negated project id for a project with none. */
export const founderKey = (founderId: number | null, projectId: number) => (founderId == null ? -Number(projectId) : Number(founderId));

function laterOfficial(a: OfficialRow, b: OfficialRow): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}

/**
 * Each founder's latest official run whose hash verifies. A run that fails
 * verification is skipped, and the founder's next-latest run is tried.
 */
export async function latestVerifiedByFounder(env: Env, rows: readonly OfficialRow[]): Promise<Map<number, PlacedRun>> {
  const byFounder = new Map<number, OfficialRow[]>();
  for (const row of rows) {
    const key = founderKey(row.founder_id, row.project_id);
    const list = byFounder.get(key) || [];
    list.push(row);
    byFounder.set(key, list);
  }
  const placed = new Map<number, PlacedRun>();
  for (const [key, list] of byFounder) {
    list.sort((a, b) => (laterOfficial(a, b) ? -1 : 1));
    for (const row of list) {
      const verified = await verifyScoreHash(env, {
        project_id: row.project_id,
        total_score: Number(row.total_score),
        integrity_hash: row.integrity_hash,
        integrity_version: row.integrity_version,
        created_at: row.created_at,
      });
      if (!verified.valid) continue;
      placed.set(key, { score: Number(row.total_score), scoredAt: row.created_at, snapshotId: row.id, hash: row.integrity_hash });
      break;
    }
  }
  return placed;
}

/** The value at a fraction of the way through the sorted scores (linear between neighbours). */
export function quantileOf(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export type PeerGroup =
  | { kind: 'lab_cohort'; label: string; cohort: string; week: number }
  | { kind: 'stage'; label: string; stage: string };

export type PeerBenchmark = {
  state: 'ok' | 'too_little' | 'not_recorded';
  group: { kind: PeerGroup['kind']; label: string; size: number } | null;
  own_score: number | null;
  /** The founder's percentile rank in the group, to the nearest 10; null unless `ok`. */
  percentile: number | null;
  /** The group's 25th, 50th and 75th percentile scores, to the nearest 5; null unless `ok`. */
  p25: number | null;
  p50: number | null;
  p75: number | null;
  reason: string | null;
};

type ProjectRef = { id: number; founder_id: number | null; stage: string | null };

/** The founder's peer group: their Lab cohort at their week when admitted, else their stage. */
export async function peerGroupOf(env: Env, project: ProjectRef): Promise<PeerGroup> {
  if (project.founder_id != null) {
    const owner = await env.DB.prepare(
      `SELECT u.spinout_lab_week AS week, f.spinout_lab_cohort AS cohort, f.spinout_lab_admitted AS admitted
         FROM users u LEFT JOIN user_spinout_flags f ON f.user_id = u.id
        WHERE u.founder_id = ? ORDER BY u.spinout_lab_active DESC, u.id ASC LIMIT 1`,
    ).bind(project.founder_id).first<{ week: number | null; cohort: string | null; admitted: number | null }>();
    const cohort = owner?.cohort?.trim() ? owner.cohort.trim() : null;
    const week = owner && owner.week != null && Number.isFinite(Number(owner.week)) ? Number(owner.week) : null;
    if (owner && cohort && Number(owner.admitted) === 1 && week !== null) {
      return { kind: 'lab_cohort', label: `Lab cohort ${cohort}, week ${week}`, cohort, week };
    }
  }
  const stage = String(project.stage || 'idea');
  return { kind: 'stage', label: `ventures at the ${stage.replace(/_/g, ' ')} stage`, stage };
}

/** The official runs a group draws from, the founder's own project included and their other projects excluded. */
export async function groupRows(env: Env, group: PeerGroup, project: ProjectRef): Promise<OfficialRow[]> {
  const official = `JOIN score_snapshots s ON s.project_id = p.id AND s.is_sandbox = 0 AND s.admin_review_status IN ('auto_approved', 'approved')`;
  const fields = 'p.id AS project_id, p.founder_id AS founder_id, s.id, s.total_score, s.created_at, s.integrity_hash, s.integrity_version';
  if (group.kind === 'lab_cohort') {
    const res = await env.DB.prepare(
      `SELECT ${fields}
         FROM projects p JOIN users u ON u.founder_id = p.founder_id JOIN user_spinout_flags f ON f.user_id = u.id ${official}
        WHERE p.deleted_at IS NULL AND f.spinout_lab_admitted = 1 AND f.spinout_lab_cohort = ? AND u.spinout_lab_week = ?
          AND (p.founder_id != ? OR p.id = ?)`,
    ).bind(group.cohort, group.week, project.founder_id, project.id).all<OfficialRow>();
    return res.results || [];
  }
  const res = await env.DB.prepare(
    `SELECT ${fields}
       FROM projects p ${official}
      WHERE p.deleted_at IS NULL AND COALESCE(p.stage, 'idea') = ?
        AND (p.founder_id IS NULL OR p.founder_id IS NOT ? OR p.id = ?)`,
  ).bind(group.stage, project.founder_id, project.id).all<OfficialRow>();
  return res.results || [];
}

/** The benchmark for one project, read as its founder's peer group. */
export async function peerBenchmark(env: Env, projectId: number): Promise<PeerBenchmark> {
  const project = await env.DB.prepare('SELECT id, founder_id, stage FROM projects WHERE id = ?').bind(projectId).first<ProjectRef>();
  const empty = (state: PeerBenchmark['state'], reason: string, group: PeerBenchmark['group'] = null, own: number | null = null): PeerBenchmark =>
    ({ state, group, own_score: own, percentile: null, p25: null, p50: null, p75: null, reason });
  if (!project) return empty('not_recorded', 'The venture could not be found.');
  const group = await peerGroupOf(env, project);
  const placed = await latestVerifiedByFounder(env, await groupRows(env, group, project));
  const own = placed.get(founderKey(project.founder_id, project.id));
  const size = placed.size;
  const summary = { kind: group.kind, label: group.label, size };
  if (!own) return empty('not_recorded', 'This venture has no verified official score yet, so there is nothing to place.', summary);
  if (size < COHORT_BENCHMARK_MIN) {
    return empty('too_little', `Only ${size} of ${group.label} ${size === 1 ? 'has' : 'have'} a verified score; a benchmark needs ${COHORT_BENCHMARK_MIN}.`, summary, own.score);
  }
  const scores = [...placed.values()].map((r) => r.score);
  return {
    state: 'ok',
    group: summary,
    own_score: own.score,
    percentile: coarsenPercentile(percentileRank(scores, own.score)),
    p25: coarsenMedian(quantileOf(scores, 0.25)),
    p50: coarsenMedian(quantileOf(scores, 0.5)),
    p75: coarsenMedian(quantileOf(scores, 0.75)),
    reason: null,
  };
}
