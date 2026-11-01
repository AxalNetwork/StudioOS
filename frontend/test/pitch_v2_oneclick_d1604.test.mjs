// D1604 (#3716, plan §3, §11 step 13) — "Generate from my data": the one-click
// run and the review it lands on.
//
// What this file holds the one-click to:
//   · the brief is the context read's (#3877's `inferred`, else `fast_path`),
//     never a literal `seed_fund` of the client's;
//   · the build shows honest progress: what it will write, the time so far,
//     and no Stop, because the synchronous build on main cannot stop;
//   · the missing-data cut: a card whose only content is "Not recorded on
//     StudioOS yet" is unticked, listed under "Left out · add data to
//     include" with where to record it, and keep-slides receives the kept
//     list, so a placeholder card never reaches Present; a partly empty card
//     keeps "Not recorded", never 0;
//   · the brand theme is part of the proposal, written only on Accept;
//   · "Accept all and present" lands on Present for the saved version;
//   · the images plan is `deckImagesApi.plan`, the one client method this
//     integration adds, on a route that is on main; each picture is a
//     proposal kept only on Accept.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_v2_oneclick_d1604.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import { newDeckApi } from '../src/lib/api/newDeck.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import OneClickBuild, { ProposalReview } from '../src/pages/raise/pitch/OneClickBuild.jsx';
import {
  ACCEPT_ALL_PRESENT, ACCEPT_LINE, ACCEPT_THEME_LINE, ALREADY_KEPT, LEFT_OUT, MISSING_PREFIX, SAVED_THEMED_LINE, acceptBody, buildingLine, defaultTicks, elapsedLine,
  flipTick, freshnessRows, imageAsk, imagesHold, imagesOffer, keptAlready, leftOut, readableOverlay, readyLine, reviewCards, themeChoices, themePick, themeToWrite,
} from '../src/pages/raise/pitch/oneClickModel.js';
import { CONTRAST_MIN, overlayContrast } from '../src/pages/raise/pitch/imageContrast.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const PITCH = 'frontend/src/pages/raise/pitch';

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends (synthetic)
 * ------------------------------------------------------------------ */

