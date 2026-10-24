/**
 * D981 (#2376) — Program grants: HQ's page at /admin/licences/programs and
 * the studio's Programs tab at /admin/my-licence/programs, the integration of
 * the owner's canvas (GR1–GR15). No grant is stored yet, so every grantable
 * cell says "Not recorded", never "Not granted"; the fixed facts (HQ only,
 * not ready to grant) are drawn as the canvas states them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/program_grants_d981.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  NOT_RECORDED_GRANT, PROGRAMS, adminCell, hqCell, programGroups, studioRows, studiosTile,
} from '../src/lib/programGrants.js';
import ProgramGrants from '../src/pages/admin/grants/ProgramGrants.jsx';
import ProgramsTab from '../src/pages/subsidiary/licence/ProgramsTab.jsx';
import { stripFor } from '../src/lib/hqStrips.js';
import { LICENCE_TABS, tabFor } from '../src/lib/licencePage.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const LICENCES = { items: [
  { uid: 'l1', licence_ref: 'AXL-002', brand_name: 'Studio Lisbon', kind: 'subsidiary', status: 'active', territories: ['PT'] },
  { uid: 'l2', licence_ref: 'AXL-004', brand_name: 'Northfield Ventures', kind: 'white_label', status: 'active', territories: [] },
  { uid: 'l3', licence_ref: 'AXL-005', brand_name: 'Studio Seoul', kind: 'subsidiary', status: 'suspended', territories: ['KR'] },
  { uid: 'l4', licence_ref: 'AXL-006', brand_name: 'Studio Bogotá', kind: 'subsidiary', status: 'pending_activation', territories: ['CO'] },
  { uid: 'l5', licence_ref: 'AXL-007', brand_name: 'Draft Studio', kind: 'subsidiary', status: 'draft', territories: [] },
  { uid: 'l6', licence_ref: 'AXL-001', brand_name: 'Old Studio', kind: 'subsidiary', status: 'terminated', territories: [] },
] };

// ---------------------------------------------------------------- the model

test('the programs are the canvas\'s nine, in its order and groups; six can be granted', () => {
  assert.deepEqual(PROGRAMS.map((p) => p.name), [
    'Spin-Out Lab', 'AI-native Venture', 'Mentor cohort access', 'Investor cohort access',
    'Referral partners', 'Refer & Earn', 'Perks', 'Learning', 'Product testing',
  ]);
  assert.deepEqual(programGroups().map((g) => [g.group, g.span]), [
    ['Ventures', 2], ['Access', 2], ['Network and referrals', 2], ['Rewards', 1], ['Learning', 1], ['Product', 1],
  ]);
  assert.equal(PROGRAMS.filter((p) => p.grant === 'yes').length, 6);
});

test('with no grant stored, a grantable cell is "Not recorded", never "Not granted"; the fixed facts are drawn', () => {
  const byKey = Object.fromEntries(PROGRAMS.map((p) => [p.key, p]));
  assert.equal(hqCell(byKey.perks).text, NOT_RECORDED_GRANT);
  assert.match(hqCell(byKey.perks).tip, /grant store/);
  assert.equal(hqCell(byKey['product-testing']).text, 'HQ only');
  assert.equal(hqCell(byKey['investor-cohorts']).text, 'Not ready to grant');
  assert.equal(adminCell(byKey['product-testing']).text, 'Runs at HQ');
  assert.equal(adminCell(byKey['ai-native-venture']).text, 'Not offered yet');
  assert.equal(adminCell(byKey.learning).text, NOT_RECORDED_GRANT);
  for (const p of PROGRAMS) {
    assert.notEqual(hqCell(p).text, 'Not granted', p.key);
    assert.notEqual(adminCell(p).text, 'Not granted', p.key);
  }
});

test('the grid\'s rows are the licensed studios, drafts and terminated licences left out, with their row notes', () => {
  const rows = studioRows(LICENCES.items);
  assert.deepEqual(rows.map((r) => r.ref), ['AXL-002', 'AXL-004', 'AXL-005', 'AXL-006']);
  assert.equal(rows[1].kind, 'White-label');
  assert.equal(rows[1].territories, 'No territory');
  assert.match(rows[2].note, /frozen until HQ lifts the suspension/);
  assert.match(rows[3].note, /when the licence is active/);
  assert.equal(rows[0].note, null);
  assert.deepEqual(studiosTile(LICENCES.items), { value: 4, sub: '2 active · 1 suspended · 1 pending activation' });
});

test('the Licences strip covers both its items; the Programs tab is the licence page\'s third', () => {
  assert.equal(stripFor('/admin/licences'), 'Licences');
  assert.equal(stripFor('/admin/licences/programs'), 'Licences');
  assert.deepEqual(LICENCE_TABS.map((t) => t.key).slice(0, 3), ['summary', 'terms', 'programs']);
  assert.equal(tabFor('/admin/my-licence/programs'), 'programs');
});

// ---------------------------------------------------------------- the pages, mounted

async function render(el, url = '/admin/licences/programs') {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el)); });
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    text: () => textOf(container),
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    cells: () => walk(container).filter((n) => n.tagName === 'TD').map(textOf),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

function stub(answer) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname);
    if (u.pathname === '/api/admin/licences') return answer();
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { seen, restore() { globalThis.fetch = original; } };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('mounted HQ page: the header, the studios tile, one row per studio against nine programs, and the waits', async () => {
  const s = stub(() => json(LICENCES));
  const v = await render(h(ProgramGrants));
  try {
    assert.match(v.of('grants-header'), /Licences.*Program grants.*HQ only/s);
    assert.match(v.of('grants-tile-studios'), /4.*2 active · 1 suspended · 1 pending activation/s);
    for (const id of ['in-force', 'requests', 'ending']) assert.match(v.of(`grants-tile-${id}`), /Not read here yet/);
    assert.match(v.of('grants-row-AXL-005'), /Studio Seoul.*frozen/s);
    assert.ok(!v.has('grants-row-AXL-007'), 'a draft licence became a row');
    const cells = v.cells();
    assert.equal(cells.length, 4 * 9);
    assert.equal(cells.filter((c) => c === 'HQ only').length, 4);
    assert.equal(cells.filter((c) => c === 'Not granted').length, 0, 'a cell claimed a decision no store holds');
    assert.deepEqual([...new Set(s.seen.filter((p) => !p.startsWith('/api/ai')))], ['/api/admin/licences']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted HQ page: a failed ledger read says so, and an empty ledger says to issue a licence first', async () => {
  let s = stub(() => json({ detail: 'down' }, 503));
  let v = await render(h(ProgramGrants));
  try {
    assert.match(v.of('grants-unreadable'), /not the same as none/);
    assert.match(v.of('grants-tile-studios'), /Unreadable/);
  } finally { await v.unmount(); s.restore(); }
  s = stub(() => json({ items: [LICENCES.items[4]] }));
  v = await render(h(ProgramGrants));
  try { assert.match(v.of('grants-empty'), /No studio holds a licence yet/); } finally { await v.unmount(); s.restore(); }
});

test('the studio\'s Programs tab: HQ decides, nine programs, nothing "Not granted"', async () => {
  const v = await render(h(ProgramsTab), '/admin/my-licence/programs');
  try {
    assert.match(v.of('licence-programs-rule'), /HQ decides which programs your studio runs/);
    assert.match(v.of('licence-program-product-testing'), /Runs at HQ/);
    assert.match(v.of('licence-program-perks'), new RegExp(NOT_RECORDED_GRANT));
    assert.doesNotMatch(v.text(), /Not granted/);
  } finally { await v.unmount(); }
});

// ---------------------------------------------------------------- the source

test('the routes, the guard, the strip, the tab door and nothing that writes', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/licences/programs" element={guard(['admin'], hqOnly(<ProgramGrants />))} />`));
  assert.ok(app.includes(`<Route path="/admin/my-licence/programs" element={guard(['admin'], <MyLicencePage />)} />`));
  assert.match(app, /\{hqStrip === 'Licences' && \(\s*<HqSubNavStrip label="Licences">/);
  assert.ok(read('frontend/src/pages/subsidiary/LicenceFrame.jsx').includes('<Tab to="/admin/my-licence/programs" tab="programs">Programs</Tab>'));
  assert.ok(read('frontend/src/pages/subsidiary/MyLicencePage.jsx').includes("{tab === 'programs' && <ProgramsTab />}"));
  const page = read('frontend/src/pages/admin/grants/ProgramGrants.jsx');
  assert.doesNotMatch(page + read('frontend/src/pages/subsidiary/licence/ProgramsTab.jsx'), /method: ['"](POST|PUT|PATCH|DELETE)|api\.\w+\(\{|\.post\(/);
  assert.match(page, /export default function ProgramGrants\(\) \{\s*return \(\s*<AdminBoardFrame workspace="Licences"/);
});
