import { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { getCurrentUser } from '../auth';

// Endpoints we don't want spamming activity_logs on every request.
const SKIP_ACTIVITY_LOG_PATHS = [
  '/api/health',
  '/api/activity',                 // listing your own activity shouldn't write activity
  '/api/monitoring/',              // monitoring polls would create infinite churn
  '/api/dashboard/stats',
];

// Endpoints completely excluded from system_metrics — prevents the monitoring
// dashboard's polling from inflating the very metrics it displays.
const SKIP_METRICS_PATHS = [
  '/api/health',
  '/api/monitoring/',
];

function shouldLog(path: string) {
  return path.startsWith('/api/') && !SKIP_ACTIVITY_LOG_PATHS.some(p => path === p || path.startsWith(p));
}

function shouldMeter(path: string) {
  return path.startsWith('/api/') && !SKIP_METRICS_PATHS.some(p => path === p || path.startsWith(p));
}

export const observabilityMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
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
      const env = c.env;
      const ctx = c.executionCtx as any;

      // Reuse the user resolved by rateLimit middleware (cached on context).
      const cached: any = (c as any).get('currentUser');
      const work = (async () => {
        let userId: number | null = null;
        let actor: string | null = null;
        let role: string = 'anon';
        try {
          const u = cached !== undefined ? cached : await getCurrentUser(c);
          userId = u?.id ?? null;
          actor = u?.email ?? null;
          role = u?.role ?? 'anon';
        } catch {}

        // ---- increment a metric counter (skip self-monitoring paths) ----
        if (shouldMeter(path)) {
          try {
            await env.DB.prepare(
              `INSERT INTO system_metrics (metric_name, value, labels) VALUES (?, ?, ?)`
            ).bind(
              'request',
              1,
              JSON.stringify({ endpoint: path, method, status, latency_ms: latency, role }),
            ).run();
          } catch (e) {
            console.error('system_metrics insert failed', e);
          }

          // Task #13 — also write to Workers Analytics Engine when the
          // ANALYTICS binding is present. Required dimensions per task
          // contract: {ts, route, status, duration_ms, user_id, role, tier}.
          // ts is implicit (AE timestamps every row). Best-effort — never
          // throw, never block the request.
          try {
            const ae = (env as unknown as { ANALYTICS?: AnalyticsEngineDataset }).ANALYTICS;
            if (ae && typeof ae.writeDataPoint === 'function') {
              // Resolve subscription tier opportunistically. We don't want
              // to add a D1 hop on every single request, so only fetch when
              // we have a user id AND the binding is configured.
              let tier = 'free';
              if (userId != null) {
                try {
                  const row = await env.DB
                    .prepare('SELECT plan FROM mi_pro_subscriptions WHERE user_id = ?')
                    .bind(userId)
                    .first<{ plan: string | null }>();
                  if (row?.plan) tier = String(row.plan);
                } catch {}
              }
              ae.writeDataPoint({
                // Indexes (cardinality-bounded; first one is the sampling key)
                indexes: [path.slice(0, 96)],
                // Blobs (in slot order, must match SQL reads in
                // analyticsReports.ts loadTechnicalFromAnalyticsEngine):
                //   blob1 route, blob2 method, blob3 role, blob4 status, blob5 tier
                blobs: [path, method, role, String(status), tier],
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
        if (shouldLog(path) && status !== 429) {
          try {
            await env.DB.prepare(
              `INSERT INTO activity_logs (action, details, actor, user_id, endpoint, method, status_code, latency_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              `http_${method.toLowerCase()}`,
              `${method} ${path} → ${status} (${latency}ms)`,
              actor,
              userId,
              path,
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
            ).bind(userId, path, method, status, msg, stack).run();
          } catch (e) {
            console.error('error_logs insert failed', e);
          }
        }
      })();
      if (ctx) ctx.waitUntil(work); else await work;
    }
  };
};
