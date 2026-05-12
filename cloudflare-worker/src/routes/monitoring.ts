import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin } from '../auth';
import type { ScoreSnapshotRow, AnomalyFlag } from '../services/scoreIntegrity';
import analytics from './monitoring_analytics';
import { loadAiUsageReport } from '../services/aiRouter';

const monitoring = new Hono<{ Bindings: Env }>();

// Task #3 — admin analytics sub-router (5 sub-tabs + export).
monitoring.route('/analytics', analytics);

// Task #1 (AX) — Multi-model AI router observability.
// Per-day spend per task class with model / latency / safety / fallback
// breakdown + top-10 most expensive users (last 7 days). Driven by the
// `ai_usage_logs` D1 table that aiRouter.ts writes on every call.
monitoring.get('/ai-usage', async (c) => {
  await requireAdmin(c);
  const days = Math.max(1, Math.min(90, parseInt(c.req.query('days') || '7', 10) || 7));
  try {
    const report = await loadAiUsageReport(c.env, days);
    return c.json(report);
  } catch (e) {
    return c.json({ error: (e as Error).message || 'failed to load ai usage' }, 500);
  }
});

// ---------- /metrics ----------
// Admin-only: returns aggregated time-series for the dashboard.
// Clamp helpers — protect D1 from runaway scans
const clampMinutes = (raw: string | undefined) => Math.max(5, Math.min(1440, parseInt(raw || '60', 10) || 60));
const clampLimit = (raw: string | undefined, max = 200) => Math.max(1, Math.min(max, parseInt(raw || '50', 10) || 50));

