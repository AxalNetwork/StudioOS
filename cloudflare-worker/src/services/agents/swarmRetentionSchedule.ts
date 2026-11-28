/**
 * D5586 part 5: the daily swarm admission retention run, at 03:17 UTC (the owner's answer C1, 2026-11-28).
 *
 * The cron handler in `index.ts` calls `scheduledSwarmRetention` once, in the every-minute firing whose wall clock
 * reads 03:17 UTC, the same time-gating every other daily job there uses; `17 3 * * *` in all three `wrangler.toml`
 * tables and in `CRON_TRIGGERS` makes the cadence visible. One call is one bounded `runSwarmRetention` on the
 * coordinator (`swarmRetention.ts`): settled and withdrawn tickets past their age are retired in bounded batches,
 * and a pass that does not finish (`more`) carries on the next night. D1's `swarm_admission_events` is never pruned
 * (answer B1). The function never throws, and a deployment with no `WORKSPACE_ADMISSION` binding logs nothing.
 */
import type { Env } from '../../types';
import { runSwarmRetention } from './workspaceAdmissionClient';

export const SWARM_RETENTION_CRON = '17 3 * * *';
export const SWARM_RETENTION_HOUR_UTC = 3;
export const SWARM_RETENTION_MINUTE_UTC = 17;

/** Whether `now` is the minute the retention runs. */
export function isSwarmRetentionMinute(now: Date): boolean {
  return now.getUTCHours() === SWARM_RETENTION_HOUR_UTC && now.getUTCMinutes() === SWARM_RETENTION_MINUTE_UTC;
}

/** What the cron handler logs: `quiet` when there is nothing to say. */
export type ScheduledRetentionLog = { level: 'info' | 'warn' | 'quiet'; line: string };

export async function scheduledSwarmRetention(env: Pick<Env, 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>): Promise<ScheduledRetentionLog> {
  const r = await runSwarmRetention(env);
  if (!r.ok) {
    // A deployment without the binding (a branch Worker) has no coordinator to prune.
    if (r.code === 'admission_unbound') return { level: 'quiet', line: '' };
    return { level: 'warn', line: `[cron] swarm retention did not run: ${r.code}` };
  }
  const v = r.value;
  const retired = v.tickets + v.slots + v.audit + v.evicted;
  if (!retired && !v.more) return { level: 'quiet', line: '' };
  return {
    level: 'info',
    line: `[cron] swarm retention tickets=${v.tickets} slots=${v.slots} audit=${v.audit} evicted=${v.evicted} batches=${v.batches}${v.more ? ' more' : ''}`,
  };
}
