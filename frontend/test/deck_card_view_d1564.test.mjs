/**
 * D1564 (#3811, deck builder v2 D3) — the read-only responsive card view of a
 * shared deck, the email gate, and the one publish control.
 *
 * What this file holds the frontend to:
 *   · the 390 px check: one column, a 16 px gutter, nothing fixed wider than
 *     the screen less its gutters, pictures and charts in a scaling 16:9 box,
 *     a table scrolling inside its card, 44 px targets; and the share reader
 *     opens on the card view at phone width;
 *   · no "Not recorded" and no source or grade badge: a block cut for missing
 *     data stays out, and a card left with nothing stays out; the compliance
 *     footnote and Confidential stay on (owner decision T);
 *   · the publish control lives only in ShareDialog, says public pages are off
 *     until counsel's wording, has no default exemption, and does not publish
 *     a 506(b) round.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_card_view_d1564.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import DeckCardView from '../src/pages/raise/pitch/DeckCardView.jsx';
import PublishPanel, { EXEMPTION_506B_NOTE, PUBLIC_OFF, embedUrl, originsOf, whatPublishDoes } from '../src/pages/raise/pitch/PublishPanel.jsx';
import { EmailGate } from '../src/pages/raise/pitch/ShareViewerParts.jsx';
import { GUTTER, PHONE_WIDTH, blockHasData, cardViewCards } from '../src/pages/raise/pitch/cardViewModel.js';
import { deckPublishApi } from '../src/lib/api/deckPublish.js';
import { NOT_RECORDED } from '../src/lib/absence.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const binding = { source_key: 'revenue.mrr', grade: 'Verified', as_of: '2026-10-01', label: 'Stripe' };
const DECK = {
  id: 40, version: 4,
  compliance: { confidential: true, footnotes: [[], ['Forward-looking projection from the venture’s own model. It is not a result and may not be achieved.'], [], []] },
  slides: [
    { title: 'Kestrel Labs', blocks: [
      { id: 'h', kind: 'text', style: 'heading', text: 'Kestrel Labs', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
      { id: 'img', kind: 'image', image_url: 'https://img.example.test/cover.png', alt: 'Cover', grid: { c1: 7, c2: 12, r1: 2, r2: 6 } },
      { id: 'gone-img', kind: 'image', image_url: null, grid: { c1: 1, c2: 6, r1: 2, r2: 3 } },
    ] },
    { title: 'Traction', blocks: [
      { id: 'mrr', kind: 'metric', label: 'MRR', value: '$42k', binding, grid: { c1: 1, c2: 3, r1: 2, r2: 2 } },
      { id: 'churn', kind: 'metric', label: 'Churn', value: null, binding, grid: { c1: 4, c2: 6, r1: 2, r2: 2 } },
      { id: 'typed', kind: 'metric', label: 'Customers', value: '38', grid: { c1: 7, c2: 9, r1: 2, r2: 2 } },
      { id: 'tbl', kind: 'table', rows: [
        ['Year', 'Revenue', 'Customers', 'Churn', 'Margin', 'Burn', 'Runway'].map((text) => ({ text })),
        [...['2025', '$1.2M', '38', '2%', '61%', '$90k'].map((text) => ({ text })), { binding }],
      ], grid: { c1: 1, c2: 12, r1: 3, r2: 4 } },
      { id: 'chart', kind: 'chart', chart_type: 'bar', series: [{ binding, points: [{ x: '2026-01', y: 1 }, { x: '2026-02', y: 2 }] }], grid: { c1: 1, c2: 12, r1: 5, r2: 6 } },
      { id: 'nochart', kind: 'chart', chart_type: 'bar', series: [{ label: 'Empty', points: [] }], grid: { c1: 1, c2: 6, r1: 1, r2: 1 } },
    ] },
    // Every block cut for missing data: the card stays out.
    { title: 'Team', blocks: [
      { id: 'm0', kind: 'metric', label: 'Hires', value: '', grid: { c1: 1, c2: 3, r1: 1, r2: 1 } },
      { id: 't0', kind: 'text', text: '   ', grid: { c1: 4, c2: 6, r1: 1, r2: 1 } },
      { id: 'c0', kind: 'chart', chart_type: 'market_circles', series: [{ points: [] }], grid: { c1: 7, c2: 9, r1: 1, r2: 1 } },
    ] },
    // A fielded card: its unfilled field is left out, never "Not recorded".
    { title: 'Market', fields: [
      { key: 'market_body', label: 'Market', kind: 'paragraph', value: 'Fintech teams reconcile by hand.', source: 'data' },
      { key: 'market_size', label: 'Market size', kind: 'paragraph', value: '', source: 'placeholder' },
      { key: 'figs', label: 'Figures', kind: 'metric_grid', value: [{ label: 'TAM', value: '' }, { label: 'SAM', value: '$2B' }], source: 'data' },
    ] },
  ],
};

const html = () => renderToStaticMarkup(h(DeckCardView, { deck: DECK, watermark: 'Prepared for Pat Partner · Fund A' }));
const classesIn = (markup) => [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);

/** A screen `width` wide: every `(max-width: N)` query answers as a browser would. */
function screen(width) {
  const was = globalThis.matchMedia;
  globalThis.matchMedia = (query) => {
    const m = /max-width:\s*(\d+)/.exec(query);
    return { matches: m ? width <= Number(m[1]) : false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  return () => { globalThis.matchMedia = was; };
}

test('the 390 px check: one column, a 16 px gutter, nothing wider than the screen, scaling media, scrolling tables, 44 px targets', () => {
  assert.equal(PHONE_WIDTH, 390);
  assert.equal(GUTTER, 16);
  const markup = html();
  const classes = classesIn(markup);
  const room = PHONE_WIDTH - 2 * GUTTER;
  // The column: full width, a 16 px (px-4) gutter, a cap that only binds on wider screens.
  assert.match(markup, /^(?:<link [^>]*\/>)*<div class="[^"]*\bw-full\b[^"]*\bpx-4\b[^"]*" data-testid="deck-card-view"/);
  // Nothing fixed wider than the room inside the gutters: no w-/min-w-[Npx], no inline px width.
  for (const c of classes) {
    const m = /^(?:min-w|w|basis)-\[(\d+)px\]$/.exec(c);
    if (m) assert.ok(Number(m[1]) <= room, `${c} is wider than ${room}px`);
    assert.ok(!/^(?:grid-cols-(?:[2-9]|1[0-2])|columns-)/.test(c), `${c} would set cards side by side at 390`);
  }
  assert.ok(!/style="[^"]*\bwidth:\s*\d{3,}px/.test(markup), 'no inline width in pixels');
  assert.ok(!/style="[^"]*position:absolute/.test(markup.replace(/<div class="relative aspect-video[\s\S]*?<\/div>/g, '')), 'no absolute placement outside a media box');
  // Pictures and charts sit in a 16:9 box that scales with the width.
  for (const id of ['img', 'chart']) assert.match(markup, new RegExp(`<div class="relative aspect-video w-full max-w-full[^"]*" data-testid="card-view-block-${id}"`));
  // A wide table scrolls inside its card instead of widening the page.
  assert.match(markup, /<div class="w-full max-w-full overflow-x-auto" data-testid="card-view-block-tbl"><table/);
  // Text wraps; no card refuses to shrink.
  assert.match(markup, /class="w-full min-w-0 max-w-full break-words" data-testid="card-view-block-h"/);
  assert.ok(classes.includes('min-w-0'));
  // The reader's controls at phone width: the view switch and the email gate are 44 px targets.
  const reader = read('frontend/src/pages/PitchDeckPrintPage.jsx');
  assert.match(reader, /min-h-\[44px\][^"]*"\s*\n?\s*data-testid="share-view-toggle"/);
  const gate = renderToStaticMarkup(h(EmailGate, { token: 'tok', gate: { project_name: 'Kestrel Labs', frozen: { version: 4 } } }));
  assert.match(gate, /class="min-h-\[44px\][^"]*" maxLength="254" data-testid="share-email-input"|class="min-h-\[44px\][^"]*"[^>]*data-testid="share-email-input"/);
  assert.match(gate, /min-h-\[44px\][^"]*"[^>]*data-testid="share-email-submit"/);
  // The reader opens on the card view at phone width (its media query, answered at 390).
  const back = screen(390);
  try {
    const q = /window\.matchMedia\(`\(max-width: \$\{PHONE_WIDTH \+ (\d+)\}px\)`\)/.exec(reader);
    assert.ok(q, 'the reader asks a max-width query built on PHONE_WIDTH');
    assert.equal(globalThis.matchMedia(`(max-width: ${PHONE_WIDTH + Number(q[1])}px)`).matches, true, 'a 390 px screen opens on cards');
    assert.equal(globalThis.matchMedia('(max-width: 1023px)').matches, true);
  } finally { back(); }
  const desk = screen(1280);
  try {
    const q = /PHONE_WIDTH \+ (\d+)/.exec(reader);
    assert.equal(globalThis.matchMedia(`(max-width: ${PHONE_WIDTH + Number(q[1])}px)`).matches, false, 'a desktop opens on the 16:9 slides');
  } finally { desk(); }
});

test('no "Not recorded" and no source or grade badge: cut blocks and empty cards stay out; the compliance chrome stays', () => {
  const markup = html();
  const text = renderedText(markup);
  assert.ok(!text.includes(NOT_RECORDED), 'no Not recorded placeholder');
  for (const badge of ['Verified', 'Stripe', 'revenue.mrr', 'Stated', 'Source']) assert.ok(!text.includes(badge), `no "${badge}" badge`);
  assert.ok(!/deck-block-face-/.test(markup), 'no tile face line');
  // Cut: an image with no picture, a metric with no figure, a chart with no point, the whole Team card.
  for (const id of ['gone-img', 'churn', 'nochart', 'm0', 't0', 'c0']) assert.ok(!markup.includes(`card-view-block-${id}"`), `${id} stays out`);
  assert.ok(!markup.includes('deck-card-view-card-2"'), 'a card left with nothing stays out');
  // Kept, each where it was.
  for (const id of ['h', 'img', 'mrr', 'typed', 'tbl', 'chart']) assert.ok(markup.includes(`card-view-block-${id}"`), `${id} is drawn`);
  assert.match(text, /\$42k/);
  // The chart series is named by its label, never its source key.
  assert.match(text, /Series: 2026-01 1/);
  // The fielded card: its paragraph and its recorded figure; the unfilled field and TAM are left out.
  assert.match(text, /Fintech teams reconcile by hand\./);
  assert.match(text, /SAM\$2B/);
  assert.ok(!/TAM/.test(text));
  // T: the footnote stays on, keyed to the card's place in the version; Confidential on every card; the watermark.
  assert.match(markup, /data-testid="deck-card-view-footnote-1">Forward-looking projection/);
  assert.equal((markup.match(/data-testid="deck-card-view-confidential-/g) || []).length, 3);
  assert.equal((markup.match(/Prepared for Pat Partner · Fund A/g) || []).length, 3);
  // The model, block by block.
  assert.equal(blockHasData({ kind: 'link', url: 'javascript:alert(1)' }), false);
  assert.equal(blockHasData({ kind: 'video', url: 'https://v.example.test/x' }), true);
  assert.equal(blockHasData({ kind: 'table', rows: [[{ text: '' }], [{ text: '' }]] }), false);
  assert.deepEqual(cardViewCards({ slides: [{ blocks: [{ kind: 'table', rows: [[{ text: 'A' }], [{ binding }]] }] }] }), [], 'a table whose only figure is a source key stays out');
  assert.equal(blockHasData({ kind: 'mystery' }), false);
  assert.deepEqual(cardViewCards({ slides: [{ blocks: [{ kind: 'metric', label: 'X', value: null }] }] }), []);
  const nothing = renderedText(renderToStaticMarkup(h(DeckCardView, { deck: { slides: [] } })));
  assert.ok(!nothing.includes(NOT_RECORDED));
  // The card view draws through BlockView, live, with sources off.
  assert.match(read('frontend/src/pages/raise/pitch/DeckCardView.jsx'), /<BlockView block=\{block\} colours=\{COLOURS\} live sources=\{false\}/);
});

/** Every source file under frontend/src. */
function sources(dir = resolve(root, 'frontend/src')) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(jsx?|tsx?)$/.test(n) ? [p] : [];
  });
}

test('the publish control lives only in ShareDialog (Share ▾ › Share link…), never in the header', () => {
  const users = sources().filter((p) => /from '\.\/PublishPanel(?:\.jsx)?'/.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length + 1));
  assert.deepEqual(users, ['frontend/src/pages/raise/pitch/ShareDialog.jsx']);
  const savers = sources().filter((p) => /deckPublishApi\.save\(/.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length + 1));
  assert.deepEqual(savers, ['frontend/src/pages/raise/pitch/PublishPanel.jsx']);
  for (const header of ['DeckToolbar.jsx', 'StudioActions.jsx', 'DeckMoreMenu.jsx']) {
    assert.ok(!/Publish/.test(read(`frontend/src/pages/raise/pitch/${header}`)), `${header} draws no publish control`);
  }
  // It sits on the link just made, under the link and Copy.
  assert.match(read('frontend/src/pages/raise/pitch/ShareDialog.jsx'), /<PublishPanel deck=\{deck\} made=\{made\} \/>/);
});

async function mountPanel(answers) {
  const saved = { read: deckPublishApi.read, save: deckPublishApi.save };
  const calls = [];
  deckPublishApi.read = async (...a) => { calls.push(['read', ...a]); return answers.read(...a); };
  deckPublishApi.save = async (...a) => { calls.push(['save', ...a]); return answers.save(...a); };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(PublishPanel, { deck: { id: 40 }, made: { id: 91, share_path: '/share/deck/tok.abc' } })); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr,
    text: () => text(container).replace(/\s+/g, ' '),
    async change(id, value) { await act(async () => { pr(by(id)).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async press(id) { await act(async () => { await pr(by(id)).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => rootEl.unmount()); restore(); deckPublishApi.read = saved.read; deckPublishApi.save = saved.save; },
  };
}

const OFF = { link_id: 91, publish: null, gate: null, public_views: false, note: PUBLIC_OFF };

test('the panel says public pages are off until counsel\'s wording, has no default exemption, and does not publish 506(b)', async () => {
  const m = await mountPanel({
    read: async () => OFF,
    save: async (_d, _s, body) => ({ ...OFF, publish: { on: true, gate: 'email', exemption: body.exemption, embed_origins: body.embed_origins, at: 'x' }, gate: 'email' }),
  });
  try {
    assert.deepEqual(m.calls[0], ['read', 40, 91]);
    assert.match(m.text(), /Public pages are off until counsel's wording is in\./);
    assert.equal(m.pr(m.by('pitch-publish-gate')).checked, true, 'the email gate is on');
    assert.equal(m.pr(m.by('pitch-publish-gate')).disabled, true, 'and cannot be turned off while public pages are off');
    assert.equal(m.pr(m.by('pitch-publish-save')).disabled, true, 'no exemption is chosen for the founder');
    await m.change('pitch-publish-exemption-506b', true);
    assert.equal(m.pr(m.by('pitch-publish-save')).disabled, true, 'a 506(b) round does not publish');
    assert.match(m.text(), new RegExp(EXEMPTION_506B_NOTE.replace(/[()]/g, '\\$&')));
    assert.equal(m.calls.filter((c) => c[0] === 'save').length, 0, 'nothing is written');
    await m.change('pitch-publish-exemption-506c', true);
    await m.change('pitch-publish-origins', 'https://partner.example.test');
    assert.match(m.text(), /after giving their email\. It can be embedded on one site\./);
    await m.press('pitch-publish-save');
    assert.deepEqual(m.calls.at(-1), ['save', 40, 91, { on: true, exemption: '506c', gate: 'email', embed_origins: ['https://partner.example.test'] }]);
    assert.ok(m.by('pitch-publish-on'));
    assert.match(m.pr(m.by('pitch-publish-embed')).children, /<iframe src="\/embed\/tok\.abc"/);
  } finally { await m.unmount(); }
});

test('a refusal is shown in the Worker\'s words; an unread state offers Try again', async () => {
  const refused = Object.assign(new Error('409'), { status: 409, data: { error: 'exemption_506b', message: 'A 506(b) round cannot be published: Rule 506(b) allows no general solicitation. Share it one investor at a time.' } });
  const m = await mountPanel({ read: async () => OFF, save: async () => { throw refused; } });
  try {
    await m.change('pitch-publish-exemption-506c', true);
    await m.press('pitch-publish-save');
    assert.match(m.text(), /allows no general solicitation/);
  } finally { await m.unmount(); }
  const u = await mountPanel({ read: async () => { throw new Error('down'); }, save: async () => OFF });
  try {
    assert.ok(u.by('pitch-publish-unread'));
    assert.ok(u.by('pitch-publish-retry'));
    assert.ok(!/Not recorded|\b0\b/.test(u.text()));
  } finally { await u.unmount(); }
  assert.deepEqual(originsOf('https://a.test, https://b.test\nhttps://c.test'), ['https://a.test', 'https://b.test', 'https://c.test']);
  assert.equal(embedUrl({ share_path: '/share/deck/tok.abc' }, 'https://axal.vc'), 'https://axal.vc/embed/tok.abc');
  assert.equal(embedUrl({ share_path: '/elsewhere' }, 'https://axal.vc'), null);
  assert.equal(whatPublishDoes({ exemption: null, origins: '' }), 'Say which exemption the round is offered under before publishing.');
});

test('the embed page and the email gate are wired: /embed/:token is public, and the reader answers gate "email" before any card', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/embed\/:token" element=\{<DeckEmbedPage \/>\} \/>/);
  assert.match(read('frontend/src/lib/api.js'), /currentPath\.startsWith\('\/embed\/'\)/);
  const reader = read('frontend/src/pages/PitchDeckPrintPage.jsx');
  assert.ok(reader.indexOf("deck.gate === 'email'") < reader.indexOf("deck.gate === 'nda'"));
  const embed = read('frontend/src/pages/DeckEmbedPage.jsx');
  assert.match(embed, /deck\.gate === 'email'\) return <EmailGate/);
  assert.match(embed, /<DeckCardView deck=\{deck\}/);
});
