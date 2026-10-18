/**
 * D722 — "Continue with Google" opens Google's own window on /login.
 *
 * Two halves. The SOURCE half reads LoginPage.jsx and lib/googlePopup.js as
 * code (`codeOnly`, so the comments that explain a rule cannot satisfy it) and
 * pins the properties a browser enforces and a unit test cannot: nothing is
 * awaited between the click and `requestCode()`, Google's script is never
 * loaded at import or in render, a blocked window falls back to the redirect,
 * and no client ID is ever committed. The BEHAVIOUR half runs the pure
 * functions of lib/googlePopup.js and lib/api/googleSignIn.js against a fake
 * `google.accounts.oauth2`, a fake document and a recorded `fetch`.
 *
 * login_offers_what_it_names.test.mjs and login_safari_startup.test.mjs still
 * hold: the button is unconditional and `googleStartUrl` has one call site.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/login_google_popup_d722.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LOGIN = codeOnly(read('frontend/src/pages/LoginPage.jsx'));
const POPUP = codeOnly(read('frontend/src/lib/googlePopup.js'));
const SIGNIN_API = codeOnly(read('frontend/src/lib/api/googleSignIn.js'));
const WORKER = codeOnly(read('cloudflare-worker/src/routes/auth_google.ts'));

/** A top-level `const name = …` in the component, up to its closing `\n  };`. */
function handler(src, name) {
  const at = src.indexOf(`const ${name} = `);
  assert.ok(at > 0, `${name} is gone`);
  const end = src.indexOf('\n  };', at);
  assert.ok(end > at, `${name} is unterminated`);
  return { at, end, body: src.slice(at, end) };
}

// ─────────────────────────────────────────────────────────── the click ──

test('the popup branch awaits nothing before Google’s window opens', () => {
  const { body } = handler(LOGIN, 'continueWithGoogle');
  const open = body.indexOf('openCodePopup(');
  assert.ok(open > 0, 'continueWithGoogle no longer opens Google’s window');
  const before = body.slice(0, open);
  assert.ok(!/\bawait\b/.test(before),
    'an await before openCodePopup leaves the click: Safari and Chrome then block the window');
  assert.match(before, /gisReady\(\)/, 'the window must be opened only when the library is already loaded');
  // ...and the redirect is still the fallback, after the popup branch.
  assert.ok(body.indexOf('api.googleStartUrl(') > open, 'the redirect must remain, after the window');

  const fn = POPUP.slice(POPUP.indexOf('export function openCodePopup'));
  const fnBody = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(!/async\s+function\s+openCodePopup/.test(POPUP), 'openCodePopup must not be async');
  assert.ok(!/\bawait\b/.test(fnBody), 'openCodePopup awaits something');
  assert.ok(fnBody.indexOf('initCodeClient(') >= 0 && fnBody.indexOf('.requestCode()') > fnBody.indexOf('initCodeClient('),
    'openCodePopup must build the client and call requestCode() in the same turn');
});

