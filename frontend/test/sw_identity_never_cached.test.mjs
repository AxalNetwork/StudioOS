/**
 * The service worker never caches who you are.
 *
 * HOW THIS WAS FOUND, because the shape of the bug is the reason this file
 * exists. Task #147's support session was driven end to end in Chromium: an
 * admin opens a session as a founder, the thirty minutes run out, and the
 * client hands the session back. It handed back correctly — token restored,
 * `user` set to the admin, session ended server-side — and then, sixteen
 * milliseconds later, the SPA wiped that and signed the admin in AS THE
 * FOUNDER, with no token at all. No request reached the server in that
 * window. The founder's `/api/auth/me` body had been answered sixty-five
 * seconds earlier and `sw.js` still had it.
 *
 * WHY IT WAS WORSE THAN A SUPPORT-SESSION BUG. A Cache Storage entry is keyed
 * by URL. `Cache.match` does not look at request headers, and the worker
 * sends no `Vary`, so the `Authorization` header is not part of the key. One
 * cached `/api/auth/me` was replayed to whoever asked next on that browser,
 * whatever token they held — a second person signing in on a shared machine
 * read the first person's identity until the revalidation landed. The SPA's
 * identity-change purge (`useAuthSync`, Task #4) exists to clean up exactly
 * that, and it was cleaning up after this line.
 *
 * So two things are pinned here: the pattern list must not name an auth
 * route, and the fetch handler must return before either cache strategy can
 * see one. Both, because either alone still leaves a path: dropping it from
 * the stale-while-revalidate list leaves `networkFirst`, which `cache.put`s
 * every 200 and replays it whenever the network throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SW = readFileSync(resolve(process.cwd(), 'frontend/public/sw.js'), 'utf8');

/** One named array's literal, bounded at both ends. */
function list(name) {
  const a = SW.indexOf(`const ${name} = [`);
  assert.ok(a >= 0, `${name} is gone from sw.js`);
  const b = SW.indexOf('];', a);
  assert.ok(b > a, `${name} is unterminated`);
  return SW.slice(a, b);
}

test('no auth route is offered for offline read', () => {
  // `/api/auth/me` was in this list. Anything under /api/auth is identity or
  // session state and none of it may be answered from disk.
  const offline = list('OFFLINE_API_PATTERNS');
  assert.ok(!offline.includes('/api\\/auth'),
    'an /api/auth route is back in the stale-while-revalidate list');
  // The list still does its job for the two surfaces it is for — if this
  // ever empties, offline read is gone and the assertion above is vacuous.
  assert.ok(offline.includes('academy'), 'the offline list no longer covers academy');
  assert.ok(offline.includes('projects'), 'the offline list no longer covers projects');
});

test('auth is refused both caches, not just one', () => {
  const never = list('NEVER_CACHE_API');
  assert.match(never, /\/\^\\\/api\\\/auth\(\\\/\|\$\)\//,
    'the never-cache list no longer covers /api/auth');
});

test('the refusal happens before either strategy runs', () => {
  // A list nothing consults is a comment. The order matters too: the check
  // has to come before the stale-while-revalidate branch, and it has to be a
  // bare `return` — falling through to `respondWith` would put the request
  // back inside a strategy.
  const at = SW.indexOf("if (url.pathname.startsWith('/api/'))");
  assert.ok(at >= 0, 'the /api routing branch is gone');
  const branch = SW.slice(at, SW.indexOf('return;', SW.indexOf('networkFirst(request', at)));
  const never = branch.indexOf('isNeverCachableApi(url)');
  const swr = branch.indexOf('isOfflineCachableApi(url)');
  assert.ok(never >= 0, 'the /api branch never consults the never-cache list');
  assert.ok(swr > never, 'the never-cache check no longer runs before stale-while-revalidate');
  assert.match(branch.slice(never, swr), /\breturn;/,
    'an auth request is still handed to a caching strategy instead of the network');
  // Not respondWith — that would answer from the worker and re-enter a cache.
  assert.doesNotMatch(branch.slice(never, swr), /respondWith/,
    'the never-cache path answers the request itself instead of standing aside');
});

test('the cache names changed, so the poisoned ones are dropped', () => {
  // `activate` deletes every cache whose name is not current. Fixing the
  // strategy without renaming would leave every existing browser reading
  // its old `studioos-api-v15-…` entries forever.
  //
  // TWO ASSERTIONS HERE WERE REWRITTEN, and not because they were
  // inconvenient. They pinned `const RUNTIME_API = ...` and an `activate`
  // sweep over exactly three names. The single shared API bucket those
  // described is gone: it is now one bucket per signed-in account
  // (`API_CACHE_PREFIX` + identity, see sw_api_cache_per_user.test.mjs),
  // because one bucket for the whole origin meant the next person to sign
  // in on a browser could be served the previous person's API bodies. Those
  // names cannot be listed, so the sweep keeps them by prefix. What both
  // assertions were FOR is unchanged and is what they check now: the API
  // cache name carries VERSION, so bumping it drops what came before.
  const m = SW.match(/const VERSION = '([^']+)'/);
  assert.ok(m, 'VERSION is gone');
  for (const stale of ['v15-2026-08-05', 'v16-2026-09-10']) {
    assert.notEqual(m[1], stale,
      `VERSION still names build ${stale}, whose API cache holds other accounts' bodies`);
  }
  assert.match(SW, /const API_CACHE_PREFIX = `studioos-api-\$\{VERSION\}-`/,
    'the API cache name no longer carries VERSION, so a bump would not clear it');
  assert.match(SW, /k === PRECACHE \|\| k === RUNTIME_STATIC \|\| k\.startsWith\(API_CACHE_PREFIX\)/,
    'activate no longer keeps exactly the current caches — it drops the live ones or keeps the stale ones');
});
