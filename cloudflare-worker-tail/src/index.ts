/**
 * StudioOS Tail Consumer Worker
 *
 * Receives tail events from the main `studioos` worker (configured as the
 * tail producer) and persists them to R2 (`studioos-logs`) as newline-
 * delimited JSON. One R2 object per batch keyed by
 *   {YYYY/MM/DD/HH}/{batch_uuid}.ndjson
 * which keeps prefix-list operations cheap and aligns with downstream
 * parquet conversion jobs.
 *
 * Tail event shape (per Cloudflare docs):
 *   {
 *     scriptName, outcome, eventTimestamp, exceptions[], logs[],
 *     event: { request?, scheduledTime?, ... }
 *   }
 *
 * We add `_received_at` (ISO) so downstream consumers can detect ingest lag
 * separately from `eventTimestamp` (the time the producer's request started).
 *
 * No PII filtering is done here — the producing worker is expected to scrub
 * sensitive fields before logging. Adding scrubbing here would be defense-
 * in-depth but also creates a foot-gun (silent log loss). Instead we rely on
 * the upstream `redactSensitive` helpers in middleware/observability.ts.
 */

interface Env {
  LOGS: R2Bucket;
  RETENTION_DAYS?: string;
  ENVIRONMENT?: string;
}

// `TailEvent` is not exported from @cloudflare/workers-types in the
// version pinned by the main worker; declare a structural type locally
// rather than pulling a separate dep into this tiny worker.
type TailEvent = {
  scriptName?: string;
  outcome?: string;
  eventTimestamp?: number;
  exceptions?: Array<{ name?: string; message?: string; timestamp?: number }>;
  logs?: Array<{ level?: string; message?: unknown[]; timestamp?: number }>;
  event?: unknown;
  diagnosticsChannelEvents?: unknown[];
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function r2KeyForBatch(now: Date, batchId: string): string {
  return (
    `${now.getUTCFullYear()}/` +
    `${pad(now.getUTCMonth() + 1)}/` +
    `${pad(now.getUTCDate())}/` +
    `${pad(now.getUTCHours())}/` +
    `${batchId}.ndjson`
  );
}

export default {
  async tail(events: TailEvent[], env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!events || events.length === 0) return;
    const now = new Date();
    const receivedAt = now.toISOString();
    const batchId = crypto.randomUUID();

    const lines: string[] = [];
    for (const ev of events) {
      // Best-effort serialization — bail per-event rather than failing the
      // entire batch if one line has a circular reference (shouldn't happen
      // since the runtime already pre-serializes tail events, but defensive).
      try {
        lines.push(JSON.stringify({ ...ev, _received_at: receivedAt }));
      } catch (e) {
        lines.push(
          JSON.stringify({
            _received_at: receivedAt,
            _serialization_error: (e as Error)?.message || 'unknown',
            scriptName: ev?.scriptName,
            outcome: ev?.outcome,
            eventTimestamp: ev?.eventTimestamp,
          }),
        );
      }
    }
    const body = lines.join('\n') + '\n';
    const key = r2KeyForBatch(now, batchId);

    try {
      await env.LOGS.put(key, body, {
        httpMetadata: { contentType: 'application/x-ndjson' },
        customMetadata: {
          batch_size: String(events.length),
          retention_days: env.RETENTION_DAYS || '2555',
          environment: env.ENVIRONMENT || 'production',
        },
      });
    } catch (e) {
      // Surface the failure in tail-of-the-tail so it's visible in
      // Cloudflare's own observability dashboard. We deliberately don't
      // re-throw — Cloudflare doesn't retry tail handlers, so a throw
      // would just lose the batch silently anyway.
      console.error('[studioos-tail] R2 put failed', {
        key,
        error: (e as Error)?.message,
        batch_size: events.length,
      });
    }
  },
};
