/** D886 B1. One serialized supervisor per run. Runtime events are data, never commands. */
import { meetingBotNotice, MEETING_BOT_NOTICE_PUBLISHED } from '../../../meeting-bot/notice.mjs';
import type { Env } from '../types';
import { decryptColumn, encryptColumn } from '../services/columnCipher';
import { settleAiReservation, reserveAiBudget, aiPaused } from '../services/aiBudget';
import { constantTimeEqual } from '../rpc/secret';
import { withDeadline } from '../util/deadline';
import { meetingBotRuntime, runtimeKey, runtimeUid } from '../services/meetingBotRuntime';
import { putChunk, isUploadWav, MAX_CHUNK_BYTES, WAV_HEADER_BYTES, UPLOAD_BYTES_PER_SECOND } from '../services/interviewSessions';
import {
  BOT_HEARTBEAT_MS, BOT_PROCESSING_MAX_MS, BotError, botRow, botSession, botView, botConfigured, botMemberEnabled, botVentureName, terminal,
  type BotRun, type BotStatus,
} from '../services/meetingBots';

export const BOT_RENEWAL_LEAD_MS = 20_000;
export const BOT_CALLBACK_WINDOW_MS = 5 * 60_000;
const NEXT: Record<BotStatus, readonly BotStatus[]> = {
  queued: ['joining','failed','stopped'], joining: ['waiting_room','recording','failed','stopped'],
  waiting_room: ['recording','failed','stopped'], recording: ['processing','failed','stopped'],
  processing: ['done','failed','stopped'], done: [], failed: [], stopped: [],
};
export async function botHmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function validBotCallback(env: Env, req: Request, raw: string, now = Date.now()) {
  const ts = req.headers.get('x-meeting-bot-timestamp') ?? '';
  const signature = req.headers.get('x-meeting-bot-signature') ?? '';
  if ((env.MEETING_BOT_SECRET?.length ?? 0) < 32 || !/^\d{13}$/.test(ts) || Math.abs(now - Number(ts)) > BOT_CALLBACK_WINDOW_MS || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const text = `v1:${ts}:${req.method}:${new URL(req.url).pathname}:${raw}`;
  if (constantTimeEqual(signature, await botHmac(env.MEETING_BOT_SECRET!, text))) return true;
  const uid = /^\/api\/meeting-bots\/([^/]+)\/(?:events|zoom-credentials)$/.exec(new URL(req.url).pathname)?.[1];
  return runtimeUid(uid) && constantTimeEqual(signature,await botHmac(await runtimeKey(env.MEETING_BOT_SECRET!,uid),text));
}
export async function validBotUploadToken(env: Env, uid: string, seq: string, token: string, now=Date.now()) {
  const parts=token.split('.');
  if ((env.MEETING_BOT_SECRET?.length??0)<32 || !/^[a-f0-9-]{36}$/.test(uid) || !/^[0-9]{1,4}$/.test(seq) || parts.length!==3 || !/^[0-9]{13}$/.test(parts[0]) || Number(parts[0])<now || Number(parts[0])>now+BOT_CALLBACK_WINDOW_MS || !/^[a-f0-9-]{36}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  return constantTimeEqual(parts[2],await botHmac(env.MEETING_BOT_SECRET!,`upload:${uid}:${Number(seq)}:${parts[0]}:${parts[1]}`));
}
export async function boundedBotBody(req: Request, max: number): Promise<ArrayBuffer> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw new BotError(413,'too_large','The bot payload is too large.');
  const reader = req.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const pieces: Uint8Array[] = []; let count = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; count += next.value.byteLength;
      if (count > max) { await reader.cancel(); throw new BotError(413,'too_large','The bot payload is too large.'); }
      pieces.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(count); let at = 0;
  for (const piece of pieces) { out.set(piece,at); at += piece.length; }
  return out.buffer;
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), {status,headers:{'content-type':'application/json'}});
const int = (v: unknown, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const FAILED_CODES = new Set(['admission_refused','meeting_ended','runtime_failed','notice_failed','unsupported_platform','processing_failed']);
interface BillingBlock { uid: string; index: number; start: number; end: number; settled: boolean; minutes: number }
interface UploadTicket { token: string; seq: number; size: number; start: number; expires: number; used: boolean }

export class MeetingBotRun implements DurableObject {
  private state: DurableObjectState; private env: Env;
  constructor(state: DurableObjectState, env: Env) { this.state=state; this.env=env; }
  async fetch(req: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      try {
        const uid = req.headers.get('x-bot-run') ?? '';
        const stored = await this.state.storage.get<string>('uid');
        if (!/^[a-f0-9-]{36}$/.test(uid) || (stored && uid !== stored)) throw new BotError(404,'bot_not_found','The bot run is not available.');
        if (!stored) {
          await this.state.storage.put('uid',uid);
        }
        let run = await botRow(this.env,uid);
        if (!run) throw new BotError(404,'bot_not_found','The bot run is not available.');
        await this.state.storage.put('snapshot',run);
        const action = new URL(req.url).pathname;
        if (action === '/init') { await this.state.storage.setAlarm(Date.now()+1000); await this.tick(run); }
        else if (action === '/drain') await this.drain(run,'stopped');
        else if (action === '/stop') await this.finish(run,'stopped',null);
        else if (action === '/event') return await this.event(req,run);
        else if (action === '/chunk') return await this.upload(req,run);
        else if (action === '/zoom-credentials') {
          if (!await this.allowed(run) || !['joining','waiting_room'].includes(run.status) || (await this.lease()??0)<=Date.now()) throw new BotError(403,'bot_zoom_unavailable','The Zoom runtime is not available.');
          const last=await this.state.storage.get<number>('credentials_requested_at')??0;
          if (Date.now()-last<2500) throw new BotError(429,'bot_zoom_rate','The runtime must wait before retrying.');
          await this.state.storage.put('credentials_requested_at',Date.now());
          const { zoomRuntimeCredentials }=await import('../services/meetingBotZoom');
          const credentials=await zoomRuntimeCredentials(this.env,run);
          if (!await this.allowed(run) || (await this.lease()??0)<=Date.now()) throw new BotError(403,'bot_zoom_unavailable','The Zoom runtime is not available.');
          return json(credentials);
        }
        else if (action === '/status') await this.tick(run);
        else throw new BotError(404,'bot_not_found','The bot run is not available.');
        run = await botRow(this.env,uid);
        return json(run ? botView(run) : null);
      } catch (e) {
        if (e instanceof BotError) return json(e.body(),e.status);
        // Neither request data nor a runtime/provider error is logged or reflected.
        return json({code:'bot_unavailable',detail:'The meeting bot is temporarily unavailable.',message:'The meeting bot is temporarily unavailable.'},503);
      }
    });
  }
  private async update(run: BotRun, status: BotStatus, code: string | null = null) {
    if (run.status !== status && !NEXT[run.status].includes(status)) throw new BotError(409,'invalid_bot_transition','That bot status change is not available.');
    const now=Date.now();
    await this.env.DB.prepare('UPDATE meeting_bots SET status = ?, failure_code = ?, heartbeat_at = ? WHERE uid = ? AND status = ?')
      .bind(status,code,now,run.uid,run.status).run();
    run.status=status; run.failure_code=code; run.heartbeat_at=now;
    await this.state.storage.put('snapshot',run);
  }
  private async allowed(run: BotRun) {
    if (!botConfigured(this.env,run.platform) || await aiPaused(this.env,run.user_id)) return false;
    const member = await this.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(run.user_id).first<any>();
    if (!member || !await botMemberEnabled(this.env,member) || Number(member.jwt_min_iat ?? 0) * 1000 > run.created_at) return false;
    try { await botSession(this.env,run); return true; } catch { return false; }
  }
  private async stopRuntime(run: BotRun) {
    if (run.started_at === null) { await this.state.storage.put('runtime_stopped',true); return; }
    try {
      await withDeadline(meetingBotRuntime(this.env).stop({uid:run.uid}),5000,'bot stop');
      await this.state.storage.put('runtime_stopped',true);
    } catch { await this.state.storage.setAlarm(Date.now()+BOT_HEARTBEAT_MS); }
  }
  private async settleBlocks(run: BotRun, end: number, elapsedOnly = false) {
    const blocks=await this.state.storage.get<BillingBlock[]>('billing')??[];
    for (const block of blocks) {
      if (block.settled || elapsedOnly && block.end > end) continue;
      block.minutes=Math.min(2,Math.ceil(Math.max(0,Math.min(end,block.end)-block.start)/60_000));
      await settleAiReservation(this.env,{uid:block.uid,userId:run.user_id},block.minutes*run.rate_per_minute_microusd,block.minutes===0);
      block.settled=true;
      await this.state.storage.put('billing',blocks);
    }
    return blocks;
  }
  /** Never run past a paid block: runtime must enforce budget_deadline_at too. */
  private async fundBlock(run: BotRun, now: number): Promise<boolean> {
    const blocks=await this.state.storage.get<BillingBlock[]>('billing')??[];
    const last=blocks.at(-1);
    if (last) await this.settleBlocks(run,now,true);
    if (last && last.end >= (run.started_at ?? blocks[0].start) + run.limit_minutes*60_000) return now < last.end;
    if (last && now < last.end - BOT_RENEWAL_LEAD_MS) return true;
    if (last) {
      // An alarm that missed its boundary must not silently bill an unfunded gap.
      if (now-last.end>5000) return false;
    }
    const index=blocks.length;
    const held=await reserveAiBudget(this.env,run.user_id,run.rate_per_minute_microusd*2,new Date(now),{idempotencyKey:`meeting-bot:${run.uid}:${index}`});
    if (!held.ok || held.replayed && held.status!=='pending') return false;
    const start=last?.end??now;
    // Reload after settlement to preserve its durable flags.
    const saved=await this.state.storage.get<BillingBlock[]>('billing')??[];
    saved.push({uid:held.reservation.uid,index,start,end:Math.min(start+120_000,(run.started_at??now)+run.limit_minutes*60_000),settled:false,minutes:0});
    await this.state.storage.put('billing',saved);
    run.reservation_uid=held.reservation.uid;
    await this.env.DB.prepare('UPDATE meeting_bots SET reservation_uid = ? WHERE uid = ?').bind(run.reservation_uid,run.uid).run();
    await this.state.storage.put('snapshot',run);
    return true;
  }
  private async lease() { return (await this.state.storage.get<BillingBlock[]>('billing'))?.at(-1)?.end??null; }
  private async settle(run: BotRun) {
    if (run.settled_at !== null) return;
    const now=Date.now(),end=run.ended_at??now;
    const blocks=await this.settleBlocks(run,end);
    const minutes=blocks.reduce((sum,b)=>sum+b.minutes,0);
    await this.env.DB.prepare('UPDATE meeting_bots SET minutes = ?, settled_at = ? WHERE uid = ? AND settled_at IS NULL').bind(minutes,now,run.uid).run();
    run.minutes=minutes; run.settled_at=now; await this.state.storage.put('snapshot',run);
  }
  private async endClock(run: BotRun) {
    if (run.ended_at === null) {
      run.ended_at=Date.now();
      await this.env.DB.prepare('UPDATE meeting_bots SET ended_at = ? WHERE uid = ? AND ended_at IS NULL').bind(run.ended_at,run.uid).run();
      await this.state.storage.put('snapshot',run);
      await this.env.DB.prepare("UPDATE interview_sessions SET status = 'stopped', recording_since = NULL, stopped_at = datetime('now'), active_ms = ? WHERE id = ? AND submitted_via = 'meeting_bot' AND status = 'recording'").bind(Math.min(run.limit_minutes*60_000,Math.max(0,run.ended_at-(run.started_at??run.ended_at))),run.session_id).run();
    }
    await this.settle(run);
  }
  private async draining(run: BotRun) { return !await this.state.storage.get('uploads_complete') && run.status==='processing' && (await this.state.storage.get<number>('drain_until')??0)>Date.now(); }
  private async drain(run: BotRun, reason: string) {
    if (await this.draining(run)) return;
    if (run.status==='processing' && !await this.state.storage.get('uploads_complete')) return this.finish(run,'failed','processing_failed');
    if (run.status!=='recording') return this.finish(run,'stopped',reason==='stopped'?null:reason);
    // Capture ends now. The runtime asynchronously flushes only audio captured before this boundary.
    const until=Date.now()+30_000;
    await this.state.storage.put('drain_until',until);
    await this.state.storage.put('drain_reason',reason);
    await this.update(run,'processing');
    await this.endClock(run);
    await this.state.storage.setAlarm(until);
    await this.stopRuntime(run);
  }
  private async finish(run: BotRun, status: 'done'|'failed'|'stopped', code: string | null) {
    if (status === 'stopped' && run.status === 'processing' && await this.state.storage.get('drain_until') && await this.allowed(run)) {
      await this.queueAssembly(run,true);
    }
    if (!terminal(run.status)) await this.update(run,status,code);
    // Always retain an alarm until the runtime stop AND ledger settlement have succeeded.
    await this.state.storage.setAlarm(Date.now()+BOT_HEARTBEAT_MS);
    await this.endClock(run);
    if (!await this.state.storage.get('runtime_stopped')) await this.stopRuntime(run);
    if (await this.state.storage.get('runtime_stopped') && run.settled_at !== null) {
      await this.state.storage.deleteAlarm();
      run.meeting_url_enc='';
      await this.env.DB.prepare("UPDATE meeting_bots SET meeting_url_enc = '' WHERE uid = ?").bind(run.uid).run();
      await this.state.storage.put('snapshot',run);
      const tickets=await this.state.storage.list({prefix:'chunk:'});
      if (tickets.size) await this.state.storage.delete([...tickets.keys()]);
    }
  }
  private async tick(run: BotRun) {
    if (terminal(run.status)) return this.finish(run,run.status as 'done'|'failed'|'stopped',run.failure_code);
    await this.state.storage.setAlarm(Date.now()+BOT_HEARTBEAT_MS);
    if (!await this.allowed(run)) return this.finish(run,'stopped','access_revoked');
    if (run.status === 'queued') {
      if (Date.now()<run.scheduled_at) { await this.state.storage.setAlarm(run.scheduled_at); return; }
      if (Date.now()-run.scheduled_at>60_000) return this.finish(run,'failed','schedule_missed');
      if (!MEETING_BOT_NOTICE_PUBLISHED) return this.finish(run,'failed','notice_unpublished');
      const ventureName = await botVentureName(this.env,run);
      const notice = meetingBotNotice({ventureName});
      if (!await this.fundBlock(run,Date.now())) return this.drain(run,'tokens');
      const link=await decryptColumn(this.env,'meeting_bots','meeting_url_enc',run.uid,run.meeting_url_enc);
      if (!link) return this.finish(run,'failed','runtime_unavailable');
      run.started_at=(await this.state.storage.get<BillingBlock[]>('billing'))![0].start;
      await this.env.DB.prepare('UPDATE meeting_bots SET started_at = ? WHERE uid = ? AND started_at IS NULL').bind(run.started_at,run.uid).run();
      await this.update(run,'joining');
      try {
        await withDeadline(meetingBotRuntime(this.env).start({uid:run.uid,platform:run.platform,meeting_url:link,limit_minutes:run.limit_minutes,deadline_at:run.started_at+run.limit_minutes*60_000,budget_deadline_at:(await this.lease())!,notice,venture_name:ventureName}),10_000,'bot start');
      } catch { return this.finish(run,'failed','runtime_unavailable'); }
    }
    const now=Date.now();
    if (run.status === 'processing') {
      const until=await this.state.storage.get<number>('drain_until');
      if (until && now>=until) {
        if (!await this.state.storage.get('uploads_complete')) return this.finish(run,'failed','processing_failed');
        return this.finish(run,'stopped',(await this.state.storage.get<string>('drain_reason'))??null);
      }
      if (until) await this.state.storage.setAlarm(Math.min(now+BOT_HEARTBEAT_MS,until));
      if (!await this.state.storage.get('runtime_stopped')) await this.stopRuntime(run);
      if (!until) {
        await this.queueAssembly(run);
        const session = await botSession(this.env,run);
        const persisted = await botRow(this.env,run.uid);
        if (session.processing_stage === 'done' && persisted?.participants_enc) return this.finish(run,'done',null);
        if (session.processing_stage === 'failed') return this.finish(run,'failed','processing_failed');
        const progress = Date.parse(String(session.processing_updated_at ?? '').replace(' ','T').replace(/Z?$/,'Z'));
        if (Number.isFinite(progress) && now-progress < BOT_PROCESSING_MAX_MS) return;
      }
      if (run.ended_at !== null && now-run.ended_at>=BOT_PROCESSING_MAX_MS) return this.finish(run,'failed','processing_timeout');
    } else if (run.started_at !== null && now-run.started_at>=run.limit_minutes*60_000) return this.drain(run,'time_limit');
    else if (run.heartbeat_at !== null && now-run.heartbeat_at>2*BOT_HEARTBEAT_MS) return this.finish(run,'failed','heartbeat_timeout');
    else if (run.started_at !== null && !await this.fundBlock(run,now)) return this.drain(run,'tokens');
    const lease=await this.lease();
    if (!terminal(run.status) && run.status!=='processing' && lease) {
      const boundary = lease < run.started_at!+run.limit_minutes*60_000 ? lease-BOT_RENEWAL_LEAD_MS : lease;
      await this.state.storage.setAlarm(Math.min(now+BOT_HEARTBEAT_MS,boundary));
    }
  }
  async alarm() {
    return this.state.blockConcurrencyWhile(async () => {
      const uid=await this.state.storage.get<string>('uid'); if (!uid) return;
      const run=await botRow(this.env,uid);
      if (!run) {
        const old=await this.state.storage.get<BotRun>('snapshot');
        if (old) await this.finish(old,'stopped','session_deleted');
        return;
      }
      try { await this.tick(run); } catch { await this.state.storage.setAlarm(Date.now()+BOT_HEARTBEAT_MS); }
    });
  }
  /** A processing acknowledgement closes intake only after every declared chunk is durable. */
  private async uploadsComplete(run: BotRun, event: Record<string, unknown>): Promise<boolean> {
    const prior = await this.state.storage.get<number>('upload_count');
    const count = event.chunks === undefined ? prior : event.chunks;
    if (!int(count,3600) || (event.chunks_failed === undefined ? (prior === undefined ? null : 0) : event.chunks_failed) !== 0) return false;
    const tickets = await this.state.storage.list<UploadTicket>({prefix:'chunk:'});
    const rows = (await this.env.DB.prepare('SELECT seq FROM interview_session_chunks WHERE session_id = ? ORDER BY seq')
      .bind(run.session_id).all<{seq:number}>()).results ?? [];
    if (tickets.size !== count || rows.length !== count) return false;
    for (let seq=0;seq<Number(count);seq++) if (!tickets.get(`chunk:${seq}`)?.used || rows[seq].seq !== seq) return false;
    await this.state.storage.put('upload_count',count);
    await this.state.storage.put('uploads_complete',true);
    return true;
  }
  private async queueAssembly(run: BotRun, force = false) {
    if (await this.state.storage.get('assembly_queued')) return;
    const tickets = await this.state.storage.list<UploadTicket>({prefix:'chunk:'});
    const unfinished = [...tickets.values()].filter(ticket=>!ticket.used);
    if (unfinished.length && !force && unfinished.some(ticket=>ticket.expires>Date.now())) return;
    const { queueBotAssembly } = await import('../services/meetingBotAssembly');
    try {
      if (unfinished.length) {
        const { BotAssemblyError } = await import('../services/meetingBotAssembly');
        throw new BotAssemblyError('bot_audio_incomplete');
      }
      await queueBotAssembly(this.env,run.uid);
    }
    catch (error) {
      const { BotAssemblyError } = await import('../services/meetingBotAssembly');
      if (!(error instanceof BotAssemblyError)) throw error;
      await this.env.DB.prepare(`UPDATE interview_sessions SET processing_stage = 'failed', processing_error = 'The recording parts could not be assembled. Nothing was inferred.',
        processing_updated_at = datetime('now') WHERE id = ? AND consent_status = 'given' AND audio_removed_at IS NULL`).bind(run.session_id).run();
    }
    await this.state.storage.put('assembly_queued',true);
  }
  private async event(req: Request, run: BotRun) {
    if (!await this.allowed(run)) { await this.finish(run,'stopped','access_revoked'); throw new BotError(409,'consent_required','This bot run no longer has permission.'); }
    // Signature was validated by the public router; only internal calls reach this endpoint.
    const event=await req.json() as Record<string,unknown>;
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new BotError(400,'invalid_bot_event','The bot event is not valid.');
    if (run.status === 'queued') throw new BotError(409,'bot_not_started','The scheduled bot has not started.');
    if (!int(event.seq,1_000_000) || typeof event.type !== 'string') throw new BotError(400,'invalid_bot_event','The bot event is not valid.');
    const seen=await this.env.DB.prepare('SELECT seq, kind, payload_enc FROM meeting_bot_events WHERE run_uid = ? AND seq = ?').bind(run.uid,event.seq).first<{seq:number;kind:string;payload_enc:string}>();
    if (seen) {
      if (seen.kind === 'chunk' && event.type === 'chunk') {
        const stored=await decryptColumn(this.env,'meeting_bot_events','payload_enc',`${run.uid}:${event.seq}`,seen.payload_enc);
        if (!stored) throw new BotError(503,'bot_unavailable','The audio manifest could not be read.');
        return this.ticket(run,{...JSON.parse(stored),seq:event.seq},false);
      }
      return json({duplicate:true,bot:botView(run),budget_deadline_at:terminal(run.status) || run.status==='processing' ? null : await this.lease()});
    }
    if (terminal(run.status)) throw new BotError(409,'bot_finished','This bot run has ended.');
    if (run.status === 'processing' && !await this.draining(run) && ['roster','speaker','chunk'].includes(event.type)) throw new BotError(409,'bot_processing','The recording is already being processed.');
    if (run.started_at !== null && run.status !== 'processing' && Date.now() >= run.started_at + run.limit_minutes*60_000) { await this.finish(run,'stopped','time_limit'); throw new BotError(409,'bot_time_limit','The bot reached its time limit.'); }
    const last=await this.env.DB.prepare('SELECT MAX(seq) AS seq FROM meeting_bot_events WHERE run_uid = ?').bind(run.uid).first<{seq:number|null}>();
    if (last?.seq !== null && last?.seq !== undefined && Number(event.seq)<=last.seq) throw new BotError(409,'stale_bot_event','This bot event is older than the last accepted event.');
    if (run.status !== 'processing' && !await this.fundBlock(run,Date.now())) { await this.finish(run,'stopped','tokens'); throw new BotError(402,'tokens','There are not enough AI tokens to continue the call.'); }
    let payload: unknown;
    if (event.type === 'status') {
      if (typeof event.status !== 'string' || event.status !== run.status && !NEXT[run.status].includes(event.status as BotStatus)) throw new BotError(409,'invalid_bot_transition','That bot status change is not available.');
      const status=event.status as BotStatus;
      if ((status==='processing' || status==='done' || status==='stopped' && ['recording','processing'].includes(run.status)) && !await this.uploadsComplete(run,event)) {
        await this.finish(run,'failed','processing_failed');
        return json({bot:botView(run)});
      }
      if (status==='done' && !await this.state.storage.get('drain_until')) {
        const session = await botSession(this.env,run);
        if (session.processing_stage !== 'done' || !run.participants_enc) throw new BotError(409,'bot_processing','The transcript is still being assembled.');
      }
      const failure=typeof event.failure_code==='string' && FAILED_CODES.has(event.failure_code) ? event.failure_code : status==='failed'?'runtime_failed':null;
      if (status==='done' || status==='failed' || status==='stopped') {
        const draining=await this.state.storage.get<number>('drain_until');
        await this.finish(run,draining && status==='done'?'stopped':status,draining?(await this.state.storage.get<string>('drain_reason'))??failure:failure);
      }
      else {
        await this.update(run,status);
        if (status==='recording') await this.env.DB.prepare("UPDATE interview_sessions SET status = 'recording', submitted_via = 'meeting_bot', recording_since = datetime('now'), started_at = COALESCE(started_at,datetime('now')) WHERE id = ? AND consent_status = 'given'").bind(run.session_id).run();
        if (status==='processing') {
          await this.endClock(run); await this.stopRuntime(run);
          await this.state.storage.setAlarm(Date.now()+1000);
        }
      }
      payload={status,failure_code:failure};
    } else if (event.type === 'heartbeat') {
      if (run.status!=='processing' && run.started_at!==null) {
        const runtime=meetingBotRuntime(this.env);
        // Renewal is part of the signed event acknowledgement: a failed host
        // lease must not grant more capture time. B2 retries the same seq/body;
        // only a successful renewal advances liveness (regression-tested).
        if (runtime.heartbeat) await withDeadline(runtime.heartbeat({uid:run.uid,deadline_at:run.started_at+run.limit_minutes*60_000,budget_deadline_at:(await this.lease())!}),5000,'bot heartbeat');
      }
      payload={};
    }
    else if (event.type === 'roster') {
      if (!Array.isArray(event.participants) || event.participants.length>500 || event.participants.some((p:any)=>!p || typeof p.id!=='string' || p.id.length>128 || typeof p.name!=='string' || p.name.length>160 || !int(p.joined_ms,run.limit_minutes*60_000) || (p.left_ms!==null && !int(p.left_ms,run.limit_minutes*60_000)))) throw new BotError(400,'invalid_bot_event','The bot roster is not valid.');
      payload={participants:event.participants.map((p:any)=>({id:p.id,name:p.name,joined_ms:p.joined_ms,left_ms:p.left_ms}))};
      const count=event.participants.filter((p:any)=>p.left_ms===null).length;
      await this.env.DB.prepare('UPDATE meeting_bots SET participant_count = ? WHERE uid = ?').bind(count,run.uid).run(); run.participant_count=count;
    } else if (event.type === 'speaker') {
      if (event.participant_id!==null && (typeof event.participant_id!=='string' || event.participant_id.length>128) || !int(event.at_ms,run.limit_minutes*60_000)) throw new BotError(400,'invalid_bot_event','The speaker event is not valid.');
      payload={participant_id:event.participant_id,at_ms:event.at_ms};
    } else if (event.type === 'chunk') {
      return this.ticket(run,event);
    } else throw new BotError(400,'invalid_bot_event','The bot event is not valid.');
    const aad=`${run.uid}:${event.seq}`;
    const enc=await encryptColumn(this.env,'meeting_bot_events','payload_enc',aad,JSON.stringify(payload));
    await this.env.DB.batch([
      this.env.DB.prepare('INSERT INTO meeting_bot_events(run_uid,seq,kind,payload_enc,received_at) VALUES(?,?,?,?,?)').bind(run.uid,event.seq,event.type,enc,Date.now()),
      this.env.DB.prepare('UPDATE meeting_bots SET heartbeat_at = ? WHERE uid = ?').bind(Date.now(),run.uid),
    ]);
    return json({bot:botView(run),budget_deadline_at:await this.lease()});
  }
  private async ticket(run: BotRun, event: Record<string,unknown>, record=true) {
    if (run.status!=='recording' && !await this.draining(run) || !int(event.chunk_seq,3599) || !int(event.size_bytes,MAX_CHUNK_BYTES) || Number(event.size_bytes)<=WAV_HEADER_BYTES || !int(event.start_ms,run.limit_minutes*60_000)) throw new BotError(400,'invalid_bot_chunk','The audio chunk is not valid.');
    if (event.participant_id !== undefined && event.participant_id !== null && (typeof event.participant_id !== 'string' || event.participant_id.length>128)) throw new BotError(400,'invalid_bot_chunk','The audio participant is not valid.');
    const seq=Number(event.chunk_seq), key=`chunk:${seq}`;
    const old=await this.state.storage.get<UploadTicket>(key);
    if (old?.used) throw new BotError(409,'chunk_already_uploaded','This audio chunk is already stored.');
    if (record) {
      const payload=JSON.stringify({chunk_seq:seq,size_bytes:event.size_bytes,start_ms:event.start_ms,participant_id:event.participant_id??null});
      const enc=await encryptColumn(this.env,'meeting_bot_events','payload_enc',`${run.uid}:${event.seq}`,payload);
      await this.env.DB.prepare('INSERT INTO meeting_bot_events(run_uid,seq,kind,payload_enc,received_at) VALUES(?,?,?,?,?)').bind(run.uid,event.seq,'chunk',enc,Date.now()).run();
    }
    const expires=Date.now()+BOT_CALLBACK_WINDOW_MS, jti=crypto.randomUUID();
    const token=`${expires}.${jti}.${await botHmac(this.env.MEETING_BOT_SECRET!,`upload:${run.uid}:${seq}:${expires}:${jti}`)}`;
    await this.state.storage.put(key,{token,seq,size:Number(event.size_bytes),start:Number(event.start_ms),expires,used:false} satisfies UploadTicket);
    return json({upload_path:`/api/meeting-bots/${run.uid}/chunks/${seq}?token=${encodeURIComponent(token)}`,expires_at:expires});
  }
  private async upload(req: Request, run: BotRun) {
    const seq=Number(req.headers.get('x-bot-chunk')), token=req.headers.get('x-bot-upload')??'';
    const ticket=await this.state.storage.get<UploadTicket>(`chunk:${seq}`);
    if (!ticket || ticket.used || ticket.expires<Date.now() || !constantTimeEqual(token,ticket.token)) throw new BotError(401,'invalid_upload','This upload permission is invalid or has already been used.');
    const draining=await this.draining(run);
    if (run.started_at === null || !draining && (Date.now() >= run.started_at + run.limit_minutes*60_000 || run.status!=='recording') || !await this.allowed(run)) throw new BotError(409,'bot_not_recording','The bot is no longer recording.');
    if (!draining && !await this.fundBlock(run,Date.now())) { await this.finish(run,'stopped','tokens'); throw new BotError(402,'tokens','There are not enough AI tokens to continue the call.'); }
    const session=await botSession(this.env,run);
    const bytes=await boundedBotBody(req,MAX_CHUNK_BYTES);
    if (bytes.byteLength!==ticket.size || !isUploadWav(new Uint8Array(bytes))) throw new BotError(415,'invalid_bot_audio','Use a 16 kHz mono PCM WAV chunk.');
    const duration=(bytes.byteLength-WAV_HEADER_BYTES)/UPLOAD_BYTES_PER_SECOND*1000;
    if (ticket.start+duration>Math.min(run.limit_minutes*60_000,draining?Math.max(0,run.ended_at!-run.started_at!):Infinity)) throw new BotError(413,'bot_time_limit','The bot audio exceeds the call time limit.');
    const held = await this.env.DB.prepare('SELECT COALESCE(SUM(size_bytes - ?),0) AS bytes FROM interview_session_chunks WHERE session_id = ?').bind(WAV_HEADER_BYTES,session.id).first<{bytes:number}>();
    const existing = await this.env.DB.prepare('SELECT seq FROM interview_session_chunks WHERE session_id = ? AND seq = ?').bind(session.id,seq).first();
    if (!existing && Number(held?.bytes??0)+bytes.byteLength-WAV_HEADER_BYTES > run.limit_minutes*60*UPLOAD_BYTES_PER_SECOND) throw new BotError(413,'bot_time_limit','The audio exceeds the call time limit.');
    const saved=await putChunk(this.env,session,run.user_id,seq,'audio/wav',bytes,ticket.start);
    try { await botSession(this.env,run); }
    catch {
      await this.env.FILES!.delete(saved.objectPath);
      await this.env.DB.prepare('DELETE FROM interview_session_chunks WHERE session_id = ? AND seq = ?').bind(session.id,seq).run();
      throw new BotError(409,'consent_required','The recording permission ended during upload.');
    }
    ticket.used=true; await this.state.storage.put(`chunk:${seq}`,ticket);
    return json({ok:true,seq,duplicate:saved.duplicate});
  }
}
