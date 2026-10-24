/** D891 / #2447: synthetic facts on the canonical schema, never request-claimed provenance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { checkInputs, computeReadiness, dataRoomCard, figures, loadVersions } from '../src/services/raiseCycle.ts';
import { runCheck } from '../src/services/raiseWriters.ts';
import { readableRoomFiles, mercuryFacts, selectedCheckSources } from '../src/services/raiseEvidence.ts';
import { buildMetrics, cleanMetrics } from '../src/services/updateShare.ts';
import { fillAxalSpinoutDemoDay } from '../src/services/decks/axalSpinoutDemoDay.ts';
import { mapToSpinoutDeckData } from '../src/services/decks/spinoutDeckData.ts';
const sql = (name: string) => readFileSync(new URL('../sql/migrations/' + name, import.meta.url), 'utf8');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const ddl = (() => {
 const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
 db.exec(baseline);
 for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter(n => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
  if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(sql(name));
 }
 const result = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map(r => r.sql).join(';\n');
 db.close(); return result;
})();
function fixture() {
 const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); db.exec(ddl);
 db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES (1,'founder','Synthetic founder','founder@example.test',11,1),(2,'investor','Synthetic investor','investor@example.test',NULL,1),(3,'founder','Other','other@example.test',33,1);
 INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'synthetic-one','Synthetic venture',11),(2,'synthetic-two','Other venture',33);`);
 const env:any = { DB:d1Over(db), ENVIRONMENT:'development' }; const ctx = { env, projectId:1, today:'2026-10-24' };
 return { db, env, ctx };
}
function bank(db:any, owner=1) {
 db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type,status) VALUES(1,'synthetic-bank',?,'mercury','oauth_mcp','active')").run(owner);
 db.exec(`INSERT INTO mercury_raise_facts(integration_id,project_id,kind,fact_key,label,amount_cents,burn_cents,value,as_of)
 VALUES(1,1,'runway','runway','Runway',1200000,100000,12,'2026-10-20'),(1,1,'revenue','revenue:2026-09','2026-09',150000,NULL,NULL,'2026-10-20');`);
}
function file(db:any, id:number, tier='invited', visibility='open', expiry:string|null=null) {
 db.prepare("INSERT INTO data_room_files(id,uid,project_id,name,r2_key,visibility,access_tier,access_expires_at,checklist_item) VALUES(?,?,1,?,?,?, ?,?,'incorporation')")
 .run(id,'synthetic-file-'+id,'Synthetic file '+id,'synthetic/'+id,visibility,tier,expiry);
}
function grant(db:any, expiry:string|null=null) {
 db.prepare("INSERT INTO data_room_grants(uid,project_id,investor_user_id,granted_by_user_id,status,expires_at) VALUES('synthetic-grant',1,2,1,'active',?)").run(expiry);
}
function narrative(db:any, selection:string|null='["metrics"]') {
 db.exec("INSERT INTO spinout_deck_overrides(project_id,field_key,value,version) VALUES(1,'traction.takeaway','$900 MRR and $600 monthly revenue',1)");
 db.prepare("INSERT INTO narrative_version_meta(project_id,version,check_against_json) VALUES(1,1,?)").run(selection);
 db.exec("INSERT INTO project_metrics(project_id,snapshot_date,source,mrr) VALUES(1,'2026-10-20','manual',900),(1,'2026-10-01','stripe',1000)");
}
const figure = async (ctx:any,key:string) => (await figures(ctx)).find(f=>f.key===key)!;
test('check-against is enforced on stored checks and version lists; a deck is never invented from project columns', async () => {
 const {db,env,ctx}=fixture(); narrative(db,'["deck"]'); db.exec('UPDATE projects SET mrr=40000 WHERE id=1');
 assert.equal((await checkInputs(env,1,1)).compared,0); assert.deepEqual(await runCheck(env,1,1),[]); assert.equal((await loadVersions(ctx))[0].compared,0);
 db.exec(`UPDATE narrative_version_meta SET check_against_json='["metrics"]'`);
 const mismatches=await runCheck(env,1,1); assert.equal(mismatches.length,1); assert.equal(mismatches[0].metric_value,1000);
 assert.match(mismatches[0].metric_source,/Stripe \(measured\)/); assert.equal((await loadVersions(ctx))[0].mismatches,1);
 db.exec(`UPDATE narrative_version_meta SET check_against_json='[]'`); assert.deepEqual(await runCheck(env,1,1),[]);
 assert.equal(db.prepare('SELECT count(*) n FROM narrative_checks').get()!.n,0);
 assert.deepEqual(selectedCheckSources('broken'),[]); assert.deepEqual(selectedCheckSources(null),['deck','metrics']);
});
test('metrics name stored typed, Mercury and verified revenue sources; credits are never MRR', async () => {
 const {db,env}=fixture(); narrative(db); db.exec("DELETE FROM project_metrics WHERE source='stripe'");
 let result=await checkInputs(env,1,1); assert.match(result.metrics.mrr!.source,/stated: manual/); assert.equal(result.metrics.revenue,undefined);
 bank(db); result=await checkInputs(env,1,1); assert.equal(result.metrics.revenue!.value,1500); assert.match(result.metrics.revenue!.source,/Mercury revenue credits/); assert.equal(result.metrics.mrr!.value,900);
 db.exec("INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,revenue_type,received_on,source,verification) VALUES('synthetic-revenue',1,'Synthetic customer',70000,'one_time',date('now','start of month','-1 month','+17 days'),'stripe','verified')");
 result=await checkInputs(env,1,1); assert.equal(result.metrics.revenue!.value,700); assert.match(result.metrics.revenue!.source,/Verified revenue/);
 db.exec("UPDATE revenue_entries SET received_on=date('now','start of month')"); assert.match((await checkInputs(env,1,1)).metrics.revenue!.source,/Mercury/);
 db.exec("UPDATE revenue_entries SET received_on='2000-01-01'"); assert.match((await checkInputs(env,1,1)).metrics.revenue!.source,/Mercury/);
 db.exec("UPDATE revenue_entries SET verification='supported'"); assert.match((await checkInputs(env,1,1)).metrics.revenue!.source,/Mercury/);
});
test('typed traction is stated; only verified ledger receipts justify measured traction', async () => {
 const {db,env}=fixture(); db.exec('UPDATE projects SET mrr=123,revenue=456,paying_customers=7 WHERE id=1');
 let traction=(await computeReadiness(env,1)).find(x=>x.key==='traction')!; assert.equal(traction.evidence,'stated'); assert.equal(traction.score,10);
 db.exec("INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,revenue_type,received_on,source,verification) VALUES('synthetic-revenue',1,'Customer',50000,'one_time',date('now','start of month','-1 month','+17 days'),'stripe','verified')");
 traction=(await computeReadiness(env,1)).find(x=>x.key==='traction')!; assert.equal(traction.evidence,'measured'); assert.match(traction.reads[0].b,/500/);
 db.exec("UPDATE revenue_entries SET received_on='2000-01-01'"); assert.equal((await computeReadiness(env,1)).find(x=>x.key==='traction')!.evidence,'stated');
 db.exec("UPDATE revenue_entries SET verification='manual'"); assert.equal((await computeReadiness(env,1)).find(x=>x.key==='traction')!.evidence,'stated');
});
test('readiness and coverage require a downloadable file: tier, expiry, active grant, active investor and NDA', async () => {
 const {db,env,ctx}=fixture(); file(db,1); file(db,2,'nobody'); file(db,3,'committed'); file(db,4,'invited','nda'); file(db,5,'invited','open','2000-01-01');
 assert.equal((await readableRoomFiles(env,1)).length,0); grant(db,'2000-01-01'); assert.equal((await readableRoomFiles(env,1)).length,0);
 db.exec('UPDATE data_room_grants SET expires_at=NULL'); assert.deepEqual((await readableRoomFiles(env,1)).map(f=>f.id),[1]);
 const ready=(await computeReadiness(env,1)).find(x=>x.key==='data_room')!; assert.match(ready.reads[0].b,/^1 in/);
 const before=await dataRoomCard(ctx); assert.notEqual(before.state,'empty');
 db.exec("INSERT INTO raise_prospects(uid,project_id,name,email,stage) VALUES('synthetic-prospect',1,'Investor','INVESTOR@example.test','committed')");
 assert.deepEqual((await readableRoomFiles(env,1)).map(f=>f.id),[1,3]);
 db.exec("INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(1,2,'active')");
 assert.deepEqual((await readableRoomFiles(env,1)).map(f=>f.id),[1,3,4]);
 db.exec("UPDATE pairwise_ndas SET valid_until='2000-01-01T12:00:00Z'"); assert.deepEqual((await readableRoomFiles(env,1)).map(f=>f.id),[1,3]);
 db.exec('UPDATE users SET is_active=0 WHERE id=2'); assert.equal((await readableRoomFiles(env,1)).length,0); assert.equal((await dataRoomCard(ctx)).state,'empty');
});
test('data-room activity counts downloads only, excluding blocked requests and room opens', async () => {
 const {db,ctx}=fixture(); file(db,1); grant(db);
 db.exec("INSERT INTO data_room_access_log(project_id,user_id,file_id,action) VALUES(1,2,1,'blocked'),(1,3,1,'open_room')");
 const before=JSON.stringify((await dataRoomCard(ctx)).series); db.exec("INSERT INTO data_room_access_log(project_id,user_id,file_id,action) VALUES(1,2,1,'download')");
 const after=JSON.stringify((await dataRoomCard(ctx)).series); assert.notEqual(after,before); assert.match(after,/1/);
 db.exec("INSERT INTO data_room_access_log(project_id,user_id,file_id,action) VALUES(1,3,1,'blocked')"); assert.equal(JSON.stringify((await dataRoomCard(ctx)).series),after);
});
test('soft, signed and received amounts are disjoint, with unknown amounts kept missing', async () => {
 const {db,ctx}=fixture(); db.exec("INSERT INTO raise_rounds(uid,project_id,name,status,target_amount) VALUES('synthetic-round',1,'Seed','active',1000000)");
 const insert=db.prepare("INSERT INTO raise_prospects(uid,project_id,name,stage,commit_status,amount) VALUES(?,1,'Investor','committed',?,?)");
 insert.run('soft','soft',100000); insert.run('signed','signed',200000); insert.run('received','wired',300000); insert.run('missing',null,null);
 let f=await figure(ctx,'committed'); assert.deepEqual(f.value,[500000,1000000]); assert.equal(f.label,'Signed or received against target'); assert.match(f.reason!,/Soft: \$100,000.*Signed: \$200,000.*Received: \$300,000.*Incomplete commitments: 1/);
 db.exec("DELETE FROM raise_prospects WHERE commit_status='signed'"); f=await figure(ctx,'committed'); assert.deepEqual(f.value,[300000,1000000]);
 db.exec("DELETE FROM raise_prospects WHERE commit_status='wired'");
 f=await figure(ctx,'committed'); assert.equal(f.value,null); assert.equal(f.state,'not_recorded');
 insert.run('legacy',null,400000); assert.match((await figure(ctx,'committed')).reason!,/Status not recorded: \$400,000/);
 insert.run('zero','signed',0); assert.deepEqual((await figure(ctx,'committed')).value,[0,1000000]);
});
test('runway prefers measured Mercury facts and fails visibly when a fact cannot be read', async () => {
 const {db,env,ctx}=fixture(); db.exec("INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn) VALUES(1,'2026-10-24','manual',10,10)");
 assert.equal((await figure(ctx,'runway_months')).value,1); assert.match((await figure(ctx,'runway_months')).source,/stated/);
 bank(db); let f=await figure(ctx,'runway_months'); assert.equal(f.value,12); assert.match(f.source,/Mercury.*measured/); assert.equal(f.as_of,'2026-10-20');
 db.exec("UPDATE integrations SET status='disconnected'"); assert.equal((await figure(ctx,'runway_months')).value,1);
 db.exec("UPDATE integrations SET status='active',user_id=3"); assert.equal((await mercuryFacts(env,1,'runway')).length,0);
 db.exec('UPDATE integrations SET user_id=1'); db.exec("UPDATE mercury_raise_facts SET burn_cents=0 WHERE kind='runway'"); assert.equal((await figure(ctx,'runway_months')).value,null);
 db.exec('DROP TABLE mercury_raise_facts'); assert.equal((await figure(ctx,'runway_months')).state,'unreadable');
});
test('an update source needs an exact server fact, including key, unit, value, date and source', () => {
 const facts=buildMetrics([{snapshot_date:'2026-10-01',source:'stripe',mrr:100,paying_accounts:null,net_burn:null,cash_balance:null}],[],'2026-10-01');
 const m=facts[0]; assert.equal(cleanMetrics([m],facts)[0].source,'stripe'); assert.equal(cleanMetrics([m])[0].source,'typed');
 for (const changed of [{value:101},{as_of:'2026-10-02'},{source:'mercury'},{unit:'count'},{key:'burn'}]) assert.equal(cleanMetrics([{...m,...changed}],facts)[0].source,'typed');
 assert.equal(cleanMetrics([{...m,value:null}],facts)[0].source,null);
});
test('demo-day readiness reads downloadable files, never a URL; failed reads are Unreadable', async () => {
 const {db,env}=fixture(); db.exec("UPDATE projects SET data_room_url='https://example.invalid/room' WHERE id=1");
 const deck=()=>fillAxalSpinoutDemoDay(env,1,1);
 assert.equal((await deck()).contact.deal_access.data_room_ready,false);
 file(db,1); grant(db); assert.equal((await deck()).contact.deal_access.data_room_ready,true);
 db.exec("UPDATE data_room_files SET access_tier='nobody'"); assert.equal((await deck()).contact.deal_access.data_room_ready,false);
 db.exec('DROP TABLE data_room_grants'); const unreadable=await deck(); assert.equal(unreadable.contact.deal_access.data_room_ready,null);
 assert.match(JSON.stringify(mapToSpinoutDeckData(unreadable)),/Unreadable/);
});
test('migration 536 relabels historical computed traction only and preserves score history, actors and constraints', () => {
 const {db}=fixture(); db.exec('DROP TABLE readiness_scores');
 // Recreate just the old table from its original migration, without replaying ALTERs.
 const old=sql('442_raise_cycle_stores.sql'); const at=old.indexOf('CREATE TABLE IF NOT EXISTS readiness_scores'); db.exec(old.slice(at,old.indexOf('\n);',at)+4));
 db.exec("INSERT INTO readiness_items(id,project_id,item_key,label) VALUES(1,1,'traction','Traction'),(2,1,'deck','Deck')");
 db.exec("INSERT INTO readiness_scores(id,item_id,project_id,score,evidence,source,scored_by,scored_at,missing) VALUES(91,1,1,7,'measured','computed',1,'2026-09-01','Synthetic missing'),(92,1,1,8,'pattern','manual',1,'2026-09-02',NULL),(93,2,1,10,'measured','computed',1,'2026-09-03',NULL)");
 const before=db.prepare('SELECT * FROM readiness_scores ORDER BY id').all() as any[]; db.exec(sql('536_readiness_stated_evidence.sql'));
 assert.deepEqual(db.prepare('SELECT * FROM readiness_scores ORDER BY id').all().map(r=>({...r})),before.map(r=>({...r,evidence:r.id===91?'stated':r.evidence})));
 assert.throws(()=>db.exec("INSERT INTO readiness_scores(item_id,project_id,score,evidence) VALUES(1,1,7,'invented')"),/CHECK/);
 assert.throws(()=>db.exec("INSERT INTO readiness_scores(item_id,project_id,score,evidence) VALUES(1,1,11,'stated')"),/CHECK/);
 db.exec("INSERT INTO readiness_scores(item_id,project_id,score,evidence) VALUES(1,1,0,'stated')"); assert.equal(db.prepare('SELECT MAX(id) n FROM readiness_scores').get()!.n,94);
});
