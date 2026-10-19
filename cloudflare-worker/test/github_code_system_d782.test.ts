/**
 * D782 (#2113): GitHub on Operating systems and on its connector page.
 *
 * - The Code system: each GitHub connection enabled for the project's company,
 *   with its repositories, last sync and what it fed in this project, read
 *   from the connection and never written into `project_core_systems`.
 * - Each sync is a line in Tools, from the sync's log row: what arrived per
 *   module, and a failure's words with anything credential-shaped hidden.
 * - The connector page claims only the feeds the code builds.
 *
 * Real SQL on node:sqlite and real JWT routes; GitHub is never called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import integrations, { syncLogPayload, SYNC_LOG_REPOSITORY_CHARS } from '../src/routes/integrations.ts';
import { CONNECTOR_METADATA, getDescriptor, publicDescriptor, registerProvider } from '../src/integrations/registry.ts';
import { CONNECTOR_PAGES } from '../src/integrations/connectorPages.ts';
import { MODULE_LABELS } from '../src/integrations/moduleLabels.ts';
import { GITHUB_LANDINGS, GITHUB_READ_BY, githubFedModules, syncArrivals, syncArrivalsText, syncErrorWords } from '../src/integrations/githubFeeds.ts';
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
  a.route('/api/connectors', integrations);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1, method = 'GET') {
  const token = await new SignJWT({ user_id: id, role: id === 3 ? 'admin' : id === 4 ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': '10', 'Content-Type': 'application/json' } }, env);
  return { status: r.status, body: await r.json() as any };
}
const tools = async (env: any, project = 101, id = 1) => (await call(env, `/api/cycles/build/modules/operating-systems?project=${project}`, id)).body.parts.tools;

/** Member 1's GitHub connection, enabled for company 10 and pointed at project 101, with ledger rows in 101 and in 102. */
function github(db: any) {
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, config_json, last_synced_at, last_error_at)
      VALUES (31, 'gh-one', 1, 'github', 'active', 'oauth2', '${JSON.stringify({ repositories: ['acme/app', 'acme/site'], project_id: 101 })}', '2026-10-18 09:00:00', NULL);
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1);
    INSERT INTO connector_fed_items(integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES
      (31, 101, 'product_roadmap', 'issue', 'issue:acme/app#1', 'roadmap_okrs', 1),
      (31, 101, 'product_roadmap', 'issue', 'issue:acme/app#2', 'roadmap_okrs', 2),
      (31, 101, 'prototype_mvp', 'pull', 'pull:acme/app#3', 'mvp_features', 1),
      (31, 102, 'prototype_mvp', 'pull', 'pull:acme/site#4', 'mvp_features', 2);`);
}
function syncLog(db: any, id: number, at: string, status: string, summary: string, payload: unknown, integration = 31, provider = 'github') {
  db.prepare(`INSERT INTO integration_logs(id, integration_id, user_id, provider_key, direction, event_type, status, response_summary, payload_json, created_at)
    VALUES (?, ?, 1, ?, 'outbound', 'sync', ?, ?, ?, ?)`).run(id, integration, provider, status, summary, payload === undefined ? null : JSON.stringify(payload), at);
}

test('GitHub is the Code system: repositories, last sync and what it fed in this project, written nowhere', async () => {
  // Mutation checked: count the ledger across projects (fedCounts without the project) → the 102 pull counts here.
  const { db, env } = fixture(); github(db);
  const t = await tools(env);
  assert.equal(t.code.state, 'ok');
  const [sys] = t.code.systems;
  assert.deepEqual([sys.system, sys.provider, sys.source, sys.source_label, sys.state, sys.last_sync, sys.repositories, sys.repositories_total, sys.owner],
    ['Code', 'GitHub', 'connection', 'From the GitHub connection', 'Connected', '2026-10-18 09:00:00', ['acme/app', 'acme/site'], 2, 'You']);
  assert.deepEqual(sys.feeds, [
    { module: 'product_roadmap', label: 'Product roadmap', href: '/build/product-roadmap?project_id=101', count: 2 },
    { module: 'prototype_mvp', label: 'Prototype / MVP', href: '/build/prototype-mvp?project_id=101', count: 1 },
  ]);
  assert.deepEqual(sys.action, { text: 'Open', href: '/build/connect?tool=github&project_id=101' });
  // The other project of the same company counts only its own row.
  const other = (await tools(env, 102)).code.systems[0];
  assert.deepEqual(other.feeds.map((f: any) => [f.module, f.count]), [['prototype_mvp', 1]]);
  // A read, never a write: no core-system row appears.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM project_core_systems').get() as any).n, 0);
  db.close();
});

test('repository names and the owner follow the Tools rule: the owner and the company\'s members, nobody else', async () => {
  // Mutation checked: show repositories to every viewer → the partner outside the company reads them.
  const { db, env } = fixture(); github(db); db.exec('INSERT INTO user_company_links VALUES (3, 10)');
  const member = (await tools(env, 101, 3)).code.systems[0];
  const outsider = (await tools(env, 101, 4)).code.systems[0];
  assert.deepEqual([member.repositories, member.owner], [['acme/app', 'acme/site'], 'One'], 'an admin who is a company member');
  assert.deepEqual([outsider.repositories, outsider.repositories_total, outsider.owner], [null, 2, null], 'a partner outside the company');
  db.close();
});

test('no GitHub connection, a disabled one, and a project with no company', async () => {
  // Mutation checked: drop `ic.enabled = 1` → the disabled connection shows.
  const { db, env } = fixture();
  const none = await tools(env);
  assert.deepEqual([none.code.state, none.code.systems, none.code.reason, none.syncs.state, none.syncs.rows], ['empty', [], 'No GitHub connection is enabled for this company.', 'empty', []]);
  github(db); db.exec('UPDATE integration_companies SET enabled = 0 WHERE integration_id = 31');
  assert.equal((await tools(env)).code.systems.length, 0);
  const noCompany = await tools(env, 303);
  assert.deepEqual([noCompany.code.state, noCompany.syncs.state], ['not_recorded', 'not_recorded']);
  db.close();
});

test('each sync is a line: what arrived per module, newest first, and only GitHub\'s company-enabled syncs', async () => {
  // Mutation checked: order oldest first → the 2026-10-17 line leads.
  const { db, env } = fixture(); github(db);
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type) VALUES (32, 'st-one', 1, 'stripe', 'active', 'oauth2');
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (32, 10, 1);`);
  syncLog(db, 1, '2026-10-17 08:00:00', 'ok', 'Synced 1 issues…', { issues: 1, pull_requests: 0, releases: 0, repositories: ['acme/app'] });
  syncLog(db, 2, '2026-10-18 09:00:00', 'ok', 'Synced 12 issues…', { issues: 12, pull_requests: 3, releases: 2, roadmap_items_created: 4, repositories: ['acme/app', 'acme/site'], repositories_more: 1 });
  syncLog(db, 3, '2026-10-18 10:00:00', 'ok', 'Stripe', { charges: 5 }, 32, 'stripe');
  const s = (await tools(env)).syncs;
  assert.equal(s.state, 'ok');
  assert.deepEqual(s.rows.map((r: any) => r.at), ['2026-10-18 09:00:00', '2026-10-17 08:00:00'], 'Stripe\'s sync is not GitHub\'s line');
  const [line] = s.rows;
  assert.deepEqual([line.provider, line.state, line.repositories, line.repositories_more, line.error], ['GitHub', 'done', ['acme/app', 'acme/site'], 1, null]);
  assert.equal(line.text, '12 issues → Product roadmap, 3 pull requests → Prototype / MVP, 2 releases counted');
  assert.deepEqual(line.arrived.map((a: any) => [a.module, a.count, a.stored]), [['product_roadmap', 12, true], ['prototype_mvp', 3, true], ['product_roadmap', 2, false]]);
  assert.equal(s.rows[1].text, '1 issue → Product roadmap, 0 pull requests → Prototype / MVP, 0 releases counted');
  // An outsider reads the lines without the repository names.
  assert.equal((await tools(env, 101, 4)).syncs.rows[0].repositories, null);
  db.close();
});

