/**
 * D695 PR 3a (#1656): Build's six canvas forms (CO:311-316) and their Edits
 * as specs, and PR 3b's registration (decision 15).
 *
 * Each form is mounted in the real `FormLightbox` with a stubbed write table.
 * Test 7: the canvas copy, except where decisions 8 and 10 draw other words.
 * Test 2: the `when` boxes (Linked's URLs, For on 83(b), Custom vesting,
 * Workspace's Sync). Test 8: no bracket anywhere, and empty chip sets. Test
 * 10: Connect a system. Each body's keys are read against the handler on
 * `main` (`routes/cycle_build.ts`, #1695's first PR, #1769), or against
 * #1695's write table for the roadmap and filing fields its closing PR adds.
 * Each group runs on `forms.js`, on mutants of it that must fail, and again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { MODULES } from '../src/pages/cycles/modules.js';
import { h, mountForm, mutationCheck, propsOf, textOf } from './_form_d695.mjs';
import { extractClientCalls, normalizePath } from '../../scripts/lib/apiModules.mjs';

const path = 'pages/cycles/forms.js';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');
const routes = readFileSync(new URL('../../cloudflare-worker/src/routes/cycle_build.ts', import.meta.url), 'utf8');
const writes = readFileSync(new URL('../src/lib/api/cycleWrites.js', import.meta.url), 'utf8');
const m0 = await import('../src/pages/cycles/forms.js');

const SLUGS = ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems'];
const P = 3;

function writeTable() {
  const calls = [];
  const build = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { id: 1, next: { href: '/raise/legal-engine/founders' } }; } });
  return { calls, w: { build } };
}

async function mount(form, { current = null, id = null, slug } = {}) {
  const { calls, w } = writeTable();
  const onSubmit = (v) => (id == null ? form.submit(w, P, v) : form.submit(w, P, id, v));
  const ui = await mountForm(h(FormLightbox, { form, current, cycle: 'build', slug, onSubmit, onClose() {} }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const radios = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio');
  const checks = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'checkbox');
  return { ...ui, calls, inputs, radios, checks };
}

// ---------- Test 7: the canvas copy ------------------------------------------

/** CO:311-316, brackets removed (decision 3), with decision 8's and 10's words. */
const COPY = {
  'solution-design': {
    title: 'Add feature', cta: 'Add feature', sub: 'A feature answers a pain theme and tests a hypothesis. One that links to nothing is flagged.',
    foot: 'Counted on Solution design’s chart as linked or unlinked.',
    labels: ['Feature', 'Answers pain theme', 'Tests hypothesis', 'Impact', 'Effort', 'Scope'],
    chips: { pain_group_id: [['None yet'], ''], hypothesis_id: [['None yet'], ''], impact: [['Low', 'Medium', 'High'], 'high'], effort: [['Low', 'Medium', 'High'], 'low'], scope: [['Core', 'Out of scope'], 'core'] },
    notes: ['Pick None yet and the feature is flagged until you link it.'], placeholders: ['What it lets the customer do'],
  },
  'prototype-mvp': {
    title: 'Add must-have', cta: 'Add must-have', sub: 'What has to work before the MVP ships.', foot: 'Counts toward the burn-up to the ship date.',
    labels: ['Must-have', 'Tests hypothesis', 'State', 'Owner · due', 'Linked'],
    chips: { hypothesis_id: [['None yet'], ''], state: [['Not started', 'In progress', 'Done', 'Blocked'], 'not_started'] },
    checks: { linked: [['Figma file', 'design', false], ['GitHub issue', 'code', false]] }, placeholders: ['What must work', '8 Nov'],
  },
  'product-roadmap': {
    title: 'Add item', cta: 'Add item', sub: 'A roadmap item moves a KPI or answers a feedback theme.', foot: 'Issues from a connected GitHub repository land here too.',
    labels: ['Item', 'Column', 'Moves KPI', 'Answers feedback theme', 'Owner · date', 'Waits on'],
    chips: { column: [['Now', 'Next', 'Later'], 'next'], kpi_key: [['None'], ''], feedback_theme: [['None'], ''], waits_on_id: [['Nothing'], ''] },
    placeholders: ['What ships', 'Dec'],
  },
  'founding-team': {
    title: 'Add founder', cta: 'Add founder', sub: 'Role, equity and vesting. Then draft the agreement in the legal engine.', foot: 'Changes the unallocated share.',
    labels: ['Founder', 'Role', 'Equity', 'Vesting', 'Vesting starts', 'Then'],
    chips: { vesting: [['4 years, 1-year cliff', '4 years, no cliff', 'Custom'], '4y_1y_cliff'] },
    checks: { then: [['Draft the co-founder agreement', 'in the legal engine', true], ['Add to the cap table', 'founder stock', true]] },
    placeholders: ['Name', 'email', 'CEO, CTO, …', '40%', '12 Mar 2026'],
  },
  'company-creation': {
    title: 'Add filing', cta: 'Add filing', sub: 'A filing with its jurisdiction, due date and proof.', foot: null,
    labels: ['Filing', 'Jurisdiction', 'Due', 'For', 'State', 'Proof', 'Upload the confirmation when filed'],
    chips: { kind: [['Formation', 'EIN', '83(b) election', 'Annual report', 'Franchise tax', 'Other'], '83b'], jurisdiction: [['Federal', 'Other'], 'Federal'], state: [['Upcoming', 'Filed', 'Due soon'], 'upcoming'] },
    placeholders: ['11 Nov'],
  },
  'operating-systems': {
    title: 'Connect a system', cta: 'Continue to sign-in', sub: 'Each system shows its state and last sync once connected.', foot: 'Opens the provider’s own sign-in.',
    labels: ['System', 'Provider', 'Sync', 'Feeds'],
    chips: { system: [['Bank', 'Accounting', 'Payroll', 'CRM', 'Workspace'], 'accounting'], sync: [['Live', 'Hourly', 'Daily', 'Manual'], 'daily'] },
    checks: { feeds: [['Use of funds', 'bank and accounting', true], ['KPIs', 'accounting', true], ['Team', 'payroll', false]] },
    notes: ['No Accounting provider can be connected yet.'], placeholders: [],
  },
};

