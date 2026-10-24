/** D895 (#2674): synthetic data, mounted Worker routes and the real migrated schema. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks, { createShareLink, deckOwnerBrand, founderPitchSlides, deckShareMetrics, founderSpinoutFields } from '../src/routes/decks.ts';
import brand from '../src/routes/brand.ts';
import shareActions from '../src/routes/deck_share_actions.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { recordedDeckRunway, autofillDeck, formatDeckRunway } from '../src/services/decks/autofill.ts';
import { getMethod } from '../src/services/decks/methods.ts';
import { fetchLandingPageForProject, applyBrandKitToSlides } from '../src/services/decks/branding.ts';
import { generateReview, normalizeReview, DECK_SECTIONS } from '../src/services/deckExtract.ts';
import { fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { canWrite, canWritePitchDeck } from '../src/routes/_founder_validate_helpers.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter(n => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map(n => readFileSync(new URL('migrations/'+n, root), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'pitch-d895-'));
const seedPath = join(scratch, 'schema.sqlite');
const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
schema.exec(baseline); for (const sql of migrations) schema.exec(sql); schema.close();
let nextFixture = 0;
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-d895-only-not-a-real-credential'.repeat(2);
const SLIDES = [{ title: 'Synthetic problem', method_id: 'yc_seed', spec_id: 'problem', body: 'Recorded problem', fields: [] }];
async function fixture() {
  const file = join(scratch, `case-${++nextFixture}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  const users: Array<[number,string,number|null,string]> = [[1,'admin',null,'studio'],[2,'founder',100,'studio'],[3,'founder',200,'studio'],[4,'advisor',null,'studio'],[5,'partner',null,'studio'],[6,'investor',null,'studio'],[7,'exploring',null,'studio'],[8,'founder',800,'studio'],[9,'advisor',null,'studio']];
  for (const [id,role,fid,tier] of users) insert.run(id,role,fid,`Synthetic member ${id}`,`synthetic-${id}@example.invalid`,tier);
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(2,'Synthetic other',800)");
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT:'development' };
  await ensureProjectMembershipSchema(env);
  db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES(1,3,'cofounder','accepted'),(1,4,'advisor','accepted'),(1,5,'advisor','accepted'),(1,9,'cofounder','accepted')");
  db.prepare('INSERT INTO pitch_decks(id,project_id,version,slides,title,is_current,created_by) VALUES(10,1,1,?,?,1,2)').run(JSON.stringify(SLIDES),'Synthetic deck');
  db.prepare("INSERT INTO pitch_deck_proposals(id,project_id,base_deck_id,slides,title,method_id,created_by) VALUES(20,1,10,?,'Synthetic proposal','yc_seed',2)").run(JSON.stringify(SLIDES));
  const app = new Hono<any>().route('/api/decks',decks).route('/api/brand',brand).route('/api/deck-share',shareActions).route('/api/cycles/raise',cycleRaise).route('/api/cycles',cycleRecords);
  app.onError((err,c) => c.json({detail:err.message}, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return {db, env, app};
}
type F = Awaited<ReturnType<typeof fixture>>;
async function call(f:F, who:number|null, method:string, path:string, json?:any) {
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(who) headers.Authorization='Bearer '+await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res=await f.app.request(path,{method,headers,...(json===undefined?{}:{body:JSON.stringify(json)})},f.env);
  const bytes=await res.arrayBuffer();let body:any;try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{body=null}
  return {status:res.status,body,headers:res.headers,bytes};
}
const writes:Array<[string,string,any?]>=[['PUT','/api/decks/10',{slides:SLIDES}],['POST','/api/decks/10/restore'],['POST','/api/decks/10/share'],['DELETE','/api/decks/10/shares/1'],['POST','/api/decks/10/export',{format:'pptx'}],['POST','/api/decks/10/autofill'],['POST','/api/decks/apply-method',{project_id:1,method_id:'yc_seed'}],['POST','/api/decks/generate',{project_id:1}],['POST','/api/decks/proposals/20/keep'],['DELETE','/api/decks/proposals/20']];
for(const who of [1,4,5,6,7,8,9]) test(`D895: principal ${who} cannot write a founder deck`,async()=>{
 const f=await fixture();try{
  f.db.exec("INSERT INTO pitch_deck_share_tokens(id,deck_id,token_hash,expires_at,view_limit,created_by) VALUES(1,10,'synthetic-gate-token','2999-01-01',1,2)");
  const before=f.db.prepare('SELECT * FROM pitch_decks').all();
  for(const [method,path,body]of writes){const r=await call(f,who,method,path,body);assert.ok([403,404].includes(r.status),`${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`)}
  assert.deepEqual(f.db.prepare('SELECT * FROM pitch_decks').all(),before);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE entity_type='raise.pitch-deck'").get()!.n,0);
 }finally{f.db.close()}
});
test('D895: admin reads remain; advisors and advisor-members cannot read deck data or engagement',async()=>{
 const f=await fixture();try{
  for(const path of ['/api/decks/10','/api/decks/10/engagement','/api/decks/by-project/1']){
   assert.equal((await call(f,1,'GET',path)).status,200,path);
   for(const who of [4,5,9])assert.equal((await call(f,who,'GET',path)).status,403,`${who} ${path}`);
   assert.equal((await call(f,3,'GET',path)).status,200,'accepted cofounder retains reads');
  }
 }finally{f.db.close()}
});
test('D895: fixed single-segment reads reach methods and brand instead of the deck-id handler',async()=>{
 const f=await fixture();try{
  const methods=await call(f,2,'GET','/api/decks/methods');assert.equal(methods.status,200);assert.equal(methods.body.methods.length,13);
  assert.equal((await call(f,2,'GET','/api/decks/brand')).status,200);
 }finally{f.db.close()}
});
for(const [method,path,body,action] of [
 ['PUT','/api/decks/10',{slides:SLIDES},'deck_saved'],['POST','/api/decks/10/restore',undefined,'deck_restored'],
 ['POST','/api/decks/proposals/20/keep',undefined,'deck_kept'],['POST','/api/decks/10/export',{format:'pptx'},'deck_exported'],
 ['POST','/api/decks/generate',{project_id:1},'deck_generated'],
 ['DELETE','/api/decks/proposals/20',undefined,'deck_proposal_discarded'],
 ['POST','/api/decks/apply-method',{project_id:1,method_id:'yc_seed'},'deck_template_proposed'],
 ['POST','/api/decks/10/autofill',undefined,'deck_fill_proposed'],
] as const)test(`D895: ${action} logs one actor-scoped pitch activity without figures`,async()=>{
 const f=await fixture();try{
  const r=await call(f,2,method,path,body);assert.equal(r.status,200,JSON.stringify(r.body));
  const rows=f.db.prepare("SELECT project_id,user_id,action,details FROM activity_logs WHERE entity_type='raise.pitch-deck'").all() as any[];
  assert.equal(rows.length,1);assert.equal(rows[0].project_id,1);assert.equal(rows[0].user_id,2);assert.equal(rows[0].action,action);assert.doesNotMatch(rows[0].details,/Recorded problem|\$|runway|revenue/i);
 }finally{f.db.close()}
});
test('D895: measured runway comes from the model or Mercury, never funding size',async()=>{
 const f=await fixture();try{
  assert.equal(await recordedDeckRunway(f.env,1),null);
  if(!(f.db.prepare('PRAGMA table_info(financial_models)').all() as any[]).some(x=>x.name==='computed_json'))f.db.exec('ALTER TABLE financial_models ADD COLUMN computed_json TEXT');
  f.db.prepare("INSERT INTO financial_models(project_id,computed_json) VALUES(1,?)").run(JSON.stringify({runway_months:7}));
  assert.equal(await recordedDeckRunway(f.env,1),7);
  f.db.exec("UPDATE financial_models SET computed_json='{}'");
  // Use the real canonical Mercury fact table, without making a provider request.
  f.db.prepare("INSERT INTO mercury_raise_facts(integration_id,project_id,kind,fact_key,value,as_of) VALUES(99,1,'runway','runway',4,'2026-10-20')").run();
  assert.equal(await recordedDeckRunway(f.env,1),4);
  f.db.exec("UPDATE financial_models SET computed_json='{\"runway_months\":0}'");assert.equal(await recordedDeckRunway(f.env,1),0);
 }finally{f.db.close()}
});
test('D895: missing review output supplies neither a fabricated score nor a fabricated first fix',async()=>{
 const f=await fixture();try{
  const review=await generateReview(f.env,2,DECK_SECTIONS.map(s=>({...s,content:'Synthetic recorded text'})));
  assert.equal(review.overall_score,null);assert.equal(review.fix_first,'');
 }finally{f.db.close()}
});
test('D895: founder slide fields cannot expose a persisted internal score',()=>{
 const slides=[{title:'Team',fields:[{key:'vr_headline',kind:'paragraph',value:'Axal score: 91/100'},{key:'vr_breakdown',kind:'metric_grid',value:[{label:'Market',value:'20'}]},{key:'team_founder1_name',kind:'paragraph',value:'Synthetic Founder'}]}];
 const safe=founderPitchSlides(slides);assert.doesNotMatch(JSON.stringify(safe),/91\/100|Axal score/);assert.deepEqual(safe[0].fields[1].value,[]);assert.equal(safe[0].fields[2].value,'Synthetic Founder');assert.equal(slides[0].fields[0].value,'Axal score: 91/100');
});
test('D895: export brand follows the venture owner and plan',async()=>{
 const f=await fixture();try{
  f.db.exec("UPDATE users SET subscription_tier='free' WHERE id=2");assert.equal((await deckOwnerBrand(f.env,1)).show_footer,true);
  const exported=await call(f,3,'POST','/api/decks/10/export',{format:'pptx'});assert.equal(exported.status,200);assert.match(new TextDecoder().decode(exported.bytes),/Built with Axal VC/);
  f.db.exec("UPDATE users SET subscription_tier='studio' WHERE id=2");assert.equal((await deckOwnerBrand(f.env,1)).show_footer,false);
  f.db.exec("UPDATE users SET subscription_tier='free' WHERE id=3");const paid=await call(f,3,'POST','/api/decks/10/export',{format:'pptx'});assert.equal(paid.status,200);assert.doesNotMatch(new TextDecoder().decode(paid.bytes),/Built with Axal VC/);
 }finally{f.db.close()}
});
test('D895: deck-link permissions narrow only the pitch module',async()=>{
 const f=await fixture();try{
  const project={id:1,founder_id:100};const admin={id:1,role:'admin'}as any;
  assert.equal(canWrite(project,admin),true);assert.equal(canWritePitchDeck(project,admin),false);assert.equal(canWritePitchDeck(project,{id:2,role:'founder',founder_id:100}as any),true);
  for(const method of ['POST','PATCH'])assert.equal((await call(f,1,method,'/api/cycles/raise/deck-links'+(method==='PATCH'?'/1':'')+'?project=1',{deck_id:10,expires_days:7})).status,403);
 }finally{f.db.close()}
});

test('D895: the current brand kit is the newest live page, with voice and dark logo',async()=>{
 const f=await fixture();try{
  const insert=f.db.prepare('INSERT INTO landing_pages(project_id,slug,page_slug,name,logo_url,voice_json,logo_dark_url,archived_at) VALUES(1,?,?,?,?,?,?,?)');
  insert.run('old','old','Old','https://example.invalid/old.svg','["Old"]',null,null);
  insert.run('current','current','Current','https://example.invalid/current.svg','["Direct"]','https://example.invalid/dark.svg',null);
  insert.run('archived','archived','Archived','https://example.invalid/archived.svg','["Wrong"]',null,'2026-10-01');
  const kit=await fetchLandingPageForProject(f.env,1);assert.equal(kit?.name,'Current');assert.equal(kit?.voice_json,'["Direct"]');assert.equal(kit?.logo_dark_url,'https://example.invalid/dark.svg');
  const fields=applyBrandKitToSlides([{title:'Title',fields:[]}],kit,'full')[0].fields;
  assert.equal(fields.find((x:any)=>x.key==='brandkit_logo_dark_url').value,'https://example.invalid/dark.svg');
  assert.equal(fields.find((x:any)=>x.key==='brandkit_voice_json').value,'["Direct"]');
  const response=await call(f,2,'GET','/api/brand/landing/by-project/1');assert.equal(response.status,200);assert.equal(response.body.name,'Current');assert.deepEqual(response.body.voice_tags,['Direct']);
 }finally{f.db.close()}
});
test('D895: founder template generation withholds internal scores while the Lab assembler keeps them',async()=>{
 const f=await fixture();try{
  f.db.exec("INSERT INTO score_snapshots(project_id,total_score,tier,is_sandbox) VALUES(1,87,'TIER_2',0)");
  const lab=await fillAxalSpinoutDemoDay(f.env,2,1);
  assert.match(lab.venture_readiness.headline,/87\/100/);
  const founder=await fillAxalSpinoutDemoDay(f.env,2,1,{includeInternalScore:false});
  assert.doesNotMatch(JSON.stringify(founder.venture_readiness),/87\/100|Axal score/);
  const applied=await call(f,2,'POST','/api/decks/apply-method',{project_id:1,method_id:'axal_spinout_demoday'});
  assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action='deck_template_applied'").get()!.n,1);assert.doesNotMatch(JSON.stringify(applied.body.deck.slides),/87\/100|Axal score/);
  const fill=await call(f,2,'POST','/api/decks/'+applied.body.deck.id+'/autofill');assert.equal(fill.status,200);assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action='deck_fill_proposed'").get()!.n,1);
  const link=await createShareLink(f.env,{deckId:applied.body.deck.id,deckVersion:applied.body.deck.version,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});
  const shared=await call(f,null,'GET','/api/decks/share/'+link.token);assert.equal(shared.status,200,JSON.stringify(shared.body));
  assert.doesNotMatch(JSON.stringify(shared.body.spinout_fields),/87\/100|Axal score/);
 }finally{f.db.close()}
});
test('D895: no recorded runway says Not recorded in the generated Ask',async()=>{
 const f=await fixture();try{
  f.db.exec('UPDATE projects SET funding_needed=9000000 WHERE id=1');
  const response=await call(f,2,'POST','/api/decks/generate',{project_id:1});assert.equal(response.status,200);
  const ask=response.body.slides.find((s:any)=>s.title==='Ask');assert.ok(ask);assert.match(JSON.stringify(ask),/Runway: Not recorded/);assert.doesNotMatch(JSON.stringify(ask),/18-24|24\+|9000000.*months/);
 }finally{f.db.close()}
});
test('D895: an accepted deck NDA becomes the founder-viewer pairwise NDA, never a body-supplied identity',async()=>{
 const f=await fixture();try{
  const link=await createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});
  const res=await call(f,6,'POST','/api/deck-share/share/'+link.token+'/nda',{signed_by:'Synthetic Signer',user_id:8});
  assert.equal(res.status,200,JSON.stringify(res.body));assert.equal(res.body.data_room_access_granted,false);
  const rows=f.db.prepare('SELECT party_a_user_id,party_b_user_id,status,valid_until FROM pairwise_ndas').all()as any[];
  assert.equal(rows.length,1);assert.equal(rows[0].party_a_user_id,2);assert.equal(rows[0].party_b_user_id,6);assert.equal(rows[0].status,'active');assert.ok(Date.parse(rows[0].valid_until)>Date.now());
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM data_room_grants').get()!.n,0,'an NDA is not an access grant');
 }finally{f.db.close()}
});

test('D895: unknown counts stay null; measured zero and finite exhausted links remain distinct',()=>{
 assert.deepEqual(deckShareMetrics({}),{view_limit:null,view_count:null,exhausted:false});
 assert.deepEqual(deckShareMetrics({view_limit:2147483647,view_count:0}),{view_limit:null,view_count:0,exhausted:false});
 assert.deepEqual(deckShareMetrics({view_limit:null,view_count:9}),{view_limit:null,view_count:9,exhausted:false});
 assert.deepEqual(deckShareMetrics({view_limit:1,view_count:1}),{view_limit:1,view_count:1,exhausted:true});
});
test('D895: engagement reports an unlimited cap honestly and conversion outages are not zeros',async()=>{
 const f=await fixture();try{
  await createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});
  const res=await call(f,2,'GET','/api/decks/10/engagement');assert.equal(res.status,200);assert.equal(res.body.shares[0].view_limit,null);assert.equal(res.body.shares[0].view_count,0);
  f.db.exec('DROP TABLE deck_share_conversions');
  // The bootstrap was already used above, so this simulates a later store outage.
  const unreadable=await call(f,2,'GET','/api/decks/10/engagement');assert.equal(unreadable.status,200);assert.equal(unreadable.body.conversions.signups,null);
 }finally{f.db.close()}
});
test('D895: editor withdrawal logs one link activity; repeating the withdrawal preserves its first state',async()=>{
 const f=await fixture();try{
  const link=await createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});f.db.exec('DELETE FROM activity_logs');
  assert.equal((await call(f,2,'DELETE',`/api/decks/10/shares/${link.id}`)).status,200);
  const before=f.db.prepare('SELECT revoked_at,expires_at FROM pitch_deck_share_tokens WHERE id=?').get(link.id!);
  assert.equal((await call(f,2,'DELETE',`/api/decks/10/shares/${link.id}`)).status,200);
  assert.deepEqual(f.db.prepare('SELECT revoked_at,expires_at FROM pitch_deck_share_tokens WHERE id=?').get(link.id!),before);
  const logs=f.db.prepare("SELECT user_id,action FROM activity_logs WHERE entity_type='raise.pitch-deck'").all() as any[];assert.equal(logs.length,1);assert.equal(logs[0].action,'deck_link_revoked');assert.equal(logs[0].user_id,2);
 }finally{f.db.close()}
});
for(const format of ['pdf','pptx'])test(`D895: successful browser ${format} export logs once; failed rendering logs no completed export`,async()=>{
 const f=await fixture();try{
  f.env.BROWSER={fetch:async()=>new Response(new Uint8Array([1,2,3]),{status:200})};
  assert.equal((await call(f,2,'POST','/api/decks/10/export',{format})).status,200);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE entity_type='raise.pitch-deck' AND action='deck_exported'").get()!.n,1);
  f.env.BROWSER={fetch:async()=>new Response('synthetic failure',{status:502})};
  assert.equal((await call(f,2,'POST','/api/decks/10/export',{format})).status,502);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM activity_logs WHERE entity_type='raise.pitch-deck' AND action='deck_exported'").get()!.n,1);
 }finally{f.db.close()}
});
test('D895: admin deck-link records are read-only, including their action metadata and form options',async()=>{
 const f=await fixture();try{
  const link=await createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});
  const path=`/api/cycles/raise/modules/pitch-deck/records/${link.id}`;
  const admin=await call(f,1,'GET',path+'?project=1');assert.equal(admin.status,200,JSON.stringify(admin.body));assert.deepEqual(admin.body.actions,[]);
  const owner=await call(f,2,'GET',path+'?project=1');assert.equal(owner.status,200);assert.ok(owner.body.actions.some((a:any)=>a.key==='revoke'));
  assert.equal((await call(f,1,'GET','/api/cycles/raise/modules/pitch-deck/form-options?project=1')).status,403);
  assert.equal((await call(f,1,'POST',path+'/actions/revoke?project=1',{})).status,403);
  assert.equal(f.db.prepare('SELECT revoked_at FROM pitch_deck_share_tokens WHERE id=?').get(link.id!)!.revoked_at,null);
 }finally{f.db.close()}
});
test('D895: review normalization distinguishes an absent score from returned zero and retains only returned first fixes',()=>{
 const sections=DECK_SECTIONS.map(s=>({...s,content:'Synthetic text'}));
 for(const value of [undefined,null,'',true])assert.equal(normalizeReview({overall_score:value} as any,sections).overall_score,null);
 assert.equal(normalizeReview({overall_score:0},sections).overall_score,0);
 assert.equal(normalizeReview({overall_score:67.4,fix_first:'Recorded model feedback'},sections).overall_score,67);
 assert.equal(normalizeReview({overall_score:67.4,fix_first:'Recorded model feedback'},sections).fix_first,'Recorded model feedback');
 assert.equal(normalizeReview({overall_score:500},sections).overall_score,100);
 assert.equal(normalizeReview({},sections).fix_first,'');
});

test('D895: reading a legacy deck removes saved internal score fields',async()=>{
 const f=await fixture();try{
  f.db.prepare('UPDATE pitch_decks SET slides=? WHERE id=10').run(JSON.stringify([{title:'Readiness',fields:[{key:'vr_headline',kind:'paragraph',value:'Axal score: 91/100'},{key:'vr_breakdown',kind:'metric_grid',value:[{label:'Market',value:'20'}]}]}]));
  const read=await call(f,2,'GET','/api/decks/10');assert.equal(read.status,200);assert.doesNotMatch(JSON.stringify(read.body),/91\/100|Axal score/);assert.deepEqual(read.body.slides[0].fields[1].value,[]);
 }finally{f.db.close()}
});

test('D895: template Ask runway cells use records, including Mercury, rather than the amount raised',async()=>{
 const f=await fixture();try{
  f.db.exec('UPDATE projects SET funding_needed=5000000 WHERE id=1');
  const method={...getMethod('yc_seed')!,slides:getMethod('yc_seed')!.slides.filter(s=>s.id==='ask')};
  const runway=async()=>{
   const filled=await autofillDeck(f.env,method,1);
   return (filled.slides[0].fields.round.value as any[]).filter(cell=>/Runway/.test(cell.label)).map(cell=>cell.value);
  };
  assert.deepEqual(await runway(),['Not recorded','Not recorded']);
  f.db.prepare("INSERT INTO mercury_raise_facts(integration_id,project_id,kind,fact_key,value,as_of) VALUES(99,1,'runway','runway',4,'2026-10-20')").run();
  assert.deepEqual(await runway(),['4 months runway','4 mo']);
  f.db.exec("UPDATE mercury_raise_facts SET value=0");assert.deepEqual(await runway(),['0 months runway','0 mo']);
 }finally{f.db.close()}
});


test('D895: fractional recorded runway has consistent whole-month display without changing the stored measurement',async()=>{
 const f=await fixture();try{
  if(!(f.db.prepare('PRAGMA table_info(financial_models)').all() as any[]).some(x=>x.name==='computed_json'))f.db.exec('ALTER TABLE financial_models ADD COLUMN computed_json TEXT');
  f.db.prepare('INSERT INTO financial_models(project_id,computed_json) VALUES(1,?)').run(JSON.stringify({runway_months:13.846153846}));
  assert.equal(await recordedDeckRunway(f.env,1),13.846153846);
  assert.equal(formatDeckRunway(13.846153846),'14 months');assert.equal(formatDeckRunway(13.846153846,'mo'),'14 mo');assert.equal(formatDeckRunway(0),'0 months');assert.equal(formatDeckRunway(null),null);
  const generated=await call(f,2,'POST','/api/decks/generate',{project_id:1});assert.equal(generated.status,200);assert.match(JSON.stringify(generated.body.slides),/Runway: 14 months/);assert.doesNotMatch(JSON.stringify(generated.body.slides),/13\.846/);
 }finally{f.db.close()}
});
for(const failing of ['upsert','activate'])test(`D895: failed pairwise ${failing} leaves no unfinished acceptance or conversion; retry completes one NDA`,async()=>{
 const f=await fixture();try{
  const link=await createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});
  const original=f.env.DB;
  const pattern=failing==='upsert'?/INSERT INTO pairwise_ndas/:/UPDATE pairwise_ndas/;
  f.env.DB={...original,prepare(sql:string){if(pattern.test(sql))throw new Error('Synthetic pairwise failure');return original.prepare(sql)}};
  const path='/api/deck-share/share/'+link.token+'/nda';const failed=await call(f,6,'POST',path,{signed_by:'Synthetic'});assert.equal(failed.status,503);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents WHERE doc_type='nda_acceptance'").get()!.n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM pairwise_ndas').get()!.n,0);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM deck_share_conversions WHERE type='nda_signed'").get()!.n,0);
  f.env.DB=original;const retry=await call(f,6,'POST',path,{signed_by:'Synthetic'});assert.equal(retry.status,200,JSON.stringify(retry.body));
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents WHERE doc_type='nda_acceptance'").get()!.n,1);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM pairwise_ndas WHERE status='active'").get()!.n,1);
 }finally{f.db.close()}
});

test('D895: failure to replace an existing NDA preserves the previous active agreement',async()=>{
 const f=await fixture();try{
  f.db.exec("INSERT INTO documents(uid,project_id,title,doc_type,status) VALUES('synthetic-existing-nda',1,'Existing synthetic NDA','nda_acceptance','signed'); INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,nda_envelope_uuid,status,valid_until) VALUES(2,6,'synthetic-existing-nda','active','2099-01-01')");
  const before=f.db.prepare('SELECT * FROM pairwise_ndas').all();
  const link=await createShareLink(f.env,{deckId:10,deckVersion:1,userId:2,actorEmail:null,ttlSeconds:null,projectId:1});const original=f.env.DB;
  f.env.DB={...original,prepare(sql:string){if(/INSERT INTO pairwise_ndas/.test(sql))throw new Error('Synthetic upsert failure');return original.prepare(sql)}};
  const failed=await call(f,6,'POST','/api/deck-share/share/'+link.token+'/nda',{signed_by:'Synthetic'});assert.equal(failed.status,503);
  assert.deepEqual(f.db.prepare('SELECT * FROM pairwise_ndas').all(),before);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM documents WHERE doc_type='nda_acceptance'").get()!.n,1);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM deck_share_conversions WHERE type='nda_signed'").get()!.n,0);
 }finally{f.db.close()}
});

test('D895: malformed or non-array readiness cards cannot hide unrelated public fields',()=>{
 for(const raw of ['broken-json','{}','null','42','']){
  const fields={'cover.title':'Synthetic venture','validation.cards_json':raw};
  assert.deepEqual(founderSpinoutFields(fields),{'cover.title':'Synthetic venture','validation.cards_json':'[]'});assert.equal(fields['validation.cards_json'],raw);
 }
 const cards=[['internal','Axal score','91/100'],['recorded','Interviews','7'],null,'Axal score: 91/100',['internal','AXAL SCORE','91/100']];const fields={'cover.title':'Synthetic venture','validation.cards_json':JSON.stringify(cards)};
 assert.deepEqual(JSON.parse(founderSpinoutFields(fields)['validation.cards_json']),[cards[1]]);assert.deepEqual(JSON.parse(fields['validation.cards_json']),cards);
 assert.deepEqual(founderSpinoutFields({'cover.title':'Synthetic venture'}),{'cover.title':'Synthetic venture'});
});