test('a failed sync shows its words and never a token; a partial one says so; an old row with no counts reads Not recorded', async () => {
  // Mutation checked: show response_summary as stored → the token reaches the page.
  const { db, env } = fixture(); github(db);
  syncLog(db, 1, '2026-10-18 09:00:00', 'error', 'github_api_failed: 401 /repos/acme/app/issues Bearer ghs_FIXTUREnotARealToken1234567890 token=abc', undefined);
  syncLog(db, 2, '2026-10-18 08:00:00', 'ok', 'Partly synced', { issues: 100, pull_requests: 0, releases: 0, partial: true, repositories: ['acme/app'] });
  syncLog(db, 3, '2026-10-18 07:00:00', 'ok', 'Synced', undefined);
  const r = await call(env, '/api/cycles/build/modules/operating-systems?project=101');
  const [failed, partial, old] = r.body.parts.tools.syncs.rows;
  assert.deepEqual([failed.state, failed.text, failed.arrived], ['failed', null, []]);
  assert.equal(failed.error, '401 /repos/acme/app/issues [hidden] [hidden]');
  assert.ok(!JSON.stringify(r.body).includes('ghs_FIXTURE'), 'the token is nowhere in the read');
  assert.deepEqual([partial.state, partial.text], ['partial', '100 issues → Product roadmap, 0 pull requests → Prototype / MVP, 0 releases counted']);
  assert.deepEqual([old.state, old.text, old.repositories], ['done', 'Not recorded', null]);
  db.close();
});

test('at most SYNC_LINES lines', async () => {
  const { db, env } = fixture(); github(db);
  for (let i = 1; i <= 25; i++) syncLog(db, i, `2026-10-${String(i).padStart(2, '0')} 09:00:00`, 'ok', 'Synced', { issues: i });
  const rows = (await tools(env)).syncs.rows;
  assert.equal(rows.length, 20);
  assert.equal(rows[0].at, '2026-10-25 09:00:00');
  db.close();
});

