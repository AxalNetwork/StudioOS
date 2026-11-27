/**
 * D5078 (#5078; Build v2 BD20 A/B, BD12) — Operating systems' Systems and Tools
 * from the module read, on real SQL (node:sqlite) and real JWT routes:
 *
 *   1. a venture with only GitHub connected also lists every other tool that
 *      feeds Build as Not connected, with what it would feed and Connect;
 *   2. each tool's action follows its state, Reconnect is its owner's only, and
 *      a failing tool says why in words (the owner's and members' privacy rule);
 *   3. the sync history is every provider's, the latest 20, and says so;
 *   4. Systems: no company is one prerequisite with no rows; with a company,
 *      one state per kind drives its line and its action, and `next` is the
 *      first system to reconnect or connect;
 *   5. the overview read gains no statement: it reads no sync log at all.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/operating_systems_5078.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { SYNC_LINES } from '../src/services/operatingSystemsView.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT, external_account_id TEXT, external_account_name TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE integration_logs(id INTEGER PRIMARY KEY, integration_id INTEGER, user_id INTEGER, provider_key TEXT, direction TEXT,
      event_type TEXT, status TEXT, http_status INTEGER, request_summary TEXT, response_summary TEXT, external_id TEXT,
      payload_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT, entity_type TEXT, entity_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE google_oauth_tokens(user_id INTEGER PRIMARY KEY);
    CREATE TABLE microsoft_oauth_tokens(user_id INTEGER PRIMARY KEY);
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'One', 'one@example.test'), (2, 'founder', 22, 'Two', 'two@example.test'), (3, 'admin', NULL, 'Admin', 'admin@example.test'), (4, 'partner', NULL, 'Partner', 'partner@example.test');
    INSERT INTO company_profiles VALUES (10), (20);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10), (102, 11, 10), (202, 22, 20), (303, 11, NULL);
    INSERT INTO user_company_links VALUES (1, 10), (2, 10), (2, 20);
  `);
  for (const m of ['441_build_cycle_stores.sql', '445_connector_fed_items.sql', '455_core_systems_workspace.sql', '459_cycle_activity_convention.sql', '461_build_record_stores.sql']) db.exec(mig(m));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  return { db, env };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/build', build);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1) {
  const token = await new SignJWT({ user_id: id, role: id === 3 ? 'admin' : id === 4 ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { headers: { Authorization: 'Bearer ' + token } }, env);
  return { status: r.status, body: await r.json() as any };
}
const read = async (env: any, project = 101, id = 1) => (await call(env, `/api/cycles/build/modules/operating-systems?project=${project}`, id)).body;

/** A connection enabled for company 10. */
function connection(db: any, id: number, user: number, provider: string, status = 'active', extra = '') {
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, display_name, status, auth_type, last_synced_at, last_error_at)
      VALUES (${id}, 'c-${id}', ${user}, '${provider}', 'Private ${provider} of ${user}', '${status}', 'oauth2', '2026-10-18 09:00:00', ${status === 'error' ? "'2026-10-20 07:00:00'" : 'NULL'});
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (${id}, 10, 1); ${extra}`);
}
function syncLog(db: any, id: number, integration: number, provider: string, at: string, status: string, summary: string, payload?: unknown) {
  db.prepare(`INSERT INTO integration_logs(id, integration_id, user_id, provider_key, direction, event_type, status, response_summary, payload_json, created_at)
    VALUES (?, ?, 1, ?, 'outbound', 'sync', ?, ?, ?, ?)`).run(id, integration, provider, status, summary, payload === undefined ? null : JSON.stringify(payload), at);
}

test('1. only GitHub connected: every other Build-feeding tool is Not connected, with what it would feed and Connect', async () => {
  // Mutation checked: notConnectedTools ignoring the company's keys → GitHub is listed twice; without BUILD_PART_TOOLS → no Lovable or PostHog;
  // a coming-soon tool given Connect → Google Workspace offers it.
  const { db, env } = fixture(); connection(db, 31, 1, 'github');
  const t = (await read(env)).parts.tools;
  assert.deepEqual(t.rows.map((r: any) => r.cells.tool), ['GitHub']);
  const missing = new Map(t.not_connected.map((r: any) => [r.cells.tool, r]));
  for (const tool of ['Vercel', 'Lovable', 'Notion', 'Google Workspace', 'PostHog']) assert.ok(missing.has(tool), `${tool} is listed as Not connected`);
  assert.ok(!missing.has('GitHub'), 'a connected tool is not also listed as missing');
  // Google Workspace and Figma are coming soon: listed with what they would feed, never with a Connect the route refuses.
  for (const soon of ['Google Workspace', 'Figma']) {
    const r: any = missing.get(soon);
    assert.deepEqual([r.cells.state, r.cells.action, r.cells.reason, r.keys.state], ['Coming soon', null, 'Not available to connect yet.', 'coming_soon'], soon);
  }
  assert.deepEqual(t.not_connected.slice(-2).map((r: any) => r.cells.tool).sort(), ['Figma', 'Google Workspace'], 'after the tools that can connect');
  assert.ok(!missing.has('Google Calendar') && !missing.has('Stripe'), 'a personal connection and a tool that feeds no Build module are left out');
  const vercel: any = missing.get('Vercel');
  assert.deepEqual([vercel.cells.state, vercel.cells.action, vercel.keys], ['Not connected', { text: 'Connect', href: '/build/connect?tool=vercel&project_id=101' }, { state: 'not_connected', intent: 'connect' }]);
  assert.equal(vercel.cells.feeds, 'Prototype / MVP · Product roadmap · Operating systems · Solution design');
  assert.equal((missing.get('Lovable') as any).cells.feeds, 'Prototype / MVP');
  assert.equal((missing.get('PostHog') as any).cells.feeds, 'Prototype / MVP · Product roadmap · Operating systems');
  assert.equal(t.total, 1, 'the count is still the connected tools');
  // No company: nothing is listed as missing either.
  assert.deepEqual((await read(env, 303)).parts.tools.not_connected, []);
  db.close();
});

test('2. a failing tool says when and why, and offers Reconnect only to its owner; a healthy one is managed', async () => {
  // Mutation checked: Reconnect for every viewer → member 3 is offered it; the failure words shown to everyone → the partner reads them.
  const { db, env } = fixture(); db.exec('INSERT INTO user_company_links VALUES (3, 10)'); // the admin is a company member
  connection(db, 31, 1, 'github', 'error'); connection(db, 32, 1, 'vercel');
  syncLog(db, 1, 31, 'github', '2026-10-19 08:00:00', 'error', 'github_api_failed: 401 old words');
  syncLog(db, 2, 31, 'github', '2026-10-20 07:00:00', 'error', 'github_api_failed: 401 the token was rejected Bearer ghs_FIXTUREnotARealToken1234567890');
  syncLog(db, 3, 32, 'vercel', '2026-10-20 08:00:00', 'ok', 'Synced');
  const row = (body: any, tool: string) => body.parts.tools.rows.find((r: any) => r.cells.tool === tool);
  const owner = await read(env, 101, 1), member = await read(env, 101, 3), partner = await read(env, 101, 4);
  assert.deepEqual([row(owner, 'GitHub').cells.state, row(owner, 'GitHub').cells.failed_at, row(owner, 'GitHub').cells.action, row(owner, 'GitHub').cells.reason],
    ['Failing', '2026-10-20 07:00:00', { text: 'Reconnect', href: '/build/connect?tool=github&project_id=101' }, '401 the token was rejected [hidden]']);
  assert.deepEqual([row(member, 'GitHub').cells.action, row(member, 'GitHub').cells.owner, row(member, 'GitHub').cells.reason],
    [null, 'One', '401 the token was rejected [hidden] Only One can reconnect it.']);
  assert.deepEqual([row(partner, 'GitHub').cells.action, row(partner, 'GitHub').cells.owner, row(partner, 'GitHub').cells.reason],
    [null, null, 'The last sync did not complete. Only the connection’s owner can reconnect it.']);
  assert.ok(!JSON.stringify(owner).includes('ghs_FIXTURE'), 'a token never reaches the read');
  assert.deepEqual([row(member, 'Vercel').cells.action, row(member, 'Vercel').cells.reason], [{ text: 'Manage', href: '/build/connect?tool=vercel&project_id=101' }, null]);
  // GitHub's Code system follows the same rule.
  assert.deepEqual([owner.parts.tools.code.systems[0].action?.text, member.parts.tools.code.systems[0].action], ['Reconnect', null]);
  db.close();
});

test('3. the sync history is every provider\'s, newest first, at most the latest 20, and labelled so', async () => {
  // Mutation checked: the log read bound to GitHub's connections only → the Vercel and Notion lines are gone.
  const { db, env } = fixture();
  connection(db, 31, 1, 'github'); connection(db, 32, 1, 'vercel'); connection(db, 33, 2, 'notion');
  for (let i = 1; i <= 24; i++) {
    const [integration, provider] = i % 3 === 0 ? [31, 'github'] : i % 3 === 1 ? [32, 'vercel'] : [33, 'notion'];
    syncLog(db, i, integration, provider, `2026-10-${String(i).padStart(2, '0')} 09:00:00`, 'ok', 'Synced', provider === 'github' ? { issues: i } : {});
  }
  const s = (await read(env)).parts.tools.syncs;
  assert.equal(SYNC_LINES, 20);
  assert.deepEqual([s.state, s.rows.length, s.limit, s.label], ['ok', 20, 20, 'Latest 20']);
  assert.equal(s.rows[0].at, '2026-10-24 09:00:00');
  assert.deepEqual([...new Set(s.rows.map((r: any) => r.provider))].sort(), ['GitHub', 'Notion', 'Vercel']);
  const notion = s.rows.find((r: any) => r.provider === 'Notion');
  assert.deepEqual([notion.text, notion.repositories], ['Not recorded', null], 'what another provider brought is not recorded, never guessed');
  db.close();
});

test('4. Systems: no company is one prerequisite with no rows; with one, a state per kind drives its line and its action', async () => {
  // Mutation checked: system rows built without a company → five rows; Reconnect offered to a non-owner → member 3 sees it;
  // `next` taking the first Connect before a Reconnect → "Connect Payroll" for the owner too.
  const { db, env } = fixture();
  const none = (await read(env, 303)).parts.systems;
  assert.deepEqual([none.state, none.rows, none.reason], ['not_recorded', [], 'This venture is not in a company yet, so no connected tool feeds it.']);
  db.exec('INSERT INTO user_company_links VALUES (3, 10)'); // the admin is a company member
  connection(db, 41, 2, 'hubspot'); connection(db, 42, 1, 'salesforce', 'error'); connection(db, 43, 2, 'stripe', 'revoked');
  db.exec(`INSERT INTO project_core_systems(project_id, kind, integration_id, updated_by) VALUES (101, 'crm', 41, 2), (101, 'accounting', 42, 1), (101, 'bank', 43, 2)`);
  syncLog(db, 1, 42, 'salesforce', '2026-10-20 07:00:00', 'error', 'salesforce_failed: session expired');
  const one = (await read(env, 101, 1)).parts.systems, admin = (await read(env, 101, 3)).parts.systems;
  const by = (p: any, k: string) => p.rows.find((r: any) => r.kind === k);
  assert.deepEqual(one.rows.map((r: any) => [r.kind, r.state]), [['bank', 'disconnected'], ['accounting', 'failing'], ['payroll', 'not_connected'], ['crm', 'connected'], ['workspace', 'not_connected']]);
  assert.deepEqual([by(one, 'crm').action, by(one, 'crm').line, by(one, 'crm').provider, by(one, 'crm').owner],
    [{ intent: 'manage', text: 'Manage', href: '/build/operating-systems/crm?project_id=101' }, 'Last good sync 18 Oct', 'HubSpot', 'Two']);
  assert.deepEqual([by(one, 'payroll').action, by(one, 'payroll').line, by(one, 'payroll').provider, by(one, 'payroll').why],
    [{ intent: 'connect', text: 'Connect', href: '/build/operating-systems/payroll?project_id=101' }, 'Connect a provider to start', null, null]);
  assert.deepEqual([by(one, 'accounting').action, by(one, 'accounting').reason, by(one, 'accounting').owner, by(one, 'accounting').provider, by(one, 'accounting').why, by(one, 'accounting').line],
    [{ intent: 'reconnect', text: 'Reconnect', href: '/build/connect?tool=salesforce&project_id=101' }, null, 'You', 'Private salesforce of 1', 'session expired', 'Failing since 20 Oct · last good sync 18 Oct']);
  assert.deepEqual([by(admin, 'accounting').action, by(admin, 'accounting').reason, by(admin, 'accounting').owner, by(admin, 'accounting').provider],
    [null, 'Only One can reconnect it.', 'One', 'Salesforce']);
  assert.deepEqual([by(one, 'bank').action, by(one, 'bank').reason, by(one, 'bank').line, by(one, 'bank').why],
    [null, 'Only Two can reconnect it.', 'Reconnect required · access was revoked', 'Reconnect required: access was revoked.']);
  assert.deepEqual(one.summary, { connected: 1, failing: 1, disconnected: 1, not_connected: 2, total: 5 });
  // The dominant action is the first system this viewer can repair, else the first to connect.
  assert.deepEqual([one.next, admin.next], [{ text: 'Reconnect Accounting', href: '/build/connect?tool=salesforce&project_id=101' }, { text: 'Connect Payroll', href: '/build/operating-systems/payroll?project_id=101' }]);
  // A partner outside the company reads neither the owner nor the stored words.
  const partner = (await read(env, 101, 4)).parts.systems;
  assert.deepEqual([by(partner, 'accounting').owner, by(partner, 'accounting').why, by(partner, 'accounting').reason], [null, 'The last sync did not complete.', 'Only the connection’s owner can reconnect it.']);
  db.close();
});

test('5. the overview read reads no sync log and sends no parts: no new statement there', async () => {
  // Mutation checked: the failure words read on the overview too → an integration_logs statement appears.
  const { db, env } = fixture(); connection(db, 31, 1, 'github', 'error');
  db.exec(`INSERT INTO project_core_systems(project_id, kind, integration_id, updated_by) VALUES (101, 'crm', 31, 1)`);
  const seen: string[] = [];
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => { seen.push(sql); return prepare(sql); };
  const r = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(r.status, 200);
  assert.deepEqual(seen.filter((sql) => /integration_logs/.test(sql)), []);
  const card = r.body.cards.find((c: any) => c.slug === 'operating-systems');
  assert.equal(card.next.text.startsWith('Reconnect'), true, 'the card still names the system to reconnect');
  db.close();
});
