/**
 * D4559 (#4559) part 3 — operational signals other issues record for
 * themselves, added to the capacity read, its daily snapshot and its alert
 * episodes. Each one is read from where its issue already writes it; no store,
 * table, vendor or network call is added.
 *
 *   #4592  eligible work and admissions: the agent sweep's own `agent_sweep_*`
 *          rows in `system_metrics` (one batch per 5-minute sweep).
 *   #4593  lifecycle repairs still owed: the sweep's `agent_repair_*` rows.
 *   #4558  the last verified restore: `drill-d1.json` in the backups bucket,
 *          read and validated by `services/backup.ts` (`readRestoreDrill`).
 *
 * Not read, with why (`SIGNALS_NOT_READ_HERE`): #4572, #4568, #4571 and #4556
 * shipped no record the Worker can read. They are listed, not invented.
 *
 * EVERY SIGNAL SAYS where it came from (`source`), what span it covers
 * (`window`), how it is recorded and sampled (`sampling`), its `unit`, its
 * `scope` (always this deployment) and when its source last produced the
 * record used (`last_success_at`).
 *
 * MISSING IS NOT ZERO. A source that throws, times out, has never recorded, or
 * last recorded too long ago is `unavailable` (level `unknown`). A subsystem
 * that is off here is `not_running`, not zero. A sweep that did not scan (halt,
 * engine off or paused, manual autonomy) records `eligible` 0 without looking,
 * so the eligible count and age are trusted only from a sweep labelled
 * `scanned: true`. A failed or absent restore drill is `not_verified`, never an
 * age.
 *
 * NO TENANT DATA. The sweep's rows are counts and ages with low-cardinality
 * labels (cadence, cursor reset, scanned); the drill marker is names, counts and
 * times. Nothing here names a member, company, agent, task, file or table.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { readRestoreDrill, DRILL_STALE_AFTER_DAYS } from './backup';
import { levelFor, withTimeout, READ_TIMEOUT_MS, type Metric, type Thresholds } from './platformCapacity';

const HOUR_S = 3_600;
const DAY_S = 86_400;

/** The agent sweep runs every 5 minutes; a newest row older than this is stale, not current. */
export const SWEEP_STALE_AFTER_MS = 20 * 60_000;
/** `agents/sweep.ts` DISCOVERY_SCAN_MAX: the eligible count is capped at this per scan. */
export const SWEEP_SCAN_CAP = 120;
/** `agents/sweep.ts` REPAIR_MAX: the repair count is capped at this per sweep. */
export const REPAIR_CAP = 20;

/** Proposed, not approved: the oldest eligible task's age (since it was created). */
export const ELIGIBLE_AGE_THRESHOLDS: Thresholds = {
  warning: 1 * HOUR_S, critical: 6 * HOUR_S, hysteresis: 5 * 60,
  basis: 'Proposed (#4559 part 3): age since the oldest eligible task was created. Not yet approved by the owner.',
};
/** Proposed, not approved: the oldest lifecycle repair still owed after a sweep. */
export const REPAIR_AGE_THRESHOLDS: Thresholds = {
  warning: 1 * HOUR_S, critical: 6 * HOUR_S, hysteresis: 5 * 60,
  basis: 'Proposed (#4559 part 3): the sweep repairs every 5 minutes, so an hour owed is twelve sweeps. Not yet approved by the owner.',
};
/** Warning at the Security page's own freshness rule (D263); critical is proposed. */
export const RESTORE_AGE_THRESHOLDS: Thresholds = {
  warning: DRILL_STALE_AFTER_DAYS * DAY_S, critical: 64 * DAY_S, hysteresis: DAY_S,
  basis: `Warning when the last passing drill is older than ${DRILL_STALE_AFTER_DAYS} days (the Security page's rule, D263); critical at 64 days is proposed. A failed or absent drill is critical.`,
};

