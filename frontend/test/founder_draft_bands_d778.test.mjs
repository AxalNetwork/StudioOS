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
import { readFileSync } from 'node:fs';
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

async function mount(props, overrides = {}) {
  const restore = installDocument();
  const orig = { ...api.research };
  const calls = [];
  const pending = [];
  api.research.zoneDrafts = async () => ({ items: [] });
  api.research.zoneDraftRun = (...args) => { calls.push(['run', ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.research.zoneDraftAccept = async (...args) => { calls.push(['accept', ...args]); return { item: { uid: args[0], body: 'kept', accepted: true, cost_usd: 0 } }; };
  api.research.zoneDraftDiscard = async (...args) => { calls.push(['discard', ...args]); return { ok: true }; };
  Object.assign(api.research, overrides);
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

const SHARED = ['network/relationships', 'network/introductions', 'research/ask', 'research/library'];
const proposal = (uid) => ({ item: { uid, body: `Draft ${uid}`, accepted: false, cost_usd: 0 } });
const deferred = () => {
  let ok, no;
  const promise = new Promise((resolve, reject) => { ok = resolve; no = reject; });
  return { promise, ok, no };
};

test('D778 part 10: each shared option sends its own key and waits for an explicit decision', async () => {
  for (const surface of SHARED) {
    const token = setRailPage(surface.split('/')[0]);
    const m = await mount({ surface, scopeKey: 'session-a' });
    try {
      await m.press('Draft it');
      assert.deepEqual(m.calls[0].slice(1, 3), [surface, 'session-a']);
      assert.equal(m.calls[0][4]['X-Rail-Page'], surface.split('/')[0]);
      assert.equal(m.calls[0][4]['X-Rail-Option'], encodeURIComponent(`draft:${surface}`));
      await act(async () => m.pending[0].ok(proposal(surface)));
      await m.settle();
      assert.ok(m.text().includes(`Draft ${surface}`));
      assert.deepEqual(m.calls.map((c) => c[0]), ['run']);
      await m.press('Accept it');
      assert.deepEqual(m.calls.map((c) => c[0]), ['run', 'accept']);
      assert.equal(m.calls[1][1], surface);
    } finally { await m.unmount(); clearRailPage(token); }
  }
});

test('D778 part 10: late loads and failed loads never replace or clear another band', async () => {
  for (const fail of [false, true]) {
    const old = deferred();
    const m = await mount({ surface: 'research/ask', scopeKey: 'old', scoped: true }, {
      zoneDrafts: async (_surface, scope) => scope === 'old' ? old.promise : { items: [proposal('new').item] },
    });
    try {
      await m.render({ surface: 'research/ask', scopeKey: 'new', scoped: true });
      await m.settle();
      assert.ok(m.text().includes('Draft new'));
      await act(async () => fail ? old.no(new Error('old load failed')) : old.ok({ items: [proposal('old').item] }));
      await m.settle();
      assert.ok(m.text().includes('Draft new'));
      assert.ok(!m.text().includes('Draft old'));
    } finally { await m.unmount(); }
  }
});

test('D778 part 10: a mount load cannot overwrite a newer run on the same band', async () => {
  const load = deferred();
  const m = await mount({ surface: 'research/library' }, { zoneDrafts: () => load.promise });
  try {
    await m.press('Draft it');
    await act(async () => m.pending[0].ok(proposal('fresh')));
    await act(async () => load.ok({ items: [proposal('obsolete').item] }));
    await m.settle();
    assert.ok(m.text().includes('Draft fresh'));
    assert.ok(!m.text().includes('obsolete'));
  } finally { await m.unmount(); }
});

test('D778 part 10: the new band is immediately pressable and an old run cannot release its busy state', async () => {
  const m = await mount({ surface: 'research/ask', scopeKey: 'old' });
  try {
    await m.press('Draft it');
    await m.render({ surface: 'research/ask', scopeKey: 'new' });
    await m.settle();
    assert.ok(m.button('Draft it'), 'the old request does not lock the new session');
    await m.press('Draft it');
    await act(async () => m.pending[0].ok(proposal('old')));
    await m.settle();
    assert.ok(m.button('Drafting…'), 'old finally must not clear the new run');
    assert.ok(!m.text().includes('Draft old'));
    await act(async () => m.pending[1].ok(proposal('new')));
    await m.settle();
    assert.ok(m.text().includes('Draft new'));
  } finally { await m.unmount(); }
});

test('D778 part 10: late Accept results or errors never update or notify another session', async () => {
  for (const fail of [false, true]) {
    const pending = []; const accepted = [];
    const load = async (_s, scope) => ({ items: [proposal(scope).item] });
    const props = (scopeKey) => ({ surface: 'research/ask', scopeKey, scoped: true, onAccepted: (v) => accepted.push(v.uid) });
    const m = await mount(props('old'), {
      zoneDrafts: load,
      zoneDraftAccept: () => { const d = deferred(); pending.push(d); return d.promise; },
    });
    try {
      await m.press('Accept it');
      await m.render(props('new')); await m.settle();
      assert.ok(m.text().includes('Draft new'));
      await m.press('Accept it');
      await act(async () => fail ? pending[0].no(new Error('old accept failed')) : pending[0].ok(proposal('old')));
      await m.settle();
      assert.deepEqual(accepted, []);
      assert.ok(m.button('Saving…'));
      assert.ok(m.text().includes('Draft new'));
      assert.ok(!m.text().includes('could not be saved'));
      await act(async () => pending[1].ok(proposal('new')));
      await m.settle();
      assert.deepEqual(accepted, ['new']);
    } finally { await m.unmount(); }
  }
});

test('D778 part 10: late Discard results or errors cannot discard a different draft', async () => {
  for (const fail of [false, true]) {
    const pending = [];
    const m = await mount({ surface: 'network/relationships' }, {
      zoneDrafts: async (surface) => ({ items: [proposal(surface).item] }),
      zoneDraftDiscard: () => { const d = deferred(); pending.push(d); return d.promise; },
    });
    try {
      await m.press('Discard');
      await m.render({ surface: 'network/introductions' }); await m.settle();
      assert.ok(m.text().includes('Draft network/introductions'));
      await m.press('Discard');
      await act(async () => fail ? pending[0].no(new Error('old discard failed')) : pending[0].ok({ ok: true }));
      await m.settle();
      assert.ok(m.text().includes('Draft network/introductions'));
      assert.ok(m.button('Discarding…'));
      assert.ok(!m.text().includes('could not be discarded'));
      await act(async () => pending[1].ok({ ok: true }));
      await m.settle();
      assert.ok(m.button('Draft it'));
    } finally { await m.unmount(); }
  }
});


test('D778 part 10: the Ask brief reads only the open session, and an empty session cannot draft a previous one', async () => {
  const source = readFileSync(new URL('../src/pages/research/AskZone.jsx', import.meta.url), 'utf8');
  assert.match(source, /scopeKey=\{sessionUid\}\s+scoped\s+blocked=\{!sessionUid/);
  const reads = [];
  const m = await mount({ surface: 'research/ask', scopeKey: 'session-a', scoped: true }, {
    zoneDrafts: async (...args) => { reads.push(args); return { items: [] }; },
  });
  try {
    await m.render({ surface: 'research/ask', scopeKey: 'session-b', scoped: true });
    await m.settle();
    assert.deepEqual(reads, [['research/ask', 'session-a'], ['research/ask', 'session-b']]);
    await m.render({ surface: 'research/ask', scopeKey: '', scoped: true, blocked: 'Ask a question first.' });
    await m.settle();
    await m.press('Draft it');
    assert.equal(m.calls.length, 0);
    assert.deepEqual(reads.at(-1), ['research/ask', '']);
  } finally { await m.unmount(); }
});

test('D778 part 10: leaving the page ends pending acceptance callbacks', async () => {
  const decision = deferred(); const accepted = [];
  const m = await mount({ surface: 'research/ask', onAccepted: (v) => accepted.push(v.uid) }, {
    zoneDrafts: async () => ({ items: [proposal('open').item] }),
    zoneDraftAccept: () => decision.promise,
  });
  await m.press('Accept it');
  await m.unmount();
  await act(async () => decision.ok(proposal('closed')));
  assert.deepEqual(accepted, []);
});
