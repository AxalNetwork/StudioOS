/**
 * Admin-only infrastructure routes — queue inspection, metrics, manual trigger.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
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
// Query params: job_type, limit (max 200), offset.
infra.get('/dlq', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const jobType = c.req.query('job_type') || '';
  const limit = Math.max(1, Math.min(200, parseInt(c.req.query('limit') || '50', 10)));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));

  const where = jobType ? 'WHERE job_type = ?' : '';
  const countStmt = `SELECT COUNT(*) AS c FROM dead_letter_queue ${where}`;
  const listStmt = `SELECT * FROM dead_letter_queue ${where} ORDER BY moved_at DESC LIMIT ? OFFSET ?`;

  const count = await c.env.DB.prepare(countStmt)
    .bind(...(jobType ? [jobType] : []))
    .first<{ c: number }>();

  const rows = await c.env.DB.prepare(listStmt)
    .bind(...(jobType ? [jobType, limit, offset] : [limit, offset]))
    .all();

  return c.json({
    ok: true,
    items: rows.results || [],
    total: Number(count?.c ?? 0),
    limit,
    offset,
  });
});

// POST /api/infra/dlq/:id/retry — re-enqueue a dead-letter job and remove it from DLQ.
infra.post('/dlq/:id/retry', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT job_type, payload, last_error, attempts FROM dead_letter_queue WHERE id = ?`
  ).bind(id).first<{ job_type: string; payload: string | null; last_error: string | null; attempts: number }>();
  if (!row) return c.json({ error: 'DLQ item not found' }, 404);

  // Re-enqueue with a fresh idempotency key so the dedup layer won't
  // silently skip it if the original key is still in job_idempotency.
  const payload = row.payload ? JSON.parse(row.payload) : {};
  const result = await enqueueJob(c.env, row.job_type as JobType, payload, {
    idempotency_key: `dlq-retry-${id}-${crypto.randomUUID()}`,
  });

  // Remove from DLQ after successful enqueue.
  await c.env.DB.prepare(`DELETE FROM dead_letter_queue WHERE id = ?`).bind(id).run();

  return c.json({ ok: true, requeued: true, transport: result.transport, idempotency_key: result.idempotency_key });
});

// DELETE /api/infra/dlq/:id — discard a dead-letter entry (admin only).
infra.delete('/dlq/:id', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const r = await c.env.DB.prepare(`DELETE FROM dead_letter_queue WHERE id = ?`).bind(id).run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'DLQ item not found' }, 404);

  return c.json({ ok: true, deleted: true });
});

// GET /api/infra/cron-history — list recent cron run history.
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

  return c.json({
    ok: true,
    items: rows.results || [],
    total: Number(count?.c ?? 0),
    limit,
    offset,
  });
});

// POST /api/infra/cron-log — internal endpoint for the cron handler to record runs.
// Not a public admin surface; called from index.ts scheduled().
infra.post('/cron-log', async (c) => {
  await ensureInfraSchema(c.env);
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

// GET /api/infra/ws-check — lightweight WS connectivity spot-check.
// Verifies that the Durable Object bindings are reachable and returns a
// synthetic "can-upgrade" status without opening an actual socket.
infra.get('/ws-check', async (c) => {
  await requireAdmin(c);
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // PipelineRoom binding check
  if (c.env.PIPELINE_ROOM) {
    try {
      const id = c.env.PIPELINE_ROOM.idFromName('healthcheck');
      const stub = c.env.PIPELINE_ROOM.get(id);
      const r = await stub.fetch('https://do/count');
      checks.pipeline = { ok: r.status === 200, detail: r.status === 200 ? 'reachable' : `status ${r.status}` };
    } catch (e: any) {
      checks.pipeline = { ok: false, detail: e?.message || 'unreachable' };
    }
  } else {
    checks.pipeline = { ok: false, detail: 'PIPELINE_ROOM binding missing' };
  }

  // OnboardingChat binding check
  if (c.env.ONBOARDING_CHAT) {
    try {
      const id = c.env.ONBOARDING_CHAT.idFromName('healthcheck');
      const stub = c.env.ONBOARDING_CHAT.get(id);
      const r = await stub.fetch('https://do/count');
      checks.onboarding = { ok: r.status === 200, detail: r.status === 200 ? 'reachable' : `status ${r.status}` };
    } catch (e: any) {
      checks.onboarding = { ok: false, detail: e?.message || 'unreachable' };
    }
  } else {
    checks.onboarding = { ok: false, detail: 'ONBOARDING_CHAT binding missing' };
  }

  return c.json({ ok: true, checks });
});

export default infra;
