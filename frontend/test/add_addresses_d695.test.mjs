/**
 * D695 PR 1, second part (#1656): every Add has an address. Each form has a
 * `key` and a `cta`; `initialValues` and `validate` read the canvas's T, CH
 * and CK kinds and keep every legacy type's rules; each cycle has a
 * `/:slug/new` route beside its module page, Customer research's sends the
 * founder to Record a session; and the module page's Add link passes its
 * entry's `state`, so a `/new` page knows the page it opened over.
 * CycleRoute's `adding` mount is #1656's later part, after #1655's PR 2.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { Route, Routes, matchRoutes, useLocation } from 'react-router-dom';
import { EDITS, FORMS, editFor, formFor, formsFor, initialValues, kindOf, shownWith, toCents, toScore, validate } from '../src/pages/cycles/forms.js';
import { MODULES } from '../src/pages/cycles/modules.js';
import { isCyclePath } from '../src/pages/cycles/cyclePaths.js';
import { readRoutesSource } from './_routesSource.mjs';
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

const formsPath = 'pages/cycles/forms.js';
const formsSource = readFileSync(new URL('../src/' + formsPath, import.meta.url), 'utf8');
const pagePath = 'pages/cycles/CycleModulePage.jsx';
const pageSource = readFileSync(new URL('../src/' + pagePath, import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const ADD_KEYS = {
  raise: { 'fundraising-readiness': ['readiness'], 'investor-narrative': ['narrative-version'] },
  grow: {
    'product-improvement': ['feedback'], distribution: ['channel'], 'partner-network': ['partner'],
    'market-expansion': ['market'], 'durable-company-building': ['obligation'],
  },
  build: { 'solution-design': ['feature', 'risk'], 'prototype-mvp': ['must-have'], 'company-creation': ['formation-step'] },
};
const EDIT_KEYS = {
  grow: {
    'product-improvement': 'edit-feedback', distribution: 'edit-channel', 'partner-network': 'edit-partner',
    'market-expansion': 'edit-market', 'durable-company-building': 'edit-obligation',
  },
  build: { 'solution-design': 'edit-feature', 'prototype-mvp': 'edit-must-have', 'company-creation': 'edit-formation-step', 'operating-systems': 'edit-system' },
};
const mapTable = (table, fn) => Object.fromEntries(Object.entries(table).map(([cycle, bySlug]) => [cycle, Object.fromEntries(Object.entries(bySlug).map(([slug, v]) => [slug, fn(v)]))]));
const allForms = (m) => [
  ...Object.values(m.FORMS).flatMap((bySlug) => Object.values(bySlug).flat()),
  ...Object.values(m.EDITS).flatMap((bySlug) => Object.values(bySlug)),
];

// ---------- A. Keys and calls to action -------------------------------------

function assertKeys(m) {
  assert.deepEqual(mapTable(m.FORMS, (forms) => forms.map((f) => f.key)), ADD_KEYS);
  assert.deepEqual(mapTable(m.EDITS, (f) => f.key), EDIT_KEYS);
  for (const [cycle, bySlug] of Object.entries(m.FORMS)) {
    for (const [slug, forms] of Object.entries(bySlug)) {
      assert.ok(MODULES[cycle].some((mod) => mod.slug === slug), `${cycle}/${slug} is a module`);
      for (const f of forms) {
        assert.match(f.key, KEY, `${cycle}/${slug}: ${f.key}`);
        assert.equal(encodeURIComponent(f.key), f.key, 'a key goes in `?form=` as it is');
        assert.equal(f.cta, f.button, `${cycle}/${slug} ${f.key}: an Add's CTA is its button`);
      }
      // `?form=<key>` names one form of the module's own: Add and Edit keys never collide.
      const keys = [...forms.map((f) => f.key), m.editFor(cycle, slug)?.key].filter(Boolean);
      assert.equal(new Set(keys).size, keys.length, `${cycle}/${slug} keys are unique`);
    }
  }
  for (const [cycle, bySlug] of Object.entries(m.EDITS)) {
    for (const [slug, f] of Object.entries(bySlug)) {
      assert.ok(MODULES[cycle].some((mod) => mod.slug === slug), `${cycle}/${slug} is a module`);
      assert.match(f.key, /^edit-[a-z0-9-]+$/);
      assert.equal(f.cta, 'Save', `${cycle}/${slug}: an Edit saves with Save`);
    }
  }
  // The row buttons are unchanged: Edit, Mark, Choose connector.
  assert.equal(m.editFor('grow', 'distribution').button, 'Edit');
  assert.equal(m.editFor('build', 'solution-design').button, 'Mark');
  assert.equal(m.editFor('build', 'operating-systems').button, 'Choose connector');
  assert.deepEqual(m.formsFor('build', 'solution-design').map((f) => f.key), ['feature', 'risk']);
  assert.equal(m.formFor('build', 'solution-design').key, 'feature', '`/new` with no `?form=` opens the first');
}

test('every Add and Edit form has a key unique in its module and its own call to action', async () => {
  assertKeys({ FORMS, EDITS, editFor, formFor, formsFor });
  await mutationCheck(formsSource, formsPath, assertKeys, [
    ["key: 'channel', cta: 'Add channel'", "key: 'channel', cta: 'Add a channel'"],
    ["key: 'risk', cta", "key: 'feature', cta"],
    ["key: 'narrative-version'", "key: 'narrative_version'"],
    ["const EDIT = { button: 'Edit', cta: 'Save' };", "const EDIT = { button: 'Edit' };"],
    ["key: 'edit-system', cta: 'Save'", "key: 'edit-system', cta: 'Choose connector'"],
    ["  key: 'edit-partner',\n", ''],
  ]);
});

// ---------- B and C. The canvas's kinds, and today's types unchanged --------

const canvas = () => ({
  fields: [
    { name: 'title', kind: 'T', k: 'Theme', def: 'Onboarding', max: 20 },
    { name: 'stage', kind: 'CH', k: 'Stage', opts: [{ t: 'Idea' }, { t: 'Build' }, { t: 'Live' }], def: 1 },
    { name: 'tier', kind: 'CH', k: 'Tier', opts: [['Gold', '', false], ['Silver', '', true]] },
    { name: 'count', kind: 'CH', k: 'Count', opts: ['1', '2', '3'], def: 2 },
    { name: 'quotes', kind: 'CK', k: 'Quotes', opts: [{ value: 'q1', label: 'One', checked: true }, { value: 'q2', label: 'Two' }, { value: 'q3', label: 'Three', on: true }] },
    { name: 'pair', kind: 'T', k: 'Owner · deadline', parts: [{ name: 'owner', kind: 'T', k: 'Owner' }, { name: 'due', kind: 'T', k: 'Deadline', input: 'date', required: true }] },
    { name: 'amount', kind: 'T', k: 'Amount', input: 'money', required: true, when: { name: 'stage', value: 'Live' } },
    { name: 'score', kind: 'T', k: 'Score', input: 'score' },
    { name: 'why', kind: 'T', k: 'Why', required: true, when: (v) => v.stage === 'Idea' },
    { name: 'source', kind: 'T', k: 'Source', required: true, when: { name: 'quotes', value: 'q2' } },
  ],
});

/** forms.js's `initialValues` and `validate` before D695: what every legacy form must still get. */
function legacyInitial(form, current = null) {
  const base = Object.fromEntries((form?.fields || []).map((f) => [f.name, f.initial ?? '']));
  if (!current) return base;
  for (const f of form?.fields || []) {
    if (Object.prototype.hasOwnProperty.call(current, f.name)) base[f.name] = current[f.name] == null ? '' : String(current[f.name]);
  }
  return base;
}
function legacyValidate(form, values) {
  const errors = {};
  for (const f of form?.fields || []) {
    const raw = values?.[f.name];
    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (f.required && (text == null || text === '')) { errors[f.name] = `${f.label} is required.`; continue; }
    if (typeof text === 'string' && f.max && text.length > f.max) errors[f.name] = `${f.label} is at most ${f.max} characters.`;
    if (f.type === 'money' && Number.isNaN(toCents(raw))) errors[f.name] = 'Type an amount in US dollars, 0 or more.';
    if (f.type === 'score' && Number.isNaN(toScore(raw))) errors[f.name] = 'A score is a whole number from 0 to 10.';
    if (f.type === 'date' && text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) errors[f.name] = 'Pick a date.';
    if (f.type === 'select' && text && !(f.options || []).some((o) => o.value === text)) errors[f.name] = `Pick one of the choices for ${f.label.toLowerCase()}.`;
  }
  return { ...errors, ...(typeof form?.check === 'function' ? form.check(values || {}) : {}) };
}
/** Value sets that reach every legacy rule: empty, too long, a bad number, a bad date, an unknown choice, a row. */
function legacyCases(form) {
  const fields = form.fields || [];
  const all = (fn) => Object.fromEntries(fields.map((f) => [f.name, fn(f)]));
  return [
    {},
    all(() => ''),
    all(() => '   '),
    all((f) => 'x'.repeat((f.max || 10) + 1)),
    all((f) => (f.type === 'money' ? '-4' : f.type === 'score' ? '11' : f.type === 'date' ? '17/10/2026' : f.type === 'select' ? 'invented' : 'ok')),
    all((f) => (f.type === 'money' ? '12.50' : f.type === 'score' ? '7' : f.type === 'date' ? '2026-10-17' : f.type === 'select' ? f.options?.[0]?.value ?? '' : 'Synthetic')),
  ];
}

