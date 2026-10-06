import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import { readFundCapital, rollUpFundRow, totalFundRollups, FUND_METRIC_UNAVAILABLE, type FundRollupRow } from '../src/services/fundRollup.ts';

const base = (id = 1) => rollUpFundRow({ id, name: 'Fixture fund', vintage_year: 2025,
  status: 'active', total_commitment: 1000, fund_size_cents: 100000, deployed_capital: 50,
  lp_rows: 2, called_dollars: 90, distributed_cents: 4500, management_fee: 0.02,
  carried_interest: 0.2 } as FundRollupRow);
const schema = `CREATE TABLE limited_partners(id INTEGER PRIMARY KEY, fund_id INTEGER, name TEXT);
CREATE TABLE capital_calls(id INTEGER PRIMARY KEY, limited_partner_id INTEGER, amount REAL, amount_cents INTEGER);
CREATE TABLE capital_call_receipts(id INTEGER PRIMARY KEY, limited_partner_id INTEGER, fund_id INTEGER, amount_cents INTEGER);
INSERT INTO limited_partners VALUES (1,1,'LP one'),(2,1,'LP two'),(3,2,'Other fund');
INSERT INTO capital_calls VALUES (1,1,100,10000),(2,1,23.45,NULL),(3,2,200,20000),(4,3,999,99900);`;
const receipts = `INSERT INTO capital_call_receipts VALUES (1,1,1,2500),(2,1,1,1500),(3,2,1,5000),(4,3,2,99900);`;

test('calls and multiple partial receipts sum independently per fund and per LP, without another fund', async () => {
  const { DB, db } = makeD1(schema, receipts);
  try {
    const f = await readFundCapital({ DB } as any, base());
    assert.equal(f.called_cents, 32345);
    assert.equal(f.collected_cents, 9000);
    assert.equal(f.outstanding_cents, 23345);
    assert.equal(f.capital_state, 'recorded');
    assert.equal(f.capital_reason, null);
    assert.deepEqual(f.lp_capital.map(lp => [lp.limited_partner_id, lp.called_cents, lp.collected_cents, lp.outstanding_cents]),
      [[1,12345,4000,8345],[2,20000,5000,15000]]);
    assert.equal(f.dpi, 0.5, 'D550 does not change performance calculations');
    assert.equal(f.irr, null);
    assert.equal(totalFundRollups([f]).collected_cents, 9000);
    assert.equal(totalFundRollups([f]).dpi, 0.5);
  } finally { db.close(); }
});

test('no receipts means unknown collection and outstanding, with a reason, not zero', async () => {
  const { DB, db } = makeD1(schema);
  try {
    const f = await readFundCapital({ DB } as any, base());
    assert.equal(f.called_cents, 32345);
    assert.equal(f.collected_cents, null);
    assert.equal(f.outstanding_cents, null);
    assert.equal(f.capital_state, 'not_recorded');
    assert.match(f.capital_reason!, /No dated capital-call receipts/);
    assert.ok(f.lp_capital.every(lp => lp.collected_cents === null && lp.outstanding_cents === null && lp.capital_reason));
    assert.equal(totalFundRollups([f]).collected_cents, null);
  } finally { db.close(); }
});

test('a missing LP receipt is not softened into zero even when another LP paid', async () => {
  const { DB, db } = makeD1(schema, 'INSERT INTO capital_call_receipts VALUES (1,1,1,2500);');
  try {
    const f = await readFundCapital({ DB } as any, base());
    assert.equal(f.collected_cents, 2500);
    assert.equal(f.lp_capital[1].collected_cents, null);
    assert.equal(f.lp_capital[1].outstanding_cents, null);
    assert.equal(f.lp_capital[1].capital_state, 'not_recorded');
  } finally { db.close(); }
});

test('a failed receipt read is Unreadable, and cannot become an empty ledger or cash zero', async () => {
  const { DB, db } = makeD1(schema);
  db.exec('DROP TABLE capital_call_receipts');
  try {
    const f = await readFundCapital({ DB } as any, base());
    assert.equal(f.capital_state, 'unreadable');
    assert.match(f.capital_reason!, /could not be read/);
    for (const field of ['called_cents', 'collected_cents', 'outstanding_cents'] as const) assert.equal(f[field], null);
    assert.deepEqual(f.lp_capital, []);
    assert.equal(totalFundRollups([f]).collected_cents, null);
  } finally { db.close(); }
});

test('a reported D1 failure is Unreadable even if it returns no results', async () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ success: false, results: [] }) }) }) } };
  const f = await readFundCapital(env as any, base());
  assert.equal(f.capital_state, 'unreadable');
  assert.equal(f.collected_cents, null);
});

test('no calls is Not recorded; a fully collected line has a real zero outstanding', async () => {
  const { DB, db } = makeD1(schema, 'INSERT INTO capital_call_receipts VALUES (1,3,2,99900);');
  try {
    const none = await readFundCapital({ DB } as any, base(99));
    assert.equal(none.called_cents, null);
    assert.equal(none.collected_cents, null);
    assert.equal(none.capital_state, 'not_recorded');
    const paid = await readFundCapital({ DB } as any, base(2));
    assert.equal(paid.outstanding_cents, 0);
    assert.equal(paid.capital_state, 'recorded');
    assert.equal(paid.lp_capital[0].outstanding_cents, 0);
    assert.equal(totalFundRollups([none, paid]).collected_cents, null);
  } finally { db.close(); }
});

test('IRR absence explains the remaining missing inputs rather than denying existing dated receipts', () => {
  assert.match(FUND_METRIC_UNAVAILABLE.irr, /complete dated cash-flow history/);
  assert.match(FUND_METRIC_UNAVAILABLE.irr, /terminal fund valuation/);
  assert.doesNotMatch(FUND_METRIC_UNAVAILABLE.irr, /not as dated cash receipts/);
});

test('mounted analytics returns receipt totals only for funds run by the authenticated GP', async () => {
  const { default: funds } = await import('../src/routes/funds.ts');
  const { SignJWT } = await import('jose');
  const { DB, db } = makeD1(schema + `
    ALTER TABLE limited_partners ADD COLUMN invested_amount REAL DEFAULT 0;
    CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER, investor_tier TEXT, investor_subscription_status TEXT);
    INSERT INTO users VALUES(40,'gp@example.test','Fixture GP','investor',1,'institutional','active');
    CREATE TABLE vc_funds(id INTEGER PRIMARY KEY, name TEXT, vintage_year INTEGER, status TEXT, deployed_capital REAL, total_commitment REAL, management_fee REAL, carried_interest REAL, fund_size_cents INTEGER, gp_user_id INTEGER);
    INSERT INTO vc_funds VALUES(1,'Visible',2025,'active',50,1000,.02,.2,100000,40),(2,'Other GP',2025,'active',0,1000,.02,.2,100000,41);
    CREATE TABLE fund_distributions(fund_id INTEGER, amount_cents INTEGER, status TEXT);`, receipts);
  const secret = 'd550-fixture-only-signing-secret';
  const jwt = await new SignJWT({user_id:40, role:'investor'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  try {
    const response = await funds.request('/analytics', {headers:{Authorization:`Bearer ${jwt}`}}, {DB,JWT_SECRET:secret,ENVIRONMENT:'development'} as any);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.items.map((f: any) => f.id), [1]);
    assert.equal(body.items[0].called_cents, 32345);
    assert.equal(body.items[0].collected_cents, 9000);
    assert.equal(body.items[0].lp_capital.length, 2);
    assert.equal(body.totals.outstanding_cents, 23345);
  } finally { db.close(); }
});
