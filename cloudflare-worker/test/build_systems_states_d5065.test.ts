/**
 * D5065 (#5065) — Operating Systems states and actions cannot contradict
 * each other.
 *
 * Before this, `systemState()` classified a connection whose status was
 * neither `active` nor `error` as `not_connected`, while the record's
 * subtitle was derived from the mere existence of a connection row and so
 * still read "Connected … · last good sync …". A revoked connection
 * therefore said **Not connected** and **Connected** at once. The record's
 * primary action was always Reconnect, so a healthy system was told its main
 * job was repair, and a kind that mapped nothing at all was told to reconnect
 * a connection it never had.
 *
 * Every case the issue names is pinned here, over real SQLite built from the
 * actual schema: active, error, revoked, disabled, an unrecognised status, no
 * mapping at all, and Workspace. Each assertion is mutation-checked both ways
 * against the source it guards.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_systems_states_d5065.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import build from '../src/routes/cycle_build.ts';
import cycleRecords from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import {
  SYSTEM_STATE_LABEL, SYSTEM_STATE_ORDER, disconnectedReason, systemActionIntent, systemStateOf,
} from '../src/services/systemsState.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const FOUNDER = 10, TEAMMATE = 11;
const P = 1, COMPANY = 5;
/** One catalogue provider per kind, so four mapped kinds fit one owner. */
const PROVIDER: Record<string, string> = { bank: 'mercury', accounting: 'stripe', payroll: 'notion', crm: 'hubspot' };

const SCHEMA = (() => { const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true }); loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map(r => r.sql as string); })();

/**
 * One venture, one company, both members, and the five kinds left unmapped.
 * `statuses` maps a kind to the status its connection carries, so one fixture
 * covers every state the issue names.
 */
function fixture(statuses: Record<string, string | null> = {}, workspace = false) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of SCHEMA) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', 1, 1001),
    (${TEAMMATE}, 'founder', 'Tomas Reyes', 'tomas@example.test', 1, NULL)`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id) VALUES (${P}, 'Kestrel Works', 1001, ${COMPANY})`);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, ${COMPANY}), ('l2', ${TEAMMATE}, ${COMPANY})`);
  Object.keys(statuses).forEach((kind, i) => {
    const status = statuses[kind];
    const id = 20 + i;
    // integrations is UNIQUE(user_id, provider_key), so each kind names a
    // different catalogue provider; the read does not check the category.
    db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, auth_type, display_name, status, last_synced_at, last_error_at, config_json)
      VALUES (${id}, 'c-${kind}', ${FOUNDER}, '${PROVIDER[kind]}', 'oauth2', 'Private own account',
              ${status == null ? 'NULL' : `'${status}'`}, '2026-10-10 08:00:00', '2026-10-09 08:00:00', '{}')`);
    db.exec(`INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (${id}, ${COMPANY}, 1)`);
    db.exec(`INSERT INTO project_core_systems (project_id, kind, integration_id, updated_by, feeds_json)
      VALUES (${P}, '${kind}', ${id}, ${FOUNDER}, '["kpis"]')`);
  });
  if (workspace) {
    db.exec(`INSERT INTO project_core_systems (project_id, kind, provider_key, updated_by, feeds_json)
      VALUES (${P}, 'workspace', 'google_calendar', ${FOUNDER}, '["team"]')`);
    db.exec(`INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (${FOUNDER}, 'synthetic-test-token', 'calendar')`);
  }
  return db;
}

