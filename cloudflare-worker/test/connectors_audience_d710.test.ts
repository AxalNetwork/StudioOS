/**
 * D710 (#1775) decision 5 — the catalogue knows who may see Mercury.
 *
 * On HQ, `GET /available` lists `mercury` to an admin as a read-only preview
 * of the founder's card (D879, #2552, which removed D710's entity row) and, since D713 (#1778) and D752 (#1886), to a founder, a partner and an
 * investor as their own, personal one, each in their role's words; on a
 * branch, to the founder and the partner only. Every other provider's row is
 * unchanged for every role `ALLOWED_ROLES` admits. `POST /connect` answers an
 * admin on HQ 403 `purpose_not_allowed` (D879), hands a founder or partner (either
 * host) or an investor (HQ) to the personal provider, answers an investor on a
 * branch 403 `purpose_not_allowed` ("on HQ only"), and answers everyone else
 * 404, as if the key did not exist; so do the waitlist and notify-me routes.
 * `logEvent` masks bank numbers and an EIN, and leaves `protein` alone.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/connectors_audience_d710.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations, { logEvent } from '../src/routes/integrations.ts';
import { REGISTRY, publicDescriptor } from '../src/integrations/registry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import '../src/integrations/providers/mercury.ts';
import { mercuryFedModules } from '../src/integrations/mercuryFeeds.ts';

const JWT_SECRET = 'y'.repeat(64); // synthetic fixture key
const ROLES = ['admin', 'founder', 'partner', 'investor', 'advisor', 'operator', 'service_provider'];

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'studio');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, user_id INTEGER, actor TEXT, action TEXT, details TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      display_name TEXT, credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT,
      external_account_id TEXT, external_account_name TEXT, last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, provider_key));
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_waitlist(id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, notes TEXT, notified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider_key));
    INSERT INTO company_profiles VALUES (10);`);
  ROLES.forEach((role, i) => {
    db.prepare('INSERT INTO users(id, role, name, email) VALUES (?, ?, ?, ?)').run(i + 1, role, `User ${i + 1}`, `u${i + 1}@example.test`);
    db.prepare('INSERT INTO user_company_links VALUES (?, 10)').run(i + 1);
  });
  return db;
}

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function call(db: DatabaseSync, role: string, method: string, path: string, body?: unknown, branch = false) {
  const id = ROLES.indexOf(role) + 1;
  const token = await new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', ...(branch ? { BRANCH_CODE: 'ldn' } : {}) } as any;
  const res = await app.request(`/api/connectors${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': '10', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const OTHERS = REGISTRY.filter((p) => p.key !== 'mercury').map((p) => p.key);
const PERSONAL = ['founder', 'partner', 'investor'];
const BRANCH_PERSONAL = ['founder', 'partner'];

test('on HQ, /available lists mercury to an admin as a preview of the founder\'s card (D879) and to a founder, a partner and an investor as their own; every other row is unchanged', async () => {
  const db = fixture();
  for (const role of ROLES) {
    const r = await call(db, role, 'GET', '/available');
    assert.equal(r.status, 200, role);
    const keys = r.body.items.map((p: any) => p.key);
    // D757 §2.11: Zoom is a Validate source, listed only to who can hold a venture.
    assert.deepEqual(keys.filter((k: string) => k !== 'mercury'), OTHERS.filter((k) => k !== 'zoom' || role === 'admin' || role === 'founder'), `${role}: the other providers, in order`);
    assert.equal(keys.includes('mercury'), role === 'admin' || PERSONAL.includes(role), role);
    for (const p of r.body.items.filter((x: any) => x.key !== 'mercury')) {
      const desc = REGISTRY.find((d) => d.key === p.key)!;
      assert.equal(p.connection_source, publicDescriptor(desc).connection_source, `${role} ${p.key}`);
      assert.ok(!('preview_roles' in p) && !('personal_roles' in p), 'the audience fields stay private');
    }
  }
  const admin = (await call(db, 'admin', 'GET', '/available')).body.items.find((p: any) => p.key === 'mercury');
  // D879 (#2552): the admin previews the founder's card, connects nothing, and is told where Axal VC's own accounts live.
  assert.deepEqual([admin.connection_source, admin.already_connected, admin.category, admin.has_implementation, admin.status, admin.auth_type, admin.preview],
    ['integrations', false, 'Accounting and banking', false, 'beta', 'api_key', true]);
  assert.deepEqual(admin.hq_accounts, { line: 'Axal VC’s own accounts are managed in HQ › Fund administration › Bank accounts.', href: '/admin?tab=bank-accounts' });
  assert.deepEqual(admin.feeds, mercuryFedModules('founder'));
  assert.ok(!/Axal entity/.test(JSON.stringify(admin)), 'nothing about Axal VC\'s entity accounts');
  assert.ok(!('preview_roles' in admin) && !('personal_roles' in admin) && !('personal_hq_only_roles' in admin));
  for (const role of PERSONAL) {
    const own = (await call(db, role, 'GET', '/available')).body.items.find((p: any) => p.key === 'mercury');
    assert.deepEqual([own.connection_source, own.has_implementation, own.status, own.auth_type], ['integrations', true, 'beta', 'api_key'], role);
    assert.deepEqual(own.capabilities, role === 'investor' ? ['Proof of funds', 'Capacity', 'Closing, calls, accounting and reporting proposals'] /* D840 part 4 */ : role === 'founder' ? ['Revenue import', 'Payment matching', 'Spending and runway'] : ['Revenue import', 'Payment matching'], role);
    assert.equal(own.permissions.length, 1, role);
    assert.match(own.permissions[0], /never sends, transfers or requests money/);
    // D840: a role's feeds are `MERCURY_FEEDS`' modules for it (D713's revenue, then part 2's Raise modules; part 4's investor sections).
    assert.deepEqual(own.feeds, role === 'founder' || role === 'investor' ? mercuryFedModules(role) : []);
    if (role === 'founder') assert.equal(own.feeds[0], 'revenue_and_traction');
    if (role === 'investor') assert.deepEqual(own.feeds, ['deals_commit', 'deals_closing', 'fund_calls', 'fund_ledger', 'fund_reporting']);
    if (role === 'investor') {
      assert.match(own.description, /^Your own Mercury account, read-only: show Axal's admins/);
      // D840 part 4: the investor's capacity is their own balance, shown to them alone; D752's admins still see none.
      assert.match(own.permissions[0], /only you see a balance/);
      assert.match(own.description, /Axal's admins never see your balance\./);
    } else if (role === 'founder') {
      assert.match(own.description, /venture revenue, and see each month's spending, burn, cash on hand and runway/);
    } else {
      assert.match(own.description, /venture revenue \(founders\)/, role);
    }
    assert.ok(!/Axal entity accounts/.test(own.description), 'the personal card never describes the entity console');
    assert.ok(!('preview_roles' in own) && !('personal_roles' in own) && !('personal_hq_only_roles' in own));
    assert.ok(!('preview' in own) && !('hq_accounts' in own), 'a member reads no preview note');
  }
});

