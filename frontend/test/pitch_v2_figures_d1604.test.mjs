/**
 * D1604 (#3716, pd6, pd24) — a live figure carries its source and grade.
 *
 *   · the pure `figuresModel.js`: a tile's face (source · grade, the
 *     binding's own grade and date), the hover card, which figures on a card
 *     have moved in their store, Refresh from records, and the Projection
 *     label for a chart that reaches past today;
 *   · the editor, mounted: the tile face draws `SourceChip`'s face form, the
 *     hover card names the record, date and grade, a changed figure says so
 *     with Refresh from records, and the refresh is held until Save;
 *   · Present and the print page draw no provenance badge, and keep the
 *     Projection label.
 *
 * The owner's rules: a live figure carries its source and grade, and "Not
 * recorded" is never shown as a zero. Every figure here is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CHANGED_LINE, NOT_RECORDED, PROJECTION, PROJECTION_NOTE, REFRESH_FROM_RECORDS, TYPED_LINE,
  faceOf, figureCard, projectionOf, refreshCard, refreshMetric, staleFigures,
} from '../src/pages/raise/pitch/figuresModel.js';
import { BlockView } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { mountEditor } from './_pitch_editor_mount.mjs';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/pages/raise/pitch/${rel}`, import.meta.url), 'utf8');
const COLOURS = { bg: '#fff', ink: '#111', accent: '#6d28d9', muted: '#6b7280' };

const MRR = { source_key: 'grow.mrr', label: 'MRR', value: 18400, unit: 'usd', as_of: '2026-10-12', grade: 'Measured', source: 'Connector', state: 'recorded', module: 'Grow › Revenue and traction', href: '/grow/revenue-and-traction?project_id=7', snapshot_hash: 'b'.repeat(24) };
const TILE = { id: 'm1', kind: 'metric', grid: { c1: 9, c2: 12, r1: 1, r2: 3 }, label: 'MRR', value: '17900', binding: { source_key: 'grow.mrr', record_ref: null, as_of: '2026-09-30', grade: 'Measured', snapshot_hash: 'a'.repeat(24) } };

/* ------------------------------------------------------------------ *
 * The pure model
 * ------------------------------------------------------------------ */

test('the face: the store\'s source and the binding\'s own grade and date; nothing for a figure no record backs', () => {
  const f = faceOf(TILE.binding, MRR);
  assert.equal(f.source, 'Connector');
  assert.equal(f.grade, 'Measured', 'the grade the card holds');
  assert.equal(f.as_of, '2026-09-30', 'the snapshot the card holds, not the store\'s newest');
  assert.equal(faceOf(TILE.binding, null).source, 'Grow', 'before the store is read, the area names it');
  assert.equal(faceOf({ source_key: 'grow.mrr', grade: null }, MRR), null, 'no grade: not a recorded figure');
  assert.equal(faceOf(null, MRR), null);
});

test('the hover card: record, as of and grade, Open the record; a missing tile reads Not recorded, never 0', () => {
  const c = figureCard({ ...TILE, binding: { ...TILE.binding, snapshot_hash: MRR.snapshot_hash } }, [MRR], null);
  assert.equal(c.lines.length, 1);
  assert.match(c.lines[0], /^From Grow › Revenue and traction · as of 30 Sep\S* · Measured$/);
  assert.equal(c.link.href, MRR.href);
  assert.deepEqual(c.changed, [], 'the same snapshot: nothing changed');
  const empty = figureCard({ id: 'm2', kind: 'metric', label: 'Runway', value: null }, [], null);
  assert.equal(empty.missing.text, NOT_RECORDED);
  assert.ok(!JSON.stringify(empty).includes('"0"'), 'never a zero');
  const gap = figureCard({ id: 'm3', kind: 'metric', label: 'Runway', binding: { source_key: 'grow.runway', grade: null } },
    [{ source_key: 'grow.runway', state: 'not_recorded', module: 'Grow › Runway', href: '/grow/runway' }], null);
  assert.equal(gap.missing.text, NOT_RECORDED);
  assert.deepEqual(gap.missing.link, { text: 'Add in Grow › Runway ›', href: '/grow/runway' });
  assert.equal(figureCard({ id: 't', kind: 'text', text: 'Words' }, [MRR], null), null, 'a text block is not a figure');
  // A typed tile no record backs is not "Not recorded": its face holds a value.
  const typed = figureCard({ id: 'm4', kind: 'metric', label: 'Raise', value: '$2M' }, [], null);
  assert.equal(typed.missing, null, 'the hover does not contradict the face');
  assert.deepEqual(typed.lines, [TYPED_LINE()], 'pd24: "Typed on the card · not linked to a record" when the typist is not known (D1538)');
});

