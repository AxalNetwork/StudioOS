/**
 * D713 (#1778) PR B — connecting a member's own Mercury, and every refusal.
 *
 *  - A founder or partner connects a Read Only token. Only GETs reach Mercury,
 *    the token is stored encrypted, and the row keeps the organization's id
 *    and name and whether read-only was reported or confirmed.
 *  - Each refusal keeps its own status and code (decisions 2 and 3) and stores
 *    nothing: a support session, a webhook secret, no token, a token Mercury
 *    rejects, a permission above read-only, an unconfirmed one, an Axal
 *    entity's organization by name, by account id or by last four, and an
 *    unreadable registry.
 *  - `POST /webhook/mercury/:uid` is 404 for a real uid and a made-up one, and
 *    writes no log.
 *  - `GET /status` names the use keys and reads no bank.
 *  - A later read re-checks the token and decision 3, and marks the row `error`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_personal_connect_d713.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntityName } from '../src/integrations/providers/mercury.ts';
import { personalFixture, connected, bank, defaultBank, account, req, count, registered, TOKEN, FOUR_A, ACC_A } from './_mercury_personal_d713.ts';

const connect = (env: any, who: number, extra: Record<string, unknown> = {}, opts = {}) =>
  req(env, who, 'POST', '/api/connectors/connect', { provider_key: 'mercury', api_key: TOKEN, config: { confirm_read_only: true }, ...extra }, opts);
const stored = (db: any) => count(db, "SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury'");

test('a founder and a partner connect a Read Only token: GETs only, the token encrypted, read-only reported or confirmed', async () => {
  const { db, env } = await personalFixture();
  const b = bank({ ...defaultBank(), org: { id: 'org-own', legalBusinessName: 'Own Practice LLC', permissions: ['read-only'] } });
  try {
    const f = await connect(env, 10, { config: {} });
    assert.equal(f.status, 200, f.text);
    const row: any = db.prepare("SELECT * FROM integrations WHERE user_id = 10 AND provider_key = 'mercury'").get();
    assert.equal(row.status, 'active');
    assert.equal(row.external_account_id, 'org-own');
    assert.equal(row.external_account_name, 'Own Practice LLC');
    assert.deepEqual(JSON.parse(row.config_json), { read_only: 'reported' });
    assert.ok(!row.credentials_enc.includes(TOKEN), 'the token is never stored in the clear');
    assert.ok(!f.text.includes(TOKEN));
    const p = await connect(env, 20);
    assert.equal(p.status, 200, p.text);
    assert.deepEqual(JSON.parse((db.prepare('SELECT config_json FROM integrations WHERE user_id = 20').get() as any).config_json), { read_only: 'reported' });
    assert.ok(b.calls.length >= 4);
    for (const c of b.calls) { assert.equal(c.method, 'GET'); assert.equal(c.redirect, 'manual'); assert.equal(c.body, false); }
    assert.deepEqual([...new Set(b.calls.map((c) => c.path))].sort(), ['/accounts', '/organization']);
  } finally { b.restore(); }
});

test('decision 2: each refusal keeps its status and code, and nothing is stored', async () => {
  const { db, env } = await personalFixture();
  const b = bank();
  try {
    const cases: Array<[string, () => Promise<any>, number, string]> = [
      ['support session', () => connect(env, 10, {}, { impersonated: true }), 403, 'support_session_refused'],
      ['webhook secret', () => connect(env, 10, { webhook_secret: 'fixture-secret' }), 400, 'webhook_not_supported'],
      ['no token', () => connect(env, 10, { api_key: '  ' }), 400, 'api_key_required'],
      ['unconfirmed', () => connect(env, 10, { config: {} }), 400, 'confirm_read_only_required'],
    ];
    for (const [label, run, status, code] of cases) {
      const r = await run();
      assert.deepEqual([r.status, r.body?.error], [status, code], `${label}: ${r.text}`);
      assert.ok(r.body.message, `${label} carries our sentence`);
    }
    assert.equal(b.calls.filter((c) => c.path === '/organization').length, 1, 'only the unconfirmed case reached Mercury');
    b.state.org = { id: 'org-own', legalBusinessName: 'Own Practice LLC', scopes: ['read', 'write'] };
    const wide = await connect(env, 10);
    assert.deepEqual([wide.status, wide.body.error], [403, 'write_scope_refused'], 'a confirmation never overrides a reported write scope');
    b.state.status = 401;
    const rejected = await connect(env, 10);
    assert.deepEqual([rejected.status, rejected.body.error], [400, 'token_rejected']);
    assert.equal(stored(db), 0);
    // Investors get no card; an admin keeps #1775's entity console.
    assert.deepEqual([(await connect(env, 30)).status], [404]);
    const admin = await connect(env, 2);
    assert.deepEqual([admin.status, admin.body.error], [409, 'entity_connection_only']);
    assert.equal(stored(db), 0);
  } finally { b.restore(); }
});

test('decision 3: an Axal entity\'s organization is refused by name, account id or active last four; an unreadable registry fails closed', async () => {
  const { db, env } = await personalFixture();
  assert.equal(normalizeEntityName('AXAL VC MANAGEMENT, LLC'), 'axal vc management');
  assert.equal(normalizeEntityName('Axal-VC  Management L.L.C.'), 'axal vc management');
  const b = bank();
  try {
    b.state.org = { id: 'org-x', legalBusinessName: 'AXAL VC MANAGEMENT, LLC' };
    let r = await connect(env, 20);
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_entity_account'], r.text);
    b.state.org = defaultBank().org;
    db.prepare(`INSERT INTO mercury_entity_connections (uid, entity_key, credentials_enc, status, connected_by)
      VALUES ('mec-1', 'management', 'v1.fixture-not-ciphertext', 'active', 1)`).run();
    const conn: any = db.prepare('SELECT id FROM mercury_entity_connections').get();
    db.prepare(`INSERT INTO mercury_accounts (uid, connection_id, entity_key, mercury_account_id, kind, last_four, status)
      VALUES ('ma-1', ?, 'management', ?, 'checking', '8642', 'active')`).run(conn.id, ACC_A);
    r = await connect(env, 20);
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_entity_account'], 'an account id #1775 holds');
    db.exec('DELETE FROM mercury_accounts');
    registered(db, 'management', FOUR_A, 'retired');
    r = await connect(env, 20);
    assert.equal(r.status, 200, `a retired registry row is not a match: ${r.text}`);
    db.exec('DELETE FROM integrations');
    registered(db, 'gp', '1357');
    r = await connect(env, 20);
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_entity_account'], 'an active last four');
    db.exec('DROP TABLE entity_bank_accounts');
    r = await connect(env, 20);
    assert.deepEqual([r.status, r.body.error], [503, 'bank_registry_unavailable']);
    assert.equal(stored(db), 0);
  } finally { b.restore(); }
});

test('POST /webhook/mercury/:uid is 404 for a real uid and a made-up one, and writes no log', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 20);
  let reads = 0;
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => { reads += 1; return prepare(sql); };
  for (const uid of ['mp-20', 'not-a-real-uid']) {
    const r = await req(env, 20, 'POST', `/api/connectors/webhook/mercury/${uid}`, { type: 'transaction.created' });
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'not_found' });
  }
  assert.equal(reads, 0, 'answered before any schema check, row lookup or log');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM integration_logs'), 0);
});

test('GET /status names the use keys for each role, marks partner_deals HQ only, and reads no bank', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 20);
  const b = bank();
  try {
    const p = await req(env, 20, 'GET', '/api/mercury/personal/status');
    assert.equal(p.status, 200, p.text);
    assert.equal(p.body.connected, true);
    assert.deepEqual(p.body.connection, { uid: 'mp-20', status: 'active', account_name: 'Own Practice LLC', read_only: 'confirmed' });
    const avail = (r: any) => Object.fromEntries(r.body.uses.map((u: any) => [u.key, [u.available, u.reason]]));
    assert.deepEqual(avail(p), { venture_revenue: [false, 'purpose_not_allowed'], raise_receipts: [false, 'purpose_not_allowed'], practice_income: [true, null], partner_deals: [true, null] });
    const branch = await req(env, 20, 'GET', '/api/mercury/personal/status', undefined, { branch: true });
    assert.deepEqual(avail(branch).partner_deals, [false, 'hq_only']);
    const f = await req(env, 10, 'GET', '/api/mercury/personal/status');
    assert.deepEqual([f.body.connected, avail(f)], [false, { venture_revenue: [true, null], raise_receipts: [true, null], practice_income: [false, 'purpose_not_allowed'], partner_deals: [false, 'purpose_not_allowed'] }]);
    assert.equal(b.calls.length, 0);
  } finally { b.restore(); }
});

test('a later read re-checks: a revoked token, a write scope or an entity\'s last four marks the row error; a support session reads nothing', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 10);
  const b = bank();
  const read = (opts = {}) => req(env, 10, 'GET', '/api/revenue/projects/1/mercury-credits', undefined, opts);
  const row = () => db.prepare('SELECT status, last_error FROM integrations WHERE user_id = 10').get() as any;
  try {
    let r = await read({ impersonated: true });
    assert.deepEqual([r.status, r.body.error, b.calls.length], [403, 'support_session_refused', 0]);
    r = await read();
    assert.equal(r.status, 200, r.text);
    b.state.status = 401;
    r = await read();
    assert.deepEqual([r.status, r.body.error, row().status, row().last_error], [409, 'mercury_reconnect_required', 'error', 'token_rejected']);
    r = await read();
    assert.deepEqual([r.status, r.body.error], [409, 'mercury_reconnect_required'], 'an errored row is not read again');
    const calls = b.calls.length;
    db.exec("UPDATE integrations SET status = 'active', last_error = NULL");
    b.state.status = undefined;
    b.state.org = { ...defaultBank().org, permission: 'read_write' };
    r = await read();
    assert.deepEqual([r.status, r.body.error, row().last_error], [403, 'write_scope_refused', 'write_scope_refused']);
    assert.ok(b.calls.length > calls);
    db.exec("UPDATE integrations SET status = 'active', last_error = NULL");
    b.state.org = defaultBank().org;
    b.state.accounts = [account(ACC_A, FOUR_A)];
    registered(db, 'fund', FOUR_A);
    r = await read();
    assert.deepEqual([r.status, r.body.error, row().status, row().last_error], [409, 'mercury_entity_account', 'error', 'mercury_entity_account']);
  } finally { b.restore(); }
});
