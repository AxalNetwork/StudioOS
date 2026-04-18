/**
 * Typed producer for the StudioOS job queue.
 *
 * Behavior is controlled by the USE_CF_QUEUE feature flag in wrangler.toml:
 *   - "true" + JOB_QUEUE binding present → enqueue onto the native CF Queue.
 *   - else                               → enqueue into the legacy D1 queue.
 *
 * Each enqueue gets an `idempotency_key` (UUID) embedded in the message
 * body. The consumer uses it to dedupe redeliveries (CF Queues guarantees
 * at-least-once delivery, so the same message can land twice — e.g. a
 * consumer crash after side effects but before ack).
 *
 * Retry/DLQ semantics on CF transport are governed by wrangler.toml's
 * [[queues.consumers]] block (max_retries=5, dead_letter_queue=...).
 * The legacy `max_retries` option is honored on the D1 path only and
 * documented as such in the EnqueueOptions type.
 *
 * Failure policy: if env.JOB_QUEUE.send() throws we re-throw rather than
 * silently falling back to D1, because dual-writes (CF accepts but client
 * times out, then we also insert into D1) would cause duplicate execution
 * across two transports — most job handlers are NOT idempotent on the
 * D1-table side. Callers can decide to retry the producer call.
 */
import type { Env, JobMessage } from '../types';
import { Jobs, JobType, QueueJob } from '../models/jobs';

export interface EnqueueOptions {
  /** Honored on D1 transport only. CF retry count is set in wrangler.toml. */
  max_retries?: number;
  /** Per-message delay in seconds (CF transport only; D1 enqueues run on next cron tick). */
  delay_seconds?: number;
  /** Optional caller-provided dedupe key. If omitted we generate a UUID. */
  idempotency_key?: string;
}

export interface EnqueueResult {
  transport: 'cf_queue' | 'd1';
  /** D1 row when transport=='d1'; null for cf_queue (CF .send() returns no id). */
  job: QueueJob | null;
  idempotency_key: string;
}

function cfQueueEnabled(env: Env): boolean {
  return env.USE_CF_QUEUE === 'true' && !!env.JOB_QUEUE;
}

export async function enqueueJob(
  env: Env,
  jobType: JobType,
  payload: any,
  opts?: EnqueueOptions,
): Promise<EnqueueResult> {
  const idempotency_key = opts?.idempotency_key ?? crypto.randomUUID();

  if (cfQueueEnabled(env)) {
    const body: JobMessage = {
      job_type: jobType,
      payload: payload ?? {},
      idempotency_key,
    };
    // No fallback to D1 on send failure — see file header for rationale.
    await env.JOB_QUEUE!.send(
      body,
      opts?.delay_seconds ? { delaySeconds: opts.delay_seconds } : undefined,
    );
    return { transport: 'cf_queue', job: null, idempotency_key };
  }

  const job = await Jobs.enqueue(env, jobType, payload, { max_retries: opts?.max_retries });
  return { transport: 'd1', job, idempotency_key };
}
