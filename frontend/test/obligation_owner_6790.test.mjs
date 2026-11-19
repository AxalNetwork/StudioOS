/**
 * D6790 (#6790) — an obligation's owner is picked from the company team (GR-23).
 *
 *   - Add obligation's Owner is a listbox of Durable's `owners` (the company
 *     team), No one yet first, and sends `owner_user_id`.
 *   - Edit obligation opens on the picked member; a name typed before the
 *     change is kept as its own choice and never sent until someone is picked.
 *   - A module row shows the Worker's `owner`; an ownerless row offers Pick
 *     owner, which opens the same Edit focused on the owner listbox.
 *   - Calendar → Compliance draws the same `owner` the Worker sends.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/obligation_owner_6790.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { EDITS, FORMS, obligationOwnerOptions } from '../src/pages/cycles/forms.js';
import { recordEditAction, recordFormFor } from '../src/pages/cycles/recordModel.js';
import { adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { pickOwnerAction } from '../src/pages/cycles/cycleModel.js';
import { ownerLine } from '../src/pages/calendarComplianceModel.js';
import { h, mountForm, propsOf } from './_form_d695.mjs';

const P = 7;
const SLUG = 'durable-company-building';
const add = FORMS.grow[SLUG][0];
const edit = EDITS.grow[SLUG];
const TEAM = { owners: [{ value: '11', label: 'Cai Moreno' }, { value: '10', label: 'Ana Wren' }] };

function writeTable(read = TEAM) {
  const calls = [];
  const grow = new Proxy({}, { get: (_t, name) => async (...args) => { calls.push([name, ...args]); return { ok: true }; } });
  return { calls, w: { grow, formOptions: async (cycle, projectId, slug) => { calls.push(['formOptions', cycle, projectId, slug]); return read; } } };
}

async function mount(form, { current, submit, w }) {
  const ui = await mountForm(h(FormLightbox, {
    form, current, cycle: 'grow', slug: SLUG, onSubmit: submit, onClose() {}, loadOptions: () => form.loadOptions(w, P),
  }));
  await ui.flush();
  const radios = (name) => ui.nodes().filter((n) => n.tagName === 'INPUT' && propsOf(n).name === name);
  return { ...ui, chips: (name) => radios(name).map((n) => propsOf(n).value),
    picked: (name) => radios(name).filter((n) => propsOf(n).checked).map((n) => propsOf(n).value) };
}

test('Add obligation: the owner is a listbox of the company team, and sends owner_user_id', async () => {
  assert.deepEqual(obligationOwnerOptions(TEAM), { owner_user_id: { opts: [{ value: '', label: 'No one yet' }, { value: '11', label: 'Cai Moreno' }, { value: '10', label: 'Ana Wren' }] } });
  assert.deepEqual(obligationOwnerOptions(null), { owner_user_id: { opts: [{ value: '', label: 'No one yet' }] } }, 'no team read: No one yet alone');
  const field = add.fields.find((f) => f.name === 'owner_user_id');
  assert.equal(field.kind, 'CH');
  assert.ok(!add.fields.some((f) => f.name === 'owner_name'), 'no free-text owner');
  const { calls, w } = writeTable();
  const ui = await mount(add, { w, submit: (v) => add.submit(w, P, v) });
  try {
    assert.deepEqual(calls[0], ['formOptions', 'grow', P, SLUG]);
    assert.deepEqual(ui.chips('owner_user_id'), ['', '11', '10']);
    await ui.input('title', 'Annual return'); await ui.input('due_at', '2026-12-12');
    await ui.choose('owner_user_id', '11');
    await ui.submit();
    assert.deepEqual(calls.at(-1), ['obligation', P, { title: 'Annual return', kind: 'governance', due_at: '2026-12-12', owner_user_id: '11', repeats: 'quarterly', remind_days: [14, 1] }]);
  } finally { await ui.unmount(); }
});

/** A record read: its Edit's owner field is the listbox value, its Owner fact what the page shows. */
const record = (ownerId, shown) => ({
  id: 9, title: 'Board meeting',
  facts: [{ label: 'Kind', value: 'Governance' }, { label: 'Due', value: '2027-03-01' }, shown == null ? { label: 'Owner', value: null, reason: 'No owner named', action: 'pick-owner' } : { label: 'Owner', value: shown }],
  actions: [{ key: 'edit', label: 'Edit', kind: 'form', form: { title: 'Edit', fields: [
    { key: 'title', kind: 'T', value: 'Board meeting' }, { key: 'due_at', kind: 'T', value: '2027-03-01' }, { key: 'owner_user_id', kind: 'CH', value: ownerId }, { key: 'status', kind: 'CH', value: 'upcoming' },
  ] } }],
});

