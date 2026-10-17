import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import CycleOverview from '../src/pages/cycles/CycleOverview.jsx';
import { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import ValidatePhoneFocus from '../src/pages/cycles/ValidatePhoneFocus.jsx';
import { formFor, formsFor, validate } from '../src/pages/cycles/forms.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import CycleRoute, { useProject } from '../src/pages/cycles/CycleRoute.jsx';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const html = (element, path = '/build?project_id=7') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, element));
const source = (path) => readFileSync(path, 'utf8');
/** An href as React writes it into an attribute, so its `&` is escaped by React's own encoder, not a hand-built one. */
const inAttr = (href) => /^<a href="([^"]*)">/.exec(renderToStaticMarkup(h('a', { href })))[1];
const reasons = [
  ['solution-design', 'Solution design', 'No features yet. Linked and unlinked features appear here.', 'Add feature', '/build/solution-design?project=7&add=1'],
  ['prototype-mvp', 'Prototype / MVP', 'No must-haves yet. The burn-up toward the ship date appears here.', 'Add must-have', '/build/prototype-mvp?project=7&add=1'],
  ['product-roadmap', 'Product roadmap', 'No roadmap items yet. Now, Next and Later appear here.', 'Add item', '/build/roadmap?project_id=7'],
  ['founding-team', 'Founding team', 'No founders yet. The equity split and vesting appear here.', 'Add founder', '/raise/capital/cap-table'],
  ['company-creation', 'Company creation', 'No filings yet. Formation steps and their dates appear here.', 'Add filing', '/build/company-creation?project=7&add=1'],
  ['operating-systems', 'Operating systems', 'No systems connected yet. Each system and its state appear here.', 'Connect a system', '/build/connect?project_id=7'],
];
const board = {
  cycle: 'build', question: 'Can this become a real company?',
  figures: ['must_haves_done', 'days_to_mvp', 'roadmap_shipped', 'systems_connected'].map((key) => ({ key, label: key, state: 'not_recorded', value: null, spark: [] })),
  cards: reasons.map(([slug, name, reason, text, href]) => ({ slug, name, state: 'empty', reason, next: { text, href }, range: 'Now', caption: 'Hidden chart caption', series: [] })),
  focus: { rule: 'first_feature', eyebrow: 'Build · Next', headline: 'Add the first feature.', why: 'Nothing in Build is recorded yet. Each chart fills as you add to its module.', cta: { label: 'Add feature', href: reasons[0][4] }, then: null },
};

test('D688: the six Build cards render empty links and four figures say Not recorded', () => {
  const out = html(h(CycleOverview, { cycle: 'build', data: board, status: 'ready', search: '?project_id=7' }));
  for (const [slug, , reason, text, href] of reasons) {
    const card = out.match(new RegExp(`<article[^>]*data-testid="cycle-card-${slug}"[\\s\\S]*?<\\/article>`))?.[0] || '';
    assert.match(card, /data-state="empty"/);
    assert.ok(card.includes(reason), slug);
    assert.ok(card.includes(text), slug);
    assert.ok(card.includes(inAttr(href)), slug);
  }
  assert.equal((out.match(/nothing recorded yet/g) || []).length, 4);
  assert.doesNotMatch(out, /Hidden chart caption|Next:|>0</);
});

test('D688: Build phone focus has the Add feature link and no Validate meter or index', () => {
  const out = html(h(ValidatePhoneFocus, { cycle: 'build', raw: board, search: '?project_id=7' }));
  assert.match(out, /Add the first feature\./);
  assert.match(out, /Add feature/);
  assert.match(out, /href="\/build\/solution-design\?project=7&amp;add=1"/);
  assert.doesNotMatch(out, /phone-meter|phone-target|Everything else in Validate|Then:/);
  const absent = html(h(ValidatePhoneFocus, { cycle: 'build', raw: { ...board, focus: null, cards: [] } }));
  assert.doesNotMatch(absent, /data-testid="phone-focus"/);
});

test('D688: Solution design has two distinct Add forms; Score readiness opens Re-score; narrative requires type', () => {
  const forms = formsFor('build', 'solution-design');
  assert.deepEqual(forms.map((form) => form.button), ['Add feature', 'Add risk']);
  assert.equal(formFor('build', 'solution-design'), forms[0]);
  assert.equal(formFor('build', 'constructor'), null);
  assert.equal(formFor('raise', 'toString'), null);
  assert.deepEqual(forms[0].fields.map((field) => field.name), ['title', 'added_value', 'effort']);
  const calls = [];
  const w = { build: { mvpFeature: (...args) => { calls.push(args); return { id: 1 }; } } };
  forms[0].submit(w, 7, { title: 'First feature' });
  assert.equal(calls[0][1].is_must_have, undefined);
  const record = html(h(RecordsTable, { title: 'Features', records: { cols: [], rows: [], total: 0 }, add: forms.map((form) => ({ text: form.button, onClick() {} })) }));
  assert.match(record, /Add feature/);
  assert.match(record, /Add risk/);
  // D695 (#1657): the card's "Score readiness" opens Re-score, the canvas form (CO:317).
  const rescore = formFor('raise', 'fundraising-readiness');
  assert.deepEqual(rescore.fields.map((field) => field.name), ['items', 'since']);
  assert.match(html(h(FormLightbox, { form: rescore, cycle: 'raise', slug: 'fundraising-readiness', onSubmit() {}, onClose() {} })), /Re-score now/);
  const narrative = formFor('raise', 'investor-narrative');
  assert.ok(validate(narrative, {}).investor_type);
  assert.deepEqual(validate(narrative, { investor_type: 'angel' }), {});
});

