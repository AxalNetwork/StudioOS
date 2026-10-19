/** D686 #1592. Actual SQL and JWT routes; provider calls are mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import * as routes from '../src/routes/integrations.ts';
import * as registry from '../src/integrations/registry.ts';
import * as labels from '../src/integrations/moduleLabels.ts';
import * as fed from '../src/integrations/fed.ts';
import * as cal from '../src/routes/calendar.ts';
import * as li from '../src/routes/linkedin.ts';
import * as stripe from '../src/integrations/providers/stripe.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { issueOauthState,consumeOauthState } from '../src/integrations/oauth.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const migration = readFileSync('cloudflare-worker/sql/migrations/435_connector_companies.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE project_metrics(id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE discovery_interviews(id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider_key));
    INSERT INTO users(id, role, name, email, subscription_tier) VALUES (1, 'founder', 'First', 'first@example.test', 'growth'), (2, 'founder', 'Second', 'second@example.test', 'free'), (3, 'admin', 'Owner', 'owner@example.test', 'free');
    INSERT INTO super_admins VALUES (3);
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO user_company_links VALUES (1, 10), (1, 20), (2, 10), (3, 10);
    INSERT INTO projects VALUES (100, 10, NULL), (200, 20, NULL);`);
  db.exec(migration);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/457_integrations_last_error_at.sql', 'utf8'));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  return { db, env };
}

async function auth(userId = 1) {
  return new SignJWT({ user_id: userId, role: userId === 3 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

type Mods = { route: typeof routes; reg: typeof registry; labels: typeof labels; fed: typeof fed; cal: typeof cal; li: typeof li; stripe: typeof stripe };
const real: Mods = { route: routes, reg: registry, labels, fed, cal, li, stripe };
const snap = (a: unknown, b: unknown) => assert.deepEqual(a,b);
function appFor(m:Mods) {
 const a=new Hono<any>(); a.route('/api/connectors',m.route.default); a.route('/api/calendar',m.cal.default); a.route('/api/linkedin',m.li.default);
 a.onError((e,c)=>c.json({error:e.message},500)); return a;
}
async function req(a:any,env:any,path:string,method='GET',body?:unknown,id=1,cookie='') {
 try { return await a.request(path,{method,headers:{Authorization:'Bearer '+await auth(id),'X-Company-Id':'10','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
 ...(body===undefined?{}:{body:JSON.stringify(body)})},env); } catch (e) { if (e instanceof Response) return e; throw e; }
}
function fake(mode='ok',capture?:(config:any)=>void) {
 registry.registerProvider({key:'slack',async buildAuthorizeUrl(_c,_u,state){return 'https://provider.example.test/authorize?state='+encodeURIComponent(state);},
 async connect(_c,_u,input){capture?.(input.config);if(mode==='fail')throw new Error('fixture_exchange_failed');
 return {credentials:{},scopes:mode==='overreach'?['admin']:['incoming-webhook'],config:input.config};}});
}
async function redirect(m:Mods,mode:string,token:unknown,key='slack') {
 const {db,env}=fixture(); fake(mode); const state=await issueOauthState(env,1,key,'fixture',{company_id:10,return_to:token});
 const r=await req(appFor(m),env,'/api/connectors/oauth/'+key+'/callback?code=fixture&state='+encodeURIComponent(state));
 const out=[r.status,r.headers.get('location')];db.close();return out;
}
async function mock<T>(fn:(url:string)=>Response,run:()=>Promise<T>){const old=globalThis.fetch;
 globalThis.fetch=((url:any)=>Promise.resolve(fn(String(url)))) as typeof fetch;try{return await run();}finally{globalThis.fetch=old;}}
const res=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
function calEnv(env:any){Object.assign(env,{GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',MICROSOFT_CLIENT_ID:'fixture',MICROSOFT_CLIENT_SECRET:'fixture',APP_URL:'https://app.axal.vc',PUBLIC_BASE_URL:'https://app.axal.vc'});}
type Check={name:string;module:keyof Mods;before:string;after:string;secondBefore?:string;secondAfter?:string;run:(m:Mods)=>Promise<void>};
const checks:Check[]=[
 {name:'Recorded feed counts include the same module doors',module:'fed',before:"href: moduleHref(m), count,",after:"href: null, count,",run:async m=>{
 const {db,env}=fixture();db.exec("CREATE TABLE connector_fed_items(integration_id INTEGER,module TEXT,local_id INTEGER); INSERT INTO connector_fed_items VALUES(11,'product_roadmap',7),(11,'product_roadmap',NULL)");
 snap((await m.fed.fedCounts(env,11,'github')).map(x=>[x.module,x.href,x.count,x.linked,x.unlanded]),
 [['product_roadmap','/build/product-roadmap',2,1,1],['prototype_mvp','/build/prototype-mvp',0,0,0],['operating_systems','/build/operating-systems',null,null,null],['solution_design','/build/solution-design',0,0,0],['founding_team','/build/founding-team',0,0,0],['company_creation','/build/company-creation',0,0,0]]);db.close();}},
 {name:'Stripe cron records failure time and clears it after recovery',module:'stripe',before:"await env.DB.prepare('UPDATE integrations SET last_error = ?, last_error_at = CURRENT_TIMESTAMP WHERE id = ?').bind(msg, row.id).run();\n      } catch",after:"await env.DB.prepare('UPDATE integrations SET last_error = ? WHERE id = ?').bind(msg, row.id).run();\n      } catch",run:async m=>{
 const {db,env}=fixture();const enc=await encryptCredentials(env,'cron-fixture',{access_token:'fixture-token'});
 db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,credentials_enc) VALUES(11,'cron-fixture',1,'stripe','oauth2',?)").run(enc);
 db.exec("INSERT INTO integration_companies(integration_id,company_id) VALUES(11,10)");
 let fail=true;await mock(()=>fail?new Response('{}',{status:503}):res({data:[],has_more:false}),async()=>{
 const first=await m.stripe.syncAllStripeIntegrations(env);const row:any=db.prepare('SELECT last_error,last_error_at FROM integrations WHERE id=11').get();fail=false;
 const second=await m.stripe.syncAllStripeIntegrations(env);const recovered:any=db.prepare('SELECT last_error,last_error_at FROM integrations WHERE id=11').get();
 snap([first,!!row.last_error,!!row.last_error_at,second,recovered.last_error,recovered.last_error_at],
 [{scanned:1,ok:0,failed:1},true,true,{scanned:1,ok:1,failed:0},null,null]);});db.close();}},

 {name:'OAuth start accepts only literal build in signed state',module:'route',before:"if (c.req.query('return_to') === 'build')",after:"if (false)",run:async m=>{
 const {db,env}=fixture();fake();const got=[];for(const token of ['build','https://evil.example','/x','BUILD']){
 const r=await req(appFor(m),env,'/api/connectors/oauth/slack/start?return_to='+encodeURIComponent(token));const b:any=await r.json();
 const state=b.state?await consumeOauthState(env,1,'slack',b.state):null;got.push([r.status,state?.extra.return_to??null]);}
 snap(got,[[200,'build'],[200,null],[200,null],[200,null]]);db.close();}},
 {name:'OAuth success uses verified destination',module:'route',before:"extra?.return_to === 'build'",after:"false",run:async m=>{
 snap([await redirect(m,'ok','build'),await redirect(m,'ok','/build/connect')],[[302,'/build/connect?oauth=ok&provider=slack'],[302,'/integrations?oauth=ok&provider=slack']]);}},
 {name:'Provider error consumes state before recovering destination',module:'route',before:"return c.redirect(returnQuery(consumed?.extra, `oauth=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(/^",after:"return c.redirect(returnQuery(null, `oauth=error&provider=${encodeURIComponent(provider)}&reason=${encodeURIComponent(/^",run:async m=>{
 const {db,env}=fixture();fake();const state=await issueOauthState(env,1,'slack','fixture',{return_to:'build'});const a=appFor(m);
 const good=await req(a,env,'/api/connectors/oauth/slack/callback?error=access_denied&state='+encodeURIComponent(state));
 const bad=await req(a,env,'/api/connectors/oauth/slack/callback?error=access_denied&state=invalid');
 snap([good.headers.get('location'),bad.headers.get('location'),await consumeOauthState(env,1,'slack',state)],
 ['/build/connect?oauth=error&provider=slack&reason=access_denied','/integrations?oauth=error&provider=slack&reason=access_denied',null]);db.close();}},
 {name:'Overreach, exchange failure and rolling-out preserve Build destination',module:'route',before:"extra?.return_to === 'build'",after:"false",run:async m=>{
 snap([await redirect(m,'overreach','build'),await redirect(m,'fail','build'),await redirect(m,'ok','build','figma')],
 [[302,'/build/connect?oauth=error&provider=slack&reason=scope_overreach'],[302,'/build/connect?oauth=error&provider=slack&reason=fixture_exchange_failed'],[302,'/build/connect?oauth=rolling_out&provider=figma']]);}},
 {name:'Return token is excluded from provider config and persisted config',module:'route',before:"...providerExtra },",after:"...consumed.extra },",run:async m=>{
 const {db,env}=fixture();let config:any;fake('ok',v=>{config=v;});const state=await issueOauthState(env,1,'slack','fixture',{company_id:10,return_to:'build'});
 const r=await req(appFor(m),env,'/api/connectors/oauth/slack/callback?code=fixture&state='+encodeURIComponent(state));
 const row:any=db.prepare("SELECT config_json FROM integrations WHERE provider_key='slack'").get();
 snap([r.status,config.return_to??null,JSON.parse(row.config_json).return_to??null,config.pkce_verifier],[302,null,null,'fixture']);db.close();}},
 {name:'Figma is coming soon without granted permissions or placeholder providers',module:'reg',before:"status: 'coming_soon', tier: 'free'",after:"status: 'live', tier: 'free'",run:async m=>{
 const d=m.reg.getDescriptor('figma')!,p:any=m.reg.publicDescriptor(d);
 snap([d.status,d.integration_type,d.oauth_scopes??[],p.category,p.permissions,p.feeds,p.feed_modules,
 m.reg.REGISTRY.filter(d=>/Accounting tool|Payroll tool|^\[Bank\]$/.test(d.display_name)).length],
 ['coming_soon','data_feed',[],'Design',[],['prototype_mvp'],[{key:'prototype_mvp',label:'Prototype / MVP',href:'/build/prototype-mvp'}],0]);}},
 {name:'Workspace descriptors retain names and expose both feed doors',module:'reg',before:"google_calendar: { category: 'Calendar and workspace'",after:"google_calendar: { category: 'Calendar'",run:async m=>{
 const got:any[]=['google_calendar','microsoft_365'].map(k=>m.reg.publicDescriptor(m.reg.getDescriptor(k)!));
 snap(got.map(p=>[p.display_name,p.category,p.feeds,p.feed_modules.map((x:any)=>x.href)]),
 [['Google Calendar','Calendar and workspace',['customer_research','operating_systems'],['/validate/customer-research','/build/operating-systems']],
 ['Microsoft 365','Calendar and workspace',['customer_research','operating_systems'],['/validate/customer-research','/build/operating-systems']]]);}},
 {name:'feed_modules is beside unchanged string feeds',module:'reg',before:"feed_modules: feeds.map",after:"wrong_modules: feeds.map",run:async m=>{
 const p:any=m.reg.publicDescriptor(m.reg.getDescriptor('github')!);snap([p.feeds,p.feed_modules],
 [['product_roadmap','prototype_mvp','operating_systems','solution_design','founding_team','company_creation'],[{key:'product_roadmap',label:'Product roadmap',href:'/build/product-roadmap'},{key:'prototype_mvp',label:'Prototype / MVP',href:'/build/prototype-mvp'},{key:'operating_systems',label:'Operating systems',href:'/build/operating-systems'},{key:'solution_design',label:'Solution design',href:'/build/solution-design'},{key:'founding_team',label:'Founding team',href:'/build/founding-team'},{key:'company_creation',label:'Company creation',href:'/build/company-creation'}]]);}},
 {name:'Unknown keys including inherited properties have no href',module:'labels',before:"Object.hasOwn(MODULE_HREFS, key)",after:"true",run:async m=>{
 snap(['unknown','__proto__','constructor'].map(k=>m.labels.moduleHref(k)),[null,null,null]);}},
 {name:'Unrecorded feed counts still include module doors',module:'fed',before:"href: moduleHref(m)",after:"href: null",run:async m=>{
 snap((await m.fed.fedCounts({} as any,1,'stripe')).map(x=>[x.module,x.href,x.count]),[['revenue_and_traction','/grow/revenue-and-traction',null],['customers','/grow/customers',null]]);}},
 {name:'Free syncs an existing paid connection but cannot connect a new one',module:'route',before:"// D686: an existing connection keeps syncing after a downgrade.",after:"const desc = getDescriptor(row.provider_key); if (desc && desc.tier !== 'free') ensureTier(user, desc.tier as 'growth' | 'studio');",run:async m=>{
 const {db,env}=fixture();let calls=0;db.exec("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type) VALUES(11,'paid-existing',2,'carta','oauth2'); INSERT INTO integration_companies(integration_id,company_id) VALUES(11,10)");
 registry.registerProvider({key:'carta',async connect(){return {credentials:{}};},async sync(){calls++;return {summary:'fixture'};}});
 const a=appFor(m),sync=await req(a,env,'/api/connectors/paid-existing/sync','POST',{},2),connect=await req(a,env,'/api/connectors/connect','POST',{provider_key:'carta'},2);
 snap([sync.status,connect.status,calls],[200,402,1]);db.close();}},
 {name:'Manual sync stores failure time, exposes it and clears it on success',module:'route',before:"last_error = ?, last_error_at = CURRENT_TIMESTAMP",after:"last_error = ?",run:async m=>{
 const {db,env}=fixture();let fail=true;db.exec("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type) VALUES(11,'own-sync',1,'slack','oauth2')");
 registry.registerProvider({key:'slack',async connect(){return {credentials:{}};},async sync(){if(fail)throw new Error('fixture_sync_failed');return {summary:'fixture'};}});
 const a=appFor(m),first=await req(a,env,'/api/connectors/own-sync/sync','POST',{});
 const row:any=db.prepare('SELECT last_error_at FROM integrations WHERE id=11').get();
 const read:any=await (await req(a,env,'/api/connectors')).json();fail=false;
 const second=await req(a,env,'/api/connectors/own-sync/sync','POST',{});
 const cleared:any=db.prepare('SELECT last_error,last_error_at FROM integrations WHERE id=11').get();
 snap([first.status,!!row.last_error_at,read.items[0].last_error_at===row.last_error_at,second.status,cleared.last_error,cleared.last_error_at],[502,true,true,200,null,null]);db.close();}},
 {name:'Google and Microsoft start set Build return cookies',module:'cal',before:"returnTo === 'integrations' || returnTo === 'build'",after:"returnTo === 'integrations'",run:async m=>{
 const {db,env}=fixture();calEnv(env);const a=appFor(m),g=await req(a,env,'/api/calendar/google/start?return_to=build'),ms=await req(a,env,'/api/calendar/microsoft/start?return_to=build');
 snap([g.status,g.headers.get('set-cookie')?.includes('studioos_cal_return=build')??false,ms.status,ms.headers.get('set-cookie')?.includes('studioos_cal_return=build')??false],[200,true,200,true]);db.close();}},
 {name:'Build Google email mismatch persists no token',module:'cal',before:"(returnTo === 'integrations' || returnTo === 'build') && !emailsMatch",after:"returnTo === 'integrations' && !emailsMatch",run:async m=>{
 const {db,env}=fixture();calEnv(env);const a=appFor(m),start:any=await (await req(a,env,'/api/calendar/google/start?return_to=build')).json();
 const state=new URL(start.redirect_url).searchParams.get('state');
 await mock(url=>url.includes('/token')?res({access_token:'fixture-access',refresh_token:'fixture-refresh'}):res({id:'fixture-google-id',email:'other@example.test',verified_email:true}),async()=>{
 const r=await req(a,env,'/api/calendar/google/callback?code=fixture&state='+encodeURIComponent(state!),'GET',undefined,1,'studioos_cal_return=build');
 const count:any=db.prepare('SELECT COUNT(*) n FROM google_oauth_tokens').get();
 snap([r.status,r.headers.get('location')?.includes('/build/connect?google=error')??false,count.n],[302,true,0]);});db.close();}},
 {name:'Calendar error callbacks return to Build',module:'cal',before:"parseReturn(returnTo).kind === 'build' ?",after:"false ?",run:async m=>{
 const {db,env}=fixture();calEnv(env);const r=await req(appFor(m),env,'/api/calendar/google/callback?error=access_denied','GET',undefined,1,'studioos_cal_return=build');
 snap([r.status,r.headers.get('location')],[302,'https://app.axal.vc/build/connect?google=error&reason=access_denied']);db.close();}},
 {name:'LinkedIn start and denied callback return to Build',module:'li',before:"kind === 'build' ? '/build/connect'",after:"false ? '/build/connect'",run:async m=>{
 const {db,env}=fixture();Object.assign(env,{LINKEDIN_CLIENT_ID:'fixture',LINKEDIN_CLIENT_SECRET:'fixture',APP_URL:'https://app.axal.vc'});
 const kv=new Map<string,string>();env.RATE_LIMITS={get:async(k:string)=>kv.get(k),put:async(k:string,v:string)=>{kv.set(k,v);},delete:async(k:string)=>{kv.delete(k);}};
 const a=appFor(m),start=await req(a,env,'/api/linkedin/oauth/start?return_to=build','POST',{}),back=await req(a,env,'/api/linkedin/oauth/callback?error=access_denied','GET',undefined,1,'studioos_li_return=build');
 snap([start.status,start.headers.get('set-cookie')?.includes('studioos_li_return=build')??false,back.status,back.headers.get('location')?.startsWith('https://app.axal.vc/build/connect?linkedin=error')??false],[200,true,302,true]);db.close();}},

 // #1597: Build's venture rides in the signed state, so the return names it on the callback's host, where no cookie or sessionStorage is.
 {name:'Registry return carries Build\'s venture from the signed state',module:'route',before:"? `&project_id=${id}` : ''",after:"? '' : ''",run:async m=>{
 const {db,env}=fixture();fake();const a=appFor(m),got=[];
 for(const q of ['return_to=build&project_id=7','return_to=build&project_id=abc','return_to=build&project_id=-3','project_id=7']){
  const b:any=await (await req(a,env,'/api/connectors/oauth/slack/start?'+q)).json();
  const r=await req(a,env,'/api/connectors/oauth/slack/callback?error=access_denied&state='+encodeURIComponent(b.state));got.push(r.headers.get('location'));}
 snap(got,['/build/connect?oauth=error&provider=slack&reason=access_denied&project_id=7','/build/connect?oauth=error&provider=slack&reason=access_denied',
  '/build/connect?oauth=error&provider=slack&reason=access_denied','/integrations?oauth=error&provider=slack&reason=access_denied']);db.close();}},
 {name:'The venture is not handed to the provider\'s config',module:'route',before:"project_id: _projectId, ...providerExtra",after:"...providerExtra",run:async m=>{
 const {db,env}=fixture();let config:any;fake('ok',v=>{config=v;});const state=await issueOauthState(env,1,'slack','fixture',{company_id:10,return_to:'build',project_id:7});
 const r=await req(appFor(m),env,'/api/connectors/oauth/slack/callback?code=fixture&state='+encodeURIComponent(state));
 snap([r.status,r.headers.get('location'),config.project_id??null],[302,'/build/connect?oauth=ok&provider=slack&project_id=7',null]);db.close();}},
 {name:'Google and Microsoft return to Build with the venture and no cookie',module:'cal',before:"returnTo = returnFromNonce(signed) || returnTo;",after:"returnTo = returnTo;",
  secondBefore:"returnTo = returnFromNonce(stateRaw ? await verifyState(c.env, stateRaw) : null) || returnTo;",secondAfter:"returnTo = returnTo;",run:async m=>{
 const {db,env}=fixture();calEnv(env);const a=appFor(m),got=[];
 for(const p of ['google','microsoft']){const start:any=await (await req(a,env,`/api/calendar/${p}/start?return_to=build&project_id=7`)).json();
  const state=new URL(start.redirect_url).searchParams.get('state');
  got.push((await req(a,env,`/api/calendar/${p}/callback?error=access_denied&state=${encodeURIComponent(state!)}`)).headers.get('location'));}
 const plain:any=await (await req(a,env,'/api/calendar/google/start')).json();
 got.push((await req(a,env,'/api/calendar/google/callback?error=access_denied&state='+encodeURIComponent(new URL(plain.redirect_url).searchParams.get('state')!))).headers.get('location'));
 const forged=(await req(a,env,'/api/calendar/google/callback?error=access_denied&state=rb7_feedface.notasignature')).headers.get('location');
 snap([...got,forged],['https://app.axal.vc/build/connect?google=error&reason=access_denied&project_id=7','https://app.axal.vc/build/connect?microsoft=error&reason=access_denied&project_id=7',
  'https://app.axal.vc/calendar?google=error&reason=access_denied','https://app.axal.vc/calendar?google=error&reason=access_denied']);db.close();}},
 {name:'LinkedIn returns to Build with the venture and no cookie; a forged state is not read',module:'li',before:"const returnTo = (await returnFromState(c.env, c.req.query('state'))) || readLinkedinReturnTo(c);",after:"const returnTo = readLinkedinReturnTo(c);",run:async m=>{
 const {db,env}=fixture();Object.assign(env,{LINKEDIN_CLIENT_ID:'fixture',LINKEDIN_CLIENT_SECRET:'fixture',APP_URL:'https://app.axal.vc'});
 const kv=new Map<string,string>();env.RATE_LIMITS={get:async(k:string)=>kv.get(k),put:async(k:string,v:string)=>{kv.set(k,v);},delete:async(k:string)=>{kv.delete(k);}};
 const a=appFor(m),start:any=await (await req(a,env,'/api/linkedin/oauth/start','POST',{return_to:'build',project_id:7})).json();
 const url=(v:any)=>{try{return new URL(String(v));}catch{return new URL('https://unparsed.invalid/');}};
 const state=url(start.authorize_url).searchParams.get('state')||'';
 const back=url((await req(a,env,'/api/linkedin/oauth/callback?error=access_denied&state='+encodeURIComponent(state))).headers.get('location'));
 const forged=url((await req(a,env,'/api/linkedin/oauth/callback?error=access_denied&state=rb7_feedface.bad')).headers.get('location'));
 snap([back.pathname,back.searchParams.get('project_id'),forged.pathname,forged.searchParams.get('project_id')],['/build/connect','7','/refer',null]);db.close();}},
];
for(const [key,href] of Object.entries({product_roadmap:'/build/product-roadmap',prototype_mvp:'/build/prototype-mvp',solution_design:'/build/solution-design',founding_team:'/build/founding-team',company_creation:'/build/company-creation',operating_systems:'/build/operating-systems',capital_relationships:'/raise/capital-relationships',customer_research:'/validate/customer-research',market_intelligence:'/validate/market-intelligence',revenue_and_traction:'/grow/revenue-and-traction',customers:'/grow/customers',network:'/network'})){
 checks.push({name:'Module door: '+key,module:'labels',before:"'"+href+"'",after:"'/wrong-module'",run:async m=>snap(m.labels.moduleHref(key),href)});
}
for(const check of checks)test(check.name,()=>check.run(real));
let serial=0;
async function mutant(check:Check):Promise<Mods>{
 const paths={route:'../src/routes/integrations.ts',reg:'../src/integrations/registry.ts',labels:'../src/integrations/moduleLabels.ts',fed:'../src/integrations/fed.ts',cal:'../src/routes/calendar.ts',li:'../src/routes/linkedin.ts',stripe:'../src/integrations/providers/stripe.ts'};
 const file=new URL(paths[check.module],import.meta.url);let source=readFileSync(file,'utf8');
 if(!source.includes(check.before))throw new Error('mutation_target_missing: '+check.name);
 source=stripTypeScriptTypes(source.replace(check.before,check.after),{mode:'strip'});
 source=source.replace(/^((?:import\s+[^'\";]+|export\s*\{[^}]*\})\s+from\s*['\"])([^'\"]+)(['\"])/gm,(_all,begin,path,end)=>begin+(path.startsWith('.')?new URL(/\.(?:ts|mjs|js)$/.test(path)?path:path+'.ts',file).href:import.meta.resolve(path))+end);
 const loaded=await import('data:text/javascript;base64,'+Buffer.from(source+'\n// mutant '+serial++).toString('base64'));
 return {...real,[check.module]:loaded};
}
for(const check of checks)test('Mutation and restoration: '+check.name,async()=>{await check.run(real);await assert.rejects(check.run(await mutant(check)),assert.AssertionError);await check.run(real);
 if(check.secondBefore){await assert.rejects(check.run(await mutant({...check,before:check.secondBefore,after:check.secondAfter!})),assert.AssertionError);await check.run(real);}});