async function openEdit(read) {
  const spec = recordFormFor(recordEditAction(read), read, edit);
  const { calls, w } = writeTable();
  const ui = await mount(spec.form, { current: spec.current, w, submit: (v) => edit.submit(w, P, spec.id, v, spec.current) });
  return { ui, calls: () => calls.filter((c) => c[0] !== 'formOptions'), spec };
}

test('Edit obligation: a name typed before the change stays a choice and is never sent until someone is picked', async () => {
  const { ui, calls, spec } = await openEdit(record('', 'Sam Typed'));
  try {
    assert.equal(spec.current.owner_user_id, '__typed');
    assert.deepEqual(ui.chips('owner_user_id'), ['', '11', '10', '__typed'], 'the team, then the typed name');
    assert.deepEqual(ui.picked('owner_user_id'), ['__typed']);
    assert.match(ui.text(), /Sam Typed \(typed, not on the team\)/);
    await ui.input('title', 'Board meeting (Q4)');
    await ui.submit();
    assert.deepEqual(calls(), [['obligationUpdate', P, 9, { title: 'Board meeting (Q4)' }]], 'the typed name is kept: no owner is sent');
  } finally { await ui.unmount(); }
  const picked = await openEdit(record('', 'Sam Typed'));
  try {
    await picked.ui.choose('owner_user_id', '11');
    await picked.ui.submit();
    assert.deepEqual(picked.calls(), [['obligationUpdate', P, 9, { owner_user_id: '11' }]]);
  } finally { await picked.ui.unmount(); }
  // Defensive: the kept chip is never sent, even with no record to compare against.
  assert.equal(Object.hasOwn(edit.toBody({ owner_user_id: '__typed', title: 'X', status: 'upcoming' }, null), 'owner_user_id'), false);
});

test('Edit obligation: opens on the picked member, labelled from the record, and sends only a change', async () => {
  const { ui, calls } = await openEdit(record('11', 'Cai Moreno'));
  try {
    assert.deepEqual(ui.picked('owner_user_id'), ['11']);
    await ui.submit();
    assert.deepEqual(calls(), [['obligationUpdate', P, 9, {}]]);
  } finally { await ui.unmount(); }
  const cleared = await openEdit(record('11', 'Cai Moreno'));
  try {
    await cleared.ui.choose('owner_user_id', '');
    await cleared.ui.submit();
    assert.deepEqual(cleared.calls(), [['obligationUpdate', P, 9, { owner_user_id: null }]], 'No one yet clears the owner');
  } finally { await cleared.ui.unmount(); }
});

test('module rows: the Worker\'s owner is shown, and an ownerless row offers Pick owner', () => {
  const rows = adaptRecords('grow', SLUG, { cols: ['Obligation', 'Kind', 'Due', 'Owner', 'State', 'Repeats'], rows: [
    { id: 1, title: 'Annual return', owner: 'Cai Moreno', owner_user_id: 11, owner_name: null },
    { id: 2, title: 'Board meeting', owner: 'Sam Typed', owner_user_id: null, owner_name: 'Sam Typed' },
    { id: 3, title: 'Franchise tax', owner: null, owner_user_id: null, owner_name: null },
  ] }).rows;
  assert.deepEqual(rows.map((r) => r.cells.owner), ['Cai Moreno', 'Sam Typed', { text: 'No owner named', tone: 'warn' }]);
  assert.deepEqual(rows.map((r) => r.keys.owner), ['set', 'set', 'none']);
  assert.deepEqual(rows[0].edit, { title: 'Annual return', status: null, owner_user_id: 11, owner: 'Cai Moreno', owner_name: null, due_at: null, id: 1 });
  const open = () => 'opened';
  assert.equal(pickOwnerAction(rows[0], { text: 'Annual return' }, open), null);
  assert.equal(pickOwnerAction(rows[2], { text: 'Franchise tax' }, null), null, 'no Edit, no Pick owner');
  assert.deepEqual(pickOwnerAction(rows[2], { text: 'Franchise tax' }, open), { text: 'Pick owner', label: 'Pick an owner for Franchise tax', onClick: open });
  // CycleRoute opens the row's Edit focused on the owner listbox.
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /\.\.\.pickOwnerAction\(row, [^\n]+\n\s+\(\) => navigate\([^\n]+editingFocus: 'owner_user_id' \}/);
});

test('Calendar → Compliance draws the owner the Worker sends', () => {
  assert.deepEqual(ownerLine({ compliance: { owner: 'Cai Moreno' } }), { name: 'Cai Moreno', missing: null });
  assert.equal(ownerLine({ compliance: { owner: null } }).name, 'Not recorded');
});
