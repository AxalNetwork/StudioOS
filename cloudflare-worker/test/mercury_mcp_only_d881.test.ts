/**
 * D881 (#2554) — members connect Mercury only by Sign in with Mercury.
 *
 *  - A new token connect is refused, `token_connect_retired`, in the
 *    Worker's sentence: nothing reaches Mercury and nothing is stored.
 *  - A replace of a stored token is refused the same way, and the stored row
 *    is left exactly as it was.
 *  - A token row kept from before D881 keeps reading through the GET-only
 *    client (the venture revenue import and spending), and `/status` says how
 *    it reads and asks for the sign-in. D840's sign-in-only feeds stay
 *    sign-in only, as they were.
 *  - The member page signs in only: kind `mcp`, no token help, no token line.
 *  - HQ's entity token connect (`/api/admin/mercury`) is unchanged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_mcp_only_d881.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_TOKEN_NOTICE, TOKEN_CONNECT_RETIRED } from '../src/integrations/providers/mercury.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { personalFixture, connected, bank, req, count, TOKEN } from './_mercury_personal_d713.ts';
import { JTI, SUPER, appFor, call, envFor, freshDb, mercuryStub, one, settled, withRegistry, account } from './_mercury_fixture.ts';

const connect = (env: any, who: number, extra: Record<string, unknown> = {}) =>
  req(env, who, 'POST', '/api/connectors/connect', { provider_key: 'mercury', api_key: TOKEN, config: { confirm_read_only: true }, ...extra });
const stored = (db: any) => count(db, "SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury'");
const rowOf = (db: any, user: number) => db.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key = 'mercury'").get(user) as any;

test('a new token connect is refused in the Worker\'s sentence; nothing reaches Mercury and nothing is stored', async () => {
  const { db, env } = await personalFixture();
  const b = bank();
  try {
    for (const who of [10, 20, 30]) {
      const r = await connect(env, who);
      assert.deepEqual([r.status, r.body.error, r.body.message], [410, 'token_connect_retired', 'Connect Mercury with Sign in with Mercury.'], `${who}: ${r.text}`);
      assert.ok(!r.text.includes(TOKEN));
    }
    assert.equal(TOKEN_CONNECT_RETIRED, 'Connect Mercury with Sign in with Mercury.');
    assert.equal(b.calls.length, 0, 'no token was read');
    assert.equal(stored(db), 0);
  } finally { b.restore(); }
});

test('a replace of a stored token is refused the same way, and the stored row is left as it was', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 10);
  const before = rowOf(db, 10);
  const b = bank();
  try {
    const r = await connect(env, 10, { api_key: 'fixture-not-a-token-other' });
    assert.deepEqual([r.status, r.body.error], [410, 'token_connect_retired'], r.text);
    assert.deepEqual(rowOf(db, 10), before, 'uid, credentials, auth type, status and dates unchanged');
    assert.equal(b.calls.length, 0);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM integration_logs WHERE event_type IN ('connect', 'reconnect')"), 0, 'no connect or reconnect is logged');
  } finally { b.restore(); }
});

test('a token row kept from before D881 keeps reading, and /status asks for the sign-in', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 10);
  const b = bank();
  try {
    const credits = await req(env, 10, 'GET', '/api/revenue/projects/1/mercury-credits');
    assert.equal(credits.status, 200, credits.text);
    const spend = await req(env, 10, 'GET', '/api/revenue/projects/1/mercury-spend');
    assert.equal(spend.status, 200, spend.text);
    assert.ok(b.calls.length >= 2, 'read through the GET-only client');
    for (const c of b.calls) assert.equal(c.method, 'GET');
    assert.equal(rowOf(db, 10).status, 'active');
    const s = await req(env, 10, 'GET', '/api/mercury/personal/status');
    assert.deepEqual([s.body.connection.via, s.body.connection.notice], ['api_key', LEGACY_TOKEN_NOTICE]);
    assert.equal(LEGACY_TOKEN_NOTICE, 'Connected with an API token. Sign in with Mercury to keep it connected after you reconnect.');
    // A sign-in carries no notice.
    db.exec("UPDATE integrations SET auth_type = 'oauth_mcp' WHERE user_id = 10");
    const signed = await req(env, 10, 'GET', '/api/mercury/personal/status');
    assert.deepEqual([signed.body.connection.via, signed.body.connection.notice], ['oauth_mcp', null]);
  } finally { b.restore(); }
});

test('the member page signs in only: kind mcp, no token help, no token line; the entity page is untouched', async () => {
  for (const role of ['founder', 'partner', 'investor']) {
    const page = (CONNECTOR_PAGES as any).mercury.personal[role];
    assert.deepEqual(page.sign_in, { kind: 'mcp', label: 'Sign in with Mercury', key_help_href: null }, role);
    assert.ok(!page.long_description.some((l: string) => /API token/.test(l)), role);
    assert.ok(page.long_description.some((l: string) => /^Sign in with Mercury: /.test(l)), `${role}: MERCURY_SIGN_IN stays`);
  }
  const { db, env } = await personalFixture();
  const r = await req(env, 10, 'GET', '/api/connectors/directory/mercury');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.connector.sign_in, { kind: 'mcp', label: 'Sign in with Mercury', key_help_href: null });
  void db;
});

test('HQ\'s entity token connect is unchanged: the Super Admin still connects an entity with a Read Only token', async () => {
  const db = freshDb();
  withRegistry(db, [['gp', 'checking', '1111'], ['gp', 'savings', '2222']]);
  const stub = mercuryStub({ accounts: [account('acc-gp-chk', 'checking', '1111'), account('acc-gp-sav', 'savings', '2222')], org: { id: 'org-1', legalBusinessName: 'Axal VC GP LLC' }, txns: {} });
  const app = appFor({ fetcher: stub.fetcher });
  const env = envFor(db);
  const ok = await call(app, env, 'PUT', '/connections/gp', SUPER, { jti: JTI.superFresh, body: { api_token: 'fixture-not-a-token-gp', confirm_read_only: true } });
  await settled(db);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.entity_key, 'gp');
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM mercury_entity_connections WHERE entity_key = 'gp' AND status = 'active'").n, 1);
});