monitoring.get('/metrics', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const minutes = clampMinutes(c.req.query('minutes'));
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  // Bucket request rows into 1-minute buckets
  const rpm = await sql`
    SELECT strftime('%Y-%m-%d %H:%M:00', timestamp) AS bucket,
           COUNT(*) AS count,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) = 429 THEN 1 ELSE 0 END) AS rate_limited
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const aiCalls = await sql`
    SELECT strftime('%Y-%m-%d %H:%M:00', timestamp) AS bucket, COUNT(*) AS count
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${since}
      AND (json_extract(labels, '$.endpoint') LIKE '/api/scoring/%'
        OR json_extract(labels, '$.endpoint') LIKE '/api/matches/%'
        OR json_extract(labels, '$.endpoint') LIKE '/api/advisory/%')
    GROUP BY bucket ORDER BY bucket ASC
  `;

  const spinouts = await sql`
    SELECT strftime('%Y-%m-%d %H:%M:00', created_at) AS bucket, COUNT(*) AS count
    FROM activity_logs
    WHERE action LIKE 'spinout_%' AND created_at >= ${since}
    GROUP BY bucket ORDER BY bucket ASC
  `;

  const topEndpoints = await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint,
           COUNT(*) AS hits,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${since}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 10
  `;

  // System-health rollup
  const lastHour = await sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors_5xx,
      SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) = 429 THEN 1 ELSE 0 END) AS rate_limited,
      AVG(json_extract(labels, '$.latency_ms')) AS avg_latency
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${since}
  `;
  const h = lastHour[0] || { total: 0, errors_5xx: 0, rate_limited: 0, avg_latency: 0 };
  const total = Number(h.total) || 0;
  const errors = Number(h.errors_5xx) || 0;
  const errorRate = total > 0 ? (errors / total) * 100 : 0;
  const avgLatency = Number(h.avg_latency) || 0;
  let health: 'green' | 'yellow' | 'red' = 'green';
  if (errorRate > 5 || avgLatency > 2000) health = 'red';
  else if (errorRate > 1 || avgLatency > 800) health = 'yellow';

  await sql.end();
  return c.json({
    window_minutes: minutes,
    health,
    summary: {
      total_requests: total,
      errors_5xx: errors,
      rate_limited: Number(h.rate_limited) || 0,
      avg_latency_ms: Math.round(avgLatency),
      error_rate_pct: Number(errorRate.toFixed(2)),
    },
    requests_per_minute: rpm,
    ai_calls_per_minute: aiCalls,
    spinouts_per_minute: spinouts,
    top_endpoints: topEndpoints,
  });
});

// ---------- /rate-limits ----------
monitoring.get('/rate-limits', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const minutes = clampMinutes(c.req.query('minutes'));
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const blocked = await sql`
    SELECT rl.id, rl.user_id, rl.endpoint, rl.requests_in_window, rl.bucket, rl.created_at,
           u.email, u.name, u.role
    FROM rate_limit_logs rl
    LEFT JOIN users u ON u.id = rl.user_id
    WHERE rl.blocked = 1 AND rl.created_at >= ${since}
    ORDER BY rl.created_at DESC LIMIT 200
  `;
  const heatmap = await sql`
    SELECT endpoint, bucket, COUNT(*) AS blocks
    FROM rate_limit_logs
    WHERE blocked = 1 AND created_at >= ${since}
    GROUP BY endpoint, bucket
    ORDER BY blocks DESC LIMIT 50
  `;
  const byUser = await sql`
    SELECT user_id, COUNT(*) AS blocks
    FROM rate_limit_logs
    WHERE blocked = 1 AND created_at >= ${since}
    GROUP BY user_id
    ORDER BY blocks DESC LIMIT 20
  `;
  await sql.end();
  return c.json({ window_minutes: minutes, blocked, heatmap, by_user: byUser });
});

// ---------- /errors ----------
monitoring.get('/errors', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const limit = clampLimit(c.req.query('limit'));
  const rows = await sql`
    SELECT e.*, u.email, u.name
    FROM error_logs e LEFT JOIN users u ON u.id = e.user_id
    ORDER BY e.created_at DESC LIMIT ${limit}
  `;
  await sql.end();
  return c.json({ errors: rows });
});

// ---------- /anomalies ----------
// Replit AI-powered summary of the last hour's metrics.
monitoring.get('/anomalies', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const prevSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const lastHour = await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint,
           COUNT(*) AS hits,
           AVG(json_extract(labels, '$.latency_ms')) AS avg_latency,
           SUM(CASE WHEN CAST(json_extract(labels, '$.status') AS INTEGER) >= 500 THEN 1 ELSE 0 END) AS errors
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${since}
    GROUP BY endpoint ORDER BY hits DESC LIMIT 10
  `;
  const last24 = await sql`
    SELECT json_extract(labels, '$.endpoint') AS endpoint, COUNT(*) AS hits
    FROM system_metrics
    WHERE metric_name = 'request' AND timestamp >= ${prevSince}
    GROUP BY endpoint
  `;
  const blockedCount = await sql`
    SELECT COUNT(*) AS c FROM rate_limit_logs WHERE blocked = 1 AND created_at >= ${since}
  `;
  const errCount = await sql`SELECT COUNT(*) AS c FROM error_logs WHERE created_at >= ${since}`;
  await sql.end();

  const totals24 = new Map<string, number>();
  for (const r of last24) totals24.set(String(r.endpoint), Number(r.hits));

  const anomalies: { endpoint: string; type: string; detail: string }[] = [];
  for (const r of lastHour) {
    const ep = String(r.endpoint);
    const hits = Number(r.hits);
    const baseline = (totals24.get(ep) || 0) / 24;  // avg per hour over last 24h
    if (baseline > 0 && hits > baseline * 3 && hits >= 30) {
      anomalies.push({ endpoint: ep, type: 'spike', detail: `${hits} hits in last hour vs avg ${baseline.toFixed(1)}/hr` });
    }
    if (Number(r.avg_latency) > 1500) {
      anomalies.push({ endpoint: ep, type: 'slow', detail: `Avg latency ${Math.round(Number(r.avg_latency))}ms` });
    }
    if (Number(r.errors) > 5) {
      anomalies.push({ endpoint: ep, type: 'errors', detail: `${r.errors} 5xx errors` });
    }
  }

  // AI summary (Workers AI). Falls back to heuristic text if AI is unavailable.
  let aiSummary = '';
  try {
    if (c.env.AI) {
      const prompt = `You are a site-reliability engineer. Summarise the following metrics from the last hour in 2-3 short bullet points. Be concrete, mention numbers, and flag anything unusual.

Top endpoints (last hour):
${lastHour.map((r: any) => `- ${r.endpoint}: ${r.hits} hits, avg ${Math.round(Number(r.avg_latency) || 0)}ms, ${r.errors} errors`).join('\n')}

Rate-limit blocks: ${blockedCount[0]?.c ?? 0}
5xx errors: ${errCount[0]?.c ?? 0}

Detected anomalies: ${anomalies.length === 0 ? 'none' : anomalies.map(a => `${a.endpoint} (${a.type})`).join(', ')}`;
      const r: any = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You write short, factual SRE alert summaries.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 250,
      });
      aiSummary = (r?.response || r?.result?.response || '').trim();
    }
  } catch (e) {
    aiSummary = '';
  }
  if (!aiSummary) {
    aiSummary = anomalies.length === 0
      ? 'System nominal. No anomalies detected in the last hour.'
      : `Detected ${anomalies.length} potential issue(s): ${anomalies.slice(0, 3).map(a => `${a.endpoint} (${a.type})`).join('; ')}.`;
  }

  return c.json({
    generated_at: new Date().toISOString(),
    window_minutes: 60,
    rate_limit_blocks: Number(blockedCount[0]?.c ?? 0),
    errors_5xx: Number(errCount[0]?.c ?? 0),
    anomalies,
    ai_summary: aiSummary,
  });
});