const ITEMS = [
  { source_key: 'grow.mrr', label: 'MRR', module: 'Grow › Revenue and traction', href: '/grow/revenue-and-traction?project=1', state: 'not_recorded' },
  { source_key: 'validate.competitors', label: 'Competitors', module: 'Validate › Market', href: '/validate/market?project=1', state: 'not_recorded' },
];
const metric = (id, label, value) => ({ id, kind: 'metric', grid: { c1: 1, c2: 4, r1: 2, r2: 4 }, label, value, binding: { source_key: 'grow.mrr', grade: value == null ? 'Not recorded' : 'Stated' } });
const heading = (text) => ({ id: 'h', kind: 'text', style: 'heading', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, text });
const SLIDES = [
  { title: 'Title', spec_id: 'new:title', blocks: [heading('Close the books in a day.')], fields: [] },
  // Partly empty: one figure recorded, one not.
  { title: 'Traction', spec_id: 'new:traction', blocks: [heading('Customers keep coming.'), metric('m1', 'Paying customers', '42'), metric('m2', 'MRR', null)],
    fields: [{ key: 'grow.mrr', label: 'MRR', kind: 'auto', source: 'placeholder', binding: { source_key: 'grow.mrr' } }] },
  // Nothing recorded: the Worker's not-recorded line is its only content.
  { title: 'Market', spec_id: 'new:market', blocks: [heading('A crowded market.'), { id: 'n', kind: 'text', style: 'paragraph', grid: { c1: 2, c2: 11, r1: 6, r2: 6 }, text: `${MISSING_PREFIX} Competitors.` }],
    fields: [{ key: 'validate.competitors', label: 'Competitors', kind: 'auto', source: 'placeholder', binding: { source_key: 'validate.competitors' } }] },
];
const PROPOSAL = { id: 77, base_deck_id: 9, slides: SLIDES, kept: null, outline: { audience: 'pre_seed_fund' } };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the missing-data cut: a not-recorded-only card is unticked and left out, with where to record it', () => {
  const cards = reviewCards(PROPOSAL, ITEMS);
  assert.deepEqual(cards.map((c) => [c.n, c.emptyOnly, c.partial]), [['01', false, false], ['02', false, true], ['03', true, false]]);
  assert.deepEqual(cards[2].gaps, [{ key: 'validate.competitors', label: 'Competitors', module: 'Validate › Market', href: '/validate/market?project=1' }]);
  // Mutation checked: tick every card by default → the market card is ticked and this fails.
  const ticks = defaultTicks(cards, PROPOSAL);
  assert.deepEqual([...ticks].sort(), [0, 1]);
  assert.deepEqual(leftOut(cards, ticks).map((c) => c.title), ['Market']);
  assert.deepEqual(acceptBody(ticks), { indexes: [0, 1], save: true }, 'keep-slides takes the kept list, saved in one press');
  assert.equal(acceptBody(new Set()), null, 'nothing ticked, nothing sent');
  // A card the founder already kept stays ticked, even with nothing recorded: keep-slides adds to what is kept.
  assert.deepEqual([...defaultTicks(cards, { kept: [2] })].sort(), [0, 1, 2]);
  // …and it cannot be unticked or left out: main's keep-slides merges the kept list with what is sent, so Accept saves it anyway.
  // Mutation checked: drop the lock in flipTick → card 2 unticks and is listed as left out; drop it in leftOut → listed.
  const locked = keptAlready({ kept: [2] });
  const kt = flipTick(defaultTicks(cards, { kept: [2] }), 2, locked);
  assert.ok(kt.has(2), 'an already kept card stays ticked');
  assert.deepEqual(leftOut(cards, new Set([0, 1]), locked), [], 'and is never left out');
  assert.deepEqual([...flipTick(new Set([0, 1]), 1)].sort(), [0], 'any other card flips');
  // A chart, a bound line or a recorded tile is content; a heading and a not-recorded line are not.
  const chart = reviewCards({ slides: [{ blocks: [heading('x'), { kind: 'chart' }, { kind: 'text', text: `${MISSING_PREFIX} y.` }] }] });
  assert.equal(chart[0].emptyOnly, false);
  assert.equal(readyLine(10, 2), 'Ready to present: 10 cards, 2 left out.');
  assert.equal(readyLine(1, 0), 'Ready to present: 1 card.');
});

test('the theme is part of the proposal: the version\'s, else the brand kit\'s, else Neutral light; written only when it differs', () => {
  assert.equal(themePick(null, { status: 'loading' }), null, 'no pick while the kit reads');
  assert.deepEqual(themePick({ kind: 'neutral_dark', background: null }, { status: 'ok', data: { kit: { palette: {} } } }).from, 'version', 'the version\'s theme wins');
  const kit = themePick(null, { status: 'ok', data: { kit: { palette: {} } } });
  assert.deepEqual([kit.from, kit.line, kit.theme.kind], ['kit', 'Theme: Brand · from your brand kit', 'brand']);
  assert.equal(themePick(null, { status: 'ok', data: { kit: null } }).line, 'Theme: Neutral light');
  assert.equal(themePick(null, { status: 'error' }).from, 'unread');
  assert.deepEqual(themeToWrite({ kind: 'brand' }, null), { kind: 'brand', background: null });
  assert.equal(themeToWrite({ kind: 'brand' }, { kind: 'brand' }), null, 'the same theme is not written again');
  assert.equal(themeToWrite({ kind: 'neutral_light' }, null), null, 'a version with no theme already draws Neutral light');
  // Change offers "From your brand kit" only when there is a kit behind it, or the version is Brand already.
  // Mutation checked: offer every kind → brand appears with no kit and this fails.
  assert.deepEqual(themeChoices({ status: 'ok', data: { kit: { palette: {} } } }, null), ['brand', 'neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest']);
  assert.deepEqual(themeChoices({ status: 'ok', data: { kit: null } }, null), ['neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest']);
  assert.deepEqual(themeChoices({ status: 'error', data: null }, null), ['neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest']);
  assert.deepEqual(themeChoices({ status: 'error', data: null }, { kind: 'brand' }), ['brand', 'neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest']);
});