async function assertCopy(m) {
  assert.deepEqual(Object.keys(m.BUILD_FORMS), SLUGS);
  for (const slug of SLUGS) {
    assert.ok(MODULES.build.some((mod) => mod.slug === slug), `${slug} is a Build module`);
    const want = COPY[slug];
    const [f, ...more] = m.BUILD_FORMS[slug];
    assert.equal(more.length, 0, `${slug}: one Add`);
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
        assert.deepEqual(ui.checks(name).map((n) => propsOf(n).checked), rows.map((r) => r[2]), `${slug} ${name}: defaults`);
        for (const [l, meta] of rows) assert.ok(text.includes(l) && text.includes(meta), `${slug} ${name}: ${l} · ${meta}`);
        assert.deepEqual(f.fields.find((x) => x.name === name).opts.map((o) => [o.label, o.meta, !!o.checked]), rows, `${slug} ${name}: each row's words`);
      }
      const ph = ui.inputs().map((n) => propsOf(n).placeholder).filter(Boolean);
      for (const p of want.placeholders) assert.ok(ph.includes(p), `${slug}: placeholder "${p}"`);
      assert.ok(!/·\s*required/i.test(text), `${slug}: no required marker`);
    } finally { await ui.unmount(); }
  }
}

test('7: each Build form draws the canvas copy, with decisions 8 and 10\'s words', async () => {
  await mutationCheck(source, path, assertCopy, [
    ["foot: 'Counted on Solution design’s chart as linked or unlinked.'", "foot: 'Appears on the impact × effort board.'"],
    ["foot: 'Issues from a connected GitHub repository land here too.'", "foot: 'Syncs to GitHub when connected.'"],
    ["sub: 'Role, equity and vesting. Then draft the agreement in the legal engine.'", "sub: 'Role, equity and vesting. The agreement is drafted from the split.'"],
    ["{ value: 'agreement', label: 'Draft the co-founder agreement', meta: 'in the legal engine', checked: true }", "{ value: 'agreement', label: 'Draft the co-founder agreement from the split', meta: 'e-signature', checked: true }"],
    ["{ kind: 'CH', name: 'kind', k: 'Filing', opts: FILING, def: 2 }", "{ kind: 'CH', name: 'kind', k: 'Filing', opts: FILING, def: 0 }"],
    ["{ kind: 'CH', name: 'column', k: 'Column', opts: COLUMN, def: 1 }", "{ kind: 'CH', name: 'column', k: 'Column', opts: COLUMN, def: 0 }"],
    ["  // No foot: no job sends filing reminders (decision 8).", "  foot: 'Reminders 14 days before.',\n  // No foot: no job sends filing reminders (decision 8)."],
  ]);
});

// ---------- Test 2: boxes a choice reveals -----------------------------------

async function assertWhen(m) {
  const must = await mount(m.BUILD_FORMS['prototype-mvp'][0], { slug: 'prototype-mvp' });
  try {
    assert.ok(!must.by('cycle-form-figma_url') && !must.by('cycle-form-github_url'));
    await must.choose('linked', 'github');
    assert.ok(must.by('cycle-form-github_url') && !must.by('cycle-form-figma_url'), 'each Linked check reveals its own URL box');
    await must.input('title', 'Reconciliation report');
    await must.input('github_url', 'https://github.com/example-org/app/issues/12');
    await must.submit();
    assert.deepEqual(must.calls, [['addMustHave', P, { title: 'Reconciliation report', hypothesis_id: null, state: 'not_started', due_date: null,
      links: ['https://github.com/example-org/app/issues/12'] }]]);
  } finally { await must.unmount(); }

  const filing = await mount(m.BUILD_FORMS['company-creation'][0], { slug: 'company-creation' });
  try {
    assert.ok(filing.text().includes('No founder recorded yet.'), '83(b) election shows For');
    await filing.choose('kind', 'ein');
    assert.ok(!filing.text().includes('No founder recorded yet.'), 'For shows only for an 83(b) election');
    await filing.submit();
    assert.deepEqual(filing.calls, [['formationStep', P, { kind: 'ein', jurisdiction: 'Federal', due_date: null, for_holder_id: null, state: 'upcoming' }]]);
  } finally { await filing.unmount(); }

  const founder = await mount(m.BUILD_FORMS['founding-team'][0], { slug: 'founding-team' });
  try {
    assert.ok(!founder.by('cycle-form-total_months'));
    await founder.choose('vesting', 'custom');
    assert.ok(founder.by('cycle-form-total_months') && founder.by('cycle-form-cliff_months'), 'Custom reveals its months');
    assert.equal(propsOf(founder.checks('then').find((n) => propsOf(n).value === 'cap_table')).disabled, true, 'the cap-table check is locked');
    await founder.input('name', 'Ana Example'); await founder.input('equity_pct', '40%');
    await founder.input('total_months', '36'); await founder.input('cliff_months', '6'); await founder.input('vesting_start', '2026-03-12');
    await founder.submit();
    assert.deepEqual(founder.calls, [['founder', P, { name: 'Ana Example', email: null, role: null, equity_pct: 40, vesting: 'custom', vesting_start: '2026-03-12', total_months: 36, cliff_months: 6 }]]);
    assert.ok(founder.by('cycle-form-done'), 'the done view shows the legal engine link');
  } finally { await founder.unmount(); }

  const system = await mount(m.BUILD_FORMS['operating-systems'][0], { slug: 'operating-systems' });
  try {
    assert.equal(system.radios('sync').length, 4);
    await system.choose('system', 'workspace');
    assert.equal(system.radios('sync').length, 0, 'Workspace draws no Sync');
    assert.ok(system.text().includes('No Workspace provider can be connected yet.'));
  } finally { await system.unmount(); }
}

