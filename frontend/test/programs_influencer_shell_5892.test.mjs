import test from 'node:test';
import assert from 'node:assert/strict';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import adminInfluencersRoutes from '../src/routes/adminInfluencers.jsx';
import '../src/pages/admin/programs/ProgramPage.jsx';
import { TABS } from '../src/pages/admin/programs/influencersModel.js';
import { moduleRows } from '../src/pages/admin/programs/genericProgramModel.js';

const h = React.createElement;
const base = '/admin/programs/influencer';
const user = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const Table = () => h(Suspense, { fallback: null }, h(Routes, null, adminInfluencersRoutes({
  guard(roles, element) { assert.deepEqual(roles, ['admin']); return element; },
})));

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

function worker(failRegistry = false) {
  return (url) => {
    const [path] = url.split('?');
    if (path === '/api/auth/me') return response(user);
    if (path === '/api/admin/programs/influencer') {
      if (failRegistry) return response({ error: 'unavailable' }, 503);
      return response({ program: { key: 'influencer', name: 'Influencers', status: 'live', member_access: 'open',
        modules: ['applications', 'influencers'] }, grant: { state: 'granted_to', granted_count: 1 },
        playbook: { published: true, version: 1, sections: [] } });
    }
    if (path.endsWith('/applications')) return response({ applications: [], counts: { applied: 0 } });
    if (path.endsWith('/tier-defaults')) return response({ tiers: [] });
    return response({ items: [], rows: [], influencers: [], flags: [], total: 0 });
  };
}

async function mounted(url, handle, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}${l.hash}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Table), h(Probe)))));
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  for (let waited = 0; !container.childNodes?.length && waited < 5000; waited += 25) {
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, at, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { await act(async () => { await props(byId(id)).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

test('Influencers module tabs match their registry addresses', () => {
  const rows = moduleRows('influencer', { modules: ['applications', 'influencers'] }).rows;
  assert.deepEqual(TABS.filter(t => t.module).map(t => [t.module, t.path]),
    rows.map(row => [row.key, row.path]));
  assert.equal(TABS.length, 10);
});

test('the real route table keeps the original screens and draws the shell sections', async () => {
  const screens = [
    ['', 'influencers-applications'],
    ['/how-it-runs', 'programs-influencer-how'],
    ['/applications', 'influencers-applications'],
    ['/influencers', 'influencers-table-card'],
    ['/offers', 'influencers-offers'],
    ['/payouts', 'influencers-payouts'],
    ['/activity', 'programs-influencer-activity'],
    ['/settings', 'influencers-settings'],
    ['/availability', 'programs-generic-availability'],
    ['/participation', 'programs-generic-participation-unrecorded'],
  ];
  for (const [suffix, expected] of screens) {
    const url = base + suffix + '?fixture=1#screen';
    const view = await mounted(url, worker(), user);
    try {
      assert.equal(view.at.path, url);
      assert.ok(view.has(expected), url + ' opens ' + expected);
      if (suffix === '/settings') assert.ok(view.has('programs-generic-settings'));
      if (suffix === '/participation') assert.match(view.textOf(expected), /Not recorded/);
    } finally { await view.close(); }
  }
});

test('a failed registry read leaves Influencer settings and applications available', async () => {
  for (const [suffix, expected] of [['', 'influencers-applications'], ['/settings', 'influencers-settings']]) {
    const view = await mounted(base + suffix, worker(true), user);
    try {
      assert.ok(view.has(expected));
      assert.match(view.text(), /could not be read/i);
      assert.ok(!view.has('programs-generic-settings'));
    } finally { await view.close(); }
  }
});