test('#3877 freshness, the build line and the images plan read as drawn; a partial price is never a price', () => {
  const rows = freshnessRows({ freshness: [
    { provider: 'stripe', as_of: '2026-10-12', stale: true, sync: { method: 'POST', path: '/api/connectors/con_1/sync' } },
    { provider: 'github', as_of: null, stale: false, sync: { method: 'POST', path: 'https://evil.example/x' } },
  ] });
  assert.deepEqual(rows.map((r) => [r.line, r.uid]), [['Stripe · as of 12 Oct · out of date', 'con_1'], ['GitHub · never synced', null]]);
  assert.deepEqual(freshnessRows({}), [], 'a read without the field draws nothing: the client never guesses');
  assert.equal(buildingLine(12), 'Building 12 cards from your records.');
  assert.equal(buildingLine(null), 'Building your deck from your records.');
  assert.equal(elapsedLine(12_400), '12 s so far');
  assert.deepEqual(imagesOffer({ capability: { available: false, reason: 'Not on this deployment.' }, cards: [] }), { off: true, line: 'Not on this deployment.' });
  assert.equal(imagesOffer({ capability: { available: true }, cards: [] }), null);
  assert.equal(imagesOffer({ capability: { available: true }, cards: [{ index: 0 }] }).line, 'Add pictures to 1 card');
  assert.deepEqual(imageAsk({ index: 3, description: 'An illustration for: X', style: 'flat', palette: 'brand' }, { colours: ['#111111'] }),
    { use: 'card', description: 'An illustration for: X', style: 'flat', palette: 'brand', aspect: '16:9', count: 1, card: 3, points: [], colours: ['#111111'] });
  assert.equal(imagesHold([{ ai: true, total_microusd: 3000 }, { ai: true, total_microusd: 6000 }]), 'Holds up to $0.0090 · you pay what it uses');
  assert.equal(imagesHold([{ ai: true, total_microusd: 3000 }, { ai: false, total_microusd: 0 }]), null, 'one card unpriced: no sum is shown');
  assert.ok(overlayContrast(readableOverlay()) >= CONTRAST_MIN, 'the kept overlay reads at 4.5:1, as the Worker requires');
});

test('no literal brief and no Stop: the one-click reads its brief, and progress draws nothing it cannot do', () => {
  for (const f of ['PitchStudio.jsx', 'NewDeck.jsx', 'OneClickBuild.jsx', 'StudioHome.jsx', 'oneClickModel.js']) {
    assert.doesNotMatch(codeOnly(read(`${PITCH}/${f}`)), /'seed_fund'/, `${f}: no hard-coded audience`);
  }
  const one = codeOnly(read(`${PITCH}/OneClickBuild.jsx`));
  assert.match(one, /fastBrief\(ctx\)/, 'the brief is the context read\'s');
  const progress = codeOnly(read(`${PITCH}/BuildProgress.jsx`));
  assert.doesNotMatch(progress, /\bStop\b|Escape|'Esc'/, 'a press that cannot stop is not drawn');
  assert.match(progress, /availability\('batch'\)/, 'live rows wait on #3753 through the adapter');
});

