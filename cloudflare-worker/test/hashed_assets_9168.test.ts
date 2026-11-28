/**
 * D9168 (#9168): hashed `/assets/*` files leave the Worker as `immutable` for a year; a miss stays a `no-store`
 * 404; HEAD is answered like GET. Driven through the real Worker entry with a fake assets binding, so the
 * routing in `index.ts` is what is tested, not only the helper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

const ctx: any = { waitUntil() {}, passThroughOnException() {} };
const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';
/** A Worker env whose assets binding always answers `res`, to drive the /assets/ branch with any status. */
const answering = (res: () => Response) => ({ ASSETS: { fetch: async () => res() }, ENVIRONMENT: 'development', JWT_SECRET: 'z'.repeat(64) } as any);
const JS = 'export const x = 1;\n';
const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';

/** A fake ASSETS binding: one hashed file, the SPA fallback (index.html) for anything else, as `not_found_handling` does. */
function env() {
  const seen: Array<{ method: string; path: string }> = [];
  const ASSETS = {
    fetch: async (req: Request) => {
      const { pathname } = new URL(req.url);
      seen.push({ method: req.method, path: pathname });
      if (pathname === '/assets/index-BrjndlSl.js') {
        if (req.headers.get('if-none-match') === '"abc"') return new Response(null, { status: 304, headers: { etag: '"abc"', 'cache-control': 'public, max-age=0, must-revalidate' } });
        return new Response(req.method === 'HEAD' ? null : JS, { status: 200, headers: { 'content-type': 'text/javascript', etag: '"abc"', 'cache-control': 'public, max-age=0, must-revalidate' } });
      }
      return new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
    },
  };
  return { env: { ASSETS, ENVIRONMENT: 'development', JWT_SECRET: 'z'.repeat(64) } as any, seen };
}

const get = (e: any, path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://axal.vc${path}`, init), e, ctx);

test('a hashed asset that exists leaves as immutable for a year, with its body, type and etag intact', async () => {
  // Mutation checked: the cache-control set removed → the binding's max-age=0 comes through and this fails.
  const { env: e } = env();
  const res = await get(e, '/assets/index-BrjndlSl.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('content-type'), 'text/javascript');
  assert.equal(res.headers.get('etag'), '"abc"');
  assert.equal(await res.text(), JS);
});

test('a revalidation answered 304 also carries immutable, so the browser stops asking', async () => {
  const { env: e } = env();
  const res = await get(e, '/assets/index-BrjndlSl.js', { headers: { 'if-none-match': '"abc"' } });
  assert.equal(res.status, 304);
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE);
});

test('a missing hash is a plain 404 with no-store, never the shell and never cached', async () => {
  // Mutations checked: the html test dropped → the shell is served for a missing chunk with status 200;
  // `no-store` turned to the immutable value → a miss would be cached for a year.
  const { env: e } = env();
  const res = await get(e, '/assets/index-OLDHASH0.js');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await res.text(), 'Asset not found\n');
  // A real 404 from the binding (no SPA fallback) is the same answer.
  const plain = await get(answering(() => new Response('gone', { status: 404, headers: { 'content-type': 'text/javascript' } })), '/assets/gone-0.js');
  assert.deepEqual([plain.status, plain.headers.get('cache-control')], [404, 'no-store']);
});

test('HEAD on a hashed asset is answered like GET (it was a 404 before #9168)', async () => {
  // Mutation checked: the HEAD method dropped from the branch → HEAD falls through and is not answered by the binding.
  const { env: e, seen } = env();
  const res = await get(e, '/assets/index-BrjndlSl.js', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE);
  assert.deepEqual(seen, [{ method: 'HEAD', path: '/assets/index-BrjndlSl.js' }]);
  const miss = await get(e, '/assets/index-OLDHASH0.js', { method: 'HEAD' });
  assert.deepEqual([miss.status, miss.headers.get('cache-control')], [404, 'no-store']);
});

test('another status from the binding passes through untouched, and nothing outside /assets/ is changed', async () => {
  const odd = await get(answering(() => new Response('busy', { status: 503, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } })), '/assets/busy-0.js');
  assert.deepEqual([odd.status, odd.headers.get('cache-control')], [503, 'no-store']);
  // A POST to /assets/ is not a file read: it never reaches the binding and never leaves as immutable.
  const { env: e, seen } = env();
  const quiet = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const post = await get(e, '/assets/index-BrjndlSl.js', { method: 'POST', body: 'x' });
    assert.notEqual(post.headers.get('cache-control'), IMMUTABLE_ASSET_CACHE);
  } finally { [console.warn, console.error] = quiet; }
  assert.ok(!seen.some((s) => s.method === 'POST'));
});
