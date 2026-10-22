/** D886 B10 live check: reuse B1's member dispatch, consent and billing path. */
import type { Env } from '../types';
import type { ExecutionContext } from 'hono';
import { decryptColumn } from './columnCipher';
import { BOT_PLATFORMS, BOT_STATUSES, BOT_FAILURE_CODES, type BotStatus } from './meetingBotOperations';

export const validBotTestId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export async function ownBotTest(env: Env, userId: number, uid: string, now = Date.now()) {
  if (!validBotTestId(uid)) return null;
  const run = await env.DB.prepare(`SELECT uid,platform,status,failure_code,created_at,started_at,ended_at
    FROM meeting_bots WHERE uid=? AND user_id=?`).bind(uid,userId).first<{
      uid: string; platform: string; status: BotStatus; failure_code: string | null;
      created_at: number; started_at: number | null; ended_at: number | null;
    }>();
  if (!run) return null;
  if (!BOT_PLATFORMS.includes(run.platform as any) || !BOT_STATUSES.includes(run.status)) throw new Error('meeting_bot_test_unreadable');
  const events = await env.DB.prepare(`SELECT seq,payload_enc,received_at FROM meeting_bot_events
    WHERE run_uid=? AND kind='status' ORDER BY seq LIMIT 501`).bind(uid)
    .all<{ seq: number; payload_enc: string; received_at: number }>();
  if ((events.success as unknown) === false || !Array.isArray(events.results) || events.results.length > 500) throw new Error('meeting_bot_test_unreadable');
  const times = new Map<BotStatus, number>([['queued',run.created_at]]);
  if (run.started_at !== null) times.set('joining',run.started_at);
  for (const event of events.results) {
    const text = await decryptColumn(env,'meeting_bot_events','payload_enc',`${uid}:${event.seq}`,event.payload_enc);
    if (text === null) throw new Error('meeting_bot_test_unreadable');
    const payload = JSON.parse(text);
    if (!BOT_STATUSES.includes(payload?.status)) throw new Error('meeting_bot_test_unreadable');
    if (!times.has(payload.status)) times.set(payload.status,event.received_at);
  }
  // DO-generated terminal transitions need not have a runtime callback event.
  if (['done','failed','stopped'].includes(run.status) && !times.has(run.status) && run.ended_at !== null) times.set(run.status,run.ended_at);
  const reached = [...times.entries()].sort((a,b) => a[1]-b[1]);
  if (reached.some(([,at]) => !Number.isSafeInteger(at) || at < run.created_at || at > now)) throw new Error('meeting_bot_test_unreadable');
  return {
    uid: run.uid, platform: run.platform, status: run.status,
    failure_code: run.failure_code === null ? null : BOT_FAILURE_CODES.includes(run.failure_code as any) ? run.failure_code : 'unknown',
    stages: reached.map(([stage,at],i) => ({ stage, at: new Date(at).toISOString(), elapsed_ms: at-run.created_at,
      duration_ms: i+1 < reached.length ? reached[i+1][1]-at : ['done','failed','stopped'].includes(run.status) ? null : now-at })),
    timing_basis: 'Worker receipt times; a stage without a recorded transition is not inferred.',
  };
}

/** Authentication is checked again by the existing mounted member router.
 * No alternate runtime or charging path. Before B1 lands this returns 404,
 * which the HQ route maps to a fixed unavailable response.
 */
export async function dispatchBotTest(env: Env, headers: Headers, sessionId: number, meetingUrl: unknown, executionCtx: ExecutionContext) {
  const sessions = (await import('../routes/founder_validate_sessions')).default;
  const forward = new Headers(headers); forward.set('content-type','application/json');
  return sessions.fetch(new Request(`https://meeting-bot.internal/sessions/${sessionId}/bot`, {
    method: 'POST', headers: forward, body: JSON.stringify({ meeting_url: meetingUrl }),
  }), env, executionCtx);
}
