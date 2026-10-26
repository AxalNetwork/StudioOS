/** D1263: real SQLite, production schema + migrations; all people/figures are synthetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import router from '../src/routes/cycle_raise.ts';
import { collectEvidenceSources, evidenceDate, evidenceStale, EVIDENCE_RULES, candidateKey } from '../src/services/raiseEvidenceSources.ts';
import { raiseEvidenceContext, buildCandidates, acceptItem, dismissItem, setSharing, linkClaim, readRaiseEvidence } from '../src/services/raiseEvidence.ts';
import { decideRail } from '../src/services/railProposals.ts';
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8');
const DDL=(()=>{const db=new DatabaseSync(':memory:',{enableDoubleQuotedStringLiterals:true});db.exec(read('../sql/schema_baseline.sql'));
 for(const f of readdirSync(new URL('../sql/migrations/',import.meta.url)).filter(f=>/^\d+_.*\.sql$/.test(f)&&migrationNumber(f)>BASELINE_CUTOFF).sort(compareMigrations))db.exec(read('../sql/migrations/'+f));
 const ddl=db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all().map((r:any)=>r.sql);db.close();return ddl;})();
const secret='synthetic-evidence-secret-0123456789-abcdef';
function world(){
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,enableDoubleQuotedStringLiterals:true});for(const sql of DDL)db.exec(sql);
 db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active,spinout_lab_active) VALUES
 (1,'Synthetic Founder','one@example.invalid','founder',100,1,0),(2,'Other Founder','two@example.invalid','founder',200,1,0),
 (3,'Synthetic Admin','three@example.invalid','admin',NULL,1,0),(4,'Synthetic Partner','four@example.invalid','partner',NULL,1,0),
 (5,'Synthetic Investor','five@example.invalid','investor',NULL,1,0),(6,'Lab Founder','six@example.invalid','exploring',100,1,1);
 INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic Venture',100,10),(2,'Other Venture',200,20);
 INSERT INTO company_profiles(id,uid,company_name) VALUES(10,'company-one','Synthetic One'),(20,'company-two','Synthetic Two');
 INSERT INTO user_company_links(uid,user_id,company_id) VALUES('one',1,10),('two',2,20),('three',3,10),('six',6,10);`);
 const env:any={DB:d1Over(db),JWT_SECRET:secret,ENVIRONMENT:'development'};
 const ctx:any={env,user:db.prepare('SELECT * FROM users WHERE id=1').get(),projectId:1,companyId:10,founder:true};
 const app=new Hono<any>();app.route('/api/cycles/raise',router);
 return {db,env,ctx,app};
}
type World=ReturnType<typeof world>;
/** Only fills required fixture columns; the source under test and dates are always explicit below. */
function seed(w:World,table:string,values:Record<string,unknown>){
 if(!/^[a-z_0-9]+$/.test(table))throw new Error('bad fixture table');
 const row={...values};for(const c of w.db.prepare('PRAGMA table_info('+table+')').all() as any[])if(c.notnull&&!c.pk&&c.dflt_value==null&&!(c.name in row))row[c.name]=/INT|REAL|NUM/.test(c.type)?1:c.name==='uid'?table+'-'+String(values.id??values.external_id??values.user_id??'one'):'synthetic';
 const keys=Object.keys(row);for(const k of keys)if(!/^[a-z_0-9]+$/.test(k))throw new Error('bad fixture column');
 w.db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k] as any));
}
function sources(w:World){
 seed(w,'integrations',{id:1,user_id:1,provider_key:'mercury',status:'active'});seed(w,'integrations',{id:2,user_id:1,provider_key:'github',status:'active'});
 seed(w,'data_room_files',{id:1,uid:'file-one',project_id:1,name:'PRIVATE NAME',r2_key:'PRIVATE KEY'});
 seed(w,'revenue_entries',{id:1,uid:'revenue-one',project_id:1,customer:'PRIVATE CUSTOMER',revenue_type:'recurring',amount_cents:100,currency:'usd',received_on:'2026-09-01',source:'mercury',verification:'verified',proof_document_id:1});
 for(const [id,kind,key,value,months] of [[1,'runway','runway',8,3],[2,'revenue','revenue:2026-09',null,3],[3,'spend','spend:product',null,6]])seed(w,'mercury_raise_facts',{id,integration_id:1,project_id:1,kind,fact_key:key,value,months,amount_cents:123400,label:'product',as_of:'2026-09-02'});
 seed(w,'mercury_raise_proposals',{id:1,integration_id:1,project_id:1,kind:'fund_mapping',source_key:'product',status:'accepted',target:'product'});
 seed(w,'mercury_raise_proposals',{id:2,integration_id:1,project_id:1,kind:'statement',source_key:'statement-one',status:'accepted',local_table:'data_room_files',local_id:1,payload_json:JSON.stringify({month:'2026-09',account_id:'PRIVATE ACCOUNT',last_four:'9876'})});
 seed(w,'mercury_raise_proposals',{id:3,integration_id:1,project_id:1,kind:'safe',source_key:'safe-one',status:'accepted',local_table:'cap_table_holders',local_id:1,payload_json:JSON.stringify({date:'2026-09-03',amount_cents:200000,investor_name:'PRIVATE INVESTOR'})});
 seed(w,'cap_table_holders',{id:1,user_id:1,project_id:1,kind:'founder',source:'manual',founder_role:'ceo',ownership_pct:50,created_at:'2026-09-04'});
 seed(w,'cap_table_vesting',{id:1,user_id:1,holder_id:1,project_id:1,source:'manual',total_shares:100,start_date:'2026-09-05'});
 seed(w,'github_login_map',{project_id:1,login:'PRIVATE LOGIN',holder_id:1,mapped_by:1});
 seed(w,'github_contributors',{id:1,integration_id:2,project_id:1,repository:'PRIVATE REPO',login:'PRIVATE LOGIN',commits_90d:0,updated_at:'2026-10-26'});
 seed(w,'skill_evidence',{user_id:1,axis:'engineering',source:'action',count_window:3,count_lifetime:3,last_at:'2026-09-06'});
 seed(w,'pain_groups',{id:1,project_id:1,title:'Slow setup'});seed(w,'pain_group_aliases',{project_id:1,group_id:1,phrase_norm:'slow setup',display_phrase:'Slow setup'});
 seed(w,'discovery_interviews',{id:1,project_id:1,interviewee_name:'PRIVATE INTERVIEWEE',interview_date:'2026-09-07',pains_json:'["Slow setup"]',quote_consent:1,notes:'PRIVATE QUOTE',icp_fit:'strong'});
 seed(w,'demand_signals',{id:1,project_id:1,kind:'loi',status:'confirmed',signal_date:'2026-09-08',source_kind:'interview',interview_id:1,evidence_file_key:'PRIVATE FILE',amount_cents:100,currency:'usd'});
 seed(w,'hypothesis_experiments',{id:1,uid:'experiment-one',project_id:1,result:'PRIVATE RESULT',status:'done',updated_at:'2026-10-26'});
 seed(w,'validation_decisions',{id:1,project_id:1,decision:'proceed',state:'given',decided_at:'2026-09-09'});
 seed(w,'project_metrics',{id:1,project_id:1,snapshot_date:'2026-09-10',source:'manual',mrr:0,cash_balance:987654321});
 seed(w,'roadmap_releases',{id:1,project_id:1,repository:'PRIVATE REPO',tag:'v1',published_at:'2026-09-11',prerelease:0});
 seed(w,'mvp_features',{id:1,project_id:1,title:'Synthetic feature',is_must_have:1,delivery_status:'done',done_at:'2026-09-12'});
 seed(w,'use_of_funds_hires',{id:1,uid:'hire-one',project_id:1,category_key:'product',role:'PRIVATE ROLE',annual_cents:100000,currency:'usd',created_at:'2026-09-13'});
 seed(w,'roadmap_okrs',{id:1,project_id:1,objective:'Synthetic',target_date:'2027-01-01',created_at:'2026-09-14'});
 seed(w,'formation_steps',{id:1,project_id:1,title:'Synthetic formation',kind:'formation',state:'done',proof_file_key:'PRIVATE PROOF',updated_at:'2026-10-26'});
 seed(w,'entity_obligations',{id:1,uid:'obligation-one',entity_id:1,kind:'annual_report',cadence:'annual',status:'filed',resolved_on:'2026-09-15'});w.db.exec('UPDATE projects SET entity_id=1 WHERE id=1');
 seed(w,'documents',{id:1,uid:'document-one',project_id:1,title:'Synthetic document',doc_type:'cofounder',status:'signed',signed_at:'2026-09-16',content:'PRIVATE DOCUMENT'});
 seed(w,'section_83b_trackers',{id:1,uid:'83b-one',project_id:1,user_id:1,status:'filed',mailed_at:'2026-09-17'});
 seed(w,'raise_prospects',{id:1,uid:'prospect-one',project_id:1,name:'PRIVATE INVESTOR',email:'private@example.invalid',stage:'committed',commit_status:'soft',amount_cents:50000,currency:'USD',updated_at:'2026-10-26'});
 seed(w,'mercury_personal_matches',{id:1,uid:'match-one',user_id:1,integration_id:1,account_last_four:'1234',target_kind:'raise_prospect',target_id:1,state:'confirmed',amount_cents:50000,posted_on:'2026-09-18'});
 seed(w,'round_calls',{id:1,uid:'call-one',project_id:1,company_id:10,state:'sent',instrument:'safe'});seed(w,'round_call_recipients',{id:1,origin:'chosen',call_id:1,investor_user_id:5,commitment_cents:50000,responded_at:'2026-09-19'});
 seed(w,'financial_models',{id:1,project_id:1,assumptions_json:'{"monthly_growth_pct":0,"monthly_churn_pct":2,"cac":10,"gross_margin_pct":80}',updated_by:1,updated_at:'2026-09-20'});
 for(const [id,table,kind] of [[1,'roadmap_releases','release'],[2,'formation_steps','ip_step']])seed(w,'connector_fed_items',{integration_id:2,project_id:1,module:'build',kind,external_id:'external-'+id,local_table:table,local_id:1});
}
async function call(w:World,who:number|null,method='GET',tail='/evidence?project=1',body?:unknown,claims:Record<string,unknown>={},headers:Record<string,string>={}){
 const auth=who==null?{}:{Authorization:'Bearer '+await new SignJWT({user_id:who,...claims}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret))};
 const r=await w.app.request('/api/cycles/raise'+tail,{method,headers:{'Content-Type':'application/json','X-Company-Id':'10',...auth,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})},w.env);
 return {status:r.status,cache:r.headers.get('Cache-Control'),body:await r.json() as any};
}
const proposal=(w:World,kind='kpi-snapshot')=>w.db.prepare("SELECT uid,payload_json FROM ai_rail_proposals WHERE status='proposed' AND json_extract(payload_json,'$.kind')=? LIMIT 1").get(kind) as any;
const auditCount=(w:World)=>Number(w.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action<>'evidence_refreshed'").get()?.n);
async function pin(w:World,kind='kpi-snapshot'){await buildCandidates(w.ctx);const q=proposal(w,kind);return acceptItem(w.ctx,q.uid,JSON.parse(q.payload_json).snapshot_hash);}

test('each pack kind has its source label and actual source date; missing dates and measured zero survive',async()=>{
 const w=world();try{sources(w);const got=await collectEvidenceSources(w.env,1,1,'2026-10-26');assert.deepEqual(got.blocks.filter(b=>b.state==='unreadable'),[]);
 const expected:Record<string,[string,string|null]>={
 'revenue-receipt':['connector','2026-09-01'],'bank-runway':['connector','2026-09-02'],'founder-holding':['typed','2026-09-04'],'vesting-schedule':['typed','2026-09-05'],'founder-commits':['connector',null],'skill-actions':['recorded','2026-09-06'],'pain-theme':['recorded','2026-09-07'],'consented-quote':['recorded','2026-09-07'],'icp-fit':['recorded','2026-09-07'],'demand-signal':['document','2026-09-08'],'experiment-result':['typed',null],'validation-verdict':['typed','2026-09-09'],'kpi-snapshot':['typed','2026-09-10'],'bank-revenue':['connector','2026-09-02'],'roadmap-release':['connector','2026-09-11'],'must-have-done':['typed','2026-09-12'],'mapped-bank-spend':['connector','2026-09-02'],'hiring-plan':['typed','2026-09-13'],'roadmap-milestone':['typed','2026-09-14'],'formation-proof':['document',null],'filed-obligation':['signed','2026-09-15'],'signed-document':['signed','2026-09-16'],'github-ip-step':['connector',null],'bank-statement':['connector','2026-09'],'loi-file':['document','2026-09-08'],'revenue-proof':['document','2026-09-01'],'accepted-safe':['connector','2026-09-03'],'filed-83b':['signed','2026-09-17'],'signed-founder-equity':['signed','2026-09-16'],'confirmed-receipt':['connector','2026-09-18'],'round-call-response':['recorded','2026-09-19'],'typed-commitment':['typed',null],'model-assumption':['typed','2026-09-20']};
 assert.deepEqual(Object.keys(expected).sort(),EVIDENCE_RULES.map(r=>r.kind).sort());
 for(const [kind,[label,date]] of Object.entries(expected)){const rows=got.candidates.filter(c=>c.kind===kind);assert.ok(rows.length>0,kind);for(const c of rows){assert.equal(c.source_label,label,kind);assert.equal(c.observed_on,date,kind);if(c.source_label==='typed')assert.equal(c.strength,'anecdote');}}
 assert.equal(new Set(got.candidates.map(candidateKey)).size,got.candidates.length);
 assert.equal(got.candidates.find(c=>c.kind==='kpi-snapshot')?.value_num,0);assert.equal(got.candidates.find(c=>c.kind==='founder-commits')?.value_num,0);
 assert.doesNotMatch(JSON.stringify(got.candidates),/PRIVATE|987654321|private@example/);
 assert.equal(evidenceDate('2026-02-30'),null);assert.equal(evidenceDate('2026-09'), '2026-09');assert.equal(evidenceStale(null,90,'2026-10-26'),null);assert.equal(evidenceStale('2025-01-01',365,'2026-10-26'),true);assert.equal(evidenceStale('2026-10-01',90,'2026-10-26'),false);
 }finally{w.db.close();}
});
test('connector proof, mapping, quote consent and saved assumptions are required; no defaults are invented',async()=>{
 const w=world();try{sources(w);w.db.exec("UPDATE integrations SET status='revoked'; UPDATE discovery_interviews SET quote_consent=0; DELETE FROM github_login_map; UPDATE financial_models SET updated_by=NULL; UPDATE mercury_raise_proposals SET status='dismissed'");
 const got=await collectEvidenceSources(w.env,1,1);for(const kind of ['bank-runway','founder-commits','consented-quote','bank-revenue','roadmap-release','mapped-bank-spend','github-ip-step','bank-statement','accepted-safe','confirmed-receipt','model-assumption'])assert.equal(got.candidates.some(c=>c.kind===kind),false,kind);
 assert.ok(got.candidates.some(c=>c.kind==='kpi-snapshot'));assert.equal(got.candidates.find(c=>c.kind==='typed-commitment')?.source_label,'typed');
 }finally{w.db.close();}
});
test('freshness is one hour, force refresh works, safe proposal payloads carry no figures, and dismiss is permanent',async()=>{
 const w=world();try{sources(w);const first=await buildCandidates(w.ctx,{now:'2026-10-26T12:00:00Z'});assert.equal(first.outcome,'recorded');assert.ok(first.changed>0);
 assert.equal((await buildCandidates(w.ctx,{now:'2026-10-26T12:30:00Z'})).refreshed,false);assert.equal((await buildCandidates(w.ctx,{force:true,now:'2026-10-26T12:30:00Z'})).refreshed,true);
 const q=proposal(w);await dismissItem(w.ctx,q.uid);w.db.exec('UPDATE project_metrics SET mrr=25');await buildCandidates(w.ctx,{force:true,now:'2026-10-26T13:31:00Z'});
 assert.equal(w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(q.uid)?.status,'discarded');assert.equal(w.db.prepare("SELECT COUNT(*) n FROM ai_rail_proposals WHERE json_extract(payload_json,'$.kind')='kpi-snapshot' AND json_extract(payload_json,'$.area')='Investor narrative and Pitch deck'").get()?.n,1);
 assert.doesNotMatch(JSON.stringify(w.db.prepare('SELECT payload_json FROM ai_rail_proposals').all()),/PRIVATE|123400|987654321|value_num/);
 assert.equal(auditCount(w),1);assert.equal(w.db.prepare("SELECT written_value FROM fill_provenance WHERE target_table='ai_rail_proposals'").get()?.written_value,'discarded');
 }finally{w.db.close();}
});
test('accept rebuilds values, defaults privacy, refuses changed snapshots and accepts once with provenance and audit',async()=>{
 const w=world();try{sources(w);await buildCandidates(w.ctx);const q=proposal(w);const hash=JSON.parse(q.payload_json).snapshot_hash;
 w.db.exec('UPDATE project_metrics SET mrr=25');await assert.rejects(()=>acceptItem(w.ctx,q.uid,hash),{code:'changed'});assert.equal(auditCount(w),0);
 w.db.exec('UPDATE project_metrics SET mrr=0');const item=await acceptItem(w.ctx,q.uid,hash);assert.equal(item.value_num,0);assert.equal(item.source_label,'typed');assert.equal(item.visibility,'after_nda');
 await assert.rejects(()=>acceptItem(w.ctx,q.uid,hash),{code:'decided'});assert.equal(auditCount(w),1);
 for(const kind of ['bank-runway','consented-quote']){const r=proposal(w,kind);const i=await acceptItem(w.ctx,r.uid,JSON.parse(r.payload_json).snapshot_hash);assert.equal(i.visibility,'private');}
 const provenance=w.db.prepare("SELECT * FROM fill_provenance WHERE target_table='raise_evidence_items'").all() as any[];assert.equal(provenance.length,3);assert.equal(JSON.parse(provenance[0].citation_json).source_label,'typed');assert.equal(provenance[0].ai_usage_log_id,null);
 assert.match(String(w.db.prepare("SELECT details FROM activity_logs WHERE action='evidence_accepted' ORDER BY id LIMIT 1").get()?.details),/kpi-snapshot \(typed\)/);
 }finally{w.db.close();}
});
test('sharing and links are versioned, never claim Backed, invalidate cached checks, and unpin works after source deletion',async()=>{
 const w=world();try{sources(w);const i=await pin(w);seed(w,'raise_claims',{uid:'claim-one',project_id:1,surface:'deck',surface_version:'v1',field_key:'mrr',claim_kind:'mrr',state:'backed'});
 await assert.rejects(()=>linkClaim(w.ctx,'claim-one',{item_id:i.uid,item_version:1,how:'computed'}),{code:'invalid'});
 assert.equal((await linkClaim(w.ctx,'claim-one',{item_id:i.uid,item_version:1})).how,'founder');assert.equal(w.db.prepare('SELECT state FROM raise_claims').get()?.state,'not_backed');
 w.db.exec("UPDATE raise_claims SET state='backed'; UPDATE project_metrics SET mrr=50");
 await assert.rejects(()=>setSharing(w.ctx,i.uid,{version:1,visibility:'summary'}),{code:'changed'});
 const changed=await setSharing(w.ctx,i.uid,{version:1,visibility:'summary',confirm_current:true});assert.equal(changed.version,2);assert.equal(changed.value_num,50);assert.equal(w.db.prepare('SELECT state FROM raise_claims').get()?.state,'not_backed');
 await assert.rejects(()=>setSharing(w.ctx,i.uid,{version:1,visibility:'private'}),{code:'changed'});
 await linkClaim(w.ctx,'claim-one',{item_id:i.uid},true);assert.equal(w.db.prepare('SELECT COUNT(*) n FROM raise_claim_evidence').get()?.n,0);
 w.db.exec('DELETE FROM project_metrics');const unpinned=await setSharing(w.ctx,i.uid,{version:2,state:'unpinned',visibility:'private'});assert.equal(unpinned.state,'unpinned');
 await assert.rejects(()=>setSharing(w.ctx,i.uid,{version:3,state:'pinned'}),{code:'changed'});assert.equal(auditCount(w),5);
 }finally{w.db.close();}
});
test('audit/provenance failure and a stale founder permission roll every decision back',async()=>{
 for(const fail of ['audit','provenance','permission']){const w=world();try{sources(w);await buildCandidates(w.ctx);const q=proposal(w);const base=w.env.DB;
 if(fail==='permission')w.db.exec('UPDATE users SET is_active=0 WHERE id=1');else w.env.DB={...base,batch:(stmts:any[])=>base.batch([...stmts,base.prepare(fail==='audit'?"INSERT INTO activity_logs(id) VALUES(NULL)":"INSERT INTO fill_provenance(target_table) VALUES('synthetic')")])};
 await assert.rejects(()=>acceptItem(w.ctx,q.uid,JSON.parse(q.payload_json).snapshot_hash));assert.equal(w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(q.uid)?.status,'proposed');assert.equal(w.db.prepare('SELECT COUNT(*) n FROM raise_evidence_items').get()?.n,0);assert.equal(auditCount(w),0);assert.equal(w.db.prepare('SELECT COUNT(*) n FROM fill_provenance').get()?.n,0);
 }finally{w.db.close();}}
});
test('generic decisions cannot bypass evidence writers; ordinary proposals keep working',async()=>{
 const w=world();try{sources(w);await buildCandidates(w.ctx);const q=proposal(w);assert.equal(await decideRail(w.env,1,q.uid,'accept'),null);assert.equal(await decideRail(w.env,1,q.uid,'discard'),null);
 seed(w,'ai_rail_proposals',{uid:'normal-one',user_id:1,rail_page:'/raise/evidence',rail_option:'ordinary:option',kind:'proposal',payload_json:'{}'});assert.equal((await decideRail(w.env,1,'normal-one','accept'))?.status,'accepted');assert.equal(w.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(q.uid)?.status,'proposed');
 }finally{w.db.close();}
});
test('source failures stay unreadable without blanking other sources; invalid paging is refused',async()=>{
 const w=world();try{sources(w);w.db.exec('DROP TABLE project_metrics');const got=await readRaiseEvidence(w.ctx);assert.equal(got.refresh.outcome,'partial');assert.equal(got.sources?.find(b=>b.dataset==='metrics')?.count,null);assert.equal(got.sources?.find(b=>b.dataset==='metrics')?.state,'unreadable');assert.ok((got.proposals.rows?.length??0)>0);
 await assert.rejects(()=>readRaiseEvidence(w.ctx,{limit:0}),{code:'invalid'});assert.equal(evidenceStale('2026-07',90,'2026-10-26'),null);
 }finally{w.db.close();}
});
test('routes enforce founder ownership, active company and support refusal; admins read safe metadata only',async()=>{
 const w=world();try{sources(w);const i=await pin(w,'bank-runway');
 const own=await call(w,1);assert.equal(own.status,200);assert.equal(own.cache,'no-store');assert.equal(own.body.permissions.can_decide,true);
 for(const who of [2,4,5])assert.equal((await call(w,who)).status,403);assert.equal((await call(w,null)).status,401);
 assert.equal((await call(w,1,'GET','/evidence?project=1',undefined,{}, {'X-Company-Id':'20'})).status,403);
 const admin=await call(w,3);assert.equal(admin.status,200);assert.equal(admin.body.permissions.can_decide,false);assert.equal(admin.body.items.rows.some((r:any)=>r.uid===i.uid),false);assert.doesNotMatch(JSON.stringify(admin.body),/PRIVATE|123400|value_num|stated_value/);
 assert.equal((await call(w,3,'PATCH',`/evidence/items/${i.uid}?project=1`,{version:1,visibility:'summary'})).status,403);
 assert.equal((await call(w,6)).status,200);assert.equal((await call(w,1,'GET','/evidence?project=1',undefined,{impersonated_by:3})).status,403);
 assert.equal((await call(w,1,'GET','/evidence?project=1&limit=banana')).status,400);
 const q=proposal(w);assert.equal((await call(w,1,'POST',`/evidence/items/${q.uid}/accept?project=1`,{snapshot_hash:JSON.parse(q.payload_json).snapshot_hash,source_label:'connector'})).status,400);
 assert.equal((await call(w,1,'POST','/evidence/refresh?project=1')).status,200);
 await assert.rejects(()=>raiseEvidenceContext(w.env,w.ctx.user,2,20),{code:'forbidden'});
 }finally{w.db.close();}
});

test('Eadwyn links require the exact proposal and a matching real run; project-composite foreign keys reject cross-venture links',async()=>{
 const w=world();try{sources(w);const i=await pin(w);seed(w,'raise_claims',{id:1,uid:'claim-one',project_id:1,surface:'deck',surface_version:'v1',field_key:'mrr',claim_kind:'mrr'});
 seed(w,'ai_usage_logs',{id:1,user_id:1,task:'evidence-link',model:'synthetic-model',rail_option:'raise:evidence-link',record_ref:'project:1'});
 seed(w,'ai_rail_proposals',{uid:'link-one',user_id:1,rail_page:'/raise/evidence',rail_option:'raise:evidence-link',record_ref:'project:1',kind:'proposal',model:'synthetic-model',usage_log_id:1,payload_json:JSON.stringify({claim_id:'claim-one',item_id:i.uid,snapshot_hash:i.snapshot_hash})});
 assert.equal(await decideRail(w.env,1,'link-one','accept'),null);
 w.db.exec("UPDATE ai_usage_logs SET model='other-model'");await assert.rejects(()=>linkClaim(w.ctx,'claim-one',{item_id:i.uid,item_version:1,proposal_uid:'link-one'}),{code:'forbidden'});assert.equal(w.db.prepare('SELECT COUNT(*) n FROM raise_claim_evidence').get()?.n,0);
 w.db.exec("UPDATE ai_usage_logs SET model='synthetic-model'");const linked=await linkClaim(w.ctx,'claim-one',{item_id:i.uid,item_version:1,proposal_uid:'link-one'});assert.equal(linked.how,'eadwyn_accepted');
 const p=w.db.prepare("SELECT ai_usage_log_id,model FROM fill_provenance WHERE target_table='raise_claim_evidence'").get();assert.equal(p?.ai_usage_log_id,1);assert.equal(p?.model,'synthetic-model');
 seed(w,'raise_claims',{id:2,uid:'other-claim',project_id:2,surface:'deck',surface_version:'v1',field_key:'mrr',claim_kind:'mrr'});w.db.exec('PRAGMA foreign_keys=ON');
 assert.throws(()=>w.db.prepare("INSERT INTO raise_claim_evidence(project_id,claim_id,item_id,how,mutation_uid) VALUES(1,2,?,'founder','cross')").run(i.id),/FOREIGN KEY/);
 await assert.rejects(()=>linkClaim(w.ctx,'other-claim',{item_id:i.uid,item_version:1}),{code:'not_found'});
 }finally{w.db.close();}
});
test('bounded refresh progresses across a large pack; source identity and pagination remain stable',async()=>{
 const w=world();try{sources(w);const base=(await collectEvidenceSources(w.env,1,1)).candidates.find(c=>c.kind==='kpi-snapshot')!;
 const candidates=Array.from({length:501},(_,n)=>({...base,source_ref:String(n)+':mrr'}));const input={candidates,blocks:[{dataset:'metrics',state:'recorded',count:501}]} as any;
 const first=await buildCandidates(w.ctx,{sources:input,now:'2026-10-26T12:00:00Z'});assert.equal(first.changed,500);assert.equal(first.remaining,1);assert.equal(first.outcome,'partial');
 const second=await buildCandidates(w.ctx,{sources:input,now:'2026-10-26T12:01:00Z'});assert.equal(second.changed,1);assert.equal(second.outcome,'recorded');assert.equal(w.db.prepare('SELECT COUNT(*) n FROM ai_rail_proposals').get()?.n,501);
 const page=await readRaiseEvidence(w.ctx,{limit:10,offset:20});assert.equal(page.proposals.rows?.length,10);assert.equal(page.proposals.has_more,true);
 }finally{w.db.close();}
});
