/** D7821 (#7821): five states, native-code precedence, immutable evidence, physical-row recompute and audited admin writes.
 *
 * From cloudflare-worker/test/README.md (moved by #6472):
 * `research_company_classification_7821.test.ts` — D7821 native evidence, five states, code
 * precedence, resumable maintenance and audited overrides.
 */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {SignJWT} from 'jose';
import route from '../src/routes/research_company_mapping.ts';
import {classifyCompany,readCompanyClassification,COMPANY_MAPPING_RULES_VERSION} from '../src/services/researchCompanyClassification.ts';
import type {NativeClassification,ClassificationCrosswalk} from '../src/services/researchCompanyClassification.ts';
import {mapCompanySector,mapCompanyCountry,mapFundFocus,COUNTRY_ALIASES,resolveCompanySectorOverride} from '../src/services/researchTaxonomy.ts';
import {SIC_SECTORS} from '../../scripts/import-companies-house.mjs';
import {buildClassificationCrosswalk} from '../../scripts/build-classification-crosswalk.mjs';
import {migratedDatabase,removeMigratedDatabases} from './_storage_schema.ts';
import {d1Over} from './_d1_sqlite.mjs';
import {AUTH_ERROR_STATUSES} from '../src/util/authErrors.ts';
after(removeMigratedDatabases);
const primary=readFileSync(new URL('../sql/migrations/202611200102_7821_research_company_classification.sql',import.meta.url),'utf8');
const seed=readFileSync(new URL('../sql/migrations/202611200106_7821_research_classification_crosswalk_uk_sic.sql',import.meta.url),'utf8');
const asset=JSON.parse(readFileSync(new URL('../../attached_assets/research-classification-crosswalk-2026-11-20.json',import.meta.url),'utf8'));
const native=(code:string,position=0,version='2007',scheme='UK SIC'):NativeClassification=>({scheme,scheme_version:version,code,native_label:null,language:null,source:'Synthetic register',position});
function fixture(){
 const db=migratedDatabase();
 db.exec("INSERT INTO research_company_mapping_revision(id,revision) VALUES(1,0)");
 db.exec("INSERT INTO users(id,name,email,role) VALUES(1,'Synthetic Admin','admin@example.invalid','admin'),(2,'Synthetic Founder','founder@example.invalid','founder')");
 const targets=new Set(Object.values(SIC_SECTORS).flatMap(label=>mapCompanySector(String(label)).targets));
 const market=db.prepare('INSERT INTO research_market_directory(slug,name,company_count,source_name,source_boundary,as_of) VALUES(?,?,0,?,?,?)');
 for(const slug of targets)market.run(slug,slug,'Synthetic','Synthetic only','2026-11-20');
 db.exec(seed);
 const company=db.prepare('INSERT INTO research_company_directory(uid,name,website,sector,source_name,source_url,as_of) VALUES(?,?,?, ?,?,?,?)');
 for(const [uid,label]of [['a-rule','software'],['b-code',null],['c-outside','dormant company'],['d-empty',null],['e-unreviewed','Synthetic novel activity'],['f-pin','Synthetic pinned label'],['g-code-outside',null],['h-held',null]])company.run(uid,'Synthetic '+uid,'',label,uid==='h-held'?'Synthetic held source':'Synthetic register','https://example.invalid','2026-11-20');
 db.exec("INSERT INTO research_taxonomy_overrides(kind,raw_value,target,note,author) VALUES('company_sector','Synthetic pinned label','','Synthetic pin',1)");
 const add=db.prepare('INSERT INTO research_company_classifications(company_uid,scheme,scheme_version,code,native_label,language,source,position) VALUES(?,?,?,?,?,?,?,?)');
 for(const [uid,code]of [['b-code','62012'],['g-code-outside','99999'],['h-held','62012']])add.run(uid,'UK SIC','2007',code,null,null,'Synthetic register',0);
 db.exec("INSERT INTO research_classification_crosswalk(scheme,scheme_version,code,match_kind,normalized_scheme,normalized_version,industry_code,industry_title,state,market_slug,reason,reviewed_on,reviewer) VALUES('UK SIC','2007','99999','exact','UK SIC','2007','99999','Synthetic outside activity','outside_tracked_markets',NULL,'Synthetic reviewed outside','2026-11-20','Synthetic reviewer')");
 const env={DB:d1Over(db),JWT_SECRET:'synthetic-7821-only-not-a-secret'.repeat(2),ENVIRONMENT:'development'}as any;
 return{db,env};
}
type Fixture=ReturnType<typeof fixture>;
const app=new Hono<any>().route('/api/admin/research-company-mapping',route);
app.onError((error,c)=>c.json({error:error.message},(AUTH_ERROR_STATUSES[error.message]||500)as any));
async function call(f:Fixture,path:string,body:any,user:number|null=1){
 const token=user===null?null:await new SignJWT({user_id:user,role:user===1?'admin':'founder'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
 const r=await app.request('/api/admin/research-company-mapping'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)},f.env);
 return{status:r.status,body:await r.json()as any};
}
const crosswalk=(f:Fixture)=>f.db.prepare('SELECT * FROM research_classification_crosswalk').all()as unknown as ClassificationCrosswalk[];

