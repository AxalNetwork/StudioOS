/**
 * D997 (#2378) — Persona segments at /admin/persona-segments: the owner's
 * canvas (SEG1–SEG14) integrated under D936's header, out of the Admin
 * Console. Overview and Unclassified draw what the persona list and the
 * taxonomy carry, admins left out of every count, under Guard L.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/persona_segments_d997.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  BANDS, confidenceBands, howSet, members, movedNotices, scopeLine, searchMembers, segmentCards, segmentLabel, segmentsByProfile, tabOf, tiles, unclassified,
} from '../src/pages/admin/segments/segModel.js';
import PersonaSegments from '../src/pages/admin/segments/PersonaSegments.jsx';
import { legacyContractsTarget } from '../src/pages/admin/LegacyContractsRedirect.jsx';
import { stripFor } from '../src/lib/hqStrips.js';
import { PERSONAS } from '../src/lib/personas.js';

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

test('admins are left out of every count; the tiles are in a segment and no segment over members', () => {
  assert.equal(members(USERS).length, 10);
  assert.deepEqual(tiles(USERS), { members: 10, tagged: 6, untagged: 4, pct: 60 });
  assert.equal(tiles([]).pct, null, 'a percentage of nobody');
});

test('segments by profile: the member\'s role, a bar per segment, a hollow no-segment count, Other only when it holds someone', () => {
  const g = Object.fromEntries(segmentsByProfile(USERS).map((x) => [x.role || 'other', x]));
  assert.deepEqual(g.investor.bars.map((b) => [b.id, b.count]), [['angel_scout', 2], ['lp_individual', 1]]);
  assert.equal(g.investor.none, 1);
  assert.equal(g.advisor.bars.length, 0);
  assert.equal(g.advisor.none, 1);
  assert.equal(g.exploring.bars[0].id, 'founder_new');
  assert.equal(g.other.total, 1);
  assert.equal(segmentsByProfile(USERS.slice(0, 10)).some((x) => !x.role), false);
});

test('how segments were set, and confidence bands over sign-up suggestions where a missing confidence is not 0%', () => {
  const s = howSet(USERS);
  assert.deepEqual(s.rows.map((r) => [r.label, r.count]), [['Suggested at sign-up', 4], ['Chosen by the member', 1], ['Set by an admin', 0]]);
  assert.equal(s.other, 1);
  const b = confidenceBands(USERS);
  assert.equal(b.total, 4);
  assert.deepEqual(b.counts.map((c) => c.count), [1, 0, 1, 1]);
  assert.equal(b.unrecorded, 1, 'a null confidence was counted as under 50%');
  assert.equal(BANDS.length, 4);
});

test('the cards are the twelve segments with counts; an unknown stored id is shown as itself; Unclassified and search', () => {
  const cards = segmentCards(USERS);
  assert.equal(cards.length, PERSONAS.length);
  assert.equal(cards.find((c) => c.id === 'angel_scout').count, 2, 'the admin\'s tag was counted');
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

test('mounted Overview, as an Admin: one h1, the Accounts crumb and notice, the tiles, the charts, the waits, and today\'s re-tag table', async () => {
  const s = stub(() => json({ users: USERS }));
  const v = await render('/admin/persona-segments?moved=personas');
  try {
    assert.equal(v.h1s(), 1);
    assert.match(v.of('seg-header'), /Accounts.*Persona segments/s);
    assert.match(v.of('seg-header'), /Personas is now Persona segments, under Accounts\./);
    assert.match(v.of('seg-tab-unclassified'), /Unclassified\s*4/);
    assert.match(v.of('seg-tile-tagged'), /6.*of 10 members · 60%/s);
    assert.match(v.of('seg-tile-untagged'), /4/);
    for (const id of ['differ', 'moved30']) assert.match(v.of(`seg-tile-${id}`), /Not read here yet/);
    assert.match(v.of('seg-group-investor'), /Angel \/ Scout.*2.*No segment.*1/s);
    assert.match(v.of('seg-confidence-unrecorded'), /No confidence recorded for 1/);
    assert.match(v.of('seg-wait-needs'), /Not read here yet/);
    assert.match(v.of('seg-move-table'), /User Personas/, 'the re-tag table is unreachable');
    assert.equal(v.count('seg-scope-capped'), 0);
    assert.ok(!v.has('hq-board-persona-segments'), 'a plain admin got the HQ rail');
    assert.deepEqual([...new Set(s.seen.filter((p) => !p.startsWith('/api/ai')))], ['/api/personas/admin/list']);
  } finally { await v.unmount(); s.restore(); }
});

test('mounted Unclassified: members with no segment, profile chips, and a failed read that says so', async () => {
  let s = stub(() => json({ users: USERS }));
  let v = await render('/admin/persona-segments/unclassified');
  try {
    assert.match(v.of('seg-profile-chips'), /All\s*4.*Founders\s*1.*Investors\s*1.*Advisors\s*1.*Operating Partners\s*0.*Explorers\s*1/s);
    assert.equal(v.count('seg-unclassified-row'), 4);
    assert.match(v.of('seg-count'), /1–4 of 4/);
  } finally { await v.unmount(); s.restore(); }
  s = stub(() => json({ detail: 'down' }, 503));
  v = await render('/admin/persona-segments/unclassified');
  try {
    assert.match(v.of('seg-list-failed'), /not a claim that no one has a segment/);
    assert.ok(!v.has('seg-unclassified-none'));
  } finally { await v.unmount(); s.restore(); }
});

// ---------------------------------------------------------------- the source

test('the routes, the console mount gone, the doors, the strip, and the HQ rail around the page', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/admin/persona-segments" element={guard(['admin'], <PersonaSegments />)} />`));
  assert.ok(app.includes(`<Route path="/admin/persona-segments/unclassified" element={guard(['admin'], <PersonaSegments />)} />`));
  assert.ok(app.includes('<StripLink to="/admin/persona-segments">Persona segments</StripLink>'));
  const admin = read('frontend/src/pages/AdminPage.jsx');
  assert.ok(!admin.includes('<PersonasPanel'), 'the console still mounts the tab');
  assert.match(admin, /\{ value: 'personas',/, 'the tab left the section list');
  assert.ok(read('frontend/src/pages/admin/HeldAccounts.jsx').includes('<Link to="/admin/persona-segments"'));
  assert.ok(read('frontend/src/pages/hq/ContentPage.jsx').includes('<Link to="/admin/persona-segments"'));
  assert.match(read('frontend/src/sidebarConfig.js'), /'\/admin\/trash', '\/admin\/persona-segments'\]/);
  const page = read('frontend/src/pages/admin/segments/PersonaSegments.jsx');
  assert.match(page, /<AdminBoardFrame workspace="Personas"/);
  assert.ok(!/\b(alert|confirm)\(/.test(page), 'a browser pop-up on the page');
});
