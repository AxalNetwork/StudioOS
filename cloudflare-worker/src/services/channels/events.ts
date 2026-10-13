/**
 * D684 — every webhook event once.
 *
 * `claimEvent` is the idempotency boundary for all four providers: an
 * `INSERT OR IGNORE` on UNIQUE(provider, external_event_id). The first delivery
 * gets the row id and does the work; a retry gets null and must answer 200 and
 * do nothing. If the work fails BEFORE anything was stored, `releaseEvent`
 * deletes the claim so the provider's retry processes it again (the GitHub
 * receiver's claim-then-release, `services/githubSync.ts`). Rows carry a
 * hashed id, kind and outcome — never message text.
 *
 * Provider ids are stored as `refKey` hashes, here and wherever a message id is
 * kept (`outbound.ts`, `threads.ts`): a WhatsApp wamid carries the customer's
 * number in base64, and equality is all any of these lookups need.
 */
import type { Env } from '../../types';
import { sha256Hex } from '../../rpc/secret';
import { CHANNEL_LIMITS, type ChannelProvider } from './types';

/** The stored form of a provider's event or message id: a SHA-256, never the id itself. */
export function refKey(provider: ChannelProvider, externalId: string): Promise<string> {
  return sha256Hex(`${provider}:${String(externalId ?? '').slice(0, 200)}`);
}

export type EventKind =
  | 'message' | 'voice' | 'echo' | 'edit' | 'delete' | 'command' | 'link' | 'connection'
  | 'status' | 'meeting' | 'transcript' | 'ignored';
export type EventStatus = 'accepted' | 'stored' | 'done' | 'ignored' | 'failed';

/** The new claim's id, or null when this event was already claimed. */
export async function claimEvent(env: Env, provider: ChannelProvider, externalEventId: string, kind: EventKind): Promise<number | null> {
  if (!String(externalEventId ?? '')) return null;
  const id = await refKey(provider, externalEventId);
  const row = await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_events (uid, provider, external_event_id, kind) VALUES (?, ?, ?, ?) RETURNING id`,
  ).bind(crypto.randomUUID(), provider, id, kind).first<{ id: number }>();
  return row ? Number(row.id) : null;
}

export type EventFields = { userId?: number | null; threadId?: number | null; sessionId?: number | null; error?: string | null };

/**
 * `finishEvent`'s UPDATE, unrun, so a caller can put it in the same batch as
 * the write it records (the voice job does: a retry after the append finds
 * the work done, rather than an event still 'accepted').
 */
export function finishEventStatement(env: Env, eventId: number, status: EventStatus, fields: EventFields = {}): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE channel_events
        SET status = ?, user_id = COALESCE(?, user_id), thread_id = COALESCE(?, thread_id),
            session_id = COALESCE(?, session_id), error = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(status, fields.userId ?? null, fields.threadId ?? null, fields.sessionId ?? null,
    fields.error ? String(fields.error).slice(0, 80) : null, eventId);
}

/** Record how a claimed event ended. `error` is a machine code, never text from the payload. */
export async function finishEvent(env: Env, eventId: number, status: EventStatus, fields: EventFields = {}): Promise<void> {
  await finishEventStatement(env, eventId, status, fields).run();
}

/** Drop a claim so the provider's retry is processed. Only before anything was stored. */
export async function releaseEvent(env: Env, eventId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM channel_events WHERE id = ?').bind(eventId).run();
}

// ---------------------------------------------------------------------------
// Per-connection counters (migration 451)
// ---------------------------------------------------------------------------
//
// Held in D1, one row per connection, counter and window, raised by an upsert
// that D1 applies atomically. KV could not do this job: it takes one write per
// key per second, so a per-minute KV counter stopped near 60 and a limit of
// 120 never tripped (and its read-modify-write lost increments under
// concurrent deliveries besides).

/** Count one webhook event on a connection; true when it is over the per-minute limit. Fails OPEN. */
export async function connectionOverLimit(env: Env, integrationId: number, now = new Date()): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `INSERT INTO channel_counters (integration_id, counter, window_start, n) VALUES (?, 'events_minute', ?, 1)
       ON CONFLICT (integration_id, counter, window_start) DO UPDATE SET n = n + 1
       RETURNING n`,
    ).bind(integrationId, now.toISOString().slice(0, 16)).first<{ n: number }>();
    return Number(row?.n ?? 0) > CHANNEL_LIMITS.eventsPerMinute;
  } catch {
    // Storing a customer's text costs nothing: a counter outage must not drop it.
    console.error('[channels] event counter unavailable');
    return false;
  }
}

/**
 * Take one of a connection's voice transcriptions for today, or false when
 * the day's cap is spent. Fails CLOSED: a D1 error throws, so nothing is spent
 * on the model and the queue retries the job later.
 */
export async function reserveTranscription(env: Env, integrationId: number, now = new Date()): Promise<boolean> {
  // The DO UPDATE's WHERE leaves a full day's row untouched, and then nothing is returned.
  const row = await env.DB.prepare(
    `INSERT INTO channel_counters (integration_id, counter, window_start, n) VALUES (?, 'transcriptions_day', ?, 1)
     ON CONFLICT (integration_id, counter, window_start) DO UPDATE SET n = n + 1 WHERE n < ?
     RETURNING n`,
  ).bind(integrationId, now.toISOString().slice(0, 10), CHANNEL_LIMITS.transcriptionsPerDay).first<{ n: number }>();
  return !!row;
}

/**
 * A webhook's raw body, or null once it passes `max` bytes — before anything
 * parses it. The bytes are counted as they arrive and the read stops at the
 * cap: a request without Content-Length (chunked, or HTTP/2) would otherwise
 * be buffered whole, up to the platform's own limit, before its size was known.
 */
export async function readCappedBody(req: Request, max: number = CHANNEL_LIMITS.maxBodyBytes): Promise<ArrayBuffer | null> {
  if (Number(req.headers.get('content-length') || 0) > max) return null;
  const stream = req.body;
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out.buffer;
}
