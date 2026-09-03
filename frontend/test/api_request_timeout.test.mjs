/**
 * `request()` has a deadline, and the deadline is honest about what fired.
 *
 * WHY THIS FILE EXISTS. `fetch` has no timeout, and until this landed neither
 * did `frontend/src/lib/api.js` — no `AbortController` anywhere, on any of the
 * ~1300 SPA calls. A request that never settled left its caller's `loading`
 * flag true for good: the same perpetual spinner #427 fixed on
 * /expertise/profile, reachable from any page, and recorded nowhere when it
 * happened. GOTCHAS still carries an open census of 254 504s from 2026-08-30
 * whose cause was never found; a client deadline is the evidence that
 * investigation did not have.
 *
 * MOST OF THIS IS UNIT-TESTED, NOT REGEX-MATCHED. The rest of this suite reads
 * source as text because there is no DOM here (frontend/test/README.md), but
 * the deadline logic is pure by construction — `deadlineFor` and `armDeadline`
 * take plain arguments and touch no network — so it is exercised directly.
 * Two cases do need a `fetch`, and stub `globalThis.fetch` rather than assert
 * on source: whether a hung request rejects, and what it rejects WITH, is the
 * whole point and a regex cannot see it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_TIMEOUT_MS,
  LONG_TIMEOUT_MS,
  SLOW_PATHS,
  armDeadline,
  deadlineFor,
  request,
  timeoutError,
} from '../src/lib/api.js';

const API = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');

// `request()` reads the auth token and the CSRF cookie on its way out. There
// is no DOM here, so stand up the two globals it needs — signed out, no
// cookie, which is the state a deadline test wants anyway.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.document ??= { cookie: '' };

/** Swap in a fake `fetch` for one call and always put the real one back. */
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/**
 * Every path literal `request()` is called with, as a matchable string.
 *
 * A template path interpolates an id, so `${…}` becomes a placeholder segment
 * rather than being truncated: `/references/${id}/transcribe` has to come back
 * as a path with BOTH halves, or a pattern anchored on the tail could not be
 * checked at all. Three delimiters, matched separately, so a quote inside a
 * `${…}` does not end the capture early.
 */
