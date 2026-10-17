/**
 * D695 (S03-B, #1657) PR 1: Grow's seven canvas forms (CO:324-330), their
 * Edits, their client writes and Team expansion's Add.
 *
 * Each form is mounted in the real `FormLightbox` with a stubbed write table,
 * so these are the words a founder reads and the bodies #1697's routes
 * receive (`cycle_adapters_d661.test.ts` sends the same bodies through the
 * real routes). Test 1: the canvas copy, byte for byte, with D691.md's
 * wording where it rewords one. Test 7: each Grow field. Test 8: Team
 * expansion's Add and Log feedback's foot. Test 9: the Edits. Test 10: the
 * client writes. Each group runs on `forms.js`, on mutants of it that must
 * fail, and again. Raise's half is PR 2's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { extractClientCalls, normalizePath } from '../../scripts/lib/apiModules.mjs';
import { cycleFills, cycleRouteSource } from './_cycleBands.mjs';
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

const path = 'pages/cycles/forms.js';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const writesPath = 'lib/api/cycleWrites.js';
const writesSource = readFileSync(new URL('../src/' + writesPath, import.meta.url), 'utf8');
const P = 7;
const SLUGS = ['product-improvement', 'distribution', 'revenue-and-traction', 'team-expansion', 'partner-network', 'market-expansion', 'durable-company-building'];

/** A write table that records each Grow call and answers as a route would. */
function writeTable() {
  const calls = [];
  const grow = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { uid: 'u1', id: 1 }; } });
  return { calls, w: { grow } };
}

async function mount(form, { slug, current = null, id = null, search = '' } = {}) {
  const { calls, w } = writeTable();
  const onSubmit = (v) => (id == null ? form.submit(w, P, v) : form.submit(w, P, id, v));
  const ui = await mountForm(h(FormLightbox, { form, current, cycle: 'grow', slug, search, onSubmit, onClose() {} }));
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const radios = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio');
  const checks = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'checkbox');
  // A check row toggles through its own input, as a chip does.
  const tick = (name, value) => ui.choose(name, value);
  // Feedback's box is named `body`, which is also the Lightbox body's test id, so it is found by name.
  const typeIn = async (name, value) => {
    const node = inputs().find((n) => propsOf(n).name === name);
    assert.ok(node, name);
    await act(async () => propsOf(node).onChange({ target: { value } }));
  };
  return { ...ui, calls, inputs, radios, checks, tick, typeIn };
}
const form = (m, slug) => m.FORMS.grow[slug][0];

// ---------- Test 1: the canvas copy ------------------------------------------

