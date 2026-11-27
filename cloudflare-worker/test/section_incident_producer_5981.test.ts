/** Observability middleware → D5980 rules → D5979 outbox: the first request-path section incident producer (#5981). */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { makeD1 } from './_d1_sqlite.mjs';
import { observabilityMiddleware } from '../src/middleware/observability';
import {
  produceRequestSectionIncident, requestIncidentProducerActive, resetSectionIncidentRequestProducer,
  sectionIncidentRequestCounts, SAMPLE_LIMIT,
} from '../src/services/sectionIncidentRequestProducer';

const START = '2026-11-27T00:00:00Z';
const NOW = new Date('2026-11-27T12:00:00Z');
const TRIAGE = 'axalvc-superadmin-platform';
// Synthetic values a request carries. None of them may reach an outbox row.
const SECRETS = {
  body: 'body-marker-7f3a', query: 'query-marker-91c2', header: 'header-marker-2b8d',
  email: 'member@example.test', tenant: 'tenant-marker-55e0', exception: 'exception-marker-c4d1', id: 'record-marker-0a9b',
};
const outboxSchema = ['202611141540_5979_section_incident_outbox', '202611160958_5984_section_incident_issue']
  .map(name => readFileSync(new URL(`../sql/migrations/${name}.sql`, import.meta.url), 'utf8')).join('\n');
// Every column the producer may set. The rest must hold the table's defaults.
const PRODUCER_FIELDS = new Set(['episode_id', 'fingerprint', 'section_slug', 'impacted_sections', 'occurrence_total']);
const DEFAULTS: Record<string, unknown> = {
  checkpoint: 0, version: null, posted_version: null, recovered: 0, recovery_posted: 0, state: 'pending', attempts: 0,
  next_at: 0, lease_until: null, claim_token: null, channel_id: null, message_ts: null, last_reason: null,
  incident_case: null, classification: null, github_state: null, github_issue: null, github_milestone: null,
  github_milestone_pending: null, github_next_at: 0, github_reason: null,
};

const quiet = new WeakSet<TestContext>();
type Who = { id: number; email: string; role: string; tenant: string } | null;

function fixture(t: TestContext, vars: Partial<Env> = { AXAL_SECTION_REQUEST_INCIDENT_START_UTC: START }, schema = outboxSchema) {
  resetSectionIncidentRequestProducer();
  if (!quiet.has(t)) {
    quiet.add(t);
    t.mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
  }
  const { DB, db } = makeD1(schema);
  t.after(() => db.close());
  const env = { DB, ...vars } as unknown as Env;
  let who: Who = { id: 7, email: SECRETS.email, role: 'founder', tenant: SECRETS.tenant };
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => { (c as any).set('currentUser', who); await next(); });
  app.use('/api/*', observabilityMiddleware());
  app.get('/api/things/:id', () => { throw new Error(`${SECRETS.exception} ${SECRETS.email}`); });
  app.post('/api/things', c => c.json({ detail: 'Could not save.' }, 500));
  app.get('/api/forbidden', c => c.json({ detail: 'Not yours.' }, 403));
  app.get('/api/fine', c => c.json({ ok: true }));
  app.onError((_e, c) => c.json({ detail: 'Internal error' }, 500));
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (task: Promise<unknown>) => { pending.push(task); }, passThroughOnException() {}, props: {} };
  const settle = async () => { for (let i = 0; i < pending.length; i++) await pending[i]; };
  const send = async (method: string, path: string) => {
    const init: RequestInit = { method, headers: { 'x-tenant': SECRETS.header, 'content-type': 'application/json' } };
    if (method === 'POST') init.body = JSON.stringify({ note: SECRETS.body });
    const res = await app.request(`${path}?q=${SECRETS.query}`, init, env, ctx as any);
    return { status: res.status, body: await res.text() };
  };
  return {
    env, send, settle, db, ctx,
    signOut: () => { who = null; },
    rows: () => db.prepare('SELECT * FROM section_incident_outbox ORDER BY episode_id').all() as Record<string, unknown>[],
    observations: () => db.prepare('SELECT * FROM section_incident_observations').all() as Record<string, unknown>[],
  };
}

