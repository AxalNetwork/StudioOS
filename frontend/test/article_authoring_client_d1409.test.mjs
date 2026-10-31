// D1409 (#3695) — `articleAuthoringApi` asks the Worker's article assist
// routes: the path, the method and the body each method sends.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/article_authoring_client_d1409.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument } from './_contracts_dom.mjs';
import * as api from '../src/lib/api.js';

async function asked(fn) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (u, init = {}) => {
    seen = { path: new URL(String(u), 'http://x').pathname, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' };
  };
  try { await fn(api.articleAuthoringApi); } finally { globalThis.fetch = previous; restore(); }
  return seen;
}

test('the module is re-exported from api.js', () => {
  assert.equal(typeof api.articleAuthoringApi?.quote, 'function');
  assert.equal(typeof api.articleAuthoringApi?.assist, 'function');
});

test('quote and assist POST the option and its input to the article\'s routes', async () => {
  const q = await asked((a) => a.quote(5, 'draft:article-outline', { brief: 'Why ledgers' }));
  assert.deepEqual([q.path, q.method, q.body], ['/api/articles/5/assist/quote', 'POST', { option: 'draft:article-outline', input: { brief: 'Why ledgers' } }]);
  const r = await asked((a) => a.assist(5, 'rewrite:article', { selection: 'x', tone: 'plainer' }));
  assert.deepEqual([r.path, r.method, r.body], ['/api/articles/5/assist', 'POST', { option: 'rewrite:article', input: { selection: 'x', tone: 'plainer' } }]);
  const empty = await asked((a) => a.assist(5, 'draft:article-seo'));
  assert.deepEqual(empty.body, { option: 'draft:article-seo', input: {} }, 'an option with no input sends an empty one');
  const enc = await asked((a) => a.quote('5/../6', 'draft:article-seo'));
  assert.equal(enc.path, '/api/articles/5%2F..%2F6/assist/quote', 'the id is encoded');
  const encRun = await asked((a) => a.assist('5/../6', 'draft:article-seo'));
  assert.equal(encRun.path, '/api/articles/5%2F..%2F6/assist', 'the run encodes it too');
});