test('2: Linked reveals its URL, For shows for an 83(b) election, Custom reveals its months and Workspace draws no Sync', async () => {
  await mutationCheck(source, path, assertWhen, [
    ["when: { name: 'linked', value: 'github' } },", '},'],
    ["when: { name: 'kind', value: '83b' } },", '},'],
    ["for_holder_id: v.kind === '83b' ? str(v.for_holder_id) : null,", 'for_holder_id: str(v.for_holder_id) ?? 7,'],
    ["{ kind: 'T', name: 'total_months', k: 'Vesting months', input: 'number', required: true, when: { name: 'vesting', value: 'custom' } },", "{ kind: 'T', name: 'total_months', k: 'Vesting months', input: 'number', required: true },"],
    ["{ value: 'cap_table', label: 'Add to the cap table', meta: 'founder stock', checked: true, disabled: true },", "{ value: 'cap_table', label: 'Add to the cap table', meta: 'founder stock', checked: true },"],
    ["when: (v) => v.system !== 'workspace' },", '},'],
    ["  done: (result) => (result?.next?.href ? { text: 'Founder added to the cap table.', href: result.next.href } : null),", ''],
  ]);
});

// ---------- Test 8: no brackets, empty sets ----------------------------------

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
  for (const form of [...Object.values(m.BUILD_FORMS).flat(), ...Object.values(m.BUILD_EDITS)]) {
    for (const s of strings(form)) assert.ok(!/[[\]€]/.test(s), `${form.key}: "${s}"`);
  }
  // An options read that names nothing leaves each set as decision 4 draws it.
  const empty = async () => ({});
  const feature = await mountForm(h(FormLightbox, { form: m.BUILD_FORMS['solution-design'][0], cycle: 'build', slug: 'solution-design', onSubmit() {}, onClose() {}, loadOptions: empty }));
  try {
    await feature.flush();
    const values = (name) => feature.nodes().filter((n) => n.tagName === 'INPUT' && propsOf(n).name === name).map((n) => propsOf(n).value);
    assert.deepEqual(values('pain_group_id'), [''], 'Answers pain theme offers only None yet');
    assert.deepEqual(values('hypothesis_id'), ['']);
  } finally { await feature.unmount(); }
  const must = await mount(m.BUILD_FORMS['prototype-mvp'][0], { slug: 'prototype-mvp' });
  try { assert.ok(must.text().includes('No member to choose yet.'), 'no owner is invented'); } finally { await must.unmount(); }
  const sys = await mount(m.BUILD_FORMS['operating-systems'][0], { slug: 'operating-systems' });
  try {
    assert.equal(sys.radios('provider_accounting').length, 0, 'no provider is offered that the read did not name');
    assert.ok(sys.nodes().some((n) => n.tagName === 'A' && propsOf(n).href === '/build/connect'), 'Connect a tool is one link away');
    await sys.submit();
    assert.equal(sys.calls.length, 0, 'Continue to sign-in sends nothing without a provider');
  } finally { await sys.unmount(); }
}

test('8: no Build string carries a bracket, and an empty read leaves None yet or the empty sentence', async () => {
  await mutationCheck(source, path, assertEmpty, [
    ["k: 'Answers pain theme', opts: [NONE_YET]", "k: 'Answers pain theme', opts: []"],
    ["empty: 'No member to choose yet.'", "empty: 'No [member] yet.'"],
    ["optionsFrom: 'providers', required: true,", "optionsFrom: 'providers',"],
    ["note: (v) => (v[providerField(kind)] ? null : { text: `No ${systemLabel(kind)} provider can be connected yet.`, href: '/build/connect', link: 'Connect a tool' }),", ''],
  ]);
});

// ---------- Each body is the one its route takes -----------------------------

