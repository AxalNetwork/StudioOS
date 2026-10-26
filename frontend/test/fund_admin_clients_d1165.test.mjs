import test from 'node:test';
import assert from 'node:assert/strict';
import { fundNoticesApi } from '../src/lib/api/fundNotices.js';

test('D1165: admin notice reads use the mounted routes; the kept PDF stays authenticated', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => 'fixture-token', setItem() {}, removeItem() {} };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="fixture.pdf"' } });
  };
  try {
    await fundNoticesApi.list({ fund_id: 7 });
    await fundNoticesApi.read('fixture');
    const pdf = await fundNoticesApi.pdfBlob('fixture');
    assert.deepEqual(calls.map(([url]) => url), ['/api/fund-notices?fund_id=7', '/api/fund-notices/fixture', '/api/fund-notices/fixture/pdf']);
    assert.equal(calls[2][1].credentials, 'include');
    assert.equal(calls[2][1].headers.Authorization, 'Bearer fixture-token');
    assert.equal(pdf.filename, 'fixture.pdf');
    assert.ok(pdf.blob instanceof Blob);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});
