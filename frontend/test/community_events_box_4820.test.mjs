/**
 * D4820 (#4820) part 4 — the Events lightbox (CM05): a summary strip and three
 * tabs (Events, Participation, By type), with events by type moved here from the
 * overview. The strip and both tabs are the Community read the overview already
 * holds, so they cannot disagree with it. Every record is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/community_events_box_4820.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { at, full } from './_community_overview_fixture.mjs';
import { COMMUNITY_PATH, buildEventsFunnel, buildTiles } from '../src/pages/admin/community/communityModel.js';
import { EVENTS_TABS, eventsSummary, typesWithEvents } from '../src/pages/admin/community/lightboxModel.js';
import AdminCommunity from '../src/pages/admin/community/AdminCommunity.jsx';

const h = React.createElement;
const ok = (data) => ({ status: 'ready', data });
const UNREAD = { available: false, unreadable: true, reason: 'This could not be read on this database. That is not the same as none.' };
const put = (answer, path, value) => {
  const o = structuredClone(answer);
  const keys = path.split('.');
  let n = o;
  for (const k of keys.slice(0, -1)) n = n[k];
  n[keys.at(-1)] = value;
  return o;
};
const community = (answer) => {
  const reads = { overview: ok(answer) };
  return { ev: buildEventsFunnel(reads), fig: Object.fromEntries(buildTiles(reads).map((t) => [t.key, t])) };
};
const strip = (answer) => Object.fromEntries(eventsSummary(community(answer)).map((s) => [s.key, [s.state, s.value ?? s.note ?? null]]));

// ---------------------------------------------------------------- the model

test('D4820 part 4: CM05\'s three tabs, the list first', () => {
  assert.deepEqual(EVENTS_TABS.map((t) => t.label), ['Events', 'Participation', 'By type']);
});

test('D4820 part 4: the strip is the overview\'s own figures', () => {
  // Mutation checked: Attended read from steps[1] (Confirmed) → '64' and this fails.
  assert.deepEqual(strip(full()), {
    upcoming: ['ready', '3'],
    registrations: ['ready', '60'],
    confirmed: ['ready', '64'],
    attended: ['ready', '52'],
    'show-up': ['ready', '65%'],
    waitlisted: ['ready', '9'],
  });
  const items = eventsSummary(community(full()));
  assert.equal(items.find((s) => s.key === 'attended').sub, '3 ended events');
  assert.equal(items.find((s) => s.key === 'waitlisted').sub, 'across 2 upcoming events');
});

test('D4820 part 4: a part that was not read is Unreadable or Reading…, never 0, and an older read\'s Confirmed is not recorded', () => {
  const noShowUp = strip(put(full(), 'blocks.events.show_up', UNREAD));
  // Mutation checked: `step` drawing a failed funnel as 0 → confirmed is ['ready', '0'] and this fails.
  assert.deepEqual([noShowUp.confirmed, noShowUp.attended, noShowUp['show-up']], [['unreadable', null], ['unreadable', null], ['unreadable', null]]);
  assert.deepEqual(noShowUp.registrations, ['ready', '60'], 'one failed block cost the others');
  assert.deepEqual(strip(put(full(), 'blocks.events.waitlisted', UNREAD)).waitlisted, ['unreadable', null]);
  const older = full();
  delete older.blocks.events.show_up.confirmed;
  assert.deepEqual(strip(older).confirmed, ['unrecorded', 'Not in this read']);
  assert.deepEqual(eventsSummary({}).map((s) => s.state), ['loading', 'loading', 'loading', 'loading', 'loading', 'loading']);
});

test('D4820 part 4: the By type tab counts the types that had an event, and none for a part not read', () => {
  assert.equal(typesWithEvents(community(full()).ev.byType), 2);
  assert.equal(typesWithEvents(community(put(full(), 'blocks.events.by_type', UNREAD)).ev.byType), null);
});

// ---------------------------------------------------------------- mounted

async function mount(answer) {
  const restore = installDocument();
  const original = globalThis.fetch;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname === '/api/admin/community/overview') return json(answer);
    if (u.pathname === '/api/admin/community/activity') return json({ rows: [], as_of: at(0) });
    if (u.pathname === '/api/admin/events') return json({ events: [], total: 0, limit: 25, offset: 0 });
    return json({});
  };
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(other) { for (let x = other; x; x = x.parentNode) if (x === this) return true; return false; };
    n.querySelector = () => null;
    n.querySelectorAll = () => [];
    return n;
  };
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [`${COMMUNITY_PATH}?weeks=4&open=events`] }, h(AdminCommunity))); });
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byTestId = (id) => walk(container).find((n) => props(n)?.['data-testid'] === id);
  const node = (id) => { const n = byTestId(id); assert.ok(n, `no ${id}`); return n; };
  return {
    has: (id) => Boolean(byTestId(id)),
    of: (id) => textOf(node(id)),
    props: (id) => props(node(id)),
    active: () => props(document.activeElement)?.['data-testid'],
    async click(id) { await act(async () => { props(node(id)).onClick({ preventDefault() {} }); }); await settle(); },
    async key(id, key) { await act(async () => { props(node(id)).onKeyDown({ key, preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('mounted D4820 part 4: the lightbox opens on the list, with the strip, and each tab draws its own panel', async () => {
  const m = await mount(full());
  try {
    assert.match(m.of('community-box-events-summary-upcoming'), /Upcoming\s*3/);
    assert.match(m.of('community-box-events-summary-attended'), /Attended\s*52\s*3 ended events/);
    assert.equal(m.props('community-box-events-tab-list')['aria-selected'], true);
    assert.ok(m.has('community-box-events-panel-list'));
    assert.ok(!m.has('community-box-events-panel-by-type'));
    // The overview no longer draws events by type; the By type tab does, with the types that had none in one line.
    assert.match(m.of('community-box-events-tab-by-type'), /By type\s*2/);
    await m.click('community-box-events-tab-by-type');
    // Mutation checked: the By type panel without ByTypeParts → no community-by-type and this fails.
    assert.match(m.of('community-by-type'), /Workshop/);
    assert.equal(m.of('community-by-type-none'), '10 of the 12 types had no event.');
    assert.ok(!m.has('community-box-events-panel-list'), 'the list panel stayed under another tab');
    await m.click('community-box-events-tab-participation');
    assert.match(m.of('community-box-events-panel-participation'), /Registered/);
    assert.ok(m.has('community-funnel'));
  } finally { await m.unmount(); }
});

test('mounted D4820 part 4: the tabs move with the arrow keys, wrap, and take focus with them', async () => {
  const m = await mount(full());
  try {
    await m.key('community-box-events-tabs', 'ArrowRight');
    assert.equal(m.props('community-box-events-tab-participation')['aria-selected'], true);
    assert.equal(m.active(), 'community-box-events-tab-participation');
    await m.key('community-box-events-tabs', 'End');
    assert.equal(m.props('community-box-events-tab-by-type')['aria-selected'], true);
    // Mutation checked: no wrap on ArrowRight → it stays on By type and this fails.
    await m.key('community-box-events-tabs', 'ArrowRight');
    assert.equal(m.props('community-box-events-tab-list')['aria-selected'], true);
    assert.equal(m.props('community-box-events-tab-list').tabIndex, 0);
    assert.equal(m.props('community-box-events-tab-by-type').tabIndex, -1, 'a tab not chosen is still in the tab order');
  } finally { await m.unmount(); }
});
