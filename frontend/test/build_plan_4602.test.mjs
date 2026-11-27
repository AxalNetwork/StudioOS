/**
 * D4602 (#4602, Build audit 3/4) — the three findings this slice closes:
 *
 *   5. the accepted item's Open went to its module, although the plan held the
 *      id of the row it landed in (`landedHref`);
 *   7. Progress could be searched and filtered on a desk and not on a phone,
 *      where the only control was Show more (one filter model, both widths);
 *   8. the Plan edit dialog's choices were `role="radio"` buttons with no
 *      arrow keys and no managed tab order (native radios).
 *
 * Mounted against the Worker's own plan, handoffs and links shapes through a
 * stubbed fetch, as `build_plan_progress_d1070.test.mjs` does. Every venture,
 * item and label is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_plan_4602.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import BuildPlan from '../src/pages/cycles/BuildPlan.jsx';
import { LANDED_RECORD, landedHref, opensRecord } from '../src/pages/cycles/buildPlanModel.js';
import { filterRows, progressRows } from '../src/pages/cycles/buildProgressModel.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/pages/cycles/${p}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const FEAT = '22222222-2222-4222-8222-222222222222';
const RISK = '33333333-3333-4333-8333-333333333333';
const MUST = '11111111-1111-4111-8111-111111111111';
const ROAD = '44444444-4444-4444-8444-444444444444';
const STEP = '77777777-7777-4777-8777-777777777777';
const TEST = '88888888-8888-4888-8888-888888888888';

const accepted = (uid, kind, title, table, id, payload = {}) => ({
  uid, kind, status: 'accepted', payload: { title, ...payload }, evidence: [],
  decided_at: '2026-10-12 15:00:00', landed_table: table, landed_id: id, marker: `VB-${uid.slice(0, 4).toUpperCase()}`,
});

const PLAN = () => ({
  plan: { uid: 'plan-uid', scope: 'venture', status: 'open', prepared_at: '2026-10-12 14:05:00' },
  verdict: { id: 9, decision: 'proceed', state: 'given', decided_at: '2026-10-12 09:00:00', evidence_count: 6 },
  brief: null,
  modules: {
    'solution-design': [
      accepted(FEAT, 'feature', 'Live ETA panel', 'mvp_features', '6'),
      accepted(RISK, 'risk', 'Buyers fear migration', 'venture_risks', '2'),
      { uid: 'proposed-one', kind: 'feature', status: 'proposed', payload: { title: 'Driver app', description: 'A phone app.', added_value: 'Medium', effort: 'M' }, evidence: [] },
    ],
    'prototype-mvp': [
      accepted(MUST, 'must-have', 'One-day setup wizard', 'mvp_features', '5'),
      accepted(TEST, 'prototype-test', 'Setup in a day', 'hypothesis_experiments', '4'),
    ],
    'product-roadmap': [accepted(ROAD, 'roadmap', 'Carrier integrations', 'roadmap_okrs', '9', { lane: 'Later' })],
    'company-creation': [accepted(STEP, 'formation-step', 'Incorporate', 'formation_steps', '3')],
    'operating-systems': [],
    'founding-team': [],
  },
});

function handler() {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    if (/\/cycles\/build\/plan\/handoffs\?/.test(url) && method === 'GET') return response({ handoffs: [] });
    if (/\/cycles\/build\/plan\/links\?/.test(url)) return response({ links: [] });
    if (/\/cycles\/build\/plan\/states\?/.test(url)) return response({ states: [] });
    if (/\/cycles\/build\/plan\/word\?/.test(url) && method === 'GET') return response({ wording: null });
    if (/\/cycles\/build\/plan\/since\?/.test(url)) return response({ plan: 'plan-uid', status: 'open', changed: false, new: 0, contradicting: 0 });
    if (/\/cycles\/build\/plan\?/.test(url) && method === 'GET') return response(PLAN());
    if (/\/connectors$/.test(url)) return response({ ok: true, items: [] });
    if (url.includes('/ai/me/spend')) return response({ recorded: true, by_task_recorded: true, by_task: [] });
    if (url.includes('/cycles/validate/overview')) return response({ cards: [] });
    return response({});
  };
}

async function mounted({ props = {}, phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const handle = handler();
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(BuildPlan, { tab: 'progress', projectId: 3, search: '?project_id=3', cards: [], role: 'founder', phone, ...props }))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  const all = (id) => nodes().filter((n) => props_(n)['data-testid'] === id);
  return {
    has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)),
    texts: (id) => all(id).map(text), count: (id) => all(id).length,
    node: (id) => byId(id), propsOfNode: props_,
    tag: (id) => byId(id)?.tagName || null,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value } }); }); await flush(); },
    pick: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value: props_(n).value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ───────────────────────────────── finding 5: the landed record's own address

test('an accepted item opens the row it landed in, and the module only where no record route reads that table', () => {
  // Mutation checked: dropping the `modules.includes(module)` guard → the
  // cross-module assert resolves to another table's row; dropping `landedId`'s
  // check → `../x` and `0` reach the URL; `step-` left off → the formation
  // step's address is one `filingOf` does not answer.
  const item = (table, id) => ({ landed_table: table, landed_id: id });
  assert.equal(landedHref(item('mvp_features', '6'), 'solution-design', '?project_id=3'), '/build/solution-design/6?project_id=3');
  assert.equal(landedHref(item('mvp_features', '5'), 'prototype-mvp', '?project_id=3'), '/build/prototype-mvp/5?project_id=3');
  assert.equal(landedHref(item('roadmap_okrs', '9'), 'product-roadmap', ''), '/build/product-roadmap/9');
  // The typed id convention `services/records/build.ts` writes and reads.
  assert.equal(landedHref(item('formation_steps', '3'), 'company-creation', ''), '/build/company-creation/step-3');

  // No record reader for these two tables, so the module, which is honest.
  assert.equal(landedHref(item('venture_risks', '2'), 'solution-design', '?project_id=3'), '/build/solution-design?project_id=3');
  assert.equal(landedHref(item('hypothesis_experiments', '4'), 'prototype-mvp', ''), '/build/prototype-mvp');
  assert.equal(opensRecord(item('venture_risks', '2'), 'solution-design'), false);
  assert.equal(opensRecord(item('mvp_features', '6'), 'solution-design'), true);

  // A table addressable under one module is not addressable under another.
  assert.equal(landedHref(item('mvp_features', '6'), 'product-roadmap', ''), '/build/product-roadmap');
  // Nothing that is not a positive integer reaches a URL.
  for (const bad of ['0', '-1', '../x', '3; DROP', '', null, undefined, '1e3', '01x']) {
    assert.equal(landedHref(item('mvp_features', bad), 'solution-design', ''), '/build/solution-design', `rejected: ${String(bad)}`);
  }
  // An item that landed nowhere (a door) keeps the module.
  assert.equal(landedHref({}, 'operating-systems', ''), '/build/operating-systems');
  // Every table the resolver claims names at least one module, and every
  // module it names is one of Build's own.
  const slugs = new Set(['solution-design', 'prototype-mvp', 'product-roadmap', 'company-creation']);
  for (const [table, where] of Object.entries(LANDED_RECORD)) {
    assert.ok(where.modules.length >= 1, table);
    for (const m of where.modules) assert.ok(slugs.has(m), `${table}: ${m}`);
  }
});

test("the done row's Open says what it opens, and reaches the record", async () => {
  // Mutation checked: the label left as a bare "Open" → the two label asserts
  // fail and a founder cannot tell a record link from a module link.
  const r = await mounted({ props: { tab: 'plan' } });
  try {
    assert.equal(r.props(`plan-done-open-${FEAT}`).href, '/build/solution-design/6?project_id=3');
    assert.equal(r.textOf(`plan-done-open-${FEAT}`), 'Open the record');
    assert.equal(r.props(`plan-done-open-${FEAT}`).title, "Opens this item's record in Solution design");
    // A risk has no record page, so it opens its module and says so.
    assert.equal(r.props(`plan-done-open-${RISK}`).href, '/build/solution-design?project_id=3');
    assert.equal(r.textOf(`plan-done-open-${RISK}`), 'Open the module');
    assert.equal(r.props(`plan-done-open-${RISK}`).title, 'Opens Solution design');
    assert.equal(r.props(`plan-done-open-${STEP}`).href, '/build/company-creation/step-3?project_id=3');
  } finally { await r.close(); }
});

// ───────────────────────────── finding 7: one filter model, desktop and phone

test('Progress is searched and filtered on a phone, by the same model as the table', async () => {
  // Mutation checked: the phone branch back to `filterRows(rows)` → the phone
  // search changes nothing and the count assert fails; the controls dropped
  // from the phone → the `has` assert fails.
  const rows = progressRows(PLAN(), [], []);
  assert.equal(rows.length, 6, 'six accepted items');

  const desk = await mounted();
  try {
    assert.ok(desk.has('plan-progress-controls') && !desk.has('plan-progress-controls-phone'));
    assert.equal(desk.count('plan-progress-row'), 6);
    await desk.change('plan-progress-search', 'setup');
    assert.equal(desk.count('plan-progress-row'), 2);
    assert.deepEqual([desk.textOf(`plan-progress-open-${MUST}`), desk.textOf(`plan-progress-open-${TEST}`)], ['One-day setup wizard', 'Setup in a day']);
    await desk.change('plan-progress-filter-module', 'product-roadmap');
    assert.equal(desk.count('plan-progress-row'), 0, 'the two filters are an AND, as they always were');
    assert.equal(desk.textOf('plan-progress-none'), 'No item matches the search and filters.');
  } finally { await desk.close(); }

  const phone = await mounted({ phone: true });
  try {
    assert.ok(phone.has('plan-progress-controls-phone') && !phone.has('plan-progress-table'));
    assert.equal(phone.count('plan-progress-card'), 5, 'five at a time, as before');
    await phone.click('plan-progress-more');
    assert.equal(phone.count('plan-progress-card'), 6);
    // The same search selects the same items at this width.
    await phone.change('plan-progress-search', 'setup');
    assert.equal(phone.count('plan-progress-card'), 2);
    assert.match(phone.textOf('plan-progress-phone'), /One-day setup wizard/);
    // And the Show more window went back to five, so the cards shown are the
    // first of the narrowed list, never the eleventh of a two-item result.
    await phone.change('plan-progress-search', '');
    assert.equal(phone.count('plan-progress-card'), 5, 'the window reset with the filter');
    // Step 2 (BD14m A): the module filter is set in the Filters sheet, applied by Show.
    await phone.click('plan-progress-filters-open');
    await phone.pick('plan-progress-f-module-company-creation');
    assert.equal(phone.textOf('plan-progress-filters-show'), 'Show 1 item');
    await phone.click('plan-progress-filters-show');
    assert.equal(phone.count('plan-progress-card'), 1);
    await phone.change('plan-progress-search', 'nothing matches this');
    assert.equal(phone.count('plan-progress-card'), 0);
    assert.equal(phone.textOf('plan-progress-phone-none'), 'No accepted item matches these filters.');
  } finally { await phone.close(); }
});

test('the same filter inputs select the same items at either width', () => {
  // The model is one function, so this is what "equivalent" means: the page
  // holds the state and both branches pass it to the same `filterRows`.
  const rows = progressRows(PLAN(), [], []);
  for (const f of [
    { q: 'setup', module: '', stage: '', tool: '' },
    { q: '', module: 'product-roadmap', stage: '', tool: '' },
    { q: 'carrier', module: 'product-roadmap', stage: '', tool: '' },
    { q: '', module: '', stage: 'accepted', tool: '' },
  ]) {
    for (const sort of ['last', 'name', 'module']) {
      assert.deepEqual(filterRows(rows, f, sort).map((r) => r.uid), filterRows(rows, f, sort).map((r) => r.uid), JSON.stringify(f));
    }
  }
  const page = src('BuildPlanProgress.jsx');
  assert.match(page, /useProgressFilter\(\)/, 'the page owns the filter state');
  assert.match(page, /filterRows\(rows, filter\.f, filter\.sort\)/, 'the phone list reads it');
  assert.match(page, /<ItemsTable rows=\{rows\} onOpen=\{setOpen\} state=\{filter\} \/>/, 'and so does the table');
  assert.doesNotMatch(page, /PhoneItems rows=\{filterRows\(rows\)\}/, 'the phone list no longer filters with the defaults');
});

// ──────────────────────────── finding 8: the edit dialog's choices are radios

test("the edit dialog's choices are native radios: one tab stop, a group label, arrows the browser drives", async () => {
  // Mutation checked: back to `role="radio"` buttons → the tagName and the
  // `no ARIA radio` asserts fail; `sr-only` swapped for `hidden` → the input
  // leaves the accessible tree and the keyboard pattern goes with it.
  const r = await mounted({ props: { tab: 'plan' } });
  try {
    await r.click('plan-item-edit-proposed-one');
    assert.equal(r.tag('plan-edit-added_value-High'), 'INPUT');
    const high = r.props('plan-edit-added_value-High');
    const medium = r.props('plan-edit-added_value-Medium');
    assert.equal(high.type, 'radio');
    assert.equal(high.name, medium.name, 'one group, so one tab stop and the arrows move within it');
    assert.equal(high.value, 'High');
    assert.notEqual(high.name, r.props('plan-edit-effort-M').name, 'Impact and Effort are separate groups');
    assert.match(String(high.className), /\bpeer\b/, 'the label draws the chip from the input it follows');
    assert.match(String(high.className), /sr-only/, 'kept in the accessible tree, never display:none');
    assert.equal(high.checked, false);
    assert.equal(r.props('plan-edit-added_value-Medium').checked, true, 'the proposal\'s own value is the one selected');
    await r.pick('plan-edit-added_value-High');
    assert.equal(r.props('plan-edit-added_value-High').checked, true);
    assert.equal(r.props('plan-edit-added_value-Medium').checked, false, 'a radio group holds one answer');

    // The group's accessible name is a legend, and no hand-rolled ARIA is left.
    const dialog = r.textOf('plan-edit');
    assert.match(dialog, /Impact/);
    const file = src('BuildPlanCards.jsx');
    // The code, not the docblock that records what it replaced.
    const code = file.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /role="radiogroup"|role="radio"|aria-checked/, 'no ARIA radio pattern is hand-rolled any more');
    assert.match(code, /<fieldset[\s\S]{0,200}<legend/, 'the group names itself with a legend');
    assert.match(code, /type="radio"/);
  } finally { await r.close(); }
});
