/**
 * D8774 (#8774) — a connected tool is said to feed THIS venture only when the
 * account connection, its company and (for GitHub) the venture's repositories
 * all hold, on real SQL (node:sqlite) and real JWT routes:
 *
 *   1. `projectBinding` tells apart no company, company off, another venture,
 *      no repository, failing, not read, stale, no items and healthy;
 *   2. Operating systems' Code system carries that binding, with the last
 *      successful read of the venture (a sync row names its venture; an older
 *      row counts only after the latest repository choice for this venture);
 *   3. a venture in no company: the owner's card offers Link to a company,
 *      anyone else's offers nothing; the viewer's own GitHub is named at
 *      account scope only;
 *   4. stopping a company lets go of GitHub's venture and repositories in the
 *      same write, and a sync's log row names the venture it read.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/connector_scope_8774.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import integrations, { releasedConfig, syncLogPayload } from '../src/routes/integrations.ts';
import { NO_COMPANY_REASON, STALE_AFTER_HOURS, projectBinding } from '../src/services/connectorBinding.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'q'.repeat(64); // synthetic test fixture
const mig = (n: string) => readFileSync(`cloudflare-worker/sql/migrations/${n}`, 'utf8');
const NOW = Date.parse('2026-11-20T12:00:00Z');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, email TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0, subscription_tier TEXT DEFAULT 'free');
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE company_profiles(id INTEGER PRIMARY KEY, archived_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT UNIQUE, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT DEFAULT 'active', auth_type TEXT,
      credentials_enc TEXT, webhook_secret_enc TEXT, config_json TEXT, capabilities_json TEXT, scopes_json TEXT, external_account_id TEXT, external_account_name TEXT,
      last_synced_at TEXT, last_error TEXT, last_error_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER DEFAULT 1, UNIQUE(integration_id, company_id));
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
    INSERT INTO users(id, role, founder_id, name, email) VALUES (1, 'founder', 11, 'Maya Sample', 'maya@example.test'), (2, 'founder', 22, 'Noah Sample', 'noah@example.test'), (3, 'admin', NULL, 'Admin', 'admin@example.test'), (4, 'partner', NULL, 'Partner', 'partner@example.test');
    INSERT INTO company_profiles(id) VALUES (10), (20);
    INSERT INTO projects(id, founder_id, company_id) VALUES (101, 11, 10), (102, 11, 10), (303, 11, NULL);
    INSERT INTO user_company_links VALUES (1, 10), (1, 20), (2, 10);
  `);
  for (const m of ['441_build_cycle_stores.sql', '445_connector_fed_items.sql', '455_core_systems_workspace.sql', '459_cycle_activity_convention.sql', '461_build_record_stores.sql']) db.exec(mig(m));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  return { db, env };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/build', build);
  a.route('/api/integrations', integrations);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1, init: RequestInit = {}) {
  const role = id === 4 ? 'partner' : id === 3 ? 'admin' : 'founder';
  const token = await new SignJWT({ user_id: id, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) } }, env);
  return { status: r.status, body: await r.json() as any };
}
const tools = async (env: any, project = 101, id = 1) => { const r = await call(env, `/api/cycles/build/modules/operating-systems?project=${project}`, id); return r.body.parts.tools; };

/** A GitHub connection of user 1, enabled for company 10, with this config. */
function github(db: any, config: unknown, status = 'active') {
  db.prepare(`INSERT INTO integrations(id, uid, user_id, provider_key, display_name, status, auth_type, config_json, last_synced_at, last_error_at)
    VALUES (31, 'gh-31', 1, 'github', 'Maya GitHub', ?, 'oauth2', ?, '2026-10-18 09:00:00', ?)`).run(status, JSON.stringify(config), status === 'error' ? '2026-10-20 07:00:00' : null);
  db.exec(`INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (31, 10, 1), (31, 20, 1)`);
}
function log(db: any, id: number, event: string, status: string, payload: unknown, at: string) {
  db.prepare(`INSERT INTO integration_logs(id, integration_id, user_id, provider_key, direction, event_type, status, response_summary, payload_json, created_at)
    VALUES (?, 31, 1, 'github', 'outbound', ?, ?, 'x', ?, ?)`).run(id, event, status, payload === undefined ? null : JSON.stringify(payload), at);
}