test('a blocked window falls back to the same-tab redirect', () => {
  const { body } = handler(LOGIN, 'failGooglePopup');
  const at = body.indexOf("'popup_failed_to_open'");
  assert.ok(at > 0, 'a blocked window is not handled');
  assert.match(body.slice(at, at + 300), /continueWithGoogle\(\{\s*forceRedirect:\s*true/,
    'popup_failed_to_open must continue in this tab, not stop with an error');
  const { body: cwg } = handler(LOGIN, 'continueWithGoogle');
  assert.match(cwg, /forceRedirect/, 'continueWithGoogle no longer takes forceRedirect');
});

test('an answer from an older window is ignored', () => {
  for (const name of ['finishGooglePopup', 'failGooglePopup']) {
    const { body } = handler(LOGIN, name);
    assert.match(body, /state !== googleAttemptRef\.current\) return;/, `${name} acts on a stale attempt`);
  }
});

test('Google’s script is loaded from one URL, never at import or in render, and never from index.html', async () => {
  const mod = await import('../src/lib/googlePopup.js');
  assert.equal(mod.GIS_SRC, 'https://accounts.google.com/gsi/client');
  // googlePopup.js: the only mention of loadGis( is its own definition.
  assert.deepEqual([...POPUP.matchAll(/loadGis\(/g)].length, 1, 'googlePopup.js calls loadGis at module scope');
  // LoginPage: every call sits inside the config answer or the hover/focus primer.
  const ask = handler(LOGIN, 'askGoogleConfig');
  const prime = handler(LOGIN, 'primeGoogle');
  const calls = [...LOGIN.matchAll(/loadGis\(\)/g)].map((m) => m.index);
  assert.ok(calls.length >= 2, `expected the two loaders, found ${calls.length}`);
  for (const i of calls) {
    const inside = (h) => i > h.at && i < h.end;
    assert.ok(inside(ask) || inside(prime), 'loadGis() is called outside the idle answer and the primer — at render or import');
  }
  // The config is asked at idle, from an effect, never during render.
  const effect = LOGIN.slice(LOGIN.indexOf('useEffect(() => {\n    mountedRef.current = true;'));
  assert.match(effect.slice(0, 200), /whenIdle\(\(\) => askGoogleConfig\(\)\)/);
  const html = read('frontend/index.html');
  assert.ok(!/accounts\.google\.com/.test(html), 'index.html loads Google’s script on every page');
});

test('the button is primed on hover, focus and touch', () => {
  const at = LOGIN.indexOf('data-testid="login-google"');
  const open = LOGIN.lastIndexOf('<button', at);
  const tag = LOGIN.slice(open, at);
  for (const ev of ['onPointerEnter', 'onFocus', 'onTouchStart']) {
    assert.match(tag, new RegExp(`${ev}=\\{primeGoogle\\}`), `${ev} does not prime Google`);
  }
});

test('the POST carries X-Requested-With; the config is a plain GET', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const { googleSignInApi } = await import('../src/lib/api/googleSignIn.js');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ configured: false, popup: false, client_id: null }) };
  };
  try {
    await googleSignInApi.config();
    await googleSignInApi.popup({ code: 'c', state: 's' });
  } finally { globalThis.fetch = real; }
  assert.equal(seen[0].url, '/api/auth/google/config');
  assert.ok(!seen[0].init.method || seen[0].init.method === 'GET');
  assert.equal(seen[1].url, '/api/auth/google/popup');
  assert.equal(seen[1].init.method, 'POST');
  assert.equal(seen[1].init.headers['X-Requested-With'], 'XmlHttpRequest');
  assert.equal(seen[1].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen[1].init.body), { code: 'c', state: 's' });
  // The Worker checks the exact value; the two spellings must be one string.
  assert.match(WORKER, /x-requested-with'\) !== 'XmlHttpRequest'/);
  assert.match(SIGNIN_API, /'X-Requested-With': 'XmlHttpRequest'/);
});

// ─────────────────────────────────────────────────────────── the copy ──

function copyKeys() {
  const at = LOGIN.indexOf('const GOOGLE_ERROR_COPY = {');
  const block = LOGIN.slice(at, LOGIN.indexOf('\n};', at));
  return new Set([...block.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]));
}

