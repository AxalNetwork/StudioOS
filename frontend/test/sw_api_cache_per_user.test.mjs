/**
 * One person's cached API responses are never handed to another.
 *
 * WHAT WAS WRONG. `sw.js` kept ONE Cache Storage bucket for every API
 * response on the origin. A cache entry is keyed by URL alone — `Cache.match`
 * does not look at request headers, and the worker sends no `Vary` — so on
 * any browser two people sign in to, the second could be served the first's
 * private bodies: immediately on the stale-while-revalidate paths, and on
 * every other `/api/*` GET whenever the network threw. `offline.html`
 * promises "your own project data"; the code had no idea whose it was.
 *
 * `/api/auth/me` was the acute case and is fixed separately
 * (`sw_identity_never_cached.test.mjs`, which must keep passing whatever
 * happens here). This file is the rest of the surface.
 *
 * WHY THIS TEST RUNS THE WORKER INSTEAD OF READING IT. Every other guard in
 * this repo matches source text, which proves the shape of the code and not
 * the property. The property here is "a body written under one identity
 * cannot be read under another", and the ways to break it are not textual:
 * the global `caches.match` searching every bucket, an `activate` sweep that
 * deletes the new buckets, a name that two identities can collide on. So
 * `sw.js` is executed against a fake Cache Storage and two identities are
 * actually driven through it — the assertions are about what comes back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(process.cwd(), 'frontend/public/sw.js'), 'utf8');

/* ── a Cache Storage that behaves the way the real one does ──────────────
   Keyed by URL only, deliberately: that IS the browser's behaviour absent a
   `Vary`, and a fake that keyed on headers would quietly assert the bug away. */
