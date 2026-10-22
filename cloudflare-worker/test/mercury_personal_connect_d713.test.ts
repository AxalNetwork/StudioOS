/**
 * D713 (#1778) PR B — connecting a member's own Mercury, and every refusal.
 *
 *  - D881 (#2554): a token connect is retired. A founder, a partner and an
 *    investor on HQ who post one read `token_connect_retired`; nothing reaches
 *    Mercury and nothing is stored (`mercury_mcp_only_d881.test.ts` holds the
 *    rest of D881). On a branch an investor still reads D752's 403 first.
 *  - The refusals that come before it keep their status and code: a support
 *    session, and an admin's `entity_connection_only`.
 *  - Decision 3, which the sign-in and every read still call: an Axal entity's
 *    organization by name, by account id or by an active last four, and an
 *    unreadable registry, which fails closed.
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
import { LEGACY_TOKEN_NOTICE, TOKEN_CONNECT_RETIRED, entityAccountRefusal, normalizeEntityName } from '../src/integrations/providers/mercury.ts';
import { personalFixture, connected, bank, defaultBank, account, req, count, registered, TOKEN, FOUR_A, ACC_A } from './_mercury_personal_d713.ts';

const connect = (env: any, who: number, extra: Record<string, unknown> = {}, opts = {}) =>
  req(env, who, 'POST', '/api/connectors/connect', { provider_key: 'mercury', api_key: TOKEN, config: { confirm_read_only: true }, ...extra }, opts);
const stored = (db: any) => count(db, "SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury'");

test('D881: a founder, a partner and an investor on HQ who post a token read token_connect_retired; nothing reaches Mercury and nothing is stored', async () => {
  const { db, env } = await personalFixture();
  const b = bank({ ...defaultBank(), org: { id: 'org-own', legalBusinessName: 'Own Practice LLC', permissions: ['read-only'] } });
  try {
    for (const who of [10, 20, 30]) {
      const r = await connect(env, who);
      assert.deepEqual([r.status, r.body.error, r.body.message], [410, 'token_connect_retired', TOKEN_CONNECT_RETIRED], `${who}: ${r.text}`);
      assert.ok(!r.text.includes(TOKEN), 'the token is never echoed');
    }
    // D752: off HQ, an investor reads the HQ-only sentence before the retirement.
    const off = await connect(env, 30, {}, { branch: true });
    assert.deepEqual([off.status, off.body.error, off.body.message], [403, 'purpose_not_allowed', 'Mercury is offered to your profile on HQ only.'], off.text);
    assert.equal(b.calls.length, 0, 'nothing reached Mercury');
    assert.equal(stored(db), 0);
  } finally { b.restore(); }
});

test('the refusals before it keep their status and code: a support session, and an admin (D879)', async () => {
  const { db, env } = await personalFixture();
  const b = bank();
  try {
    const support = await connect(env, 10, {}, { impersonated: true });
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused'], support.text);
    // D879 (#2552): an admin connects nothing here; Axal VC's own accounts are HQ's (#1775's console).
    const admin = await connect(env, 2);
    assert.deepEqual([admin.status, admin.body.error], [403, 'purpose_not_allowed']);
    // Whatever else rides along, a token is not read: no webhook, no confirmation, no token at all.
    for (const extra of [{ webhook_secret: 'fixture-secret' }, { config: {} }, { api_key: '  ' }]) {
      const r = await connect(env, 10, extra);
      assert.deepEqual([r.status, r.body.error], [410, 'token_connect_retired'], JSON.stringify(extra));
    }
    assert.equal(b.calls.length, 0);
    assert.equal(stored(db), 0);
  } finally { b.restore(); }
});

test('decision 3: an Axal entity\'s organization is refused by name, account id or active last four; an unreadable registry fails closed', async () => {
  const { db, env } = await personalFixture();
  assert.equal(normalizeEntityName('AXAL VC MANAGEMENT, LLC'), 'axal vc management');
  assert.equal(normalizeEntityName('Axal-VC  Management L.L.C.'), 'axal vc management');
  const own = { id: 'org-own', legal_name: 'Own Practice LLC' } as any;
  const accounts = [{ mercury_account_id: ACC_A, last_four: FOUR_A, kind: 'checking' }, { mercury_account_id: 'acc-personal-b', last_four: '1357', kind: 'savings' }] as any;
  const code = async (org: any) => (await entityAccountRefusal(env, org, accounts))?.code ?? null;
  assert.equal(await code({ id: 'org-x', legal_name: 'AXAL VC MANAGEMENT, LLC' }), 'mercury_entity_account');
  assert.equal(await code(own), null, 'the member\'s own organization');
  db.prepare(`INSERT INTO mercury_entity_connections (uid, entity_key, credentials_enc, status, connected_by)
    VALUES ('mec-1', 'management', 'v1.fixture-not-ciphertext', 'active', 1)`).run();
  const conn: any = db.prepare('SELECT id FROM mercury_entity_connections').get();
  db.prepare(`INSERT INTO mercury_accounts (uid, connection_id, entity_key, mercury_account_id, kind, last_four, status)
    VALUES ('ma-1', ?, 'management', ?, 'checking', '8642', 'active')`).run(conn.id, ACC_A);
  assert.equal(await code(own), 'mercury_entity_account', 'an account id #1775 holds');
  db.exec('DELETE FROM mercury_accounts');
  registered(db, 'management', FOUR_A, 'retired');
  assert.equal(await code(own), null, 'a retired registry row is not a match');
  registered(db, 'gp', '1357');
  assert.equal(await code(own), 'mercury_entity_account', 'an active last four');
  db.exec('DROP TABLE entity_bank_accounts');
  const down = await entityAccountRefusal(env, own, accounts);
  assert.deepEqual([down?.status, down?.code], [503, 'bank_registry_unavailable']);
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

test('GET /status names the use keys for each role, marks partner_deals and capital_attestation HQ only, and reads no bank', async () => {
  const { db, env } = await personalFixture();
  await connected(db, env, 20);
  const b = bank();
  try {
    const p = await req(env, 20, 'GET', '/api/mercury/personal/status');
    assert.equal(p.status, 200, p.text);
    assert.equal(p.body.connected, true);
    // D881 (#2554): a token row kept from before D881 says how it reads, and asks for the sign-in.
    assert.deepEqual(p.body.connection, { uid: 'mp-20', status: 'active', account_name: 'Own Practice LLC', read_only: 'confirmed', via: 'api_key', notice: LEGACY_TOKEN_NOTICE });
    const avail = (r: any) => Object.fromEntries(r.body.uses.map((u: any) => [u.key, [u.available, u.reason]]));
    assert.deepEqual(avail(p), { venture_revenue: [false, 'purpose_not_allowed'], raise_receipts: [false, 'purpose_not_allowed'], venture_spend: [false, 'purpose_not_allowed'], practice_income: [true, null], partner_deals: [true, null], capital_attestation: [false, 'purpose_not_allowed'] });
    const branch = await req(env, 20, 'GET', '/api/mercury/personal/status', undefined, { branch: true });
    assert.deepEqual(avail(branch).partner_deals, [false, 'hq_only']);
    const f = await req(env, 10, 'GET', '/api/mercury/personal/status');
    assert.deepEqual([f.body.connected, avail(f)], [false, { venture_revenue: [true, null], raise_receipts: [true, null], venture_spend: [true, null], practice_income: [false, 'purpose_not_allowed'], partner_deals: [false, 'purpose_not_allowed'], capital_attestation: [false, 'purpose_not_allowed'] }]);
    // D752 (#1889): spending is the founder's on a branch too.
    const fb = await req(env, 10, 'GET', '/api/mercury/personal/status', undefined, { branch: true });
    assert.deepEqual([avail(fb).venture_revenue, avail(fb).venture_spend], [[true, null], [true, null]]);
    const i = await req(env, 30, 'GET', '/api/mercury/personal/status');
    assert.deepEqual(avail(i), { venture_revenue: [false, 'purpose_not_allowed'], raise_receipts: [false, 'purpose_not_allowed'], venture_spend: [false, 'purpose_not_allowed'], practice_income: [false, 'purpose_not_allowed'], partner_deals: [false, 'purpose_not_allowed'], capital_attestation: [true, null] });
    const ib = await req(env, 30, 'GET', '/api/mercury/personal/status', undefined, { branch: true });
    assert.deepEqual(avail(ib).capital_attestation, [false, 'hq_only']);
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