function assertKinds(m) {
  const form = canvas();
  assert.equal(m.kindOf({ type: 'select' }), 'CH');
  assert.equal(m.kindOf({ type: 'money' }), 'T');
  assert.equal(m.kindOf({ kind: 'CK', type: 'select' }), 'CK');
  const start = m.initialValues(form);
  assert.deepEqual(start, {
    title: 'Onboarding', stage: 'Build', tier: 'Silver', count: '2', quotes: ['q1', 'q3'],
    owner: '', due: '', amount: '', score: '', why: '', source: '',
  }, 'def, a CH def as an index, a checked option, a def that is a value, CK checked rows, parts in their place');
  assert.deepEqual(m.initialValues(form, { title: 'Pricing', stage: null, quotes: ['q2', 7], owner: 12, extra: 'x' }), {
    ...start, title: 'Pricing', stage: '', quotes: ['q2', '7'], owner: '12',
  }, 'a row\'s values win, a CK keeps its array, a field the form lacks is not added');

  assert.equal(m.shownWith(form.fields[6], start), false);
  assert.equal(m.shownWith(form.fields[6], { ...start, stage: 'Live' }), true);
  assert.equal(m.shownWith(form.fields[9], { ...start, quotes: ['q2'] }), true, 'a `when` on a CK field looks in its array');
  assert.equal(m.shownWith(form.fields[8], { stage: 'Idea' }), true);
  assert.equal(m.shownWith({ name: 'plain' }, {}), true);

  assert.deepEqual(m.validate(form, start), { due: 'Deadline is required.' }, 'hidden fields are not required; a part is');
  const ok = { ...start, due: '2026-10-17' };
  assert.deepEqual(m.validate(form, ok), {});
  assert.deepEqual(m.validate(form, { ...ok, stage: 'Live' }), { amount: 'Amount is required.' });
  assert.deepEqual(m.validate(form, { ...ok, stage: 'Live', amount: '-1' }), { amount: 'Type an amount in US dollars, 0 or more.' });
  assert.deepEqual(m.validate(form, { ...ok, stage: 'Idea' }), { why: 'Why is required.' });
  assert.deepEqual(m.validate(form, { ...ok, stage: 'Retired' }), { stage: 'Pick one of the choices for stage.' });
  assert.deepEqual(m.validate(form, { ...ok, tier: 'Bronze' }), { tier: 'Pick one of the choices for tier.' });
  assert.deepEqual(m.validate(form, { ...ok, quotes: ['q1', 'q9'] }), { quotes: 'Pick the recorded choices for quotes.' });
  assert.deepEqual(m.validate(form, { ...ok, quotes: ['q2'] }), { source: 'Source is required.' });
  assert.deepEqual(m.validate(form, { ...ok, due: 'tomorrow' }), { due: 'Pick a date.' });
  assert.deepEqual(m.validate(form, { ...ok, score: '11' }), { score: 'A score is a whole number from 0 to 10.' });
  assert.deepEqual(m.validate(form, { ...ok, title: 'x'.repeat(21) }), { title: 'Theme is at most 20 characters.' });
  const evidence = { fields: [{ name: 'evidence', kind: 'CK', k: 'Evidence', required: true, opts: [{ value: 'a', label: 'A' }] }], check: (v) => (v.evidence.length > 1 ? { evidence: 'One only.' } : {}) };
  assert.deepEqual(m.validate(evidence, { evidence: [] }), { evidence: 'Evidence is required.' });
  assert.deepEqual(m.validate(evidence, { evidence: 'a' }), { evidence: 'Evidence is required.' }, 'a CK value that is not a list picks nothing');
  assert.deepEqual(m.validate(evidence, { evidence: ['a'] }), {});
  assert.deepEqual(m.validate(evidence, { evidence: ['a', 'a'] }), { evidence: 'One only.' }, "the form's own check still runs");

  for (const f of allForms(m)) {
    assert.deepEqual(m.initialValues(f), legacyInitial(f), `${f.key}: first values`);
    for (const values of legacyCases(f)) {
      assert.deepEqual(m.initialValues(f, values), legacyInitial(f, values), `${f.key}: a row's values`);
      assert.deepEqual(m.validate(f, values), legacyValidate(f, values), `${f.key}: ${JSON.stringify(values)}`);
    }
  }
}

