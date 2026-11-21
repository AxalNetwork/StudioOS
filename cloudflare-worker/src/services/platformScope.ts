/**
 * D5786 (#5786) — Platform readings scoped to one subsidiary, for HQ's scope switcher (#5757).
 *
 * The Platform overview's three reads (`/admin/platform/summary`, `/admin/deployments`,
 * `/monitoring/analytics/traffic-by-branch`) are HQ-wide: the summary reads HQ's own Worker and stores, and the other
 * two list every branch together. D4860 part 5 kept the switcher out until a reading is genuinely scoped, because a
 * switcher over HQ-wide reads would only relabel them. This is that reading. The HQ-wide reads are unchanged.
 *
 * A SUBSIDIARY IS A BRANCH, AND ITS IDENTITY IS ITS CODE. `licence_deployments.code` is the key the branch's own
 * `BRANCH_CODE`, its `BRANCH_<CODE>` service binding and Analytics Engine's blob6 all carry (util/branch, D211), and
 * `licence_uid` is its licence (D150). Nothing here takes a name, a hostname or a free-text id as a scope.
 *
 * WHAT IS ATTRIBUTABLE, AND WHAT IS NOT. Each Platform signal is one of three things for a subsidiary:
 *   attributable  read for that branch alone, from a key only that branch carries (`SCOPED_SIGNALS`);
 *   unavailable   the branch has its own, in its own database, and no read brings it to HQ (`UNAVAILABLE_SIGNALS`);
 *   hq_only       the reading is of HQ's own deployment and stores (`HQ_ONLY_SIGNALS`).
 * Only attributable signals judge a subsidiary's state. An HQ-wide reading NEVER stands in for one: the HQ-wide
 * telemetry probe, HQ's scheduled jobs or HQ's dead letters say nothing about a branch, so they are listed, with the
 * reason, and are not read here at all.
 *
 * THE STATE. Critical > degraded > unknown > healthy, by `healthStateOf`, the rule the summary uses (D4854). A scope
 * with no usable reading is Unknown, never Healthy: every attributable signal that did not answer is an `unknown` entry
 * with its reason, and a scope with none answering cannot read healthy.
 */
import type { Env } from '../types';
import { BRANCH_CODE_RE } from '../util/branch';
import { branchByCode, branchRead, branchBindings, type BranchResult } from './branches';
import { BRANCH_CHECK_STALE_HOURS, LIVE_BRANCH_STATES, healthStateOf, type DetectedIncident, type HealthState, REMEDIATION } from './platformHealth';
import { loadTrafficByBranch, parseRange, type BranchTrafficRow } from './analyticsReports';

/** The traffic read's own row cap (`loadTrafficByBranch`'s LIMIT). A code missing from a full page is not a zero. */
export const TRAFFIC_ROW_CAP = 50;

/** The default window, the one the overview's traffic read uses (`parseRange` with no bounds). */
export const TRAFFIC_WINDOW_DAYS = 30;

export type Availability = 'ready' | 'unavailable' | 'not_deployed';

/** One subsidiary, by its canonical keys only. */
export type Scope = {
  kind: 'subsidiary';
  code: string;
  licence_uid: string | null;
  /** The deployment's provisioning status in the registry, or null when HQ holds no row for a bound branch. */
  registry_status: string | null;
  /** Whether this Worker has a service binding to the branch, so its live health can be asked. */
  bound: boolean;
};

/** The signals read per subsidiary, each its own block with availability, observation time and source. */
export const SCOPED_SIGNALS = [
  { key: 'live_health', name: 'Branch health', source: 'the branch itself, over its service binding (health RPC)' },
  { key: 'stored_check', name: 'Last stored check', source: 'licence_deployments (D1): the last health check Deployments stored (D452)' },
  { key: 'traffic', name: 'Traffic', source: 'Analytics Engine, rows coded with the branch (blob6)' },
] as const;

/** Signals the branch has in its own database that no read brings back to HQ. */
export const UNAVAILABLE_SIGNALS = [
  { key: 'jobs', name: 'Scheduled jobs', reason: 'A branch fires its own scheduled triggers into its own run history. No branch read returns that history to HQ, so it is not judged here.' },
  { key: 'dlq', name: 'Dead letters', reason: 'A branch drains its own queue into its own dead-letter tables. No branch read returns that backlog to HQ, so it is not judged here.' },
] as const;

