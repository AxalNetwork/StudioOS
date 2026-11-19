/** D7709 (#7709): stored-row import, retry, provenance and operator gates over every migration; synthetic HTTP replies only. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import imports, { mount } from '../src/routes/admin_market_observation_imports.ts';
import research from '../src/routes/research_market_data.ts';
import { ingestWorldBank, WORLD_BANK_IMPORT_LIMITS } from '../src/services/researchMarketData.ts';
import { runObservationBatch, ImportFailure, type Observation } from '../src/services/marketObservations/write.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { refuse } from '../src/util/refusal.ts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const DAY = '2026-11-01', INDICATOR = 'SP.POP.TOTL', TEST_AUTH = 'test-only'.repeat(4);
const PARAMS = { from: 2024, to: 2024, indicators: [INDICATOR] };
const CODES = ['CHE','USA','CAN','FRA','DEU','ITA','ESP','PRT','NLD','BEL','AUT','POL','SWE','NOR','FIN','DNK','IRL','AUS','NZL','JPN'];
const COUNTRIES = [{ page: 1, pages: 1, total: 21, per_page: '400' },
  [...CODES.map(id => ({ id, region: { id: 'ECS' } })), { id: 'WLD', region: { id: 'NA' } }]];
const row = (value: unknown = 100, code = 'CHE', date = '2024') => ({ indicator: { id: INDICATOR }, countryiso3code: code, date, value });
const response = (rows: unknown[] = [row()], lastupdated: string | undefined = DAY, page = 1, pages = 1) =>
  Response.json([{ page, pages, per_page: 20, total: rows.length * pages, lastupdated }, rows]);

function world(t: TestContext) {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS); loadSchema(db); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  for (const [id, role] of [[1, 'admin'], [2, 'admin'], [3, 'founder']] as const)
    db.prepare('INSERT INTO users(id,uid,role,name,email,is_active,email_verified) VALUES(?,?,?,?,?,1,1)')
      .run(id, 'fixture-' + id, role, 'Synthetic user', `fixture-${id}@example.test`);
  db.prepare('INSERT INTO super_admins(user_id) VALUES(?)').run(1);
  for (const id of [1, 2, 3]) db.prepare("INSERT INTO user_sessions(user_id,jti,factor,assurance_level,created_at,last_step_up_at) VALUES(?,?,'totp','totp',?,?)")
    .run(id, 'fixture-' + id, new Date(NOW).toISOString(), new Date(NOW).toISOString());
  const sql: string[] = [], base = d1Over(db);
  const env = { JWT_SECRET: TEST_AUTH, ENVIRONMENT: 'development', DB: { ...base, prepare(s: string) { sql.push(s); return base.prepare(s); } } } as any;
  const app = new Hono<any>().route(mount.path, imports).route('/api/research', research);
  app.onError((error, c) => refuse(c, AUTH_ERROR_STATUSES[error.message] ?? 500, {
    code: 'auth_required', message: 'The required operator access is missing.', raw: error,
  }));
  const call = async (who: number, method = 'POST', body: unknown = { importer: 'world-bank', params: PARAMS, reason: 'Synthetic import check' }, path = mount.path + '/imports') => {
    const token = await new SignJWT({ user_id: who, role: who === 3 ? 'founder' : 'admin', jti: 'fixture-' + who })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(TEST_AUTH));
    const res = await app.request(path, { method, headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const network = (reply: (url: URL) => Response | Promise<Response> = () => response()) => {
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: any) => {
      const url = new URL(String(input)); calls.push(url.href);
      return url.pathname === '/v2/country' ? Response.json(COUNTRIES) : reply(url);
    });
    return calls;
  };
  const stored = () => db.prepare('SELECT * FROM research_market_observations ORDER BY id').all() as any[];
  const runs = () => db.prepare('SELECT * FROM research_market_ingestion_runs ORDER BY id').all() as any[];
  return { db, env, sql, call, network, stored, runs };
}

test('a provider edition imports once, records every attempt, and keeps the provider date and unspecified status', async t => {
  const w = world(t); w.network();
  const first = await ingestWorldBank(w.env, PARAMS), again = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([first.rows_inserted, again.rows_inserted, again.rows_unchanged], [1, 0, 1]);
  assert.deepEqual(w.stored().map(r => [r.value, r.published_at, r.vintage, r.observation_status]), [[100, DAY, DAY, 'unspecified']]);
  assert.deepEqual(w.runs().map(r => [r.status, r.rows_seen, r.rows_inserted, r.rows_unchanged]), [['succeeded', 1, 1, 0], ['succeeded', 1, 0, 1]]);
  assert.deepEqual({ ...w.db.prepare("SELECT last_attempt_at,last_success_at,last_error FROM research_market_sources WHERE id='world-bank'").get() },
    { last_attempt_at: new Date(NOW).toISOString(), last_success_at: new Date(NOW).toISOString(), last_error: null });
});

test('a new edition revises the stored value and links its predecessor; replaying the older edition cannot replace it', async t => {
  const w = world(t); let changed = false; w.network(() => response([row(changed ? 120 : 100)], changed ? '2026-11-02' : DAY));
  await ingestWorldBank(w.env, PARAMS); changed = true; await ingestWorldBank(w.env, PARAMS);
  changed = false; const replay = await ingestWorldBank(w.env, PARAMS);
  const rows = w.stored();
  assert.deepEqual(rows.map(r => [r.value, r.vintage, r.supersedes_observation_id]), [[100, DAY, null], [120, '2026-11-02', rows[0].id]]);
  assert.deepEqual([replay.rows_inserted, replay.rows_unchanged], [0, 1]);
});

test('missing, blank and nonnumeric cells store nothing, while actual zero is a stored observation', async t => {
  const w = world(t); w.network(() => response([row(null), row('', 'USA'), row(false, 'CAN'), row(0, 'FRA'), row(999, 'WLD')]));
  const result = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual(w.stored().map(r => [r.geography_code, r.value]), [['FRA', 0]]);
  assert.deepEqual([result.rows_seen, result.rows_inserted, result.rows_unchanged], [5, 1, 0]);
});

test('a provider failure records only a class and status, retains prior rows and leaves the last successful timestamp intact', async t => {
  const w = world(t); let failed = false; w.network(() => failed ? new Response('PRIVATE_PROVIDER_BODY', { status: 502 }) : response());
  await ingestWorldBank(w.env, PARAMS); const before = w.stored(); failed = true;
  t.mock.timers.setTime(NOW + 60_000);
  const result = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual(w.stored(), before);
  assert.deepEqual([result.status, w.runs()[1].status, w.runs()[1].error], ['failed', 'failed', 'provider_http HTTP 502']);
  assert.deepEqual({ ...w.db.prepare("SELECT last_attempt_at,last_success_at,last_error FROM research_market_sources WHERE id='world-bank'").get() },
    { last_attempt_at: new Date(NOW + 60_000).toISOString(), last_success_at: new Date(NOW).toISOString(), last_error: 'provider_http HTTP 502' });
  assert.doesNotMatch(JSON.stringify([w.runs(), result]), /PRIVATE_PROVIDER_BODY/);
});

test('a later page failure preserves the first page, records partial and resumes exactly at the failed page', async t => {
  const w = world(t); let broken = true;
  w.network(url => Number(url.searchParams.get('page')) === 2 && broken ? new Response('PRIVATE_PROVIDER_BODY', { status: 503 })
    : response([row(100, Number(url.searchParams.get('page')) === 1 ? 'CHE' : 'USA')], DAY, Number(url.searchParams.get('page')), 2));
  const partial = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([partial.status, partial.rows_seen, partial.rows_inserted, w.runs()[0].status], ['partial', 1, 1, 'partial']);
  assert.ok(partial.next_cursor);
  broken = false; const resumed = await ingestWorldBank(w.env, PARAMS, partial.next_cursor);
  assert.deepEqual([resumed.status, resumed.rows_inserted, resumed.next_cursor, w.stored().length], ['succeeded', 1, null, 2]);
});

test('a request fetches at most two pages and a cursor is bound to its range and indicators', async t => {
  const w = world(t), params = { ...PARAMS, to: 2026 };
  const calls = w.network(url => { const page = Number(url.searchParams.get('page')); return response(CODES.map((c, i) => row(100 + i, c, String(2023 + page))), DAY, page, 3); });
  const first = await ingestWorldBank(w.env, params);
  assert.deepEqual([calls.length, first.rows_seen, first.rows_inserted, w.stored().length], [3, 40, 40, 40]);
  assert.ok(first.next_cursor);
  await assert.rejects(() => ingestWorldBank(w.env, PARAMS, first.next_cursor), { code: 'invalid_cursor' });
  const next = await ingestWorldBank(w.env, params, first.next_cursor);
  assert.deepEqual([next.rows_inserted, next.next_cursor, w.stored().length], [20, null, 60]);
});

test('over-cap and unknown inputs are refused before a run or provider request', async t => {
  const w = world(t), calls = w.network();
  for (const params of [{ ...PARAMS, to: 2034 }, { ...PARAMS, from: 1899, to: 1900 }, { ...PARAMS, from: 2100, to: 2101 },
    { ...PARAMS, indicators: Array(11).fill(INDICATOR) }, { ...PARAMS, indicators: ['unknown'] }])
    await assert.rejects(() => ingestWorldBank(w.env, params), { code: 'invalid_parameters' });
  assert.deepEqual([calls.length, w.runs().length], [0, 0]);
});

test('disabled sources never call a provider or create a run', async t => {
  const w = world(t), calls = w.network(); w.db.prepare("UPDATE research_market_sources SET enabled=0 WHERE id='world-bank'").run();
  await assert.rejects(() => ingestWorldBank(w.env, PARAMS), { code: 'source_disabled' });
  assert.deepEqual([calls.length, w.runs().length, w.stored().length], [0, 0, 0]);
});

test('unchanged values in a new edition are skipped; a status change is a linked revision through the same writer', async t => {
  const w = world(t);
  const cell: Observation = { metric_key: 'population', metric_label: 'Population', geography_type: 'country', geography_code: 'CHE', period: '2024',
    value: 100, unit: 'people', observation_status: 'unspecified', published_at: DAY, source_observation_key: 'population:CHE:2024', vintage: DAY };
  const put = (r: Observation) => runObservationBatch(w.env, 'world-bank', async () => ({ rows: [r], seen: 1, vintage: r.vintage, cursor: null, retry_cursor: null, progressed: true }));
  await put(cell); const unchanged = await put({ ...cell, vintage: '2026-11-02' });
  await put({ ...cell, vintage: '2026-11-03', observation_status: 'estimate' });
  const rows = w.stored();
  assert.deepEqual([unchanged.rows_inserted, unchanged.rows_unchanged], [0, 1]);
  assert.deepEqual(rows.map(r => [r.observation_status, r.supersedes_observation_id]), [['unspecified', null], ['estimate', rows[0].id]]);
  assert.equal(w.sql.filter(s => s.startsWith('SELECT o.id,o.source_observation_key')).length, 3, 'one bounded prior read per batch');
});

test('concurrent identical imports append once and classify the loser as unchanged', async t => {
  const w = world(t); w.network();
  const results = await Promise.all([ingestWorldBank(w.env, PARAMS), ingestWorldBank(w.env, PARAMS)]);
  assert.deepEqual([w.stored().length, results.reduce((n, r) => n + r.rows_inserted, 0), results.reduce((n, r) => n + r.rows_unchanged, 0)], [1, 1, 1]);
  assert.deepEqual(w.runs().map(r => r.status), ['succeeded', 'succeeded']);
});

test('undated replies have a stable content identity, never a fabricated publication date', async t => {
  const w = world(t);
  w.network(() => Response.json([{ page: 1, pages: 1, total: 1 }, [row()]]));
  await ingestWorldBank(w.env, PARAMS); const again = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([w.stored()[0].published_at, again.rows_inserted, w.stored().length], [null, 0, 1]);
  assert.match(w.stored()[0].vintage, /^content-sha256:[a-f0-9]{64}$/);
});

test('a contradictory immutable edition fails without overwriting history', async t => {
  const w = world(t); let changed = false; w.network(() => response([row(changed ? 200 : 100)]));
  await ingestWorldBank(w.env, PARAMS); changed = true; const result = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([result.status, result.failure, w.stored().map(r => r.value)], ['failed', 'edition_conflict', [100]]);
});

test('HQ write bar, reason and audit; members, plain admins and branches cannot import', async t => {
  const w = world(t), calls = w.network();
  for (const who of [2, 3]) assert.equal((await w.call(who)).status, 403);
  w.env.BRANCH_CODE = 'fixture-branch'; assert.equal((await w.call(1)).status, 403); delete w.env.BRANCH_CODE;
  w.db.prepare("UPDATE user_sessions SET factor='sms',assurance_level='sms' WHERE user_id=1").run();
  assert.equal((await w.call(1)).status, 403);
  w.db.prepare("UPDATE user_sessions SET factor='totp',assurance_level='totp',last_step_up_at='2000-01-01',created_at='2000-01-01' WHERE user_id=1").run();
  assert.equal((await w.call(1)).status, 403);
  w.db.prepare('UPDATE user_sessions SET created_at=?,last_step_up_at=? WHERE user_id=1').run(new Date(NOW).toISOString(), new Date(NOW).toISOString());
  assert.equal((await w.call(1, 'POST', { importer: 'world-bank', params: PARAMS, reason: 'no' })).status, 400);
  assert.equal(calls.length, 0);
  const made = await w.call(1);
  assert.equal(made.status, 202, JSON.stringify(made.body));
  const audit = w.db.prepare("SELECT admin_user_id,filters_json FROM admin_audit_log WHERE action='market_observation_import'").get() as any;
  assert.ok(audit);
  assert.deepEqual([audit.admin_user_id, JSON.parse(audit.filters_json).run_id, JSON.parse(audit.filters_json).reason], [1, made.body.result.run_id, 'Synthetic import check']);
  const intent = w.db.prepare("SELECT admin_user_id,filters_json FROM admin_audit_log WHERE action='market_observation_import_requested'").get() as any;
  assert.ok(intent);
  assert.deepEqual([intent.admin_user_id, JSON.parse(intent.filters_json).params], [1, PARAMS]);
  assert.equal((await w.call(3, 'POST', {}, '/api/research/market-data/refresh/world-bank')).status, 404);
});

test('operator run reads are per source, capped, HQ-only, body-free and name unfinished runs honestly', async t => {
  const w = world(t);
  w.db.prepare("INSERT INTO research_market_ingestion_runs(source_id,vintage,started_at,status,error) VALUES('world-bank','unknown','2000-01-01','running','PRIVATE_PROVIDER_BODY')").run();
  const got = await w.call(2, 'GET', undefined, mount.path + '/runs?source=world-bank&limit=1');
  assert.deepEqual([got.status, got.body.items[0].status_label, got.body.items[0].error], [200, 'Not finished', 'previous_import_error']);
  assert.deepEqual([got.body.items[0].rows_seen, got.body.items[0].rows_inserted, got.body.items[0].rows_unchanged], [null, null, null]);
  assert.doesNotMatch(JSON.stringify(got.body), /PRIVATE_PROVIDER_BODY/);
  assert.equal((await w.call(3, 'GET', undefined, mount.path + '/runs')).status, 403);
  w.env.BRANCH_CODE = 'fixture-branch'; assert.equal((await w.call(2, 'GET', undefined, mount.path + '/runs')).status, 403); delete w.env.BRANCH_CODE;
  assert.equal((await w.call(2, 'GET', undefined, mount.path + '/runs?limit=101')).status, 400);
  assert.equal((await w.call(2, 'GET', undefined, mount.path + '/runs?source=unknown')).status, 404);
});

test('oversized provider pages and a failed database batch leave no observation behind', async t => {
  const w = world(t); w.network(() => response(Array.from({ length: WORLD_BANK_IMPORT_LIMITS.page_rows + 1 }, () => row())));
  const result = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([result.status, result.failure, w.stored().length], ['failed', 'provider_payload', 0]);
  w.network(); const base = w.env.DB;
  w.env.DB = { ...base, batch: async (stmts: any[]) => { if (stmts.length === 1) throw new Error('PRIVATE_DATABASE_BODY'); return base.batch(stmts); } };
  const failed = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([failed.status, failed.failure, w.stored().length], ['failed', 'database_unavailable', 0]);
  w.network(() => response([row(), row()]));
  const duplicateFailure = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([duplicateFailure.rows_inserted, duplicateFailure.rows_unchanged, w.stored().length], [0, 0, 0]);
});

test('an operator receives a safe provider refusal and the failed attempt is audited', async t => {
  const w = world(t); w.network(() => new Response('PRIVATE_PROVIDER_BODY', { status: 502 }));
  const r = await w.call(1);
  assert.deepEqual([r.status, r.body.error, r.body.result.status, w.runs()[0].error], [502, 'import_incomplete', 'failed', 'provider_http HTTP 502']);
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE_PROVIDER_BODY/);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='market_observation_import'").get()!.n, 1);
});

test('a source disabled during the provider read refuses the buffered writes', async t => {
  const w = world(t); w.network(() => { w.db.prepare("UPDATE research_market_sources SET enabled=0 WHERE id='world-bank'").run(); return response(); });
  const r = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([r.status, r.failure, w.stored().length], ['failed', 'source_disabled', 0]);
});

test('a failed runs read is unavailable, not an empty or zero-valued receipt list', async t => {
  const w = world(t), base = w.env.DB;
  w.env.DB = { ...base, prepare(sql: string) { if (sql.includes('FROM research_market_ingestion_runs WHERE source_id=')) throw new Error('PRIVATE_DATABASE_BODY'); return base.prepare(sql); } };
  const r = await w.call(2, 'GET', undefined, mount.path + '/runs');
  assert.deepEqual([r.status, r.body.error, Object.hasOwn(r.body, 'items')], [503, 'runs_unavailable', false]);
  assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE_DATABASE_BODY/);
});

test('oversized streamed responses and oversized country metadata are refused before writes', async t => {
  const w = world(t);
  w.network(() => response([{ ...row(), unused: 'x'.repeat(WORLD_BANK_IMPORT_LIMITS.response_bytes + 1) }]));
  const largeBody = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([largeBody.status, largeBody.failure, w.stored().length], ['failed', 'provider_payload HTTP 200', 0]);
  t.mock.method(globalThis, 'fetch', async (input: any) => new URL(String(input)).pathname === '/v2/country'
    ? Response.json([{ pages: 1 }, Array.from({ length: WORLD_BANK_IMPORT_LIMITS.country_rows + 1 }, () => ({ id: 'CHE', region: { id: 'ECS' } }))]) : response());
  const largeMetadata = await ingestWorldBank(w.env, PARAMS);
  assert.deepEqual([largeMetadata.status, largeMetadata.failure, w.stored().length], ['failed', 'provider_payload', 0]);
});

test('an older finishing run cannot erase the latest attempt error', async t => {
  const w = world(t); let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
  const older = runObservationBatch(w.env, 'world-bank', async () => { started(); await hold;
    return { rows: [], seen: 0, vintage: DAY, cursor: null, retry_cursor: null, progressed: true }; });
  await ready; t.mock.timers.setTime(NOW + 60_000);
  await runObservationBatch(w.env, 'world-bank', async () => { throw new ImportFailure('provider_http', 503); });
  t.mock.timers.setTime(NOW + 120_000); release(); await older;
  const source = w.db.prepare("SELECT last_attempt_at,last_success_at,last_error FROM research_market_sources WHERE id='world-bank'").get() as any;
  assert.deepEqual([source.last_attempt_at, source.last_success_at, source.last_error],
    [new Date(NOW + 60_000).toISOString(), new Date(NOW + 120_000).toISOString(), 'provider_http HTTP 503']);
  assert.deepEqual(w.runs().map(r => r.status), ['succeeded', 'failed']);
});
