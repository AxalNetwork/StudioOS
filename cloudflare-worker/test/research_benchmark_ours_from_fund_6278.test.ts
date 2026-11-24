/**
 * D6278 (#6278): a benchmark's "Ours" from a fund's recorded TVPI or DPI.
 *
 * Real SQLite: the benchmark tables come from migrations 217 and 303 with this
 * issue's migration applied over them, and the fund tables are fund
 * performance's own fixture shape, so the figure offered is the one
 * `readFundPerformance` computes and the fund list is the one it reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { stripForeignKeys } from './_baseline.mjs';
import funds, { formatMultiple, mount } from '../src/routes/research_benchmark_funds.ts';
import research from '../src/routes/research.ts';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const secret = 'd6278-fixture-only-signing-secret';
// The Worker reads figures as of today; the clock is pinned so "today" is fixed.
const NOW = '2026-11-18T12:00:00.000Z';
const TODAY = NOW.slice(0, 10);
const pin = (t: any) => t.mock.timers.enable({ apis: ['Date'], now: new Date(NOW) });

function tableFrom(prefix: string, table: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`)) as string;
  const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `migration ${prefix} no longer declares ${table}`);
  return stripForeignKeys(sql.slice(start, sql.indexOf('\n);', start) + 3)) + ';';
}
const thisMigration = readFileSync(resolve(MIGRATIONS, '202611180253_6278_research_benchmark_fund.sql'), 'utf8');
const valuations = readFileSync(resolve(MIGRATIONS, '417_fund_position_valuations.sql'), 'utf8');

// Fund performance's fixture (fund_performance_d627.test.ts), plus fund 30
// with nothing called, so its TVPI and DPI are not recorded.
const schema = `
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT, is_active INTEGER, investor_tier TEXT, investor_subscription_status TEXT);
INSERT INTO users VALUES (1,'admin@example.test','Admin','admin',1,NULL,NULL),
 (3,'lp@example.test','LP','investor',1,'professional','active'),
 (4,'other@example.test','Other LP','investor',1,'institutional','active');
CREATE TABLE vc_funds(id INTEGER PRIMARY KEY, name TEXT, vintage_year INTEGER, status TEXT, gp_user_id INTEGER);
INSERT INTO vc_funds VALUES (10,'Fund A',2021,'active',NULL),(20,'Fund B',2022,'active',NULL),(30,'Fund C',2024,'active',NULL);
CREATE TABLE limited_partners(id INTEGER PRIMARY KEY, fund_id INTEGER, user_id INTEGER, email TEXT);
INSERT INTO limited_partners VALUES (101,10,3,'lp@example.test'),(102,20,4,'other@example.test');
CREATE TABLE portfolio_positions(id INTEGER PRIMARY KEY, fund_id INTEGER, created_by INTEGER, updated_at TEXT, position_date TEXT, created_at TEXT);
INSERT INTO portfolio_positions(id, fund_id, created_by) VALUES (201,10,1),(202,20,1);
CREATE TABLE fund_capital_calls(id INTEGER PRIMARY KEY, fund_id INTEGER, amount_cents INTEGER, created_at TEXT);
INSERT INTO fund_capital_calls VALUES (1,10,10000,'2021-01-01 12:00:00'),(2,20,20000,'2021-01-01');
CREATE TABLE capital_calls(id INTEGER PRIMARY KEY, limited_partner_id INTEGER, fund_call_id INTEGER, amount_cents INTEGER, amount REAL, created_at TEXT);
CREATE TABLE fund_distributions(id INTEGER PRIMARY KEY, fund_id INTEGER, amount_cents INTEGER, status TEXT, distributed_at TEXT);
INSERT INTO fund_distributions VALUES (1,10,1000,'paid','2022-01-01'),(2,20,4000,'paid','2022-01-01');
CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, action TEXT, details TEXT, actor TEXT, user_id INTEGER);
`;

function fixture(opts: { failFundList?: boolean } = {}) {
  const { DB, db } = makeD1(schema + valuations + tableFrom('217', 'research_benchmarks')
    + tableFrom('303', 'research_benchmark_constituents') + stripForeignKeys(thisMigration));
  db.exec(`INSERT INTO fund_position_valuations(position_id,valuation_date,value_cents,source,recorded_by) VALUES
    (201,'2023-01-01',12100,'Latest',1),(202,'2023-01-01',30000,'Latest',1);`);
  const add = db.prepare(`INSERT INTO research_benchmarks (id, uid, owner_user_id, metric, our_value, updated_at)
    VALUES (?, ?, ?, ?, ?, '2026-09-01T00:00:00.000Z')`);
  add.run(1, 'b-empty', 3, 'TVPI', null);
  add.run(2, 'b-typed', 3, 'TVPI', '1.4x');
  add.run(3, 'b-theirs', 4, 'TVPI', null);
  add.run(4, 'b-admin', 1, 'TVPI', null);
  const env = { DB, JWT_SECRET: secret, ENVIRONMENT: 'development' } as any;
  if (opts.failFundList) {
    env.DB = { prepare(sql: string) {
      const stmt = DB.prepare(sql);
      if (!/FROM vc_funds/.test(sql)) return stmt;
      const failing: any = { bind: () => failing, all: async () => ({ success: false, results: [] }),
        first: async () => null, run: async () => ({ success: false }) };
      return failing;
    }, batch: DB.batch?.bind(DB) };
  }
  const send = async (router: any, path: string, user: number, method = 'GET', body?: any) => {
    const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const res = await router.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const row = (uid: string) => ({ ...(db.prepare('SELECT * FROM research_benchmarks WHERE uid = ?').get(uid) as any) });
  return {
    db, row,
    figures: (user: number) => send(funds, '/fund-figures', user),
    use: (user: number, uid: string, body: any) => send(funds, `/${uid}/ours-from-fund`, user, 'POST', body),
    patch: (user: number, uid: string, body: any) => send(research, `/benchmarks/${uid}`, user, 'PATCH', body),
    detail: (user: number, uid: string) => send(research, `/benchmarks/${uid}`, user),
  };
}

test('fund figures offer only the funds the caller can read, with each figure or why it is not recorded', async (t) => {
  pin(t);
  const f = fixture();
  const lp = await f.figures(3);
  assert.equal(lp.status, 200);
  assert.deepEqual(lp.body.items.map((x: any) => x.fund_id), [10], 'an LP was offered a fund they hold no position in');
  assert.deepEqual(lp.body.items[0].tvpi, { value: 1.31, display: '1.31×', reason: null });
  assert.deepEqual(lp.body.items[0].dpi, { value: 0.1, display: '0.10×', reason: null });
  assert.equal(lp.body.items[0].as_of, TODAY);

  const admin = await f.figures(1);
  assert.deepEqual(admin.body.items.map((x: any) => x.fund_id), [10, 20, 30]);
  const empty = admin.body.items.find((x: any) => x.fund_id === 30);
  assert.equal(empty.tvpi.value, null, 'a fund with nothing called showed a TVPI');
  assert.equal(empty.tvpi.display, null);
  assert.match(empty.tvpi.reason, /capital called/);
});

test('using a fund figure fills an empty "Ours" and records where it came from', async (t) => {
  pin(t);
  const f = fixture();
  const r = await f.use(3, 'b-empty', { fund_id: 10, metric: 'tvpi' });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.our_value, '1.31×');
  assert.deepEqual(r.body.item.our_from, { fund_id: 10, fund_name: 'Fund A', metric: 'tvpi', as_of: TODAY });
  const stored = f.row('b-empty');
  assert.equal(stored.fund_id, 10);
  assert.equal(stored.our_value_metric, 'tvpi');
  assert.equal(stored.our_value_as_of, TODAY);
  // The ordinary detail read says the same thing.
  assert.deepEqual((await f.detail(3, 'b-empty')).body.item.our_from, r.body.item.our_from);
  // A row typed by hand says so with null.
  assert.equal((await f.detail(3, 'b-typed')).body.item.our_from, null);
});

test('a typed "Ours" is never overwritten without the writer confirming', async (t) => {
  pin(t);
  const f = fixture();
  const refused = await f.use(3, 'b-typed', { fund_id: 10, metric: 'dpi' });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'typed_value');
  assert.match(refused.body.message, /typed by hand \(1\.4x\).*Fund A’s recorded DPI of 0\.10×/);
  assert.equal(refused.body.proposed.display, '0.10×');
  assert.equal(f.row('b-typed').our_value, '1.4x', 'a typed figure changed without confirmation');
  assert.equal(f.row('b-typed').fund_id, null);

  const confirmed = await f.use(3, 'b-typed', { fund_id: 10, metric: 'dpi', replace: true });
  assert.equal(confirmed.status, 200);
  assert.equal(f.row('b-typed').our_value, '0.10×');
  // Swapping one recorded figure for another needs no confirmation: neither was typed.
  assert.equal((await f.use(3, 'b-typed', { fund_id: 10, metric: 'tvpi' })).status, 200);
  assert.equal(f.row('b-typed').our_value, '1.31×');
});

test('a figure that is not recorded is refused with its reason, never written as zero', async (t) => {
  pin(t);
  const f = fixture();
  const r = await f.use(1, 'b-admin', { fund_id: 30, metric: 'tvpi' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'figure_not_recorded');
  assert.match(r.body.message, /^Not recorded: .*capital called/);
  const stored = f.row('b-admin');
  assert.equal(stored.our_value, null);
  assert.equal(stored.fund_id, null);
});

test('a fund the caller cannot read answers as a missing one, and another owner’s benchmark is not found', async (t) => {
  pin(t);
  const f = fixture();
  const unreadable = await f.use(3, 'b-empty', { fund_id: 20, metric: 'tvpi' });
  const missing = await f.use(3, 'b-empty', { fund_id: 999, metric: 'tvpi' });
  assert.equal(unreadable.status, 404);
  assert.deepEqual(unreadable.body, missing.body, 'an unreadable fund was distinguishable from a missing one');
  assert.equal(f.row('b-empty').fund_id, null);

  const theirs = await f.use(3, 'b-theirs', { fund_id: 10, metric: 'tvpi' });
  assert.equal(theirs.status, 404);
  assert.equal(theirs.body.error, 'benchmark_not_found');
  assert.equal(f.row('b-theirs').our_value, null);
});

test('a fund the reader lost access to keeps the figure but no longer names the fund', async (t) => {
  pin(t);
  const f = fixture();
  assert.equal((await f.use(3, 'b-empty', { fund_id: 10, metric: 'tvpi' })).status, 200);
  f.db.exec('DELETE FROM limited_partners WHERE id = 101');
  const after = await f.detail(3, 'b-empty');
  assert.equal(after.body.item.our_value, '1.31×');
  assert.deepEqual(after.body.item.our_from, { fund_id: 10, fund_name: null, metric: 'tvpi', as_of: TODAY });
});

test('a hand edit of "Ours" drops the fund link; an edit elsewhere keeps it', async (t) => {
  pin(t);
  const f = fixture();
  await f.use(3, 'b-empty', { fund_id: 10, metric: 'tvpi' });
  assert.equal((await f.patch(3, 'b-empty', { reading: 'One re-mark.' })).status, 200);
  assert.equal(f.row('b-empty').fund_id, 10, 'editing the reading dropped the fund link');
  assert.equal((await f.patch(3, 'b-empty', { our_value: '1.31×' })).status, 200);
  assert.equal(f.row('b-empty').fund_id, 10, 'saving the same figure dropped the fund link');

  const edited = await f.patch(3, 'b-empty', { our_value: '1.5x' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.item.our_from, null);
  const stored = f.row('b-empty');
  assert.deepEqual([stored.our_value, stored.fund_id, stored.our_value_metric, stored.our_value_as_of], ['1.5x', null, null, null]);
});

test('bad input is refused with a sentence, and an unreadable fund list says Unreadable rather than empty', async (t) => {
  pin(t);
  const f = fixture();
  assert.equal((await f.use(3, 'b-empty', { fund_id: 10, metric: 'irr' })).body.error, 'fund_metric_invalid');
  assert.equal((await f.use(3, 'b-empty', { metric: 'tvpi' })).body.error, 'fund_required');

  const broken = fixture({ failFundList: true });
  const read = await broken.figures(1);
  assert.equal(read.status, 503);
  assert.equal(read.body.error, 'fund_figures_unreadable');
  assert.match(read.body.message, /Unreadable/);
  const write = await broken.use(1, 'b-admin', { fund_id: 10, metric: 'tvpi' });
  assert.equal(write.status, 503);
  assert.equal(broken.row('b-admin').our_value, null);
});

test('the router mounts ahead of research.ts, so fund-figures is never read as a benchmark uid', () => {
  assert.equal(mount.path, '/api/research/benchmarks');
  assert.ok(mount.before?.includes(research), 'fund-figures would be shadowed by GET /benchmarks/:uid');
  assert.equal(formatMultiple(1.4), '1.40×');
});
