/**
 * D775 (#2101) PR 6 — the Super Admin's Team section (H10–H11) on the rail.
 *
 * H10 Team is `pages/hq/AccountsPage.jsx`, whose rail is HQ's. Its record view
 * is the account drawer, `UserDetailModal` in the users console the page draws
 * below the roster: the open account is the rail's last crumb and the run's
 * record, through `useRecordCrumb` (whose contract
 * `rail_content_super_admin_d775.test.mjs` renders). The roster's own expanded
 * row is an action form, not a record. H11 Users is an `/admin` tab in D774's
 * frame (#2100), where the same drawer names its account. Team offers no option
 * that runs a model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { SUPER_ADMIN_BOARDS, SUPER_ADMIN_RAIL_OPTIONS, boardPage } from '../src/lib/railOptions/superAdmin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const keyOf = (route) => {
  const [path, search = ''] = route.split('?');
  return pageKeyFor(path, 'super_admin', { search: search ? `?${search}` : '' });
};

test('the Team section is H10–H11, and each board\'s route answers its own key', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.section === 'Team');
  assert.deepEqual(boards.map((b) => b.id), ['H10', 'H11']);
  for (const b of boards) assert.equal(keyOf(b.route), boardPage(b), `${b.id} ${b.route}`);
  assert.deepEqual(SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Team')), []);
});

test('Team draws the users console, whose account drawer names the open account', () => {
  assert.match(read('pages/hq/AccountsPage.jsx'), /<UsersConsole onImpersonate=\{onImpersonate\} \/>/, 'Team no longer draws the users console');
  const code = read('pages/admin/consoles/UsersConsole.jsx');
  const drawer = code.slice(code.indexOf('export function UserDetailModal('));
  assert.match(drawer, /^export function UserDetailModal\([^)]*\) \{\s*useEscapeClose\(onClose\);\s*useRecordCrumb\(userRow\?\.name \|\| userRow\?\.email \|\| null, 'account', userRow\?\.id\);/,
    'the account drawer no longer names its account first thing');
  // The drawer is the one record: the console's list names none.
  assert.equal(code.split('useRecordCrumb(').length - 1, 1, 'a second record in the users console');
});