// ---------- /throughput (operator-visible limited stats) ----------
monitoring.get('/throughput', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin' && user.role !== 'partner' && user.role !== 'investor') {
    return c.json({ detail: 'Forbidden' }, 403);
  }
  const sql = getSQL(c.env);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const total = await sql`SELECT COUNT(*) AS c FROM system_metrics WHERE metric_name='request' AND timestamp >= ${since}`;
  const spinouts = await sql`SELECT COUNT(*) AS c FROM activity_logs WHERE action LIKE 'spinout_%' AND created_at >= ${since}`;
  await sql.end();
  return c.json({
    window_minutes: 60,
    requests: Number(total[0]?.c ?? 0),
    spinouts_completed: Number(spinouts[0]?.c ?? 0),
  });
});

// ---------- /score-flags (Epic 5 — admin sign-off queue) ----------
// Lists snapshots that anomaly detection flagged + any rows whose stored
// hash does not match what the integrity service recomputes. Admin reviews
// each one in MonitoringPage and either approves (visible to LPs) or
// rejects (hidden permanently + project status reverted).
monitoring.get('/score-flags', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const status = c.req.query('status') || 'flagged';
  const limit = clampLimit(c.req.query('limit'), 100);

  const rows = await sql`
    SELECT s.id, s.project_id, p.name AS project_name, p.status AS project_status,
           s.total_score, s.tier, s.is_sandbox,
           s.integrity_hash, s.integrity_version,
           s.anomaly_flags, s.admin_review_status, s.admin_review_notes,
           s.admin_reviewed_by, s.admin_reviewed_at,
           s.inputs_json, s.created_at, s.locked_until
    FROM score_snapshots s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.admin_review_status = ${status}
      AND s.is_sandbox = 0
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `;

  // Re-verify each hash on the way out so the queue surfaces silent tampering
  // (row whose `admin_review_status` is still `auto_approved` but whose hash
  // no longer matches — i.e. somebody hand-edited the DB after the fact).
  const { verifyScoreHash } = await import('../services/scoreIntegrity');
  type ScoreFlagRow = ScoreSnapshotRow & {
    project_name: string | null;
    project_status: string | null;
    inputs_json: string | null;
    anomaly_flags: string | null;
    admin_review_notes: string | null;
    admin_reviewed_by: number | null;
    admin_reviewed_at: string | null;
    locked_until: string | null;
  };
  type EnrichedFlag = Omit<ScoreFlagRow, 'anomaly_flags'> & {
    integrity_valid: boolean;
    integrity_reason: string | null;
    anomaly_flags: AnomalyFlag[];
  };
  const enriched: EnrichedFlag[] = [];
  for (const raw of rows) {
    const r = raw as ScoreFlagRow;
    const v: { valid: boolean; reason?: string } = r.integrity_hash
      ? await verifyScoreHash(c.env, r)
      : { valid: false, reason: 'missing_hash' };
    let flags: AnomalyFlag[] = [];
    try {
      const parsed = r.anomaly_flags ? JSON.parse(r.anomaly_flags) : [];
      if (Array.isArray(parsed)) flags = parsed as AnomalyFlag[];
    } catch { /* malformed json — surface as no flags but keep the row visible */ }
    enriched.push({ ...r, integrity_valid: v.valid, integrity_reason: v.valid ? null : (v.reason ?? null), anomaly_flags: flags });
  }
  await sql.end();
  return c.json({ items: enriched, count: enriched.length, status });
});

