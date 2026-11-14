/** D886 B10 live check: reuse B1's member dispatch, consent and billing path. */
import type { Env, User } from '../types';
import { dispatchBot, BotError } from './meetingBots';
import { loadSession } from './interviewSessions';
import { decryptColumn } from './columnCipher';
import { BOT_PLATFORMS, BOT_STATUSES, BOT_FAILURE_CODES, type BotStatus } from './meetingBotOperations';

export const validBotTestId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export async function ownBotTest(env: Env, userId: number, uid: string, now = Date.now()) {
  if (!validBotTestId(uid)) return null;
  const run = await env.DB.prepare(`SELECT uid,platform,status,failure_code,created_at,started_at,ended_at,heartbeat_at
    FROM meeting_bots WHERE uid=? AND user_id=?`).bind(uid,userId).first<{
      uid: string; platform: string; status: BotStatus; failure_code: string | null;
      created_at: number; started_at: number | null; ended_at: number | null; heartbeat_at: number | null;
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
  if (['done','failed','stopped'].includes(run.status) && !times.has(run.status) && run.heartbeat_at !== null) times.set(run.status,run.heartbeat_at);
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

/** Reuse B1's service with the authenticated actor; all consent, rollout and
 * billing gates remain in dispatchBot. No second router or runtime path. */
export async function dispatchBotTest(env: Env, actor: User, sessionId: number, meetingUrl: unknown) {
  const session = await loadSession(env, sessionId);
  if (!session || session.created_by_user_id !== actor.id) throw new BotError(404,'session_not_found','That test session is not available.');
  try {
    return Response.json({ bot: await dispatchBot(env, actor, session, { meeting_url: meetingUrl }) }, { status: 202 });
  } catch (e) {
    if (e instanceof BotError) return Response.json({ code: e.code }, { status: e.status });
    throw e;
  }
}
