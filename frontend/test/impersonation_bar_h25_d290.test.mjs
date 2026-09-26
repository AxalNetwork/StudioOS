/**
 * D290 / canvas H25 — the impersonation bar is global chrome, and it says who,
 * as whom, why and for how long.
 *
 * Until D290 the strip lived inside `PortalSwitcher`, so it drew only where
 * that bar did, and it said only who was being viewed and how long was left:
 * the reason was sent to the worker and never kept. Now `ImpersonationBar`
 * mounts above `PortalSwitcher` in the shell, the worker echoes the reason it
 * stored (or null), `beginSupportSession` passes it on, and the shell keeps
 * it beside the expiry and purges it on sign-out, on End session and on the
 * thirty-minute hand-back. A null reason reads "Not recorded".
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/impersonation_bar_h25_d290.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  REASON_KEY, NOT_RECORDED, SUPPORT_SESSION_MINUTES, EXTEND_LABEL, END_LABEL,
  storeReason, readStoredReason, clearStoredReason, whyValue, impersonationFields,
} from '../src/lib/impersonationBar.js';
import { NOT_RECORDED as ABSENCE_NOT_RECORDED } from '../src/lib/absence.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = codeOnly(raw('frontend/src/App.jsx'));
const BAR = codeOnly(raw('frontend/src/components/ImpersonationBar.jsx'));
const LIB = codeOnly(raw('frontend/src/lib/impersonationBar.js'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const ADMIN_PAGE = codeOnly(raw('frontend/src/pages/AdminPage.jsx'));
const ADMIN_TS = codeOnly(raw('cloudflare-worker/src/routes/admin.ts'));
const AUTH_TS = raw('cloudflare-worker/src/auth.ts');
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

/** A slice between two unique anchors, asserted to exist and to be ordered. */
function between(src, from, to, what) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `${what}: start anchor not found (${from})`);
  const b = src.indexOf(to, a);
  assert.ok(b > a, `${what}: end anchor not found after the start (${to})`);
  return src.slice(a, b);
}

test('the bar is global chrome: mounted in the shell above PortalSwitcher, outside the router, ungated by route', () => {
  const layout = between(APP, 'function ProtectedLayout(', 'function RequireAuth(', 'the layout');
  const mount = layout.indexOf('<SafeMount name="ImpersonationBar">');
  assert.ok(mount >= 0, 'the bar is not mounted in ProtectedLayout');
  // ABOVE `PortalSwitcher` — anchored on the mounts, not the names, for the
  // reason hq_governance_h7 gives: an import line is before every mount.
  const portal = layout.indexOf('<PortalSwitcher');
  assert.ok(portal > 0, 'PortalSwitcher is not mounted');
  assert.ok(mount < portal, 'the impersonation bar mounts below PortalSwitcher, so the admin bar can frame a support session alone');
  // Outside the router: every guarded route renders ProtectedLayout, and the
  // first <Routes in the file comes after the layout's definition.
  assert.ok(APP.indexOf('<Routes') > APP.indexOf('<SafeMount name="ImpersonationBar">'),
    'the bar is mounted inside the route table rather than the shell');
  // Ungated by route: the component reads no location and returns null on
  // exactly one condition — nobody is being impersonated.
  assert.doesNotMatch(BAR, /useLocation|pathname/, 'the bar reads the route, so it can go missing on one');
  assert.match(BAR, /if \(!operator \|\| !target\) return null;/, 'the bar is gated on something other than a session existing');
  const nulls = BAR.match(/return null/g) || [];
  assert.equal(nulls.length, 1, `the bar has ${nulls.length} ways to draw nothing; one is the session not existing`);
  // The strip no longer lives in the switcher: no clock, no Extend, no Exit
  // there — one session, drawn once.
  const switcher = between(APP, 'function PortalSwitcher(', 'const FULL_BLEED_BY_ROLE', 'the switcher');
  for (const gone of ['supportLeftMs', 'onExtendImpersonation', 'Exit Impersonation', 'Logged in as', 'impersonatedUser']) {
    assert.ok(!switcher.includes(gone), `PortalSwitcher still carries the session strip: ${gone}`);
  }
  assert.match(switcher, /Support session in progress — the bar above says who, as whom, why and for how long\./,
    'the switcher no longer says why the picker is not offered');
});

