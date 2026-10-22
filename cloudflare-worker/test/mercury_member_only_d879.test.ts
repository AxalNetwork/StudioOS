/**
 * D879 (#2552) — Mercury is a member connector only. For each viewer (a
 * founder, a partner and an investor on HQ and on a branch, an admin on HQ and
 * on a branch): the catalogue entry, the page and the `/connect` answer.
 *
 *   · Nothing served to anyone describes Axal VC's own accounts or names an
 *     entity key (`holdings`, `management`, `gp`, `fund`).
 *   · An admin on HQ previews the founder's page with the line to HQ › Fund
 *     administration › Bank accounts, reads no Mercury store and no connection,
 *     and cannot connect.
 *   · A founder's card and page declare Grow and Raise (`used_by`, `feeds`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mercury_member_only_d879.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import integrations from '../src/routes/integrations.ts';
import { CONNECTOR_METADATA, HQ_ACCOUNTS_NOTE, PERSONAL_MERCURY, getDescriptor } from '../src/integrations/registry.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { MERCURY_FEEDS, mercuryFedModules } from '../src/integrations/mercuryFeeds.ts';
import { d1Over } from './_d1_sqlite.mjs';
import '../src/integrations/providers/mercury.ts';

const JWT_SECRET = 'y'.repeat(64); // synthetic fixture key
const ROLES = ['admin', 'founder', 'partner', 'investor'];
const ENTITY_KEYS = ['holdings', 'management', 'gp', 'fund'];

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
    -- HQ's own store, holding an entity row: nothing here may read it.
    CREATE TABLE mercury_entity_connections(id INTEGER PRIMARY KEY, entity_key TEXT, organization_name TEXT);
    INSERT INTO mercury_entity_connections(entity_key, organization_name) VALUES ('holdings', 'Axal VC Holdings LLC');
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

/** One request as `role`, with every SQL statement it ran. */
async function call(db: DatabaseSync, role: string, method: string, path: string, body?: unknown, branch = false) {
  const id = ROLES.indexOf(role) + 1;
  const token = await new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const sql: string[] = [];
  const DB = d1Over(db);
  const prepare = DB.prepare.bind(DB);
  DB.prepare = (q: string) => { sql.push(q); return prepare(q); };
  const env = { DB, JWT_SECRET, ENVIRONMENT: 'development', ...(branch ? { BRANCH_CODE: 'ldn' } : {}) } as any;
  const res = await app.request(`/api/connectors${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'X-Company-Id': '10', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any, sql };
}

/** Every key and every string value, at any depth. */
function words(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => words(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); words(x, out); }
  else if (typeof v === 'string') out.push(v);
  return out;
}

/** Nothing about Axal VC's own accounts: no wording, no store, no entity key. */
function assertMemberOnly(v: unknown, label: string) {
  const text = JSON.stringify(v);
  assert.ok(!/Axal entit|entity account|Super Admin|mercury_entity_connections|entity_connection_only/i.test(text), `${label}: ${text.slice(0, 200)}`);
  for (const w of words(v)) {
    assert.ok(!ENTITY_KEYS.includes(w), `${label}: names the entity key ${w}`);
    assert.ok(!['entity', 'entities'].includes(w), `${label}: has an ${w} field`);
  }
}

const mercuryOf = (r: any) => r.body?.items?.find((p: any) => p.key === 'mercury') ?? null;

// viewer → [audience, the page served (by role), the connect answer without a token (D881: every member token connect is retired)]
const VIEWERS: Array<{ role: string; branch: boolean; listed: boolean; page: string | null; connect: [number, string] }> = [
  { role: 'founder', branch: false, listed: true, page: 'founder', connect: [410, 'token_connect_retired'] },
  { role: 'founder', branch: true, listed: true, page: 'founder', connect: [410, 'token_connect_retired'] },
  { role: 'partner', branch: false, listed: true, page: 'partner', connect: [410, 'token_connect_retired'] },
  { role: 'partner', branch: true, listed: true, page: 'partner', connect: [410, 'token_connect_retired'] },
  { role: 'investor', branch: false, listed: true, page: 'investor', connect: [410, 'token_connect_retired'] },
  // D884 (#2557, the owner's answer A): an investor has their own Mercury in a branch too.
  { role: 'investor', branch: true, listed: true, page: 'investor', connect: [410, 'token_connect_retired'] },
  { role: 'admin', branch: false, listed: true, page: 'founder', connect: [403, 'purpose_not_allowed'] },
  { role: 'admin', branch: true, listed: false, page: null, connect: [404, 'unknown_provider'] },
];

test('every viewer: the card, the page and the connect answer; none describes Axal VC\'s accounts or reads HQ\'s store', async () => {
  const db = fixture();
  for (const v of VIEWERS) {
    const label = `${v.role}${v.branch ? ' on a branch' : ' on HQ'}`;
    const list = await call(db, v.role, 'GET', '/available', undefined, v.branch);
    assert.equal(list.status, 200, label);
    const card = mercuryOf(list);
    assert.equal(!!card, v.listed, `${label}: listed`);
    const page = await call(db, v.role, 'GET', '/directory/mercury', undefined, v.branch);
    if (v.page) {
      assert.equal(page.status, 200, label);
      assert.equal(page.body.connector.tagline, (CONNECTOR_PAGES.mercury as any).personal[v.page].tagline, `${label}: the ${v.page} page`);
      assert.equal(page.body.connector.sign_in.kind, 'mcp', label); // D881 (#2554): Sign in with Mercury only
      assert.equal(page.body.connector.connection_source, 'integrations', label);
    } else {
      assert.deepEqual([page.status, page.body], [404, { error: 'unknown_provider' }], label);
    }
    const connect = await call(db, v.role, 'POST', '/connect', { provider_key: 'mercury' }, v.branch);
    assert.deepEqual([connect.status, connect.body.error], v.connect, `${label}: connect`);
    for (const r of [list, page, connect]) {
      assertMemberOnly(r.body, label);
      assert.ok(!r.sql.some((q) => /mercury_entity_connections|mercury_entity/.test(q)), `${label}: read HQ's store`);
    }
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE provider_key = 'mercury'").get()!.n, 0, 'nothing was connected');
});

