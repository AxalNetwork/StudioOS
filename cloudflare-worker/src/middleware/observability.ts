import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { getCurrentUser } from '../auth';
import { branchOf } from '../util/branch';
// D210 — which requests write an activity_logs row is decided in ONE place,
// because both Analytics pages count "active accounts" from it: a branch reads
// its own activity_logs, and HQ reads Analytics Engine through the same rule
// written as a WHERE clause. The skip list moved there; it is not restated here.
import { activityLogged } from '../services/activeAccounts';
// D4672 — a credential carried in the path never reaches a telemetry store.
import { redactPath } from '../util/pathRedaction';
import { produceRequestSectionIncident } from '../services/sectionIncidentRequestProducer';

// Endpoints completely excluded from system_metrics — prevents the monitoring
// dashboard's polling from inflating the very metrics it displays.
const SKIP_METRICS_PATHS = [
  '/api/health',
  '/api/monitoring/',
];

function shouldMeter(path: string) {
  return path.startsWith('/api/') && !SKIP_METRICS_PATHS.some(p => path === p || path.startsWith(p));
}

/**
 * D9202 (#9202) — the D1 `system_metrics` 'request' row is SAMPLED, one in
 * this many, because Analytics Engine already carries every request and D1
 * runs writes one at a time on the same database as real writes. The row's
 * `value` column holds the number of requests it stands for (this rate for a
 * sampled row, 1 for a row kept whole), so every reader counts with
 * `SUM(value)` and averages weighted by it; rows written before the change
 * have value 1 and read the same way.
 */
export const REQUEST_METRIC_SAMPLE_EVERY = 10;

/**
 * How many requests this request's `system_metrics` row stands for, or 0 for
 * no row. A 5xx or a 429 is rare and is what the monitoring health figure and
 * the rate-limited count are made of, so it is always kept, at weight 1.
 * Everything else is kept when `rand` falls in the first 1/N of [0, 1).
 */
export function requestMetricWeight(status: number, rand: number): number {
  if (status >= 500 || status === 429) return 1;
  return rand < 1 / REQUEST_METRIC_SAMPLE_EVERY ? REQUEST_METRIC_SAMPLE_EVERY : 0;
}

/**
 * D9202 — a READ (GET, HEAD) writes at most one `activity_logs` row per
 * account per endpoint per UTC minute, per isolate. Every reader of the
 * middleware's rows asks a coarser question — distinct accounts per day, per
 * week, per hour of activity, the first logged day, the newest request — and a
 * minute bucket nests inside each of those, so each still sees the account.
 * A WRITE (any other method) is logged every time: the Stripe webhook's
 * delivery count, refusal streak and newest success/failure read one row per
 * POST, and a write is the kind of request an audit should never collapse.
 *
 * The map holds key → minute. It is per isolate, so two isolates may each
 * write one row for the same minute: the cap bounds the writes, it does not
 * promise uniqueness. It is cleared whole past ACTIVITY_DEDUPE_CAP keys, so
 * memory stays bounded; a clear costs at most one extra row per key.
 */
const ACTIVITY_DEDUPE_CAP = 10_000;
const activitySeen = new Map<string, number>();

/** For tests: forget which reads this isolate has already logged. */
export function resetActivityLogDedupe(): void { activitySeen.clear(); }

/** Whether this read was already logged for this account, endpoint and minute; records it if not. */
function readAlreadyLogged(userId: number | null, method: string, endpoint: string, atMs: number): boolean {
  const key = `${userId ?? 'anon'}\u0000${method}\u0000${endpoint}`;
  const minute = Math.floor(atMs / 60_000);
  if (activitySeen.get(key) === minute) return true;
  if (activitySeen.size >= ACTIVITY_DEDUPE_CAP) activitySeen.clear();
  activitySeen.set(key, minute);
  return false;
}

export type ObservabilityOptions = {
  /** The sampling draw for `system_metrics`, in [0, 1). Tests pin it. */
  random?: () => number;
};

let defaultDraw: () => number = Math.random;

/**
 * For tests that mount the whole Worker (the D1 statement budgets): pin the
 * sampling draw of the middleware index.ts already built. No argument restores
 * Math.random.
 */
export function setRequestMetricDrawForTests(draw?: () => number): void { defaultDraw = draw ?? Math.random; }

