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
 * Idempotency check. Returns true if this message has already been
 * processed (ack-skip it); false if it's the first sighting (record and
 * proceed). 24h TTL handles realistic redelivery windows.
 */
async function alreadyProcessed(env: Env, idempotencyKey: string): Promise<boolean> {
  if (!idempotencyKey) return false;
  const k = `job:idem:${idempotencyKey}`;
  const seen = await env.RATE_LIMITS.get(k);
  if (seen) return true;
  await env.RATE_LIMITS.put(k, '1', { expirationTtl: 86400 });
  return false;
}

export async function queueConsumer(
  batch: MessageBatch<JobMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body || ({} as JobMessage);
    const t0 = Date.now();

    // Dedup BEFORE side effects.
    if (await alreadyProcessed(env, body.idempotency_key)) {
      console.log(`[queue-consumer] dedup skip job_type=${body.job_type} key=${body.idempotency_key}`);
      message.ack();
      await meter(env, body.job_type, 'duplicate', Date.now() - t0);
      continue;
    }

    // AI budget gate.
    if (!(await reserveAiBudget(env, body.job_type))) {
      console.log(`[queue-consumer] ai budget exhausted, deferring job_type=${body.job_type}`);
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
      await meter(env, body.job_type, 'completed', Date.now() - t0);
    } catch (e: any) {
      console.error(`[queue-consumer] job=${body.job_type} attempt=${message.attempts} failed:`, e?.message || e);
      await meter(env, body.job_type, 'failed', Date.now() - t0);
      message.retry();
    }
  }
}
