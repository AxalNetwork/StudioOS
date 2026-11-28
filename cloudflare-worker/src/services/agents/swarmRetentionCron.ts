/**
 * D5586 part 5 (#5586): the daily retention run of the swarm coordinator (owner answer C1, 2026-11-28). The Worker's
 * `scheduled()` handler calls `runSwarmRetentionTick` at 03:17 UTC, the minute of the
 * `17 3 * * *` trigger declared in the three `wrangler.toml` trigger tables and in `CRON_TRIGGERS`. As every daily
 * block in that handler does, it gates on the event's own minute, not on which expression fired: the every-minute
 * ticker and this trigger dedupe on one lease, so retention runs once in that minute whichever one wins it.
 *
 * BOUNDED. Each call to the coordinator (`runSwarmRetention`) retires at most 2000 tickets (D5586-p4 §3). A call that
 * answers `more: true` is followed by another, at most `SWARM_RETENTION_CALLS` in one run; what is still left waits for
 * the next night, oldest first. Each call is idempotent, so a run that repeats (a lost lease, a retried tick) retires
 * nothing twice.
 *
 * NEVER THROWS. No binding (a deployment without `WORKSPACE_ADMISSION`) is `skipped`; a refusal from the coordinator
 * (`admission_unavailable`, `clock_regressed`, …) is `failed` with its code, keeping what earlier calls in the run
 * retired. D1's `swarm_admission_events` is not touched (owner answer B1).
 */
import type { Env } from '../../types';
import { runSwarmRetention } from './workspaceAdmissionClient';

/** The trigger the owner chose for retention (C1): daily, off the hour. */
export const SWARM_RETENTION_CRON = '17 3 * * *';
/** At most this many coordinator calls in one run (up to 3 × 2000 tickets). */
export const SWARM_RETENTION_CALLS = 3;

export type SwarmRetentionTick = {
  outcome: 'done' | 'skipped' | 'failed';
  /** A one-line note for the cron row's task outcome. */
  note: string;
  calls: number;
  tickets: number;
  slots: number;
  audit: number;
  evicted: number;
  /** Work is left for the next run. */
  more: boolean;
  /** The refusal code when the outcome is `skipped` or `failed`. */
  code: string | null;
};

export async function runSwarmRetentionTick(
  env: Pick<Env, 'WORKSPACE_ADMISSION' | 'BRANCH_DO_JURISDICTION'>,
  opts: { calls?: number } = {},
): Promise<SwarmRetentionTick> {
  const maxCalls = opts.calls ?? SWARM_RETENTION_CALLS;
  const t: SwarmRetentionTick = { outcome: 'done', note: '', calls: 0, tickets: 0, slots: 0, audit: 0, evicted: 0, more: false, code: null };
  const counts = () => `tickets=${t.tickets} slots=${t.slots} audit=${t.audit} evicted=${t.evicted} calls=${t.calls}${t.more ? ' more' : ''}`;
  while (t.calls < maxCalls) {
    // `runSwarmRetention` never throws: a failing stub is already `admission_unavailable`.
    const r = await runSwarmRetention(env);
    if (!r.ok) {
      t.code = r.code;
      if (r.code === 'admission_unbound') return { ...t, outcome: 'skipped', note: 'coordinator not bound' };
      return { ...t, outcome: 'failed', note: `${r.code} ${counts()}` };
    }
    t.calls++;
    t.tickets += r.value.tickets; t.slots += r.value.slots; t.audit += r.value.audit; t.evicted += r.value.evicted;
    t.more = r.value.more;
    if (!t.more) break;
  }
  if (!t.tickets && !t.slots && !t.audit && !t.evicted) return { ...t, outcome: 'skipped', note: 'nothing due' };
  return { ...t, note: counts() };
}
