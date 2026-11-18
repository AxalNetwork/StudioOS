/** #6315: real SQLite acceptance receipts, atomic undo, actor audit and same-second edit refusal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { growProposalReceipts,rememberGrowProposal,undoGrowProposal } from '../src/services/growProposalReceipts.ts';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE projects(id INTEGER PRIMARY KEY);CREATE TABLE users(id INTEGER PRIMARY KEY);
  INSERT INTO projects VALUES(7),(8);INSERT INTO users VALUES(1),(2);
  CREATE TABLE growth_partners(id INTEGER PRIMARY KEY,uid TEXT,project_id INTEGER,name TEXT);
  CREATE TABLE compliance_events(id INTEGER PRIMARY KEY,project_id INTEGER,title TEXT);
  CREATE TABLE product_feedback(id INTEGER PRIMARY KEY,uid TEXT,project_id INTEGER,body TEXT);
  CREATE TABLE growth_channels(id INTEGER PRIMARY KEY,uid TEXT,project_id INTEGER,name TEXT);
  CREATE TABLE partner_revenue(partner_id INTEGER);CREATE TABLE growth_partner_deals(partner_id INTEGER);
  CREATE TABLE channel_spend(channel_id INTEGER);CREATE TABLE grow_campaign_channels(channel_id INTEGER);
  CREATE TABLE integrations(id INTEGER PRIMARY KEY,user_id INTEGER);INSERT INTO integrations VALUES(41,1),(42,1);
  CREATE TABLE connector_fed_items(integration_id INTEGER,project_id INTEGER,external_id TEXT,local_table TEXT,local_id INTEGER);
  CREATE TABLE mercury_partner_proposals(id INTEGER PRIMARY KEY,project_id INTEGER,state TEXT,growth_partner_id INTEGER,integration_id INTEGER,partner_uid TEXT,decided_by INTEGER,decided_at TEXT);
  CREATE TABLE google_workspace_proposals(id INTEGER PRIMARY KEY,project_id INTEGER,status TEXT,integration_id INTEGER,payload_json TEXT,decided_by INTEGER,decided_at TEXT);
  CREATE TABLE posthog_proposals(id INTEGER PRIMARY KEY,project_id INTEGER,status TEXT,target_ref TEXT,integration_id INTEGER,decided_by INTEGER,decided_at TEXT);
  CREATE TABLE beehiiv_publication_links(id INTEGER PRIMARY KEY,project_id INTEGER,channel_state TEXT,growth_channel_id INTEGER,decided_by INTEGER,decided_at TEXT);
  CREATE TABLE activity_logs(project_id INTEGER,user_id INTEGER,entity_type TEXT,entity_id TEXT,action TEXT,details TEXT,actor TEXT);`);
 db.exec(readFileSync(new URL('../sql/migrations/202611151923_6315_grow_proposal_receipts.sql',import.meta.url),'utf8'));
 db.exec(`INSERT INTO growth_partners(id,uid,project_id,name) VALUES(11,'partner-a',7,'Partner');
  INSERT INTO compliance_events(id,project_id,title) VALUES(12,7,'Board');
  INSERT INTO product_feedback(id,uid,project_id,body) VALUES(13,'feedback-a',7,'Feedback');
  INSERT INTO growth_channels(id,uid,project_id,name) VALUES(14,'channel-a',7,'Newsletter');
  INSERT INTO mercury_partner_proposals VALUES(21,7,'accepted',11,41,'payee-a',1,'now');
  INSERT INTO google_workspace_proposals VALUES(22,7,'accepted',42,'{"event_id":"board-a"}',1,'now');
  INSERT INTO posthog_proposals VALUES(23,7,'accepted','product_feedback:feedback-a',42,1,'now');
  INSERT INTO beehiiv_publication_links VALUES(24,7,'accepted',14,1,'now');
  INSERT INTO connector_fed_items VALUES(41,7,'grow:partner:7:payee-a','growth_partners',11),(42,7,'calendar:board-a:7','compliance_events',12);`);
 return {db,env:{DB:d1Over(db)} as any};
}
const cases=[['mercury',21,'partner','partner-a','growth_partners'],['google',22,'obligation',12,'compliance_events'],['posthog',23,'feedback','feedback-a','product_feedback'],['beehiiv',24,'channel','channel-a','growth_channels']] as const;

test('each source returns a venture record link, undoes only its new record, and records the actor once',async()=>{
 const f=fixture();try{
  for(const[source,id,kind,key,table]of cases){
   const receipt=await rememberGrowProposal(f.env,7,1,source,id,kind,key,true);
   assert.match(receipt.href,new RegExp(`/grow/.+/${key}\\?project_id=7$`));assert.ok(receipt.label);
   assert.deepEqual((await growProposalReceipts(f.env,7,1,source)).receipts,[receipt]);
   assert.deepEqual((await growProposalReceipts(f.env,8,1,source)).receipts,[]);
   await assert.rejects(()=>undoGrowProposal(f.env,7,2,receipt.uid),{status:404});
   await assert.rejects(()=>undoGrowProposal(f.env,8,1,receipt.uid),{status:404});
   assert.deepEqual(await undoGrowProposal(f.env,7,1,receipt.uid),{ok:true});
   assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,0);
   assert.deepEqual((await growProposalReceipts(f.env,7,1,source)).receipts,[]);
   await assert.rejects(()=>undoGrowProposal(f.env,7,1,receipt.uid),{status:404});
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n,4);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id=1 AND actor='user:1' AND action='grow_proposal_undone'").get()!.n,4);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM connector_fed_items WHERE local_id IS NOT NULL').get()!.n,0);
 }finally{f.db.close();}
});
test('same-second edits, including edit back, and newly attached business records refuse without undoing anything',async()=>{
 const f=fixture();try{
  for(const[source,id,kind,key,table]of cases){
   const receipt=await rememberGrowProposal(f.env,7,1,source,id,kind,key,true);
   // No clock tick: even a no-op update is an edit, and a later edit back cannot reset the version.
   f.db.exec(`UPDATE ${table} SET project_id=project_id;UPDATE ${table} SET project_id=8;UPDATE ${table} SET project_id=7;`);
   await assert.rejects(()=>undoGrowProposal(f.env,7,1,receipt.uid),{status:409});
   assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,1);
   assert.equal((await growProposalReceipts(f.env,7,1,source)).receipts.length,1);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n,0);
 }finally{f.db.close();}
 const child=fixture();try{
  const receipt=await rememberGrowProposal(child.env,7,1,'mercury',21,'partner','partner-a',true);
  child.db.exec('INSERT INTO growth_partner_deals VALUES(11)');
  await assert.rejects(()=>undoGrowProposal(child.env,7,1,receipt.uid),{status:409});
  assert.equal(child.db.prepare('SELECT COUNT(*) AS n FROM growth_partner_deals').get()!.n,1);
 }finally{child.db.close();}
});
test('linking an existing record never authorizes deleting it or another connector link',async()=>{
 const f=fixture();try{
  f.db.exec("INSERT INTO connector_fed_items VALUES(99,7,'other-link','growth_partners',11)");
  f.db.exec('INSERT INTO growth_partner_deals VALUES(11)');
  const receipt=await rememberGrowProposal(f.env,7,1,'mercury',21,'partner','partner-a',false);
  assert.equal(receipt.created_record,false);
  await undoGrowProposal(f.env,7,1,receipt.uid);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM growth_partners').get()!.n,1);
  assert.equal(f.db.prepare("SELECT local_id FROM connector_fed_items WHERE external_id='other-link'").get()!.local_id,11);
  assert.equal(f.db.prepare('SELECT state FROM mercury_partner_proposals').get()!.state,'pending');
 }finally{f.db.close();}
});

test('historical destinations stay linked without invented creation permission; changed source links refuse',async()=>{
 const f=fixture();try{
  for(const source of ['google','posthog']){
   const old=await growProposalReceipts(f.env,7,1,source);
   assert.equal(old.receipts.length,1);assert.equal(old.receipts[0].can_undo,false);assert.match(old.receipts[0].href,/project_id=7$/);
  }
  const receipt=await rememberGrowProposal(f.env,7,1,'mercury',21,'partner','partner-a',true);
  f.db.exec('UPDATE mercury_partner_proposals SET growth_partner_id=99');
  await assert.rejects(()=>undoGrowProposal(f.env,7,1,receipt.uid),{status:409});
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM growth_partners').get()!.n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get()!.n,0);
 }finally{f.db.close();}
});

test('mounted Mercury accept returns its receipt; the source-specific undo enforces actor and venture gates',async()=>{
 const {growDb,syncOnce,call,FOUNDER,COFOUNDER,PID}=await import('./_mercury_grow_fixture.ts');
 const {db,env}=await growDb();try{
  await syncOnce(env);
  const proposal=db.prepare('SELECT id FROM mercury_partner_proposals').get()!;
  const accepted=await call(env,FOUNDER,'POST',`/api/cycles/grow/mercury/partner-proposals/${proposal.id}/accept`,{project:PID});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  const receipt=accepted.body.destination;
  assert.match(receipt.href,/\/grow\/partner-network\/.+\?project_id=7$/);
  // The compact legacy fixture intentionally has no other source connector.
  // Empty shapes let SQLite prepare the conditional cross-source batch.
  db.exec(`CREATE TABLE google_workspace_proposals(id INTEGER,project_id INTEGER,status TEXT,integration_id INTEGER,payload_json TEXT,decided_by INTEGER,decided_at TEXT);
   CREATE TABLE posthog_proposals(id INTEGER,project_id INTEGER,status TEXT,target_ref TEXT,decided_by INTEGER,decided_at TEXT);
   CREATE TABLE beehiiv_publication_links(id INTEGER,project_id INTEGER,channel_state TEXT,growth_channel_id INTEGER,decided_by INTEGER,decided_at TEXT);`);
  const path=`/api/cycles/grow/mercury/partner-proposals/${proposal.id}/undo`;
  assert.ok([403,404].includes((await call(env,COFOUNDER,'POST',path,{project:PID,receipt_uid:receipt.uid})).status));
  assert.equal((await call(env,FOUNDER,'POST',path,{project:PID,receipt_uid:'unknown'})).status,404);
  assert.equal((await call(env,FOUNDER,'POST',path,{project:PID,receipt_uid:receipt.uid})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM growth_partners WHERE project_id=7').get()!.n,0);
  assert.ok(db.prepare("SELECT 1 FROM activity_logs WHERE action='grow_proposal_undone' AND user_id=1 AND actor='user:1'").get());
 }finally{db.close();}
});
