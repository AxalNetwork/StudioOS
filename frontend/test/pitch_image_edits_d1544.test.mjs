/**
 * D1544 (#3784, deck builder v2 B8): image edits reach the studio through one
 * client and one adapter key, and the lightbox's references line follows the
 * quoted model. The Worker routes are held by
 * `cloudflare-worker/test/deck_image_edits_d1544.test.ts`.
 *
 *   · the client's verbs, paths and bodies; api.js re-exports it (D527); no
 *     request names a model;
 *   · the adapter's `imageVary` prices an edit through the client's quote and
 *     answers it as available; "Edit or vary" is #3784's row, while
 *     background removal and upscale stay #3778's;
 *   · a model that takes references (FLUX.2) gets its line; Schnell keeps the
 *     "no references" line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deckImageEditsApi, editBody } from '../src/lib/api/deckImageEdits.js';
import { deckImageEditsApi as viaApi } from '../src/lib/api.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { ELEMENT_GROUPS } from '../src/pages/raise/pitch/deckV2Model.js';
import { NO_REFERENCES, TAKES_REFERENCES, takesReferences } from '../src/pages/raise/pitch/imageModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const store = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  };
}

test('the client: each call\'s verb, path and body, and api.js re-exports it (D527); no request names a model', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await deckImageEditsApi.quote('u 1', { op: 'edit', instruction: '  Warmer lamp ', model: '@cf/any/model' });
    await deckImageEditsApi.edit('u/1', { op: 'erase', mask: 'data:image/png;base64,AAAA' });
    await deckImageEditsApi.edit('u1', { op: 'expand', aspect: '16:9', instruction: '' });
    await deckImageEditsApi.revert('c1');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['POST', '/api/decks/images/u%201/edit/quote', { op: 'edit', instruction: 'Warmer lamp' }],
    ['POST', '/api/decks/images/u%2F1/edit', { op: 'erase', mask: 'data:image/png;base64,AAAA' }],
    ['POST', '/api/decks/images/u1/edit', { op: 'expand', aspect: '16:9' }],
    ['POST', '/api/decks/images/c1/revert', {}],
  ]);
  assert.equal(viaApi, deckImageEditsApi);
  assert.equal('model' in editBody({ op: 'vary', model: 'x' }), false, 'a request never names a model');
});

test('the adapter: imageVary prices an edit through the client and is on; Edit or vary is #3784\'s row', async () => {
  const orig = deckImageEditsApi.quote;
  const asked = [];
  deckImageEditsApi.quote = async (uid, ask) => { asked.push([uid, ask]); return { ai: true, op: ask.op, hold_microusd: 1200 }; };
  try {
    const answer = await adapter.imageVary('u1', { op: 'vary' });
    assert.deepEqual(answer, { available: true, value: { ai: true, op: 'vary', hold_microusd: 1200 } });
    assert.deepEqual(asked, [['u1', { op: 'vary' }]]);
  } finally { deckImageEditsApi.quote = orig; }
  assert.ok(adapter.SWAPPED.includes('imageVary'));
  assert.equal(adapter.SURFACES.imageVary.issue, 3784);
  assert.equal(adapter.availability('imageVary'), null, 'on');
  const images = ELEMENT_GROUPS.find((g) => g.id === 'images').items;
  const row = (id) => images.find((i) => i.id === id);
  assert.equal(row('edit_vary').issue, 3784);
  assert.equal(row('remove_bg').issue, 3778, 'background removal stays #3778\'s');
  assert.equal(row('upscale').issue, 3778, 'upscale stays #3778\'s');
});

test('the lightbox\'s references line follows the quoted model', () => {
  assert.equal(takesReferences('@cf/black-forest-labs/flux-2-klein-4b'), true);
  assert.equal(takesReferences('@cf/black-forest-labs/flux-1-schnell'), false);
  assert.equal(takesReferences(undefined), false);
  const src = read('frontend/src/pages/raise/pitch/ImageLightbox.jsx');
  assert.match(src, /takesReferences\(quote\?\.model\)\s*\?\s*<span[^>]*data-testid="pitch-image-takes-references">\{TAKES_REFERENCES\}/);
  assert.match(src, /data-testid="pitch-image-no-references">\{NO_REFERENCES\}/);
  assert.match(TAKES_REFERENCES, /up to 4 reference images/);
  assert.match(NO_REFERENCES, /takes no reference images/);
});