/** The body keys a handler on `main` reads. */
function routeKeys(method, route) {
  const at = routes.indexOf(`app.${method}('${route}'`);
  assert.ok(at >= 0, `${method.toUpperCase()} ${route} is on main`);
  const next = routes.indexOf('\napp.', at + 1);
  const handler = routes.slice(at, next < 0 ? undefined : next);
  // The keys it reads, and those the file's own helpers it calls read (`linkedIds`, `vestingOf`).
  const read = (text) => [...text.matchAll(/\bbody\??\.([a-z_]+)|hasOwn\(body, '([a-z_]+)'\)|has\('([a-z_]+)'\)|mvpValue\(body, '([a-z_]+)'|read\('([a-z_]+)'\)/g)]
    .map((x) => x[1] ?? x[2] ?? x[3] ?? x[4] ?? x[5]);
  const helpers = [...routes.matchAll(/\n(?:async )?function ([A-Za-z]+)\(/g)].filter(([, name]) => handler.includes(`${name}(`))
    .map((x) => routes.slice(x.index, routes.indexOf('\n}', x.index)));
  return new Set([handler, ...helpers].flatMap(read));
}
/** #1695's write table (its Build section) for the fields its closing PR adds. */
const TABLE = {
  roadmap: ['title', 'column', 'kpi_key', 'feedback_theme', 'owner_user_id', 'target_date', 'waits_on_id', 'feature_id'],
  formationSteps: ['title', 'due_date', 'kind', 'jurisdiction', 'for_holder_id', 'state'],
};

async function assertBodies(m) {
  const f = (slug) => m.BUILD_FORMS[slug][0];
  const keys = (o) => Object.keys(o);
  const feature = f('solution-design').toBody({ title: 'Bank feed import', pain_group_id: '4', hypothesis_id: '', impact: 'high', effort: 'low', scope: 'core' });
  assert.deepEqual(feature, { title: 'Bank feed import', pain_group_id: 4, hypothesis_id: null, impact: 'high', effort: 'low', scope: 'core' });
  for (const k of keys(feature)) assert.ok(routeKeys('post', '/features').has(k), `POST /features reads ${k}`);
  const must = f('prototype-mvp').toBody({ title: 'T', state: 'in_progress', owner_user_id: '12', due_date: '2026-11-08', linked: ['figma'], figma_url: 'https://www.figma.com/file/x' });
  assert.deepEqual(must, { title: 'T', hypothesis_id: null, state: 'in_progress', owner_user_id: 12, due_date: '2026-11-08', links: ['https://www.figma.com/file/x'] });
  for (const k of keys(must)) assert.ok(routeKeys('post', '/must-haves').has(k), `POST /must-haves reads ${k}`);
  const founder = f('founding-team').toBody({ name: 'Ana', email: 'ana@example.test', role: 'CEO', equity_pct: '40', vesting: '4y_1y_cliff', vesting_start: '2026-03-12' });
  for (const k of keys(founder)) assert.ok(routeKeys('post', '/founders').has(k), `POST /founders reads ${k}`);
  const item = f('product-roadmap').toBody({ title: 'Approval rules', column: 'now', kpi_key: 'mrr', owner_user_id: '12', target_date: '2026-12-01', waits_on_id: '3' });
  assert.deepEqual(item, { title: 'Approval rules', column: 'now', kpi_key: 'mrr', feedback_theme: null, owner_user_id: 12, target_date: '2026-12-01', waits_on_id: 3 });
  for (const k of keys(item)) assert.ok(TABLE.roadmap.includes(k), `#1695's POST /roadmap takes ${k}`);
  for (const k of keys(f('company-creation').toBody({ kind: '83b', for_holder_id: 'h-4' }))) assert.ok(TABLE.formationSteps.includes(k), `#1695's formation step takes ${k}`);
  assert.equal(f('company-creation').toBody({ kind: '83b', for_holder_id: 'h-4' }).for_holder_id, 'h-4');
  assert.equal(f('company-creation').toBody({ kind: 'ein', for_holder_id: 'h-4' }).for_holder_id, null, 'For is for an 83(b) election only');
  const other = f('company-creation').fields.find((x) => x.name === 'jurisdiction').opts.find((o) => o.label === 'Other').value;
  assert.equal(f('company-creation').toBody({ kind: 'other', jurisdiction: other }).jurisdiction, null, 'Other names no jurisdiction');
  // Connect a system: one keyless PUT with sync and feeds, then the hand-off; Workspace skips the PUT.
  const sys = f('operating-systems');
  const { calls, w } = writeTable();
  const crm = await sys.submit(w, P, { system: 'crm', provider_crm: 'hubspot', sync: 'hourly', feeds: ['kpis'] });
  assert.deepEqual(calls, [['system', P, 'crm', { feeds: ['kpis'], sync: 'hourly' }]]);
  for (const k of ['integration_uid', 'integration_id', 'provider_key']) assert.ok(!Object.hasOwn(calls[0][3], k), `never ${k}`);
  for (const k of keys(calls[0][3])) assert.ok(routeKeys('put', '/systems/:kind').has(k), `PUT /systems/:kind reads ${k}`);
  assert.deepEqual(crm, { next: `/build/connect?project_id=${P}&tool=hubspot` });
  calls.length = 0;
  const ws = await sys.submit(w, P, { system: 'workspace', provider_workspace: 'google', sync: 'daily', feeds: ['team'] });
  assert.equal(calls.length, 0, 'an unmapped Workspace has no row for Feeds');
  assert.deepEqual(ws, { next: `/build/connect?project_id=${P}&tool=google` });
  assert.equal(m.connectToolHref(P, 'bad tool/../x'), `/build/connect?project_id=${P}`, 'only a catalogue key reaches the link');
  assert.ok(!sys.fields.find((x) => x.name === 'system').opts.some((o) => /calendar/i.test(o.label)), 'no Calendar chip');
  assert.ok(!sys.fields.some((x) => /compan/i.test(String(x.k))), 'no Companies chip');
}

test('each Add sends the body #1695\'s routes take, and Connect a system never sends a connector key', async () => {
  await mutationCheck(source, path, assertBodies, [
    ['title: str(v.title), pain_group_id: idOrNull(v.pain_group_id), hypothesis_id: idOrNull(v.hypothesis_id),', 'title: str(v.title), pain_group_id: v.pain_group_id, hypothesis_id: idOrNull(v.hypothesis_id),'],
    ["links: LINKS.filter((l) => checked(v.linked, l.value)).map((l) => str(v[`${l.value}_url`])).filter(Boolean)", 'links: [v.figma_url, v.github_url]'],
    ["    if (v.system !== 'workspace') await w.build.system(projectId, v.system, buildSystem.toBody(v));", '    await w.build.system(projectId, v.system, buildSystem.toBody(v));'],
    ["toBody: (v) => ({ feeds: Array.isArray(v.feeds) ? v.feeds : [], ...(v.system !== 'workspace' && v.sync ? { sync: v.sync } : {}) }),",
      "toBody: (v) => ({ feeds: Array.isArray(v.feeds) ? v.feeds : [], sync: v.sync, provider_key: v[providerField(v.system)] }),"],
    ["if (/^[a-z0-9_-]{1,64}$/.test(String(tool ?? ''))) q.set('tool', String(tool));", "q.set('tool', String(tool));"],
    ["{ value: '', label: 'Other' }], def: 0, optionsFrom: 'jurisdictions' },", "{ value: 'Other', label: 'Other' }], def: 0, optionsFrom: 'jurisdictions' },"],
    ["return { next: connectToolHref(projectId, v[providerField(v.system)]) };", 'return { next: connectToolHref(projectId, v.provider) };'],
  ]);
});

// ---------- The Edits --------------------------------------------------------

const EDITS = {
  'solution-design': { title: 'Edit feature', method: 'feature', row: { id: 7, edit: { title: 'Bank feed import', impact: 'high', is_must_have: 1 } }, id: '7', change: [['impact', 'low']],
    body: { title: 'Bank feed import', impact: 'low', is_must_have: true }, route: ['patch', '/features/:id'] },
  'prototype-mvp': { title: 'Edit must-have', method: 'feature', row: { id: 8, edit: { title: 'Report', state: 'in_progress', due_date: '2026-11-08T00:00:00Z' } }, id: '8', change: [['state', 'done']],
    body: { title: 'Report', state: 'done', due_date: '2026-11-08' }, route: ['patch', '/features/:id'] },
  'product-roadmap': { title: 'Edit item', method: 'roadmapItemUpdate', row: { id: 3, edit: { column: 'next', target_date: '2026-12-01' } }, id: '3', change: [['column', 'now']],
    body: { column: 'now', target_date: '2026-12-01' }, table: TABLE.roadmap },
  'founding-team': { title: 'Edit founder', method: 'founderUpdate', row: { id: 'h-4', edit: { role: 'CTO', vesting: '4y_no_cliff', vesting_start: '2026-01-05T00:00:00Z' } }, id: 'h-4', change: [['vesting', '4y_1y_cliff']],
    body: { role: 'CTO', vesting: '4y_1y_cliff', vesting_start: '2026-01-05' }, route: ['patch', '/founders/:id'] },
  'company-creation': { title: 'Edit filing', method: 'formationStepUpdate', row: { id: 'step-5', edit: { kind: 'ein', state: 'upcoming', due_date: '2026-11-11' } }, id: 5, change: [['state', 'filed']],
    body: { kind: 'ein', due_date: '2026-11-11', state: 'filed' }, table: TABLE.formationSteps },
};

async function assertEdits(m) {
  assert.deepEqual(Object.keys(m.BUILD_EDITS), SLUGS.filter((s) => s !== 'operating-systems'), 'Operating systems keeps today\'s Choose connector');
  for (const [slug, c] of Object.entries(EDITS)) {
    const edit = m.BUILD_EDITS[slug];
    assert.equal(edit.title, c.title); assert.equal(edit.cta, 'Save'); assert.equal(edit.button, 'Edit');
    assert.equal(edit.idOf(c.row), c.id, `${slug}: its id`);
    const current = edit.valuesOf(c.row);
    const ui = await mount(m.editFieldsFor(edit, current), { slug, current, id: edit.idOf(c.row) });
    try {
      for (const [name, value] of c.change) await ui.choose(name, value);
      await ui.submit();
      assert.equal(ui.calls.length, 1, `${slug}: one save`);
      const [method, project, id, body] = ui.calls[0];
      assert.deepEqual([method, project, id], [c.method, P, c.id]);
      assert.deepEqual(body, c.body, `${slug}: only the carried fields are sent`);
      for (const k of Object.keys(body)) assert.ok(c.route ? routeKeys(...c.route).has(k) : c.table.includes(k), `${slug}: takes ${k}`);
    } finally { await ui.unmount(); }
  }
  const names = (f) => (f.fields || []).flatMap((x) => (x.parts ? x.parts.map((p) => p.name) : [x.name]));
  assert.ok(names(m.BUILD_EDITS['solution-design']).includes('is_must_have'), 'Edit feature carries Must-have for the MVP');
  for (const e of Object.values(m.BUILD_EDITS)) assert.ok(!names(e).some((n) => ['linked', 'waits_on_id', 'proof', 'figma_url', 'github_url'].includes(n)), `${e.key}: no Linked, Waits on or Proof`);
  assert.deepEqual(names(m.BUILD_EDITS['founding-team']), ['name', 'email', 'role', 'equity_pct', 'vesting', 'total_months', 'cliff_months', 'vesting_start']);
  assert.equal(m.BUILD_EDITS['company-creation'].idOf({ id: 'lab-2-0' }), null, 'a Lab step is changed where it lives');
  assert.equal(m.BUILD_EDITS['founding-team'].idOf({ id: '4' }), null, 'a founder is addressed as h-<id>');
}

test('6: each Build Edit is the Add\'s PATCH fields, titled Edit <noun>, and sends only what its source carried', async () => {
  await mutationCheck(source, path, assertEdits, [
    ["fields: [...featureFields, { kind: 'CH', name: 'is_must_have', k: 'Must-have for the MVP', opts: YES_NO }],", 'fields: featureFields,'],
    ["    if (v.vesting_start) v.vesting_start = dateText(v.vesting_start);\n", ''],
    ["idOf: recordId(/^h-[1-9]\\d*$/),", 'idOf: recordId(/^[a-z0-9-]+$/),'],
    ["  fields: mustHaveFields,\n  idOf", "  fields: buildMustHave.fields,\n  idOf"],
    ["key: 'edit-filing', title: 'Edit filing'", "key: 'edit-filing', title: 'Edit a filing'"],
    ["    if (v.due_date) v.due_date = dateText(v.due_date);\n    canvasWord(v, 'state', STATE_STORED, MVP_STATE);", "    canvasWord(v, 'state', STATE_STORED, MVP_STATE);"],
  ]);
});

// ---------- Registered (PR 3b) -----------------------------------------------

test('15: PR 3b registers Build\'s six Adds and five Edits; Add risk leaves the Adds; Operating systems keeps Choose connector', () => {
  assert.deepEqual(Object.keys(m0.FORMS.build), SLUGS);
  for (const slug of SLUGS) {
    assert.deepEqual(m0.formsFor('build', slug), m0.BUILD_FORMS[slug], `${slug}: its canvas Add`);
    if (m0.BUILD_EDITS[slug]) {
      assert.equal(m0.editFor('build', slug), m0.BUILD_EDITS[slug], `${slug}: its Edit`);
      assert.equal(m0.BUILD_EDITS[slug].readsRecord, true, `${slug}: its Edit reads the record`);
    }
  }
  assert.deepEqual(m0.formsFor('build', 'solution-design').map((f) => f.key), ['feature'], 'Add a risk is the feature record\'s own action (decision 9)');
  assert.equal(m0.editFor('build', 'operating-systems').key, 'edit-system');
  for (const method of ['addFeature', 'addMustHave', 'roadmapItem', 'roadmapItemUpdate', 'founder', 'founderUpdate']) {
    assert.match(writes, new RegExp(`\\b${method}:`), `cycleWrites.js has ${method}`);
  }
});

// =============================================================================
// PR 3b: the loaders, Add filing's Proof, the stored words, the writes
// =============================================================================

/** #1792's Build `form-options`, keyed by field name, with made-up names. */
const READS = {
  'solution-design': { pain_group_id: { options: [{ value: '11', label: 'Manual reconciliation' }] }, hypothesis_id: { options: [{ value: '5', label: 'H1 · Controllers pay' }] },
    impact: { options: [{ value: 'High', label: 'High' }] }, effort: { options: [{ value: 'S', label: 'Low' }] } },
  'prototype-mvp': { hypothesis_id: { options: [] }, owner_user_id: { options: [{ value: '12', label: 'Fay Founder' }] } },
  'product-roadmap': { kpi_key: { options: [{ value: 'mrr', label: 'MRR' }] }, feedback_theme: { options: [{ value: 'Exports', label: 'Exports' }] },
    waits_on_id: { options: [{ value: '3', label: 'Second bank' }] }, owner_user_id: { options: [] } },
  'founding-team': { unallocated: { value: 20 } },
  'company-creation': { jurisdiction: { options: [{ value: 'DE', label: 'DE' }, { value: 'Federal', label: 'Federal' }] }, for_holder_id: { options: [{ value: 'h-4', label: 'Ana Wren' }] } },
  'operating-systems': { kinds: [
    { kind: 'crm', providers: [{ provider_key: 'hubspot', display_name: 'HubSpot' }], sync_editable: false },
    { kind: 'accounting', providers: [{ provider_key: 'xero', display_name: 'Xero' }], sync_editable: true },
  ] },
};
async function mountRead(form, slug, { answer } = {}) {
  const calls = [];
  const build = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return answer ? answer(name, ...args) : { id: 9 }; } });
  const w = { build, formOptions: async (cycle, projectId, s) => { calls.push(['formOptions', cycle, projectId, s]); return READS[s]; },
    recordAction: async (...args) => { calls.push(['recordAction', ...args]); return { ok: true }; } };
  const ui = await mountForm(h(FormLightbox, { form, cycle: 'build', slug, onSubmit: (v) => form.submit(w, P, v), onClose() {}, loadOptions: () => form.loadOptions(w, P) }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const radios = (name) => inputs().filter((n) => propsOf(n).name === name && propsOf(n).type === 'radio');
  return { ...ui, calls, inputs, radios, sends: (name) => calls.filter((c) => c[0] === name) };
}
const chosen = (ui, name) => ui.radios(name).filter((n) => propsOf(n).checked).map((n) => propsOf(n).value);
const labels = (ui, name) => ui.radios(name).map((n) => textOf(n.parentNode).trim());

async function assertLoaders(m) {
  let ui = await mountRead(m.FORMS.build['solution-design'][0], 'solution-design');
  try {
    assert.deepEqual(labels(ui, 'pain_group_id'), ['Manual reconciliation', 'None yet'], 'the venture\'s themes, then None yet last');
    assert.deepEqual([chosen(ui, 'pain_group_id'), chosen(ui, 'hypothesis_id')], [['11'], ['5']], 'the first chosen, as the canvas draws it');
    assert.deepEqual(labels(ui, 'impact'), ['Low', 'Medium', 'High'], 'the canvas\'s fixed chips, not the read\'s');
  } finally { await ui.unmount(); }
  ui = await mountRead(m.FORMS.build['product-roadmap'][0], 'product-roadmap');
  try {
    assert.deepEqual([chosen(ui, 'kpi_key'), chosen(ui, 'feedback_theme'), chosen(ui, 'waits_on_id')], [['mrr'], [''], ['']], 'Moves KPI first; Answers None; Waits on Nothing');
    assert.deepEqual(labels(ui, 'waits_on_id'), ['Nothing', 'Second bank']);
  } finally { await ui.unmount(); }
  ui = await mountRead(m.FORMS.build['founding-team'][0], 'founding-team');
  try { assert.ok(ui.text().includes('Unallocated now 20%.')); } finally { await ui.unmount(); }
  ui = await mountRead(m.FORMS.build['company-creation'][0], 'company-creation');
  try {
    assert.deepEqual(labels(ui, 'jurisdiction'), ['DE', 'Federal', 'Other']);
    assert.deepEqual(chosen(ui, 'jurisdiction'), ['DE'], 'the entity\'s jurisdiction first');
  } finally { await ui.unmount(); }
  ui = await mountRead(m.FORMS.build['operating-systems'][0], 'operating-systems');
  try {
    assert.deepEqual(labels(ui, 'provider_accounting'), ['Xero'], 'Accounting\'s providers while Accounting is chosen');
    assert.equal(ui.radios('sync').length, 4, 'the caller may set Accounting\'s Sync');
    await ui.choose('system', 'crm');
    assert.deepEqual(labels(ui, 'provider_crm'), ['HubSpot']);
    assert.equal(ui.radios('provider_accounting').length, 0);
    assert.equal(ui.radios('sync').length, 0, 'another member\'s CRM: no Sync (sync_editable false)');
    await ui.submit();
    assert.deepEqual(ui.sends('system'), [['system', P, 'crm', { feeds: ['use_of_funds', 'kpis'] }]], 'no sync sent where it may not be set');
  } finally { await ui.unmount(); }
}

test('8 (PR 3b): each loader takes only the venture\'s own choices from Build\'s form-options, in the canvas\'s order', async () => {
  await mutationCheck(source, path, assertLoaders, [
    ['const thenNone = (read, name, none = NONE_YET) => ({ options: [...readChips(read, name), none], def: 0 });', 'const thenNone = (read, name, none = NONE_YET) => ({ options: [none, ...readChips(read, name)], def: 0 });'],
    ["feedback_theme: { options: [...readChips(read, 'feedback_theme'), NONE_CHIP], def: NONE_CHIP.value },", "feedback_theme: { options: [...readChips(read, 'feedback_theme'), NONE_CHIP], def: 0 },"],
    ["{ equity_pct: { note: `Unallocated now ${read.unallocated.value}%.` } }", '{}'],
    ["sync: { when: (v) => v.system !== 'workspace' && editable.has(v.system) },", "sync: { when: (v) => v.system !== 'workspace' },"],
    ["jurisdiction: { options: [...readChips(read, 'jurisdiction'), { value: '', label: 'Other' }], def: 0 },", "jurisdiction: { options: [{ value: '', label: 'Other' }, ...readChips(read, 'jurisdiction')], def: 0 },"],
  ]);
});

async function assertProof(m) {
  const form = m.FORMS.build['company-creation'][0];
  const file = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });
  let ui = await mountRead(form, 'company-creation');
  try {
    const box = ui.inputs().find((n) => propsOf(n).name === 'proof' && propsOf(n).type === 'file');
    assert.ok(box, 'Proof is a file box');
    await ui.input('proof', file);
    await ui.submit();
    assert.equal(ui.sends('formationStep').length, 1);
    const [, cycle, project, slug, id, key, body] = ui.sends('recordAction')[0];
    assert.deepEqual([cycle, project, slug, id, key], ['build', P, 'company-creation', 'step-9', 'upload-proof'], 'the new step\'s own Upload proof');
    assert.ok(body instanceof FormData && body.get('file') === file, 'the bytes, as `file`');
  } finally { await ui.unmount(); }
  ui = await mountRead(form, 'company-creation');
  try {
    await ui.submit();
    assert.equal(ui.sends('recordAction').length, 0, 'no proof, no upload');
  } finally { await ui.unmount(); }
}

