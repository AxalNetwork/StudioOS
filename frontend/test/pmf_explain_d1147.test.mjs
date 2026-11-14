import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import PmfExplain from '../src/workspaces/PmfExplain.jsx';
import { pmfExplainApi } from '../src/lib/api/pmfExplain.js';
const item = { input: 'waitlist', text: 'The recorded evidence is limited.', citation: { label: 'Waitlist', words: '0 signups', grade: 'sourced', stale: false, state: 'recorded', module: 'demand-signals' } };
const proposal = { items: [item], receipt: { payload: 'synthetic receipt', signature: 'synthetic signature' } };
async function mounted(overrides = {}) {
  const restore = installDocument();
  const saved = { ...pmfExplainApi }; const calls = [];
  const previousMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = tag => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  pmfExplainApi.read = async p => { calls.push(['read', p]); return overrides.read ? overrides.read(p) : { reading: null }; };
  pmfExplainApi.preview = async (p, mode, headers, inputsHash) => { calls.push(['preview', p, mode, headers, inputsHash]); return overrides.preview ? overrides.preview(p, mode) : mode === 'questions' ? { items: [item] } : proposal; };
  pmfExplainApi.keep = async (p, receipt) => { calls.push(['keep', p, receipt]); return overrides.keep ? overrides.keep(p, receipt) : { reading: { items: [item] } }; };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const render = async (projectId, inputsHash = 'a'.repeat(64)) => { await act(async () => root.render(React.createElement(PmfExplain, { projectId, inputsHash }))); await flush(); };
  await render(7);
  const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = n => n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '';
  const props = n => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  return { calls, render, flush, text: () => text(container),
    async start(label) { const node = walk(container).find(n => n.tagName?.toUpperCase() === 'BUTTON' && text(n) === label); assert.ok(node); let pending; await act(async () => { pending = props(node).onClick(); }); return { pending }; },
    async click(label) { const node = walk(container).find(n => n.tagName?.toUpperCase() === 'BUTTON' && text(n) === label); assert.ok(node, `Button missing: ${label}`); await act(async () => { await props(node).onClick(); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(pmfExplainApi, saved); globalThis.matchMedia = previousMatch; restore(); },
  };
}
test('mount reads only kept text; Explain is a cited proposal and Dismiss never calls Keep', async () => {
  const ui = await mounted();
  try {
    assert.deepEqual(ui.calls, [['read', 7]]); assert.match(ui.text(), /Explain this score/);
    await ui.click('Explain this score');
    assert.match(ui.text(), /Proposal · plain-language reading/); assert.match(ui.text(), /Cites · Waitlist/); assert.match(ui.text(), /0 signups/);
    assert.equal(ui.calls[1][2], 'explain'); assert.equal(decodeURIComponent(ui.calls[1][3]['X-Rail-Option']), 'draft:raise/pmf-explain');
    assert.equal(ui.calls[1][4], 'a'.repeat(64));
    await ui.click('Dismiss'); assert.equal(ui.calls.filter(c => c[0] === 'keep').length, 0); assert.doesNotMatch(ui.text(), /The recorded evidence is limited/);
  } finally { await ui.close(); }
});
test('only Keep persists the receipt; it keeps the original input citations and closes the dialog', async () => {
  const ui = await mounted();
  try {
    await ui.click('Explain this score'); await ui.click('Keep this reading');
    assert.deepEqual(ui.calls.find(c => c[0] === 'keep'), ['keep', 7, proposal.receipt]);
    assert.match(ui.text(), /Kept reading/); assert.match(ui.text(), /Cites · Waitlist/); assert.doesNotMatch(ui.text(), /Proposal · plain-language reading/);
  } finally { await ui.close(); }
});
test('questions offer Copy and Dismiss, no Keep, with the questions rail option', async () => {
  const ui = await mounted();
  try {
    await ui.click('Questions for the next interviews');
    assert.match(ui.text(), /Copy questions/); assert.doesNotMatch(ui.text(), /Keep this reading/);
    assert.equal(decodeURIComponent(ui.calls[1][3]['X-Rail-Option']), 'draft:raise/pmf-questions');
    await ui.click('Dismiss'); assert.equal(ui.calls.some(c => c[0] === 'keep'), false);
  } finally { await ui.close(); }
});
test('failed reads say Unreadable and retry rather than pretending there is no saved reading', async () => {
  let attempts = 0;
  const ui = await mounted({ read: async () => { if (++attempts === 1) throw new Error('Synthetic read failure'); return { reading: { items: [item] } }; } });
  try { assert.match(ui.text(), /Kept reading · Unreadable/); await ui.click('Try again'); assert.match(ui.text(), /0 signups/); assert.doesNotMatch(ui.text(), /Unreadable/); }
  finally { await ui.close(); }
});
test('a failed Keep retains the preview for retry; no score is submitted', async () => {
  const ui = await mounted({ keep: async () => { throw Object.assign(new Error('Synthetic stale refusal'), { status: 409 }); } });
  try { await ui.click('Explain this score'); await ui.click('Keep this reading'); assert.match(ui.text(), /inputs changed/); assert.match(ui.text(), /Keep this reading/); assert.deepEqual(Object.keys(ui.calls.find(c => c[0] === 'keep')[2]).sort(), ['payload','signature']); }
  finally { await ui.close(); }
});
test('a late preview from a previous venture cannot replace the current venture reading', async () => {
  const resolve = new Map();
  const ui = await mounted({ preview: p => new Promise(done => resolve.set(p, done)) });
  try {
    const old = await ui.start('Explain this score');
    await ui.render(8);
    const current = await ui.start('Explain this score');
    await act(async () => { resolve.get(7)({ ...proposal, items: [{ ...item, text: 'Previous venture wording.' }] }); await old.pending; });
    assert.doesNotMatch(ui.text(), /Previous venture wording/);
    await act(async () => { resolve.get(8)({ ...proposal, items: [{ ...item, text: 'Current venture wording.' }] }); await current.pending; });
    assert.match(ui.text(), /Current venture wording/);
    assert.equal(ui.calls.filter(c => c[0] === 'keep').length, 0);
  } finally { await ui.close(); }
});
test('a refreshed input payload clears the old proposal and uses its new hash', async () => {
  const ui = await mounted();
  try {
    await ui.click('Explain this score'); await ui.render(7, 'b'.repeat(64));
    assert.doesNotMatch(ui.text(), /Proposal · plain-language reading/);
    await ui.click('Questions for the next interviews');
    assert.equal(ui.calls.filter(c => c[0] === 'preview').at(-1)[4], 'b'.repeat(64));
  } finally { await ui.close(); }
});
