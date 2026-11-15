/**
 * #6111 — Grow's row Edits on Roles, Partners, Markets and Obligations open
 * with what the record stores.
 *
 * Each now reads its record (`readsRecord`), as Build's and Validate's do:
 * the record's own Edit action gives the values (`recordModel.js`'s
 * `recordFormFor`), mapped through the Edit's `valuesOf`. Per form:
 *
 *   - every stored value is shown: pay band and equity, typed terms, renewal
 *     and contact, a market's decision and scores, an obligation's kind,
 *     repeats and reminders;
 *   - Save with nothing changed sends no field, and a change sends only
 *     itself;
 *   - a refused or unreadable record read draws the refused form.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_edit_record_values_6111.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { EDITS } from '../src/pages/cycles/forms.js';
import { recordEditAction, recordFormFor } from '../src/pages/cycles/recordModel.js';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';

const P = 7;
const edit = (slug) => EDITS.grow[slug];

/** A write table that records each Grow call. */
function writeTable() {
  const calls = [];
  const grow = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { ok: true }; } });
  return { calls, w: { grow } };
}

/** A record read whose Edit action is `fields` (the Worker's keys and values), plus `more` actions. */
const read = (id, fields, more = [], uid = undefined) => ({
  id, ...(uid ? { uid } : {}), title: 'Record',
  actions: [{ key: 'edit', label: 'Edit', kind: 'form', form: { title: 'Edit', cta: 'Save', fields: fields.map(([key, value]) => ({ key, label: key, kind: 'T', value })) } }, ...more],
});

/** Open the Edit as CycleRoute does for a record-reading Edit, and mount it. */
async function open(slug, record) {
  const e = edit(slug);
  const spec = recordFormFor(recordEditAction(record), record, e);
  assert.ok(spec, `${slug} opens from its record`);
  const { calls, w } = writeTable();
  const ui = await mountForm(h(FormLightbox, {
    form: spec.form, current: spec.current, cycle: 'grow', slug,
    onSubmit: (values) => e.submit(w, P, spec.id, values, spec.current), onClose() {},
  }));
  await ui.flush();
  const inputs = () => ui.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName));
  const valueOf = (name) => {
    const named = inputs().filter((n) => propsOf(n).name === name);
    if (named.length && ['radio', 'checkbox'].includes(propsOf(named[0]).type)) return named.filter((n) => propsOf(n).checked).map((n) => propsOf(n).value);
    return named.length ? propsOf(named[0]).value : propsOf(ui.by(`cycle-form-${name}`)).value;
  };
  const type = (name, value) => ui.input(name, value);
  return { ...ui, spec, calls, valueOf, type };
}

const ROLE = read(5, [
  ['title', 'Founding engineer'], ['team', 'Engineering'], ['target_start', '2027-01'], ['type', 'contract'],
  ['comp_min_cents', 9000000], ['comp_max_cents', 12000000], ['comp_currency', 'usd'], ['equity_pct', 0.5], ['comp_public', ['1']],
]);
const PARTNER = read('p1', [
  ['name', 'Acme'], ['type', 'other'], ['stage', 'signed'], ['terms_kind', 'rev_share'], ['terms_pct', 20], ['terms_amount_cents', ''],
  ['terms_currency', ''], ['renewal_on', '2027-06-30'], ['contact_name', 'Ana Silva'], ['contact_email', 'ana@example.test'],
], [], 'p1');
const MARKET = read('m1', [
  ['state', 'not_now'], ['demand_score', 7], ['demand_source', 'Waitlist'], ['regulation_score', ''], ['regulation_source', ''],
  ['partners_score', 4], ['partners_source', 'Two resellers'], ['cost_score', ''], ['cost_source', ''], ['geography_ref', 'PT'],
  ['size_cents', ''], ['size_currency', ''], ['size_source', ''],
], [{ key: 'change-decision', label: 'Change decision', kind: 'form', form: { fields: [{ key: 'decision', kind: 'CH', value: 'not_yet' }] } }], 'm1');
const OBLIGATION = read(9, [
  ['title', 'Delaware franchise tax'], ['kind', 'tax'], ['due_at', '2027-03-01'], ['owner_name', 'Sam'], ['repeats', 'yearly'],
  ['remind_days', ['30', '7']], ['status', 'overdue'],
]);

