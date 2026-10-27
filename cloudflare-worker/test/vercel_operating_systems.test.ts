/**
 * D1097 (#2962, part 2 of #2408) — Vercel's production health events
 * (migration 590) and the Hosting block on Operating systems › Tools.
 *
 *   · each health kind opens on evidence and closes when it clears; a partial
 *     read closes nothing it could not check; every opened row is a ledger row;
 *   · a dismissed event never comes back while its evidence holds;
 *   · the Hosting read: empty, Unreadable on its own, and the Tools rule (a
 *     non-member reads the counts, never a domain); GitHub's Code system
 *     unchanged.
 *
 * Real SQL on node:sqlite and real JWT routes, on D782's fixture. Vercel is
 * never called: the evidence is fixture data in the shapes `services/vercel/api.ts`
 * types.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/vercel_operating_systems.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { EXPIRY_WINDOW_DAYS, HEALTH_KINDS, applyHealth, fedKey, healthFindings } from '../src/services/vercel/health.ts';
import { PART1_WAIT, SYNC_WAIT } from '../src/services/vercel/hosting.ts';
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
  for (const m of ['441_build_cycle_stores.sql', '445_connector_fed_items.sql', '455_core_systems_workspace.sql', '459_cycle_activity_convention.sql', '461_build_record_stores.sql', '590_vercel_health_events.sql']) db.exec(mig(m));
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'fixture-cipher-key-'.repeat(4) } as any;
  return { db, env };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/build', build);
  a.onError((e, c) => c.json({ error: e.message }, 500));
  return a;
})();
async function call(env: any, path: string, id = 1, method = 'GET') {
  const token = await new SignJWT({ user_id: id, role: id === 3 ? 'admin' : id === 4 ? 'partner' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'X-Company-Id': '10', 'Content-Type': 'application/json' } }, env);
  return { status: r.status, body: await r.json() as any };
}
const tools = async (env: any, project = 101, id = 1) => (await call(env, `/api/cycles/build/modules/operating-systems?project=${project}`, id)).body.parts.tools;
const rowsOf = (db: any, sql: string, ...b: unknown[]) => db.prepare(sql).all(...b).map((r: any) => ({ ...r }));

/** Member 1's Vercel connection (id 50), enabled for company 10. */
function vercel(db: any) {
  db.exec(`INSERT INTO integrations(id, uid, user_id, provider_key, display_name, status, last_synced_at) VALUES (50, 'vc-1', 1, 'vercel', 'Vercel', 'active', '2026-10-23 09:12:00');
           INSERT INTO integration_companies(integration_id, company_id, enabled) VALUES (50, 10, 1);`);
}
const DAY = 86_400_000;
// Today at noon UTC: the Hosting read's 30-day window counts back from the real clock, so the fixtures do too.
const NOW = new Date(Math.floor(Date.now() / DAY) * DAY + 12 * 3_600_000);
const iso = (ms: number) => new Date(ms).toISOString();
const dep = (uid: string, readyState: string, createdAt: number) => ({ uid, readyState, target: 'production', createdAt });
/** Evidence where every kind is wrong at once. */
const BAD = {
  project: { id: 'prj_1', name: 'acme-web', targets: { production: dep('dpl_old', 'READY', 1000) } },
  production: [dep('dpl_new_failed', 'ERROR', 3000), dep('dpl_ready', 'READY', 2000), dep('dpl_old', 'READY', 1000)],
  projectDomains: [{ name: 'app.acme.example', verified: true }, { name: 'www.acme.example', verified: false }],
  configs: { 'app.acme.example': { misconfigured: true }, 'www.acme.example': { misconfigured: false } },
  accountDomains: [{ name: 'acme.example', expiresAt: NOW.getTime() + 20 * DAY, renew: true }, { name: 'other.example', expiresAt: NOW.getTime() + 2 * DAY, renew: true }],
  certificates: [{ domain: 'app.acme.example', failed: true }],
};
/** The same project with every kind well. */
const GOOD = {
  project: { id: 'prj_1', name: 'acme-web', targets: { production: dep('dpl_fixed', 'READY', 4000) } },
  production: [dep('dpl_fixed', 'READY', 4000), dep('dpl_new_failed', 'ERROR', 3000)],
  projectDomains: [{ name: 'app.acme.example', verified: true }, { name: 'www.acme.example', verified: true }],
  configs: { 'app.acme.example': { misconfigured: false } },
  accountDomains: [{ name: 'acme.example', expiresAt: NOW.getTime() + 300 * DAY, renew: true }],
  certificates: [{ domain: 'app.acme.example', failed: false }],
};
const CTX = { integrationId: 50, projectId: 101, vercelProjectId: 'prj_1', source: 'sync' as const };

