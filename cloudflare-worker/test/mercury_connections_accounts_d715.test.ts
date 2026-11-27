/**
 * D715 (#1780) decision 4 — `GET /api/admin/mercury/connections` carries each
 * connection's accounts by ending (kind, last four, nickname, registered),
 * under the one audit row the read already writes, with no balance and no
 * Mercury account id. Built on #1775's fixture (312, 472, 473, 474).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_connections_accounts_d715.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN, JTI, SUPER, TOKEN, account, appFor, call, envFor, freshDb, mercuryStub, rows, settled, withRegistry,
} from './_mercury_fixture.ts';

// Invented endings. 5555 is not in the registry, so it is stored unregistered.
const GP_ACCOUNTS = [
  account('acc-gp-chk', 'checking', '1111'), account('acc-gp-sav', 'savings', '2222'),
  account('acc-gp-extra', 'checking', '5555'), account('acc-gp-card', 'creditCard', '3333'),
];

async function connected() {
  const db = freshDb();
  withRegistry(db, [['gp', 'checking', '1111'], ['gp', 'savings', '2222']]);
  const stub = mercuryStub({ accounts: GP_ACCOUNTS, org: { id: 'org-1', legalBusinessName: 'Axal VC GP LLC', ein: '12-3456789' }, txns: {} });
  const app = appFor({ fetcher: stub.fetcher });
  const env = envFor(db);
  const r = await call(app, env, 'PUT', '/connections/gp', SUPER, { jti: JTI.superFresh, body: { api_token: TOKEN, confirm_read_only: true } });
  await settled(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // A balance the sync would have read: the connections read must never carry it.
  db.exec("UPDATE mercury_accounts SET current_cents = 987654321, available_cents = 123456789, balance_read_at = '2026-10-17 09:00:00'");
  return { db, app, env };
}

const audits = (db: any) => rows(db, "SELECT * FROM admin_audit_log WHERE action = 'mercury_connections_read'").length;

test('each connection carries its accounts by kind, last four, nickname and registered — and an unconnected entity stays null', async () => {
  const s = await connected();
  const r = await call(s.app, s.env, 'GET', '/connections', ADMIN, { jti: JTI.adminTotp });
  assert.equal(r.status, 200);
  const byKey = Object.fromEntries(r.body.entities.map((e: any) => [e.entity_key, e.connection]));
  assert.deepEqual(byKey.gp.accounts, [
    { kind: 'checking', last_four: '1111', nickname: 'checking 1111', registered: true },
    { kind: 'checking', last_four: '5555', nickname: 'checking 5555', registered: false },
    { kind: 'savings', last_four: '2222', nickname: 'savings 2222', registered: true },
  ]);
  for (const k of ['holdings', 'management', 'fund']) assert.equal(byKey[k], null, k);
});

test('no balance, no Mercury account id and no account number reaches the response', async () => {
  const s = await connected();
  for (const [who, jti] of [[ADMIN, JTI.adminTotp], [SUPER, JTI.superFresh]] as const) {
    const r = await call(s.app, s.env, 'GET', '/connections', who, { jti });
    for (const leak of ['987654321', '123456789', 'current_cents', 'available_cents', 'balance', 'acc-gp-', 'mercury_account_id', '908172631111']) {
      assert.ok(!r.text.includes(leak), `user ${who}: the read carries ${leak}`);
    }
  }
});

test('the read still writes exactly one audit row, and a plain Admin still gets no token preview', async () => {
  const s = await connected();
  const before = audits(s.db);
  const r = await call(s.app, s.env, 'GET', '/connections', ADMIN, { jti: JTI.adminTotp });
  assert.equal(audits(s.db), before + 1);
  const gp = r.body.entities.find((e: any) => e.entity_key === 'gp').connection;
  assert.ok(!('token_preview' in gp));
  assert.doesNotMatch(r.text, /••••/);
  const own = await call(s.app, s.env, 'GET', '/connections', SUPER, { jti: JTI.superFresh });
  assert.equal(audits(s.db), before + 2);
  assert.match(own.body.entities.find((e: any) => e.entity_key === 'gp').connection.token_preview, /^••••/);
});