export const observabilityMiddleware = (opts: ObservabilityOptions = {}): MiddlewareHandler<{ Bindings: Env }> => {
  const random = opts.random ?? (() => defaultDraw());
  return async (c, next) => {
    const start = Date.now();
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;

    let errored: any = null;
    try {
      await next();
    } catch (err) {
      errored = err;
      throw err;
    } finally {
      const latency = Date.now() - start;
      const status = errored ? 500 : c.res.status;
      // D4672 — what every store below records: the path with each credential
      // the route carries in it (a consent, share, signing or download link)
      // replaced by its parameter name. `path` itself is kept for the
      // decisions (metering, activity) that read prefixes.
      let recorded = path;
      let routePattern: string | undefined;
      try { routePattern = (c.req as any).routePath; } catch {}
      try { recorded = redactPath(path, routePattern); } catch { recorded = redactPath(path); }
      const env = c.env;
      const ctx = c.executionCtx as any;

      // Reuse the user resolved by rateLimit middleware (cached on context).
      const cached: any = (c as any).get('currentUser');
      const work = (async () => {
        let userId: number | null = null;
        let actor: string | null = null;
        let role: string = 'anon';
        // D9202 — the Analytics Engine tier label is the plan auth already
        // loaded: resolveCurrentUser hydrates `mi_subscription_plan` from
        // `mi_pro_subscriptions` once per request, the same column the
        // middleware used to SELECT again here on every signed-in request.
        let tier = 'free';
        try {
          const u = cached !== undefined ? cached : await getCurrentUser(c);
          userId = u?.id ?? null;
          actor = u?.email ?? null;
          role = u?.role ?? 'anon';
          if (u?.mi_subscription_plan) tier = String(u.mi_subscription_plan);
        } catch {}

        // ---- D5981: section incident producer (off unless its start time is set) ----
        // Only the method, the route pattern and the status are passed; the
        // outbox write is its own background task and never fails this one.
        if (ctx && env.AXAL_SECTION_REQUEST_INCIDENT_START_UTC) {
          await produceRequestSectionIncident(env, ctx, {
            method, routePattern, status, errored: Boolean(errored), authenticated: userId != null,
          });
        }

        // ---- increment a metric counter (skip self-monitoring paths) ----
        if (shouldMeter(path)) {
          // D9202 — sampled; `value` is the number of requests the row stands for.
          const weight = requestMetricWeight(status, random());
          if (weight > 0) {
            try {
              await env.DB.prepare(
                `INSERT INTO system_metrics (metric_name, value, labels) VALUES (?, ?, ?)`
              ).bind(
                'request',
                weight,
                JSON.stringify({ endpoint: recorded, method, status, latency_ms: latency, role }),
              ).run();
            } catch (e) {
              console.error('system_metrics insert failed', e);
            }
          }

          // Task #13 — also write to Workers Analytics Engine when the
          // ANALYTICS binding is present. Required dimensions per task
          // contract: {ts, route, status, duration_ms, user_id, role, tier}.
          // ts is implicit (AE timestamps every row). Best-effort — never
          // throw, never block the request.
          try {
            // `Env.ANALYTICS` is declared (types.ts), so this reads the typed
            // field directly. It used to go through an `as unknown as` cast
            // that worked around a type which already existed.
            const ae = env.ANALYTICS;
            if (ae && typeof ae.writeDataPoint === 'function') {
              ae.writeDataPoint({
                // Indexes (cardinality-bounded; first one is the sampling key).
                //
                // D161 — THE BRANCH GOES IN A BLOB, NOT HERE, AND THAT IS
                // DELIBERATE. D105 justified sharing this dataset on the
                // grounds it was "indexed by BRANCH_CODE"; it never was, and
                // making it so now would change the SAMPLING KEY for every
                // request on the platform, so samples either side of the change
                // stop being comparable and route-level sampling fairness --
                // the reason `path` is the key -- is lost. Worse, it could not
                // be verified from here: `AnalyticsEngineDataPoint.indexes` is
                // typed as an UNBOUNDED array, so a second index typechecks,
                // and this block swallows failures with a console.warn below.
                // A silent runtime rejection is the one failure mode a metrics
                // write must not have. Do not "tidy" the branch into here.
                indexes: [recorded.slice(0, 96)],
                // Blobs (in slot order, must match SQL reads in
                // analyticsReports.ts loadTechnicalFromAnalyticsEngine):
                //   blob1 route, blob2 method, blob3 role, blob4 status,
                //   blob5 tier, blob6 branch
                //
                // blob6 is `branchOf(env)` and NOT `env.BRANCH_CODE` raw:
                // branchOf validates against BRANCH_CODE_RE and THROWS on a
                // malformed value. That throw is caught below, so a misconfigured
                // branch costs a dropped metric rather than a failed request --
                // correct, because such a deployment already fails loudly at
                // boot (assertBranchAppUrl) and on every authed path. Reading
                // the var raw would instead write a garbage dimension verbatim.
                blobs: [recorded, method, role, String(status), tier, branchOf(env) || 'hq'],
                // Doubles: double1 latency_ms, double2 status, double3 user_id
                doubles: [latency, status, userId ?? 0],
              });
            }
          } catch (e) {
            // AE writes can fail under load (token bucket); log only.
            console.warn('analytics engine write failed', (e as Error).message);
          }
        }

        // ---- write activity_logs row with latency / status ----
        // D9202 — a read is logged once per account, endpoint and minute; a write every time.
        const isRead = method === 'GET' || method === 'HEAD';
        if (activityLogged(path, status) && !(isRead && readAlreadyLogged(userId, method, recorded, start))) {
          try {
            await env.DB.prepare(
              `INSERT INTO activity_logs (action, details, actor, user_id, endpoint, method, status_code, latency_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              `http_${method.toLowerCase()}`,
              `${method} ${recorded} → ${status} (${latency}ms)`,
              actor,
              userId,
              recorded,
              method,
              status,
              latency,
            ).run();
          } catch (e) {
            console.error('activity_logs insert failed', e);
          }
        }

        // ---- error tracking ----
        if (errored || status >= 500) {
          try {
            const msg = errored?.message ?? `HTTP ${status}`;
            const stack = (errored?.stack ?? '').toString().split('\n').slice(0, 5).join('\n');
            await env.DB.prepare(
              `INSERT INTO error_logs (user_id, endpoint, method, status_code, message, stack_snippet)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(userId, recorded, method, status, msg, stack).run();
          } catch (e) {
            console.error('error_logs insert failed', e);
          }
        }
      })();
      if (ctx) ctx.waitUntil(work); else await work;
    }
  };
};
