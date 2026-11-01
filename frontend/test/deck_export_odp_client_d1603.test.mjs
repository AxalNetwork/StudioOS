/**
 * D1603 (#3882): the slides-suite export's client calls the Worker route the
 * Worker test holds — POST /api/decks/:id/export/odp with the two options —
 * and hands back the raw Response, as deckExportHtml does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { api } = await import('../src/lib/api.js');

test('POST /api/decks/:id/export/odp with notes and sources, and the raw Response back', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  const answer = new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'content-type': 'application/vnd.oasis.opendocument.presentation' } });
  globalThis.fetch = async (url, init = {}) => { seen.push([init.method, String(url).replace(/^.*?\/api\//, '/api/'), init.body]); return answer; };
  try {
    assert.equal(await api.deckExportOdp(10, { notes: true }), answer);
    await api.deckExportOdp(11);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['POST', '/api/decks/10/export/odp', JSON.stringify({ notes: true, sources: false })],
    ['POST', '/api/decks/11/export/odp', JSON.stringify({ notes: false, sources: false })],
  ]);
});