test('8 (PR 3b): Add filing sends its Proof through the new step\'s Upload proof, once the filing exists', async () => {
  await mutationCheck(source, path, assertProof, [
    ["      try { await w.recordAction('build', projectId, 'company-creation', `step-${made.id}`, 'upload-proof', body); }", "      try { await w.recordAction('build', projectId, 'company-creation', made.id, 'upload-proof', body); }"],
    ["      body.append('file', file);", "      body.append('proof', file);"],
    ["    if (made?.id && file && typeof file === 'object' && typeof file.name === 'string') {", '    if (made?.id) {'],
  ]);
});

function assertStored(m) {
  const feature = m.EDITS.build['solution-design'];
  assert.deepEqual(feature.valuesOf({ edit: { impact: 'High', effort: 'S', is_must_have: 'yes' } }), { impact: 'high', effort: 'low', is_must_have: 'yes' });
  assert.deepEqual(feature.valuesOf({ edit: { effort: 'XL' } }), {}, 'an XL effort the form does not offer is left out, so it is neither shown nor sent');
  const must = m.EDITS.build['prototype-mvp'];
  assert.deepEqual(must.valuesOf({ edit: { state: 'In Progress' } }), { state: 'in_progress' });
  assert.deepEqual(must.valuesOf({ edit: { state: 'Review' } }), {});
  const filing = m.EDITS.build['company-creation'];
  assert.deepEqual(filing.valuesOf({ edit: { state: 'doing', for_holder_id: 4 } }), { state: 'upcoming', for_holder_id: 'h-4' });
  assert.deepEqual(filing.valuesOf({ edit: { state: 'done' } }), { state: 'filed' });
  for (const slug of ['solution-design', 'prototype-mvp', 'product-roadmap', 'founding-team', 'company-creation']) assert.equal(m.EDITS.build[slug].readsRecord, true, slug);
  assert.equal(m.EDITS.build['operating-systems'].readsRecord, undefined, 'Choose connector keeps its row values');
}

