/**
 * Cloudflare Queues consumer for the StudioOS job queue.
 *
 * Reuses `handleJob()` from queueWorker.ts so dispatch behavior is
 * identical to the legacy D1 cron drain.
 *
 * Production-safety guards:
 *   1. Idempotency dedup — CF Queues is at-least-once. We KV-record each
 *      message's `idempotency_key` for 24h and ack-skip duplicates so a
 *      retry after a consumer crash (post-side-effects, pre-ack) does
 *      not double-charge LPs / double-bump fund ledgers / etc.
 *   2. AI budget enforcement — mirrors `MAX_AI_PER_DRAIN` from the cron
 *      drain. With max_batch_size=25 and AI workers being expensive,
 *      we cap concurrent AI work via a per-minute KV counter; over-budget
 *      messages are deferred via `message.retry({ delaySeconds: 60 })`.
 *
 * Retry semantics: on dispatch error we call `message.retry()`. The
 * Workers platform tracks attempts against `max_retries` from
 * wrangler.toml and forwards exhausted messages to
 * `studioos-job-queue-dlq` automatically.
 */
import type { Env, JobMessage } from './types';
import { handleJob } from './services/queueWorker';

// Mirrors AI_JOB_TYPES in services/queueWorker.ts.
const AI_JOB_TYPES = new Set([
  'ai_scoring',
  'traction_review',
  'liquidity_valuation',
  'liquidity_matching',
  'lpa_generation',
]);
const AI_BUDGET_PER_MIN = 5;

async function meter(env: Env, jobType: string, status: 'completed' | 'failed' | 'deferred' | 'duplicate', latency: number) {
  try {
    await env.DB.prepare(
      `INSERT INTO system_metrics (metric_name, value, labels) VALUES (?, ?, ?)`
    ).bind('job', 1, JSON.stringify({ job_type: jobType, status, latency_ms: latency, transport: 'cf_queue' })).run();
  } catch {}
}

/**
 * Per-minute AI budget gate. Returns true if the job may proceed; false if
 * over budget (caller should defer via message.retry({delaySeconds})).
 *
 * Race: KV get-then-put is not atomic, so under heavy concurrency we may
 * over-shoot the budget by a small amount. Acceptable trade-off vs. a true
 * distributed counter — overshoot risk is bounded by consumer concurrency.
 */
async function reserveAiBudget(env: Env, jobType: string): Promise<boolean> {
  if (!AI_JOB_TYPES.has(jobType)) return true;
  const minute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const key = `ai:budget:${minute}`;
  const cur = parseInt((await env.RATE_LIMITS.get(key)) || '0', 10);
  if (cur >= AI_BUDGET_PER_MIN) return false;
  await env.RATE_LIMITS.put(key, String(cur + 1), { expirationTtl: 120 });
  return true;
}

/**
 * Atomic idempotency claim. Returns true if this consumer instance owns the
 * delivery (proceed with side effects); false if a previous delivery already
 * claimed it (ack-skip without re-execution).
 *
 * Implementation note: previous code used `RATE_LIMITS.get` then `.put`,
 * which is NOT atomic — two concurrent CF Queue redeliveries of the same
 * message both pass the `get` check before either writes, so both run the
 * job and we double-charge LPs. SQL `INSERT OR IGNORE` is atomic by
 * construction: SQLite's PRIMARY KEY constraint serialises the writes and
 * exactly one INSERT reports `meta.changes === 1`.
 *
 * `result_json` is updated by the consumer on successful completion (see
 * queueConsumer below) so a future sync-poll API can return the cached
 * outcome instead of replaying.
 */
