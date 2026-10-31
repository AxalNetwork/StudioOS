/**
 * D1421 (#3699): the Studio layout client calls the Worker routes the Worker
 * test holds, with these paths, verbs and bodies, sends `profile` only when
 * given, and is re-exported from api.js in alphabetical position (D527).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { studioLayoutApi } = await import('../src/lib/api/studioLayout.js');
const { studioLayoutApi: viaApi } = await import('../src/lib/api.js');

test('paths, verbs and bodies; profile only when given', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ?? null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const layout = [{ key: 'today', size: '1/2' }];
  try {
    await studioLayoutApi.modules();
    await studioLayoutApi.modules('advisor');
    await studioLayoutApi.layout();
    await studioLayoutApi.layout('partner');
    await studioLayoutApi.saveLayout(layout);
    await studioLayoutApi.saveLayout([], 'investor');
    await studioLayoutApi.resetLayout();
    await studioLayoutApi.resetLayout('a b');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['GET', '/api/studio/modules', null],
    ['GET', '/api/studio/modules?profile=advisor', null],
    ['GET', '/api/studio/layout', null],
    ['GET', '/api/studio/layout?profile=partner', null],
    ['PUT', '/api/studio/layout', JSON.stringify({ layout })],
    ['PUT', '/api/studio/layout?profile=investor', JSON.stringify({ layout: [] })],
    ['POST', '/api/studio/layout/reset', null],
    ['POST', '/api/studio/layout/reset?profile=a%20b', null],
  ]);
});

test('api.js re-exports the module, in alphabetical position (D527)', () => {
  assert.equal(viaApi, studioLayoutApi);
  const lines = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8').split('\n').filter((l) => /^export \* from '\.\/api\//.test(l));
  const at = lines.indexOf("export * from './api/studioLayout.js';");
  assert.ok(at > 0);
  assert.ok(lines[at - 1] < lines[at] && lines[at] < lines[at + 1], `${lines[at - 1]} / ${lines[at + 1]}`);
});
