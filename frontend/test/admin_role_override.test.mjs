/**
 * The super-admin override on the Users-table role picker — task #174,
 * "as a Super Admin I cannot change the Role of users".
 *
 * That was true, and it was not a bug. Every new signup lands in
 * `role='exploring'` (`routes/auth.ts:334`), and leaving `exploring` requires a
 * signed binding agreement enforced at three layers — the dropdown disables the
 * four real roles, `PATCH /users/:id/role` answers 409
 * `use_exploring_assign_role`, and the Exploring queue re-checks for a completed
 * `esign_envelopes` row. So the picker was inert for most of the table by
 * design, which is what read as broken, twice (#152, then #174).
 *
 * What was added is ONE door, not an open gate: a super admin may assign the
 * role anyway by typing a reason, and that reason is written into the
 * `role_changed` audit line so the override is legible afterwards instead of
 * indistinguishable from a routine assignment. The gate's own behaviour for
 * everybody else is unchanged and is still asserted in
 * `frontend/test/admin_role_picker.test.mjs`.
 *
 * This file holds the three ways the door can be widened by accident:
 *
 *   1. the affordance is offered to every admin, not only a super admin —
 *      `canOverride={true}`, or a truthiness test that an absent field passes;
 *   2. the reason is collected but not really required, so the audit line says
 *      nothing a person can act on later;
 *   3. the reason SENT is not the reason TYPED — a literal in the api layer
 *      would leave every assertion above passing and every audit line a lie.
 *
 * Read as text rather than rendered: this repo's frontend suite has no DOM, and
 * these are structural facts about the source. The server-side half — that a
 * plain admin is refused, that a short reason is refused, that the audit row
 * carries both roles and the reason, and that the override still cannot mint or
 * demote an admin — is driven for real against SQLite in
 * `cloudflare-worker/test/admin_role_override.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/AdminPage.jsx');
const src = codeOnly(PAGE);
const api = codeOnly(raw('frontend/src/lib/api.js'));
const route = raw('cloudflare-worker/src/routes/admin.ts');

/** `RoleOverrideDialog` alone. AdminPage is 5k lines with several dialogs in it;
 *  an unbounded search would happily read the support-session one, which has the
 *  same ten-character rule and would satisfy half of this file by accident. */
function dialog() {
  const a = src.indexOf('function RoleOverrideDialog(');
  assert.ok(a >= 0, 'RoleOverrideDialog is gone');
  const b = src.indexOf('function SupportSessionDialog(', a);
  assert.ok(b > a, "RoleOverrideDialog's end marker is gone — this slice would run past it");
  return src.slice(a, b);
}

