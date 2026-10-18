/** D713: stored revenue protections (PR A); the founder's own Mercury credits, listed and imported (PR B). */
import test from 'node:test';
import assert from 'node:assert/strict';
import revenue from '../src/routes/revenue.ts';
import { verificationFor, ensureRevenueEntriesSchema } from '../src/services/revenueLedger.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { fixture, mig, call } from './_mercury_d713.ts';
import { mercuryCreditToEntry, namesStripe } from '../src/services/revenueLedger.ts';
import { personalFixture, connected, bank, credit, req, count, tx, day, ACC_A, ACC_B } from './_mercury_personal_d713.ts';
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
  db.exec('PRAGMA foreign_keys = ON');
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

// ─────────────────────────────────────────────── PR B: the founder's own credits, listed and imported


const facts = (over: Record<string, unknown> = {}) => ({ transaction_id: tx(1), amount_cents: 5000, posted_on: '2026-09-01', posted: true, internal: false,
  voided: false, axal_counterparty: false, stripe_counterparty: false, ...over }) as any;
const ctx = (over: Record<string, unknown> = {}) => ({ stripeActive: false, importedHere: false, importedElsewhere: false, ...over }) as any;

test('mercuryCreditToEntry: debits and void lines are no candidates; each other refusal has its reason; an entry is Mercury\'s amount and date', () => {
  assert.deepEqual(mercuryCreditToEntry(facts(), ctx()), { kind: 'entry', entry: { source_ref: tx(1), amount_cents: 5000, received_on: '2026-09-01' } });
  assert.deepEqual(mercuryCreditToEntry(facts({ amount_cents: -5000 }), ctx()), { kind: 'skip' });
  assert.deepEqual(mercuryCreditToEntry(facts({ voided: true }), ctx()), { kind: 'skip' });
  const reason = (f: any, c: any) => (mercuryCreditToEntry(facts(f), ctx(c)) as any).reason;
  assert.equal(reason({ posted: false }, {}), 'pending');
  assert.equal(reason({ posted_on: null }, {}), 'pending');
  assert.equal(reason({ internal: true }, {}), 'internal_transfer');
  assert.equal(reason({ axal_counterparty: true }, {}), 'axal_entity');
  assert.equal(reason({ stripe_counterparty: true }, { stripeActive: true }), 'stripe_payout');
  assert.equal(mercuryCreditToEntry(facts({ stripe_counterparty: true }), ctx()).kind, 'entry', 'a Stripe payout counts only when Stripe already feeds the ledger');
  assert.equal(reason({}, { importedHere: true }), 'already_imported');
  assert.equal(reason({}, { importedElsewhere: true }), 'imported_elsewhere');
  assert.equal(reason({ amount_cents: 1.5 }, {}), 'invalid_amount');
  assert.ok(namesStripe('STRIPE TRANSFER') && namesStripe('Stripe, Inc.') && !namesStripe('Stripes Bakery'));
});

function seeded(state: any) {
  state.txns[ACC_A] = [
    credit(1, 50, day(-10)),
    credit(2, 75.25, day(-9), 'Pending Co', { status: 'pending' }),
    credit(3, 100, day(-8), 'Own savings', { kind: 'internalTransfer' }),
    credit(4, 200, day(-7), 'AXAL VC MANAGEMENT LLC'),
    credit(5, 300, day(-6), 'STRIPE TRANSFER'),
    credit(6, -40, day(-5), 'A vendor'),
    credit(7, 60, day(-4), 'Cancelled Co', { status: 'cancelled' }),
  ];
  state.txns[ACC_B] = [credit(8, 12.34, day(-3), 'Second Customer')];
}

test('GET mercury-credits: the founder only; the window is checked before Mercury; each credit listed with its reason; one log row; no ledger write', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 10);
  const b = bank(); seeded(b.state);
  try {
    for (const [who, code] of [[20, 'forbidden'], [2, 'mercury_owner_only']] as const) {
      const r = await req(env, who, 'GET', '/api/revenue/projects/1/mercury-credits');
      assert.deepEqual([r.status, r.body.error], [403, code], `${who}: ${r.text}`);
    }
    for (const q of ['?from=2026-02-30', `?from=${day(-400)}&to=${day(0)}`, `?from=${day(0)}&to=${day(-1)}`]) {
      const r = await req(env, 10, 'GET', `/api/revenue/projects/1/mercury-credits${q}`);
      assert.equal(r.status, 400, q);
    }
    assert.equal(b.calls.length, 0, 'nothing reached Mercury');
    const r = await req(env, 10, 'GET', '/api/revenue/projects/1/mercury-credits');
    assert.equal(r.status, 200, r.text);
    const by = Object.fromEntries(r.body.credits.map((c: any) => [c.transaction_id, [c.importable, c.reason, c.amount_cents]]));
    assert.deepEqual(by, {
      [tx(1)]: [true, null, 5000], [tx(2)]: [false, 'pending', 7525], [tx(3)]: [false, 'internal_transfer', 10000],
      [tx(4)]: [false, 'axal_entity', 20000], [tx(5)]: [true, null, 30000], [tx(8)]: [true, null, 1234],
    }, 'the debit and the cancelled line are not listed; Stripe is importable while Stripe feeds nothing');
    assert.equal(r.body.credits.find((c: any) => c.transaction_id === tx(8)).last_four, '1357');
    db.prepare("INSERT INTO integrations (uid, user_id, provider_key, display_name, auth_type, status, credentials_enc) VALUES ('stripe-1', 10, 'stripe', 'Stripe', 'oauth2', 'active', 'v1.fixture')").run();
    const again = await req(env, 10, 'GET', '/api/revenue/projects/1/mercury-credits');
    assert.equal(again.body.credits.find((c: any) => c.transaction_id === tx(5)).reason, 'stripe_payout');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM revenue_entries'), 0);
    const logs = db.prepare("SELECT event_type, response_summary, payload_json FROM integration_logs WHERE provider_key = 'mercury'").all() as any[];
    assert.equal(logs.length, 2);
    assert.deepEqual([logs[0].event_type, logs[0].response_summary, logs[0].payload_json], ['mercury_credits_read', 'use=venture_revenue lines=8 credits=6', null]);
    assert.ok(b.calls.every((c) => c.method === 'GET'));
  } finally { b.restore(); }
});

