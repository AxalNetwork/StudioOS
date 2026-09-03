/**
 * The Super Admin shell and mode.
 *
 * `super_admin` is an elevation on `admin` (migration 199, one holder by
 * 207), so `user.role` is still `'admin'` when this shell renders. The shell
 * is chosen on the flag by `shellRoleFor` (lib/shellRole.js) — a name for a
 * sidebar, never a permission — and the holder can switch between the HQ
 * shell and the plain admin shell from the View-as list.
 *
 * THE ROW/ROUTE RULE. A row pointing at an unregistered route is worse than a
 * missing row — it looks shipped and 404s — so every HQ row must resolve to a
 * `<Route path>` in App.jsx. Adding a row before its page fails here.
 *
 * THE ACCESS RULE. Nothing that decides access may read the shell role:
 * `'super_admin'` appears in no `guard([...])` array, and the HQ-only routes
 * are wrapped in `hqOnly(...)`, which renders a stated notice for an admin
 * without the elevation rather than a page that 403s on every call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { shellRoleFor, isSuperAdminUser, HQ_VIEW_KEY } from '../src/lib/shellRole.js';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const APP_CODE = codeOnly(APP);

const rows = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []);
const adminRows = (SIDEBAR_GROUPS.admin || []).flatMap((g) => g.items || []);

test('the super admin shell exists and is not empty', () => {
  assert.ok(rows.length > 0, 'SIDEBAR_GROUPS.super_admin must have rows');
});

test('every row points at a route that is actually registered', () => {
  const missing = rows.filter((r) => !APP.includes(`path="${r.to}"`));
  assert.deepEqual(
    missing.map((r) => `${r.label} → ${r.to}`), [],
    'a sidebar row whose route does not exist looks shipped and 404s — add the page first',
  );
});

test('all eight rows are present, in canvas order', () => {
  // The canvas order is Home, Licences, Funds, Contracts, Team, Support,
  // Security, Settings. "Security", not "Governance" — decision A4.
  assert.deepEqual(rows.map((r) => r.label), ['Home', 'Licences', 'Funds', 'Contracts', 'Team', 'Support', 'Security', 'Settings']);
  const licences = rows.find((r) => r.to === '/admin/licences');
  assert.ok(licences, 'the franchise console must be reachable from the HQ shell');
  assert.equal(rows.find((r) => r.label === 'Team')?.to, '/admin/accounts',
    'Team is the cross-tenant accounts table, not the public team-page editor');
});

test('the shell is chosen on the flag and the HQ toggle, never on the role alone', () => {
  const user = { role: 'admin', is_super_admin: 1 };
  assert.equal(shellRoleFor('admin', user), 'super_admin');
  assert.equal(shellRoleFor('admin', user, false), 'admin', 'the holder can look at the plain admin shell');
  assert.equal(shellRoleFor('admin', { role: 'admin', is_super_admin: 0 }), 'admin');
  assert.equal(shellRoleFor('admin', { role: 'admin' }), 'admin', 'a DB without the column reads as not elevated');
  assert.equal(shellRoleFor('admin', { role: 'admin', is_super_admin: '1' }), 'super_admin', 'D1 may hand the integer back as a string');
  assert.equal(isSuperAdminUser(null), false);
  // The selector is one expression, pinned so it cannot quietly widen.
  assert.match(read('frontend/src/lib/shellRole.js'),
    /role === 'admin' && Number\(user\?\.is_super_admin \?\? 0\) === 1 && hqView \? 'super_admin' : role/);
  assert.match(APP_CODE, /SIDEBAR_GROUPS\[shellRoleFor\(role, user, hqView\)\]/,
    'the sidebar lookup must go through the selector');
});

test('viewing as another role still shows that role\'s shell', () => {
  const user = { role: 'admin', is_super_admin: 1 };
  for (const role of ['founder', 'investor', 'advisor', 'partner', 'exploring']) {
    assert.equal(shellRoleFor(role, user), role, `${role} preview must get the ${role} shell`);
  }
});

test('the sidebar receives the shell role, so the HQ group opens on first visit', () => {
  // `defaultOpenGroups(role)` looks the role up in SIDEBAR_GROUPS. Passing
  // the active role ('admin') opened the admin groups and left `hq` — the only
  // group actually rendered — collapsed on a fresh device.
  assert.match(APP_CODE, /<SidebarNav groups=\{sidebarGroups\} role=\{shellRole \|\| 'founder'\}/);
});

test('the mode bar says Super Admin Mode only on the flag, and the View-as list leads with it', () => {
  assert.match(APP_CODE, /superAdmin \? 'Super Admin Mode' : 'Admin Mode'/);
  assert.match(APP_CODE, /\['super_admin', 'Super Admin'\]/, 'the HQ entry is offered only to a holder');
  assert.match(APP_CODE, /onViewModeChange\('admin', \{ hq: true \}\)/, 'choosing Super Admin browses as admin with the HQ shell');
  assert.match(APP_CODE, /onViewModeChange\('admin', \{ hq: false \}\)/, 'choosing Admin browses as admin with the plain shell');
});

test("'super_admin' names a shell, never a permission", () => {
  // Every access decision keys on the six roles. A guard array carrying the
  // shell name would be a route nobody can reach: `resolveActiveRole` never
  // returns it.
  const guards = [...APP_CODE.matchAll(/guard\(\[([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(guards.length > 50, 'expected the route table');
  assert.deepEqual(guards.filter((g) => /super_admin/.test(g)), [], "'super_admin' must not appear in a guard array");
  assert.doesNotMatch(read('frontend/src/lib/activeRole.js'), /super_admin/, 'the active role stays a role');
});

test('the HQ-only routes render the notice for an admin without the elevation', () => {
  for (const path of ['/admin/licences', '/admin/contracts', '/admin/accounts', '/hq', '/admin/security']) {
    const line = APP.split('\n').find((l) => l.includes(`path="${path}"`));
    assert.ok(line, `${path} must be registered`);
    assert.match(line, /hqOnly\(/, `${path} must be wrapped in hqOnly — the server 403s a plain admin on every call there`);
  }
  assert.match(APP_CODE, /const hqOnly = \(component\) => \(\s*isSuperAdminUser\(user\) \? component : <SuperAdminOnlyNotice \/>/);
});

test('the plain admin shell no longer offers HQ\'s ledger', () => {
  // Every call behind /admin/licences is super-admin-only server-side; a row
  // for it in the admin shell was a door onto 403s. The subsidiary admin's own
  // read stays.
  assert.equal(adminRows.find((r) => r.to === '/admin/licences'), undefined);
  assert.ok(adminRows.find((r) => r.to === '/admin/my-licence'), 'My Licence stays for a subsidiary admin');
});

test('a super admin keeps every admin destination', () => {
  // The elevation adds a power; it must not remove the product.
  assert.ok(adminRows.length > rows.length,
    'the HQ shell is a lens over the admin product, not a replacement for it');
});

test('the HQ toggle is per browser and dies with the session', () => {
  assert.equal(HQ_VIEW_KEY, 'hqView');
  assert.match(APP_CODE, /clearHqView\(\)/, 'clearSession must drop the toggle with the rest of the session');
  assert.match(APP_CODE, /readHqView\(\)/, 'the toggle is restored on load');
});

test('the rail has an HQ accent that is not the seam hue', () => {
  const cfg = read('frontend/src/workspaces/shellConfig.js');
  const m = /super_admin:\s*\{([^}]*)\}/.exec(cfg);
  assert.ok(m, 'ACCENT.super_admin missing');
  for (const key of ['ink', 'deep', 'tint', 'border', 'deepDark', 'tintDark']) {
    assert.match(m[1], new RegExp(`${key}:`), `ACCENT.super_admin has no ${key}`);
  }
  assert.doesNotMatch(m[1], /#0e7490/i, 'the seam hue is reserved for founder-sourced objects');
});
