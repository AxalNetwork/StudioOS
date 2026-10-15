/**
 * D678 (#1552) — `/methodology` and `/intelligence`, built to the owner's
 * canvases `design/canvases/integrated/Axal VC Website.dc.html` (METHODOLOGY)
 * and `design/canvases/integrated/Eadwyn Intelligence Page.dc.html`.
 *
 * This pins:
 *   - the Methodology page's eight sections, in the canvas's order, and its
 *     calls to action;
 *   - its words are the owner's: every string in `lib/siteMethod.js` is in the
 *     canvas;
 *   - every image's alt text, read from the canvases themselves, and every
 *     image shipping in `frontend/public/`;
 *   - the phone containment: each blueprint scrolls inside its own frame, the
 *     grids cannot be widened by one, and the dashed path stops for
 *     reduced motion;
 *   - the Intelligence model table reading `GET /api/public/ai-models`, with no
 *     model named in the page's source;
 *   - each canvas claim kept or dropped, as `lib/siteIntelligence.js` records
 *     it: a kept claim renders and its evidence is still in the code; a dropped
 *     one never renders;
 *   - none of the canvas's sample rows ship.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/methodology_intelligence_d678.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const decode = (s) => s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

const WEBSITE = read('design/canvases/integrated/Axal VC Website.dc.html');
const EADWYN = read('design/canvases/integrated/Eadwyn Intelligence Page.dc.html');
const METHOD_VIEW = WEBSITE.slice(WEBSITE.indexOf('<!-- ============================================================ METHODOLOGY'),
  WEBSITE.indexOf('<!-- ============================================================ INTELLIGENCE'));
const METHOD_SRC = read('frontend/src/pages/site/MethodologyPage.jsx');
const INTEL_SRC = read('frontend/src/pages/site/IntelligencePage.jsx');
const INTEL_DATA_SRC = read('frontend/src/lib/siteIntelligence.js');
const CSS = read('frontend/src/pages/site/method.css');

const { default: MethodologyPage } = await import('../src/pages/site/MethodologyPage.jsx');
const { default: IntelligencePage, ModelTable, modelRows } = await import('../src/pages/site/IntelligencePage.jsx');
const method = await import('../src/lib/siteMethod.js');
const { INTEL_CLAIMS, RESEARCH_CARDS } = await import('../src/lib/siteIntelligence.js');

const render = (el, path = '/') => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [path] }, el));
const METHOD_HTML = render(React.createElement(MethodologyPage), '/methodology');
const INTEL_HTML = render(React.createElement(IntelligencePage), '/intelligence');
const imgs = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => ({
  src: /src="([^"]*)"/.exec(m[0])?.[1],
  alt: decode(/alt="([^"]*)"/.exec(m[0])?.[1] ?? '__missing__'),
}));

// ---------------------------------------------------------------- Methodology

test('methodology: the eight sections render in the canvas order', () => {
  const ids = ['m-hero-h', 'm-dims-h', 'm-loop-h', 'm-stages-h', 'm-lab-h', 'm-record-h', 'm-partners-h', 'm-close-h'];
  let at = -1;
  for (const id of ids) {
    const i = METHOD_HTML.indexOf(`id="${id}"`);
    assert.ok(i > at, `section ${id} is missing or out of order`);
    at = i;
  }
  const t = text(METHOD_HTML);
  const heads = ['Validate. Build. Raise. Grow.', 'Reach, Depth, Momentum.', 'A faster path to a better decision.',
    'From opportunity to enduring company.', 'The methodology in motion.', 'The record is part of the work.',
    'Built with partners globally.', 'Build with clarity. Move with evidence.'];
  let last = -1;
  for (const h of heads) {
    const i = t.indexOf(h);
    assert.ok(i > last, `"${h}" is missing or out of order`);
    last = i;
  }
  // Within the loop section: Fig. 02, the links, the five disciplines, then Figs. 03–06.
  const loop = t.slice(t.indexOf('A faster path'), t.indexOf('From opportunity'));
  const order = ['Fig. 02', 'Validate creates evidence for Build.', 'Five disciplines. One operating system.', 'Fig. 03', 'Fig. 04', 'Fig. 05', 'Fig. 06'];
  let k = -1;
  for (const o of order) { const i = loop.indexOf(o); assert.ok(i > k, `the loop section draws "${o}" in order`); k = i; }
});

test('methodology: the hero CTAs go to the Lab, registration and contact, in that order', () => {
  const hero = METHOD_HTML.slice(METHOD_HTML.indexOf('id="m-hero-h"'), METHOD_HTML.indexOf('ax-m-hero-fig'));
  const hrefs = [...hero.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], decode(m[2])]);
  assert.deepEqual(hrefs, [
    ['/spinout-lab', 'Explore the Spin-Out Lab'],
    ['/register', 'Join Axal VC'],
    ['/contact', 'Work with us →'],
  ]);
  for (const route of ['/spinout-lab', '/register', '/contact']) {
    assert.match(read('frontend/src/App.jsx'), new RegExp(`path="${route}"`), `${route} is a live route`);
  }
});

test('methodology: every string the page draws from lib/siteMethod.js is the canvas\'s own', () => {
  const canvas = decode(WEBSITE);
  const strings = [];
  const walk = (v) => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([key, x]) => { if (!['img', 'tone', 'icon'].includes(key)) walk(x); });
  };
  for (const k of ['METHOD_STAGES', 'METHOD_DIMENSIONS', 'METHOD_LOOP', 'METHOD_LINKS', 'METHOD_DISCIPLINES', 'METHOD_FIGURES', 'LAB_WEEKS', 'METHOD_RECORD', 'METHOD_USERS', 'METHOD_ROLES']) {
    walk(method[k]);
  }
  assert.ok(strings.length > 120, `the page's copy is read (${strings.length} strings)`);
  for (const s of strings) assert.ok(canvas.includes(s), `"${s}" is not in the canvas`);
});

test('methodology: every blueprint keeps the canvas\'s alt text, and ships', () => {
  const canvasAlts = [...METHOD_VIEW.matchAll(/<img class="ax-bp-img" src="[^"]*\/site\/([a-z0-9-]+)\.webp" alt="([^"]+)"/g)]
    .map((m) => ({ src: `/site/${m[1]}.webp`, alt: m[2] }));
  assert.equal(canvasAlts.length, 7, 'the canvas draws seven blueprints');
  const pageImgs = imgs(METHOD_HTML).filter((i) => i.src.startsWith('/site/'));
  assert.deepEqual(pageImgs, canvasAlts, 'the same seven images, in the same order, with the same alt text');
  for (const i of pageImgs) assert.ok(existsSync(resolve(ROOT, `frontend/public${i.src}`)), `${i.src} ships`);
  // The drawn symbol is the canvas's SVG, with its label.
  const svgLabel = /<svg role="img" aria-label="([^"]+)"/.exec(METHOD_VIEW)[1];
  assert.ok(METHOD_HTML.includes(`aria-label="${svgLabel}"`), 'the Axal symbol keeps its accessible name');
  assert.match(METHOD_HTML, /patternUnits="userSpaceOnUse"/, 'the SVG attributes are spelled for React, so they render');
  assert.doesNotMatch(METHOD_SRC, /stroke-width=|sc-camel|style-hover/, 'no canvas-only attribute is left in the page');
  assert.equal((METHOD_HTML.match(/class="ax-m-role-icon"/g) || []).length, 4, 'the four role marks');
});

test('methodology: on a phone each blueprint scrolls inside its frame and the page does not', () => {
  const figures = [...METHOD_HTML.matchAll(/<div class="ax-m-bp-scroll"[^>]*><img class="ax-m-bp-img"/g)];
  assert.equal(figures.length, 7, 'every blueprint sits directly inside its own scroll box');
  assert.match(METHOD_HTML, /class="ax-m-bp-scroll" tabindex="0" role="region" aria-label="Fig\. 01/, 'the scroll box is keyboard-reachable and named');
  assert.match(CSS, /\.ax-m-bp-scroll \{[^}]*overflow-x: auto;[^}]*max-width: 100%;/, 'the box scrolls and never exceeds its column');
  assert.match(CSS, /@media \(max-width: 900px\) \{\s*\.ax-m-bp-img \{ min-width: 1000px; \}\s*\.ax-m-only \{ display: block; \}/,
    'below 900px the blueprint keeps the canvas\'s 1000px and the hint shows');
  assert.match(METHOD_HTML, /class="ax-m-only">Scroll sideways to read the blueprint</);
  assert.match(CSS, /\.ax-m \{ overflow-x: clip; \}/, 'the page clips, so nothing can push it sideways');
  // Every flexible track is minmax(0, …), so a 1000px blueprint cannot widen its column.
  const tracks = [...CSS.matchAll(/grid-template-columns:([^;]+);/g)].map((m) => m[1]);
  assert.ok(tracks.length >= 15, 'the grids are read');
  for (const t of tracks) {
    assert.doesNotMatch(t.replace(/minmax\(0,\s*[\d.]*fr\)/g, ''), /fr\b/, `a bare fr track: "${t.trim()}"`);
  }
  assert.match(CSS, /@media \(max-width: 640px\) \{\s*\.ax-m-wrap \{ padding-left: 16px; padding-right: 16px; \}/, 'the 16px phone gutter');
});

test('methodology: the dashed return path stops for reduced motion', () => {
  assert.match(METHOD_HTML, /<path class="ax-m-dash"/);
  assert.match(CSS, /\.ax-m-dash \{ animation: axMDash 40s linear infinite; \}/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*\.ax-m-dash \{ animation: none; \}/);
});

// ---------------------------------------------------------------- Intelligence

test('intelligence: the model table reads the public registry, and the page names no model', () => {
  assert.match(code(INTEL_SRC), /publicAiModelsApi\.list\(\)/, 'the table is fed by the registry read');
  assert.match(read('frontend/src/lib/api/publicAiModels.js'), /request\('\/public\/ai-models'\)/);
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/publicAiModels\.js';$/m, 'one re-export line (D527)');
  assert.match(read('cloudflare-worker/src/routes/public.ts'), /publicRoutes\.get\('\/ai-models'/, 'the Worker serves it');
  const literals = /@cf\/|llama|guard-3|glm|kimi|gemma|whisper|qwen|deepgram|aura|bge|gpt-oss|deepseek|moonshot|zai-org/i;
  assert.doesNotMatch(code(INTEL_SRC), literals, 'no model id or name typed into the page');
  assert.doesNotMatch(JSON.stringify(RESEARCH_CARDS), literals);
  // Before the read answers there is no table, only the sentence that says so.
  assert.doesNotMatch(INTEL_HTML, /<table/);
  assert.match(INTEL_HTML, /Reading the model registry…/);
});

test('intelligence: the table draws the rows it is given, and says so when it has none', () => {
  const rows = modelRows({ models: [
    { feature: 'Feature A', model: '@x/model-a', name: 'Model A', provider: 'p' },
    { feature: 'Feature B', model: '@x/model-b', provider: 'p' },
    { feature: '', model: '@x/nope' }, null, { model: '@x/no-feature' },
  ] });
  assert.deepEqual(rows, [
    { feature: 'Feature A', model: '@x/model-a', name: 'Model A' },
    { feature: 'Feature B', model: '@x/model-b', name: '@x/model-b' },
  ], 'a row without a feature or a model is not drawn; a model with no name shows its id');
  assert.deepEqual(modelRows(null), []);
  assert.deepEqual(modelRows({ models: 'no' }), []);
  const ok = renderToStaticMarkup(React.createElement(ModelTable, { state: { status: 'ok', rows } }));
  assert.match(ok, /<th scope="col">Axal VC function<\/th><th scope="col">Default model<\/th>/);
  assert.match(ok, /<th scope="row">Feature A<\/th><td><div class="ax-i-model">Model A<\/div><div class="ax-mono ax-i-model-id">@x\/model-a<\/div>/);
  assert.match(ok, /<th scope="row">Feature B<\/th><td><div class="ax-i-model">@x\/model-b<\/div><\/td>/, 'the id is not repeated under itself');
  const empty = renderToStaticMarkup(React.createElement(ModelTable, { state: { status: 'ok', rows: [] } }));
  assert.match(empty, /No models are listed right now\./);
  const failed = renderToStaticMarkup(React.createElement(ModelTable, { state: { status: 'error', rows: [] } }));
  assert.match(failed, /The model registry could not be read just now\./);
  for (const html of [empty, failed]) assert.doesNotMatch(html, /<table/);
});

test('intelligence: every kept claim renders and its evidence is still in the code', () => {
  const page = text(INTEL_HTML);
  const kept = INTEL_CLAIMS.filter((c) => c.kept);
  assert.ok(kept.length >= 9, 'the ledger records what was kept');
  const table = text(renderToStaticMarkup(React.createElement(ModelTable, { state: { status: 'ok', rows: [{ feature: 'f', model: 'm', name: 'n' }] } })));
  for (const c of kept) {
    const where = c.id === 'model-table' ? table : page;
    assert.ok(where.includes(c.text), `kept claim "${c.id}" is on the page`);
    assert.ok(decode(EADWYN).includes(c.text), `kept claim "${c.id}" is the canvas's own words`);
    const [file, token] = c.evidence;
    assert.ok(read(file).includes(token), `kept claim "${c.id}": ${file} no longer holds "${token}"`);
  }
});

test('intelligence: every dropped claim stays off the page', () => {
  const page = text(INTEL_HTML).toLowerCase();
  const src = code(INTEL_SRC).toLowerCase();
  const dropped = INTEL_CLAIMS.filter((c) => !c.kept);
  assert.ok(dropped.length >= 15, 'the ledger records what was dropped');
  for (const c of dropped) {
    assert.ok(typeof c.instead === 'string' && c.instead.length > 10, `dropped claim "${c.id}" says what the code does instead`);
    const needle = c.text.toLowerCase();
    assert.ok(!page.includes(needle), `dropped claim "${c.id}" is on the page`);
    assert.ok(!src.includes(needle), `dropped claim "${c.id}" is in the page's source`);
  }
  for (const word of ['llama guard', 'beta', 'federated', 'proposed, pending', 'read back aloud', 'side rail']) {
    assert.ok(!page.includes(word), `"${word}" is not claimed`);
  }
});

test('intelligence: the reasons two claims were dropped still hold in the code', () => {
  // The safety screen: the feature pages' AI runs do not call the guard.
  for (const f of ['cloudflare-worker/src/routes/founder_validate.ts', 'cloudflare-worker/src/routes/research.ts', 'cloudflare-worker/src/routes/founder_validate_structure.ts']) {
    assert.doesNotMatch(read(f), /classifyInput\(/, `${f} now screens its runs: revisit the dropped "safety-screen" claim`);
  }
  // The model pick: only fill bands carry `pick: true` — Validate's two, and
  // since D698 Grow's Product improvement, whose fill band (D691) sends the
  // rail's pick once its task is in the router. "Pick the model behind each
  // feature page" stays false: any other pick means revisiting the claim.
  const rail = read('frontend/src/ui/railModels.js');
  const validate = rail.slice(rail.indexOf('Validate: ['), rail.indexOf('Research: ['));
  const grow = rail.slice(rail.indexOf("'Product improvement': ["), rail.indexOf('];', rail.indexOf("'Product improvement': [")));
  const elsewhere = rail.slice(rail.indexOf('Research: [')).replace(grow, '');
  assert.match(validate, /pick: true/);
  assert.match(grow, /task: 'grow_theme_feedback',\s*pick: true/);
  assert.doesNotMatch(elsewhere, /pick: true/, 'a pick on another section: revisit the dropped "model-pick" claim');
});

test('intelligence: images keep the canvas\'s alt text, and the canvas\'s sample rows do not ship', () => {
  const pageImgs = imgs(INTEL_HTML).filter((i) => i.src !== '/axal-mark.png');
  assert.deepEqual(pageImgs, [
    { src: '/site/ead-hero.webp', alt: '' },
    { src: '/eadwyn-ai.png', alt: /<img src="[^"]*eadwyn-ai\.png" alt="([^"]+)"/.exec(EADWYN)[1] },
    { src: '/site/ead-map.webp', alt: '' },
    { src: '/eadwyn-ai.png', alt: '' },
  ], 'the two photographs and the second mark are decorative, as the canvas has them');
  for (const i of pageImgs) assert.ok(existsSync(resolve(ROOT, `frontend/public${i.src}`)), `${i.src} ships`);
  for (const sample of ['Log two more discovery interviews', 'Cap table: founder stock issued', 'Investors & LPs', 'Administrators',
    'Peux-tu', 'Local nodes', 'Spend on this page', 'Rail · Pitch deck']) {
    assert.ok(!INTEL_SRC.includes(sample) && !INTEL_DATA_SRC.includes(sample), `the canvas sample "${sample}" does not ship`);
  }
  assert.match(INTEL_HTML, /href="\/studio"[^>]*>Try Eadwyn</, 'Try Eadwyn opens Studio, where the Eadwyn chat lives');
  assert.match(INTEL_HTML, /href="#ei-research"[^>]*>See Research</);
  assert.match(INTEL_HTML, /<section id="ei-research"/);
});

// ---------------------------------------------------------------- Spin-Out Lab

const { LabHero } = await import('../src/components/spinout/LabIntro.jsx');
const LAB_BOARD = read('design/canvases/integrated/Spin-Out Lab Page.dc.html');
const LAB_SRC = read('frontend/src/components/spinout/LabIntro.jsx');

test('lab: the hero draws the board\'s image and reads every cohort figure from the record', () => {
  assert.match(LAB_BOARD, /src="\.\.\/\.\.\/\.\.\/frontend\/public\/site\/lab-board-2\.webp"/, 'the board names this image');
  const ok = render(React.createElement(LabHero, {
    surface: 'public', applyHref: '/register', briefHref: '/spinout-lab/brief',
    cohort: { status: 'ok', cohort: { open: true, name: 'Read-Name', startLabel: 'Read-Start', endLabel: 'Read-End', deadlineLabel: 'Read-Close' } },
  }), '/spinout-lab');
  assert.match(ok, /<img src="\/site\/lab-board-2\.webp" alt="" aria-hidden="true"/);
  assert.ok(existsSync(resolve(ROOT, 'frontend/public/site/lab-board-2.webp')));
  for (const [id, v] of [['hero-cohort', 'Read-Name'], ['hero-starts', 'Read-Start'], ['hero-ends', 'Read-End'], ['hero-applications-close', 'Read-Close']]) {
    assert.match(ok, new RegExp(`data-testid="${id}"[^>]*>${v}<`), `${id} shows the record's value`);
  }
  assert.match(ok, />Apply to the Read-Name cohort →</, 'the apply button names the cohort the record names');
  const failed = render(React.createElement(LabHero, { surface: 'public', applyHref: '/register', briefHref: '/b', cohort: { status: 'error', retry() {} } }));
  assert.equal((failed.match(/>Could not be read</g) || []).length, 4, 'a failed read is said, never filled');
  // The board's placeholders and sample cohort never ship.
  assert.doesNotMatch(code(LAB_SRC), /\{cohort\.(name|start_date|end_date|close_at|company_count)\}/, 'no board placeholder ships');
  for (const literal of ['Halyard', 'Verity Health', 'LoopSense', 'Kelp Bio', 'Meridian Robotics']) {
    assert.ok(!code(LAB_SRC).includes(literal), `the board's "${literal}" is not in the page`);
  }
});
