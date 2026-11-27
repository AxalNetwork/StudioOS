/**
 * #6036 (D6036, BD25, BD26, BD28, BD30) — Build › Product roadmap's board above its list.
 *
 *   1. the strip reads the Worker's facts: seven figures, Not recorded (never 0) for a missing one; Late and
 *      Unlinked toggle the list's own filter and go back to the first page;
 *   2. the cards read each row's keys: Late with its day, Unlinked, Blocked with what it waits on, Blocks N;
 *      a column outside the four is said, never dropped; the timeline groups by month with a No date tray;
 *   3. mounted: the strip's Late button filters (aria-pressed), Board and Timeline are a radio group, the
 *      phone's column control shows one column, the board links Quarters, dependencies and scenarios (D8776), and a venture
 *      with no item draws no board (the progressive list's zero guide stands alone).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/roadmap_board_6036.test.mjs
 *
 * Every item and person here is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import RoadmapBoard from '../src/pages/cycles/RoadmapBoard.jsx';
import { dateLine, monthOf, roadmapCard, roadmapColumns, roadmapStrip, roadmapTimeline, shortDay, stripPressed, toggleStrip } from '../src/pages/cycles/roadmapBoardModel.js';

const FACTS = { items: 6, shipped_this_month: 1, now: 2, next: 2, later: 1, done: 1, late: 1, unlinked: 2 };
const row = (id, item, keys, cells = {}) => ({ id, cells: { item, owner: null, date: null, moves: null, ...cells }, keys: { state: 'provisional', late: 'no', link: 'linked', blocks: 0, waits_on: null, ...keys } });
const ROWS = [
  row(1, 'Account setup', { column: 'now', state: 'in_flight', blocks: 2 }, { owner: 'Synthetic Founder', date: '2026-11-18', moves: 'Setup takes two days' }),
  row(2, 'Billing page', { column: 'now', state: 'blocked', late: 'yes', waits_on: 'Account setup' }, { date: '2026-10-12', moves: 'Paid conversions' }),
  row(3, 'Data import', { column: 'next', link: 'unlinked' }, { date: '2026-12-04' }),
  row(4, 'Usage analytics', { column: 'next', link: 'unlinked' }),
  row(5, 'SSO', { column: 'later' }, { date: '2027-02-26', moves: 'Enterprise asks' }),
  row(6, 'Signup flow', { column: 'done', state: 'done' }, { date: '2026-10-21', moves: 'Signups' }),
  row(7, 'Old archived item', { column: 'archived' }),
];
const MODULE = { facts: FACTS, records: { rows: ROWS, total: 7, page: 1, page_size: 25 } };

test('1. the strip reads the facts; Late and Unlinked toggle the list\'s filter', () => {
  // Mutation checked: a missing figure read as 0 → "0" for Not recorded; the toggle keeping the page → page 3 stays.
  const strip = roadmapStrip(FACTS);
  assert.deepEqual(strip.map((c) => [c.label, c.text]), [['Now', '2'], ['Next', '2'], ['Later', '1'], ['Done', '1'], ['Shipped this month', '1'], ['Late', '1'], ['Unlinked', '2']]);
  assert.deepEqual(roadmapStrip({ ...FACTS, late: undefined, unlinked: -1 }).slice(5).map((c) => c.text), ['Not recorded', 'Not recorded']);
  assert.equal(roadmapStrip(null), null);
  const late = strip.find((c) => c.key === 'late');
  const on = toggleStrip({ q: 'x', filter: { column: 'now' }, page: 3 }, late);
  assert.deepEqual(on, { q: 'x', filter: { column: 'now', late: 'yes' }, page: 1 });
  assert.equal(stripPressed(on, late), true);
  assert.deepEqual(toggleStrip(on, late), { q: 'x', filter: { column: 'now' }, page: 1 }, 'pressed again, it turns off');
  assert.equal(strip.find((c) => c.key === 'now').filter, undefined, 'a column figure filters nothing');
});

test('2. cards read the row\'s keys; the timeline groups by month with a No date tray', () => {
  // Mutation checked: waits-on shown on a non-blocked card → the stray card says it waits; an unknown column dropped →
  // `other` is empty; the No date tray dropped → Usage analytics vanishes from the timeline.
  const billing = roadmapCard(ROWS[1]);
  assert.deepEqual([billing.state, billing.waitsOn, billing.late, dateLine(billing)], ['blocked', 'Account setup', true, 'Late · due 12 Oct']);
  const setup = roadmapCard(ROWS[0]);
  assert.deepEqual([setup.state, setup.waitsOn, setup.blocks, dateLine(setup), setup.owner], ['in_flight', null, 2, '18 Nov', 'Synthetic Founder']);
  assert.equal(dateLine(roadmapCard(ROWS[3])), 'No date');
  assert.equal(roadmapCard({ id: 9, cells: {}, keys: { state: 'at_risk' } }).state, 'provisional', 'an unknown state is never drawn as one');
  assert.equal(roadmapCard(row(10, 'Stray', { column: 'now', state: 'in_flight', waits_on: 'Account setup' })).waitsOn, null, 'only a Blocked card says what it waits on');
  const board = roadmapColumns(MODULE.records);
  assert.deepEqual(board.columns.map((c) => [c.key, c.cards.map((x) => x.id)]), [['now', [1, 2]], ['next', [3, 4]], ['later', [5]], ['done', [6]]]);
  assert.deepEqual(board.other.map((x) => x.id), [7]);
  const t = roadmapTimeline(MODULE.records);
  assert.deepEqual(t.months.map((m) => [m.label, m.cards.map((x) => x.id)]), [['Oct 2026', [2, 6]], ['Nov 2026', [1]], ['Dec 2026', [3]], ['Feb 2027', [5]]]);
  assert.deepEqual(t.noDate.map((x) => x.id), [4, 7]);
  assert.deepEqual([shortDay('soon'), shortDay(null), monthOf('2026-13-01'), monthOf('soon')], ['soon', null, null, null]);
});

test('3. mounted: the strip filters, Board and Timeline switch, the phone shows one column', async () => {
  // Mutation checked: the Late cell drawn as a plain cell → no button to press; the phone control ignored → every
  // column shown at once; the zero guard dropped → a board over the zero guide.
  const queries = [];
  const ui = await mountForm(h(RoadmapBoard, { module: MODULE, query: { filter: {} }, onQuery: (q) => queries.push(q), search: '?project=7' }));
  try {
    const lateBtn = ui.by('roadmap-strip-late');
    assert.equal(lateBtn.tagName, 'BUTTON');
    assert.equal(propsOf(lateBtn)['aria-pressed'], false);
    await ui.flush();
    propsOf(lateBtn).onClick();
    assert.deepEqual(queries.at(-1), { filter: { late: 'yes' }, page: 1 });
    assert.equal(ui.by('roadmap-strip-now').tagName, 'DIV');
    assert.match(ui.text(), /Blocked · waits on Account setup/);
    assert.match(ui.text(), /Late · due 12 Oct/);
    assert.match(ui.text(), /Unlinked · no theme, no KPI/);
    assert.match(ui.text(), /Blocks 2/);
    assert.match(ui.text(), /1 listed item has a column other than Now, Next, Later or Done/);
    // D8776 (#8776): the link names its destination and opens it on By quarter, keeping the venture.
    assert.equal(propsOf(ui.by('roadmap-dependencies-link')).href, '/build/roadmap?project_id=7&view=quarters');
    const cls = (id) => String(propsOf(ui.by(id)).className);
    assert.match(cls('roadmap-column-now'), /(^| )flex( |$)/);
    assert.match(cls('roadmap-column-next'), /(^| )hidden( |$)/, 'on a phone, one column at a time');
    await ui.choose('roadmap-phone-column', 'next');
    assert.match(cls('roadmap-column-next'), /(^| )flex( |$)/);
    assert.match(cls('roadmap-column-now'), /(^| )hidden( |$)/);
    assert.equal(ui.by('roadmap-timeline'), undefined);
    await ui.choose('roadmap-view', 'timeline');
    assert.ok(ui.by('roadmap-timeline'));
    assert.match(ui.text(), /No date recorded/);
    assert.equal(ui.by('roadmap-columns'), undefined);
  } finally { await ui.unmount(); }

  const pressed = await mountForm(h(RoadmapBoard, { module: MODULE, query: { filter: { link: 'unlinked' } }, onQuery() {} }));
  try { assert.equal(propsOf(pressed.by('roadmap-strip-unlinked'))['aria-pressed'], true); } finally { await pressed.unmount(); }

  const paged = await mountForm(h(RoadmapBoard, { module: { ...MODULE, records: { ...MODULE.records, total: 60 } }, query: {}, onQuery() {} }));
  try { assert.match(paged.text(), /Showing the 7 items on this page of 60/); } finally { await paged.unmount(); }

  const zero = await mountForm(h(RoadmapBoard, { module: { facts: { ...FACTS, items: 0 }, records: { rows: [], total: 0 } }, query: {}, onQuery() {} }));
  try { assert.equal(zero.by('roadmap-board'), undefined); } finally { await zero.unmount(); }
});
