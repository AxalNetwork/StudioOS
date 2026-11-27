// D1059 (#2929) — the report methods of the reporting client call the Worker's
// mounted routes (routes/reporting_reports.ts at /api/reporting), each with its
// method and body, and encode every id they put in a path. A statement is read
// as a blob with the session's token, and its filename comes from the Worker.
//
// Run with:
//   node --test frontend/test/reporting_reports_api_d1059.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceModule } from './_form_d695.mjs';

const WORKER = readFileSync(new URL('../../cloudflare-worker/src/routes/reporting_reports.ts', import.meta.url), 'utf8');

test('D1059: each report method calls its mounted route with its method and body; a statement is read as a blob', async () => {
  globalThis.__reportingCalls = [];
  globalThis.__fetches = [];
  const code = readFileSync(new URL('../src/lib/api/reporting.js', import.meta.url), 'utf8')
    .replace(/import \{ request \}[^;]+;/, 'const request=(...args)=>{globalThis.__reportingCalls.push(args);return Promise.resolve({ok:true});};')
    .replace(/import \{ refusalError \}[^;]+;/, 'const refusalError=async()=>new Error("refused");');
  const realFetch = globalThis.fetch;
  globalThis.localStorage = { getItem: () => 'tok-1' };
  globalThis.fetch = async (path, init) => {
    globalThis.__fetches.push([path, init?.headers?.Authorization]);
    return { ok: true, blob: async () => 'BLOB', headers: { get: () => 'attachment; filename="Q3 statements.pdf"' } };
  };
  try {
    const { reportingApi } = await sourceModule(code, 'lib/api/reporting.js');
    await reportingApi.draftReport('p/1');
    await reportingApi.report('r/1');
    await reportingApi.saveReport('r/1', { figures: [{ key: 'revenue', include: false, reason: 'Board pack' }] });
    await reportingApi.previewReport('r/1', 'team');
    await reportingApi.sendReport('r/1', 'abc');
    await reportingApi.correctReport('r/1', 'Stripe refund');
    await reportingApi.attachReportDocument('r/1', { filename: 'x.pdf', data: 'data:application/pdf;base64,JVBERi0=' });
    const calls = globalThis.__reportingCalls.map(([path, o]) => [path, o?.method || 'GET', o?.body ? JSON.parse(o.body) : null]);
    assert.deepEqual(calls, [
      ['/reporting/periods/p%2F1/draft', 'POST', {}],
      ['/reporting/reports/r%2F1', 'GET', null],
      ['/reporting/reports/r%2F1', 'PUT', { figures: [{ key: 'revenue', include: false, reason: 'Board pack' }] }],
      ['/reporting/reports/r%2F1/preview?as=team', 'GET', null],
      ['/reporting/reports/r%2F1/send', 'POST', { figures_sha256: 'abc' }],
      ['/reporting/reports/r%2F1/correct', 'POST', { reason: 'Stripe refund' }],
      ['/reporting/reports/r%2F1/documents', 'POST', { filename: 'x.pdf', data: 'data:application/pdf;base64,JVBERi0=' }],
    ]);
    assert.deepEqual(await reportingApi.reportDocument('d/1'), { blob: 'BLOB', filename: 'Q3 statements.pdf' });
    assert.deepEqual(globalThis.__fetches, [['/api/reporting/documents/d%2F1', 'Bearer tok-1']]);
    for (const [method, route] of [['post', '/periods/:uid/draft'], ['get', '/reports/:uid'], ['put', '/reports/:uid'], ['get', '/reports/:uid/preview'],
      ['post', '/reports/:uid/send'], ['post', '/reports/:uid/correct'], ['post', '/reports/:uid/documents'], ['get', '/documents/:uid']]) {
      assert.ok(WORKER.includes(`r.${method}('${route}'`), `${method} ${route} is mounted`);
    }
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
    delete globalThis.__reportingCalls;
    delete globalThis.__fetches;
  }
});
