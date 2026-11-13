/**
 * D778 part 9 (#2103) — Research · Companies' five presses name their option on
 * the run: `analyse:competitors`, `analyse:again`, `analyse:sources`,
 * `extract:candidate` and `extract:site`. Each keeps the mounted rail's page,
 * and the advisor's board sends its own keys (D773). A run answers only the
 * analysis, or the company, it was pressed on: opening another one drops it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_competitors_d778.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import CompanyAnalysis from '../src/pages/research/CompanyAnalysis.jsx';
import CompanyCandidate from '../src/pages/research/CompanyCandidate.jsx';
import CompetitorAnalysis from '../src/components/CompetitorAnalysis.jsx';
import { api } from '../src/lib/api.js';
import { clearRailPage, railPageHeaders, setRailPage } from '../src/lib/railPage.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const enc = encodeURIComponent;

const analysis = (id, title, extra = {}) => ({
  id, title, status: 'complete', inputs: { market: title, depth: 'quick' },
  output: { market_summary: `${title} summary.`, gaps: [], next_actions: [] },
  candidates: [{ id: `${id}-c1`, name: `${title} Rival`, url: `https://${id}.example`, category: 'direct', origin: 'discovered', scores: {}, details: {} }],
  sources: [], signals: [], ...extra,
});
const ONE = analysis('a-one', 'Freight');
const ONE_RERUN = analysis('a-one', 'Freight', {
  candidates: [{ id: 'a-one-c9', name: 'Rerun Rival', url: 'https://rerun.example', category: 'direct', origin: 'discovered', scores: {}, details: {} }],
});
const TWO = analysis('a-two', 'Payroll');

/** Stub the competitors client: reads answer at once; the five runs wait until the test answers them. */
function stubApi() {
  const original = api.competitors;
  const calls = [];
  const pending = [];
  const wait = (name) => (...args) => { calls.push([name, ...args]); return new Promise((ok, no) => pending.push({ name, ok, no })); };
  api.competitors = {
    ...original,
    list: async () => ({ analyses: [{ id: ONE.id, title: ONE.title, status: 'complete' }, { id: TWO.id, title: TWO.title, status: 'complete' }] }),
    get: async (id) => (id === TWO.id ? TWO : ONE),
    analyze: wait('analyze'), rerun: wait('rerun'), refresh: wait('refresh'),
    addCandidate: wait('addCandidate'), crawlCandidate: wait('crawlCandidate'),
  };
  return { calls, pending, restore: () => { api.competitors = original; } };
}

/** A page under its route, with a button that opens another address the way a link would. */
function Harness({ path, element, to }) {
  const navigate = useNavigate();
  return React.createElement(React.Fragment, null,
    React.createElement('button', { type: 'button', onClick: () => navigate(to) }, 'Open the other one'),
    React.createElement(Routes, null, React.createElement(Route, { path, element })));
}

async function mount(element, url) {
  const m = await mountContracts(element, url);
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  const button = (label) => m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  const press = async (label) => {
    const b = button(label);
    assert.ok(b, `button ${label}`);
    await act(async () => { m.props(b).onClick({ preventDefault() {}, stopPropagation() {} }); });
    await settle();
  };
  return { ...m, settle, press, button, text: () => m.nodes().map(textOf).join(' ') };
}
const analysisPage = (url = '/research/companies/a-one') => mount(React.createElement(Harness, {
  path: '/research/companies/:id', element: React.createElement(CompanyAnalysis), to: '/research/companies/a-two',
}), url);
const candidatePage = () => mount(React.createElement(Harness, {
  path: '/research/companies/:analysisId/:candidateId', element: React.createElement(CompanyCandidate), to: '/research/companies/a-two/a-two-c1',
}), '/research/companies/a-one/a-one-c1');

