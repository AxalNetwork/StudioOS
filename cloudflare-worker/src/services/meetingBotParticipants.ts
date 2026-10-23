/** D886 B7: expose only display names/times from the latest encrypted runtime roster. */
import type { Env } from '../types';
import { BotError, sessionBot } from './meetingBots';
import { decryptColumn } from './columnCipher';
export async function botParticipants(env: Env, sessionId: number, userId: number) {
  if (!env.MEETING_BOT_RUN) throw new BotError(503,'bot_unavailable','The participants could not be read.');
  const run=await sessionBot(env,sessionId,userId);
  if (!run) return {participants:null};
  const row=await env.DB.prepare("SELECT seq,payload_enc FROM meeting_bot_events WHERE run_uid = ? AND kind = 'roster' ORDER BY seq DESC LIMIT 1").bind(run.uid).first<{seq:number;payload_enc:string}>();
  if (!row) return {participants:null};
  const raw=await decryptColumn(env,'meeting_bot_events','payload_enc',`${run.uid}:${row.seq}`,row.payload_enc);
  if (!raw) throw new BotError(503,'roster_unreadable','The participants could not be read.');
  const parsed=JSON.parse(raw);
  if (!Array.isArray(parsed.participants)) throw new BotError(503,'roster_unreadable','The participants could not be read.');
  return {participants:parsed.participants.filter((p:any)=>String(p.name).trim().toLowerCase()!=='eadwyn ai').map((p:any,i:number)=>({
    display_name: typeof p.name==='string' && p.name.trim() && !p.name.includes('@') ? p.name.trim() : `Participant ${i+1}`,
    joined_ms:p.joined_ms,left_ms:p.left_ms,
  }))};
}
