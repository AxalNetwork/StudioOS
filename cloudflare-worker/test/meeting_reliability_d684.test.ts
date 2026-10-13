/** D684 #1601. Actual SQLite refs and sessions; all provider requests mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import meetingsRouter, { zoomWebhook } from '../src/routes/founder_validate_meetings.ts';
import { MEET_TRANSCRIPT_SCOPE } from '../src/services/channels/googleMeet.ts';
import { openSession,writableInterview } from '../src/services/interviewIntake.ts';
import { decryptCredentials,encryptCredentials } from '../src/integrations/secrets.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import * as zoom from '../src/services/channels/zoom.ts';
import * as meeting from '../src/services/channels/meetings.ts';
import * as reg from '../src/integrations/registry.ts';

/** How the interviewee agreed: a call is scheduled only with consent recorded (#1470's rule). */
const CONSENT = { status: 'given', method: 'verbal' };
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const JWT_SECRET = 'd684-s18-fixture-only-signing-secret-0123456789';
const WEBHOOK_SECRET = 'zoom-webhook-fixture-secret';
const ME = 2, OTHER = 3, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101, THEIR_INTERVIEW = 501;
const MEETING_ID = '85746065432';
const MEET_CODE = 'abc-mnop-xyz';

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function world(over: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}), (${OTHER_PROJECT}, 'Not mine', 99);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES
      (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz'), (${THEIR_INTERVIEW}, ${OTHER_PROJECT}, 'Theirs');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      pkce_verifier TEXT, extra_json TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const t of ['integrations', 'google_oauth_tokens', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql', '454_channel_voice_failures.sql']) db.exec(mig(m));
  const jobs: any[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-client-id', ZOOM_CLIENT_SECRET: 'zoom-client-secret', ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_SECRET,
    GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret', PUBLIC_BASE_URL: 'https://axal.test',
    APP_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(body: unknown) { jobs.push(body); } },
    ...over,
  };
  return { env, db, jobs };
}
type World = ReturnType<typeof world>;

const count = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);

async function connectZoom(f: World, creds: Record<string, unknown> = {}, userId = ME) {
  const uid = `zoom-${userId}`;
  const enc = await encryptCredentials(f.env, uid, {
    access_token: 'zoom-at', refresh_token: 'zoom-rt', token_type: 'bearer', expires_at: Date.now() + HOUR, ...creds,
  });
  f.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, credentials_enc)
                VALUES (?, ?, 'zoom', 'active', 'oauth2', ?)`).run(uid, userId, enc);
}

async function connectGoogle(f: World, scope: string, userId = ME) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(userId, await encryptString(f.env, 'google-refresh-token'), scope);
}
const GRANTED = `https://www.googleapis.com/auth/calendar.events openid ${MEET_TRANSCRIPT_SCOPE}`;
const NO_MEET = 'https://www.googleapis.com/auth/calendar.events openid';

/** A ref as the POST route leaves it, last looked at long ago (so a sweep finds it due). */
async function seedRef(f: World, over: Partial<{ provider: string; external_ref: string; status: string; ends_at: string; join_url: string }> = {}) {
  const provider = (over.provider ?? 'zoom') as 'zoom' | 'google_meet';
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const session = await openSession(f.env, scoped, provider, 'video');
  const uid = crypto.randomUUID();
  f.db.prepare(`INSERT INTO interview_channel_refs
      (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01 00:00:00')`).run(
    uid, provider, over.external_ref ?? (provider === 'zoom' ? MEETING_ID : 'evt0123abc'), session.id, INTERVIEW, ME,
    over.join_url ?? (provider === 'zoom' ? 'https://zoom.us/j/85746065432?pwd=x' : `https://meet.google.com/${MEET_CODE}`),
    iso(-2 * HOUR), over.ends_at ?? iso(-HOUR), over.status ?? 'scheduled');
  return { uid, sessionId: session.id };
}
const refRow = (f: World, uid: string) => f.db.prepare('SELECT * FROM interview_channel_refs WHERE uid = ?').get(uid);

// ── fetch ─────────────────────────────────────────────────────────────────────