test('Who · As · Why · Limit, in H25\'s order, from the shell\'s own facts', () => {
  // The order and the keys are read off the artboard, not retyped.
  const board = between(CANVAS, 'impBar: [', ']', 'the H25 bar');
  const keys = [...board.matchAll(/k:'([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['Who', 'As', 'Why', 'Limit'], 'the artboard changed its four fields');

  const fields = impersonationFields({
    operator: { name: 'T. Okafor', role: 'admin' },
    target: { name: 'T. Roussel', role: 'admin' },
    reason: 'Approvals filter loses state (#4471)',
    holder: true,
  });
  assert.deepEqual(fields.map((f) => f.k), keys);
  assert.deepEqual(fields, [
    { k: 'Who', v: 'T. Okafor · Axal VC HQ' },
    { k: 'As', v: 'T. Roussel · Admin' },
    { k: 'Why', v: '“Approvals filter loses state (#4471)”' },
    { k: 'Limit', v: `${SUPPORT_SESSION_MINUTES} min · hard` },
  ]);
  // A plain admin is not HQ, and a founder target is named as one.
  const plain = impersonationFields({
    operator: { name: 'P. Peer', role: 'admin' }, target: { name: 'F. Founder', role: 'founder' }, reason: 'x'.repeat(12),
  });
  assert.equal(plain[0].v, 'P. Peer · Admin');
  assert.equal(plain[1].v, 'F. Founder · Founder');
  // The limit is the token's, not the bar's: the worker mints the support
  // token for IMPERSONATION_EXPIRY_MINUTES, and the bar may not promise more.
  const m = AUTH_TS.match(/export const IMPERSONATION_EXPIRY_MINUTES = (\d+);/);
  assert.ok(m, 'the worker no longer exports IMPERSONATION_EXPIRY_MINUTES as a literal');
  assert.equal(SUPPORT_SESSION_MINUTES, Number(m[1]), 'the bar promises a limit the token does not have');
  // Drawn from the list, not from four literals.
  assert.match(BAR, /\{fields\.map\(\(f\) => \(/, 'the bar does not draw the fields from the list');
  assert.match(BAR, /impersonationFields\(\{ operator, target, reason, holder \}\)/);
});

test('a null reason reads "Not recorded" — never an invented one', () => {
  assert.equal(NOT_RECORDED, ABSENCE_NOT_RECORDED, 'the bar spells absence differently from lib/absence.js');
  for (const empty of [null, undefined, '', '   ', 0, {}]) {
    assert.equal(whyValue(empty), NOT_RECORDED, `${JSON.stringify(empty)} did not read as not recorded`);
  }
  assert.equal(whyValue('  ticket 4471  '), '“ticket 4471”');
  const fields = impersonationFields({ operator: { name: 'A' }, target: { name: 'B', role: 'founder' }, reason: null });
  assert.equal(fields[2].v, NOT_RECORDED);
  // Nowhere between the worker and the bar is a stand-in reason supplied.
  assert.doesNotMatch(BAR, /reason\s*(\|\||\?\?)/, 'the bar fills a missing reason');
  assert.doesNotMatch(LIB, /reason\s*(\|\||\?\?)\s*['"`]/, 'the lib fills a missing reason with a literal');
  assert.match(API, /storeReason\(typeof res\?\.reason === 'string' \? res\.reason : null\);/,
    'api.adminImpersonate stores something other than the echoed reason');
  assert.match(APP, /const \[impersonationReason, setImpersonationReason\] = useState\(\(\) => readStoredReason\(\)\);/,
    'the shell initialises the reason from something other than the stored echo');
  assert.match(APP, /setImpersonationReason\(typeof reason === 'string' && reason\.trim\(\) \? reason : readStoredReason\(\)\);/,
    'handleImpersonate sets the reason from something other than the echo or its stored copy');
  // The store: a non-string clears, a string is kept as given, a read of
  // nothing is null.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.equal(readStoredReason(), null);
    storeReason('ticket 4471, the filter loses state');
    assert.equal(readStoredReason(), 'ticket 4471, the filter loses state');
    assert.equal(store.get(REASON_KEY), 'ticket 4471, the filter loses state');
    storeReason(null);
    assert.equal(store.has(REASON_KEY), false, 'a null echo left the previous session’s reason behind');
    assert.equal(readStoredReason(), null);
    storeReason('kept');
    clearStoredReason();
    assert.equal(store.has(REASON_KEY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('the worker echoes the reason it stored, or null, and the dialog passes it on', () => {
  const handler = between(ADMIN_TS, "admin.post('/impersonate/:userId'", "admin.post('/impersonate-sessions/:id/extend'", 'the impersonate handler');
  assert.match(handler, /reason: impersonationSessionId === null \? null : reason,/,
    'the response does not echo the stored reason as null when the audit write failed');
  // The dialog passes the echo, not the text it collected.
  assert.match(ADMIN_PAGE, /onImpersonate\(res\.token, res\.user, null, res\.reason \?\? null\);/,
    'beginSupportSession does not pass the echoed reason on');
  assert.match(APP, /const handleImpersonate = \(token, impersonatedUser, targetPath, reason\) => \{/,
    'handleImpersonate no longer takes the reason');
  // And reaches the bar through the shell, as a prop named for what it is.
  assert.match(APP, /supportReason: impersonationReason,/, 'the shell does not hand the reason to the layout');
  assert.match(APP, /supportReason=\{supportReason\}/, 'RequireAuth does not pass the reason through');
  assert.match(between(APP, '<SafeMount name="ImpersonationBar">', '<PortalSwitcher', 'the mount'), /reason=\{supportReason\}/,
    'the bar is not given the reason');
});

test('the reason is purged on sign-out, on End session and on the hand-back — and the key has one owner', () => {
  const signOut = between(APP, 'const clearSession = useCallback(', 'const logout = useCallback(', 'clearSession');
  assert.match(signOut, /clearStoredReason\(\);/, 'sign-out leaves the stored reason behind');
  assert.match(signOut, /setImpersonationReason\(null\);/, 'sign-out leaves the reason in state');

  // Code anchors: `codeOnly` has stripped the comments.
  const end = between(APP, 'const exitImpersonation = () => {', 'const exitImpersonationRef = useRef(exitImpersonation);', 'exitImpersonation');
  assert.match(end, /clearStoredReason\(\);/, 'End session leaves the stored reason behind');
  assert.match(end, /setImpersonationReason\(null\);/, 'End session leaves the reason in state');

  // The hand-back comes through exitImpersonation, via the ref the H4 guard
  // explains — so the purge above is the hand-back's purge only while the
  // effect still calls it.
  const handBack = between(APP, 'const exitImpersonationRef = useRef(exitImpersonation);', 'const clearSession = useCallback(', 'the hand-back');
  assert.match(handBack, /exitImpersonationRef\.current = exitImpersonation;/);
  assert.match(handBack, /if \(impersonationLeftMs > 0\) return;\s*exitImpersonationRef\.current\(\);/,
    'the hand-back no longer ends the session, so nothing purges the reason at zero');

  // One owner for the key: named in the lib, and nowhere else.
  const owners = (LIB.match(/'impersonationReason'/g) || []).length;
  assert.equal(owners, 1, `the key is spelled ${owners} times in the lib; once`);
  for (const [name, src] of [['App.jsx', APP], ['api.js', API], ['ImpersonationBar.jsx', BAR], ['AdminPage.jsx', ADMIN_PAGE]]) {
    // The quoted string, not the bare word: `impersonationReason` is also the
    // shell's state name.
    assert.ok(!src.includes(`'${REASON_KEY}'`) && !src.includes(`"${REASON_KEY}"`), `${name} spells the key out — one owner, one name`);
  }
  assert.match(APP, /import \{ readStoredReason, clearStoredReason \} from '\.\/lib\/impersonationBar';/);
});

test('Extend and End session still work, in H25\'s words; the header chip stays; the clock is the shell\'s', () => {
  assert.equal(EXTEND_LABEL, 'Extend');
  assert.equal(END_LABEL, 'End session');
  assert.ok(CANVAS.includes('End session'), 'the artboard no longer names the control End session');
  const render = BAR.slice(BAR.indexOf('return ('));
  assert.match(render, /\{onExtend && \(\s*<button[^>]*type="button"\s*onClick=\{onExtend\}/, 'Extend is gone or not gated on its callback');
  assert.match(render, /\{EXTEND_LABEL\}/);
  assert.match(render, /<button[^>]*type="button"\s*onClick=\{onExit\}/, 'End session is gone');
  assert.match(render, /\{END_LABEL\}/);
  assert.match(render, /\{leftMs !== null && \(/, 'the countdown is gone');
  assert.match(BAR, /import \{ timeLeftLabel \} from '\.\.\/lib\/supportSession';/,
    'the operator\'s clock is formatted differently from the branch\'s');
  assert.match(BAR, /const left = timeLeftLabel\(leftMs\);/);
  // The shell hands over its own clock and callbacks, and the identities only
  // while impersonating.
  const mount = between(APP, '<SafeMount name="ImpersonationBar">', '<PortalSwitcher', 'the mount');
  assert.match(mount, /operator=\{isImpersonating \? realUser : null\}/);
  assert.match(mount, /target=\{isImpersonating \? user : null\}/);
  assert.match(mount, /holder=\{superAdmin\}/);
  assert.match(mount, /leftMs=\{supportLeftMs\}/);
  assert.match(mount, /onExtend=\{onExtendImpersonation\}/);
  assert.match(mount, /onExit=\{onExitImpersonation\}/);
  assert.match(APP, /supportLeftMs: impersonationLeftMs, onExtendImpersonation: extendImpersonation,/,
    'the shell no longer hands out its clock and Extend');
  assert.match(APP, /onExitImpersonation: exitImpersonation/);
  // The header chip is unchanged.
  assert.match(APP, /Impersonating \{user\.name\}/, 'the header chip is gone');
});
