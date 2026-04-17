/**
 * Admin-only infrastructure routes — queue inspection, metrics, manual trigger.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { Jobs, JobType } from '../models/jobs';
import { processQueueBatch } from '../services/queueWorker';

const infra = new Hono<{ Bindings: Env }>();

// GET /api/infra/queue — admin queue dashboard
infra.get('/queue', async (c) => {
  await requireAdmin(c);
  const stats = await Jobs.stats(c.env);
  return c.json({ ok: true, ...stats });
});

// GET /api/infra/metrics — high-throughput stats
infra.get('/metrics', async (c) => {
  await requireAdmin(c);
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
  const job = await Jobs.enqueue(c.env, body.job_type, body.payload ?? {}, { max_retries: body.max_retries });
  return c.json({ ok: true, job });
});

// POST /api/infra/cleanup — purge old completed/failed jobs (>7 days) and old DLQ (>30 days)
infra.post('/cleanup', async (c) => {
  await requireAdmin(c);
  await Jobs.cleanup(c.env);
  return c.json({ ok: true });
});

// GET /api/infra/dlq — dead letter inspection
infra.get('/dlq', async (c) => {
  await requireAdmin(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM dead_letter_queue ORDER BY moved_at DESC LIMIT 100`
  ).all();
  return c.json({ ok: true, items: rows.results || [] });
});

export default infra;
