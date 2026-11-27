/**
 * D1184 (#3113, part 3 of #2389): the Bank accounts registry beside Mercury.
 * Each account's matched Mercury account by entity and last four, how a
 * notice prints it, and the last-four check on an add from a Mercury account.
 *
 * Mercury is stubbed by its own store: rows in `mercury_accounts` and
 * `mercury_entity_connections` (migration 474), with no network at all. The
 * registry is migration 472's, through the real router. Every account number
 * is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/bank_accounts_mercury_d1184.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import bankAccounts from '../src/routes/admin_bank_accounts.ts';
import { PAY_WARNING } from '../src/services/payInstructions.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const HOLDER = 901;
const NUMBER_GP = '4400118897';
const NUMBER_FUND = '73302255';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const databases: InstanceType<typeof DatabaseSync>[] = [];
const nativeFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected provider call'); }; });
test.afterEach(() => { while (databases.length) databases.pop()!.close(); });
test.after(() => { globalThis.fetch = nativeFetch; assert.equal(networkCalls, 0, 'stored registry facts never call a provider'); });

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  databases.push(db);
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'capital_calls', 'limited_partners', 'vc_funds']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(read('cloudflare-worker/sql/migrations/312_fund_call_ledger.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/473_fund_management_fees.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/472_entity_bank_accounts.sql'));
  // Build the real dependencies, then apply the whole migration strictly.
  // Any broken table, column or index must fail setup rather than disappear.
  db.exec(read('cloudflare-worker/sql/migrations/474_mercury_entity_connections.sql'));
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'totp-holder', 'totp', datetime('now'))").run(HOLDER);
  return db;
}
const envFor = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

const app = new Hono<any>();
app.route('/', bankAccounts);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});

async function call(env: any, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: HOLDER, role: 'admin', jti: 'totp-holder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = console.warn; console.warn = () => {};
  try {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return {}; } })() as any };
  } finally { console.warn = saved; }
}

const GP = {
  entity_key: 'gp', label: 'Operating', bank_name: 'Column N.A.', bank_address: '1 Letterman Drive, San Francisco, CA 94129',
  beneficiary_name: 'Axal VC GP LLC', beneficiary_address: '16192 Coastal Highway, Lewes, DE 19958',
  account_kind: 'checking', account_number: NUMBER_GP, account_number_confirm: NUMBER_GP, routing_number: '121145433',
  purposes: ['management_fee'],
};

function connect(db: any, id: number, entity: string, status = 'active') {
  // A live connection holds a token (ciphertext, synthetic); a disconnected one holds none.
  db.prepare(`INSERT INTO mercury_entity_connections (id, uid, entity_key, status, credentials_enc, connected_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, `conn${id}`.padEnd(32, '0'), entity, status, status === 'disconnected' ? null : 'v1.synthetic', HOLDER);
}
let n = 0;
function mercury(db: any, connection: number, entity: string, last4: string, cur: number | null, avail: number | null, kind = 'checking') {
  n += 1;
  const uid = n.toString(16).padStart(32, 'a'); // hex, as newUid() makes
  db.prepare(`INSERT INTO mercury_accounts (uid, mercury_account_id, connection_id, entity_key, kind, last_four, current_cents, available_cents, balance_read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-25 09:00:00')`).run(uid, `merc-${n}`, connection, entity, kind, last4, cur, avail);
  return uid;
}
const reads = (db: any) => (db.prepare("SELECT filters_json FROM admin_audit_log WHERE action IN ('bank_accounts_mercury_read', 'bank_accounts_mercury_source_read')").all() as any[]);

test('a registry account carries its Mercury account by entity and last four, after the read\'s audit row', async () => {
  const db = freshDb(); const env = envFor(db);
  assert.equal((await call(env, 'POST', '/', GP)).status, 201);
  connect(db, 1, 'gp');
  connect(db, 2, 'fund');
  const uid = mercury(db, 1, 'gp', '8897', 1250000, 1200000);
  mercury(db, 2, 'fund', '8897', 999, 999); // another entity's account with the same last four is not a match
  const r = await call(env, 'GET', '/');
  assert.equal(r.status, 200, r.text);
  const m = r.body.accounts[0].mercury;
  assert.deepEqual(m, { account_uid: uid, kind: 'checking', connected: true,
    current: { cents: 1250000, reason: null }, available: { cents: 1200000, reason: null }, read_at: '2026-10-25 09:00:00', reason: null });
  const audit = reads(db);
  assert.equal(audit.length, 1, 'the Mercury read writes its audit row');
  assert.deepEqual(JSON.parse(audit[0].filters_json), { source_check: false });
});

test('an unmatched account says so, never 0; a balance Mercury has not given is null with its reason', async () => {
  const db = freshDb(); const env = envFor(db);
  await call(env, 'POST', '/', GP);
  let m = (await call(env, 'GET', '/')).body.accounts[0].mercury;
  assert.equal(m.account_uid, null);
  assert.equal(m.reason, 'unmatched');
  assert.deepEqual(m.current, { cents: null, reason: 'unmatched' }, 'no balance, not a zero');
  assert.equal(m.kind, null);
  assert.equal(m.connected, null);
  connect(db, 1, 'gp');
  mercury(db, 1, 'gp', '1111', 500, 500);
  m = (await call(env, 'GET', '/')).body.accounts[0].mercury;
  assert.equal(m.reason, 'unmatched');
  mercury(db, 1, 'gp', '8897', null, null);
  m = (await call(env, 'GET', '/')).body.accounts[0].mercury;
  assert.notEqual(m.account_uid, null);
  assert.deepEqual(m.current, { cents: null, reason: 'unreadable' });
  assert.deepEqual(m.available, { cents: null, reason: 'unreadable' });
  mercury(db, 1, 'gp', '8897', 10, 10);
  m = (await call(env, 'GET', '/')).body.accounts[0].mercury;
  assert.equal(m.reason, 'ambiguous', 'two Mercury accounts ending alike show neither');
  assert.equal(m.account_uid, null);
  assert.equal(m.kind, null);
  assert.equal(m.connected, null);
  db.exec('DROP TABLE mercury_accounts');
  const failed = await call(env, 'GET', '/');
  assert.equal(failed.status, 200, 'a failed stored-facts block preserves the registry');
  m = failed.body.accounts[0].mercury;
  assert.equal(m.reason, 'unreadable');
  assert.equal(m.kind, null);
  assert.equal(m.connected, null);
});

test('matched kind and connection are stored facts; error/disconnected retain dated cached balances', async () => {
  const db = freshDb(); const env = envFor(db);
  assert.equal((await call(env, 'POST', '/', GP)).status, 201);
  connect(db, 1, 'gp');
  const uid = mercury(db, 1, 'gp', '8897', 0, 250, 'savings');
  for (const [status, connected] of [['active', true], ['error', false], ['disconnected', false]] as const) {
    db.prepare('UPDATE mercury_entity_connections SET status = ?, credentials_enc = ? WHERE id = 1')
      .run(status, status === 'disconnected' ? null : 'v1.synthetic');
    const response = await call(env, 'GET', '/');
    assert.equal(response.status, 200);
    const m = response.body.accounts[0].mercury;
    assert.equal(m.account_uid, uid);
    assert.equal(m.kind, 'savings', 'the kind comes from Mercury, not the registry checking account');
    assert.equal(m.connected, connected, status);
    assert.deepEqual(m.current, { cents: 0, reason: null }, 'a measured zero stays zero');
    assert.deepEqual(m.available, { cents: 250, reason: null });
    assert.equal(m.read_at, '2026-10-25 09:00:00', 'connection changes never imply a fresh bank read');
  }
});

test('when the read cannot be recorded, the existing strict 503 gate returns no accounts or Mercury facts', async () => {
  const db = freshDb(); const env = envFor(db);
  await call(env, 'POST', '/', GP);
  connect(db, 1, 'gp');
  mercury(db, 1, 'gp', '8897', 100, 100);
  db.exec(`CREATE TRIGGER no_mercury_reads BEFORE INSERT ON admin_audit_log WHEN NEW.action = 'bank_accounts_mercury_read'
    BEGIN SELECT RAISE(ABORT, 'audit down'); END`);
  const r = await call(env, 'GET', '/');
  assert.equal(r.status, 503, 'the existing audit gate stays fail-closed');
  assert.equal(r.body.code, 'audit_unavailable');
  assert.equal('accounts' in r.body, false);
  assert.doesNotMatch(r.text, /"cents":100/, 'no Mercury figure without its audit row');
});

test('notice_preview: the resolver\'s masked instructions and warning, its refusal, or why no notice prints the account', async () => {
  const db = freshDb(); const env = envFor(db);
  const gp = (await call(env, 'POST', '/', GP)).body.account.uid;
  const savings = (await call(env, 'POST', '/', { ...GP, label: 'Reserve', account_kind: 'savings', account_number: NUMBER_FUND, account_number_confirm: NUMBER_FUND, purposes: [] })).body.account.uid;
  let r = await call(env, 'GET', '/');
  const p = r.body.accounts.find((a: any) => a.uid === gp).notice_preview;
  assert.ok(Array.isArray(p), 'the merged notice-preview API stays an array');
  assert.equal(p.length, 1);
  assert.equal(p[0].ok, true);
  assert.equal(p[0].instructions.account_masked, '••••8897');
  assert.equal(p[0].warning, PAY_WARNING);
  const reserve = r.body.accounts.find((a: any) => a.uid === savings);
  assert.deepEqual(reserve.notice_preview, []);
  assert.equal(reserve.notice_preview_reason, 'no_notice_purpose');
  assert.ok(!r.text.includes(NUMBER_GP) && !r.text.includes(NUMBER_FUND), 'the preview carries no full number');
  // Two accounts on one purpose (set by hand, as the resolver re-checks): it gives neither, and each preview says why.
  db.prepare("UPDATE entity_bank_accounts SET purposes_json = '[\"management_fee\"]' WHERE uid = ?").run(savings);
  r = await call(env, 'GET', '/');
  for (const uid of [gp, savings]) {
    const q = r.body.accounts.find((a: any) => a.uid === uid).notice_preview;
    assert.equal(q.some((row: any) => row.ok), false, uid);
    assert.equal(q[0].code, 'ambiguous_account', uid);
  }
  db.prepare("UPDATE entity_bank_accounts SET purposes_json = '[]' WHERE uid = ?").run(savings);
  await call(env, 'POST', `/${gp}/retire`, { reason: 'Account closed' });
  r = await call(env, 'GET', '/');
  const retired = r.body.accounts.find((a: any) => a.uid === gp);
  assert.deepEqual(retired.notice_preview, []);
  assert.equal(retired.notice_preview_reason, 'account_retired');
});

test('an add from a Mercury account: refused when the last four differ or the entity is another; stored when they match', async () => {
  const db = freshDb(); const env = envFor(db);
  connect(db, 1, 'gp');
  connect(db, 2, 'fund');
  const gpMercury = mercury(db, 1, 'gp', '8897', 1, 1);
  const otherMercury = mercury(db, 1, 'gp', '1234', 1, 1);
  const fundMercury = mercury(db, 2, 'fund', '8897', 1, 1);
  const count = () => Number((db.prepare('SELECT COUNT(*) n FROM entity_bank_accounts').get() as any).n);
  const wrong = await call(env, 'POST', '/', { ...GP, mercury_account_uid: otherMercury });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.code, 'mercury_last_four_mismatch');
  assert.match(wrong.body.message, /same four digits/);
  assert.ok(!wrong.text.includes(NUMBER_GP), 'the refusal never echoes the number');
  assert.equal((await call(env, 'POST', '/', { ...GP, mercury_account_uid: fundMercury })).body.code, 'mercury_entity_mismatch');
  assert.equal((await call(env, 'POST', '/', { ...GP, mercury_account_uid: 'f'.repeat(32) })).status, 404);
  assert.equal((await call(env, 'POST', '/', { ...GP, mercury_account_uid: 'not-a-uid' })).body.code, 'mercury_account_invalid');
  assert.equal(count(), 0, 'nothing is stored on a refusal');
  const ok = await call(env, 'POST', '/', { ...GP, mercury_account_uid: gpMercury });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(count(), 1);
  assert.ok(reads(db).length >= 4, 'each Mercury lookup wrote its audit row first');
  db.exec(`CREATE TRIGGER no_mercury_reads BEFORE INSERT ON admin_audit_log WHEN NEW.action = 'bank_accounts_mercury_source_read'
    BEGIN SELECT RAISE(ABORT, 'audit down'); END`);
  const down = await call(env, 'POST', '/', { ...GP, label: 'Again', mercury_account_uid: gpMercury });
  assert.equal(down.status, 503);
  assert.equal(down.body.code, 'audit_unavailable');
  assert.equal(count(), 1);
  // An add that names no Mercury account reads no Mercury.
  const before = reads(db).length;
  db.exec('DROP TRIGGER no_mercury_reads');
  await call(env, 'POST', '/', { ...GP, label: 'Plain', purposes: [] });
  assert.equal(reads(db).length, before);
});
