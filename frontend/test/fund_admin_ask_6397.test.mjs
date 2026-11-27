/** D6397 (#6397): today's shared Ask panel serves recorded fund tasks, with scoped retries and no model fallback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import AskPanel from '../src/ui/AskPanel.jsx';
import FundAdminAsk from '../src/pages/admin/fundAdmin/FundAdminAsk.jsx';
import { PageAsk } from '../src/ui/AskButton.jsx';
import { RailPageProvider, useRailPage } from '../src/ui/railCrumbs.js';
import { askPanelEvent, openAskPanel, useAskPanel, useAskRail, __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { useAskPageBody } from '../src/ui/askPageBody.js';
import { askPanelAdapter } from '../src/ui/askPanelAdapter.js';
import { mountContracts } from './_contracts_dom.mjs';
const h = React.createElement;
const KEYS = ['explain:fund-outstanding','identify:fund-overdue-lps','summarize:fund-reconciliation','prepare:fund-capital-call','identify:fund-incomplete-setup'];
const LABELS = ['Explain outstanding capital','Identify overdue LPs','Summarize reconciliation exceptions','Prepare a capital call','Identify incomplete fund setup'];
const response = (prompt, extra = {}) => ({ prompt, state: 'ok', no_model: true, as_of: '2026-11-14', lines: ['Recorded $0.00; missing amount — Not recorded.'], navigation: { to: '/admin/fund-admin/calls?fund=7', label: 'Open capital calls' }, ...extra });
const by = (m, id) => m.nodes().find(node => m.props(node)?.['data-testid'] === id);
function Harness({ api, user, navigate, serves = true }) {
  const [fundId, setFundId] = useState(7);
  const [showBody, setShowBody] = useState(true);
  const rail = useRailPage(); const ask = useAskPanel();
  useAskRail(serves, rail.page, 'Fund Admin');
  return h(React.Fragment, null,
    showBody && h(FundAdminAsk, { api, user, fundId, scopeLabel: 'Fund ' + fundId }),
    h('output', { 'data-testid': 'registered-body' }, useAskPageBody(rail.page) ? 'registered' : 'none'),
    h('button', { onClick: () => setShowBody(false) }, 'Leave fund page'),
    h(PageAsk, { label: 'Fund Admin' }),
    h('button', { onClick: () => setFundId(8) }, 'Change fund'),
    ask.open && h(AskPanel, { page: rail.page, label: 'Fund Admin', onNavigate: navigate, onClose: type => askPanelEvent({ type }) }),
  );
}
async function setup(api, superAdmin = false, serves = true) {
  __resetEadwynPanelForTest();
  const user = { id: 902, role: 'admin', is_super_admin: Number(superAdmin) };
  const modelCalls = []; const original = { ...askPanelAdapter };
  for (const name of Object.keys(original)) askPanelAdapter[name] = async () => { modelCalls.push(name); throw new Error('unexpected generic Ask request: ' + name); };
  askPanelAdapter.waiting = async () => ({ available: true, data: { count: 0 } });
  const navigations = [];
  const m = await mountContracts(h(RailPageProvider, { role: superAdmin ? 'super_admin' : 'admin' }, h(Harness, { api, user, serves, navigate: path => navigations.push(path) })), '/admin/fund-admin/calls?fund=7', user);
  return { m, modelCalls, navigations, async close() { await m.unmount(); Object.assign(askPanelAdapter, original); __resetEadwynPanelForTest(); } };
}

test('both admin tiers get exactly five recorded tasks in the one Ask panel, with dates and navigation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1794657600000 });
  for (const elevated of [false, true]) {
    const reads = []; const f = await setup({ answer: async (key, fundId) => { reads.push([key, fundId]); return response(key); } }, elevated);
    try {
      await f.m.click('Ask');
      const chips = f.m.nodes().filter(node => f.m.props(node)?.['data-testid']?.startsWith('ask-chip-'));
      assert.equal(chips.length, 5);
      assert.match(f.m.text(), /Eadwyn prepares, explains and navigates. It never issues, records or moves money./);
      assert.equal(Boolean(by(f.m, 'ask-panel-input')), false, 'recorded tasks do not fall through to paid conversation');
      assert.equal(Boolean(by(f.m, 'ask-cost-line')), false);
      for (let i = 0; i < KEYS.length; i++) {
        assert.match(f.m.text(), new RegExp(LABELS[i]));
        const node = by(f.m, 'ask-chip-' + KEYS[i]);
        await React.act(async () => f.m.props(node).onClick());
        assert.equal(f.m.props(by(f.m, 'fund-admin-ask-answer'))['data-state'], 'ok');
        assert.match(f.m.text(), /2026-11-14/);
        assert.match(f.m.text(), /Recorded \$0\.00; missing amount — Not recorded/);
      }
      assert.deepEqual(reads, KEYS.map(key => [key, 7]));
      assert.deepEqual(f.modelCalls, []);
      await React.act(async () => f.m.props(by(f.m, 'fund-admin-ask-open')).onClick({ preventDefault() {} }));
      assert.deepEqual(f.navigations, ['/admin/fund-admin/calls?fund=7']);
      assert.equal(Boolean(by(f.m, 'ask-panel')), false);
    } finally { await f.close(); }
  }
});

test('Unreadable keeps Retry and recorded absence distinct; retry rereads the same scope without a model', async () => {
  let reads = 0;
  const f = await setup({ answer: async key => {
    reads++;
    if (reads === 1) throw { data: response(key, { state: 'unreadable', lines: ['! Unreadable · Retry. Not a zero.'] }) };
    return response(key, { state: 'not_recorded', lines: ['— Not recorded. No administered fund is recorded.'] });
  } });
  try {
    await f.m.click('Ask'); await f.m.click(LABELS[0]);
    assert.equal(f.m.props(by(f.m, 'fund-admin-ask-answer'))['data-state'], 'unreadable');
    assert.match(f.m.text(), /Not a zero/);
    await f.m.click('Retry');
    assert.equal(f.m.props(by(f.m, 'fund-admin-ask-answer'))['data-state'], 'not_recorded');
    assert.equal(reads, 2); assert.deepEqual(f.modelCalls, []);
  } finally { await f.close(); }
});

test('a changed fund clears its answer and ignores a late response from the previous scope', async () => {
  let resolve; const reads = [];
  const f = await setup({ answer: (key, fundId) => { reads.push(fundId); return fundId === 7 ? new Promise(done => { resolve = () => done(response(key, { lines: ['Old private fund answer'] })); }) : Promise.resolve(response(key, { lines: ['Fund 8 recorded answer'] })); } });
  try {
    await f.m.click('Ask'); await f.m.click(LABELS[0]);
    assert.equal(f.m.props(by(f.m, 'ask-chip-' + KEYS[0])).disabled, true);
    assert.match(f.m.text(), /Reading recorded data/);
    await f.m.click('Change fund');
    assert.equal(Boolean(by(f.m, 'fund-admin-ask-answer')), false);
    await React.act(async () => resolve());
    assert.doesNotMatch(f.m.text(), /Old private fund answer/);
    await f.m.click(LABELS[0]); assert.match(f.m.text(), /Fund 8 recorded answer/);
    assert.deepEqual(reads, [7,8]); assert.deepEqual(f.modelCalls, []);
  } finally { await f.close(); }
});

test('malformed answers and failed reads show Unreadable, and no served rail means no prompt request', async () => {
  for (const malformed of [
    { navigation: { to: 'https://outside.example.test', label: 'Outside' } },
    { no_model: false }, { state: 'invented' }, { lines: 'not an array' }, { as_of: {} }, { prompt: 'wrong-prompt' },
  ]) {
    const f = await setup({ answer: async key => response(key, malformed) });
    try {
      await f.m.click('Ask'); await f.m.click(LABELS[0]);
      assert.equal(f.m.props(by(f.m, 'fund-admin-ask-answer'))['data-state'], 'unreadable');
      assert.equal(f.m.props(by(f.m, 'fund-admin-ask-open')).href, '/admin/fund-admin?fund=7');
      assert.deepEqual(f.modelCalls, []);
    } finally { await f.close(); }
  }
  let reads = 0; const hidden = await setup({ answer: async () => { reads++; } }, false, false);
  try { await React.act(async () => openAskPanel('Fund Admin')); assert.equal(Boolean(by(hidden.m, 'ask-panel')), false); assert.equal(reads, 0); }
  finally { await hidden.close(); }
});


test('the actual Fund Admin page mounts one existing rail for both tiers and clears its old missing-rail ratchet', async () => {
  const { railRenderer } = await import('./_airailRender.mjs');
  const renderer = await railRenderer();
  try {
    for (const role of ['Admin', 'Super Admin']) {
      const drawn = await renderer.draw(role, '/admin/fund-admin', 'down');
      assert.equal(drawn.rails, 1);
      assert.deepEqual(drawn.keys, [role + ' · Fund Admin']);
      assert.equal(drawn.askAvailable, true, 'the actual rail serves Ask despite the off-canvas inventory flag');
      assert.equal(drawn.askPage, role + ' · Fund Admin');
    }
  } finally { renderer.close(); }
});


test('page-owned task registration is removed when its host leaves', async () => {
  const f = await setup({ answer: async key => response(key) });
  try {
    assert.equal(f.m.props(by(f.m, 'registered-body')).children, 'registered');
    await f.m.click('Leave fund page');
    assert.equal(f.m.props(by(f.m, 'registered-body')).children, 'none');
  } finally { await f.close(); }
});