/** CO:324-330, brackets removed and money in dollars (#1656's decision 3), with D691.md's KPI note. */
const COPY = {
  'product-improvement': {
    title: 'Log feedback', cta: 'Log feedback', sub: 'Feedback from a customer, an investor or the team, grouped by theme.', foot: null,
    labels: ['Feedback', 'Source', 'From', 'Theme', 'Links to roadmap item', 'Then'],
    chips: { source: [['Customer', 'Investor', 'Team'], 'customer'], theme_choice: [['New theme'], 'new'], roadmap_item_ref: [['None yet'], ''] },
    checks: { then: [['Tell them when it ships', true]] },
    placeholders: ['What they said', 'Name', 'Company'],
  },
  distribution: {
    title: 'Add channel', cta: 'Add channel', sub: 'A channel with its spend, so cost per customer can be read.', foot: 'Customers acquired are attributed to it.',
    labels: ['Channel', 'Name', 'State', 'Spend · 30 days', 'Bar'],
    chips: { kind: [['Content', 'Paid search', 'Paid social', 'Outbound', 'Referral', 'Partner', 'Events', 'Other'], 'content'], state: [['Testing', 'Active', 'Paused'], 'testing'] },
    placeholders: ['Channel name', '$1,440', 'Strong when CAC under $200'],
  },
  'revenue-and-traction': {
    title: 'Enter a KPI', cta: 'Save KPI', sub: 'A figure by hand, with its source. Connected sources fill the rest.', foot: 'A connected source overrides a hand entry.',
    labels: ['KPI', 'Value', 'As of', 'Source', 'Note'],
    chips: { kpi: [['MRR', 'Customers', 'Churn', 'Expansion MRR', 'Burn', 'Runway', 'Custom'], 'mrr'], source: [['Entered by hand'], 'manual'] },
    notes: ['Stripe shows here once connected.', 'Expansion MRR is worked out from the revenue ledger. Runway is worked out from cash and burn.'],
    placeholders: ['$38,400', 'Optional'],
  },
  'team-expansion': {
    title: 'Open a role', cta: 'Open role', sub: 'A role with its team and the stage it is at.', foot: 'Applicants land in the pipeline.',
    labels: ['Role', 'Team', 'Type', 'Target start', 'Compensation band', 'Post to'],
    chips: { team: [['Engineering', 'Product', 'Go-to-market', 'Operations'], 'Engineering'], type: [['Full-time', 'Part-time', 'Contract', 'Fractional'], 'full_time'] },
    checks: { post_to: [['Axal jobs board', true]] },
    placeholders: ['Title', '$90k–$120k', 'equity 0.5%'],
  },
  'partner-network': {
    title: 'Add partner', cta: 'Add partner', sub: 'A partner with its type, stage and terms.', foot: 'Revenue they source is attributed to them.',
    labels: ['Partner', 'Type', 'Stage', 'Terms', 'Contact'],
    chips: { type: [['Reseller', 'Integration', 'Agency', 'Referral', 'Co-marketing'], 'reseller'], stage: [['Talking', 'Terms', 'Signed', 'Paused'], 'talking'],
      terms_kind: [['Rev-share', 'Services fee', 'Referral fee', 'None yet'], 'none'] },
    placeholders: ['Company', 'Name', 'email'],
  },
  'market-expansion': {
    title: 'Add market', cta: 'Add market', sub: 'A market served or considered, scored on four parts with sources.', foot: 'Readiness is scored out of 40.',
    labels: ['Market', 'State', 'Score with sources', 'Attach'],
    chips: { state: [['Considering', 'Served'], 'considering'], geography_ref: [['Nothing yet'], ''] },
    checks: { parts: [['Demand evidence', true], ['Regulation', false], ['Partners', true], ['Cost to enter', false]] },
    placeholders: ['Country or region'],
  },
  'durable-company-building': {
    title: 'Add obligation', cta: 'Add obligation', sub: 'Governance, compliance or risk, with an owner and a date.', foot: 'Appears on the compliance calendar.',
    labels: ['Obligation', 'Kind', 'Due', 'Owner', 'Repeats', 'Remind'],
    chips: { kind: [['Governance', 'Compliance', 'Risk', 'Culture'], 'governance'], repeats: [['Once', 'Monthly', 'Quarterly', 'Yearly'], 'quarterly'] },
    checks: { remind: [['14 days before', true], ['The day before', true]] },
    placeholders: ['Board meeting, filing, review…', 'Name'],
  },
};
const strings = (f) => {
  const out = [f.title, f.sub, f.foot, f.cta, f.button];
  const walk = (fields) => (fields || []).forEach((x) => {
    out.push(x.k, x.ph, typeof x.note === 'string' ? x.note : '', x.empty);
    for (const o of x.opts || []) out.push(o.label, o.meta);
    walk(x.parts);
  });
  walk(f.fields);
  return out.filter((x) => typeof x === 'string');
};

async function assertCopy(m) {
  assert.deepEqual(Object.keys(m.FORMS.grow), SLUGS, 'every Grow module has its form');
  for (const slug of SLUGS) {
    const want = COPY[slug];
    const f = form(m, slug);
    assert.equal(m.FORMS.grow[slug].length, 1, `${slug}: one Add`);
    assert.equal(f.foot ?? null, want.foot, `${slug}: foot`);
    const ui = await mount(f, { slug });
    try {
      const text = ui.text();
      for (const s of [want.title, want.sub, want.cta, ...want.labels, ...(want.notes ?? []), ...(want.foot ? [want.foot] : [])]) assert.ok(text.includes(s), `${slug}: "${s}"`);
      for (const [name, [labels, def]] of Object.entries(want.chips)) {
        assert.equal(ui.radios(name).length, labels.length, `${slug} ${name}: chip count`);
        for (const l of labels) assert.ok(text.includes(l), `${slug} ${name}: "${l}"`);
        assert.deepEqual(ui.radios(name).filter((n) => propsOf(n).checked).map((n) => propsOf(n).value), [def], `${slug} ${name}: default`);
      }
      for (const [name, rows] of Object.entries(want.checks ?? {})) {
        assert.deepEqual(ui.checks(name).map((n) => propsOf(n).checked), rows.map((r) => r[1]), `${slug} ${name}: defaults`);
        for (const [l] of rows) assert.ok(text.includes(l), `${slug} ${name}: "${l}"`);
      }
      const ph = ui.inputs().map((n) => propsOf(n).placeholder).filter(Boolean);
      for (const p of want.placeholders) assert.ok(ph.includes(p), `${slug}: placeholder "${p}"`);
      assert.ok(!/·\s*required/i.test(text), `${slug}: no required marker`);
    } finally { await ui.unmount(); }
  }
  for (const f of [...Object.values(m.FORMS.grow).flat(), ...Object.values(m.EDITS.grow)]) {
    for (const s of strings(f)) assert.ok(!/[[\]€]/.test(s), `${f.key}: "${s}"`);
  }
  // The records table's Add reads the canvas's LISTS label (CO:630-636).
  assert.deepEqual(SLUGS.map((s) => form(m, s).button), ['Log feedback', 'Add channel', 'Enter a KPI', 'Open a role', 'Add partner', 'Add market', 'Add obligation']);
}