test('with the start time unset the producer writes nothing and counts nothing (the default)', async t => {
  const f = fixture(t, {});
  assert.equal((await f.send('GET', `/api/things/${SECRETS.id}`)).status, 500);
  assert.equal((await f.send('GET', '/api/forbidden')).status, 403);
  await f.settle();
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(sectionIncidentRequestCounts(), {});
});

test('a malformed or future start time, or a branch Worker, keeps it off without throwing', () => {
  const env = (vars: Record<string, string>) => vars as unknown as Env;
  assert.equal(requestIncidentProducerActive(env({ AXAL_SECTION_REQUEST_INCIDENT_START_UTC: START }), NOW), true);
  assert.equal(requestIncidentProducerActive(env({ AXAL_SECTION_REQUEST_INCIDENT_START_UTC: '2026-11-27' }), NOW), false);
  assert.equal(requestIncidentProducerActive(env({ AXAL_SECTION_REQUEST_INCIDENT_START_UTC: '2026-11-27T12:00:01Z' }), NOW), false);
  assert.equal(requestIncidentProducerActive(env({ AXAL_SECTION_REQUEST_INCIDENT_START_UTC: START, BRANCH_CODE: 'lisbon' }), NOW), false);
  assert.equal(requestIncidentProducerActive(env({ AXAL_SECTION_REQUEST_INCIDENT_START_UTC: START, BRANCH_CODE: 'NOT A CODE!' }), NOW), false);
});

test('an authenticated server failure becomes one triage episode, with an allowlisted row and an unchanged response', async t => {
  const off = fixture(t, {});
  const expected = [await off.send('GET', `/api/things/${SECRETS.id}`), await off.send('POST', '/api/things')];
  const f = fixture(t);
  const got = [await f.send('GET', `/api/things/${SECRETS.id}`), await f.send('POST', '/api/things'),
    await f.send('GET', `/api/things/${SECRETS.id}-2`)];
  assert.deepEqual(got.slice(0, 2), expected, 'the producer changed a response');
  await f.settle();
  const rows = f.rows();
  // The thrown GET (twice, two record ids, one route) and the returned 500 POST are two operations.
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.occurrence_total).sort(), [1, 2]);
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (PRODUCER_FIELDS.has(column)) continue;
      assert.ok(column in DEFAULTS, `unexpected outbox column ${column}`);
      assert.equal(value, DEFAULTS[column], `${column} was written by the producer`);
    }
    assert.match(String(row.episode_id), /^request-[0-9a-f]{24}-20261127$/);
    assert.match(String(row.fingerprint), /^server_operation-[0-9a-f]{32}$/);
    assert.equal(row.section_slug, TRIAGE);
    assert.equal(row.impacted_sections, '[]');
  }
  assert.ok(f.observations().every(o => o.kind === 'occurrence' && /^[0-9a-f-]{36}$/.test(String(o.event_id))));
  const stored = JSON.stringify([rows, f.observations()]);
  for (const marker of [...Object.values(SECRETS), '/api/things', 'founder', '"7"']) {
    assert.ok(!stored.includes(marker), `${marker} reached the outbox`);
  }
});

test('an unauthenticated failure and a successful request are not produced or counted', async t => {
  const f = fixture(t);
  assert.equal((await f.send('GET', '/api/fine')).status, 200);
  f.signOut();
  assert.equal((await f.send('GET', `/api/things/${SECRETS.id}`)).status, 500);
  await f.settle();
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(sectionIncidentRequestCounts(), {});
});

