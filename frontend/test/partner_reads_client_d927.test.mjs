/**
 * D927 (#2723) — the Partner invitations read clients on `api.adminPartners`:
 * the Overview, one invitation and the offer preview, each a GET to its one
 * route. What the Worker answers is tested in
 * cloudflare-worker/test/partner_reads_d927.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/partner_reads_client_d927.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const seen = [];
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
globalThis.fetch = async (url, options = {}) => {
  seen.push(`${String(options.method || 'GET')} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { api } = await import('../src/lib/api.js');

test('the three reads are GETs to their own routes; the preview sends the types as one list', async () => {
  seen.length = 0;
  await api.adminPartners.overview();
  await api.adminPartners.getInvitation(42);
  await api.adminPartners.previewOffers(['equity_partnership', 'custom']);
  await api.adminPartners.previewOffers('capital_partnership');
  assert.deepEqual(seen, [
    'GET /api/admin/partners/overview',
    'GET /api/admin/partners/invitations/42',
    'GET /api/admin/partners/offers/preview?types=equity_partnership%2Ccustom',
    'GET /api/admin/partners/offers/preview?types=capital_partnership',
  ]);
});