type Handler = (url: URL, init: any) => Response | Promise<Response>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Routes are `METHOD origin+path`; a request nothing matches throws, so no test reaches a provider. */
function mockFetch(t: any, routes: Record<string, Handler>) {
  const calls: { key: string; url: URL; headers: Headers; body: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    const body = init.body == null ? null : String(init.body);
    calls.push({ key, url, headers: new Headers(init.headers), body });
    const handler = routes[key] ?? (/^GET https:\/\/api\.zoom\.us\/v2\/past_meetings\/\d+\/instances$/.test(key) ? (() => json({ meetings: [] })) : undefined);
    if (!handler) throw new Error(`unmocked fetch: ${key}`);
    return handler(url, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', meetingsRouter as any);
  a.route('/api/channels', zoomWebhook as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const hmac = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex');
function signed(body: string, { ts = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET } = {}) {
  return { 'x-zm-signature': `v0=${hmac(secret, `v0:${ts}:${body}`)}`, 'x-zm-request-timestamp': String(ts), 'content-type': 'application/json' };
}
async function zoomPost(env: any, payload: unknown, headers?: Record<string, string>) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = await app.fetch(new Request('http://x/api/channels/zoom/webhook', {
    method: 'POST', headers: headers ?? signed(body), body,
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const transcriptEvent = (id: string | number = Number(MEETING_ID), uuid = 'Mtg+uuid==') => ({
  event: 'recording.transcript_completed', event_ts: Date.now(),
  payload: {
    // Host and account fields are Zoom's view of the world; tenancy never reads them.
    account_id: 'some-other-account', object: {
      id, uuid, host_id: 'someone-else', topic: 'Customer interview',
      recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.us/rec/download/not-used-from-payload' }],
    },
  },
});

const VTT = [
  'WEBVTT', 'Kind: captions', '',
  'NOTE Zoom audio transcript', 'spans two lines', '',
  '1', '00:00:01.200 --> 00:00:04.000', 'Dana Ruiz: We lose a day a month', 'to reconciling invoices.', '',
  '2', '00:00:04.500 --> 00:00:07.000 align:start position:10%', 'Sam Founder: Who signs off?', '', '', '',
  '3', '00:00:07.000 --> 00:00:09.250', 'Dana Ruiz: The CFO &amp; me.', '',
].join('\r\n');

const zoomRecordings = (files: unknown[]) => json({ uuid: 'Mtg+uuid==', id: Number(MEETING_ID), recording_files: files });
const TRANSCRIPT_FILE = { file_type: 'TRANSCRIPT', file_extension: 'VTT', status: 'completed', recording_type: 'audio_transcript',
  download_url: 'https://zoom.us/rec/download/transcript-file' };


const real={zoom,meeting,route:meetingsRouter,reg};
const snap=(got:unknown,want:unknown)=>assert.deepEqual(got,want);
async function http(route:any,env:any,method:string,path:string){
 const a=new Hono<any>();a.route('/api/founder/validate',route);a.onError((e,c)=>c.json({error:e.message},500));
 const token=await new SignJWT({user_id:ME,role:'founder'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
 const r=await a.request('/api/founder/validate'+path,{method,headers:{Authorization:'Bearer '+token}},env);return{status:r.status,body:await r.json() as any};
}
async function withFetch(routes:Record<string,Handler>,run:()=>Promise<void>){
 const saved=globalThis.fetch;globalThis.fetch=(async(input:any,init:any={})=>{const url=new URL(typeof input==='string'?input:input.url),key=(init.method??'GET')+' '+url.origin+url.pathname;
 const handler=routes[key];if(!handler)throw new Error('unmocked_fixture_request');return handler(url,init);}) as typeof fetch;
 try{await run();}finally{globalThis.fetch=saved;}
}
const part=(uuid:string,started:string)=>json({uuid,start_time:started,recording_files:[{file_type:'TRANSCRIPT',status:'completed',download_url:'https://zoom.us/rec/download/'+uuid}]});
async function ready(f:World){await connectZoom(f);const ref=await seedRef(f,{status:'ended'});f.db.prepare("UPDATE interview_sessions SET consent_status='given',consent_method='verbal' WHERE id=?").run(ref.sessionId);return ref;}
const checks=[
 {name:'Later lookup failures persist on the instance without replacing the imported first part',module:'zoom',before:"if (named) {\n        const instance = await bindInstance",after:"if (false) {\n        const instance = await bindInstance",run:async m=>{
 const f=world(),ref=await ready(f),start=String(refRow(f,ref.uid).starts_at);let status=403;
 await withFetch({'GET https://api.zoom.us/v2/meetings/first/recordings':()=>part('first',start),'GET https://zoom.us/rec/download/first':()=>new Response(VTT),
 'GET https://api.zoom.us/v2/meetings/later/recordings':()=>json({code:status===403?4711:0},status)},async()=>{
 await m.zoom.importZoomRef(f.env,refRow(f,ref.uid),{meetingUuid:'first'});const got=[];
 for(const st of [403,400,503]){status=st;const out=await m.zoom.importZoomRef(f.env,refRow(f,ref.uid),{meetingUuid:'later'});
 const row:any=f.db.prepare("SELECT * FROM interview_channel_refs WHERE external_ref=?").get(MEETING_ID+':later');
 got.push([out.code,row?.status,m.meeting.errorCodeOf(row?.last_error??null),refRow(f,ref.uid).status]);}
 snap(got,[['zoom_reconnect','failed','zoom_reconnect','imported'],['zoom_fetch_failed','failed','zoom_fetch_failed','imported'],['zoom_unreachable','failed','zoom_unreachable','imported']]);
 });f.db.close();}},
 {name:'Past-instance discovery recovers a missed restart and excludes a different slot',module:'zoom',before:"const within = instances.filter(instance => withinCallSlot(instance.started, ref));",after:"const within = [];",run:async m=>{
 const f=world(),ref=await ready(f),start=Date.parse(refRow(f,ref.uid).starts_at);
 await withFetch({'GET https://api.zoom.us/v2/meetings/first/recordings':()=>part('first',new Date(start).toISOString()),
 'GET https://api.zoom.us/v2/meetings/later/recordings':()=>part('later',new Date(start+40*60_000).toISOString()),
 'GET https://zoom.us/rec/download/first':()=>new Response(VTT),'GET https://zoom.us/rec/download/later':()=>new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nA second part.\n'),
 ['GET https://api.zoom.us/v2/past_meetings/'+MEETING_ID+'/instances']:()=>json({meetings:[{uuid:'first',start_time:new Date(start).toISOString()},{uuid:'later',start_time:new Date(start+40*60_000).toISOString()},{uuid:'outside',start_time:new Date(start+7*24*HOUR).toISOString()}]})},async()=>{
 await m.zoom.importZoomRef(f.env,refRow(f,ref.uid),{meetingUuid:'first'});const out=await m.zoom.importZoomRef(f.env,refRow(f,ref.uid));
 const all=f.db.prepare("SELECT external_ref,status FROM interview_channel_refs WHERE instr(external_ref,':')>0 ORDER BY external_ref").all();
 snap([out.status,all.map((r:any)=>[r.external_ref,r.status])],['imported',[[MEETING_ID+':first','imported'],[MEETING_ID+':later','imported']]]);
 });f.db.close();}},
 {name:'The sweep revisits recently imported root calls without revisiting old calls',module:'zoom',before:"importedAfter: new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString(),",after:"importedAfter: undefined,",run:async m=>{
 const f=world();await connectZoom(f);const recent=await seedRef(f,{status:'imported',ends_at:iso(-25*HOUR)});await seedRef(f,{status:'imported',ends_at:iso(-8*24*HOUR),external_ref:'11111111111'});
 snap([await m.zoom.sweepZoom(f.env,new Date()),f.jobs.map(j=>j.payload.refUid),await m.zoom.sweepZoom(f.env,new Date())],[1,[recent.uid],0]);f.db.close();}},
 {name:'Token body stalls are bounded below the rotation lease and release the held credentials',module:'zoom',before:"const TOKEN_DEADLINE_MS = 10_000;",after:"const TOKEN_DEADLINE_MS = 35_000;",run:async m=>{
 const f=world();await connectZoom(f,{expires_at:Date.now()-1000});const timers:number[]=[];let signal=false,code='';const saved=globalThis.setTimeout;
 globalThis.setTimeout=((fn:any,ms:any,...args:any[])=>{timers.push(ms);return saved(fn,1,...args);}) as typeof setTimeout;
 try{await withFetch({'POST https://zoom.us/oauth/token':(_u,init)=>{signal=!!init.signal;return {ok:true,status:200,json:()=>new Promise(()=>{})} as any;}},async()=>{
 const conn=await m.zoom.zoomConnection(f.env,ME);try{await m.zoom.createMeeting(f.env,conn!,{topic:'Fixture',startsAt:iso(HOUR),durationMin:30});}catch(e:any){code=e.code;}
 });}finally{globalThis.setTimeout=saved;}
 const row:any=f.db.prepare("SELECT uid,credentials_enc FROM integrations WHERE provider_key='zoom'").get(),creds:any=await decryptCredentials(f.env,row.uid,row.credentials_enc);
 snap([timers[0],signal,code,creds.refresh_lease??null,creds.refresh_token],[10000,true,'zoom_unreachable',null,'zoom-rt']);f.db.close();}},
 {name:'An unconfirmed cancellation survives GET and a repeated cancel',module:'route',before:"providerCancelled === false ? (ref.provider === 'zoom' ? 'zoom_cancel_unconfirmed' : 'meet_cancel_unconfirmed') : null",after:"null",run:async m=>{
 const f=world();await connectZoom(f);const ref=await seedRef(f,{ends_at:iso(HOUR)});
 await withFetch({['DELETE https://api.zoom.us/v2/meetings/'+MEETING_ID]:()=>json({},503)},async()=>{
 const path='/interviews/'+INTERVIEW+'/meetings/'+ref.uid;const first=await http(m.route,f.env,'DELETE',path),list=await http(m.route,f.env,'GET','/interviews/'+INTERVIEW+'/meetings'),second=await http(m.route,f.env,'DELETE',path);
 const stored=list.body.meetings[0];snap([first.status,first.body.provider_cancelled,stored.provider_cancelled,stored.error_code,second.body.provider_cancelled],[200,false,false,'zoom_cancel_unconfirmed',false]);
 });f.db.close();}},
 {name:'Import-now failures offer manual retry without promising an automatic retry',module:'meeting',before:"Zoom did not answer. Try again in a minute.",after:"Zoom did not answer. Axal will try again.",run:async m=>{
 snap([/will try again/i.test(m.meeting.MEETING_ERRORS.zoom_unreachable),/will try again/i.test(m.meeting.MEETING_ERRORS.meet_unreachable),/Try again/.test(m.meeting.MEETING_ERRORS.zoom_unreachable)],[false,false,true]);}},
 {name:'The transcript mirror retains each provider session once',module:'meeting',before:"s.submitted_via IN ('zoom','google_meet')",after:"s.submitted_via = 'google_meet'",run:async m=>{
 const f=world();const a=await seedRef(f,{external_ref:'11111111111'}),b=await seedRef(f,{external_ref:'22222222222'});
 await m.meeting.importMeetingRef(f.env,refRow(f,a.uid),async()=>({kind:'segments',segments:[{speaker:'Fixture',text:'First part.'}]}));
 await m.meeting.importMeetingRef(f.env,refRow(f,b.uid),async()=>({kind:'segments',segments:[{speaker:'Fixture',text:'Second part.'}]}));
 await m.meeting.importMeetingRef(f.env,refRow(f,a.uid),async()=>({kind:'segments',segments:[{speaker:'Fixture',text:'Duplicate.'}]}));
 const interview:any=f.db.prepare('SELECT transcript FROM discovery_interviews WHERE id=?').get(INTERVIEW);
 snap([interview.transcript,count(f.db,"SELECT COUNT(*) n FROM interview_transcript_segments WHERE source='final'")],['First part.\nSecond part.',2]);f.db.close();}},
 {name:'The registry requests past-instance scope with a plain permission',module:'reg',before:"'meeting:read:list_past_instances',",after:"",run:async m=>{
 snap([m.reg.getDescriptor('zoom')!.oauth_scopes!.includes('meeting:read:list_past_instances'),m.reg.CONNECTOR_METADATA.zoom.permissions.some((s:string)=>/past meeting instances/.test(s))],[true,true]);}},
 {name:'An imported Zoom root can run discovery on the manual import route',module:'route',before:"if (ref.status === 'imported' && (ref.provider !== 'zoom' || zoom.instanceOf(ref)))",after:"if (ref.status === 'imported')",run:async m=>{
 const f=world();await connectZoom(f);const ref=await seedRef(f,{status:'imported'});
 await withFetch({['GET https://api.zoom.us/v2/past_meetings/'+MEETING_ID+'/instances']:()=>json({meetings:[]})},async()=>{
 const r=await http(m.route,f.env,'POST','/interviews/'+INTERVIEW+'/meetings/'+ref.uid+'/import');snap([r.status,r.body.outcome],[200,'skipped']);
 });f.db.close();}},
];
for(const c of checks)test(c.name,()=>c.run(real));
let serial=0;
async function mutant(c:any){
 const paths={zoom:'../src/services/channels/zoom.ts',meeting:'../src/services/channels/meetings.ts',route:'../src/routes/founder_validate_meetings.ts',reg:'../src/integrations/registry.ts'};
 const file=new URL(paths[c.module as keyof typeof paths],import.meta.url);let src=readFileSync(file,'utf8');
 if(!src.includes(c.before))throw new Error('mutation_target_missing: '+c.name);
 src=stripTypeScriptTypes(src.replace(c.before,c.after),{mode:'strip'});
 src=src.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,(_a,b,path,end)=>b+(path.startsWith('.')?new URL(/\.(?:ts|mjs|js)$/.test(path)?path:path+'.ts',file).href:import.meta.resolve(path))+end);
 const loaded=await import('data:text/javascript;base64,'+Buffer.from(src+'\n// mutant '+serial++).toString('base64'));return{...real,[c.module]:c.module==='route'?loaded.default:loaded};
}
for(const c of checks)test('Mutation and restoration: '+c.name,async()=>{await c.run(real);await assert.rejects(c.run(await mutant(c)),assert.AssertionError);await c.run(real);});
