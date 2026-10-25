/**
 * D1075 (#2967) — the trust center's clients: the public reads and subscribe,
 * HQ's content writes, and Help's security reports. What the Worker answers
 * is tested in cloudflare-worker/test/trust_content_d1075.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/trust_content_client_d1075.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const seen = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.fetch = async (url, init = {}) => {
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null;
  const type = init.headers?.['Content-Type'];
  seen.push({ url: String(url).replace(/^https?:\/\/[^/]+/, ''), method: init.method || 'GET', body, ...(type === 'application/pdf' ? { type } : {}) });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { trustPublicApi, trustCenterAdminApi, securityReportsApi } = await import('../src/lib/api.js');

test('the public reads and subscribe', async () => {
  seen.length = 0;
  await trustPublicApi.read();
  await trustPublicApi.changes(20);
  await trustPublicApi.matrix();
  await trustPublicApi.subscribe({ email: 'ana@example.test', turnstileToken: 't' });
  assert.deepEqual(seen, [
    { url: '/api/public/trust', method: 'GET', body: null },
    { url: '/api/public/trust/changes?limit=20', method: 'GET', body: null },
    { url: '/api/public/trust/matrix', method: 'GET', body: null },
    { url: '/api/public/trust/subprocessors/subscribe', method: 'POST', body: { email: 'ana@example.test', turnstileToken: 't' } },
  ]);
});

test('HQ\'s content writes call their routes with exactly what they are given', async () => {
  seen.length = 0;
  const pdf = new Uint8Array([37, 80, 68, 70, 45]);
  await trustCenterAdminApi.read();
  await trustCenterAdminApi.saveDraft('security', { body: { groups: [] }, checked_at: '2026-10-25' });
  await trustCenterAdminApi.discardDraft('security');
  await trustCenterAdminApi.addSubprocessor({ name: 'Vendor F', purpose: 'Errors', data: 'Error reports', location: 'US' });
  await trustCenterAdminApi.editSubprocessor('tsp 1', { purpose: 'Errors and alerts' });
  await trustCenterAdminApi.removeSubprocessor('tsp_1');
  await trustCenterAdminApi.keepSubprocessor('tsp_1');
  await trustCenterAdminApi.attachReport(pdf);
  await trustCenterAdminApi.publish('Subprocessors: Vendor F added.');
  const TC = '/api/admin/security/trust-center';
  assert.deepEqual(seen, [
    { url: TC, method: 'GET', body: null },
    { url: `${TC}/blocks/security`, method: 'PUT', body: { body: { groups: [] }, checked_at: '2026-10-25' } },
    { url: `${TC}/blocks/security/draft`, method: 'DELETE', body: null },
    { url: `${TC}/subprocessors`, method: 'POST', body: { name: 'Vendor F', purpose: 'Errors', data: 'Error reports', location: 'US' } },
    { url: `${TC}/subprocessors/tsp%201`, method: 'PATCH', body: { purpose: 'Errors and alerts' } },
    { url: `${TC}/subprocessors/tsp_1`, method: 'DELETE', body: null },
    { url: `${TC}/subprocessors/tsp_1/keep`, method: 'POST', body: null },
    { url: `${TC}/reports`, method: 'POST', body: pdf, type: 'application/pdf' },
    { url: `${TC}/publish`, method: 'POST', body: { note: 'Subprocessors: Vendor F added.' } },
  ]);
});

test('Help\'s security reports', async () => {
  seen.length = 0;
  await securityReportsApi.send({ affected: 'Sign in', what_happened: 'x' });
  await securityReportsApi.mine();
  await securityReportsApi.list();
  await securityReportsApi.list('open');
  await securityReportsApi.setStatus('sec_1', 'acknowledged');
  assert.deepEqual(seen, [
    { url: '/api/help/security-reports', method: 'POST', body: { affected: 'Sign in', what_happened: 'x' } },
    { url: '/api/help/security-reports/mine', method: 'GET', body: null },
    { url: '/api/admin/security/reports', method: 'GET', body: null },
    { url: '/api/admin/security/reports?status=open', method: 'GET', body: null },
    { url: '/api/admin/security/reports/sec_1', method: 'PATCH', body: { status: 'acknowledged' } },
  ]);
});
