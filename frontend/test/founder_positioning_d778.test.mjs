import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { useNavigate } from 'react-router-dom';
import PitchPositioningPage from '../src/pages/PitchPositioningPage.jsx';
import { api } from '../src/lib/api.js';
import { setRailPage, clearRailPage } from '../src/lib/railPage.js';
import { mountContracts, installDocument } from './_contracts_dom.mjs';

const PAGE = 'Founder · Raise · Pitch deck';
const output = { one_liner: 'Dispatch together', elevator_pitch: 'Local shipments in one place.', positioning_lines: ['A shared screen'] };
const textOf = n => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '';
async function mount(initialId = 1) {
  const original = { ...api }; const calls = []; const writes = []; let answer; let reject;
  const pending = new Promise((resolve, fail) => { answer = resolve; reject = fail; });
  api.listProjects = async () => [{ id: 1, name: 'Harbour' }, { id: 2, name: 'Second' }];
  api.deckPositioning = (...args) => { calls.push(args); return pending; };
  api.deckUpdate = (...args) => { writes.push(args); };
  let navigate;
  function Screen(){ navigate=useNavigate(); return React.createElement(PitchPositioningPage); }
  const m = await mountContracts(React.createElement(Screen), `/raise/pitch/positioning?project_id=${initialId}`);
  for (let i = 0; i < 3; i++) await m.flush();
  const generate = () => m.nodes().find(n => n.tagName === 'BUTTON' && m.props(n)['data-testid'] === 'positioning-generate');
  return {
    ...m, calls, writes,
    async start() { await act(async () => { void m.props(generate()).onClick(); }); },
    async finish(value = output) { await act(async () => { answer(value); await pending; }); await m.flush(); },
    async fail() { await act(async () => { reject(Object.assign(new Error('Old request failed'), { status: 503 })); await pending.catch(() => {}); }); await m.flush(); },
    async select(id) {
      await act(async () => { navigate(`/raise/pitch/positioning?project_id=${id}`); });
    },
    text: () => m.nodes().map(textOf).join(' '),
    async close() { await m.unmount(); Object.assign(api, original); },
  };
}

for (const mounted of [null, 'raise']) test(`draft:positioning captures its option on press (${mounted || 'canonical fallback'}), and only returns a local draft`, async () => {
  const m = await mount(); const token = mounted ? setRailPage(mounted, 'draft:old') : null;
  try {
    assert.deepEqual(m.calls, [], 'mount runs no model');
    await m.start();
    assert.deepEqual(m.calls, [['1', { 'X-Rail-Page': mounted || encodeURIComponent(PAGE), 'X-Rail-Option': 'draft:positioning' }]]);
    await m.finish();
    assert.match(m.text(), /Dispatch together/);
    assert.deepEqual(m.writes, [], 'a draft never updates the deck');
  } finally { if (token) clearRailPage(token); await m.close(); }
});

for (const ids of [[2], [2, 1]]) test(`draft:positioning ignores responses after changing project ${ids.join(' → ')}`, async () => {
  const m = await mount();
  try {
    await m.start();
    for (const id of ids) await m.select(id);
    await m.finish();
    assert.doesNotMatch(m.text(), /Dispatch together/);
    assert.deepEqual(m.writes, []);
  } finally { await m.close(); }
});


test('the existing mounted positioning API forwards explicit press context', async () => {
  const restore = installDocument(); const before = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push([url, opts]); return new Response('{}', { headers: { 'content-type': 'application/json' } }); };
  try {
    const headers = { 'X-Rail-Page': encodeURIComponent(PAGE), 'X-Rail-Option': 'draft:positioning' };
    await api.deckPositioning('1', headers);
    assert.equal(calls[0][0], '/api/decks/positioning');
    assert.equal(calls[0][1].headers['X-Rail-Page'], headers['X-Rail-Page']);
    assert.equal(calls[0][1].headers['X-Rail-Option'], 'draft:positioning');
    assert.deepEqual(JSON.parse(calls[0][1].body), { project_id: '1' });
  } finally { globalThis.fetch = before; restore(); }
});


test('a refusal for a previous project cannot replace the current form with an error', async () => {
  const m = await mount();
  try {
    await m.start(); await m.select(2); await m.fail();
    assert.doesNotMatch(m.text(), /Old request failed/);
  } finally { await m.close(); }
});


test('#2691: positioning uses the venture in the address and offers no in-page picker',async()=>{
 const m=await mount(2);
 try {
  await m.start();
  assert.equal(m.calls[0][0],'2');
  assert.equal(m.nodes().some(n=>n.tagName==='SELECT'),false);
  await m.select(1); await m.finish();
  assert.doesNotMatch(m.text(),/Dispatch together/);
 }finally{await m.close();}
});
