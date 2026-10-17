/** D696 PR 2: mounted reads/actions, boundaries, and linkable module rows. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { fixture, mutationCheck } from './_record_d696.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { cyclesApi } from '../src/lib/api/cycles.js';
import * as rules from '../src/pages/cycles/recordModel.js';
import { routeBlock } from './_routes.mjs';
import { codeOnly } from './_codeOnly.mjs';
const h = React.createElement;
const read = path => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const record = () => ({ ...fixture(), module: 'solution-design', title: 'Example feature', sub: 'One recorded feature.', id: '7',
  actions: [
    { key: 'mark', kind: 'write', label: 'Mark complete' },
    { key: 'delete', kind: 'write', label: 'Delete', tone: 'danger', confirm: { title: 'Delete feature?', body: 'This removes the feature.', cta: 'Delete permanently' } },
    { key: 'edit', kind: 'form', label: 'Edit', form: { fields: [{ key: 'is_must_have', value: 'yes' }] } },
    { key: 'proof', kind: 'form', label: 'Attach proof', multipart: true, form: { title: 'Attach proof', fields: [{ key: 'proof', label: 'Proof', kind: 'T', input: 'file', required: true }] } },
    { key: 'open-minutes', kind: 'write', label: 'Open minutes' },
    { key: 'compare', kind: 'link', label: 'Compare', href: '/build/solution-design?project_id=3' },
  ],
});
function fiber(container, name) {
  const key = Object.keys(container).find(k => k.startsWith('__reactContainer$'));
  const stack = [container[key]?.stateNode?.current || container[key]];
  while (stack.length) { const f = stack.pop(); if (!f) continue; if (f.type?.name === name) return f; stack.push(f.sibling, f.child); }
  return null;
}
async function mounted(handler, { url = '/build/solution-design/7?project_id=3', phone = false, View = CycleRoute, staticSlug } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia, open: globalThis.open };
  const requests = [], opened = [];
  globalThis.fetch = async (url, options = {}) => { requests.push({ url: String(url), options }); return handler(String(url), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  globalThis.open = (...args) => opened.push(args);
  const create = document.createElement.bind(document);
  document.createElement = tag => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const out = {};
  function Capture() { out.location = useLocation(); out.navigate = useNavigate(); return null; }
  const props = node => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const nodes = () => { const walk = node => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = node => node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '';
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Capture), h(Routes, null,
    h(Route, { path: '/build/:slug/:id', element: h(View, { cycle: 'build', record: true }) }),
    h(Route, { path: '/build/:slug', element: h('p', null, 'Module landing') }),
    h(Route, { path: '/raise/static', element: h(View, { cycle: 'raise', slug: staticSlug }) }),
  ))));
  return { ...out, out, requests, opened, container, nodes, props, text: () => text(container),
    fiber: name => fiber(container, name),
    flush: () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }),
    run: callback => act(async () => { await callback(); }),
    click: label => act(async () => { const node = nodes().find(n => n.tagName === 'BUTTON' && text(n) === label); assert.ok(node, 'button: ' + label); await props(node).onClick({ preventDefault() {}, stopPropagation() {} }); }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const defaultHandler = (url, opts) => response(url.includes('/activity?') ? { items: [{ a: 'Later activity', b: '17 Oct' }], total: 2 } : opts.method === 'POST' ? { ok: true } : url.includes('/records/') ? record() : {});

test('5. record clients encode paths and query, reject unknown cycles, and preserve multipart bodies', async () => {
  const restore = installDocument();
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return response({ ok: true }); };
  try {
    await cyclesApi.record('build', 3, 'solution-design', 'a/b');
    await cyclesApi.recordActivity('raise', 4, 'pitch-deck', 'deck-7', 2);
    await cyclesApi.recordAction('grow', 5, 'distribution', 'ch-1', 'a/b', { status: 'active' });
    const body = new FormData(); body.append('proof', new Blob(['evidence']), 'proof.txt');
    await cyclesApi.recordAction('validate', 6, 'demand-signals', 'signal-7', 'attach', body);
    assert.ok(calls[0].url.endsWith('/cycles/build/modules/solution-design/records/a%2Fb?project=3'));
    assert.ok(calls[1].url.endsWith('/cycles/raise/modules/pitch-deck/records/deck-7/activity?project=4&page=2'));
    assert.ok(calls[2].url.endsWith('/actions/a%2Fb?project=5')); assert.equal(calls[2].options.body, '{"status":"active"}');
    assert.equal(calls[3].options.body, body); assert.equal(calls[3].options.headers['Content-Type'], undefined);
    for (const method of ['record', 'recordActivity', 'recordAction']) await assert.rejects(() => cyclesApi[method]('invented', 3, 'x', '7'), /No such cycle/);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = original; restore(); }
});

test('6. record reads skip the module and render header/back, body, and paged activity', async () => {
  const view = await mounted(defaultHandler);
  try {
    assert.match(view.text(), /Build · Solution designExample feature/);
    assert.match(view.text(), /‹ Back to Solution design/);
    assert.match(view.text(), /RecordExample feature/);
    assert.ok(view.requests.some(r => r.url.includes('/records/7?project=3')));
    assert.ok(!view.requests.some(r => /modules\/solution-design\?/.test(r.url)));
    assert.ok(view.fiber('RecordView')); assert.equal(view.fiber('FillProposals'), null); assert.equal(view.fiber('ZoneDraft'), null);
    assert.ok(!view.nodes().some(n => view.props(n)?.['data-testid'] === 'cycle-action'));
    const back = view.nodes().find(n => view.props(n)?.href === '/build/solution-design?project_id=3' && String(view.props(n)?.children).includes('Back'));
    assert.ok(back); assert.equal(view.props(back)['aria-current'], undefined);
    await view.click('Show all'); assert.match(view.text(), /Later activity/);
    assert.ok(view.requests.some(r => r.url.endsWith('/activity?project=3&page=2')));
    assert.ok(!view.nodes().some(n => n.tagName === 'BUTTON' && view.props(n)?.children === 'Show all'));
    assert.equal(view.fiber('Lightbox'), null);
  } finally { await view.close(); }
});

test('6. writes confirm outside the size container; cancel sends nothing; delete returns to module', async () => {
  let deleted = false;
  const view = await mounted((url, opts) => {
    if (opts.method === 'POST') { deleted = true; return response({ ok: true }); }
    return deleted && url.includes('/records/') ? response({ detail: 'Record not found.' }, 404) : defaultHandler(url, opts);
  });
  try {
    await view.click('Delete'); assert.match(view.text(), /Delete feature\?[\s\S]*This removes the feature/);
    const dialog = view.fiber('Lightbox'); assert.ok(dialog);
    let parent = dialog.return; while (parent) { assert.notEqual(parent.memoizedProps?.['data-testid'], 'cycle-route-body'); assert.ok(!String(parent.memoizedProps?.className).includes('@container/cycle')); parent = parent.return; }
    await view.click('Cancel'); assert.ok(!view.requests.some(r => r.options.method === 'POST'));
    await view.click('Delete'); await view.click('Delete permanently'); await view.flush();
    assert.ok(view.requests.some(r => r.url.endsWith('/actions/delete?project=3')));
    assert.equal(view.out.location.pathname, '/build/solution-design');
  } finally { await view.close(); }
});

test('6. Edit uses the registered PATCH form with Worker values; Back closes it', async () => {
  const view = await mounted(defaultHandler);
  try {
    await view.click('Edit');
    const form = view.fiber('FormLightbox'); assert.ok(form);
    assert.equal(form.memoizedProps.current.is_must_have, 'yes');
    assert.equal(view.out.location.state.editing, 'edit');
    await view.run(() => form.memoizedProps.onSubmit({ is_must_have: 'no' }));
    assert.ok(view.requests.some(r => r.options.method === 'PATCH' && r.url.endsWith('/cycles/build/features/7?project=3')));
    assert.ok(view.requests.filter(r => r.url.includes('/records/7?project=3')).length >= 2);
    await view.run(() => view.out.navigate(-1)); assert.equal(view.fiber('FormLightbox'), null);
  } finally { await view.close(); }
});

for (const phone of [false, true]) test(`6. a file form sends bytes, and is ${phone ? 'the only phone body child' : 'outside the desktop size container'}`, async () => {
  const view = await mounted(defaultHandler, { phone });
  try {
    await view.click('Attach proof');
    const form = view.fiber('FormLightbox'); assert.ok(form);
    assert.ok(view.nodes().some(n => n.tagName === 'INPUT' && view.props(n)?.type === 'file'));
    let parent = form.return, inBody = false;
    while (parent) { if (parent.memoizedProps?.['data-testid'] === 'cycle-route-body') inBody = true; parent = parent.return; }
    assert.equal(inBody, phone);
    if (phone) assert.equal(view.fiber('RecordView'), null);
    const file = new File(['proof bytes'], 'proof.txt', { type: 'text/plain' });
    await view.run(() => form.memoizedProps.onSubmit({ proof: file }));
    const post = view.requests.find(r => r.url.includes('/actions/proof?project=3'));
    assert.ok(post.options.body instanceof FormData); assert.equal(await post.options.body.get('proof').text(), 'proof bytes');
  } finally { await view.close(); }
});

test('7. 403 and 404 show the Worker sentence; 500 offers Retry; malformed ids make no record read', async () => {
  for (const [status, sentence] of [[403, 'Partners do not see decisions.'], [404, 'Record not found.'], [500, 'Store down']]) {
    const view = await mounted(url => url.includes('/records/') ? response({ detail: sentence }, status) : response({}));
    try {
      assert.ok(view.text().includes(sentence)); assert.equal(view.fiber('RecordView'), null);
      const retry = view.nodes().find(n => {
        if (n.tagName !== 'BUTTON' || !String(view.props(n)?.children).includes('Retry')) return false;
        for (let p = n; p; p = p.parentNode) if (view.props(p)?.['data-testid'] === 'cycle-record-page') return true;
        return false;
      });
      assert.equal(!!retry, status === 500);
    } finally { await view.close(); }
  }
  const bad = await mounted(defaultHandler, { url: '/build/solution-design/Ab%20C?project_id=3' });
  try { assert.equal(bad.out.location.pathname, '/build/solution-design'); assert.ok(!bad.requests.some(r => r.url.includes('/records/'))); }
  finally { await bad.close(); }
});

test('7. late responses never replace another venture or record', async () => {
  let resolveOld;
  const view = await mounted(url => url.includes('/records/7?project=3') ? new Promise(resolve => { resolveOld = resolve; }) : url.includes('/records/') ? response({ ...record(), title: 'Other venture record' }) : response({}));
  try {
    await view.run(() => view.out.navigate('/build/solution-design/8?project_id=4'));
    assert.match(view.text(), /Other venture record/);
    await view.run(() => resolveOld(response(record())));
    assert.doesNotMatch(view.text(), /Example feature/); assert.match(view.text(), /Other venture record/);
    assert.ok(view.requests.some(r => r.url.endsWith('/records/8?project=4')));
  } finally { await view.close(); }
});

test('6. a static slug prop reads its own module', async () => {
  const view = await mounted(defaultHandler, { url: '/raise/static?project_id=3', staticSlug: 'data-room' });
  try { assert.ok(view.requests.some(r => r.url.endsWith('/cycles/raise/modules/data-room?project=3'))); }
  finally { await view.close(); }
});

test('8. the four record routes keep their module guards', () => {
  const app = codeOnly(read('frontend/src/App.jsx'));
  for (const cycle of ['validate', 'build', 'raise', 'grow']) {
    const moduleGuard = routeBlock(app, `/${cycle}/:slug`).match(/element=\{(.+?), <CycleRoute/)[1];
    assert.ok(routeBlock(app, `/${cycle}/:slug/:id`).includes(`element={${moduleGuard}, <CycleRoute cycle="${cycle}" record />)`));
  }
});

test('9. linkable rows have one stretched first-cell link, preserve project, and keep Edit above it', () => {
  const markup = (row, linkable = true) => renderToStaticMarkup(h(MemoryRouter, null, h(CycleModulePage, {
    cycle: 'build', slug: 'solution-design', search: '?project_id=3',
    data: { card: { name: 'Solution design' }, records: { linkable, cols: [{ key: 'name', label: 'Name' }, { key: 'other', label: 'Other' }], rows: [row] } },
    rowAction: () => ({ text: 'Edit', onClick() {} }),
  })));
  const row = { id: '7', cells: { name: { text: 'Feature', href: '/old' }, other: { text: 'Tool', href: '/tool' } } };
  const out = markup(row);
  assert.match(out, /href="\/build\/solution-design\/7\?project_id=3"/);
  assert.doesNotMatch(out, /href="\/(old|tool)"/); assert.match(out, /after:absolute after:inset-0/); assert.match(out, /relative z-10/);
  for (const bad of [{ ...row, recordId: null }, { ...row, id: 'Team' }, { ...row, id: 'investors:Example Holder:0' }]) assert.doesNotMatch(markup(bad), /href="\/build\/solution-design\//);
  assert.match(markup(row, false), /href="\/old"/);
});

test('10. headers carry the canvas copy and the record select starts at its title', () => {
  const html = props => renderToStaticMarkup(h(MemoryRouter, null, h(CycleHeader, { cycle: 'validate', ...props })));
  assert.match(html({}), /Validate · Is this worth building/);
  assert.match(html({}), /The cycle’s data at a glance; the tabs above move between modules/);
  const out = html({ record: true, active: 'problem-discovery', moduleName: 'Problem discovery', title: 'Example theme', sub: 'The stored description.', cards: [{ slug: 'problem-discovery', name: 'Problem discovery' }], action: { onClick() {}, label: 'Never on record' } });
  assert.match(out, /Validate · Problem discovery/); assert.match(out, /‹ Back to Problem discovery/);
  assert.match(out, /value="record" selected="">Example theme/); assert.doesNotMatch(out, /Never on record|aria-current="page"/);
});

function assertMapping(m) {
  assert.deepEqual(m.confirmView({ label: 'Remove', confirm: 'Really?' }), { title: 'Remove', body: 'Really?', cta: 'Remove' });
  assert.deepEqual(m.confirmView({ confirm: { title: 'Remove?', body: 'The row', cta: 'Yes' } }), { title: 'Remove?', body: 'The row', cta: 'Yes' });
  const source = record();
  assert.equal(m.recordFormFor(source.actions[2], source, null), null);
  assert.equal(m.recordFormFor(source.actions[2], source, { idOf: row => row.id })?.id, '7');
  const form = m.recordFormFor(source.actions[3], source);
  assert.equal(form.form.fields[0].name, 'proof');
  assert.equal(m.availableRecord(source, null).actions.some(a => a.key === 'edit'), false);
  assert.equal(m.availableRecord(source, { idOf: () => null }).actions.some(a => a.key === 'edit'), false);
  const body = m.recordActionBody({ body: { occurrence: 'm-3' }, multipart: true }, { proof: new Blob(['proof']) });
  assert.equal(body.get('occurrence'), 'm-3'); assert.ok(body.get('proof') instanceof Blob);
}
test('forms and confirms map the merged Worker contract in one place, with mutation/restoration probes', async () => {
  await mutationCheck(read('frontend/src/pages/cycles/recordModel.js'), 'pages/cycles/recordModel.js', assertMapping, [
    ["name: field.key ?? field.name", 'name: field.name'],
    ["const id = edit?.idOf(row);", 'const id = null;'],
    ['body: action.confirm', "body: ''"],
    ['...(action.body ?? {})', '...{}'],
  ]);
});

async function assertRecordRead(module) {
  const view = await mounted(defaultHandler, { View: module.default });
  try {
    assert.ok(view.fiber('RecordView'));
    assert.ok(view.requests.some(r => r.url.endsWith('/records/7?project=3')));
    assert.ok(!view.requests.some(r => /modules\/solution-design\?/.test(r.url)));
    assert.ok(!view.nodes().some(n => view.props(n)?.['data-testid'] === 'cycle-action'));
    await view.click('Mark complete');
    assert.ok(view.requests.some(r => r.url.endsWith('/actions/mark?project=3')));
    assert.ok(view.requests.filter(r => r.url.endsWith('/records/7?project=3')).length >= 2);
  } finally { await view.close(); }
}
test('record mode and write completion are mutation checked against the mounted route', async () => {
  await mutationCheck(read('frontend/src/pages/cycles/CycleRoute.jsx'), 'pages/cycles/CycleRoute.jsx', assertRecordRead, [
    ['record && known && validRecord && !!projectId && !!def', 'false'],
    ["if (record || !slug || !known || !projectId || !def)", "if (!slug || !known || !projectId || !def)"],
    ['reread: () => load(true)', 'reread: async () => {}'],
  ], true);
});

test('6. download writes use the signed download door without rereading; foreign URLs are refused', async () => {
  for (const [url, allowed] of [['/api/files/dl/signed-proof', true], ['https://example.invalid/proof', false]]) {
    const view = await mounted((path, options) => options.method === 'POST' ? response({ ok: true, open: { url } }) : defaultHandler(path, options));
    try {
      const before = view.requests.filter(r => r.url.includes('/records/7?project=3')).length;
      await view.run(() => view.fiber('RecordView').memoizedProps.onWrite({ key: 'open-minutes', kind: 'write', body: { occurrence: 'm-3' } }));
      await view.flush();
      const post = view.requests.find(r => r.url.includes('/actions/open-minutes'));
      assert.equal(JSON.parse(post.options.body).occurrence, 'm-3');
      assert.equal(view.requests.filter(r => r.url.includes('/records/7?project=3')).length, before);
      assert.deepEqual(view.opened, allowed ? [[url, '_blank', 'noopener,noreferrer']] : []);
      if (!allowed) assert.match(view.text(), /That file could not be opened/);
    } finally { await view.close(); }
  }
});

test('6. the record dropdown navigates Back with its venture', async () => {
  const view = await mounted(defaultHandler);
  try {
    const select = view.nodes().find(n => n.tagName === 'SELECT' && view.props(n)?.['aria-label'] === 'Build module');
    assert.equal(view.props(select).value, 'record');
    await view.run(() => view.props(select).onChange({ target: { value: 'solution-design' } }));
    assert.equal(view.out.location.pathname + view.out.location.search, '/build/solution-design?project_id=3');
  } finally { await view.close(); }
});

async function assertRowForm(View = CycleRoute) {
  const data = record();
  const proof = data.actions.find(action => action.key === 'proof');
  data.actions = data.actions.filter(action => action.key !== 'proof');
  data.main = [{ title: 'Meeting proof', action: proof, rows: [
    { a: 'First meeting', action: { key: 'proof', body: { occurrence: 'meeting-3' } } },
    { a: 'Second meeting', action: { key: 'proof', body: { occurrence: 'meeting-4' } } },
  ] }];
  const view = await mounted((url, opts) => opts.method === 'POST' ? response({ ok: true }) : response(data), { View });
  try {
    const buttons = view.nodes().filter(n => n.tagName === 'BUTTON' && view.props(n)?.children === 'Attach proof');
    assert.equal(buttons.length, 3);
    await view.run(() => view.props(buttons.at(-1)).onClick());
    const form = view.fiber('FormLightbox'); assert.ok(form);
    await view.run(() => form.memoizedProps.onSubmit({ proof: new File(['row proof'], 'proof.txt') }));
    const post = view.requests.find(r => r.url.includes('/actions/proof?project=3'));
    assert.equal(post.options.body.get('occurrence'), 'meeting-4');
    assert.equal(await post.options.body.get('proof').text(), 'row proof');
  } finally { await view.close(); }
}
test('6. a row form preserves its own target through history and submission; mutation checked', async () => {
  await assertRowForm();
  await mutationCheck(read('frontend/src/pages/cycles/CycleRoute.jsx'), 'pages/cycles/CycleRoute.jsx', module => assertRowForm(module.default), [
    ['editingPayload: { record: key, body: action.body }', 'editingPayload: null'],
  ], true);
});
