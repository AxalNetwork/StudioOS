/**
 * D9277 (#9277): the Eadwyn client names a conversation's space, `{ scope, id }`, on start and on list, and keeps the
 * older workspace call working. The Worker side is `cloudflare-worker/test/eadwyn_space_d9277.test.ts`. The composer
 * prints the space's name the Worker returns.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_space_client_9277.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};
const { eadwynApi } = await import('../src/lib/api/eadwyn.js');

test('start and list take a space, and a workspace string stays the older call', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await eadwynApi.start({ scope: 'project', id: 7, workspace: 'Build' });
    await eadwynApi.start({ scope: 'company', id: 41 });
    await eadwynApi.start('Build');
    await eadwynApi.conversations({ scope: 'project', id: 7 });
    await eadwynApi.conversations('Build & Raise');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['POST', '/api/eadwyn/conversations', { scope: 'project', id: 7, workspace: 'Build' }],
    ['POST', '/api/eadwyn/conversations', { scope: 'company', id: 41 }],
    ['POST', '/api/eadwyn/conversations', { workspace: 'Build' }],
    ['GET', '/api/eadwyn/conversations?scope=project&id=7', null],
    ['GET', '/api/eadwyn/conversations?workspace=Build%20%26%20Raise', null],
  ]);
});

test('the composer header prints the conversation\'s space from the Worker', () => {
  const src = readFileSync(new URL('../src/ui/EadwynComposer.jsx', import.meta.url), 'utf8');
  assert.match(src, /conv\.space\?\.name && <span className="ead-space" data-testid="text-eadwyn-space">In \{conv\.space\.name\}<\/span>/);
  assert.match(src, /space: r\.conversation\?\.space \?\? null/, 'a reopened conversation drops its space');
});
