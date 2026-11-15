/**
 * D6112 (#6112) — the Partner network record's Enter revenue, as the record
 * page runs it: the Worker's declaration (shape pinned by
 * `cloudflare-worker/test/grow_partner_revenue_6112.test.ts`) opens a form
 * with a month and an amount in dollars, the form's own check reads the
 * amount as dollars, and the body sent is the two values. A reader's read
 * carries no action, so the Revenue by month section offers none. The table
 * and the chart read a typed month as typed, and an unrecorded month as Not recorded.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_partner_revenue_6112.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { availableRecord, recordActionBody, recordFormFor } from '../src/pages/cycles/recordModel.js';
import { formErrors, formFields } from '../src/pages/cycles/FormLightbox.jsx';
import { CARDS, RECORDS } from '../src/pages/cycles/adapters/grow.js';

const ENTER = {
  key: 'enter-revenue', label: 'Enter revenue', kind: 'form',
  form: { title: 'Enter revenue', cta: 'Save', fields: [
    { key: 'month', label: 'Month', kind: 'T', placeholder: 'YYYY-MM', value: '2026-11', required: true },
    { key: 'amount', label: 'Amount', kind: 'T', input: 'money', required: true, note: 'US dollars.' },
  ] },
};
const read = (actions) => ({
  id: 'pt1', title: 'Lantern Resellers', actions,
  main: [{ key: 'revenue', title: 'Revenue by month', rows: [{ a: 'Oct 2026', b: 'typed', c: '$1,200' }], empty: 'No month entered.', action: 'enter-revenue' }],
  side: [],
});

test('D6112: a writer gets Enter revenue on the record and on Revenue by month', () => {
  const page = availableRecord(read([ENTER]), null);
  assert.deepEqual(page.actions.map((a) => a.key), ['enter-revenue']);
  assert.equal(page.main[0].action, 'enter-revenue');
  const spec = recordFormFor(ENTER, read([ENTER]), null);
  assert.deepEqual(spec.form.fields.map((f) => f.name), ['month', 'amount']);
  assert.deepEqual(spec.current, { month: '2026-11' });
});

test('D6112: a reader gets no action anywhere on the record', () => {
  const page = availableRecord(read([]), null);
  assert.deepEqual(page.actions, []);
  assert.equal(page.main[0].action, undefined);
  assert.deepEqual(page.main[0].rows.map((r) => r.b), ['typed']);
});

test('D6112: the amount is checked as dollars and sent as typed, with the month', () => {
  const { form } = recordFormFor(ENTER, read([ENTER]), null);
  const fields = formFields(form);
  assert.deepEqual(formErrors(form, fields, { month: '2026-10', amount: '$1,200' }), {});
  assert.equal(formErrors(form, fields, { month: '2026-10', amount: 'lots' }).amount, 'Type an amount in US dollars, 0 or more.');
  assert.equal(formErrors(form, fields, { month: '2026-10', amount: '' }).amount, 'Amount is required.');
  assert.deepEqual(recordActionBody(ENTER, { month: '2026-10', amount: '$1,200' }), { month: '2026-10', amount: '$1,200' });
});

test('D6112: the table reads a typed month as typed; the chart draws it, and no month as Not recorded', () => {
  const row = RECORDS['partner-network'].row({ uid: 'pt1', name: 'Lantern Resellers', type: 'reseller', stage: 'signed', revenue_cents: 120000, revenue_source: 'manual' }, 0);
  assert.equal(row.cells.revenue, '$1,200 · typed');
  assert.equal(RECORDS['partner-network'].row({ uid: 'pt2', name: 'Mill', type: 'agency', stage: 'talking', revenue_cents: null, revenue_source: null }, 1).cells.revenue, null);
  const drawn = CARDS['partner-network']({ by_stage: [], revenue: [{ month: '2026-10', cents: null }, { month: '2026-11', cents: 120000 }] });
  assert.deepEqual(drawn.find((f) => f.kind === 'vbars').values, [null, 1200]);
  const none = CARDS['partner-network']({ by_stage: [], revenue: [{ month: '2026-10', cents: null }, { month: '2026-11', cents: null }] });
  assert.deepEqual(none.find((f) => f.kind === 'rows').items, [{ label: 'Partner-sourced revenue', value: 'Not recorded' }]);
});
