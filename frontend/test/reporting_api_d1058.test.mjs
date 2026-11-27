// D1058 (#2928) — the reporting client calls the Worker's mounted routes
// (routes/reporting.ts at /api/reporting), each with its method and body, and
// encodes every id it puts in a path.
//
// Run with:
//   node --test frontend/test/reporting_api_d1058.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceModule } from './_form_d695.mjs';

const WORKER = readFileSync(new URL('../../cloudflare-worker/src/routes/reporting.ts', import.meta.url), 'utf8');

test('D1058: each method calls its mounted route with its method and body', async () => {
  globalThis.__reportingCalls = [];
  const code = readFileSync(new URL('../src/lib/api/reporting.js', import.meta.url), 'utf8')
    .replace(/import \{ request \}[^;]+;/, 'const request=(...args)=>{globalThis.__reportingCalls.push(args);return Promise.resolve({ok:true});};');
  try {
    const { reportingApi } = await sourceModule(code, 'lib/api/reporting.js');
    await reportingApi.desk(7);
    await reportingApi.setExpected('p/1', '2026-11-14', 'Waiting on the close');
    await reportingApi.setReminders({ project: 7, offsets: [3], channels: ['in_app'], recipient_user_ids: [3] });
    await reportingApi.portfolio();
    await reportingApi.company('proj seven');
    await reportingApi.ask('p/1');
    await reportingApi.waive('p/1');
    const calls = globalThis.__reportingCalls.map(([path, o]) => [path, o?.method || 'GET', o?.body ? JSON.parse(o.body) : null]);
    assert.deepEqual(calls, [
      ['/reporting/desk?project=7', 'GET', null],
      ['/reporting/periods/p%2F1/expected', 'POST', { expected_on: '2026-11-14', note: 'Waiting on the close' }],
      ['/reporting/reminders', 'PUT', { project: 7, offsets: [3], channels: ['in_app'], recipient_user_ids: [3] }],
      ['/reporting/portfolio', 'GET', null],
      ['/reporting/companies/proj%20seven', 'GET', null],
      ['/reporting/periods/p%2F1/ask', 'POST', {}],
      ['/reporting/periods/p%2F1/waive', 'POST', {}],
    ]);
    for (const [method, route] of [['get', '/desk'], ['post', '/periods/:uid/expected'], ['put', '/reminders'], ['get', '/portfolio'],
      ['get', '/companies/:projectUid'], ['post', '/periods/:uid/ask'], ['post', '/periods/:uid/waive']]) {
      assert.ok(WORKER.includes(`r.${method}('${route}'`), `${method} ${route} is mounted`);
    }
  } finally { delete globalThis.__reportingCalls; }
});
