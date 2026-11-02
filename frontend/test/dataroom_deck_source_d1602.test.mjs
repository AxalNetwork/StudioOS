import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import DataRoomDeckSource, { extractionLabel } from '../src/pages/raise/dataroom/DataRoomDeckSource.jsx';
import { dataRoomApi } from '../src/lib/api/dataRoom.js';
import { setDeckSource, availability } from '../src/pages/raise/pitch/deckV2Adapter.js';

async function mount(room, file = {}, onChanged = () => {}) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = tag => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(React.createElement(DataRoomDeckSource, { room, file: { uid: 'f/a', ...file }, projectUid: 'p/a', onChanged })));
  const nodes = n => [n, ...(n.childNodes || []).flatMap(nodes)];
  const props = n => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const find = id => nodes(host).find(n => props(n)['data-testid'] === id);
  const text = n => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '';
  return { has: id => !!find(id), text: () => text(host), prop: (id, key) => props(find(id))[key],
    async update(nextFile) { await act(async () => root.render(React.createElement(DataRoomDeckSource, { room, file: { uid: 'f/a', ...nextFile }, projectUid: 'p/a', onChanged }))); },
    async do(id, action = 'onClick') { const n = find(id); assert.ok(n, id); await act(async () => props(n)[action]()); },
    async close() { await act(async () => root.unmount()); restore(); } };
}

test('owner opts in only on an available route; cofounder cannot change it, extraction states are explicit', async () => {
  const hidden = await mount({ role: 'owner' });
  try { assert.equal(hidden.has('dataroom-deck-source'), false); } finally { await hidden.close(); }
  const co = await mount({ role: 'cofounder', deck_sources_available: true }, { deck_source: true, extraction: { state: 'done' } });
  try { assert.equal(co.prop('dataroom-deck-source-toggle', 'disabled'), true); assert.ok(co.text().includes('Document · Sourced')); } finally { await co.close(); }
  assert.deepEqual(['queued', 'done', 'no_values', 'unreadable'].map(extractionLabel), ['Queued for extraction', 'Document · Sourced', 'No supported values found', 'Extraction unreadable — try again']);
});

test('polling stops as soon as the server reports a recoverable unreadable extraction', async () => {
  const real = { set: globalThis.setInterval, clear: globalThis.clearInterval }, timers = [], cleared = [];
  globalThis.setInterval = (fn, delay) => { timers.push({ fn, delay }); return 42; };
  globalThis.clearInterval = id => cleared.push(id);
  const ui = await mount({ role: 'owner', deck_sources_available: true }, { deck_source: true, extraction: { state: 'queued' } });
  try {
    assert.equal(timers.length, 1); assert.equal(timers[0].delay, 5000);
    await ui.update({ deck_source: true, extraction: { state: 'unreadable' } });
    assert.deepEqual(cleared, [42]); assert.equal(timers.length, 1);
    assert.ok(ui.text().includes('Try extraction again'));
  } finally { await ui.close(); globalThis.setInterval = real.set; globalThis.clearInterval = real.clear; }
});

test('a collaborator update asks the owner to confirm extraction, with no spending control for a cofounder', async () => {
  const file = { deck_source: true, extraction: { state: 'unreadable', reason: 'owner_confirmation_required' } };
  const owner = await mount({ role: 'owner', deck_sources_available: true }, file);
  try {
    assert.ok(owner.text().includes('Owner confirmation needed')); assert.ok(owner.text().includes('Confirm extraction'));
    await owner.do('dataroom-deck-source-retry');
    assert.ok(owner.has('dataroom-deck-source-dialog')); assert.ok(owner.text().includes('updates by cofounders need the owner'));
  } finally { await owner.close(); }
  const co = await mount({ role: 'cofounder', deck_sources_available: true }, file);
  try { assert.equal(co.has('dataroom-deck-source-retry'), false); assert.equal(co.prop('dataroom-deck-source-toggle', 'disabled'), true); } finally { await co.close(); }
});

test('typed quote remains in the dialog, holds are shown before confirmation, and only confirmed quote is resent', async () => {
  const real = dataRoomApi.setDeckSource; const calls = []; let changed = 0;
  dataRoomApi.setDeckSource = async (...args) => { calls.push(args); if (calls.length === 1) throw Object.assign(new Error('quote'), { status: 402, data: { quote: { hold_microusd: 1234, confirm_quote: 'confirmed' } } }); return { deck_source: true, extraction: { state: 'queued' } }; };
  const ui = await mount({ role: 'owner', deck_sources_available: true }, {}, () => changed++);
  try {
    await ui.do('dataroom-deck-source-toggle', 'onChange');
    assert.equal(calls.length, 0, 'opening the confirmation does not write');
    await ui.do('dataroom-deck-source-dialog-go');
    assert.ok(ui.text().includes('Holds up to $0.001234'));
    assert.equal(changed, 0);
    await ui.do('dataroom-deck-source-dialog-go');
    assert.deepEqual(calls, [['p/a', 'f/a', { enabled: true }], ['p/a', 'f/a', { enabled: true, confirm_quote: 'confirmed' }]]);
    assert.equal(changed, 1); assert.equal(ui.has('dataroom-deck-source-dialog'), false);
  } finally { dataRoomApi.setDeckSource = real; await ui.close(); }
});

test('withdraw confirms first; failed save stays in the dialog and the deck seam uses the real client', async () => {
  const real = dataRoomApi.setDeckSource; const calls = [];
  dataRoomApi.setDeckSource = async (...args) => { calls.push(args); throw new Error('Try this again.'); };
  const ui = await mount({ role: 'owner', deck_sources_available: true }, { deck_source: true, extraction: { state: 'done' } });
  try {
    await ui.do('dataroom-deck-source-toggle', 'onChange');
    assert.ok(ui.text().includes('Withdraw this deck source?')); assert.equal(calls.length, 0);
    await ui.do('dataroom-deck-source-dialog-go');
    assert.ok(ui.text().includes('Try this again.')); assert.equal(ui.has('dataroom-deck-source-dialog'), true);
    assert.deepEqual(calls, [['p/a', 'f/a', { enabled: false }]]);
    dataRoomApi.setDeckSource = async (...args) => { calls.push(args); return { uid: 'f/a', deck_source: true }; };
    assert.deepEqual(await setDeckSource('p/a', 'f/a', { enabled: true }), { available: true, value: { uid: 'f/a', deck_source: true } });
    assert.deepEqual(calls[1], ['p/a', 'f/a', { enabled: true }]); assert.equal(availability('setDeckSource'), null);
  } finally { dataRoomApi.setDeckSource = real; await ui.close(); }
});

test('the real client encodes both identifiers, sends PUT and keeps the quote refusal inline', async () => {
  const restore = installDocument(), real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push([String(url), options.method, JSON.parse(options.body)]); return new Response(JSON.stringify({ detail: 'Confirm the cost.', code: 'quote_required', quote: { confirm_quote: 'quoted' } }), { status: 402, headers: { 'content-type': 'application/json' } }); };
  try {
    await assert.rejects(dataRoomApi.setDeckSource('p/a', 'f?a', { enabled: true, confirm_quote: 'prior' }), e => e.status === 402 && e.data.quote.confirm_quote === 'quoted');
    assert.ok(calls[0][0].endsWith('/data-room/p%2Fa/files/f%3Fa/deck-source'));
    assert.deepEqual(calls[0].slice(1), ['PUT', { enabled: true, confirm_quote: 'prior' }]);
  } finally { globalThis.fetch = real; restore(); }
});
