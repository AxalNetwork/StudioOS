/**
 * D695 PR 1, the routed half (#1656): every form on `main` renders in the
 * dialog (test 3); each Add opens from its `/new` address, over the module
 * page on a desktop and as the page itself below 1024px, and closes back or
 * replaces (test 5); an Edit is the same URL with `state.editing`, opened with
 * the row's values and closed by Back (test 6). The routing cases run against
 * `CycleRoute.jsx` and against source mutations it must reject.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { EDITS, FORMS } from '../src/pages/cycles/forms.js';
import { MODULES } from '../src/pages/cycles/modules.js';
import { CYCLES } from '../src/pages/cycles/cycleModel.js';
import { PHONE_QUERY } from '../src/workspaces/lens.jsx';
import { installDocument } from './_contracts_dom.mjs';
import { srcFilesWith } from './_srcFilesWith.mjs';
import { card } from './_cycle_fixtures.mjs';
import { h, mutationCheck, propsOf, textOf } from './_form_d695.mjs';

const routePath = 'pages/cycles/CycleRoute.jsx';
const routeSource = readFileSync(new URL('../src/' + routePath, import.meta.url), 'utf8');
const moduleName = (cycle, slug) => MODULES[cycle].find((m) => m.slug === slug).name;
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// ---------- test 3: every form on main renders in the dialog -----------------

test('every Add and Edit on main renders in the dialog, named, with its eyebrow and its call to action', () => {
  const entries = [
    ...Object.entries(FORMS).flatMap(([cycle, bySlug]) => Object.entries(bySlug).flatMap(([slug, forms]) => forms.map((form) => [cycle, slug, form]))),
    ...Object.entries(EDITS).flatMap(([cycle, bySlug]) => Object.entries(bySlug).map(([slug, form]) => [cycle, slug, form])),
  ];
  assert.ok(entries.length >= 20, 'every registered form');
  for (const [cycle, slug, form] of entries) {
    const html = renderToStaticMarkup(h(MemoryRouter, null, h(FormLightbox, { form, cycle, slug, onSubmit() {}, onClose() {} })));
    const label = `${cycle}/${slug} ${form.key}`;
    assert.match(html, new RegExp(`role="dialog" aria-modal="true" aria-label="${form.title}"`), label);
    assert.match(html, /data-testid="cycle-form"/, label);
    assert.ok(plain(html).includes(`${CYCLES[cycle].name} · ${moduleName(cycle, slug)} ${form.title}`), `${label}: eyebrow, then title`);
    const cta = /data-testid="cycle-form-save"[^>]*>([^<]*)</.exec(html)?.[1];
    assert.equal(cta, form.cta, `${label}: its own CTA`);
    assert.doesNotMatch(plain(html), /· required/, `${label}: no required marker`);
  }
  const market = renderToStaticMarkup(h(MemoryRouter, null, h(FormLightbox, { form: FORMS.grow['market-expansion'][0], cycle: 'grow', slug: 'market-expansion', onSubmit() {}, onClose() {} })));
  assert.ok(plain(market).includes('Grow · Market expansion Add market'), 'the canvas title (CO:329, D695 #1657)');
  assert.match(market, /data-testid="cycle-form-save"[^>]*>Add market</);
  // A form with no fields still draws its sub and its CTA (#1652's Score readiness had none; #1657's Re-score has two).
  const bare = { key: 'fixture', title: 'Score readiness', lead: 'Checks what is recorded.', cta: 'Score readiness', fields: [] };
  const readiness = renderToStaticMarkup(h(MemoryRouter, null, h(FormLightbox, { form: bare, cycle: 'raise', slug: 'fundraising-readiness', onSubmit() {}, onClose() {} })));
  assert.doesNotMatch(readiness, /<input|<textarea/, 'a form with no fields draws none');
  assert.ok(plain(readiness).includes(bare.lead), 'its sub still draws');
  assert.match(readiness, /data-testid="cycle-form-save"[^>]*>Score readiness</);
  const rescore = renderToStaticMarkup(h(MemoryRouter, null, h(FormLightbox, { form: FORMS.raise['fundraising-readiness'][0], cycle: 'raise', slug: 'fundraising-readiness', onSubmit() {}, onClose() {} })));
  assert.match(rescore, /data-testid="cycle-form-save"[^>]*>Re-score now</, 'Re-score is the canvas form (CO:317, #1657)');
  // The side sheet is gone (step 8); Choose connector's loading and Bank note are connect_tool_d686's.
  assert.deepEqual(srcFilesWith(/RecordFormSheet/), []);
  assert.deepEqual(srcFilesWith('cycle-form-sheet'), []);
});

// ---------- the harness: CycleRoute in a router, the Worker stubbed ----------

const BUILD_READS = {
  // A filing's record (#1792), whose Edit gives its stored values; listed first, as the stub matches the first path it holds.
  '/cycles/build/modules/company-creation/records/step-5': {
    id: 'step-5', title: 'Certificate of incorporation',
    actions: [{ key: 'edit', kind: 'form', form: { title: 'Edit filing', cta: 'Save', fields: [
      { key: 'title', kind: 'T', value: 'Certificate of incorporation' }, { key: 'kind', kind: 'CH', value: 'formation' },
      { key: 'jurisdiction', kind: 'CH', value: 'Federal' }, { key: 'for_holder_id', kind: 'CH', value: '' },
      { key: 'due_date', kind: 'T', value: '2026-11-02' }, { key: 'state', kind: 'CH', value: 'upcoming' },
    ] } }],
  },
  '/cycles/build/modules/operating-systems': {
    module: { slug: 'operating-systems', name: 'Operating systems' }, card: card('build', 'Operating systems', 5),
    records: { cols: [{ key: 'system', label: 'System' }, { key: 'used_by', label: 'Used by' }], rows: [{ id: 'crm', cells: { system: 'CRM', used_by: 'Sales' } }], total: 1, page: 1, page_size: 25 },
  },
  '/cycles/build/modules/solution-design': {
    module: { slug: 'solution-design', name: 'Solution design' }, card: card('build', 'Solution design', 0),
    records: { cols: [{ key: 'feature', label: 'Feature' }], rows: [{ id: 7, cells: { feature: 'Bank feed import' } }], total: 1, page: 1, page_size: 25 },
  },
  '/cycles/build/modules/company-creation': {
    module: { slug: 'company-creation', name: 'Company creation' }, card: card('build', 'Company creation', 1),
    records: {
      cols: [{ key: 'filing', label: 'Filing' }, { key: 'due', label: 'Due' }, { key: 'state', label: 'State' }],
      rows: [{ id: 'step-5', cells: { filing: 'Certificate of incorporation', due: '2026-11-02', state: 'todo' } }, { id: 'lab-2', cells: { filing: 'Lab step', due: null, state: 'done' } }],
      total: 2, page: 1, page_size: 25,
    },
  },
};
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)];
const inside = (node, ancestor) => { for (let n = node; n; n = n.parentNode) if (n === ancestor) return true; return false; };
const click = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };

async function mountCycle(Route_, entry, { phone = false } = {}) {
  const restore = installDocument();
  const media = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: phone && query === PHONE_QUERY, media: query, addEventListener() {}, removeEventListener() {} });
  const fetchBefore = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url);
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const read = opts.method && opts.method !== 'GET' ? { id: 9 } : Object.entries(BUILD_READS).find(([key]) => path.includes(key))?.[1] ?? {};
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => read, text: async () => JSON.stringify(read) };
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = {};
  function Address() { const navigate = useNavigate(); const location = useLocation(); Object.assign(at, { navigate, type: useNavigationType(), path: location.pathname, search: location.search, state: location.state }); return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [entry] }, h(Address), h(Routes, null,
    h(Route, { path: '/build', element: h(Route_, { cycle: 'build' }) }),
    h(Route, { path: '/build/:slug', element: h(Route_, { cycle: 'build' }) }),
    h(Route, { path: '/build/:slug/new', element: h(Route_, { cycle: 'build', adding: true }) })))));
  await settle();
  const nodes = () => walk(container);
  const all = (id) => nodes().filter((n) => propsOf(n)['data-testid'] === id);
  const by = (id) => all(id)[0];
  /** The mounted FormLightbox's props, read from the fiber tree. */
  const forms = () => {
    const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
    // The container keeps the first HostRoot fiber; the committed tree is its root's `current`.
    const out = []; const stack = [container[key]?.stateNode?.current ?? container[key]];
    while (stack.length) { const n = stack.pop(); if (!n) continue; if (n.type === FormLightbox) out.push(n.memoizedProps); stack.push(n.sibling, n.child); }
    return out;
  };
  const reads = (slug) => calls.filter((c) => c.method === 'GET' && c.path.includes(`/cycles/build/modules/${slug}`) && !c.path.includes('/records/')).length;
  return {
    at, calls, by, all, nodes, forms, reads, form: () => forms()[0] || null,
    /** The open form's own <form>, not the records table's search. */
    formNode: () => walk(by('cycle-form') || by('cycle-form-page')).find((n) => n.tagName === 'FORM'),
    async act(fn) { await act(async () => { await fn(); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = fetchBefore; globalThis.matchMedia = media; restore(); },
  };
}

// ---------- test 5: the `/new` addresses --------------------------------------

async function assertAddRoutes(Route_) {
  // A deep link on a desktop: the module page with the dialog over it, mounted after the size container.
  let m = await mountCycle(Route_, '/build/solution-design/new?project_id=3');
  try {
    assert.equal(m.form()?.form.key, 'feature', '/new opens the first form');
    const dialog = m.by('cycle-form'); const body = m.by('cycle-route-body');
    assert.ok(dialog && body, 'the dialog and the body');
    assert.ok(!inside(dialog, body), 'the dialog is not inside the body');
    assert.ok(m.by('cycle-records') && inside(m.by('cycle-records'), body), 'the module page is under it');
    assert.equal(m.form().search, '?project_id=3', 'a form reads its address\'s query (fromQuery)');
    // A save sends the form's body, closes, and reads the module again.
    const before = m.reads('solution-design');
    await m.act(() => propsOf(m.by('cycle-form-title')).onChange({ target: { value: 'Bank feed import' } }));
    await m.act(() => propsOf(m.formNode()).onSubmit({ preventDefault() {} }));
    const post = m.calls.find((c) => c.method === 'POST');
    assert.equal(post?.path, '/api/cycles/build/features?project=3', 'Add feature, through #1695\'s route');
    assert.equal(post.body.title, 'Bank feed import');
    assert.equal(m.form(), null, 'a save closes the dialog');
    assert.deepEqual([m.at.path, m.at.search, m.at.type], ['/build/solution-design', '?project_id=3', 'REPLACE'], 'from a deep link, closing replaces /new with the module page');
    assert.ok(m.reads('solution-design') > before, 'the module is read again after the save');
  } finally { await m.unmount(); }

  // From the page: each Add is a link; the later one names its form; closing goes back.
  m = await mountCycle(Route_, '/build/solution-design?project_id=3');
  try {
    const links = m.all('records-add');
    assert.deepEqual(links.map((l) => propsOf(l).href), ['/build/solution-design/new?project_id=3', '/build/solution-design/new?project_id=3&form=risk']);
    assert.equal(m.form(), null);
    await m.act(() => propsOf(links[1]).onClick({ ...click }));
    assert.deepEqual([m.at.path, m.at.search, m.at.type], ['/build/solution-design/new', '?project_id=3&form=risk', 'PUSH']);
    assert.deepEqual(m.at.state, { under: '/build/solution-design?project_id=3' });
    assert.equal(m.form()?.form.key, 'risk', '?form=risk opens Add risk');
    await m.act(() => m.form().onClose());
    assert.deepEqual([m.at.path, m.at.search, m.at.type], ['/build/solution-design', '?project_id=3', 'POP'], 'closing goes back to the page that pushed it');
    assert.equal(m.form(), null);
    // ?add=1 is the first Add's address, the rest of the query kept.
    await m.act(() => m.at.navigate('/build/solution-design?project_id=3&add=1'));
    assert.deepEqual([m.at.path, m.at.search, m.at.type], ['/build/solution-design/new', '?project_id=3', 'REPLACE']);
    assert.equal(m.form()?.form.key, 'feature');
    // A key the module does not have opens its first form.
    await m.act(() => m.at.navigate('/build/solution-design/new?project_id=3&form=nothing'));
    assert.equal(m.form()?.form.key, 'feature');
    // A known module with no form has no /new; an unknown slug goes to the cycle.
    const bare = MODULES.build.find((mod) => !Object.hasOwn(FORMS.build, mod.slug)).slug;
    await m.act(() => m.at.navigate(`/build/${bare}/new?project_id=3`));
    assert.deepEqual([m.at.path, m.at.search], [`/build/${bare}`, '?project_id=3']);
    assert.equal(m.form(), null);
    await m.act(() => m.at.navigate('/build/not-a-module/new?project_id=3'));
    assert.deepEqual([m.at.path, m.at.search], ['/build', '?project_id=3']);
  } finally { await m.unmount(); }

  // Below 1024px the same address is a page in the body's gutter, and nothing is drawn at the mount.
  m = await mountCycle(Route_, '/build/solution-design/new?project_id=3', { phone: true });
  try {
    const body = m.by('cycle-route-body');
    assert.equal(m.all('cycle-form-page').length, 1, 'one form page');
    assert.ok(inside(m.by('cycle-form-page'), body), 'the page is drawn in the body');
    assert.equal(m.by('cycle-form'), undefined, 'no dialog');
    assert.equal(m.by('cycle-records'), undefined, 'the form is the body\'s only content');
    await m.act(() => propsOf(m.by('cycle-form-back')).onClick());
    assert.deepEqual([m.at.path, m.at.search], ['/build/solution-design', '?project_id=3'], '‹ Back closes it');
    assert.ok(m.by('cycle-records'), 'the module page is back');
  } finally { await m.unmount(); }
}

/**
 * Every module has one Add since #1656 PR 3b, and every Build module a form.
 * The routing of a second Add (`?form=`) and of a module with no form run on
 * the registry as a fixture changes it: Solution design gains a second Add,
 * and Operating systems loses its own, for the length of the test.
 */
const SECOND = { key: 'risk', cta: 'Add risk', button: 'Add risk', title: 'Add a risk', fields: [{ kind: 'T', name: 'title', k: 'Risk', required: true }],
  submit: (w, projectId, v) => w.build.risk(projectId, { title: v.title }) };
async function withFixtureRegistry(work) {
  const systems = FORMS.build['operating-systems'];
  FORMS.build['solution-design'].push(SECOND);
  delete FORMS.build['operating-systems'];
  try { await work(); } finally {
    FORMS.build['solution-design'].splice(FORMS.build['solution-design'].indexOf(SECOND), 1);
    FORMS.build['operating-systems'] = systems;
  }
}

test('each Add opens from its /new address: over the page on a desktop, as the page on a phone; it closes back or replaces', async () => withFixtureRegistry(async () => {
  await assertAddRoutes(CycleRoute);
  await mutationCheck(routeSource, routePath, (mod) => assertAddRoutes(mod.default), [
    ["forms.find((f) => f.key === searchParams.get('form')) || forms[0]", 'forms[0]'],
    ['if (location.state?.under) { navigate(-1); return; }', ''],
    ["    if (i > 0) params.set('form', entry.key);\n", ''],
    // D697: the body's phone line also carries a further part's page dialog.
    ['{phone && openForm ? openForm : phone && dialog?.page ? dialog.element : body}', '{phone && dialog?.page ? dialog.element : body}'],
    ['{!phone && openForm}', '{openForm}'],
    ['  if (adding && slug && !forms.length) return <Navigate to={`/${cycle}/${slug}${location.search}`} replace />;\n', ''],
    ["navigate(`/${cycle}/${slug}/new${rest ? `?${rest}` : ''}`, { replace: true });", "navigate(`/${cycle}/${slug}/new${rest ? `?${rest}` : ''}`);"],
    ['        onSaved={saved}\n        onClose={closeAdd} />', '        onClose={closeAdd} />'],
    ['  }, [adding, editingId]);', '  }, []);'],
  ]);
}));

// ---------- test 6: Edit -------------------------------------------------------

async function assertEdit(Route_) {
  const edit = EDITS.build['company-creation'];
  let m = await mountCycle(Route_, '/build/company-creation?project_id=3');
  try {
    const actions = m.all('records-row-action');
    assert.equal(actions.length, 1, 'Edit on the formation step only, not the Lab\'s step');
    await m.act(() => propsOf(actions[0]).onClick());
    assert.deepEqual([m.at.path, m.at.search, m.at.type], ['/build/company-creation', '?project_id=3', 'PUSH'], 'Edit pushes the same URL');
    assert.deepEqual(m.at.state, { editing: 'step-5' });
    // D695 (#1656): the filing's Edit reads its record first, then opens with the record's values.
    assert.ok(m.calls.some((c) => c.path === '/api/cycles/build/modules/company-creation/records/step-5?project=3'), 'the record is read');
    const open = m.form();
    assert.equal(open?.form.key, edit.key);
    assert.deepEqual(open.current, { kind: 'formation', jurisdiction: 'Federal', for_holder_id: '', due_date: '2026-11-02', state: 'upcoming' }, 'it starts from the record, through valuesOf');
    assert.equal(textOf(m.by('cycle-form-save')), 'Save');
    assert.ok(textOf(m.by('cycle-form')).includes('Edit filing'));
    const before = m.reads('company-creation');
    await m.act(() => propsOf(m.by('cycle-form-due_date')).onChange({ target: { value: '2026-11-09' } }));
    await m.act(() => propsOf(m.formNode()).onSubmit({ preventDefault() {} }));
    const patch = m.calls.find((c) => c.method === 'PATCH');
    assert.equal(patch?.path, '/api/cycles/build/formation-steps/5?project=3');
    assert.deepEqual(patch.body, { kind: 'formation', jurisdiction: 'Federal', due_date: '2026-11-09', state: 'upcoming' }, 'For is hidden for a formation, so not sent');
    assert.equal(m.form(), null, 'a save closes it');
    assert.deepEqual([m.at.path, m.at.type, m.at.state], ['/build/company-creation', 'POP', null], 'a save goes back');
    assert.ok(m.reads('company-creation') > before, 'and the module is read again');
    // Back closes an open Edit, as × and Cancel do.
    await m.act(() => propsOf(m.all('records-row-action')[0]).onClick());
    assert.ok(m.form());
    await m.act(() => m.at.navigate(-1));
    assert.equal(m.form(), null, 'Back closes it');
  } finally { await m.unmount(); }

  // An Edit that does not read its record (Choose connector) starts from valuesOf(row).
  m = await mountCycle(Route_, '/build/operating-systems?project_id=3');
  try {
    await m.act(() => propsOf(m.all('records-row-action')[0]).onClick());
    const open = m.form();
    assert.equal(open?.form, EDITS.build['operating-systems']);
    assert.deepEqual(open.current, { choice: '', used_by: 'Sales' }, 'it starts from valuesOf(row)');
    assert.ok(!m.calls.some((c) => c.path.includes('/records/')), 'no record read for it');
    const before = m.reads('operating-systems');
    await m.act(() => propsOf(m.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).value === 'none')).onChange({ target: { value: 'none' } }));
    await m.act(() => propsOf(m.formNode()).onSubmit({ preventDefault() {} }));
    assert.equal(m.calls.find((c) => c.method === 'PUT')?.path, '/api/cycles/build/systems/crm?project=3');
    assert.ok(m.reads('operating-systems') > before, 'its save reads the module again');
  } finally { await m.unmount(); }

  m = await mountCycle(Route_, '/build/company-creation?project_id=3', { phone: true });
  try {
    await m.act(() => propsOf(m.all('records-row-action')[0]).onClick());
    assert.ok(inside(m.by('cycle-form-page'), m.by('cycle-route-body')), 'on a phone the Edit is the page');
    assert.equal(m.by('cycle-form'), undefined);
    await m.act(() => propsOf(m.by('cycle-form-back')).onClick());
    assert.equal(m.form(), null);
    assert.equal(m.at.type, 'POP');
  } finally { await m.unmount(); }
}

