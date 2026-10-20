/**
 * D778 part 3 (#2103) — the founder's draft bands (`ZoneDraft`) through the
 * run path. A press sends its own option with the run (`X-Rail-Option`), with
 * the mounted rail's page kept, rather than waiting for the busy render to
 * hand the option to the rail. A run answers only the band it was pressed on:
 * another record (scope) or leaving the page drops it. Nothing is accepted,
 * so no record is written, until the founder presses Accept.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_draft_bands_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { clearRailPage, setRailPage } from '../src/lib/railPage.js';
import { api } from '../src/lib/api.js';
import ZoneDraft, { pressHeaders } from '../src/workspaces/ZoneDraft.jsx';

const h = React.createElement;
const PART3 = [
  'build/roadmap', 'build/this-week', 'build/retro', 'build/kpi',
  'raise/data-room', 'raise/legal', 'raise/narrative-fix', 'raise/capital', 'raise/liquidity',
  'grow/customers', 'grow/talent', 'network/re-engagement', 'network/intro-email', 'research/funds',
];

async function mount(props) {
  const restore = installDocument();
  const orig = { ...api.research };
  const calls = [];
  const pending = [];
  api.research.zoneDrafts = async () => ({ items: [] });
  api.research.zoneDraftRun = (...args) => { calls.push(['run', ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.research.zoneDraftAccept = async (...args) => { calls.push(['accept', ...args]); return { item: { uid: args[0], body: 'kept', accepted: true, cost_usd: 0 } }; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const render = (p) => act(async () => { root.render(h(ZoneDraft, { label: 'Band', empty: 'Nothing yet.', run: 'Draft it', accept: 'Accept it', ...p })); });
  await render(props);
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(txt).join(''));
  const button = (label) => walk(container).find((n) => n.tagName === 'BUTTON' && txt(n).trim() === label);
  return {
    calls, pending, settle, render, button,
    text: () => txt(container),
    press: (label) => act(async () => { pr(button(label)).onClick(); }),
    async unmount() { await act(async () => root.unmount()); Object.assign(api.research, orig); restore(); },
  };
}

test('a press sends its own option with the run, before any re-render, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop `pressHeaders(option)` from the run call → the first request carries no option.
  const token = setRailPage('build');
  try {
    for (const surface of PART3) {
      const m = await mount({ surface, scopeKey: '7' });
      try {
        await m.press('Draft it');
        const [, sent, scope, , headers] = m.calls[0];
        assert.deepEqual([sent, scope], [surface, '7']);
        assert.equal(headers['X-Rail-Option'], encodeURIComponent(`draft:${surface}`), surface);
        assert.equal(headers['X-Rail-Page'], 'build', 'the mounted page holds the Manual switch');
      } finally { await m.unmount(); }
    }
  } finally { clearRailPage(token); }
  // No rail mounted: the option alone; the Worker names the inventoried page.
  assert.deepEqual(pressHeaders('draft:build/kpi'), { 'X-Rail-Option': 'draft%3Abuild%2Fkpi' });
});

test('a band keyed otherwise sends that key', async () => {
  const m = await mount({ surface: 'build/retro', railOption: 'draft:retro-summary' });
  try {
    await m.press('Draft it');
    assert.equal(m.calls[0][4]['X-Rail-Option'], 'draft%3Aretro-summary');
  } finally { await m.unmount(); }
});

test('the draft waits: nothing is accepted until the founder presses Accept', async () => {
  // Mutation checked: accept on arrival → an accept call before the press.
  const m = await mount({ surface: 'build/this-week', scopeKey: '7' });
  try {
    await m.press('Draft it');
    await act(async () => { m.pending[0].ok({ item: { uid: 'd1', body: 'A Monday plan.', accepted: false, cost_usd: 0 } }); });
    await m.settle();
    assert.ok(m.text().includes('A Monday plan.'));
    assert.deepEqual(m.calls.map((c) => c[0]), ['run'], 'shown, not accepted');
    await m.press('Accept it');
    await m.settle();
    assert.deepEqual(m.calls.map((c) => c[0]), ['run', 'accept']);
    assert.equal(m.calls[1][1], 'd1');
  } finally { await m.unmount(); }
});

test('a run answers only the band it was pressed on: another project or record drops it', async () => {
  // Mutation checked: drop the stale check → the old project's draft lands on the new one.
  const m = await mount({ surface: 'raise/capital', scopeKey: '7' });
  try {
    await m.press('Draft it');
    await m.render({ surface: 'raise/capital', scopeKey: '8' });
    await m.settle();
    await act(async () => { m.pending[0].ok({ item: { uid: 'old', body: 'Project seven\'s round.', accepted: false, cost_usd: 0 } }); });
    await m.settle();
    assert.ok(!m.text().includes('Project seven'), 'a stale draft is never drawn');
    assert.ok(m.button('Draft it'), 'and the band is pressable again');
    // A stale refusal is not drawn either.
    await m.press('Draft it');
    await m.render({ surface: 'raise/capital', scopeKey: '7' });
    await m.settle();
    await act(async () => { m.pending[1].no(Object.assign(new Error('x'), { code: 'nothing_to_draft' })); });
    await m.settle();
    assert.ok(!m.text().includes('nothing on this page'), 'switching back does not revive it');
  } finally { await m.unmount(); }
});

test('the existing API method sends the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from `zoneDraftRun` → the request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ item: null }), { status: 201, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.research.zoneDraftRun('build/kpi', '7', '/build', pressHeaders('draft:build/kpi'));
    const sent = seen.find((s) => s.url.endsWith('/research/drafts'));
    assert.ok(sent, JSON.stringify(seen.map((s) => s.url)));
    assert.equal(sent.init.headers['X-Rail-Option'], 'draft%3Abuild%2Fkpi');
    assert.deepEqual(JSON.parse(sent.init.body), { surface: 'build/kpi', scope_key: '7', page: '/build' });
  } finally { globalThis.fetch = realFetch; restore(); }
});