test('a one-click Not recorded binding against a store that still records nothing is not "changed"', () => {
  // newDeck.ts binds a missing slot as { source_key, grade: 'Not recorded', snapshot_hash: null }.
  const tile = { id: 'm9', kind: 'metric', label: 'Runway', value: null, binding: { source_key: 'grow.runway', record_ref: null, as_of: null, grade: 'Not recorded', snapshot_hash: null } };
  const items = [{ source_key: 'grow.runway', state: 'not_recorded', module: 'Grow › Runway', href: '/grow/runway' }];
  assert.deepEqual(staleFigures({ blocks: [tile] }, items), [], 'the figure never changed');
  assert.deepEqual(figureCard(tile, items, null).changed, []);
  assert.equal(refreshCard({ blocks: [tile] }, items).moved, 0);
  // Once the store records it, the tile is stale and Refresh fills it, formatted.
  const now = [{ source_key: 'grow.runway', state: 'recorded', value: 1240000, unit: 'cents', grade: 'Measured', as_of: '2026-10-20', snapshot_hash: 'f'.repeat(24) }];
  assert.deepEqual(staleFigures({ blocks: [tile] }, now).map((x) => [x.state, x.was, x.now]), [['stale', NOT_RECORDED, '$12,400']]);
  assert.equal(refreshCard({ blocks: [tile] }, now).card.blocks[0].value, '$12,400', 'cents read as dollars, never 100x off');
});

test('a changed figure: stale with then and now; gone is never zeroed; Refresh moves only the stale ones', () => {
  const card = { blocks: [TILE, { id: 'm2', kind: 'metric', label: 'Runway', value: '14', binding: { source_key: 'grow.runway', as_of: '2026-09-01', grade: 'Stated', snapshot_hash: 'c'.repeat(24) } }] };
  const items = [MRR, { source_key: 'grow.runway', state: 'not_recorded' }];
  const stale = staleFigures(card, items);
  assert.deepEqual(stale.map((x) => [x.blockId, x.state, x.was, x.now]), [['m1', 'stale', '17900', '$18,400'], ['m2', 'gone', '14', null]]);
  const r = refreshCard(card, items);
  assert.equal(r.moved, 1);
  assert.equal(r.card.blocks[0].value, '$18,400', 'the unit-formatted words the build writes, not the raw number');
  assert.equal(r.card.blocks[0].binding.snapshot_hash, MRR.snapshot_hash);
  assert.equal(r.card.blocks[0].binding.as_of, '2026-10-12', 'the chip moves with the value');
  assert.equal(r.card.blocks[1], card.blocks[1], 'a figure its store no longer holds is left as the card shows it');
  assert.deepEqual(staleFigures(r.card, items).map((x) => x.blockId), ['m2'], 'after the refresh only the gone one is listed');
  assert.equal(refreshMetric(TILE, { ...MRR, state: 'unreadable' }), TILE, 'an unreadable store changes nothing');
  assert.equal(staleFigures(card, []).length, 0, 'a store not read is not called changed');
  // A chart series moves to the series read's snapshot.
  const chart = { id: 'c1', kind: 'chart', chart_type: 'line', series: [{ label: 'MRR', binding: { source_key: 'grow.mrr.monthly', grade: 'Measured', snapshot_hash: 'a'.repeat(24) } }] };
  const charts = { status: 'ok', data: { series: [{ key: 'grow.mrr.monthly', state: 'recorded', source: 'Connector', grade: 'Measured', as_of: '2026-10-01', record_ref: 'project_metrics:7', snapshot_hash: 'd'.repeat(24), points: [] }] } };
  assert.equal(staleFigures({ blocks: [chart] }, [], charts)[0].state, 'stale');
  assert.equal(refreshCard({ blocks: [chart] }, [], charts).card.blocks[0].series[0].binding.snapshot_hash, 'd'.repeat(24));
});

test('Projection: a chart that reaches past today is labelled, with its footnote; a series of records is not', () => {
  const ahead = { id: 'c1', kind: 'chart', chart_type: 'line', series: [{ label: 'Revenue', points: [{ x: '2026-09', y: 1 }, { x: '2027-02', y: 3 }, { x: '2026-12', y: 2 }] }] };
  const p = projectionOf(ahead, '2026-10-31');
  assert.equal(p.label, PROJECTION);
  assert.equal(p.note, PROJECTION_NOTE);
  assert.equal(p.grade, 'Projected');
  assert.equal(p.from, '2026-12', 'from the first month after today');
  assert.equal(projectionOf({ ...ahead, series: [{ points: [{ x: '2026-09', y: 1 }, { x: '2026-10', y: 2 }] }] }, '2026-10-31'), null);
  assert.equal(projectionOf({ id: 'm', kind: 'metric' }, '2026-10-31'), null);
});

/* ------------------------------------------------------------------ *
 * Present and print: no badge, the Projection label kept
 * ------------------------------------------------------------------ */

