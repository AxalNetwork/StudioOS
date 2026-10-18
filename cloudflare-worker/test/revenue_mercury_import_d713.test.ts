/** D713 PR A: stored revenue protections. Live imports follow in PR B. */
import test from 'node:test';
import assert from 'node:assert/strict';
import revenue from '../src/routes/revenue.ts';
import { verificationFor, ensureRevenueEntriesSchema } from '../src/services/revenueLedger.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { fixture, mig, call } from './_mercury_d713.ts';
function entry(db:any,source='mercury',id=1) {
  db.prepare(`INSERT INTO revenue_entries (id,uid,project_id,customer,amount_cents,revenue_type,received_on,source,source_ref,verification,notes,import_batch,created_by,created_at,updated_at) VALUES (?,?,1,'Member label',5000,'one_time','2026-09-01',?,?,'supported','Notes','batch-a',10,'2026-09-02','2026-09-03')`).run(id,`entry-${id}`,source,source==='stripe'?'ch_a':`txn-${id}`);
}
test('Mercury amount and date cannot change; label, type, notes and proof remain editable with supported evidence',async()=>{
  const {db,env}=fixture(); entry(db);
  for(const body of [{amount_cents:6000},{amount:'60.00'},{received_on:'2026-09-02'}]) {
    const res=await call(revenue,env,'/projects/1/entries/entry-1',10,'PATCH',body);
    assert.equal(res.status,409,JSON.stringify(res)); assert.equal(res.body.error,'synced_entry_locked');
  }
  db.exec('INSERT INTO documents VALUES (1,1)');
  for (const proof of [1,null]) {
    const res=await call(revenue,env,'/projects/1/entries/entry-1',10,'PATCH',{customer:'New label',revenue_type:'pilot',notes:'Updated',proof_document_id:proof,source:'manual',verification:'verified'});
    assert.equal(res.status,200,JSON.stringify(res));
    const row:any=db.prepare('SELECT * FROM revenue_entries').get();
    assert.equal(row.amount_cents,5000); assert.equal(row.received_on,'2026-09-01');
    assert.equal(row.source,'mercury'); assert.equal(row.verification,'supported'); assert.equal(row.customer,'New label'); assert.equal(row.proof_document_id,proof);
  }
  assert.equal(verificationFor({source:'mercury',proof_document_id:null}),'supported');
});
test('477 preserves every preexisting value, existing indexes, Stripe reimport dedupe and global Mercury uniqueness',async()=>{
  const {db,env}=fixture(false);
  for(const [i,source] of ['manual','csv','stripe'].entries()) entry(db,source,i+10);
  const before=db.prepare('SELECT * FROM revenue_entries ORDER BY id').all();
  db.exec(mig('477_mercury_personal.sql'));
  assert.deepEqual(db.prepare('SELECT * FROM revenue_entries ORDER BY id').all(),before);
  const indexes=db.prepare("PRAGMA index_list('revenue_entries')").all().map((r:any)=>r.name);
  for(const n of ['idx_revenue_entries_project','uq_revenue_entries_stripe_charge','uq_revenue_entries_mercury_txn']) assert.ok(indexes.includes(n));
  const enc=await encryptCredentials(env,'stripe-test',{access_token:'test-placeholder'} as any);
  db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,status,credentials_enc) VALUES(1,'stripe-test',10,'stripe','active',?)").run(enc);
  const real=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{id:'ch_a',status:'succeeded',paid:true,currency:'usd',amount:5000,amount_refunded:0,created:Math.floor(Date.parse('2026-09-01')/1000),customer:null}],has_more:false}));
  try {
    const res=await call(revenue,env,'/projects/1/entries/import-stripe',10,'POST');
    assert.equal(res.status,200,JSON.stringify(res)); assert.equal(res.body.inserted,0); assert.equal(res.body.already_imported,1);
  } finally {globalThis.fetch=real;}
  entry(db);
  assert.throws(()=>db.exec("INSERT INTO revenue_entries(uid,project_id,customer,amount_cents,revenue_type,received_on,source,source_ref) VALUES('duplicate',2,'Label',5000,'one_time','2026-09-01','mercury','txn-1')"),/UNIQUE/);
  await ensureRevenueEntriesSchema(env);
});
test('cold bootstrap declares Mercury and the global transaction index',async()=>{
  const {db,env}=fixture(false); db.exec('DROP TABLE revenue_entries');
  await ensureRevenueEntriesSchema(env); entry(db);
  assert.throws(()=>entry(db,'mercury',1),/UNIQUE/);
  assert.ok(db.prepare("PRAGMA index_list('revenue_entries')").all().some((r:any)=>r.name==='uq_revenue_entries_mercury_txn'));
});