/** The issues whose signals this read does not make, and why. */
export const SIGNALS_NOT_READ_HERE = [
  { key: 'agents.halt_acknowledgement', reason: '#4572 shipped a contract and tests, not a record: the halt is a KV key with no acknowledgement or propagation time. Measuring propagation is #4594 (open).' },
  { key: 'd1.runtime_ddl_attempts', reason: '#4568 shipped a build-time ratchet (scripts/check-runtime-ddl.mjs) and an audit; the Worker counts no runtime ALTER attempt.' },
  { key: 'auth.monitor_state', reason: '#4571\'s probe outcome is printed in the GitHub Actions run of magic-link-probe.yml; nothing reaches a Worker binding.' },
  { key: 'ai.gateway_quota_retries', reason: '#4556\'s gateway path has no caller and its switch is off, so it records no attempt; the shared upstream limits are published figures, not counters.' },
] as const;

type Base = Omit<Metric, 'value' | 'availability' | 'reason' | 'level' | 'last_success_at'>;

const measured = (b: Base, value: number, at: string | null, level: Metric['level'] = 'ok'): Metric =>
  ({ ...b, value, availability: 'measured', reason: null, level, last_success_at: at });
const unavailable = (b: Base, reason: string, at: string | null = null): Metric =>
  ({ ...b, value: null, availability: 'unavailable', reason, level: 'unknown', last_success_at: at });
const notRunning = (b: Base, reason: string, at: string | null = null): Metric =>
  ({ ...b, value: null, availability: 'not_running', reason, level: 'ok', last_success_at: at });
const noneWaiting = (b: Base, reason: string, at: string | null): Metric =>
  ({ ...b, value: null, availability: 'none_waiting', reason, level: 'ok', last_success_at: at });