test('every code the /popup handler answers with has a sentence on the page', () => {
  const at = WORKER.indexOf("authGoogle.post('/popup'");
  const h = WORKER.slice(at, WORKER.indexOf('\n});', at));
  const codes = new Set([...h.matchAll(/popupRefuse\(c,\s*\d+,\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 10, `parsed ${codes.size} codes out of the /popup handler`);
  const keys = copyKeys();
  for (const code of codes) assert.ok(keys.has(code), `GOOGLE_ERROR_COPY has no line for the Worker's '${code}'`);
  // GIS's own failure types, and Google's refusal, are named too.
  for (const type of ['popup_closed', 'popup_failed_to_open', 'access_denied', 'unreachable']) {
    assert.ok(keys.has(type), `GOOGLE_ERROR_COPY has no line for '${type}'`);
  }
  // The shared helper's refusals reach /callback's redirect too.
  for (const code of ['link_blocked_unverified', 'account_inactive']) assert.ok(keys.has(code));
});

test('the unconfirmed-account copy points at the email link, not at a Settings step that no longer exists', () => {
  const at = LOGIN.indexOf('link_blocked_unverified:');
  const line = LOGIN.slice(at, LOGIN.indexOf('\n', at));
  assert.match(line, /Email me a sign-in link/);
  assert.ok(!/Settings/.test(line), 'rule 2 links automatically; the copy must not send them to Settings');
});

test('a non-JSON 403 or no answer at all reads as unreachable; a known code wins', () => {
  // Executed from the source: the function is pure and small, so it is lifted
  // out with the copy map rather than duplicated here.
  const at = LOGIN.indexOf('const GOOGLE_ERROR_COPY = {');
  const end = LOGIN.indexOf('\n}\n', LOGIN.indexOf('function googlePopupErrorCopy'));
  const src = LOGIN.slice(at, end + 2);
  const make = new Function(`${src}; return { googlePopupErrorCopy, GOOGLE_ERROR_COPY };`);
  const { googlePopupErrorCopy: copy, GOOGLE_ERROR_COPY: C } = make();
  assert.equal(copy(Object.assign(new Error('Forbidden'), { status: 403 }), ''), C.unreachable);
  assert.equal(copy(new TypeError('Failed to fetch'), ''), C.unreachable);
  assert.equal(copy(Object.assign(new Error('x'), { status: 403, code: 'bad_state' }), ''), C.bad_state);
  assert.equal(copy(Object.assign(new Error('Rate limit exceeded for google_popup bucket. Try again in 60 seconds.'), { status: 429 }), ''),
    'Rate limit exceeded for google_popup bucket. Try again in 60 seconds.', 'a rate limit keeps the server’s own sentence');
  assert.equal(
    copy(Object.assign(new Error('x'), { status: 409, code: 'different_account', data: { google_email: 'me@gmail.test' } }), 'work@example.test'),
    'You typed work@example.test, but Google signed in me@gmail.test. Choose work@example.test in the Google window, or clear the email field to continue as me@gmail.test.',
  );
  assert.equal(copy(Object.assign(new Error('x'), { status: 409, code: 'different_account' }), ''), C.different_account);
});

test('no Google client ID is committed anywhere in the SPA source', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|tsx?|json|html|css)$/.test(e) && readFileSync(p, 'utf8').includes('apps.googleusercontent.com')) hits.push(p);
    }
  };
  walk(path.join(ROOT, 'frontend/src'));
  assert.deepEqual(hits, [], 'a client ID belongs to the deployment and is read from GET /api/auth/google/config');
  assert.ok(!/VITE_GOOGLE/.test(LOGIN + POPUP), 'no build-time Google variable either');
});

// ─────────────────────────────────────────────────── lib/googlePopup.js ──

