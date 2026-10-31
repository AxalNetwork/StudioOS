/**
 * D969 (#3352): Grow's forms read their chip sets from the Worker's
 * form-options, as Raise's do (D695 PR 2).
 *
 * Each form is mounted in the real `FormLightbox` with a write table whose
 * `formOptions` answers as `cycle_records.ts` would. Test 1: Log feedback,
 * Enter a KPI, Open a role and Add market fill their chips from the read, and
 * the other three read nothing. Test 2: a connected Stripe is a KPI source,
 * and choosing it saves nothing. Test 3: Edit feedback offers theme and
 * roadmap chips, keeps a stored value the read does not list, and posts
 * `roadmap_item_ref`. Test 4: a failed read says so with Try again. Tests 1 to
 * 3 run on `forms.js` and test 4 on `FormLightbox.jsx`, on mutants that must
 * fail, and again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

const P = 7;
const formsPath = 'pages/cycles/forms.js';
const formsSource = readFileSync(new URL('../src/' + formsPath, import.meta.url), 'utf8');
const boxPath = 'pages/cycles/FormLightbox.jsx';
const boxSource = readFileSync(new URL('../src/' + boxPath, import.meta.url), 'utf8');

/** Each Grow module's form-options, in the shapes `services/records/grow.ts` returns. */
const REPLIES = {
  'product-improvement': {
    sources: [{ value: 'customer', label: 'Customer' }],
    themes: [{ value: 'Exports', label: 'Exports', count: 3 }, { value: 'Onboarding', label: 'Onboarding', count: 1 }],
    roadmap_items: [{ value: '12', label: 'CSV export' }, { value: '9', label: 'Guided setup' }],
  },
  'revenue-and-traction': {
    kpis: [
      { value: 'mrr', label: 'MRR', enterable: true, disabled: false, reason: null },
      { value: 'runway', label: 'Runway', enterable: false, disabled: true, reason: 'Worked out from cash and burn.' },
      { value: 'kpi:ab12', label: 'Pilots', enterable: true, disabled: false, reason: null },
      { value: 'custom', label: 'Custom', enterable: true, disabled: false, reason: null },
    ],
    sources: [
      { value: 'manual', label: 'Entered by hand', disabled: false, reason: null },
      { value: 'stripe', label: 'Stripe', disabled: false, state: 'connected', reason: 'Connected: its figures override a hand entry.' },
      { value: 'bank', label: 'Bank', disabled: true, reason: 'No bank connector writes KPIs yet.' },
    ],
  },
  'team-expansion': { teams: [{ value: 'Engineering', label: 'Engineering' }, { value: 'Design', label: 'Design' }], types: [] },
  'market-expansion': { geographies: [{ value: 'PT', label: 'Portugal' }, { value: 'ES', label: 'Spain' }] },
};

function writeTable(replies, fail = 0) {
  const calls = [];
  let failures = fail;
  const grow = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { uid: 'u1', id: 1 }; } });
  const formOptions = async (cycle, projectId, slug) => {
    calls.push(['formOptions', cycle, projectId, slug]);
    if (failures > 0) { failures -= 1; throw new Error('The choices could not be read.'); }
    return replies[slug] ?? {};
  };
  return { calls, w: { grow, formOptions } };
}