test('1: each Grow form draws the canvas copy, with D691.md\'s KPI note and no foot Log feedback cannot keep yet', async () => {
  await mutationCheck(source, path, assertCopy, [
    ["note: 'Stripe shows here once connected.'", "note: 'Stripe and Accounting show here once connected.'"],
    ["{ kind: 'CH', name: 'repeats', k: 'Repeats', opts: REPEATS, def: 2 }", "{ kind: 'CH', name: 'repeats', k: 'Repeats', opts: REPEATS, def: 0 }"],
    ["['culture', 'Culture']]);\nconst REPEATS", "]);\nconst REPEATS"],
    ["{ kind: 'CH', name: 'terms_kind', k: 'Terms', opts: TERMS_KIND, def: 3 }", "{ kind: 'CH', name: 'terms_kind', k: 'Terms', opts: TERMS_KIND, def: 0 }"],
    ["key: 'kpi', cta: 'Save KPI', button: 'Enter a KPI'", "key: 'kpi', cta: 'Enter a KPI', button: 'Enter a KPI'"],
    ["ph: 'Strong when CAC under $200'", "ph: 'Strong when CAC under [€200]'"],
  ]);
});

// ---------- Test 7: Grow's fields --------------------------------------------

async function assertFields(m) {
  // Log feedback: Their email only while they are to be told.
  const fb = await mount(form(m, 'product-improvement'), { slug: 'product-improvement' });
  try {
    assert.ok(fb.by('cycle-form-from_email'), 'checked by default, so their email is asked');
    await fb.typeIn('body', 'Needs single sign-on');
    await fb.input('from_name', 'Ana'); await fb.input('from_company', 'Acme Test');
    await fb.input('theme', 'Security');
    await fb.input('from_email', 'ana@example.test');
    await fb.submit();
    assert.deepEqual(fb.calls, [['feedback', P, { body: 'Needs single sign-on', source: 'customer', from_name: 'Ana', from_company: 'Acme Test', theme: 'Security',
      roadmap_item_ref: null, notify_on_ship: true, from_email: 'ana@example.test' }]]);
    await fb.tick('then', 'notify');
    assert.ok(!fb.by('cycle-form-from_email'), 'unchecked, no email is asked');
  } finally { await fb.unmount(); }
  assert.equal(form(m, 'product-improvement').toBody({ body: 'x', theme_choice: 'new', then: [], from_email: 'kept@example.test' }).from_email, null, 'no email is kept for someone not to be told');
  assert.equal(form(m, 'product-improvement').toBody({ body: 'x', theme_choice: 'Exports', theme: 'stale' }).theme, 'Exports', 'a chosen theme wins over a typed one');

  // Add channel: no UTM field; spend and bar in the one POST.
  const ch = await mount(form(m, 'distribution'), { slug: 'distribution' });
  try {
    assert.ok(!ch.text().toLowerCase().includes('utm'));
    await ch.input('name', 'Podcasts'); await ch.input('spend', '1,440'); await ch.input('bar', '200');
    await ch.choose('kind', 'paid_social');
    await ch.submit();
    assert.deepEqual(ch.calls, [['channel', P, { name: 'Podcasts', kind: 'paid_social', state: 'testing', spend_cents: 144000, cac_bar_cents: 20000, bar_currency: 'usd' }]]);
  } finally { await ch.unmount(); }
  assert.ok(!Object.hasOwn(form(m, 'distribution').toBody({ name: 'X', bar: '' }), 'bar_currency'), 'no currency without its amount');

  // Add partner: 20% is a percentage, 4,000 an amount a month, None yet hides Amount.
  const pa = await mount(form(m, 'partner-network'), { slug: 'partner-network' });
  try {
    assert.ok(!pa.by('cycle-form-amount'), 'None yet hides Amount');
    assert.ok(!/revenue/i.test(pa.text().replace('Revenue they source is attributed to them.', '')), 'no revenue field');
    await pa.input('name', 'Initech');
    await pa.choose('terms_kind', 'rev_share');
    await pa.input('amount', '20%');
    await pa.submit();
    await pa.input('amount', '4,000');
    await pa.submit();
    assert.deepEqual(pa.calls.map((c) => c[2]), [
      { name: 'Initech', type: 'reseller', stage: 'talking', terms_kind: 'rev_share', terms_pct: 20, contact_name: null, contact_email: null },
      { name: 'Initech', type: 'reseller', stage: 'talking', terms_kind: 'rev_share', terms_amount_cents: 400000, terms_currency: 'usd', contact_name: null, contact_email: null },
    ]);
  } finally { await pa.unmount(); }

  // Add market: a checked row reveals its score and source; Attach sends the geography.
  const mk = await mount(form(m, 'market-expansion'), { slug: 'market-expansion' });
  try {
    assert.ok(mk.by('cycle-form-demand_score') && !mk.by('cycle-form-regulation_score'));
    await mk.tick('parts', 'regulation');
    assert.ok(mk.by('cycle-form-regulation_score'), 'checking Regulation reveals its score');
    await mk.input('name', 'Portugal'); await mk.input('regulation_score', '6');
    await mk.submit();
    assert.equal(mk.calls.length, 0, 'a score needs its source');
    assert.ok(mk.text().includes('The regulation score needs its source.'));
    await mk.input('regulation_source', 'Counsel memo');
    await mk.submit();
    assert.deepEqual(mk.calls[0][2], { name: 'Portugal', state: 'considering', demand_score: null, demand_source: null, regulation_score: 6, regulation_source: 'Counsel memo', partners_score: null, partners_source: null });
  } finally { await mk.unmount(); }
  assert.equal(form(m, 'market-expansion').toBody({ name: 'P', geography_ref: 'PT' }).geography_ref, 'PT');

  // Enter a KPI: Custom reveals a name and a unit; disabled KPIs; no source; ?kpi= fixes it.
  const kp = await mount(form(m, 'revenue-and-traction'), { slug: 'revenue-and-traction' });
  try {
    for (const k of ['expansion_mrr', 'runway']) assert.equal(propsOf(kp.radios('kpi').find((n) => propsOf(n).value === k)).disabled, true, `${k} is not entered by hand`);
    assert.ok(!kp.by('cycle-form-label'));
    await kp.input('value', '38,400'); await kp.input('as_of', '2026-10-12');
    await kp.submit();
    assert.deepEqual(kp.calls[0], ['kpi', P, { kpi: 'mrr', value: 38400, as_of: '2026-10-12', note: null }], 'US dollars, not cents, and no source');
    await kp.choose('kpi', 'custom');
    assert.ok(kp.by('cycle-form-label'), 'Custom reveals a name');
    await kp.input('label', 'Pilots'); await kp.choose('unit', 'pct');
    await kp.submit();
    assert.deepEqual(kp.calls[1][2], { kpi: 'custom', value: 38400, as_of: '2026-10-12', note: null, label: 'Pilots', unit: 'pct' });
  } finally { await kp.unmount(); }
  const fixed = await mount(form(m, 'revenue-and-traction'), { slug: 'revenue-and-traction', search: '?kpi=net_burn' });
  try { assert.deepEqual(fixed.radios('kpi').filter((n) => propsOf(n).checked).map((n) => propsOf(n).value), ['net_burn']); } finally { await fixed.unmount(); }
  assert.deepEqual(form(m, 'revenue-and-traction').fromQuery(new URLSearchParams('kpi=runway')), {}, 'a KPI worked out by the platform is never fixed');

  // Open a role: no LinkedIn row, publish by default, the band in cents.
  const ro = await mount(form(m, 'team-expansion'), { slug: 'team-expansion' });
  try {
    assert.ok(!/linkedin/i.test(ro.text()));
    await ro.input('title', 'Founding engineer'); await ro.input('band', '90,000–120,000'); await ro.input('equity', '0.5');
    await ro.choose('type', 'fractional');
    await ro.submit();
    assert.deepEqual(ro.calls[0][2], { title: 'Founding engineer', team: 'Engineering', type: 'fractional', target_start: null,
      comp_min_cents: 9000000, comp_max_cents: 12000000, comp_currency: 'usd', equity_pct: 0.5, publish: true });
    await ro.input('band', '120k-90k');
    await ro.submit();
    assert.equal(ro.calls.length, 1, 'a band that ends below its start is not sent');
  } finally { await ro.unmount(); }
  assert.deepEqual(m.bandCents('$90k–$120k'), { min: 9000000, max: 12000000 });
  assert.deepEqual(m.bandCents('95,000'), { min: 9500000, max: 9500000 });

  // Add obligation: Culture, Quarterly, both reminders, a required Due.
  const ob = await mount(form(m, 'durable-company-building'), { slug: 'durable-company-building' });
  try {
    await ob.input('title', 'Board meeting');
    await ob.submit();
    assert.equal(ob.calls.length, 0); assert.ok(ob.text().includes('Due is required.'));
    await ob.input('due_at', '2026-12-12'); await ob.choose('kind', 'culture');
    await ob.submit();
    assert.deepEqual(ob.calls[0][2], { title: 'Board meeting', kind: 'culture', due_at: '2026-12-12', owner_name: null, repeats: 'quarterly', remind_days: [14, 1] });
  } finally { await ob.unmount(); }

  // No body carries a bare `currency`, and Add market's no size.
  for (const slug of SLUGS) {
    const body = form(m, slug).toBody({ name: 'N', title: 'T', body: 'B', bar: '1', amount: '4,000', terms_kind: 'rev_share', band: '1', value: '1' });
    assert.ok(!Object.hasOwn(body, 'currency'), `${slug}: no bare currency`);
    assert.ok(!Object.hasOwn(body, 'size_currency') && !Object.hasOwn(body, 'size_cents'), `${slug}: no size`);
  }
}

