// D1174 (#3101): mounted legacy model context and removal of the unused score.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { register } from 'node:module';
// Only chart drawing is stubbed: this suite exercises the real page, URL and API effects.
// Recharts expects a browser layout engine; the minimal DOM supplies no chart layout.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'recharts' && context.parentURL?.endsWith('/FinancialsPage.jsx')) {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
        'export const LineChart = () => null; export const Line = LineChart, XAxis = LineChart, YAxis = LineChart, Tooltip = LineChart, ResponsiveContainer = LineChart, ReferenceLine = LineChart, CartesianGrid = LineChart, Legend = LineChart;') };
    }
    return next(specifier, context);
  }
`));
const { default: FinancialsPage } = await import('../src/pages/FinancialsPage.jsx');
const { tabHref } = await import('../src/pages/CapitalWorkspacePage.jsx');
const h = React.createElement;
const response = body => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mounted(url, exists = false) {
  const restore = installDocument();
  const oldFetch = globalThis.fetch, oldObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const create = document.createElement.bind(document);
  document.createElement = tag => { const node = create(tag); node.getBoundingClientRect = () => ({ width: 800, height: 240, top: 0, left: 0 }); return node; };
  const requests = [];
  globalThis.fetch = async input => {
    const path = String(input); requests.push(path);
    if (/\/projects(?:\?|$)/.test(path)) return response([{ id: 1, name: 'One' }, { id: 2, name: 'Two' }]);
    const id = path.match(/\/financials\/(\d+)$/)?.[1];
    if (id) return response({ project_id: Number(id), exists, assumptions: null, computed: null, sensitivity: null,
      capital_recompute: { total: 9, max: 10, factors: {} } });
    return response({ sources: [] });
  };
  let location, navigate;
  function Probe() { location = useLocation(); navigate = useNavigate(); return h(FinancialsPage, { embedded: true }); }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });
  await flush();
  const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = n => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const textOf = n => n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '';
  return {
    requests, text: () => textOf(container), search: () => location.search,
    exportButton: () => props(walk(container).find(n => n.tagName === 'BUTTON' && textOf(n).includes('Export XLSX'))),
    async select(id) { const node = walk(container).find(n => n.tagName === 'SELECT'); await act(async () => props(node).onChange({ target: { value: String(id) } })); await flush(); },
    async back() { await act(async () => navigate(-1)); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = oldFetch; globalThis.ResizeObserver = oldObserver; restore(); },
  };
}
const modelRequests = p => p.requests.filter(p => /\/financials\/\d+$/.test(p));

test('D1174: either venture alias loads that venture, all tabs keep it, and a legacy score is never drawn', async () => {
  for (const alias of ['project', 'project_id']) {
    const page = await mounted(`/raise/capital/model?${alias}=2&keep=1`);
    try {
      assert.deepEqual(modelRequests(page), ['/api/financials/2']);
      assert.equal(new URLSearchParams(page.search()).get('project_id'), '2');
      assert.equal(new URLSearchParams(page.search()).get('keep'), '1');
      assert.doesNotMatch(page.text(), /Capital score|Capital category recompute|scoring engine/);
      assert.match(page.text(), /Source: Modelled/);
      for (const path of ['/raise/capital/model', '/raise/capital/cap-table', '/raise/capital/pipeline']) {
        assert.equal(new URLSearchParams(tabHref(path, page.search()).split('?')[1]).get('project_id'), '2');
      }
    } finally { await page.close(); }
  }
});

test('D1174: invalid or missing venture never silently loads the first venture', async () => {
  for (const search of ['?project_id=999', '?project=2bad', '?project_id=', '']) {
    const page = await mounted(`/raise/capital/model${search}`);
    try {
      assert.deepEqual(modelRequests(page), []);
      assert.match(page.text(), search ? /selected venture is unavailable/ : /Choose a venture/);
    } finally { await page.close(); }
  }
});

test('D1174: changing venture and browser Back keep model reads on the URL venture', async () => {
  const page = await mounted('/raise/capital/model?project_id=2');
  try {
    await page.select(1);
    assert.equal(modelRequests(page).at(-1), '/api/financials/1');
    assert.equal(new URLSearchParams(page.search()).get('project_id'), '1');
    await page.back();
    assert.equal(modelRequests(page).at(-1), '/api/financials/2');
    assert.equal(new URLSearchParams(page.search()).get('project_id'), '2');
  } finally { await page.close(); }
});


test('D1174: export needs a person-saved model and explains the disabled action', async () => {
  for (const exists of [false, true]) {
    const page = await mounted('/raise/capital/model?project_id=2', exists);
    try {
      assert.equal(page.exportButton().disabled, !exists);
      assert.equal(page.exportButton().title, exists ? 'Download as XLSX' : 'Save the model before exporting');
    } finally { await page.close(); }
  }
});