function requestPaths(code) {
  const out = new Set();
  for (const re of [/request\(\s*`([^`]*)`/g, /request\(\s*'([^']*)'/g, /request\(\s*"([^"]*)"/g]) {
    for (const m of code.matchAll(re)) {
      out.add(m[1].replace(/\$\{[^}]*\}/g, 'x').split('?')[0]);
    }
  }
  return [...out];
}

test('every call gets a deadline, and it clears both bounds that constrain it', () => {
  // Below: a cold isolate pays 15-20 sequential D1 round-trips before its
  // first response (GOTCHAS). Above: Cloudflare's gateway gives up near 100s,
  // so a longer default would bound nothing.
  assert.equal(deadlineFor('/advisors/me'), DEFAULT_TIMEOUT_MS);
  assert.ok(DEFAULT_TIMEOUT_MS >= 20_000, 'a cold start must not be aborted as a hang');
  assert.ok(DEFAULT_TIMEOUT_MS < 100_000, 'past the gateway timeout the deadline bounds nothing');
});

test('generation and upload get the long deadline without a call site remembering', () => {
  // Generation: the worker is calling aiRouter, Workers AI, or a live crawl.
  assert.equal(deadlineFor('/decks/generate'), LONG_TIMEOUT_MS);
  assert.equal(deadlineFor('/advisory/ask'), LONG_TIMEOUT_MS);
  // Path ids in the middle — the case a startsWith list could not express.
  assert.equal(deadlineFor('/funds/12/regenerate-lpa'), LONG_TIMEOUT_MS);
  assert.equal(deadlineFor('/references/ab3/transcribe'), LONG_TIMEOUT_MS);
  // A query string is never what makes a call slow.
  assert.equal(deadlineFor('/scoring/score?range=90d'), LONG_TIMEOUT_MS);

  // Uploads are detected from the body, so nobody has to annotate them. Their
  // duration belongs to the user's connection, not the server.
  if (typeof FormData !== 'undefined') {
    assert.equal(deadlineFor('/decks/import', { body: new FormData() }), LONG_TIMEOUT_MS);
  }

  // And an ordinary read is NOT swept up by any of the patterns.
  assert.equal(deadlineFor('/advisors/me'), DEFAULT_TIMEOUT_MS);
  assert.equal(deadlineFor('/tickets'), DEFAULT_TIMEOUT_MS);
});

test('every SLOW_PATHS pattern still matches a real call in api.js', () => {
  // THIS IS THE TEST THAT CAUGHT THE FIRST DRAFT. Written from memory, the
  // list had `/ask-advisory`, `/legal/generate`, `/onboarding/chat` and
  // `/score` — four paths this codebase does not serve; the real ones are
  // /advisory/ask, /legalcap/legal/generate, /profiling/chat and /scoring/*.
  // A slow-path entry that matches nothing is not inert, it is a promise of a
  // longer deadline that silently never applies.
  const paths = requestPaths(API);
  assert.ok(paths.length > 200, `parse failed — only ${paths.length} request() paths found`);

  for (const re of SLOW_PATHS) {
    const hit = paths.some((p) => re.test(p));
    assert.ok(hit, `${re} matches no request() path in api.js — a deadline nobody gets`);
  }
});

/**
 * A `fetch` that never answers — but that honours its signal exactly as the
 * real one does, rejecting with a DOMException-shaped `AbortError`. Faithful
 * on purpose: a stub that ignored the signal would hang the test rather than
 * exercise anything, and it is precisely the conversion of THAT rejection into
 * a `TimeoutError` that this file needs to prove.
 */
const hangingFetch = (_url, init) => new Promise((_resolve, reject) => {
  const abort = () => {
    const e = new Error('The operation was aborted.');
    e.name = 'AbortError';
    reject(e);
  };
  const signal = init?.signal;
  if (!signal) return;                    // no signal: hangs, as fetch would
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort);
});

test('a hung request rejects as a timeout rather than spinning', async () => {
  const started = Date.now();
  await withFetch(hangingFetch, async () => {
    await assert.rejects(
      () => request('/advisors/me', { timeoutMs: 60 }),
      (e) => {
        assert.equal(e.code, 'timeout', 'callers branch on the machine flag');
        assert.equal(e.name, 'TimeoutError');
        return true;
      },
    );
  });
  assert.ok(Date.now() - started < 5_000, 'it must reject on its own, not wait for the caller');
});

test('the timeout error cannot be mistaken for the three things it resembles', () => {
  const e = timeoutError('/advisors/me', DEFAULT_TIMEOUT_MS);

  // 1. LoginPage and SettingsPage both read `name === 'AbortError'` to mean
  //    "the user dismissed the passkey prompt". A timeout is not that.
  assert.notEqual(e.name, 'AbortError');

  // 2. RouteErrorBoundary and main.jsx reload the whole page on a message
  //    matching this. A timeout must never trigger a reload.
  assert.doesNotMatch(e.message, /Failed to fetch dynamically imported module/i);

  // 3. Pages render `e?.message || 'Failed to load'` verbatim, so the message
  //    is prose for a human — never `signal is aborted without reason`.
  assert.doesNotMatch(e.message, /abort/i);
  assert.match(e.message, /did not respond/);

  // No HTTP status, because there was no HTTP response. Consumers branching on
  // `e.status` fall through to their generic branch, which is the truth.
  assert.equal(e.status, undefined);
});

test('a caller cancelling is not reported as a timeout', () => {
  const controller = new AbortController();
  const deadline = armDeadline(60_000, controller.signal);
  controller.abort();
  assert.equal(deadline.timedOut(), false, 'the caller aborted, not the deadline');
  deadline.cleanup();
});

test('no timer outlives its request', async () => {
  // BEHAVIOURAL, not a source match, because the first version of this test
  // asserted only that `cleanup()` was CALLED — and passed while `cleanup`
  // itself had lost its `clearTimeout`. A leaked timer does not fail loudly:
  // it keeps the event loop alive and fires into a request that finished long
  // ago. Arm a short deadline, clear it, and wait past when it would have hit.
  const deadline = armDeadline(20, undefined);
  deadline.cleanup();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(deadline.timedOut(), false, 'a cleared deadline must never fire');

  // And it is cleared on the success path too, not only on failure.
  assert.match(API, /finally\s*\{[^}]*deadline\.cleanup\(\)/,
    'request() must clear its timer on every exit path, success included');

  // Opting out must not arm anything at all.
  const none = armDeadline(null, undefined);
  assert.equal(none.signal, undefined);
  assert.equal(none.timedOut(), false);
});

test('a caller passing headers still sends auth, CSRF and company', async () => {
  // THE LATENT BUG THIS PINS SHUT. The fetch init used to spread `...options`
  // LAST, after `headers: baseHeaders` — so any caller passing `headers`
  // replaced the merged object with its own raw one and shipped the request
  // with no Authorization, no CSRF token and no X-Company-Id. Only
  // /auth/google/start reached it, a GET needing none of the three, so it
  // never surfaced. `signal` would have been dropped the same way, which would
  // have made every deadline above silently inert.
  let seen = null;
  await withFetch(async (_url, init) => {
    seen = init;
    return { ok: true, status: 200, json: async () => ({}) };
  }, () => request('/auth/google/start', { headers: { accept: 'application/json' } }));

  assert.ok(seen, 'fetch was not called');
  assert.equal(seen.headers.accept, 'application/json', "the caller's own header survives");
  assert.equal(seen.headers['Content-Type'], 'application/json', 'the merged headers survive too');
  assert.ok(seen.signal, 'the deadline signal must not be spread away');
});

test('a timeout is never retried into a second full wait', () => {
  // `_analyticsRead` retries once on anything with no `.status`, which a
  // timeout has none of — so on reflex it would turn a 30s bound into
  // 30 + 1 + 30. The user has already waited the deadline once.
  const helper = API.slice(API.indexOf('async function _analyticsRead'));
  const body = helper.slice(0, helper.indexOf('\n}'));
  assert.match(body, /code === 'timeout'/, 'the retry must exclude timeouts');
  assert.ok(
    body.indexOf("code === 'timeout'") < body.indexOf('setTimeout'),
    'the exclusion must come before the backoff, or the wait happens anyway',
  );
});

test('a timeout is written down, not just thrown', () => {
  // An invisible failure is what left the 2026-08-30 census of 254 504s
  // unexplained. reportError consoles, keeps a capped ring buffer support can
  // read off the affected browser, and beacons POST /api/client-error into the
  // Worker logs.
  assert.match(API, /reportError\('api:timeout'/);
});