test('D688: Raise writes use existing query-scoped Worker routes', async () => {
  const calls = [];
  const writes = makeCycleWrites((path, opts) => { calls.push({ path, opts }); return Promise.resolve({}); });
  await writes.raise.rescore(7);
  await writes.raise.narrativeVersion(7, { investor_type: 'angel' });
  assert.deepEqual(calls.map((call) => [call.path, call.opts.method, call.opts.body]), [
    ['/cycles/raise/readiness/rescore?project=7', 'POST', undefined],
    ['/cycles/raise/narrative-versions?project=7', 'POST', '{"investor_type":"angel"}'],
  ]);
});

test('D688: route follows ?add=1 and selects the project returned by CreateStartupForm', () => {
  const route = source('frontend/src/pages/cycles/CycleRoute.jsx');
  const create = source('frontend/src/components/CreateStartupForm.jsx');
  // D695: `?add=1` is the first Add's address, `/new`, the rest of the query kept.
  assert.match(route, /if \(adding \|\| lightbox \|\| !slug \|\| !forms\.length \|\| searchParams\.get\('add'\) !== '1'\) return;/);
  assert.match(route, /params\.delete\('add'\)/);
  assert.match(route, /navigate\(`\/\$\{cycle\}\/\$\{slug\}\/new\$\{rest \? `\?\$\{rest\}` : ''\}`, \{ replace: true \}\);/);
  assert.match(route, /if \(created\?\.id\) writeProject\(created\.id, \['new'\]\)/);
  assert.match(create, /onCreated\(created\)/);
});

test('D688: the returned venture replaces the old selection and drops ?new=1 in one URL write', async () => {
  function Probe() {
    const { projectId, writeProject } = useProject();
    const location = useLocation();
    return h('div', null, h('button', { onClick: () => writeProject(2, ['new']) }, 'Select created'),
      h('i', null, `${projectId}:${location.search}`));
  }
  const mounted = await mountContracts(h(Probe), '/build?project_id=1&new=1');
  try {
    assert.match(mounted.text(), /1:\?project_id=1&new=1/);
    await mounted.click('Select created');
    assert.match(mounted.text(), /2:\?project_id=2$/);
  } finally { await mounted.unmount(); }
});

test('D688: ?add=1 opens the first form at its /new address on load and later navigation; close leaves it; no-form routes ignore it', async () => {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' });
  let navigate; let search; let path;
  function Address() { navigate = useNavigate(); const at = useLocation(); search = at.search; path = at.pathname; return null; }
  function form() {
    const key = Object.keys(container).find((entry) => entry.startsWith('__reactContainer$'));
    const stack = [container[key]];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type?.name === 'FormLightbox') return node.memoizedProps;
      stack.push(node.sibling, node.child);
    }
    return null;
  }
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/build/solution-design?project_id=7&add=1'] },
      h(Address), h(Routes, null,
        h(Route, { path: '/build', element: h(CycleRoute, { cycle: 'build' }) }),
        h(Route, { path: '/build/:slug', element: h(CycleRoute, { cycle: 'build' }) }),
        h(Route, { path: '/build/:slug/new', element: h(CycleRoute, { cycle: 'build', adding: true }) })))));
    assert.equal(form()?.form.button, 'Add feature');
    assert.equal(`${path}${search}`, '/build/solution-design/new?project_id=7', '?add=1 becomes the address');
    await act(async () => form().onClose());
    assert.equal(form(), null);
    assert.equal(`${path}${search}`, '/build/solution-design?project_id=7');
    await act(async () => navigate('/build/solution-design?project_id=7&add=1'));
    assert.equal(form()?.form.button, 'Add feature', 'query added after mount opens the form');
    assert.equal(path, '/build/solution-design/new');
    await act(async () => navigate('/build/product-roadmap?project_id=7&add=1'));
    assert.equal(form(), null, 'module with no form ignores add');
    assert.equal(`${path}${search}`, '/build/product-roadmap?project_id=7&add=1');
    await act(async () => navigate('/build?project_id=7&add=1'));
    assert.equal(form(), null, 'overview ignores add');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = fetchBefore;
    restore();
  }
});