test('initialValues and validate read T, CH and CK fields, parts and `when`, and keep every legacy form\'s rules', async () => {
  assertKinds({ FORMS, EDITS, initialValues, validate, kindOf, shownWith });
  await mutationCheck(formsSource, formsPath, assertKinds, [
    ["f?.type === 'select' ? 'CH' : 'T'", "f?.type === 'select' ? 'T' : 'T'"],
    ['Array.isArray(f?.parts) ? leafFields(f.parts) : [f]', '[f]'],
    ['if (!shownWith(f, values)) continue;', ''],
    ["return Array.isArray(v) ? v.includes(field.when.value) : v === field.when.value;", 'return v === field.when.value;'],
    ['v = choices[v]?.value;', 'v = String(v);'],
    ['if (v == null) v = choices.find((o) => o.checked)?.value;', ''],
    ['checked: !!(o?.checked ?? o?.on)', 'checked: !!o?.checked'],
    ['Array.isArray(v) ? v.map(String) : choicesOf(f)', 'Array.isArray(v) ? v : choicesOf(f)'],
    ['if (f.required && picked.length === 0)', 'if (false)'],
    ['const picked = Array.isArray(raw) ? raw : [];', 'const picked = [].concat(raw ?? []);'],
    ["if (kind === 'CH' && text", "if (f.type === 'select' && text"],
    ["const input = inputOf(f);", 'const input = f.type;'],
    ['const labelOf = (f) => f?.label ?? f?.k ?? f?.name;', 'const labelOf = (f) => f?.label ?? f?.name;'],
    ["let v = f.initial ?? f.def;", 'let v = f.initial;'],
  ]);
});

