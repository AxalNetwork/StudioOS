/**
 * D6122 (#6122, GR-21, GR-24, GR-27) — Grow › Company's working view: the due strip filtering the
 * obligations by window, the Repeats column and state words, the line naming Calendar → Compliance,
 * the checklist's how-ticked line and the last five updates.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_company_6122.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { DUE_WINDOWS, dueChips, openLine, rangeLine, tickLine, toggleDue } from '../src/pages/cycles/durableModel.js';
import DurableDueStrip from '../src/pages/cycles/DurableDueStrip.jsx';
import DurabilityChecklist from '../src/pages/cycles/DurabilityChecklist.jsx';
import UpdatesHistory from '../src/pages/cycles/UpdatesHistory.jsx';
import { adaptRecords } from '../src/pages/cycles/adapters/index.js';
import grow from '../src/pages/cycles/defs/grow.jsx';
import { fnOf } from '../src/pages/cycles/adapters/index.js';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/grow/durable-company-building'] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const COUNTS = { overdue: 2, next_30: 3, next_90: 5, later: 4, none: 1 };

test('the strip: four windows in the canvas order, counts from the read, Overdue alarmed only when it holds one', () => {
  assert.deepEqual(DUE_WINDOWS.map((w) => w.label), ['Overdue', 'Next 30 days', 'Next 90 days', 'Later']);
  const chips = dueChips(COUNTS, 'next_30');
  assert.deepEqual(chips.map((c) => c.count), [2, 3, 5, 4]);
  assert.deepEqual(chips.map((c) => c.pressed), [false, true, false, false]);
  assert.equal(chips[0].alarm, true);
  assert.equal(dueChips({ ...COUNTS, overdue: 0 }, '')[0].alarm, false, 'no overdue, no alarm');
  assert.equal(dueChips(null, ''), null, 'no counts, no strip');
  assert.equal(dueChips({ overdue: 1, next_30: 2 }, ''), null, 'a partial read draws no strip, never zeros');
  assert.equal(dueChips({ ...COUNTS, later: -1 }, ''), null);
});

test('a chip sets its window, pressing it again clears it, and either way the page goes back to 1', () => {
  const on = toggleDue({ q: 'tax', page: 3, filter: { kind: 'tax' } }, 'overdue');
  assert.deepEqual(on, { q: 'tax', page: 1, filter: { kind: 'tax', due_window: 'overdue' } });
  const off = toggleDue(on, 'overdue');
  assert.deepEqual(off, { q: 'tax', page: 1, filter: { kind: 'tax' } });
  assert.deepEqual(toggleDue(on, 'later').filter, { kind: 'tax', due_window: 'later' }, 'another chip replaces it');
});

test('the lines: the 90-day range from the Worker\'s day, the open count and what is in no window', () => {
  assert.equal(rangeLine('2026-11-14'), 'Next 90 days · 14 Nov 2026 – 12 Feb 2027');
  assert.equal(rangeLine(null), null);
  assert.equal(rangeLine('14/11/2026'), null);
  assert.equal(openLine(COUNTS), '14 open · soonest due first · 1 done or snoozed (in no due window)');
  assert.equal(openLine({ ...COUNTS, none: 0 }), '14 open · soonest due first');
  assert.equal(openLine(null), null);
});

test('the mounted strip: toggle buttons with aria-pressed, Overdue with a word and a glyph, and Calendar → Compliance named', () => {
  const out = html(h(DurableDueStrip, { counts: COUNTS, on: '2026-11-14', query: { filter: { due_window: 'next_90' } }, onQuery() {}, search: '?project_id=7' }));
  assert.match(out, /role="group" aria-label="Due"/);
  assert.equal((out.match(/<button/g) || []).length, 4);
  assert.match(out, /aria-pressed="true"[^>]*data-testid="grow-company-due-next_90"/);
  assert.match(out, /aria-pressed="false"[^>]*data-testid="grow-company-due-overdue"/);
  assert.match(text(out), /2 ⚠ Overdue/);
  assert.match(text(out), /Next 90 days · 14 Nov 2026 – 12 Feb 2027/);
  assert.match(out, /href="\/calendar\?project_id=7&amp;layer=compliance"/);
  assert.match(text(out), /These obligations are also edited in Calendar → Compliance \. Both write the same records\./);
  assert.match(out, /min-h-\[44px\]/, 'chips are 44px on a phone');
  const bare = html(h(DurableDueStrip, { counts: undefined, on: undefined, query: {}, onQuery() {} }));
  assert.doesNotMatch(bare, /<button/, 'no counts, no chips');
  assert.match(bare, /href="\/calendar\?layer=compliance"/, 'the second editor is named without a venture too');
});

test('Grow names the strip above Company only, and hands it the query', () => {
  const above = fnOf(grow.aboveRecords, 'durable-company-building');
  assert.equal(typeof above, 'function');
  for (const slug of ['distribution', 'market-expansion']) assert.equal(fnOf(grow.aboveRecords, slug), null, slug);
  // D6118 (GR-09): Partnerships puts its Mercury-sourced partner proposal above the partner table.
  assert.equal(typeof fnOf(grow.aboveRecords, 'partner-network'), 'function', 'partner-network');
  const out = html(above({ parts: { due_counts: COUNTS, due_on: '2026-11-14' } }, { projectId: 7, query: {}, onQuery() {}, search: '?project_id=7' }));
  assert.match(out, /data-testid="grow-company-due"/);
  const route = readFileSync(resolve('frontend/src/pages/cycles/CycleRoute.jsx'), 'utf8');
  assert.match(route, /above\?\.\(module, \{ projectId, reload: \(\) => setReload\(\(n\) => n \+ 1\), query, onQuery: setQuery, search: q \}\)/);
});

test('the rows: Repeats, Overdue and Snoozed as words, No owner named, Culture as a kind', () => {
  const recs = adaptRecords('grow', 'durable-company-building', {
    cols: ['Obligation', 'Kind', 'Due', 'Owner', 'State', 'Repeats'],
    rows: [
      { id: 1, title: 'Q3 sales tax', kind: 'tax', due_at: '2026-10-31', owner_name: 'Priya', status: 'overdue', repeats: 'quarterly' },
      { id: 2, title: 'Agent renewal', kind: 'compliance', due_at: '2026-12-03', owner_name: null, status: 'upcoming', repeats: 'yearly' },
      { id: 3, title: 'Retro', kind: 'culture', due_at: '2026-12-18', owner_name: 'Ana', status: 'snoozed', repeats: null },
    ],
  });
  assert.deepEqual(recs.cols.map((c) => c.key), ['obligation', 'kind', 'due', 'owner', 'state', 'repeats']);
  const [a, b, c] = recs.rows.map((r) => r.cells);
  assert.deepEqual(a.state, { text: 'Overdue', tone: 'bad' });
  assert.equal(a.repeats, 'Quarterly');
  assert.deepEqual(b.owner, { text: 'No owner named', tone: 'warn' });
  assert.equal(b.repeats, 'Yearly');
  assert.equal(c.kind, 'Culture');
  assert.deepEqual(c.state, { text: 'Snoozed', tone: 'grey' });
  assert.equal(c.repeats, null, 'a repeat the store does not hold is Not recorded, never Once');
});

test('the checklist: how each item was ticked, or how it will be', () => {
  assert.equal(tickLine({ done: true, source: 'Spin-Out Lab', done_at: '2026-03-02T00:00:00Z' }), 'Spin-Out Lab · 2 Mar 2026');
  assert.equal(tickLine({ done: true, source: 'manual', done_at: '2026-07-14' }), 'By hand · 14 Jul 2026');
  assert.equal(tickLine({ done: true, source: 'manual', done_at: null }), 'By hand');
  assert.equal(tickLine({ done: true, source: 'From Mercury, as of 2026-11-13' }), 'From Mercury, as of 2026-11-13');
  assert.equal(tickLine({ done: false, ticks: 'lab' }), 'Open · Ticks from the Spin-Out Lab');
  assert.equal(tickLine({ done: false, ticks: 'hand' }), 'Open · Tick by hand');
  assert.match(tickLine({ done: false, ticks: 'mercury' }), /^Open · Ticks from Mercury/);
  const out = html(h(DurabilityChecklist, { items: [
    { key: 'ein_received', label: 'Tax ID (EIN) received', done: true, source: 'Spin-Out Lab', done_at: '2026-03-02', ticks: 'lab' },
    { key: 'data_room_built', label: 'Data room built', done: false, source: null, ticks: 'lab' },
  ] }));
  assert.match(text(out), /1 of 2 done/);
  assert.match(out, /data-testid="checklist-how-ein_received">Spin-Out Lab · 2 Mar 2026</);
  assert.match(out, /data-testid="checklist-how-data_room_built">Open · Ticks from the Spin-Out Lab</);
  assert.match(text(out), /Tax ID \(EIN\) received , done/, 'done is said in words, not only a tick');
});

test('Updates history on Company: the last five, titled so, and where the next is written', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ uid: `u${i}`, title: `Update ${i}`, label: 'Not sent' }));
  const out = html(h(UpdatesHistory, { updates: rows, limit: 5, more: { text: 'Write the update in Reporting →', href: '/grow/reporting?project_id=7' } }));
  assert.equal((out.match(/data-testid="updates-row"/g) || []).length, 5);
  assert.match(text(out), /Updates history · last 5/);
  assert.match(out, /data-testid="updates-more" href="\/grow\/reporting\?project_id=7"/);
  const plain = html(h(UpdatesHistory, { updates: rows }));
  assert.equal((plain.match(/data-testid="updates-row"/g) || []).length, 7, 'without a limit, every row');
  assert.doesNotMatch(plain, /updates-more/);
});
