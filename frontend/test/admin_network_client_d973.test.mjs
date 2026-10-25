/** D973 — the actual request client on fetch; UI consumers land in D975/D977. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const seen = [];
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
let payload = { available: true, items: [], total: 0 };
let status = 200;
globalThis.fetch = async (url, init = {}) => {
  seen.push({ url: String(url).replace(/^https?:\/\/[^/]+/, ''), method: init.method ?? 'GET', body: init.body });
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
};
const { adminNetworkApi } = await import('../src/lib/api.js');
test('all three mounted network clients preserve filters, false, zero and opaque refs', async () => {
  seen.length = 0;
  assert.deepEqual(await adminNetworkApi.overview(), payload);
  await adminNetworkApi.people();
  await adminNetworkApi.people({ q: 'Ada & Ben', kind: 'advisor', on_deck: false, active_deal: true, offset: 0, limit: 2, sort: 'rating_desc', ignored: 'never', skill: '', sector: null });
  await adminNetworkApi.person('user:2');
  assert.deepEqual(seen.map(x => x.url), ['/api/admin/network/overview', '/api/admin/network/people', '/api/admin/network/people?q=Ada+%26+Ben&kind=advisor&on_deck=false&active_deal=true&sort=rating_desc&limit=2&offset=0', '/api/admin/network/people/user%3A2']);
  assert.ok(seen.every(x => x.method === 'GET' && !x.body));
});
test('an unavailable overview block survives transport alongside healthy blocks', async () => {
  payload = { counts: { people: { available: true, recorded: true, value: 2 } }, sessions: { available: false, reason: 'Sessions could not be read. Try again.' }, settlements: { available: true, recorded: false, reason: 'Settlements are kept by HQ.' } };
  assert.deepEqual(await adminNetworkApi.overview(), payload);
  status = 503; payload = { detail: 'A requested filter source could not be read. Try again.', available: false };
  try { await assert.rejects(() => adminNetworkApi.people({ skill: 'Hiring' }), /could not be read/); }
  finally { status = 200; }
});
test('D527 re-export and Worker mount are present for the drift scanner', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const root = read('../src/lib/api.js');
  const exports = root.slice(root.indexOf('// api-modules:begin'), root.indexOf('// api-modules:end')).split('\n').filter(x => x.startsWith('export * from'));
  assert.ok(exports.includes("export * from './api/adminNetwork.js';")); assert.deepEqual(exports, [...exports].sort());
  const worker = read('../../cloudflare-worker/src/index.ts');
  assert.match(worker, /app\.route\('\/api\/admin\/network', adminNetworkReads\)/);
  assert.ok(worker.indexOf("app.route('/api/admin/network', adminNetworkReads)") < worker.indexOf("app.route('/api/admin/network', adminNetwork)"));
  assert.match(worker, /import adminNetworkReads from '\.\/routes\/admin_network_reads'/);
});


test('both network modules expose one client with D976 standing writes intact', async () => {
  const fromReads = await import('../src/lib/api/adminNetwork.js');
  const fromStanding = await import('../src/lib/api/network.js');
  assert.equal(fromReads.adminNetworkApi, fromStanding.adminNetworkApi);
  seen.length = 0;
  await adminNetworkApi.person(2);
  await adminNetworkApi.pause(2, 'Pause fixture');
  await adminNetworkApi.resume(2, 'Resume fixture');
  await adminNetworkApi.setListed(2, false);
  assert.deepEqual(seen, [
    { url: '/api/admin/network/people/2', method: 'GET', body: undefined },
    { url: '/api/admin/network/people/2/pause', method: 'POST', body: JSON.stringify({ reason: 'Pause fixture' }) },
    { url: '/api/admin/network/people/2/resume', method: 'POST', body: JSON.stringify({ reason: 'Resume fixture' }) },
    { url: '/api/admin/network/people/2/directory', method: 'POST', body: JSON.stringify({ listed: false }) },
  ]);
});