test('1. projectBinding names each state apart, and says a module is fed only when every scope holds', () => {
  // Mutation checked: `company === 'off'` read as on → company_off becomes no_repo; the 24-hour rule dropped → stale reads healthy;
  // a zero count read as healthy → no_items is lost; `other_venture` folded into no_repo → it is lost.
  const base = { providerKey: 'github', status: 'active', companyId: 10, companyEnabled: true, projectId: 101, lastGoodRead: null, fedTotal: 0, sees: true, now: NOW };
  const cfg = (c: unknown) => JSON.stringify(c);
  const read = (at: string) => ({ at, source: 'GitHub sync', repositories: ['acme/app'], partial: false });
  const s = (over: any) => projectBinding({ ...base, configJson: cfg({ project_id: 101, repositories: ['acme/app'] }), ...over });
  const none = s({ companyId: null });
  assert.deepEqual([none.state, none.effective, none.reason, none.scopes, none.feeds_after_sync], ['no_company', false, NO_COMPANY_REASON, { account: 'connected', company: 'none', venture: 'bound' }, []]);
  assert.equal(s({ companyEnabled: false }).state, 'company_off');
  assert.equal(s({ companyEnabled: false }).effective, false);
  const other = s({ configJson: cfg({ project_id: 102, repositories: ['acme/app'] }) });
  assert.deepEqual([other.state, other.effective, other.scopes.venture], ['other_venture', false, 'other_venture']);
  const noRepo = s({ configJson: cfg({ project_id: 101, repositories: [] }) });
  assert.deepEqual([noRepo.state, noRepo.effective], ['no_repo', false]);
  assert.ok(noRepo.feeds_after_sync.includes('Product roadmap') && noRepo.feeds_after_sync.includes('Prototype / MVP'), 'what will feed after sync, with no counts');
  assert.equal(s({ configJson: cfg({}) }).state, 'no_repo', 'a connection that chose nothing yet');
  assert.equal(s({}).state, 'not_read');
  const failing = s({ status: 'error', lastGoodRead: read('2026-11-20 06:00:00') });
  assert.deepEqual([failing.state, failing.effective, failing.stale], ['failing', true, { since: '2026-11-20 06:00:00', hours: 6 }], 'Q3 A: stale as soon as the latest sync fails');
  const stale = s({ lastGoodRead: read('2026-11-19 11:00:00'), fedTotal: 3 });
  assert.deepEqual([stale.state, stale.stale], ['stale', { since: '2026-11-19 11:00:00', hours: 25 }]);
  assert.equal(STALE_AFTER_HOURS, 24);
  assert.equal(s({ lastGoodRead: read('2026-11-19 13:00:00'), fedTotal: 3 }).state, 'healthy', '23 hours is not stale yet');
  const zero = s({ lastGoodRead: read('2026-11-20 11:00:00'), fedTotal: 0 });
  assert.deepEqual([zero.state, zero.effective], ['no_items', true]);
  assert.match(zero.reason, /measured zero/);
  // A tool that does not record a venture is bound once its company holds.
  assert.equal(projectBinding({ ...base, providerKey: 'vercel', configJson: null, lastGoodRead: read('2026-11-20 11:00:00'), fedTotal: 1 }).state, 'healthy');
});

test('2. the Code system carries the binding and the last successful read of THIS venture', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW }); // the read's age is measured against a fixed clock
  // Mutation checked: the untagged-row branch without the `repositories_chosen` bound → the read from before the choice counts;
  // the tagged branch matching any project → venture 102's read is shown on 101; the binding read with companyEnabled false → company_off.
  const { db, env } = fixture();
  github(db, { project_id: 101, repositories: ['acme/app'] });
  log(db, 1, 'sync', 'ok', { issues: 2 }, '2026-10-01 09:00:00'); // before the choice: not this venture's read
  log(db, 2, 'repositories_chosen', 'ok', { repositories: ['acme/app'], project_id: 101 }, '2026-10-02 09:00:00');
  log(db, 3, 'sync', 'ok', { issues: 1, project_id: 102 }, '2026-10-03 09:00:00'); // another venture's read
  let code = (await tools(env)).code;
  assert.deepEqual([code.systems[0].binding.state, code.systems[0].binding.last_good_read], ['not_read', null]);
  log(db, 4, 'sync', 'ok', { issues: 3, repositories: ['acme/app'] }, '2026-10-04 09:00:00'); // untagged, after the choice for 101
  code = (await tools(env)).code;
  assert.deepEqual(code.systems[0].binding.last_good_read, { at: '2026-10-04 09:00:00', source: 'GitHub sync', repositories: ['acme/app'], partial: false });
  assert.equal(code.systems[0].binding.state, 'stale', 'weeks old');
  log(db, 5, 'sync', 'ok', { issues: 0, project_id: 101, repositories: ['acme/app'], partial: true }, '2026-11-20 11:00:00');
  log(db, 6, 'sync', 'error', undefined, '2026-11-20 11:00:00'); // a failure is never a read
  code = (await tools(env)).code;
  assert.equal(code.systems[0].binding.last_good_read.partial, true);
  assert.equal(code.systems[0].binding.state, 'no_items', 'read recently, nothing landed');
  db.exec(`INSERT INTO connector_fed_items(integration_id, project_id, module, kind, external_id, local_table, local_id) VALUES (31, 101, 'product_roadmap', 'issue', 'issue:acme/app#1', 'roadmap_okrs', 1)`);
  assert.equal((await tools(env)).code.systems[0].binding.state, 'healthy');
  // The same connection read from venture 102 feeds another venture there.
  const there = (await tools(env, 102)).code.systems[0].binding;
  assert.deepEqual([there.state, there.effective, there.last_good_read?.at], ['other_venture', false, '2026-10-03 09:00:00'], 'venture 102 has its own read');

  assert.equal((await tools(env, 101, 3)).code.systems[0].binding.last_good_read.repositories, null, 'someone outside the company reads the date, never the names');
  db.close();
});

