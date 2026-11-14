/**
 * D6113 (#6113) — a record row's further actions (`row.actions`), and a row
 * form's own starting values (`values` on a row's action reference), as the
 * records contract draws them generically: an entry step's Mark done, Edit
 * and Remove. Synthetic record; every name is made up.
 *
 * Mutation checked (each made a test below fail, then was restored):
 *   · recordModel.js rowView no longer passing `actions` → the model and view tests fail.
 *   · recordModel.js rowAction dropping `values` → the model test fails.
 *   · recordModel.js recordFormFor not overlaying a row's values → the model test fails.
 *   · recordModel.js availableRecord not filtering `actions` → the model test fails (an undeclared key survives).
 *   · RecordView.jsx desktop `{more}` removed → the view test fails.
 *   · RecordView.jsx phone rows not including `...more` → the phone test fails.
 *   · RecordView.jsx header or phone Actions drawing `rowOnly` actions → the desktop or phone test fails.
 * (Each is run below through `mutationCheck`, so the suite re-proves them every run.)
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_row_actions_6113.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as rules from '../src/pages/cycles/recordModel.js';
import * as view from '../src/pages/cycles/RecordView.jsx';
import { mutationCheck } from './_record_d696.mjs';

const h = React.createElement;
const modelSource = readFileSync(new URL('../src/pages/cycles/recordModel.js', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/pages/cycles/RecordView.jsx', import.meta.url), 'utf8');

const record = () => ({
  module: 'market-expansion', id: 'mka1', title: 'Portugal', sub: 'Considering', pills: [],
  facts: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }, { label: 'C', value: 3 }, { label: 'D', value: 4 }],
  main: [{ key: 'entry-plan', title: 'Entry plan', rows: [
    { a: 'Register the company', c: 'Open', tone: 'amb', action: { key: 'mark-entry-step-done', body: { step: 's1' } },
      actions: [
        { key: 'edit-entry-step', body: { step: 's1' }, values: { text: 'Register the company', owner_name: 'Ana', due_on: '' } },
        { key: 'remove-entry-step', body: { step: 's1' } },
        { key: 'undeclared', body: { step: 's1' } },
      ] },
    { a: 'Open a bank account', c: 'Done', tone: 'ok' },
  ] }],
  side: [],
  actions: [
    { key: 'mark-entry-step-done', label: 'Mark done', kind: 'write', rowOnly: true },
    { key: 'edit-entry-step', label: 'Edit step', kind: 'form', rowOnly: true, form: { title: 'Edit entry step', fields: [
      { key: 'text', label: 'Step', kind: 'T', required: true }, { key: 'owner_name', label: 'Owner', kind: 'T', value: 'declared' },
    ] } },
    { key: 'edit', label: 'Edit market', kind: 'form', tone: 'primary', form: { fields: [] } },
    { key: 'remove-entry-step', label: 'Remove step', kind: 'write', tone: 'danger', rowOnly: true, confirm: { title: 'Remove this entry step?', cta: 'Remove' } },
  ],
  activity: [], activity_total: 0,
});

function assertModel(m) {
  const r = record(); const declared = m.declaredActions(r);
  const row = m.rowView(r.main[0].rows[0]);
  assert.equal(row.actions?.length, 3);
  assert.equal('actions' in m.rowView(r.main[0].rows[1]), false, 'a row with none carries none');
  const edit = m.rowAction(row.actions[0], declared);
  assert.deepEqual(edit.body, { step: 's1' });
  assert.deepEqual(edit.values, { text: 'Register the company', owner_name: 'Ana', due_on: '' });
  assert.equal(m.rowAction(row.actions[2], declared), null);
  // The form opens on the row's own values, only for the fields it declares.
  const spec = m.recordFormFor(edit, r, null);
  assert.deepEqual(spec.current, { text: 'Register the company', owner_name: 'Ana' });
  // A declared value stays when the row sends none.
  assert.deepEqual(m.recordFormFor(m.rowAction({ key: 'edit-entry-step', body: { step: 's1' } }, declared), r, null).current, { owner_name: 'declared' });
  const shown = m.availableRecord(r, null).main[0].rows[0];
  assert.deepEqual(shown.actions.map((a) => a.key), ['edit-entry-step', 'remove-entry-step']);
}
test('a row carries further actions, and its form opens on its own values', async () => {
  assertModel(rules);
  await mutationCheck(modelSource, 'pages/cycles/recordModel.js', assertModel, [
    ['...(Array.isArray(row.actions) && row.actions.length ? { actions: row.actions } : {})', '...{}'],
    ['? { ...own, values: reference.values } : own', '? own : own'],
    ['if (action.values && Object.hasOwn(action.values, field.name))', 'if (false)'],
    ['{ actions: row.actions.filter(ref => canRun(rowAction(ref, declarations))) }', '{ actions: row.actions }'],
  ]);
});

const desktop = (m) => renderToStaticMarkup(h(m.default, { record: record(), cycleName: 'Grow', moduleName: 'Market expansion', onForm() {}, onWrite() {} }));
const phone = (m) => renderToStaticMarkup(h(m.RecordPhoneProvider, { phone: true },
  h(m.default, { record: record(), cycleName: 'Grow', moduleName: 'Market expansion', onForm() {}, onWrite() {} })));
const plan = (html) => html.slice(html.indexOf('Entry plan'), html.indexOf('Activity'));

function assertDesktop(m) {
  const whole = desktop(m);
  // A rowOnly action is not one of the record's own: only the row draws it.
  const header = whole.slice(0, whole.indexOf('Entry plan'));
  for (const label of ['Mark done', 'Edit step', 'Remove step']) assert.ok(!header.includes(label), `${label} not in the header`);
  assert.ok(header.includes('Edit market'), 'the record\'s own Edit stays');
  const html = plan(whole);
  for (const label of ['Mark done', 'Edit step', 'Remove step']) assert.ok(html.includes(`>${label}</button>`), label);
  assert.ok(html.indexOf('>Mark done<') < html.indexOf('>Edit step<') && html.indexOf('>Edit step<') < html.indexOf('>Remove step<'), 'own action first');
  // Only the first row has actions.
  assert.equal((html.match(/>Edit step</g) || []).length, 1);
}
test('desktop: a row draws its further actions after its own', async () => {
  assertDesktop(view);
  await mutationCheck(viewSource, 'pages/cycles/RecordView.jsx', assertDesktop, [
    ['{ownAction && <RecordAction action={ownAction} quiet {...handlers} />}{more}', '{ownAction && <RecordAction action={ownAction} quiet {...handlers} />}'],
    ['actions={recordOwn(record.actions)} handlers={handlers}', 'actions={record.actions} handlers={handlers}'],
  ], true);
});

function assertPhone(m) {
  const whole = phone(m);
  const actionsGroup = whole.slice(whole.indexOf('data-testid="record-actions"'));
  assert.ok(actionsGroup.includes('Edit market') && !actionsGroup.includes('Remove step'), 'the phone Actions group holds the record\'s own only');
  const html = plan(whole);
  assert.ok(html.includes('Edit step'), 'Edit on the phone');
  assert.ok(html.includes('Remove step'), 'Remove on the phone');
  assert.ok(/text-red-700[^>]*>Remove step/.test(html), 'Remove drawn as a danger row');
}
test('phone: a row\'s further actions are rows beneath it', async () => {
  assertPhone(view);
  await mutationCheck(viewSource, 'pages/cycles/RecordView.jsx', assertPhone, [
    ['return [main, ...more];', 'return [main];'],
    ['<RecordActions actions={recordOwn(record.actions)}', '<RecordActions actions={record.actions}'],
  ], true);
});
