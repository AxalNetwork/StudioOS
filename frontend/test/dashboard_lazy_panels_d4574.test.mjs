// D4574 (#4574, H6) — the Studio page's charted and Product testing panels load
// through lazy boundaries, so recharts and ProductTestingStudio leave the
// Dashboard chunk's static closure (#4573 §2: 251 KiB and 228 KiB raw).
//
//   - each wrapper draws its skeleton first, then the real panel once the
//     dynamic import settles (mounted, as the page mounts it);
//   - the imports are dynamic, and Dashboard / ProfileFitSection reach the
//     panels only through the wrappers (a revert to a static import fails here);
//   - the Studio page still mounts the section under each member home and not
//     the Admin's, with the same props.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dashboard_lazy_panels_d4574.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ProductTestingStudioLazy from '../src/pages/testing/member/ProductTestingStudioLazy.jsx';
import SkillRadarLazy from '../src/components/play/SkillRadarLazy.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

async function mount(el, { measured = false } = {}) {
  const restore = installDocument();
  if (measured) {
    // recharts' ResponsiveContainer measures its box, so every fake node answers one. A zero box:
    // the container mounts and draws no SVG, so recharts' store never holds (and deep-freezes) a DOM node.
    const make = document.createElement;
    document.createElement = (tag) => Object.assign(make(tag), { getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }) });
  }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  await act(async () => { root.render(h(MemoryRouter, null, el)); });
  return {
    has: (id) => Boolean(by(id)),
    attr: (id, k) => pr(by(id))[k],
    nodes: () => walk(container),
    // The lazy chunk is transpiled on first import here, so wait for it (up to 10 s), not a fixed number of ticks.
    async until(id, present = true) {
      for (let i = 0; i < 200; i += 1) {
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        if (Boolean(by(id)) === present) return;
      }
      throw new Error(`${id} never ${present ? 'appeared' : 'went'}`);
    },
    async settle() { await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

const fakeApi = () => {
  const calls = [];
  const ok = (data) => async () => data;
  return {
    calls,
    api: {
      tester: async () => { calls.push('tester'); return { tester: { status: null }, consent: { version: 'v', text: 't' }, can_apply: true, cannot_apply: null }; },
      myApplications: async () => { calls.push('myApplications'); return { items: [] }; },
      programmes: ok({ items: [] }),
    },
  };
};

test('the Product testing section draws its skeleton, then the real card through the lazy boundary', async () => {
  const fake = fakeApi();
  const m = await mount(h(ProductTestingStudioLazy, { user: { role: 'founder' }, api: fake.api }));
  try {
    assert.equal(m.has('pt-studio-loading'), true, 'the skeleton holds the place while the chunk loads');
    await m.until('pt-card');
    await m.settle();
    assert.equal(m.has('pt-card'), true, 'the card draws once the chunk is in');
    assert.equal(m.has('pt-studio-loading'), false, 'the skeleton is gone');
    assert.deepEqual(fake.calls.sort(), ['myApplications', 'tester'], 'the props, `api` included, reach the real section');
  } finally { await m.unmount(); }
  // An Admin still draws nothing, and is not read.
  const admin = fakeApi();
  const a = await mount(h(ProductTestingStudioLazy, { user: { role: 'admin' }, api: admin.api }));
  try {
    await a.until('pt-studio-loading', false);
    await a.settle();
    assert.equal(a.has('pt-card'), false);
    assert.deepEqual(admin.calls, []);
  } finally { await a.unmount(); }
});

test('the skills radar holds its box at the radar height, then mounts the recharts chart', async () => {
  const prev = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const m = await mount(h(SkillRadarLazy, { skillVector: {}, height: 210 }), { measured: true });
  try {
    // Before the dynamic import settles, the fallback holds the radar's own height.
    assert.deepEqual(m.attr('skill-radar-loading', 'style'), { width: '100%', height: 210 });
    await m.until('skill-radar-loading', false);
    await m.settle();
    assert.equal(m.has('skill-radar-loading'), false, 'the skeleton is replaced');
    const box = m.nodes().find((n) => n.tagName === 'DIV' && Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.style?.height === 210);
    assert.ok(box, 'SkillRadar itself drew its 210px box');
    assert.ok(m.nodes().some((n) => /recharts-responsive-container/.test(Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.className || '')), 'recharts mounted');
  } finally { await m.unmount(); globalThis.ResizeObserver = prev; }
});

test('the imports are dynamic: Dashboard and ProfileFitSection reach the panels only through their lazy wrappers', () => {
  const dash = codeOnly(read('frontend/src/pages/Dashboard.jsx'));
  assert.match(dash, /^import ProductTestingStudio from '\.\/testing\/member\/ProductTestingStudioLazy';$/m);
  assert.doesNotMatch(dash, /from '\.\/testing\/member\/ProductTestingStudio(\.jsx)?'/, 'no static import of the section itself');
  assert.doesNotMatch(dash, /from ['"]recharts['"]/);

  const fit = codeOnly(read('frontend/src/components/profile/ProfileFitSection.jsx'));
  assert.match(fit, /^import SkillRadar from '\.\.\/play\/SkillRadarLazy';$/m);
  assert.doesNotMatch(fit, /from '\.\.\/play\/SkillRadar(\.jsx)?'/, 'no static import of the recharts radar');
  assert.doesNotMatch(fit, /from ['"]recharts['"]/);

  const pts = codeOnly(read('frontend/src/pages/testing/member/ProductTestingStudioLazy.jsx'));
  assert.match(pts, /lazy\(\(\) => import\('\.\/ProductTestingStudio\.jsx'\)\)/);
  assert.doesNotMatch(pts, /^import\s+\w+\s+from '\.\/ProductTestingStudio(\.jsx)?'/m);
  const radar = codeOnly(read('frontend/src/components/play/SkillRadarLazy.jsx'));
  assert.match(radar, /lazy\(\(\) => import\('\.\/SkillRadar\.jsx'\)\)/);
  assert.doesNotMatch(radar, /^import\s+\w+\s+from '\.\/SkillRadar(\.jsx)?'/m);
  assert.doesNotMatch(radar, /from ['"]recharts['"]/);
});

test('the Studio page still mounts the section under each member home, with the same props, and not the Admin\'s', () => {
  const dash = read('frontend/src/pages/Dashboard.jsx');
  assert.equal(dash.match(/<ProductTestingStudio user=\{authUser \|\| user\} \/>/g)?.length, 5);
  const adminBranch = dash.slice(dash.indexOf("if (activeRole === 'admin' && authUser)"), dash.indexOf('if (loading) return ('));
  assert.doesNotMatch(adminBranch, /ProductTestingStudio/);
  // The route, its guard and its lazy page are untouched.
  const app = read('frontend/src/App.jsx');
  assert.match(app, /const Dashboard = lazy\(\(\) => import\('\.\/pages\/Dashboard'\)\);/);
  assert.match(app, /<Route path="\/studio" element=\{guard\(labRoles\(\['admin', 'founder', 'partner', 'investor', 'advisor'\]\), <Dashboard activeRole=\{effectiveRole\} authUser=\{user\} \/>\)\} \/>/);
  assert.match(read('documentation/architecture/decisions/D4574.md'), /^## D4574 — .+ \(#4574\)$/m);
});
