/**
 * What `reportError` actually produces — the first test `lib/log.js` has had.
 *
 * WHY THIS IS A UNIT TEST AND NOT A SOURCE SCAN. The rest of this suite reads
 * source as text because there is no DOM here (frontend/test/README.md). This
 * file cannot: the bug it was written for is that `reportError(err, { where })`
 * COMPILES, LINTS AND RUNS. Nothing about the source text is wrong. What is
 * wrong is the object that comes out the other end — no stack, a message of
 * "[object Object]", and the error's own text sitting in the one field that is
 * beaconed without redaction. Only calling it can see that, exactly as
 * `api_request_timeout.test.mjs` argues for the deadline.
 *
 * The module is pure enough to call directly: it touches `localStorage`,
 * `window.location` and `fetch`, all stubbed below and all restored.
 *
 * ONE SHARED PIECE OF MODULE STATE TO KNOW ABOUT: the beacon's per-page-load
 * counter (`_BEACON_MAX = 25`) and its dedupe Map live at module scope, so
 * every test here draws on the same budget and every test uses its own scope
 * string to avoid deduping against a sibling.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `window` must exist before the module is evaluated: log.js hangs
// `__axalErrors` off it at import time for support to call in a console.
globalThis.window ??= { location: { pathname: '/spinout-lab/scoring' } };
globalThis.localStorage ??= (() => {
  let store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store = new Map(); },
  };
})();

const { reportError, reportWarn, getClientErrors, clearClientErrors, redact } =
  await import('../src/lib/log.js');

const LOG_SRC = readFileSync(resolve(process.cwd(), 'frontend/src/lib/log.js'), 'utf8');

/** Run `fn` with a fake `fetch`, collecting every beacon body, then restore. */
async function withBeacons(fn) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), init });
    return Promise.resolve({ ok: true });
  };
  try { await fn(sent); } finally { globalThis.fetch = real; }
  return sent;
}

/** The newest ring-buffer entry. */
const last = () => getClientErrors().at(-1);

test('a correct call carries the error itself — name, message and a real stack', () => {
  clearClientErrors();
  const err = new TypeError('Failed to fetch');
  reportError('ScoringPage:run', err);

  const e = last();
  assert.equal(e.scope, 'ScoringPage:run');
  assert.equal(e.name, 'TypeError', 'the error name is lost unless the error is the SECOND argument');
  assert.equal(e.message, 'Failed to fetch');
  assert.ok(typeof e.stack === 'string' && e.stack.includes('TypeError'),
    'a report with no stack cannot be acted on — this is the whole point of the fix');
  assert.equal(e.level, 'error');
  assert.equal(e.path, '/spinout-lab/scoring');
});

test('the reversed call keeps none of it — the failure the guard exists to prevent', () => {
  // This pins the BROKEN shape deliberately, as the record of what 27 call
  // sites were shipping. `check-frontend-logging.mjs` makes the shape
  // unreachable from source; if you ever make `toEntry` tolerant of both
  // argument orders, this test should fail — delete it and say so, rather
  // than loosening it.
  clearClientErrors();
  reportError(new TypeError('Failed to fetch'), { where: 'ScoringPage.run' });

  const e = last();
  assert.equal(e.message, '[object Object]', 'the context object is stringified as the message');
  assert.equal(e.stack, undefined, 'the stack is read off the context object, so it is lost');
  assert.equal(e.name, undefined);
  assert.match(e.scope, /TypeError: Failed to fetch/, "the error's own text lands in the scope");
});

test('the scope is redacted, so a reversed call cannot leak PII into the Worker log', async () => {
  clearClientErrors();
  const sent = await withBeacons(async () => {
    // The exact shape of the leak: an error whose message quotes a user's
    // address, passed where the scope belongs.
    reportError(new Error('magic link for ada@example.com expired'), { where: 'x' });
  });

  const e = last();
  assert.ok(!e.scope.includes('ada@example.com'), 'the scope reached the ring buffer un-redacted');
  assert.match(e.scope, /\[email\]/);
  assert.equal(sent.length, 1, 'errors beacon in production, and node has no import.meta.env.DEV');
  assert.equal(sent[0].url, '/api/client-error');
  assert.ok(!JSON.stringify(sent[0].body).includes('ada@example.com'),
    'the Worker sink states it relies on the client having redacted every field it logs');
  assert.equal(sent[0].init.credentials, 'omit', 'the beacon must never carry the session cookie');
});

test('redact is exported and strips what the header claims', () => {
  assert.equal(redact('write to ada@example.com'), 'write to [email]');
  // The path survives and only the query goes: the route is not the secret,
  // the magic-link token in `?token=` is.
  assert.equal(redact('https://axal.vc/magic?token=abc'), 'https://axal.vc/magic[redacted]');
  assert.equal(redact('auth: hunter2'), 'auth: [redacted]');
  // And it leaves an ordinary scope alone — the property the guard relies on.
  assert.equal(redact('SpinoutLab83bPage:markMailed'), 'SpinoutLab83bPage:markMailed');
});

test('reportWarn reaches the ring buffer and deliberately does NOT beacon', async () => {
  clearClientErrors();
  const sent = await withBeacons(async () => {
    reportWarn('pwa:register', 'service worker refused');
  });

  assert.equal(last().level, 'warn');
  assert.equal(last().message, 'service worker refused');
  assert.equal(sent.length, 0,
    'warnings are kept locally to keep Worker log volume on real errors (log.js says so)');
});

test('identical reports dedupe inside the 5s window, different ones do not', async () => {
  clearClientErrors();
  const sent = await withBeacons(async () => {
    reportError('DedupeProbe:load', new Error('same'));
    reportError('DedupeProbe:load', new Error('same'));
    reportError('DedupeProbe:load', new Error('different'));
  });

  assert.equal(sent.length, 2, 'an error loop must not beacon-DoS the user or the Worker logs');
  assert.deepEqual(sent.map((s) => s.body.message), ['same', 'different']);
});

test('the ring buffer keeps the newest 50 and never throws on hostile storage', () => {
  clearClientErrors();
  for (let i = 0; i < 55; i += 1) reportError('RingProbe:load', new Error(`e${i}`));
  const all = getClientErrors();
  assert.equal(all.length, 50);
  assert.equal(all[0].message, 'e5', 'the oldest five are dropped, not the newest');
  assert.equal(all.at(-1).message, 'e54');

  // A poisoned value must not take the logger down with it.
  globalThis.localStorage.setItem('axal:client-errors', '{"not":"an array"}');
  assert.doesNotThrow(() => reportError('RingProbe:poisoned', new Error('after')));
  assert.equal(last().message, 'after');
});

test('the guard that keeps this true is wired, and named where guards are listed', () => {
  const pkg = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
  assert.match(pkg, /node scripts\/check-frontend-logging\.mjs/,
    'the guard is not in test:guards, so nothing runs it on a PR');
  const readme = readFileSync(resolve(process.cwd(), 'scripts/README.md'), 'utf8');
  assert.match(readme, /`check-frontend-logging\.mjs`/,
    'add the check-frontend-logging.mjs row to scripts/README.md');
  // The scope redaction is the security half; a revert would be silent.
  assert.match(LOG_SRC, /scope:\s*clip\(redact\(scope\)/,
    'toEntry stopped redacting the scope — the one beaconed field with no other sanitiser');
});
