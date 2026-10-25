/** Mounted reads over migration 474 in real SQLite. All amounts are synthetic;
 * both the injected and global bank callers refuse every network request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, SUPER, FOUNDER, PARTNER, INVESTOR, ADVISOR, EXPLORING, appFor, call, envFor, freshDb } from './_mercury_fixture.ts';

const NOW = new Date('2026-10-25T23:59:59Z');
const previousFetch = globalThis.fetch;
let bankCalls = 0;
const noBank = async () => { bankCalls++; throw new Error('Bank caller must be stubbed'); };
globalThis.fetch = noBank;
test.after(() => { globalThis.fetch = previousFetch; assert.equal(bankCalls, 0); });

function setup(now = NOW) {
  const db = freshDb(), env = envFor(db);
  const base = env.DB, bankReads: number[] = [];
  // Observe order only; every statement still executes against real SQLite.
  env.DB = { ...base, prepare(sql: string) {
    let statement = base.prepare(sql);
    const observe = () => {
      if (/\bmercury_(accounts|balance_snapshots|transactions)\b/.test(sql)) bankReads.push(Number(db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n));
    };
    return {
      bind(...args: any[]) { statement = statement.bind(...args); return this; },
      all: () => { observe(); return statement.all(); },
      first: (...args: any[]) => { observe(); return statement.first(...args); },
      run: () => { observe(); return statement.run(); },
    };
  } };
  const app = appFor({ now: () => now, fetcher: noBank });
  let seq = 0;
  const account = (entity: string, ending: string, registered = 1, uid = `account-${ending}`) => {
    let conn = db.prepare('SELECT id FROM mercury_entity_connections WHERE entity_key = ?').get(entity) as any;
    if (!conn) {
      const result = db.prepare("INSERT INTO mercury_entity_connections (uid, entity_key, status, credentials_enc, connected_by) VALUES (?, ?, 'active', 'v1.synthetic-private-credential', ?)").run(`conn-${entity}`, entity, SUPER);
      conn = { id: Number(result.lastInsertRowid) };
    }
    return Number(db.prepare(`INSERT INTO mercury_accounts (uid, mercury_account_id, connection_id, entity_key, kind, last_four, nickname, registered)
      VALUES (?, ?, ?, ?, 'checking', ?, 'SYNTHETIC PRIVATE LABEL', ?)`)
      .run(uid, `private-provider-${ending}`, conn.id, entity, ending, registered).lastInsertRowid);
  };
  const snapshot = (id: number, date: string, current: number | null, available: number | null) => db.prepare(
    'INSERT INTO mercury_balance_snapshots (account_id, as_of_date, current_cents, available_cents, read_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, date, current, available, `${date} 08:00:00`);
  const txn = (id: number, amount: number, posted: string | null, extra: { status?: string; kind?: string; currency?: string; created?: string } = {}) => {
    seq++;
    return Number(db.prepare(`INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, posted_on, created_on, status, kind, currency, memo, counterparty_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRIVATE MEMO', 'PRIVATE COUNTERPARTY')`)
      .run(`txn-${seq}`, `private-provider-txn-${seq}`, id, amount, posted, extra.created ?? posted, extra.status ?? 'sent', extra.kind ?? 'externalTransfer', extra.currency ?? 'usd').lastInsertRowid);
  };
  const get = (path: string, user = ADMIN, opts = {}) => call(app, env, 'GET', path, user, opts);
  return { db, env, app, bankReads, account, snapshot, txn, get };
}
const entity = (body: any, key: string) => body.items.find((x: any) => x.entity_key === key);
const month = (body: any, key: string, date: string) => entity(body, key).points.find((x: any) => x.month === date);

test('daily balances retain real readings, gaps, nulls, zero and as-of, with only masked account metadata', async () => {
  const s = setup();
  const h = s.account('holdings', '4821'), g = s.account('gp', '6604', 0);
  s.snapshot(h, '2026-09-25', 12, 10); // outside 30 days
  s.snapshot(h, '2026-09-26', 10005, 9001);
  s.snapshot(h, '2026-10-23', 0, null);
  s.snapshot(h, '2026-10-25', 25000, 24000);
  s.snapshot(h, '2026-10-26', 99999, 99999); // future
  const r = await s.get('/balances?range=30d');
  assert.equal(r.status, 200); assert.deepEqual([r.body.range, r.body.from, r.body.to, r.body.currency], ['30d', '2026-09-26', '2026-10-25', 'USD']);
  const a = r.body.items.find((x: any) => x.account_uid === 'account-4821');
  assert.deepEqual(a, { account_uid: 'account-4821', entity_key: 'holdings', kind: 'checking', account_masked: '••••4821', registered: true, reason: null,
    points: [
      { date: '2026-09-26', current: { cents: 10005, reason: null }, available: { cents: 9001, reason: null }, as_of: '2026-09-26 08:00:00' },
      { date: '2026-10-23', current: { cents: 0, reason: null }, available: { cents: null, reason: 'not_recorded' }, as_of: '2026-10-23 08:00:00' },
      { date: '2026-10-25', current: { cents: 25000, reason: null }, available: { cents: 24000, reason: null }, as_of: '2026-10-25 08:00:00' },
    ] });
  assert.deepEqual(r.body.items.find((x: any) => x.account_uid === 'account-6604'), { account_uid: 'account-6604', entity_key: 'gp', kind: 'checking', account_masked: '••••6604', registered: false, reason: 'not_recorded', points: [] });
  assert.doesNotMatch(r.text, /private-provider|PRIVATE|credentials|last_four/);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM mercury_balance_snapshots WHERE account_id = ?').get(g)!.n, 0);
});

test('account filter, default 90-day range and trailing 12 calendar months include exactly their boundaries', async () => {
  const s = setup(), a = s.account('fund', '1111');
  s.account('gp', '2222');
  for (const day of ['2025-10-25', '2025-10-26', '2026-07-27', '2026-07-28', '2026-10-25']) s.snapshot(a, day, 1, 2);
  const ninety = await s.get('/balances?account=account-1111');
  assert.equal(ninety.status, 200); assert.equal(ninety.body.range, '90d'); assert.equal(ninety.body.from, '2026-07-28');
  assert.deepEqual(ninety.body.items.map((x: any) => x.account_uid), ['account-1111']);
  assert.deepEqual(ninety.body.items[0].points.map((x: any) => x.date), ['2026-07-28', '2026-10-25']);
  const year = await s.get('/balances?account=account-1111&range=12m');
  assert.equal(year.status, 200); assert.equal(year.body.from, '2025-10-26');
  assert.deepEqual(year.body.items[0].points.map((x: any) => x.date), ['2025-10-26', '2026-07-27', '2026-07-28', '2026-10-25']);
  const leap = setup(new Date('2024-02-29T00:30:00Z')), l = leap.account('gp', '3333');
  leap.snapshot(l, '2023-02-28', 1, 1); leap.snapshot(l, '2023-03-01', 2, 2);
  const r = await leap.get('/balances?range=12m');
  assert.equal(r.status, 200); assert.deepEqual([r.body.from, r.body.to], ['2023-03-01', '2024-02-29']);
  assert.deepEqual(r.body.items[0].points.map((x: any) => x.date), ['2023-03-01']);
});

test('monthly posted USD flows use posting month, leave gaps, preserve measured zero, and mark current month to date', async () => {
  const s = setup(), h = s.account('holdings', '1111'), h2 = s.account('holdings', '2222');
  s.account('fund', '3333');
  s.txn(h, 101, '2026-05-01'); s.txn(h, 777, '2026-04-30');
  s.txn(h, 12000, '2026-06-05', { created: '2026-05-20' }); s.txn(h, -3500, '2026-06-07');
  s.txn(h, 50, '2026-06-10', { status: 'pending' }); s.txn(h, 80, null, { created: '2026-06-10' });
  s.txn(h, 90, '2026-06-10', { status: 'cancelled' }); s.txn(h, 99, '2026-06-10', { status: 'failed' });
  s.txn(h, -600, '2026-06-18'); s.txn(h2, 600, '2026-06-19'); // same entity is not a D712 pair
  s.txn(h, 0, '2026-07-01');
  s.txn(h, -500, '2026-08-05', { kind: 'internalTransfer' }); s.txn(h2, 500, '2026-08-05', { kind: 'internalTransfer' });
  s.txn(h, 700, '2026-10-25', { status: 'SENT' }); s.txn(h, 99999, '2026-10-26');
  const r = await s.get('/monthly');
  assert.equal(r.status, 200); assert.deepEqual([r.body.from, r.body.to, r.body.months, r.body.currency], ['2026-05-01', '2026-10-25', 6, 'USD']);
  assert.deepEqual(entity(r.body, 'holdings').points, [
    { month: '2026-05', in_cents: 101, out_cents: 0, to_date: false },
    { month: '2026-06', in_cents: 12600, out_cents: 4100, to_date: false },
    { month: '2026-07', in_cents: 0, out_cents: 0, to_date: false },
    { month: '2026-08', in_cents: 0, out_cents: 0, to_date: false },
    { month: '2026-10', in_cents: 700, out_cents: 0, to_date: true },
  ]);
  assert.deepEqual(entity(r.body, 'fund'), { entity_key: 'fund', reason: 'not_recorded', points: [] });
  assert.doesNotMatch(r.text, /PRIVATE|private-provider|account_uid|last_four/);
});

test('five-day intercompany pairs cross month/window boundaries, pair once earliest-first, and survive the entity display filter', async () => {
  const s = setup(), h = s.account('holdings', '1111'), m = s.account('management', '2222'), g = s.account('gp', '3333'), f = s.account('fund', '4444');
  s.txn(h, -3000, '2026-04-26'); s.txn(g, 3000, '2026-05-01'); // five-day lookback boundary
  s.txn(h, -1300, '2026-08-10'); s.txn(g, -1300, '2026-08-11'); s.txn(m, 1300, '2026-08-12'); // one debit only
  s.txn(h, -4000, '2026-08-26'); s.txn(f, 4000, '2026-09-01'); // six days: not a pair
  s.txn(g, -2500, '2026-09-04'); s.txn(m, 2500, '2026-09-05'); s.txn(f, 2500, '2026-09-06'); // one credit only
  s.txn(h, -2000, '2026-09-29'); s.txn(m, 2000, '2026-10-03');
  s.txn(m, 5000, '2026-10-01'); s.txn(f, -5000, '2026-10-06'); // credit can post first
  s.txn(m, 6100, '2026-06-14'); s.txn(h, -6100, '2026-06-20'); // reverse, six days: not a pair
  const r = await s.get('/monthly');
  assert.equal(r.status, 200);
  assert.deepEqual(month(r.body, 'gp', '2026-05'), { month: '2026-05', in_cents: 0, out_cents: 0, to_date: false });
  assert.equal(month(r.body, 'holdings', '2026-08').out_cents, 4000);
  assert.equal(month(r.body, 'gp', '2026-08').out_cents, 1300);
  assert.equal(month(r.body, 'holdings', '2026-06').out_cents, 6100);
  assert.equal(month(r.body, 'management', '2026-06').in_cents, 6100);
  assert.equal(month(r.body, 'fund', '2026-09').in_cents, 6500);
  assert.equal(month(r.body, 'gp', '2026-09').out_cents, 0);
  assert.equal(month(r.body, 'management', '2026-09').in_cents, 0);
  assert.equal(month(r.body, 'holdings', '2026-09').out_cents, 0);
  assert.equal(month(r.body, 'management', '2026-10').in_cents, 0);
  assert.equal(month(r.body, 'fund', '2026-10').out_cents, 0);
  const filtered = await s.get('/monthly?entity=management');
  assert.equal(filtered.status, 200); assert.deepEqual(filtered.body.items, [entity(r.body, 'management')]);
});

test('an unregistered account does not form a D712 intercompany pair; no data produces no invented months', async () => {
  const s = setup(), h = s.account('holdings', '1111', 0), g = s.account('gp', '2222');
  s.txn(h, -8000, '2026-09-20'); s.txn(g, 8000, '2026-09-21');
  const hr = s.account('holdings', '3333'), mu = s.account('management', '4444', 0);
  s.txn(hr, -9000, '2026-10-10'); s.txn(mu, 9000, '2026-10-11');
  const r = await s.get('/monthly');
  assert.equal(r.status, 200); assert.equal(month(r.body, 'holdings', '2026-09').out_cents, 8000); assert.equal(month(r.body, 'gp', '2026-09').in_cents, 8000);
  assert.equal(month(r.body, 'holdings', '2026-10').out_cents, 9000); assert.equal(month(r.body, 'management', '2026-10').in_cents, 9000);
  const empty = setup();
  assert.deepEqual((await empty.get('/balances')).body.items, []);
  const none = await empty.get('/monthly'); assert.equal(none.status, 200);
  assert.deepEqual(none.body.items.map((x: any) => [x.entity_key, x.reason, x.points]), ['holdings', 'management', 'gp', 'fund'].map(k => [k, 'not_recorded', []]));
});

test('each read records its own action and actor before querying bank tables, even for empty and unknown accounts', async () => {
  for (const [path, action] of [['/balances', 'mercury_balances_read'], ['/monthly', 'mercury_monthly_read']] as const) {
    const s = setup();
    assert.equal((await s.get(path, SUPER)).status, 200);
    assert.ok(s.bankReads.length > 0); assert.ok(s.bankReads.every(n => n === 1), `${path}: the audit precedes every bank read`);
    const rows = s.db.prepare('SELECT admin_user_id, action, filters_json FROM admin_audit_log').all() as any[];
    assert.deepEqual(rows.map(x => [x.admin_user_id, x.action]), [[SUPER, action]]);
    assert.doesNotMatch(rows[0].filters_json, /cents|PRIVATE|4821/);
  }
  const s = setup(); const missing = await s.get('/balances?account=unknown');
  assert.deepEqual([missing.status, missing.body.code], [404, 'account_not_recorded']); assert.deepEqual(s.bankReads, [1]);
});

test('audit failure returns 503 without making a bank read or logging its private error', async () => {
  const s = setup(); s.account('gp', '1111');
  s.db.exec("CREATE TRIGGER fail_read_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT, 'PRIVATE AUDIT DETAILS'); END");
  const previous = console.warn, warnings: string[] = []; console.warn = (...args) => warnings.push(args.join(' '));
  try {
    for (const path of ['/balances', '/monthly']) {
      const r = await s.get(path); assert.deepEqual([r.status, r.body.code], [503, 'audit_unavailable']);
      assert.equal(r.body.items, undefined); assert.doesNotMatch(r.text, /1111|PRIVATE|cents/);
    }
    assert.deepEqual(s.bankReads, []); assert.doesNotMatch(warnings.join(' '), /PRIVATE AUDIT DETAILS/);
  } finally { console.warn = previous; }
});

test('unavailable snapshot/transaction stores and unsafe totals are unreadable, never successful empty charts or raw errors', async () => {
  for (const [path, table, code] of [['/balances', 'mercury_balance_snapshots', 'balances_unreadable'], ['/monthly', 'mercury_transactions', 'monthly_unreadable']] as const) {
    const s = setup(); s.account('gp', '1111'); s.db.exec(`DROP TABLE ${table}`);
    const r = await s.get(path); assert.deepEqual([r.status, r.body.code], [503, code]);
    assert.equal(r.body.items, undefined); assert.doesNotMatch(r.text, /no such table|1111|mercury_/);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n, 1);
  }
  const s = setup(), h = s.account('holdings', '1111');
  s.txn(h, Number.MAX_SAFE_INTEGER, '2026-10-01'); s.txn(h, 1, '2026-10-02');
  const overflow = await s.get('/monthly'); assert.deepEqual([overflow.status, overflow.body.code], [503, 'monthly_unreadable']);
});

test('HQ admin reads need no write elevation; all other roles, support sessions and branches are refused before bank reads or audit', async () => {
  for (const path of ['/balances', '/monthly']) {
    const s = setup();
    for (const user of [FOUNDER, PARTNER, INVESTOR, ADVISOR, EXPLORING]) assert.equal((await s.get(path, user)).status, 403);
    assert.equal((await s.app.request(`/api/admin/mercury${path}`, {}, s.env)).status, 401);
    assert.deepEqual([(await s.get(path, ADMIN, { impersonated: true })).status, (await s.get(path, SUPER, { impersonated: true })).status], [403, 403]);
    s.env.BRANCH_CODE = 'synthetic';
    assert.deepEqual([(await s.get(path, ADMIN)).status, (await s.get(path, SUPER)).status], [403, 403]);
    assert.deepEqual(s.bankReads, []); assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n, 0);
  }
});

test('bounded account/range and entity filters refuse invalid values without echoing them or reading/auditing bank data', async () => {
  const s = setup();
  for (const path of ['/balances?range=7d', '/balances?account=%27private', `/balances?account=${'a'.repeat(81)}`, '/monthly?entity=private']) {
    const r = await s.get(path); assert.equal(r.status, 400); assert.doesNotMatch(r.text, /private|a{81}/);
  }
  assert.deepEqual(s.bankReads, []); assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get()!.n, 0);
});
