import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import route from '../src/routes/fund_performance.ts';
import { calculatePerformance, readFundPerformance, validDate, xirr } from '../src/services/fundPerformance.ts';
const marks = [{ id: 1, value_cents: 12100, valuation_date: '2023-01-01' }];
const calls = [{ amount_cents: 10000, date: '2021-01-01' }];
const dist = [{ amount_cents: 1000, date: '2022-01-01' }];
const schema = `
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER, investor_tier TEXT, investor_subscription_status TEXT);
INSERT INTO users VALUES (1,'admin@example.test','Admin','admin',1,NULL,NULL),
 (2,'gp@example.test','GP','investor',1,'institutional','active'),
 (3,'lp@example.test','LP','investor',1,'professional','active'),
 (4,'other@example.test','Other LP','investor',1,'institutional','active'),
 (5,'founder@example.test','Founder','founder',1,NULL,NULL),
 (6,'legacy@example.test','Legacy','investor',1,'professional','active');
CREATE TABLE vc_funds(id INTEGER PRIMARY KEY, name TEXT, vintage_year INTEGER, status TEXT, gp_user_id INTEGER);
INSERT INTO vc_funds VALUES (10,'Fund A',2021,'active',2),(20,'Fund B',2022,'active',4);
CREATE TABLE limited_partners(id INTEGER PRIMARY KEY, fund_id INTEGER, user_id INTEGER, email TEXT);
INSERT INTO limited_partners VALUES (101,10,3,'lp@example.test'),(102,20,4,'other@example.test'),(103,10,NULL,'LEGACY@example.test'),(104,20,4,'legacy@example.test');
CREATE TABLE portfolio_positions(id INTEGER PRIMARY KEY, fund_id INTEGER, created_by INTEGER, updated_at TEXT);
INSERT INTO portfolio_positions VALUES (201,10,2,NULL),(202,20,4,NULL),(203,NULL,2,NULL),(204,NULL,4,NULL);
CREATE TABLE fund_capital_calls(id INTEGER PRIMARY KEY, fund_id INTEGER, amount_cents INTEGER, created_at TEXT);
INSERT INTO fund_capital_calls VALUES (1,10,10000,'2021-01-01 12:00:00'),(2,20,999999,'2021-01-01');
CREATE TABLE capital_calls(id INTEGER PRIMARY KEY, limited_partner_id INTEGER, fund_call_id INTEGER, amount_cents INTEGER, amount REAL, created_at TEXT);
INSERT INTO capital_calls VALUES (1,101,1,10000,100,'2021-01-01'),(2,102,2,999999,9999.99,'2021-01-01');
CREATE TABLE fund_distributions(id INTEGER PRIMARY KEY, fund_id INTEGER, amount_cents INTEGER, status TEXT, distributed_at TEXT);
INSERT INTO fund_distributions VALUES (1,10,1000,'paid','2022-01-01'),(2,10,90000,'pending','2022-01-01'),(3,20,888888,'paid','2022-01-01');
CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, action TEXT, details TEXT, actor TEXT, user_id INTEGER);
`;
const migration = readFileSync(new URL('../sql/migrations/417_fund_position_valuations.sql', import.meta.url), 'utf8');
const secret = 'd627-fixture-only-signing-secret';
async function fixture() {
  const { DB, db } = makeD1(schema + migration);
  db.exec(`INSERT INTO fund_position_valuations(position_id,valuation_date,value_cents,source,recorded_by) VALUES
    (201,'2021-01-01',10000,'Initial',2),(201,'2023-01-01',12100,'Latest',2),(202,'2023-01-01',999999,'Other',4);`);
  const env = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development' } as any;
  const request = async (path: string, user = 1, method = 'GET', body?: any) => {
    const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    return route.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  };
  return { DB, db, env, request };
}
test('worked formulas use called capital and investments-only NAV; known annual IRR', () => {
  const p = calculatePerformance(marks, calls, dist, '2023-01-01');
  assert.equal(p.nav_cents, 12100);
  assert.equal(p.paid_in_cents, 10000);
  assert.equal(p.distributed_cents, 1000);
  assert.equal(p.rvpi, 1.21);
  assert.equal(p.dpi, .1);
  assert.equal(p.tvpi, 1.31);
  assert.ok(Math.abs(p.irr! - ((.1 + Math.sqrt(.01 + 4 * 1.21)) / 2 - 1)) < 1e-9);
  assert.match(p.nav_basis, /Investments only/);
  assert.deepEqual(p.unavailable, {});
});
test('XIRR handles irregular dates, zero and negative returns; refuses absent or ambiguous roots', () => {
  const excel = [{ date:'2008-01-01',amount_cents:-1000000 },{date:'2008-03-01',amount_cents:275000},{date:'2008-10-30',amount_cents:425000},{date:'2009-02-15',amount_cents:325000},{date:'2009-04-01',amount_cents:275000}];
  assert.ok(Math.abs(xirr(excel)! - .373362535) < 1e-8);
  assert.ok(Math.abs(xirr([...calls.map(f => ({...f,amount_cents:-f.amount_cents})),{date:'2023-01-01',amount_cents:12100}])! - .1) < 1e-9);
  assert.ok(Math.abs(xirr([{date:'2021-01-01',amount_cents:-100},{date:'2022-01-01',amount_cents:100}])!) < 1e-9);
  assert.ok(Math.abs(xirr([{date:'2021-01-01',amount_cents:-100},{date:'2022-01-01',amount_cents:90}])! + .1) < 1e-9);
  for (const series of [[],[{date:'2021-01-01',amount_cents:100}], [{date:'2021-01-01',amount_cents:-100},{date:'2021-01-01',amount_cents:110}], [{date:'2021-01-01',amount_cents:-100},{date:'2022-01-01',amount_cents:-100}], [{date:'2021-01-01',amount_cents:-100},{date:'2022-01-01',amount_cents:230},{date:'2023-01-01',amount_cents:-132}], [{date:null,amount_cents:-100},{date:'2022-01-01',amount_cents:110}]]) assert.equal(xirr(series), null);
});
test('missing marks, calls, distributions and dates withhold only unsupported figures with reasons', () => {
  for (const [positions, flows, paid, fields] of [
    [[],calls,dist,['nav_cents','rvpi','tvpi','irr']],
    [[...marks,{id:2,value_cents:null,valuation_date:null}],calls,dist,['nav_cents','rvpi','tvpi','irr']],
    [marks,[],dist,['paid_in_cents','rvpi','dpi','tvpi','irr']],
    [marks,calls,[],['distributed_cents','dpi','tvpi','irr']],
    [[{id:1,value_cents:1.5,valuation_date:'2023-01-01'}],calls,dist,['nav_cents','rvpi','tvpi','irr']],
    [[{id:1,value_cents:.5,valuation_date:'2023-01-01'},{id:2,value_cents:.5,valuation_date:'2023-01-01'}],calls,dist,['nav_cents','rvpi','tvpi','irr']],
    [marks,[{amount_cents:-1,date:'2021-01-01'}],dist,['paid_in_cents','rvpi','dpi','tvpi','irr']],
    [marks,calls,[{amount_cents:1.5,date:'2022-01-01'}],['distributed_cents','dpi','tvpi','irr']],
    [marks,[{amount_cents:0,date:'2021-01-01'}],dist,['rvpi','dpi','tvpi','irr']],
    [marks,[{amount_cents:10000,date:null}],dist,['irr']],
    [marks,calls,[{amount_cents:1000,date:null}],['irr']],
    [marks,[{amount_cents:10000,date:'2024-01-01'}],dist,['irr']],
  ] as any[]) {
    const p = calculatePerformance(positions, flows, paid, '2023-01-01') as any;
    for (const field of fields) { assert.equal(p[field], null); assert.ok(p.unavailable[field]?.length > 10); }
  }
  const zero = calculatePerformance([{id:1,value_cents:0,valuation_date:'2023-01-01'}],calls,[{amount_cents:0,date:'2022-01-01'}],'2023-01-01');
  assert.deepEqual([zero.nav_cents,zero.rvpi,zero.distributed_cents,zero.dpi,zero.tvpi], [0,0,0,0,0]);
  assert.equal(zero.irr, null);
  const overflow = calculatePerformance([{id:1,value_cents:Number.MAX_SAFE_INTEGER,valuation_date:'2023-01-01'},{id:2,value_cents:1,valuation_date:'2023-01-01'}],calls,dist,'2023-01-01');
  assert.equal(overflow.nav_cents, null);
});
test('date validation rejects calendar overflow, timestamps and non-date values', () => {
  assert.equal(validDate('2024-02-29'), true);
  for (const value of ['2023-02-29','2024-02-30','2023-13-01','2023-00-01','2023-01-00','2023-01-01T00:00:00Z',null,4,'x']) assert.equal(validDate(value), false);
});
test('real SQL picks latest marks with deterministic same-day tie, ignores future marks and double counting', async () => {
  const f = await fixture();
  try {
    f.db.exec(`INSERT INTO fund_position_valuations(position_id,valuation_date,value_cents,source,recorded_by) VALUES
      (201,'2023-01-01',13000,'Correction',1),(201,'2099-01-01',900000,'Future',1);
      INSERT INTO capital_calls VALUES(3,101,NULL,NULL,23.45,'2022-01-01');`);
    const p = await readFundPerformance(f.env, {id:10}, '2023-01-01');
    assert.equal(p.nav_cents,13000);
    assert.equal(p.paid_in_cents,12345);
    assert.equal(p.distributed_cents,1000);
    assert.equal(p.dpi,1000/12345);
  } finally { f.db.close(); }
});
test('admin reads all; LP reads only own fund; managers without LP membership cannot read; legacy email cannot override claimed owner', async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await (await f.request('/',1)).json() as any).items.map((x:any)=>x.id),[10,20]);
    assert.deepEqual((await (await f.request('/',3)).json() as any).items.map((x:any)=>x.id),[10]);
    assert.equal((await f.request('/10',3)).status,200);
    for (const [path,user] of [['/20',3],['/10',4],['/10',2],['/10',5],['/999',1],['/10x',1]] as const) assert.equal((await f.request(path,user)).status,404);
    assert.equal((await f.request('/',5)).status,404);
    assert.deepEqual((await (await f.request('/',6)).json() as any).items.map((x:any)=>x.id),[10]);
    assert.equal(f.db.prepare('SELECT user_id FROM limited_partners WHERE id=103').get()!.user_id,6);
    assert.equal(f.db.prepare('SELECT user_id FROM limited_partners WHERE id=104').get()!.user_id,4);
    assert.equal((await route.request('/10',{},f.env)).status,401);
  } finally { f.db.close(); }
});
test('GP/admin valuations and attribution record both actor and data; LP has no write access', async () => {
  const f = await fixture();
  try {
    const value = {valuation_date:'2023-04-01',value_cents:15000,source:' Board mark '};
    assert.equal((await f.request('/positions/201/valuations',2,'POST',value)).status,201);
    assert.deepEqual({...f.db.prepare('SELECT value_cents,source,recorded_by FROM fund_position_valuations ORDER BY id DESC LIMIT 1').get()}, {value_cents:15000,source:'Board mark',recorded_by:2});
    assert.equal((await f.request('/positions/201/valuations',1,'POST',{...value,value_cents:0})).status,201);
    assert.equal((await f.request('/positions/203/fund',2,'PUT',{fund_id:10})).status,200);
    assert.equal((await f.request('/positions/201/fund',1,'PUT',{fund_id:20})).status,200);
    assert.equal((await f.request('/positions/201/fund',1,'PUT',{fund_id:null})).status,200);
    const audits = f.db.prepare("SELECT action,actor,user_id,details FROM activity_logs WHERE action IN ('fund_position_valued','fund_position_attributed') ORDER BY id").all();
    assert.deepEqual(audits.map(x=>[x.action,x.actor,x.user_id]),[['fund_position_valued','2',2],['fund_position_valued','1',1],['fund_position_attributed','2',2],['fund_position_attributed','1',1],['fund_position_attributed','1',1]]);
    assert.deepEqual(JSON.parse(String(audits[2].details)),{position_id:203,before_fund_id:null,fund_id:10});
    assert.deepEqual(JSON.parse(String(audits[0].details)),{position_id:201,fund_id:10,valuation_date:'2023-04-01',value_cents:15000,source:'Board mark'});
    assert.deepEqual(JSON.parse(String(audits[3].details)),{position_id:201,before_fund_id:10,fund_id:20});
    assert.equal(f.db.prepare('SELECT fund_id FROM portfolio_positions WHERE id=203').get()!.fund_id,10);
    assert.equal(f.db.prepare('SELECT fund_id FROM portfolio_positions WHERE id=201').get()!.fund_id,null);
    for (const [id,user,method,body] of [[202,2,'POST',value],[201,3,'POST',value],[204,2,'PUT',{fund_id:10}],[202,2,'PUT',{fund_id:10}],[203,2,'PUT',{fund_id:20}],[203,3,'PUT',{fund_id:null}],[204,2,'POST',value]] as any[]) {
      assert.equal((await f.request(`/positions/${id}/${method==='POST'?'valuations':'fund'}`,user,method,body)).status,user === 3 && id === 203 ? 402 : 404);
    }
    assert.equal(f.db.prepare("SELECT count(*) n FROM activity_logs WHERE action LIKE 'fund_position_%'").get()!.n,5);
  } finally { f.db.close(); }
});
test('writes reject malformed amounts/dates/source/IDs and absent fund; no rows or audits on refusal', async () => {
  const f = await fixture();
  try {
    const base = {valuation_date:'2023-01-01',value_cents:100,source:'Fixture'};
    for (const value of [{...base,value_cents:-1},{...base,value_cents:1.5},{...base,value_cents:'100'},{...base,value_cents:Number.MAX_SAFE_INTEGER+1},{...base,valuation_date:'2023-02-29'},{...base,valuation_date:'2099-01-01'},{...base,source:' '},{...base,source:'s'.repeat(501)},null]) assert.equal((await f.request('/positions/201/valuations',1,'POST',value)).status,400);
    for (const body of [{fund_id:1.1},{fund_id:0},{fund_id:'10'},{}]) assert.equal((await f.request('/positions/201/fund',1,'PUT',body)).status,400);
    assert.equal((await f.request('/positions/201/fund',1,'PUT',{fund_id:999})).status,404);
    assert.equal((await f.request('/positions/201x/valuations',1,'POST',base)).status,400);
    assert.equal((await f.request('/positions/999/valuations',1,'POST',base)).status,404);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fund_position_valuations').get()!.n,3);
    assert.equal(f.db.prepare('SELECT count(*) n FROM activity_logs').get()!.n,0);
  } finally { f.db.close(); }
});
test('audit failure rolls back each write, and read failures say Unreadable rather than zero', async () => {
  const f = await fixture();
  try {
    f.db.exec('DROP TABLE activity_logs');
    assert.equal((await f.request('/positions/201/fund',1,'PUT',{fund_id:20})).status,503);
    assert.equal(f.db.prepare('SELECT fund_id FROM portfolio_positions WHERE id=201').get()!.fund_id,10);
    assert.equal((await f.request('/positions/201/valuations',1,'POST',{valuation_date:'2023-01-01',value_cents:100,source:'Fixture'})).status,503);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fund_position_valuations').get()!.n,3);
    f.db.exec('DROP TABLE fund_position_valuations');
    const response = await f.request('/10');
    assert.equal(response.status,503);
    const body = await response.json() as any;
    assert.match(body.message,/Unreadable/);
    assert.doesNotMatch(JSON.stringify(body),/no such table|SQLITE/);
  } finally { f.db.close(); }
});
test('migration stores only integer nonnegative marks with a recorded actor and source', async () => {
  const f = await fixture();
  try {
    for (const [amount,source,actor] of [[-1,'Fixture',1],[1.5,'Fixture',1],[1,' ',1],[1,'Fixture',null]]) assert.throws(()=>f.db.prepare('INSERT INTO fund_position_valuations(position_id,valuation_date,value_cents,source,recorded_by) VALUES(201,?,?,?,?)').run('2023-01-01',amount,source,actor));
  } finally { f.db.close(); }
});
test('a concurrent attribution change refuses either stale write without a mark or actor audit', async () => {
  for (const endpoint of ['fund','valuations']) {
    const f = await fixture();
    try {
      const real = f.env.DB.batch.bind(f.env.DB);
      f.env.DB = {...f.env.DB,batch:async (stmts:any[])=> {
        f.db.exec('UPDATE portfolio_positions SET fund_id=20 WHERE id=201');
        return real(stmts);
      }};
      const response = await f.request(`/positions/201/${endpoint}`,1,endpoint==='fund'?'PUT':'POST',endpoint==='fund'?{fund_id:null}:{valuation_date:'2023-01-01',value_cents:100,source:'Fixture'});
      assert.equal(response.status,409);
      assert.equal(f.db.prepare('SELECT fund_id FROM portfolio_positions WHERE id=201').get()!.fund_id,20);
      assert.equal(f.db.prepare('SELECT count(*) n FROM fund_position_valuations').get()!.n,3);
      assert.equal(f.db.prepare('SELECT count(*) n FROM activity_logs').get()!.n,0);
    } finally {f.db.close();}
  }
});
test('a reported D1 read failure is refused even when it supplies an empty results array', async () => {
  const DB = { prepare:()=>({bind:()=>({all:async()=>({success:false,results:[]})})}) };
  await assert.rejects(readFundPerformance({DB} as any,{id:10},'2023-01-01'),/read failed/);
});