/** Signals read from HQ's own deployment and stores: true of HQ, and not a reading of any subsidiary. */
export const HQ_ONLY_SIGNALS = [
  { key: 'telemetry', name: 'Telemetry probe', reason: 'The probe asks whether Analytics Engine answers at all. It is one reading for the platform; this scope\'s traffic is read on its own.' },
  { key: 'webhook', name: 'Stripe webhook', reason: 'HQ\'s Stripe webhook request log.' },
  { key: 'integrations', name: 'Integrations', reason: 'HQ\'s integrations table.' },
  { key: 'broadcast', name: 'Broadcast', reason: 'HQ\'s Telegram channels and X accounts.' },
  { key: 'overrides', name: 'HQ overrides', reason: 'The operator switches are HQ\'s and apply to the whole platform.' },
  { key: 'keys', name: 'Integration keys', reason: 'HQ\'s managed keys and Worker secrets.' },
  { key: 'catalog', name: 'Payments catalogue', reason: 'HQ\'s Stripe catalogue mirror.' },
  { key: 'promo_codes', name: 'Promo codes', reason: 'HQ\'s promo code mirror.' },
  { key: 'sync', name: 'GitHub sync', reason: 'HQ\'s Support ticket mirror.' },
  { key: 'meeting_bot', name: 'Meeting bot starts', reason: 'HQ\'s meeting bot runs.' },
  { key: 'published', name: 'Published incidents', reason: 'HQ\'s public status page.' },
] as const;

type Meta = { availability: Availability; observed_at: string | null; source: string; reason: string | null };

export type LiveHealthBlock = Meta & { db_ok: boolean | null; deploy_version: string | null; licence_status: string | null; timed_out?: true };
export type StoredCheckBlock = Meta & { ok: boolean | null; checked_at: string | null };
export type TrafficBlock = Meta & {
  window: { from: string; to: string; window_minutes: number } | null;
  hits: number | null; errors_5xx: number | null; error_rate_pct: number | null; p95_ms: number | null; avg_latency_ms: number | null;
};

export type ScopedReading = {
  scope: Scope;
  observed_at: string;
  state: HealthState;
  detected: DetectedIncident[];
  unknown: { signal: string; reason: string }[];
  signals: { live_health: LiveHealthBlock; stored_check: StoredCheckBlock; traffic: TrafficBlock };
  unavailable: { signal: string; reason: string }[];
  hq_only: { signal: string; reason: string }[];
};

/** The answer to a scope that is refused, by the reason it was. */
export class ScopeRefused extends Error {
  readonly code: 'invalid_scope' | 'unknown_scope';
  constructor(code: 'invalid_scope' | 'unknown_scope', message: string) { super(message); this.code = code; }
}

type RegistryRow = { licence_uid: string | null; code: string; status: string | null; last_health_at: string | null; last_health_ok: number | null };

/** The deployments registry, or null when it cannot be read. Codes only, never a worker, database or account. */
async function readRegistry(env: Env): Promise<RegistryRow[] | null> {
  try {
    const q = await env.DB.prepare(
      'SELECT licence_uid, code, status, last_health_at, last_health_ok FROM licence_deployments ORDER BY code LIMIT 500',
    ).all<RegistryRow>();
    return q.results ?? [];
  } catch {
    return null;
  }
}

/**
 * Every subsidiary HQ can scope to: each registry row and each bound branch, by code. With the registry unreadable,
 * the bound branches are still listed and `registry_available` says the set may be incomplete.
 */
export async function listScopes(env: Env): Promise<{ registry_available: boolean; registry_reason?: string; scopes: Scope[] }> {
  const rows = await readRegistry(env);
  const bound = new Set(branchBindings(env).map((b) => b.code));
  const byCode = new Map<string, Scope>();
  for (const r of rows ?? []) {
    if (!BRANCH_CODE_RE.test(r.code)) continue;
    byCode.set(r.code, { kind: 'subsidiary', code: r.code, licence_uid: r.licence_uid ?? null, registry_status: r.status ?? null, bound: bound.has(r.code) });
  }
  for (const code of bound) {
    if (!byCode.has(code)) byCode.set(code, { kind: 'subsidiary', code, licence_uid: null, registry_status: null, bound: true });
  }
  const scopes = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return rows === null
    ? { registry_available: false, registry_reason: 'The deployments registry could not be read, so only the branches this Worker is bound to are listed.', scopes }
    : { registry_available: true, scopes };
}