test('7: Grow\'s fields send the bodies #1697\'s writers read', async () => {
  await mutationCheck(source, path, assertFields, [
    ["when: { name: 'then', value: NOTIFY } }", '}'],
    ["from_email: notify ? str(v.from_email) : null,\n    };\n  },\n  submit: (w, projectId, v) => w.grow.feedback", "from_email: str(v.from_email),\n    };\n  },\n  submit: (w, projectId, v) => w.grow.feedback"],
    ["...(bar == null ? {} : { bar_currency: 'usd' })", "bar_currency: 'usd'"],
    ["if (s.endsWith('%')) return { terms_pct: toNumber(s) };", ''],
    ["when: (v) => Boolean(v.terms_kind) && v.terms_kind !== 'none' }", '}'],
    ["const marketPartsBody = (v) => Object.fromEntries(MARKET_PARTS.filter(([k]) => checkedOf(v.parts, k)).flatMap", 'const marketPartsBody = (v) => Object.fromEntries(MARKET_PARTS.flatMap'],
    ["{ value: 'runway', label: 'Runway', disabled: true }", "{ value: 'runway', label: 'Runway' }"],
    ["...(v.kpi === CUSTOM ? { label: str(v.label), unit: v.unit || 'count' } : {}),", ''],
    ["fromQuery: (q) => (ENTERABLE_KPIS.includes(q.get('kpi')) ? { kpi: q.get('kpi') } : {}),", "fromQuery: (q) => ({ kpi: q.get('kpi') }),"],
    ['return { min, max };\n}', 'return { min: toCents(parts[0]), max: toCents(parts[1] ?? parts[0]) };\n}'],
    ["min != null && max != null && min > max ? { band:", 'false ? { band:'],
    ["publish: checkedOf(v.post_to, POST_AXAL)", 'publish: false'],
    ["remind_days: remindDays(v) }),\n  submit: (w, projectId, v) => w.grow.obligation", "remind_days: v.remind }),\n  submit: (w, projectId, v) => w.grow.obligation"],
  ]);
});

