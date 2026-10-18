/** PR A read sides: insert stored evidence, never call a bank. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { engagementsRouter } from '../src/routes/needs.ts';
import network from '../src/routes/network.ts';
import { matchFor } from '../src/services/mercuryPersonal.ts';
import { fixture, ddl, mig, call, match } from './_mercury_d713.ts';

test('invoice parties see the match date, only partner sees last four, strangers see no invoice',async()=>{
  const {db,env}=fixture(); ddl(db,'engagements'); db.exec(mig('188_engagement_invoices.sql'));
  db.exec(`INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price) VALUES(1,'engagement',1,1,200,100,1,50);
    INSERT INTO engagement_invoices(id,uid,invoice_number,engagement_id,partner_user_id,founder_user_id,total_cents,currency) VALUES(1,'invoice','AX-test',1,20,10,5000,'USD');`);
  assert.equal((await call(engagementsRouter,env,'/1/invoice',20)).body.bank_matched_on,null);
  match(db,'engagement_invoice',1);
  const founder=await call(engagementsRouter,env,'/1/invoice',10);
  assert.equal(founder.status,200,JSON.stringify(founder)); assert.equal(founder.body.bank_matched_on,'2026-10-02'); assert.ok(!('bank_last_four' in founder.body)); assert.ok(!JSON.stringify(founder.body).includes('4242'));
  const partner=await call(engagementsRouter,env,'/1/invoice',20); assert.equal(partner.body.bank_last_four,'4242');
  assert.equal((await call(engagementsRouter,env,'/1/invoice',21)).status,404);
  assert.ok(!('mercury_transaction_id' in partner.body)); assert.ok(!('integration_id' in partner.body));
  db.exec("UPDATE mercury_personal_matches SET state='withdrawn'");
  assert.equal((await call(engagementsRouter,env,'/1/invoice',20)).body.bank_matched_on,null);
});
test('own and admin payout GETs expose the same minimal evidence without changing payout status',async()=>{
  const {db,env}=fixture();
  for(const t of ['payouts','commissions','commission_rules','referrals']) ddl(db,t);
  db.exec(mig('338_partner_interactions_reminders.sql')); db.exec(mig('343_partner_interaction_void.sql'));
  db.exec(mig('393_partner_earnings.sql')); db.exec(mig('409_payout_destination_and_leaderboard.sql'));
  db.exec("INSERT INTO payouts(id,user_id,amount_cents,currency,status,payout_method) VALUES(1,20,5000,'USD','requested','wire'),(2,21,5000,'USD','requested','wire')");
  match(db,'payout',1); match(db,'payout',2,'withdrawn','txn-b');
  const own=await call(network,env,'/payouts/me',20);
  assert.equal(own.status,200,JSON.stringify(own)); assert.equal(own.body.length,1);
  assert.deepEqual(own.body[0].bank_match,{posted_on:'2026-10-02',last_four:'4242'}); assert.equal(own.body[0].status,'requested');
  const admin=await call(network,env,'/admin/payouts',1);
  assert.equal(admin.status,200,JSON.stringify(admin)); assert.equal(admin.body.length,2);
  assert.deepEqual(admin.body.find((p:any)=>p.id===1).bank_match,own.body[0].bank_match);
  assert.equal(admin.body.find((p:any)=>p.id===2).bank_match,null);
  const insert = db.prepare("INSERT INTO payouts(user_id,amount_cents,currency,status,payout_method) VALUES(20,5000,'USD','requested','wire')");
  for (let i=0;i<200;i++) insert.run();
  let evidenceReads=0;
  const prepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=(sql:string)=>{if(sql.includes('mercury_personal_matches')) evidenceReads++;return prepare(sql);};
  const page=await call(network,env,'/payouts/me',20);
  assert.equal(page.status,200); assert.equal(page.body.length,201);
  assert.equal(evidenceReads,3,'evidence reads are chunked, not one per payout');
  assert.deepEqual(page.body.find((p:any)=>p.id===1).bank_match,own.body[0].bank_match);

});
test('only confirmed matches read; unique transaction and target indexes release on withdrawal',async()=>{
  const {db,env}=fixture(); match(db,'payout',1);
  assert.throws(()=>match(db,'payout',2),/UNIQUE/);
  assert.throws(()=>match(db,'payout',1,'confirmed','txn-b'),/UNIQUE/);
  assert.equal(await matchFor(env,'engagement_invoice',1),null);
  db.exec("UPDATE mercury_personal_matches SET state='withdrawn'");
  assert.equal(await matchFor(env,'payout',1),null);
  match(db,'payout',1);
  assert.deepEqual({...await matchFor(env,'payout',1)},{posted_on:'2026-10-02',last_four:'4242'});
  assert.throws(()=>db.exec("UPDATE mercury_personal_matches SET account_last_four='12ab'"),/CHECK/);
});
