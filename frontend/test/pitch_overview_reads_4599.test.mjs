// #4599 (D4599, Pitch audit 5/5) — the Overview's first-use import and its loading contract.
//
//   1. The no-deck Overview offers "Import a deck or document" at desktop and phone width. It opens
//      the Decks tile's own sheet (`DocumentImport`, #3810) in place, under the same `importDocument`
//      gate, and a reader is offered nothing. Its line says what each kind gives: a .pptx is cards,
//      a PDF or a document is an outline, never a copy of a PDF's slides.
//   2. Request-level regression. The whole studio is mounted on a stubbed `fetch`, so every request
//      the real clients send is recorded. These are the reads #4599 removed or shared:
//        · `/decks/null/usage`, three times: the rail asked for a deck's usage before it had a deck;
//        · `/decks/:id/usage`, three times at once, and `/decks/:id/model-presets`, twice at once:
//          now one in-flight read each (`sharedRead`, #4622);
//        · the Raise module read: the Overview draws nothing from it, so it waits for Decks or
//          Share & analytics;
//        · the version checks with no deck: the check pills live on the deck card only.
//      Each path is counted on its own; no total is pinned (D4134).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_overview_reads_4599.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PitchStudio, { NO_MODULE_TABS } from '../src/pages/raise/pitch/PitchStudio.jsx';
import { IMPORT_LINE, NO_DECK_ITEMS } from '../src/pages/raise/pitch/pitchOverviewModel.js';

const h = React.createElement;
const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const FOUNDER = { id: 2, role: 'founder', founder_id: 20, name: 'Synthetic Founder' };
const ADMIN = { id: 21, role: 'admin', name: 'Synthetic Admin' };
const VERSIONS = { versions: [{ id: 31, version: 3, is_current: true, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00' }] };

/**
 * Mount the studio at `url`, answering every request from synthetic data. `deck` says whether the
 * venture has a current version. Returns the requests, in order, as `METHOD path`.
 */
async function mount({ url = '/raise/pitch?project_id=7', tab = 'overview', deck = true, user = FOUNDER, phone = false } = {}) {
  const calls = [];
  const fetchBefore = globalThis.fetch;
  const matchBefore = globalThis.matchMedia;
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    calls.push(`${init?.method || 'GET'} ${u}`);
    if (u.endsWith('/auth/me')) return Response.json(user);
    if (/\/api\/projects(\?|$)/.test(u)) return Response.json([{ id: 7, name: 'Synthetic Labs' }]);
    if (u.includes('/decks/by-project/7')) return Response.json(deck ? VERSIONS : { versions: [] });
    if (/\/api\/decks\/31$/.test(u)) return Response.json({ id: 31, project_id: 7, slides: [] });
    return Response.json({});
  };
  const restore = installDocument();
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(PitchStudio, { tab })))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, text,
    count: (re) => calls.filter((c) => re.test(c)).length,
    async press(node) { await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount());
      restore();
      globalThis.fetch = fetchBefore;
      globalThis.matchMedia = matchBefore;
    },
  };
}

// ── 1. the first-use import ────────────────────────────────────────────────

test('the no-deck ways in include the import, gated on importDocument, in the canvas words', () => {
  const item = NO_DECK_ITEMS.find((i) => i.id === 'import');
  assert.ok(item, 'the import is a way in');
  assert.equal(item.adapter, 'importDocument', 'the same gate as the Decks tile');
  assert.equal(item.title, 'Import a deck or document');
  assert.match(IMPORT_LINE, /\.pptx becomes editable cards/);
  assert.match(IMPORT_LINE, /PDF, DOCX or pasted text becomes an outline/);
  assert.doesNotMatch(IMPORT_LINE, /PDF[^.]*(editable|cards|slides)/i, 'a PDF is never promised as an editable copy of its slides');
  const s = src('pages/raise/pitch/PitchOverview.jsx');
  assert.match(s, /const off = availability\(it\.adapter\);/, 'an import switched off on this Worker is drawn off, not opened');
  assert.match(s, /<DocumentImport projectId=\{projectId\} q=\{q\} onClose=/, 'the Decks tile\'s own sheet, not a second import flow');
});

