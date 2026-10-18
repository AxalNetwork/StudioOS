/**
 * D703 (#1665), PR 2c — `CycleRoute` wires the pushed pages below 1024px:
 * test 6's route cases (a module route draws `PhoneModulePage` with
 * `CycleModulePage`'s props), test 11's (an Add page draws the route's
 * `CycleBar`, through `LightboxBarProvider`), test 12's (each action is a
 * page at the `Mount`, the route's only content) and the rest of test 14.
 * The component cases of tests 6-8, 12 and 13 are on `main` (#1761, #1765).
 *
 * Phone width is #1656's `matchMedia` stub. Every name is made up.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/phone_cycle_route_pages_d703.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { CycleBar, PHONE_GUTTER } from '../src/pages/cycles/PhoneModulePage.jsx';
import { FORMS } from '../src/pages/cycles/forms.js';
import { PHONE_QUERY } from '../src/workspaces/lens.jsx';
import { installDocument } from './_contracts_dom.mjs';
import { card } from './_cycle_fixtures.mjs';

const h = React.createElement;
const Q = '?project_id=3';

const READS = {
  '/cycles/build/modules/solution-design': {
    module: { slug: 'solution-design', name: 'Solution design', records_title: 'Features' },
    card: { ...card('build', 'Solution design', 0), caption: 'Features against the pains they answer.', next: null },
    records: { cols: [{ key: 'feature', label: 'Feature' }, { key: 'effort', label: 'Effort' }], rows: [{ id: 7, cells: { feature: 'Bank feed import', effort: 'S' } }], total: 1, page: 1, page_size: 25, linkable: true },
  },
};

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });

/** `CycleRoute` under App's lines for every cycle: root, module, `/new`, record and the four action paths. */
async function mount(entry, { phone = true, state } = {}) {
  const restore = installDocument();
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: phone && query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} });
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url);
    const body = Object.entries(READS).find(([key]) => path.includes(key))?.[1] ?? {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = {};
  function Address() { const navigate = useNavigate(); const location = useLocation(); Object.assign(at, { navigate, path: location.pathname, search: location.search }); return null; }
  const routes = [];
  for (const [cycle, action] of [['validate', 'record'], ['build', 'connect'], ['raise', 'call'], ['grow', 'update']]) {
    routes.push(h(Route, { key: `${cycle}`, path: `/${cycle}`, element: h(CycleRoute, { cycle }) }));
    routes.push(h(Route, { key: `${cycle}-a`, path: `/${cycle}/${action}`, element: h(CycleRoute, { cycle, lightbox: true }) }));
    routes.push(h(Route, { key: `${cycle}-s`, path: `/${cycle}/:slug`, element: h(CycleRoute, { cycle }) }));
    routes.push(h(Route, { key: `${cycle}-n`, path: `/${cycle}/:slug/new`, element: h(CycleRoute, { cycle, adding: true }) }));
  }
  const initial = state ? { pathname: entry.split('?')[0], search: entry.includes('?') ? `?${entry.split('?')[1]}` : '', state } : entry;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [initial] }, h(Address), h(Routes, null, ...routes))));
  await settle();
  const nodes = () => walk(container);
  const all = (id) => nodes().filter((n) => pr(n)['data-testid'] === id);
  /** The mounted components of `type`, read from the fiber tree. */
  const fibers = (type) => {
    const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
    const out = []; const stack = [container[key]?.stateNode?.current ?? container[key]];
    while (stack.length) { const n = stack.pop(); if (!n) continue; if (n.type === type) out.push(n.memoizedProps); stack.push(n.sibling, n.child); }
    return out;
  };
  return {
    at, nodes, all, by: (id) => all(id)[0], fibers,
    classes: () => nodes().map((n) => String(pr(n).className || '')),
    barBack: () => walk(all('cycle-bar')[0] || {}).find((n) => n.tagName === 'BUTTON' || n.tagName === 'A'),
    act: async (fn) => { await act(async () => { await fn(); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = fetchBefore; globalThis.matchMedia = media; restore(); },
  };
}

// ── 6. A module route is the pushed module page ───────────────────────────

// Validate's Add forms join `FORMS` with #1656's PR 2b, so the module and Add cases run on Build's Solution design.
test('6 (route): below 1024px /build/solution-design draws PhoneModulePage with CycleModulePage\'s props; at 1024px the desktop page', async () => {
  let m = await mount(`/build/solution-design${Q}`);
  try {
    assert.equal(m.all('phone-module').length, 1);
    assert.equal(m.by('cycle-module'), undefined, 'CycleModulePage does not render');
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1, 'one bar');
    assert.deepEqual([bars[0].back.label, bars[0].back.to, bars[0].title, bars[0].sub, bars[0].eadwynLabel],
      ['Build', `/build${Q}`, 'Solution design', 'Features against the pains they answer.', 'Build · Solution design']);
    assert.equal(pr(m.by('phone-module-cta')).href, `/build/solution-design/new${Q}`, 'the module\'s own Add, as the desktop links it');
    assert.ok(txt(m.by('phone-module-records')).includes('Features ·'), 'the records group');
    assert.equal(pr(m.by('phone-module-row')).href, `/build/solution-design/7${Q}`, 'a linkable row opens its record');
  } finally { await m.unmount(); }
  m = await mount(`/build/solution-design${Q}`, { phone: false });
  try {
    assert.equal(m.by('phone-module'), undefined, 'no phone page at 1024px');
    assert.equal(m.fibers(CycleBar).length, 0);
  } finally { await m.unmount(); }
});