test('2b. failing and no repository read as such on the Code system', async () => {
  const { db, env } = fixture();
  github(db, { project_id: 101, repositories: [] });
  const none = (await tools(env)).code.systems[0].binding;
  assert.deepEqual([none.state, none.effective], ['no_repo', false]);
  db.exec(`UPDATE integrations SET status = 'error', config_json = '{"project_id":101,"repositories":["acme/app"]}'`);
  const failing = (await tools(env)).code.systems[0].binding;
  assert.deepEqual([failing.state, failing.stale.since], ['failing', null]);
  db.close();
});

test('3. a venture in no company: the owner is offered Link to a company; the viewer\'s GitHub is account scope only', async () => {
  // Mutation checked: linkNext without isProjectManager → the partner is offered it; accountGithub left out → `account` is null.
  const { db, env } = fixture();
  github(db, { project_id: 101, repositories: ['acme/app'] });
  const overview = async (id: number) => (await call(env, '/api/cycles/build/overview?project=303', id)).body.cards.find((c: any) => c.slug === 'operating-systems');
  const mine = await overview(1);
  assert.deepEqual([mine.state, mine.reason, mine.next], ['not_recorded', NO_COMPANY_REASON, { text: 'Link to a company', href: '/build/connect?project_id=303&link=company' }]);
  const partner = await overview(4);
  assert.equal(partner?.next ?? null, null, 'the partner cannot link it, so the card offers nothing');
  const t = await tools(env, 303);
  assert.deepEqual([t.code.state, t.code.reason, t.code.account], ['not_recorded', NO_COMPANY_REASON, { provider: 'GitHub', state: 'connected' }]);
  // With a company whose GitHub is not on: the viewer's own is named at account scope.
  db.exec('DELETE FROM integration_companies');
  const off = (await tools(env, 101)).code;
  assert.deepEqual([off.state, off.account], ['empty', { provider: 'GitHub', state: 'connected' }]);
  assert.match(off.reason, /connected to your account but not turned on/);
  assert.equal((await tools(env, 101, 3)).code.account, null, 'a viewer with no GitHub of their own');
  db.close();
});

test('4. stopping a company lets go of the venture and its repositories; a sync row names its venture', async () => {
  // Mutation checked: `releasedConfig` left out of the batch → project_id survives; it ignoring the kept companies → keeping 10 drops it too.
  const { db, env } = fixture();
  github(db, { project_id: 101, repositories: ['acme/app'], installations: [7] });
  const config = () => JSON.parse(String((db.prepare('SELECT config_json FROM integrations WHERE id = 31').get() as any).config_json));
  const keep = await call(env, '/api/integrations/gh-31/companies', 1, { method: 'PUT', body: JSON.stringify({ company_ids: [10] }) });
  assert.equal(keep.status, 200);
  assert.equal(keep.body.project_released, undefined);
  assert.deepEqual(config(), { project_id: 101, repositories: ['acme/app'], installations: [7] }, 'its venture\'s company is still on');
  const stop = await call(env, '/api/integrations/gh-31/companies', 1, { method: 'PUT', body: JSON.stringify({ company_ids: [20] }) });
  assert.deepEqual([stop.status, stop.body.project_released, stop.body.company_ids], [200, true, [20]]);
  assert.deepEqual(config(), { installations: [7] });
  // The pure rule: no venture named changes nothing; a venture gone is let go.
  assert.equal(await releasedConfig(env, '{"repositories":["a/b"]}', []), null);
  assert.equal(await releasedConfig(env, '{"project_id":999,"repositories":["a/b"]}', [10]), '{}');
  // A sync that read a venture names it on its log row.
  assert.deepEqual(syncLogPayload({ counts: { issues: 1 }, repositories: ['a/b'], project_id: 101 }), { issues: 1, repositories: ['a/b'], project_id: 101 });
  assert.deepEqual(syncLogPayload({ counts: { issues: 1 } }), { issues: 1 });
  db.close();
});