test('Edit opens with the row\'s values over the same URL (state.editing), saves through its PATCH, and Back closes it', async () => {
  await assertEdit(CycleRoute);
  await mutationCheck(routeSource, routePath, (mod) => assertEdit(mod.default), [
    ['{ state: { editing: String(row.id) } }', '{ replace: true, state: { editing: String(row.id) } }'],
    ['current={edit.valuesOf(editing)}', 'current={null}'],
    ["    if (location.key !== 'default') navigate(-1);\n    else navigate", '    navigate'],
    ['        onSaved={saved}\n        onClose={closeEdit} />', '        onClose={closeEdit} />'],
    ['          onSaved={saved}\n          onClose={closeEdit} />', '          onClose={closeEdit} />'],
    ['edit.readsRecord ? (', 'false ? ('],
  ]);
  // #1658's record page passes `{ id, edit: { id, uid } }`; every Edit resolves it.
  const ids = { 'company-creation': 'step-7', 'prototype-mvp': '7', 'solution-design': '7', 'operating-systems': 'crm', 'revenue-and-traction': 'mrr',
    'cap-table': 'h-7', 'use-of-funds': 'product', 'demand-signals': 'signal-7', 'market-intelligence': 'cand-7', 'founding-team': 'h-7' };
  for (const [cycle, bySlug] of Object.entries(EDITS)) {
    for (const [slug, form] of Object.entries(bySlug)) {
      // As `recordFormFor` builds it: the record's own id in `edit` too.
      const record = { id: ids[slug] ?? 7, edit: { id: ids[slug] ?? 7, uid: 'u-7' } };
      assert.notEqual(form.idOf(record), null, `${cycle}/${slug}`);
    }
  }
});
