/**
 * D695 PR 3a (#1656): Build's six canvas forms (CO:311-316) and their Edits
 * as specs, registered nowhere until PR 3b (decision 15).
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
import { h, mountForm, mutationCheck, propsOf } from './_form_d695.mjs';

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
    labels: ['Filing', 'Jurisdiction', 'Due', 'For', 'State'],
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
    assert.equal(sys.radios('provider').length, 0, 'no provider is offered that the read did not name');
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
    ["note: (v) => ({ text: `No ${systemLabel(v.system)} provider can be connected yet.`, href: '/build/connect' }) },", '},'],
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
  const crm = await sys.submit(w, P, { system: 'crm', provider: 'hubspot', sync: 'hourly', feeds: ['kpis'] });
  assert.deepEqual(calls, [['system', P, 'crm', { feeds: ['kpis'], sync: 'hourly' }]]);
  for (const k of ['integration_uid', 'integration_id', 'provider_key']) assert.ok(!Object.hasOwn(calls[0][3], k), `never ${k}`);
  for (const k of keys(calls[0][3])) assert.ok(routeKeys('put', '/systems/:kind').has(k), `PUT /systems/:kind reads ${k}`);
  assert.deepEqual(crm, { next: `/build/connect?project_id=${P}&tool=hubspot` });
  calls.length = 0;
  const ws = await sys.submit(w, P, { system: 'workspace', provider: 'google', sync: 'daily', feeds: ['team'] });
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
      "toBody: (v) => ({ feeds: Array.isArray(v.feeds) ? v.feeds : [], sync: v.sync, provider_key: v.provider }),"],
    ["if (/^[a-z0-9_-]{1,64}$/.test(String(tool ?? ''))) q.set('tool', String(tool));", "q.set('tool', String(tool));"],
    ["{ value: '', label: 'Other' }], def: 0, optionsFrom: 'jurisdictions' },", "{ value: 'Other', label: 'Other' }], def: 0, optionsFrom: 'jurisdictions' },"],
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
    ["    if (v.due_date) v.due_date = dateText(v.due_date);\n    return v;\n  },\n  toBody: (v) => onlyShown(v, { ...mustHaveBody(v)", "    return v;\n  },\n  toBody: (v) => onlyShown(v, { ...mustHaveBody(v)"],
  ]);
});

// ---------- Registered nowhere (decision 15) ---------------------------------

test('15: no Build spec is registered, today\'s Build forms are unchanged, and no Build write method is added', () => {
  assert.deepEqual(Object.keys(m0.FORMS.build), ['solution-design', 'prototype-mvp', 'company-creation'], 'today\'s registered Build Adds');
  assert.deepEqual(Object.keys(m0.EDITS.build), ['solution-design', 'prototype-mvp', 'company-creation', 'operating-systems']);
  for (const slug of SLUGS) {
    for (const f of m0.BUILD_FORMS[slug]) assert.ok(!m0.formsFor('build', slug).includes(f), `${slug}: ${f.key} is not registered`);
    if (m0.BUILD_EDITS[slug]) assert.notEqual(m0.editFor('build', slug), m0.BUILD_EDITS[slug], `${slug}: its Edit is not registered`);
  }
  for (const method of ['addFeature', 'addMustHave', 'roadmapItem', 'roadmapItemUpdate', 'founder', 'founderUpdate']) {
    assert.ok(!new RegExp(`\\b${method}:`).test(writes), `cycleWrites.js has no ${method} yet`);
  }
});