// POST /score-flags/:id/review — admin approves or rejects a flagged snapshot.
// Approving makes it visible to LPs/partners; rejecting blocks it forever
// and restores the project's previous tier so an LP never sees ghost numbers.
monitoring.post('/score-flags/:id/review', async (c) => {
  const admin = await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  let body: any = {};
  try { body = await c.req.json(); } catch { /* allow empty body for default approve */ }
  const decision: string = (body.decision || '').toLowerCase();
  if (decision !== 'approve' && decision !== 'reject') {
    return c.json({ error: "decision must be 'approve' or 'reject'" }, 400);
  }
  const notes: string | null = (body.notes && String(body.notes).slice(0, 2000)) || null;

  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM score_snapshots WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Snapshot not found' }, 404); }
  const snap = rows[0];

  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await sql`
    UPDATE score_snapshots
       SET admin_review_status = ${newStatus},
           admin_review_notes  = ${notes},
           admin_reviewed_by   = ${admin.id},
           admin_reviewed_at   = ${now}
     WHERE id = ${id}
  `;

  // Re-derive project status from the approved score (or revert on reject so
  // a flagged TIER_1 doesn't linger after admin says no).
  if (decision === 'approve') {
    const newProjectStatus = Number(snap.total_score) >= 85 ? 'tier_1'
                           : Number(snap.total_score) >= 70 ? 'tier_2'
                           : 'rejected';
    await sql`UPDATE projects SET status = ${newProjectStatus}, updated_at = CURRENT_TIMESTAMP WHERE id = ${snap.project_id}`;
  } else {
    // Roll the project back to 'scoring' so it shows in the queue, not as TIER_x.
    await sql`UPDATE projects SET status = 'scoring', updated_at = CURRENT_TIMESTAMP WHERE id = ${snap.project_id}`;
  }

  await sql`
    INSERT INTO activity_logs (project_id, user_id, action, details, actor)
    VALUES (${snap.project_id}, ${admin.id}, ${'score_review_' + decision},
            ${JSON.stringify({ snapshot_id: id, notes, prior_status: snap.admin_review_status })},
            'admin')
  `;
  await sql.end();
  return c.json({ ok: true, snapshot_id: id, admin_review_status: newStatus });
});

// POST /score-flags/:id/waiver — admin grants a one-off cooldown override
// for a project, so a founder can re-run the official score before the 7-day
// lock expires. Used when a genuine intake correction needs immediate rescore.
monitoring.post('/score-flags/:id/waiver', async (c) => {
  const admin = await requireAdmin(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT project_id FROM score_snapshots WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Snapshot not found' }, 404); }
  await sql`UPDATE score_snapshots SET locked_until = NULL WHERE id = ${id}`;
  await sql`
    INSERT INTO activity_logs (project_id, user_id, action, details, actor)
    VALUES (${rows[0].project_id}, ${admin.id}, 'score_cooldown_waived',
            ${JSON.stringify({ snapshot_id: id })}, 'admin')
  `;
  await sql.end();
  return c.json({ ok: true });
});

// ---------- /cleanup (manual; safe to call by admin or cron) ----------
monitoring.post('/cleanup', async (c) => {
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const r1 = await sql`DELETE FROM system_metrics WHERE timestamp < ${cutoff}`;
  const r2 = await sql`DELETE FROM rate_limit_logs WHERE created_at < ${cutoff}`;
  const r3 = await sql`DELETE FROM error_logs WHERE created_at < ${cutoff}`;
  await sql.end();
  return c.json({ purged: { system_metrics: r1, rate_limit_logs: r2, error_logs: r3 }, cutoff });
});

export default monitoring;