// ───────────────────────────────────────────────────────────── the rules

test('each health kind opens on its evidence; a source not read checks nothing', () => {
  const f = healthFindings(BAD as any, NOW);
  assert.deepEqual(f.checked, [...HEALTH_KINDS]);
  assert.deepEqual(f.open.map((x) => `${x.kind}:${x.subject}`).sort(), [
    'certificate_failed:app.acme.example', 'domain_expiring:acme.example', 'domain_misconfigured:app.acme.example',
    'domain_unverified:www.acme.example', 'production_failed:dpl_new_failed', 'rollback:dpl_old',
  ], 'other.example is not this project’s domain, so its expiry is not this venture’s');
  assert.deepEqual(healthFindings(GOOD as any, NOW).open, []);
  assert.deepEqual(healthFindings({ production: BAD.production } as any, NOW).checked, ['production_failed'], 'without the project, a rollback cannot be judged');
  assert.deepEqual(healthFindings({ accountDomains: BAD.accountDomains } as any, NOW).checked, [], 'without the project’s domains, an expiry is no venture’s');
  assert.deepEqual(healthFindings({}, NOW), { checked: [], open: [] });
  // Production on a deployment newer than the newest ready one in the list is no rollback.
  const promoted = { project: { targets: { production: dep('dpl_promoted', 'READY', 9000) } }, production: [dep('dpl_ready', 'READY', 2000)] };
  assert.deepEqual(healthFindings(promoted as any, NOW).open, []);
});

test('a Vercel-registered domain’s expiry window: 30 days, or 14 with auto-renew off; an external domain has no expiry', () => {
  const at = (days: number, renew: boolean | undefined) => healthFindings({ projectDomains: [{ name: 'acme.example', verified: true }],
    accountDomains: [{ name: 'acme.example', expiresAt: NOW.getTime() + days * DAY, renew }] } as any, NOW).open.length;
  assert.deepEqual([EXPIRY_WINDOW_DAYS.renewOn, EXPIRY_WINDOW_DAYS.renewOff], [30, 14]);
  assert.deepEqual([at(30, true), at(31, true), at(14, false), at(15, false), at(-1, true)], [1, 0, 1, 0, 1]);
  assert.equal(healthFindings({ projectDomains: [{ name: 'acme.example' }], accountDomains: [{ name: 'acme.example', expiresAt: null }] } as any, NOW).open.length, 0);
});

// ───────────────────────────────────────────────────────────── the store

test('applyHealth opens each kind with its ledger row, keeps it while the evidence holds, and closes it when it clears', async () => {
  const { db, env } = fixture(); vercel(db);
  assert.deepEqual(await applyHealth(env, CTX, healthFindings(BAD as any, NOW), NOW), { opened: 6, closed: 0, still: 0 });
  const opened = rowsOf(db, 'SELECT kind, subject, opened_at, closed_at, source FROM vercel_health_events ORDER BY kind');
  assert.equal(opened.length, 6);
  assert.ok(opened.every((r: any) => r.closed_at === null && r.source === 'sync' && r.opened_at === NOW.toISOString()));
  const fed = rowsOf(db, "SELECT module, kind, external_id, local_table FROM connector_fed_items WHERE integration_id = 50 ORDER BY external_id");
  assert.equal(fed.length, 6);
  assert.ok(fed.every((r: any) => r.module === 'operating_systems' && r.kind === 'health_event' && r.local_table === 'vercel_health_events'));
  assert.ok(fed.some((r: any) => r.external_id === fedKey('domain_unverified', 'www.acme.example', NOW.toISOString())));
  const later = new Date(NOW.getTime() + DAY);
  assert.deepEqual(await applyHealth(env, CTX, healthFindings(BAD as any, later), later), { opened: 0, closed: 0, still: 6 }, 'the same evidence opens nothing new');
  const fixed = new Date(NOW.getTime() + 2 * DAY);
  assert.deepEqual(await applyHealth(env, CTX, healthFindings(GOOD as any, fixed), fixed), { opened: 0, closed: 6, still: 0 });
  assert.ok(rowsOf(db, 'SELECT closed_at FROM vercel_health_events').every((r: any) => r.closed_at === fixed.toISOString()));
  // The same trouble later is a new event, with its own opened_at.
  const again = new Date(NOW.getTime() + 5 * DAY);
  assert.equal((await applyHealth(env, CTX, healthFindings(BAD as any, again), again)).opened, 6);
  assert.equal(rowsOf(db, 'SELECT id FROM vercel_health_events').length, 12);
});

