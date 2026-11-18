/**
 * D5074 slice 5 (#5074) — Use of funds' capabilities, across roles. The plan read returns the caller's map, and each
 * capability is checked against what it governs: `edit` against a write (allowed: it lands; denied: 403
 * `support_read_only`), `mercury` against the founder's Mercury figures, `admin_logged` against the admin banner's
 * standing. Roles: the venture's founder, an admin, a support session acting as the founder and as an admin, another
 * founder and an investor (the last two read no map). The frontend fixtures' mirror (`frontend/test/_uof_capabilities.mjs`)
 * is pinned to the Worker's function. Mounted HTTP handlers, canonical SQLite DDL and synthetic users only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/uof_capabilities_5074.test.ts
 */
import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {SignJWT} from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import financials from '../src/routes/financials.ts';
import {d1Over} from './_d1_sqlite.mjs';
import {tableFromBaseline} from './_baseline.mjs';
import {SECTION_KEYS} from '../src/services/useOfFunds/plan.ts';
import {UOF_CAPABILITIES,uofCan,uofCapabilities} from '../src/services/useOfFunds/capabilities.ts';
import {UOF_CAPABILITIES as MIRROR_KEYS,uofCapabilities as mirror} from '../../frontend/test/_uof_capabilities.mjs';
const secret='synthetic-5074-only-not-a-real-credential';
const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
const migrations=['442_raise_cycle_stores.sql','463_raise_record_stores.sql','436_round_calls.sql','520_mercury_raise_feeds.sql','249_project_metrics.sql','606_use_of_funds_scenarios.sql','202611082130_uof_scenario_revision.sql','202611101555_5375_uof_hire_revision.sql','607_raise_money_cents.sql'].map(n=>readFileSync(new URL(`../sql/migrations/${n}`,import.meta.url),'utf8'));
const roles=['founder','founder','admin','partner','investor','advisor','exploring'];
let savedFetch:typeof fetch;let dbs:DatabaseSync[]=[];let fetches=0;
beforeEach(()=>{ savedFetch=globalThis.fetch;fetches=0;globalThis.fetch=async()=>{fetches++;throw new Error('Provider stub: no network');}; });
afterEach(()=>{globalThis.fetch=savedFetch;for(const db of dbs)db.close();dbs=[];assert.equal(fetches,0);});
const app=new Hono();app.route('/api/cycles/raise',cycleRaise as any);app.route('/api/financials',financials as any);
function fixture(){
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});dbs.push(db);
  for(const name of ['founders','users','projects','activity_logs','user_company_links','company_profiles','super_admins','mi_pro_subscriptions',
    'roadmap_okrs','integrations','cap_table_scenarios','financial_models','raise_rounds','raise_prospects','raise_pro_rata','raise_closes',
    'spinout_deck_overrides','pitch_decks','pitch_deck_share_tokens','data_room_files'])db.exec(tableFromBaseline(baseline,name));
  for(const m of migrations)db.exec(m);
  db.exec(readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql',import.meta.url),'utf8')); // D1137: resolveActiveCompany reads archived_at
  db.exec("INSERT INTO founders(id,name,email) VALUES(11,'Synthetic owner','owner@example.test'),(22,'Other owner','other@example.test'); INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',11,10),(2,'Other venture',22,20); INSERT INTO roadmap_okrs(id,project_id,objective) VALUES(1,1,'Product milestone'),(2,2,'Other milestone');");
  roles.forEach((role,i)=>db.prepare('INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(?,?,?,?,?,1)').run(i+1,role,`Synthetic ${i+1}`,`member-${i+1}@example.test`,i===1?22:11));
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('link-one',1,10),('link-two',1,20)");
  return {db,env:{DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'} as any};
}
// D5069: a write names the revision it read. These tests are about other things, so the
// helper reads the scenario's stored revision for them; the stale-revision tests pass their own.
function revisionFor(f:any,method:string,path:string,b:any){
  if (!b || typeof b !== 'object' || 'expected_revision' in b) return b;
  // D5375: a hire edit names the hire's own revision.
  const hr=/^\/hires\/([0-9]+)(?:\?|$)/.exec(path);
  if(hr&&method==='PATCH'){const h=f.db.prepare('SELECT revision FROM use_of_funds_hires WHERE id=?').get(Number(hr[1])) as any;return h?{...b,expected_revision:Number(h.revision)}:b;}
  let sid:number|null|undefined;let matched=true;
  const sc=/^\/scenarios\/([0-9]+)(?:\?|$)/.exec(path);const ms=/^\/milestones\/([0-9]+)(?:\?|$)/.exec(path);
  const base=():number|undefined=>(f.db.prepare('SELECT id FROM uof_scenarios WHERE project_id=1 AND is_base=1').get() as any)?.id;
  if(sc&&method==='PATCH') sid=Number(sc[1]);
  else if(ms&&method==='PATCH') sid=(f.db.prepare('SELECT scenario_id FROM uof_milestones WHERE id=?').get(Number(ms[1])) as any)?.scenario_id;
  else if(path.startsWith('/milestones')&&method==='POST') sid=b.scenario_id??base();
  else if(/^\/?(\?|$)/.test(path)&&method==='PUT') sid=base();
  else matched=false;
  if(!matched) return b;
  if(sid==null) return {...b,expected_revision:0};
  const row=f.db.prepare('SELECT revision FROM uof_scenarios WHERE id=?').get(sid) as any;
  return {...b,expected_revision:row?Number(row.revision):0};
}
async function call(f:any,method:string,path:string,b?:unknown,who=1,extra:Record<string,unknown>={},headers:Record<string,string>={}){
  b=revisionFor(f,method,path,b);
  const hd=method==='DELETE'?/^\/hires\/([0-9]+)$/.exec(path):null;
  if(hd){const row=f.db.prepare('SELECT revision FROM use_of_funds_hires WHERE id=?').get(Number(hd[1])) as any;path=`${path}?expected_revision=${row?Number(row.revision):0}`;}
  const dm=method==='DELETE'?/^\/milestones\/([0-9]+)$/.exec(path):null;
  if(dm){const row=f.db.prepare('SELECT s.revision FROM uof_milestones m JOIN uof_scenarios s ON s.id=m.scenario_id WHERE m.id=?').get(Number(dm[1])) as any;path=`${path}?expected_revision=${row?Number(row.revision):0}`;}
  const token=await new SignJWT({user_id:who,role:roles[who-1],...extra}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res=await app.request(path.startsWith('/api/')?path:`/api/cycles/raise/use-of-funds${path}${path.includes('?')?'&':'?'}project=1`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:b===undefined?undefined:JSON.stringify(b)},f.env);
  return {status:res.status,body:await res.json() as any};
}
const lines=SECTION_KEYS.map((key,i)=>({key,share_pct:i===0?100:0}));
const input=(name='Lean')=>({name,amount_to_raise_cents:120000,target_runway_months:12,start_month:'2027-01',raise_month:'2027-01',cash_cents:0,lines});
const rows=(f:any,sql:string)=>JSON.parse(JSON.stringify(f.db.prepare(sql).all()));

const FOUNDER=1,OTHER_FOUNDER=2,ADMIN=3,INVESTOR=5;
const FOUNDER_MAP=uofCapabilities({admin:false,founderAccount:true,support:false});
const ADMIN_MAP=uofCapabilities({admin:true,founderAccount:false,support:false});

test('the map: each standing, every key a boolean; no map, an unknown key or a non-true value allows nothing',()=>{
  assert.deepEqual(FOUNDER_MAP,{edit:true,mercury:true,admin_logged:false});
  assert.deepEqual(ADMIN_MAP,{edit:true,mercury:false,admin_logged:true});
  assert.deepEqual(uofCapabilities({admin:false,founderAccount:true,support:true}),{edit:false,mercury:false,admin_logged:false});
  assert.deepEqual(uofCapabilities({admin:true,founderAccount:false,support:true}),{edit:false,mercury:false,admin_logged:true});
  // An admin never reads the founder's Mercury, whatever the standing says.
  assert.equal(uofCapabilities({admin:true,founderAccount:true,support:false}).mercury,false);
  for(const caps of [FOUNDER_MAP,ADMIN_MAP])assert.deepEqual(Object.keys(caps).sort(),[...UOF_CAPABILITIES].sort());
  assert.equal(uofCan(null,'edit'),false);
  assert.equal(uofCan({edit:'true'} as any,'edit'),false);
  assert.equal(uofCan({edit:true},'mercury'),false);
});

test('the frontend fixtures\' mirror is the Worker\'s function',()=>{
  assert.deepEqual([...MIRROR_KEYS],[...UOF_CAPABILITIES]);
  for(const admin of [false,true])for(const founderAccount of [false,true])for(const support of [false,true])
    assert.deepEqual(mirror({admin,founderAccount,support}),uofCapabilities({admin,founderAccount,support}),JSON.stringify({admin,founderAccount,support}));
});

for(const [label,who,map] of [['the founder',FOUNDER,FOUNDER_MAP],['an admin',ADMIN,ADMIN_MAP]] as const){
  test(`${label}: the plan carries their map, and an allowed write lands`,async()=>{
    // Mutation checked: `edit: !s.support` → `edit: false` refuses the write here.
    const f=fixture();
    const r=await call(f,'GET','/plan',undefined,who);
    assert.equal(r.status,200,JSON.stringify(r.body));
    // The standing's map, with D6084's two plan-data keys beside it.
    assert.deepEqual(r.body.capabilities,{...map,...r.body.viewer.capabilities});
    assert.deepEqual(Object.keys(r.body.capabilities).sort(),[...Object.keys(map),'add_to_data_room','export'].sort());
    assert.equal(r.body.viewer.can_write,map.edit,'the old viewer field agrees with the map');
    const w=await call(f,'POST','/scenarios',input(`${label} plan`),who);
    assert.equal(w.status,201,JSON.stringify(w.body));
  });
}

for(const [label,who] of [['acting as the founder',FOUNDER],['acting as an admin',ADMIN]] as const){
  test(`a support session ${label}: the map allows no write, and every write is refused`,async()=>{
    // Mutation checked: the middleware reading `support` instead of the map's `edit` still refuses; `edit: true` lands the write.
    const f=fixture();
    await call(f,'GET','/plan',undefined,FOUNDER); // the founder initializes the Base, which a support session may only read
    const r=await call(f,'GET','/plan',undefined,who,{impersonated_by:ADMIN});
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.capabilities.edit,false);
    assert.equal(r.body.capabilities.mercury,false,'Mercury stays the founder\'s own session');
    const before=rows(f,'SELECT id FROM uof_scenarios').length;
    for(const [method,path,b] of [['POST','/scenarios',input('Support plan')],['PUT','/',{lines}]] as const){
      const w=await call(f,method,path,b,who,{impersonated_by:ADMIN});
      assert.equal(w.status,403,`${method} ${path}: ${JSON.stringify(w.body)}`);
      assert.equal(w.body.code,'support_read_only');
    }
    assert.equal(rows(f,'SELECT id FROM uof_scenarios').length,before,'nothing was written');
  });
}

test('another founder and an investor read no map',async()=>{
  const f=fixture();
  for(const who of [OTHER_FOUNDER,INVESTOR]){
    const r=await call(f,'GET','/plan',undefined,who);
    assert.equal(r.status,403,`${who}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code,'forbidden');
    assert.ok(!('capabilities' in r.body));
  }
});

test('the writes refuse from the map, in the route source',()=>{
  const src=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/routes/cycle_use_of_funds.ts'),'utf8');
  assert.match(src,/const caps=uofCapabilities\(uofStanding\(user,project,support\)\);/);
  assert.match(src,/if \(c\.req\.method!=='GET'&&!uofCan\(caps,'edit'\)\) return c\.json\(\{code:'support_read_only'/);
  assert.match(src,/c\.set\('mercury',uofCan\(caps,'mercury'\)\);/);
  assert.match(src,/readOnly:!uofCan\(caps,'edit'\)/);
  assert.match(src,/capabilities:\{\.\.\.c\.get\('caps'\),\.\.\.plan\.viewer\.capabilities\}/);
  assert.ok(!/support&&c\.req\.method!=='GET'/.test(src),'no write refusal of its own beside the map');
});

// D5074 part 6: Runway's other reads carry the same map, and the forecast (its own store, `routes/financials.ts`)
// answers with `edit` from its own save gate and a support session's read-only rule.
const SUPPORT_AS_FOUNDER=uofCapabilities({admin:false,founderAccount:true,support:true});
test('part 6: the scenarios, compare and forecast reads carry the caller\'s map; a support session saves no forecast',async()=>{
  const f=fixture();
  await call(f,'GET','/plan',undefined,FOUNDER); // the founder initializes the Base
  for(const [label,who,extra,map] of [['founder',FOUNDER,{},FOUNDER_MAP],['admin',ADMIN,{},ADMIN_MAP],['support as founder',FOUNDER,{impersonated_by:ADMIN},SUPPORT_AS_FOUNDER]] as const){
    const s=await call(f,'GET','/scenarios',undefined,who,extra);
    assert.equal(s.status,200,`${label}: ${JSON.stringify(s.body)}`);
    assert.deepEqual(s.body.capabilities,map,`${label}: scenarios`);
    const id=s.body.items[0].id;
    const cmp=await call(f,'GET',`/compare?ids=${id}`,undefined,who,extra);
    assert.equal(cmp.status,200,`${label}: ${JSON.stringify(cmp.body)}`);
    assert.deepEqual(cmp.body.capabilities,map,`${label}: compare`);
    const fc=await call(f,'GET','/api/financials/1',undefined,who,extra);
    assert.equal(fc.status,200,`${label}: ${JSON.stringify(fc.body)}`);
    assert.deepEqual(fc.body.capabilities,{edit:map.edit},`${label}: forecast`);
  }
  for(const path of ['/api/financials/1','/api/financials/1/recompute']){
    const w=await call(f,path.endsWith('recompute')?'POST':'PUT',path,{assumptions:{}},FOUNDER,{impersonated_by:ADMIN});
    assert.equal(w.status,403,`${path}: ${JSON.stringify(w.body)}`);
    assert.equal(w.body.code,'support_read_only');
  }
  assert.equal(rows(f,'SELECT project_id FROM financial_models').length,0,'a support session wrote no forecast');
  const own=await call(f,'PUT','/api/financials/1',{assumptions:{}},FOUNDER);
  assert.notEqual(own.status,403,`the founder's own save is not refused for who they are: ${JSON.stringify(own.body)}`);
});

test('part 6: the forecast\'s map and its save ask the same rule, in the route source',()=>{
  const src=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/routes/financials.ts'),'utf8');
  assert.match(src,/return \{ edit: canEditFinancials\(project, user\) && !\(await isSupportSession\(c as any\)\) \};/);
  assert.match(src,/if \(!canEditFinancials\(project, user\)\) throw new Error\('Forbidden'\);/);
  assert.equal((src.match(/ensureCanEdit\(project, user\);\n  if \(await isSupportSession\(c as any\)\) return c\.json\(SUPPORT_READ_ONLY, 403\);/g)||[]).length,2,'the save and the recompute');
  const uof=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/routes/cycle_use_of_funds.ts'),'utf8');
  assert.equal((uof.match(/capabilities:c\.get\('caps'\)\}\);/g)||[]).length,2,'the scenarios and compare reads');
});