test('five states remain distinguishable; native-only codes carry proof and only match their scheme and version',()=>{
 const f=fixture();try{
  const rules=crosswalk(f),pin=new Map([['company_sector',new Map([['Synthetic pinned label',[]]])]])as any;
  const cases=[classifyCompany('software',[],rules),classifyCompany(null,[],rules),classifyCompany('Synthetic novel activity',[],rules),classifyCompany('dormant company',[],rules),classifyCompany('Synthetic pinned label',[],rules,pin)];
  assert.deepEqual(cases.map(row=>row.state),['mapped','no_label','not_yet_considered','outside_tracked_markets','pinned_unmapped_by_hand']);
  assert.deepEqual(cases.map(row=>row.method),['rule',null,null,'rule','manual']);
  const code=classifyCompany(null,[native('62012')],rules);assert.equal(code.rules_version,COMPANY_MAPPING_RULES_VERSION);assert.equal(code.state,'mapped');assert.equal(code.market_slug,'saas');assert.equal(code.method,'code');
  assert.equal((code.proof.crosswalk as any).industry_code,'62012');assert.equal((code.proof.crosswalk as any).industry_title,'Business and domestic software development');assert.equal((code.proof.native as any).native_label,null);
  assert.equal(classifyCompany(null,[native('62012',0,'2025')],rules).state,'not_yet_considered');assert.equal(classifyCompany(null,[native('62012',0,'2007','NAICS')],rules).state,'not_yet_considered');
  const outside=classifyCompany(null,[native('99999')],rules);assert.equal(outside.state,'outside_tracked_markets');assert.equal(outside.method,'code');assert.equal(outside.market_slug,null);
 }finally{f.db.close();}
});
test('manual precedes code, first placed register code precedes label, exact precedes the longest matching prefix',()=>{
 const f=fixture();try{
  const rules=crosswalk(f),ov=new Map([['company_sector',new Map([['software',['agtech']]])]])as any;
  assert.equal(classifyCompany('software',[native('62012')],rules,ov).market_slug,'agtech');
  assert.equal(classifyCompany('software',[native('unknown',0),native('73110',2),native('62012',1)],rules).market_slug,'saas');
  assert.equal(classifyCompany('software',[native('73110',0),native('62012',1)],rules).market_slug,'advertising');
  const prototype=rules.find(row=>row.code==='62012')!;
  const prefix=[{...prototype,code:'6',match_kind:'prefix',market_slug:'advertising'},{...prototype,code:'62',match_kind:'prefix',market_slug:'agtech'}]as ClassificationCrosswalk[];
  assert.equal(classifyCompany(null,[native('62012')],prefix).market_slug,'agtech');assert.equal(classifyCompany(null,[native('62012')],[...prefix,prototype]).market_slug,'saas');
 }finally{f.db.close();}
});
test('normalized company overrides apply, exact keys win and conflicting normalized keys are reported; fund and country overrides stay exact',()=>{
 const overrides=new Map([['company_sector',new Map([['Synthetic-Sector',['saas']]])],['fund_focus',new Map([['Synthetic-Focus',['saas']]])],['company_country',new Map([['Synthetic-Place',['GB']]])]])as any;
 assert.equal(mapCompanySector(' SYNTHETIC   SECTOR ',overrides).method,'manual');assert.deepEqual(mapCompanySector(' SYNTHETIC   SECTOR ',overrides).targets,['saas']);
 overrides.get('company_sector').set('synthetic sector',['agtech']);
 assert.deepEqual(mapCompanySector('Synthetic-Sector',overrides).targets,['saas']);assert.deepEqual(mapCompanySector('synthetic sector',overrides).targets,['agtech']);
 assert.deepEqual(resolveCompanySectorOverride('SYNTHETIC SECTOR',overrides).collisions,['Synthetic-Sector','synthetic sector']);
 assert.deepEqual(mapCompanySector('SYNTHETIC SECTOR',overrides),{raw:'SYNTHETIC SECTOR',targets:[],method:null,rule:null,unmatched:[]});
 assert.equal(classifyCompany('SYNTHETIC SECTOR',[native('62012')],[],overrides).proof.reason,'normalized_override_collision');
 assert.deepEqual(mapFundFocus('synthetic focus',overrides).targets,[]);assert.deepEqual(mapCompanyCountry('synthetic place',overrides).targets,[]);assert.equal(COUNTRY_ALIASES['united kingdom'],'GB');
});
test('UK SIC backfill preserves every code and register order without inventing native labels',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE research_market_directory(slug TEXT UNIQUE); CREATE TABLE research_taxonomy_overrides(kind TEXT,raw_value TEXT,target TEXT,note TEXT); CREATE TABLE research_company_directory(uid TEXT UNIQUE,source_name TEXT,sic_codes TEXT,sector TEXT); INSERT INTO research_company_directory VALUES('synthetic-ch','Companies House','62012, 73110,99999','software'),('not-ch','Other','62012','software')");
  db.exec(primary);
  assert.deepEqual(db.prepare('SELECT code,position,native_label,language,scheme,scheme_version FROM research_company_classifications ORDER BY position').all().map(row=>({...row})),['62012','73110','99999'].map((code,position)=>({code,position,native_label:null,language:null,scheme:'UK SIC',scheme_version:'2007'})));
  assert.throws(()=>db.exec("INSERT INTO research_classification_crosswalk VALUES('UK SIC','2007','0','exact','UK SIC','2007','0','Synthetic','mapped','not-a-market','Synthetic reason','2026-11-20','Synthetic')"),/FOREIGN KEY/);
 }finally{db.close();}
});
test('every reviewed SIC code keeps its old market, seed is reproducible and normalized industries use own codes and titles',()=>{
 const f=fixture();try{
  assert.equal(buildClassificationCrosswalk(asset),seed);const rules=crosswalk(f);
  for(const [code,label]of Object.entries(SIC_SECTORS)){
   const result=classifyCompany(null,[native(code)],rules);assert.equal(result.market_slug,mapCompanySector(String(label)).targets[0],code);assert.equal(result.method,'code');assert.equal((result.proof.crosswalk as any).industry_code,code);assert.ok((result.proof.crosswalk as any).industry_title);
  }
  const source=readFileSync(new URL('../src/services/researchTaxonomy.ts',import.meta.url),'utf8');assert.deepEqual(source.match(/^import (?!type).*$/gm),null);
 }finally{f.db.close();}
});
test('admin recompute is bounded and resumable over physical rows including held sources, repeatable, with counts and stale reads',async()=>{
 const f=fixture();try{
  assert.equal((await readCompanyClassification(f.env,'h-held')).state,'needs_recompute');
  let after='',done=false,version:string|null=null;const totals:Record<string,number>={},schemeTotals:Record<string,number>={};let methods=0,schemes=0;
  while(!done){const r=await call(f,'/recompute',{after,limit:3,rules_version:version});assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.processed<=3);for(const [state,n]of Object.entries(r.body.counts.state))totals[state]=(totals[state]||0)+Number(n);for(const [scheme,n]of Object.entries(r.body.counts.scheme))schemeTotals[scheme]=(schemeTotals[scheme]||0)+Number(n);methods+=Object.values(r.body.counts.method).reduce((a:any,b:any)=>a+b,0)as number;schemes+=Object.values(r.body.counts.scheme).reduce((a:any,b:any)=>a+b,0)as number;after=r.body.after;version=r.body.rules_version;done=r.body.done;}
  assert.deepEqual(totals,{mapped:3,outside_tracked_markets:2,no_label:1,not_yet_considered:1,pinned_unmapped_by_hand:1});assert.equal(methods,8);assert.equal(schemes,8);assert.deepEqual(schemeTotals,{none:5,'UK SIC':3});
  const before=f.db.prepare('SELECT * FROM research_company_mapping ORDER BY company_uid').all();assert.equal((await readCompanyClassification(f.env,'h-held')).state,'mapped');
  assert.equal((await call(f,'/recompute',{limit:100})).status,200);assert.deepEqual(f.db.prepare('SELECT * FROM research_company_mapping ORDER BY company_uid').all(),before);
  f.db.exec("UPDATE research_company_mapping SET rules_version='older' WHERE company_uid='h-held'");assert.deepEqual(await readCompanyClassification(f.env,'h-held'),{state:'needs_recompute',reason:'older_rules_version'});
  for(const limit of [0,101,1.5])assert.equal((await call(f,'/recompute',{limit})).status,400);
 }finally{f.db.close();}
});
test('admin override writes require the gate, validate market slugs, record authenticated author and reason in an atomic audit, and invalidate stale mappings',async()=>{
 const f=fixture();try{
  assert.equal((await call(f,'/recompute',{},null)).status,401);assert.equal((await call(f,'/recompute',{},2)).status,403);
  const body={raw_value:'Synthetic novel activity',target:'saas',reason:'Synthetic approved classification',author:2};
  assert.equal((await call(f,'/overrides',body,null)).status,401);assert.equal((await call(f,'/overrides',body,2)).status,403);
  assert.equal((await call(f,'/overrides',{...body,target:'not-a-market'})).status,400);assert.equal((await call(f,'/overrides',{...body,reason:''})).status,400);
  await call(f,'/recompute',{});const r=await call(f,'/overrides',body);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.author,1);
  const stored=f.db.prepare("SELECT author,note,method FROM research_taxonomy_overrides WHERE raw_value='Synthetic novel activity'").get()!;assert.equal(stored.author,1);assert.equal(stored.note,body.reason);assert.equal(stored.method,'manual');
  const audit=f.db.prepare("SELECT admin_user_id,filters_json FROM admin_audit_log WHERE action='research_company_sector_override_written'").get()!;assert.equal(audit.admin_user_id,1);assert.equal(JSON.parse(String(audit.filters_json)).reason,body.reason);
  assert.equal((await readCompanyClassification(f.env,'e-unreviewed')).state,'needs_recompute');
  await call(f,'/recompute',{});const mapped=await readCompanyClassification(f.env,'e-unreviewed');assert.equal(mapped.state,'mapped');assert.equal((mapped as any).method,'manual');
 }finally{f.db.close();}
});
test('audit failure rolls back override replacement and mapping invalidation',async()=>{
 const f=fixture();try{
  await call(f,'/recompute',{});const base=f.env.DB;
  f.env.DB={...base,batch:async(statements:any[])=>base.batch([...statements,base.prepare('INSERT INTO users(id,name,email) VALUES(1,?,?)').bind('Synthetic duplicate','duplicate@example.invalid')])};
  assert.equal((await call(f,'/overrides',{raw_value:'Synthetic novel activity',target:'saas',reason:'Synthetic reason'})).status,500);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM research_taxonomy_overrides WHERE raw_value='Synthetic novel activity'").get()!.n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM research_company_mapping').get()!.n,8);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE action='research_company_sector_override_written'").get()!.n,0);
 }finally{f.db.close();}
});

