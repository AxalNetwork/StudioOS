/**
 * #8776 (D8776, BLR00 to BLR07) — Build › Product roadmap's shortcut names the page it opens, and that page
 * (`/build/roadmap`, Quarters, dependencies and scenarios) keeps the venture, explains how an item's horizon
 * and quarter relate, opens By quarter on the exact item it came from, offers one first action at zero items,
 * and Back returns to where the founder left.
 *
 *   1. the pure rules: views, the phone column, `?item=`, the venture picked or refused, By quarter's order,
 *      every href keeping the venture, and where Back goes (a foreign `from` is never followed);
 *   2. the board: the link's words and explainer, its href, the address it hands over; `?view=` / `?column=`
 *      / `?item=` drawn and written back; focus on the link after Back, on the card for `?item=`;
 *   3. the landing: h1 equal to the link, Back to Product roadmap (to the board as left), the relation card,
 *      By quarter with No quarter recorded, the linked item highlighted and focused with Back naming it;
 *   4. the landing's zero items (one action, never `/execution`), a reader (no edit), a project in the link
 *      that is not the reader's (said, not silently swapped), and a failed read (Unavailable, not 0).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/roadmap_shortcut_8776.test.mjs
 *
 * Every venture, item and person here is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { textOf, propsOf } from './_form_d695.mjs';
import RoadmapBoard from '../src/pages/cycles/RoadmapBoard.jsx';
import FounderBuildRoadmap from '../src/pages/founder/FounderBuildRoadmap.jsx';
import { api } from '../src/lib/api.js';
import {
  DOOR, addFirstHref, boardColumn, boardHref, doorHref, dueText, horizonOf, itemParam, itemSheetHref, landingBack,
  landingView, pickProject, quarterGroups, quarterRange,
} from '../src/pages/cycles/roadmapShortcut.js';

const h = React.createElement;

/** Mounts `element` at `entry` (a path, or `{ pathname, search, state }`) with focus tracked and the location read back. */
async function mount(element, entry) {
  const restore = installDocument('', { focus: true });
  const seen = { location: null };
  const Probe = () => { seen.location = useLocation(); return null; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [entry] }, element, h(Probe))); });
  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const by = (id) => nodes().find((n) => propsOf(n)['data-testid'] === id);
  return {
    seen, nodes, by, text: () => textOf(container), doc: document,
    async flush() { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); },
    async choose(name, value) {
      const node = nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).name === name && propsOf(n).value === value);
      assert.ok(node, `${name}: ${value}`);
      await act(async () => propsOf(node).onChange({ target: { value } }));
    },
    /** Follows a link as a plain click does, so the history state it carries can be read back. */
    async follow(id) {
      const ev = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      await act(async () => propsOf(by(id)).onClick(ev));
      return seen.location;
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

// ── 1. the pure rules ────────────────────────────────────────────────────────

test('1. views, column, item, the venture, By quarter and every href keep the venture', () => {
  // Mutation checked: the retired `board` accepted as a landing view → 'board'; a refused id dropped → refused null;
  // quarters sorted as text → Q1 2027 after Q4 2026 fails; a foreign `from` followed → the Back href leaves Build.
  assert.deepEqual(['dependencies', 'scenarios', 'board', 'timeline', null, 'x'].map(landingView), ['dependencies', 'scenarios', 'quarters', 'quarters', 'quarters', 'quarters']);
  assert.deepEqual([boardColumn('later'), boardColumn(null, 'next'), boardColumn('nope', 'nope'), boardColumn('done', 'next')], ['later', 'next', 'now', 'done']);
  assert.deepEqual(['57', '0', '-3', '5x', null, '1e3'].map(itemParam), [57, null, null, null, null, null]);
  assert.deepEqual(['now', ' Next ', 'LATER', 'done', 'archived', null].map(horizonOf), ['Now', 'Next', 'Later', 'Done', null, null]);

  const ventures = [{ id: 412, name: '[Atlas Orchard]' }, { id: 413, name: '[Second venture]' }];
  assert.deepEqual(pickProject(ventures, '413'), { chosen: ventures[1], refused: null });
  assert.deepEqual(pickProject(ventures, '999'), { chosen: ventures[0], refused: '999' }, 'a project not the reader\'s is said');
  assert.deepEqual(pickProject(ventures, null), { chosen: ventures[0], refused: null });
  assert.deepEqual(pickProject([], '412'), { chosen: null, refused: '412' });

  const items = [
    { id: 58, objective: '[Yield forecast]', quarter: null },
    { id: 57, objective: '[Harvest log]', quarter: 'Q1 2027' },
    { id: 60, objective: '[Odd]', quarter: 'Spring' },
    { id: 55, objective: '[Block map]', quarter: 'Q4 2026' },
    { id: 59, objective: '[Second in Q1]', quarter: 'Q1 2027' },
    { id: 61, objective: '[Blank]', quarter: '   ' },
  ];
  const g = quarterGroups(items);
  assert.deepEqual(g.quarters.map((q) => [q.label, q.range, q.items.map((i) => i.id)]),
    [['Q4 2026', 'Oct – Dec 2026', [55]], ['Q1 2027', 'Jan – Mar 2027', [57, 59]], ['Spring', null, [60]]]);
  assert.deepEqual(g.none.map((i) => i.id), [58, 61], 'No quarter recorded is its own group, blank counting as none');
  assert.equal(quarterRange('Q3 2027'), 'Jul – Sep 2027');

  assert.equal(doorHref(412), '/build/roadmap?project_id=412&view=quarters');
  assert.equal(doorHref(412, 57), '/build/roadmap?project_id=412&view=quarters&item=57');
  assert.equal(itemSheetHref(412, 57), '/build/product-roadmap/57?project_id=412');
  assert.equal(addFirstHref(412), '/build/product-roadmap?project_id=412&add=1');
  assert.equal(boardHref(412, 'timeline', 'next'), '/build/product-roadmap?project_id=412&view=timeline&column=next');
  assert.deepEqual([dueText('2027-02-26'), dueText(null), dueText('soon')], ['due 26 Feb 2027', 'No date', 'due soon']);

  assert.deepEqual(landingBack({ projectId: 412, item: { id: 57, objective: '[Harvest log]' } }),
    { href: '/build/product-roadmap/57?project_id=412', label: 'Back to [Harvest log]', focus: null });
  const kept = '/build/product-roadmap?project_id=412&view=timeline&column=next';
  assert.deepEqual(landingBack({ projectId: 412, from: kept }), { href: kept, label: 'Back to Product roadmap', focus: 'door' });
  for (const foreign of ['https://evil.example/x', '//evil.example', '/build/product-roadmap/../../admin', '/admin?x=1']) {
    assert.equal(landingBack({ projectId: 412, from: foreign }).href, '/build/product-roadmap?project_id=412', foreign);
  }
});

// ── 2. the board ─────────────────────────────────────────────────────────────

const row = (id, item, column) => ({ id, cells: { item, owner: null, date: null, moves: null }, keys: { state: 'provisional', late: 'no', link: 'linked', blocks: 0, waits_on: null, column } });
const MODULE = {
  facts: { items: 3, shipped_this_month: 0, now: 1, next: 1, later: 1, done: 0, late: 0, unlinked: 0 },
  records: { rows: [row(55, '[Block map]', 'now'), row(57, '[Harvest log]', 'next'), row(58, '[Yield forecast]', 'later')], total: 3, page: 1, page_size: 25 },
};
const board = (search = '?project_id=412') => h(RoadmapBoard, { module: MODULE, query: { filter: {} }, onQuery() {}, search });

test('2. the board names the page its link opens, and keeps its view, column and card in the address', async () => {
  // Mutation checked: the old label → the words differ; the view kept in component state → `?view=` stays absent;
  // the handed-over address dropped → `roadmapFrom` undefined; the focus effect removed → activeElement is not the link.
  const ui = await mount(board(), '/build/product-roadmap?project_id=412');
  try {
    const door = ui.by('roadmap-dependencies-link');
    assert.equal(textOf(door), `${DOOR}›`);
    assert.doesNotMatch(ui.text(), /Now, Next and Later/, 'the shortcut never claims the view it sits on');
    assert.equal(propsOf(door).href, '/build/roadmap?project_id=412&view=quarters');
    assert.equal(textOf(ui.by('roadmap-door-explainer')), 'The same 3 items placed by quarter, with what waits on what and saved what-ifs.');
    await ui.choose('roadmap-phone-column', 'later');
    assert.equal(new URLSearchParams(ui.seen.location.search).get('column'), 'later');
    await ui.choose('roadmap-view', 'timeline');
    assert.equal(new URLSearchParams(ui.seen.location.search).get('view'), 'timeline');
    assert.equal(new URLSearchParams(ui.seen.location.search).get('project_id'), '412', 'the venture stays');
    const landed = await ui.follow('roadmap-dependencies-link');
    assert.equal(`${landed.pathname}${landed.search}`, '/build/roadmap?project_id=412&view=quarters');
    assert.equal(landed.state.roadmapFrom, '/build/product-roadmap?project_id=412&view=timeline&column=later', 'the board hands over its address');
  } finally { await ui.unmount(); }

  // Back from the landing: the address restores Timeline and the column, and focus is on the link that left.
  const back = await mount(board(), { pathname: '/build/product-roadmap', search: '?project_id=412&view=timeline&column=later', state: { roadmapFocus: 'door' } });
  try {
    assert.ok(back.by('roadmap-timeline'), 'Timeline came back from the address');
    assert.equal(back.doc.activeElement, back.by('roadmap-dependencies-link'));
  } finally { await back.unmount(); }

  // `?item=` opens the phone column holding the item, with focus on its card.
  const item = await mount(board(), '/build/product-roadmap?project_id=412&item=57');
  try {
    const cls = (id) => String(propsOf(item.by(id)).className);
    assert.match(cls('roadmap-column-next'), /(^| )flex( |$)/);
    assert.match(cls('roadmap-column-now'), /(^| )hidden( |$)/);
    assert.equal(item.doc.activeElement, item.by('roadmap-card-link-57'));
  } finally { await item.unmount(); }
});

// ── 3. and 4. the landing ────────────────────────────────────────────────────

const ITEMS = [
  { id: 55, objective: '[Block map]', quarter: 'Q4 2026', kanban_status: 'now', sort_order: 0, target_date: '2026-12-18', owner: '[Maya Ruiz]', state: 'in_flight', state_label: 'In flight', blocks: [{ id: 1, okr_id: 57, objective: '[Harvest log]' }], blocked_by: [] },
  { id: 57, objective: '[Harvest log]', quarter: 'Q1 2027', kanban_status: 'next', sort_order: 1, target_date: '2027-02-26', owner: '[Noah Brandt]', state: 'blocked', state_label: 'Blocked', blocks: [], blocked_by: [{ id: 1, okr_id: 55, objective: '[Block map]' }] },
  { id: 58, objective: '[Yield forecast]', quarter: null, kanban_status: 'later', sort_order: 2, target_date: null, owner: null, state: 'provisional', state_label: 'Provisional', blocks: [], blocked_by: [] },
];
const GRAPH = (over = {}) => ({
  project: { id: 412, name: '[Atlas Orchard]' }, items: ITEMS, dependencies: [], scenarios: [],
  stats: { items: 3, quarters: 2, dependencies: 1, unresolved: 1, blocked: 1, scenarios: 0 }, store_ready: true, can_write: true, ...over,
});

async function landing(entry, { graph = GRAPH(), projects = [{ id: 412, name: '[Atlas Orchard]' }], fail = null } = {}) {
  const original = { ...api };
  const asked = [];
  api.listProjects = async () => projects;
  api.roadmapGraph = async (id) => { asked.push(id); if (fail) throw new Error(fail); return graph; };
  const ui = await mount(h(FounderBuildRoadmap), entry);
  await ui.flush();
  return { ...ui, asked, async close() { await ui.unmount(); Object.assign(api, original); } };
}

test('3. the landing: h1 is the link, Back returns as left, the relation is said, By quarter opens', async () => {
  // Mutation checked: the old h1 "Roadmap" → the heading differs; the crumb to /build as Back → the Back href drops
  // Product roadmap; useState('timeline') kept → no By quarter card; No quarter recorded folded into a quarter → its
  // group is missing; focus left on <body> → activeElement is not the h1.
  const from = '/build/product-roadmap?project_id=412&view=timeline&column=later';
  const ui = await landing({ pathname: '/build/roadmap', search: '?project_id=412&view=quarters', state: { roadmapFrom: from } });
  try {
    assert.equal(textOf(ui.by('text-roadmap-heading')), DOOR);
    assert.equal(ui.doc.activeElement, ui.by('text-roadmap-heading'), 'arriving, focus is on the h1');
    const back = ui.by('link-roadmap-back');
    assert.match(textOf(back), /Back to Product roadmap/);
    assert.equal(propsOf(back).href, from, 'Back returns to the board as it was left');
    assert.equal(textOf(ui.by('text-roadmap-project')), '[Atlas Orchard]');
    assert.match(textOf(ui.by('card-roadmap-relation')), /How this relates to Now, Next and Later/);
    assert.match(textOf(ui.by('card-roadmap-relation')), /a scenario never moves an item/);
    const quarters = ui.nodes().filter((n) => propsOf(n)['data-testid'] === 'roadmap-quarter').map((n) => propsOf(n)['aria-label']);
    assert.deepEqual(quarters, ['Q4 2026', 'Q1 2027']);
    assert.match(textOf(ui.by('roadmap-quarter-none')), /No quarter recorded.*\[Yield forecast\]/);
    assert.match(textOf(ui.by('row-quarter-item-57')), /↦ Next.*Blocked · waits on \[Block map\].*due 26 Feb 2027 · \[Noah Brandt\]/);
    assert.equal(ui.by('text-roadmap-opened-from'), undefined, 'nothing is highlighted without ?item=');
    assert.doesNotMatch(ui.text(), /This week|KPI entry|Roadmap board|Roadmap timeline/, 'no zone row, no Board or Timeline view');
    // A view changes the address in place, the venture kept, and Scenarios has its one primary.
    const chip = ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Scenarios');
    assert.ok(chip, 'the Scenarios view');
    await act(async () => propsOf(chip).onClick({ preventDefault() {}, stopPropagation() {} }));
    const params = new URLSearchParams(ui.seen.location.search);
    assert.deepEqual([params.get('view'), params.get('project_id')], ['scenarios', '412']);
    assert.ok(ui.by('card-scenarios'));
    assert.equal(textOf(ui.by('button-new-scenario')), 'New scenario');
    assert.equal(propsOf(ui.by('link-roadmap-back')).href, from, 'a view change keeps where Back goes');
    const returned = await ui.follow('link-roadmap-back');
    assert.equal(`${returned.pathname}${returned.search}`, from);
    assert.deepEqual(returned.state, { roadmapFocus: 'door' }, 'focus goes back to the link that left');
  } finally { await ui.close(); }

  const deps = await landing('/build/roadmap?project_id=412&view=dependencies');
  try {
    assert.ok(deps.by('card-dependencies'));
    assert.equal(textOf(deps.by('button-open-dependencies')), 'Edit dependency links', 'Dependencies has its one primary');
    assert.equal(propsOf(deps.by('link-roadmap-back')).href, '/build/product-roadmap?project_id=412', 'Back without a handed-over address');
  } finally { await deps.close(); }
});

test('3b. arrived from one item: that row is highlighted and focused, and Back names it', async () => {
  // Mutation checked: aria-current dropped → the row is not marked; the item ignored by Back → "Back to Product roadmap".
  const ui = await landing('/build/roadmap?project_id=412&view=quarters&item=57');
  try {
    const row57 = ui.by('row-quarter-item-57');
    assert.equal(propsOf(row57)['aria-current'], 'true');
    assert.match(textOf(row57), /Opened from Product roadmap/);
    assert.equal(propsOf(ui.by('row-quarter-item-55'))['aria-current'], undefined);
    assert.equal(ui.doc.activeElement, row57, 'focus is on the item it came from');
    assert.match(textOf(ui.by('link-roadmap-back')), /Back to \[Harvest log\]/);
    assert.equal(propsOf(ui.by('link-roadmap-back')).href, '/build/product-roadmap/57?project_id=412');
    assert.match(textOf(ui.by('text-roadmap-from')), /Product roadmap · \[Harvest log\]/);
  } finally { await ui.close(); }

  const gone = await landing('/build/roadmap?project_id=412&item=999');
  try {
    assert.match(textOf(gone.by('status-roadmap-item-missing')), /Item 999 is not on this venture’s roadmap/);
    assert.match(textOf(gone.by('link-roadmap-back')), /Back to Product roadmap/);
  } finally { await gone.close(); }
});

test('4. zero items, a reader, a project that is not the reader\'s, and a failed read', async () => {
  // Mutation checked: the /execution editor link kept → the zero state names it; can_write ignored → the reader
  // sees Edit dependency links; the silent swap kept → no notice; the error read as an empty roadmap → no alert.
  const zero = await landing('/build/roadmap?project_id=412', { graph: GRAPH({ items: [], stats: { items: 0, quarters: 0, dependencies: 0, unresolved: 0, blocked: 0, scenarios: 0 } }) });
  try {
    const add = zero.by('link-roadmap-add-first');
    assert.equal(textOf(add), 'Add the first item');
    assert.equal(propsOf(add).href, '/build/product-roadmap?project_id=412&add=1');
    assert.doesNotMatch(zero.text(), /roadmap editor|execution/i);
    assert.equal(zero.by('card-roadmap-relation'), undefined, 'nothing to relate at zero');
    const actions = zero.nodes().filter((n) => (n.tagName === 'A' || n.tagName === 'BUTTON') && /add|new|edit/i.test(textOf(n)));
    assert.deepEqual(actions.map((n) => textOf(n)), ['Add the first item'], 'one first action');
  } finally { await zero.close(); }

  const reader = await landing('/build/roadmap?project_id=412&view=dependencies', { graph: GRAPH({ can_write: false }) });
  try {
    assert.ok(reader.by('status-roadmap-read-only'));
    assert.equal(reader.by('button-open-dependencies'), undefined);
    assert.equal(reader.nodes().find((n) => n.tagName === 'BUTTON' && /New scenario|Record a link/.test(textOf(n))), undefined);
  } finally { await reader.close(); }

  const foreign = await landing('/build/roadmap?project_id=999', { projects: [{ id: 412, name: '[Atlas Orchard]' }] });
  try {
    assert.match(textOf(foreign.by('status-roadmap-refused')), /Project 999 isn’t one you can open.*Showing \[Atlas Orchard\]/);
    assert.deepEqual(foreign.asked, [412]);
    assert.equal(new URLSearchParams(foreign.seen.location.search).get('project_id'), '412');
  } finally { await foreign.close(); }

  const failed = await landing('/build/roadmap?project_id=412', { fail: 'Synthetic outage.' });
  try {
    assert.match(textOf(failed.by('status-roadmap-error')), /Unavailable · Synthetic outage\. Nothing is shown as 0\./);
    assert.equal(failed.by('card-quarters'), undefined);
    assert.match(textOf(failed.by('link-roadmap-back')), /Back to Product roadmap/, 'Back still works');
  } finally { await failed.close(); }
});