test('a partial read closes nothing it could not check', async () => {
  const { db, env } = fixture(); vercel(db);
  await applyHealth(env, CTX, healthFindings(BAD as any, NOW), NOW);
  const later = new Date(NOW.getTime() + DAY);
  // Only the deployments were read this time, and they are well: the domain events stay open.
  const out = await applyHealth(env, CTX, healthFindings({ project: GOOD.project, production: GOOD.production } as any, later), later);
  assert.deepEqual(out, { opened: 0, closed: 2, still: 0 });
  assert.deepEqual(rowsOf(db, 'SELECT kind FROM vercel_health_events WHERE closed_at IS NULL ORDER BY kind').map((r: any) => r.kind),
    ['certificate_failed', 'domain_expiring', 'domain_misconfigured', 'domain_unverified']);
});

test('migration 590: one open row per kind and subject, the kinds held by CHECK, a dismissal names who', () => {
  const { db } = fixture();
  const put = (kind: string, subject: string, opened: string) => db.prepare("INSERT INTO vercel_health_events (integration_id, project_id, kind, subject, opened_at, source) VALUES (50, 101, ?, ?, ?, 'sync')").run(kind, subject, opened);
  put('rollback', 'dpl_1', '2026-10-01');
  assert.throws(() => put('rollback', 'dpl_1', '2026-10-02'), /UNIQUE/, 'a second open row for the same event');
  assert.throws(() => put('uptime', 'x', '2026-10-01'), /CHECK/);
  assert.throws(() => db.prepare("UPDATE vercel_health_events SET dismissed_at = '2026-10-03'").run(), /CHECK/, 'a dismissal names who dismissed');
  assert.throws(() => db.prepare("UPDATE vercel_health_events SET closed_at = '2026-09-01'").run(), /CHECK/, 'closed after opened');
});

// ───────────────────────────────────────────────────────────── Dismiss

