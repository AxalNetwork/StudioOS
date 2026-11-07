/**
 * D4694 (#4694) — the licence consoles send only what their user changed, name
 * the revision they read, and say so when another write got there first. The
 * Worker's half is cloudflare-worker/test/licence_revisions_4694.test.ts.
 * Each case names the mutations it was checked against.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_terms_revisions_4694.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { buildCoreSave, coreFormFrom, coreRevision, dirtyKeys, reconcileCoreForm } from '../src/lib/licenceCoreTermsForm.js';
import { buildSave } from '../src/lib/licenceTermsForm.js';
import LicenceFeeInvoices from '../src/pages/admin/LicenceFeeInvoices.jsx';

const h = React.createElement;
const LICENCE = {
  uid: 'lic_a', term_years: 3, annual_fee_cents: 1000000, currency: 'EUR', revenue_share_bps: 3000, token_split_bps: 5000,
  starts_on: '2025-01-01', renews_on: '2027-01-01', terms_revision: 0,
};
const REASON = 'Agreed at the annual review';

// 1 ───────────────────────────────────────────────────────────────────────────
test('the core terms form sends only the fields the user changed, the fee in cents, the reason, and the revision it read', () => {
  // Mutations checked: every field sent; the fee sent in currency units; the revision left out; a save with no reason or no change allowed.
  const base = coreFormFrom(LICENCE);
  assert.equal(base.annual_fee, '10000');
  assert.deepEqual(dirtyKeys(base, base), []);
  const form = { ...base, annual_fee: '11000.50' };
  assert.deepEqual(dirtyKeys(form, base), ['annual_fee']);
  assert.deepEqual(buildCoreSave({ form, base, revision: 4, reason: ` ${REASON} ` }),
    { ok: true, body: { annual_fee_cents: 1100050, reason: REASON, expected_revision: 4 } });
  assert.deepEqual(buildCoreSave({ form, base, revision: 4, reason: '  ' }).errors, { reason: 'Say why these terms are changing. It is kept in the licence\'s history.' });
  assert.deepEqual(buildCoreSave({ form: base, base, revision: 0, reason: REASON }).errors, { form: 'Nothing has changed.' });
  assert.deepEqual(buildCoreSave({ form: { ...base, revenue_share_bps: '12x' }, base, revision: 0, reason: REASON }).errors, { revenue_share_bps: 'must be a number' });
  // Clearing a field is a change: null, not "keep".
  const cleared = buildCoreSave({ form: { ...base, renews_on: '', term_years: '' }, base, revision: 0, reason: REASON });
  assert.deepEqual([cleared.body.renews_on, cleared.body.term_years], [null, null]);
  assert.equal(coreRevision({}), 0, 'a licence without the column reads revision 0');
  assert.equal(coreRevision({ terms_revision: '7' }), 7);
  assert.equal(coreRevision({ terms_revision: -1 }), 0);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('renewing while Terms is open: the untouched renewal date takes the new value, the typed fee stays, and the save carries neither the date nor the old revision', () => {
  // Mutations checked: reconcile keeping the stale base for untouched fields; reconcile overwriting a typed field; the new revision not adopted.
  let state = { form: coreFormFrom(LICENCE), base: coreFormFrom(LICENCE), revision: 0, moved: [] };
  state = { ...state, form: { ...state.form, annual_fee: '11000' } };
  const refreshed = { ...LICENCE, renews_on: '2028-01-01', terms_revision: 1 };
  state = reconcileCoreForm(state, refreshed);
  assert.equal(state.form.renews_on, '2028-01-01', 'the untouched field follows the server');
  assert.equal(state.form.annual_fee, '11000', 'the typed field is kept');
  assert.equal(state.revision, 1);
  assert.deepEqual(state.moved, []);
  const built = buildCoreSave({ ...state, reason: REASON });
  assert.deepEqual(built.body, { annual_fee_cents: 1100000, reason: REASON, expected_revision: 1 }, 'the renewal date is not in the save');

  // The user edited the very field another admin changed: the form keeps the typed value and says it moved.
  let both = { form: { ...coreFormFrom(LICENCE), renews_on: '2029-06-01' }, base: coreFormFrom(LICENCE), revision: 0, moved: [] };
  both = reconcileCoreForm(both, refreshed);
  assert.deepEqual([both.form.renews_on, both.moved], ['2029-06-01', ['renews_on']]);
  // A typed value that now equals the server's value is no longer a change, and is not reported as one.
  let same = { form: { ...coreFormFrom(LICENCE), renews_on: '2028-01-01' }, base: coreFormFrom(LICENCE), revision: 0, moved: [] };
  same = reconcileCoreForm(same, refreshed);
  assert.deepEqual([dirtyKeys(same.form, same.base), same.moved], [[], []]);
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the schedule form sends only changed terms with the revision it read, and the API carries it', () => {
  // Mutations checked: expected_revision dropped from buildSave; dropped from the API body; every term sent.
  const stored = { terms: { governing_law: 'Delaware', cure_days: null }, sections: {}, revision: 3 };
  const fields = [
    { key: 'governing_law', type: 'text', max: 200, label: 'Governing law' },
    { key: 'cure_days', type: 'int', min: 0, max: 3650, label: 'Cure period', unit: 'days' },
  ];
  const form = { values: { governing_law: 'Delaware', cure_days: '30' }, sections: {} };
  const built = buildSave(stored, form, REASON, fields);
  assert.deepEqual(built.body, { terms: { cure_days: 30 }, reason: REASON, expected_revision: 3 });
  assert.equal(buildSave({ terms: {}, sections: {} }, form, REASON, fields).body.expected_revision, 0, 'no schedule yet is revision 0');
  const api = readFileSync(new URL('../src/lib/api/licenceTerms.js', import.meta.url), 'utf8');
  assert.match(api, /save: \(uid, \{ terms, sections, reason, expected_revision \} = \{\}\)/);
  assert.match(api, /\.\.\.\(sections \? \{ sections \} : \{\}\), reason, expected_revision \}\)/);
  const page = readFileSync(new URL('../src/pages/admin/LicenceTermsSchedule.jsx', import.meta.url), 'utf8');
  assert.match(page, /revision: Number\(r\?\.revision \?\? 0\)/);
  assert.match(page, /err\?\.code === 'terms_conflict'/);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the Terms editor is wired to the dirty-field form, not to a full-row save', () => {
  // Mutations checked: the editor sending every field again; the reconcile effect removed; the reason box removed.
  const page = readFileSync(new URL('../src/pages/admin/AdminLicences.jsx', import.meta.url), 'utf8');
  const editor = page.slice(page.indexOf('function TermsEditor('), page.indexOf('function TermsEditor(') + 6000);
  assert.match(editor, /buildCoreSave\(\{ form: st\.form, base: st\.base, revision: st\.revision, reason \}\)/);
  assert.match(editor, /setSt\(\(cur\) => reconcileCoreForm\(cur, licence\)\)/);
  assert.match(editor, /e\?\.code === 'terms_conflict'/);
  assert.match(editor, /data-testid="licence-terms-reason"/);
  assert.doesNotMatch(editor, /annual_fee_cents: f\.annual_fee === ''/, 'the old full-row body is gone');
  assert.match(page, /disabled=\{busy \|\| dirty\.length === 0\}/, 'nothing to save until something changed');
});

// 5 ───────────────────────────────────────────────────────────────────────────
async function mount(api) {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  await act(async () => { root.render(h(LicenceFeeInvoices, { licence: { uid: 'lic_a' }, api })); await settle(); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    by, text: () => text(container),
    click: (id) => act(async () => { props(by(id)).onClick(); await settle(); await settle(); }),
    type: (id, value) => act(async () => { props(by(id)).onChange({ target: { value } }); }),
    submit: (id) => act(async () => { props(by(id)).onSubmit({ preventDefault() {} }); await settle(); await settle(); }),
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('a payment refused because the invoice changed says so and reads the invoice again', async () => {
  // Mutations checked: the list not re-read after an invoice_changed refusal; the server's sentence replaced by a generic one.
  const INV = {
    uid: 'inv_1', period_label: '2026–27', period_start: '2026-03-15', period_end: '2027-03-14', amount_cents: 1200000, currency: 'EUR',
    paid_cents: 0, outstanding_cents: 1200000, reference: 'AXAL-LIC-LIC-A-2026-27', issued_at: '2026-10-20', due_at: '2026-11-19',
    status: 'issued', paid_at: null, paid_note: null, void_note: null, pdf_url: '/x', revision: 0,
  };
  const calls = [];
  let read = { invoices: [INV], annual_fee_cents: 1200000, currency: 'EUR', starts_on: '2020-03-15' };
  const api = {
    list: async () => { calls.push('list'); return read; },
    recordPayment: async (...a) => {
      calls.push(['pay', ...a]);
      read = { ...read, invoices: [{ ...INV, paid_cents: 300000, outstanding_cents: 900000, revision: 2 }] };
      const e = new Error('This invoice changed since you opened it, so nothing was recorded. Reload it and check the current total and status.');
      e.code = 'invoice_changed';
      throw e;
    },
  };
  const m = await mount(api);
  try {
    await m.click('fee-invoice-record');
    await m.type('fee-invoice-paid', '5,000.00');
    await m.submit('fee-invoice-pay-form');
    assert.deepEqual(calls, ['list', ['pay', 'lic_a', 'inv_1', 500000, '', 0], 'list']);
    assert.match(m.text(), /changed since you opened it/);
    assert.match(m.text(), /€3,000\.00/, 'the invoice is drawn as it now stands');
  } finally { await m.unmount(); }
});
