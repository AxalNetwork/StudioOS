// D5365 — mounted regressions for the five defects found by the Portfolio UX audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import InvestorPortfolioCanvas from '../src/pages/investor/InvestorPortfolioCanvas.jsx';
import InvestorPortfolioUpdates, { kpiText } from '../src/pages/investor/InvestorPortfolioUpdates.jsx';
import { reportedLine } from '../src/pages/investor/InvestorPortfolioPositions.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(Component, answer) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    return answer({ path: url.pathname, query: url.search, method: (init.method || 'GET').toUpperCase() }) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const text = (node = box) => node.nodeType === 3 ? node.textContent : (node.childNodes || []).map((child) => text(child)).join('') || node.textContent || '';
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(Component))));
  await settle();
  return { text, async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); } };
}

test('a failed positions read replaces the Overview book and never exposes the Worker detail', async () => {
  const view = await mount(InvestorPortfolioCanvas, ({ path }) => path === '/api/positions'
    ? json({ detail: 'D1_SECRET_INTERNAL_DETAIL' }, 500) : json({}));
  try {
    const words = view.text();
    assert.match(words, /Positions could not be read\.Retry/);
    assert.doesNotMatch(words, /D1_SECRET_INTERNAL_DETAIL|0 companies|No direct positions have been recorded|No intervention flags|currently healthy/);
  } finally { await view.close(); }
});

test('optional Overview failures label their figures Unavailable rather than zero or a dash', async () => {
  const view = await mount(InvestorPortfolioCanvas, ({ path }) => path === '/api/positions'
    ? json({ items: [{ project_id: 7, project: { name: 'Northwind' }, total_invested: 100 }] })
    : path.startsWith('/api/') ? json({ detail: 'down' }, 500) : json({}));
  try {
    const words = view.text();
    assert.match(words, /TVPI · grossUnavailableAnalytics source unavailable/);
    assert.match(words, /IntroductionsIntroduction records unavailableUnavailable/);
    assert.match(words, /Portfolio healthHealth source unavailableUnavailable/);
    assert.doesNotMatch(words, /0 currently healthy|0 recorded · 0 accepted/);
  } finally { await view.close(); }
});

test('the mounted Updates inbox formats each KPI by its unit', async () => {
  const view = await mount(InvestorPortfolioUpdates, ({ path }) => {
    if (path === '/api/positions') return json({ items: [{ project_id: 7, project: { uid: 'northwind', name: 'Northwind' } }] });
    if (path === '/api/portfolio-updates') return json({ items: [{ project_id: 7, title: 'October', submitted_at: '2026-11-01T10:00:00Z', kpis: { customers: 41, runway_months: 22, headcount: 31, revenue: 9000 } }] });
    if (path === '/api/positions/kpi-compliance') return json({ cadence: 'quarterly', companies: [{ project_id: 7, reported: true }], kpi_set: [{ kpi_key: 'headcount', unit: 'count' }, { kpi_key: 'revenue', unit: 'USD' }] });
    if (path === '/api/portfolio/health') return json({ items: [], totals: {} });
    if (path === '/api/portfolio/chases') return json({ items: [] });
    if (path === '/api/reporting/portfolio') return json({ companies: [] });
    return json({});
  });
  try {
    const words = view.text();
    assert.match(words, /Customers 41 · Runway Months 22 months · Headcount 31 · Revenue \$9,000/);
    assert.doesNotMatch(words, /Customers \$41|Runway Months \$22|Headcount \$31/);
  } finally { await view.close(); }
});

test('KPI kinds and alert dates keep their member-facing units and separators', () => {
  const update = { kpis: { arr: 12000, gross_margin: 54.5, runway_months: 1, headcount: 9 } };
  const rules = [
    { kpi_key: 'arr', unit: 'USD' }, { kpi_key: 'gross_margin', unit: '%' },
    { kpi_key: 'runway_months', unit: 'months' }, { kpi_key: 'headcount', unit: 'count' },
  ];
  assert.equal(kpiText(update, rules), 'Arr $12,000 · Gross Margin 54.5% · Runway Months 1 month · Headcount 9');
  assert.equal(reportedLine('Last reported', '2026-07-20T09:00:00Z', 112), 'Last reported Jul 20, 2026 · 112d ago');
  assert.doesNotMatch(reportedLine('Reported', '2026-07-02T09:00:00Z', 131), /T09:00:00Z/);
});

test('investor-visible copy carries no issue, decision or canvas identifiers', () => {
  const files = [
    'InvestorPortfolioCanvas.jsx', 'InvestorPortfolioPositions.jsx', 'InvestorPortfolioUpdates.jsx', 'FromMercury.jsx',
  ].map((name) => codeOnly(readFileSync(new URL(`../src/pages/investor/${name}`, import.meta.url), 'utf8'))).join('\n');
  const rendered = files.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.doesNotMatch(rendered, /\bIP[12]\b|\bD\d{3,5}\b|#\d{3,5}\b|asked on|Two rule sets, and only one|What this book will not do/);
});
