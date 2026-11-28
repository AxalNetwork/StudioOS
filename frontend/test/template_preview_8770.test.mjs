/**
 * D8770 (#8770) — template previews: each card laid out once at export size
 * in the template's own theme and scaled; a marked fictional example kept
 * apart from the blank structure; charts plotted and stepping down; Read this
 * slide; and the six-column heading that no longer clips. The real-browser
 * DOM overflow check over all 24 templates is
 * `frontend/tests/visual/template_composition_8770.spec.mjs`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LIBRARY, LAYOUT_AREAS } from '../../cloudflare-worker/src/services/decks/templateLibrary.ts';
import { toSlides } from '../../cloudflare-worker/src/services/decks/templates.ts';
import {
  DEFAULT_VIEW, carryLines, chartPlan, dataTable, effectiveHeading, exampleSlide, fontsHref, niceTicks, overflowing,
  previewFace, previewScale, previewSlides, readSlide, seriesPanel, takeaway, templateSets, tooSmall, withMedia,
} from '../src/pages/raise/pitch/templatePreviewModel.js';
import { EXAMPLES, EXAMPLE_BADGE, EXAMPLE_COMPANY } from '../src/pages/raise/pitch/templateExamples.js';
import TemplateSlide from '../src/pages/raise/pitch/TemplateSlide.jsx';
import { BlockView } from '../src/pages/raise/pitch/BlockGrid.jsx';

const KT = LIBRARY.find((t) => t.name === 'Kitchen Table');
const ktCards = toSlides(KT);
const ktFace = previewFace(KT.theme);
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('a card is scaled as one picture from its 1920-wide layout, and says when it is too small to read', () => {
  assert.equal(previewScale(960), 0.5);
  assert.equal(previewScale(1440, '4:3'), 1);
  assert.equal(previewScale(0), 0);
  assert.equal(effectiveHeading(960), 32);
  // 64 px headings fall under 9 px below 270 px wide.
  assert.equal(tooSmall(269), true);
  assert.equal(tooSmall(306), false);
  assert.equal(tooSmall(358), false);
});

test('the preview draws the template’s own theme, never Present’s Outfit on #fbfaf7', () => {
  assert.equal(ktFace.bg, '#F4EDE0');
  assert.equal(ktFace.accent, '#2F5D50');
  assert.match(ktFace.display, /^"Lora", "Space Grotesk", serif$/);
  assert.match(ktFace.body, /^"Inter"/);
  assert.match(ktFace.mono, /^"IBM Plex Mono", "Roboto Mono"/);
  assert.doesNotMatch(JSON.stringify(ktFace), /Outfit|#fbfaf7/i);
  assert.equal(fontsHref(KT.theme), 'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;700&family=Inter:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
  // Only plain family names reach the stylesheet URL or the CSS stack.
  const hostile = { fonts: { display: 'Lora&family=x"><script>', body: 'Inter', mono: null }, colours: { ground: 'red' } };
  assert.equal(fontsHref(hostile), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap');
  assert.doesNotMatch(previewFace(hostile).display, /script|&/);
  assert.equal(previewFace(hostile).bg, '#fbfaf7', 'a colour that is not #rrggbb falls back');
  assert.deepEqual(templateSets({ theme: KT.theme, cards: ktCards }), [['Theme', 'Kitchen Table cream · accent #2F5D50'], ['Type', 'Lora · Inter · IBM Plex Mono'], ['Aspect', '16:9 · 13 cards']]);
});

test('the Example is drawn over copies: the store’s cards are never changed, and Blank structure is them as stored', () => {
  const cards = deepFreeze(JSON.parse(JSON.stringify(ktCards)));
  const before = JSON.stringify(cards);
  const shown = previewSlides(cards, 'example', ktFace);
  assert.equal(JSON.stringify(cards), before);
  assert.equal(previewSlides(cards, 'blank', ktFace), cards, 'Blank structure is the store’s own cards');
  assert.equal(DEFAULT_VIEW, 'example', 'owner Q1, option A');
  assert.ok(shown.every((s) => s.example?.company === EXAMPLE_COMPANY), 'every Kitchen Table card has its example');
  const blankText = JSON.stringify(cards);
  for (const word of ['Larder Lane', '10600', '$1.2M', 'Ada Mensah']) assert.ok(!blankText.includes(word), `${word} is not in the blank structure`);
  assert.match(JSON.stringify(shown), /Larder Lane/);
  // A figure the example fills drops its record binding, so nothing presents it as a venture's record.
  const traction = shown.find((s) => s.card === 'traction');
  assert.equal(traction.blocks.find((b) => b.id === 'H').binding, undefined);
});

test('the Example finds its card by title, as the store serves cards without their catalogue key', () => {
  // `GET /decks/templates/:uid` runs the cards through `sanitizeSlides`, which drops `card`.
  const served = ktCards.map(({ card, ...rest }) => rest);
  const shown = previewSlides(served, 'example', ktFace);
  assert.ok(shown.every((s) => s.example), 'every served Kitchen Table card is drawn with its example');
  assert.equal(takeaway(shown[2]), 'MRR grew 2.5× in five months');
});

test('one example company covers every card of all 24 templates, area by area (owner Q2, option A)', () => {
  for (const t of LIBRARY) {
    for (const card of toSlides(t)) {
      const key = `${card.card}·${card.layout}`;
      const ex = EXAMPLES[key];
      assert.ok(ex, `${t.name}: no example for ${key}`);
      const ids = new Set(card.blocks.map((b) => b.id));
      for (const id of Object.keys(ex.areas)) assert.ok(ids.has(id), `${t.name} ${key}: the example fills ${id}, which the card does not have`);
      for (const id of ids) assert.ok(id in ex.areas, `${t.name} ${key}: area ${id} keeps its placeholder in the Example`);
      const figures = card.blocks.some((b) => b.kind === 'metric' || b.kind === 'chart');
      if (figures) assert.ok(ex.source, `${t.name} ${key}: figures with no source line`);
    }
  }
});

test('Use this template sends only the template and the venture: the example cannot reach a draft', () => {
  const gallery = src('../src/pages/raise/pitch/TemplatesGallery.jsx');
  assert.match(gallery, /deckTemplatesApi\.applyTemplate\(tile\.id, projectId\)/);
  assert.equal((gallery.match(/applyTemplate\(/g) || []).length, 1);
  const api = src('../src/lib/api/deckTemplates.js');
  assert.match(api, /applyTemplate: \(uid, projectId\) => request\(`\/decks\/templates\/\$\{enc\(uid\)\}\/apply`, \{ method: 'POST', body: JSON\.stringify\(\{ project_id: projectId \}\) \}\)/);
  // Only the preview reads the example store.
  const readers = ['TemplatesGallery.jsx', 'TemplateSlide.jsx', 'templatePreviewModel.js', 'DeckPreview.jsx', 'deckV2Adapter.js', 'PitchEditor.jsx', 'GridStage.jsx']
    .filter((f) => /templateExamples/.test(src(`../src/pages/raise/pitch/${f}`)));
  assert.deepEqual(readers, ['TemplatesGallery.jsx', 'TemplateSlide.jsx', 'templatePreviewModel.js']);
  const lines = carryLines({ cards: ktCards }, 'Kitchen Table');
  assert.deepEqual(lines.carries.map((r) => r[0]), ['Structure', 'Placeholders']);
  assert.match(lines.carries[0][1], /13 cards in Kitchen Table’s order/);
  assert.deepEqual(lines.not.map((r) => r[0]), ['Example', 'Theme and type', 'Art']);
  assert.match(lines.not[1][1], /^Not yet/, 'the theme is not claimed to carry: Keep takes the current version’s (D898)');
});

test('a chart steps down for too little data, and two units never share an axis (PTP12)', () => {
  const pts = (ys) => ys.map((y, i) => ({ x: `2026-0${i + 4}`, y }));
  const line = seriesPanel({ label: 'MRR', unit: 'usd', points: pts([4200, 5100, 10600]) });
  assert.equal(line.state, 'line');
  assert.equal(line.ticks[0], 0, 'ticks start at 0');
  assert.ok(line.ticks.length >= 3 && line.ticks.length <= 4 && line.ticks.at(-1) >= 10600);
  assert.equal(line.last, '$10.6k');
  assert.deepEqual(line.xLabels, ['Apr', 'May', 'Jun 2026'], 'the year once, on the last tick');
  const two = seriesPanel({ label: 'Paying shops', unit: 'count', points: [{ x: '2026-10', y: 38 }, { x: '2026-11', y: 41 }] });
  assert.deepEqual([two.state, two.line, two.chip], ['figures', '38 Oct → 41 Nov', '2 points · shown as figures']);
  const one = seriesPanel({ label: 'ARR', unit: 'usd', points: [{ x: '2026-11', y: 127000 }] });
  assert.deepEqual([one.state, one.line, one.when], ['figure', '$127k', 'Nov 2026']);
  const zero = seriesPanel({ label: 'Churn', points: pts([0, 0, 0]) });
  assert.equal(zero.state, 'line', 'a measured zero is a value, drawn as a line');
  const none = seriesPanel({ label: '[MRR]', binding: { source_key: 'grow.mrr' } });
  assert.deepEqual([none.state, none.line], ['none', 'Not recorded']);
  assert.match(none.from, /from Grow/);
  assert.deepEqual(niceTicks(83), [0, 50, 100]);
  // The blank structure's chart is the dashed frame that says what fills it, never an empty axis.
  const blankChart = ktCards.find((c) => c.card === 'traction').blocks.find((b) => b.kind === 'chart');
  assert.equal(chartPlan(blankChart).kind, 'blank');
  const plotted = chartPlan(exampleSlide(ktCards.find((c) => c.card === 'traction'), ktFace).blocks.find((b) => b.kind === 'chart'));
  assert.equal(plotted.kind, 'panels');
  assert.equal(plotted.panels.length, 2);
  assert.deepEqual(plotted.panels.map((p) => p.unit), ['usd', 'count']);
});

test('use of funds sums to its total, and Read this slide gives the takeaway, the data, the source and the blank structure', () => {
  const funds = exampleSlide(ktCards.find((c) => c.card === 'use_of_funds'), ktFace);
  const plan = chartPlan(funds.blocks.find((b) => b.kind === 'chart'));
  assert.equal(plan.kind, 'shares');
  assert.equal(plan.total, 1200);
  assert.equal(plan.totalLabel, '$1.2M');
  assert.deepEqual(plan.items.map((i) => i.share), [45, 30, 15, 10]);
  assert.deepEqual(dataTable(funds.blocks.find((b) => b.kind === 'chart')).rows.at(-1), ['Total', '$1.2M', '100%']);
  const i = ktCards.findIndex((c) => c.card === 'traction');
  const read = readSlide(ktCards[i], previewSlides(ktCards, 'example', ktFace)[i], i, ktCards.length);
  assert.equal(read.heading, 'Slide 3 of 13 · Traction');
  assert.equal(read.takeaway, 'MRR grew 2.5× in five months');
  assert.deepEqual(read.table.head, ['Month', 'MRR', 'Paying shops']);
  assert.deepEqual(read.table.rows.at(-1), ['Nov 2026', '$10.6k', '83']);
  assert.match(read.source, /^Source · Larder Lane billing export · sample, fictional · as of 30 Nov 2026$/);
  assert.ok(read.blank.some((l) => /\[MRR\] and \[Paying customers\] from Grow/.test(l)));
  const blankRead = readSlide(ktCards[i], ktCards[i], i, ktCards.length);
  assert.equal(blankRead.example, false);
  assert.equal(blankRead.source, null);
  assert.equal(takeaway(ktCards[3]), '[What the model does; what a person keeps]');
});

test('a missing image or photo is a labelled frame, not an empty area (PTP15)', () => {
  const [b] = withMedia([{ id: 'I', kind: 'image', image_url: null, alt: '[A screen of the product]', tag: 'screenshot', grid: { c1: 1, c2: 6, r1: 1, r2: 6 } }], ktFace);
  assert.match(b.image_url, /^data:image\/svg\+xml/);
  assert.match(decodeURIComponent(b.image_url), /\[A screen of the product\][\s\S]*Screenshot · not added yet/);
  assert.equal(b.fit, 'contain');
});

test('the card renders once at 1920 × 1080 and is scaled, in the theme, with its chart plotted and its example marked', () => {
  const i = ktCards.findIndex((c) => c.card === 'traction');
  const ex = previewSlides(ktCards, 'example', ktFace)[i];
  const html = renderToStaticMarkup(createElement(TemplateSlide, { slide: ex, index: i, count: 13, face: ktFace, label: 'Traction', initialWidth: 480 }));
  assert.match(html, /width:1920px;height:1080px;transform:scale\(0\.25\)/);
  assert.match(html, /font-family:&quot;Lora&quot;, &quot;Space Grotesk&quot;, serif">MRR grew 2\.5× in five months/);
  assert.match(html, /data-plan="panels"/);
  assert.doesNotMatch(html, /Line chart/);
  assert.match(html, new RegExp(EXAMPLE_BADGE));
  assert.match(html, /Source · Larder Lane billing export · sample, fictional/);
  assert.match(html, /role="img" aria-label="Traction"/);
  const blank = renderToStaticMarkup(createElement(TemplateSlide, { slide: ktCards[i], index: i, count: 13, face: ktFace, initialWidth: 240 }));
  assert.doesNotMatch(blank, new RegExp(`${EXAMPLE_BADGE}|Larder Lane`));
  assert.match(blank, /data-plan="blank"[\s\S]*Line chart/);
  assert.match(blank, /data-small="true"[\s\S]*Too small to read here/);
});

test('a face with a display font draws headings and figures in it; Present’s face is unchanged', () => {
  const block = { id: 'h', kind: 'text', style: 'heading', text: 'Heading' };
  assert.match(renderToStaticMarkup(createElement(BlockView, { block, colours: ktFace, live: true, size: 'print' })), /font-family:&quot;Lora&quot;/);
  const plain = { bg: '#fbfaf7', ink: '#0f2a3d', accent: '#6d28d9', muted: '#64748b' };
  assert.doesNotMatch(renderToStaticMarkup(createElement(BlockView, { block, colours: plain, live: true, size: 'print' })), /font-family/);
  const metric = { id: 'm', kind: 'metric', label: 'MRR', value: '$10.6k' };
  assert.match(renderToStaticMarkup(createElement(BlockView, { block: metric, colours: ktFace, live: true, size: 'print' })), /font-family:&quot;Lora&quot;[^>]*>\$10\.6k/);
});

test('the six-column heading spans rows 1 and 2, and Kitchen Table’s Product card is image and text (owner Q3, option A)', () => {
  const head = LAYOUT_AREAS.image_text.find((a) => a.id === 'H');
  const para = LAYOUT_AREAS.image_text.find((a) => a.id === 'P');
  assert.deepEqual(head.grid, { c1: 7, c2: 12, r1: 1, r2: 2 });
  assert.deepEqual(para.grid, { c1: 7, c2: 12, r1: 3, r2: 6 });
  const product = ktCards.find((c) => c.card === 'product');
  assert.equal(product.layout, 'image_text');
  assert.equal(product.blocks.find((b) => b.id === 'I').tag, 'screenshot');
});

test('the overflow check reads the real layout’s measurements', () => {
  assert.deepEqual(overflowing({ '3:H': { clipped: true, font_px: 64 }, '3:P': { clipped: false }, '3:I': { natural_w: 10 } }), ['3:H']);
  assert.deepEqual(overflowing(null), []);
});
