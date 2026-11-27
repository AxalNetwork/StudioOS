/**
 * D1607 (#3731, #2409 part 5) — PostHog into Raise: Fundraising readiness,
 * Investor narrative and Pitch deck. Registers the Raise sync on import.
 *
 * WHAT A SYNC LANDS: every metric the founder tracked in those three modules,
 * read from its saved insight, as a fact "From PostHog, as of".
 *
 * WHAT RAISE READS FROM IT (#2409 decision E, a):
 *   - Fundraising readiness' "Traction proof" gains read lines: active users
 *     and retention, from PostHog. They are shown; the score rule is
 *     unchanged and never counts them.
 *   - The narrative and deck consistency check reads `active_users` from the
 *     latest tracked "active users" metric, so a stated user count that
 *     differs is a mismatch naming both sources.
 *
 * A figure is the latest PostHog fact of a metric the founder said measures
 * active users (or retention): never guessed from an insight's name, never a
 * 0 for a value not read. Nothing here writes outside PostHog's own stores.
 */
import type { Env } from '../../types';
import type { PosthogReads } from './reads';
import { emptyResult, landTracked, metricReadings, registerSync, type Role, type SyncContext } from './metrics';

export const RAISE_MODULES = Object.freeze(['fundraising_readiness', 'investor_narrative', 'pitch_deck'] as const);

export async function syncRaise(env: Env, reads: PosthogReads, ctx: SyncContext) {
  const r = emptyResult();
  await landTracked(env, reads, ctx, [...RAISE_MODULES], r);
  return r;
}

registerSync('raise', syncRaise);

export interface PosthogFigure { value: number; unit: 'count' | 'pct'; name: string; as_of: string; source: string }

/** The latest read figure among the tracked metrics given this role; null when none has a value. */
export async function posthogFigure(env: Env, projectId: number, role: Role): Promise<PosthogFigure | null> {
  const rows = (await metricReadings(env, projectId))
    .filter(({ metric, reading }) => metric.role === role && reading.value != null && reading.as_of)
    .sort((a, b) => String(b.reading.as_of).localeCompare(String(a.reading.as_of)));
  const top = rows[0];
  if (!top) return null;
  const name = top.metric.insight_name || 'PostHog metric';
  return { value: top.reading.value!, unit: top.metric.unit, name, as_of: top.reading.as_of!, source: `From PostHog · ${name} · as of ${top.reading.as_of}` };
}
