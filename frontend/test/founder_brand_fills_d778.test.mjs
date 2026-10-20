// D778 part 1: exercise the real page's three press handlers and explicit Save.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import BrandBuilderPage from '../src/pages/BrandBuilderPage.jsx';
import { getRecommendedTemplatesForAudience } from '../src/lib/brand/flow.js';
import { setRailPage, clearRailPage } from '../src/lib/railPage.js';
import { api } from '../src/lib/api.js';
import { mountContracts, installDocument } from './_contracts_dom.mjs';

const textOf = n => n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '';
const PAGE = 'Founder · Grow · Distribution';
const cases = [
  { key: 'form:landing', method: 'brandAutofillLanding', button: 'Auto-fill with AI', result: { name: 'Harbour', headline: 'Generated headline', content: {} }, field: 'headline', value: 'Generated headline' },
  { key: 'form:palette', method: 'brandSuggestPalette', button: 'Suggest AI palette', result: { palette: { primary: '#123456', background: '#eeeeee' } }, field: 'theme_color', value: '#123456' },
  { key: 'draft:taglines', method: 'brandSuggestTaglines', button: 'Iterate', result: { taglines: ['Generated tagline'] }, field: 'tagline', value: 'Generated tagline' },
];
async function mount(option) {
  const original = { ...api }; const calls = []; const saves = [];
  let answer;
  const pending = new Promise(r => { answer = r; });
  api.listProjects = async () => [{ id: 1, name: 'Harbour', description: 'Local dispatch' }, { id: 2, name: 'Second', description: 'Other work' }];
  api.brandGetLanding = async id => ({ name: id === 1 ? 'Harbour' : 'Second', template: 'minimal', audience: 'customer', headline: 'Founder headline', tagline: 'Founder tagline', theme_color: '#7c3aed' });
  api.brandListWaitlist = async () => ({ signups: [] });
  api.brandGetPreviewUrl = async () => ({});
  api.brandListTemplates = async () => ({ templates: [] });
  api.myAiSpend = api.aiPricing = async () => null;
  for (const c of cases) api[c.method] = (...args) => { calls.push([c.key, ...args]); return pending; };
  api.brandSaveLanding = async (id, body) => { saves.push([id, structuredClone(body)]); return { ...body }; };
  const m = await mountContracts(React.createElement(BrandBuilderPage), '/build/brand');
  for (let i=0;i<4;i++) await m.flush();
  const button = label => m.nodes().find(n => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return { ...m, calls, saves, button, answer, async start() { let promise; await act(async () => { promise = m.props(button(option.button)).onClick(); }); return { promise }; }, async finish() { await act(async () => { answer(option.result); await pending; }); await m.flush(); }, async close() { await m.unmount(); Object.assign(api, original); } };
}
for (const c of cases) {
  test(`${c.key}: preserves the mounted page while replacing a stale option`, async () => {
    const m = await mount(c); const token = setRailPage('grow', 'draft:old');
    try {
      await m.start();
      assert.deepEqual(m.calls[0][2], { 'X-Rail-Page': 'grow', 'X-Rail-Option': c.key }, 'the mounted page owns the Manual switch');
      await m.finish();
    } finally { clearRailPage(token); await m.close(); }
  });
  test(`${c.key}: press fills only the open form; Save is the only business write`, async () => {
    const m = await mount(c);
    try {
      assert.equal(m.calls.length, 0, 'mount never runs the model');
      await m.start();
      assert.equal(m.calls.length, 1);
      assert.deepEqual(m.calls[0][2], { 'X-Rail-Page': encodeURIComponent(PAGE), 'X-Rail-Option': c.key }, 'context travels on the press, before a busy-state effect');
      assert.deepEqual(m.saves, [], 'pending run saves nothing');
      await m.finish();
      assert.deepEqual(m.saves, [], 'returned suggestion saves nothing');
      if (c.key === 'draft:taglines') {
        await m.click(c.value);
        assert.deepEqual(m.saves, [], 'choosing a candidate changes the form only');
      }
      await m.click('Save');
      assert.equal(m.saves.length, 1);
      assert.equal(m.saves[0][0], 1);
      assert.equal(m.saves[0][1][c.field], c.value);
    } finally { await m.close(); }
  });
  test(`${c.key}: switching template keeps the new form's copy and palette`, async () => {
    const m = await mount(c);
    try {
      await m.start();
      const kit = getRecommendedTemplatesForAudience('customer').find(t => t.visualTemplate !== 'minimal');
      const pick = m.nodes().find(n => n.tagName === 'BUTTON' && textOf(n).includes(kit.label));
      await act(async () => { m.props(pick).onClick(); }); await m.flush();
      await m.finish();
      if (c.key === 'draft:taglines') assert.ok(!m.button(c.value), 'no candidate from the old template');
      await m.click('Save');
      assert.equal(m.saves.length, 1);
      assert.equal(m.saves[0][1].template, kit.visualTemplate);
      assert.notEqual(m.saves[0][1][c.field], c.value, 'late result cannot overwrite the chosen template');
    } finally { await m.close(); }
  });
  for (const projects of [[2], [2, 1]]) test(`${c.key}: a response is ignored after project switches ${projects.join(' → ')}`, async () => {
    const m = await mount(c);
    try {
      await m.start();
      for (const project of projects) { await m.fill('Startup', String(project)); for (let i=0;i<3;i++) await m.flush(); }
      await m.finish();
      if (c.key === 'draft:taglines') assert.ok(!m.button(c.value), 'no stale candidate offered');
      await m.click('Save');
      assert.equal(m.saves.length, 1);
      assert.equal(m.saves[0][0], projects.at(-1));
      assert.equal(m.saves[0][1][c.field], c.key === 'form:palette' ? '#7c3aed' : c.key === 'form:landing' ? 'Founder headline' : 'Founder tagline');
    } finally { await m.close(); }
  });
}

test('the three existing API methods forward explicit press headers to fetch', async () => {
  const restore = installDocument();
  const fetchBefore = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, opts) => { requests.push([url, opts]); return new Response('{}', { headers: { 'content-type': 'application/json' } }); };
  try {
    for (const c of cases) {
      const headers = { 'X-Rail-Page': encodeURIComponent(PAGE), 'X-Rail-Option': c.key };
      await api[c.method]({ description: 'Draft text' }, headers);
      assert.equal(requests.at(-1)[1].headers['X-Rail-Page'], headers['X-Rail-Page']);
      assert.equal(requests.at(-1)[1].headers['X-Rail-Option'], c.key);
    }
  } finally { globalThis.fetch = fetchBefore; restore(); }
});
