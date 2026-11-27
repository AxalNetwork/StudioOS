/**
 * D778 part 4 (#2103) — the founder's fill bands (`FillProposals`) through the
 * run path: `fill:pain_tag`, `fill:hypothesis` and `fill:feedback_theme`. A
 * press sends its own option with the run (`X-Rail-Option`), keeping the
 * mounted rail's page, rather than waiting for the busy render to hand the
 * option to the rail. A run answers only the venture it was pressed for, and a
 * proposal is applied only on Accept.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_fill_bands_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { clearRailPage, railPressHeaders, setRailPage } from '../src/lib/railPage.js';
import FillProposals from '../src/workspaces/FillProposals.jsx';

const h = React.createElement;
const PART4 = ['pain_tag', 'hypothesis', 'feedback_theme'];
const KINDS = Object.fromEntries(PART4.map((k) => [k, { task: `task_${k}`, copy: { heading: k, run: 'Propose', accept: 'Add it', empty: 'None yet.' } }]));

async function mount(props) {
  const restore = installDocument();
  const orig = { list: api.listValidateProposals, propose: api.proposeValidate, accept: api.acceptValidateProposal };
  const calls = [];
  const pending = [];
  let listed = [];
  api.listValidateProposals = async (pid) => { calls.push(['list', pid]); return { proposals: listed, kinds: KINDS }; };
  api.proposeValidate = (...args) => { calls.push(['propose', ...args]); return new Promise((ok, no) => pending.push({ ok, no })); };
  api.acceptValidateProposal = async (...args) => { calls.push(['accept', ...args]); return {}; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const render = (p) => act(async () => { root.render(h(FillProposals, { enabled: true, ...p })); });
  await render(props);
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    calls, pending, settle, render, by, pr,
    setListed: (v) => { listed = v; },
    text: () => txt(container).replace(/\s+/g, ' ').trim(),
    press: (id) => act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }),
    async unmount() {
      await act(async () => root.unmount());
      Object.assign(api, { listValidateProposals: orig.list, proposeValidate: orig.propose, acceptValidateProposal: orig.accept });
      restore();
    },
  };
}

test('a press sends its own option with the run, before any re-render, keeping the mounted rail\'s page', async () => {
  // Mutation checked: drop the press headers from the run call → the first request carries no option.
  const token = setRailPage('validate');
  try {
    for (const kind of PART4) {
      const m = await mount({ projectId: 7, kind, railOption: `fill:${kind}` });
      try {
        await m.press(`action-propose-${kind}`);
        const [, pid, body, headers] = m.calls.find((c) => c[0] === 'propose');
        assert.deepEqual([pid, body.kind], [7, kind]);
        assert.equal(headers['X-Rail-Option'], encodeURIComponent(`fill:${kind}`), kind);
        assert.equal(headers['X-Rail-Page'], 'validate', 'the mounted page holds the Manual switch');
      } finally { await m.unmount(); }
    }
  } finally { clearRailPage(token); }
});

test('a band that names no option still sends its kind\'s key', async () => {
  const m = await mount({ projectId: 7, kind: 'hypothesis' });
  try {
    await m.press('action-propose-hypothesis');
    assert.equal(m.calls.find((c) => c[0] === 'propose')[3]['X-Rail-Option'], 'fill%3Ahypothesis');
  } finally { await m.unmount(); }
});

test('a proposal waits: nothing is applied until the founder presses Accept', async () => {
  // Mutation checked: accept on arrival → an accept call before the press.
  const m = await mount({ projectId: 7, kind: 'hypothesis', railOption: 'fill:hypothesis' });
  try {
    await m.press('action-propose-hypothesis');
    m.setListed([{ id: 5, kind: 'hypothesis', payload: { claim: 'Ops leads will pay.' } }]);
    await act(async () => { m.pending[0].ok({ proposals: [{ id: 5 }], usage: null }); });
    await m.settle();
    assert.ok(m.text().includes('Ops leads will pay.'));
    assert.ok(!m.calls.some((c) => c[0] === 'accept'), 'shown, not applied');
    await m.press('action-accept-5');
    await m.settle();
    assert.deepEqual(m.calls.filter((c) => c[0] === 'accept').map((c) => c[1]), [5]);
  } finally { await m.unmount(); }
});

test('a run answers only the venture it was pressed for: another project drops it', async () => {
  // Mutation checked: drop the stale check → the old project's refusal is drawn over the new one.
  const m = await mount({ projectId: 7, kind: 'pain_tag', railOption: 'fill:pain_tag' });
  try {
    await m.press('action-propose-pain_tag');
    await m.render({ projectId: 8, kind: 'pain_tag', railOption: 'fill:pain_tag' });
    await m.settle();
    await act(async () => { m.pending[0].no(Object.assign(new Error('Project seven has nothing to tag.'), {})); });
    await m.settle();
    assert.ok(!m.text().includes('Project seven'), 'a stale refusal is never drawn');
    assert.ok(m.pr(m.by('action-propose-pain_tag')).disabled !== true, 'and the band is pressable again');
    // A stale success is not drawn either: its "nothing new" belongs to the old project.
    await m.press('action-propose-pain_tag');
    await m.render({ projectId: 7, kind: 'pain_tag', railOption: 'fill:pain_tag' });
    await m.settle();
    await act(async () => { m.pending[1].ok({ proposals: [], usage: null }); });
    await m.settle();
    assert.ok(!m.text().includes('Nothing new to propose'), 'switching back does not revive it');
  } finally { await m.unmount(); }
});

test('the existing API method sends the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from `proposeValidate` → the request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ proposals: [] }), { status: 201, headers: { 'content-type': 'application/json' } }); };
  try {
    await api.proposeValidate(7, { kind: 'feedback_theme' }, railPressHeaders('fill:feedback_theme'));
    const sent = seen.find((s) => s.url.endsWith('/founder/validate/propose/7'));
    assert.ok(sent, JSON.stringify(seen.map((s) => s.url)));
    assert.equal(sent.init.headers['X-Rail-Option'], 'fill%3Afeedback_theme');
    assert.equal(JSON.parse(sent.init.body).kind, 'feedback_theme');
  } finally { globalThis.fetch = realFetch; restore(); }
});
