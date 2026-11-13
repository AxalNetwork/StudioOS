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
import { attentionRulesOf, registerRowsOf } from '../src/pages/portfolio/portfolioModel.js';

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

test('optional Overview failures label their own panels Unreadable rather than zero or a dash', async () => {
  // D4817 part 1 (#5311): PF-01 replaced this page; the finding's test moved with it.
  const view = await mount(InvestorPortfolioCanvas, ({ path }) => path === '/api/positions'
    ? json({ items: [{ project_id: 7, project: { name: 'Northwind' }, total_invested: 100 }] })
    : path.startsWith('/api/') ? json({ detail: 'down' }, 500) : json({}));
  try {
    const words = view.text();
    assert.match(words, /TVPIUnreadablePerformance could not be read\./);
    assert.match(words, /Support could not be read\. This is not a claim that no support was given\./);
    assert.match(words, /Reporting could not be read\. This is not a claim that any company is late\./);
    assert.match(words, /Northwind.*\$100.*Unreadable.*Unreadable/);
    assert.doesNotMatch(words, /0 currently healthy|0 recorded · 0 accepted|TVPI0|Received0|\bdown\b/);
  } finally { await view.close(); }
});

test('the overview uses the reporting population and full support totals independently of displayed records', async () => {
  const view = await mount(InvestorPortfolioCanvas, ({ path }) => {
    if (path === '/api/positions') return json({ items: [{ project_id: 7, project: { name: 'Northwind' }, total_invested: 0 }] });
    if (path === '/api/positions/analytics') return json({ nav: 1234.56, as_of: '2026-09-30' });
    if (path === '/api/positions/kpi-compliance') return json({
      population: { period: '2026-Q3' }, reported_count: 1, total_count: 2,
      companies: [{ project_id: 7, reported: true }, { project_id: 8, reported: false }],
      kpi_set: [{ kpi_key: 'headcount', unit: 'count' }, { kpi_key: 'revenue', unit: 'EUR' }],
    });
    if (path === '/api/portfolio-updates/latest') return json({
      items: [{ project_id: 7, title: 'Latest visible update', kpis: { headcount: 0, revenue: 12.34, runway: null } }],
    });
    if (path === '/api/portfolio-support') return json({
      entries: [], totals: { delivered: 412, companies_supported: 2, companies_in_book: 3 },
    });
    return json({});
  });
  try {
    const words = view.text();
    assert.match(words, /Net asset value · gross\$1,234\.56/);
    assert.match(words, /1 of 2 portfolio companies reported for 2026-Q3/);
    assert.match(words, /Delivered412/);
    assert.match(words, /2 of 3 companies supported/);
  } finally { await view.close(); }
});

test('the mounted Updates inbox formats each KPI by its unit', async () => {
  const view = await mount(InvestorPortfolioUpdates, ({ path }) => {
    if (path === '/api/positions') return json({ items: [{ project_id: 7, project: { uid: 'northwind', name: 'Northwind' } }] });
    if (path === '/api/portfolio-updates/latest') return json({ items: [{ project_id: 7, title: 'October', submitted_at: '2026-11-01T10:00:00Z', kpis: { customers: 41, runway_months: 22, headcount: 31, revenue: 9000 } }] });
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
  // F-19: D4817 part 2 (#5311, PF-02) replaced Positions' alerts with the
  // attention rules; their dates are words with a separator, never a timestamp.
  const positions = { state: 'ok', value: { items: [{ project_id: 7, project: { uid: 'nw', name: 'Northwind' }, total_invested: 100 }] } };
  const reads = {
    positions,
    health: { state: 'ok', value: { items: [] } },
    compliance: { state: 'ok', value: { as_of: '2026-11-09', companies: [{ project_id: 7, last_reported_at: '2026-07-20T09:00:00Z', days_since_report: 112 }] } },
    updates: { state: 'ok', value: { items: [{ project_id: 7, period: '2026-Q2', submitted_at: '2026-07-02T09:00:00Z', kpis: { runway_months: 5 } }] } },
  };
  const alerts = attentionRulesOf(reads, registerRowsOf(reads, { date: '2026-11-09', state: 'ok' }));
  const line = (key) => alerts.find((r) => r.key === key).hits[0].text;
  assert.equal(line('stale-update'), 'Last update received 20 Jul 2026 · 112 days');
  assert.equal(line('runway'), '5 months · founder-reported · 2026-Q2 · 2 Jul 2026');
  assert.doesNotMatch(alerts.flatMap((r) => r.hits || []).map((x) => x.text).join(' '), /T09:00:00Z|\d{4}-\d{2}-\d{2}T/);
});

test('investor-visible copy carries no issue, decision or canvas identifiers', () => {
  const files = [
    'InvestorPortfolioCanvas.jsx', 'InvestorPortfolioPositions.jsx', 'InvestorPortfolioUpdates.jsx', 'FromMercury.jsx',
    '../portfolio/PortfolioFrame.jsx', '../portfolio/PortfolioParts.jsx', '../portfolio/portfolioModel.js',
  ].map((name) => codeOnly(readFileSync(new URL(`../src/pages/investor/${name}`, import.meta.url), 'utf8'))).join('\n');
  const rendered = files.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.doesNotMatch(rendered, /\bIP[12]\b|\bD\d{3,5}\b|#\d{3,5}\b|asked on|Two rule sets, and only one|What this book will not do/);
});
