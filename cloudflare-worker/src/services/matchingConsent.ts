/**
 * Task #19 — Matching consent (hard filter).
 *
 * The "Include me in matching" preference lives in user_settings.matching_opt_in
 * and defaults OFF (absence of a row == opted out). This module is the single
 * enforcement point used by every people-matching endpoint so an opted-out user
 * is never returned as a candidate.
 */
import type { Env } from '../types';
import { ensureUserSettings } from './userSettings';

/** Minimum profile completeness (%) required before a user may opt IN. */
export const MATCHING_MIN_COMPLETION_PCT = 60;

/**
 * Given a set of candidate user IDs, return the subset who have explicitly
 * opted IN to matching. Fails closed (privacy-first): if the column/table is
 * missing, nobody is treated as opted in.
 */
export async function filterOptedInUserIds(
  env: Env,
  userIds: Array<number | null | undefined>,
): Promise<Set<number>> {
  const ids = [...new Set(userIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return new Set();
  await ensureUserSettings(env);
  const ph = ids.map(() => '?').join(',');
  try {
    const res = await env.DB.prepare(
      `SELECT user_id FROM user_settings WHERE matching_opt_in = 1 AND user_id IN (${ph})`,
    ).bind(...ids).all<{ user_id: number }>();
    return new Set((res.results || []).map((r) => Number(r.user_id)));
  } catch {
    return new Set();
  }
}
