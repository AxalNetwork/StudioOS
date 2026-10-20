/**
 * D796 (#2229) — the Admin sidebar's "Settings" row is "Licences", on both
 * Admin shells.
 *
 *  - Neither the plain Admin shell nor the branch shell has a row labelled
 *    "Settings"; each has "Licences", opening /admin/my-licence.
 *  - The branch shell's row stays lit on Branch settings, which My Licence
 *    links only on a branch.
 *  - The rail calls the page `Admin · Licences`, the canvas's board.
 *  - The Super Admin's own "Settings" row (/account) is left as it is.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_licences_row_d796.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { ADMIN_ROWS } from '../src/lib/adminPlacement.js';
import { BranchSettingsLink } from '../src/pages/subsidiary/MyLicencePage.jsx';

const h = React.createElement;
const rowsOf = (role) => (SIDEBAR_GROUPS[role] || []).flatMap((g) => g.items || []);

test('neither Admin shell has a "Settings" row; each has "Licences" opening /admin/my-licence', () => {
  for (const role of ['admin', 'branch_admin']) {
    const rows = rowsOf(role);
    assert.ok(rows.length > 0, `${role} has rows`);
    assert.deepEqual(rows.filter((r) => r.label === 'Settings'), [], `${role} still has a Settings row`);
    const licences = rows.filter((r) => r.label === 'Licences');
    assert.equal(licences.length, 1, `${role} has one Licences row`);
    assert.equal(licences[0].to, '/admin/my-licence', `${role}'s Licences row opens My Licence`);
  }
  assert.equal(ADMIN_ROWS.at(-1), 'Licences');
});

test('the branch row stays lit on Branch settings, which My Licence links only on a branch', () => {
  const row = rowsOf('branch_admin').find((r) => r.label === 'Licences');
  assert.deepEqual(row.match, ['/admin/my-licence', '/branch/settings']);
  const on = renderToStaticMarkup(h(MemoryRouter, null, h(BranchSettingsLink, { onBranch: true })));
  assert.match(on, /href="\/branch\/settings"/);
  assert.match(on, /Branch settings →/);
  assert.equal(renderToStaticMarkup(h(MemoryRouter, null, h(BranchSettingsLink, { onBranch: false }))), '');
});

test('the rail calls the page Admin · Licences on both tiers; the Super Admin keeps its Settings row', () => {
  assert.equal(pageKeyFor('/admin/my-licence', 'admin'), 'Admin · Licences');
  assert.equal(pageKeyFor('/branch/settings', 'branch_admin'), 'Admin · Licences');
  const hq = rowsOf('super_admin').find((r) => r.label === 'Settings');
  assert.equal(hq?.to, '/account', 'the HQ shell\'s personal Settings row is unchanged');
});
