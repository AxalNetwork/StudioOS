/**
 * D684 — the slow work behind a channel, off the webhook's request.
 *
 * A webhook answers its provider within seconds; transcribing a voice note or
 * downloading a meeting transcript cannot. Two queue job types carry that work:
 *   channel_followup  a messaging provider's deferred step (a voice note to
 *                     fetch and transcribe, a reply to retry)
 *   meeting_import    a Zoom or Meet transcript to download and import
 * Each adapter registers its handler here at module load (its route module is
 * imported by `index.ts`, so registration precedes any queue delivery), and
 * `queueWorker.ts` dispatches by job type and the payload's `provider`. A job
 * whose provider registered nothing fails loudly rather than vanishing.
 *
 * Sweeps are the same idea for the cron: a provider that must poll (Google
 * Meet's transcripts have no webhook) registers one, and the every-five-minutes
 * tick runs them.
 */
import type { Env } from '../../types';
import { enqueueJob } from '../queue';
import type { ChannelProvider } from './types';

export type ChannelJobName = 'channel_followup' | 'meeting_import';
export type ChannelJobPayload = { provider: ChannelProvider } & Record<string, unknown>;
type JobHandler = (env: Env, payload: ChannelJobPayload) => Promise<void>;
type Sweep = (env: Env, now: Date) => Promise<void>;

const HANDLERS = new Map<string, JobHandler>();
const SWEEPS = new Map<ChannelProvider, Sweep>();

export function registerChannelJob(name: ChannelJobName, provider: ChannelProvider, handler: JobHandler): void {
  HANDLERS.set(`${name}:${provider}`, handler);
}

export function registerChannelSweep(provider: ChannelProvider, sweep: Sweep): void {
  SWEEPS.set(provider, sweep);
}

/**
 * Queue a channel job. `key` is the provider's own id for the work (an event
 * id, a meeting id) and travels as the job's idempotency key. What stops a
 * redelivered webhook queuing the work twice is its claim (`events.ts`), taken
 * before this is called; a handler must still be safe to run twice.
 */
export function enqueueChannelJob(
  env: Env, name: ChannelJobName, provider: ChannelProvider, key: string, payload: Record<string, unknown>,
  opts: { delaySeconds?: number } = {},
) {
  return enqueueJob(env, name, { ...payload, provider }, {
    idempotency_key: `${provider}:${name}:${key}`,
    ...(opts.delaySeconds ? { delay_seconds: opts.delaySeconds } : {}),
  });
}

export async function runChannelJob(env: Env, name: ChannelJobName, payload: unknown): Promise<void> {
  const p = (payload ?? {}) as ChannelJobPayload;
  const handler = HANDLERS.get(`${name}:${String(p.provider)}`);
  if (!handler) throw new Error(`no ${name} handler for provider ${String(p.provider)}`);
  await handler(env, p);
}

/** Every registered sweep, each in its own try: one provider failing never stops another. */
export async function runChannelSweeps(env: Env, now: Date): Promise<string[]> {
  const failed: string[] = [];
  for (const [provider, sweep] of SWEEPS) {
    try {
      await sweep(env, now);
    } catch (e) {
      failed.push(provider);
      console.error('[cron] channel sweep failed provider=%s', provider, e instanceof Error ? e.message : 'error');
    }
  }
  return failed;
}
