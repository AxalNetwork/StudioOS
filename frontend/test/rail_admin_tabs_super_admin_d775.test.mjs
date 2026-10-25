/**
 * D775 (#2101) PR 8 — the one rail around each of the Admin Console's tools
 * (the owner's answer A on #2101).
 *
 * Five Super Admin boards were tabs of the Admin Console: H11 Users, H22
 * Personas, H24 Directory, H29 Payments catalogue and H30 Promo codes (H23
 * left for Advisors & Partners' page, D972; H27 and H28 for HQ's keys page).
 * D938 (#2743) retired the console: each tool is a page at its own address
 * (`pages/admin/ConsolePages.jsx`), which draws one `AdminBoardFrame` around
 * itself, named for its board in the viewer's tier from D768's page map. The
 * Admin profile's boards (#2100) get the same frame from the same map. A page
 * that is no board of the viewer's profile draws the page alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { pageKeyFor } from '../src/lib/railPages.js';
import { consoleBoard } from '../src/pages/admin/ConsolePages.jsx';
import { SUPER_ADMIN_BOARDS, boardPage } from '../src/lib/railOptions/superAdmin.js';
import { ADMIN_BOARDS } from '../src/lib/railOptions/admin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const nameOf = (b) => b.module || b.section;
const HOST = 'pages/admin/ConsolePages.jsx';
// Every address a console page is registered at (App.jsx, D938).
const PAGES = ['/admin/accounts/all', '/admin/kyc', '/admin/directory', '/admin/wellbeing',
  '/admin/platform/bank-accounts', '/admin/platform/product-testing', '/admin/platform/promo-codes', '/admin/revenue/billing'];

test('the Super Admin\'s console pages are the three remaining boards, each drawn by the frame under its name', () => {
  const boards = SUPER_ADMIN_BOARDS.filter((b) => b.host === HOST);
  assert.deepEqual(boards.map((b) => b.id), ['H11', 'H24', 'H30']);
  for (const b of boards) {
    assert.equal(b.rail, 'pages/admin/AdminBoardFrame.jsx', `${b.id}'s rail is not the board frame`);
    assert.equal(b.railPending, undefined, `${b.id} still says it waits`);
    assert.ok(PAGES.includes(b.route), `${b.id} is drawn at ${b.route}, which is no console page`);
    assert.equal(consoleBoard(b.route, 'super_admin'), nameOf(b), b.route);
    assert.equal(pageKeyFor(b.route, 'super_admin'), boardPage(b));
  }
  // No other console page draws a Super Admin rail: each one that does is one of these three.
  const drawn = PAGES.filter((p) => consoleBoard(p, 'super_admin'));
  assert.deepEqual(drawn.sort(), boards.map((b) => b.route).sort());
});

test('H27 and H28 are HQ\'s Integration keys page, which draws the frame named for the section the address opens', () => {
  const [keys, sync] = ['H27', 'H28'].map((id) => SUPER_ADMIN_BOARDS.find((b) => b.id === id));
  assert.equal(keys.route, '/admin/integration-keys');
  assert.equal(sync.route, '/admin/integration-keys#github');
  for (const b of [keys, sync]) {
    assert.equal(b.host, 'pages/hq/IntegrationKeysPage.jsx', `${b.id} is not hosted by the keys page`);
    assert.equal(b.rail, 'pages/admin/AdminBoardFrame.jsx', `${b.id}'s rail is not the board frame`);
    const [path, hash] = b.route.split('#');
    assert.equal(pageKeyFor(path, 'super_admin', { hash: hash ? `#${hash}` : '' }), boardPage(b), `${b.id}: the page map`);
  }
  const page = read('pages/hq/IntegrationKeysPage.jsx');
  assert.match(page, /const board = github \? 'GitHub sync' : 'Integration keys';/);
  assert.match(page, /<AdminBoardFrame\s+workspace=\{board\}/);
  assert.equal(page.split('<AdminBoardFrame').length - 1, 1, 'more than one frame on the page');
});

test('an admin\'s console pages are named for the Admin profile\'s boards, from the same map', () => {
  const boards = ADMIN_BOARDS.filter((b) => b.host === HOST);
  assert.deepEqual(boards.map((b) => b.id), ['S2', 'S6', 'S28', 'S30']);
  for (const b of boards) assert.equal(consoleBoard(b.route, 'admin'), nameOf(b), `${b.id} ${b.route}`);
  const drawn = PAGES.filter((p) => consoleBoard(p, 'admin'));
  assert.deepEqual(drawn.sort(), boards.map((b) => b.route).sort());
});

test('a page that is no board of the viewer, and any other tier, draw no rail', () => {
  assert.equal(consoleBoard('/admin/kyc', 'super_admin'), null, 'Identity checks is no Super Admin board');
  assert.equal(consoleBoard('/admin/persona-segments', 'admin'), null, 'Personas is no Admin board');
  for (const p of PAGES) assert.equal(consoleBoard(p, 'founder'), null, `a founder on ${p}`);
  // Platform's and Revenue's own sections answer these addresses, which are no board's module.
  assert.equal(consoleBoard('/admin/platform/bank-accounts', 'super_admin'), null);
  assert.equal(consoleBoard('/admin/revenue/billing', 'super_admin'), null);
});

test('the page is one frame around the whole page', () => {
  const code = read(HOST);
  assert.match(code, /if \(!board\) return page;\s*return \(\s*<AdminBoardFrame workspace=\{board\} [^>]*data-testid="admin-console-frame">\s*\{page\}\s*<\/AdminBoardFrame>/,
    'the frame is not the outermost element around the whole page');
  assert.equal(code.split('<AdminBoardFrame').length - 1, 1, 'more than one frame on the page');
  assert.doesNotMatch(code, /<WorkerRail\b/, 'the page mounts a rail of its own beside the frame');
});
