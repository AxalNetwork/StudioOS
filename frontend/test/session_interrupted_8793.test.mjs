/**
 * D8793 (#8793) — an interrupted session says so, keeps the page it was on,
 * and is told apart from a chosen sign-out.
 *
 * The browser retest (documentation/architecture/decisions/D8793.md)
 * reproduced the audit's reading on a local build with fictional accounts:
 *   - an HQ page and an Investor page whose reads met a 401 landed on a bare
 *     `/login`, with no reason given and no way back. Only Grow, Companies,
 *     Funds and Learning kept their page (D7178).
 *   - a second open tab, whose own server session still answered, landed on
 *     the same bare `/login`: it mirrors the cleared stored user.
 *   - the 20-minute inactivity sign-out runs per tab and lands where a chosen
 *     sign-out does.
 * The security timeouts are unchanged; the screen waits on the canvas.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/session_interrupted_8793.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
const {
  SESSION_ENDED_BACK, SESSION_ENDED_IDLE, SESSION_ENDED_MARKER_TTL_MS, SESSION_ENDED_PLAIN, SESSION_IDLE_BACK, SESSION_IDLE_PLAIN,
  clearSessionEnded, loginRedirectFor, markSessionEnded, sessionEndedNotice, sessionEndedRecently, sessionEndedRedirectFor,
  signedOutRedirectFor,
} = await import('../src/lib/pendingNext.js');

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const T0 = Date.parse('2026-11-27T12:00:00Z');
const kept = (path, flag = '1') => `/login?next=${encodeURIComponent(path)}&ended=${flag}`;

test('a 401 on any protected page keeps that page; the audit’s HQ and Investor pages included', () => {
  assert.equal(sessionEndedRedirectFor({ pathname: '/hq' }), kept('/hq'));
  assert.equal(sessionEndedRedirectFor({ pathname: '/network', search: '?tab=people' }), kept('/network?tab=people'));
  assert.equal(sessionEndedRedirectFor({ pathname: '/due-diligence/templates' }), kept('/due-diligence/templates'));
  // D7178's named areas are unchanged.
  assert.equal(sessionEndedRedirectFor({ pathname: '/grow/reporting' }), kept('/grow/reporting'));
});

test('what cannot be kept still says why, and nothing unsafe is carried', () => {
  assert.equal(sessionEndedRedirectFor({ pathname: `/hq/${'x'.repeat(220)}` }), '/login?ended=1', 'too long');
  assert.equal(sessionEndedRedirectFor({ pathname: '//evil.example/x' }), '/login?ended=1', 'not a same-origin path');
  assert.equal(sessionEndedRedirectFor({ pathname: '/login', search: '?next=/hq' }), '/login?ended=1', 'never back to a sign-in page');
});

test('the inactivity sign-out is its own reason', () => {
  assert.equal(sessionEndedRedirectFor({ pathname: '/hq' }, SESSION_ENDED_IDLE), kept('/hq', 'idle'));
  assert.equal(sessionEndedRedirectFor({ pathname: '/grow' }, SESSION_ENDED_IDLE), kept('/grow', 'idle'));
});

test('the sign-in page’s sentence: none for an ordinary visit or a chosen sign-out, and never the page itself', () => {
  assert.equal(sessionEndedNotice(null, ''), null, 'a direct visit');
  assert.equal(sessionEndedNotice('/hq', '?next=%2Fhq'), null, 'a kept page without `ended` is a signed-out deep link, not an interruption');
  assert.equal(sessionEndedNotice('/hq', '?next=%2Fhq&ended=1'), SESSION_ENDED_BACK);
  assert.equal(sessionEndedNotice(null, '?ended=1'), SESSION_ENDED_PLAIN);
  assert.equal(sessionEndedNotice('/hq', '?next=%2Fhq&ended=idle'), SESSION_IDLE_BACK);
  assert.equal(sessionEndedNotice(null, '?ended=idle'), SESSION_IDLE_PLAIN);
  assert.equal(sessionEndedNotice('/grow/reporting', '?ended=1'), 'Your session ended. Sign in again to go back to Grow.', 'D7178’s named line');
  assert.equal(sessionEndedNotice('/hq', '?ended=yes'), null, 'an unknown flag claims nothing');
  for (const s of [SESSION_ENDED_BACK, SESSION_ENDED_PLAIN, SESSION_IDLE_BACK, SESSION_IDLE_PLAIN]) {
    assert.doesNotMatch(s, /\/|hq|network|project|account/i, 'a signed-out page names no page, project or account');
  }
});

test('another open tab: sent to the explained, kept sign-in for two minutes after the session ended elsewhere', () => {
  clearSessionEnded();
  const at = { pathname: '/admin/due-diligence' };
  assert.equal(signedOutRedirectFor(at, T0), loginRedirectFor(at), 'no marker: exactly the guard’s old answer');
  assert.equal(signedOutRedirectFor(at, T0), '/login');
  markSessionEnded(undefined, T0);
  assert.equal(signedOutRedirectFor(at, T0 + 1000), kept('/admin/due-diligence'));
  markSessionEnded(SESSION_ENDED_IDLE, T0);
  assert.equal(signedOutRedirectFor(at, T0 + SESSION_ENDED_MARKER_TTL_MS), kept('/admin/due-diligence', 'idle'));
  assert.equal(sessionEndedRecently(T0 + SESSION_ENDED_MARKER_TTL_MS + 1), null, 'stale after two minutes');
  assert.equal(localStorage.getItem('gvpn:session-ended'), null, 'and removed');
  markSessionEnded(undefined, T0 + 5000);
  assert.equal(sessionEndedRecently(T0), null, 'a marker from the future is not trusted');
  localStorage.setItem('gvpn:session-ended', '{"reason":"other","ts":1}');
  assert.equal(sessionEndedRecently(T0), null, 'an unknown reason is not trusted');
  markSessionEnded(undefined, T0);
  clearSessionEnded();
  assert.equal(signedOutRedirectFor(at, T0 + 1000), '/login', 'a chosen sign-out clears it');
});

test('the wiring: the 401 leaves the marker first, the timer says inactivity, a chosen sign-out clears it', () => {
  const api = read('frontend/src/lib/api.js');
  const i401 = api.indexOf('markSessionEnded();');
  assert.ok(i401 > 0 && i401 < api.indexOf("localStorage.removeItem('user');", i401), 'marked before the stored user goes');
  assert.match(api, /window\.location\.href = sessionEndedRedirectFor\(window\.location\);/);

  const hook = read('frontend/src/hooks/useInactivityTimeout.js');
  assert.match(hook, /onTimeoutRef\.current\?\.\(\{ reason: 'inactivity' \}\)/, 'the timer’s sign-out names itself');
  assert.match(hook, /const logoutNow = useCallback\(\(\) => \{\s*clearTimers\(\);\s*setWarningOpen\(false\);\s*try \{ onTimeoutRef\.current\?\.\(\); \}/, '“Log out now” stays a chosen sign-out');
  assert.match(hook, /timeoutMs = 20 \* 60 \* 1000/, 'the timeout itself is unchanged');

  const app = read('frontend/src/App.jsx');
  assert.match(app, /timeoutMs: 20 \* 60 \* 1000,\s*warningMs: 60 \* 1000,/, 'App keeps 20 minutes and a 60-second warning');
  const logout = app.slice(app.indexOf('const logout = useCallback(async (opts) => {'), app.indexOf('}, [clearSession]);', app.indexOf('const logout = useCallback(async (opts) => {')));
  assert.match(logout, /const idle = opts\?\.reason === 'inactivity';/);
  assert.match(logout, /if \(idle\) markSessionEnded\(SESSION_ENDED_IDLE\); else clearSessionEnded\(\);/);
  assert.match(logout, /await clearSession\(\);[\s\S]*window\.location\.replace\(to\);/);
  // D8680 wraps it so an email link that left no session also says why.
  assert.match(app, /<Navigate to=\{withLinkFailure\(signedOutRedirectFor\(location\), linkBootstrapFailure\)\} state=\{\{ from: location \}\} replace \/>/);

  const login = read('frontend/src/pages/LoginPage.jsx');
  assert.match(login, /return sessionEndedNotice\(safeNextPath\(\), window\.location\.search\);/);
  assert.match(login, /\{ended && \(\s*<p role="status"[^>]*data-testid="login-session-ended">\s*\{ended\}/);
});
