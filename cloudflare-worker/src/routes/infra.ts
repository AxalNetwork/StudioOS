/**
 * Admin-only infrastructure routes — queue inspection, metrics, manual trigger.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, createJWT } from '../auth';
import { Jobs, JobType } from '../models/jobs';
import { enqueueJob } from '../services/queue';
import { processQueueBatch } from '../services/queueWorker';
import { getRealtimeStats } from '../services/realtime';

const infra = new Hono<{ Bindings: Env }>();

// Defensive self-heal — the three tables /queue and /dlq read from were
// created by migrations, but if any deploy lands on a D1 instance where
// those migrations didn't run, every infra route 500s with "no such table".
let infraMigrated = false;
async function ensureInfraSchema(env: Env) {
  if (infraMigrated) return;
  // queue_jobs MUST match the canonical shape used by models/jobs.ts
  // (max_retries / updated_at / dead_at). A defensive CREATE TABLE IF NOT
  // EXISTS that omitted these would let the table win the race on a fresh
  // DB and break Jobs.enqueue/markFailed downstream.
  const stmts = [
    `CREATE TABLE IF NOT EXISTS queue_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      dead_at TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_qj_status ON queue_jobs(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_qj_type ON queue_jobs(job_type, status)`,
    `CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_job_id INTEGER,
      job_type TEXT NOT NULL,
      payload TEXT,
      last_error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      moved_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dlq_type ON dead_letter_queue(job_type, moved_at)`,
    // Task #7 (IE) — mirror table for CF Queue DLQ messages.
    `CREATE TABLE IF NOT EXISTS cf_dlq_mirror (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      payload TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cf_dlq_time ON cf_dlq_mirror(received_at)`,
    `CREATE INDEX IF NOT EXISTS idx_cf_dlq_type ON cf_dlq_mirror(job_type, received_at)`,
    `CREATE TABLE IF NOT EXISTS system_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_name TEXT NOT NULL,
      value REAL NOT NULL,
      labels TEXT DEFAULT '{}',
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sm_name_time ON system_metrics(metric_name, timestamp)`,
    // Task #7 (IE) — cron run history for observability dashboard.
    `CREATE TABLE IF NOT EXISTS cron_run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_name TEXT NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'started',
      summary TEXT,
      error TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_crh_trigger_time ON cron_run_history(trigger_name, started_at)`,
  ];
  // Only flip infraMigrated=true when every statement succeeds — otherwise
  // a transient D1 hiccup would lock the warm isolate into a partial schema.
  let allOk = true;
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); }
    catch (e: any) {
      allOk = false;
      console.error('infra ensureSchema:', e?.message);
    }
  }
  if (allOk) infraMigrated = true;
}

// GET /api/infra/queue — admin queue dashboard.
// Reports both the legacy D1 queue (still drained by cron during the
// migration window) AND the native CF Queue throughput. CF doesn't expose
// a "depth" via the message API, so we approximate by counting cf_queue
// completions/failures recorded in `system_metrics` over the last hour.
infra.get('/queue', async (c) => {
  await requireAdmin(c);
  await ensureInfraSchema(c.env);
  const stats = await Jobs.stats(c.env);

  const cfWindow = await c.env.DB.prepare(
    `SELECT json_extract(labels,'$.status') AS status, COUNT(*) AS n
       FROM system_metrics
      WHERE metric_name = 'job'
        AND timestamp >= datetime('now','-1 hour')
        AND json_extract(labels,'$.transport') = 'cf_queue'
      GROUP BY status`
  ).all<{ status: string; n: number }>();

  const realtime = await getRealtimeStats(c.env);

  return c.json({
    ok: true,
    transport_active: c.env.USE_CF_QUEUE === 'true' && !!c.env.JOB_QUEUE ? 'cf_queue' : 'd1',
    use_cf_queue_flag: c.env.USE_CF_QUEUE === 'true',
    cf_queue_binding_present: !!c.env.JOB_QUEUE,
    cf_queue_1h: cfWindow.results || [],
    realtime,
    ...stats,
  });
});

// GET /api/infra/metrics — high-throughput stats
infra.get('/metrics', async (c) => {
  await requireAdmin(c);
  await ensureInfraSchema(c.env);
  const minutes = Math.max(5, Math.min(1440, parseInt(c.req.query('minutes') || '60', 10)));
  const since = new Date(Date.now() - minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);

  const jobsPerMin = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m-%dT%H:%M:00Z', timestamp) AS bucket,
            json_extract(labels, '$.status') AS status,
            COUNT(*) AS n
     FROM system_metrics
     WHERE metric_name = 'job' AND timestamp >= ?
     GROUP BY bucket, status ORDER BY bucket`
  ).bind(since).all();

  const parallel = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM queue_jobs WHERE status = 'processing'`
  ).first<{ n: number }>();

  const projectsActive = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM projects WHERE status NOT IN ('archived','rejected')`
  ).first<{ n: number }>();

  const aiHealth = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM system_metrics
     WHERE metric_name = 'job' AND timestamp >= datetime('now','-5 minutes')
       AND json_extract(labels,'$.status') = 'completed'
       AND (json_extract(labels,'$.job_type') = 'ai_scoring'
         OR json_extract(labels,'$.job_type') = 'traction_review')`
  ).first<{ n: number }>();

  return c.json({
    ok: true,
    jobs_per_min: jobsPerMin.results || [],
    in_flight: parallel?.n ?? 0,
    projects_active: projectsActive?.n ?? 0,
    ai_calls_5m: aiHealth?.n ?? 0,
  });
});

// POST /api/infra/process — manual queue drain trigger (admin)
infra.post('/process', async (c) => {
  await requireAdmin(c);
  const batch = Math.max(1, Math.min(50, parseInt(c.req.query('batch') || '10', 10)));
  const result = await processQueueBatch(c.env, batch);
  return c.json({ ok: true, ...result });
});

// POST /api/infra/enqueue — admin can manually enqueue any job (for testing/ops)
infra.post('/enqueue', async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<{ job_type: JobType; payload?: any; max_retries?: number; idempotency_key?: string }>();
  if (!body?.job_type) return c.json({ error: 'job_type required' }, 400);
  // T8 — manual enqueues MUST carry an explicit idempotency_key so an
  // operator who fat-fingers two POSTs gets dedup'd at the SQL layer
  // instead of double-running side-effecting jobs (capital_call,
  // returns_distribution, lpa_generation, …). Internal callers of
  // `enqueueJob()` still default to crypto.randomUUID(); only this admin
  // surface enforces the contract.
  const idempotency_key = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
  if (!idempotency_key) {
    return c.json({ error: 'idempotency_key required (non-empty string)' }, 400);
  }
  const result = await enqueueJob(c.env, body.job_type, body.payload ?? {}, {
    max_retries: body.max_retries,
    idempotency_key,
  });
  return c.json({ ok: true, job: result.job, transport: result.transport, idempotency_key: result.idempotency_key });
});

// POST /api/infra/cleanup — purge old completed/failed jobs (>7 days) and old DLQ (>30 days)
infra.post('/cleanup', async (c) => {
  await requireAdmin(c);
  await Jobs.cleanup(c.env);
  return c.json({ ok: true });
});

// GET /api/infra/dlq — dead letter inspection with pagination/filtering.
// Reads both the legacy D1 dead_letter_queue AND the CF Queue DLQ mirror.
// Query params: job_type, source (cf|d1), limit (max 200), offset.
infra.get('/dlq', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const jobType = c.req.query('job_type') || '';
  const source = c.req.query('source') || ''; // 'cf' | 'd1' | ''
  const limit = Math.max(1, Math.min(200, parseInt(c.req.query('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));

  const buildWhere = (baseTable: string) => {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (jobType) { clauses.push('job_type = ?'); params.push(jobType); }
    const sql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return { sql, params };
  };

  // If source filter is active, query only one table; otherwise UNION.
  let count = 0;
  let items: any[] = [];

  if (source === 'd1') {
    const { sql, params } = buildWhere('dead_letter_queue');
    const cRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM dead_letter_queue ${sql}`).bind(...params).first<{ c: number }>();
    count = Number(cRow?.c ?? 0);
    const rows = await c.env.DB.prepare(
      `SELECT id, original_job_id, job_type, payload, last_error, attempts, moved_at AS created_at, 'd1' AS source
       FROM dead_letter_queue ${sql} ORDER BY moved_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();
    items = rows.results || [];
  } else if (source === 'cf') {
    const { sql, params } = buildWhere('cf_dlq_mirror');
    const cRow = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM cf_dlq_mirror ${sql}`).bind(...params).first<{ c: number }>();
    count = Number(cRow?.c ?? 0);
    const rows = await c.env.DB.prepare(
      `SELECT id, message_id AS original_job_id, job_type, payload, error AS last_error, attempts, received_at AS created_at, 'cf' AS source
       FROM cf_dlq_mirror ${sql} ORDER BY received_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all();
    items = rows.results || [];
  } else {
    // No source filter — UNION both tables.
    const { sql: w1, params: p1 } = buildWhere('dead_letter_queue');
    const { sql: w2, params: p2 } = buildWhere('cf_dlq_mirror');
    const c1 = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM dead_letter_queue ${w1}`).bind(...p1).first<{ c: number }>();
    const c2 = await c.env.DB.prepare(`SELECT COUNT(*) AS c FROM cf_dlq_mirror ${w2}`).bind(...p2).first<{ c: number }>();
    count = Number(c1?.c ?? 0) + Number(c2?.c ?? 0);
    const rows = await c.env.DB.prepare(
      `SELECT id, original_job_id, job_type, payload, last_error, attempts, created_at, source FROM (
        SELECT id, original_job_id, job_type, payload, last_error, attempts, moved_at AS created_at, 'd1' AS source
        FROM dead_letter_queue ${w1}
        UNION ALL
        SELECT id, message_id AS original_job_id, job_type, payload, error AS last_error, attempts, received_at AS created_at, 'cf' AS source
        FROM cf_dlq_mirror ${w2}
      ) ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...p1, ...p2, limit, offset).all();
    items = rows.results || [];
  }

  return c.json({
    ok: true,
    items,
    total: count,
    limit,
    offset,
  });
});

// POST /api/infra/dlq/:id/retry — re-enqueue a dead-letter job and remove it from DLQ.
// Requires ?source=d1|cf to avoid ambiguous ID collisions between the two tables.
infra.post('/dlq/:id/retry', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  const source = (c.req.query('source') || '').trim();
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  if (source !== 'd1' && source !== 'cf') return c.json({ error: 'source query param required (d1|cf)' }, 400);

  const table = source === 'cf' ? 'cf_dlq_mirror' : 'dead_letter_queue';
  const errorCol = source === 'cf' ? 'error' : 'last_error';
  const row = await c.env.DB.prepare(
    `SELECT job_type, payload, ${errorCol} AS last_error, attempts FROM ${table} WHERE id = ?`
  ).bind(id).first<{ job_type: string; payload: string | null; last_error: string | null; attempts: number }>();

  if (!row) return c.json({ error: 'DLQ item not found' }, 404);

  // Re-enqueue with a fresh idempotency key so the dedup layer won't
  // silently skip it if the original key is still in job_idempotency.
  const payload = row.payload ? JSON.parse(row.payload) : {};
  const result = await enqueueJob(c.env, row.job_type as JobType, payload, {
    idempotency_key: `dlq-retry-${source}-${id}-${crypto.randomUUID()}`,
  });

  // Remove from the correct table.
  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();

  return c.json({ ok: true, requeued: true, source, transport: result.transport, idempotency_key: result.idempotency_key });
});

// DELETE /api/infra/dlq/:id — discard a dead-letter entry (admin only).
// Requires ?source=d1|cf to avoid ambiguous ID collisions between the two tables.
infra.delete('/dlq/:id', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  const source = (c.req.query('source') || '').trim();
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  if (source !== 'd1' && source !== 'cf') return c.json({ error: 'source query param required (d1|cf)' }, 400);

  const table = source === 'cf' ? 'cf_dlq_mirror' : 'dead_letter_queue';
  const r = await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'DLQ item not found' }, 404);

  return c.json({ ok: true, deleted: true });
});

// Canonical cron expressions declared in wrangler.toml [triggers].
// Must be kept in sync with the deployed config. Each entry is used for
// computing `next_run_at` in the cron-history endpoint.
export const CRON_TRIGGERS: { name: string; expr: string }[] = [
  { name: 'scheduled', expr: '* * * * *' },
  { name: 'cleanup', expr: '0 3 * * *' },
  { name: 'mi_refresh', expr: '0 */6 * * *' },
  { name: 'mi_snapshot', expr: '0 4 * * *' },
  { name: 'daily_digest', expr: '0 9 * * *' },
  { name: 'weekly_digest', expr: '0 9 * * 1' },
];