test('the sync route keeps the repositories on the log row, and the row stays readable', async () => {
  // Mutation checked: log `out.counts` alone → the line has no repositories.
  const { db, env } = fixture();
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, status, auth_type, config_json) VALUES (41, 'fx-sync', 1, 'figma', 'active', 'oauth2', '{}');
    INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (41, 10, 1);`);
  const many = Array.from({ length: 50 }, (_, i) => `acme-organisation-with-a-long-name/repository-number-${i}`);
  registerProvider({ key: 'figma', async buildAuthorizeUrl() { return 'https://provider.example.test/'; },
    async connect() { return { credentials: {}, scopes: [] }; },
    async sync() { return { summary: 'Synced', counts: { issues: 2 }, repositories: many }; } } as any);
  const r = await call(env, '/api/connectors/fx-sync/sync', 1, 'POST');
  assert.equal(r.status, 200);
  const raw = (db.prepare("SELECT payload_json FROM integration_logs WHERE event_type = 'sync'").get() as any).payload_json;
  const payload = JSON.parse(raw);
  assert.equal(payload.issues, 2);
  assert.ok(payload.repositories.length > 0 && payload.repositories.length < 50);
  assert.equal(payload.repositories.length + payload.repositories_more, 50);
  assert.ok(raw.length < 4000, 'well under logEvent\'s cut');
  assert.deepEqual(syncLogPayload({ counts: { issues: 1 } }), { issues: 1 }, 'a sync with no repositories logs its counts as before');
  assert.ok(payload.repositories.join(' , ').length <= SYNC_LOG_REPOSITORY_CHARS);
  db.close();
});

test('the connector page claims only the feeds the code builds', () => {
  // Mutation checked: put "Releases → Product roadmap" back in `pulls` → its store is null.
  const meta = CONNECTOR_METADATA.github;
  const stored = new Map(GITHUB_LANDINGS.filter((l) => l.store !== null).map((l) => [l.what, l.module]));
  for (const p of meta.pulls) {
    const fromLanding = stored.get(p.what);
    const readsConnection = (GITHUB_READ_BY as readonly string[]).includes(p.module);
    assert.ok(fromLanding === p.module || readsConnection, `"${p.what} → ${p.module}" is a feed the code builds`);
  }
  assert.deepEqual([...meta.feeds].sort(), [...githubFedModules()].sort(), 'feeds are exactly the built modules');
  assert.deepEqual([...new Set(meta.pulls.map((p) => p.module))].sort(), [...githubFedModules()].sort(), 'every built module is named in pulls');
  assert.deepEqual(publicDescriptor(getDescriptor('github')!).feeds, meta.feeds);
  // The page's read tools name only a built module, and the one that matches their kind.
  const page = CONNECTOR_PAGES.github as any;
  for (const t of page.tools.filter((x: any) => x.lands_in)) assert.ok(githubFedModules().includes(t.lands_in), `${t.name} → ${t.lands_in}`);
  const toolFor = (name: string) => page.tools.find((x: any) => x.name === name)?.lands_in ?? null;
  // #2114: decision records and docs land as Solution design's notes, languages and topics as its stack.
  assert.deepEqual([toolFor('read_issues'), toolFor('read_pull_requests'), toolFor('read_releases'), toolFor('read_design_docs'), toolFor('read_stack')], GITHUB_LANDINGS.map((l) => l.store === null ? null : l.module));
  // The long description names every built module.
  const words = page.long_description.join(' ');
  for (const m of githubFedModules()) assert.ok(words.includes(MODULE_LABELS[m]), `the page names ${MODULE_LABELS[m]}`);
  // And the sync writes each stored landing into its store, through the ledger.
  const src = ['github.ts', 'github/solutionDesign.ts'].map((f) => readFileSync(`cloudflare-worker/src/integrations/providers/${f}`, 'utf8')).join('\n');
  for (const l of GITHUB_LANDINGS) {
    assert.ok(src.includes(`'${l.module}', '${l.kind}'`), `the sync records ${l.kind} under ${l.module}`);
    if (l.store) assert.ok(src.includes(`INSERT INTO ${l.store} `), `the sync lands ${l.kind} in ${l.store}`);
  }
});

test('the sync words and the error words, alone', () => {
  assert.deepEqual(syncArrivals(null), []);
  assert.deepEqual(syncArrivals({ issues: -1, pull_requests: 1.5, releases: 'x' }), [], 'only whole, non-negative figures');
  assert.equal(syncArrivalsText([]), 'Not recorded');
  assert.equal(syncArrivalsText(syncArrivals({ pull_requests: 1 })), '1 pull request → Prototype / MVP');
  assert.equal(syncErrorWords('github_no_repositories: choose repositories first.'), 'choose repositories first.');
  assert.equal(syncErrorWords(''), 'The sync did not complete.');
  assert.equal(syncErrorWords('github_api_failed: 500 ' + 'gho_' + 'A'.repeat(20)), '500 [hidden]');
  assert.equal(syncErrorWords('x: github_pat_' + 'B'.repeat(30)), '[hidden]');
  assert.ok(!syncErrorWords('failed ' + 'c'.repeat(40)).includes('c'.repeat(40)), 'a long opaque string is hidden');
});
