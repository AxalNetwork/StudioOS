/**
 * D997 (#2378) — Persona segments at /admin/persona-segments: the owner's
 * canvas (SEG1–SEG14) integrated under D936's header, out of the Admin
 * Console. Overview and Unclassified draw what the persona list and the
 * taxonomy carry, admins left out of every count, under Guard L.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_segments_d997.test.mjs
 */
import test from 'node:test';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  BANDS, members, movedNotices, scopeLine, searchMembers, segmentLabel, tabOf, unclassified,
} from '../src/pages/admin/segments/segModel.js';
import PersonaSegments from '../src/pages/admin/segments/PersonaSegments.jsx';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';
import { stripFor } from '../src/lib/hqStrips.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const U = (user_id, role, persona_id = null, extra = {}) => ({ user_id, email: `u${user_id}@example.com`, name: `Member ${user_id}`, role, persona_id, ...extra });
const USERS = [
  U(1, 'admin', 'angel_scout', { source: 'admin_retag' }),
  U(2, 'investor', 'angel_scout', { source: 'router', confidence: 0.92 }),
  U(3, 'investor', 'angel_scout', { source: 'router', confidence: 0.45 }),
  U(4, 'investor', 'lp_individual', { source: 'self_select', confidence: 0 }),
  U(5, 'investor'),
  U(6, 'founder', 'founder_new', { source: 'router', confidence: null }),
  U(7, 'founder'),
  U(8, 'advisor'),
  U(9, 'exploring', 'founder_new', { source: 'router', confidence: 0.7 }),
  U(10, 'exploring'),
  U(11, null, 'press_analyst', { source: 'weird' }),
];

// ---------------------------------------------------------------- the model

test('the addresses, the redirect, the strip and the two moved notices', () => {
  assert.equal(tabOf('/admin/persona-segments'), 'overview');
  assert.equal(tabOf('/admin/persona-segments/unclassified/'), 'unclassified');
  assert.equal(tabOf('/admin/persona-segments/angel_scout'), null, 'a segment\'s page waits for its part');
  assert.equal(legacyContractsTarget('?tab=personas'), '/admin/persona-segments?moved=personas');
  assert.equal(stripFor('/admin/persona-segments'), 'Content');
  assert.equal(movedNotices(false).personas, 'Personas is now Persona segments, under Accounts.');
  assert.equal(movedNotices(true).personas, 'Personas is now Persona segments, under Content.');
});

// D1004 (#2819): Overview's tiles, charts and cards count from D999's segment read, so the
// list-based tiles, segments by profile, how set, bands and cards left this model; they are
// tested on D999's blocks in persona_segments_overview_d1004.
test('admins are left out; an unknown stored id is shown as itself; Unclassified and search', () => {
  assert.equal(members(USERS).length, 10);
  assert.equal(BANDS.length, 4);
  assert.match(segmentLabel('retired_one'), /not in the taxonomy/);
  const u = unclassified(USERS);
  assert.deepEqual(u.rows.map((r) => r.user_id), [5, 7, 8, 10]);
  assert.deepEqual(u.byProfile.map((p) => p.count), [1, 1, 1, 0, 1]);
  assert.equal(searchMembers(u.rows, 'z').length, 4, 'one character filtered');
  assert.deepEqual(searchMembers(u.rows, 'u8@').map((r) => r.user_id), [8]);
});

test('Guard L: a list at its cap of 500 says it covers the newest 500', () => {
  assert.equal(scopeLine(USERS), null);
  const many = Array.from({ length: 500 }, (_, i) => U(i, 'founder'));
  assert.match(scopeLine(many), /newest 500 accounts/);
});

// ---------------------------------------------------------------- the page, mounted

async function render(url) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] },
      h(Routes, null,
        h(Route, { path: '/admin/persona-segments', element: h(PersonaSegments) }),
        h(Route, { path: '/admin/persona-segments/unclassified', element: h(PersonaSegments) }))));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  return {
    of: (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    has: (id) => Boolean(byTestId(id)),
    count: (id) => walk(container).filter((n) => props(n)?.['data-testid'] === id).length,
    h1s: () => walk(container).filter((n) => n.tagName === 'H1').length,
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function stub(list) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    seen.push(u.pathname);
    if (u.pathname === '/api/personas/admin/list') return list();
    return json({});
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('mounted Overview, as an Admin: one h1, the Accounts crumb and notice, and no re-tag table (D1004 draws the counts)', async () => {
  // D1004 (#2819): Overview's tiles, charts and cards read D999's segment counts and D1000's
  // profiles, tested in persona_segments_overview_d1004. D1005 (#2820) retired the re-tag
  // table: a member moves from their segment's Members tab, by the Move dialog.
  const s = stub(() => json({ users: USERS }));
  const v = await render('/admin/persona-segments?moved=personas');
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('seg-header'), /Accounts.*Persona segments/s);
    assert.match(v.of('seg-header'), /Personas is now Persona segments, under Accounts\./);
    assert.ok(!v.has('seg-move-table'), 'the retired re-tag table is still on Overview');
    assert.equal(v.count('seg-scope-capped'), 0, 'Overview is not under Guard L');
    assert.ok(!v.has('hq-board-persona-segments'), 'a plain admin got the HQ rail');
    assert.ok(s.seen.includes('/api/personas/admin/segments'), 'Overview reads the segment counts');
  } finally { await v.unmount(); s.restore(); }
});

// D1006 (#2821): Unclassified reads D1002's members with no segment, with why and ask to
// finish, not the persona list; persona_segments_d1006.test.mjs mounts it.

// ---------------------------------------------------------------- the source

test('the routes, the console mount gone, the doors, the strip, and the HQ rail around the page', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/persona-segments" element={guard(['admin'], <PersonaSegments />)} />`));
  assert.ok(app.includes(`<Route path="/admin/persona-segments/unclassified" element={guard(['admin'], <PersonaSegments />)} />`));
  assert.ok(app.includes('<StripLink to="/admin/persona-segments">Persona segments</StripLink>'));
  const admin = read('frontend/src/pages/admin/ConsolePages.jsx');
  assert.ok(!admin.includes('<PersonasPanel'), 'the console still mounts the tab');
  assert.ok(read('frontend/src/pages/admin/HeldAccounts.jsx').includes('<Link to="/admin/persona-segments"'));
  assert.ok(read('frontend/src/pages/hq/ContentPage.jsx').includes('<Link to="/admin/persona-segments"'));
  assert.ok(SIDEBAR_GROUPS.admin.flatMap((g) => g.items).find((r) => r.label === 'Accounts').match.includes('/admin/persona-segments'));
  const page = read('frontend/src/pages/admin/segments/PersonaSegments.jsx');
  assert.match(page, /<AdminBoardFrame workspace="Personas"/);
  assert.ok(!/\b(alert|confirm)\(/.test(page), 'a browser pop-up on the page');
});
