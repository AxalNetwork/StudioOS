/** D9192 (#9192): an anonymous request to a signed-in API answers one 401 body, and a route that catches its own auth throw keeps 403/423 apart from it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import events from '../src/routes/events.ts';
import jobs from '../src/routes/jobs.ts';
import rec from '../src/routes/event_recommendations.ts';
import fundNotices from '../src/routes/fund_notices.ts';
import { ADMIN_FROZEN, authRefusal } from '../src/util/authErrors.ts';

const app = new Hono<any>()
  .route('/api/events', rec)
  .route('/api/events', events)
  .route('/api/jobs', jobs)
  .route('/api/fund-notices', fundNotices);
const env: any = {
  JWT_SECRET: 'synthetic-9192-secret',
  ENVIRONMENT: 'development',
  DB: { prepare() { throw new Error('an anonymous request must not reach the database'); } },
};

const PATHS = [
  '/api/fund-notices/mine',
  '/api/events/1/export',
  '/api/jobs/1/applications/1/resume',
  '/api/events/recommended',
];

test('anonymous requests answer the same 401 code and sentence on every route', async () => {
  for (const path of PATHS) {
    const r = await app.fetch(new Request('http://test' + path), env, { waitUntil() {}, passThroughOnException() {} } as any);
    assert.equal(r.status, 401, path);
    const body: any = await r.json();
    assert.deepEqual(body, { error: 'unauthenticated', message: 'Sign in to continue.', detail: 'Sign in to continue.' }, path);
  }
});

test('an anonymous caller on an Admin fund notices route is not told about an account', async () => {
  const r = await app.fetch(new Request('http://test/api/fund-notices/types'), env, { waitUntil() {}, passThroughOnException() {} } as any);
  assert.equal(r.status, 401);
  const text = await r.text();
  assert.ok(!/account/i.test(text), text);
  assert.ok(!text.includes('fund_notices_refused'), text);
});

test('authRefusal keeps a mapped 403/423 distinct and rethrows what is not a refusal', async () => {
  const c = { json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }) };
  const forbidden = authRefusal(c, new Error('Forbidden'));
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { detail: 'Forbidden' });
  assert.equal(authRefusal(c, new Error(ADMIN_FROZEN)).status, 423);
  const broken = new Error('D1_ERROR: no such table: sessions');
  assert.throws(() => authRefusal(c, broken), (e) => e === broken);
});
