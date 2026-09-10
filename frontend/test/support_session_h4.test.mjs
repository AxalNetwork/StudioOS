/**
 * The support-session flow — canvas H4's dialog, banner and hand-back.
 *
 * The worker half is held by `cloudflare-worker/test/admin_impersonation_session.test.ts`:
 * a 30-minute token instead of the ordinary 24-hour one, a reason of at
 * least ten characters required at the route, and an extend that re-checks
 * everything the grant checked. This file holds the client half, which has
 * one job the server cannot do for it and one it must not get wrong.
 *
 * THE JOB IT MUST NOT GET WRONG. The support token now dies on its own. If
 * the client simply carried on, the next request would 401 — and
 * `api.request` reads a 401 as a dead session and redirects to /login,
 * which would end the ADMIN's real session, not merely the support session.
 * Shortening the token without the hand-back would have turned a security
 * improvement into "support logs you out every half hour". So the countdown
 * and the hand-back are load-bearing, not decoration, and are pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = codeOnly(raw('frontend/src/App.jsx'));
const ADMIN_PAGE = raw('frontend/src/pages/AdminPage.jsx');
const LAB = codeOnly(raw('frontend/src/pages/admin/AdminSpinoutLab.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

/** H4 alone, bounded at both ends — the file holds seven artboards. */
function h4() {
  const a = CANVAS.indexOf('Accounts — cross-tenant, and the impersonation banner');
  assert.ok(a >= 0, 'the H4 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('Revenue — the money rails', a);
  assert.ok(b > a, 'H5 no longer follows H4 — this slice would run past the artboard');
  return CANVAS.slice(a, b);
}

test('the dialog asks for the three things the artboard asks for', () => {
  // Read off the canvas rather than retyped, so the page cannot drift from
  // the design without this failing.
  const board = h4();
  for (const label of ['Scope', 'Expiry', 'Reason']) {
    assert.ok(board.includes(label), `the artboard no longer draws ${label}`);
    assert.ok(ADMIN_PAGE.includes(label), `the dialog dropped ${label}`);
  }
  assert.ok(board.includes('Recorded in Governance'), 'the artboard changed');
  assert.match(ADMIN_PAGE, /Recorded in Governance/, 'the dialog no longer says where this is recorded');
  assert.match(ADMIN_PAGE, /Start a support session/, 'the dialog lost its title');
  assert.match(ADMIN_PAGE, /Begin session/, 'the confirm control is gone');
});

test('scope and expiry are stated, not offered as choices', () => {
  // Neither is a decision: the minted token IS the user, so the scope is
  // read-and-write by construction, and the expiry is enforced in the token.
  // A picker would invent options the product does not have.
  const src = codeOnly(ADMIN_PAGE);
  const a = src.indexOf('function SupportSessionDialog(');
  assert.ok(a >= 0, 'the dialog is gone');
  const body = src.slice(a, src.indexOf('const STATUS_BADGES', a));
  assert.ok(body.length > 200, "the dialog's end marker moved");
  assert.match(body, /Read and write as user/, 'the scope is no longer stated');
  assert.match(body, /30 minutes · hard/, 'the expiry is no longer stated');
  assert.doesNotMatch(body, /<select/, 'scope or expiry became a picker over options that do not exist');
});

test('the reason is required in the dialog, at the floor the route enforces', () => {
  const src = codeOnly(ADMIN_PAGE);
  assert.match(src, /reason\.trim\(\)\.length < 10/,
    'the dialog no longer holds the ten-character floor the worker enforces');
  assert.match(src, /disabled=\{busy \|\| tooShort\}/, 'Begin session is clickable with no reason');
});

test('every caller supplies a reason — the route refuses a session without one', () => {
  // A caller left behind does not degrade, it 400s. Both call sites must
  // pass one, and neither may fabricate a constant: a hardcoded reason on
  // every row satisfies the field and tells a later reader nothing.
  const calls = [...`${APP}\n${codeOnly(ADMIN_PAGE)}\n${LAB}`.matchAll(/api\.adminImpersonate\(([^)]*)\)/g)]
    .map((m) => m[1]);
  assert.ok(calls.length >= 2, `expected both impersonation callers; found ${calls.length}`);
  for (const args of calls) {
    assert.ok(args.includes(','), `a caller still opens a session with no reason: adminImpersonate(${args})`);
    assert.doesNotMatch(args, /,\s*['"`]/, `a caller passes a hardcoded reason: adminImpersonate(${args})`);
  }
  assert.match(LAB, /reason\.trim\(\)\.length < 10/, 'the Spin-Out Lab caller does not check the floor');
});

test('the reason reaches the worker as the column it fills', () => {
  assert.match(API, /\/admin\/impersonate\/\$\{userId\}\?context=\$\{encodeURIComponent/,
    'the reason is not sent as `context`, the column impersonation_sessions has');
  // The DEFINITION, not the name. `/adminImpersonateExtend/` also matches
  // `adminImpersonateExtendXX`, so renaming the method away escaped it.
  assert.match(API, /adminImpersonateExtend:\s*async \(sessionId\) =>/,
    'the extend method is gone or renamed');
  assert.match(API, /\/admin\/impersonate-sessions\/\$\{sessionId\}\/extend/,
    'extend no longer calls the route that mints the fresh token');
});

test('the banner says what the session is, and how long is left', () => {
  const board = h4();
  assert.ok(board.includes('support session'), 'the artboard no longer calls it a support session');
  assert.match(APP, /Viewing as \{impersonatedUser\?\.name\} — support session/,
    'the banner no longer names the session the way the artboard does');
  // Sliced to the impersonating branch. `onExtendImpersonation` appears all
  // through the prop chain, so matching the whole file said nothing about
  // whether the BUTTON is rendered — deleting it escaped.
  const a = APP.indexOf('{isImpersonating ? (');
  assert.ok(a >= 0, 'the impersonation branch of the bar is gone');
  const b = APP.indexOf(') : (', a);
  assert.ok(b > a, "the branch's end marker moved — this slice would run past it");
  const banner = APP.slice(a, b);
  assert.match(banner, /supportLeftMs !== null &&/, 'the countdown is gone');
  assert.match(banner, /onClick=\{onExtendImpersonation\}/,
    'the banner renders no control that extends the session');
  assert.match(banner, />\s*Extend\s*<\/button>/, 'the extend control has no label');
  // The CONDITION as well as the markup. This is source text, not a render:
  // gating the button on `false` leaves every line of it in the file, so
  // deleting the control by disabling it escaped both assertions above.
  assert.match(banner, /\{onExtendImpersonation && \(/,
    'the extend control is gated on something other than the callback existing');
  assert.match(banner, /\{supportLeftMs !== null && \(/,
    'the countdown is gated on something other than there being a time left');
});

test('the session is handed back before it can 401 the admin out', () => {
  // THE POINT. Without this, a 30-minute token ends the admin's own session
  // every half hour, because api.request treats a 401 as a dead session.
  assert.match(APP, /if \(impersonationLeftMs > 0\) return;/,
    'nothing acts when the countdown reaches zero');
  assert.match(APP, /exitImpersonationRef\.current\(\);/,
    'the countdown does not hand the session back');
  // Via a ref on purpose: exitImpersonation is rebuilt every render, so
  // depending on it would tear down and re-arm this effect once a second.
  assert.match(APP, /\}, \[isImpersonating, impersonationLeftMs\]\);/,
    'the hand-back effect depends on something that changes every render');
  // And the stored expiry is cleared, or the next session inherits it.
  assert.match(APP, /localStorage\.removeItem\('impersonationExpiresAt'\)/,
    'the expiry outlives the session it belonged to');
});
