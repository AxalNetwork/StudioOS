import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import { PAGES } from '../src/pages/admin/programs/programsModel.js';
import { genericTabs } from '../src/pages/admin/programs/genericProgramModel.js';
import investorRoutes from '../src/routes/adminProgramsInvestorCohorts.jsx';

const h = React.createElement;
const base = '/admin/programs/investor-cohorts';
const user = { id: 1, role: 'admin', name: 'Admin' };
const sections = [
  ['overview', '', 'programs-investor-overview'],
  ['how', '/how-it-runs', 'programs-investor-how'],
  ['availability', '/availability', 'programs-generic-availability'],
  ['participation', '/participation', 'programs-investor-participation'],
  ['activity', '/activity', 'programs-investor-activity'],
  ['settings', '/settings', 'programs-generic-settings'],
];

test('Investor cohort access has the six shell sections on literal admin routes', () => {
  const tabs = PAGES['investor-cohorts'].tabs;
  assert.deepEqual(tabs.map(({ label, path }) => ({ label, path })),
    genericTabs('investor-cohorts').map(({ label, path }) => ({ label, path })));
  const source = readRoutesSource();
  for (const [, suffix] of sections) {
    assert.ok(source.includes(`<Route path="${base}${suffix}" element={guard(['admin'], <AdminProgramPage />)} />`), suffix);
  }
});

async function check(suffix, registryFails, verify) {
  const restore = installDocument();
  const prevFetch = globalThis.fetch;
  const prevMatch = globalThis.matchMedia;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async (url) => {
    const path = String(url).split('?')[0];
    if (path === '/api/auth/me') return response(user);
    if (path === '/api/admin/programs/investor-cohorts') return registryFails ? response({}, 503) : response({
      program: { key: 'investor-cohorts', status: 'live', modules: ['cohorts', 'nda_signature'], member_access: 'open' },
      grantable: true, playbook: { published: true, version: 1, sections: [] },
    });
    if (path.endsWith('/activity')) return response({ rows: [], next_before: null, not_audited: null });
    if (path.endsWith('/summary')) return response({ investors_with_access: 17, cohorts_open: 3, nda_template: 'published' });
    if (path.endsWith('/timeline')) return response({ cycles: [] });
    return response({ items: [], total: 0 });
  };
  localStorage.setItem('user', JSON.stringify(user));
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const nodes = (n) => [n, ...Array.from(n.childNodes || []).flatMap(nodes)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes(div).find((n) => props(n)['data-testid'] === id);
  const text = (n) => n?.childNodes?.length ? Array.from(n.childNodes).map(text).join('') : n?.textContent || '';
  try {
    const guard = (_roles, element) => element;
    await act(async () => root.render(h(MemoryRouter, { initialEntries: [`${base}${suffix}?source=bookmark#details`] },
      h(AuthProvider, null, h(Suspense, { fallback: null }, h(Routes, null,
        h(Route, { path: base, element: h(ProgramPage) }),
        h(Route, { path: `${base}/activity`, element: h(ProgramPage) }),
        investorRoutes({ guard })))))));
    verify(byId, text, props);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = prevFetch;
    globalThis.matchMedia = prevMatch;
    restore();
  }
}

test('bookmarks open the six sections, preserving cohort and NDA content on Overview', async () => {
  for (const [key, suffix, id] of sections) {
    await check(suffix, false, (byId, text, props) => {
      assert.equal(props(byId(`programs-tab-${key}`))['aria-current'], 'page', key);
      assert.ok(byId(id), id);
      if (key === 'overview') {
        for (const item of ['programs-investor-table', 'programs-investor-nda-template', 'programs-generic-module-cohorts', 'programs-generic-module-nda_signature']) assert.ok(byId(item), item);
        assert.equal(byId('programs-investor-how'), undefined);
      }
      if (key === 'participation') {
        assert.match(text(byId(id)), /17/);
        assert.match(text(byId(id)), /Not recorded how many investors viewed/);
      }
    });
  }
});

test('registry failure leaves the cohort summary, participation and history readable', async () => {
  await check('', true, (byId, text) => {
    assert.ok(byId('programs-investor-table'));
    assert.match(text(byId('programs-generic-modules')), /Could not be read/);
  });
  await check('/availability', true, (byId) => {
    assert.ok(byId('programs-shell-registry-failed'));
    assert.equal(byId('programs-generic-availability'), undefined);
  });
  await check('/participation', true, (byId, text) => assert.match(text(byId('programs-investor-participation')), /17/));
  await check('/activity', true, (byId) => assert.ok(byId('programs-investor-activity')));
});