test('only a real super admin is offered the override', () => {
  // THE FLAG IS READ, NOT ASSUMED. `is_super_admin` already rides
  // `GET /api/auth/me` and therefore `useAuth().user`, so no new fetch — but
  // that also means a shape without the field (the dev FastAPI returns a
  // different one) must read as NOT super rather than as undefined-and-truthy.
  assert.match(src, /const canOverrideRole = Number\(viewer\?\.is_super_admin \?\? 0\) === 1;/,
    'the override is no longer gated on the viewer\'s own is_super_admin, or an '
    + 'absent field no longer reads as "no"');
  assert.match(src, /^import \{ useAuth \} from '\.\.\/hooks\/useAuthSync';$/m,
    'useAuth is not imported, so there is no viewer to check');
  assert.match(src, /<RoleDropdown user=\{u\} onRoleChange=\{handleRoleChange\} canOverride=\{canOverrideRole\} \/>/,
    'the Users table no longer passes the computed flag to the picker');
  // The two shapes that would hand the override to every admin in the console.
  assert.doesNotMatch(src, /canOverride=\{true\}/,
    'canOverride is hardcoded true — every admin can now skip the binding agreement');
  assert.doesNotMatch(src, /canOverride=\{!!viewer/,
    'the flag is coerced by truthiness rather than compared, which lets any '
    + 'non-empty value through');
});

test('leaving Exploring asks for a reason instead of a yes/no confirm', () => {
  // A `window.confirm` cannot collect an audit line. The exploring branch has to
  // be taken BEFORE the confirm, or the override falls through to it and the
  // server refuses the reasonless request the page then sends.
  const h = src.slice(src.indexOf('const handleRoleChange = async'), src.indexOf('const confirmRoleOverride'));
  assert.ok(h.length > 0, 'handleRoleChange or confirmRoleOverride is gone');
  assert.match(h, /if \(String\(user\.role\)\.toLowerCase\(\) === 'exploring' && newRole !== 'exploring'\) \{[\s\S]*?setRoleOverride\(\{ user, nextRole: newRole \}\);[\s\S]*?return;/,
    'a change out of exploring does not open the reason dialog');
  assert.ok(h.indexOf('setRoleOverride(') < h.indexOf('window.confirm'),
    'the plain confirm runs before the exploring branch, so the override never '
    + 'collects a reason and the request is refused');
  // And the dialog has to be mounted, or the state is set and nothing appears.
  assert.match(src, /\{roleOverride && \(\s*<RoleOverrideDialog/,
    'RoleOverrideDialog is never rendered, so choosing a role does nothing visible');
});

test('the reason is required in substance, not just in shape', () => {
  const d = dialog();
  // Trimmed, so a screenful of spaces is not a reason. Ten characters is the bar
  // the support-session dialog already sets, for the same stated reason.
  assert.match(d, /const tooShort = reason\.trim\(\)\.length < 10;/,
    'the ten-character floor on the reason is gone, or it no longer trims — '
    + '"ok" and "          " are not explanations anybody can act on later');
  assert.match(d, /disabled=\{busy \|\| tooShort\}/,
    'the confirm button is not gated on the reason, so the guard is decoration');
  assert.match(d, /onConfirm\(reason\.trim\(\)\)/,
    'the dialog does not hand up the trimmed reason it just validated');
  // Starts empty. A prefilled reason is the same defect as a pre-ticked consent
  // checkbox: the audit line would carry words nobody chose.
  assert.match(d, /const \[reason, setReason\] = useState\(''\)/,
    'the reason field does not start empty — a prefilled reason puts words into '
    + 'the audit that the super admin never wrote');
});

test('the dialog says what is being skipped and that it is recorded', () => {
  // An override the operator does not understand is not an informed one. Read as
  // rendered children with attribute values stripped, so moving the sentences
  // into a `title=` does not satisfy this.
  const rendered = dialog().replace(/\s[a-zA-Z-]+="[^"]*"/g, '');
  assert.match(rendered, /Exploring holding state/,
    'the dialog does not say what state the person is being moved out of');
  assert.match(rendered, /sign the binding agreement/,
    'the dialog does not name the requirement being skipped');
  assert.match(rendered, /Override · recorded in Governance/,
    'the dialog does not say the override is recorded, which is the one thing '
    + 'that makes it different from a routine assignment');
  assert.match(rendered, /this is the line someone reads in the audit later/,
    'the reason field does not say what the reason is for');
});

test('the reason that is sent is the reason that was typed', () => {
  // THE ESCAPE THIS TEST EXISTS FOR. Every assertion above passes while the api
  // layer sends a constant, and the audit then carries a sentence in the super
  // admin's name that they did not write — which is worse than no audit at all,
  // because it reads as evidence.
  assert.match(src, /await api\.adminUpdateRole\(roleOverride\.user\.id, roleOverride\.nextRole, reason\)/,
    'the page does not forward the typed reason to the API call');
  const method = api.slice(api.indexOf('adminUpdateRole:'), api.indexOf('adminToggleActive:'));
  assert.ok(method.length > 0, 'adminUpdateRole is gone');
  assert.match(method, /adminUpdateRole: \(userId, role, overrideReason\) =>/,
    'adminUpdateRole does not take a reason');
  assert.match(method, /body: JSON\.stringify\(\{ override_reason: overrideReason \}\)/,
    'the api method does not forward the caller\'s reason verbatim');
  assert.doesNotMatch(method, /override_reason: '/,
    'override_reason is a literal string in the api layer, which makes every '
    + 'override audit line a fiction');
  // No reason means NO BODY, not an empty one. A routine demotion back to
  // exploring must not carry an `override_reason` key at all — the server reads
  // the key's presence as the request to override.
  assert.match(method, /\.\.\.\(overrideReason \? \{ body: JSON\.stringify/,
    'the body is sent unconditionally — a routine role change would arrive '
    + 'asking for an override it has no reason for');
});

test('the client gate is a courtesy; the server holds the real one', () => {
  // Nothing above stops a crafted PATCH. These are the anchors that say where
  // the enforcement lives, so removing it cannot leave this suite green;
  // `cloudflare-worker/test/admin_role_override.test.ts` drives it for real.
  assert.match(route, /super_admin_required/,
    'the route has no named refusal for a non-super admin asking to override');
  assert.match(route, /override_reason_too_short/,
    'the route does not enforce the reason length server-side');
  assert.match(route, /if \(!isSuperAdmin\(adminUser as any\)\) \{/,
    'the override no longer asks isSuperAdmin about the caller, so whatever is '
    + 'gating it is not the elevation');
  assert.match(route, /BINDING-AGREEMENT OVERRIDE by super admin/,
    'the audit line no longer marks the override, so it is indistinguishable '
    + 'from a routine assignment in the activity log');
});
