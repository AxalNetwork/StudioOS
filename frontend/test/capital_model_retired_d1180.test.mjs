// D1180 (#3107, Use of funds part 7) — the old capital model is retired:
// FinancialsPage.jsx and the Capital workspace's Financial Model tab. Forecast
// (Use of funds › Runway › Forecast) is the model now, on the same store.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/capital_model_retired_d1180.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import UseOfFundsMovedRedirect from '../src/pages/raise/useoffunds/UseOfFundsMovedRedirect.jsx';
import { tabHref } from '../src/pages/CapitalWorkspacePage.jsx';
import { FORWARD_REDIRECTS, REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor } from '../src/lib/redirectBeacon.js';
import { FOUNDER_TOOLS } from '../src/pages/cycles/founderToolNavigation.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('FinancialsPage.jsx is gone, and nothing in the app imports it', () => {
  assert.equal(existsSync('frontend/src/pages/FinancialsPage.jsx'), false);
  for (const f of walk('frontend/src').filter((p) => /\.(jsx?|mjs)$/.test(p))) {
    assert.doesNotMatch(read(f), /from ['"][^'"]*FinancialsPage['"]|import\(['"][^'"]*FinancialsPage['"]\)/, f);
  }
});

test('the Capital workspace keeps only Raise Pipeline, still keeping the venture across its tab', () => {
  const ws = read('frontend/src/pages/CapitalWorkspacePage.jsx');
  assert.doesNotMatch(ws, /id: 'model'|Financial Model'|<FinancialsPage/);
  assert.match(ws, /\{ id: 'pipeline', to: '\/raise\/capital\/pipeline', label: 'Raise Pipeline'/);
  assert.match(ws, /<RaisePipelinePage embedded \/>/);
  assert.equal(tabHref('/raise/capital/pipeline', '?project=4&mode=x'), '/raise/capital/pipeline?project=4');
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/raise\/capital\/pipeline" element=\{guard\(\['admin', 'founder'\], founderWorkspace\('raise', founderEditor\(<CapitalWorkspacePage \/>\)\)\)\}/);
  assert.equal(app.match(/<CapitalWorkspacePage \/>/g).length, 1, 'the workspace is mounted somewhere other than its Pipeline address');
});

test('?mode=workspace and the model\'s old addresses land on Forecast with the venture; the workspace mode counts itself', async () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /get\('mode'\) === 'workspace'\s*\n\s*\? <UseOfFundsMovedRedirect count="\/raise\/capital\?mode=workspace" \/>\s*\n\s*: <FounderRaiseCapital \/>/);
  for (const p of ['/raise/capital/model', '/build/financials']) {
    assert.match(app, new RegExp(`path="${p.replace(/\//g, '\\/')}" element=\\{<UseOfFundsMovedRedirect \\/>\\}`), p);
    assert.ok(REDIRECT_ROUTES.some((r) => r.path === p), `${p} is no longer counted`);
  }
  assert.ok(FORWARD_REDIRECTS.some((r) => r.path === '/raise/capital?mode=workspace'));
  assert.equal(redirectPatternFor('/raise/capital', '?mode=workspace'), null, 'the address bar counts the Capital page as a redirect');

  for (const [count, from, sent, landed] of [
    ['/raise/capital?mode=workspace', '/raise/capital?mode=workspace&project=12#d', ['redirect:/raise/capital?mode=workspace'],
      '/raise/use-of-funds/runway/forecast?mode=workspace&project_id=12&moved=capital-model#d'],
    [null, '/raise/capital?mode=workspace&project_id=3', [], '/raise/use-of-funds/runway/forecast?mode=workspace&project_id=3&moved=capital-model'],
  ]) {
    const restore = installDocument();
    const got = []; let at = null;
    function Where() { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; }
    const root = createRoot(document.createElement('div'));
    try {
      await act(async () => { root.render(h(MemoryRouter, { initialEntries: [from] }, h(Routes, null,
        h(Route, { path: '/raise/capital', element: h(UseOfFundsMovedRedirect, { count, send: (k) => got.push(k) }) }),
        h(Route, { path: '*', element: h(Where) })))); });
      assert.deepEqual(got, sent, from);
      assert.equal(at, landed, from);
    } finally { await act(async () => root.unmount()); restore(); }
  }
});

test('the doors that opened the model point where it lives now', () => {
  const capital = read('frontend/src/pages/founder/FounderRaiseCapital.jsx');
  assert.doesNotMatch(capital, /mode=workspace/, 'the Capital page still opens the retired workspace');
  assert.equal(capital.match(/to=\{`\/raise\/cap-table\$\{project\.id \? `\?project_id=\$\{project\.id\}` : ''\}`\}/g)?.length, 2, 'the two cap-table editor links');
  const bank = read('frontend/src/lib/advisor/banks/existingFounder.js');
  assert.doesNotMatch(bank, /page_target: '\/raise\/capital\/model'/);
  assert.equal(bank.match(/page_target: '\/raise\/use-of-funds\/runway\/forecast'/g)?.length, 3);
  assert.ok(!FOUNDER_TOOLS.some((t) => t.path === '/raise/capital'), 'the retired model editor still has a module return');
  assert.ok(FOUNDER_TOOLS.some((t) => t.path === '/raise/capital/pipeline'));
  assert.doesNotMatch(read('frontend/src/lib/explainers.js'), /^\s+financials: \{/m);
});

test('the model\'s store stays: /api/financials is Forecast\'s, and only the builder\'s dead client methods went', () => {
  const api = read('frontend/src/lib/api.js');
  assert.doesNotMatch(api, /getFinancialModel:|saveFinancialModel:|recomputeFinancialModel:/);
  assert.match(api, /downloadFinancialModelXlsx: async \(projectId\) =>/);
  const uof = read('frontend/src/lib/api/useOfFunds.js');
  assert.match(uof, /forecast: project => request\(`\/financials\/\$\{seg\(project\)\}`\)/);
  assert.match(uof, /saveForecast: \(project, assumptions\) => request\(`\/financials\/\$\{seg\(project\)\}`, \{ method: 'PUT'/);
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/financials', financialsRoutes\);/);
  assert.ok(!readdirSync('cloudflare-worker/sql/migrations').some((f) => /capital_recompute/.test(f)), 'D1180 drops no column');
});
