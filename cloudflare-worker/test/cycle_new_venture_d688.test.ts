import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { figureValue } from '../../frontend/src/pages/cycles/cycleModel.js';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const migration = readFileSync('cloudflare-worker/sql/migrations/441_build_cycle_stores.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0);
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
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
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT, last_synced_at TEXT, last_error_at TEXT, config_json TEXT);
    CREATE TABLE cap_table_scenarios(id INTEGER PRIMARY KEY, project_id INTEGER, is_variant INTEGER DEFAULT 0, inputs_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    INSERT INTO users(id, role, founder_id, name) VALUES (1, 'founder', 11, 'One'), (2, 'founder', 22, 'Two'), (3, 'admin', NULL, 'Admin');
    INSERT INTO projects(id, founder_id, company_id, entity_id) VALUES (101, 11, 10, 501), (202, 22, 20, 502);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
    INSERT INTO entities VALUES (501, 'DE'), (502, 'NY');
  `);
  db.exec(migration);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/455_core_systems_workspace.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/461_build_record_stores.sql', 'utf8'));
  db.exec('CREATE TABLE google_oauth_tokens(user_id INTEGER PRIMARY KEY); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER PRIMARY KEY)');
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/build', build);
app.onError((error, c) => c.json({ error: error.message }, 500));
async function call(env: any, path: string, user = 1, method = 'GET', body?: unknown) {
  const token = await new SignJWT({ user_id: user, role: user === 3 ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: response.status, body: await response.json() as any };
}

const emptyBuild = [
  ['solution-design', 'No features yet. Linked and unlinked features appear here.', 'Add feature', '/build/solution-design?project=101&add=1'],
  ['prototype-mvp', 'No must-haves yet. The burn-up toward the ship date appears here.', 'Add must-have', '/build/prototype-mvp?project=101&add=1'],
  ['product-roadmap', 'No roadmap items yet. Now, Next and Later appear here.', 'Add item', '/build/roadmap?project_id=101'],
  ['founding-team', 'No founders yet. The equity split and vesting appear here.', 'Add founder', '/raise/capital/cap-table'],
  ['company-creation', 'No filings yet. Formation steps and their dates appear here.', 'Add filing', '/build/company-creation?project=101&add=1'],
  ['operating-systems', 'No systems connected yet. Each system and its state appear here.', 'Connect a system', '/build/connect?project_id=101'],
] as const;

test('D688: a new Build venture has six actionable empty cards, null figures and first-feature focus', async () => {
  const { db, env } = fixture();
  const { status, body } = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(status, 200);
  assert.deepEqual(body.cards.map((c: any) => [c.slug, c.reason, c.next?.text, c.next?.href]), emptyBuild);
  assert.ok(body.cards.every((c: any) => c.state === 'empty' && c.series.length === 0));
  assert.ok(body.figures.every((f: any) => f.value === null && f.state !== 'ok'));
  assert.deepEqual([body.focus.rule, body.focus.eyebrow, body.focus.headline, body.focus.why, body.focus.cta, body.focus.then],
    ['first_feature', 'Build · Next', 'Add the first feature.', 'Nothing in Build is recorded yet. Each chart fills as you add to its module.', { label: 'Add feature', href: emptyBuild[0][3] }, null]);
  db.close();
});

test('D688: no company keeps operating systems and its figure not recorded, with first-feature focus', async () => {
  const { db, env } = fixture();
  db.exec('UPDATE projects SET company_id = NULL WHERE id = 101');
  const { body } = await call(env, '/api/cycles/build/overview?project=101');
  assert.deepEqual(body.cards.slice(0, 5).map((c: any) => c.state), Array(5).fill('empty'));
  assert.deepEqual([body.cards[5].state, body.cards[5].reason], ['not_recorded', 'This project has no company scope for connectors.']);
  assert.deepEqual([body.figures[3].state, body.figures[3].value, body.figures[3].reason], ['not_recorded', null, 'The project has no company scope.']);
  assert.equal(body.focus.rule, 'first_feature');
  db.close();
});

test('D688: one feature changes only Solution design; an unvalued founder or unreadable card suppresses focus', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO mvp_features(id, project_id, title) VALUES (1, 101, 'First feature')");
  let { body } = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(body.cards[0].state, 'ok');
  assert.deepEqual(body.cards.slice(1).map((c: any) => c.state), Array(5).fill('empty'));
  assert.equal(body.focus, null);
  db.exec('DELETE FROM mvp_features');
  db.exec("INSERT INTO cap_table_holders(id, user_id, project_id, name, founder_role) VALUES (1, 1, 101, 'Founder', 'CEO')");
  ({ body } = await call(env, '/api/cycles/build/overview?project=101'));
  assert.equal(body.cards[3].state, 'not_recorded');
  assert.equal(body.focus, null);
  db.exec('DELETE FROM cap_table_holders');
  db.exec('DROP TABLE venture_risks');
  ({ body } = await call(env, '/api/cycles/build/overview?project=101'));
  assert.equal(body.cards[0].state, 'unreadable');
  assert.equal(body.focus, null);
  db.close();
});

test('D688: an item or a mapped but inactive system turns missing counts into counted zero', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO roadmap_okrs(id, project_id, objective, kanban_status) VALUES (1, 101, 'First item', 'now')");
  db.exec("INSERT INTO project_core_systems(project_id, kind, integration_id, updated_by) VALUES (101, 'crm', NULL, 1)");
  const { body } = await call(env, '/api/cycles/build/overview?project=101');
  assert.deepEqual([body.figures[2].state, body.figures[2].value], ['ok', 0]);
  assert.deepEqual([body.figures[3].state, figureValue(body.figures[3])], ['ok', '0 of 5']);
  db.close();
});

test('D688: an existing unmapped tool keeps its reconnect action, not the new-venture prompt', async () => {
  const { db, env } = fixture();
  db.exec("INSERT INTO integrations(id,user_id,provider_key,display_name,status) VALUES (1,1,'hubspot','HubSpot','error')");
  db.exec('INSERT INTO integration_companies(integration_id,company_id,enabled) VALUES (1,10,1)');
  const { body } = await call(env, '/api/cycles/build/overview?project=101');
  assert.equal(body.cards[5].state, 'ok');
  assert.match(body.cards[5].next?.text, /^Reconnect HubSpot/);
  assert.equal(body.focus, null);
  assert.equal(body.figures[3].value, null, 'no core mapping makes Systems connected Not recorded');
  db.close();
});

const base = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const mig = (name: string) => readFileSync(`cloudflare-worker/sql/migrations/${name}`, 'utf8');
const migrations = 'cloudflare-worker/sql/migrations';
const file = (number: string) => mig(readdirSync(migrations).find(name => name.startsWith(`${number}_`))!);
const ddl = (number: string) => file(number).split(/;\s*\n/).map(s => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(s => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map(s => `${s};`).join('\n');

function raiseFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const table of ['users', 'projects', 'activity_logs', 'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens',
    'deck_share_views', 'data_room_folders', 'data_room_files', 'data_room_access_log', 'cap_table_scenarios',
    'raise_prospects', 'raise_rounds', 'contacts']) db.exec(tableFromBaseline(base, table));
  const cols = (table: string) => new Set((db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as any[]).map(row => row.name));
  if (!cols('pitch_deck_share_tokens').has('revoked_at')) db.exec('ALTER TABLE pitch_deck_share_tokens ADD COLUMN revoked_at TEXT');
  for (const [col, type] of [['amount', 'REAL'], ['close_id', 'INTEGER'], ['commit_status', 'TEXT'], ['instrument', 'TEXT']]) {
    if (!cols('raise_prospects').has(col)) db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${col} ${type}`);
  }
  db.exec(mig('249_project_metrics.sql'));
  db.exec(mig('442_raise_cycle_stores.sql'));
  db.exec(mig('463_raise_record_stores.sql'));
  db.exec("INSERT INTO users(id, role, name, email, is_active, founder_id) VALUES (10, 'founder', 'Test Founder', 'founder@example.test', 1, 1001)");
  db.exec("INSERT INTO projects(id, name, founder_id) VALUES (1, 'Sample Venture', 1001)");
  return db;
}

