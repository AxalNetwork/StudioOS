import test from 'node:test';
import assert from 'node:assert/strict';
import { adminPartnerSettlements as admin, partnerSettlements as member } from '../src/routes/partner_settlements.ts';
import { fixture, call, draft } from './_mercury_d713.ts';
const rows = (db: any) => db.prepare('SELECT * FROM partner_deal_settlements').all();
const audits = (db: any) => db.prepare('SELECT * FROM admin_audit_log').all();

test('HQ Admin drafts, edits, filters and deletes; roles and branches are refused', async () => {
  const { db, env } = fixture();
  for (const who of [10,20,30]) assert.equal((await call(admin,env,'/',who,'POST',draft)).status,403);
  const branch = await call(admin,{...env,BRANCH_CODE:'fr'},'/',2,'POST',draft);
  assert.equal(branch.status,403); assert.equal(branch.body.detail,'HQ only');
  assert.equal(rows(db).length,0); assert.equal(audits(db).length,0);
  const created = await call(admin,env,'/',2,'POST',{...draft,user_id:21,state:'issued'});
  assert.equal(created.status,201,JSON.stringify(created)); assert.equal(created.body.user_id,20); assert.equal(created.body.state,'draft');
  const uid=created.body.uid;
  assert.equal((await call(admin,env,`/${uid}`,2,'PATCH',{amount_cents:6000})).body.amount_cents,6000);
  assert.equal((await call(admin,env,'/?deal=1&partner=20&state=draft')).body.length,1);
  assert.equal((await call(admin,env,'/?partner=21')).body.length,0);
  assert.equal((await call(admin,env,'/?state=invalid')).status,400);
  assert.equal((await call(admin,env,`/${uid}`,2,'DELETE')).status,200);
  assert.equal(rows(db).length,0); assert.equal(audits(db).length,3);
});

for (const act of ['issue','void']) test(`plain Admin ${act} is refused before TOTP or step-up and writes nothing`,async()=>{
  const { db,env }=fixture();
  const made=await call(admin,env,'/',2,'POST',draft);
  if(act==='void') db.exec("UPDATE partner_deal_settlements SET state='issued',issued_by=1,issued_at='2026-10-01'");
  const before=rows(db), auditBefore=audits(db);
  for (const jti of ['plain-totp','plain-password']) {
    const res=await call(admin,env,`/${made.body.uid}/${act}`,2,'POST',{reason:'Correction of terms'},jti);
    assert.equal(res.status,403); assert.deepEqual(res.body,{code:'super_admin_required',detail:'Super admin required'});
    assert.deepEqual(rows(db),before); assert.deepEqual(audits(db),auditBefore);
  }
});

test('Super Admin needs fresh TOTP; issue freezes terms; void requires an issued row and reason',async()=>{
  const {db,env}=fixture(); const made=await call(admin,env,'/',2,'POST',draft); const path=`/${made.body.uid}`;
  const stale=await call(admin,env,`${path}/issue`,1,'POST',{},'stale'); assert.equal(stale.status,403); assert.equal(stale.body.detail,'step_up_required');
  assert.equal(rows(db)[0].state,'draft');
  assert.equal((await call(admin,env,`${path}/void`,1,'POST',{reason:'Wrong terms'},'fresh')).status,409);
  assert.equal((await call(admin,env,`${path}/issue`,1,'POST',{},'fresh')).status,200);
  for (const change of ['amount_cents=7',"due_on='2026-11-01'",'partner_deal_id=2',"kind='capital'","direction='from_member'"]) assert.throws(()=>db.exec(`UPDATE partner_deal_settlements SET ${change}`),/settlement_fixed/);
  assert.equal((await call(admin,env,path,2,'PATCH',{memo:'Changed'})).status,409);
  assert.equal((await call(admin,env,path,2,'DELETE')).status,409);
  assert.equal((await call(admin,env,`${path}/void`,1,'POST',{reason:' '},'fresh')).status,400);
  db.exec("UPDATE partner_deal_settlements SET state='matched'");
  assert.equal((await call(admin,env,`${path}/void`,1,'POST',{reason:'Wrong terms'},'fresh')).status,409);
  db.exec("UPDATE partner_deal_settlements SET state='issued'");
  assert.equal((await call(admin,env,`${path}/void`,1,'POST',{reason:'Wrong terms'},'fresh')).status,200);
  assert.throws(()=>db.exec("UPDATE partner_deal_settlements SET memo='Changed'"),/settlement_fixed/);
  assert.equal(audits(db).length,3);
});

test('draft validation and database CHECKs refuse invalid money, dates, deals, entity and memo',async()=>{
  const {db,env}=fixture();
  for(const bad of [{memo:'12345678'},{amount_cents:1.5},{amount_cents:0},{due_on:'2026-02-30'},{partner_deal_id:3},{entity_key:'fund'},{currency:'eur'},{kind:'invalid'}]) assert.equal((await call(admin,env,'/',2,'POST',{...draft,...bad})).status,400);
  assert.equal(rows(db).length,0);
  await call(admin,env,'/',2,'POST',draft);
  assert.throws(()=>db.exec("UPDATE partner_deal_settlements SET entity_key='fund'"),/CHECK/);
});

test('member sees only own issued, matched and void settlements, never drafts',async()=>{
  const {db,env}=fixture();
  for(const state of ['draft','issued','matched','void']) {
    for(const deal of [1,2]) {
      const made=await call(admin,env,'/',2,'POST',{...draft,partner_deal_id:deal});
      db.prepare('UPDATE partner_deal_settlements SET state=? WHERE uid=?').run(state,made.body.uid);
    }
  }
  const res=await call(member,env,'/',20);
  assert.equal(res.status,200); assert.equal(res.body.length,3);
  assert.ok(res.body.every((r:any)=>r.user_id===20&&r.state!=='draft'));
});