test('6 (PR 3b): each Build Edit reads the record\'s stored words as the canvas\'s, and leaves out a value the form does not offer', async () => {
  await mutationCheck(source, path, assertStored, [
    ["    canvasWord(v, 'effort', EFFORT_STORED, LEVEL);\n", ''],
    ['  if (choices.some((o) => o.value === word)) v[key] = word;\n  else delete v[key];', '  v[key] = word;'],
    ["const FILING_STORED = { todo: 'upcoming', doing: 'upcoming', done: 'filed' };", "const FILING_STORED = { todo: 'upcoming', done: 'filed' };"],
    ["    if (/^[1-9]\\d*$/.test(String(v.for_holder_id ?? ''))) v.for_holder_id = `h-${v.for_holder_id}`;\n", ''],
  ]);
});

async function assertBuildWrites(m) {
  const sent = [];
  const w = m.makeCycleWrites(async (url, opts = {}) => { sent.push([url, opts.method ?? 'GET', opts.inlinePaywall === true, opts.body instanceof FormData ? 'form' : opts.body ? JSON.parse(opts.body) : null]); return {}; });
  await w.build.addFeature(P, { title: 'f' });
  await w.build.addMustHave(P, { title: 'm' });
  await w.build.roadmapItem(P, { title: 'i' });
  await w.build.roadmapItemUpdate(P, 3, { column: 'now' });
  await w.build.founder(P, { name: 'Ana' });
  await w.build.founderUpdate(P, 'h-4', { role: 'CTO' });
  await w.recordAction('build', P, 'company-creation', 'step-9', 'upload-proof', new FormData());
  assert.deepEqual(sent, [
    ['/cycles/build/features?project=3', 'POST', false, { title: 'f' }],
    ['/cycles/build/must-haves?project=3', 'POST', false, { title: 'm' }],
    ['/cycles/build/roadmap?project=3', 'POST', false, { title: 'i' }],
    ['/cycles/build/roadmap/3?project=3', 'PATCH', false, { column: 'now' }],
    ['/cycles/build/founders?project=3', 'POST', true, { name: 'Ana' }],
    ['/cycles/build/founders/h-4?project=3', 'PATCH', true, { role: 'CTO' }],
    ['/cycles/build/modules/company-creation/records/step-9/actions/upload-proof?project=3', 'POST', false, 'form'],
  ], 'the venture in the query; Add founder’s plan refusal drawn in the dialog (inlinePaywall)');
  await assert.rejects(() => w.recordAction('nope', P, 'x', 1, 'y'), /no records/);
}