/** `system_metrics.timestamp` is UTC `YYYY-MM-DD HH:MM:SS`; ISO with a Z, or null. */
export function sqlUtc(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(v)) return null;
  const ms = Date.parse(`${v.slice(0, 19).replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type Batch =
  | { state: 'never' }
  | { state: 'unreadable'; reason: string }
  | { state: 'ok'; at: string; values: Map<string, number>; labels: Record<string, unknown> };

/**
 * The newest batch a recorder wrote: the latest timestamp of its anchor metric,
 * then every row of that batch. Both statements are literal; names are bound.
 */
async function newestBatch(env: Partial<Env>, which: 'sweep' | 'repair', timeoutMs: number): Promise<Batch> {
  const db = env.DB as any;
  if (!db || typeof db.prepare !== 'function') return { state: 'unreadable', reason: 'The DB binding is not present on this Worker.' };
  try {
    const anchor = which === 'sweep' ? 'agent_sweep_admitted' : 'agent_repair_pending';
    const head: any = await withTimeout(db.prepare(
      'SELECT timestamp FROM system_metrics WHERE metric_name = ? ORDER BY timestamp DESC LIMIT 1',
    ).bind(anchor).first(), timeoutMs);
    if (!head) return { state: 'never' };
    const at = sqlUtc(head.timestamp);
    if (!at) return { state: 'unreadable', reason: 'The newest record has no readable time.' };
    const res: any = await withTimeout(which === 'sweep'
      ? db.prepare(
        `SELECT metric_name, value, labels FROM system_metrics
          WHERE timestamp = ? AND metric_name IN ('agent_sweep_candidates_examined', 'agent_sweep_eligible', 'agent_sweep_admitted',
            'agent_sweep_refused', 'agent_sweep_resent', 'agent_sweep_oldest_eligible_age_seconds')
          ORDER BY id DESC`,
      ).bind(head.timestamp).all()
      : db.prepare(
        `SELECT metric_name, value, labels FROM system_metrics
          WHERE timestamp = ? AND metric_name IN ('agent_repair_pending', 'agent_repair_repaired', 'agent_repair_ambiguous',
            'agent_repair_oldest_age_seconds')
          ORDER BY id DESC`,
      ).bind(head.timestamp).all(), timeoutMs);
    if (!Array.isArray(res?.results)) return { state: 'unreadable', reason: 'system_metrics answered without rows.' };
    const values = new Map<string, number>();
    let labels: Record<string, unknown> = {};
    for (const r of res.results) {
      // Two sweeps in one second write two batches; the newest row of each name wins.
      if (values.has(r.metric_name)) continue;
      const v = Number(r.value);
      if (r.value === null || r.value === undefined || !Number.isFinite(v) || v < 0) continue;
      values.set(r.metric_name, v);
      if (r.metric_name === (which === 'sweep' ? 'agent_sweep_admitted' : 'agent_repair_pending')) {
        try { const p = JSON.parse(r.labels || '{}'); if (p && typeof p === 'object') labels = p; } catch { /* no labels */ }
      }
    }
    return { state: 'ok', at, values, labels };
  } catch (e) {
    return { state: 'unreadable', reason: (e as Error)?.message === 'timeout' ? 'system_metrics did not answer in time.' : 'system_metrics could not be read.' };
  }
}

const SWEEP_SOURCE = 'system_metrics agent_sweep_* (agents/sweep.ts, D4592)';
const SWEEP_WINDOW = 'The newest agent sweep: one pass, every 5 minutes.';
const SWEEP_SAMPLING = 'Each sweep writes one batch; this read takes the newest batch and calls it stale after 20 minutes.';
const REPAIR_SOURCE = 'system_metrics agent_repair_* (agents/sweep.ts sweepStrandedRuns, D4593)';
const REPAIR_SAMPLING = 'Each sweep writes one batch before its halt and engine checks; this read takes the newest batch and calls it stale after 20 minutes.';

function base(key: string, label: string, source: string, unit: Metric['unit'], thresholds: Thresholds | null, sampling: string): Base {
  return { key, label, source, unit, scope: 'deployment', thresholds, window: SWEEP_WINDOW, sampling };
}

/** #4592 and #4593: the agent sweep's eligible work, admissions and lifecycle repairs. */
export async function readAgentSweepSignals(env: Partial<Env>, now: Date, timeoutMs = READ_TIMEOUT_MS): Promise<Metric[]> {
  const sweep = {
    eligible: base('agents.sweep.eligible', `Eligible agent tasks found by the latest scan (at most ${SWEEP_SCAN_CAP})`, SWEEP_SOURCE, 'count', null, SWEEP_SAMPLING),
    examined: base('agents.sweep.examined', 'Eligible tasks the latest sweep examined', SWEEP_SOURCE, 'count', null, SWEEP_SAMPLING),
    admitted: base('agents.sweep.admitted', 'Agent runs the latest sweep admitted', SWEEP_SOURCE, 'count', null, SWEEP_SAMPLING),
    refused: base('agents.sweep.refused', 'Admissions the latest sweep was refused', SWEEP_SOURCE, 'count', null, SWEEP_SAMPLING),
    resent: base('agents.sweep.resent', 'Stale admitted runs the latest sweep resent', SWEEP_SOURCE, 'count', null, SWEEP_SAMPLING),
    age: base('agents.sweep.oldest_eligible_age_seconds', 'Oldest eligible agent task age', SWEEP_SOURCE, 'seconds', ELIGIBLE_AGE_THRESHOLDS, SWEEP_SAMPLING),
  };
  const repair = {
    pending: base('agents.repair.pending', `Lifecycle repairs the latest sweep found owed (at most ${REPAIR_CAP})`, REPAIR_SOURCE, 'count', null, REPAIR_SAMPLING),
    unresolved: base('agents.repair.unresolved', 'Lifecycle repairs the latest sweep could not settle', REPAIR_SOURCE, 'count', null, REPAIR_SAMPLING),
    age: base('agents.repair.oldest_age_seconds', 'Oldest lifecycle repair still owed', REPAIR_SOURCE, 'seconds', REPAIR_AGE_THRESHOLDS, REPAIR_SAMPLING),
  };
  const all = [...Object.values(sweep), ...Object.values(repair)];

  if (env.TEAM_AGENTS_ENABLED !== 'true') {
    return all.map((b) => notRunning(b, 'Team agents are off on this deployment, so the agent sweep does not run.'));
  }
  const [s, r] = await Promise.all([newestBatch(env, 'sweep', timeoutMs), newestBatch(env, 'repair', timeoutMs)]);
  const out: Metric[] = [];

  // A batch that cannot be used makes every metric it carries unavailable, with the same reason.
  const unusable = (b: Batch, who: string): { reason: string; at: string | null } | null => {
    if (b.state === 'never') return { reason: `The agent sweep has never recorded ${who}.`, at: null };
    if (b.state === 'unreadable') return { reason: b.reason, at: null };
    if (now.getTime() - Date.parse(b.at) > SWEEP_STALE_AFTER_MS) {
      return { reason: `The agent sweep last recorded ${who} at ${b.at}; it runs every 5 minutes, so that reading is stale.`, at: b.at };
    }
    return null;
  };

  const su = unusable(s, 'its admissions');
  if (su || s.state !== 'ok') {
    for (const b of Object.values(sweep)) out.push(unavailable(b, su?.reason ?? 'Unreadable.', su?.at ?? null));
  } else {
    const v = (name: string) => s.values.get(name);
    const count = (b: Base, name: string) => {
      const n = v(name);
      return n === undefined ? unavailable(b, 'The latest sweep recorded no value for this.', s.at) : measured(b, n, s.at);
    };
    const scanned = s.labels.scanned;
    if (scanned === true) {
      out.push(count(sweep.eligible, 'agent_sweep_eligible'));
    } else if (scanned === false) {
      out.push(notRunning(sweep.eligible, 'The latest sweep did not scan for eligible work (halted, engine off or paused, or manual autonomy).', s.at));
    } else {
      out.push(unavailable(sweep.eligible, 'The latest sweep did not say whether it scanned, so its eligible count is not evidence.', s.at));
    }
    out.push(count(sweep.examined, 'agent_sweep_candidates_examined'));
    out.push(count(sweep.admitted, 'agent_sweep_admitted'));
    out.push(count(sweep.refused, 'agent_sweep_refused'));
    out.push(count(sweep.resent, 'agent_sweep_resent'));
    const eligible = v('agent_sweep_eligible');
    const age = v('agent_sweep_oldest_eligible_age_seconds');
    if (scanned === false) {
      out.push(notRunning(sweep.age, 'The latest sweep did not scan for eligible work, so there is no age to state.', s.at));
    } else if (scanned !== true) {
      out.push(unavailable(sweep.age, 'The latest sweep did not say whether it scanned.', s.at));
    } else if (eligible === 0) {
      out.push(noneWaiting(sweep.age, 'The latest scan found no eligible work.', s.at));
    } else if (age === undefined) {
      out.push(unavailable(sweep.age, 'The latest scan found eligible work but recorded no age for it.', s.at));
    } else {
      out.push(measured(sweep.age, Math.round(age), s.at, levelFor(Math.round(age), ELIGIBLE_AGE_THRESHOLDS)));
    }
  }

  const ru = unusable(r, 'its lifecycle repairs');
  if (ru || r.state !== 'ok') {
    for (const b of Object.values(repair)) out.push(unavailable(b, ru?.reason ?? 'Unreadable.', ru?.at ?? null));
  } else {
    const pending = r.values.get('agent_repair_pending');
    const unresolved = r.values.get('agent_repair_ambiguous');
    const age = r.values.get('agent_repair_oldest_age_seconds');
    out.push(pending === undefined ? unavailable(repair.pending, 'The latest sweep recorded no repair count.', r.at) : measured(repair.pending, pending, r.at));
    out.push(unresolved === undefined ? unavailable(repair.unresolved, 'The latest sweep recorded no unresolved count.', r.at) : measured(repair.unresolved, unresolved, r.at));
    if (pending === undefined || unresolved === undefined) {
      out.push(unavailable(repair.age, 'The latest sweep did not record both its found and unresolved repairs.', r.at));
    } else if (pending === 0) {
      out.push(noneWaiting(repair.age, 'The latest sweep found no lifecycle repair owed.', r.at));
    } else if (unresolved === 0 && pending < REPAIR_CAP) {
      // Every run it found was repaired or settled in that sweep; the found age is history, not debt.
      out.push(noneWaiting(repair.age, 'Every repair the latest sweep found was repaired or settled.', r.at));
    } else if (age === undefined) {
      out.push(unavailable(repair.age, 'Repairs are still owed but the sweep recorded no age for them.', r.at));
    } else {
      // Unresolved repairs, or a full batch that may leave more behind: the oldest found is the bound.
      out.push(measured(repair.age, Math.round(age), r.at, levelFor(Math.round(age), REPAIR_AGE_THRESHOLDS)));
    }
  }
  return out;
}

/** #4558: the age of the last passing restore drill, from its marker. */
export async function readRestoreSignal(env: Partial<Env>, now: Date, timeoutMs = READ_TIMEOUT_MS): Promise<Metric> {
  const b: Base = {
    key: 'dr.restore.last_verified_age_seconds', label: 'Last verified restore age',
    source: 'drill-d1.json in the backups bucket (scripts/dr-drill.sh, D263, D4558)', unit: 'seconds', scope: 'deployment',
    thresholds: RESTORE_AGE_THRESHOLDS,
    window: 'The latest restore drill; the marker keeps only the latest run.',
    sampling: 'The monthly drill writes the marker on every exit; this read validates it on each request.',
  };
  if (branchOf(env as Env)) return notRunning(b, 'The restore drill covers the HQ database only.');
  let drill: Awaited<ReturnType<typeof readRestoreDrill>>;
  try {
    drill = await withTimeout(readRestoreDrill(env as Env, now.getTime()), timeoutMs);
  } catch (e) {
    return unavailable(b, (e as Error)?.message === 'timeout' ? 'The backups bucket did not answer in time.' : 'The restore drill marker could not be read.');
  }
  if (!drill.available) {
    return unavailable(b, drill.state === 'invalid' ? 'The restore drill marker is not valid evidence.' : 'The restore drill marker could not be read.');
  }
  if (drill.state === 'never_run') {
    return { ...b, value: null, availability: 'not_verified', reason: 'No restore drill has recorded a run, so no restore is verified.', level: 'critical', last_success_at: null };
  }
  if (drill.state === 'last_run_failed') {
    const step = typeof drill.step === 'string' && /^[a-z0-9_-]{1,40}$/i.test(drill.step) ? ` at step ${drill.step}` : '';
    return {
      ...b, value: null, availability: 'not_verified', level: 'critical', last_success_at: drill.at,
      reason: `The latest restore drill (${drill.at}) failed${step}; the marker keeps only the latest run, so no verified restore is on record.`,
    };
  }
  const ageS = Math.max(0, Math.floor((now.getTime() - Date.parse(drill.at)) / 1000));
  return measured(b, ageS, drill.at, levelFor(ageS, RESTORE_AGE_THRESHOLDS));
}

/** Every part 3 signal. Each fails into its own state; none fails the read. */
export async function readOperationalSignals(env: Partial<Env>, now: Date, timeoutMs = READ_TIMEOUT_MS): Promise<Metric[]> {
  const [agents, restore] = await Promise.all([readAgentSweepSignals(env, now, timeoutMs), readRestoreSignal(env, now, timeoutMs)]);
  return [...agents, restore];
}
