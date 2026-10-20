/**
 * D778 part 5 (#2103) — the pitch deck's two form fills through the run path:
 * `form:deck` ("Fill from project") and `form:deck-template` ("Use this
 * template"). A press sends its own option with the run (`X-Rail-Option`),
 * keeping the mounted rail's page. A template the model fills comes back as a
 * proposal, kept or discarded like a fill, so nothing is written before Keep.
 * A run answers only the project it was pressed for.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_deck_forms_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import PitchDeckPage from '../src/pages/PitchDeckPage.jsx';
import { api } from '../src/lib/api.js';
import { clearRailPage, railPressHeaders, setRailPage } from '../src/lib/railPage.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const DECK = { id: 10, project_id: 7, version: 1, title: 'Seed deck', slides: [{ title: 'Problem', method_id: 'yc_seed', spec_id: 'problem', body: 'Old', fields: [] }] };
const PROPOSAL = { id: 55, project_id: 7, base_deck_id: 10, method_id: 'yc_seed', slides: [{ title: 'Problem', body: 'Freight teams reconcile by hand.', fields: [] }] };
const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

async function mount() {
  const original = { ...api };
  const calls = [];
  const pending = [];
  const wait = (name) => (...args) => { calls.push([name, ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.deckMethods = async () => ({ methods: [{ id: 'yc_seed', label: 'YC Seed' }], premium_method_ids: [], user_tier: 'studio' });
  api.deckListVersions = async (pid) => { calls.push(['versions', pid]); return { versions: [{ ...DECK, project_id: pid }], proposal: null }; };
  api.deckGet = async () => ({ deck: DECK });
  api.deckRecommend = async () => ({ method_id: 'yc_seed' });
  api.deckApplyMethod = wait('apply');
  api.deckAutofill = wait('autofill');
  api.deckKeepProposal = async (id) => { calls.push(['keep', id]); return { deck: { ...DECK, id: 11, version: 2 } }; };
  api.deckUpdate = async (...args) => { calls.push(['update', ...args]); return {}; };
  const projects = [{ id: 7, name: 'Kestrel' }, { id: 8, name: 'Osprey' }];
  const m = await mountContracts(React.createElement(PitchDeckPage, { embedded: true, initialProjects: projects, initialProjectId: 7 }), '/raise/pitch?mode=workspace');
  for (let i = 0; i < 4; i += 1) await m.flush();
  const button = (pred) => m.nodes().find((n) => n.tagName === 'BUTTON' && pred(textOf(n).trim(), m.props(n) || {}));
  const press = async (pred) => { const b = button(pred); assert.ok(b, 'button present'); await act(async () => { m.props(b).onClick({ preventDefault() {}, stopPropagation() {} }); }); };
  return {
    ...m, calls, pending,
    text: () => m.nodes().map(textOf).join(' '),
    useTemplate: () => press((t) => t === 'Use'),
    fill: () => press((t) => t === 'Fill from project'),
    keep: () => press((_, p) => p['data-testid'] === 'button-deck-proposal-keep'),
    disabled: (label) => m.props(button((t) => t === label))?.disabled === true,
    async answer(i, value) { await act(async () => { pending[i].ok(value); }); for (let k = 0; k < 3; k += 1) await m.flush(); },
    async refuse(i, message) { await act(async () => { pending[i].no(Object.assign(new Error(message), { status: 503 })); }); for (let k = 0; k < 3; k += 1) await m.flush(); },
    async select(id) {
      const n = m.nodes().find((x) => x.tagName === 'SELECT');
      await act(async () => { m.props(n).onChange({ target: { value: String(id) } }); });
      for (let k = 0; k < 3; k += 1) await m.flush();
    },
    writes: () => calls.filter((c) => ['keep', 'update'].includes(c[0])),
    async close() { await m.unmount(); Object.assign(api, original); },
  };
}

test('each press sends its own option with the run, before any re-render, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop the press headers from either call → the request carries no option.
  for (const mounted of [null, 'raise']) {
    const token = mounted ? setRailPage(mounted, 'draft:old') : null;
    const m = await mount();
    try {
      await m.useTemplate();
      await m.fill();
      const [apply, autofill] = [m.calls.find((c) => c[0] === 'apply'), m.calls.find((c) => c[0] === 'autofill')];
      assert.deepEqual(apply.slice(1, 3), [7, 'yc_seed']);
      assert.equal(apply[3]['X-Rail-Option'], encodeURIComponent('form:deck-template'));
      assert.equal(autofill[1], 10);
      assert.equal(autofill[2]['X-Rail-Option'], encodeURIComponent('form:deck'));
      for (const h of [apply[3], autofill[2]]) {
        assert.equal(h['X-Rail-Page'], mounted || undefined, 'the mounted page holds the Manual switch; with none the Worker names the inventory\'s');
      }
    } finally { if (token) clearRailPage(token); await m.close(); }
  }
});

test('a template the model fills is shown as a proposal: the deck and its versions wait for Keep', async () => {
  // Mutation checked: set the deck from a proposal answer → the editor draws the proposal as current.
  const m = await mount();
  try {
    await m.useTemplate();
    await m.answer(0, { proposal: PROPOSAL, method_id: 'yc_seed', coverage_pct: 80 });
    assert.ok(m.text().includes('Freight teams reconcile by hand.'), 'the proposal is drawn beside the current version');
    assert.ok(m.text().includes('Keep as new version'));
    assert.deepEqual(m.writes(), [], 'nothing is written on arrival');
    assert.equal(m.calls.filter((c) => c[0] === 'versions').length, 1, 'no version list refresh: no version was written');
    await m.keep();
    for (let k = 0; k < 3; k += 1) await m.flush();
    assert.deepEqual(m.writes(), [['keep', 55]], 'Keep is the only write');
  } finally { await m.close(); }
});

test('a run answers only the project it was pressed for: another project drops it, and switching back does not revive it', async () => {
  // Mutation checked: drop the stale check → the old project's proposal or refusal is drawn over the new one.
  const m = await mount();
  try {
    await m.useTemplate();
    await m.select(8);
    await m.answer(0, { proposal: PROPOSAL, method_id: 'yc_seed', coverage_pct: 80 });
    assert.ok(!m.text().includes('Freight teams reconcile by hand.'), 'a stale proposal is never drawn');
    assert.equal(m.disabled('Fill from project'), false, 'and the page is pressable again');
    await m.fill();
    await m.select(7);
    await m.refuse(1, 'Project eight could not be filled.');
    assert.ok(!m.text().includes('Project eight'), 'a stale refusal is never drawn either');
    assert.deepEqual(m.writes(), []);
  } finally { await m.close(); }
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
