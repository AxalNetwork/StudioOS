/**
 * D710 (#1775) — the entity connections: who may read and write them, the
 * cipher, the registry check, disconnect and the fail-closed read audit.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_entity_connections_d710.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptColumn } from '../src/services/columnCipher.ts';
import {
  ADMIN, ADVISOR, EXPLORING, FOUNDER, FUND_ADMIN, INVESTOR, JTI, JWT_SECRET, PARTNER, SUPER, TOKEN, TOKEN_2,
  account, appFor, call, envFor, freshDb, mercuryStub, one, rows, settled, withRegistry,
} from './_mercury_fixture.ts';

const GP_ACCOUNTS = [account('acc-gp-chk', 'checking', '1111'), account('acc-gp-sav', 'savings', '2222'), account('acc-gp-card', 'creditCard', '3333')];
const REGISTRY: Array<[string, string, string]> = [['gp', 'checking', '1111'], ['gp', 'savings', '2222'], ['holdings', 'checking', '4444']];

function setup(opts: { registry?: boolean; accounts?: any[]; org?: any } = {}) {
  const db = freshDb();
  if (opts.registry !== false) withRegistry(db, REGISTRY);
  const stub = mercuryStub({ accounts: opts.accounts ?? GP_ACCOUNTS, org: opts.org ?? { id: 'org-1', legalBusinessName: 'Axal VC GP LLC', ein: '12-3456789' }, txns: {} });
  const app = appFor({ fetcher: stub.fetcher });
  return { db, stub, app, env: envFor(db) };
}
async function connect(s: ReturnType<typeof setup>, token = TOKEN, jti = JTI.superFresh, entity = 'gp') {
  const r = await call(s.app, s.env, 'PUT', `/connections/${entity}`, SUPER, { jti, body: { api_token: token, confirm_read_only: true } });
  await settled(s.db);
  return r;
}

test('reads: a plain Admin reads the connections with one audit row and no token preview; every other caller is refused', async () => {
  const s = setup();
  assert.equal((await connect(s)).status, 200);
  const before = rows(s.db, "SELECT * FROM admin_audit_log WHERE action = 'mercury_connections_read'").length;
  const r = await call(s.app, s.env, 'GET', '/connections', ADMIN, { jti: JTI.adminTotp });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.entities.map((e: any) => e.entity_key), ['holdings', 'management', 'gp', 'fund']);
  const gp = r.body.entities.find((e: any) => e.entity_key === 'gp').connection;
  assert.equal(gp.status, 'active');
  assert.ok(!('token_preview' in gp), 'D223: no preview on a read every admin makes');
  assert.doesNotMatch(r.text, /oken-1|••••/);
  assert.equal(rows(s.db, "SELECT * FROM admin_audit_log WHERE action = 'mercury_connections_read'").length, before + 1);
  // The Super Admin's own read carries the preview, and only the preview.
  const own = await call(s.app, s.env, 'GET', '/connections', SUPER, { jti: JTI.superFresh });
  assert.equal(own.body.entities.find((e: any) => e.entity_key === 'gp').connection.token_preview, '••••en-1');
  assert.ok(!own.text.includes(TOKEN));
  for (const who of [FOUNDER, PARTNER, INVESTOR, ADVISOR, EXPLORING, FUND_ADMIN]) {
    assert.equal((await call(s.app, s.env, 'GET', '/connections', who)).status, 403, `user ${who}`);
  }
  const branch = await call(s.app, envFor(s.db, { BRANCH_CODE: 'ldn' }), 'GET', '/connections', ADMIN, { jti: JTI.adminTotp });
  assert.deepEqual([branch.status, branch.body.code], [403, 'hq_only']);
  const support = await call(s.app, s.env, 'GET', '/connections', ADMIN, { jti: JTI.adminTotp, impersonated: true });
  assert.deepEqual([support.status, support.body.code], [403, 'support_session_refused']);
});

test('the write bar: the Super Admin without a fresh step-up is refused; with one, the connect stores the entity', async () => {
  const s = setup();
  const stale = await connect(s, TOKEN, JTI.superStale);
  assert.deepEqual([stale.status, stale.body.code], [403, 'step_up_required']);
  assert.equal(rows(s.db, 'SELECT * FROM mercury_entity_connections').length, 0);
  assert.equal(s.stub.calls.length, 0, 'nothing reached Mercury');
  const ok = await connect(s);
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.body.entity_key, ok.body.replaced, ok.body.accounts, ok.body.registered, ok.body.skipped_kinds], ['gp', false, 2, 2, 1]);
  assert.equal(one(s.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'mercury_connected'").n, 1);
  // Without the read-only confirmation, nothing is read or stored.
  const t = setup();
  const unconfirmed = await call(t.app, t.env, 'PUT', '/connections/gp', SUPER, { jti: JTI.superFresh, body: { api_token: TOKEN } });
  assert.deepEqual([unconfirmed.status, unconfirmed.body.code, t.stub.calls.length], [400, 'confirm_read_only_required', 0]);
});

for (const act of ['connect', 'replace', 'disconnect'] as const) {
  test(`a plain Admin's ${act} is refused super_admin_required, never a step-up demand, and writes nothing`, async () => {
    const s = setup();
    if (act !== 'connect') assert.equal((await connect(s)).status, 200);
    const callsBefore = s.stub.calls.length;
    const conn = () => JSON.stringify(rows(s.db, 'SELECT * FROM mercury_entity_connections'));
    const audits = () => rows(s.db, "SELECT * FROM admin_audit_log WHERE action LIKE 'mercury_%' AND action NOT LIKE '%_read'").length;
    const before = [conn(), audits()];
    for (const jti of [JTI.adminTotp, JTI.adminSms]) {
      const r = act === 'disconnect'
        ? await call(s.app, s.env, 'DELETE', '/connections/gp', ADMIN, { jti, body: { reason: 'Leaving the platform for good' } })
        : await call(s.app, s.env, 'PUT', '/connections/gp', ADMIN, { jti, body: { api_token: TOKEN_2, confirm_read_only: true } });
      assert.deepEqual([r.status, r.body.code, r.body.detail], [403, 'super_admin_required', 'Super admin required'], jti);
      assert.doesNotMatch(r.text, /step_up|TOTP/);
    }
    assert.deepEqual([conn(), audits()], before, 'no row, token, status or audit changed');
    assert.equal(s.stub.calls.length, callsBefore, 'no Mercury call');
  });
}

test('the cipher: the token is v1. ciphertext that opens under this table\'s AAD only; no response carries it', async () => {
  const s = setup();
  const r = await connect(s);
  const row = one(s.db, 'SELECT * FROM mercury_entity_connections');
  assert.match(row.credentials_enc, /^v1\./);
  assert.ok(!row.credentials_enc.includes(TOKEN));
  const env = envFor(s.db);
  assert.equal(await decryptColumn(env, 'mercury_entity_connections', 'credentials_enc', row.uid, row.credentials_enc), TOKEN);
  assert.equal(await decryptColumn(env, 'integrations', 'credentials_enc', row.uid, row.credentials_enc), null, 'not under integrations\' AAD');
  assert.ok(!r.text.includes(TOKEN));
  // A replace keeps the row and its uid.
  const again = await connect(s, TOKEN_2);
  assert.deepEqual([again.status, again.body.replaced], [200, true]);
  const after = one(s.db, 'SELECT * FROM mercury_entity_connections');
  assert.equal(after.uid, row.uid);
  assert.equal(await decryptColumn(env, 'mercury_entity_connections', 'credentials_enc', after.uid, after.credentials_enc), TOKEN_2);
  assert.equal(one(s.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'mercury_token_replaced'").n, 1);
  assert.equal(JWT_SECRET.length > 0, true);
});

test('the registry check: a mismatch or another entity\'s account is 409 and stores nothing; a different name is only a flag', async () => {
  const none = setup({ accounts: [account('acc-x', 'checking', '7777')] });
  const r1 = await connect(none);
  assert.deepEqual([r1.status, r1.body.code], [409, 'mercury_entity_mismatch']);
  assert.equal(rows(none.db, 'SELECT * FROM mercury_entity_connections').length, 0);
  const other = setup({ accounts: [account('acc-gp-chk', 'checking', '1111'), account('acc-h', 'checking', '4444')] });
  const r2 = await connect(other);
  assert.deepEqual([r2.status, r2.body.code], [409, 'mercury_entity_mismatch'], 'Holdings\' registered account under the GP\'s token');
  assert.equal(rows(other.db, 'SELECT * FROM mercury_accounts').length, 0);
  // An account already stored for another entity.
  const taken = setup();
  withRegistry(taken.db, [['holdings', 'checking', '1111']]);
  taken.db.exec("INSERT INTO mercury_entity_connections (uid, entity_key, status, credentials_enc, connected_by) VALUES ('c-h', 'holdings', 'active', 'v1.x', 901)");
  taken.db.exec("INSERT INTO mercury_accounts (uid, mercury_account_id, connection_id, entity_key, kind, last_four) VALUES ('a-h', 'acc-gp-chk', 1, 'holdings', 'checking', '1111')");
  taken.db.exec("UPDATE entity_bank_accounts SET status = 'retired', retired_at = datetime('now'), retired_reason = 'Fixture retirement' WHERE entity_key = 'holdings' AND account_last4 = '1111'");
  const r3 = await connect(taken);
  assert.deepEqual([r3.status, r3.body.code], [409, 'mercury_account_taken']);
  // A different organization name: 200, flagged.
  const named = setup({ org: { id: 'org-2', legalBusinessName: 'Some Other LLC' } });
  const r4 = await connect(named);
  assert.deepEqual([r4.status, r4.body.org_name_differs], [200, true]);
  // An unregistered account of the token is stored with registered = 0.
  const extra = setup({ accounts: [...GP_ACCOUNTS, account('acc-gp-new', 'checking', '5555')] });
  assert.equal((await connect(extra)).status, 200);
  assert.deepEqual(rows(extra.db, 'SELECT mercury_account_id, registered FROM mercury_accounts ORDER BY mercury_account_id').map((a) => [a.mercury_account_id, a.registered]),
    [['acc-gp-chk', 1], ['acc-gp-new', 0], ['acc-gp-sav', 1]]);
});

test('with no account in #1773\'s registry, a connect answers 409 and stores nothing; an unknown entity is 404', async () => {
  const s = setup({ registry: false });
  const r = await connect(s);
  assert.deepEqual([r.status, r.body.code], [409, 'mercury_entity_mismatch']);
  assert.equal(rows(s.db, 'SELECT * FROM mercury_entity_connections').length, 0);
  assert.equal(rows(s.db, 'SELECT * FROM mercury_accounts').length, 0);
  const t = setup();
  assert.equal((await connect(t, TOKEN, JTI.superFresh, 'treasury')).status, 404);
});

test('disconnect needs a reason, erases the token, keeps the lines, and a reconnect moves the entity\'s accounts', async () => {
  const s = setup();
  assert.equal((await connect(s)).status, 200);
  s.db.exec("INSERT INTO mercury_transactions (uid, mercury_transaction_id, account_id, amount_cents, created_on) VALUES ('t1', 'tx-1', 1, 500, '2026-10-01')");
  const bare = await call(s.app, s.env, 'DELETE', '/connections/gp', SUPER, { jti: JTI.superFresh, body: {} });
  assert.deepEqual([bare.status, bare.body.code], [400, 'reason_required']);
  const ok = await call(s.app, s.env, 'DELETE', '/connections/gp', SUPER, { jti: JTI.superFresh, body: { reason: 'Token rotated in Mercury' } });
  assert.equal(ok.status, 200);
  const old = one(s.db, 'SELECT * FROM mercury_entity_connections');
  assert.deepEqual([old.status, old.credentials_enc], ['disconnected', null]);
  assert.equal(rows(s.db, 'SELECT * FROM mercury_transactions').length, 1, 'transactions are kept');
  assert.equal(one(s.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'mercury_disconnected'").n, 1);
  assert.equal((await connect(s)).status, 200);
  const live = one(s.db, "SELECT id FROM mercury_entity_connections WHERE status = 'active'");
  assert.notEqual(live.id, old.id, 'a new row');
  assert.deepEqual([...new Set(rows(s.db, 'SELECT connection_id FROM mercury_accounts').map((a) => a.connection_id))], [live.id]);
});

test('the read audit fails closed: a read whose audit row cannot be written answers 503 with no rows', async () => {
  const s = setup();
  assert.equal((await connect(s)).status, 200);
  s.db.exec(`CREATE TRIGGER block_mercury_audit BEFORE INSERT ON admin_audit_log WHEN NEW.action LIKE 'mercury_%_read'
             BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);
  for (const path of ['/connections', '/accounts', '/transactions', '/matches']) {
    const r = await call(s.app, s.env, 'GET', path, ADMIN, { jti: JTI.adminTotp });
    assert.deepEqual([r.status, r.body.code], [503, 'audit_unavailable'], path);
    assert.ok(!('items' in r.body) && !('entities' in r.body), path);
  }
});
