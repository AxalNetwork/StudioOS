/**
 * D5791 (#5791) — the share viewer plays the walkthrough attached to the link.
 *
 *   1. The model: nothing attached (or no take of a card on the page) draws
 *      nothing; the takes sit on the cards the investor sees, in the link's
 *      order; captions at the playhead, or "Captions not recorded"; HQ's
 *      switch off draws nothing; any other failure is unreadable.
 *   2. The viewer: "Watch the walkthrough" only when a take is attached; it
 *      plays card by card with the caption under it, from the share link's
 *      media route; a failed read says so with Try again; nothing attached
 *      and the switch off draw nothing.
 *   3. Where it lives: the share page draws it in each of its share layouts;
 *      the client's two paths are the Worker's two routes.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/share_walkthrough_d5791.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import ShareWalkthrough from '../src/pages/raise/pitch/ShareWalkthrough.jsx';
import { deckShareWalkthroughApi } from '../src/lib/api/deckShareWalkthrough.js';
import {
  CAPTIONS_NOT_RECORDED, UNREADABLE, WATCH, captionLine, playlist, readProblem, summaryLine, walkthroughState,
} from '../src/pages/raise/pitch/shareWalkthroughModel.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const TOKEN = 'eyJrIjoiZGVjazo1OnYxIn0.sig';
const CUES = [{ start_ms: 0, end_ms: 2000, text: 'This is the problem we solve.' }, { start_ms: 2500, end_ms: 4000, text: 'Freight teams reconcile by hand.' }];
// A variant's order: Traction is shown first.
const SLIDES = [{ uid: 'card-traction', title: 'Traction' }, { uid: 'card-kestrel', title: 'Kestrel' }, { uid: 'card-team', title: 'Team' }];
const TAKES = [
  { uid: '00000000-0000-4000-8000-000000000002', card: 1, card_uid: 'card-kestrel', take: 2, duration_ms: 5000, media_mime: 'video/webm', captions: CUES },
  { uid: '00000000-0000-4000-8000-000000000004', card: 3, card_uid: 'card-traction', take: 1, duration_ms: 6000, media_mime: 'video/webm', captions: null },
  // A card that is not on this page.
  { uid: '00000000-0000-4000-8000-000000000009', card: 9, card_uid: 'card-gone', take: 1, duration_ms: 1000, media_mime: 'video/webm', captions: null },
];

test('1. the model: what draws, in which order, with which caption', () => {
  // Mutation checked: walkthroughState ignoring `attached` → an unattached reply draws; playlist in the takes' order →
  // Kestrel comes first; readProblem treating every failure as off → a failed read draws nothing.
  assert.deepEqual(walkthroughState({ attached: false, takes: [] }), { status: 'none', takes: [] });
  assert.deepEqual(walkthroughState({ attached: false, takes: TAKES }), { status: 'none', takes: [] });
  assert.deepEqual(walkthroughState({ attached: true, takes: [] }), { status: 'none', takes: [] });
  assert.equal(walkthroughState(null).status, 'none');
  assert.equal(walkthroughState({ attached: true, takes: TAKES }).takes.length, 3);

  const items = playlist(TAKES, SLIDES);
  assert.deepEqual(items.map((it) => [it.label, it.take.uid]), [
    ['Card 1 · Traction', TAKES[1].uid],
    ['Card 2 · Kestrel', TAKES[0].uid],
  ], 'the link\'s order, numbered as the page numbers its cards; a card not on the page plays nothing');
  assert.equal(summaryLine(items), '2 cards · 0:11');

  assert.equal(captionLine(TAKES[0], 500), 'This is the problem we solve.');
  assert.equal(captionLine(TAKES[0], 2200), '', 'between cues, no line');
  assert.equal(captionLine(TAKES[1], 500), CAPTIONS_NOT_RECORDED);

  assert.equal(readProblem({ status: 404, code: 'not_switched_on' }), 'off');
  assert.equal(readProblem({ status: 500 }), 'unreadable');
  assert.equal(readProblem(new TypeError('Failed to fetch')), 'unreadable');
});

/** Mount on a stubbed fetch keyed "METHOD /path"; an unknown request is a network failure. */
async function mount(element, handle) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push(key);
    const f = handle[key];
    if (!f) throw new TypeError('Failed to fetch');
    return f(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(element));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    seen, settle, props, by: byId,
    text: (id) => textOf(id ? byId(id) : container).replace(/\s+/g, ' ').trim(),
    has: (id) => Boolean(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}
