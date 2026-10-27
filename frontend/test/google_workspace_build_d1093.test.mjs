/**
 * D1093 (#2958) — the client for Google Workspace on Build: each call names
 * the Worker route `routes/build_google.ts` serves, with the venture, and
 * sends nothing a page computed. Mounting "From Google" waits for #2956's
 * shared component (D1314).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/google_workspace_build_d1093.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { googleWorkspaceBuild } from '../src/lib/api/googleWorkspaceBuild.js';

test('each client call names its route and the venture, and sends only the venture', async () => {
  const seen = [];
  const previous = globalThis.fetch;
  const store = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async (u, o = {}) => {
    seen.push([o.method || 'GET', String(u), o.body ? JSON.parse(o.body) : null]);
    return { ok: true, status: 200, type: 'basic', redirected: false, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' };
  };
  try {
    await googleWorkspaceBuild.fromGoogle(7);
    await googleWorkspaceBuild.sync(7);
    await googleWorkspaceBuild.accept(7, 12);
    await googleWorkspaceBuild.dismiss(7, 13);
  } finally { globalThis.fetch = previous; globalThis.localStorage = store; }
  assert.deepEqual(seen, [
    ['GET', '/api/cycles/build/google?project=7', null],
    ['POST', '/api/cycles/build/google/sync', { project: 7 }],
    ['POST', '/api/cycles/build/google/proposals/12/accept', { project: 7 }],
    ['POST', '/api/cycles/build/google/proposals/13/dismiss', { project: 7 }],
  ]);
});

test('the client is re-exported by one line in api.js, and the Worker serves its routes', () => {
  assert.match(readFileSync('frontend/src/lib/api.js', 'utf8'), /^export \* from '\.\/api\/googleWorkspaceBuild\.js';$/m);
  const routes = readFileSync('cloudflare-worker/src/routes/build_google.ts', 'utf8');
  for (const r of [`build.get('/',`, `build.post('/sync',`, 'build.post(`/proposals/:id/${verb}`']) assert.ok(routes.includes(r), r);
  assert.match(readFileSync('cloudflare-worker/src/index.ts', 'utf8'), /app\.route\('\/api\/cycles\/build\/google', buildGoogleRoutes\);\napp\.route\('\/api\/cycles\/build', cycleBuildRoutes\);/);
  assert.match(readFileSync('documentation/architecture/decisions/D1093.md', 'utf8'), /## D1093/);
});
