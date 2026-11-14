import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { moduleRows } from '../src/pages/admin/programs/genericProgramModel.js';
import { PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import { readRoutesSource } from './_routesSource.mjs';

const base = '/admin/programs/mentor-cohorts';
const tabs = [
  ['', 'overview', 'Overview'],
  ['/how-it-runs', 'how', 'Playbook'],
  ['/availability', 'availability', 'Availability & grants'],
  ['/participation', 'participation', 'Participation'],
  ['/people', 'people', 'Cohorts'],
  ['/activity', 'activity', 'History'],
  ['/settings', 'settings', 'Settings'],
];

test('Mentor cohort access keeps all seven shell paths and the Cohorts module address', () => {
  assert.deepEqual(PAGES['mentor-cohorts'].tabs.map(({ path, key, label }) => [path, key, label]),
    tabs.map(([suffix, key, label]) => [base + suffix, key, label]));
  const cohorts = PAGES['mentor-cohorts'].tabs.find(({ module }) => module === 'cohorts');
  assert.equal(cohorts.path, moduleRows('mentor-cohorts', { modules: ['cohorts'] }).rows[0].path);
  const routes = readRoutesSource();
  for (const [suffix, tab] of tabs) {
    const path = base + suffix;
    assert.ok(routes.includes(`path="${path}" element={guard(['admin'], <`), path);
    assert.deepEqual(routeFor(path), { program: 'mentor-cohorts', tab });
    assert.deepEqual(routeFor(path + '/'), { program: 'mentor-cohorts', tab });
  }
});

test('registry-dependent tabs use the shared registry states, and Participation reads recorded sessions', () => {
  const page = readFileSync('frontend/src/pages/admin/programs/MentorCohortAccess.jsx', 'utf8');
  for (const [key, component] of [['availability', 'Availability'], ['settings', 'Settings']]) {
    assert.ok(page.includes(`tab === '${key}' ? <OnRegistry detail={detail}>`), key);
    assert.ok(page.includes(`<${component} `), component);
  }
  assert.match(page, /<Modules modules=\{shellModules\('mentor-cohorts', detail\.read\)\}/);
  assert.match(page, /sessionsFrom\(reads\.sessions\)/);
  assert.match(page, /word="Not recorded" reason="The sessions read does not count distinct people/);
});

test('the registry failure stays on registry sections while Participation shows the recorded total', async () => {
  const { default: React, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { installDocument } = await import('./_contracts_dom.mjs');
  const { default: Page } = await import('../src/pages/admin/programs/MentorCohortAccess.jsx');
  const restore = installDocument();
  const previousFetch = globalThis.fetch;
  const previousMatchMedia = globalThis.matchMedia;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.fetch = async (url) => {
    const path = String(url).split('?')[0];
    if (path === base.replace('/admin', '/api/admin')) return Response.json({ error: 'unavailable' }, { status: 503 });
    if (path === '/api/admin/programs/mentor-cohorts/sessions') {
      return Response.json({ cycles: [{ cycle_id: 1, year: 2026, month: 10, mentors: 2, sessions: 7 }] });
    }
    return Response.json({ items: [], cycles: [] });
  };

  const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
  const ids = () => {
    return walk(container).map((node) => Object.entries(node).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.['data-testid']);
  };
  async function mount(suffix, expected) {
    await act(async () => root.render(React.createElement(MemoryRouter, {
      key: suffix, initialEntries: [base + suffix + '?source=test#details'],
    }, React.createElement(Page))));
    for (let attempt = 0; !ids().includes(expected) && attempt < 80; attempt++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.ok(ids().includes(expected), expected);
  }

  try {
    await mount('/availability', 'programs-shell-registry-failed');
    assert.ok(!ids().includes('programs-generic-availability'));
    await mount('/settings', 'programs-shell-registry-failed');
    assert.ok(!ids().includes('programs-generic-settings'));
    await mount('/participation', 'programs-mentor-participation-unrecorded');
    const recorded = () => walk(container).some((node) => /7 sessions booked with a mentor/.test(node.textContent));
    for (let attempt = 0; !recorded() && attempt < 80; attempt++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.ok(recorded(), 'Participation renders the booked sessions total');
    assert.ok(!ids().includes('programs-shell-registry-failed'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previousFetch;
    globalThis.matchMedia = previousMatchMedia;
    restore();
  }
});
