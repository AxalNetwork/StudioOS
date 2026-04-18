/**
 * Real-time event helpers — fire-and-forget broadcasts to the relevant
 * Durable Object instance. Safe to call from any worker route; if the DO
 * binding is missing (e.g. during a partial deploy) the call is a no-op
 * with a console warning. Never throws into the calling route.
 */
import type { Env } from '../types';

async function postToDO(ns: DurableObjectNamespace | undefined, name: string, body: unknown): Promise<void> {
  if (!ns) {
    console.warn('[realtime] DO namespace missing — broadcast dropped');
    return;
  }
  try {
    const id = ns.idFromName(name);
    const stub = ns.get(id);
    // The DO base URL is irrelevant — the namespace stub routes by ID.
    await stub.fetch('https://do/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[realtime] broadcast failed', e);
  }
}

export async function notifyPipelineRoom(
  env: Env,
  dealId: number | string,
  event: { type: string; [k: string]: unknown }
): Promise<void> {
  // Fan out to BOTH the per-deal room (for the detail modal) and the
  // global 'overview' room (for the board list view). Two cheap DO calls
  // that run in parallel; failures in one don't affect the other.
  const stamped = { ...event, ts: Date.now() };
  await Promise.allSettled([
    postToDO(env.PIPELINE_ROOM, `deal:${dealId}`, stamped),
    postToDO(env.PIPELINE_ROOM, 'overview', stamped),
  ]);
}

export async function notifyOnboardingChat(
  env: Env,
  userId: number | string,
  message: { role: 'user' | 'assistant' | 'system'; content: string }
): Promise<void> {
  await postToDO(env.ONBOARDING_CHAT, `user:${userId}`, message);
}

/** Used by /api/infra/queue to surface live connection counts. */
export async function getRealtimeStats(env: Env): Promise<{ pipeline_rooms: number; onboarding_rooms: number; note: string }> {
  // CF doesn't expose a "list all DO instances" API. We can't enumerate
  // active rooms cheaply — return a stub plus the binding-presence flags.
  return {
    pipeline_rooms: env.PIPELINE_ROOM ? -1 : 0,
    onboarding_rooms: env.ONBOARDING_CHAT ? -1 : 0,
    note: env.PIPELINE_ROOM && env.ONBOARDING_CHAT
      ? 'DOs bound. -1 means "not enumerable" — query a specific room via /api/infra/realtime/:room/:id for an exact count.'
      : 'DOs not bound. Real-time fan-out is disabled.',
  };
}
