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
 *
 * TASK #174 REPORTED THE SAME SYMPTOM AGAIN — "as a Super Admin I cannot change
 * the Role of users" — and the answer taken was one explicit door rather than an
 * open gate: a super admin may step over the binding agreement by typing a
 * reason, which is written into the role's audit line. That door, and the proof
 * that only a super admin has it, live in
 * `frontend/test/admin_role_override.test.mjs` and
 * `cloudflare-worker/test/admin_role_override.test.ts`. What this file keeps
 * asserting is the other half: with nobody overriding, the gate is exactly as
 * shut as #152 left it.
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

test('the signed-agreement gate is shut by default, and only `canOverride` opens it', () => {
  // THE GATE STILL CLOSES FIRST. Task #174 reported the same symptom as #152 —
  // "as a Super Admin I cannot change the Role of users" — and the answer taken
  // was to add ONE explicit door, not to open the gate: a super admin may step
  // over the binding agreement by typing a reason that goes into the audit
  // (`frontend/test/admin_role_override.test.mjs`,
  // `cloudflare-worker/test/admin_role_override.test.ts`). For everybody else
  // this is unchanged, and the server refuses a reasonless request either way.
  const d = dropdown();
  assert.match(d, /const isExploring = user\.role === 'exploring';/,
    'the exploring branch is gone');
  // Written out whole, because each half is a different regression. Lose
  // `isExploring && opt.value !== 'exploring'` and every option is live for
  // every admin — the bypass the 409 exists to refuse. Lose `&& !canOverride`
  // and the menu is dead again for the one role that is allowed through it,
  // which is how this was reported twice.
  assert.match(d, /const disabled = isExploring && opt\.value !== 'exploring' && !canOverride;/,
    'the exploring gate is no longer `isExploring && not-exploring && not-overriding` — '
    + 'one of the two halves has gone, and either loss is a defect');
  // The parameter DEFAULTS TO CLOSED. Every other caller of RoleDropdown, and
  // any future one that forgets the prop, must get the gate rather than the
  // bypass; `canOverride` arriving as `undefined` has to read as "no".
  assert.match(src, /function RoleDropdown\(\{ user, onRoleChange, canOverride = false \}\)/,
    'canOverride does not default to false — a caller that omits it would open the gate');
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
  // BOUNDED ON `</div>`, NOT `</li>`. The note used to be the last <li> of the
  // options list; it is a <div> now because it had to leave the scrolling
  // region (next test). The old bound was `indexOf('</li>', a)`, which after
  // that move returned -1 — and `slice(a, -1)` silently reads to the end of the
  // component, so the assertions below would have passed against copy found
  // anywhere in RoleDropdown. An end marker that cannot be found must fail,
  // not widen.
  const end = d.indexOf('</div>', a);
  assert.ok(end > a, "the exploring branch's end marker is gone — this slice would run past it");
  const branch = d.slice(a, end);
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

test('the note and the queue link cannot be scrolled out of the menu', () => {
  // WHY #152'S EXPLANATION MAY NEVER HAVE BEEN READ. The note and the queue link
  // were the LAST children of the scrolling `<ul>`, under a `maxHeight` that
  // floors at 96px (`Math.max(96, …)`) while the five options alone run to
  // roughly 135px. For any row without room below or above, the menu opened at
  // its floor, the options filled it, and the one thing saying why they were
  // grey — and where to go instead — sat below the fold of a 96px box. #174 is
  // the same complaint reported a second time.
  //
  // The fix is structural: the cap is on a flex column, the options scroll
  // inside it, and the footer is a sibling of that list with `shrink-0`. So it
  // is pinned at every height the placement can produce.
  const d = dropdown();
  const list = d.indexOf('<ul role="listbox"');
  const listEnd = d.indexOf('</ul>', list);
  assert.ok(list >= 0 && listEnd > list, 'the options list is gone');
  assert.ok(d.indexOf('{isExploring && (') > listEnd,
    'the note is back INSIDE the scrolling options list, where a short menu hides it');
  // `shrink-0` is what stops flex taking the space back from it: without it the
  // footer is compressible and the options win the negotiation, which reproduces
  // the same invisibility one layer up from where it was fixed.
  const footer = d.slice(d.indexOf('{isExploring && ('));
  assert.match(footer, /className="shrink-0 /,
    'the footer can be shrunk by flex, so a tight menu squeezes it away again');
  // And the menu itself must be the column that clips, or the footer is outside
  // the rounded border rather than pinned inside it.
  assert.match(d, /className="z-50 flex min-w-\[190px\] flex-col overflow-hidden/,
    'the menu is no longer a clipping flex column, so the pinned footer has nothing to be pinned in');
});

test('the route out is a client-side link, not a page reload', () => {
  // AdminPage carries unsaved filter and tab state; an <a href> would throw it
  // away and refetch the whole console to move one route.
  // The pin is the property — `Link` among the router's named imports — not
  // the literal line, which D285 widened to `Link, useLocation, useNavigate`
  // when the tab began following the address bar.
  assert.match(src, /^import \{[^}]*\bLink\b[^}]*\} from 'react-router-dom';$/m,
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
  assert.match(d, /maxHeight: at\.maxHeight,/,
    'the menu is not capped to the space it was given, so it can still overflow the window');
  // The cap stayed; the SCROLL moved off it onto the options list, so the note
  // below them can sit outside the scrolling region (next test). Capping the
  // wrapper without giving the list its own scroll would clip the overflowing
  // options with no way to reach them — strictly worse than before.
  assert.match(d, /<ul role="listbox"[^>]*className="[^"]*overflow-y-auto[^"]*"/,
    'the options list does not scroll, so a capped menu now clips options instead of '
    + 'letting them be scrolled to');
  // `min-h-0` is load-bearing, not decoration: a flex child's default
  // `min-height: auto` refuses to shrink below its content, so `overflow-y-auto`
  // on it does nothing and the list pushes the menu past its own maxHeight.
  assert.match(d, /<ul role="listbox"[^>]*className="[^"]*min-h-0[^"]*"/,
    'the scrolling list can refuse to shrink (flex min-height: auto), which defeats the cap');
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
  // Written out rather than built in a loop: `new RegExp` on an interpolated
  // value is what Semgrep's detect-non-literal-regexp rule exists for, and
  // with two events a loop was saving one line and costing a finding.
  assert.match(d, /window\.removeEventListener\('scroll', place, true\)/,
    'the scroll listener is never removed');
  assert.match(d, /window\.removeEventListener\('resize', place\)/,
    'the resize listener is never removed');
});
