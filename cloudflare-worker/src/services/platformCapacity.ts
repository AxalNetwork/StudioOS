/**
 * D4559 (#4559) — platform capacity: this Worker's own D1 size against its plan
 * limit, its queues' backlog and oldest-message age, and which declared
 * bindings are present. `GET /api/admin/platform/capacity`, Super Admin only.
 *
 * WORKER-NATIVE ONLY. Every figure here is read through a binding the Worker
 * already holds: D1's `meta.size_after` (bytes, returned with every query) and
 * `Queue.metrics()` (backlog count, bytes, oldest message timestamp). No
 * Cloudflare account API is called and no token is read, so this read cannot
 * leak or need a credential. The account-level metrics (GraphQL datasets) are
 * listed in `documentation/operations/PLATFORM_OBSERVABILITY.md` as owner items.
 *
 * MISSING IS NOT ZERO. A metric that could not be read carries `value: null`,
 * `availability: 'unavailable'`, a reason and the level `unknown`. The overall
 * level is never `ok` while a metric is unknown, so an outage of the source
 * cannot read as a healthy platform.
 *
 * NO PERSONAL DATA. Nothing here names a member, a company, a tenant or a file;
 * the scope of every metric is this deployment. Units are bytes, counts and
 * seconds; no arithmetic mixes them.
 */
import type { Env } from '../types';
import { BINDINGS } from './topology';
import { branchOf } from '../util/branch';

/** Decimal gigabyte: Cloudflare states D1 limits in GB. */
export const GB = 1_000_000_000;

/**
 * The documented D1 maximum per database on Workers Paid (10 GB). The account's
 * plan is not readable from inside the Worker, so this is a default the owner
 * confirms or overrides with `PLATFORM_D1_LIMIT_BYTES`.
 */
export const D1_LIMIT_BYTES_DEFAULT = 10 * GB;
/** #4559: an architecture review at about 5 GB. A policy trigger, not a Cloudflare limit. */
export const D1_WARN_BYTES_DEFAULT = 5 * GB;
/** #4559: a migration / partitioning assessment before about 7–8 GB. A policy trigger. */
export const D1_CRIT_BYTES_DEFAULT = 7.5 * GB;
/** A level is held until the value falls this far below the threshold that raised it. */
export const D1_HYSTERESIS_BYTES = 0.25 * GB;

/** Queue oldest-message age, seconds. Proposed, not yet approved by the owner. */
export const QUEUE_AGE_WARN_S = 15 * 60;
export const QUEUE_AGE_CRIT_S = 60 * 60;
export const QUEUE_AGE_HYSTERESIS_S = 60;

/** A source that does not answer in this long is unavailable, not slow-but-fine. */
export const READ_TIMEOUT_MS = 5_000;

export type Level = 'ok' | 'warning' | 'critical' | 'unknown';
export type Availability = 'measured' | 'unavailable' | 'none_waiting';

export type Thresholds = { warning: number; critical: number; hysteresis: number; basis: string };

export type Metric = {
  key: string;
  label: string;
  source: string;
  unit: 'bytes' | 'messages' | 'seconds' | 'ratio';
  scope: 'deployment';
  value: number | null;
  availability: Availability;
  reason: string | null;
  level: Level;
  thresholds: Thresholds | null;
};

/**
 * The level for a value against warning/critical thresholds. Hysteresis needs
 * the previous level: a raised level is held while the value stays within
 * `hysteresis` below the threshold that raised it, so a value hovering at the
 * boundary does not flap. With no previous level the plain thresholds apply.
 */
export function levelFor(value: number | null, t: Thresholds, previous?: Level): Level {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  if (value >= t.critical) return 'critical';
  if (previous === 'critical' && value >= t.critical - t.hysteresis) return 'critical';
  if (value >= t.warning) return 'warning';
  if ((previous === 'critical' || previous === 'warning') && value >= t.warning - t.hysteresis) return 'warning';
  return 'ok';
}

/** The worst level wins; any unknown keeps the whole from reading `ok`. */
export function overallLevel(levels: Level[]): Level {
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warning')) return 'warning';
  if (levels.length === 0 || levels.includes('unknown')) return 'unknown';
  return 'ok';
}