test('the four Grow Edits read their record, as Build and Validate do', () => {
  for (const slug of ['team-expansion', 'partner-network', 'market-expansion', 'durable-company-building']) {
    assert.equal(edit(slug).readsRecord, true, slug);
  }
  // CycleRoute hands each record-reading Edit the values it opened with, on a row and on the record page.
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /edit\.submit\(cyclesWrite, projectId, rowEdit\.spec\.id, values, rowEdit\.spec\.current\)/);
  assert.match(route, /edit\.submit\(cyclesWrite, projectId, formSpec\.id, values, formSpec\.current\)/);
});

test('Edit role opens with title, team, type, start, pay band, equity and the jobs-board switch; untouched Save sends nothing', async () => {
  const ui = await open('team-expansion', ROLE);
  try {
    assert.equal(ui.spec.id, 5);
    assert.equal(ui.valueOf('title'), 'Founding engineer');
    assert.deepEqual(ui.valueOf('team'), ['Engineering']);
    assert.deepEqual(ui.valueOf('type'), ['contract']);
    assert.equal(ui.valueOf('target_start'), '2027-01');
    assert.equal(ui.valueOf('band'), '90,000–120,000');
    assert.equal(ui.valueOf('equity'), '0.5');
    assert.deepEqual(ui.valueOf('comp_public'), ['show']);
    await ui.submit();
    assert.deepEqual(ui.calls, [['roleUpdate', P, 5, {}]], 'no field changed, so none is sent');
  } finally { await ui.unmount(); }
  const changed = await open('team-expansion', ROLE);
  try {
    await changed.type('band', '95,000–120,000');
    await changed.submit();
    assert.deepEqual(changed.calls, [['roleUpdate', P, 5, { comp_min_cents: 9500000, comp_max_cents: 12000000, comp_currency: 'usd', comp_public: 1 }]], 'the switch goes with a changed band');
  } finally { await changed.unmount(); }
});

test('Edit partner opens with name, type, stage, typed terms, renewal and contact; only a change is sent', async () => {
  const ui = await open('partner-network', PARTNER);
  try {
    assert.equal(ui.spec.id, 'p1');
    assert.equal(ui.valueOf('name'), 'Acme');
    assert.deepEqual(ui.valueOf('type'), ['other']);
    assert.deepEqual(ui.valueOf('stage'), ['signed']);
    assert.deepEqual(ui.valueOf('terms_kind'), ['rev_share']);
    assert.equal(ui.valueOf('amount'), '20%');
    assert.equal(ui.valueOf('renewal_on'), '2027-06-30');
    assert.equal(ui.valueOf('contact_name'), 'Ana Silva');
    assert.equal(ui.valueOf('contact_email'), 'ana@example.test');
    await ui.submit();
    assert.deepEqual(ui.calls, [['partnerUpdate', P, 'p1', {}]]);
  } finally { await ui.unmount(); }
  const changed = await open('partner-network', PARTNER);
  try {
    await changed.type('contact_email', 'ana@acme.test');
    await changed.submit();
    assert.deepEqual(changed.calls, [['partnerUpdate', P, 'p1', { contact_email: 'ana@acme.test' }]]);
  } finally { await changed.unmount(); }
  // An amount in dollars is shown as dollars.
  const inDollars = { ...PARTNER, actions: [{ ...PARTNER.actions[0], form: { fields: [
    { key: 'terms_kind', value: 'services_fee' }, { key: 'terms_pct', value: '' }, { key: 'terms_amount_cents', value: 400000 },
  ] } }] };
  const dollars = recordFormFor(recordEditAction(inDollars), inDollars, edit('partner-network'));
  assert.equal(dollars.current.amount, '4,000');
});