function appFor(route: any) {
  const app = new Hono<any>();
  app.route('/api/cycles', cycleRecords);
  app.route('/api/cycles/build', route);
  app.onError((e, c) => c.json({ error: e.message }, 500));
  return app;
}
async function call(route: any, db: DatabaseSync, path: string, user = FOUNDER) {
  const token = await new SignJWT({ user_id: user, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await withThrownResponses(() => appFor(route).request(path, { headers: { Authorization: `Bearer ${token}` } },
    { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const moduleRead = (route: any, db: DatabaseSync) => call(route, db, `/api/cycles/build/modules/operating-systems?project=${P}`);
const recordRead = (route: any, db: DatabaseSync, id: string) => call(route, db, `/api/cycles/build/modules/operating-systems/records/${id}?project=${P}`);
const rowState = (body: any, kind: string) => body.records.rows.find((r: any) => r.id === kind)?.cells.state;
const factOf = (body: any, label: string) => body.facts.find((f: any) => f.label === label);
const pillText = (body: any) => body.pills.map((p: any) => (typeof p === 'string' ? p : p.text));

// ── The derivation itself ────────────────────────────────────────────────────

test('the one derivation: a mapped connection is never "not connected", whatever its status', () => {
  assert.equal(systemStateOf(null, undefined), 'not_connected', 'no connection maps to nothing to repair');
  assert.equal(systemStateOf(null, 'active'), 'not_connected', 'a status without a connection is still nothing');
  assert.equal(systemStateOf({}, 'active'), 'connected');
  assert.equal(systemStateOf({}, 'ACTIVE  '), 'connected', 'the stored case and padding do not change the state');
  assert.equal(systemStateOf({}, 'error'), 'failing');
  for (const status of ['revoked', 'disabled', 'expired', 'inactive', 'pending', 'something_new', '', null, undefined, 7]) {
    assert.equal(systemStateOf({}, status), 'disconnected', `status ${String(status)}`);
  }
});

test('the labels and the order name all four states, worst first', () => {
  assert.deepEqual([...SYSTEM_STATE_ORDER], ['failing', 'disconnected', 'connected', 'not_connected']);
  assert.deepEqual(SYSTEM_STATE_ORDER.map(s => SYSTEM_STATE_LABEL[s]), ['Failing', 'Reconnect required', 'Connected', 'Not connected']);
});

test('the primary action follows the state: manage, reconnect, connect, choose', () => {
  assert.equal(systemActionIntent('connected', true), 'manage', 'a healthy system is managed, never repaired');
  assert.equal(systemActionIntent('failing', true), 'reconnect');
  assert.equal(systemActionIntent('disconnected', true), 'reconnect');
  assert.equal(systemActionIntent('not_connected', true), 'connect', 'a named connector is connected');
  assert.equal(systemActionIntent('not_connected', false), 'choose', 'with no connector named, one is chosen');
});

test('an unrecognised status is reported in general terms rather than echoed as copy', () => {
  assert.equal(disconnectedReason('revoked'), 'access was revoked');
  assert.equal(disconnectedReason('DISABLED'), 'the connection is disabled');
  assert.equal(disconnectedReason('weird_internal_code'), 'the connector no longer reports it as active');
  assert.doesNotMatch(disconnectedReason('weird_internal_code'), /weird_internal_code/);
});

// ── The module read ─────────────────────────────────────────────────────────

test('the rows, the tiles, the count and the filter read one state model', async () => {
  const db = fixture({ crm: 'active', bank: 'error', accounting: 'revoked', payroll: 'disabled' }, true);
  const r = await moduleRead(build, db);
  assert.equal(r.status, 200);
  assert.deepEqual(['crm', 'bank', 'accounting', 'payroll', 'workspace'].map(k => rowState(r.body, k)),
    ['Connected', 'Failing', 'Reconnect required', 'Reconnect required', 'Connected'],
    'a revoked or disabled connection reads Reconnect required, never Not connected');
  // The tiles follow SYSTEM_KINDS: bank, accounting, payroll, crm, workspace.
  assert.deepEqual(r.body.card.series[0].items.map((t: any) => t.state),
    ['failing', 'disconnected', 'disconnected', 'connected', 'connected'], 'tiles');
  assert.equal(r.body.facts.connected, 2, 'only active connections count as connected');
  assert.deepEqual(r.body.records.filters.find((f: any) => f.key === 'state').options.map((o: any) => o.value),
    ['failing', 'disconnected', 'connected', 'not_connected'], 'the filter offers every state, worst first');
  db.close();
});

test('an unmapped kind still reads Not connected, so nothing to repair is never offered repair', async () => {
  const db = fixture({ crm: 'active' });
  const r = await moduleRead(build, db);
  assert.equal(rowState(r.body, 'bank'), 'Not connected');
  assert.equal(r.body.card.next, null, 'a healthy book needs no recovery action');
  db.close();
});

test('the card offers recovery for a mapped connection that is no longer active', async () => {
  const revoked = fixture({ crm: 'revoked' });
  const a = await moduleRead(build, revoked);
  assert.match(a.body.card.next.text, /^Reconnect /, 'a revoked system has a clear recovery action');
  assert.equal(a.body.card.next.href, `/build/connect?tool=hubspot&project_id=${P}`);
  revoked.close();
  // A failing system is still named first, ahead of a merely disconnected one.
  const both = fixture({ bank: 'error', crm: 'revoked' });
  const b = await moduleRead(build, both);
  assert.match(b.body.card.next.text, /^Reconnect Mercury/, 'failing first');
  both.close();
});

test('a card that offers Reconnect does not call a disconnected system failing', async () => {
  // A revoked connection can still carry the last_error_at of an earlier
  // failure. Naming that date would say the system is failing on the same card
  // that says it needs reconnecting.
  const db = fixture({ crm: 'revoked' });
  const r = await moduleRead(build, db);
  assert.match(r.body.card.next.text, /^Reconnect HubSpot$/, `card said: ${r.body.card.next.text}`);
  db.close();
  // A failing one still says since when, which is the whole point of the line.
  const bad = fixture({ bank: 'error' });
  const f = await moduleRead(build, bad);
  assert.match(f.body.card.next.text, /^Reconnect Mercury · failing since /);
  bad.close();
});

test('a tool whose connection is no longer active is not listed as never connected', async () => {
  const db = fixture({ crm: 'revoked' });
  const r = await call(build, db, `/api/cycles/build/modules/operating-systems?project=${P}&parts=1`);
  const states = r.body.parts.tools.rows.map((row: any) => row.cells.state);
  assert.ok(states.includes('Reconnect required'), `tool states were ${JSON.stringify(states)}`);
  assert.ok(!states.includes('Not connected'), 'a stored connection is never "Not connected"');
  db.close();
});

// ── The record read ─────────────────────────────────────────────────────────

test('no record renders a state and a subtitle that contradict each other', async () => {
  const db = fixture({ crm: 'revoked', bank: 'error', accounting: 'active' }, true);
  const revoked = await recordRead(build, db, 'crm');
  assert.deepEqual(pillText(revoked.body), ['Reconnect required']);
  assert.equal(factOf(revoked.body, 'State').value, 'Reconnect required');
  assert.match(revoked.body.sub, /^Reconnect required · access was revoked/);
  assert.doesNotMatch(revoked.body.sub, /Connected/, 'a revoked connection is never described as connected');

  const failing = await recordRead(build, db, 'bank');
  assert.deepEqual(pillText(failing.body), ['Failing']);
  assert.match(failing.body.sub, /^Failing since /);
  assert.doesNotMatch(failing.body.sub, /^Connected/);

  const healthy = await recordRead(build, db, 'accounting');
  assert.deepEqual(pillText(healthy.body), ['Connected']);
  assert.match(healthy.body.sub, /^Connected/);
  db.close();
});

test('a healthy system manages its connection; a failing or disconnected one reconnects', async () => {
  const db = fixture({ accounting: 'active', bank: 'error', crm: 'revoked' }, true);
  const primary = async (id: string) => {
    const r = await recordRead(build, db, id);
    return [r.body.actions[0]?.key ?? null, r.body.actions[0]?.label ?? null, r.body.actions[0]?.tone ?? null];
  };
  assert.deepEqual(await primary('accounting'), ['manage', 'Manage connection', 'primary'], 'healthy');
  assert.deepEqual(await primary('bank'), ['reconnect', 'Reconnect', 'primary'], 'failing');
  assert.deepEqual(await primary('crm'), ['reconnect', 'Reconnect', 'primary'], 'disconnected');
  assert.deepEqual(await primary('workspace'), ['manage', 'Manage connection', 'primary'], 'workspace');
  db.close();
});

test('a kind that maps nothing chooses a connector instead of being told to reconnect', async () => {
  const db = fixture({ crm: 'active' });
  const r = await recordRead(build, db, 'payroll');
  const keys = r.body.actions.map((a: any) => a.key);
  assert.ok(!keys.includes('reconnect'), `Not connected offered ${JSON.stringify(keys)}`);
  assert.deepEqual([r.body.actions[0].key, r.body.actions[0].label, r.body.actions[0].tone], ['edit', 'Choose connector', 'primary']);
  assert.equal(r.body.sub, 'Not connected yet');
  db.close();
});

test('Workspace says which sync and history fields do not apply rather than sounding broken', async () => {
  const db = fixture({}, true);
  const r = await recordRead(build, db, 'workspace');
  assert.equal(r.body.sub, 'Connected · sync and sync log not applicable');
  for (const label of ['Last sync', 'Sync']) {
    const f = factOf(r.body, label);
    assert.equal(f.value, null, label);
    assert.match(f.reason, /^Not applicable: a workspace connection/, `${label}: ${f.reason}`);
    assert.doesNotMatch(f.reason, /no connection row/, `${label} must not read as a missing row`);
  }
  const log = [...r.body.main, ...r.body.side].find((s: any) => s.key === 'sync_log');
  assert.equal(log.rows[0].b, 'Not applicable: a workspace connection keeps no sync log.');
  db.close();
});

test('another member’s private connector name stays private in every state', async () => {
  const db = fixture({ crm: 'revoked' });
  db.exec(`UPDATE integrations SET user_id = ${TEAMMATE}, display_name = 'Private teammate account' WHERE uid = 'c-crm'`);
  db.exec(`UPDATE project_core_systems SET updated_by = ${TEAMMATE} WHERE kind = 'crm'`);
  const r = await recordRead(build, db, 'crm');
  assert.ok(!JSON.stringify(r.body).includes('Private teammate account'), 'the private name must not leak');
  assert.match(r.body.title, /HubSpot/, 'the catalogue name is used instead');
  db.close();
});

// ── The SPA's tiles ─────────────────────────────────────────────────────────

/**
 * The module card's tiles are drawn by the SPA from the state the Worker
 * sends. A state with no tile of its own falls back to the Not connected tile,
 * which is how a `disconnected` system would have been drawn "Not connected"
 * beside a record that said Connected. The two maps are pinned to each other.
 */
test('the SPA draws a tile for every state the Worker sends', () => {
  const src = readFileSync(resolve(ROOT, 'frontend/src/pages/cycles/CycleCharts.jsx'), 'utf8');
  const map = src.slice(src.indexOf('const TILE = {'), src.indexOf('function Tiles'));
  for (const state of SYSTEM_STATE_ORDER) {
    assert.match(map, new RegExp(`\\b${state}:`), `the SPA has no tile for ${state}`);
    assert.ok(map.includes(`'${SYSTEM_STATE_LABEL[state]}'`), `the SPA's ${state} tile does not read "${SYSTEM_STATE_LABEL[state]}"`);
  }
});

// ── Mutation and restoration ────────────────────────────────────────────────

/**
 * Every assertion above is checked both ways. A check names the source it
 * guards, the exact text to break, and the tests that must then fail.
 *
 * The mutation is applied to the file on disk and this same file is re-run in
 * a child process, filtered to those tests. Rebinding the module in memory is
 * not enough here: the record read reaches `services/records/build.ts` through
 * `routes/cycle_records.ts`, so only a real import of the mutated tree
 * exercises it. The child is told to skip this section, so it never recurses,
 * and the source is restored in a `finally` whether the child passes or not.
 */
type Check = { name: string; file: string; before: string; after: string; pattern: string };
const CHECKS: Check[] = [
  { name: 'a non-active status is disconnected, not connected', file: 'src/services/systemsState.ts',
    before: "return value === 'active' ? 'connected' : value === 'error' ? 'failing' : 'disconnected';",
    after: "return value === 'error' ? 'failing' : 'connected';",
    pattern: 'contradict each other' },
  { name: 'a mapped connection is never not_connected', file: 'src/services/systemsState.ts',
    before: "if (connection == null) return 'not_connected';", after: "if (connection == null || true) return 'not_connected';",
    pattern: 'one state model' },
  { name: 'a healthy system is managed, not repaired', file: 'src/services/systemsState.ts',
    before: "if (state === 'connected') return 'manage';", after: "if (state === 'connected') return 'reconnect';",
    pattern: 'manages its connection' },
  { name: 'an unmapped kind chooses rather than reconnects', file: 'src/services/systemsState.ts',
    before: "return hasProvider ? 'connect' : 'choose';", after: "return 'reconnect';",
    pattern: 'chooses a connector' },
  { name: 'an unrecognised status is not echoed as copy', file: 'src/services/systemsState.ts',
    before: "return DISCONNECTED_REASON[value] ?? 'the connector no longer reports it as active';", after: 'return value;',
    pattern: 'rather than echoed as copy' },
  { name: 'the subtitle follows the state, not the existence of a row', file: 'src/services/records/build.ts',
    before: "  if (state === 'not_connected') return 'Not connected yet';",
    after: "  if (state === 'not_connected') return 'Not connected yet';\n  if (state === 'disconnected') return `Connected ${dateText(c?.created_at) ?? ''}`;",
    pattern: 'contradict each other' },
  { name: 'Workspace names what does not apply instead of a missing row', file: 'src/services/records/build.ts',
    before: "const WORKSPACE_SYNC = 'Not applicable: a workspace connection records no sync time.';",
    after: "const WORKSPACE_SYNC = 'Workspace has no connection row.';",
    pattern: 'do not apply' },
  { name: 'the card offers recovery for a disconnected system too', file: 'src/routes/cycle_build.ts',
    before: "const failing = SYSTEM_KINDS.find(k => stateOf(k) === 'failing') ?? SYSTEM_KINDS.find(k => systemNeedsReconnect(stateOf(k)));",
    after: "const failing = SYSTEM_KINDS.find(k => stateOf(k) === 'failing');",
    pattern: 'no longer active' },
  { name: 'only a failing system is said to be failing since a date', file: 'src/routes/cycle_build.ts',
    before: "  const failedSince = failing && stateOf(failing) === 'failing' ? failedSystem?.last_error_at : null;",
    after: '  const failedSince = failedSystem?.last_error_at;', pattern: 'does not call a disconnected system failing' },
  { name: 'the list offers every state, worst first', file: 'src/routes/cycle_build.ts',
    before: 'const SYSTEM_STATE: Record<string, string> = Object.fromEntries(SYSTEM_STATE_ORDER.map(state => [state, SYSTEM_STATE_LABEL[state]]));',
    after: "const SYSTEM_STATE: Record<string, string> = { failing: 'Failing', connected: 'Connected', not_connected: 'Not connected' };",
    pattern: 'one state model' },
  { name: 'a tool with a stored connection is never "Not connected"', file: 'src/routes/cycle_build.ts',
    before: '      state: SYSTEM_STATE_LABEL[systemStateOf(tool, tool.status)],',
    after: "      state: tool.status === 'active' ? 'Connected' : tool.status === 'error' ? 'Failing' : 'Not connected',",
    pattern: 'not listed as never connected' },
  { name: 'the SPA has a tile for a disconnected system', file: '../frontend/src/pages/cycles/CycleCharts.jsx',
    before: "  disconnected: ['Reconnect required', 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'],\n",
    after: '', pattern: 'tile for every state' },
  { name: 'the record’s facts and pill read the normalized label', file: 'src/services/records/build.ts',
    before: "        fact('State', SYSTEM_STATE_LABEL[state], ''),", after: "        fact('State', 'Connected', ''),",
    pattern: 'contradict each other' },
];

const SELF = new URL(import.meta.url).pathname;
const run = (pattern: string) => spawnSync(process.execPath,
  ['--experimental-strip-types', '--no-warnings', '--import', './cloudflare-worker/test/_ts-loader.mjs',
    '--test', '--test-name-pattern', pattern, SELF],
  { cwd: resolve(ROOT), encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
    // NODE_TEST_CONTEXT makes a nested runner report to its parent instead of
    // stdout, so the child's TAP would never reach us. It is dropped here.
    env: { ...childEnv(), D5065_SKIP_MUTATIONS: '1' } });
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  return env;
}

if (!process.env.D5065_SKIP_MUTATIONS) {
  test('every check’s tests pass against the source before any mutation', () => {
    for (const pattern of new Set(CHECKS.map(c => c.pattern))) {
      const r = run(pattern);
      assert.equal(r.status, 0, `${pattern} did not pass unmutated: ${(r.stdout ?? '').slice(-1500)}`);
      assert.match(r.stdout ?? '', /# fail 0/, pattern);
      assert.doesNotMatch(r.stdout ?? '', /# pass 0\n/, `${pattern} matched no test`);
    }
  });

  for (const check of CHECKS) test(`Mutation and restoration: ${check.name}`, () => {
    const file = resolve(ROOT, 'cloudflare-worker', check.file);
    const original = readFileSync(file, 'utf8');
    assert.ok(original.includes(check.before), `mutation_target_missing: ${check.name}`);
    assert.equal(original.split(check.before).length - 1, 1, `mutation target is not unique: ${check.name}`);
    let result;
    try {
      writeFileSync(file, original.replace(check.before, check.after));
      result = run(check.pattern);
    } finally { writeFileSync(file, original); }
    assert.notEqual(result.status, 0, `the mutation went unnoticed by "${check.pattern}": ${(result.stdout ?? '').slice(-1500)}`);
    assert.equal(readFileSync(file, 'utf8'), original, 'the source was not restored');
  });
}