test('an admin on HQ: the founder\'s card as a preview, the line to HQ, no connection read, and no connect', async () => {
  const db = fixture();
  // Even a Mercury row in the admin's own name is not read for the preview.
  db.prepare("INSERT INTO integrations(uid, user_id, provider_key, auth_type) VALUES ('own-1', 1, 'mercury', 'api_key')").run();
  const card = mercuryOf(await call(db, 'admin', 'GET', '/available'));
  assert.deepEqual([card.preview, card.has_implementation, card.already_connected, card.connection_source], [true, false, false, 'integrations']);
  assert.deepEqual(card.hq_accounts, { line: 'Axal VC’s own accounts are managed in HQ › Fund administration › Bank accounts.', href: '/admin?tab=bank-accounts' });
  assert.deepEqual(card.hq_accounts, { ...HQ_ACCOUNTS_NOTE });
  assert.equal(card.description, PERSONAL_MERCURY.founder.description, 'the founder\'s card');
  assert.deepEqual(card.feeds, mercuryFedModules('founder'));
  const page = (await call(db, 'admin', 'GET', '/directory/mercury')).body.connector;
  assert.deepEqual([page.preview, page.has_implementation, page.hq_accounts], [true, false, { ...HQ_ACCOUNTS_NOTE }]);
  assert.deepEqual(page.trust, (await call(db, 'founder', 'GET', '/directory/mercury')).body.connector.trust);
  const connect = await call(db, 'admin', 'POST', '/connect', { provider_key: 'mercury', api_key: 'fixture-not-a-token-1' });
  assert.deepEqual([connect.status, connect.body.error, connect.body.message], [403, 'purpose_not_allowed', 'Your role does not hold a personal Mercury connection.']);
  // A member never reads the preview note.
  for (const role of ['founder', 'partner', 'investor']) {
    const own = mercuryOf(await call(db, role, 'GET', '/available'));
    assert.ok(!('preview' in own) && !('hq_accounts' in own), role);
  }
});

test('a founder\'s card and page declare Grow and Raise: used_by, feeds and pulls, from mercuryFeeds.ts', async () => {
  const db = fixture();
  const founderFeeds = MERCURY_FEEDS.filter((f) => f.role === 'founder' && f.module !== null);
  const grow = ['revenue_and_traction', 'durable_company_building', 'team_expansion', 'distribution', 'partner_network'];
  const raise = ['fundraising_readiness', 'use_of_funds', 'data_room', 'cap_table', 'capital_relationships', 'investor_narrative', 'pitch_deck'];
  assert.deepEqual(CONNECTOR_METADATA.mercury.used_by, [{ label: 'Grow', href: '/grow' }, { label: 'Raise', href: '/raise' }]);
  assert.deepEqual(CONNECTOR_METADATA.mercury.pulls, founderFeeds.map((f) => ({ what: f.what, module: f.module })));
  for (const path of ['/available', '/directory/mercury']) {
    const r = await call(db, 'founder', 'GET', path);
    const entry = path === '/available' ? mercuryOf(r) : r.body.connector;
    assert.deepEqual(entry.used_by, [{ label: 'Grow', href: '/grow' }, { label: 'Raise', href: '/raise' }], path);
    for (const m of [...grow, ...raise]) assert.ok(entry.feeds.includes(m), `${path}: feeds ${m}`);
    assert.deepEqual(entry.feed_modules.map((f: any) => f.href.split('/')[1]).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).sort(), ['grow', 'raise'], path);
    assert.equal(entry.pulls.length, founderFeeds.length, path);
  }
  // A partner's and an investor's cards claim neither Grow nor Raise.
  for (const role of ['partner', 'investor']) {
    const own = mercuryOf(await call(db, role, 'GET', '/available'));
    assert.deepEqual([own.used_by, own.pulls], [[], []], role);
  }
  // The registry row describes a member's own Mercury, read through its sign-in.
  const row = getDescriptor('mercury')!;
  assert.match(row.description, /^Your own Mercury account, read-only, through Mercury’s own sign-in/);
  assert.match(row.description, /Grow and Raise/);
  assert.equal('entity_roles' in row, false);
  assert.match(CONNECTOR_METADATA.mercury.permissions[0], /^Sign in with Mercury: .* through Mercury’s MCP server; it never sends, transfers or requests money\.$/);
});
