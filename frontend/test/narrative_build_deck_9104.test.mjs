/**
 * D9104 (#9104, RAN-24 part 1) — Build a deck from a saved narrative version:
 * the entry (Story's Share ▾, the Versions table's Deck cell, NoVersion's line)
 * and the confirm (RAN24b), which reads the deck outline only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_build_deck_9104.test.mjs
 *
 * What this file holds the pages to (the issue's acceptance criteria):
 *   · the model: the Deck cell for the newest, an older and no version; the
 *     "not current" line with and without a current deck; the price line; the
 *     left-out line; and the adapter's answer as a state (available,
 *     unreadable, a 403, and the 404 `through` turns into `available: false`);
 *   · opening the confirm calls only `POST /api/decks/narrative/outline`, never
 *     the build, and focus opens on its title and goes back to the row button;
 *   · a 403 and a 404 are the refused state, never "Coming later"; an
 *     unreadable outline says nothing was charged and shows no price;
 *   · the Versions tab draws the Deck column for an editor and not read only,
 *     and NoVersion draws the Save-first line for an editor only;
 *   · Story's Share ▾ offers Build a deck to the founder; an admin keeps Copy
 *     text only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { withNarrativeCapabilities } from './_narrative_capabilities.mjs';
import { NarrativeTabPage } from '../src/pages/raise/narrative/NarrativeTool.jsx';
import BuildDeckDialog from '../src/pages/raise/narrative/BuildDeckDialog.jsx';
import {
  NEWEST_ONLY, NO_CARDS_LINE, NO_VERSION_LINE, PRICE_LOADING, REFUSED_TITLE, SAVE_FIRST, UNREADABLE_LINE, UNREADABLE_TITLE,
  canContinue, deckEntry, noVersionLine, outlineLine, outlineState, priceLine, readByChange, savesView, shareItems, studioHref, versionDrift,
} from '../src/pages/raise/narrative/buildDeckModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// The Worker's shapes; invented words and figures.
const OUTLINE = {
  project_id: 1, narrative: { version: 5, ref: 'narrative_version_meta:v5', reason: null, dropped: {} },
  stage: 'seed', stage_label: 'Seed', stage_source: 'profile',
  cards: Array.from({ length: 11 }, (_, i) => ({ card: `c${i}`, uid: `u${i}`, title: `Card ${i + 1}`, areas: [] })),
  left_out: [{ card: 'closing', title: 'Closing line', line: 'Closing line not evidenced' }], warnings: [],
  theme: null, template: null, quote: { class: 'deck_build', quote_uid: 'q1', expires_at: null, hold_microusd: 840000, areas: [], runs: 11, refused: [] },
};
const DECKS = { versions: [{ id: 61, version: 6, is_current: 1 }, { id: 50, version: 5, is_current: 0 }] };
const SAVED = [{ value: '5', label: 'v5 · seed fund' }, { value: '4', label: 'v4 · seed fund' }, { value: '3', label: 'v3 · angel' }];
const ROWS = SAVED.map((v) => ({ version: Number(v.value), audience: 'Seed fund', based_on: `v${Number(v.value) - 1}`, saved: '2026-11-12', by: 'Fay Founder', read_by: v.value === '4' ? { deck_version: 6, cards: [1, 2] } : null }));

test('1. the model: the Deck cell for the newest, an older and a read-only row; NoVersion\'s line; the Share items', () => {
  assert.deepEqual(deckEntry('5', 5), { kind: 'build', label: 'Build a deck from v5' });
  const older = deckEntry('4', 5, { search: '?project_id=1' });
  assert.equal(older.kind, 'older');
  assert.equal(older.tag, 'Builds from v5, the newest, until older versions can be chosen');
  assert.equal(older.open, 'Open v5');
  assert.equal(older.href, '/raise/investor-narrative/5?project_id=1');
  assert.equal(deckEntry('5', 5, { readOnly: true }), null);
  assert.equal(deckEntry('5', null), null);
  assert.equal(noVersionLine(false), 'Build a deck from the narrative: Save a version first.');
  assert.equal(noVersionLine(true), null);
  assert.deepEqual(shareItems({ exportAs: 'founder', newest: '5' }).map((i) => i.label), ['Copy or export…', 'Build a deck from v5…']);
  assert.deepEqual(shareItems({ exportAs: 'founder', newest: '5', phone: true }).map((i) => i.label), ['Copy text', 'Build a deck from v5']);
  assert.deepEqual(shareItems({ exportAs: 'admin', newest: '5' }), []);
  assert.deepEqual(shareItems({ exportAs: null, newest: '5' }), []);
  assert.equal(studioHref(12), '/raise/pitch/new?project_id=12&from=narrative');
});

test('2. the model: what it saves, with and without a current deck; the price; the outline and left-out line; the drift', () => {
  assert.equal(savesView({ status: 'ready', data: DECKS }).line, 'A new deck version, Pitch deck v7, not current. Pitch deck v6 stays current.');
  assert.equal(savesView({ status: 'ready', data: DECKS }).next, 7);
  assert.equal(savesView({ status: 'ready', data: { versions: [] } }).line, 'A new deck version, Pitch deck v1, not current. You have no current deck yet.');
  assert.equal(savesView({ status: 'ready', data: { versions: [{ version: 2, is_current: 0 }] } }).line, 'A new deck version, Pitch deck v3, not current. You have no current deck yet.');
  assert.equal(savesView({ status: 'error' }).kind, 'unreadable');
  assert.equal(savesView({ status: 'error' }).next, null);
  assert.equal(priceLine(OUTLINE), '$0.8400 estimated · held when you confirm in the studio, charged for what runs');
  assert.equal(priceLine({ ...OUTLINE, quote: { hold_microusd: null } }), null, 'no price is never $0');
  assert.equal(outlineLine(OUTLINE), '11 cards planned · 1 left out: Closing line, Closing line not evidenced');
  assert.equal(outlineLine({ ...OUTLINE, left_out: [] }), '11 cards planned · nothing left out');
  assert.equal(readByChange(7, 5), 'Changes only once you make v7 current and its cards bind v5.');
  assert.match(versionDrift(5, 4), /read v4, not v5/);
  assert.equal(versionDrift(5, 5), null);
});

test('3. the model: the adapter\'s answer as a state; a 403 and the 404 turned into available:false are refused', () => {
  assert.equal(outlineState(null).kind, 'loading');
  const ready = outlineState({ available: true, value: OUTLINE });
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.version, 5);
  assert.ok(canContinue(ready));
  assert.equal(outlineState({ available: true, value: { ...OUTLINE, narrative: { version: 5, reason: 'Some of your narrative could not be read right now.' } } }).warning, 'Some of your narrative could not be read right now.');
  const none = outlineState({ available: true, value: { ...OUTLINE, narrative: { version: null, reason: 'No narrative version is saved yet: the build writes from your records and card titles.' } } });
  assert.equal(none.kind, 'empty');
  assert.equal(none.line, NO_VERSION_LINE);
  assert.ok(!canContinue(none));
  const store = outlineState({ available: true, value: { ...OUTLINE, narrative: { version: null, reason: 'Your investor narrative could not be read right now.' } } });
  assert.equal(store.kind, 'unreadable');
  const noCards = outlineState({ available: true, value: { ...OUTLINE, cards: [] } });
  assert.equal(noCards.kind, 'empty');
  assert.equal(noCards.line, NO_CARDS_LINE);
  assert.ok(!canContinue(noCards));
  assert.equal(outlineState({ available: false, unreadable: true, status: 500, reason: 'could not be read' }).kind, 'unreadable');
  assert.equal(outlineState({ available: false, unreadable: true, status: 403, reason: 'forbidden' }).kind, 'refused');
  assert.equal(outlineState({ available: false, reason: 'Coming later', issue: 3768 }).kind, 'refused', 'the 404 through() made "Coming later" is refused');
  assert.ok(!canContinue(outlineState({ available: false })));
});

async function mounted(element, handle, { url = '/raise/investor-narrative/versions?project_id=1', viewer = { founder: true } } = {}) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push([options.method || 'GET', String(u), options.body || null]);
    const reply = await handle(String(u), options);
    if (!String(u).includes('/form-options') || !reply?.ok) return reply;
    const data = await reply.json().catch(() => null);
    return response(withNarrativeCapabilities(data, viewer), reply.status);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.body.querySelectorAll = () => [];
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, element)));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, props, byId, text: () => text(container), nodeText: text,
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    async press(id) {
      const node = byId(id);
      assert.ok(node, `${id} is drawn`);
      await act(async () => { props(node).onClick({ currentTarget: node, preventDefault() {}, stopPropagation() {} }); });
      await flush();
      return node;
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const versionsHandler = ({ outline = () => response(OUTLINE), decks = () => response(DECKS), saved = SAVED } = {}) => (url, options) => {
  if (url.includes('/form-options')) return response({ versions: saved });
  if (url.includes('/narrative/compare')) return response({ pairs: [] });
  if (url.includes('/modules/investor-narrative')) return response({ parts: { narrative: { state: 'ok', versions: ROWS } } });
  if (url.includes('/decks/narrative/outline') && options.method === 'POST') return outline();
  if (url.includes('/decks/narrative/build')) return response({ deck_id: 99 });
  if (url.includes('/decks/by-project/')) return decks();
  return response({});
};
const versionsPage = (admin = false) => h(NarrativeTabPage, { tab: 'versions', projectId: 1, search: '?project_id=1', admin, cards: [] });

test('4. Versions: an editor sees the canvas table with a Deck cell on every row; read only sees no Deck column', async () => {
  const page = await mounted(versionsPage(), versionsHandler());
  try {
    assert.ok(page.byId('narrative-versions-table'));
    for (const col of ['Version', 'Audience', 'Saved', 'By', 'Revision', 'Based on', 'Read by', 'Deck']) assert.ok(page.text().includes(col), `column ${col}`);
    assert.equal(page.testIds().filter((id) => id === 'narrative-version-row').length, 3);
    assert.equal(page.testIds().filter((id) => id === 'narrative-version-deck-build').length, 1, 'the newest row builds');
    assert.equal(page.testIds().filter((id) => id === 'narrative-version-deck-older').length, 2, 'each older row shows the ◇ tag');
    assert.match(page.nodeText(page.byId('narrative-version-deck-build')), /^Build a deck from v5$/);
    assert.match(page.text(), /◇ Builds from v5, the newest, until older versions can be chosen/);
    assert.match(page.text(), /Open v5/);
    assert.ok(page.byId('narrative-version-newest'), 'the newest row is marked');
    assert.match(page.text(), /Pitch deck v6 · cards 1, 2/);
    assert.match(page.text(), /3 saved · newest v5/);
    assert.ok(!page.requests.some(([, u]) => u.includes('/decks/narrative/')), 'the tab reads no outline until asked');
  } finally { await page.close(); }

  const reader = await mounted(versionsPage(true), versionsHandler(), { viewer: { admin: true } });
  try {
    assert.ok(reader.byId('narrative-versions-table'));
    assert.ok(!reader.text().includes('Deck') || !/\bDeck\b(?!s)/.test(reader.text().replace(/Pitch deck/g, '')), 'no Deck column');
    assert.ok(!reader.testIds().some((id) => String(id).startsWith('narrative-version-deck')), 'no Deck cell read only');
  } finally { await reader.close(); }
});

test('5. NoVersion: an editor reads the Save-first line beside New version, with no build button; read only reads neither', async () => {
  const page = await mounted(versionsPage(), versionsHandler({ saved: [] }));
  try {
    assert.ok(page.byId('narrative-no-version'));
    assert.equal(page.nodeText(page.byId('narrative-no-version-build')), SAVE_FIRST);
    assert.match(page.text(), /New version/);
    assert.ok(!page.testIds().some((id) => String(id).includes('deck-build')));
  } finally { await page.close(); }
  const reader = await mounted(versionsPage(true), versionsHandler({ saved: [] }), { viewer: { admin: true } });
  try {
    assert.ok(reader.byId('narrative-no-version'));
    assert.ok(!reader.byId('narrative-no-version-build'));
  } finally { await reader.close(); }
});

test('6. the confirm calls only the outline, never the build; focus opens on its title and returns to the row button', async () => {
  const page = await mounted(versionsPage(), versionsHandler());
  try {
    const button = await page.press('narrative-version-deck-build');
    assert.ok(page.byId('build-deck-dialog'));
    assert.ok(document.activeElement === page.byId('build-deck-title'), `focus opens on the title, not ${page.props(document.activeElement)['data-testid'] || document.activeElement?.tagName}`);
    const posts = page.requests.filter(([m]) => m !== 'GET');
    assert.deepEqual(posts.map(([m, u]) => [m, u.replace(/^.*\/api/, '')]), [['POST', '/decks/narrative/outline']]);
    assert.deepEqual(JSON.parse(posts[0][2]), { project_id: 1 }, 'no quote_uid: nothing runs');
    assert.ok(!page.requests.some(([, u]) => u.includes('/narrative/build')), 'the build is never called');
    const text = page.text();
    assert.match(text, /v5’s words, figure-free\. A sentence that names a figure is left out; figures come bound from your records\./);
    assert.match(text, /11 cards planned · 1 left out: Closing line/);
    assert.match(text, /A new deck version, Pitch deck v7, not current\. Pitch deck v6 stays current\./);
    assert.ok(page.byId('build-deck-not-current'));
    assert.match(text, /\$0\.8400 estimated · held when you confirm in the studio, charged for what runs/);
    assert.match(text, /Changes only once you make v7 current and its cards bind v5\./);
    assert.ok(text.includes(NEWEST_ONLY));
    assert.match(page.nodeText(page.byId('build-deck-version-line')), /^v5 · audience Seed fund · saved 2026-11-12 by Fay Founder · revision Not recorded$/);
    assert.ok(!page.props(page.byId('build-deck-continue')).disabled, 'Continue is offered on a ready outline');
    await page.press('build-deck-cancel');
    assert.ok(!page.byId('build-deck-dialog'));
    assert.ok(document.activeElement === button, `focus goes back to the row button, not ${page.props(document.activeElement)['data-testid'] || document.activeElement?.tagName}`);
  } finally { await page.close(); }
});

const dialog = (handle) => mounted(h(BuildDeckDialog, { projectId: 1, version: 5, row: ROWS[0], onClose() {} }), handle);

test('7. a 403 and a 404 are refused, never "Coming later"; an unreadable outline says nothing was charged and shows no price', async () => {
  for (const status of [403, 404]) {
    const page = await dialog(versionsHandler({ outline: () => response({ error: status === 404 ? 'not found' : 'forbidden' }, status) }));
    try {
      assert.ok(page.byId('build-deck-refused'), `${status} is refused`);
      assert.ok(page.text().includes(REFUSED_TITLE));
      assert.ok(!/Coming later/i.test(page.text()), `${status} never reads Coming later`);
      assert.ok(page.props(page.byId('build-deck-continue')).disabled);
    } finally { await page.close(); }
  }
  const page = await dialog(versionsHandler({ outline: () => response({ error: 'boom' }, 500) }));
  try {
    assert.ok(page.byId('build-deck-unreadable'));
    assert.ok(page.text().includes(UNREADABLE_TITLE));
    assert.ok(page.text().includes(UNREADABLE_LINE));
    assert.ok(page.byId('build-deck-retry'), 'Try again');
    assert.ok(!/\$/.test(page.text()), 'no price, not even $0');
    assert.ok(page.props(page.byId('build-deck-continue')).disabled);
  } finally { await page.close(); }
});

test('8. loading reads the price, keeps skeletons and keeps Continue off; empty outlines keep Continue off', async () => {
  let release;
  const page = await dialog(versionsHandler({ outline: () => new Promise((r) => { release = () => r(response(OUTLINE)); }) }));
  try {
    assert.ok(page.text().includes(PRICE_LOADING));
    assert.ok(page.testIds().includes('build-deck-skeleton'));
    assert.ok(page.props(page.byId('build-deck-continue')).disabled);
    release();
    await page.flush();
    assert.ok(!page.text().includes(PRICE_LOADING));
    assert.ok(!page.props(page.byId('build-deck-continue')).disabled);
  } finally { await page.close(); }
  const empty = await dialog(versionsHandler({ outline: () => response({ ...OUTLINE, narrative: { version: null, reason: 'No narrative version is saved yet.' } }) }));
  try {
    assert.ok(empty.byId('build-deck-empty-no_version'));
    assert.ok(empty.text().includes(NO_VERSION_LINE));
    assert.ok(empty.props(empty.byId('build-deck-continue')).disabled);
  } finally { await empty.close(); }
  const warn = await dialog(versionsHandler({ outline: () => response({ ...OUTLINE, narrative: { version: 5, reason: 'Some of your narrative could not be read right now.' } }) }));
  try {
    assert.match(warn.nodeText(warn.byId('build-deck-warning')), /Some of your narrative could not be read right now\./);
  } finally { await warn.close(); }
});

const storyHandler = (url, options) => {
  if (/\/narrative\/5\?/.test(url)) return response({ version: 5, meta: { state: 'ok', investor_type: 'seed_fund', revision: 3 }, sections: { state: 'ok', items: [{ key: 'problem', body: 'Close the month in a day.' }] }, bindings: { state: 'ok', items: [] } });
  if (url.includes('/narrative/reads')) return response({ reads: [], mine: null, viewer: 'founder' });
  if (url.includes('/narrative/notes')) return response({ notes: [], viewer: 'founder' });
  return versionsHandler()(url, options);
};
const storyPage = (admin = false) => h(NarrativeTabPage, { tab: 'story', projectId: 1, search: '?project_id=1', admin, cards: [] });

test('9. Story: the founder\'s Share ▾ offers Build a deck from the newest; an admin keeps only Copy text', async () => {
  const page = await mounted(storyPage(), storyHandler, { url: '/raise/investor-narrative/story?project_id=1' });
  try {
    assert.ok(page.byId('story-share-open'));
    assert.ok(!page.byId('story-export-open'));
    assert.equal(page.props(page.byId('story-share-open'))['aria-haspopup'], 'menu');
    await page.press('story-share-open');
    assert.ok(page.byId('story-share-menu'));
    assert.equal(page.nodeText(page.byId('story-share-build')), 'Build a deck from v5…');
    assert.equal(page.nodeText(page.byId('story-share-export')), 'Copy or export…');
    await page.press('story-share-build');
    assert.ok(page.byId('build-deck-dialog'));
    assert.ok(!page.requests.some(([, u]) => u.includes('/narrative/build')));
  } finally { await page.close(); }
  const admin = await mounted(storyPage(true), storyHandler, { url: '/raise/investor-narrative/story?project_id=1', viewer: { admin: true } });
  try {
    assert.equal(admin.nodeText(admin.byId('story-export-open')), 'Copy text');
    assert.ok(!admin.byId('story-share-open'));
    assert.ok(!admin.testIds().some((id) => String(id).startsWith('build-deck')));
  } finally { await admin.close(); }
});