test('a concurrent override cannot leave a freshly versioned mapping from an older read',async()=>{
 const f=fixture();try{
  const base=f.env.DB;let injected=false;
  f.env.DB={...base,batch:async(statements:any[])=>{
   if(!injected){injected=true;f.db.exec("INSERT INTO research_company_mapping_revision(id,revision) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1");}
   return base.batch(statements);
  }};
  const result=await call(f,'/recompute',{});assert.equal(result.status,409);assert.equal(result.body.error,'recompute_rules_changed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM research_company_mapping').get()!.n,0);
  f.env.DB=base;assert.equal((await call(f,'/recompute',{})).status,200);assert.equal((await readCompanyClassification(f.env,'b-code')).state,'mapped');
 }finally{f.db.close();}
});

test('resumed recompute pages refuse a missing or older version after an intervening override',async()=>{
 const f=fixture();try{
  const first=await call(f,'/recompute',{limit:3});assert.equal(first.status,200);assert.equal(first.body.done,false);
  assert.equal((await call(f,'/recompute',{after:first.body.after,limit:3})).status,400);
  const changed=await call(f,'/overrides',{raw_value:'Synthetic novel activity',target:'saas',reason:'Synthetic approved update'});assert.equal(changed.status,200);
  const resumed=await call(f,'/recompute',{after:first.body.after,limit:3,rules_version:first.body.rules_version});assert.equal(resumed.status,409);assert.equal(resumed.body.error,'recompute_rules_changed');
  assert.equal((await readCompanyClassification(f.env,'a-rule')).state,'needs_recompute');
  const restarted=await call(f,'/recompute',{});assert.equal(restarted.status,200);assert.equal(restarted.body.done,true);assert.notEqual(restarted.body.rules_version,first.body.rules_version);
 }finally{f.db.close();}
});