async function mount(Box, form, { slug, current = null, id = null, replies = REPLIES, fail = 0 } = {}) {
  const { calls, w } = writeTable(replies, fail);
  const onSubmit = (v) => (id == null ? form.submit(w, P, v) : form.submit(w, P, id, v));
  const ui = await mountForm(h(Box, {
    form, current, cycle: 'grow', slug, onSubmit, onClose() {},
    loadOptions: form.loadOptions ? () => form.loadOptions(w, P, id) : null,
  }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const radios = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio');
  const values = (name) => radios(name).map((n) => propsOf(n).value);
  const checked = (name) => radios(name).filter((n) => propsOf(n).checked).map((n) => propsOf(n).value);
  const typeIn = async (name, value) => {
    const node = inputs().find((n) => propsOf(n).name === name);
    assert.ok(node, name);
    await act(async () => propsOf(node).onChange({ target: { value } }));
  };
  return { ...ui, calls, radios, values, checked, typeIn };
}
const reads = (calls) => calls.filter((c) => c[0] === 'formOptions');
const writes = (calls) => calls.filter((c) => c[0] !== 'formOptions');

// ---------- Test 1: each Grow form's chips --------------------------------------

async function assertChips(m) {
  const Box = (await import('../src/pages/cycles/FormLightbox.jsx')).default;
  const form = (slug) => m.FORMS.grow[slug][0];

  // Log feedback: themes, then New theme; None yet, then the roadmap items.
  const fb = await mount(Box, form('product-improvement'), { slug: 'product-improvement' });
  try {
    assert.deepEqual(reads(fb.calls), [['formOptions', 'grow', P, 'product-improvement']]);
    assert.deepEqual(fb.values('theme_choice'), ['Exports', 'Onboarding', 'new']);
    assert.deepEqual(fb.checked('theme_choice'), ['new'], 'New theme until a theme is chosen');
    assert.deepEqual(fb.values('roadmap_item_ref'), ['', '12', '9']);
    await fb.typeIn('body', 'Exports time out'); await fb.choose('theme_choice', 'Exports'); await fb.choose('roadmap_item_ref', '12');
    await fb.submit();
    const body = writes(fb.calls)[0][2];
    assert.equal(body.theme, 'Exports'); assert.equal(body.roadmap_item_ref, '12');
  } finally { await fb.unmount(); }

  // Enter a KPI: the read's KPIs, a derived one disabled with why, and a custom one.
  const kp = await mount(Box, form('revenue-and-traction'), { slug: 'revenue-and-traction' });
  try {
    assert.deepEqual(reads(kp.calls), [['formOptions', 'grow', P, 'revenue-and-traction']]);
    assert.deepEqual(kp.values('kpi'), ['mrr', 'runway', 'kpi:ab12', 'custom']);
    assert.equal(propsOf(kp.radios('kpi')[1]).disabled, true);
    assert.ok(kp.text().includes('Worked out from cash and burn.'));
    assert.deepEqual(kp.checked('kpi'), ['mrr']);
    assert.deepEqual(kp.values('source'), ['manual', 'stripe', 'bank']);
    assert.deepEqual(kp.checked('source'), ['manual']);
  } finally { await kp.unmount(); }

  // Open a role: the venture's teams.
  const ro = await mount(Box, form('team-expansion'), { slug: 'team-expansion' });
  try {
    assert.deepEqual(reads(ro.calls), [['formOptions', 'grow', P, 'team-expansion']]);
    assert.deepEqual(ro.values('team'), ['Engineering', 'Design']);
  } finally { await ro.unmount(); }

  // Add market: Nothing yet, then the geographies.
  const mk = await mount(Box, form('market-expansion'), { slug: 'market-expansion' });
  try {
    assert.deepEqual(reads(mk.calls), [['formOptions', 'grow', P, 'market-expansion']]);
    assert.deepEqual(mk.values('geography_ref'), ['', 'PT', 'ES']);
  } finally { await mk.unmount(); }

  // Channel, partner and obligation have no chip set in form-options, so they read nothing.
  for (const slug of ['distribution', 'partner-network', 'durable-company-building']) assert.equal(form(slug).loadOptions, undefined, slug);
}

test('1: Log feedback, Enter a KPI, Open a role and Add market read their chips from form-options', async () => {
  await mutationCheck(formsSource, formsPath, assertChips, [
    ["growOptions(w, projectId, 'product-improvement').then(feedbackOptions)", "Promise.resolve({}).then(feedbackOptions)"],
    ["theme_choice: { opts: [...growChips(read?.themes), { value: NEW_THEME, label: 'New theme' }] },\n    roadmap_item_ref: { opts: [{ value: NONE, label: 'None yet' }, ...growChips(read?.roadmap_items)] },", "theme_choice: { opts: [...growChips(read?.themes), { value: NEW_THEME, label: 'New theme' }] },\n    roadmap_item_ref: { opts: [{ value: NONE, label: 'None yet' }] },"],
    ["return { kpi: { opts: growChips(read?.kpis) }, source:", "return { kpi: { opts: KPI }, source:"],
    ["...(o.disabled ? { disabled: true } : {}), ", ''],
    [", ...(o.reason ? { meta: String(o.reason) } : {})", ''],
    ["growOptions(w, projectId, 'team-expansion')", "growOptions(w, projectId, 'distribution')"],
    ["growOptions(w, projectId, 'market-expansion')", "growOptions(w, projectId, 'team-expansion')"],
  ]);
});

// ---------- Test 2: a connected Stripe is a source ------------------------------

async function assertSource(m) {
  const Box = (await import('../src/pages/cycles/FormLightbox.jsx')).default;
  const kpi = m.FORMS.grow['revenue-and-traction'][0];
  const kp = await mount(Box, kpi, { slug: 'revenue-and-traction' });
  try {
    assert.ok(!propsOf(kp.radios('source').find((n) => propsOf(n).value === 'stripe')).disabled, 'a connected Stripe is a chip');
    assert.ok(kp.text().includes('Connected: its figures override a hand entry.'));
    assert.equal(propsOf(kp.radios('source').find((n) => propsOf(n).value === 'bank')).disabled, true);
    await kp.input('value', '38,400'); await kp.input('as_of', '2026-10-12');
    await kp.choose('source', 'stripe');
    await kp.submit();
    assert.deepEqual(writes(kp.calls), [], 'a typed figure is never saved as Stripe\'s');
    assert.ok(kp.text().includes(m.CONNECTED_SOURCE));
    await kp.choose('source', 'manual');
    await kp.submit();
    assert.deepEqual(writes(kp.calls), [['kpi', P, { kpi: 'mrr', value: 38400, as_of: '2026-10-12', note: null, source: 'manual' }]]);
  } finally { await kp.unmount(); }
}

test('2: a connected Stripe shows as a KPI source, and a typed figure is saved only as Entered by hand', async () => {
  await mutationCheck(formsSource, formsPath, assertSource, [
    ["...(v.source && v.source !== 'manual' ? { source: CONNECTED_SOURCE } : {}),", ''],
    ["source: v.source || 'manual',", ''],
    ["source: { opts: growChips(read?.sources) }", "source: { opts: [{ value: 'manual', label: 'Entered by hand' }] }"],
  ]);
});

// ---------- Test 3: Edit feedback ---------------------------------------------

async function assertEditFeedback(m) {
  const Box = (await import('../src/pages/cycles/FormLightbox.jsx')).default;
  const edit = m.EDITS.grow['product-improvement'];
  const open = (row) => mount(Box, edit, { slug: 'product-improvement', current: edit.valuesOf(row), id: edit.idOf(row) });

  // A linked row: its theme and its item are chosen; choosing others posts them.
  const linked = await open({ id: 'u1', edit: { uid: 'u1', status: 'open', theme: 'Exports', roadmap_item_ref: 12, roadmap_item_label: 'CSV export' } });
  try {
    assert.deepEqual(reads(linked.calls), [['formOptions', 'grow', P, 'product-improvement']]);
    assert.deepEqual(linked.values('theme'), ['', 'Exports', 'Onboarding', 'new']);
    assert.deepEqual(linked.checked('theme'), ['Exports']);
    assert.deepEqual(linked.values('roadmap_item_ref'), ['', '12', '9']);
    assert.deepEqual(linked.checked('roadmap_item_ref'), ['12']);
    await linked.choose('theme', 'Onboarding'); await linked.choose('roadmap_item_ref', '9');
    await linked.submit();
    assert.deepEqual(writes(linked.calls), [['feedbackUpdate', P, 'u1', { theme: 'Onboarding', roadmap_item_ref: '9', status: 'open' }]]);
  } finally { await linked.unmount(); }

  // New theme names one.
  const named = await open({ id: 'u2', edit: { uid: 'u2', status: 'open', theme: null } });
  try {
    await named.choose('theme', 'new'); await named.typeIn('new_theme', 'Pricing');
    await named.submit();
    assert.equal(writes(named.calls)[0][3].theme, 'Pricing');
  } finally { await named.unmount(); }

  // A theme the read does not list and an item typed before chips: each kept as a chip, and the typed item sends nothing.
  const typed = await open({ id: 'u3', edit: { uid: 'u3', status: 'open', theme: 'Legacy', roadmap_item_ref: null, roadmap_item_label: 'Faster sync' } });
  try {
    assert.deepEqual(typed.checked('theme'), ['Legacy']);
    assert.deepEqual(typed.checked('roadmap_item_ref'), ['__typed']);
    assert.ok(typed.text().includes('Faster sync'));
    await typed.choose('status', 'planned');
    await typed.submit();
    assert.deepEqual(writes(typed.calls), [['feedbackUpdate', P, 'u3', { theme: 'Legacy', status: 'planned' }]], 'no roadmap_item_ref for a typed item');
  } finally { await typed.unmount(); }
}

test('3: Edit feedback offers theme and roadmap chips from form-options and posts roadmap_item_ref', async () => {
  await mutationCheck(formsSource, formsPath, assertEditFeedback, [
    ["growOptions(w, projectId, 'product-improvement').then(editFeedbackOptions)", "Promise.resolve({}).then(editFeedbackOptions)"],
    ["theme: { opts: [{ value: NONE, label: 'No theme' }, ...growChips(read?.themes), { value: NEW_THEME, label: 'New theme' }] },", "theme: { opts: [{ value: NONE, label: 'No theme' }, ...growChips(read?.themes)] },"],
    ["theme: v.theme === NEW_THEME ? str(v.new_theme) : str(v.theme), roadmap_item_ref", "theme: str(v.theme), roadmap_item_ref"],
    ["if (v.roadmap_item_ref === KEEP_TYPED_ITEM) delete body.roadmap_item_ref;", ''],
    ["keep: (c) => (asText(c.theme) ? { value: c.theme, label: c.theme } : null) },", '},'],
    ["label: asText(c.roadmap_item_label) || 'The linked item'", "label: 'The linked item'"],
    ["asText(e.roadmap_item_ref) : asText(e.roadmap_item_label) ? KEEP_TYPED_ITEM : ''", "asText(e.roadmap_item_ref) : ''"],
  ]);
});

// ---------- Test 4: a failed read ---------------------------------------------

async function assertReadAgain(box) {
  const Box = box.default;
  const { FORMS } = await import('../src/pages/cycles/forms.js');
  const ro = await mount(Box, FORMS.grow['team-expansion'][0], { slug: 'team-expansion', fail: 1 });
  try {
    assert.ok(ro.text().includes('The choices could not be read.'));
    assert.ok(ro.by('cycle-form-read-again'), 'Try again');
    await ro.submit();
    assert.deepEqual(writes(ro.calls), [], 'nothing is saved without the choices');
    await ro.click('Try again');
    await ro.flush();
    assert.equal(reads(ro.calls).length, 2, 'read again');
    assert.ok(!ro.by('cycle-form-read-again'));
    assert.ok(!ro.text().includes('The choices could not be read.'));
    assert.deepEqual(ro.values('team'), ['Engineering', 'Design']);
  } finally { await ro.unmount(); }
}

test('4: a failed read of the choices says so with Try again, which reads them again', async () => {
  await mutationCheck(boxSource, boxPath, assertReadAgain, [
    ['{readFailed && !readRecovery && <button', '{false && <button'],
    ['setLoaded(null); setReadFailed(true);', 'setLoaded(null);'],
    ['setAttempt((n) => n + 1);', ''],
  ]);
});

// ---------- Test 5: formFields keeps a stored chip ------------------------------

test('5: formFields keeps the chip an Edit opened with only when the read does not list it', async () => {
  const verify = async (box) => {
    const f = { fields: [{ kind: 'CH', name: 'x', opts: [{ value: 'a', label: 'A' }], keep: (c) => (c.x ? { value: c.x, label: 'Kept ' + c.x } : null) }] };
    assert.deepEqual(box.formFields(f, {}, { x: 'b' })[0].options.map((o) => o.label), ['A', 'Kept b']);
    assert.deepEqual(box.formFields(f, {}, { x: 'a' })[0].options.map((o) => o.label), ['A'], 'not twice');
    assert.deepEqual(box.formFields(f, {}, null)[0].options.map((o) => o.label), ['A'], 'an Add keeps nothing');
  };
  await mutationCheck(boxSource, boxPath, verify, [
    ["typeof field.keep === 'function' && current ? field.keep(current) : null", 'null'],
    ['!listed.some((option) => String(option?.value ?? option) === String(kept.value))', 'true'],
  ]);
});