test('Present and the print page draw no provenance badge on a tile; "Show sources" keeps its plain line', () => {
  const live = renderToStaticMarkup(h(BlockView, { block: TILE, colours: COLOURS, live: true }));
  assert.ok(!/Measured|Connector|source-chip|data-face/.test(live), live);
  assert.match(live, /17900/);
  const shown = renderToStaticMarkup(h(BlockView, { block: TILE, colours: COLOURS, live: true, sources: true }));
  assert.match(shown, /Source: Grow · Measured/, 'the presenter\'s own Show sources line stays');
  assert.ok(!/source-chip|data-face/.test(shown));
  // The editor's face without the store read: source · grade in words, never the raw key.
  const editor = renderToStaticMarkup(h(BlockView, { block: TILE, colours: COLOURS }));
  assert.match(editor, /Grow · Measured/);
  assert.ok(!editor.includes('grow.mrr ·'), 'the binding key is not the face');
  for (const f of ['PitchPresent.jsx', 'PrintExtras.jsx', 'BlockGrid.jsx']) {
    assert.ok(!/^import .*(SourceChip|FigureCard|SourcesBoards)/m.test(read(f)), `${f} imports no badge`);
  }
});

test('a missing tile reads Not recorded on every face, never 0', () => {
  for (const live of [false, true]) {
    const html = renderToStaticMarkup(h(BlockView, { block: { id: 'm', kind: 'metric', label: 'Runway', value: null }, colours: COLOURS, live }));
    assert.match(html, /Not recorded/);
    assert.ok(!/>0</.test(html));
  }
});

test('the Projection label and footnote are drawn on Present and the print face too', () => {
  const ahead = { id: 'c9', kind: 'chart', chart_type: 'line', series: [{ label: 'Revenue', points: [{ x: '2099-01', y: 3 }] }] };
  for (const live of [false, true]) {
    const html = renderToStaticMarkup(h(BlockView, { block: ahead, colours: COLOURS, live }));
    assert.match(html, /Projection · Projected/);
    assert.ok(html.includes(PROJECTION_NOTE));
  }
  const html = renderToStaticMarkup(h(BlockView, { block: ahead, colours: COLOURS, renderChart: () => h('i', null, 'chart') }));
  assert.match(html, /Projection · Projected/, 'the editor\'s drawn chart keeps it');
});

/* ------------------------------------------------------------------ *
 * The editor, mounted
 * ------------------------------------------------------------------ */

const SOURCES = (over = {}) => ({
  project_id: 7,
  items: [{ source_key: 'revenue.mrr', label: 'MRR', value: 4200, unit: 'usd', as_of: '2026-10-01', grade: 'Measured', source: 'Connector', state: 'recorded', module: 'Grow › Revenue', href: '/grow/revenue-and-traction?project_id=7', ...over }],
  coverage: { slots: 1, filled: 1, by_grade: {}, not_recorded: 0, unreadable: 0 },
});

test('the editor: the tile face is SourceChip\'s source · grade, and the hover card names the record, date and grade', async () => {
  const m = await mountEditor({ answers: { 'sources.list': async () => SOURCES() } });
  try {
    const chip = m.by('source-chip-revenue.mrr');
    assert.ok(chip, 'the face chip is drawn');
    assert.equal(m.pr(chip)['data-face'], 'true');
    assert.equal(m.text(chip), '◆ Connector · Measured');
    assert.match(m.pr(chip).title, /From Grow › Revenue · as of 1 Oct · Measured/);
    assert.equal(m.by('pitch-figure-card'), undefined, 'no hover card until the figure is pointed at');
    await m.fire(m.by('pitch-editor-block-b3'), 'onPointerEnter');
    assert.match(m.text(m.by('pitch-figure-card')), /MRR From Grow › Revenue · as of 1 Oct · Measured/);
    assert.equal(m.pr(m.by('pitch-figure-card-open')).href, '/grow/revenue-and-traction?project_id=7');
    await m.fire(m.by('pitch-editor-block-b3'), 'onPointerLeave');
    assert.equal(m.by('pitch-figure-card'), undefined);
    await m.fire(m.by('pitch-editor-block-b2'), 'onPointerEnter');
    assert.equal(m.by('pitch-figure-card'), undefined, 'a text area has no hover card');
    assert.equal(m.by('pitch-figure-changed'), undefined, 'the same snapshot: no changed line');
  } finally { await m.close(); }
});

test('the editor: a figure whose store moved says so, and Refresh from records moves it, held until Save', async () => {
  const m = await mountEditor({ answers: { 'sources.list': async () => SOURCES({ value: 5100, snapshot_hash: 'e'.repeat(24), as_of: '2026-10-20' }) } });
  try {
    const notice = m.by('pitch-figure-changed');
    assert.ok(notice, 'the changed line is drawn');
    assert.match(m.text(notice), new RegExp(`${CHANGED_LINE} MRR ?: 4200 → \\$5,100`), 'the store\'s value in the words a card prints');
    assert.equal(m.text(m.by('pitch-figure-refresh')), REFRESH_FROM_RECORDS);
    assert.match(m.text(), /Saved/);
    await m.press(m.by('pitch-figure-refresh'));
    assert.equal(m.by('pitch-figure-changed'), undefined, 'the card now holds the store\'s snapshot');
    assert.match(m.text(m.by('pitch-editor-block-b3')), /\$5,100/);
    assert.match(m.text(), /Unsaved changes/, 'held until a version is saved');
    assert.ok(!m.calls.some(([n]) => n === 'deckUpdate'), 'nothing was written');
  } finally { await m.close(); }
});