const json = (body, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const READ = `GET /api/decks/share/${TOKEN}/walkthrough`;

test('2. the viewer plays the attached walkthrough card by card, with its captions', async () => {
  // Mutation checked: the Watch entry drawn without the read → it shows with nothing attached; onEnded not moving on →
  // the second card is not reached; the video's src from the member route → the share media path assertion fails.
  const v = await mount(h(ShareWalkthrough, { token: TOKEN, slides: SLIDES }), { [READ]: json({ attached: true, takes: TAKES }) });
  try {
    assert.deepEqual(v.seen, [READ]);
    assert.equal(v.text('share-walkthrough-watch'), WATCH);
    assert.equal(v.has('share-walkthrough-player'), false, 'nothing plays until the investor asks');
    await v.click('share-walkthrough-watch');
    assert.match(v.text('share-walkthrough-card'), /^Card 1 · Traction · 1 of 2$/);
    assert.equal(v.props(v.by('share-walkthrough-video')).src, `/api/decks/share/${encodeURIComponent(TOKEN)}/walkthrough/${TAKES[1].uid}/media`);
    assert.equal(v.text('share-walkthrough-caption'), CAPTIONS_NOT_RECORDED);
    assert.equal(v.props(v.by('share-walkthrough-prev')).disabled, true);

    // The take ends: the next card plays, its captions at the playhead.
    await act(async () => { v.props(v.by('share-walkthrough-video')).onEnded(); });
    await v.settle();
    assert.match(v.text('share-walkthrough-card'), /^Card 2 · Kestrel · 2 of 2$/);
    await act(async () => { v.props(v.by('share-walkthrough-video')).onTimeUpdate({ currentTarget: { currentTime: 2.6 } }); });
    assert.equal(v.text('share-walkthrough-caption'), 'Freight teams reconcile by hand.');
    assert.equal(v.props(v.by('share-walkthrough-next')).disabled, true);

    // A take the browser cannot play says so.
    await act(async () => { v.props(v.by('share-walkthrough-video')).onError(); });
    assert.equal(v.has('share-walkthrough-play-failed'), true);
    await v.click('share-walkthrough-prev');
    assert.equal(v.has('share-walkthrough-video'), true, 'the other card still plays');
    await v.click('share-walkthrough-hide');
    assert.equal(v.has('share-walkthrough-watch'), true);
  } finally { await v.close(); }
});

test('2. nothing attached, and the switch off, draw nothing; a failed read says so with Try again', async () => {
  // Mutation checked: the unreadable branch dropped → a failed read draws nothing; 'off' drawn as unreadable → the switch-off case shows the alert.
  for (const reply of [json({ attached: false, takes: [] }), json({ error: 'not_switched_on', message: 'Not switched on yet.' }, 404)]) {
    const v = await mount(h(ShareWalkthrough, { token: TOKEN, slides: SLIDES }), { [READ]: reply });
    try {
      assert.equal(v.text(), '', 'nothing is drawn');
    } finally { await v.close(); }
  }
  let calls = 0;
  const v = await mount(h(ShareWalkthrough, { token: TOKEN, slides: SLIDES }), {
    [READ]: (init) => { calls += 1; return calls === 1 ? json({ error: 'internal', message: 'D1_ERROR: no such table' }, 500)(init) : json({ attached: true, takes: TAKES })(init); },
  });
  try {
    assert.equal(v.has('share-walkthrough-unreadable'), true);
    assert.match(v.text('share-walkthrough-unreadable'), new RegExp(UNREADABLE.replace('.', '\\.')));
    assert.ok(!v.text().includes('D1_ERROR'), 'no raw error text');
    await v.click('share-walkthrough-retry');
    assert.equal(v.has('share-walkthrough-watch'), true);
  } finally { await v.close(); }
});

test('3. the share page draws it in each share layout, and the client\'s paths are the Worker\'s routes', () => {
  // Mutation checked: removing one of the page's three ShareWalkthrough lines → the count fails.
  const page = read('frontend/src/pages/PitchDeckPrintPage.jsx');
  assert.equal((page.match(/<ShareWalkthrough token=\{token\} slides=\{deck\.slides\} \/>/g) || []).length, 3, 'the card view, the template view and the plain cards');
  assert.match(page, /\{!isFullscreen && shareMode \? <ShareWalkthrough /);
  assert.equal(deckShareWalkthroughApi.mediaUrl('a b', 'u-1'), '/api/decks/share/a%20b/walkthrough/u-1/media');
  const worker = read('cloudflare-worker/src/routes/deck_share_walkthrough.ts');
  assert.match(worker, /\.get\('\/share\/:token\/walkthrough', /);
  assert.match(worker, /\.get\('\/share\/:token\/walkthrough\/:uid\/media', /);
  assert.match(worker, /export const mount: RouteMount = \{ path: '\/api\/decks', router: deckShareWalkthrough, before: \[decks\] \};/);
});
