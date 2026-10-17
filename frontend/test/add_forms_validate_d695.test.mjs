/**
 * D695 PR 2a (#1656): Validate's five canvas forms (CO:306-310) and their
 * Edits as specs, registered nowhere until PR 2b (decision 15).
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
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

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
    ['watch: watchBody(v), why: str(v.why) };\n  },\n  submit: (w, projectId, v) => w.validate.competitor', 'watch: v.watch, why: str(v.why) };\n  },\n  submit: (w, projectId, v) => w.validate.competitor'],
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

// ---------- Registered nowhere (decision 15) ---------------------------------

test('15: no Validate form is registered, and no Validate write method is added, before PR 2b', () => {
  // D693 (#1704) registers Verdict's Record a decision first, by its issue's
  // rule; PR 2b adds these five beside it.
  assert.deepEqual(Object.keys(m0.FORMS.validate ?? {}), ['verdict']);
  assert.equal(Object.hasOwn(m0.EDITS, 'validate'), false);
  for (const { slug } of MODULES.validate.filter((m) => m.slug !== 'verdict')) {
    assert.equal(m0.formFor('validate', slug), null, `${slug}: no Add opens yet`);
    assert.equal(m0.editFor('validate', slug), null, `${slug}: no Edit draws yet`);
  }
  assert.ok(!/\bvalidate:\s*\{/.test(writes), 'cycleWrites.js has no validate group');
  for (const f of Object.values(m0.VALIDATE_FORMS).flat()) assert.match(f.key, /^[a-z0-9][a-z0-9-]*$/);
  assert.deepEqual(Object.values(m0.VALIDATE_EDITS).map((f) => f.key), ['edit-theme', 'edit-segment', 'edit-competitor', 'edit-signal', 'edit-hypothesis']);
});