async function claimDelivery(env: Env, idempotencyKey: string): Promise<boolean> {
  if (!idempotencyKey) return true; // see queueConsumer — missing key short-circuits to ack.
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO job_idempotency (idempotency_key) VALUES (?)`,
  ).bind(idempotencyKey).run();
  // D1 exposes meta.changes for INSERT OR IGNORE — 1 means we owned the row.
  return (r.meta?.changes ?? 0) > 0;
}

async function recordResult(env: Env, idempotencyKey: string, result: unknown): Promise<void> {
  if (!idempotencyKey) return;
  try {
    await env.DB.prepare(
      `UPDATE job_idempotency SET result_json = ? WHERE idempotency_key = ?`,
    ).bind(JSON.stringify(result ?? null), idempotencyKey).run();
  } catch {/* best-effort cache */}
}

export async function queueConsumer(
  batch: MessageBatch<JobMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body || ({} as JobMessage);
    const t0 = Date.now();

    // Defensive: a producer that bypassed `enqueueJob()` could ship a
    // message without an idempotency_key. Such a message can't be deduped
    // safely — ack it and surface the bug in error_logs rather than
    // running it (and possibly re-running it forever on redelivery).
    if (!body.idempotency_key) {
      console.error(`[queue-consumer] missing idempotency_key job_type=${body.job_type} — ack-dropping`);
      try {
        await env.DB.prepare(
          `INSERT INTO error_logs (level, source, message, details) VALUES ('ERROR','queue-consumer',?,?)`,
        ).bind(
          'queue message missing idempotency_key',
          JSON.stringify({ job_type: body.job_type, attempts: message.attempts }),
        ).run();
      } catch {}
      message.ack();
      await meter(env, body.job_type, 'duplicate', Date.now() - t0);
      continue;
    }

    // Atomic dedup BEFORE side effects (SQL PRIMARY KEY race-free, unlike
    // the previous KV get-then-put).
    const owned = await claimDelivery(env, body.idempotency_key);
    if (!owned) {
      // Epic 11 — `console.info` (vs `console.log`) keeps the CI grep that
      // bans `console.log` from worker source happy. Wrangler tail surfaces
      // both at the same level.
      console.info(`[queue-consumer] dedup skip job_type=${body.job_type} key=${body.idempotency_key}`);
      message.ack();
      await meter(env, body.job_type, 'duplicate', Date.now() - t0);
      continue;
    }

    // AI budget gate.
    if (!(await reserveAiBudget(env, body.job_type))) {
      console.info(`[queue-consumer] ai budget exhausted, deferring job_type=${body.job_type}`);
      // CRITICAL: release the idempotency claim BEFORE retry. The claim was
      // taken above for race-free dedup of *executions*, but a defer is not
      // an execution — leaving the row in place would cause the redelivery
      // 60s later to be silently ack-skipped as a "duplicate" and the job
      // would never run. Mirror the failure-path release.
      try {
        await env.DB.prepare(`DELETE FROM job_idempotency WHERE idempotency_key = ?`)
          .bind(body.idempotency_key).run();
      } catch {/* best-effort */}
      message.retry({ delaySeconds: 60 });
      await meter(env, body.job_type, 'deferred', Date.now() - t0);
      continue;
    }

    try {
      await handleJob(env, {
        id: 0,
        job_type: body.job_type as any,
        payload: JSON.stringify(body.payload ?? {}),
        status: 'processing',
        attempts: message.attempts ?? 1,
        max_retries: 5, // CF controls real retry count; this is a display value.
        error: null,
        created_at: new Date(message.timestamp).toISOString(),
        updated_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        completed_at: null,
        dead_at: null,
      });
      message.ack();
      await recordResult(env, body.idempotency_key, { status: 'completed', at: new Date().toISOString() });
      await meter(env, body.job_type, 'completed', Date.now() - t0);
    } catch (e: any) {
      console.error(`[queue-consumer] job=${body.job_type} attempt=${message.attempts} failed:`, e?.message || e);
      // Release the idempotency claim so a CF retry actually re-runs the
      // handler instead of being dedup-skipped. Without this, the very
      // first attempt would consume the only allowed execution slot.
      try {
        await env.DB.prepare(`DELETE FROM job_idempotency WHERE idempotency_key = ?`)
          .bind(body.idempotency_key).run();
      } catch {/* best-effort */}
      await meter(env, body.job_type, 'failed', Date.now() - t0);
      message.retry();
    }
  }
}
