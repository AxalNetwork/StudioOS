import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ReferAndEarn from '../src/pages/admin/programs/ReferAndEarn.jsx';
import { PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import { moduleRows } from '../src/pages/admin/programs/genericProgramModel.js';
import { readRoutesSource } from './_routesSource.mjs';

const h = React.createElement;
const base = '/admin/programs/refer-and-earn';
const admin = { id: 5889, role: 'admin', name: 'Admin', email: 'admin@example.test' };
const program = { key: 'refer-and-earn', name: 'Refer & Earn', status: 'live', member_access: 'open', modules: ['referral_queue'] };
const tabs = [
  ['', 'overview', 'Overview'], ['/how-it-runs', 'how', 'Playbook'],
  ['/availability', 'availability', 'Availability & grants'], ['/participation', 'participation', 'Participation'],
  ['/queue', 'queue', 'Referral queue'], ['/activity', 'activity', 'History'], ['/settings', 'settings', 'Settings'],
];

test('every Refer & Earn address matches its section and the Referral queue module path', () => {
  assert.deepEqual(PAGES['refer-and-earn'].tabs.map(({ path, key, label }) => [path, key, label]),
    tabs.map(([suffix, key, label]) => [base + suffix, key, label]));
  assert.equal(moduleRows('refer-and-earn', program).rows[0].path, base + '/queue');
  const routes = readRoutesSource();
  for (const [suffix, tab] of tabs) {
    assert.ok(routes.includes('path="' + base + suffix + '" element={guard([\'admin\'], <'));
    assert.deepEqual(routeFor(base + suffix + '/'), { program: 'refer-and-earn', tab });
  }
});

async function mounted(t, suffix, user, registryFails = false) {
  const restore = installDocument();
  const originalFetch = globalThis.fetch;
  const originalMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async input => {
    const path = new URL(String(input), 'https://example.test').pathname;
    let data = { items: [], total: 0, rows: [] };
    let status = 200;
    if (path === '/api/auth/me') data = user;
    if (path === '/api/admin/programs/refer-and-earn') {
      data = registryFails ? { error: 'Unavailable' } : { program, grant: { state: 'not_offered' } };
      status = registryFails ? 503 : 200;
    }
    if (path === '/api/refer-earn/admin/rewards') data = { rules: [] };
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    globalThis.matchMedia = originalMatchMedia;
    restore();
  });
  localStorage.setItem('user', JSON.stringify(user));
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [base + suffix + '?from=overview#rules'] },
    h(AuthProvider, null, h(ReferAndEarn)))));
  const walk = node => [node, ...(node.childNodes || []).flatMap(walk)];
  const props = node => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const has = id => walk(container).some(node => props(node)['data-testid'] === id);
  const ready = registryFails ? 'programs-shell-registry-failed' : suffix === '/participation' ? 'programs-generic-participation' : 'programs-generic-settings';
  const deadline = performance.now() + 3000;
  while (!has(ready) && performance.now() < deadline) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  assert.ok(has(ready), ready);
  return { has, props, nodes: () => walk(container) };
}

test('Settings keeps referral rules and rewards and Admin can read member access', async t => {
  const view = await mounted(t, '/settings', admin);
  for (const id of ['programs-refer-settings', 'programs-refer-rewards', 'programs-generic-access-value']) assert.ok(view.has(id), id);
  assert.equal(view.has('programs-generic-access-save'), false);
});

test('Super Admin can edit member access beside the reward settings', async t => {
  const view = await mounted(t, '/settings', { ...admin, is_super_admin: 1 });
  assert.ok(view.has('programs-generic-access'));
  assert.ok(view.has('programs-generic-access-save'));
  assert.ok(view.has('programs-refer-rewards-edit'));
});

test('registry failure keeps referral rules and rewards visible', async t => {
  const view = await mounted(t, '/settings', admin, true);
  assert.ok(view.has('programs-refer-settings'));
  assert.ok(view.has('programs-refer-rewards'));
  assert.equal(view.has('programs-generic-settings'), false);
});

test('Participation explains missing member measurements', async t => {
  const view = await mounted(t, '/participation', admin);
  assert.ok(view.has('programs-generic-participation-unrecorded'));
});