test('Edit market opens with state, decision, each scored part with its source, and the country; only a change is sent', async () => {
  const ui = await open('market-expansion', MARKET);
  try {
    assert.deepEqual(ui.valueOf('state'), ['not_now']);
    assert.deepEqual(ui.valueOf('decision'), ['not_yet'], 'read from the record\'s Change decision form');
    assert.deepEqual(ui.valueOf('parts'), ['demand', 'partners']);
    assert.equal(ui.valueOf('demand_score'), '7');
    assert.equal(ui.valueOf('demand_source'), 'Waitlist');
    assert.equal(ui.valueOf('partners_score'), '4');
    assert.equal(ui.valueOf('partners_source'), 'Two resellers');
    assert.deepEqual(ui.valueOf('geography_ref'), ['PT']);
    await ui.submit();
    assert.deepEqual(ui.calls, [['marketUpdate', P, 'm1', {}]]);
  } finally { await ui.unmount(); }
  const changed = await open('market-expansion', MARKET);
  try {
    await changed.type('demand_score', '8');
    await changed.submit();
    assert.deepEqual(changed.calls, [['marketUpdate', P, 'm1', { demand_score: 8 }]], 'the source is unchanged, so not sent');
  } finally { await changed.unmount(); }
  // A read with no Change decision draws no decision, rather than a blank one.
  const noDecision = recordFormFor(recordEditAction(MARKET), { ...MARKET, actions: [MARKET.actions[0]] }, edit('market-expansion'));
  assert.equal(Object.hasOwn(noDecision.current, 'decision'), false);
  assert.ok(!noDecision.form.fields.some((f) => f.name === 'decision'));
});

test('Edit obligation opens with title, kind, due date, owner, repeats, reminders and state; only a change is sent', async () => {
  const ui = await open('durable-company-building', OBLIGATION);
  try {
    assert.equal(ui.spec.id, 9);
    assert.equal(ui.valueOf('title'), 'Delaware franchise tax');
    assert.deepEqual(ui.valueOf('kind'), ['tax']);
    assert.equal(ui.valueOf('due_at'), '2027-03-01');
    assert.equal(ui.valueOf('owner_name'), 'Sam');
    assert.deepEqual(ui.valueOf('repeats'), ['yearly']);
    assert.deepEqual(ui.valueOf('remind'), ['30', '7'], 'every stored reminder, including ones the Add does not offer');
    assert.deepEqual(ui.valueOf('status'), ['overdue']);
    assert.match(ui.text(), /30 days before/);
    await ui.submit();
    assert.deepEqual(ui.calls, [['obligationUpdate', P, 9, {}]]);
  } finally { await ui.unmount(); }
  const changed = await open('durable-company-building', OBLIGATION);
  try {
    await changed.choose('remind', '1');
    await changed.submit();
    assert.deepEqual(changed.calls, [['obligationUpdate', P, 9, { remind_days: [30, 7, 1] }]]);
  } finally { await changed.unmount(); }
});

test('a refused or unreadable record read draws the refused form, with nothing to save', async () => {
  for (const slug of ['team-expansion', 'partner-network', 'market-expansion', 'durable-company-building']) {
    const e = edit(slug);
    // A read with no Edit action opens nothing; CycleRoute then draws the refusal.
    assert.equal(recordFormFor(recordEditAction({ id: 1, actions: [] }), { id: 1, actions: [] }, e), null, slug);
    const ui = await mountForm(h(FormLightbox, { form: { ...e, fields: [] }, cycle: 'grow', slug, refused: 'This record could not be read.', onSubmit() { assert.fail('nothing is sent'); }, onClose() {} }));
    try {
      assert.equal(textOf(ui.by('cycle-form-refusal')), 'This record could not be read.', slug);
      assert.ok(propsOf(ui.by('cycle-form-save')).disabled, `${slug}: nothing to save`);
      await ui.submit();
    } finally { await ui.unmount(); }
  }
});

test('Edit role from its record: turning the jobs-board switch off alone sends it', async () => {
  const ui = await open('team-expansion', ROLE);
  try {
    await ui.choose('comp_public', 'show');
    await ui.submit();
    assert.deepEqual(ui.calls, [['roleUpdate', P, 5, { comp_public: 0 }]]);
  } finally { await ui.unmount(); }
});