test('an expected 4xx is counted and never enqueued', async t => {
  const f = fixture(t);
  assert.equal((await f.send('GET', '/api/forbidden')).status, 403);
  assert.equal((await f.send('GET', '/api/nowhere')).status, 404);
  await f.settle();
  assert.deepEqual(f.rows(), []);
  assert.deepEqual(sectionIncidentRequestCounts(), { [`${TRIAGE}|expected_4xx`]: 2 });
});

test('failures past the sampling limit are counted, not enqueued, and a new window admits again', async t => {
  const f = fixture(t);
  for (let i = 0; i < SAMPLE_LIMIT + 2; i++) await f.send('POST', '/api/things');
  await f.settle();
  assert.equal(f.rows()[0].occurrence_total, SAMPLE_LIMIT);
  assert.deepEqual(sectionIncidentRequestCounts(), { [`${TRIAGE}|sampled_out`]: 2 });
  t.mock.timers.setTime(NOW.getTime() + 60_000);
  await f.send('POST', '/api/things');
  await f.settle();
  assert.equal(f.rows()[0].occurrence_total, SAMPLE_LIMIT + 1);
});

test('a missing outbox table leaves the response and status as they were', async t => {
  const off = fixture(t, {});
  const expected = await off.send('POST', '/api/things');
  const f = fixture(t, undefined, 'SELECT 1;');
  assert.deepEqual(await f.send('POST', '/api/things'), expected);
  await assert.doesNotReject(f.settle());
});

test('the response does not wait for the outbox write', async t => {
  const f = fixture(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const batch = f.env.DB.batch.bind(f.env.DB);
  (f.env.DB as any).batch = async (statements: unknown[]) => { await gate; return batch(statements as any); };
  const res = await f.send('POST', '/api/things');
  assert.equal(res.status, 500);
  assert.deepEqual(f.rows(), [], 'the write finished before the response was returned');
  release();
  await f.settle();
  assert.equal(f.rows().length, 1);
});

test('a throwing rule set or outbox is contained in the producer', async t => {
  t.mock.method(console, 'warn', () => {});
  resetSectionIncidentRequestProducer();
  const env = { AXAL_SECTION_REQUEST_INCIDENT_START_UTC: START } as unknown as Env;
  const ctx = { waitUntil() {} };
  const failure = { method: 'POST', routePattern: '/api/things', status: 500, errored: false, authenticated: true };
  const boom = () => { throw new Error(SECRETS.exception); };
  assert.equal(await produceRequestSectionIncident(env, ctx, failure, NOW, { decide: boom, enqueue: () => {} }), 'failed');
  const enqueued: unknown[] = [];
  const decide = (await import('../src/services/sectionIncidentRules')).decideSectionIncident;
  assert.equal(await produceRequestSectionIncident(env, ctx, failure, NOW, { decide, enqueue: boom }), 'failed');
  assert.equal(await produceRequestSectionIncident(env, ctx, failure, NOW,
    { decide, enqueue: (_e, _c, event) => { enqueued.push(event); } }), 'enqueued');
  assert.equal(enqueued.length, 1);
  // A thrown error is a failure whatever status was set; unmatched patterns are one operation.
  const capture = { decide, enqueue: (_e: Env, _c: unknown, event: any) => { enqueued.push(event); } };
  for (const routePattern of ['/api/a/*', '/api/b/*', null]) {
    assert.equal(await produceRequestSectionIncident(env, ctx, { ...failure, routePattern, status: 200, errored: true },
      NOW, capture), 'enqueued');
  }
  const unmatched = enqueued.slice(1) as Array<{ episodeId: string }>;
  assert.equal(new Set(unmatched.map(e => e.episodeId)).size, 1);
  assert.notEqual(unmatched[0].episodeId, (enqueued[0] as { episodeId: string }).episodeId);
  assert.equal(await produceRequestSectionIncident(env, { waitUntil: boom }, failure, NOW), 'enqueued',
    'the real outbox swallows a waitUntil failure');
});