test('a state is 43 base64url characters, fresh every time; the cookie carries its attributes', async () => {
  const m = await import('../src/lib/googlePopup.js');
  const a = m.newPopupState();
  const b = m.newPopupState();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  // The Worker's shape, so the two halves agree.
  assert.match(WORKER, /POPUP_STATE_RE = \/\^\[A-Za-z0-9_-\]\{43\}\$\//);
  assert.equal(m.base64url(new Uint8Array([251, 255, 191])), '-_-_');
  const cookie = m.popupStateCookie(a);
  assert.ok(cookie.startsWith(`studioos_google_popup=${a}; `));
  for (const attr of ['Secure', 'SameSite=Strict', 'Path=/api/auth/google', 'Max-Age=600']) {
    assert.ok(cookie.split('; ').includes(attr), `the state cookie lacks ${attr}`);
  }
  assert.ok(!/HttpOnly/.test(cookie), 'the page writes this cookie, so it cannot be HttpOnly');
});

function fakeGoogle() {
  const made = [];
  globalThis.window = globalThis.window || {};
  globalThis.window.google = {
    accounts: {
      oauth2: {
        initCodeClient(cfg) {
          const client = { cfg, requested: 0, requestCode() { client.requested += 1; } };
          made.push(client);
          return client;
        },
      },
    },
  };
  return made;
}

test('openCodePopup asks for exactly the sign-in, in the same turn, and drops a mismatched state', async () => {
  const m = await import('../src/lib/googlePopup.js');
  const made = fakeGoogle();
  assert.equal(m.gisReady(), true);
  const got = [];
  m.openCodePopup({
    clientId: 'cid', state: 'S1', loginHint: 'Person@Example.test',
    onCode: (r) => got.push(['code', r]), onError: (e) => got.push(['error', e]),
  });
  assert.equal(made.length, 1);
  assert.equal(made[0].requested, 1, 'requestCode() was not called before openCodePopup returned');
  const { cfg } = made[0];
  assert.equal(cfg.client_id, 'cid');
  assert.equal(cfg.scope, 'openid email profile');
  assert.equal(cfg.ux_mode, 'popup');
  assert.equal(cfg.state, 'S1');
  assert.equal(cfg.select_account, true);
  assert.equal(cfg.login_hint, 'Person@Example.test');

  cfg.callback({ code: 'stale', state: 'S0' });
  cfg.callback({ code: '4/abc', state: 'S1', scope: 'email profile openid' });
  cfg.callback({ error: 'access_denied', state: 'S1' });
  cfg.error_callback({ type: 'popup_closed' });
  cfg.error_callback({ type: 'popup_failed_to_open' });
  assert.deepEqual(got, [
    ['code', { code: '4/abc', state: 'S1' }],
    ['error', { type: 'access_denied', state: 'S1' }],
    ['error', { type: 'popup_closed', state: 'S1' }],
    ['error', { type: 'popup_failed_to_open', state: 'S1' }],
  ]);

  m.openCodePopup({ clientId: 'cid', state: 'S2', loginHint: 'not an email', onCode() {}, onError() {} });
  assert.equal('login_hint' in made[1].cfg, false, 'a typed value that is not an address must not be sent as the hint');
});

test('loadGis loads once, retries after a failure, and resolves at once when the library is there', async () => {
  const m = await import('../src/lib/googlePopup.js');
  delete globalThis.window.google;
  const appended = [];
  globalThis.document = {
    cookie: '',
    createElement: () => ({ remove() {} }),
    head: { appendChild: (s) => appended.push(s) },
  };
  const first = m.loadGis();
  const again = m.loadGis();
  assert.equal(appended.length, 1, 'a second call injected a second script');
  assert.equal(appended[0].src, 'https://accounts.google.com/gsi/client');
  appended[0].onerror();
  await assert.rejects(first);
  await assert.rejects(again);
  const retry = m.loadGis();
  assert.equal(appended.length, 2, 'a failed load is never retried');
  fakeGoogle();
  appended[1].onload();
  await retry;
  await m.loadGis();
  assert.equal(appended.length, 2, 'a loaded library was loaded again');
});

test('whenIdle falls back to a timeout where requestIdleCallback is missing (Safari)', async () => {
  const m = await import('../src/lib/googlePopup.js');
  globalThis.window = globalThis.window || {};
  delete globalThis.window.requestIdleCallback;
  let ran = 0;
  m.whenIdle(() => { ran += 1; });
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(ran, 1);
  const cancel = m.whenIdle(() => { ran += 1; });
  cancel();
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(ran, 1, 'a cancelled idle call still ran');
  assert.equal(m.looksLikeEmail('a@b.co'), true);
  assert.equal(m.looksLikeEmail('a@b'), false);
  assert.equal(m.looksLikeEmail(''), false);
});
