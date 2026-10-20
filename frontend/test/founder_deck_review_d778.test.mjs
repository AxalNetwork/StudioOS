/**
 * D778 part 7 (#2103) — the pitch deck reviewer's three presses name their
 * option on the run: `review:deck-file` (the upload, whose XHR sent no rail
 * context at all before this), `review:deck-text` (pasted text) and
 * `review:deck-again` (regenerate). Each keeps the mounted rail's page. A run
 * answers only the review it was pressed on: opening another review drops it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_deck_review_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import DeckReviewerPage from '../src/pages/DeckReviewerPage.jsx';
import { api } from '../src/lib/api.js';
import { clearRailPage, railPressHeaders, setRailPage } from '../src/lib/railPage.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const PAST = { id: 'r-old', title: 'Seed deck v1', status: 'complete', sections: [], review: { overall_score: 55, summary: 'The older review.' } };
const FRESH = { id: 'r-new', title: 'Pasted deck', status: 'complete', sections: [], review: { overall_score: 70, summary: 'The pasted review.' } };
const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

async function mount() {
  const original = { list: api.listProjects, dr: api.deckReviewer };
  const calls = [];
  const pending = [];
  const wait = (name) => (...args) => { calls.push([name, ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.listProjects = async () => [{ id: 7, name: 'Kestrel' }];
  api.deckReviewer = {
    ...original.dr,
    list: async () => ({ reviews: [{ id: PAST.id, title: PAST.title, status: 'complete' }] }),
    get: async (id) => { calls.push(['get', id]); return PAST; },
    paste: wait('paste'),
    regenerate: wait('regenerate'),
  };
  const m = await mountContracts(React.createElement(DeckReviewerPage, { embedded: true }), '/raise/pitch/review');
  for (let i = 0; i < 4; i += 1) await m.flush();
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  const button = (label) => m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim().includes(label));
  const press = async (label) => { const b = button(label); assert.ok(b, `button ${label}`); await act(async () => { m.props(b).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  return {
    ...m, calls, pending, settle, press,
    text: () => m.nodes().map(textOf).join(' '),
    async paste(text) {
      await press('Paste deck text instead');
      const area = m.nodes().find((n) => n.tagName === 'TEXTAREA');
      await act(async () => { m.props(area).onChange({ target: { value: text } }); });
      await press('Review pasted text');
    },
    async close() { await m.unmount(); api.listProjects = original.list; api.deckReviewer = original.dr; },
  };
}

test('pasted text and Regenerate each send their own option with the run, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop either press's headers → its request carries no option.
  for (const mounted of [null, 'raise']) {
    const token = mounted ? setRailPage(mounted, 'draft:old') : null;
    const m = await mount();
    try {
      await m.paste('Problem: freight teams reconcile by hand.');
      const paste = m.calls.find((c) => c[0] === 'paste');
      assert.equal(paste[1].text, 'Problem: freight teams reconcile by hand.');
      assert.equal(paste[2]['X-Rail-Option'], encodeURIComponent('review:deck-text'));
      assert.equal(paste[2]['X-Rail-Page'], mounted || undefined, 'the mounted page holds the Manual switch');
      await act(async () => { m.pending[0].ok(FRESH); });
      await m.settle();
      await m.press('Regenerate review');
      const again = m.calls.find((c) => c[0] === 'regenerate');
      assert.equal(again[1], 'r-new');
      assert.equal(again[2]['X-Rail-Option'], encodeURIComponent('review:deck-again'));
      assert.equal(again[2]['X-Rail-Page'], mounted || undefined);
    } finally { if (token) clearRailPage(token); await m.close(); }
  }
});

test('a run answers only the review it was pressed on: opening another review drops it', async () => {
  // Mutation checked: drop the stale check → the pasted review replaces the one the founder opened.
  const m = await mount();
  try {
    await m.paste('Problem: freight teams reconcile by hand.');
    await m.press('Seed deck v1');
    assert.ok(m.text().includes('The older review.'));
    await act(async () => { m.pending[0].ok(FRESH); });
    await m.settle();
    assert.ok(m.text().includes('The older review.'), 'the opened review stays');
    assert.ok(!m.text().includes('The pasted review.'), 'the dropped run is not drawn');
    await m.press('Regenerate review');
    assert.equal(m.calls.find((c) => c[0] === 'regenerate')[1], 'r-old', 'and the page is pressable again');
  } finally { await m.close(); }
});

test('the upload\'s XHR carries the press\'s headers, which it never sent before', async () => {
  // Mutation checked: drop the headers from the XHR → no rail header is set.
  const restore = installDocument();
  const real = globalThis.XMLHttpRequest;
  const sent = [];
  globalThis.XMLHttpRequest = class {
    constructor() { this.headers = {}; this.upload = {}; this.status = 200; this.responseText = JSON.stringify(FRESH); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send() { sent.push(this); setTimeout(() => this.onload(), 0); }
  };
  const token = setRailPage('raise');
  const m = await mount();
  try {
    const input = m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).type === 'file');
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'kestrel.pdf', { type: 'application/pdf' });
    await act(async () => { m.props(input).onChange({ target: { files: [file] } }); });
    await m.settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, '/api/deck-reviewer/upload');
    assert.equal(sent[0].headers['X-Rail-Option'], encodeURIComponent('review:deck-file'));
    assert.equal(sent[0].headers['X-Rail-Page'], 'raise');
  } finally { clearRailPage(token); await m.close(); globalThis.XMLHttpRequest = real; restore(); }
});

test('the existing API methods send the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from either method → its request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.deckReviewer.paste({ text: 'Deck' }, railPressHeaders('review:deck-text'));
    await api.deckReviewer.regenerate('r-1', railPressHeaders('review:deck-again'));
    const paste = seen.find((s) => s.url.endsWith('/deck-reviewer/paste'));
    assert.equal(paste.init.headers['X-Rail-Option'], 'review%3Adeck-text');
    assert.deepEqual(JSON.parse(paste.init.body), { text: 'Deck' });
    assert.equal(seen.find((s) => s.url.endsWith('/deck-reviewer/r-1/regenerate')).init.headers['X-Rail-Option'], 'review%3Adeck-again');
  } finally { globalThis.fetch = realFetch; restore(); }
});