// ── 11. Add pages ─────────────────────────────────────────────────────────

test('11 (route): below 1024px /build/solution-design/new draws CycleBar "‹ Solution design", the form\'s title, with no bar handed to FormLightbox; Back closes it', async () => {
  const m = await mount(`/build/solution-design/new${Q}`);
  const title = FORMS.build['solution-design'][0].title;
  try {
    assert.equal(m.all('cycle-form-page').length, 1, 'the form is the page');
    const forms = m.fibers(FormLightbox);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].bar, undefined, 'FormLightbox is handed no bar');
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1);
    assert.deepEqual([bars[0].back.label, bars[0].title, bars[0].eadwynLabel], ['Solution design', title, `Build · ${title}`]);
    assert.equal(typeof bars[0].back.onClick, 'function', 'Back is #1656\'s close, never a link');
    assert.equal(m.by('cycle-form-back'), undefined, 'no second Back');
    await m.act(() => pr(m.barBack()).onClick());
    assert.deepEqual([m.at.path, m.at.search], ['/build/solution-design', Q], 'the deep link closes to the module page');
    assert.equal(m.all('phone-module').length, 1);
  } finally { await m.unmount(); }
});

// ── 12. Action pages ──────────────────────────────────────────────────────

const ACTIONS = [
  ['validate', 'record', 'Validate', 'record-lightbox'],
  ['build', 'connect', 'Build', 'connect-tool-lightbox'],
  ['raise', 'call', 'Raise', 'round-call-lightbox'],
  ['grow', 'update', 'Grow', 'lightbox'],
];

for (const [cycle, path, name, testId] of ACTIONS) {
  test(`12 (route): below 1024px /${cycle}/${path} is a page at the Mount, the route's only content, with the cycle gutter and "‹ ${name}"`, async () => {
    let m = await mount(`/${cycle}/${path}${Q}`);
    try {
      const nodes = m.nodes();
      assert.ok(!nodes.some((n) => pr(n).role === 'dialog'), 'no dialog');
      const classes = m.classes();
      assert.ok(!classes.some((c) => c.includes('fixed') && c.includes('inset-0') && c.includes('z-[80]')), 'no fixed layer over the tab bar');
      assert.equal(m.by('cycle-route-body'), undefined, 'no body');
      assert.ok(!classes.some((c) => c.split(/\s+/).includes('@container/cycle')), 'no size container');
      const page = nodes.find((n) => String(pr(n)['data-testid'] || '').endsWith('-page') && String(pr(n).className || '').includes(PHONE_GUTTER));
      assert.ok(page, `the ${testId} page carries PHONE_GUTTER`);
      const bars = m.fibers(CycleBar);
      assert.equal(bars.length, 1, 'one bar');
      assert.equal(bars[0].back.label, name, 'a deep link goes back to the cycle');
      assert.equal(typeof bars[0].back.onClick, 'function', 'Back is closeAction');
      assert.equal(m.by('phone-root'), undefined, 'no root under it');
      assert.equal(m.by('cycle-overview'), undefined, 'no overview under it');
      await m.act(() => bars[0].back.onClick());
      assert.deepEqual([m.at.path, m.at.search], [`/${cycle}`, Q], 'closeAction: the deep link replaces itself with the cycle');
    } finally { await m.unmount(); }
    // At 1024px it is today's dialog, after the size container.
    m = await mount(`/${cycle}/${path}${Q}`, { phone: false });
    try {
      assert.ok(m.nodes().some((n) => pr(n).role === 'dialog'), 'the dialog');
      assert.ok(m.by('cycle-route-body'), 'the body under it');
      assert.equal(m.fibers(CycleBar).length, 0);
    } finally { await m.unmount(); }
  });
}

test('12 (route): opened from a module page, an action page goes back to that module: "‹ <Module>"', async () => {
  const m = await mount(`/validate/record${Q}`, { state: { under: `/validate/customer-research${Q}` } });
  try {
    const bars = m.fibers(CycleBar);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].back.label, 'Customer research');
  } finally { await m.unmount(); }
});

// ── 14. One breakpoint (the rest) ─────────────────────────────────────────

test('14: no md: rule in PhoneModulePage.jsx or CycleModulePage.jsx\'s table; the phone branches read usePhoneWidth() and no file in pages/cycles reads a width', () => {
  const src = (f) => readFileSync(`frontend/src/pages/cycles/${f}`, 'utf8');
  assert.doesNotMatch(src('PhoneModulePage.jsx'), /\bmd:/);
  assert.doesNotMatch(src('CycleModulePage.jsx'), /\bmd:/);
  for (const at of ['lg:grid', 'lg:col-span-1', 'lg:hidden', 'lg:justify-self-end']) assert.ok(src('CycleModulePage.jsx').includes(at), at);
  const route = src('CycleRoute.jsx');
  assert.match(route, /const ModulePage = phone \? PhoneModulePage : CycleModulePage;/);
  assert.match(route, /<LightboxBarProvider bar=\{phone \? phoneBar\(pageBack\) : null\}>/);
  assert.match(route, /const actionPage = phone && lightbox && Mount && projectId;/);
  assert.match(route, /\{!actionPage && \(\n\s+<div className="@container\/cycle min-w-0">/);
  for (const f of ['CycleRoute.jsx', 'PhoneModulePage.jsx', 'CycleModulePage.jsx', 'RecordView.jsx']) {
    assert.doesNotMatch(src(f), /matchMedia|innerWidth/, f);
  }
});
