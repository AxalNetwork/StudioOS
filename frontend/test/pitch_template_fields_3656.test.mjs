/**
 * #3656 — template cards stay complete when edited, presented and exported,
 * and a template's configuration never reaches a slide.
 *
 *   · the allowlist: brand-kit and metadata fields, raw asset values, bare
 *     flags, unbound `auto` JSON and chart specs are never drawn as text;
 *     every `brandkit_*` and `meta_*` key the Worker writes is held to it;
 *   · the conversion: a field-only card's content becomes blocks the first time
 *     it gains a block or a layout, deterministically and without loss; bindings
 *     (and so sources and dates) are kept; the stored fields are untouched;
 *   · add, edit, remove and reorder the first block, save and reload, present
 *     and print: nothing lost, nothing drawn twice;
 *   · block-only and mixed cards are left alone, and a version read is never
 *     mutated; a card that cannot fit is refused, never hidden.
 *
 * Every venture, figure and card is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_template_fields_3656.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RENDERABLE_KINDS, cardOf, fieldBlocks, renderableField, renderableFields } from '../src/pages/raise/pitch/presentExportModel.js';
import { addBlock, applyLayout, cardsOf, removeBlock, updateBlock, withFieldBlocks } from '../src/pages/raise/pitch/editorModel.js';
import { StudioPrintCard } from '../src/pages/raise/pitch/PrintExtras.jsx';

const MODEL = { grid: { cols: 12, rows: 6 } };
const BIND = (key) => ({ source_key: key, record_ref: 'synthetic:1', as_of: '2026-10-20', grade: 'Measured', snapshot_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6' });
const brandFields = (theme) => [
  ['brandkit_present', 'false'], ['brandkit_logo_url', ''], ['brandkit_logo_svg', '<svg/>'], ['brandkit_theme_color', '#7c3aed'],
  ['brandkit_accent', '#7c3aed'], ['brandkit_fonts', 'Outfit'], ['brandkit_theme', theme], ['brandkit_project_name', 'Synthetic Labs'],
  ['brandkit_voice_json', '{"tone":"warm"}'],
].map(([key, value]) => ({ kind: 'paragraph', key, value }));
// A template cover as the Worker writes it (`applyBrandKitToSlides`), with its content and its configuration.
const COVER = {
  title: 'Synthetic Labs', spec_id: 'cover', notes: 'Open with the problem.',
  fields: [
    { kind: 'title', key: 'cover_headline', value: 'Synthetic Labs' },
    { kind: 'subtitle', key: 'cover_sub', value: 'Month-end close in an afternoon' },
    { kind: 'paragraph', key: 'cover_location', value: 'Montréal' },
    { kind: 'paragraph', key: 'meta_is_sample', value: 'false' },
    { kind: 'paragraph', key: 'meta_days_remaining', value: '12' },
    ...brandFields('accent_only'),
  ],
};
const TRACTION = {
  title: 'Traction',
  fields: [
    { kind: 'text', key: 'traction_body', value: 'Small finance teams close their books faster.' },
    { kind: 'bullets', key: 'traction_points', value: ['Two pilots signed', 'Weekly active teams'] },
    { kind: 'auto', key: 'mrr', label: 'MRR', value: 'MRR · $4,200', binding: BIND('grow.mrr'), readonly: true },
    { kind: 'auto', key: 'runway', label: 'Runway', value: 'Runway · 18 months', source: 'placeholder', binding: BIND('grow.runway') },
    { kind: 'text', key: 'problem_body', label: 'Problem', value: 'Describe the problem in one line', source: 'placeholder' },
    { kind: 'metric_grid', key: 'kpis', value: [{ label: 'Customers', value: '42', binding: BIND('grow.customers') }, { label: 'Churn', value: '' }] },
    { kind: 'auto', key: 'encoded', value: '{"x":1}', readonly: true },
    { kind: 'chart', key: 'chart_spec', value: { type: 'line' } },
    { kind: 'bullets', key: 'unfilled', label: 'Milestones', value: [], source: 'placeholder' },
    { kind: 'image', key: 'product_demo_screenshot_url', value: 'https://images.example.invalid/screen.png' },
  ],
};
const textOf = (card) => [card.sub, ...card.lines, ...card.bullets, ...card.figures.map((f) => `${f.k} ${f.v}`)].join('\n');
const deepFreeze = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };

// ── The allowlist ───────────────────────────────────────────────────────────

test('a template cover shows its content and none of its configuration (#3654: "false", "accent_only")', () => {
  const card = cardOf(COVER, 0);
  assert.equal(card.sub, 'Month-end close in an afternoon');
  assert.deepEqual(card.lines, ['Montréal']);
  assert.doesNotMatch(textOf(card), /\bfalse\b|accent_only|#7c3aed|Outfit|<svg|tone|\b12\b|Synthetic Labs/, 'no brand choice, flag, metadata or asset is drawn');
  const print = renderToStaticMarkup(React.createElement(StudioPrintCard, { slide: COVER, index: 0 }));
  assert.doesNotMatch(print, />\s*(false|accent_only)\s*</);
});

test('the allowlist: figures, the content kinds and an image draw; configuration, flags, JSON and chart specs do not', () => {
  assert.deepEqual(RENDERABLE_KINDS, ['title', 'subtitle', 'text', 'paragraph', 'quote', 'bullets', 'metric_grid', 'metric', 'image']);
  assert.equal(renderableField({ kind: 'auto', binding: BIND('grow.mrr') }), true, 'a bound figure, whatever its kind');
  assert.equal(renderableField({ kind: 'auto', value: '{"x":1}' }), false);
  assert.equal(renderableField({ kind: 'chart', value: { type: 'line' } }), false);
  assert.equal(renderableField({ kind: 'image', key: 'product_demo_screenshot_url', value: 'https://x.example.invalid/a.png' }), true, 'an image field\'s value is its URL');
  assert.equal(renderableField({ kind: 'paragraph', key: 'product_demo_live_url', value: 'https://x.example.invalid' }), false, 'a URL written as text is an asset');
  assert.equal(renderableField({ kind: 'paragraph', key: 'cover_note', value: 'TRUE' }), false, 'a bare flag');
  assert.equal(renderableField({ kind: 'paragraph', key: 'cover_note', value: 'We are true to our word' }), true);
  assert.equal(renderableField(null), false);
});

test('every brand-kit and metadata key the Worker writes is configuration, never content', () => {
  const sources = ['cloudflare-worker/src/services/decks/branding.ts', 'cloudflare-worker/src/services/decks/axalSpinoutDemoDay.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const keys = [...new Set([...sources.matchAll(/'((?:brandkit|meta)_[a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 20, `found ${keys.length} keys`);
  for (const key of keys) assert.equal(renderableField({ kind: 'paragraph', key, value: 'something' }), false, key);
});

// ── The conversion ──────────────────────────────────────────────────────────

test('a field-only card becomes blocks without loss: heading, text, list, bound figures and the image', () => {
  const r = fieldBlocks(TRACTION, MODEL);
  assert.deepEqual(r.blocks, [
    { id: 'f1', kind: 'text', style: 'heading', text: 'Traction', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
    { id: 'f2', kind: 'text', style: 'paragraph', text: 'Small finance teams close their books faster.', grid: { c1: 1, c2: 7, r1: 2, r2: 2 } },
    { id: 'f3', kind: 'text', style: 'list', text: 'Two pilots signed\nWeekly active teams', grid: { c1: 1, c2: 7, r1: 3, r2: 3 } },
    { id: 'f4', kind: 'metric', label: 'MRR', value: '$4,200', binding: BIND('grow.mrr'), grid: { c1: 1, c2: 3, r1: 5, r2: 5 } },
    { id: 'f5', kind: 'metric', label: 'Runway', value: null, binding: BIND('grow.runway'), grid: { c1: 4, c2: 6, r1: 5, r2: 5 } },
    { id: 'f6', kind: 'metric', label: 'Customers', value: '42', binding: BIND('grow.customers'), grid: { c1: 1, c2: 3, r1: 6, r2: 6 } },
    { id: 'f7', kind: 'metric', label: 'Churn', value: null, grid: { c1: 4, c2: 6, r1: 6, r2: 6 } },
    { id: 'f8', kind: 'image', image_url: 'https://images.example.invalid/screen.png', alt: '', tag: 'photo', grid: { c1: 8, c2: 12, r1: 2, r2: 6 } },
  ]);
  assert.deepEqual(fieldBlocks(TRACTION, MODEL), r, 'deterministic');
  assert.doesNotMatch(JSON.stringify(r), /Milestones|\{"x":1\}|"line"|18 months|Describe the problem/, 'a placeholder\'s sample text, encoded JSON and a chart spec are not content; an unfilled figure stays null');
  // What the card face showed is all still shown.
  const before = cardOf(TRACTION, 1);
  const shown = JSON.stringify(r.blocks);
  for (const piece of [...before.lines, ...before.bullets, ...before.figures.map((f) => f.k)]) if (!/Not recorded/.test(piece)) assert.ok(shown.includes(piece), piece);
});

test('a card that cannot fit, or says more than a block holds, is refused, never hidden', () => {
  const many = { title: 'Figures', fields: Array.from({ length: 9 }, (_, i) => ({ kind: 'auto', key: `k${i}`, label: `Figure ${i}`, value: String(i), binding: BIND(`grow.k${i}`) })) };
  assert.match(fieldBlocks(many, MODEL).error, /more than fits on the 12 × 6 grid/);
  const long = { title: 'Long', fields: [{ kind: 'text', key: 'body', value: 'x'.repeat(4001) }] };
  assert.match(fieldBlocks(long, MODEL).error, /4000 characters/);
  const r = addBlock(many, { kind: 'text', style: 'paragraph', text: 'new', grid: { c1: 1, c2: 6, r1: 2, r2: 3 } }, MODEL);
  assert.match(r.error, /more than fits/);
  assert.equal(r.card, undefined, 'nothing is changed');
  assert.match(applyLayout(many, { id: 'statement', blocks: [] }).error, /more than fits/);
});

// ── Editing, saving, presenting, printing ───────────────────────────────────

test('add, edit, remove and reorder the first block; save and reload; present and print: nothing lost, nothing twice', () => {
  const [card] = deepFreeze(cardsOf({ slides: [TRACTION] }));
  // Asked for at the top left, where the title now sits: it takes the first free range of its size.
  const added = addBlock(card, { kind: 'text', style: 'paragraph', text: 'Added by the founder', grid: { c1: 1, c2: 4, r1: 1, r2: 1 } }, MODEL);
  assert.ok(added.card, added.error);
  const ids = added.card.blocks.map((b) => b.id);
  assert.deepEqual(ids, ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'b9']);
  const mine = added.card.blocks.at(-1);
  assert.equal(mine.text, 'Added by the founder');
  assert.ok(!added.card.blocks.slice(0, -1).some((b) => b.grid.c1 <= mine.grid.c2 && mine.grid.c1 <= b.grid.c2 && b.grid.r1 <= mine.grid.r2 && mine.grid.r1 <= b.grid.r2), 'the new block took a free range');
  assert.deepEqual(added.card.fields, TRACTION.fields, 'the fields are stored untouched');
  // A second block does not convert again.
  const second = addBlock(added.card, { kind: 'text', style: 'paragraph', text: 'Another', grid: { c1: 5, c2: 7, r1: 4, r2: 4 } }, MODEL);
  assert.ok(second.card, second.error);
  assert.equal(second.card.blocks.filter((b) => b.text === 'Traction').length, 1, 'converted once');
  // Edit, remove, reorder the first block.
  const edited = updateBlock(second.card, 'f1', { text: 'Traction, measured' });
  const removed = removeBlock(edited, 'f2');
  const reordered = { ...removed, blocks: [removed.blocks.at(-1), ...removed.blocks.slice(0, -1)] };
  // Save and reload: the version is JSON.
  const reloaded = JSON.parse(JSON.stringify(reordered));
  const face = cardOf(reloaded, 1);
  assert.equal(face.blocks.length, reordered.blocks.length);
  const headings = face.blocks.filter((b) => b.style === 'heading').map((b) => b.text);
  assert.deepEqual(headings, ['Traction, measured']);
  assert.equal(face.blocks.some((b) => b.text === 'Small finance teams close their books faster.'), false, 'removed means removed');
  // Present and print draw the blocks, once each, and no field text beside them.
  const print = renderToStaticMarkup(React.createElement(StudioPrintCard, { slide: reloaded, index: 1 }));
  assert.equal(print.split('Two pilots signed').length - 1, 1, 'drawn once');
  assert.equal(print.split('Traction, measured').length - 1, 1);
  assert.match(print, /data-layout="grid"/);
  assert.doesNotMatch(print, /\{&quot;x&quot;:1\}|\{"x":1\}/);
});

test('a layout carries a field card\'s content, kind by kind', () => {
  const layout = { id: 'title', label: 'Title', blocks: [{ kind: 'text', style: 'heading', grid: { c1: 1, c2: 12, r1: 1, r2: 2 } }, { kind: 'text', style: 'paragraph', grid: { c1: 1, c2: 12, r1: 3, r2: 6 } }] };
  const r = applyLayout(cardsOf({ slides: [COVER] })[0], layout);
  assert.deepEqual(r.card.blocks.map((b) => b.text), ['Synthetic Labs', 'Month-end close in an afternoon']);
  assert.deepEqual(r.dropped.map((b) => b.text), ['Montréal'], 'what the new layout has no place for is named, as for any card');
  assert.equal(r.card.notes, 'Open with the problem.', 'the notes stay');
  assert.ok(r.card.fields.some((f) => f.key === 'brandkit_theme' && f.value === 'accent_only'), 'the brand choices stay stored, for the renderer');
});

test('block-only and mixed cards are left alone; a new title-only card stays new; nothing read is mutated', () => {
  const blockOnly = { title: 'B', blocks: [{ id: 'x', kind: 'text', style: 'heading', text: 'B', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } }] };
  assert.equal(withFieldBlocks(blockOnly, MODEL).card, blockOnly);
  const mixed = { ...TRACTION, blocks: blockOnly.blocks };
  assert.equal(withFieldBlocks(mixed, MODEL).card, mixed, 'a card that already has blocks is never converted again');
  const fresh = { title: 'New card' };
  assert.equal(withFieldBlocks(fresh, MODEL).card, fresh);
  const coverOnlyConfig = { title: 'Cover', fields: brandFields('full') };
  assert.equal(withFieldBlocks(coverOnlyConfig, MODEL).card, coverOnlyConfig, 'configuration alone is not content to convert');
  const frozen = deepFreeze(JSON.parse(JSON.stringify(TRACTION)));
  assert.doesNotThrow(() => fieldBlocks(frozen, MODEL));
  assert.doesNotThrow(() => addBlock(frozen, { kind: 'text', style: 'paragraph', text: 'x', grid: { c1: 1, c2: 2, r1: 1, r2: 1 } }, MODEL));
  assert.equal(renderableFields(frozen).length, 8, 'text, bullets, two bound figures, the placeholder text, the KPI grid, the empty milestones and the image; not the JSON or the chart spec');
});
