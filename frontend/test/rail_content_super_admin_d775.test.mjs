/**
 * D775 (#2101) PR 2 — the Super Admin's Content section on the rail.
 *
 * The section's seven active boards are H18–H25 except retired H21 (`lib/railOptions/superAdmin.js`).
 * Under D768's shell provider (#2133) every rail takes its page key from the
 * route, so this checks the three things the section adds:
 *   · each board's route answers its own key, and so do Publications' record
 *     routes (`/new`, `/:id`);
 *   · each record view names its record as the last crumb and the run's
 *     record (the article under review, a publication, a team member);
 *   · each option in the inventory is opened where it lives: H20's Draft with
 *     AI on the new-publication page.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_content_super_admin_d775.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { currentRail, pageKeyFor } from '../src/lib/railPages.js';
import { RailPageProvider, useRailCrumbs, useRailPage } from '../src/ui/railCrumbs.js';
import useRecordCrumb from '../src/pages/admin/useRecordCrumb.js';
import { SUPER_ADMIN_BOARDS, SUPER_ADMIN_RAIL_OPTIONS, boardPage } from '../src/lib/railOptions/superAdmin.js';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const CONTENT = SUPER_ADMIN_BOARDS.filter((b) => b.section === 'Content');

/** A route as `pageKeyFor` reads it: path, then `?search`. */
function keyOf(route) {
  const [path, search = ''] = route.split('?');
  return pageKeyFor(path, 'super_admin', { search: search ? `?${search}` : '' });
}

test('the Content section keeps H18–H25 except retired H21, and each board\'s route answers its own key', () => {
  assert.deepEqual(CONTENT.map((b) => b.id), ['H18', 'H19', 'H20', 'H22', 'H23', 'H24', 'H25']);
  for (const b of CONTENT) assert.equal(keyOf(b.route), boardPage(b), `${b.id} ${b.route}`);
  // Publications is one board on three routes.
  for (const path of ['/admin/publications/new', '/admin/publications/41']) {
    assert.equal(pageKeyFor(path, 'super_admin'), 'Super Admin · Content · Publications', path);
  }
});

test('each record view on the section names its record, with its type', () => {
  const VIEWS = [
    ['pages/admin/ArticlesQueuePage.jsx', /useRecordCrumb\(detail\?\.article\?\.title, 'article', detail\?\.article\?\.id\)/],
    ['pages/admin/PublicationDetail.jsx', /useRecordCrumb\(data\?\.publication\?\.title, 'publication', /],
    ['pages/admin/AdminTeam.jsx', /useRecordCrumb\(isNew \? null : initial\?\.name, 'team-member', initial\?\.id\)/],
  ];
  for (const [file, call] of VIEWS) assert.match(read(file), call, `${file} no longer names its record`);
});

test('each Content option is opened where it lives, with the inventory\'s key and label', () => {
  const rows = SUPER_ADMIN_RAIL_OPTIONS.filter((o) => o.page.startsWith('Super Admin · Content'));
  assert.ok(rows.length >= 1, 'the Content section lists no option');
  for (const o of rows) {
    const code = read(o.source.file);
    const call = `useRailOption('${o.key}', '${o.label}')`;
    assert.equal(code.split(call).length - 1, 1, `${o.source.file} does not open ${o.key} once`);
  }
});

function Probe({ seen }) {
  const crumbs = useRailCrumbs();
  const page = useRailPage();
  seen.push({ crumbs, page: page?.page ?? null });
  return null;
}
function Record({ title, type, id }) { useRecordCrumb(title, type, id); return null; }

async function mount(path, child) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const seen = [];
  const tree = (c) => React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(RailPageProvider, { role: 'super_admin' }, c, React.createElement(Probe, { seen })));
  await act(async () => { root.render(tree(child)); });
  return {
    seen,
    render: async (c) => act(async () => { root.render(tree(c)); }),
    done: async () => { await act(async () => root.unmount()); restore(); },
  };
}

test('a record view\'s title is the last crumb and its ref the run\'s record; leaving drops both', async () => {
  const m = await mount('/admin/publications/41', React.createElement(Record, { title: 'Q3 letter', type: 'publication', id: 41 }));
  try {
    const last = m.seen[m.seen.length - 1];
    assert.equal(last.page, 'Super Admin · Content · Publications');
    assert.deepEqual(last.crumbs, { section: 'Content', module: 'Publications', record: 'Q3 letter' });
    assert.deepEqual(currentRail(), { page: 'Super Admin · Content · Publications', option: null, record: { type: 'publication', id: '41' } });
    await m.render(null);
    assert.equal(m.seen[m.seen.length - 1].crumbs.record, null, 'left, the record is dropped');
    assert.equal(currentRail().record, null, 'left, the run reads no record');
    await m.render(React.createElement(Record, { title: null, type: 'publication', id: 41 }));
    assert.equal(m.seen[m.seen.length - 1].crumbs.record, null, 'no title, no record crumb');
    assert.equal(currentRail().record, null);
  } finally { await m.done(); }
});
