/**
 * D753 W2 (#1878) — the page fields on every `/available` item, the Discover
 * order and LinkedIn's card on the answer, and `GET /directory/:key`: one
 * connector's page, descriptive only.
 *
 * No provider is called: `globalThis.fetch` throws. Routes run on a real
 * `node:sqlite` database through `d1Over`, signed in with a fixture JWT, as
 * connectors_audience_d710.test.ts does. Each case names the mutation it was
 * checked against.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/connector_directory_d753.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import * as registry from '../src/integrations/registry.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { writesProjectData } from '../src/integrations/companyScope.ts';
import { d1Over } from './_d1_sqlite.mjs';
import '../src/integrations/providers/affinity.ts';
import '../src/integrations/providers/calendly.ts';
import '../src/integrations/providers/carta.ts';
import '../src/integrations/providers/crunchbase.ts';
import '../src/integrations/providers/docusign.ts';
import '../src/integrations/providers/github.ts';
import '../src/integrations/providers/hubspot.ts';
import '../src/integrations/providers/mercury.ts';
import '../src/integrations/providers/salesforce.ts';
import '../src/integrations/providers/slack.ts';
import '../src/integrations/providers/stripe.ts';

const {
  REGISTRY, CATEGORY_ORDER, FIRST_PARTY_CARDS, FIRST_PARTY_PAGES, PERSONAL_MERCURY,
  audienceFor, connectorPagePath, directoryKeyFor, getDescriptor, publicDescriptor,
} = registry as any;

const JWT_SECRET = 'y'.repeat(64); // synthetic fixture key
const ROLES = ['admin', 'founder', 'partner', 'investor', 'advisor', 'operator', 'service_provider', 'exploring'];
const ALLOWED = ROLES.filter((r) => r !== 'exploring');
const SIGN_IN = ['oauth', 'oauth_or_key', 'key', 'first_party', 'entity'];
const PAGE_FIELDS = ['tagline', 'made_by', 'service', 'sign_in', 'added', 'verified', 'verified_on', 'read_only', 'page_key', 'page_href'];
const BODY_FIELDS = ['long_description', 'tools', 'prompts', 'links', 'endpoints', 'trust', 'calls'];
const PRIVATE = ['calls', 'already_connected', 'connection', 'uid', 'api_key_preview', 'credentials', 'entity_roles', 'personal_roles', 'personal_hq_only_roles', 'oauth_scopes', 'unreadable_sources'];
const CONNECTION_STORES = /\b(integrations|integration_waitlist|google_oauth_tokens|microsoft_oauth_tokens|mercury_entity_connections)\b|linkedin_/;

globalThis.fetch = (async () => { throw new Error('no provider may be called'); }) as any;

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
    CREATE TABLE google_oauth_tokens(user_id INTEGER); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER);
    INSERT INTO company_profiles VALUES (10);`);
  ROLES.forEach((role, i) => {
    db.prepare('INSERT INTO users(id, role, name, email) VALUES (?, ?, ?, ?)').run(i + 1, role, `User ${i + 1}`, `u${i + 1}@example.test`);
    db.prepare('INSERT INTO user_company_links VALUES (?, 10)').run(i + 1);
  });
  return db;
}

const app = new Hono<any>();
app.route('/api/connectors', integrations);
app.route('/api/integrations', integrations);
app.onError((e: any, c) => {
  const st = AUTH_ERROR_STATUSES[e?.message ?? ''];
  return st ? c.json({ detail: e.message }, st) : c.json({ error: e.message }, 500);
});

type Opts = { branch?: boolean; company?: boolean; token?: boolean; mount?: string; sql?: string[] };
async function call(db: DatabaseSync, role: string, path: string, o: Opts = {}) {
  const id = ROLES.indexOf(role) + 1;
  const token = await new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const base = d1Over(db);
  const DB = o.sql ? { ...base, prepare: (sql: string) => { o.sql!.push(sql); return base.prepare(sql); } } : base;
  const env = { DB, JWT_SECRET, ENVIRONMENT: 'development', ...(o.branch ? { BRANCH_CODE: 'ldn' } : {}) } as any;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.token !== false) headers.Authorization = `Bearer ${token}`;
  if (o.company) headers['X-Company-Id'] = '10';
  const res = await withThrownResponses(() => app.request(`${o.mount ?? '/api/connectors'}${path}`, { method: 'GET', headers }, env));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const viewerOf = (role: string, branch = false) => ({ role, hq: !branch });
const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('category_order is CATEGORY_ORDER, each category once, and every card\'s category is in it', async () => {
  // Mutation checked: serving the frontend's list (no Payroll) fails the deep-equal.
  const db = fixture();
  for (const role of ALLOWED) for (const branch of [false, true]) {
    const r = await call(db, role, '/available', { branch });
    assert.equal(r.status, 200, role);
    assert.deepEqual(r.body.category_order, [...CATEGORY_ORDER], `${role} ${branch}`);
    assert.equal(new Set(r.body.category_order).size, r.body.category_order.length);
    for (const item of [...r.body.items, ...r.body.first_party]) assert.ok(r.body.category_order.includes(item.category), `${item.key}: ${item.category}`);
  }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('every /available item carries the ten page fields', async () => {
  // Mutations checked: `verified: true` in catalogueEntry; dropping `page_key`.
  const db = fixture();
  for (const role of ALLOWED) for (const branch of [false, true]) {
    for (const item of (await call(db, role, '/available', { branch })).body.items) {
      const at = `${role} ${branch} ${item.key}`;
      for (const f of PAGE_FIELDS) assert.ok(f in item, `${at}: ${f}`);
      assert.ok(typeof item.tagline === 'string' && item.tagline.length >= 1 && item.tagline.length <= 120, at);
      assert.equal(item.made_by.name, 'Axal VC', at);
      assert.ok(item.service.name, at);
      assert.ok(SIGN_IN.includes(item.sign_in.kind), at);
      assert.ok(item.added === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(item.added), at);
      assert.equal(item.verified, item.verified_on !== null, at);
      assert.equal(typeof item.read_only, 'boolean', at);
      assert.equal(item.page_href, connectorPagePath(item.key), at);
      assert.equal(item.page_key, item.key === 'google_calendar' ? 'google' : item.key === 'microsoft_365' ? 'microsoft' : item.key, at);
    }
  }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('nothing that was on /available changed', async () => {
  // Mutation checked: dropping `tier_locked` from catalogueEntry.
  const db = fixture();
  db.exec("INSERT INTO integrations(uid, user_id, provider_key) VALUES ('u-stripe', 2, 'stripe'); INSERT INTO google_oauth_tokens VALUES (2)");
  for (const role of ALLOWED) {
    const r = await call(db, role, '/available');
    assert.deepEqual(r.body.items, r.body.providers);
    assert.deepEqual(r.body.unreadable_sources, []);
    for (const item of r.body.items) {
      const pub = publicDescriptor(getDescriptor(item.key), viewerOf(role));
      for (const [k, v] of Object.entries(pub)) if (k !== 'verified') assert.deepEqual(item[k], v, `${role} ${item.key}.${k}`);
      assert.equal(item.provider_name, item.key);
      assert.equal(item.required_tier, item.tier);
      assert.ok('icon_key' in item);
      assert.equal(item.tier_locked, item.locked_for_user, `${role} ${item.key}`);
    }
  }
  const founder = (await call(db, 'founder', '/available')).body.items;
  assert.equal(founder.find((x: any) => x.key === 'stripe').already_connected, true);
  assert.equal(founder.find((x: any) => x.key === 'google_calendar').already_connected, true);
  assert.equal(founder.find((x: any) => x.key === 'hubspot').already_connected, false);
  assert.equal((await call(db, 'admin', '/available')).body.items.find((x: any) => x.key === 'mercury').already_connected, false);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('/available stays light: no page body on any item', async () => {
  // Mutation checked: spreading pageBody into catalogueEntry.
  const db = fixture();
  for (const item of (await call(db, 'admin', '/available')).body.items) {
    for (const f of BODY_FIELDS) assert.ok(!(f in item), `${item.key}: ${f}`);
  }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('LinkedIn is one first_party card, never an item', async () => {
  // Mutation checked: dropping first_party from the answer.
  const db = fixture();
  const r = (await call(db, 'founder', '/available')).body;
  assert.equal(r.first_party.length, 1);
  const li = r.first_party[0];
  assert.deepEqual([li.key, li.display_name, li.category, li.status, li.sign_in.kind, li.page_href],
    ['linkedin', 'LinkedIn', 'Data', 'live', 'first_party', '/account/connectors/linkedin']);
  assert.ok(!('has_implementation' in li) && !('already_connected' in li));
  for (const f of PAGE_FIELDS) assert.ok(f in li, f);
  assert.ok(!r.items.some((x: any) => x.key === 'linkedin'));
  assert.deepEqual(Object.keys(FIRST_PARTY_CARDS).sort(), Object.keys(FIRST_PARTY_PAGES).sort());
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the page read is the catalogue entry, without the connection, plus the body', async () => {
  // Mutation checked: moving `already_connected` into catalogueEntry.
  const db = fixture();
  const viewers: [string, boolean][] = [['admin', false], ['founder', false], ['partner', true], ['investor', false], ['advisor', false]];
  for (const [role, branch] of viewers) {
    const avail = (await call(db, role, '/available', { branch })).body;
    for (const item of avail.items) {
      const d = await call(db, role, `/directory/${item.key}`, { branch });
      assert.equal(d.status, 200, `${role} ${item.key}`);
      assert.ok(!('already_connected' in d.body.connector), `${role} ${item.key}`);
      for (const [k, v] of Object.entries(item)) if (k !== 'already_connected') assert.deepEqual(d.body.connector[k], v, `${role} ${item.key}.${k}`);
      for (const f of BODY_FIELDS.filter((x) => x !== 'calls')) assert.ok(f in d.body.connector, `${role} ${item.key}: ${f}`);
    }
    const li = await call(db, role, '/directory/linkedin', { branch });
    for (const [k, v] of Object.entries(avail.first_party[0])) assert.deepEqual(li.body.connector[k], v, `${role} linkedin.${k}`);
  }
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('Mercury\'s page follows its audience; the entity variant reads no entity store', async () => {
  // Mutations checked: dropping the audienceOf check; calling pageDescriptor without the viewer.
  const db = fixture();
  const mercury = getDescriptor('mercury');
  for (const role of ALLOWED) for (const branch of [false, true]) {
    const r = await call(db, role, '/directory/mercury', { branch });
    const none = audienceFor(mercury, viewerOf(role, branch)) === 'none';
    if (none) assert.deepEqual([r.status, r.body], [404, { error: 'unknown_provider' }], `${role} ${branch}`);
    else assert.equal(r.status, 200, `${role} ${branch}`);
  }
  // D752 changes this line in the PR that adds `investor` to `personal_roles`.
  for (const branch of [false, true]) assert.equal((await call(db, 'investor', '/directory/mercury', { branch })).status, 404);
  const sql: string[] = [];
  const admin = (await call(db, 'admin', '/directory/mercury', { sql })).body.connector;
  assert.deepEqual([admin.connection_source, admin.has_implementation, admin.sign_in.kind], ['mercury_entity_connections', false, 'entity']);
  for (const k of ['connections', 'entities', 'accounts']) assert.ok(!keysDeep(admin).includes(k), k);
  assert.ok(!sql.some((s) => /mercury_|activity_logs/.test(s)), sql.join('\n'));
  assert.equal((await call(db, 'admin', '/directory/mercury', { branch: true })).status, 404);
  const founder = (await call(db, 'founder', '/directory/mercury')).body.connector;
  assert.deepEqual([founder.connection_source, founder.sign_in.kind], ['integrations', 'key']);
  assert.equal(founder.description, PERSONAL_MERCURY.description);
  assert.deepEqual(founder.feeds, ['revenue_and_traction']);
  assert.deepEqual((await call(db, 'partner', '/directory/mercury')).body.connector.feeds, []);
});

// 8 ───────────────────────────────────────────────────────────────────────────
test('page keys: google and microsoft answer their registry rows', async () => {
  // Mutation checked: skipping PAGE_ALIAS in directoryKeyFor makes /directory/google 404.
  const db = fixture();
  const g = await call(db, 'founder', '/directory/google');
  assert.equal(g.status, 200);
  assert.deepEqual(g.body, (await call(db, 'founder', '/directory/google_calendar')).body);
  assert.deepEqual([g.body.connector.key, g.body.connector.page_key], ['google_calendar', 'google']);
  assert.deepEqual((await call(db, 'founder', '/directory/microsoft')).body, (await call(db, 'founder', '/directory/microsoft_365')).body);
});

// 9 ───────────────────────────────────────────────────────────────────────────
test('unknown and malformed keys are 404 unknown_provider, never a lookup error', async () => {
  const db = fixture();
  // whatsapp and telegram become pages with task C1 (channel pages).
  for (const k of ['notion', 'GitHub', 'git-hub', 'a', 'w'.repeat(41), 'constructor', 'hasownproperty', '%5F%5Fproto%5F%5F', 'whatsapp', 'telegram']) {
    const r = await call(db, 'founder', `/directory/${k}`);
    assert.deepEqual([r.status, r.body], [404, { error: 'unknown_provider' }], k);
  }
});

// 10 ──────────────────────────────────────────────────────────────────────────
test('descriptive only: no private field, rebuilt tools, prompts and trust, and no connection store read', async () => {
  // Mutations checked: spreading `...t` into a served tool; reading google_oauth_tokens in the handler.
  const db = fixture();
  const viewers: [string, boolean][] = [['admin', false], ['founder', false], ['partner', true], ['investor', false]];
  for (const [role, branch] of viewers) {
    const keys = [...(await call(db, role, '/available', { branch })).body.items.map((x: any) => x.key), 'linkedin', 'google', 'microsoft'];
    for (const key of keys) {
      const sql: string[] = [];
      const r = await call(db, role, `/directory/${key}`, { branch, sql });
      assert.equal(r.status, 200, `${role} ${key}`);
      const names = keysDeep(r.body);
      for (const p of PRIVATE) assert.ok(!names.includes(p), `${role} ${key}: ${p}`);
      const c = r.body.connector;
      for (const t of c.tools) assert.deepEqual(Object.keys(t).sort(), ['access', 'label', 'lands_in', 'name', 'what']);
      for (const x of c.prompts) assert.deepEqual(Object.keys(x).sort(), ['ask', 'name', 'proposes']);
      assert.deepEqual(Object.keys(c.trust).sort(), ['built_by', 'moves_money', 'read_only', 'reads', 'sentence', 'writes']);
      assert.ok(!sql.some((s) => CONNECTION_STORES.test(s)), `${role} ${key}: ${sql.filter((s) => CONNECTION_STORES.test(s)).join(' | ')}`);
    }
  }
});

// 11 ──────────────────────────────────────────────────────────────────────────
test('who may read it: signed in, an allowed role, no company needed', async () => {
  // Mutations checked: dropping ensureRole; requiring activeCompanyFor.
  const db = fixture();
  assert.equal((await call(db, 'founder', '/directory/stripe', { token: false })).status, 401);
  const ex = await call(db, 'exploring', '/directory/stripe');
  assert.deepEqual([ex.status, ex.body], [403, { error: 'forbidden', message: 'Your role cannot manage integrations.' }]);
  for (const role of ALLOWED) assert.equal((await call(db, role, '/directory/stripe')).status, 200, role);
});

// 12 ──────────────────────────────────────────────────────────────────────────
test('registration order: the literal reads and /:key answer as before', async () => {
  // Mutation checked: moving the registration below /:key fails the source check.
  const db = fixture();
  assert.deepEqual((await call(db, 'founder', '/waitlist')).body, { ok: true, items: [] });
  // A provider that writes no project data answers the teammate lookup with no company read.
  const plain = REGISTRY.find((p: any) => !writesProjectData(p.key) && audienceFor(p, viewerOf('founder')) !== 'none').key;
  assert.deepEqual((await call(db, 'founder', `/${plain}`, { company: true })).body, { ok: true, provider_key: plain, teammate: null });
  assert.deepEqual((await call(db, 'founder', '/directory')).body, { error: 'unknown_provider' });
  const fed = await call(db, 'founder', '/0123456789abcdef0123456789abcdef/fed', { company: true });
  assert.notEqual(fed.body?.error, 'unknown_provider');
  const src = readFileSync(new URL('../src/routes/integrations.ts', import.meta.url), 'utf8');
  assert.ok(src.indexOf("integrations.get('/directory/:key'") < src.indexOf("integrations.get('/:key'"));
});

// 13 ──────────────────────────────────────────────────────────────────────────
test('both mounts give the same answers', async () => {
  const db = fixture();
  for (const path of ['/directory/stripe', '/available']) {
    assert.deepEqual((await call(db, 'founder', path, { mount: '/api/integrations' })).body, (await call(db, 'founder', path)).body, path);
  }
});

// 14 ──────────────────────────────────────────────────────────────────────────
test('one readiness value: the page read serves the card\'s `configured`', async () => {
  const db = fixture();
  if (typeof (registry as any).readinessOf !== 'function') return;
  const items = (await call(db, 'admin', '/available')).body.items;
  assert.ok(items.some((x: any) => 'configured' in x), 'some OAuth connector reports readiness');
  for (const item of items) {
    const c = (await call(db, 'admin', `/directory/${item.key}`)).body.connector;
    assert.equal('configured' in c, 'configured' in item, item.key);
    if ('configured' in item) assert.equal(c.configured, item.configured, item.key);
  }
});

// 16 ──────────────────────────────────────────────────────────────────────────
test('directoryKeyFor is pure', () => {
  assert.deepEqual(directoryKeyFor('google'), { key: 'google_calendar', page_key: 'google' });
  assert.deepEqual(directoryKeyFor('microsoft'), { key: 'microsoft_365', page_key: 'microsoft' });
  assert.deepEqual(directoryKeyFor('google_calendar'), { key: 'google_calendar', page_key: 'google_calendar' });
  assert.deepEqual(directoryKeyFor('linkedin'), { key: 'linkedin', page_key: 'linkedin' });
  for (const bad of ['', 'a/b', '../x', 'GitHub', 'a'.repeat(41)]) assert.equal(directoryKeyFor(bad), null, bad);
  assert.deepEqual(directoryKeyFor('constructor'), { key: 'constructor', page_key: 'constructor' });
  assert.deepEqual(directoryKeyFor('hasOwnProperty'), null, 'not lower-case');
  assert.ok(REGISTRY.length > 0);
});