test('Re-run and Refresh sources on an analysis send their own option, keeping the mounted rail\'s page', async () => {
  // Mutations checked: either press without headers; the wrong key on either.
  // The page mounts its own rail, so its page is always the mounted one.
  {
    const net = stubApi();
    const m = await analysisPage();
    const mounted = railPageHeaders()['X-Rail-Page'];
    assert.ok(mounted, 'the page mounts a rail');
    try {
      await m.press('Re-run');
      await act(async () => { net.pending.shift().ok(ONE_RERUN); }); await m.settle();
      await m.press('Refresh sources');
      await act(async () => { net.pending.shift().ok(ONE); }); await m.settle();
      const [rerun, refresh] = ['rerun', 'refresh'].map((n) => net.calls.find((c) => c[0] === n));
      assert.equal(rerun[1], 'a-one');
      assert.equal(rerun[3]['X-Rail-Option'], enc('analyse:again'));
      assert.equal(refresh[2]['X-Rail-Option'], enc('analyse:sources'));
      for (const h of [rerun[3], refresh[2]]) assert.equal(h['X-Rail-Page'], mounted, 'the mounted page holds the Manual switch');
    } finally { await m.unmount(); net.restore(); }
  }
});

test('a run answers only the analysis it was pressed on: opening another one drops it', async () => {
  // Mutations checked: the stale check dropped (the re-run of one is drawn on
  // two); the id change not moving the counter on (the page stays busy).
  const net = stubApi();
  const m = await analysisPage();
  try {
    await m.press('Re-run');
    assert.ok(m.text().includes('Running…'));
    await m.press('Open the other one');
    assert.ok(m.text().includes('Payroll Rival'), 'the opened analysis is drawn');
    await act(async () => { net.pending.shift().ok(ONE_RERUN); }); await m.settle();
    assert.ok(m.text().includes('Payroll Rival'), 'the opened analysis stays');
    assert.ok(!m.text().includes('Rerun Rival'), 'the dropped run is not drawn');
    assert.ok(!m.text().includes('Running…'), 'and the page is pressable again');
    await m.press('Re-run');
    assert.equal(net.calls.filter((c) => c[0] === 'rerun').at(-1)[1], 'a-two');
  } finally { await m.unmount(); net.restore(); }
});

test('Crawl site sends `extract:site`, and answers only the company it was pressed on', async () => {
  // Mutations checked: the crawl without headers; the stale check dropped.
  const net = stubApi();
  const m = await candidatePage();
  try {
    await m.press('Crawl site');
    const crawl = net.calls.find((c) => c[0] === 'crawlCandidate');
    assert.deepEqual(crawl.slice(1, 3), ['a-one', 'a-one-c1']);
    assert.equal(crawl[3]['X-Rail-Option'], enc('extract:site'));
    await m.press('Open the other one');
    assert.ok(m.text().includes('Payroll Rival'));
    await act(async () => { net.pending.shift().ok(ONE); }); await m.settle();
    assert.ok(m.text().includes('Payroll Rival'), 'the opened company stays');
    assert.ok(!m.text().includes('Freight Rival'), 'the dropped crawl is not drawn');
  } finally { await m.unmount(); net.restore(); }
});