/** Compute next run timestamp for a simple cron expression (no month-day or year). */
function nextCronRun(expr: string, from: Date = new Date()): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mStr, hStr, dStr, moStr, wdStr] = parts;
  const parseField = (s: string, min: number, max: number): number[] => {
    if (s === '*') return [];
    if (s.includes('/')) {
      const [, step] = s.split('/');
      const vals: number[] = [];
      for (let v = min; v <= max; v += parseInt(step, 10)) vals.push(v);
      return vals;
    }
    if (s.includes(',')) return s.split(',').map(v => parseInt(v, 10)).filter(Number.isFinite);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? [n] : [];
  };
  const minutes = parseField(mStr, 0, 59);
  const hours = parseField(hStr, 0, 23);
  const days = parseField(dStr, 1, 31);
  const months = parseField(moStr, 1, 12);
  const weekdays = parseField(wdStr, 0, 6);

  const d = new Date(from.getTime());
  d.setUTCSeconds(0, 0);
  for (let safety = 0; safety < 366 * 24 * 60; safety++) {
    d.setUTCMinutes(d.getUTCMinutes() + 1);
    const okMin = minutes.length === 0 || minutes.includes(d.getUTCMinutes());
    const okHour = hours.length === 0 || hours.includes(d.getUTCHours());
    const okDay = days.length === 0 || days.includes(d.getUTCDate());
    const okMonth = months.length === 0 || months.includes(d.getUTCMonth() + 1);
    const okWD = weekdays.length === 0 || weekdays.includes(d.getUTCDay());
    if (okMin && okHour && okDay && okMonth && okWD) {
      return d.toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  return null;
}

// GET /api/infra/cron-history — list recent cron run history + trigger metadata.
infra.get('/cron-history', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const limit = Math.max(1, Math.min(200, parseInt(c.req.query('limit') || '100', 10)));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
  const trigger = c.req.query('trigger') || '';

  const where = trigger ? 'WHERE trigger_name = ?' : '';
  const countStmt = `SELECT COUNT(*) AS c FROM cron_run_history ${where}`;
  const listStmt = `SELECT * FROM cron_run_history ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`;

  const count = await c.env.DB.prepare(countStmt)
    .bind(...(trigger ? [trigger] : []))
    .first<{ c: number }>();

  const rows = await c.env.DB.prepare(listStmt)
    .bind(...(trigger ? [trigger, limit, offset] : [limit, offset]))
    .all();

  // Compute last_run_at and next_run_at per trigger from the DB.
  // The DB stores the raw cron expression as trigger_name (e.g. '* * * * *'),
  // so we map by expr rather than display name.
  const lastRuns = await c.env.DB.prepare(
    `SELECT trigger_name, MAX(started_at) AS last_run_at FROM cron_run_history GROUP BY trigger_name`
  ).all<{ trigger_name: string; last_run_at: string }>();

  const lastRunMap: Record<string, string> = {};
  for (const r of (lastRuns.results || [])) lastRunMap[r.trigger_name] = r.last_run_at;

  const triggers = CRON_TRIGGERS.map(t => ({
    name: t.name,
    expr: t.expr,
    last_run_at: lastRunMap[t.expr] || null,
    next_run_at: nextCronRun(t.expr) || null,
  }));

  return c.json({
    ok: true,
    items: rows.results || [],
    total: Number(count?.c ?? 0),
    limit,
    offset,
    triggers,
  });
});

