/**
 * The Users-table role picker — Task #152, "Super Admin cannot change a user's
 * role; the picker is inert."
 *
 * IT WAS INERT, AND THE TITLE WAS STILL WRONG ABOUT WHY. `handleRoleChange`,
 * `api.adminUpdateRole` and `PATCH /api/admin/users/:userId/role` all exist and
 * all work — `cloudflare-worker/test/admin_role_change.test.ts` drives the
 * route and proves it. What is dead is the *menu*: every new signup lands in
 * `role='exploring'` (routes/auth.ts:334), and for an exploring user every
 * option except `exploring` is disabled, while the handler returns early when
 * the chosen value equals the current one. So the one enabled option is a
 * no-op and the other four are grey. The menu opens; nothing can be clicked.
 *
 * The disabling is CORRECT and stays: leaving exploring requires a signed
 * binding agreement, re-checked server-side (admin_exploring.ts:259) and
 * refused by the generic endpoint with 409 `use_exploring_assign_role`. The
 * defect was that the only thing saying so was a `title` on a disabled `<li>`
 * — invisible to anyone not hovering, and to keyboard and screen-reader users
 * entirely. A control that is right but silent reads as broken, and did.
 *
 * So this file holds two things: the gate is still shut, and the way through
 * is now on the screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/AdminPage.jsx');
const src = codeOnly(PAGE);

/** `RoleDropdown` alone, bounded at both ends — the rest of this 5k-line file
 *  has its own dropdowns and an unbounded search would read one of those. */
function dropdown() {
  const a = src.indexOf('function RoleDropdown(');
  assert.ok(a >= 0, 'RoleDropdown is gone');
  const b = src.indexOf('const STATUS_BADGES', a);
  assert.ok(b > a, "RoleDropdown's end marker is gone — this slice would run past it");
  return src.slice(a, b);
}

test('the signed-agreement gate is still shut', () => {
  // If this ever passes by the options becoming enabled, the fix went the
  // wrong way: an admin could then skip the binding agreement from the Users
  // table, which is the exact bypass the 409 exists to refuse.
  const d = dropdown();
  assert.match(d, /const isExploring = user\.role === 'exploring';/,
    'the exploring branch is gone');
  assert.match(d, /const disabled = isExploring && opt\.value !== 'exploring';/,
    'the four real roles are no longer disabled for an exploring user');
  assert.match(src, /if \(newRole === user\.role\) return;/,
    'the no-op guard on the handler is gone');
});

test('the reason is on the screen, not in a tooltip', () => {
  const d = dropdown();
  // The retired mechanism. A `title` is not an explanation for a keyboard user.
  assert.doesNotMatch(d, /title=\{disabled \?/,
    'the reason is back to being a tooltip on a disabled option');
  // Rendered text, inside the exploring branch — not merely present somewhere
  // in a 5,000-line file.
  const a = d.indexOf('{isExploring && (');
  assert.ok(a >= 0, 'the exploring branch renders nothing');
  const branch = d.slice(a, d.indexOf('</li>', a));
  // Attribute values stripped before the copy is checked. Without this, moving
  // the sentence into `title="…"` still satisfies a plain `match` on the
  // branch — a mutation doing exactly that escaped, which is the whole defect
  // put back under a different attribute name. What has to be true is that
  // the words are CHILDREN of an element, not the value of one of its props.
  const rendered = branch.replace(/\s[a-zA-Z-]+="[^"]*"/g, '');
  assert.match(rendered, /Leaving Exploring needs a signed binding agreement\./,
    'the reason is not rendered text — it is back inside an attribute');
  assert.match(rendered, /Assign from the Exploring queue/,
    'the link text does not say where it goes');
  // The destination IS an attribute, so it is read off the unstripped slice.
  assert.match(branch, /to="\/admin\/exploring"/,
    'the menu offers no way through to the queue that can actually do this');
});

test('the route out is a client-side link, not a page reload', () => {
  // AdminPage carries unsaved filter and tab state; an <a href> would throw it
  // away and refetch the whole console to move one route.
  assert.match(src, /^import \{ Link \} from 'react-router-dom';$/m,
    'Link is not imported — the queue link would be a full page load');
  assert.doesNotMatch(dropdown(), /<a href="\/admin\/exploring"/,
    'the queue link is a raw anchor');
});

test('the menu escapes the two containers that were cutting it in half', () => {
  // The card is `overflow-hidden` (its rounded corners) inside the table's
  // `overflow-x-auto` — and `overflow-x` alone computes `overflow-y: auto`, so
  // both ancestors clipped an absolutely-positioned child. For any row near
  // the bottom of the table the options were simply not on screen.
  const d = dropdown();
  assert.match(src, /^import \{ createPortal \} from 'react-dom';$/m, 'the portal import is gone');
  assert.match(d, /createPortal\(/, 'the menu is no longer portalled');
  assert.match(d, /\), document\.body\)\}/, 'the portal target is not document.body');
  assert.doesNotMatch(d, /className="absolute left-1\/2 -translate-x-1\/2 top-full/,
    'the menu is positioned inside the clipping ancestors again');
  assert.match(d, /position: 'fixed'/, 'the portalled menu is not fixed-positioned');
});

test('the menu opens toward the room it has, and never past the window edge', () => {
  // Portalling stopped the ancestors clipping it and immediately created the
  // same problem one level out: a row low in the table opened a menu that ran
  // off the bottom of the WINDOW, where `position: fixed` means it cannot be
  // scrolled to either. Measured at a 620px viewport before the fix — the
  // queue link, which is the last thing in the menu and the entire point of
  // this change, was off screen.
  //
  // The space is measured, not the menu: whichever side wins, `maxHeight`
  // makes the menu fit it, so its own height never has to be known and this
  // stays a single pass.
  const d = dropdown();
  assert.match(d, /const below = window\.innerHeight - r\.bottom;/, 'the space below is not measured');
  assert.match(d, /const above = r\.top;/, 'the space above is not measured');
  assert.match(d, /below >= above/, 'the menu no longer picks the side with more room');
  assert.match(d, /bottom: window\.innerHeight - r\.top \+ GAP/, 'the upward branch is gone');
  assert.match(d, /maxHeight: at\.maxHeight, overflowY: 'auto'/,
    'the menu is not capped to the space it was given, so it can still overflow the window');
  assert.match(d, /\.\.\.\(at\.top === undefined \? \{ bottom: at\.bottom \} : \{ top: at\.top \}\)/,
    'the style no longer switches between the two anchors');
});

test('a portalled menu still closes on an outside click, and follows the row', () => {
  const d = dropdown();
  // `ref` no longer contains the menu, so checking it alone would close the
  // menu on the first click INSIDE the menu.
  assert.match(d, /menuRef\.current\?\.contains\(e\.target\)/,
    'the outside-click check ignores the portalled menu — clicking it would close it');
  assert.match(d, /ref\.current\?\.contains\(e\.target\)/, 'the trigger is no longer spared');
  // Fixed positioning does not scroll with the page, so it must re-measure or
  // the menu is left floating over the wrong row.
  assert.match(d, /window\.addEventListener\('scroll', place, true\)/,
    'the menu does not follow the table when it scrolls');
  assert.match(d, /window\.addEventListener\('resize', place\)/,
    'the menu does not re-place on resize');
  for (const ev of ['scroll', 'resize']) {
    assert.match(d, new RegExp(`window\\.removeEventListener\\('${ev}'`),
      `the ${ev} listener is never removed`);
  }
});
