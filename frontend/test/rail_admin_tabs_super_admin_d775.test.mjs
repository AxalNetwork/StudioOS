/**
 * D775 (#2101) PR 8 — the one rail around `/admin`'s tab panel (the owner's
 * answer A on #2101).
 *
 * Eight Super Admin boards are tabs of `pages/AdminPage.jsx`: H11 Users, H22
 * Personas, H23 Advisors and partners, H24 Directory, H27 Integration keys,
 * H28 GitHub sync, H29 Payments catalogue and H30 Promo codes. The page now
 * draws one `AdminBoardFrame` around itself, named for the open tab's board in
 * the viewer's tier, which `tabBoard` reads from D768's page map. The Admin
 * profile's tabs (#2100) get the same frame from the same map. A tab that is
 * no board of the viewer's profile, and Spin-Out applications (D317), draw the
 * page alone, and so does a host that locks the console to one `section`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { tabBoard } from '../src/pages/AdminPage.jsx';
import { SUPER_ADMIN_BOARDS, boardPage } from '../src/lib/railOptions/superAdmin.js';
import { ADMIN_BOARDS } from '../src/lib/railOptions/admin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const tabOf = (route) => new URLSearchParams(route.split('?')[1] || '').get('tab');
const TABS = [...read('pages/AdminPage.jsx').matchAll(/value: '([a-z-]+)'/g)].map((m) => m[1]);
const nameOf = (b) => b.module || b.section;

test('the Super Admin\'s /admin tabs are the eight boards, each drawn by the frame under its name', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.route.startsWith('/admin?tab='));
  assert.deepEqual(boards.map((b) => b.id), ['H11', 'H22', 'H23', 'H24', 'H27', 'H28', 'H29', 'H30']);
  for (const b of boards) {
    assert.equal(b.rail, 'pages/admin/AdminBoardFrame.jsx', `${b.id}'s rail is not the tab frame`);
    assert.equal(b.railPending, undefined, `${b.id} still says it waits`);
    assert.equal(tabBoard(tabOf(b.route), 'super_admin'), nameOf(b), `${b.id} ?tab=${tabOf(b.route)}`);
    assert.equal(pageKeyFor('/admin', 'super_admin', { search: `?tab=${tabOf(b.route)}` }), boardPage(b));
  }
  // No other tab draws a Super Admin rail: each one that does is one of the eight.
  const drawn = TABS.filter((t) => tabBoard(t, 'super_admin'));
  assert.deepEqual(drawn.sort(), boards.map((b) => tabOf(b.route)).sort());
});

test('an admin\'s tabs are named for the Admin profile\'s boards, from the same map', () => {
  const boards = ADMIN_BOARDS.filter((b) => b.route.startsWith('/admin?tab=') && tabOf(b.route) !== 'lab-applications');
  assert.ok(boards.length >= 6, 'the Admin profile lists fewer /admin tabs than it did');
  for (const b of boards) assert.equal(tabBoard(tabOf(b.route), 'admin'), nameOf(b), `${b.id} ?tab=${tabOf(b.route)}`);
  const drawn = TABS.filter((t) => tabBoard(t, 'admin'));
  assert.deepEqual(drawn.sort(), [...new Set(boards.map((b) => tabOf(b.route)))].sort());
});

test('Spin-Out applications, an off-canvas tab and any other tier draw no rail', () => {
  for (const role of ['super_admin', 'admin']) assert.equal(tabBoard('lab-applications', role), null, `D317: ${role}`);
  assert.equal(tabBoard('kyc', 'super_admin'), null, 'Identity checks is no Super Admin board');
  assert.equal(tabBoard('personas', 'admin'), null, 'Personas is no Admin board');
  for (const t of TABS) assert.equal(tabBoard(t, 'founder'), null, `a founder on ?tab=${t}`);
});

test('the page is one frame around the whole page, and none when a host locks the section', () => {
  const code = read('pages/AdminPage.jsx');
  const page = code.slice(code.indexOf('export default function AdminPage('));
  assert.match(page, /const board = section \? null : tabBoard\(tab, isSuperAdminUser\(user\) \? 'super_admin' : user\?\.role\);/,
    'the board is not the open tab\'s, in the viewer\'s tier');
  assert.match(page, /if \(!board\) return page;\s*return \(\s*<AdminBoardFrame workspace=\{board\} [^>]*data-testid="admin-tab-frame">\s*\{page\}\s*<\/AdminBoardFrame>/,
    'the frame is not the outermost element around the whole page');
  assert.equal(code.split('<AdminBoardFrame').length - 1, 1, 'more than one frame on the page');
  assert.doesNotMatch(code, /<WorkerRail\b/, 'the page mounts a rail of its own beside the frame');
});