// ---------- Test 8: Team expansion's Add and Log feedback's foot -------------

test('8: Team expansion\'s Add opens Open a role, and Log feedback has a foot only once #1698\'s band is mounted', () => {
  const route = cycleRouteSource();
  assert.ok(!route.includes('/jobs/new'), 'CycleRoute holds no /jobs/new');
  return import('../src/pages/cycles/forms.js').then((m) => {
    assert.equal(m.formFor('grow', 'team-expansion').key, 'role');
    const fills = cycleFills(route, 'grow');
    assert.equal(Boolean(form(m, 'product-improvement').foot), Object.hasOwn(fills, 'product-improvement'),
      '"Themes are proposed by Eadwyn; you accept." is drawn only while the band proposes them');
  });
});

// ---------- Test 9: the Edits ------------------------------------------------

const EDIT_TITLES = { 'product-improvement': 'Edit feedback', distribution: 'Edit channel', 'revenue-and-traction': 'Enter a KPI', 'team-expansion': 'Edit role',
  'partner-network': 'Edit partner', 'market-expansion': 'Edit market', 'durable-company-building': 'Edit obligation' };

async function assertEdits(m) {
  assert.deepEqual(Object.keys(m.EDITS.grow), SLUGS);
  for (const slug of SLUGS) {
    const e = m.EDITS.grow[slug];
    assert.equal(e.title, EDIT_TITLES[slug]); assert.equal(e.cta, 'Save');
  }
  // A row that lacks a field, saved untouched, sends no key for it.
  const fbEdit = m.EDITS.grow['product-improvement'];
  const fbRow = { id: 'u1', edit: { uid: 'u1', status: 'open', theme: 'Exports', roadmap_item_label: null } };
  const fb = await mount(fbEdit, { slug: 'product-improvement', current: fbEdit.valuesOf(fbRow), id: fbEdit.idOf(fbRow) });
  try {
    assert.ok(fb.text().includes('Edit feedback') && fb.text().includes('Save'));
    await fb.choose('status', 'shipped');
    await fb.submit();
    assert.deepEqual(fb.calls, [['feedbackUpdate', P, 'u1', { theme: 'Exports', roadmap_item_label: null, status: 'shipped' }]]);
  } finally { await fb.unmount(); }
  // Edit role: only what was typed; no Post to from a row.
  const roEdit = m.EDITS.grow['team-expansion'];
  const ro = await mount(roEdit, { slug: 'team-expansion', current: roEdit.valuesOf({ id: 5 }), id: roEdit.idOf({ id: 5, recordId: '5' }) });
  try {
    assert.ok(!ro.text().includes('Post to'));
    await ro.choose('team', 'Product');
    await ro.submit();
    assert.deepEqual(ro.calls, [['roleUpdate', P, 5, { team: 'Product' }]], 'no title, band or publish key');
  } finally { await ro.unmount(); }
  assert.equal(roEdit.idOf({ id: 'row-1', edit: { id: 7 } }), 7, 'a record passed as { edit: { id } }');
  // Enter by hand posts a new value with the KPI fixed.
  const kpEdit = m.EDITS.grow['revenue-and-traction'];
  assert.equal(kpEdit.button, 'Enter by hand');
  assert.equal(kpEdit.idOf({ id: 'kpi-0-MRR', recordId: 'mrr' }), 'mrr');
  assert.equal(kpEdit.idOf({ id: 'kpi-3-Runway', recordId: 'runway' }), null, 'absent for a KPI that is not enterable');
  assert.equal(kpEdit.idOf({ id: 'custom-ab12' }), 'custom-ab12');
  const kp = await mount(kpEdit, { slug: 'revenue-and-traction', id: 'mrr' });
  try {
    assert.ok(!kp.radios('kpi').length, 'the KPI is fixed');
    await kp.input('value', '40,000'); await kp.input('as_of', '2026-10-13');
    await kp.submit();
    assert.deepEqual(kp.calls, [['kpi', P, { kpi: 'mrr', value: 40000, as_of: '2026-10-13', note: null }]]);
  } finally { await kp.unmount(); }
  // Edit feedback, Edit market and Edit obligation keep Status, Decision and State.
  const names = (f) => (f.fields || []).flatMap((x) => (x.parts ? x.parts.map((p) => p.name) : [x.name]));
  assert.ok(names(m.EDITS.grow['product-improvement']).includes('status'));
  assert.ok(names(m.EDITS.grow['market-expansion']).includes('decision'));
  assert.ok(names(m.EDITS.grow['durable-company-building']).includes('status'));
  // A stored value the Add does not offer is still a choice on Edit.
  const opts = (f, n) => f.fields.find((x) => x.name === n).opts.map((o) => o.value);
  assert.ok(opts(m.EDITS.grow['partner-network'], 'type').includes('other') && !opts(form(m, 'partner-network'), 'type').includes('other'));
  assert.ok(opts(m.EDITS.grow['durable-company-building'], 'kind').includes('tax'));
  // Edit market: a scored part is checked and sent; an untouched channel kind is not.
  const mkEdit = m.EDITS.grow['market-expansion'];
  const mkRow = { id: 'm1', edit: { uid: 'm1', state: 'served', decision: null, demand_score: 7, demand_source: 'Waitlist', regulation_score: null, regulation_source: null, partners_score: null, partners_source: null, cost_score: null, cost_source: null } };
  assert.deepEqual(mkEdit.valuesOf(mkRow).parts, ['demand']);
  const chEdit = m.EDITS.grow.distribution;
  assert.deepEqual(chEdit.toBody({ name: 'Podcasts', state: 'paused', kind: '', spend: '', bar: '' }), { name: 'Podcasts', state: 'paused' });
}