test('POST import-mercury: values checked before Mercury; each line re-read; Mercury\'s amount and date, the founder\'s label; supported; fed link; one row per bank line', async () => {
  const { db, env } = await personalFixture();
  const integrationId = await connected(db, env, 10);
  const b = bank(); seeded(b.state);
  const imp = (project: number, items: unknown) => req(env, 10, 'POST', `/api/revenue/projects/${project}/entries/import-mercury`, { items });
  const item = (n: number, extra = {}) => ({ transaction_id: tx(n), customer: `Customer ${n}`, revenue_type: 'one_time', ...extra });
  try {
    for (const [items, code] of [
      [[], 'items_required'], [[item(1, { transaction_id: 'txn-1' })], 'invalid_transaction_id'], [[item(1, { customer: ' ' })], 'invalid_customer'],
      [[item(1, { revenue_type: 'grant' })], 'invalid_revenue_type'], [[item(1), item(1)], 'duplicate_transaction_id'],
      [Array.from({ length: 201 }, (_, i) => item(1000 + i)), 'too_many_items'],
    ] as Array<[unknown, string]>) {
      const r = await imp(1, items);
      assert.deepEqual([r.status, r.body.error], [400, code], r.text);
    }
    assert.equal(b.calls.length, 0, 'nothing reached Mercury');
    for (const [who, code] of [[20, 'forbidden'], [2, 'mercury_owner_only']] as const) {
      const r = await req(env, who, 'POST', '/api/revenue/projects/1/entries/import-mercury', { items: [item(1)] });
      assert.deepEqual([r.status, r.body.error], [403, code], `${who}: ${r.text}`);
    }
    const r = await imp(1, [item(1, { amount_cents: 999999, received_on: '2020-01-01' }), item(2), item(4), item(8, { revenue_type: 'recurring' }), item(99)]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.body.inserted, r.body.already_imported], [2, 0]);
    assert.deepEqual(r.body.refused, [
      { transaction_id: tx(2), reason: 'pending' }, { transaction_id: tx(4), reason: 'axal_entity' }, { transaction_id: tx(99), reason: 'transaction_not_found' },
    ]);
    assert.ok(b.calls.some((c) => c.path === `/account/${ACC_A}/transaction/${tx(1)}`), 'each line is re-read by id');
    const rows = db.prepare("SELECT * FROM revenue_entries ORDER BY source_ref").all() as any[];
    assert.deepEqual(rows.map((x) => [x.source, x.source_ref, x.amount_cents, x.received_on, x.customer, x.revenue_type, x.verification, x.project_id]), [
      ['mercury', tx(1), 5000, day(-10), 'Customer 1', 'one_time', 'supported', 1],
      ['mercury', tx(8), 1234, day(-3), 'Customer 8', 'recurring', 'supported', 1],
    ]);
    assert.ok(!JSON.stringify(rows).includes('Customer Co') && !JSON.stringify(rows).includes('Second Customer'), 'no counterparty name is stored');
    const fed = db.prepare('SELECT integration_id, project_id, module, kind, external_id, local_table, local_id FROM connector_fed_items ORDER BY external_id').all() as any[];
    assert.deepEqual(fed.map((f) => ({ ...f })), rows.map((x) => ({ integration_id: integrationId, project_id: 1, module: 'revenue_and_traction', kind: 'credit',
      external_id: x.source_ref, local_table: 'revenue_entries', local_id: x.id })));
    const twice = await imp(1, [item(1)]);
    assert.deepEqual([twice.body.inserted, twice.body.already_imported, twice.body.refused], [0, 1, []]);
    const elsewhere = await imp(2, [item(1)]);
    assert.deepEqual([elsewhere.body.inserted, elsewhere.body.refused], [0, [{ transaction_id: tx(1), reason: 'imported_elsewhere' }]]);
    // A delete, then a re-import: the fed link follows the new row.
    db.prepare('DELETE FROM revenue_entries WHERE source_ref = ?').run(tx(1));
    const back = await imp(1, [item(1)]);
    assert.equal(back.body.inserted, 1);
    const newId = (db.prepare('SELECT id FROM revenue_entries WHERE source_ref = ?').get(tx(1)) as any).id;
    assert.equal((db.prepare('SELECT local_id FROM connector_fed_items WHERE external_id = ?').get(tx(1)) as any).local_id, newId);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM connector_fed_items'), 2);
    assert.ok(b.calls.every((c) => c.method === 'GET' && !c.body));
  } finally { b.restore(); }
});
