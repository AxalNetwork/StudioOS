/**
 * D1111 (#2991, part of #2434) — the Pitch deck gaps, as the pages read them:
 *
 *   - Present's "Show sources" draws each figure's binding (D896's, written on
 *     every figure D897's New deck fills): its area, grade and day;
 *   - the studio's links read Used up from the records and time on deck from
 *     the seconds the Worker serves (raiseCycle.ts pitchRecords).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_deck_gaps_d1111.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOURCE_NOT_ON_STUDIOOS, SOURCE_NOT_RECORDED, cardOf, sourceOf } from '../src/pages/raise/pitch/presentExportModel.js';
import { NOT_RECORDED, linkRows } from '../src/pages/raise/pitch/pitchStudioModel.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const MEASURED = { source_key: 'validate.interviews', record_ref: 'interviews:14', as_of: '2026-10-12', grade: 'Measured', snapshot_hash: 'a'.repeat(24) };
const GAP = { source_key: 'validate.strong_fit', record_ref: null, as_of: null, grade: 'Not recorded', snapshot_hash: null };

// A card as newDeck.ts cardOf writes it (D897): metric blocks and read-only auto fields, each with its binding.
const NEW_DECK_CARD = {
  title: 'Validation', layout: 'metric_tiles',
  blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Customers told us' },
    { id: 'm1', kind: 'metric', label: 'Interviews', value: '14', binding: MEASURED },
    { id: 'm2', kind: 'metric', label: 'Strong fit', value: null, binding: GAP },
  ],
  fields: [
    { key: 'headline', label: 'Headline', kind: 'paragraph', value: 'Customers told us', source: 'ai' },
    { key: 'validate.interviews', label: 'Interviews', kind: 'auto', readonly: true, binding: MEASURED, value: 'Interviews · 14', source: 'data' },
    { key: 'validate.strong_fit', label: 'Strong fit', kind: 'auto', readonly: true, binding: GAP, value: '', source: 'placeholder' },
  ],
};

test('a bound figure shows its source in Present: area, grade and day; a gap says it is not on StudioOS', () => {
  // Mutation checked: the auto field left as a line → the figures check fails; blocks not de-duplicated → four figures;
  // a Not recorded binding given a grade → the gap line fails.
  const card = cardOf(NEW_DECK_CARD, 1);
  assert.deepEqual(card.figures, [
    { k: 'Interviews', v: '14', source: 'Source: Validate · Measured · 12 Oct', key: 'validate.interviews' },
    { k: 'Strong fit', v: NOT_RECORDED, source: SOURCE_NOT_ON_STUDIOOS, key: 'validate.strong_fit' },
  ]);
  assert.deepEqual(card.lines, ['Customers told us'], 'a figure is drawn as a line of text');
  assert.ok(!JSON.stringify(card).includes('Interviews · 14'), 'the figure keeps its label glued to its value');
});

test('a metric block the editor placed is a figure with its source; one with no binding is not invented', () => {
  // Mutation checked: blocks ignored → the editor figure is missing; an unbound block admitted → two figures.
  const card = cardOf({ title: 'Traction', blocks: [
    { kind: 'metric', label: 'MRR', value: '$12,000', binding: { source_key: 'grow.mrr', grade: 'Measured', as_of: '2026-10-01' } },
    { kind: 'metric', label: 'Typed', value: '9' },
    { kind: 'text', text: 'Hello', binding: { source_key: 'grow.arr', grade: 'Stated' } },
  ] }, 0);
  assert.deepEqual(card.figures, [{ k: 'MRR', v: '$12,000', source: 'Source: Grow · Measured · 1 Oct', key: 'grow.mrr' }]);
  assert.equal(card.empty, false);
});

test('sourceOf: the grades only; no binding is null, so the card says Source: Not recorded', () => {
  assert.equal(sourceOf(null), null);
  assert.equal(sourceOf({}), null);
  assert.equal(sourceOf({ source_key: 'raise.round_target', grade: 'Stated' }), 'Source: Raise · Stated');
  assert.equal(sourceOf({ source_key: 'odd.key', grade: 'Reviewed', as_of: 'not a day' }), 'Source: StudioOS · Reviewed');
  assert.equal(sourceOf({ source_key: 'grow.mrr', grade: 'Excellent' }), SOURCE_NOT_ON_STUDIOOS, 'a grade the Worker never writes');
  // The page draws the figure's own line, and the fallback only when it has none.
  const present = read('frontend/src/pages/raise/pitch/PitchPresent.jsx');
  assert.match(present, /\{sources \? <span className="text-\[10\.5px\] text-slate-500">\{f\.source \|\| SOURCE_NOT_RECORDED\}<\/span> : null\}/);
  assert.equal(SOURCE_NOT_RECORDED, 'Source: Not recorded');
});

test('the studio reads Used up and the seconds from the records', () => {
  // Mutation checked: the record's muted Used up read as live → 2's live is true; the seconds ignored → 1's time is null.
  const rows = linkRows({ rows: [
    { id: 1, cells: { link: 'A', expires: { text: '2026-11-04', tone: 'ok' }, views: 2, time: { text: '2:05', seconds: 125 } } },
    { id: 2, cells: { link: 'B', expires: { text: 'Used up', tone: 'muted' }, views: 1, time: { text: '0:29', seconds: 29 } } },
    { id: 3, cells: { link: 'C', expires: { text: 'Never', tone: 'ok' }, views: 1, time: null } },
  ] });
  assert.deepEqual(rows.map((r) => [r.id, r.live, r.expires, r.time]), [
    [1, true, '2026-11-04', '2:05'],
    [2, false, 'Used up', '0:29'],
    [3, true, 'Never', null],
  ]);
});
