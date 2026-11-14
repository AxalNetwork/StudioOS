// D4251 (#4251) — HQ › Decks › AI models: the elements × models grid, the kill
// switch and the plan floor, each change with a reason, the safety model kept on.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_models_d4251.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { adminAiModelsApi } from '../src/lib/api/adminAiModels.js';
import AiModelsTab from '../src/pages/hq/decks/AiModelsTab.jsx';
import { NOT_RECORDED, changeBody, modelGrid, reasonOk, stateOf } from '../src/pages/hq/decks/aiModelsModel.js';

const h = React.createElement;
const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const GUARD = '@cf/meta/llama-guard-3-8b';
const REPLY = {
  groups: [{ group: 'text', label: 'Text' }, { group: 'images', label: 'Images' }],
  elements: [{ element: 'title', group: 'text' }, { element: 'body', group: 'text' }, { element: 'photo', group: 'images' }],
  models: [
    { id: LLAMA, name: 'llama-3.3-70b-instruct-fp8-fast', kind: 'Text Generation', status: 'ga', offered: true, required: false, elements: ['title', 'body'],
      policy: { enabled: false, plan_min: null, note: 'Quality regressed.', updated_by: { uid: 'u1', name: 'Sana Super' }, updated_at: '2026-11-03 09:30:00' } },
    { id: GUARD, name: 'llama-guard-3-8b', kind: 'Text Generation', status: 'ga', offered: true, required: true, elements: [], policy: null },
    { id: '@cf/b/flux', name: 'flux-1-schnell', kind: 'Text-to-Image', status: 'ga', offered: true, required: false, elements: ['photo'], policy: { enabled: true, plan_min: 'studio', note: null, updated_by: null, updated_at: '2026-11-02' } },
  ],
  plan_mins: ['free', 'growth', 'studio'],
};

test('the model: the grid counts each group\'s elements a model serves; states and the change body', () => {
  // Mutation checked: changeBody without the reason check → a bare change is sent; without the required check → the guard is switched off.
  const { groups, rows } = modelGrid(REPLY);
  assert.deepEqual(groups.map((g) => g.label), ['Text', 'Images']);
  assert.deepEqual(rows[0].cells.map((c) => `${c.n}/${c.of}`), ['2/2', '0/1']);
  assert.deepEqual(rows.map((r) => r.state.key), ['off', 'on', 'floor']);
  assert.equal(rows[2].state.label, 'Raise + Grow only');
  assert.equal(stateOf({ offered: false, policy: null }).key, 'not_offered');
  assert.equal(rows[1].by, null, 'no policy, no author');
  assert.equal(reasonOk('too short'), false);
  assert.equal(changeBody(rows[0], { enabled: true, planMin: 'free', note: '', reason: 'short' }), null);
  assert.deepEqual(changeBody(rows[0], { enabled: true, planMin: 'growth', note: ' Back. ', reason: 'Fixed upstream this morning.' }),
    { model_id: LLAMA, enabled: true, plan_min: 'growth', note: 'Back.', reason: 'Fixed upstream this morning.' });
  assert.equal(changeBody(rows[1], { enabled: false, planMin: 'free', note: '', reason: 'Trying to stop the guard.' }), null, 'the safety model stays on');
  assert.equal(changeBody(rows[1], { enabled: true, planMin: 'studio', note: '', reason: 'Trying to fence the guard.' }), null);
  assert.equal(NOT_RECORDED, 'Not recorded');
});

async function mount(over = {}) {
  const calls = [];
  const orig = { ...adminAiModelsApi };
  adminAiModelsApi.read = over.read || (async () => { calls.push(['read']); return REPLY; });
  adminAiModelsApi.set = async (b) => { calls.push(['set', b]); return { ok: true }; };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(AiModelsTab)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(n) { assert.ok(n, 'drawn'); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async type(n, value) { await act(async () => { pr(n).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); restore(); Object.assign(adminAiModelsApi, orig); },
  };
}

test('the tab: the grid draws each model\'s state; Change asks for a reason before it saves; the guard\'s switch is locked', async () => {
  // Mutation checked: Save enabled without a reason → the first set lands; the guard's checkbox enabled → the required line is gone.
  const m = await mount();
  try {
    assert.match(m.text(m.by(`hq-ai-model-state-${LLAMA}`)), /Off for everyone Quality regressed\./);
    assert.match(m.text(m.by(`hq-ai-model-${LLAMA}`)), /2 of 2/);
    assert.match(m.text(m.by(`hq-ai-model-${LLAMA}`)), /Sana Super/);
    await m.press(m.by(`hq-ai-model-change-${LLAMA}`));
    assert.equal(m.pr(m.by('hq-ai-models-save')).disabled, true, 'no reason, no save');
    await m.type(m.by('hq-ai-models-enabled'), true);
    await m.type(m.by('hq-ai-models-reason'), 'Fixed upstream; back on for everyone.');
    assert.equal(m.pr(m.by('hq-ai-models-save')).disabled, false);
    await m.press(m.by('hq-ai-models-save'));
    assert.deepEqual(m.calls.find(([n]) => n === 'set')[1], { model_id: LLAMA, enabled: true, plan_min: null, note: 'Quality regressed.', reason: 'Fixed upstream; back on for everyone.' });
    assert.equal(m.calls.filter(([n]) => n === 'read').length, 2, 'the grid is read again after the change');
    await m.press(m.by(`hq-ai-model-change-${GUARD}`));
    assert.ok(m.by('hq-ai-models-required'));
    assert.equal(m.pr(m.by('hq-ai-models-enabled')).disabled, true);
  } finally { await m.unmount(); }
});

test('the tab: a refused read says only a Super Admin sees it; a failed read is never an empty grid', async () => {
  const refused = await mount({ read: async () => { throw Object.assign(new Error('Super admin required'), { status: 403 }); } });
  try { assert.ok(refused.by('hq-ai-models-super-only')); assert.ok(!refused.by('hq-ai-models-table')); } finally { await refused.unmount(); }
  const failed = await mount({ read: async () => { throw Object.assign(new Error('down'), { status: 503 }); } });
  try { assert.match(failed.text(failed.by('hq-ai-models-unreadable')), /That is not the same as every model being on\./); } finally { await failed.unmount(); }
});

test('the wiring: the tab is on HQ › Decks at its own address; the client calls the mounted route', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  assert.match(read('routes/hqDecks.jsx'), /<Route path="\/admin\/platform\/decks\/models" element=\{guard\(\['admin'\], hqOnly\(<HqDecksPage \/>\)\)\} \/>/);
  assert.match(read('pages/hq/decks/HqDecksPage.jsx'), /\{view === 'models' \? <AiModelsTab \/> : null\}/);
  assert.match(read('lib/api/adminAiModels.js'), /request\('\/admin\/ai\/element-models'\)/);
});
