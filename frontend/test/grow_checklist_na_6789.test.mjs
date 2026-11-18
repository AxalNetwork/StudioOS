/**
 * D6789 (#6789) — a durability checklist item can be Not applicable: its row says
 * who marked it and when, it is out of the score, and the page and the Company
 * card read the same count.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_checklist_na_6789.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { tickLine } from '../src/pages/cycles/durableModel.js';
import DurabilityChecklist from '../src/pages/cycles/DurabilityChecklist.jsx';
import { CARDS } from '../src/pages/cycles/adapters/grow.js';

const ITEMS = [
  { key: 'ein_received', label: 'Tax ID (EIN) received', ticks: 'lab', done: true, source: 'Spin-Out Lab', done_at: '2026-03-02', not_applicable: false },
  { key: 'data_room_built', label: 'Data room built', ticks: 'lab', done: false, source: null, done_at: null, not_applicable: false },
  { key: 'key_person_cover', label: 'Key-person cover set up', ticks: 'hand', done: true, source: 'manual', done_at: '2026-07-14', not_applicable: false },
  { key: 'board_cadence', label: 'Board meeting cadence agreed', ticks: 'hand', done: false, source: null, done_at: null,
    not_applicable: true, not_applicable_at: '2026-11-03T10:00:00Z', not_applicable_by: 'Fay Founder' },
];
const noop = async () => {};

test('D6789: a Not applicable row reads "Not applicable · by … · date"', () => {
  assert.equal(tickLine(ITEMS[3]), 'Not applicable · by Fay Founder · 3 Nov 2026');
  assert.equal(tickLine({ not_applicable: true, not_applicable_at: '2026-11-03', not_applicable_by: null }), 'Not applicable · 3 Nov 2026');
  // Done items still say what ticked them.
  assert.equal(tickLine(ITEMS[0]), 'Spin-Out Lab · 2 Mar 2026');
});

test('D6789: the page counts done out of the items that apply, and says how many do not', () => {
  const out = renderToStaticMarkup(h(DurabilityChecklist, { items: ITEMS, onToggle: noop, onNotApplicable: noop }));
  assert.match(out, /data-testid="checklist-score">2 of 3 done · 1 not applicable</);
  assert.match(out, /Not applicable · by Fay Founder · 3 Nov 2026/);
  assert.match(out, /, not applicable</);
  const none = renderToStaticMarkup(h(DurabilityChecklist, { items: ITEMS.slice(0, 3), onToggle: noop, onNotApplicable: noop }));
  assert.match(none, /data-testid="checklist-score">2 of 3 done</);
  assert.doesNotMatch(none, /not applicable</);
});

test('D6789: a Lab-ticked item offers no Not applicable; an N/A item offers Applies, not Mark done', () => {
  const out = renderToStaticMarkup(h(DurabilityChecklist, { items: ITEMS, onToggle: noop, onNotApplicable: noop }));
  assert.doesNotMatch(out, /checklist-na-ein_received/);
  assert.match(out, /checklist-na-data_room_built/);
  assert.match(out, /checklist-na-key_person_cover/);
  assert.doesNotMatch(out, /checklist-na-board_cadence/);
  assert.match(out, /checklist-applies-board_cadence/);
  assert.doesNotMatch(out, /checklist-tick-board_cadence/);
  // Read-only: no controls at all.
  const ro = renderToStaticMarkup(h(DurabilityChecklist, { items: ITEMS }));
  assert.doesNotMatch(ro, /checklist-(na|applies|tick)-/);
});

test('D6789: the Company card and the page agree on the count', () => {
  const page = renderToStaticMarkup(h(DurabilityChecklist, { items: ITEMS }));
  const [, done, of] = page.match(/checklist-score">(\d+) of (\d+) done/);
  // The Worker's card series for the same items: done out of the items that apply.
  const applies = ITEMS.filter((i) => !i.not_applicable);
  const series = { checklist: { done: applies.filter((i) => i.done).length, total: applies.length, not_applicable: 1, pct: 67 } };
  const blocks = CARDS['durable-company-building'](series);
  const label = blocks.find((b) => b.kind === 'progress').items[0].label;
  assert.equal(label, `Checklist · ${done} of ${of}`);
});

test('D6789: the page wires Not applicable to PUT /checklist/:key with not_applicable', () => {
  const src = readFileSync(resolve('frontend/src/lib/api/cycleWrites.js'), 'utf8');
  assert.match(src, /checklistNotApplicable: \(projectId, key, na\) => request\(`\/cycles\/grow\/checklist\/\$\{seg\(key\)\}`, \{ method: 'PUT', body: JSON.stringify\(\{ project: projectId, not_applicable: na === true \}\) \}\)/);
  assert.match(readFileSync(resolve('frontend/src/pages/cycles/defs/grow.jsx'), 'utf8'), /onNotApplicable=\{ctx\.projectId \? \(key, na\) => cyclesWrite\.grow\.checklistNotApplicable\(ctx\.projectId, key, na\)/);
});