test('Dismiss: the founder dismisses an open event; it stays dismissed while its evidence holds, and leaves the read', async () => {
  const { db, env } = fixture(); vercel(db);
  await applyHealth(env, CTX, healthFindings(BAD as any, NOW), NOW);
  const id = rowsOf(db, "SELECT id FROM vercel_health_events WHERE kind = 'domain_unverified'")[0].id;
  assert.equal((await call(env, `/api/cycles/build/vercel/health-events/${id}?project=101`, 2, 'DELETE')).status, 403, 'only who may write the venture');
  assert.equal((await call(env, `/api/cycles/build/vercel/health-events/${id}?project=101`, 4, 'DELETE')).status, 403, 'a partner reads the board and never writes it');
  assert.equal((await call(env, `/api/cycles/build/vercel/health-events/${id}?project=102`, 1, 'DELETE')).status, 404, 'another venture’s event');
  const ok = await call(env, `/api/cycles/build/vercel/health-events/${id}?project=101`, 1, 'DELETE');
  assert.deepEqual([ok.status, ok.body], [200, { ok: true }]);
  assert.equal((await call(env, `/api/cycles/build/vercel/health-events/${id}?project=101`, 1, 'DELETE')).status, 409, 'already dismissed');
  assert.equal(rowsOf(db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'build_vercel_health_dismissed'")[0].n, 1);
  // The next sync with the same evidence: nothing new, and the dismissed event is not drawn.
  const later = new Date(NOW.getTime() + DAY);
  assert.deepEqual(await applyHealth(env, CTX, healthFindings(BAD as any, later), later), { opened: 0, closed: 0, still: 6 });
  const items = (await tools(env)).hosting.systems[0].health.items;
  assert.ok(!items.some((e: any) => e.kind === 'domain_unverified'), 'a dismissed event never comes back');
  assert.equal(items.length, 5);
  // Its evidence clears: it closes, and a closed event is not dismissed again.
  const fixed = new Date(NOW.getTime() + 2 * DAY);
  await applyHealth(env, CTX, healthFindings(GOOD as any, fixed), fixed);
  const other = rowsOf(db, "SELECT id FROM vercel_health_events WHERE kind = 'rollback'")[0].id;
  const closedOne = await call(env, `/api/cycles/build/vercel/health-events/${other}?project=101`, 1, 'DELETE');
  assert.deepEqual([closedOne.status, closedOne.body.detail], [409, 'That health event has closed, so there is nothing to dismiss.']);
  assert.equal((await call(env, '/api/cycles/build/vercel/health-events/abc?project=101', 1, 'DELETE')).status, 404);
});

// ───────────────────────────────────────────────────────────── the Hosting read

test('the Hosting read: empty with no Vercel connection, the events with Open and Closed, and the facts waiting for part 1', async () => {
  const { db, env } = fixture();
  const none = await tools(env);
  assert.deepEqual([none.hosting.state, none.hosting.reason], ['empty', 'Vercel has not brought anything to this venture yet.']);
  vercel(db);
  await applyHealth(env, CTX, healthFindings(BAD as any, NOW), NOW);
  const fixed = new Date(NOW.getTime() + DAY);
  await applyHealth(env, CTX, healthFindings({ ...BAD, certificates: [{ domain: 'app.acme.example', failed: false }] } as any, fixed), fixed);
  const h = (await tools(env)).hosting;
  assert.equal(h.state, 'ok');
  const sys = h.systems[0];
  assert.deepEqual([sys.system, sys.provider, sys.source_label, sys.state, sys.owner], ['Hosting', 'Vercel', 'From the Vercel connection', 'Connected', 'You']);
  assert.deepEqual([sys.health.open, sys.health.closed], [5, 1]);
  assert.equal(sys.health.items[0].state, 'open', 'open ones first');
  assert.ok(sys.health.items.some((e: any) => e.kind === 'certificate_failed' && e.state === 'closed' && e.closed_at === fixed.toISOString()));
  assert.deepEqual([sys.facts, sys.facts_reason], [null, PART1_WAIT], 'the project’s facts wait for part 1, never empty or zero');
  assert.deepEqual([h.syncs.state, h.syncs.reason], ['not_recorded', SYNC_WAIT]);
  assert.match(sys.action.href, /vercel/);
  // An event closed more than 30 days ago is not drawn; an open one is drawn first even when older than a closed one.
  const put = db.prepare('INSERT INTO vercel_health_events (integration_id, project_id, kind, subject, opened_at, closed_at, source) VALUES (50, 101, ?, ?, ?, ?, ?)');
  put.run('rollback', 'dpl_ancient', iso(NOW.getTime() - 60 * DAY), iso(NOW.getTime() - 59 * DAY), 'sync');
  put.run('domain_unverified', 'old.acme.example', iso(NOW.getTime() - 20 * DAY), null, 'webhook');
  put.run('production_failed', 'dpl_recent_closed', iso(NOW.getTime() + 3 * DAY), iso(NOW.getTime() + 3 * DAY + 3_600_000), 'sync');
  const h2 = (await tools(env)).hosting.systems[0].health;
  assert.ok(!h2.items.some((e: any) => e.subject === 'dpl_ancient'), 'closed 30 days ago or more: not drawn');
  const firstClosed = h2.items.findIndex((e: any) => e.state === 'closed');
  assert.ok(h2.items.slice(0, firstClosed).every((e: any) => e.state === 'open') && h2.items.slice(firstClosed).every((e: any) => e.state === 'closed'), 'every open event before any closed one');
  assert.ok(h2.items.findIndex((e: any) => e.subject === 'old.acme.example') < h2.items.findIndex((e: any) => e.subject === 'dpl_recent_closed'));
});

test('the Tools rule: a non-member reads the counts, never a domain; a venture with no company reads not recorded', async () => {
  const { db, env } = fixture(); vercel(db);
  await applyHealth(env, CTX, healthFindings(BAD as any, NOW), NOW);
  db.exec('INSERT INTO user_company_links VALUES (3, 10)');
  const member = (await tools(env, 101, 3)).hosting.systems[0];
  assert.equal(member.health.items.length, 6, 'an admin who is a company member reads them');
  assert.equal(member.owner, 'One');
  // D782's outsider: a partner outside the company.
  const partner = await tools(env, 101, 4);
  const outsider = partner.hosting.systems[0];
  assert.deepEqual([outsider.health.open, outsider.health.items, outsider.owner], [6, null, null]);
  assert.doesNotMatch(JSON.stringify(partner.hosting), /acme\.example|dpl_/, 'no domain or deployment for a non-member');
  assert.deepEqual([(await tools(env, 303, 1)).hosting.state, (await tools(env, 303, 1)).hosting.reason], ['not_recorded', 'This project has no company scope for connectors.'], 'a venture with no company has no connectors');
});

test('one failed read costs one block: Hosting Unreadable on its own; GitHub’s Code system unchanged', async () => {
  const { db, env } = fixture(); vercel(db);
  const before = await tools(env);
  assert.deepEqual(Object.keys(before).sort(), ['code', 'cols', 'hosting', 'note', 'reason', 'rows', 'state', 'syncs', 'total']);
  assert.equal(before.code.state, 'empty', 'no GitHub connection: the Code system reads as before');
  db.exec('DROP TABLE vercel_health_events');
  const t = await tools(env);
  assert.deepEqual([t.hosting.state, t.hosting.reason], ['unreadable', 'Unreadable: Vercel could not be read. The rest of this page is current.']);
  assert.deepEqual(t.code, before.code);
  assert.deepEqual(t.rows, before.rows);
});