class FakeCache {
  constructor() { this.entries = new Map(); }
  async match(req) { return this.entries.get(new URL(req.url).pathname + new URL(req.url).search); }
  async put(req, res) { this.entries.set(new URL(req.url).pathname + new URL(req.url).search, res); }
  async addAll() { /* precache is not under test */ }
}
class FakeCaches {
  constructor() { this.buckets = new Map(); }
  async open(name) {
    if (!this.buckets.has(name)) this.buckets.set(name, new FakeCache());
    return this.buckets.get(name);
  }
  async keys() { return [...this.buckets.keys()]; }
  async delete(name) { return this.buckets.delete(name); }
  /** The global match: searches EVERY bucket. The real one does this too,
   *  which is exactly why the worker must not use it for API reads. */
  async match(req) {
    for (const c of this.buckets.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

/** Load sw.js with its globals supplied, and hand back its event handlers. */
function loadWorker({ online = true, body = 'net' } = {}) {
  const handlers = {};
  const caches = new FakeCaches();
  let mode = { online, body };
  const self = {
    addEventListener: (name, fn) => { handlers[name] = fn; },
    location: { host: 'axal.vc', port: '', origin: 'https://axal.vc' },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  const fakeFetch = async () => {
    if (!mode.online) throw new TypeError('Failed to fetch');
    return new Response(mode.body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', SRC)(
    self, caches, fakeFetch, Response, Request, URL,
  );
  const req = (path, identity) => new Request(`https://axal.vc${path}`, {
    headers: identity ? { 'X-StudioOS-Identity': identity } : {},
  });
  /** Fire the fetch handler; undefined means the worker stood aside. */
  const go = async (path, identity) => {
    let out;
    handlers.fetch({ request: req(path, identity), respondWith: (p) => { out = p; }, waitUntil: () => {} });
    return out === undefined ? undefined : await out;
  };
  return {
    caches, handlers, go,
    setNetwork: (o, b) => { mode = { online: o, body: b ?? mode.body }; },
    activate: async () => {
      let done;
      handlers.activate({ waitUntil: (p) => { done = p; } });
      await done;
    },
  };
}

const ALICE = '8';
const BOB = '9';
const OWN_DATA = '/api/projects/41';          // stale-while-revalidate
const OTHER_API = '/api/companies/mine';      // network-first

test("a body cached for one account is not served to another, offline", async () => {
  // THE WHOLE POINT, on the path that actually leaked: network-first only
  // reads its cache when the network throws, so this is the offline case.
  for (const path of [OWN_DATA, OTHER_API]) {
    const w = loadWorker({ online: true, body: 'alice-secret' });
    assert.equal(await (await w.go(path, ALICE)).text(), 'alice-secret', 'setup: Alice was not served');

    w.setNetwork(false);
    const bob = await w.go(path, BOB);
    const seen = bob ? await bob.text() : '';
    assert.ok(!seen.includes('alice-secret'),
      `${path}: Bob was handed Alice's cached body`);
  }
});

test("and each account still gets its OWN body back offline", async () => {
  // The mirror assertion. Without it the test above passes by breaking the
  // offline read entirely, which is a promise `offline.html` makes in
  // writing — "Cached pages … are still available".
  const w = loadWorker({ online: true, body: 'alice-secret' });
  await w.go(OWN_DATA, ALICE);
  w.setNetwork(false);
  const again = await w.go(OWN_DATA, ALICE);
  assert.equal(await again.text(), 'alice-secret', 'the offline read is gone for its own owner');
});

test('two accounts get two buckets, named apart', async () => {
  const w = loadWorker();
  await w.go(OWN_DATA, ALICE);
  await w.go(OWN_DATA, BOB);
  const api = (await w.caches.keys()).filter((k) => k.startsWith('studioos-api-'));
  assert.equal(api.length, 2, `expected one API bucket per account, got ${JSON.stringify(api)}`);
  assert.equal(new Set(api).size, 2, 'both accounts resolved to the same bucket name');
  for (const id of [ALICE, BOB]) {
    assert.ok(api.some((k) => k.endsWith(`-${id}`)), `no bucket carries account ${id}`);
  }
});

test('a request with no identity gets its own bucket, never a signed-in one', async () => {
  const w = loadWorker({ online: true, body: 'alice-secret' });
  await w.go(OWN_DATA, ALICE);
  w.setNetwork(false);
  const anon = await w.go(OWN_DATA, undefined);
  const seen = anon ? await anon.text() : '';
  assert.ok(!seen.includes('alice-secret'), "a request with no identity read Alice's bucket");
  assert.ok((await w.caches.keys()).some((k) => k.endsWith('-anon')), 'there is no anonymous bucket');
});

test('a crafted identity cannot name another bucket', async () => {
  // The header is set by our own page, so this is not a live attack path —
  // but a value that is interpolated into a cache name is checked before it
  // is used, or it is only a matter of time.
  const w = loadWorker({ online: true, body: 'alice-secret' });
  await w.go(OWN_DATA, ALICE);
  w.setNetwork(false);
  //
  // `'8 '` WAS IN THIS LIST AND IS NOT A CASE. Fetch normalises header
  // values by stripping surrounding whitespace, so `'8 '` and `'8'` are the
  // same header — there is no wire on which they differ. Asserting the
  // padded one must miss Alice's bucket was asserting that 8 is not 8, which
  // no implementation can satisfy. The test was wrong, not the worker.
  for (const crafted of ['8x', '../8', '8-9', 'anon', '']) {
    const r = await w.go(OWN_DATA, crafted);
    const seen = r ? await r.text() : '';
    assert.ok(!seen.includes('alice-secret'), `identity ${JSON.stringify(crafted)} reached Alice's bucket`);
  }
  const api = (await w.caches.keys()).filter((k) => k.startsWith('studioos-api-'));
  assert.deepEqual(api.sort(), ['studioos-api-v17-2026-09-10-8', 'studioos-api-v17-2026-09-10-anon'],
    'a crafted identity created a bucket of its own');
});

test('identity is still never cached at all', async () => {
  // Belt and braces with sw_identity_never_cached.test.mjs, which reads the
  // source: this one proves the worker stands aside at runtime.
  const w = loadWorker();
  assert.equal(await w.go('/api/auth/me', ALICE), undefined,
    'the worker answered /api/auth/me instead of standing aside');
  assert.deepEqual(await w.caches.keys(), [], '/api/auth/me opened a cache');
});

test('activate keeps this build\'s per-account buckets and drops every older one', async () => {
  // The sweep deletes anything not current. With one bucket per account the
  // names cannot be listed, so they are kept by prefix — and getting that
  // wrong deletes every account's cache on every activate, or keeps the old
  // shared bucket forever. Both have to be checked.
  const w = loadWorker();
  await w.go(OWN_DATA, ALICE);
  await w.go(OWN_DATA, BOB);
  await w.caches.open('studioos-api-v16-2026-09-10');   // the old SHARED bucket
  await w.caches.open('studioos-static-v9-old');
  await w.activate();

  const left = (await w.caches.keys()).sort();
  assert.ok(left.includes('studioos-api-v17-2026-09-10-8'), "activate deleted an account's live bucket");
  assert.ok(left.includes('studioos-api-v17-2026-09-10-9'), "activate deleted an account's live bucket");
  assert.ok(!left.includes('studioos-api-v16-2026-09-10'),
    'the shared bucket from the previous build survived — every browser keeps reading it');
  assert.ok(!left.includes('studioos-static-v9-old'), 'a stale static cache survived');
});

test('sign-out drops the buckets, and the page is what does it', async () => {
  // The worker cannot see sign-out. `clearSession` in App.jsx has Cache
  // Storage from the page, and swept only localStorage and sessionStorage
  // before this — so a signed-out account's bodies stayed on disk.
  const APP = readFileSync(resolve(process.cwd(), 'frontend/src/App.jsx'), 'utf8');
  const at = APP.indexOf('const clearSession = useCallback');
  assert.ok(at >= 0, 'clearSession is gone');
  const body = APP.slice(at, APP.indexOf('const logout = useCallback', at));
  assert.ok(body.length > 200, "clearSession's end marker moved");
  assert.match(body, /caches\.keys\(\)/, 'sign-out does not look at Cache Storage');
  assert.match(body, /n\.startsWith\('studioos-api-'\)/,
    'sign-out does not select the API buckets');
  assert.match(body, /caches\.delete\(n\)/, 'sign-out finds the buckets and leaves them there');
});

test('the identity reaches the worker on every API call', async () => {
  // A per-request identity is only as good as its being sent. It goes in
  // `getAuthHeaders`, which every request path already funnels through —
  // asserted on the definition, since the name appears in the docblock too.
  const API = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');
  assert.match(API, /function getIdentityHeader\(\) \{/, 'the identity header is gone');
  assert.match(API, /'X-StudioOS-Identity': String\(id\)/, 'the header no longer carries the user id');
  const at = API.indexOf('function getAuthHeaders() {');
  assert.ok(at >= 0, 'getAuthHeaders is gone');
  const fn = API.slice(at, API.indexOf('\n}', at));
  assert.match(fn, /getIdentityHeader\(\)/,
    'getAuthHeaders no longer includes the identity, so most requests land in the anon bucket');
  // Never the address. The id is already known to the server; an email is a
  // different thing to be putting in a header on every call.
  assert.doesNotMatch(API.slice(at - 900, at + 300), /X-StudioOS-Identity'\]?\s*:\s*[^;]*email/,
    'the identity header carries an email address');
});
