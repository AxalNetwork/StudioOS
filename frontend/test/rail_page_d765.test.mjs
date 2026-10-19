/**
 * D765 (#2090) — the rail's page rides on every request as `X-Rail-Page`
 * (and `X-Rail-Option`), so the Worker records each run where it was spent
 * and checks that page's switch.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_page_d765.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument } from './_contracts_dom.mjs';
import { clearRailPage, railPageHeaders, setRailPage } from '../src/lib/railPage.js';

test('the store: the rail\'s page lower-cased and URI-encoded, its option, and a clear that only the latest owner makes', () => {
  assert.deepEqual(railPageHeaders(), {}, 'no rail mounted: nothing is sent');
  const a = setRailPage('Perks & Products');
  assert.deepEqual(railPageHeaders(), { 'X-Rail-Page': 'perks%20%26%20products' });
  const b = setRailPage(' Validate ', 'fill:pain_tag');
  assert.deepEqual(railPageHeaders(), { 'X-Rail-Page': 'validate', 'X-Rail-Option': 'fill%3Apain_tag' });
  clearRailPage(a);
  assert.equal(railPageHeaders()['X-Rail-Page'], 'validate', 'an older rail unmounting after a newer one mounted clears nothing');
  clearRailPage(b);
  assert.deepEqual(railPageHeaders(), {});
  setRailPage('');
  assert.deepEqual(railPageHeaders(), {}, 'an empty workspace sends nothing');
});

test('request() sends the rail headers beside auth and CSRF, and a caller\'s own headers still win', async () => {
  const restore = installDocument();
  const before = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => { seen.push(opts.headers); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const { request, rawRequestHeaders } = await import('../src/lib/api.js');
    const token = setRailPage('Build');
    await request('/ai/eadwyn', { method: 'POST', body: '{}' });
    assert.equal(seen[0]['X-Rail-Page'], 'build');
    assert.equal(rawRequestHeaders('POST')['X-Rail-Page'], 'build', 'a module that calls fetch itself sends it too');
    await request('/ai/eadwyn', { method: 'POST', body: '{}', headers: { 'X-Rail-Page': 'grow' } });
    assert.equal(seen[1]['X-Rail-Page'], 'grow');
    clearRailPage(token);
    await request('/ai/eadwyn', { method: 'POST', body: '{}' });
    assert.equal('X-Rail-Page' in seen[2], false);
  } finally { globalThis.fetch = before; restore(); }
});

test('WorkerRail marks its workspace as the page while it is mounted', () => {
  const src = readFileSync(new URL('../src/ui/WorkerRail.jsx', import.meta.url), 'utf8');
  assert.match(src, /const token = setRailPage\(workspace\);\s*return \(\) => clearRailPage\(token\);\s*\}, \[workspace\]\);/);
});
