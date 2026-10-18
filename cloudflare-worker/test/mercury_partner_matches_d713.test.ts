/** D713: the read sides of stored evidence (PR A), and a member proposing, confirming and withdrawing a match from their own bank lines (PR B). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { engagementsRouter } from '../src/routes/needs.ts';
import network from '../src/routes/network.ts';
import { matchFor } from '../src/services/mercuryPersonal.ts';
import { fixture, ddl, mig, call, match } from './_mercury_d713.ts';
import { personalFixture, connected, bank, credit, req, count, tx, day, ACC_A, ACC_B, FOUR_A, FOUR_B } from './_mercury_personal_d713.ts';

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

// ─────────────────────────────────────────────── PR B: proposals, confirm and withdraw

async function matchFixture() {
  const { db, env } = await personalFixture();
  ddl(db, 'engagements'); db.exec(mig('188_engagement_invoices.sql'));
  for (const t of ['payouts', 'commissions', 'commission_rules', 'referrals']) ddl(db, t);
  for (const m of ['338_partner_interactions_reminders.sql', '343_partner_interaction_void.sql', '393_partner_earnings.sql', '409_payout_destination_and_leaderboard.sql']) db.exec(mig(m));
  db.exec(`INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price) VALUES(1,'e1',1,1,200,100,1,50),(2,'e2',2,2,200,100,1,50),(3,'e3',3,3,201,100,1,50),(4,'e4',4,4,200,100,1,50);
    INSERT INTO engagement_invoices(id,uid,invoice_number,engagement_id,partner_user_id,founder_user_id,total_cents,currency,issued_at) VALUES
      (1,'i1','AX-1',1,20,10,5000,'USD',datetime('now','-20 days')),
      (2,'i2','AX-2',2,20,10,5000,'EUR',datetime('now','-20 days')),
      (3,'i3','AX-3',3,21,10,5000,'USD',datetime('now','-20 days')),
      (4,'i4','AX-4',4,20,10,0,'USD',datetime('now','-20 days'));`);
  db.exec(`INSERT INTO payouts(id,user_id,amount_cents,currency,status,payout_method,created_at,destination_last4) VALUES
      (1,20,7500,'USD','requested','wire',datetime('now','-10 days'),'${FOUR_B}'),
      (2,20,7500,'USD','failed','wire',datetime('now','-10 days'),NULL)`);
  const settle = db.prepare(`INSERT INTO partner_deal_settlements (uid, partner_deal_id, user_id, kind, direction, amount_cents, due_on, state, drafted_by)
    VALUES (?, 1, ?, 'revenue_share', ?, ?, ?, ?, 1)`);
  settle.run('s1', 20, 'to_member', 2500, day(-5), 'issued');
  settle.run('s2', 20, 'from_member', 1200, day(-5), 'issued');
  settle.run('s3', 20, 'to_member', 2500, day(-5), 'draft');
  settle.run('s4', 21, 'to_member', 2500, day(-5), 'issued');
  await connected(db, env, 20);
  const b = bank();
  b.state.txns[ACC_A] = [
    credit(1, 50, day(-15), 'Client One'), credit(2, 50, day(-14), 'Client Two'), credit(3, 49.99, day(-13), 'Client Three'),
    credit(4, 75, day(-8), 'AXAL VC MANAGEMENT LLC'),
    credit(6, 25, day(-4), 'Axal VC Management LLC'), credit(7, -12, day(-3), 'Axal VC Management LLC'),
    credit(8, 50, day(-2), 'Client Pending', { status: 'pending' }),
  ];
  b.state.txns[ACC_B] = [credit(5, 75, day(-7), 'Axal VC Management LLC'), credit(9, 75, day(-6), 'Someone Else')];
  return { db, env, b };
}
const cands = (r: any, id: number) => r.body.items.find((i: any) => i.target_id === id)?.candidates.map((x: any) => x.transaction_id);

test('invoice: the partner\'s own USD invoices with a total, every line that fits; confirm makes issued paid on the posted date; withdraw keeps it paid', async () => {
  const { db, env, b } = await matchFixture();
  try {
    const list = await req(env, 20, 'GET', '/api/mercury/personal/matches?target=invoice');
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(list.body.items.map((i: any) => i.target_id), [1], 'not the EUR one, not the zero one, not another partner\'s');
    assert.deepEqual(cands(list, 1), [tx(1), tx(2)], 'both exact credits are listed, never the near miss or the pending one');
    assert.equal((await req(env, 10, 'GET', '/api/mercury/personal/matches?target=invoice')).body.error, 'purpose_not_allowed');
    const calls = b.calls.length;
    for (const body of [{ target_kind: 'invoice', target_id: 1, transaction_id: 'txn-1' }, { target_kind: 'cheque', target_id: 1, transaction_id: tx(1) },
      { target_kind: 'invoice', target_id: 'one', transaction_id: tx(1) }]) {
      assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', body)).status, 400, JSON.stringify(body));
    }
    assert.equal(b.calls.length, calls, 'nothing reached Mercury');
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'invoice', target_id: 3, transaction_id: tx(1) })).body.error, 'target_not_found');
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'invoice', target_id: 1, transaction_id: tx(3) })).body.error, 'not_matchable');
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'invoice', target_id: 1, transaction_id: tx(77) })).body.error, 'transaction_not_found');
    const ok = await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'invoice', target_id: 1, transaction_id: tx(2) });
    assert.equal(ok.status, 201, ok.text);
    assert.deepEqual([ok.body.match.last_four, ok.body.match.amount_cents, ok.body.match.posted_on], [FOUR_A, 5000, day(-14)]);
    assert.ok(!('mercury_transaction_id' in ok.body.match) && !('integration_id' in ok.body.match));
    assert.deepEqual({ ...db.prepare('SELECT status, paid_at FROM engagement_invoices WHERE id = 1').get() as any }, { status: 'paid', paid_at: day(-14) });
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'invoice', target_id: 1, transaction_id: tx(1) })).body.error, 'target_already_matched');
    assert.deepEqual((await req(env, 20, 'GET', '/api/mercury/personal/matches?target=invoice')).body.items, [], 'a matched invoice is no longer proposed');
    const uid = ok.body.match.uid;
    assert.equal((await req(env, 20, 'POST', `/api/mercury/personal/matches/${uid}/withdraw`, { reason: 'short' })).body.error, 'reason_required');
    assert.equal((await req(env, 21, 'POST', `/api/mercury/personal/matches/${uid}/withdraw`, { reason: 'Not mine to withdraw' })).status, 404);
    const w = await req(env, 20, 'POST', `/api/mercury/personal/matches/${uid}/withdraw`, { reason: 'Matched the wrong credit' });
    assert.equal(w.status, 200, w.text);
    assert.equal(w.body.match.state, 'withdrawn');
    assert.equal((db.prepare('SELECT status FROM engagement_invoices WHERE id = 1').get() as any).status, 'paid', 'the partner\'s word stands');
    assert.equal((await req(env, 20, 'POST', `/api/mercury/personal/matches/${uid}/withdraw`, { reason: 'Matched the wrong credit' })).body.error, 'match_withdrawn');
    assert.ok(b.calls.every((c) => c.method === 'GET' && !c.body));
    assert.ok(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE event_type LIKE 'mercury_match%'") >= 2);
  } finally { b.restore(); }
});

test('payout: a Management credit on the destination account; never a failed payout; HQ only; its status stays the Super Admin\'s', async () => {
  const { db, env, b } = await matchFixture();
  try {
    const branch = await req(env, 20, 'GET', '/api/mercury/personal/matches?target=payout', undefined, { branch: true });
    assert.deepEqual([branch.status, branch.body.error], [403, 'hq_only']);
    const list = await req(env, 20, 'GET', '/api/mercury/personal/matches?target=payout');
    assert.deepEqual(list.body.items.map((i: any) => i.target_id), [1]);
    assert.deepEqual(cands(list, 1), [tx(5)], 'not tx 4 (another account), not tx 9 (not Management)');
    const ok = await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'payout', target_id: 1, transaction_id: tx(5) });
    assert.equal(ok.status, 201, ok.text);
    assert.equal((db.prepare('SELECT status FROM payouts WHERE id = 1').get() as any).status, 'requested');
    const own = await call(network, env, '/payouts/me', 20);
    assert.deepEqual(own.body.find((p: any) => p.id === 1).bank_match, { posted_on: day(-7), last_four: FOUR_B });
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'payout', target_id: 2, transaction_id: tx(5) })).body.error, 'target_not_found');
  } finally { b.restore(); }
});

test('settlement: an issued one, a credit to the member or a debit from them, with Management; confirm makes it matched, withdraw issued again', async () => {
  const { db, env, b } = await matchFixture();
  try {
    const list = await req(env, 20, 'GET', '/api/mercury/personal/matches?target=settlement');
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(list.body.items.map((i: any) => [i.target_id, i.direction]).sort(), [[1, 'credit'], [2, 'debit']], 'not the draft, not another member\'s');
    assert.deepEqual(cands(list, 1), [tx(6)]);
    assert.deepEqual(cands(list, 2), [tx(7)]);
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'settlement', target_id: 4, transaction_id: tx(6) })).body.error, 'target_not_found', 'another member\'s');
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'settlement', target_id: 3, transaction_id: tx(6) })).body.error, 'target_not_found', 'a draft');
    const ok = await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'partner_deal_settlement', target_id: 2, transaction_id: tx(7) });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.match.amount_cents, -1200);
    assert.equal((db.prepare('SELECT state FROM partner_deal_settlements WHERE id = 2').get() as any).state, 'matched');
    assert.equal((await req(env, 20, 'POST', '/api/mercury/personal/matches', { target_kind: 'settlement', target_id: 1, transaction_id: tx(7) })).body.error, 'not_matchable');
    const w = await req(env, 20, 'POST', `/api/mercury/personal/matches/${ok.body.match.uid}/withdraw`, { reason: 'The debit was a different deal' });
    assert.equal(w.status, 200, w.text);
    assert.equal((db.prepare('SELECT state FROM partner_deal_settlements WHERE id = 2').get() as any).state, 'issued');
    const wb = await req(env, 20, 'POST', `/api/mercury/personal/matches/${ok.body.match.uid}/withdraw`, { reason: 'The debit was a different deal' }, { branch: true });
    assert.equal(wb.body.error, 'hq_only', 'withdraw holds the same use');
  } finally { b.restore(); }
});
