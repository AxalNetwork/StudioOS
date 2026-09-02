/**
 * The Super Admin shell.
 *
 * `super_admin` is an elevation on `admin` (migration 199), so `user.role` is
 * still `'admin'` when this shell renders. The group is chosen on the flag,
 * which is why the selection has its own function rather than living in the
 * `SIDEBAR_GROUPS[role]` lookup.
 *
 * THE ROW/ROUTE RULE. The approved canvas has eight rows and four of them have
 * no page yet. A row pointing at an unregistered route is worse than a missing
 * row — it looks shipped and 404s — so this asserts every row resolves to a
 * `<Route path>` in App.jsx. Adding a row before its page fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');

const rows = (SIDEBAR_GROUPS.super_admin || []).flatMap((g) => g.items || []);

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

test('the Licences row is present, because it is why this tier exists', () => {
  const licences = rows.find((r) => r.to === '/admin/licences');
  assert.ok(licences, 'the franchise console must be reachable from the HQ shell');
  assert.equal(licences.label, 'Licences');
});

test('the shell is chosen on the flag, not on the role', () => {
  // `role` is 'admin' for a super admin, so a plain SIDEBAR_GROUPS[role]
  // lookup can never reach this group.
  assert.match(APP, /function shellRoleFor\(role, user\)/);
  assert.match(APP, /Number\(user\?\.is_super_admin \?\? 0\) === 1 \? 'super_admin' : role/);
  assert.match(APP, /SIDEBAR_GROUPS\[shellRoleFor\(role, user\)\]/);
});

test('viewing as another role still shows that role\'s shell', () => {
  // An admin using "view as" to check a founder's experience must get the
  // founder shell. `shellRoleFor` only elevates when the resolved role is
  // still 'admin', so the switch keeps working.
  assert.match(APP, /role === 'admin' && Number\(user\?\.is_super_admin/);
});

test('a super admin keeps every admin destination', () => {
  // The elevation adds a power; it must not remove the product. Nothing here
  // may shrink what an admin reaches, so the admin group stays intact and is
  // still the larger of the two.
  const adminRows = (SIDEBAR_GROUPS.admin || []).flatMap((g) => g.items || []);
  assert.ok(adminRows.length > rows.length,
    'the HQ shell is a lens over the admin product, not a replacement for it');
});
