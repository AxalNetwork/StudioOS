/**
 * D778 part 5 (#2103) — the pitch deck's two form fills through the run path:
 * `form:deck` ("Fill from project") and `form:deck-template` ("Use this
 * template"). A press sends its own option with the run (`X-Rail-Option`),
 * keeping the mounted rail's page. Either fill comes back as a proposal, kept
 * card by card, so nothing is written before Keep.
 *
 * D898 group E (#2676) retired the template builder these were first wired in.
 * Fill from project is the studio's Decks tab (`StudioActions.jsx`), and its
 * proposal is reviewed at New deck's step 4; a template is started from New
 * deck (`NewDeck.jsx`), which this file reads.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_deck_forms_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AskDraftFromProject } from '../src/pages/raise/pitch/StudioActions.jsx';
import { api } from '../src/lib/api.js';
import { clearRailPage, railPressHeaders, setRailPage } from '../src/lib/railPage.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';

const DECK = { id: 10, project_id: 7, version: 1, title: 'Seed deck', slides: [{ title: 'Problem', method_id: 'yc_seed', spec_id: 'problem', body: 'Old', fields: [] }] };
const PROPOSAL = { id: 55, project_id: 7, base_deck_id: 10, method_id: 'yc_seed', slides: [{ title: 'Problem', body: 'Freight teams reconcile by hand.', fields: [] }] };
const h = React.createElement;

function Landed() {
  const loc = useLocation();
  return h('p', { 'data-testid': 'landed' }, `${loc.pathname}${loc.search}`);
}

async function mount() {
  const original = { ...api };
  const calls = [];
  const pending = [];
  api.deckAutofill = (...args) => { calls.push(['autofill', ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.deckKeepProposal = async (id) => { calls.push(['keep', id]); return {}; };
  api.deckUpdate = async (...args) => { calls.push(['update', ...args]); return {}; };
  const m = await mountContracts(h(Routes, null,
    h(Route, { path: '/raise/pitch', element: h(AskDraftFromProject, { deck: DECK, q: '?project_id=7' }) }),
    h(Route, { path: '/raise/pitch/new', element: h(Landed) })), '/raise/pitch?project_id=7');
  const byId = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const press = async (id) => { const b = byId(id); assert.ok(b, `${id} present`); await act(async () => { m.props(b).onClick({ preventDefault() {}, stopPropagation() {} }); }); };
  return {
    ...m, calls, pending, byId,
    fill: async () => { await press('pitch-studio-fill'); await press('pitch-studio-fill-dialog-confirm'); },
    async answer(value) { await act(async () => { pending[0].ok(value); }); for (let k = 0; k < 3; k += 1) await m.flush(); },
    async refuse(err) { await act(async () => { pending[0].no(err); }); for (let k = 0; k < 3; k += 1) await m.flush(); },
    writes: () => calls.filter((c) => ['keep', 'update'].includes(c[0])),
    async close() { await m.unmount(); Object.assign(api, original); },
  };
}

test('each press sends its own option with the run, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop the press headers from the fill → the request carries no option.
  for (const mounted of [null, 'raise']) {
    const token = mounted ? setRailPage(mounted, 'draft:old') : null;
    const m = await mount();
    try {
      assert.deepEqual(m.calls, [], 'the button runs nothing until its dialog is confirmed');
      await m.fill();
      const autofill = m.calls.find((c) => c[0] === 'autofill');
      assert.equal(autofill[1], 10);
      assert.equal(autofill[2]['X-Rail-Option'], encodeURIComponent('form:deck'));
      assert.equal(autofill[2]['X-Rail-Page'], mounted || undefined, 'the mounted page holds the Manual switch; with none the Worker names the inventory\'s');
    } finally { if (token) clearRailPage(token); await m.close(); }
  }
  // A template start is New deck's: the same press headers, its own option.
  const newDeck = codeOnly(readFileSync(new URL('../src/pages/raise/pitch/NewDeck.jsx', import.meta.url), 'utf8'));
  assert.match(newDeck, /const RAIL = \{ outline: 'deck:outline', build: 'deck:build', template: 'form:deck-template' \};/);
  assert.match(newDeck, /api\.deckApplyMethod\(projectId, start\.id, railPressHeaders\(RAIL\.template\)\)/);
});

test('a fill is a proposal: it lands on New deck\'s review of it, and writes nothing', async () => {
  // Mutation checked: navigate without the proposal id → New deck opens on step 1, not the proposal.
  const m = await mount();
  try {
    await m.fill();
    await m.answer({ proposal: PROPOSAL, method_id: 'yc_seed', coverage_pct: 80 });
    assert.ok(m.byId('landed'), 'the fill lands on New deck');
    assert.ok(m.text().includes('/raise/pitch/new?project_id=7&proposal=55'), m.text());
    assert.deepEqual(m.writes(), [], 'nothing is kept on arrival');
  } finally { await m.close(); }
});

test('a refused fill says why, and where to fix it', async () => {
  // Mutation checked: treat every 402 as the plan → a token shortfall points at Plans, not Add tokens.
  const cases = [
    [Object.assign(new Error('Deck has no template.'), { status: 409, code: 'no_method_id' }), 'no template to draft from', 'New deck'],
    [Object.assign(new Error('paywall'), { status: 402, code: 'PAYWALL_PREMIUM_METHOD' }), 'on a paid plan', 'Plans'],
    [Object.assign(new Error('Not enough AI tokens.'), { status: 402, code: 'insufficient_tokens' }), 'Not enough AI tokens.', 'Add tokens'],
  ];
  for (const [err, says, fix] of cases) {
    const m = await mount();
    try {
      await m.fill();
      await m.refuse(err);
      const alert = m.byId('pitch-studio-fill-refusal');
      assert.ok(alert, `${err.code}: the refusal is drawn`);
      const text = m.text();
      assert.ok(text.includes(says), `${err.code}: ${says}`);
      assert.ok(text.includes(fix), `${err.code}: ${fix}`);
      assert.equal(m.byId('landed'), undefined, 'a refused fill stays on the studio');
      assert.deepEqual(m.writes(), []);
    } finally { await m.close(); }
  }
});

test('the existing API methods send the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from either method → its request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.deckApplyMethod(7, 'yc_seed', railPressHeaders('form:deck-template'));
    await api.deckAutofill(10, railPressHeaders('form:deck'));
    const apply = seen.find((s) => s.url.endsWith('/decks/apply-method'));
    const fill = seen.find((s) => s.url.endsWith('/decks/10/autofill'));
    assert.equal(apply.init.headers['X-Rail-Option'], 'form%3Adeck-template');
    assert.deepEqual(JSON.parse(apply.init.body), { project_id: 7, method_id: 'yc_seed' });
    assert.equal(fill.init.headers['X-Rail-Option'], 'form%3Adeck');
  } finally { globalThis.fetch = realFetch; restore(); }
});