async function raiseCall(db: DatabaseSync, path: string) {
  const token = await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const raise = new Hono<any>(); raise.route('/api/cycles/raise', cycleRaise);
  const response = await raise.request(`/api/cycles/raise${path}`, { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: response.status, body: await response.json() as any };
}

async function growFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT, spinout_lab_active INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, deleted_at TEXT);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, action TEXT, details TEXT, user_id INTEGER, entity_type TEXT, entity_id TEXT);
    CREATE TABLE waitlist_signups (id INTEGER PRIMARY KEY, project_id INTEGER, email TEXT, audience TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE spinout_lab_milestones (id INTEGER PRIMARY KEY, user_id INTEGER, week INTEGER, milestone_key TEXT, completed_at TEXT);`);
  db.exec(tableFromBaseline(base, 'entities'));
  db.exec(tableFromBaseline(base, 'compliance_events'));
  for (const number of ['034', '119', '127', '132', '326']) db.exec(ddl(number));
  db.exec(file('311'));
  db.exec('ALTER TABLE contacts ADD COLUMN utm_json TEXT');
  db.exec(ddl('125')); db.exec(file('437')); db.exec(file('443'));
  db.exec("INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 10, 'Test Founder', 'founder@example.test')");
  db.exec("INSERT INTO projects(id, uid, name, founder_id, company_id) VALUES (7, 'venture7', 'Sample Venture', 10, 70)");
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureProjectMetricsSchema(env);
  return { db, env };
}

async function growCall(env: any, path: string) {
  const token = await new SignJWT({ user_id: 1, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const grow = new Hono<any>(); grow.route('/api/cycles/grow', cycleGrow);
  const response = await grow.request(`/api/cycles/grow${path}`, { headers: { Authorization: `Bearer ${token}` } }, env);
  return { status: response.status, body: await response.json() as any };
}

test('D688: new Raise cards pin the seven lines and actions; figures stay null', async () => {
  const db = raiseFixture();
  const { status, body } = await raiseCall(db, '/overview?project=1');
  assert.equal(status, 200);
  assert.deepEqual(body.cards.map((c: any) => [c.state, c.reason, c.next?.text, c.next?.href]), [
    ['empty', 'No readiness score yet. Readiness by evidence appears here.', 'Score readiness', '/raise/fundraising-readiness?project=1&add=1'],
    ['empty', 'No narrative saved yet. Each version appears here.', 'New version', '/raise/investor-narrative?project=1&add=1'],
    ['empty', 'No deck yet. Views per week appear here.', 'Build your deck', '/raise/pitch'],
    ['empty', 'No files yet. Coverage of the diligence checklist appears here.', 'Upload', '/raise/data-room?mode=workspace'],
    ['empty', 'No holders yet. Ownership before and after the round appears here.', 'Add holder', '/raise/capital/cap-table'],
    ['empty', 'No split yet. The planned split and runway appear here.', 'Edit split', '/raise/capital/model'],
    ['empty', 'No investors yet. The pipeline by stage appears here.', 'Add investor', '/raise/capital/pipeline'],
  ]);
  assert.ok(body.figures.every((f: any) => f.value === null && f.state !== 'ok'));
  db.close();
});

test('D688: new Grow cards pin the seven lines and actions; figures stay null', async () => {
  const { db, env } = await growFixture();
  const { status, body } = await growCall(env, '/overview?project=7');
  assert.equal(status, 200);
  assert.deepEqual(body.cards.map((c: any) => [c.state, c.reason, c.next?.text, c.next?.href]), [
    ['empty', 'No feedback yet. Themes by volume appear here.', 'Log feedback', '/grow/product-improvement?project=7&add=1'],
    ['empty', 'No channels yet. Cost per customer by channel appears here.', 'Add channel', '/grow/distribution?project=7&add=1'],
    ['empty', 'No KPIs yet. MRR and retention appear here.', 'Enter a KPI', '/grow/focus?project_id=7'],
    ['empty', 'No open roles yet. Headcount against the plan appears here.', 'Open a role', '/jobs/new'],
    ['empty', 'No partners yet. Partners by stage appear here.', 'Add partner', '/grow/partner-network?project=7&add=1'],
    ['empty', 'No markets yet. Readiness by market appears here.', 'Add market', '/grow/market-expansion?project=7&add=1'],
    ['empty', 'No obligations yet. The compliance calendar appears here.', 'Add obligation', '/grow/durable-company-building?project=7&add=1'],
  ]);
  assert.ok(body.figures.every((f: any) => f.value === null && f.state !== 'ok'));
  db.close();
});

test('D688: Raise deck with no views keeps its Share action, and tool actions agree with records.add', async () => {
  const db = raiseFixture();
  db.exec("INSERT INTO pitch_decks(id, project_id, version, slides) VALUES (5, 1, 1, '[]')");
  const { body } = await raiseCall(db, '/overview?project=1');
  assert.deepEqual([body.cards[2].reason, body.cards[2].next?.text], ['No one has opened a deck link yet.', 'Share the deck with an investor']);
  for (const slug of ['pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships']) {
    const card = body.cards.find((entry: any) => entry.slug === slug);
    const module = await raiseCall(db, `/modules/${slug}?project=1`);
    assert.equal(card.next.href, module.body.records.add.href, slug);
  }
  const narrative = await raiseCall(db, '/modules/investor-narrative?project=1');
  assert.equal(narrative.body.records.add, undefined, 'no self-link instead of New version form');
  db.close();
});

test('D688: Grow distinguishes no store from a record outside the visible range, and no company from an empty roster', async () => {
  const { db, env } = await growFixture();
  db.exec("INSERT INTO product_feedback(uid, project_id, body, source, created_at) VALUES ('old', 7, 'Old feedback', 'team', '2020-01-01')");
  db.exec("INSERT INTO compliance_events(project_id, jurisdiction, event_type, title, due_date) VALUES (7, 'Unspecified', 'other', 'Future filing', date('now', '+120 days'))");
  let { body } = await growCall(env, '/overview?project=7');
  assert.equal(body.cards[0].reason, 'No feedback logged in the last 90 days');
  assert.equal(body.cards[6].reason, 'No obligation falls due in the next 90 days.');
  db.exec("INSERT INTO project_metrics(project_id, snapshot_date, mrr) VALUES (7, date('now'), 1000)");
  ({ body } = await growCall(env, '/overview?project=7'));
  assert.equal(body.cards[2].reason, 'No recurring revenue on the ledger yet');
  db.exec('UPDATE projects SET company_id = NULL WHERE id = 7');
  ({ body } = await growCall(env, '/overview?project=7'));
  assert.deepEqual([body.cards[3].state, body.cards[3].reason], ['not_recorded', 'Not recorded: this venture has no company roster yet']);
  const headcount = body.figures.find((entry: any) => entry.key === 'headcount');
  assert.equal(headcount.state, 'not_recorded');
  assert.equal(headcount.value, null);
  db.close();
});