// POST /api/infra/cron-log — internal endpoint for the cron handler to record runs.
// Not a public admin surface; called from index.ts scheduled().
// Task #7 (IE) — requireAdmin so perimeter-only users cannot write synthetic audit rows.
infra.post('/cron-log', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const body = await c.req.json<{ trigger_name: string; status: string; started_at?: string; finished_at?: string; summary?: string; error?: string }>();
  if (!body?.trigger_name) return c.json({ error: 'trigger_name required' }, 400);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await c.env.DB.prepare(
    `INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status, summary, error)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.trigger_name,
    body.started_at || now,
    body.finished_at || now,
    body.status || 'completed',
    body.summary || null,
    body.error || null,
  ).run();

  return c.json({ ok: true });
});

// GET /api/infra/ws-check — real authenticated WebSocket upgrade spot-check.
// Probes both the DO internal upgrade path and the worker-facing route.
// For the route probe, we mint a synthetic admin JWT and send upgrade headers.
// The probe is fire-and-close (101 is accepted, then we immediately close).
// The real user-facing route requires ?token= or Sec-WebSocket-Protocol;
// we use the protocol header for the probe.
infra.get('/ws-check', async (c) => {
  await requireAdmin(c);
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // Mint a short-lived synthetic admin token so the probe can hit the
  // auth-protected upgrade routes. The token is never returned to the caller.
  // We use the real authenticated admin user so the downstream auth layer
  // (authenticateForUpgrade) finds a valid user row and passes the token.
  let probeToken = '';
  try {
    const admin = await requireAdmin(c);
    probeToken = await createJWT(c.env, admin.id, admin.email, 'admin');
  } catch (e: any) {
    checks.token = { ok: false, detail: `JWT mint failed: ${e?.message || e}` };
  }

  // 1. PipelineRoom DO internal upgrade probe (no user auth needed — DO
  //     trusts the worker because the DO is only accessible via the binding).
  if (c.env.PIPELINE_ROOM) {
    try {
      const id = c.env.PIPELINE_ROOM.idFromName('healthcheck');
      const stub = c.env.PIPELINE_ROOM.get(id);
      // DO count (reachability)
      const count = await stub.fetch('https://do/count');
      const countOk = count.status === 200;
      // DO upgrade probe (synthetic admin)
      const upgrade = await stub.fetch('https://do/ws', {
        headers: {
          upgrade: 'websocket',
          'x-auth-user-id': '0',
          'x-auth-role': 'admin',
        },
      });
      checks.pipeline = {
        ok: countOk && upgrade.status === 101,
        detail: `count=${count.status} upgrade=${upgrade.status}`,
      };
    } catch (e: any) {
      checks.pipeline = { ok: false, detail: e?.message || 'unreachable' };
    }
  } else {
    checks.pipeline = { ok: false, detail: 'PIPELINE_ROOM binding missing' };
  }

  // 2. OnboardingChat DO internal upgrade probe.
  if (c.env.ONBOARDING_CHAT) {
    try {
      const id = c.env.ONBOARDING_CHAT.idFromName('healthcheck');
      const stub = c.env.ONBOARDING_CHAT.get(id);
      const count = await stub.fetch('https://do/count');
      const countOk = count.status === 200;
      const upgrade = await stub.fetch('https://do/ws', {
        headers: {
          upgrade: 'websocket',
          'x-auth-user-id': '0',
          'x-auth-role': 'admin',
        },
      });
      checks.onboarding = {
        ok: countOk && upgrade.status === 101,
        detail: `count=${count.status} upgrade=${upgrade.status}`,
      };
    } catch (e: any) {
      checks.onboarding = { ok: false, detail: e?.message || 'unreachable' };
    }
  } else {
    checks.onboarding = { ok: false, detail: 'ONBOARDING_CHAT binding missing' };
  }

  // 3. Worker-facing route probes — real authenticated upgrade requests.
  // We self-request the actual Hono routes so the full auth+RBAC+rate-limit
  // pipeline is exercised. The DO layer is verified by the stub probes above.
  if (probeToken) {
    const origin = c.env.APP_URL || new URL(c.req.url).origin;

    // /api/pipeline/ws/overview — any authenticated active user may subscribe.
    try {
      const req = new Request(`${origin}/api/pipeline/ws/overview`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': `bearer.${probeToken}`,
        },
      });
      const resp = await fetch(req);
      checks.pipeline_route = {
        ok: resp.status === 101,
        detail: `handshake=${resp.status}`,
      };
    } catch (e: any) {
      checks.pipeline_route = { ok: false, detail: e?.message || 'probe-failed' };
    }

    // /api/onboarding/ws/0 — admin or self; admin JWT (user_id=0) passes.
    try {
      const req = new Request(`${origin}/api/onboarding/ws/0`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': `bearer.${probeToken}`,
        },
      });
      const resp = await fetch(req);
      checks.onboarding_route = {
        ok: resp.status === 101,
        detail: `handshake=${resp.status}`,
      };
    } catch (e: any) {
      checks.onboarding_route = { ok: false, detail: e?.message || 'probe-failed' };
    }
  } else {
    checks.pipeline_route = { ok: false, detail: 'probe skipped: no token' };
    checks.onboarding_route = { ok: false, detail: 'probe skipped: no token' };
  }

  return c.json({ ok: true, checks });
});

export default infra;
