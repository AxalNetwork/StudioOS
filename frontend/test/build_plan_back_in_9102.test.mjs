/**
 * D9102 (#9102) — Back in's "Link to a plan item…" (VB9's fourth row): the
 * GitHub items that came back with no plan marker, from `GET /plan/fed`, each
 * linked by hand to one accepted plan item through D1068's
 * `POST /items/:uid/link`.
 *
 * Mounted against the Worker's own shapes through a stubbed fetch. Every
 * venture, item and title is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_back_in_9102.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import BuildPlan from '../src/pages/cycles/BuildPlan.jsx';
import { NO_PICKABLE, UNMARKED_UNREAD, linkedLine, pickGroups, unmarkedMore, unmarkedRows } from '../src/pages/cycles/buildProgressModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const MUST = '11111111-1111-4111-8111-111111111111';
const FEAT = '22222222-2222-4222-8222-222222222222';
const ROAD = '44444444-4444-4444-8444-444444444444';
const DOOR = '55555555-5555-4555-8555-555555555555';
const WAIT = '66666666-6666-4666-8666-666666666666';
const LINK_WAIT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accepted = (uid, kind, title, extra = {}) => ({ uid, kind, status: 'accepted', payload: { title }, evidence: [], decided_at: '2026-10-12 15:00:00', landed_table: extra.table ?? 'mvp_features', landed_id: extra.id ?? '5', marker: `VB-${uid.slice(0, 4).toUpperCase()}` });
const LONG = 'A very long feature title that keeps going well past the width of a phone so that it has to wrap onto more lines';

const PLAN = (accept = true) => ({
  plan: { uid: 'plan-uid', scope: 'venture', status: 'open', prepared_at: '2026-10-12 14:05:00' },
  verdict: { id: 9, decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 6 },
  brief: null,
  modules: {
    'solution-design': [
      ...(accept ? [accepted(FEAT, 'feature', LONG, { id: '6' })] : []),
      { uid: WAIT, kind: 'feature', status: 'proposed', payload: { title: 'Driver app' }, evidence: [] },
    ],
    'prototype-mvp': accept ? [accepted(MUST, 'must-have', 'One-day setup wizard')] : [],
    'product-roadmap': accept ? [accepted(ROAD, 'roadmap', 'Carrier integrations', { table: 'roadmap_okrs', id: '9' })] : [],
    'company-creation': [],
    'operating-systems': accept ? [accepted(DOOR, 'connect-door', 'Connect GitHub', { table: null, id: null })] : [],
    'founding-team': [],
  },
});
const PROPOSED = { uid: LINK_WAIT, status: 'proposed', provider: 'github', fed: 'issue:northwind/app#9', fed_kind: 'issue', title: 'Live ETA panel', plan_item_uid: FEAT, marker: 'VB-2222', decided_at: null };
const UNMARKED = {
  items: [
    { fed: 'pull:northwind/app#15', fed_kind: 'pull_request', title: 'Fix exports', local_table: 'mvp_features', local_id: '12', first_seen_at: '2026-11-01 09:00:00', last_seen_at: '2026-11-25 10:00:00' },
    { fed: 'issue:northwind/app#9', fed_kind: 'issue', title: null, local_table: null, local_id: null, first_seen_at: '2026-11-02 09:00:00', last_seen_at: '2026-11-22 10:00:00' },
  ],
  total: 2,
};

function handler({ plan = PLAN(), links = [], unmarked = () => response(UNMARKED), link = () => response({ status: 'accepted', by: 'hand' }) } = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    if (/\/cycles\/build\/plan\/fed\?/.test(url)) return unmarked(url, options);
    if (/\/cycles\/build\/plan\/items\/[^/]+\/link$/.test(url) && method === 'POST') return link(url, options);
    if (/\/cycles\/build\/plan\/handoffs\?/.test(url)) return response({ handoffs: [] });
    if (/\/cycles\/build\/plan\/links\?/.test(url)) return response({ links });
    if (/\/cycles\/build\/plan\/states\?/.test(url)) return response({ states: [], total: 0 });
    if (/\/cycles\/build\/plan\/word\?/.test(url) && method === 'GET') return response({ wording: null });
    if (/\/cycles\/build\/plan\/since\?/.test(url)) return response({ plan: 'plan-uid', status: 'open', changed: false, new: 0, contradicting: 0 });
    if (/\/cycles\/build\/plan\?/.test(url) && method === 'GET') return response(plan);
    if (/\/connectors$/.test(url)) return response({ ok: true, items: [] });
    if (url.includes('/ai/me/spend')) return response({ recorded: true, by_task_recorded: true, by_task: [] });
    return response({});
  };
}

async function mounted({ handle = handler(), props = {}, phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(BuildPlan, { tab: 'progress', projectId: 3, search: '?project_id=3', cards: [], role: 'founder', phone, ...props }))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props_(n)['data-testid'] === id);
  return {
    requests, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    texts: (id) => all(id).map(text), count: (id) => all(id).length, propsAll: (id) => all(id).map(props_),
    order: (ids) => nodes().map((n) => props_(n)['data-testid']).filter((t) => ids.includes(t)),
    click: async (id, i = 0) => { const n = all(id)[i]; assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value: props_(n).value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');
const reads = (r, re) => r.requests.filter((q) => q.method === 'GET' && re.test(q.url)).length;

// ---------------------------------------------------------------- the model

test('the model: the row line with and without a title, the picker’s groups by the sendable rule, the foot and the failed-read sentence', () => {
  assert.deepEqual(unmarkedRows(UNMARKED).map((r) => [r.fed, r.source, r.line]), [
    ['pull:northwind/app#15', 'Connector · GitHub', 'Pull request #15 ‘Fix exports’ · no plan marker.'],
    ['issue:northwind/app#9', 'Connector · GitHub', 'Issue #9 · no plan marker.'],
  ]);
  assert.deepEqual(unmarkedRows(null), []);
  assert.deepEqual(pickGroups(PLAN()).map((g) => [g.label, g.items.map((i) => [i.uid, i.kindWord])]), [
    ['Solution design', [[FEAT, 'Feature']]],
    ['Prototype / MVP', [[MUST, 'Must-have']]],
    ['Product roadmap', [[ROAD, 'Roadmap item']]],
  ], 'accepted and landed only: never a proposal or a door');
  assert.deepEqual(pickGroups(PLAN(false)), []);
  assert.equal(linkedLine({ kindWord: 'Must-have', title: 'One-day setup wizard' }), 'Linked to must-have One-day setup wizard.');
  assert.equal(unmarkedMore({ items: UNMARKED.items, total: 2 }), null);
  assert.equal(unmarkedMore({ items: UNMARKED.items, total: 250 }), 'Showing the newest 2 of 250.');
  assert.equal(UNMARKED_UNREAD, 'GitHub items without a marker could not be read. This is not a claim that none arrived.');
});

// ---------------------------------------------------------------- mounted

test('mounted: unmarked items alone open the door, counted; their rows follow the proposals, with no Not this one; opening writes nothing', async () => {
  const r = await mounted();
  try {
    assert.match(r.textOf('plan-back-in-door'), /Arrived from your tools · 2\. Nothing is linked until you press Link\./);
    await r.click('plan-back-in-open');
    assert.match(r.textOf('plan-back-in'), /Arrived from your tools · 2/);
    assert.deepEqual(r.texts('plan-back-in-unmarked-line'), ['Pull request #15 ‘Fix exports’ · no plan marker.', 'Issue #9 · no plan marker.']);
    assert.deepEqual(r.texts('plan-back-in-pick-open'), ['Link to a plan item…', 'Link to a plan item…']);
    assert.ok(!r.has('plan-back-in-dismiss'), 'an unmarked row offers no Not this one');
    await r.click('plan-back-in-pick-open');
    assert.ok(r.has('plan-back-in-picker'));
    assert.deepEqual(r.propsAll(`plan-back-in-pick-${FEAT}`).concat(r.propsAll(`plan-back-in-pick-${MUST}`), r.propsAll(`plan-back-in-pick-${ROAD}`)).map((p) => p.checked), [false, false, false], 'nothing is chosen');
    assert.ok(!r.has(`plan-back-in-pick-${DOOR}`) && !r.has(`plan-back-in-pick-${WAIT}`), 'never a door or a proposal');
    assert.equal(r.props('plan-back-in-pick-link').disabled, true, 'Link waits for a pick');
    assert.deepEqual(writes(r), [], 'opening the drawer and the picker writes nothing');
    await r.click('plan-back-in-pick-cancel');
    assert.ok(!r.has('plan-back-in-picker'), 'Cancel closes the list');
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }

  const both = await mounted({ handle: handler({ links: [PROPOSED] }) });
  try {
    assert.match(both.textOf('plan-back-in-door'), /Arrived from your tools · 3\./, 'the proposals and the unmarked items, added');
    await both.click('plan-back-in-open');
    assert.deepEqual(both.order(['plan-back-in-row', 'plan-back-in-unmarked']), ['plan-back-in-row', 'plan-back-in-unmarked', 'plan-back-in-unmarked'], 'after the proposals');
  } finally { await both.close(); }

  const none = await mounted({ handle: handler({ unmarked: () => response({ items: [], total: 0 }) }) });
  try { assert.ok(!none.has('plan-back-in-door'), 'no unmarked items and no proposals: no door'); } finally { await none.close(); }
});

test('mounted: Link sends the picked item’s uid and the row’s fed, the row says Linked, and Progress reads again', async () => {
  // After the link, the Worker leaves the item out of the read, as `listUnmarked` does.
  let done = false;
  const r = await mounted({ handle: handler({
    unmarked: () => response(done ? { items: UNMARKED.items.slice(1), total: 1 } : UNMARKED),
    link: () => { done = true; return response({ status: 'accepted', by: 'hand' }); },
  }) });
  try {
    await r.click('plan-back-in-open');
    const before = reads(r, /\/cycles\/build\/plan\?/);
    await r.click('plan-back-in-pick-open');
    await r.change(`plan-back-in-pick-${MUST}`);
    assert.equal(r.props(`plan-back-in-pick-${MUST}`).checked, true);
    await r.click('plan-back-in-pick-link');
    assert.deepEqual(writes(r).map((w) => [w.method, w.url, w.body]), [['POST', `/api/cycles/build/plan/items/${MUST}/link`, { fed: 'pull:northwind/app#15' }]]);
    assert.equal(r.textOf('plan-back-in-linked'), 'Linked to must-have One-day setup wizard.');
    assert.ok(!r.has('plan-back-in-picker'));
    assert.ok(reads(r, /\/cycles\/build\/plan\?/) > before, 'Progress reloads');
    assert.ok(reads(r, /\/cycles\/build\/plan\/fed\?/) >= 2, 'and the unmarked list with it');
    assert.deepEqual(r.texts('plan-back-in-unmarked-line'), ['Issue #9 · no plan marker.', 'Pull request #15 ‘Fix exports’ · no plan marker.'], 'the linked row keeps its line');
    assert.equal(r.textOf('plan-back-in-door').includes('· 1.'), true, 'the door counts what is left');
  } finally { await r.close(); }
});

test('mounted: a refusal stays on its row in the Worker’s own sentence, and the picker stays open', async () => {
  const r = await mounted({ handle: handler({ link: () => response({ error: 'already_linked', code: 'already_linked', message: 'This GitHub item is already linked or waiting for your decision.' }, 409) }) });
  try {
    await r.click('plan-back-in-open');
    await r.click('plan-back-in-pick-open', 1);
    await r.change(`plan-back-in-pick-${ROAD}`);
    await r.click('plan-back-in-pick-link');
    assert.deepEqual(writes(r).map((w) => w.body), [{ fed: 'issue:northwind/app#9' }]);
    assert.equal(r.textOf('plan-back-in-pick-refused'), 'This GitHub item is already linked or waiting for your decision.');
    assert.ok(r.has('plan-back-in-picker'), 'the picker stays open');
    assert.ok(!r.has('plan-back-in-linked'));
  } finally { await r.close(); }
});

test('mounted: with no accepted items the picker says so and offers no Link', async () => {
  const r = await mounted({ handle: handler({ plan: PLAN(false) }) });
  try {
    await r.click('plan-back-in-open');
    await r.click('plan-back-in-pick-open');
    assert.equal(r.textOf('plan-back-in-pick-none'), NO_PICKABLE);
    assert.ok(!r.has('plan-back-in-pick-link'));
    assert.ok(r.has('plan-back-in-pick-cancel'));
  } finally { await r.close(); }
});

test('mounted: a failed unmarked read says so, never "none arrived", and never blanks Progress', async () => {
  const fail = () => response({ code: 'unreadable', detail: 'The build plan could not be read or saved. Try again.' }, 503);
  const r = await mounted({ handle: handler({ links: [PROPOSED], unmarked: fail }) });
  try {
    assert.ok(r.has('plan-progress'), 'Progress still draws');
    assert.match(r.textOf('plan-back-in-door'), /Arrived from your tools · 1\./);
    await r.click('plan-back-in-open');
    assert.match(r.textOf('plan-back-in-unmarked-unread'), /GitHub items without a marker could not be read\. This is not a claim that none arrived\./);
    assert.equal(r.count('plan-back-in-unmarked'), 0);
  } finally { await r.close(); }
  const alone = await mounted({ handle: handler({ unmarked: fail }) });
  try {
    assert.ok(!alone.has('plan-back-in-door'));
    assert.match(alone.all(), /GitHub items without a marker could not be read\. This is not a claim that none arrived\./, 'with no door, Progress says it');
  } finally { await alone.close(); }
});

test('mounted: the foot says when more than 200 exist; loading reads "Reading…"', async () => {
  const r = await mounted({ handle: handler({ unmarked: () => response({ ...UNMARKED, total: 250 }) }) });
  try {
    await r.click('plan-back-in-open');
    assert.equal(r.textOf('plan-back-in-more'), ' Showing the newest 2 of 250.');
  } finally { await r.close(); }
  let release;
  const slow = await mounted({ handle: handler({ links: [PROPOSED], unmarked: () => new Promise((res) => { release = () => res(response(UNMARKED)); }) }) });
  try {
    await slow.click('plan-back-in-open');
    assert.equal(slow.textOf('plan-back-in-unmarked-loading'), 'Reading…');
    release();
    await slow.flush();
    assert.ok(!slow.has('plan-back-in-unmarked-loading'));
    assert.equal(slow.count('plan-back-in-unmarked'), 2);
  } finally { await slow.close(); }
});

test('mounted: an admin and an Operating Partner never read the unmarked list', async () => {
  for (const role of ['admin', 'partner']) {
    const r = await mounted({ props: { role } });
    try {
      assert.ok(r.has('plan-progress'), role);
      assert.equal(reads(r, /\/cycles\/build\/plan\/fed/), 0, `${role}: no unmarked read`);
      assert.ok(!r.has('plan-back-in-door'), role);
    } finally { await r.close(); }
  }
  const founder = await mounted();
  try { assert.equal(reads(founder, /\/cycles\/build\/plan\/fed\?project=3&scope=venture$/), 1); } finally { await founder.close(); }
});

test('mounted 390: the door, the row and the picker buttons are at least 44px; long titles wrap', async () => {
  const r = await mounted({ phone: true });
  try {
    assert.match(r.props('plan-back-in-open').className, /!min-h-\[44px\]/);
    await r.click('plan-back-in-open');
    assert.match(r.props('plan-back-in-pick-open').className, /!min-h-\[44px\]/);
    await r.click('plan-back-in-pick-open');
    for (const id of ['plan-back-in-pick-link', 'plan-back-in-pick-cancel']) assert.match(r.props(id).className, /!min-h-\[44px\]/, id);
    assert.match(r.textOf('plan-back-in-picker'), new RegExp(LONG));
    assert.match(r.props('plan-back-in-unmarked-line').className, /\[overflow-wrap:anywhere\]/);
  } finally { await r.close(); }
});
