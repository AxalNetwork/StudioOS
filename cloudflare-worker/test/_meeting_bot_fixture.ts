/** Shared D886 route/SQLite/DO fixture. All meeting data is synthetic. */
import { Hono } from 'hono';
import { fixture, seed, call, mig, FOUNDER } from './_call_audio_fixture.ts';
import { MeetingBotRun as UnpublishedMeetingBotRun, botHmac } from '../src/durable-objects/meeting-bot-run.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
export const syntheticLink = (p='zoom') => p==='zoom' ? ['https:/','unit.zoom.us','j',String(111111111)].join('/')
  : p==='google_meet' ? ['https:/','meet.google.com','abc-defg-hij'].join('/')
    : ['https:/','teams.microsoft.com','meet','synthetic'].join('/');
export const hmacSecret = 'd886-'+'x'.repeat(40);
export function world(monthMicro=500_000_000, Supervisor=UnpublishedMeetingBotRun) {
  const w=fixture({monthMicro});
  if (!w.db.prepare('PRAGMA table_info(users)').all().some((c:any)=>c.name==='display_name')) w.db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  w.db.exec(mig('525_ai_reservation_idempotency.sql'));
  w.db.exec(mig('531_meeting_bots.sql'));
  w.db.exec(mig('532_meeting_bot_participants.sql'));
  const session=seed(w,{kind:'recorder',chunks:0,ageDays:0});
  w.db.prepare("UPDATE interview_sessions SET status='draft', processing_stage=NULL, consent_method='written', consent_at=datetime('now') WHERE id=?").run(session);
  w.db.prepare('DELETE FROM interview_transcript_segments WHERE session_id=?').run(session);
  const starts:any[]=[], stops:string[]=[], objects=new Map<string,any>();
  Object.assign(w.env,{AI_BILLING:'charged',MEETING_BOT:'on',MEETING_BOT_SECRET:hmacSecret,MEETING_BOT_COST_MICROUSD_PER_MINUTE:'10000',
    MEETING_BOT_RUNTIME:{ async start(run:any){starts.push(run);}, async stop(run:any){stops.push(run.uid);} }});
  w.env.MEETING_BOT_RUN={idFromName:(s:string)=>s,get(uid:string){
    if (!objects.has(uid)) {
      const data=new Map<string,any>(); let alarm:number|null=null; let tail=Promise.resolve();
      const state:any={storage:{async get(k:string){return structuredClone(data.get(k));},async put(k:string,v:any){data.set(k,structuredClone(v));},async list({prefix}:any){return new Map([...data].filter(([k])=>k.startsWith(prefix)));},async delete(keys:any){for(const k of [keys].flat())data.delete(k);},async getAlarm(){return alarm;},async setAlarm(t:number){alarm=t;},async deleteAlarm(){alarm=null;}},
        blockConcurrencyWhile(fn:any){const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
      const object=new Supervisor(state,w.env);objects.set(uid,{object,state,data,get alarm(){return alarm;}});
    }
    return {fetch:(r:Request)=>objects.get(uid).object.fetch(r)};
  }};
  return {...w,session,starts,stops,supervisors:objects};
}
export const post = (w:any,args:any={meeting_url:syntheticLink()})=>call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot`,args);
export async function event(w:any,uid:string,data:any,{timestamp=Date.now(),signature}:any={}) {
  // B1 follow-up completion declaration, as the aligned runtime sends it.
  if (data.type==='status' && ['processing','done'].includes(data.status) && !('chunks' in data)) {
    data={...data,chunks:w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id=?').get(w.session).n,chunks_failed:0};
  }
  const path=`/api/meeting-bots/${uid}/events`,raw=JSON.stringify(data),ts=String(timestamp);
  const sig=signature??await botHmac(hmacSecret,`v1:${ts}:POST:${path}:${raw}`);
  const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
  const response=await app.fetch(new Request('https://unit.invalid'+path,{method:'POST',headers:{'x-meeting-bot-timestamp':ts,'x-meeting-bot-signature':sig,'content-type':'application/json'},body:raw}),w.env);
  return {status:response.status,body:await response.json() as any};
}
export function wav(seconds=1) {
  const b=new ArrayBuffer(44+32000*seconds),v=new DataView(b),u=new Uint8Array(b);
  for (const [at,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const) for(let i=0;i<s.length;i++)u[at+i]=s.charCodeAt(i);
  v.setUint32(4,b.byteLength-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,b.byteLength-44,true);return b;
}
export async function upload(w:any,path:string,bytes=wav()) {
  const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
  const r=await app.fetch(new Request('https://unit.invalid'+path,{method:'PUT',body:bytes,headers:{'content-length':String(bytes.byteLength)}}),w.env);
  return {status:r.status,body:await r.json() as any};
}