test('on a branch, only a founder and a partner see mercury, as their own; the admin\'s preview and the investor\'s stay HQ only', async () => {
  const db = fixture();
  for (const role of ROLES) {
    const r = await call(db, role, 'GET', '/available', undefined, true);
    assert.equal(r.status, 200);
    const row = r.body.items.find((p: any) => p.key === 'mercury');
    assert.equal(!!row, BRANCH_PERSONAL.includes(role), role);
    if (row) assert.equal(row.connection_source, 'integrations', role);
  }
});

test('connect: an admin on HQ is 403 purpose_not_allowed (D879); a founder or partner reaches the personal provider on either host and an investor on HQ; an investor on a branch is 403 on HQ only; everyone else, and their waitlist and notify-me, is 404', async () => {
  const db = fixture();
  const admin = await call(db, 'admin', 'POST', '/connect', { provider_key: 'mercury', api_key: 'fixture-not-a-token-1' });
  assert.deepEqual([admin.status, admin.body.error, admin.body.message], [403, 'purpose_not_allowed', 'Your role does not hold a personal Mercury connection.']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury'").get()!.n, 0);
  // The personal provider is reached, and refuses a token connect before anything reaches Mercury (D881).
  for (const role of PERSONAL) {
    for (const branch of role === 'investor' ? [false] : [false, true]) {
      const r = await call(db, role, 'POST', '/connect', { provider_key: 'mercury' }, branch);
      assert.deepEqual([r.status, r.body.error], [410, 'token_connect_retired'], `${role} branch=${branch}`);
    }
    assert.equal((await call(db, role, 'GET', '/mercury')).status, 200, `${role} GET /:key`);
  }
  // D752: an investor on a branch learns why at connect; its other routes stay 404.
  const off = await call(db, 'investor', 'POST', '/connect', { provider_key: 'mercury', api_key: 'fixture-not-a-token-1' }, true);
  assert.deepEqual([off.status, off.body.error, off.body.message], [403, 'purpose_not_allowed', 'Mercury is offered to your profile on HQ only.']);
  assert.equal((await call(db, 'investor', 'GET', '/mercury', undefined, true)).status, 404, 'investor branch GET /:key');
  assert.equal((await call(db, 'investor', 'POST', '/waitlist', { provider_key: 'mercury' }, true)).status, 404, 'investor branch waitlist');
  assert.equal((await call(db, 'investor', 'POST', '/notify-me', { provider_key: 'mercury' }, true)).status, 404, 'investor branch notify-me');
  assert.equal((await call(db, 'investor', 'POST', '/mercury/notify-me', {}, true)).status, 404, 'investor branch /:provider/notify-me');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury'").get()!.n, 0);
  for (const role of ROLES.filter((r) => r !== 'admin' && !PERSONAL.includes(r))) {
    const r = await call(db, role, 'POST', '/connect', { provider_key: 'mercury', api_key: 'fixture-not-a-token-1' });
    assert.deepEqual([r.status, r.body.error], [404, 'unknown_provider'], role);
    assert.equal((await call(db, role, 'GET', '/mercury')).status, 404, `${role} GET /:key`);
    assert.equal((await call(db, role, 'POST', '/waitlist', { provider_key: 'mercury' })).status, 404, `${role} waitlist`);
    assert.equal((await call(db, role, 'POST', '/notify-me', { provider_key: 'mercury' })).status, 404, `${role} notify-me`);
    assert.equal((await call(db, role, 'POST', '/mercury/notify-me', {})).status, 404, `${role} /:provider/notify-me`);
  }
  const branchAdmin = await call(db, 'admin', 'POST', '/connect', { provider_key: 'mercury' }, true);
  assert.deepEqual([branchAdmin.status, branchAdmin.body.error], [404, 'unknown_provider']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integration_waitlist WHERE provider_key = 'mercury'").get()!.n, 0);
  // Another provider's waitlist still works for a founder.
  assert.equal((await call(db, 'founder', 'POST', '/waitlist', { provider_key: 'carta' })).status, 200);
});

test('logEvent masks account and routing numbers, a tax id and an EIN, and leaves protein alone', async () => {
  const db = fixture();
  await logEvent({ DB: d1Over(db) } as any, {
    integration_id: 1, user_id: 1, provider_key: 'mercury', direction: 'inbound', event_type: 'probe', status: 'ok',
    payload: { accountNumber: '908172631111', routing_number: '000000017', tax_id: '98-7654321', ein: '98-7654321', org_ein: '98-7654321', protein: 'kept', amount: 10 },
  });
  const stored = JSON.parse((db.prepare('SELECT payload_json FROM integration_logs').get() as any).payload_json);
  assert.deepEqual(stored, { accountNumber: '[redacted]', routing_number: '[redacted]', tax_id: '[redacted]', ein: '[redacted]', org_ein: '[redacted]', protein: 'kept', amount: 10 });
});