test('9: each Grow Edit sends only what its row carried or the founder filled', async () => {
  await mutationCheck(source, path, assertEdits, [
    ['return carried.includes(f) || filled(v[f]);', 'return true;'],
    ["const bare = ({ def: _def, required: _required, ...f }) => f;", 'const bare = (f) => f;'],
    ["    return ENTERABLE_KPIS.includes(id) || /^custom-[a-z0-9]+$/.test(id) ? id : null;", '    return id || null;'],
    ["  toBody: (v, key) => kpiBody({ ...v, kpi: key }),", '  toBody: (v) => kpiBody(v),'],
    ["key: 'edit-role',\n  title: 'Edit role',", "key: 'edit-role',\n  title: 'Edit a role',"],
    ["withChips(partner.fields[1], [['other', 'Other']])", 'bare(partner.fields[1])'],
    ['const scored = MARKET_PARTS.map(([k]) => k).filter((k) => e[`${k}_score`] != null);', 'const scored = [];'],
  ]);
});

// ---------- Test 10: the client writes ---------------------------------------

async function assertWrites(m) {
  const sent = [];
  const w = m.makeCycleWrites(async (url, opts = {}) => { sent.push([url, opts.method ?? 'GET', opts.body ? JSON.parse(opts.body) : null]); return {}; });
  await w.grow.kpi(P, { kpi: 'mrr', value: 1 });
  await w.grow.role(P, { title: 'Engineer' });
  await w.grow.roleUpdate(P, 12, { team: 'Product' });
  assert.deepEqual(sent, [
    ['/cycles/grow/kpis', 'POST', { kpi: 'mrr', value: 1, project: P }],
    ['/cycles/grow/roles', 'POST', { title: 'Engineer', project: P }],
    ['/cycles/grow/roles/12', 'PATCH', { team: 'Product', project: P }],
  ], 'Grow takes the venture in the body');
}

