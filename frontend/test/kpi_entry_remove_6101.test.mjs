/**
 * D6101 (#6101) — a KPI entry's Remove runs from its History row alone.
 *
 * The read declares `remove-entry` with `row_only: true`; each hand entry's
 * History row names it with the entry's id. The header row and the Actions
 * list (desktop and phone) draw no button for it, so Remove is never pressed
 * without an entry; the row still resolves it and draws it as a danger
 * action.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/kpi_entry_remove_6101.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { headerRow } from '../src/pages/cycles/recordHeaderModel.js';
import { RecordActions, RecordPhoneProvider, RecordSection } from '../src/pages/cycles/RecordView.jsx';
import { declaredActions } from '../src/pages/cycles/recordModel.js';

const h = React.createElement;
const html = (el, phone = false) => renderToStaticMarkup(h(MemoryRouter, null, h(RecordPhoneProvider, { phone }, el)));

const REMOVE = { key: 'remove-entry', label: 'Remove', kind: 'write', tone: 'danger', row_only: true,
  confirm: { title: 'Remove this MRR entry?', body: 'For a figure typed with the wrong value.', cta: 'Remove' } };
const ENTER = { key: 'enter-by-hand', label: 'Enter by hand', kind: 'form', tone: 'primary', form: { title: 'Enter MRR', fields: [] } };
const RECORD = {
  actions: [ENTER, REMOVE],
  main: [{ key: 'history', title: 'History', rows: [
    { a: '2026-11-13', b: '$9,000', c: 'By hand', tone: 'grey', action: { key: 'remove-entry', body: { entry: '2' } } },
    { a: '2026-10-20', b: '$3,000', c: 'stripe', tone: 'vio' },
  ] }],
  side: [],
};

test('the header row leaves a row_only action out of every slot', () => {
  const row = headerRow(RECORD.actions);
  assert.equal(row.primary.key, 'enter-by-hand');
  assert.deepEqual(row.secondary.map((a) => a.key), []);
  assert.deepEqual(row.menu.map((a) => a.key), [], 'Remove is not behind ⋯');
  // A danger action without the flag still goes behind ⋯, as before.
  assert.deepEqual(headerRow([{ ...REMOVE, row_only: false }]).menu.map((a) => a.key), ['remove-entry']);
});

test('the Actions list draws no Remove button, on desktop or a phone', () => {
  for (const phone of [false, true]) {
    const out = html(h(RecordActions, { actions: RECORD.actions, onForm: () => {}, onWrite: () => {} }), phone);
    assert.match(out, /Enter by hand/, `phone=${phone}`);
    assert.doesNotMatch(out, />Remove</, `phone=${phone}`);
  }
});

test('the hand entry\'s History row still draws its Remove; the connected row has none', () => {
  const declarations = declaredActions(RECORD);
  assert.equal(declarations.get('remove-entry').row_only, true);
  const out = html(h(RecordSection, { section: RECORD.main[0], declarations, cycleName: 'Grow', moduleName: 'Revenue and traction', onWrite: () => {} }));
  assert.equal((out.match(/>Remove</g) ?? []).length, 1);
  assert.match(out, /\$9,000/);
  assert.match(out, /\$3,000/);
});
