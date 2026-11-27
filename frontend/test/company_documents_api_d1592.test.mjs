/**
 * D1592 (#3860): the company documents client calls the Worker routes
 * `company_documents_d1592.test.ts` holds, with these paths and verbs. Upload
 * sends `FormData`; download reads the bytes as a blob with the bearer header.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_documents_api_d1592.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { companyDocumentsApi } = await import('../src/lib/api/companyDocuments.js');
const { companyDocumentsApi: viaApi } = await import('../src/lib/api.js');

function capture(answer = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ method: init.method || 'GET', path: String(url).replace(/^.*?\/api\//, '/api/'), body: init.body ?? null, headers: init.headers || {} });
    return answer();
  };
  return { seen, restore: () => { globalThis.fetch = orig; } };
}

test('list and upload: their paths and verbs; upload sends FormData with the file, kind and title', async () => {
  const cap = capture();
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'bylaws.pdf', { type: 'application/pdf' });
  try {
    await companyDocumentsApi.list('co north/1');
    await companyDocumentsApi.upload('co-north', { file, kind: 'bylaws', title: 'Bylaws 2026' });
    await companyDocumentsApi.upload('co-north', { file, kind: 'other' });
  } finally { cap.restore(); }
  assert.deepEqual(cap.seen.map((s) => [s.method, s.path]), [
    ['GET', '/api/company/co%20north%2F1/documents'],
    ['POST', '/api/company/co-north/documents'],
    ['POST', '/api/company/co-north/documents'],
  ]);
  assert.equal(cap.seen[0].body, null);
  const sent = cap.seen[1].body;
  assert.ok(sent instanceof FormData, 'upload sends FormData');
  assert.equal(sent.get('kind'), 'bylaws');
  assert.equal(sent.get('title'), 'Bylaws 2026');
  assert.equal(sent.get('file').name, 'bylaws.pdf');
  assert.equal(cap.seen[2].body.has('title'), false, 'no title is sent when none is given');
  assert.equal(viaApi, companyDocumentsApi, 'api.js re-exports the module (D527)');
});

test('download: the file path, the bearer header, and the blob with the stored filename', async () => {
  store.set('token', 'fixture-token');
  const cap = capture(() => new Response(new Uint8Array([1, 2, 3]), {
    status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Bylaws.pdf"' },
  }));
  let got;
  try { got = await companyDocumentsApi.download('co-north', 'abc 1'); } finally { cap.restore(); store.clear(); }
  assert.deepEqual(cap.seen.map((s) => [s.method, s.path]), [['GET', '/api/company/co-north/documents/abc%201/file']]);
  assert.equal(cap.seen[0].headers.Authorization, 'Bearer fixture-token');
  assert.equal(got.filename, 'Bylaws.pdf');
  assert.deepEqual([...new Uint8Array(await got.blob.arrayBuffer())], [1, 2, 3]);
});

test('download: a refusal is thrown, never returned as a file', async () => {
  const cap = capture(() => new Response(JSON.stringify({ error: 'not_found', message: 'Document not found.' }), { status: 404, headers: { 'content-type': 'application/json' } }));
  try { await assert.rejects(companyDocumentsApi.download('co-north', 'x')); } finally { cap.restore(); }
});