test('10: Enter a KPI and Open a role call #1697\'s spelled-out routes, with the venture in the body', async () => {
  await mutationCheck(writesSource, writesPath, assertWrites, [
    ["kpi: (projectId, body) => request('/cycles/grow/kpis', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),", "kpi: (projectId, body) => request('/cycles/grow/kpi', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),"],
    ["roleUpdate: (projectId, id, body) => request(`/cycles/grow/roles/${seg(id)}`, { method: 'PATCH',", "roleUpdate: (projectId, id, body) => request(`/cycles/grow/roles/${seg(id)}`, { method: 'PUT',"],
    ["role: (projectId, body) => request('/cycles/grow/roles', { method: 'POST', body: JSON.stringify({ ...body, project: projectId }) }),", "role: (projectId, body) => request(`/cycles/grow/roles?project=${projectId}`, { method: 'POST', body: JSON.stringify(body) }),"],
  ]);
  // The drift check reads each call as the route it names.
  const calls = extractClientCalls(writesSource).map((c) => `${c.method} ${normalizePath(c.path)}`);
  for (const want of ['POST /cycles/grow/kpis', 'POST /cycles/grow/roles', 'PATCH /cycles/grow/roles/:p']) assert.ok(calls.some((c) => c.endsWith(want)), want);
  assert.ok(!calls.some((c) => /\/cycles\/(raise|grow)\/modules\/[^:]+\/form-options/.test(c)), 'no form-options path with a literal cycle');
});