test('deckImagesApi.plan is the one new client method, on a route that is on main', () => {
  assert.equal(typeof deckImagesApi.plan, 'function');
  assert.match(read('frontend/src/lib/api/deckImages.js'), /plan: \(deckId\) => request\(`\/decks\/\$\{enc\(deckId\)\}\/images\/plan`\)/);
  assert.match(read('cloudflare-worker/src/routes/deck_images.ts'), /deckImages\.get\('\/:id\/images\/plan'/);
  assert.doesNotMatch(read(`${PITCH}/deckV2Adapter.js`), /images\/plan|imagesPlan/, 'a route on main is not behind the adapter');
});

/* ------------------------------------------------------------------ *
 * The drawn one-click and review
 * ------------------------------------------------------------------ */

const ORIGINAL = { api: { ...api }, newDeck: { ...newDeckApi }, editor: { ...deckEditorApi }, images: { ...deckImagesApi } };

function Where() {
  const at = useLocation();
  return h('span', { 'data-testid': 'landed' }, `${at.pathname}${at.search}`);
}

async function mount(element, stubs = {}, url = '/raise/pitch/new?project_id=1') {
  const calls = [];
  const homes = { api, newDeck: newDeckApi, editor: deckEditorApi, images: deckImagesApi };
  for (const [key, fn] of Object.entries(stubs)) {
    const [home, name] = key.split('.');
    homes[home][name] = (...a) => { calls.push([key, ...a]); return fn(...a); };
  }
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const [path] = url.split('?');
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path, element }), h(Route, { path: '*', element: h(Where) }))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, settle, all: () => walk(container),
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    named: (name) => calls.filter(([k]) => k === name),
    async press(node) { assert.ok(node, 'the control is drawn'); await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    /** A press whose run does not answer yet: its promise is left pending. */
    async fire(node) { assert.ok(node, 'the control is drawn'); await act(async () => { pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async tick(node) { assert.ok(node, 'the box is drawn'); await act(async () => { pr(node).onChange?.({ target: {} }); }); await settle(); },
    async close() {
      await act(async () => root.unmount()); restore();
      Object.assign(api, ORIGINAL.api); Object.assign(newDeckApi, ORIGINAL.newDeck); Object.assign(deckEditorApi, ORIGINAL.editor); Object.assign(deckImagesApi, ORIGINAL.images);
    },
  };
}

const CTX = { audiences: [{ id: 'pre_seed_fund', label: 'Pre-seed fund' }], fast_path: { audience: 'pre_seed_fund', length: 'short' }, round: { uid: 'round-1' },
  standard: { short: [{ card: 'title', title: 'Title' }, { card: 'team', title: 'Team' }] } };

test('the one-click: Build says what it holds, shows the cards it will write while it runs, and lands on the review', async () => {
  let finish;
  const m = await mount(h(OneClickBuild, { projectId: 1, q: '?project_id=1', as: 'section' }), {
    'newDeck.context': async () => CTX,
    'newDeck.quote': async () => ({ ai: true, hold_microusd: 6000 }),
    'newDeck.build': () => new Promise((r) => { finish = r; }),
  }, '/raise/pitch?project_id=1');
  try {
    await m.press(m.by('pitch-studio-fast-build'));
    assert.match(m.text(m.by('pitch-studio-fast-hold')), /^Holds up to \$0\.0060 · you pay what it uses$/);
    // The live region is mounted with the dialog, empty, so the build's start is a change it announces.
    // Mutation checked: mount it only while busy (or with its text from the start) → this fails.
    const announce = m.by('pitch-studio-fast-announce');
    assert.ok(announce, 'the live region exists before the build');
    assert.deepEqual([m.pr(announce).role, m.pr(announce)['aria-live'], m.text(announce)], ['status', 'polite', '']);
    await m.fire(m.by('pitch-studio-fast-run'));
    assert.equal(m.text(m.by('pitch-studio-fast-announce')), 'Building 2 cards from your records.');
    // While the synchronous build runs: what it writes and the polite line; no Stop, no footer to press.
    const progress = m.by('pitch-build-progress');
    assert.ok(progress, 'BuildProgress while the build runs');
    // Mutation checked: put aria-busy back on the section → this fails (a busy ancestor holds the announcement).
    assert.equal(m.pr(progress)['aria-busy'], undefined, 'nothing holds the announcement back');
    assert.equal(m.pr(m.by('pitch-build-progress-line')).role, undefined, 'one live region, not two');
    assert.match(m.text(m.by('pitch-build-progress-line')), /^Building 2 cards from your records\.$/);
    assert.match(m.text(m.by('pitch-build-progress-cards')), /01 Title 02 Team/);
    assert.ok(!m.all().some((n) => n.tagName === 'BUTTON' && /\bStop\b/.test(n.textContent || '')), 'no Stop on main');
    assert.match(m.text(m.by('pitch-build-progress-live-later')), /Live progress per card Coming later/);
    const [, body, headers] = m.named('newDeck.build')[0];
    // Mutation checked: drop round_ref from the build body → this fails.
    assert.deepEqual(body, { project_id: 1, one_click: true, audience: 'pre_seed_fund', length: 'short', round_ref: 'round-1' }, 'the read\'s brief and round, nothing guessed; D1509: the press names itself so grid_generate can stop it');
    assert.equal(m.named('newDeck.quote')[0][1].round_ref, 'round-1', 'the quote prices the same build');
    assert.equal(headers['X-Rail-Option'], encodeURIComponent('deck:build'));
    await act(async () => { finish({ proposal: { id: 77 } }); });
    await m.settle();
    assert.equal(m.text(m.by('landed')), '/raise/pitch/new?project_id=1&proposal=77', 'the review of the proposal');
  } finally { await m.close(); }
});

test('the review: the cut, Left out with its links, the brand theme named and written only on Accept, and Accept all and present', async () => {
  const m = await mount(h(ProposalReview, { projectId: 1, q: '?project_id=1', proposal: PROPOSAL, items: ITEMS, versions: [{ id: 9, theme: null }], audience: 'Pre-seed fund' }), {
    'editor.brandKit': async () => ({ project_id: 1, kit: { palette: { bg: '#ffffff', ink: '#101010', accent: '#5b21b6' } } }),
    'newDeck.keepSlides': async (_id, b) => ({ deck: { id: 12, version: 4, title: 'Pitch deck', slides: b.indexes.map((i) => SLIDES[i]), theme: null }, kept: b.indexes }),
    'api.deckUpdate': async (id, b) => ({ id: 13, version: 5, title: b.title, slides: b.slides, theme: b.theme }),
  });
  try {
    assert.match(m.text(m.by('pitch-review-theme')), /^Theme: Brand · from your brand kit Change/);
    assert.match(m.text(m.by('pitch-review-ready')), /^Ready to present: 2 cards, 1 left out\.$/);
    assert.equal(m.pr(m.by('pitch-review-tick-2')).checked, false, 'the not-recorded-only card starts unticked');
    const left = m.by('pitch-review-left-out');
    assert.equal(m.pr(left)['aria-label'], LEFT_OUT);
    assert.match(m.text(left), /03 Market Add Competitors in Validate › Market ›/);
    assert.ok(m.all().some((n) => n.tagName === 'A' && m.pr(n).href === '/validate/market?project=1'), 'Add in … opens the module');
    // A partly empty card keeps its Not recorded tile, never 0.
    assert.match(m.text(m.by('pitch-review-partial-1')), /reads Not recorded on StudioOS ?, never 0/);
    assert.match(m.text(m.by('pitch-review-blocks-1')), /Not recorded/);
    assert.doesNotMatch(m.text(m.by('pitch-review-blocks-1')), /MRR\s*0\b/);
    assert.deepEqual(m.calls.filter(([k]) => k !== 'editor.brandKit'), [], 'nothing is written before Accept');
    // The theme write saves one more version, and the review says so before the press.
    // Mutation checked: keep ACCEPT_LINE when a theme will be written → this fails.
    assert.equal(m.text(m.by('pitch-review-accept-line')), ACCEPT_THEME_LINE);
    await m.press(m.by('pitch-review-accept-present'));
    // Mutation checked: send every card (or `all: true`) → the kept list is [0, 1, 2] and this fails.
    assert.deepEqual(m.named('newDeck.keepSlides')[0].slice(1), [77, { indexes: [0, 1], save: true }]);
    const [, id, body] = m.named('api.deckUpdate')[0];
    assert.equal(id, 12);
    assert.deepEqual(body.theme, { kind: 'brand', background: null }, 'the theme the review named');
    assert.equal(body.slides.length, 2, 'the saved cards, unchanged');
    assert.equal(m.text(m.by('landed')), '/raise/pitch/present?project_id=1&deck=13', 'Present on the version Accept saved');
    assert.ok(m.text().length > 0 && ACCEPT_ALL_PRESENT === 'Accept all and present');
  } finally { await m.close(); }
});

test('the review: the version\'s own theme is kept and nothing more is written; a card ticked back is kept', async () => {
  const m = await mount(h(ProposalReview, { projectId: 1, q: '?project_id=1', proposal: PROPOSAL, items: ITEMS, versions: [{ id: 9, theme: { kind: 'neutral_dark', background: null } }] }), {
    'editor.brandKit': async () => ({ project_id: 1, kit: null }),
    'newDeck.keepSlides': async (_id, b) => ({ deck: { id: 12, version: 4, title: 'Pitch deck', slides: b.indexes.map((i) => SLIDES[i]), theme: { kind: 'neutral_dark' } } }),
    'api.deckUpdate': async () => { throw new Error('not expected'); },
    'images.plan': async () => ({ capability: { available: false, reason: 'Image generation is not available on this deployment.' }, cards: [] }),
  });
  try {
    assert.match(m.text(m.by('pitch-review-theme')), /^Theme: Neutral dark · as on your current version/);
    const options = m.all().filter((n) => n.tagName === 'OPTION').map((n) => m.pr(n).value);
    assert.deepEqual(options, ['neutral_light', 'neutral_dark', 'sand', 'ocean', 'forest'], 'no brand kit, so no brand theme is offered');
    assert.equal(m.text(m.by('pitch-review-accept-line')), ACCEPT_LINE, 'no theme to write: one version');
    await m.tick(m.by('pitch-review-tick-2'));
    assert.match(m.text(m.by('pitch-review-ready')), /^Ready to present: 3 cards\.$/);
    assert.ok(!m.by('pitch-review-left-out'));
    await m.press(m.by('pitch-review-accept'));
    assert.deepEqual(m.named('newDeck.keepSlides')[0][2], { indexes: [0, 1, 2], save: true });
    assert.equal(m.named('api.deckUpdate').length, 0, 'the same theme is not written again');
    assert.match(m.text(m.by('pitch-review-saved')), /Saved as v4\./);
    assert.match(m.text(m.by('pitch-images-off')), /not available on this deployment/, 'the Worker\'s own reason, never an offer it cannot keep');
  } finally { await m.close(); }
});

test('pictures after Accept: the plan, one summed hold, each picture a proposal, kept as card backgrounds only on Accept all', async () => {
  const plan = { capability: { available: true }, direction: { colours: ['#5b21b6'] }, cards: [{ index: 0, card: 'title', description: 'An illustration for: Close the books', style: 'flat', palette: 'brand', use: 'card' }] };
  const m = await mount(h(ProposalReview, { projectId: 1, q: '?project_id=1', proposal: PROPOSAL, items: ITEMS, versions: [{ id: 9, theme: { kind: 'brand' } }] }), {
    'editor.brandKit': async () => ({ project_id: 1, kit: { palette: {} } }),
    'newDeck.keepSlides': async (_id, b) => ({ deck: { id: 12, version: 4, title: 'Pitch deck', slides: b.indexes.map((i) => SLIDES[i]), theme: { kind: 'brand' } } }),
    'images.plan': async () => plan,
    'images.quote': async () => ({ ai: true, total_microusd: 3000, per_image_microusd: 3000, count: 1 }),
    'images.generate': async () => ({ images: [{ uid: 'img1', url: 'https://img.example/1.png', overlay: 'light', alt: '' }] }),
    'images.keep': async (uid, b) => ({ image: { uid, url: 'https://img.example/1.png', overlay: b.overlay } }),
    'api.deckUpdate': async (id, b) => ({ id: 14, version: 5, title: b.title, slides: b.slides }),
  });
  try {
    // Mutation checked: read the plan of the base version while the review is open → a call is recorded here and this fails.
    assert.equal(m.named('images.plan').length, 0, 'the images plan is read only after Accept');
    await m.press(m.by('pitch-review-accept'));
    assert.deepEqual(m.named('images.plan')[0].slice(1), [12], 'the plan of the version Accept saved');
    assert.match(m.text(m.by('pitch-images-offer')), /Add pictures to 1 card/);
    assert.equal(m.named('images.quote').length, 0, 'nothing is priced until asked');
    await m.press(m.by('pitch-images-price'));
    assert.equal(m.text(m.by('pitch-images-hold')), 'Holds up to $0.0030 · you pay what it uses');
    await m.press(m.by('pitch-images-generate'));
    const [, deckId, ask, headers] = m.named('images.generate')[0];
    assert.equal(deckId, 12);
    assert.deepEqual([ask.use, ask.card, ask.colours], ['card', 0, ['#5b21b6']]);
    assert.equal(headers['X-Rail-Option'], encodeURIComponent('deck:image'));
    assert.ok(m.by('pitch-images-proposed'));
    assert.equal(m.named('images.keep').length, 0, 'a drawn picture is a proposal until Accept');
    await m.press(m.by('pitch-images-accept'));
    assert.deepEqual(m.named('images.keep')[0].slice(1), ['img1', { use: 'card', overlay: readableOverlay() }]);
    const saved = m.named('api.deckUpdate')[0][2];
    assert.equal(saved.slides[0].background.image_url, 'https://img.example/1.png');
    assert.match(m.text(m.by('pitch-images-done')), /saved as v5/);
  } finally { await m.close(); }
});

test('the review: a card the proposal already kept is locked in, never offered as left out', async () => {
  const m = await mount(h(ProposalReview, { projectId: 1, q: '?project_id=1', proposal: { ...PROPOSAL, kept: [2] }, items: ITEMS, versions: [{ id: 9, theme: { kind: 'neutral_light' } }] }), {
    'editor.brandKit': async () => ({ project_id: 1, kit: null }),
    'newDeck.keepSlides': async (_id, b) => ({ deck: { id: 12, version: 4, title: 'Pitch deck', slides: SLIDES, theme: { kind: 'neutral_light' } } }),
    'images.plan': async () => ({ capability: { available: true }, cards: [] }),
  });
  try {
    const box = m.by('pitch-review-tick-2');
    // Mutation checked: drop `disabled={fixed}` → this fails; drop the lock in flipTick → the tick below unticks it and fails.
    assert.deepEqual([m.pr(box).checked, m.pr(box).disabled], [true, true], 'checked and not togglable');
    assert.equal(m.text(m.by('pitch-review-kept-2')), ALREADY_KEPT);
    await m.tick(box);
    assert.equal(m.pr(m.by('pitch-review-tick-2')).checked, true, 'an untick does not take');
    assert.ok(!m.by('pitch-review-left-out'), 'not listed under Left out');
    assert.match(m.text(m.by('pitch-review-ready')), /^Ready to present: 3 cards\.$/);
    // Any other card still unticks and is listed.
    await m.tick(m.by('pitch-review-tick-1'));
    assert.match(m.text(m.by('pitch-review-left-out')), /02 Traction/);
    assert.doesNotMatch(m.text(m.by('pitch-review-left-out')), /03 Market/);
  } finally { await m.close(); }
});

test('the review: a theme write is one more version, and the saved line names both', async () => {
  const m = await mount(h(ProposalReview, { projectId: 1, q: '?project_id=1', proposal: PROPOSAL, items: ITEMS, versions: [{ id: 9, theme: null }] }), {
    'editor.brandKit': async () => ({ project_id: 1, kit: { palette: {} } }),
    'newDeck.keepSlides': async (_id, b) => ({ deck: { id: 12, version: 4, title: 'Pitch deck', slides: b.indexes.map((i) => SLIDES[i]), theme: null } }),
    'api.deckUpdate': async (id, b) => ({ id: 13, version: 5, title: b.title, slides: b.slides, theme: b.theme }),
    'images.plan': async () => ({ capability: { available: true }, cards: [] }),
  });
  try {
    await m.press(m.by('pitch-review-accept'));
    assert.equal(m.named('api.deckUpdate').length, 1);
    // Mutation checked: SAVED_LINE after a theme write → "Saved as v5. It is now…" and this fails.
    assert.equal(m.text(m.by('pitch-review-saved-line')), SAVED_THEMED_LINE(4, 5));
    assert.match(SAVED_THEMED_LINE(4, 5), /v4 holds the same cards in the earlier theme/);
  } finally { await m.close(); }
});