// ---------- D. The `/new` addresses ------------------------------------------

const GUARDS = {
  validate: "labRoles(['admin', 'founder'])",
  build: "['admin', 'founder']",
  grow: "['admin', 'founder']",
  raise: "labRoles(['admin', 'founder'])",
};
const declared = () => [...readRoutesSource().matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');
const bestMatch = (url) => matchRoutes(declared().map((path) => ({ path })), url)?.at(-1)?.route.path ?? null;

test('each cycle has a `/:slug/new` route beside its module page, with the same guard', () => {
  assert.deepEqual(Object.keys(GUARDS).sort(), Object.keys(MODULES).sort());
  for (const [cycle, roles] of Object.entries(GUARDS)) {
    const page = `<Route path="/${cycle}/:slug" element={guard(${roles}, <CycleRoute cycle="${cycle}" />)} />`;
    const adding = `<Route path="/${cycle}/:slug/new" element={guard(${roles}, <CycleRoute cycle="${cycle}" adding />)} />`;
    assert.ok(app.includes(page), `${cycle}'s module page`);
    assert.equal(app.split(adding).length, 2, `${cycle}'s /new route, once`);
    const between = app.slice(app.indexOf(page) + page.length, app.indexOf(adding));
    assert.ok(app.indexOf(page) < app.indexOf(adding) && between.split('<Route ').length <= 3, `${cycle}'s /new sits beside its module page`);
  }
  const redirect = `<Route path="/validate/customer-research/new" element={guard(${GUARDS.validate}, <HistoryRedirect to="/validate/record" />)} />`;
  assert.equal(app.split(redirect).length, 2, "Customer research's Add is Record a session");
  assert.ok(app.indexOf(redirect) < app.indexOf('<Route path="/validate/:slug/new"'));
});

test('every module\'s `/new` resolves to its cycle\'s adding route, and Customer research\'s to Record a session', () => {
  for (const [cycle, modules] of Object.entries(MODULES)) {
    for (const { slug } of modules) {
      const url = `/${cycle}/${slug}/new`;
      const want = url === '/validate/customer-research/new' ? url : `/${cycle}/:slug/new`;
      assert.equal(bestMatch(url), want, url);
      assert.equal(isCyclePath(url), true, `${url} has the cycle gutter`);
    }
    assert.equal(bestMatch(`/${cycle}/${modules[0].slug}`), `/${cycle}/:slug`, 'the module page is unchanged');
  }
  // The forms' own modules, each `?form=` key included, reach the adding route.
  for (const [cycle, bySlug] of Object.entries(FORMS)) {
    for (const slug of Object.keys(bySlug)) assert.equal(bestMatch(`/${cycle}/${slug}/new`), `/${cycle}/:slug/new`);
  }
});

// ---------- E. The Add link passes its entry's state -------------------------

async function assertAddState(m) {
  const seen = [];
  function Probe() { const location = useLocation(); seen.push({ path: location.pathname + location.search, state: location.state }); return h('p', null, 'adding'); }
  const under = { under: '/grow/distribution?q=paid' };
  const page = (add) => h(Routes, null,
    h(Route, { path: '/', element: h(m.RecordsTable, { title: 'Channels', records: { cols: [], rows: [], total: 0 }, add }) }),
    h(Route, { path: '/grow/distribution/new', element: h(Probe) }));
  const click = { button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };

  const view = await mountForm(page([{ text: 'Add channel', href: '/grow/distribution/new?form=channel', state: under }]));
  try {
    const link = view.by('records-add');
    assert.ok(link, 'the Add is a link');
    assert.equal(propsOf(link).href, '/grow/distribution/new?form=channel');
    await act(async () => propsOf(link).onClick({ ...click }));
    assert.deepEqual(seen.at(-1), { path: '/grow/distribution/new?form=channel', state: under }, 'the /new page reads state.under');
  } finally { await view.unmount(); }

  // An entry with no state opens /new with none; one with onOpen still opens its dialog in place.
  const plain = await mountForm(page({ text: 'Add channel', href: '/grow/distribution/new' }));
  try {
    await act(async () => propsOf(plain.by('records-add')).onClick({ ...click }));
    assert.deepEqual(seen.at(-1), { path: '/grow/distribution/new', state: null });
  } finally { await plain.unmount(); }
  let opened = 0;
  const count = seen.length;
  const dialog = await mountForm(page({ text: 'Add channel', href: '/grow/distribution/new', state: under, onOpen() { opened += 1; } }));
  try {
    await act(async () => propsOf(dialog.by('records-add')).onClick({ ...click }));
    assert.equal(opened, 1);
    assert.equal(seen.length, count, 'onOpen keeps the page');
  } finally { await dialog.unmount(); }
}

test("the module page's Add link carries its entry's state to the `/new` address", async () => {
  await assertAddState(await import('../src/pages/cycles/CycleModulePage.jsx'));
  await mutationCheck(pageSource, pagePath, assertAddState, [
    [' state={addBtn.state}', ''],
    [' state={addBtn.state}', ' state={undefined}'],
    ['if (isPlainClick(e)) { e.preventDefault(); addBtn.onOpen(); }', 'addBtn.onOpen();'],
  ]);
});
