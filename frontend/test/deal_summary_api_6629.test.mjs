/**
 * #6629 (D6629): the deal summary client calls the Worker routes `deal_summary_6629.test.ts` holds. Availability is a
 * JSON read; the PDF is read as bytes with `request()`'s own headers (the bearer and the chosen firm), the caller's
 * abort signal, and the filename the Worker gave. A refusal or an empty body throws: never an empty file.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_summary_api_6629.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { dealSummaryApi } = await import('../src/lib/api/dealSummary.js');
const { dealSummaryApi: viaApi, setActiveCompanyId } = await import('../src/lib/api.js');

function capture(answer) {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ method: init.method || 'GET', path: String(url).replace(/^.*?\/api\//, '/api/'), headers: init.headers || {}, signal: init.signal });
    return answer();
  };
  return { seen, restore: () => { globalThis.fetch = orig; } };
}
const pdf = (headers = { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="axal-deal-summary-100-2026-11-18.pdf"' }) =>
  () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { status: 200, headers });

// Mutation checked: the availability path changed (fails); the module not re-exported by api.js (fails).
test('availability reads the summary route as JSON', async () => {
  const cap = capture(() => new Response(JSON.stringify({ available: false, code: 'nda_required', reason: 'Sign the NDA.' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  let got;
  try { got = await dealSummaryApi.availability('100'); } finally { cap.restore(); }
  assert.deepEqual(cap.seen.map((s) => [s.method, s.path]), [['GET', '/api/deals/100/summary']]);
  assert.deepEqual(got, { available: false, code: 'nda_required', reason: 'Sign the NDA.' });
  assert.equal(viaApi, dealSummaryApi, 'api.js re-exports the module (D527)');
});

// Mutation checked: the firm header dropped (fails); the signal not passed (fails); the Worker's filename ignored (fails).
test('pdfBlob: the file path, the bearer and firm headers, the signal, and the blob with its filename', async () => {
  store.set('token', 'fixture-token');
  setActiveCompanyId(70);
  const cap = capture(pdf());
  const ctrl = new AbortController();
  let got;
  try { got = await dealSummaryApi.pdfBlob(100, { signal: ctrl.signal }); } finally { cap.restore(); setActiveCompanyId(null); store.clear(); }
  assert.deepEqual(cap.seen.map((s) => [s.method, s.path]), [['GET', '/api/deals/100/summary/pdf']]);
  assert.equal(cap.seen[0].headers.Authorization, 'Bearer fixture-token');
  assert.equal(cap.seen[0].headers['X-Company-Id'], '70');
  assert.equal(cap.seen[0].signal, ctrl.signal);
  assert.equal(got.filename, 'axal-deal-summary-100-2026-11-18.pdf');
  assert.equal(got.blob.size, 5);
});

// Mutation checked: a refusal returned as a file (fails); an empty body returned as a file (fails).
test('pdfBlob: a refusal throws with the Worker\'s sentence; an empty body throws', async () => {
  const refused = capture(() => new Response(JSON.stringify({ error: 'nda_required', message: 'Sign the NDA with this venture to download its summary.' }), { status: 403, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(() => dealSummaryApi.pdfBlob(100), /Sign the NDA with this venture/).finally(refused.restore);
  const empty = capture(() => new Response(new Uint8Array([]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
  await assert.rejects(() => dealSummaryApi.pdfBlob(100), /came back empty/).finally(empty.restore);
});
