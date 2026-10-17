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
import { FORMS } from '../src/pages/cycles/forms.js';
import { h, mountForm, mutationCheck, propsOf, textOf } from './_form_d695.mjs';

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
    title: 'Log feedback', cta: 'Log feedback', sub: 'Feedback from a customer, an investor or the team, grouped by theme.',
    // #1698's band proposes themes, so the canvas foot (CO:324) is true and drawn; test 8 holds the pair.
    foot: 'Themes are proposed by Eadwyn; you accept.',
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

test('1: each Grow form draws the canvas copy, with D691.md\'s KPI note and Log feedback\'s foot once its band proposes themes', async () => {
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

// =============================================================================
// PR 2: Raise's seven canvas forms (CO:317-323), their Edits and client writes
// =============================================================================

const RAISE_SLUGS = ['fundraising-readiness', 'investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships'];
const SECTION_LABELS = ['Product & engineering', 'GTM: sales and marketing', 'Infrastructure & data', 'Operations, legal & compliance', 'Hiring / runway reserve'];
/** What each module's `form-options` answers (D691.md "The closing PR"), with made-up names. */
const REPLIES = {
  'fundraising-readiness': { items: [
    { value: 'narrative', last_scored: '2026-10-12' }, { value: 'deck', last_scored: '2026-10-12' }, { value: 'data_room', last_scored: '2026-10-09' },
    { value: 'cap_table', last_scored: '2026-10-01' }, { value: 'use_of_funds', last_scored: '2026-10-03' }, { value: 'traction', last_scored: null },
    { value: 'team', last_scored: '2026-10-01', by_hand: true },
  ] },
  'investor-narrative': { versions: [{ value: '2', label: 'v2 · angel' }, { value: '3', label: 'v3 · seed fund' }] },
  'pitch-deck': { decks: [{ value: '41', label: 'v4 · current' }, { value: '40', label: 'v3' }], prospects: [{ value: '5', label: 'Northwind Capital' }] },
  'data-room': {
    project_uid: 'p-kestrel',
    folders: [{ value: 'fo3', label: 'Financials' }, ...['Legal', 'Team', 'Product', 'Customers'].map((n) => ({ folder_name: n, label: n }))],
    requests: [{ value: '7', label: 'Customer contracts' }], checklist: [{ value: 'cap_table', label: 'Cap table' }],
  },
  'cap-table': { prospects: [{ value: '5', label: 'Northwind Capital' }] },
  'use-of-funds': {
    sections: ['product', 'go-to-market', 'infrastructure', 'operations', 'reserve'].map((value, i) => ({ value, pct: [40, 30, 10, 10, 10][i], milestone_label: i ? null : 'Launch v2', milestone_by: i ? null : '2027-03' })),
    amount_to_raise: 1500000, runway_months: 24,
  },
  'capital-relationships': { warm_paths: [{ value: 'Lin Park · Harbour Labs' }, { value: 'Sam Lee' }] },
};

/** Raise's write table: each call recorded; `formOptions` answers each module's reply, or its refusal. */
function raiseTable(replies, answer) {
  const calls = [];
  const raise = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return answer ? answer(name, ...args) : { id: 1 }; } });
  const formOptions = async (cycle, projectId, slug, query = {}) => {
    calls.push(['formOptions', cycle, projectId, slug, query]);
    const r = replies[slug];
    if (r instanceof Error) throw r;
    return query.q ? { funds: [{ value: 'alder-ventures', label: 'Alder Ventures' }] } : r ?? {};
  };
  return { calls, w: { raise, formOptions } };
}
async function mountRaise(f, slug, { replies = REPLIES, answer, id = null, current = null } = {}) {
  const { calls, w } = raiseTable(replies, answer);
  const onSubmit = (v) => (id == null ? f.submit(w, P, v) : f.submit(w, P, id, v));
  const ui = await mountForm(h(FormLightbox, {
    form: f, current, cycle: 'raise', slug, onSubmit, onClose() {}, searchDelay: 0,
    loadOptions: f.loadOptions ? () => f.loadOptions(w, P, id) : null,
    onSearch: f.search ? (_field, q) => f.search(w, P, q) : null,
  }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const radios = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio');
  const checks = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'checkbox');
  const pick = async (name, files) => {
    const node = inputs().find((n) => propsOf(n).name === name && propsOf(n).type === 'file');
    assert.ok(node, name);
    await act(async () => propsOf(node).onChange({ target: { files } }));
  };
  const typeIn = async (name, value) => {
    const node = inputs().find((n) => propsOf(n).name === name);
    assert.ok(node, name);
    await act(async () => propsOf(node).onChange({ target: { value } }));
    await ui.flush();
  };
  const sends = (name) => calls.filter((c) => c[0] === name);
  return { ...ui, calls, sends, w, inputs, radios, checks, pick, typeIn, tick: (name, value) => ui.choose(name, value) };
}
const raiseForm = (m, slug) => m.FORMS.raise[slug][0];
const RAISE_NAMES = { 'fundraising-readiness': 'Fundraising readiness', 'investor-narrative': 'Investor narrative', 'pitch-deck': 'Pitch deck', 'data-room': 'Data room',
  'cap-table': 'Cap table', 'use-of-funds': 'Use of funds', 'capital-relationships': 'Capital relationships' };
const file = (name, size = 4) => new File([new Uint8Array(size).fill(37)], name, { type: 'application/pdf' });

// ---------- Test 1: Raise's copy ---------------------------------------------

/** CO:317-323, brackets removed and money in dollars, with D691.md decision 11's words where it rewords one. */
const RAISE_COPY = {
  'fundraising-readiness': {
    title: 'Re-score', cta: 'Re-score now', button: 'Re-score',
    sub: 'Re-reads the evidence of each item you tick and rescores it.', foot: 'Scores now, from what is recorded. Earlier scores are kept.',
    labels: ['Items to re-score', 'Evidence read'],
    chips: { since: [['Everything', 'Since the last score'], 'last'] },
    checks: { items: [['Narrative', true], ['Deck', true], ['Data room', true], ['Cap table', true], ['Use of funds', true], ['Traction', true], ['Team', false]] },
    metas: ['last 12 Oct', 'last 9 Oct', 'last 1 Oct', 'last 3 Oct', 'never scored', 'last 1 Oct · scored on its record'], placeholders: [],
  },
  'investor-narrative': {
    title: 'New version', cta: 'Create version', button: 'New version',
    sub: 'One narrative per investor type. Each is checked for consistency.', foot: 'Start from a version or blank; you edit.',
    labels: ['Investor type', 'Start from', 'One-liner', 'Why now', 'The ask', 'Check against'],
    chips: {
      investor_type: [['Angel', 'Pre-seed fund', 'Seed fund', 'Series A fund', 'Strategic', 'Grant', 'Other'], 'seed_fund'],
      start_from: [['v3 · seed fund', 'v2 · angel', 'The live deck', 'Blank'], 'version-3'],
    },
    checks: { check_against: [['Pitch deck', true], ['Metrics', true]] },
    metas: [], placeholders: ['One line', 'Line', '$1.5M for n months'],
  },
  'pitch-deck': {
    title: 'New link', cta: 'Create link', button: 'New link',
    sub: 'A link per investor, with an expiry. Views are tracked per slide.', foot: 'Expired links stop opening; their views stay.',
    labels: ['Investor', 'Deck version', 'Expires', 'Allow'],
    chips: { prospect_id: [['Northwind Capital', 'Type a name'], '5'], deck_id: [['v4 · current', 'v3'], '41'], expires_days: [['7 days', '14 days', '30 days', 'Never'], '30'] },
    checks: { allow: [['Download as PDF', false], ['Forwarding', false]] },
    metas: ['views by others are tracked too'], placeholders: [],
  },
  'data-room': {
    title: 'Upload', cta: 'Upload', button: 'Upload',
    sub: 'Files land in a folder, behind the NDA gate.', foot: 'Access is per investor, per file.',
    labels: ['Files', 'Folder', 'Answers request', 'Access', 'Protect', 'Drop files here, or browse'],
    chips: {
      folder: [['Financials', 'Legal', 'Team', 'Product', 'Customers'], 'fo3'], answers: [['Customer contracts', 'Cap table', 'None'], 'request-7'],
      access_tier: [['Invited investors', 'Committed investors only', 'Nobody yet'], 'invited'],
    },
    checks: { protect: [['Expire access on', false]] },
    metas: [], placeholders: [],
  },
  'cap-table': {
    title: 'Add holder', cta: 'Add holder', button: 'Add holder',
    sub: 'A holder with their group and instrument.', foot: 'Ownership recomputes before and after the planned round.',
    labels: ['Holder', 'Group', 'Instrument', 'Amount or shares', 'Investor in Capital relationships'],
    chips: { group: [['Founders', 'Investors'], 'investors'], instrument: [['SAFE', 'Convertible note'], 'safe'], prospect_id: [['None', 'Northwind Capital'], ''] },
    checks: {}, metas: [], placeholders: ['Name or fund', '$500k', '$8M cap'],
  },
  'use-of-funds': {
    title: 'Edit split', cta: 'Save split', button: 'Edit split',
    sub: 'How the round is spent, by category. Each buys a milestone.', foot: 'The pitch deck fills its use-of-funds slide from this split.',
    labels: ['Amount to raise', ...SECTION_LABELS, 'Milestone · by', 'Runway it buys'],
    chips: { runway: [['18 months', '24 months', 'Custom'], '24'] },
    checks: {}, metas: [], placeholders: ['$1.5M', '%', 'Milestone', 'YYYY-MM'],
  },
  'capital-relationships': {
    title: 'Add investor', cta: 'Add investor', button: 'Add investor',
    sub: 'An investor in the pipeline, with how you reach them.', foot: 'Fit is read from their sector focus and fund size.',
    labels: ['Investor', 'Stage', 'Warm path', 'Next step · due', 'Notes'],
    chips: {
      stage: [['Identified', 'Contacted', 'Meeting', 'Diligence', 'Committed', 'Passed'], 'to_contact'],
      warm_path: [['Lin Park can introduce', 'Sam Lee can introduce', 'No path yet'], 'Lin Park · Harbour Labs'],
    },
    checks: {}, metas: [], placeholders: ['Search funds and angels, or type a name', 'Send deck', 'Fri', 'One line'],
  },
};

async function assertRaiseCopy(m) {
  assert.deepEqual(Object.keys(m.FORMS.raise), RAISE_SLUGS, 'every Raise module has its form');
  for (const slug of RAISE_SLUGS) {
    const want = RAISE_COPY[slug];
    const f = raiseForm(m, slug);
    assert.equal(m.FORMS.raise[slug].length, 1, `${slug}: one Add`);
    assert.deepEqual([f.title, f.cta, f.button, f.sub, f.foot], [want.title, want.cta, want.button, want.sub, want.foot], `${slug}: title, CTA, button, sub, foot`);
    // A venture with no split yet, so Runway it buys shows the canvas's default.
    const ui = await mountRaise(f, slug, { replies: { ...REPLIES, 'use-of-funds': { sections: [] } } });
    try {
      const text = ui.text();
      assert.ok(text.includes(`Raise · ${RAISE_NAMES[slug]}`), `${slug}: the eyebrow`);
      for (const s of [want.title, want.sub, want.cta, want.foot, ...want.labels, ...want.metas]) assert.ok(text.includes(s), `${slug}: "${s}"`);
      for (const [name, [labels, def]] of Object.entries(want.chips)) {
        assert.deepEqual(ui.radios(name).map((n) => textOf(n.parentNode).trim()), labels, `${slug} ${name}: chips`);
        assert.deepEqual(ui.radios(name).filter((n) => propsOf(n).checked).map((n) => propsOf(n).value), [def], `${slug} ${name}: default`);
      }
      for (const [name, rows] of Object.entries(want.checks)) {
        assert.deepEqual(ui.checks(name).map((n) => propsOf(n).checked), rows.map((r) => r[1]), `${slug} ${name}: defaults`);
        for (const [l] of rows) assert.ok(text.includes(l), `${slug} ${name}: "${l}"`);
      }
      const ph = ui.inputs().map((n) => propsOf(n).placeholder).filter(Boolean);
      for (const p of want.placeholders) assert.ok(ph.includes(p), `${slug}: placeholder "${p}"`);
    } finally { await ui.unmount(); }
  }
  for (const f of [...Object.values(m.FORMS.raise).flat(), ...Object.values(m.EDITS.raise)]) {
    for (const s of strings(f)) assert.ok(!/[[\]€]/.test(s), `${f.key}: "${s}"`);
  }
  assert.ok(!strings(raiseForm(m, 'data-room')).some((s) => /watermark/i.test(s)), 'no Watermark row (D-q)');
  assert.ok(!strings(raiseForm(m, 'investor-narrative')).includes('Data room'), 'Data room is not a Check against source');
  assert.ok(!strings(raiseForm(m, 'cap-table')).some((s) => /Option pool|Advisors|Options|Preferred/.test(s)), 'only the pairs #1700 takes');
}

test('1 (Raise): each Raise form draws the canvas copy, with D691.md decision 11\'s words', async () => {
  await mutationCheck(source, path, assertRaiseCopy, [
    ["foot: 'Scores now, from what is recorded. Earlier scores are kept.',", "foot: 'Takes about a minute. Earlier scores are kept.',"],
    ["foot: 'Access is per investor, per file.',", "foot: 'Access is per investor, per folder.',"],
    ["foot: 'Fit is read from their sector focus and fund size.',", "foot: 'Fit is read from their thesis and cheque size.',"],
    ["{ kind: 'CH', name: 'expires_days', k: 'Expires', opts: EXPIRES, def: 2 },", "{ kind: 'CH', name: 'expires_days', k: 'Expires', opts: EXPIRES, def: 0 },"],
    ["{ kind: 'CH', name: 'group', k: 'Group', opts: GROUP, def: 1, required: true },", "{ kind: 'CH', name: 'group', k: 'Group', opts: GROUP, def: 0, required: true },"],
    ["{ kind: 'CH', name: 'runway', k: 'Runway it buys', opts: RUNWAY, def: 1 },", "{ kind: 'CH', name: 'runway', k: 'Runway it buys', opts: RUNWAY, def: 0 },"],
    ["def: 'seed_fund', required: true },", "def: 0, required: true },"],
    ["return [...saved.map((o) => ({ value: VERSION + o.value, label: o.label })), { value: LIVE, label: 'The live deck' }, { value: BLANK, label: 'Blank' }];",
      "return [{ value: LIVE, label: 'The live deck' }, ...saved.map((o) => ({ value: VERSION + o.value, label: o.label })), { value: BLANK, label: 'Blank' }];"],
    ["const CHECK_AGAINST = [{ value: 'deck', label: 'Pitch deck', checked: true }, { value: 'metrics', label: 'Metrics', checked: true }];",
      "const CHECK_AGAINST = [{ value: 'deck', label: 'Pitch deck', checked: true }, { value: 'data_room', label: 'Data room', checked: true }, { value: 'metrics', label: 'Metrics', checked: true }];"],
    ["const CANVAS_FOLDERS = ['Financials', 'Legal', 'Team', 'Product', 'Customers'];", "const CANVAS_FOLDERS = ['Financials', 'Legal', 'Team', 'Product', 'Customers', 'Watermark downloads'];"],
  ]);
});

// ---------- Tests 2-6: Re-score, New version, New link, Upload, split and holder ----------

async function assertRescore(m) {
  const ui = await mountRaise(raiseForm(m, 'fundraising-readiness'), 'fundraising-readiness');
  try {
    const team = ui.checks('items').find((n) => propsOf(n).value === 'team');
    assert.ok(propsOf(team).disabled, 'Team is drawn disabled');
    await ui.tick('items', 'deck');
    await ui.submit();
    assert.deepEqual(ui.sends('rescore'), [['rescore', P, { items: ['narrative', 'data_room', 'cap_table', 'use_of_funds', 'traction'], since: 'last' }]]);
    await ui.choose('since', 'all');
    await ui.submit();
    assert.equal(ui.sends('rescore')[1][2].since, 'all');
  } finally { await ui.unmount(); }
  assert.deepEqual(raiseForm(m, 'fundraising-readiness').toBody({ items: ['team', 'deck'], since: 'last' }).items, ['deck'], 'Team is never sent');
  assert.equal(m.rescoreRows([]).find((r) => r.value === 'narrative').meta, 'never scored');
}

async function assertNarrative(m) {
  let ui = await mountRaise(raiseForm(m, 'investor-narrative'), 'investor-narrative', { replies: { ...REPLIES, 'investor-narrative': { versions: [] } } });
  try {
    assert.deepEqual(ui.radios('start_from').filter((n) => propsOf(n).checked).map((n) => propsOf(n).value), ['live'], 'no saved version: the live deck');
    await ui.input('one_liner', 'Kestrel finds the leak'); await ui.input('why_now', 'Rules changed'); await ui.input('ask', '$1.5M for 18 months');
    await ui.submit();
    assert.deepEqual(ui.sends('narrativeVersion'), [['narrativeVersion', P, {
      investor_type: 'seed_fund', start_from: 'live', one_liner: 'Kestrel finds the leak', why_now: 'Rules changed', ask: '$1.5M for 18 months', check_against: ['deck', 'metrics'],
    }]]);
  } finally { await ui.unmount(); }
  ui = await mountRaise(raiseForm(m, 'investor-narrative'), 'investor-narrative');
  try {
    await ui.choose('start_from', 'version-2');
    await ui.choose('investor_type', 'angel');
    await ui.tick('check_against', 'deck');
    await ui.submit();
    assert.deepEqual(ui.sends('narrativeVersion')[0][2], { investor_type: 'angel', start_from: 'version', based_on_version: 2, one_liner: null, why_now: null, ask: null, check_against: ['metrics'] });
    await ui.choose('start_from', 'blank');
    await ui.submit();
    assert.equal(ui.sends('narrativeVersion')[1][2].start_from, 'blank');
    assert.ok(!Object.hasOwn(ui.sends('narrativeVersion')[1][2], 'based_on_version'));
  } finally { await ui.unmount(); }
}

async function assertLink(m) {
  const answer = (name) => (name === 'deckLink' ? { id: 41, share_path: '/share/deck/tok.abc-1' } : { ok: true });
  let ui = await mountRaise(raiseForm(m, 'pitch-deck'), 'pitch-deck', { answer });
  try {
    await ui.choose('prospect_id', 'typed');
    await ui.submit();
    assert.equal(ui.sends('deckLink').length, 0, 'an empty Investor is refused');
    assert.ok(ui.text().includes('Fund or name is required.'));
    await ui.input('investor_label', 'Juno Angels');
    await ui.choose('expires_days', 'never'); await ui.choose('deck_id', '40'); await ui.tick('allow', 'forwarding');
    await ui.submit();
    assert.deepEqual(ui.sends('deckLink'), [['deckLink', P, { deck_id: 40, investor_label: 'Juno Angels', expires_days: null, allow_download: false, allow_forwarding: true }]]);
    assert.ok(ui.by('cycle-form-done'), 'the done view');
    assert.ok(ui.text().includes('Copy the link now. It is shown only once.'));
    assert.ok(ui.text().includes('/share/deck/tok.abc-1'));
    assert.ok(ui.nodes().some((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Copy link'));
  } finally { await ui.unmount(); }
  ui = await mountRaise(raiseForm(m, 'pitch-deck'), 'pitch-deck', { answer });
  try { assert.ok(!ui.text().includes('/share/deck/'), 'reopened, no link is shown'); } finally { await ui.unmount(); }
  // With no deck: "No deck yet.", a link to build one, and a CTA that cannot be pressed.
  ui = await mountRaise(raiseForm(m, 'pitch-deck'), 'pitch-deck', { replies: { ...REPLIES, 'pitch-deck': { decks: [], prospects: [] } } });
  try {
    assert.ok(ui.text().includes('No deck yet.'));
    const build = ui.nodes().find((n) => n.tagName === 'A' && textOf(n).trim() === 'Build your deck');
    assert.equal(propsOf(build).href, '/raise/pitch');
    assert.ok(propsOf(ui.by('cycle-form-save')).disabled, 'the CTA is disabled');
    await ui.submit();
    assert.equal(ui.sends('deckLink').length, 0);
  } finally { await ui.unmount(); }
  const edit = m.EDITS.raise['pitch-deck'];
  assert.ok(!edit.fields.some((f) => f.name === 'deck_id'), 'Edit link has no Deck version');
  assert.deepEqual(edit.fields.find((f) => f.name === 'expires_days').opts.map((o) => o.value), ['7', '14', '30'], 'no Never: an edit never extends the expiry');
  assert.equal(edit.fields.find((f) => f.name === 'expires_days').note, 'A later expiry needs a new link.');
  assert.equal(m.shareLinkUrl('/share/deck/x', 'https://axal.vc'), 'https://axal.vc/share/deck/x');
  assert.equal(m.shareLinkUrl('https://evil.example/share/deck/x', ''), null);
}

async function assertUpload(m) {
  const refuseSecond = (name, uid, body) => { if (body.name === 'b.pdf') throw new Error('Folder not found'); return { uid: 'f1' }; };
  let ui = await mountRaise(raiseForm(m, 'data-room'), 'data-room');
  try {
    await ui.submit();
    assert.ok(ui.text().includes('Pick a file to upload.'));
    assert.ok(!ui.by('cycle-form-access_expires_at'), 'no date until Expire access is ticked');
    await ui.tick('protect', 'expire');
    assert.ok(ui.by('cycle-form-access_expires_at'));
    await ui.input('access_expires_at', '2026-11-30');
    await ui.choose('access_tier', 'committed');
    await ui.choose('folder', 'name:Legal');
    await ui.pick('files', [file('a.pdf'), file('b.pdf')]);
    await ui.submit();
    const posts = ui.sends('upload');
    assert.equal(posts.length, 2, 'two files, two POSTs');
    for (const [, uid, body] of posts) {
      assert.equal(uid, 'p-kestrel', 'the uid form-options gave');
      assert.deepEqual({ ...body, data: body.data.slice(0, 28) }, { name: body.name, data: 'data:application/pdf;base64,', visibility: 'nda', folder_name: 'Legal', dd_request_id: 7, access_tier: 'committed', access_expires_at: '2026-11-30' });
    }
    assert.ok(!ui.calls.some((c) => /folder/i.test(String(c[0])) && c[0] !== 'formOptions'), 'no folders call');
  } finally { await ui.unmount(); }
  ui = await mountRaise(raiseForm(m, 'data-room'), 'data-room', { answer: refuseSecond });
  try {
    await ui.choose('folder', 'fo3'); await ui.choose('answers', '');
    const big = { name: 'huge.pdf', size: 21 * 1024 * 1024, type: 'application/pdf', arrayBuffer: async () => assert.fail('never read') };
    await ui.pick('files', [file('a.pdf'), big, file('b.pdf')]);
    await ui.submit();
    assert.deepEqual(ui.sends('upload').map((c) => [c[2].name, c[2].folder_uid, c[2].dd_request_id]), [['a.pdf', 'fo3', undefined], ['b.pdf', 'fo3', undefined]], 'the oversize file is never sent');
    assert.equal(textOf(ui.by('cycle-form-refusal')), 'Uploaded a.pdf. huge.pdf: Larger than 20 MB. b.pdf: Folder not found');
  } finally { await ui.unmount(); }
  assert.equal(raiseForm(m, 'data-room').toBody({ protect: [], access_expires_at: '2026-11-30' }, 'a.pdf', 'data:,').access_expires_at, null, 'an expiry only while Expire access is ticked');
}

async function assertSplitAndHolder(m) {
  let ui = await mountRaise(raiseForm(m, 'use-of-funds'), 'use-of-funds');
  try {
    assert.equal(propsOf(ui.by('cycle-form-pct.product')).value, '40', 'it opens with the stored split');
    assert.equal(propsOf(ui.by('cycle-form-milestone_label.product')).value, 'Launch v2');
    assert.equal(propsOf(ui.by('cycle-form-amount_to_raise')).value, '1,500,000');
    assert.ok(ui.text().includes('$600,000 of the raise'), 'each amount worked out from Amount to raise');
    await ui.input('pct.reserve', '5');
    await ui.submit();
    assert.equal(ui.sends('useOfFunds').length, 0);
    assert.ok(ui.text().includes('The split adds up to 95%. It must add up to 100%.'));
    await ui.input('pct.reserve', '10'); await ui.input('milestone_by.reserve', '2027-09'); await ui.choose('runway', 'custom'); await ui.input('runway_months', '30');
    await ui.submit();
    const body = ui.sends('useOfFunds')[0][2];
    assert.equal(body.amount_to_raise_cents, 150000000);
    assert.deepEqual(body.sections.map((s) => [s.key, s.pct, s.milestone_by]), [['product', 40, '2027-03'], ['go-to-market', 30, null], ['infrastructure', 10, null], ['operations', 10, null], ['reserve', 10, '2027-09']]);
    assert.equal(body.runway_months, 30);
  } finally { await ui.unmount(); }
  ui = await mountRaise(raiseForm(m, 'cap-table'), 'cap-table');
  try {
    assert.ok(ui.by('cycle-form-cap'), 'a SAFE has its cap box');
    await ui.input('name', 'Northwind Capital'); await ui.input('amount', '$500k'); await ui.input('cap', '$8M cap'); await ui.choose('prospect_id', '5');
    await ui.submit();
    assert.deepEqual(ui.sends('holder'), [['holder', P, { name: 'Northwind Capital', group: 'investors', instrument: 'safe', amount_cents: 50000000, cap_cents: 800000000, prospect_id: 5 }]]);
    await ui.choose('group', 'founders');
    assert.ok(!ui.by('cycle-form-cap'), 'Common has no cap');
    assert.deepEqual(ui.radios('instrument_founders').map((n) => propsOf(n).value), ['common']);
    assert.ok(ui.by('cycle-form-shares'), 'its box takes shares');
    await ui.input('shares', '4000000'); await ui.choose('vesting', '4y-1y'); await ui.input('vesting_start', '2026-01-01');
    await ui.submit();
    assert.deepEqual(ui.sends('holder')[1][2], { name: 'Northwind Capital', group: 'founders', instrument: 'common', shares: 4000000, vesting: { start_date: '2026-01-01', total_months: 48, cliff_months: 12 } });
  } finally { await ui.unmount(); }
  assert.equal(m.validate(raiseForm(m, 'cap-table'), { ...m.initialValues(raiseForm(m, 'cap-table')), name: 'X', amount: '100' }).cap, 'A SAFE or a note needs its cap.');
}

async function assertInvestor(m) {
  const ui = await mountRaise(raiseForm(m, 'capital-relationships'), 'capital-relationships');
  try {
    assert.ok(ui.text().includes('Lin Park can introduce') && ui.text().includes('Sam Lee can introduce'), 'each person in the founder\'s network, by name');
    await ui.typeIn('name', 'ald');
    const found = ui.by('cycle-form-found-name');
    assert.ok(found, 'the funds whose name matches');
    assert.deepEqual(ui.calls.filter((c) => c[0] === 'formOptions' && c[4].q), [['formOptions', 'raise', P, 'capital-relationships', { q: 'ald' }]]);
    await ui.click('Alder Ventures');
    assert.equal(propsOf(ui.by('cycle-form-name')).value, 'Alder Ventures');
    await ui.input('next_step', 'Send deck'); await ui.input('next_step_due', '2026-11-06');
    await ui.submit();
    assert.deepEqual(ui.sends('prospect'), [['prospect', P, { research_fund_uid: 'alder-ventures', stage: 'to_contact', warm_path: 'Lin Park · Harbour Labs', next_step: 'Send deck', next_step_due: '2026-11-06', notes: null }]]);
    await ui.typeIn('name', 'Quinn Ventures');
    await ui.choose('warm_path', '');
    await ui.submit();
    assert.deepEqual(ui.sends('prospect')[1][2], { name: 'Quinn Ventures', stage: 'to_contact', warm_path: null, next_step: 'Send deck', next_step_due: '2026-11-06', notes: null }, 'a typed name, once the pick is gone');
  } finally { await ui.unmount(); }
}

test('2-6 (Raise): Re-score, New version, New link, Upload, Edit split, Add holder and Add investor send #1700\'s bodies', async () => {
  const all = async (m) => { await assertRescore(m); await assertNarrative(m); await assertLink(m); await assertUpload(m); await assertSplitAndHolder(m); await assertInvestor(m); };
  await mutationCheck(source, path, all, [
    ['.filter((k) => k !== BY_HAND)', ''],
    ["since: v.since === 'all' ? 'all' : 'last'", "since: 'all'"],
    ["? { value, label, meta: `${when} · scored on its record`, checked: false, disabled: true }", "? { value, label, meta: `${when} · scored on its record`, checked: true }"],
    ["start_from: based ? 'version' : from === BLANK ? BLANK : LIVE,", "start_from: based ? 'version' : LIVE,"],
    ["expires_days: v.expires_days === NEVER ? null : Number(v.expires_days || 30),", "expires_days: Number(v.expires_days || 30),"],
    ["blocked: (fields) => !fields.find((f) => f.name === 'deck_id')?.options?.length,", ''],
    ["name, data, visibility: 'nda',", 'name, data,'],
    ['if (why) { refused.push(`${file.name}: ${why}.`); continue; }', ''],
    ["...(folder.startsWith(NEW_FOLDER) ? { folder_name: folder.slice(NEW_FOLDER.length) } : folder ? { folder_uid: folder } : {}),", '...(folder ? { folder_uid: folder } : {}),'],
    ["access_expires_at: checkedOf(v.protect, EXPIRE) ? str(v.access_expires_at) : null,", 'access_expires_at: str(v.access_expires_at),'],
    ['if (!Object.keys(e).length && sum !== 100)', 'if (false)'],
    ["{ name: 'investment', k: 'Amount or shares', parts: holderMoney, when: inGroup(INVESTORS) },", "{ name: 'investment', k: 'Amount or shares', parts: holderMoney },"],
    ["const [total, cliff] = v.vesting === '4y-1y' ? [48, 12] :", "const [total, cliff] = v.vesting === '4y-1y' ? [48, 0] :"],
    ["out[`pct.${key}`] = { value: s?.pct != null ? String(s.pct) : '' };", "out[`pct.${key}`] = {};"],
    ["...(str(v.research_fund_uid) ? { research_fund_uid: str(v.research_fund_uid) } : { name: str(v.name) }),", 'name: str(v.name),'],
    ["return [...chipsOf(people).map((o) => ({ value: o.value, label: `${o.value.split(' · ')[0]} can introduce` })), NO_PATH];", "return [...chipsOf(people), NO_PATH];"],
  ]);
});

// ---------- Test 9 (Raise): the Edits -----------------------------------------

async function assertRaiseEdits(m) {
  const E = m.EDITS.raise;
  assert.deepEqual(Object.keys(E), ['investor-narrative', 'pitch-deck', 'data-room', 'cap-table', 'use-of-funds', 'capital-relationships']);
  assert.equal(m.editFor('raise', 'fundraising-readiness'), null, 'a score is never edited');
  for (const [slug, title] of [['investor-narrative', 'Edit version'], ['pitch-deck', 'Edit link'], ['data-room', 'Edit file'], ['cap-table', 'Edit holder'], ['capital-relationships', 'Edit investor']]) {
    assert.deepEqual([E[slug].title, E[slug].cta], [title, 'Save'], slug);
  }
  assert.equal(E['use-of-funds'].key, raiseForm(m, 'use-of-funds').key, 'Use of funds\' Edit is its Add');
  assert.deepEqual([E['use-of-funds'].title, E['use-of-funds'].cta], ['Edit split', 'Save split']);
  // Only a record resolves an id (#1658's `{ id, edit: { id, uid } }`); a module row draws none.
  assert.equal(E['data-room'].idOf({ id: 12, edit: { id: 12, uid: 'f12' } }), 'f12', 'the file\'s uid, never its integer id');
  assert.equal(E['cap-table'].idOf({ id: 'h-7', edit: { id: 'h-7', uid: 'h-7' } }), 'h-7');
  assert.equal(E['cap-table'].idOf({ id: 'pool', edit: { id: 'pool' } }), null, 'the pool has no Edit');
  for (const [slug, row] of [['investor-narrative', { id: 3 }], ['pitch-deck', { id: 41 }], ['data-room', { id: 12 }], ['cap-table', { id: 'h-7' }], ['use-of-funds', { id: 'product' }], ['capital-relationships', { id: 5 }]]) {
    assert.equal(E[slug].idOf(row), null, `${slug}: a module row draws no Edit`);
  }

  // Edit version: what the record carries is sent; Start from is not a field.
  let ui = await mountRaise(E['investor-narrative'], 'investor-narrative', { id: 3, current: { investor_type: 'angel', one_liner: 'One', why_now: 'Now', ask: 'Ask', check_against: ['deck'] } });
  try {
    assert.ok(!ui.by('cycle-form-start_from'));
    await ui.input('why_now', 'Later');
    await ui.submit();
    assert.deepEqual(ui.sends('narrativeVersionUpdate'), [['narrativeVersionUpdate', P, 3, { investor_type: 'angel', one_liner: 'One', why_now: 'Later', ask: 'Ask', check_against: ['deck'] }]]);
  } finally { await ui.unmount(); }
  // Edit link and Edit holder: a field left untouched sends no key.
  ui = await mountRaise(E['pitch-deck'], 'pitch-deck', { id: 41 });
  try {
    await ui.choose('allow_download', 'no');
    await ui.submit();
    assert.deepEqual(ui.sends('deckLinkUpdate'), [['deckLinkUpdate', P, 41, { allow_download: false }]]);
  } finally { await ui.unmount(); }
  ui = await mountRaise(E['cap-table'], 'cap-table', { id: 'e-3', current: { name: 'Harbour Angels' } });
  try {
    await ui.input('cap', '$6M');
    await ui.submit();
    assert.deepEqual(ui.sends('holderUpdate'), [['holderUpdate', P, 'e-3', { name: 'Harbour Angels', cap_cents: 600000000 }]]);
  } finally { await ui.unmount(); }
  // Edit file: the uid in the path, the room's uid from form-options, only existing folders.
  ui = await mountRaise(E['data-room'], 'data-room', { id: 'f12' });
  try {
    assert.deepEqual(ui.radios('folder').map((n) => propsOf(n).value), ['fo3'], 'a name not made is not offered: the PATCH moves into a folder that exists');
    await ui.choose('access_tier', 'nobody');
    await ui.submit();
    assert.deepEqual(ui.sends('fileUpdate'), [['fileUpdate', 'p-kestrel', 'f12', { access_tier: 'nobody' }]]);
  } finally { await ui.unmount(); }
  ui = await mountRaise(E['capital-relationships'], 'capital-relationships', { id: 5, current: { name: 'Northwind Capital', stage: 'meeting', warm_path: 'via Lin Park' } });
  try {
    await ui.choose('stage', 'diligence');
    await ui.submit();
    assert.deepEqual(ui.sends('prospectUpdate'), [['prospectUpdate', P, 5, { name: 'Northwind Capital', stage: 'diligence', warm_path: 'via Lin Park' }]]);
  } finally { await ui.unmount(); }
}

test('9 (Raise): each Raise Edit is titled for its noun, PATCHes its own path with the record\'s id, and sends only what it carried or the founder filled', async () => {
  await mutationCheck(source, path, assertRaiseEdits, [
    ["const recordNumber = (row) => posId(recordEdit(row)?.id);", 'const recordNumber = (row) => posId(row?.id);'],
    ["idOf: (row) => { const uid = String(recordEdit(row)?.uid ?? ''); return PROJECT_UID.test(uid) ? uid : null; },", "idOf: (row) => recordEdit(row)?.id ?? null,"],
    ["  key: 'edit-version',\n  title: 'Edit version',", "  key: 'edit-version',\n  title: 'Edit narrative',"],
    ["folder: { opts: r.folder.opts.filter((o) => !o.value.startsWith(NEW_FOLDER)) },", 'folder: { opts: r.folder.opts },'],
    ["  }, [], { amount_cents: 'amount', cap_cents: 'cap' }),", "  }, ['amount', 'cap'], { amount_cents: 'amount', cap_cents: 'cap' }),"],
    ["    'investor-narrative': editNarrative,\n    'pitch-deck': editLink,", "    'investor-narrative': editNarrative,\n    'fundraising-readiness': editNarrative,\n    'pitch-deck': editLink,"],
  ]);
});

// ---------- Test 10 (Raise): the client writes --------------------------------

async function assertRaiseWrites(m) {
  const sent = [];
  const w = m.makeCycleWrites(async (url, opts = {}) => { sent.push([url, opts.method ?? 'GET', opts.body ? JSON.parse(opts.body) : null]); return {}; });
  await w.raise.rescore(P);
  await w.raise.rescore(P, { items: ['deck'], since: 'last' });
  await w.raise.narrativeVersion(P, { investor_type: 'angel' });
  await w.raise.narrativeVersionUpdate(P, 3, { why_now: 'x' });
  await w.raise.deckLink(P, { deck_id: 5 });
  await w.raise.deckLinkUpdate(P, 41, { allow_download: true });
  await w.raise.holder(P, { name: 'x' });
  await w.raise.holderUpdate(P, 'h-7', { shares: 1 });
  await w.raise.useOfFunds(P, { sections: [] });
  await w.raise.prospect(P, { name: 'x' });
  await w.raise.prospectUpdate(P, 5, { stage: 'meeting' });
  await w.raise.upload('p-kestrel', { name: 'a.pdf' });
  await w.raise.fileUpdate('p-kestrel', 'f12', { access_tier: 'nobody' });
  await w.formOptions('raise', P, 'capital-relationships', { q: 'ald' });
  assert.deepEqual(sent, [
    ['/cycles/raise/readiness/rescore?project=7', 'POST', null],
    ['/cycles/raise/readiness/rescore?project=7', 'POST', { items: ['deck'], since: 'last' }],
    ['/cycles/raise/narrative-versions?project=7', 'POST', { investor_type: 'angel' }],
    ['/cycles/raise/narrative-versions/3?project=7', 'PATCH', { why_now: 'x' }],
    ['/cycles/raise/deck-links?project=7', 'POST', { deck_id: 5 }],
    ['/cycles/raise/deck-links/41?project=7', 'PATCH', { allow_download: true }],
    ['/cycles/raise/holders?project=7', 'POST', { name: 'x' }],
    ['/cycles/raise/holders/h-7?project=7', 'PATCH', { shares: 1 }],
    ['/cycles/raise/use-of-funds?project=7', 'PUT', { sections: [] }],
    ['/cycles/raise/prospects?project=7', 'POST', { name: 'x' }],
    ['/cycles/raise/prospects/5?project=7', 'PATCH', { stage: 'meeting' }],
    ['/data-room/p-kestrel/files', 'POST', { name: 'a.pdf' }],
    ['/data-room/p-kestrel/files/f12', 'PATCH', { access_tier: 'nobody' }],
    ['/cycles/raise/modules/capital-relationships/form-options?project=7&q=ald', 'GET', null],
  ], 'Raise takes the venture in the query, the data room its uid in the path; #1652\'s rescore sends no body');
}

test('10 (Raise): each Raise write calls its spelled-out route, and the fund search uses the one form-options path', async () => {
  await mutationCheck(writesSource, writesPath, assertRaiseWrites, [
    ["{ method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }", "{ method: 'POST', body: JSON.stringify(body ?? {}) }"],
    ["useOfFunds: (projectId, body) => request(`/cycles/raise/use-of-funds?${q(projectId)}`, { method: 'PUT',", "useOfFunds: (projectId, body) => request(`/cycles/raise/use-of-funds?${q(projectId)}`, { method: 'POST',"],
    ["upload: (projectUid, body) => request(`/data-room/${seg(projectUid)}/files`,", "upload: (projectUid, body) => request(`/data-room/files?project=${seg(projectUid)}`,"],
    ["holderUpdate: (projectId, id, body) => request(`/cycles/raise/holders/${seg(id)}?${q(projectId)}`,", "holderUpdate: (projectId, id, body) => request(`/cycles/raise/holders?id=${seg(id)}&${q(projectId)}`,"],
  ]);
  const calls = extractClientCalls(writesSource).map((c) => `${c.method} ${normalizePath(c.path)}`);
  for (const want of ['POST /cycles/raise/deck-links', 'PATCH /cycles/raise/deck-links/:p', 'POST /cycles/raise/holders', 'PATCH /cycles/raise/holders/:p',
    'PUT /cycles/raise/use-of-funds', 'POST /cycles/raise/prospects', 'PATCH /cycles/raise/prospects/:p', 'PATCH /cycles/raise/narrative-versions/:p',
    'POST /data-room/:p/files', 'PATCH /data-room/:p/files/:p']) assert.ok(calls.some((c) => c.endsWith(want)), want);
  assert.ok(!calls.some((c) => /\/cycles\/(raise|grow)\/modules\/[^:]+\/form-options/.test(c)), 'no form-options path with a literal cycle');
});

// ---------- Test 14: the Data room module page's Add is Upload -----------------

test('14: with Upload registered, the Data room module\'s Add is Upload, and its records.add and empty card open the same address', () => {
  // #1658's "Open the files tool" (S1's ruling) is not on main yet, so this pins the Add only (the issue's test 14).
  const [upload] = FORMS.raise['data-room'];
  assert.equal(upload.button, 'Upload');
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /forms\.map\(\(entry, i\) => \(\{ text: entry\.button, href: addHref\(entry, i\)/, 'a module with a form draws its Add from the form');
  assert.match(route, /loadOptions=\{formOpen\.loadOptions \? \(\) => formOpen\.loadOptions\(cyclesWrite, projectId\) : null\}/, 'an Add reads its choices');
  assert.match(route, /onSearch=\{formOpen\.search \? \(_field, q\) => formOpen\.search\(cyclesWrite, projectId, q\) : null\}/, 'and searches through its form');
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/raiseCycle.ts', import.meta.url), 'utf8');
  assert.match(worker, /add: \{ text: 'Upload', href: addHref\(ctx, 'data-room'\) \}/);
  assert.match(worker, /next: \{ text: 'Upload', href: addHref\(ctx, 'data-room'\) \}/);
  assert.match(worker, /const addHref = \(ctx: Ctx, slug: string\) => `\/raise\/\$\{slug\}\/new\?project=\$\{ctx\.projectId\}`;/);
});