const msOf = (s: string | null | undefined) => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`) : NaN);

type BranchHealthData = { ok?: boolean; db_ok?: boolean; deploy_version?: string | null; licence_status?: string | null; detail?: string; as_of?: string };

export type ScopeReaders = {
  live: (env: Env, code: string) => Promise<BranchResult<BranchHealthData>>;
  traffic: (env: Env) => ReturnType<typeof loadTrafficByBranch>;
};

export const SCOPE_READERS: ScopeReaders = {
  live: (env, code) => branchRead<BranchHealthData>(env, code, 'health'),
  traffic: (env) => loadTrafficByBranch(env, parseRange(null, null, TRAFFIC_WINDOW_DAYS)),
};

/** The traffic block for one code from the HQ-wide split: its own row, a true zero, or unavailable. */
export function trafficFor(code: string, read: Awaited<ReturnType<typeof loadTrafficByBranch>> | null): TrafficBlock {
  const source = SCOPED_SIGNALS[2].source;
  const none = { hits: null, errors_5xx: null, error_rate_pct: null, p95_ms: null, avg_latency_ms: null };
  if (!read || !read.available) {
    return { availability: 'unavailable', observed_at: read?.as_of ?? null, source, reason: read?.reason || 'The traffic read did not answer.', window: read ? { ...read.range, window_minutes: read.window_minutes } : null, ...none };
  }
  const window = { ...read.range, window_minutes: read.window_minutes };
  const row: BranchTrafficRow | undefined = read.rows.find((r) => r.branch === code);
  if (row) {
    return { availability: 'ready', observed_at: read.as_of, source, reason: null, window, hits: row.hits, errors_5xx: row.errors_5xx, error_rate_pct: row.error_rate_pct, p95_ms: row.p95_ms, avg_latency_ms: row.avg_latency_ms };
  }
  if (read.rows.length >= TRAFFIC_ROW_CAP) {
    return { availability: 'unavailable', observed_at: read.as_of, source, reason: `The traffic split lists the ${TRAFFIC_ROW_CAP} busiest deployments, and this branch is not among them, so its count is not known.`, window, ...none };
  }
  // Analytics Engine answered over the whole split and holds no request coded with this branch: a count of zero.
  return { availability: 'ready', observed_at: read.as_of, source, reason: null, window, hits: 0, errors_5xx: 0, error_rate_pct: 0, p95_ms: null, avg_latency_ms: null };
}

/**
 * One subsidiary's reading. `code` must be a branch code HQ knows (registry or binding); anything else is refused, and
 * nothing is read for a refused scope.
 */
export async function readScope(env: Env, rawCode: string, { readers = SCOPE_READERS, now = new Date() }: { readers?: ScopeReaders; now?: Date } = {}): Promise<ScopedReading> {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!BRANCH_CODE_RE.test(code)) throw new ScopeRefused('invalid_scope', 'A scope is a branch code: a lowercase hostname label, never "hq".');

  const rows = await readRegistry(env);
  const row = rows?.find((r) => r.code === code) ?? null;
  const bound = !!branchByCode(env, code);
  if (!row && !bound) {
    throw new ScopeRefused('unknown_scope', rows === null
      ? 'No branch is bound under that code, and the deployments registry could not be read to look further.'
      : 'No subsidiary is deployed or bound under that code.');
  }
  const scope: Scope = { kind: 'subsidiary', code, licence_uid: row?.licence_uid ?? null, registry_status: row?.status ?? null, bound };

  const [live, traffic] = await Promise.all([
    readers.live(env, code).catch((): BranchResult<BranchHealthData> => ({ code, binding: '', status: 'unreadable', reason: 'The branch could not be asked.' })),
    readers.traffic(env).catch(() => null),
  ]);

  const liveSource = SCOPED_SIGNALS[0].source;
  const liveBlock: LiveHealthBlock = live.status === 'ok' && live.data
    ? {
      availability: 'ready', observed_at: live.as_of ?? live.data.as_of ?? null, source: liveSource, reason: null,
      db_ok: live.data.db_ok === true, deploy_version: live.data.deploy_version ?? null, licence_status: live.data.licence_status ?? null,
    }
    : {
      availability: live.status === 'not_deployed' ? 'not_deployed' : 'unavailable', observed_at: live.as_of ?? null, source: liveSource,
      reason: live.reason || 'The branch did not answer.', db_ok: null, deploy_version: null, licence_status: null,
      ...(live.timed_out ? { timed_out: true as const } : {}),
    };

  const checkSource = SCOPED_SIGNALS[1].source;
  const checkBlock: StoredCheckBlock = rows === null
    ? { availability: 'unavailable', observed_at: null, source: checkSource, reason: 'The deployments registry could not be read.', ok: null, checked_at: null }
    : !row
      ? { availability: 'unavailable', observed_at: null, source: checkSource, reason: 'HQ holds no deployment row for this branch, so no check was stored.', ok: null, checked_at: null }
      : row.last_health_at
        ? { availability: 'ready', observed_at: row.last_health_at, source: checkSource, reason: null, ok: row.last_health_ok === 1 ? true : row.last_health_ok === 0 ? false : null, checked_at: row.last_health_at }
        : { availability: 'unavailable', observed_at: null, source: checkSource, reason: 'Deployments has never stored a check for this branch.', ok: null, checked_at: null };

  const trafficBlock = trafficFor(code, traffic);

  const { detected, unknown } = judgeScope({ code, live: liveBlock, check: checkBlock, traffic: trafficBlock, registryStatus: scope.registry_status, now });
  return {
    scope,
    observed_at: now.toISOString(),
    state: healthStateOf(detected, unknown),
    detected,
    unknown,
    signals: { live_health: liveBlock, stored_check: checkBlock, traffic: trafficBlock },
    unavailable: UNAVAILABLE_SIGNALS.map((s) => ({ signal: s.name, reason: s.reason })),
    hq_only: HQ_ONLY_SIGNALS.map((s) => ({ signal: s.name, reason: s.reason })),
  };
}

const inc = (i: Omit<DetectedIncident, 'remediation'>): DetectedIncident => ({ ...i, remediation: REMEDIATION[i.kind] });

/**
 * The scope's incidents and unknowns, from its attributable signals only. Pure. The branch rules are the summary's
 * (D5370): a stored check that said not ok is medium, an old or missing one is a low note; a live answer whose database
 * fails is medium. Traffic is read for its availability and never judged by a threshold nobody set.
 */
export function judgeScope(input: { code: string; live: LiveHealthBlock; check: StoredCheckBlock; traffic: TrafficBlock; registryStatus: string | null; now: Date }) {
  const observed = input.now.toISOString();
  const detected: DetectedIncident[] = [];
  const unknown: { signal: string; reason: string }[] = [];
  const { code, live, check, traffic } = input;
  const live_expected = input.registryStatus === null || (LIVE_BRANCH_STATES as readonly string[]).includes(input.registryStatus);

  if (live.availability === 'ready') {
    if (live.db_ok === false) {
      detected.push(inc({
        key: `branch:${code}`, kind: 'branch', severity: 'medium', title: `Branch ${code} answered, but its database is failing`,
        detail: 'The branch answered its health check and its database query failed.', since: live.observed_at, observed_at: observed,
      }));
    }
  } else if (live_expected) {
    unknown.push({ signal: 'Branch health', reason: live.reason || 'The branch did not answer.' });
  } else {
    unknown.push({ signal: 'Branch health', reason: `The branch is ${input.registryStatus ?? 'not provisioned'} in the registry, so it is not live to ask.` });
  }

  if (check.availability === 'ready') {
    if (check.ok === false && !detected.some((d) => d.key === `branch:${code}`)) {
      detected.push(inc({
        key: `branch:${code}`, kind: 'branch', severity: 'medium', title: `Branch ${code} reported unhealthy at its last check`,
        detail: `Checked ${check.checked_at} by Deployments. Open Deployments to ask it again.`, since: check.checked_at, observed_at: observed,
      }));
    } else if (check.ok !== false) {
      const at = msOf(check.checked_at);
      if (Number.isNaN(at) || input.now.getTime() - at > BRANCH_CHECK_STALE_HOURS * 3_600_000) {
        detected.push(inc({
          key: `branch_check:${code}`, kind: 'branch', severity: 'low', title: `Branch ${code} has not been checked in ${BRANCH_CHECK_STALE_HOURS} hours`,
          detail: 'Only Deployments asks a branch, and it stores the answer only when the branch replies.', since: check.checked_at, observed_at: observed,
        }));
      }
    }
  }

  if (traffic.availability !== 'ready') unknown.push({ signal: 'Traffic', reason: traffic.reason || 'The traffic read did not answer.' });

  return { detected, unknown };
}