for (const phone of [false, true]) {
  test(`a founder with no deck opens the import from the Overview (${phone ? 'phone' : 'desktop'})`, async () => {
    const m = await mount({ deck: false, phone });
    try {
      const entry = m.by('pitch-overview-start-import');
      assert.ok(entry, 'the import entry is drawn');
      assert.match(m.text(entry), /Import a deck or document/);
      assert.equal(m.by('pitch-document-drop'), undefined, 'the sheet is closed until asked for');
      await m.press(entry);
      assert.ok(m.by('pitch-document-drop'), 'the import sheet opens in place');
      assert.ok(m.by('pitch-document-paste'), 'with paste as well as a file');
      assert.equal(m.count(/\/imports|\/import\b/), 0, 'opening the sheet sends nothing');
    } finally { await m.unmount(); }
  });
}

test('a reader (an admin) with no deck is offered no import', async () => {
  const m = await mount({ deck: false, user: ADMIN });
  try {
    assert.ok(m.by('pitch-overview-no-deck'));
    assert.equal(m.by('pitch-overview-start-import'), undefined);
    assert.equal(m.by('pitch-overview-start-records'), undefined);
  } finally { await m.unmount(); }
});

// ── 2. the loading contract ────────────────────────────────────────────────

test('Overview with a deck: no read for a null deck, one usage and one presets read, no Raise module read', async () => {
  const m = await mount({ deck: true });
  try {
    assert.ok(m.by('pitch-overview'), 'the Overview drew its deck');
    assert.equal(m.count(/\/decks\/null\//), 0, 'nothing is read for a deck that is not known yet');
    assert.equal(m.count(/GET \/api\/decks\/31\/usage$/), 1, 'the rail\'s three usage rows share one read');
    assert.equal(m.count(/GET \/api\/decks\/31\/model-presets$/), 1, 'presets and HQ locks share one read');
    assert.equal(m.count(/\/cycles\/raise\/modules\/pitch-deck/), 0, 'the Overview draws nothing from the module read');
    // What the Overview does draw is still read, once each.
    for (const path of ['/decks/by-project/7', '/decks/31', '/decks/31/engagement', '/decks/31/rehearsals', '/decks/31/comments', '/decks/31/notes', '/decks/31/investor-links', '/decks/checks?project_id=7', '/decks/sources?project_id=7']) {
      assert.equal(m.count(new RegExp(`GET /api${path.replace(/[?]/g, '\\?')}$`)), 1, `${path} is read once`);
    }
  } finally { await m.unmount(); }
});

test('Overview with no deck: no checks read and no module read', async () => {
  const m = await mount({ deck: false });
  try {
    assert.ok(m.by('pitch-overview-no-deck'));
    assert.equal(m.count(/\/decks\/null\//), 0);
    assert.equal(m.count(/\/decks\/checks\?/), 0, 'no deck card, no check pills');
    assert.equal(m.count(/\/cycles\/raise\/modules\/pitch-deck/), 0);
    assert.equal(m.count(/\/decks\/by-project\/7$/), 1);
  } finally { await m.unmount(); }
});

test('Decks still reads the Raise module, once', async () => {
  assert.ok(!NO_MODULE_TABS.includes('decks') && !NO_MODULE_TABS.includes('analytics'), 'the two tabs that draw it read it');
  const m = await mount({ url: '/raise/pitch/decks?project_id=7', tab: 'decks', deck: true });
  try {
    assert.equal(m.count(/GET \/api\/cycles\/raise\/modules\/pitch-deck\?project=7/), 1);
    assert.equal(m.count(/\/decks\/null\//), 0);
  } finally { await m.unmount(); }
});
