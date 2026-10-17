/**
 * D695 PR 2a (#1656): Validate's five canvas forms (CO:306-310) and their
 * Edits as specs, and PR 2b's registration, chip loaders, Add competitor's
 * search, the Edits opened from a record, and the `validate` write group.
 *
 * Each form is mounted in the real `FormLightbox` with a stubbed write table,
 * so these are the words a founder reads and the bodies the routes receive.
 * Test 7: the canvas copy, byte for byte, except where decisions 3 and 8 draw
 * other words. Test 2: the `when` boxes. Test 8: no bracket anywhere, and the
 * chip sets an empty options read leaves. Each body's keys are read against
 * the handler on `main` (`routes/cycle_validate.ts`, #1692's first PR).
 * Each group runs on `forms.js`, on mutants of it that must fail, and again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { h, mountForm, mutationCheck, propsOf, textOf } from './_form_d695.mjs';
import { act } from 'react';
import { extractClientCalls, normalizePath } from '../../scripts/lib/apiModules.mjs';

const path = 'pages/cycles/forms.js';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_validate.ts', import.meta.url), 'utf8');
const writers = readFileSync(new URL('../../cloudflare-worker/src/services/validateWriters.ts', import.meta.url), 'utf8');
const writes = readFileSync(new URL('../src/lib/api/cycleWrites.js', import.meta.url), 'utf8');
const m0 = await import('../src/pages/cycles/forms.js');

const SLUGS = ['problem-discovery', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments'];
const P = 3;

/** A write table that records each call and answers as a route would. */
function writeTable() {
  const calls = [];
  const validate = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { id: 1 }; } });
  return { calls, w: { validate } };
}

