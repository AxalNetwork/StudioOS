/**
 * D898 §8 (#3658) — the deck design system: tokens, budgets, the layout a
 * card's evidence earns, the typed diagram, and the reference decks.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_design_system_d898.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_THEMES, LAYOUT_BUDGETS, LAYOUT_NEEDS, MIN_TYPE_SIZE, ROLE_LAYOUTS, SLIDE, TYPE_SCALE, boxOf, chooseLayout, contrast,
  fitProblems, meets, textCapacity, themeProblems, themeTokens,
} from '../src/services/decks/designSystem.ts';
import { DIAGRAM_ITEMS_MAX, diagramProblem, sanitizeDiagram } from '../src/services/decks/diagramModel.ts';
import { LAYOUT_IDS, THEME_KINDS, modelProblems, sanitizeBlocks } from '../src/services/decks/slideModel.ts';
import { fullReferenceDeck, sparseReferenceDeck } from './fixtures/pitchReferenceDecks.ts';

const url = (u: string | null | undefined) => (typeof u === 'string' && u.startsWith('https://') ? u : null);

test('the v1 contract is main’s: every layout id and theme kind has budgets and tokens, none added or renamed', () => {
  assert.deepEqual(Object.keys(LAYOUT_BUDGETS), LAYOUT_IDS);
  assert.deepEqual(Object.keys(LAYOUT_NEEDS).sort(), [...LAYOUT_IDS].sort());
  assert.deepEqual(Object.keys(BASE_THEMES).sort(), [...THEME_KINDS].sort());
  for (const prefs of Object.values(ROLE_LAYOUTS)) for (const id of prefs) assert.ok(LAYOUT_IDS.includes(id), id);
});

test('every theme is legible: body text 4.5:1, accent and chart marks 3:1, six distinct chart colours, nothing under 22px', () => {
  for (const t of Object.values(BASE_THEMES)) {
    assert.deepEqual(themeProblems(t), [], t.kind);
    assert.equal(t.chart.length, 6);
  }
  for (const s of Object.values(TYPE_SCALE)) assert.ok(s.size >= MIN_TYPE_SIZE);
  assert.equal(contrast('#000000', '#ffffff'), 21);
  const faint = { ...BASE_THEMES.neutral_light, colours: { ...BASE_THEMES.neutral_light.colours, muted: '#c8c8c8' } };
  assert.deepEqual(themeProblems(faint), ['neutral_light: muted text on ground is under 4.5:1.'], 'a faint caption colour is caught');
});

test('a brand kit overrides the brand theme only where it stays legible, and says what it left out', () => {
  const good = themeTokens('brand', { palette_bg: '#fffdf5', palette_ink: '#102030', palette_accent: '#0e7490' });
  assert.deepEqual([good.tokens.colours.ground, good.tokens.colours.ink, good.tokens.colours.accent, good.tokens.chart[0]], ['#fffdf5', '#102030', '#0e7490', '#0e7490']);
  assert.deepEqual(good.adjustments, []);
  assert.deepEqual(themeProblems(good.tokens), []);
  const bad = themeTokens('brand', { palette_bg: '#ffffff', palette_ink: '#eeeeee', palette_accent: '#ffff00' });
  assert.equal(bad.tokens.colours.ink, BASE_THEMES.brand.colours.ink, 'an unreadable ink is not taken');
  assert.equal(bad.tokens.colours.accent, BASE_THEMES.brand.colours.accent, 'nor an unreadable accent');
  assert.equal(bad.adjustments.length, 2);
  assert.deepEqual(themeTokens('neutral_dark', { palette_bg: '#000000', palette_accent: '#22d3ee' }).tokens.colours, BASE_THEMES.neutral_dark.colours, 'the neutral themes ignore even a legible kit');
  assert.equal(themeTokens('nonsense').tokens.kind, 'brand');
});

test('budgets come from geometry and the density caps: a wider range holds more, and no paragraph holds an essay', () => {
  const narrow = textCapacity({ c1: 1, c2: 4, r1: 1, r2: 2 }, 'paragraph');
  const wide = textCapacity({ c1: 1, c2: 12, r1: 1, r2: 2 }, 'paragraph');
  assert.ok(wide.perLine > narrow.perLine);
  assert.ok(textCapacity({ c1: 1, c2: 12, r1: 1, r2: 6 }, 'paragraph').chars <= 280, 'density caps a paragraph');
  const full = boxOf({ c1: 1, c2: 12, r1: 1, r2: 6 });
  assert.ok(full.x >= 100 && full.x + full.w <= SLIDE.width - 100 && full.y + full.h <= SLIDE.height - 80, 'the grid sits inside the safe margins');
  assert.equal(LAYOUT_BUDGETS.metric_tiles.slots.filter((s) => s.kind === 'metric').length, 4);
});

test('the layout a card earns: its first choice when the records are there, a fallback when they are not, never a quote without one recorded', () => {
  assert.deepEqual(chooseLayout('traction', { series: 1 }), { layout: 'chart_text', reason: 'first choice' });
  assert.equal(chooseLayout('traction', { metrics: 2 }).layout, 'metric_tiles');
  assert.equal(chooseLayout('traction', {}).layout, 'statement');
  assert.equal(chooseLayout('team', { people: 3 }).layout, 'two_columns', 'no photos, no photo grid');
  assert.equal(chooseLayout('team', { people: 3, images: 3 }).layout, 'team_grid');
  assert.equal(chooseLayout('problem', { metrics: 0 }).layout, 'statement');
  assert.equal(chooseLayout('problem', { quotes: 1 }).layout, 'quote');
  assert.equal(chooseLayout('roadmap', { steps: 4 }).layout, 'timeline');
  assert.equal(chooseLayout('roadmap', { steps: 2 }).layout, 'two_columns');
  assert.equal(chooseLayout('unknown_role', {}).layout, 'two_columns');
  assert.equal(meets('metric_tiles', { metrics: 1 }), false);
});

test('fit: overflowing text, a too-long figure, a one-row tile and too many series are each named', () => {
  const slides = [{ layout: 'two_columns', blocks: [
    { id: 'h', kind: 'text', grid: { c1: 1, c2: 3, r1: 1, r2: 1 }, style: 'heading', text: 'A heading far too long for three narrow columns on one line' },
    { id: 'm', kind: 'metric', grid: { c1: 4, c2: 5, r1: 2, r2: 2 }, label: 'Round', value: '$1,500,000,000' },
    { id: 'c', kind: 'chart', grid: { c1: 6, c2: 12, r1: 2, r2: 6 }, series: Array.from({ length: 7 }, () => ({ points: [] })) },
  ] }];
  const kinds = fitProblems(slides).map((p) => `${p.block}:${p.kind}`).sort();
  assert.deepEqual(kinds, ['c:too_many_series', 'h:overflow', 'm:too_small', 'm:value_too_long']);
  assert.deepEqual(fitProblems([{ layout: 'statement', blocks: [{ id: 'h', kind: 'text', grid: { c1: 2, c2: 11, r1: 2, r2: 5 }, style: 'heading', text: 'Short and clear' }] }]), []);
});

test('the diagram is a typed, editable element: versioned, labelled steps, a matrix with two axes; it survives the slide model and a bad one is refused', () => {
  const d = { v: 1, type: 'timeline', items: [{ label: ' Pilot ', date: '2026-11' }, { label: 'Launch', date: '2027-02-30x' }, { label: '' }] };
  assert.deepEqual(sanitizeDiagram(d), { v: 1, type: 'timeline', items: [{ label: 'Pilot', date: '2026-11' }, { label: 'Launch' }] });
  assert.equal(sanitizeDiagram({ ...d, v: 2 }), null, 'an unknown version is not read');
  assert.equal(sanitizeDiagram({ v: 1, type: 'matrix', items: [1, 2, 3, 4].map((n) => ({ label: `Q${n}` })) }), null, 'a matrix needs its axes');
  assert.ok(sanitizeDiagram({ v: 1, type: 'matrix', axes: { x: 'Price', y: 'Depth' }, items: [1, 2, 3, 4, 5].map((n) => ({ label: `Q${n}` })) })?.items.length === 4);
  const blocks = sanitizeBlocks([{ id: 'g', kind: 'graphic', grid: { c1: 1, c2: 12, r1: 2, r2: 5 }, graphic: 'timeline', diagram: d }], url);
  assert.deepEqual(blocks[0].diagram.items.map((i: any) => i.label), ['Pilot', 'Launch']);
  assert.deepEqual(sanitizeBlocks([{ id: 'g', kind: 'graphic', grid: { c1: 1, c2: 2, r1: 1, r2: 1 }, graphic: 'x' }], url)[0], { id: 'g', kind: 'graphic', grid: { c1: 1, c2: 2, r1: 1, r2: 1 }, graphic: 'x', ratio: '1x1' }, 'an old graphic reads as before');
  assert.match(modelProblems([{ blocks: [{ kind: 'graphic', grid: { c1: 1, c2: 2, r1: 1, r2: 1 }, diagram: { v: 1, type: 'spiral', items: [] } }] }], url)[0], /diagram type must be one of/);
  assert.match(String(diagramProblem({ v: 1, type: 'flow', items: Array.from({ length: DIAGRAM_ITEMS_MAX + 1 }, (_, i) => ({ label: `s${i}` })) })), /at most 8 steps/);
});

test('the reference decks: twelve cards and a sparse variant, varied layouts, every card within budget and sound by the slide model, every figure bound or Not recorded', () => {
  const full = fullReferenceDeck();
  const sparse = sparseReferenceDeck();
  assert.equal(full.length, 12);
  assert.ok(new Set(full.map((s) => s.layout)).size >= 8, 'at least eight different layouts');
  for (const role of ['title', 'product', 'traction', 'market', 'team', 'round']) assert.ok(full.some((s) => s.role === role), role);
  for (const [name, deck] of [['full', full], ['sparse', sparse]] as const) {
    assert.deepEqual(fitProblems(deck), [], `${name} fits`);
    assert.deepEqual(modelProblems(deck, url), [], `${name} is sound`);
    for (const s of deck) for (const b of s.blocks as any[]) {
      if (b.kind === 'metric') assert.equal(b.value == null, b.binding.grade === 'Not recorded', `${name} ${s.role}: a figure is bound, a missing one says so`);
      if (b.kind === 'text') assert.doesNotMatch(String(b.text), /\$\d|\d%/, `${name} ${s.role}: no figure typed into words`);
    }
  }
  assert.ok(sparse.every((s) => s.layout !== 'chart_text' && s.layout !== 'team_grid' && s.layout !== 'timeline'), 'sparse cards fall back');
  assert.ok(sparse.some((s) => (s.blocks as any[]).some((b) => b.kind === 'metric' && b.value == null)), 'and show Not recorded');
});

test('a bound chart series survives the slide model: its key carries the series cadence (it was dropped on save)', () => {
  const binding = { source_key: 'grow.mrr.monthly', record_ref: 'project_metrics:3', as_of: '2026-10-01', grade: 'Measured', snapshot_hash: 'a'.repeat(24) };
  const [chart] = sanitizeBlocks([{ id: 'c', kind: 'chart', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, chart_type: 'line', series: [{ label: 'MRR', binding }] }], url);
  assert.deepEqual(chart.series, [{ label: 'MRR', binding }]);
  assert.equal(sanitizeBlocks([{ id: 'c', kind: 'chart', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, series: [{ label: 'x', binding: { ...binding, source_key: 'grow.mrr.monthly.extra' } }] }], url)[0].series.length, 0, 'a third segment is still refused');
});
