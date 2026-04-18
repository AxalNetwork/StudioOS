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
  const body = await c.req.json<{ job_type: JobType; payload?: any; max_retries?: number }>();
  if (!body?.job_type) return c.json({ error: 'job_type required' }, 400);
  const result = await enqueueJob(c.env, body.job_type, body.payload ?? {}, { max_retries: body.max_retries });
  return c.json({ ok: true, job: result.job, transport: result.transport });
});

// POST /api/infra/cleanup — purge old completed/failed jobs (>7 days) and old DLQ (>30 days)
infra.post('/cleanup', async (c) => {
  await requireAdmin(c);
  await Jobs.cleanup(c.env);
  return c.json({ ok: true });
});

// GET /api/infra/dlq — dead letter inspection
infra.get('/dlq', async (c) => {
  await ensureInfraSchema(c.env);
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM dead_letter_queue ORDER BY moved_at DESC LIMIT 100`
  ).all();
  return c.json({ ok: true, items: rows.results || [] });
});

export default infra;