/** A positive whole number of bytes from a deploy variable, or null. */
function bytesVar(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The D1 limit and thresholds, with any deploy override. An override that is
 * not a whole byte count, or that breaks warning < critical <= limit, is
 * ignored as a whole and the defaults stand, with the reason said.
 */
export function d1Policy(env: Partial<Env>) {
  const bag = env as Record<string, unknown>;
  const limit = bytesVar(bag.PLATFORM_D1_LIMIT_BYTES) ?? D1_LIMIT_BYTES_DEFAULT;
  const warning = bytesVar(bag.PLATFORM_D1_WARN_BYTES) ?? D1_WARN_BYTES_DEFAULT;
  const critical = bytesVar(bag.PLATFORM_D1_CRIT_BYTES) ?? D1_CRIT_BYTES_DEFAULT;
  const overridden = ['PLATFORM_D1_LIMIT_BYTES', 'PLATFORM_D1_WARN_BYTES', 'PLATFORM_D1_CRIT_BYTES']
    .some((k) => bag[k] !== undefined && bag[k] !== '');
  if (!(warning < critical && critical <= limit)) {
    return {
      limit: D1_LIMIT_BYTES_DEFAULT, warning: D1_WARN_BYTES_DEFAULT, critical: D1_CRIT_BYTES_DEFAULT,
      limit_basis: 'default',
      note: 'The D1 overrides were ignored: they must be whole byte counts with warning < critical <= limit.',
    };
  }
  return {
    limit, warning, critical,
    limit_basis: bytesVar(bag.PLATFORM_D1_LIMIT_BYTES) ? 'override' : 'default',
    note: overridden ? null : 'The 10 GB limit is the documented Workers Paid maximum; the account plan is not readable here and is unconfirmed.',
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unavailable(base: Omit<Metric, 'value' | 'availability' | 'reason' | 'level'>, reason: string): Metric {
  return { ...base, value: null, availability: 'unavailable', reason, level: 'unknown' };
}

/** D1 size in bytes from the query metadata D1 returns, against the plan limit. */
export async function readD1Size(env: Partial<Env>, timeoutMs = READ_TIMEOUT_MS): Promise<{ size: Metric; used: Metric; policy: ReturnType<typeof d1Policy> }> {
  const policy = d1Policy(env);
  const thresholds: Thresholds = {
    warning: policy.warning, critical: policy.critical, hysteresis: D1_HYSTERESIS_BYTES,
    basis: 'Review at the warning size and assess migration or partitioning at the critical size (#4559 policy triggers).',
  };
  const sizeBase = {
    key: 'd1.size_bytes', label: 'D1 database size', source: 'D1 query metadata (meta.size_after)',
    unit: 'bytes' as const, scope: 'deployment' as const, thresholds,
  };
  const usedBase = {
    key: 'd1.size_ratio', label: 'D1 size against plan limit', source: 'd1.size_bytes ÷ plan limit (bytes ÷ bytes)',
    unit: 'ratio' as const, scope: 'deployment' as const, thresholds: null,
  };
  let bytes: number | null = null;
  let reason = '';
  if (!env.DB || typeof (env.DB as any).prepare !== 'function') {
    reason = 'The DB binding is not present on this Worker.';
  } else {
    try {
      const res: any = await withTimeout(env.DB.prepare('SELECT 1').run(), timeoutMs);
      const raw = res?.meta?.size_after;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) bytes = raw;
      else reason = 'D1 answered without a database size.';
    } catch (e) {
      reason = (e as Error)?.message === 'timeout' ? 'D1 did not answer in time.' : 'D1 could not be read.';
    }
  }
  if (bytes === null) {
    return { size: unavailable(sizeBase, reason), used: unavailable(usedBase, reason), policy };
  }
  return {
    size: { ...sizeBase, value: bytes, availability: 'measured', reason: null, level: levelFor(bytes, thresholds) },
    used: { ...usedBase, value: bytes / policy.limit, availability: 'measured', reason: null, level: 'ok' },
    policy,
  };
}

/** One producer queue's backlog and oldest-message age from `Queue.metrics()`. */
export async function readQueue(env: Partial<Env>, binding: 'JOB_QUEUE' | 'AGENT_QUEUE', now: Date, timeoutMs = READ_TIMEOUT_MS): Promise<Metric[]> {
  const key = binding === 'JOB_QUEUE' ? 'queue.job' : 'queue.agent';
  const name = binding === 'JOB_QUEUE' ? 'Job queue' : 'Agent queue';
  const source = `${binding}.metrics()`;
  const ageThresholds: Thresholds = {
    warning: QUEUE_AGE_WARN_S, critical: QUEUE_AGE_CRIT_S, hysteresis: QUEUE_AGE_HYSTERESIS_S,
    basis: 'Proposed: oldest-message age is the saturation signal (#4559). Not yet approved by the owner.',
  };
  const countBase = { key: `${key}.backlog_messages`, label: `${name} backlog`, source, unit: 'messages' as const, scope: 'deployment' as const, thresholds: null };
  const bytesBase = { key: `${key}.backlog_bytes`, label: `${name} backlog size`, source, unit: 'bytes' as const, scope: 'deployment' as const, thresholds: null };
  const ageBase = { key: `${key}.oldest_age_seconds`, label: `${name} oldest message age`, source, unit: 'seconds' as const, scope: 'deployment' as const, thresholds: ageThresholds };
  const all = (reason: string) => [unavailable(countBase, reason), unavailable(bytesBase, reason), unavailable(ageBase, reason)];

  const q = (env as Record<string, any>)[binding];
  if (!q) return all(`The ${binding} binding is not present on this Worker.`);
  if (typeof q.metrics !== 'function') return all('This runtime does not expose queue metrics on the binding.');
  let m: any;
  try {
    m = await withTimeout(q.metrics(), timeoutMs);
  } catch (e) {
    return all((e as Error)?.message === 'timeout' ? 'The queue did not answer in time.' : 'The queue metrics could not be read.');
  }
  const count = m?.backlogCount;
  const bytes = m?.backlogBytes;
  const out: Metric[] = [];
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  out.push(isCount(count)
    ? { ...countBase, value: count, availability: 'measured', reason: null, level: 'ok' }
    : unavailable(countBase, 'The queue answered without a backlog count.'));
  out.push(isCount(bytes)
    ? { ...bytesBase, value: bytes, availability: 'measured', reason: null, level: 'ok' }
    : unavailable(bytesBase, 'The queue answered without a backlog size.'));

  const oldest = m?.oldestMessageTimestamp;
  const oldestMs = oldest instanceof Date ? oldest.getTime() : typeof oldest === 'number' || typeof oldest === 'string' ? new Date(oldest).getTime() : NaN;
  if (oldest === undefined || oldest === null) {
    if (isCount(count) && count === 0) {
      out.push({ ...ageBase, value: null, availability: 'none_waiting', reason: 'No message is waiting.', level: 'ok' });
    } else {
      out.push(unavailable(ageBase, 'The queue reported a backlog without its oldest message time.'));
    }
  } else if (!Number.isFinite(oldestMs)) {
    out.push(unavailable(ageBase, 'The oldest message time could not be read.'));
  } else {
    const age = (now.getTime() - oldestMs) / 1000;
    // A timestamp ahead of this Worker's clock is skew, not a fresh queue.
    if (age < -5) out.push(unavailable(ageBase, 'The oldest message time is ahead of this Worker\'s clock.'));
    else {
      const seconds = Math.max(0, Math.round(age));
      out.push({ ...ageBase, value: seconds, availability: 'measured', reason: null, level: levelFor(seconds, ageThresholds) });
    }
  }
  return out;
}

/** Declared bindings and whether each is present. Presence is not health. */
export function bindingPresence(env: Partial<Env>) {
  const code = branchOf(env as Env);
  const bag = env as Record<string, unknown>;
  return BINDINGS.filter((b) => !code || !b.hqOnly).map((b) => ({ name: b.name, kind: b.kind, present: bag[b.name] != null }));
}

/**
 * Account-level signals this read does not make, each with why. They need the
 * Cloudflare GraphQL Analytics API and a read-only token; see the runbook.
 */
export const NOT_READ_HERE = [
  { key: 'workers.requests_errors_cpu', reason: 'Account analytics (GraphQL workersInvocationsAdaptive); needs a read-only analytics token.' },
  { key: 'd1.reads_writes_latency', reason: 'Account analytics (GraphQL d1AnalyticsAdaptiveGroups, d1QueriesAdaptiveGroups); needs a read-only analytics token.' },
  { key: 'queues.dlq_arrivals', reason: 'The dead-letter queues have no producer binding here; HQ · Platform reads the D1 dead-letter mirror instead.' },
  { key: 'workflows.failures', reason: 'Account analytics (GraphQL workflowsAdaptiveGroups); needs a read-only analytics token.' },
  { key: 'r2.stored_bytes', reason: 'Account analytics (GraphQL r2StorageAdaptiveGroups); member file bytes are on HQ · Platform · Storage.' },
  { key: 'durable_objects.vectorize.containers', reason: 'No supported read through a binding; check in the Cloudflare dashboard.' },
] as const;

/** The whole read. Each part fails into its own unavailable state; none fails the read. */
export async function readPlatformCapacity(env: Partial<Env>, now: Date = new Date(), timeoutMs = READ_TIMEOUT_MS) {
  const [d1, job, agent] = await Promise.all([
    readD1Size(env, timeoutMs),
    readQueue(env, 'JOB_QUEUE', now, timeoutMs),
    readQueue(env, 'AGENT_QUEUE', now, timeoutMs),
  ]);
  const metrics = [d1.size, d1.used, ...job, ...agent];
  return {
    observed_at: now.toISOString(),
    scope: branchOf(env as Env) ? 'branch' : 'hq',
    level: overallLevel(metrics.map((m) => m.level)),
    d1_limit_bytes: d1.policy.limit,
    d1_limit_basis: d1.policy.limit_basis,
    d1_policy_note: d1.policy.note,
    metrics,
    bindings: bindingPresence(env),
    not_read_here: NOT_READ_HERE,
  };
}
