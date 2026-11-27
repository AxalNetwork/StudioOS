/** D886 B8: private per-run container routing. No public runtime proxy. */
import type { Env } from '../types';
import type { BotRuntime } from './meetingBots';
import { doNamespace } from '../util/doNamespace';
import { MeetingBotRuntimeError, readStartupReply, TRANSPORT_START_MS, type RuntimeStartResult } from './meetingBotStartup';

export type RuntimeStart = Parameters<BotRuntime['start']>[0];
export type RuntimeLease = { uid: string; deadline_at: number; budget_deadline_at: number };
export const runtimeUid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function runtimeKey(secret: string, uid: string) {
  if (secret.length < 32 || !runtimeUid(uid)) throw new Error('runtime_unavailable');
  return hmac(secret,`meeting-bot-runtime:v1:${uid}`);
}
export async function runtimeHeaders(secret: string, path: string, raw: string) {
  const ts = String(Date.now());
  return { 'content-type':'application/json', 'x-meeting-bot-timestamp':ts,
    'x-meeting-bot-signature':await hmac(secret,`v1:${ts}:POST:${path}:${raw}`) };
}
export function runtimeOrigin(env: Env) {
  const url = new URL(env.APP_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('runtime_unavailable');
  return url.origin;
}
export function meetingBotRuntime(env: Env): BotRuntime {
  // In-process fixtures and an explicitly supplied runtime keep the B1 interface.
  if (env.MEETING_BOT_RUNTIME) return env.MEETING_BOT_RUNTIME;
  // D5153: a missing binding is its own startup code, not a generic outage.
  if (!env.MEETING_BOT_CONTAINER) throw new MeetingBotRuntimeError('binding_missing','container_binding_resolved');
  const ns = doNamespace(env,env.MEETING_BOT_CONTAINER);
  const send = (path: string, body: {uid:string}) => {
    if (!runtimeUid(body.uid)) throw new Error('runtime_unavailable');
    return ns.get(ns.idFromName(body.uid)).fetch(new Request(`https://meeting-bot-container.internal${path}`, {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(path === '/start' ? TRANSPORT_START_MS : 9000),
    }));
  };
  const plain = async (path: string, body: {uid:string}) => { if (!(await send(path,body)).ok) throw new Error('runtime_unavailable'); };
  /**
   * D5153: `/start` answers with a startup fact. Success carries the stage and
   * the runtime's version; a known failure throws MeetingBotRuntimeError with
   * the host's code and stage; an older host's unknown answer stays the plain
   * `runtime_unavailable` it always was.
   */
  const start = async (run: {uid:string}): Promise<RuntimeStartResult> => {
    let response: Response;
    try { response = await send('/start',run); }
    catch (e) {
      if (e instanceof Error && e.message === 'runtime_unavailable') throw e;
      // The host never answered inside its own budget: it was still waiting on the runtime.
      throw new MeetingBotRuntimeError('runtime_command_timeout', null);
    }
    const reply = readStartupReply(response.status, await response.json().catch(() => null));
    if (reply instanceof MeetingBotRuntimeError) throw reply;
    if (!reply) throw new Error('runtime_unavailable');
    return reply;
  };
  return { start, stop:run=>plain('/stop',run), heartbeat:run=>plain('/heartbeat',run) };
}
