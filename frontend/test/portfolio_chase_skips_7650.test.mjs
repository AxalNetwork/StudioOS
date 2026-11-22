/**
 * #7650 (D7650): the Reports page shows why the Worker skipped a chase, and
 * never counts a skipped company as chased. The Worker chases only a company
 * whose report is due and unreported (`POST /api/portfolio/chase`), and names
 * each other target's reason in `skips`: no_obligation, not_due,
 * already_reported or unreadable. Synthetic data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_chase_skips_7650.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import InvestorPortfolioUpdates from '../src/pages/investor/InvestorPortfolioUpdates.jsx';
import { chaseOutcomeOf, chaseSkipText } from '../src/pages/portfolio/portfolioModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const COMPLIANCE = {
  cadence: 'quarterly', period: '2026-Q3', as_of: '2026-11-10', period_from: '2026-07-01', period_until: '2026-09-30',
  period_complete: true, period_in_progress: false, population: { basis: 'companies_held_in_book', period: '2026-Q3' },
  kpi_set: [],
  companies: [
    { project_id: 1, project_uid: 'northwind', name: 'Northwind Labs', reported: false, last_reported_at: null, days_since_report: null,
      due_date: '2026-10-30', due_days: 30, due_basis: 'firm_default', due_reason: null, days_overdue: 11, overdue: true },
    { project_id: 3, project_uid: 'fjord', name: 'Fjord Data', reported: false, last_reported_at: null, days_since_report: null,
      due_date: '2026-11-14', due_days: 45, due_basis: 'reporting_duty', due_reason: null, days_overdue: null, overdue: false },
    { project_id: 4, project_uid: 'gannet', name: 'Gannet Bio', reported: false, last_reported_at: null, days_since_report: null,
      due_date: '2026-10-30', due_days: 30, due_basis: 'firm_default', due_reason: null, days_overdue: 11, overdue: true },
  ],
  reported_count: 0, total_count: 3, overdue_count: 2, overdue_project_ids: [1, 4], due_default_days: 30, due_read: 'ok',
};

async function mount(chaseAnswer) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'POST' && u.pathname === '/api/portfolio/chase') { posts.push(JSON.parse(init.body)); return json(chaseAnswer); }
    if (u.pathname === '/api/positions/kpi-compliance') return json(COMPLIANCE);
    if (u.pathname === '/api/portfolio/chases') return json({ items: [] });
    if (u.pathname === '/api/portfolio-updates/latest') return json({ items: [], companies: 0, complete: true });
    if (u.pathname === '/api/portfolio/health') return json({ items: [], not_measured: [] });
    return json({ items: [] });
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/updates'] }, h(InvestorPortfolioUpdates))));
  await settle();
  const press = async (node, what) => {
    if (!node) throw new Error(`no ${what}`);
    await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
    await settle();
  };
  return {
    posts,
    click: (id) => press(nodes().find((n) => props(n)['data-testid'] === id), id),
    clickText: (label) => press(nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label), label),
    note: () => { const n = nodes().find((x) => props(x)['data-testid'] === 'status-chase-note'); return n ? squash(textOf(n)) : null; },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; localStorage.removeItem('user'); restore(); },
  };
}

test('the model: each skip reason in words, and only `chased` counts as chased', () => {
  assert.equal(chaseSkipText({ reason: 'no_obligation' }), 'no reporting obligation in your book');
  assert.equal(chaseSkipText({ reason: 'not_due', due_date: '2026-11-14' }), 'not due until 14 Nov 2026');
  assert.equal(chaseSkipText({ reason: 'not_due', due_date: null }), 'not due yet');
  assert.equal(chaseSkipText({ reason: 'already_reported', period: '2026-Q3' }), 'already reported for Q3 2026');
  assert.equal(chaseSkipText({ reason: 'unreadable' }), 'its reporting obligation could not be read');
  assert.equal(chaseSkipText({ reason: 'something_new' }), 'skipped by the Worker');

  const names = { 1: 'Northwind Labs', 3: 'Fjord Data' };
  const out = chaseOutcomeOf({
    chased: [{ project_id: 1, already: false }, { project_id: 5, already: true }],
    skipped: [3, 9],
    skips: [{ project_id: 3, reason: 'not_due', due_date: '2026-11-14' }],
  }, (id) => names[id]);
  assert.equal(out.chased, 1);
  assert.equal(out.already, 1);
  assert.deepEqual(out.skipped.map((s) => [s.project_id, s.name, s.reason, s.text]), [
    [3, 'Fjord Data', 'not_due', 'not due until 14 Nov 2026'],
    [9, 'Company 9', null, 'skipped by the Worker'],
  ], 'a skipped id without a reason is still not chased');
  assert.deepEqual(chaseOutcomeOf({}, () => null), { chased: 0, already: 0, skipped: [] });
});

test('a per-row chase the Worker skipped says why, and does not say the company was asked', async () => {
  const view = await mount({ chased: [], skipped: [3], skips: [{ project_id: 3, reason: 'not_due', message: 'x', period: '2026-Q3', due_date: '2026-11-14' }] });
  try {
    await view.click('button-chase-3');
    assert.deepEqual(view.posts, [{ project_ids: [3] }]);
    assert.equal(view.note(), 'Fjord Data was not chased: not due until 14 Nov 2026.');
  } finally { await view.close(); }
});

test('a per-row chase with no answer for the company is not confirmed as asked', async () => {
  const view = await mount({ chased: [], skipped: [], skips: [] });
  try {
    await view.click('button-chase-1');
    assert.equal(view.note(), 'Northwind Labs was not confirmed as chased.');
  } finally { await view.close(); }
});

test('Chase all overdue counts only the chased, and names each skipped company with its reason', async () => {
  const view = await mount({
    chased: [{ project_id: 1, uid: 'c1', already: false }],
    skipped: [4],
    skips: [{ project_id: 4, reason: 'already_reported', message: 'x', period: '2026-Q3', due_date: null }],
  });
  try {
    await view.clickText('Chase all overdue');
    assert.deepEqual(view.posts.map((p) => [...p.project_ids].sort()), [[1, 4]], 'the Worker\'s overdue set: Fjord is not yet due');
    assert.equal(view.note(), '1 company chased. Not chased: Gannet Bio (already reported for Q3 2026).');
  } finally { await view.close(); }
});
