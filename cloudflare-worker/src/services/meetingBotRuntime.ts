/** D886 B8: private per-run container routing. No public runtime proxy. */
import type { Env } from '../types';
import type { BotRuntime } from './meetingBots';
import { doNamespace } from '../util/doNamespace';

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
  if (!env.MEETING_BOT_CONTAINER) throw new Error('runtime_unavailable');
  const ns = doNamespace(env,env.MEETING_BOT_CONTAINER);
  const send = async (path: string, body: {uid:string}) => {
    if (!runtimeUid(body.uid)) throw new Error('runtime_unavailable');
    const response = await ns.get(ns.idFromName(body.uid)).fetch(new Request(`https://meeting-bot-container.internal${path}`, {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(9000),
    }));
    if (!response.ok) throw new Error('runtime_unavailable');
  };
  return { start:run=>send('/start',run), stop:run=>send('/stop',run), heartbeat:run=>send('/heartbeat',run) };
}
