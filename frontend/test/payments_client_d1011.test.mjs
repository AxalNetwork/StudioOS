/**
 * D1011 (#2830) — the Payments client: one module (D527), three routes, and
 * queries that carry only the filters chosen. What the Worker answers is
 * tested in cloudflare-worker/test/payments_change_log_d1011.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const seen = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
// The CSV download clicks a link it adds to the page.
const clicked = [];
globalThis.document = {
  cookie: '',
  createElement: () => ({ click() { clicked.push(this.download); }, remove() {} }),
  body: { appendChild() {} },
};
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url).replace(/^https?:\/\/[^/]+/, ''), method: init.method || 'GET' });
  if (String(url).includes('.csv')) {
    return new Response('at,what\r\n', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="payments-change-log-2026-10-24.csv"', 'X-Export-Rows': '0' } });
  }
  return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { paymentsApi } = await import('../src/lib/api.js');

test('changeLog sends only the filters that are set', async () => {
  seen.length = 0;
  await paymentsApi.changeLog();
  await paymentsApi.changeLog({ what: 'price', who: '', product: 'prod_A', from: null, to: '2026-10-24', limit: 50, offset: 0 });
  assert.deepEqual(seen.map((s) => [s.method, s.url]), [
    ['GET', '/api/admin/payments/change-log'],
    ['GET', '/api/admin/payments/change-log?what=price&product=prod_A&to=2026-10-24&limit=50&offset=0'],
  ]);
});

test('changeLogCsv carries the filters and the reason, and names the file the Worker named', async () => {
  seen.length = 0;
  const out = await paymentsApi.changeLogCsv({ what: 'sync' }, 'Auditor asked for October');
  assert.deepEqual(seen.map((s) => s.url), ['/api/admin/payments/change-log.csv?what=sync&reason=Auditor+asked+for+October']);
  assert.equal(out.filename, 'payments-change-log-2026-10-24.csv');
  assert.deepEqual(clicked, ['payments-change-log-2026-10-24.csv']);
});

test('webhookDeliveries calls its route', async () => {
  seen.length = 0;
  await paymentsApi.webhookDeliveries();
  assert.deepEqual(seen.map((s) => [s.method, s.url]), [['GET', '/api/admin/payments/webhook-deliveries']]);
});

test('the module is one line in api.js\'s alphabetical block', () => {
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  const lines = block.split('\n').filter((l) => l.startsWith('export * from'));
  assert.ok(lines.includes("export * from './api/payments.js';"));
  assert.deepEqual(lines, [...lines].sort(), 'alphabetical');
});
