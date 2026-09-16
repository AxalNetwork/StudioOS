/**
 * D134 — the first UI `licence_admins` has ever had, and the order it enforces.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A RENDER. `AdminsEditor` is not exported
 * and is not prop-driven: it loads in an effect, which `renderToStaticMarkup`
 * never runs, so a top-level render would emit "Loading…" and assert nothing.
 * Exporting it purely to render it would be the `MarkHistory` precedent applied
 * where it does not fit — that component was already pure. What is asserted
 * here is the wiring, which is what actually went wrong in this area: three
 * `api.js` methods that existed for five months with ZERO callers.
 *
 * THE ONE CLAIM WORTH THE MOST. A UI that offered Detach beside Demote and let
 * the server sort it out would teach the operator that one of its two buttons
 * is a lie — the server answers 409 `still_an_admin` every time. So Detach is
 * disabled while the account holds the role, and the sentence saying why is on
 * the row rather than in a toast nobody keeps.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_admins_ui_d134.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/admin/AdminLicences.jsx');
const CODE = codeOnly(PAGE);
const API_RAW = read('frontend/src/lib/api.js');
const API = codeOnly(API_RAW);

test('the three licence_admins methods finally have a caller', () => {
  // The finding this PR was written against: `licenceAdmins`, `licenceAdminAdd`
  // and `licenceAdminRemove` shipped with migration 190's routes and nothing
  // ever called them, so naming a subsidiary's administrator meant SQL.
  for (const m of ['api.licenceAdmins(', 'api.licenceAdminAdd(', 'api.licenceAdminRemove(']) {
    assert.ok(CODE.includes(m), `${m} still has no caller — the binding has no UI`);
  }
  assert.ok(CODE.includes('api.adminDemoteAdmin('),
    'the demote has no caller, so closing an account is still a two-step flow with one step');
});

test('the Administrators tab is mounted, unnumbered, beside History', () => {
  assert.match(CODE, /const ADMINS_STEP = STEPS\.length \+ 2;/,
    'the tab has no step key of its own');
  assert.ok(CODE.includes('{step === ADMINS_STEP && <AdminsEditor'),
    'the tab exists and renders nothing');
  // Unnumbered means it is NOT in STEPS: adding it there would renumber the
  // canvas's six-step issue flow, which is a different claim about the product.
  const steps = CODE.match(/const STEPS = \[[^\]]*\]/)?.[0] || '';
  assert.ok(steps.length > 0, 'the issue-flow step list moved — re-point this guard');
  assert.ok(!/Administrator/i.test(steps),
    'Administrators was added to the numbered issue flow, which renumbers the canvas');
});

test('Detach is disabled while the account still holds the admin role', () => {
  // Bounded to the Detach button's own JSX so a NEIGHBOURING control's disabled
  // expression cannot satisfy it — the correction #576 and D132 both made.
  const at = CODE.indexOf('api.licenceAdminRemove(licence.uid');
  assert.ok(at > 0, 'the Detach action is gone');
  const before = CODE.slice(Math.max(0, at - 200), at);
  assert.match(before, /disabled=\{busy \|\| isAdmin\}/,
    'Detach is offered while the account is still an admin, and the server refuses every click');

  const demoteAt = CODE.indexOf('api.adminDemoteAdmin(a.user_id');
  assert.ok(demoteAt > 0, 'the Demote action is gone');
  const demoteBefore = CODE.slice(Math.max(0, demoteAt - 400), demoteAt);
  assert.match(demoteBefore, /disabled=\{busy \|\| !isAdmin\}/,
    'Demote is offered for an account that is not an admin');
});

test('the transient state between demote and detach is rendered, not inferred', () => {
  assert.ok(PAGE.includes('no longer an admin — detach'),
    'an account that has been demoted but not detached renders as an administrator');
  assert.ok(PAGE.includes('admin · deactivated'),
    'a deactivated administrator renders identically to a live one');
  // The row's own sentence, so the two-step order is on screen rather than
  // discoverable only by clicking a disabled button.
  assert.match(PAGE, /Detach is available once this account is no longer an admin/);
});

test('appointing requires a reason before the button is live', () => {
  assert.match(CODE, /form\.reason\.trim\(\)\.length >= 10/,
    'the ten-character reason is server-side only, so the form posts a request it knows will fail');
  const at = CODE.indexOf('api.licenceAdminAdd(licence.uid');
  assert.ok(at > 0);
  assert.match(CODE.slice(at, at + 200), /reason: form\.reason\.trim\(\)/,
    'the reason is collected and not sent');
});

test('a failed read renders the reason, never an empty list', () => {
  // `items === null` is the failure state and is distinct from `[]`. Without
  // the distinction the page would say "nobody administers this licence" about
  // a request that never arrived — a claim about the business made by a network
  // error, which is the exact shape this repo keeps deleting.
  assert.match(CODE, /setItems\(null\)/,
    'a failed read falls back to an empty array, so a network error reads as "nobody"');
  assert.ok(PAGE.includes('This is not the same as having none — nothing was read.'),
    'the unreadable state does not say what it is');
  assert.match(CODE, /items === null &&/,
    'nothing renders the unreadable state');
  assert.match(CODE, /Array\.isArray\(items\) && items\.length === 0/,
    'the empty state is not guarded on the read having succeeded');
});

test('api.js says the three methods are behind a write bar, so 403 is not always a refusal', () => {
  const at = API.indexOf('licenceAdmins:');
  assert.ok(at > 0, 'licenceAdmins moved — re-point this guard rather than deleting it');
  // Bounded to this block so a route elsewhere in a 3,000-line module cannot
  // satisfy it. The window is measured from `licenceAdmins:` forward, because
  // `adminDemoteAdmin` is declared immediately after the three it belongs with.
  const body = API.slice(at, at + 900);
  assert.ok(body.includes('/admin/users/${userId}/demote-admin'),
    'adminDemoteAdmin does not point at the demote route, or moved away from the three it belongs with');
  // Read from the RAW source: this claim is about the note a reader sees, and
  // `codeOnly` strips exactly that.
  const note = API_RAW.slice(Math.max(0, API_RAW.indexOf('licenceAdmins:') - 900), API_RAW.indexOf('licenceAdmins:'));
  assert.ok(note.includes('still_an_admin'),
    'nothing beside these methods records that detach refuses until the demote has run');
});