test('the Companies workspace sends each press\'s option, the advisor\'s keys on the advisor\'s board', async () => {
  // Mutations checked: Analyze, Re-run, Refresh or Add without headers; Add
  // sending the analysis's option.
  // The board's page comes from the shell's page map for the viewer's profile.
  for (const [profile, keys] of [
    ['Founder', { analyze: 'analyse:competitors', rerun: 'analyse:again', refresh: 'analyse:sources' }],
    ['Advisor', { analyze: 'analyze:competitors', rerun: 'rerun:analysis', refresh: 'refresh:sources' }],
  ]) {
    const page = `${profile} · Research · Companies`;
    const token = setRailPage(page);
    const net = stubApi();
    const origProjects = api.listProjects;
    api.listProjects = async () => [];
    const m = await mount(React.createElement(RailPageProvider, { role: profile },
      React.createElement(CompetitorAnalysis, { linkToDossier: false })), '/research/companies?tab=analyses');
    try {
      await act(async () => { m.props(m.nodes().find((n) => n.tagName === 'INPUT' && /sales enablement/.test(String(m.props(n)?.placeholder || '')))).onChange({ target: { value: 'Freight' } }); });
      await m.press('Analyze competitors');
      assert.equal(net.calls.find((c) => c[0] === 'analyze')[2]['X-Rail-Option'], enc(keys.analyze), page);
      await act(async () => { net.pending.shift().ok(ONE); }); await m.settle();
      await m.press('Re-run');
      assert.equal(net.calls.find((c) => c[0] === 'rerun')[3]['X-Rail-Option'], enc(keys.rerun), page);
      await act(async () => { net.pending.shift().ok(ONE_RERUN); }); await m.settle();
      await m.press('Refresh sources');
      assert.equal(net.calls.find((c) => c[0] === 'refresh')[2]['X-Rail-Option'], enc(keys.refresh), page);
      assert.equal(net.calls.find((c) => c[0] === 'refresh')[2]['X-Rail-Page'], railPageHeaders()['X-Rail-Page'], 'the mounted page holds the Manual switch');
      await act(async () => { net.pending.shift().ok(ONE); }); await m.settle();
      // Add, with a site to crawl: the one press whose option both boards share.
      await m.press('Add competitor');
      const field = (ph) => m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n)?.placeholder === ph);
      await act(async () => { m.props(field('Competitor name')).onChange({ target: { value: 'Tallyfreight' } }); });
      await act(async () => { m.props(field('website (optional)')).onChange({ target: { value: 'https://tallyfreight.example' } }); });
      await m.press('Add');
      const add = net.calls.find((c) => c[0] === 'addCandidate');
      assert.equal(add[2].name, 'Tallyfreight');
      assert.equal(add[3]['X-Rail-Option'], enc('extract:candidate'), page);
      await act(async () => { net.pending.shift().ok(ONE); }); await m.settle();
    } finally { clearRailPage(token); await m.unmount(); net.restore(); api.listProjects = origProjects; }
  }
});

test('in the workspace, a run answers only the analysis it was pressed on: opening a saved one drops it', async () => {
  // Mutations checked: the stale check dropped on Re-run (the re-run of one is
  // drawn over two); opening a saved analysis not moving the counter on.
  const net = stubApi();
  const origProjects = api.listProjects;
  api.listProjects = async () => [];
  const m = await mount(React.createElement(CompetitorAnalysis, { linkToDossier: false }), '/research/companies?tab=analyses');
  try {
    await act(async () => { m.props(m.nodes().find((n) => n.tagName === 'INPUT' && /sales enablement/.test(String(m.props(n)?.placeholder || '')))).onChange({ target: { value: 'Freight' } }); });
    await m.press('Analyze competitors');
    await act(async () => { net.pending.shift().ok(ONE); }); await m.settle();
    await m.press('Re-run');
    const saved = m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).includes('Payroll'));
    await act(async () => { m.props(saved).onClick({}); }); await m.settle();
    // The workspace draws names in their edit fields; each analysis's company site tells them apart.
    assert.match(m.text(), /https:\/\/a-two\.example/, 'the opened analysis is drawn');
    await act(async () => { net.pending.shift().ok(ONE_RERUN); }); await m.settle();
    assert.match(m.text(), /https:\/\/a-two\.example/, 'the opened analysis stays');
    assert.doesNotMatch(m.text(), /https:\/\/rerun\.example/, 'the dropped run is not drawn');
    await m.press('Re-run');
    assert.equal(net.calls.filter((c) => c[0] === 'rerun').at(-1)[1], 'a-two', 'and the workspace is pressable again');
  } finally { await m.unmount(); net.restore(); api.listProjects = origProjects; }
});

test('the five API methods send the press\'s headers on the request itself', async () => {
  // Mutation checked: drop `headers` from any method → its request carries no option.
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), headers: init?.headers || {} }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const h = (o) => ({ 'X-Rail-Option': enc(o) });
    await api.competitors.analyze({ market: 'x' }, h('analyse:competitors'));
    await api.competitors.rerun('a', {}, h('analyse:again'));
    await api.competitors.refresh('a', h('analyse:sources'));
    await api.competitors.addCandidate('a', { name: 'x' }, h('extract:candidate'));
    await api.competitors.crawlCandidate('a', 'c', h('extract:site'));
    const option = (s) => (s.headers instanceof Headers ? s.headers.get('X-Rail-Option') : s.headers['X-Rail-Option']);
    assert.deepEqual(seen.map(option), ['analyse:competitors', 'analyse:again', 'analyse:sources', 'extract:candidate', 'extract:site'].map(enc));
  } finally { globalThis.fetch = realFetch; restore(); }
});