test('11 (PR 3b): each Build write calls its spelled-out route, Add founder draws its plan refusal itself, and Upload proof goes as FormData', async () => {
  const writesPath = 'lib/api/cycleWrites.js';
  await mutationCheck(writes, writesPath, assertBuildWrites, [
    ["{ method: 'POST', body: JSON.stringify(body), inlinePaywall: true }),\n      founderUpdate", "{ method: 'POST', body: JSON.stringify(body) }),\n      founderUpdate"],
    ["        method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body),", "        method: 'POST', body: JSON.stringify(body),"],
    ["roadmapItemUpdate: (projectId, id, body) => request(`/cycles/build/roadmap/${seg(id)}?${q(projectId)}`, { method: 'PATCH',", "roadmapItemUpdate: (projectId, id, body) => request(`/cycles/build/roadmap/${seg(id)}?${q(projectId)}`, { method: 'PUT',"],
  ]);
  const calls = extractClientCalls(writes).map((c) => `${c.method} ${normalizePath(c.path)}`);
  for (const want of ['POST /cycles/build/features', 'POST /cycles/build/must-haves', 'POST /cycles/build/roadmap', 'PATCH /cycles/build/roadmap/:p',
    'POST /cycles/build/founders', 'PATCH /cycles/build/founders/:p']) assert.ok(calls.some((c) => c.endsWith(want)), want);
});