async function mount(form, { current = null, id = null, loadOptions = null, slug } = {}) {
  const { calls, w } = writeTable();
  const onSubmit = (v) => (id == null ? form.submit(w, P, v) : form.submit(w, P, id, v));
  const ui = await mountForm(h(FormLightbox, { form, current, cycle: 'validate', slug, onSubmit, onClose() {}, loadOptions }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const radios = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio');
  const checks = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'checkbox');
  return { ...ui, calls, inputs, radios, checks };
}

// ---------- Test 7: the canvas copy ------------------------------------------

/** CO:306-310 as drawn, brackets removed (decision 3), feet and notes per decision 8. */
const COPY = {
  'problem-discovery': {
    eyebrow: 'Validate · Problem discovery', title: 'New theme', cta: 'Create theme',
    sub: 'A pain theme groups quotes that describe the same problem.',
    foot: 'Quotes keep their interview and consent.',
    labels: ['Theme', 'How severe', 'Quotes to attach', 'Feeds hypothesis'],
    chips: { severity: ['Mild', 'Real', 'Severe'], hypothesis_id: ['None yet'] },
    defaults: { severity: 'real', hypothesis_id: '' },
    notes: ['Mild: a nuisance. Real: costs time or money. Severe: blocks the job. Applies to quotes not judged yet.'],
    placeholders: ['Name the pain in the customer’s words'],
  },
  'ideal-customer-profile': {
    eyebrow: 'Validate · Ideal customer profile', title: 'New segment', cta: 'Create segment',
    sub: 'A segment is one answer to who the customer is. Compare several.',
    foot: 'Interviews are listed against it with their ICP fit.',
    labels: ['Segment', 'Who they are', 'Job to be done', 'Urgency', 'Value promised', 'Score against'],
    chips: { urgency: ['Low', 'Medium', 'High'], score_against: ['All interviews', 'Interviews since a date'] },
    defaults: { urgency: 'high', score_against: 'all' },
    notes: [],
    placeholders: ['Segment name', 'Role at company type, size, where', 'What they are trying to get done', 'What changes for them'],
  },
  'market-intelligence': {
    eyebrow: 'Validate · Market intelligence', title: 'Add competitor', cta: 'Add competitor',
    sub: 'Tracked from Research › Companies, or added by name.',
    foot: 'Signals appear as you record them or re-run the analysis.',
    labels: ['Company', 'Kind', 'Watch for', 'Why it matters'],
    chips: { kind: ['Direct', 'Adjacent'] },
    defaults: { kind: 'direct' },
    checks: { watch: [['Funding', 'rounds and amounts', true], ['Launches', 'products and features', true], ['Hires', 'roles and team size', false]] },
    notes: ['Direct: solves the same problem for the same customer. Adjacent: one of the two.'],
    placeholders: ['Search Research › Companies, or type a name', 'One line, optional'],
  },
  'demand-signals': {
    eyebrow: 'Validate · Demand and urgency signals', title: 'Record a signal', cta: 'Record signal',
    sub: 'Evidence that someone wants this, with its date.',
    foot: 'Waitlist sign-ups count toward the bar you set.',
    labels: ['Kind', 'Who', 'Amount', 'Date', 'Status'],
    chips: { kind: ['Need-to-have mention', 'Waitlist sign-up', 'Pre-sale', 'Letter of intent'], status: ['Confirmed', 'To confirm'] },
    defaults: { kind: 'pre_sale', status: 'confirmed' },
    notes: ['To confirm: said, not yet in writing.'],
    placeholders: ['Customer, lead or interviewee', '$1,200 · pre-sales and letters of intent only', '12 Oct'],
  },
  experiments: {
    eyebrow: 'Validate · Experiments and evidence', title: 'New hypothesis', cta: 'Create hypothesis',
    sub: 'A claim you most need to be true, and how you would know.',
    foot: 'Its status comes from the evidence linked to it.',
    labels: ['Claim', 'What would prove it', 'What would disprove it', 'Pain themes it links to', 'Direction', 'Owner · deadline'],
    chips: { direction: ['Supporting', 'Contradicting'] },
    defaults: { direction: 'supports' },
    notes: [],
    placeholders: ['We believe that …', 'Success bar · e.g. 5 of 8 interviewees …', 'Condition', '31 Oct'],
  },
};

async function assertCopy(m) {
  assert.deepEqual(Object.keys(m.VALIDATE_FORMS), SLUGS);
  for (const slug of SLUGS) {
    assert.ok(MODULES.validate.some((mod) => mod.slug === slug), `${slug} is a Validate module`);
    const want = COPY[slug];
    const [form, ...more] = m.VALIDATE_FORMS[slug];
    assert.equal(more.length, 0, `${slug} has one Add`);
    assert.equal(form.cta, form.button, `${slug}: an Add's CTA is its button`);
    const ui = await mount(form, { slug });
    try {
      const text = ui.text();
      for (const s of [want.eyebrow, want.title, want.sub, want.foot, want.cta, ...want.labels, ...want.notes]) assert.ok(text.includes(s), `${slug}: "${s}"`);
      for (const [name, labels] of Object.entries(want.chips)) {
        assert.deepEqual(ui.radios(name).map((n) => propsOf(n).value).length, labels.length, `${slug} ${name}: chip count`);
        for (const label of labels) assert.ok(text.includes(label), `${slug} ${name}: "${label}"`);
        const on = ui.radios(name).filter((n) => propsOf(n).checked).map((n) => propsOf(n).value);
        assert.deepEqual(on, [want.defaults[name]], `${slug} ${name}: its default`);
      }
      for (const [name, rows] of Object.entries(want.checks ?? {})) {
        assert.deepEqual(ui.checks(name).map((n) => propsOf(n).checked), rows.map((r) => r[2]), `${slug} ${name}: defaults`);
        for (const [label, meta] of rows) assert.ok(text.includes(label) && text.includes(meta), `${slug} ${name}: ${label} · ${meta}`);
      }
      const ph = ui.inputs().map((n) => propsOf(n).placeholder).filter(Boolean);
      for (const p of want.placeholders) assert.ok(ph.includes(p), `${slug}: placeholder "${p}"`);
      assert.ok(!/·\s*required/i.test(text), `${slug}: no required marker`);
    } finally { await ui.unmount(); }
  }
  // The claim box is the canvas's 56px.
  const claim = m.VALIDATE_FORMS.experiments[0].fields.find((f) => f.name === 'claim');
  assert.equal(claim.h, '56px');
}

test('7: each Validate form draws the canvas copy, with decision 8\'s feet and note', async () => {
  await mutationCheck(source, path, assertCopy, [
    ["foot: 'Signals appear as you record them or re-run the analysis.'", "foot: 'Signals arrive as they are found.'"],
    ["foot: 'Its status comes from the evidence linked to it.'", "foot: 'Starts Untested until a sprint tests it.'"],
    ['Severe: blocks the job. Applies to quotes not judged yet.', 'Severe: blocks the job.'],
    ["{ kind: 'CH', name: 'urgency', k: 'Urgency', opts: URGENCY, def: 2 }", "{ kind: 'CH', name: 'urgency', k: 'Urgency', opts: URGENCY, def: 0 }"],
    ["{ value: 'hiring', label: 'Hires', meta: 'roles and team size', checked: false }", "{ value: 'hiring', label: 'Hires', meta: 'roles and team size', checked: true }"],
    ["opts: SIGNAL_KIND, def: 2", 'opts: SIGNAL_KIND, def: 1'],
    ["key: 'segment', cta: 'Create segment'", "key: 'segment', cta: 'Save segment'"],
  ]);
});

// ---------- Test 2: boxes a choice reveals -----------------------------------

async function assertWhen(m) {
  const signal = await mount(m.VALIDATE_FORMS['demand-signals'][0], { slug: 'demand-signals' });
  try {
    assert.ok(signal.by('cycle-form-amount'), 'Pre-sale shows Amount');
    await signal.input('amount', '1,200');
    await signal.choose('kind', 'waitlist');
    assert.ok(!signal.by('cycle-form-amount'), 'Waitlist sign-up hides Amount');
    await signal.input('signal_date', '2026-10-12');
    await signal.submit();
    assert.deepEqual(signal.calls, [['signal', P, { kind: 'waitlist', who: null, amount_cents: null, currency: null, signal_date: '2026-10-12', status: 'confirmed' }]],
      'a hidden amount is not sent');
    await signal.choose('kind', 'loi');
    assert.ok(signal.by('cycle-form-amount'), 'Letter of intent shows Amount');
    await signal.choose('kind', 'need_to_have');
    assert.ok(!signal.by('cycle-form-amount'), 'a need-to-have mention takes no amount');
  } finally { await signal.unmount(); }
  // The body never carries an amount its kind is refused for, whatever the values hold.
  const body = m.VALIDATE_FORMS['demand-signals'][0].toBody({ kind: 'waitlist', amount: '50', status: 'confirmed' });
  assert.deepEqual([body.amount_cents, body.currency], [null, null]);

  const seg = await mount(m.VALIDATE_FORMS['ideal-customer-profile'][0], { slug: 'ideal-customer-profile' });
  try {
    await seg.input('name', 'Finance leads');
    assert.ok(!seg.by('cycle-form-score_since'), 'All interviews shows no date');
    await seg.choose('score_against', 'since');
    assert.ok(seg.by('cycle-form-score_since'), 'Interviews since a date reveals the date box');
    await seg.submit();
    assert.equal(seg.calls.length, 0, 'nothing is sent without its date');
    assert.ok(seg.text().includes('Interviews since is required.'));
    await seg.input('score_since', '2026-09-01');
    await seg.submit();
    assert.deepEqual(seg.calls, [['segment', P, { name: 'Finance leads', who_they_are: null, job_to_be_done: null, urgency: 'high', value_promised: null, score_since: '2026-09-01' }]]);
  } finally { await seg.unmount(); }
}

test('2: Amount shows only for pre-sales and letters of intent, and the second Score against chip reveals its date', async () => {
  await mutationCheck(source, path, assertWhen, [
    ["when: (v) => AMOUNT_KINDS.includes(v.kind) }", '}'],
    ['const amount = AMOUNT_KINDS.includes(v.kind) ? toCents(v.amount) : null;', 'const amount = toCents(v.amount);'],
    ["when: { name: 'score_against', value: SINCE } }", '}'],
    ["score_since: v.score_against === SINCE ? str(v.score_since) : null,", 'score_since: null,'],
  ]);
});

// ---------- Test 8: no brackets, and empty chip sets -------------------------

const strings = (form) => {
  const out = [form.title, form.sub, form.foot, form.cta];
  const walk = (fields) => (fields || []).forEach((f) => {
    out.push(f.k, f.ph, typeof f.note === 'string' ? f.note : '', f.empty);
    for (const o of f.opts || []) out.push(o.label, o.meta);
    walk(f.parts);
  });
  walk(form.fields);
  return out.filter((s) => typeof s === 'string');
};

async function assertEmpty(m) {
  for (const form of [...Object.values(m.VALIDATE_FORMS).flat(), ...Object.values(m.VALIDATE_EDITS)]) {
    for (const s of strings(form)) assert.ok(!/[[\]]/.test(s), `${form.key}: "${s}" carries a bracket`);
    assert.ok(!strings(form).some((s) => s.includes('€')), `${form.key}: money is in dollars`);
  }
  // An options read that names nothing leaves each set as decision 4 draws it.
  const empty = async () => ({});
  const theme = await mount(m.VALIDATE_FORMS['problem-discovery'][0], { slug: 'problem-discovery', loadOptions: empty });
  try {
    assert.deepEqual(theme.radios('hypothesis_id').map((n) => propsOf(n).value), [''], 'Feeds hypothesis offers only None yet');
    assert.ok(theme.text().includes('None yet'));
    assert.equal(theme.checks('quotes').length, 0);
    assert.ok(theme.text().includes('No unthemed quotes recorded yet.'));
    assert.ok(!theme.text().includes('unthemed quotes are waiting'), 'no count is drawn before a read gives one');
  } finally { await theme.unmount(); }
  const hyp = await mount(m.VALIDATE_FORMS.experiments[0], { slug: 'experiments', loadOptions: empty });
  try {
    assert.equal(hyp.radios('pain_group_id').length, 0, 'no theme chip');
    assert.ok(hyp.text().includes('No pain themes recorded yet.'));
    assert.equal(hyp.radios('owner_user_id').length, 0);
    await hyp.input('claim', 'Finance teams pay to skip month-end');
    await hyp.submit();
    assert.deepEqual(hyp.calls, [['hypothesis', P, { claim: 'Finance teams pay to skip month-end', success_bar: null, disproof: null, pain_group_ids: [], direction: 'supports', deadline: null }]],
      'the links are optional, and no owner is sent when none is chosen');
  } finally { await hyp.unmount(); }
  // A read's chips replace the set, so the loader names "None yet" where the canvas puts it.
  const loaded = await mount(m.VALIDATE_FORMS['problem-discovery'][0], { slug: 'problem-discovery', loadOptions: async () => ({
    quotes: { opts: [{ value: m.quoteValue(4, 'Month-end takes days'), label: '"Month-end takes days" · Interviewee · 12 Oct', meta: 'unthemed', checked: true }] },
    hypothesis_id: { opts: [{ value: '', label: 'None yet' }, { value: '9', label: 'Finance teams pay to skip month-end' }] },
  }) });
  try {
    await loaded.input('title', 'Month-end is manual');
    await loaded.choose('hypothesis_id', '9');
    await loaded.submit();
    assert.deepEqual(loaded.calls, [['theme', P, { title: 'Month-end is manual', severity: 'real', quotes: [{ interview_id: 4, phrase: 'Month-end takes days' }], hypothesis_id: 9 }]]);
  } finally { await loaded.unmount(); }
}

test('8: no chip, placeholder or note carries a bracket, and an empty read leaves None yet or the empty sentence', async () => {
  await mutationCheck(source, path, assertEmpty, [
    ["k: 'Feeds hypothesis', opts: [NONE_YET]", "k: 'Feeds hypothesis', opts: []"],
    ["empty: 'No pain themes recorded yet.'", "empty: 'No [pain themes] yet.'"],
    ["ph: 'Role at company type, size, where'", "ph: '[Role] at [company type], [size], [where]'"],
    ["ph: '$1,200 · pre-sales and letters of intent only'", "ph: '€1,200 · pre-sales and letters of intent only'"],
    ["...(owner == null ? {} : { owner_user_id: owner })", 'owner_user_id: owner'],
    ["hypothesis_id: idOrNull(v.hypothesis_id),", 'hypothesis_id: v.hypothesis_id,'],
  ]);
});

// ---------- Each body is the one its route takes -----------------------------

/** The body keys a handler reads, from `routes/cycle_validate.ts` on main. */
function routeKeys(method, route) {
  const at = routes.indexOf(`cycleValidate.${method}('${route}'`);
  assert.ok(at >= 0, `${method.toUpperCase()} ${route} is on main`);
  const next = routes.indexOf('\ncycleValidate.', at + 1);
  const handler = routes.slice(at, next < 0 ? undefined : next);
  const keys = new Set([...handler.matchAll(/\bb\.([a-z_]+)/g)].map((x) => x[1]));
  // A demand signal's body is spread into the writer, which reads its input type.
  if (handler.includes('...b')) {
    const type = writers.slice(writers.indexOf('export type DemandSignalInput'), writers.indexOf('export async function writeDemandSignal'));
    for (const k of type.matchAll(/^\s+([a-z_]+)\??:/gm)) keys.add(k[1]);
  }
  return keys;
}

const ADDS = {
  'problem-discovery': ['/themes', 'theme', { title: 'Month-end is manual', severity: 'severe' }],
  'ideal-customer-profile': ['/segments', 'segment', { name: 'Finance leads', who_they_are: 'Controllers at 50-person firms', job_to_be_done: 'Close the month', urgency: 'medium', value_promised: 'Two days back' }],
  'market-intelligence': ['/competitors', 'competitor', { company: 'Ledgerline', kind: 'adjacent', why: 'Same buyer' }],
  'demand-signals': ['/demand-signals', 'signal', { kind: 'pre_sale', who: 'Harbour Works', amount: '1,200', signal_date: '2026-10-12', status: 'to_confirm' }],
  experiments: ['/hypotheses', 'hypothesis', { claim: 'Controllers pay to skip month-end', success_bar: '5 of 8 say yes', disproof: 'Fewer than 3', deadline: '2026-10-31' }],
};
const BODIES = {
  'problem-discovery': { title: 'Month-end is manual', severity: 'severe', quotes: [], hypothesis_id: null },
  'ideal-customer-profile': { name: 'Finance leads', who_they_are: 'Controllers at 50-person firms', job_to_be_done: 'Close the month', urgency: 'medium', value_promised: 'Two days back', score_since: null },
  'market-intelligence': { name: 'Ledgerline', kind: 'adjacent', watch: { funding: true, launch: true, hiring: false }, why: 'Same buyer' },
  'demand-signals': { kind: 'pre_sale', who: 'Harbour Works', amount_cents: 120000, currency: 'usd', signal_date: '2026-10-12', status: 'to_confirm' },
  experiments: { claim: 'Controllers pay to skip month-end', success_bar: '5 of 8 say yes', disproof: 'Fewer than 3', pain_group_ids: [], direction: 'supports', deadline: '2026-10-31' },
};

async function assertBodies(m) {
  for (const slug of SLUGS) {
    const [route, method, typed] = ADDS[slug];
    const ui = await mount(m.VALIDATE_FORMS[slug][0], { slug });
    try {
      for (const [name, value] of Object.entries(typed)) {
        const radio = ui.radios(name).length > 0;
        if (radio) await ui.choose(name, value); else await ui.input(name, value);
      }
      await ui.submit();
      assert.deepEqual(ui.calls, [[method, P, BODIES[slug]]], `${slug}: the body`);
      const takes = routeKeys('post', route);
      for (const k of Object.keys(BODIES[slug])) assert.ok(takes.has(k), `${slug}: POST ${route} reads ${k}`);
    } finally { await ui.unmount(); }
  }
  // The route takes exactly one of the three ways to name a competitor.
  const c = m.VALIDATE_FORMS['market-intelligence'][0];
  const named = (v) => ['company_ref', 'directory_uid', 'name'].filter((k) => Object.hasOwn(c.toBody({ kind: 'direct', ...v }), k));
  assert.deepEqual(named({ company: 'Ledgerline', company_ref: 'cand-7' }), ['company_ref']);
  assert.deepEqual(named({ company: 'Ledgerline', directory_uid: 'dir-ledgerline' }), ['directory_uid']);
  assert.deepEqual(named({ company: 'Ledgerline' }), ['name']);
  assert.equal(c.toBody({ company: 'Ledgerline', directory_uid: 'dir-ledgerline' }).name, undefined, 'a directory match sends no name');
  // A quote value carries its interview and its phrase, colons and all.
  assert.deepEqual(m.VALIDATE_FORMS['problem-discovery'][0].toBody({ title: 'T', quotes: [m.quoteValue(4, 'Close: takes days'), 'not-a-quote', ':x', '4:'] }).quotes,
    [{ interview_id: 4, phrase: 'Close: takes days' }]);
}

test('each Add sends the body its route on main takes, and Add competitor names its company one way', async () => {
  await mutationCheck(source, path, assertBodies, [
    [": str(v.directory_uid) ? { directory_uid: str(v.directory_uid) } : { name: str(v.company) };", ": { name: str(v.company) };"],
    ['watch: watchBody(v), why: str(v.why) };\n  },\n  search:', 'watch: v.watch, why: str(v.why) };\n  },\n  search:'],
    ["currency: amount == null ? null : 'usd'", 'currency: null'],
    ['return at > 0 && id != null && s.slice(at + 1)', 'return id != null'],
    ["w.validate.hypothesis(projectId, hypothesis.toBody(v))", "w.validate.theme(projectId, hypothesis.toBody(v))"],
  ]);
});

// ---------- The Edits --------------------------------------------------------

const EDIT_TITLES = { 'problem-discovery': 'Edit theme', 'ideal-customer-profile': 'Edit segment', 'market-intelligence': 'Edit competitor', 'demand-signals': 'Edit signal', experiments: 'Edit hypothesis' };
const PATCHES = { 'problem-discovery': '/themes/:id', 'ideal-customer-profile': '/segments/:id', 'market-intelligence': '/competitors/:id', 'demand-signals': '/demand-signals/:id', experiments: '/hypotheses/:id' };
/** Rows whose `edit` carries some values, the record route's ids, and the body each sends. */
const EDIT_CASES = {
  'problem-discovery': { row: { id: 7, edit: { title: 'Month-end is manual', severity: 'real' } }, id: '7', change: [['severity', 'severe']],
    body: { title: 'Month-end is manual', severity: 'severe' } },
  'ideal-customer-profile': { row: { id: '12', edit: { name: 'Finance leads', urgency: 'high' } }, id: '12', change: [['urgency', 'low']],
    body: { name: 'Finance leads', urgency: 'low' } },
  'market-intelligence': { row: { id: 'cand-7', edit: { kind: 'direct', watch: { funding: true, launch: false, hiring: true } } }, id: 'cand-7', change: [['kind', 'adjacent']],
    body: { kind: 'adjacent', watch: { funding: true, launch: false, hiring: true } } },
  'demand-signals': { row: { id: 'signal-4', edit: { kind: 'pre_sale', who: 'Harbour Works', amount_cents: 120000 } }, id: 'signal-4', change: [['kind', 'waitlist']],
    body: { kind: 'waitlist', who: 'Harbour Works', amount_cents: null, currency: null } },
  experiments: { row: { id: 9, edit: { claim: 'Controllers pay', deadline: '2026-10-31T00:00:00Z' } }, id: '9', change: [],
    body: { claim: 'Controllers pay', deadline: '2026-10-31' } },
};

async function assertEdits(m) {
  assert.deepEqual(Object.keys(m.VALIDATE_EDITS), SLUGS);
  for (const slug of SLUGS) {
    const edit = m.VALIDATE_EDITS[slug];
    const c = EDIT_CASES[slug];
    assert.equal(edit.title, EDIT_TITLES[slug]); assert.equal(edit.cta, 'Save'); assert.equal(edit.button, 'Edit');
    assert.equal(edit.idOf(c.row), c.id, `${slug}: its id`);
    assert.equal(edit.idOf({ edit: { id: c.row.id } }), c.id, `${slug}: a record passed as { edit: { id } }`);
    const current = edit.valuesOf(c.row);
    const form = m.editFieldsFor(edit, current);
    const ui = await mount(form, { slug, current, id: edit.idOf(c.row) });
    try {
      assert.ok(ui.text().includes(EDIT_TITLES[slug]) && ui.text().includes('Save'));
      for (const [name, value] of c.change) await ui.choose(name, value);
      await ui.submit();
      assert.equal(ui.calls.length, 1);
      const [method, project, id, body] = ui.calls[0];
      assert.equal(method, `${{ 'problem-discovery': 'theme', 'ideal-customer-profile': 'segment', 'market-intelligence': 'competitor', 'demand-signals': 'signal', experiments: 'hypothesis' }[slug]}Update`);
      assert.equal(project, P); assert.equal(id, c.id);
      assert.deepEqual(body, c.body, `${slug}: only the carried fields are sent`);
      const takes = routeKeys('patch', PATCHES[slug]);
      for (const k of Object.keys(body)) assert.ok(takes.has(k), `${slug}: PATCH ${PATCHES[slug]} reads ${k}`);
    } finally { await ui.unmount(); }
  }
  // An id the route does not take draws no Edit.
  assert.equal(m.VALIDATE_EDITS['demand-signals'].idOf({ id: 'revenue-4' }), null, 'a ledger row is not the founder\'s signal');
  assert.equal(m.VALIDATE_EDITS['demand-signals'].idOf({ id: 'waitlist-4' }), null);
  assert.equal(m.VALIDATE_EDITS['problem-discovery'].idOf({ id: null }), null, 'an ungrouped phrase has no record');
  assert.equal(m.VALIDATE_EDITS['market-intelligence'].idOf({ id: 'Bad Id' }), null);
  // Pain links, direction and quotes are the record's sections, never an Edit's.
  const names = (f) => (f.fields || []).flatMap((x) => (x.parts ? x.parts.map((p) => p.name) : [x.name]));
  assert.deepEqual(names(m.VALIDATE_EDITS.experiments), ['claim', 'success_bar', 'disproof', 'owner_user_id', 'deadline']);
  assert.deepEqual(names(m.VALIDATE_EDITS['problem-discovery']), ['title', 'severity']);
  // A source that carries no value for a field leaves that field out.
  const all = names(m.editFieldsFor(m.VALIDATE_EDITS['ideal-customer-profile'], { name: 'x', score_since: '2026-09-01', score_against: 'since' }));
  assert.deepEqual(all, ['name', 'score_against', 'score_since']);
  assert.deepEqual(names(m.editFieldsFor(m.VALIDATE_EDITS.experiments, { deadline: '2026-10-31' })), ['deadline']);
}

test('6: each Validate Edit is titled Edit <noun>, saves with Save, and sends only the PATCH fields its source carried', async () => {
  await mutationCheck(source, path, assertEdits, [
    ['Object.entries(body).filter(([k]) => Object.hasOwn(v, from[k] ?? k))', 'Object.entries(body)'],
    ["if (Object.hasOwn(v, 'kind') && !AMOUNT_KINDS.includes(v.kind)) Object.assign(body, { amount_cents: null, currency: null });", ''],
    ['return has(f) || (f.when', 'return true || (f.when'],
    ["idOf: recordId(/^signal-[1-9]\\d*$/),", "idOf: recordId(/^[a-z0-9-]+$/),"],
    ["key: 'edit-theme', title: 'Edit theme'", "key: 'edit-theme', title: 'Edit a theme'"],
    ['if (v.deadline) v.deadline = dateText(v.deadline);', ''],
  ]);
});

// ---------- Registered (PR 2b) -----------------------------------------------

test('15: PR 2b registers the five Adds and their Edits, and each module with no spec still has no form', () => {
  assert.deepEqual(Object.keys(m0.FORMS.validate), SLUGS);
  assert.deepEqual(Object.keys(m0.EDITS.validate), SLUGS);
  for (const { slug } of MODULES.validate) {
    const spec = m0.VALIDATE_FORMS[slug];
    assert.equal(m0.formFor('validate', slug), spec ? spec[0] : null, `${slug}: its Add, or none`);
    assert.equal(m0.editFor('validate', slug), m0.VALIDATE_EDITS[slug] ?? null, `${slug}: its Edit, or none`);
    if (m0.VALIDATE_EDITS[slug]) assert.equal(m0.VALIDATE_EDITS[slug].readsRecord, true, `${slug}: its Edit reads the record`);
  }
  assert.match(writes, /\bvalidate:\s*\{/, 'cycleWrites.js has the validate group');
  for (const f of Object.values(m0.VALIDATE_FORMS).flat()) assert.match(f.key, /^[a-z0-9][a-z0-9-]*$/);
  assert.deepEqual(Object.values(m0.VALIDATE_EDITS).map((f) => f.key), ['edit-theme', 'edit-segment', 'edit-competitor', 'edit-signal', 'edit-hypothesis']);
});

// =============================================================================
// PR 2b: the loaders, Add competitor's search, the Edits from a record, the writes
// =============================================================================

const writesPath = 'lib/api/cycleWrites.js';
const recordModelPath = 'pages/cycles/recordModel.js';
const recordModelSource = readFileSync(new URL('../src/' + recordModelPath, import.meta.url), 'utf8');

/** A write table whose `formOptions` answers `reply` for the module (or refuses), as #1692's read does. */
function readingTable(replies, answer) {
  const calls = [];
  const validate = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); if (answer) return answer(name, ...args); return { id: 1 }; } });
  const formOptions = async (cycle, projectId, slug, query = {}) => {
    calls.push(['formOptions', cycle, projectId, slug, query]);
    const r = replies[slug];
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(query) : r ?? {};
  };
  return { calls, w: { validate, formOptions } };
}
async function mountRead(form, slug, replies, { current = null, id = null, answer } = {}) {
  const { calls, w } = readingTable(replies, answer);
  const onSubmit = (v) => (id == null ? form.submit(w, P, v) : form.submit(w, P, id, v));
  const ui = await mountForm(h(FormLightbox, {
    form, current, cycle: 'validate', slug, onSubmit, onClose() {}, searchDelay: 0,
    loadOptions: form.loadOptions ? () => form.loadOptions(w, P, id) : null,
    onSearch: form.search ? (_field, q) => form.search(w, P, q) : null,
  }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const typeIn = async (name, value) => {
    const node = inputs().find((n) => propsOf(n).name === name);
    assert.ok(node, name);
    await act(async () => propsOf(node).onChange({ target: { value } }));
    await ui.flush();
  };
  return { ...ui, calls, inputs, typeIn, sends: (name) => calls.filter((c) => c[0] === name),
    radios: (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio'),
    checks: (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'checkbox') };
}

const QUOTES = {
  quotes: [
    { value: '4|Close takes days', label: '"Close takes days" · Ana · 12 Oct', interview_id: 4, phrase: 'Close takes days', theme: null },
    { value: '5|Spreadsheets break', label: '"Spreadsheets break" · Ben · 9 Oct', interview_id: 5, phrase: 'Spreadsheets break', theme: null },
    { value: '6|Two tools: no sync', label: '"Two tools: no sync" · Cy · 3 Oct', interview_id: 6, phrase: 'Two tools: no sync', theme: null },
    { value: '7|Audits hurt', label: '"Audits hurt" · Di · 1 Oct', interview_id: 7, phrase: 'Audits hurt', theme: null },
    { value: '8|Late invoices', label: '"Late invoices" · Ed · 2 Oct', interview_id: 8, phrase: 'Late invoices', theme: 'in Cash timing' },
  ],
  unthemed_total: 4,
  hypotheses: [{ value: '9', label: 'Controllers pay to skip month-end' }],
};

async function assertLoaders(m) {
  const theme = m.FORMS.validate['problem-discovery'][0];
  let ui = await mountRead(theme, 'problem-discovery', { 'problem-discovery': QUOTES });
  try {
    assert.ok(ui.text().includes('4 unthemed quotes are waiting.'));
    assert.deepEqual(ui.checks('quotes').map((n) => propsOf(n).checked), [true, true, true, true, false], 'unthemed quotes checked, a themed one not');
    assert.ok(ui.text().includes('in Cash timing') && ui.text().includes('unthemed'));
    assert.deepEqual(ui.radios('hypothesis_id').map((n) => textOf(n.parentNode).trim()), ['None yet', 'Controllers pay to skip month-end']);
    await ui.input('title', 'Month-end is manual');
    await ui.choose('hypothesis_id', '9');
    await ui.submit();
    assert.deepEqual(ui.sends('theme')[0][2].quotes, [
      { interview_id: 4, phrase: 'Close takes days' }, { interview_id: 5, phrase: 'Spreadsheets break' },
      { interview_id: 6, phrase: 'Two tools: no sync' }, { interview_id: 7, phrase: 'Audits hurt' },
    ], 'each quote by its interview and phrase, colons and all');
    assert.equal(ui.sends('theme')[0][2].hypothesis_id, 9);
  } finally { await ui.unmount(); }
  assert.equal(m.themeOptions({ unthemed_total: 1 }).quotes.note, '1 unthemed quote is waiting.');
  assert.deepEqual(m.themeOptions({}).hypothesis_id.options, [{ value: '', label: 'None yet' }], 'with no hypotheses, only None yet');

  const hyp = m.FORMS.validate.experiments[0];
  ui = await mountRead(hyp, 'experiments', { experiments: { themes: [], owners: [{ value: '12', label: 'Fay Founder' }] } });
  try {
    assert.ok(ui.text().includes('No pain themes recorded yet.'));
    assert.equal(ui.radios('pain_group_id').length, 0);
    await ui.input('claim', 'Controllers pay');
    await ui.choose('owner_user_id', '12');
    await ui.submit();
    assert.equal(ui.sends('hypothesis')[0][2].owner_user_id, 12);
  } finally { await ui.unmount(); }
  const refused = await mountRead(hyp, 'experiments', { experiments: Object.assign(new Error('Forbidden'), { status: 403 }) });
  try {
    assert.equal(textOf(refused.by('cycle-form-refusal')), 'Forbidden', 'a refused read shows the Worker\'s sentence');
    await refused.submit();
    assert.equal(refused.sends('hypothesis').length, 0, 'and nothing is sent');
  } finally { await refused.unmount(); }
}

test('8 (PR 2b): each loader fills its chips from form-options, with None yet and the empty sentences where decision 4 puts them', async () => {
  await mutationCheck(source, path, assertLoaders, [
    ["meta: x.theme ? String(x.theme) : 'unthemed', checked: !x.theme }", "meta: x.theme ? String(x.theme) : 'unthemed', checked: true }"],
    ["value: quoteValue(x.interview_id, x.phrase)", 'value: String(x.value)'],
    ["hypothesis_id: { options: [NONE_YET, ...chipList(read?.hypotheses)] },", 'hypothesis_id: { options: chipList(read?.hypotheses) },'],
    ["`${plural(waiting, 'unthemed quote is', 'unthemed quotes are')} waiting.`", "`${waiting} unthemed quotes are waiting.`"],
    ["loadOptions: (w, projectId) => w.formOptions('validate', projectId, 'experiments').then(hypothesisOptions),\n", ''],
  ]);
});

const MARKET = (query) => ({
  candidates: [{ value: '71', label: 'Acme Ledger', website: null }, { value: '72', label: 'Brightbooks', website: null }],
  ...(query.q ? { directory: [{ value: 'dir-acme', label: 'Acme Analytics', website: 'acme.example.test', country: 'US' }] } : {}),
});

async function assertSearch(m) {
  const competitor = m.FORMS.validate['market-intelligence'][0];
  const ui = await mountRead(competitor, 'market-intelligence', { 'market-intelligence': MARKET });
  try {
    await ui.typeIn('company', 'acme');
    assert.deepEqual(ui.calls.filter((c) => c[0] === 'formOptions'), [['formOptions', 'validate', P, 'market-intelligence', { q: 'acme' }]]);
    const found = ui.by('cycle-form-found-company');
    assert.ok(found);
    assert.equal(textOf(found), 'Your competitor analysesAcme LedgerResearch › CompaniesAcme Analytics', 'the caller\'s own candidates first, then the directory, each under its source');
    await ui.click('Acme Ledger');
    await ui.submit();
    assert.deepEqual(ui.sends('competitor')[0][2], { company_ref: '71', kind: 'direct', watch: { funding: true, launch: true, hiring: false }, why: null });
    await ui.typeIn('company', 'acme an');
    await ui.click('Acme Analytics');
    await ui.submit();
    assert.deepEqual(Object.keys(ui.sends('competitor')[1][2]).filter((k) => ['company_ref', 'directory_uid', 'name'].includes(k)), ['directory_uid'], 'a directory match sends no name');
    assert.equal(ui.sends('competitor')[1][2].directory_uid, 'dir-acme');
    await ui.typeIn('company', 'Ledgerline');
    await ui.submit();
    assert.deepEqual(Object.keys(ui.sends('competitor')[2][2]).filter((k) => ['company_ref', 'directory_uid', 'name'].includes(k)), ['name'], 'a typed name, once the pick is gone');
  } finally { await ui.unmount(); }
}

test('8 (PR 2b): Add competitor searches as the founder types, draws its own candidates before Research › Companies, and sends one key', async () => {
  await mutationCheck(source, path, assertSearch, [
    ["const own = chipList(read?.candidates).filter((o) => o.label.toLowerCase().includes(typed))", 'const own = chipList(read?.candidates)'],
    ["return [...own, ...directory];", 'return [...directory, ...own];'],
    [".map((o) => ({ ...o, into: 'directory_uid', group: 'Research › Companies' }));", ".map((o) => ({ ...o, into: 'company_ref', group: 'Research › Companies' }));"],
    ["search: { into: 'company_ref' } },", '},'],
  ]);
  const lightbox = 'pages/cycles/FormLightbox.jsx';
  const lightboxSource = readFileSync(new URL('../src/' + lightbox, import.meta.url), 'utf8');
  await mutationCheck(lightboxSource, lightbox, async (mod) => {
    const comp = m0.FORMS.validate['market-intelligence'][0];
    const { calls, w } = readingTable({ 'market-intelligence': MARKET });
    const ui = await mountForm(h(mod.default, { form: comp, cycle: 'validate', slug: 'market-intelligence', onSubmit: (v) => comp.submit(w, P, v), onClose() {}, searchDelay: 0, onSearch: (_f, q) => comp.search(w, P, q) }));
    try {
      const box = ui.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).name === 'company');
      await act(async () => propsOf(box).onChange({ target: { value: 'acme' } }));
      await ui.flush();
      await ui.click('Acme Analytics');
      await ui.submit();
      assert.equal(calls.find((c) => c[0] === 'competitor')[2].directory_uid, 'dir-acme');
      assert.ok(textOf(ui.by('cycle-form-found-company') ?? { childNodes: [] }) === '', 'the matches close once one is picked');
    } finally { await ui.unmount(); }
  }, [
    ["[field.name]: { into: option.into || field.search.into, value: option.value, label: option.label }", "[field.name]: { into: field.search.into, value: option.value, label: option.label }"],
    ['.filter(([name, p]) => values[name] === p.label)', '.filter(() => false)'],
    ["setFound((old) => ({ ...old, [field.name]: [] }));\n    },\n  };", "    },\n  };"],
  ]);
});

/** The record's own Edit action as #1692 declares it (`services/records/validate.ts`), with the shapes it sends. */
const RECORD_EDITS = {
  'market-intelligence': { id: 'cand-7', fields: [
    { key: 'kind', kind: 'CH', value: 'direct' }, { key: 'watch', kind: 'CK', value: ['funding', 'hiring'] },
    { key: 'price_position', kind: 'CH', value: 'lower' }, { key: 'why', kind: 'T', value: '' },
  ], change: [['kind', 'adjacent']], method: 'competitorUpdate', body: { kind: 'adjacent', watch: { funding: true, launch: false, hiring: true }, why: null } },
  'demand-signals': { id: 'signal-4', fields: [
    { key: 'kind', kind: 'CH', value: 'pre_sale' }, { key: 'who', kind: 'T', value: 'Harbour Works' }, { key: 'amount_cents', kind: 'T', value: '' },
    { key: 'signal_date', kind: 'T', value: '2026-10-12' }, { key: 'status', kind: 'CH', value: 'confirmed' },
  ], change: [], method: 'signalUpdate', body: { kind: 'pre_sale', who: 'Harbour Works', amount_cents: null, currency: null, signal_date: '2026-10-12', status: 'confirmed' } },
  'ideal-customer-profile': { id: '12', fields: [
    { key: 'name', kind: 'T', value: 'Finance leads' }, { key: 'urgency', kind: 'CH', value: 'high' }, { key: 'score_since', kind: 'T', value: '2026-09-01' },
  ], change: [], method: 'segmentUpdate', body: { name: 'Finance leads', urgency: 'high', score_since: '2026-09-01' } },
};

async function assertFromRecord(m, rm) {
  for (const [slug, c] of Object.entries(RECORD_EDITS)) {
    const edit = m.EDITS.validate[slug];
    const record = { id: c.id, actions: [{ key: 'edit', kind: 'form', form: { fields: c.fields } }] };
    const spec = rm.recordFormFor(rm.recordEditAction(record), record, edit);
    assert.ok(spec, slug);
    assert.equal(spec.id, c.id);
    const ui = await mountRead(spec.form, slug, {}, { current: spec.current, id: spec.id });
    try {
      for (const [name, value] of c.change) await ui.choose(name, value);
      await ui.submit();
      assert.deepEqual(ui.sends(c.method), [[c.method, P, c.id, c.body]], `${slug}: through valuesOf, as a row's edit`);
    } finally { await ui.unmount(); }
  }
  // An empty amount is no amount, never "0"; a list of watched keys is read as the switches.
  assert.equal(m.EDITS.validate['demand-signals'].valuesOf({ edit: { amount_cents: '' } }).amount, '');
  assert.deepEqual(m.EDITS.validate['market-intelligence'].valuesOf({ edit: { watch: ['launch'] } }).watch, ['launch']);
  assert.deepEqual(m.EDITS.validate['market-intelligence'].valuesOf({ edit: { watch: { funding: true, launch: false } } }).watch, ['funding']);
  // A record with no Edit action opens none; an Edit that does not read its record keeps the raw values.
  assert.equal(rm.recordEditAction({ actions: [{ key: 'delete', kind: 'write' }] }), null);
  const growRecord = { id: 'u1', uid: 'u1' };
  assert.deepEqual(rm.recordFormFor({ key: 'edit', kind: 'form', form: { fields: [{ key: 'status', value: 'open' }] } }, growRecord, m.EDITS.grow['product-improvement']).current, { status: 'open' });
}

test('6 (PR 2b): a Validate Edit opened from its record goes through its valuesOf and editFieldsFor, whatever shape the record sends', async () => {
  const rm = await import('../src/pages/cycles/recordModel.js');
  await assertFromRecord(m0, rm);
  await mutationCheck(source, path, (m) => assertFromRecord(m, rm), [
    ["    if (Array.isArray(e.watch)) v.watch = WATCH.map((o) => o.value).filter((k) => e.watch.includes(k));\n    else if", '    if'],
    ["e.amount_cents == null || e.amount_cents === '' ? ''", "e.amount_cents == null ? ''"],
  ]);
  await mutationCheck(recordModelSource, recordModelPath, (rmm) => assertFromRecord(m0, rmm), [
    ['    if (edit.readsRecord) {', '    if (false) {'],
    ["export const recordEditAction = (record) => (record?.actions ?? []).find((action) => action?.key === 'edit' && action.kind === 'form') ?? null;",
      "export const recordEditAction = (record) => (record?.actions ?? [])[0] ?? null;"],
  ]);
});

async function assertValidateWrites(m) {
  const sent = [];
  const w = m.makeCycleWrites(async (url, opts = {}) => { sent.push([url, opts.method ?? 'GET', opts.body ? JSON.parse(opts.body) : null]); return {}; });
  for (const [name, args] of [['theme', [{ title: 't' }]], ['themeUpdate', [7, { title: 't' }]], ['segment', [{ name: 's' }]], ['segmentUpdate', [12, { urgency: 'low' }]],
    ['competitor', [{ name: 'c' }]], ['competitorUpdate', ['cand-7', { kind: 'direct' }]], ['signal', [{ kind: 'waitlist' }]], ['signalUpdate', ['signal-4', { status: 'confirmed' }]],
    ['hypothesis', [{ claim: 'h' }]], ['hypothesisUpdate', [9, { claim: 'h' }]]]) await w.validate[name](P, ...args);
  await w.formOptions('validate', P, 'problem-discovery');
  await w.formOptions('validate', P, 'market-intelligence', { q: 'acme' });
  assert.deepEqual(sent.map(([url, method]) => `${method} ${url}`), [
    'POST /cycles/validate/themes?project=3', 'PATCH /cycles/validate/themes/7?project=3',
    'POST /cycles/validate/segments?project=3', 'PATCH /cycles/validate/segments/12?project=3',
    'POST /cycles/validate/competitors?project=3', 'PATCH /cycles/validate/competitors/cand-7?project=3',
    'POST /cycles/validate/demand-signals?project=3', 'PATCH /cycles/validate/demand-signals/signal-4?project=3',
    'POST /cycles/validate/hypotheses?project=3', 'PATCH /cycles/validate/hypotheses/9?project=3',
    'GET /cycles/validate/modules/problem-discovery/form-options?project=3',
    'GET /cycles/validate/modules/market-intelligence/form-options?project=3&q=acme',
  ]);
  assert.deepEqual(sent[0][2], { title: 't' }, 'the body as given; the venture is in the query');
}

test('11 (PR 2b): each Validate write calls its spelled-out route with ?project=N, and the drift check reads each one', async () => {
  const writesSourceText = readFileSync(new URL('../src/' + writesPath, import.meta.url), 'utf8');
  await mutationCheck(writesSourceText, writesPath, assertValidateWrites, [
    ["signal: (projectId, body) => request(`/cycles/validate/demand-signals?${q(projectId)}`,", "signal: (projectId, body) => request(`/cycles/validate/demand-signals`,"],
    ["competitorUpdate: (projectId, id, body) => request(`/cycles/validate/competitors/${seg(id)}?${q(projectId)}`, { method: 'PATCH',", "competitorUpdate: (projectId, id, body) => request(`/cycles/validate/competitors/${seg(id)}?${q(projectId)}`, { method: 'PUT',"],
  ]);
  const calls = extractClientCalls(writesSourceText).map((c) => `${c.method} ${normalizePath(c.path)}`);
  for (const want of ['POST /cycles/validate/themes', 'PATCH /cycles/validate/themes/:p', 'POST /cycles/validate/competitors', 'PATCH /cycles/validate/demand-signals/:p',
    'PATCH /cycles/validate/hypotheses/:p', 'GET /cycles/:p/modules/:p/form-options']) assert.ok(calls.some((c) => c.endsWith(want)), want);
});
