/** #6293: changed-field deal edits, exact currency units and independent reviewer suggestions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { dd } from '../src/lib/api.js';
import { ddDeskApi } from '../src/lib/api/ddDesk.js';
import { ddLifecycleApi } from '../src/lib/api/ddLifecycle.js';
import { AssignDialog } from '../src/pages/duediligence/DdCaseDialogs.jsx';
import DealContextDialog from '../src/pages/duediligence/DdDealContextDialog.jsx';
import { dealContextInitial, dealContextPatch, priorReviewWords } from '../src/pages/duediligence/ddDealContextModel.js';

const CASE = { uid: 'case-6293', subject_type: 'project', subject_id: 7, subject_label: 'Synthetic Venture',
  round_label: 'Seed', cheque_cents: 12345, cheque_currency: 'EUR', deal_id: 11, updated_at: '2026-11-14T10:00:00Z' };
const data = (extra = {}) => ({ case: { ...CASE }, allowed: { update: true, assign: true }, sections: [
  { id: 1, section_key: 'financial', title: 'Financial review' }, { id: 2, section_key: 'legal', title: 'Legal review' },
], ...extra });
const node = (view, id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
const change = (view, id, value) => act(async () => view.props(node(view, id)).onChange({ target: { value } }));
const press = (view, id) => act(async () => view.props(node(view, id)).onClick());
const settleSearch = () => act(async () => new Promise((resolve) => setTimeout(resolve, 230)));

function stub(extra = {}) {
  const was = { experts: dd.experts, subjects: ddDeskApi.subjects, people: ddDeskApi.people, assign: ddDeskApi.assign, update: ddLifecycleApi.update };
  const calls = [];
  dd.experts = extra.experts || (async (key) => ({ suggestions: [{ id: 5, name: 'Suggested Reviewer', role: 'advisor', prior_reviews: 2, email: 'private-reviewer@example.test' }] }));
  ddDeskApi.subjects = extra.subjects || (async () => ({ items: [{ id: 7, deals: [{ id: 11, instrument: 'SAFE' }, { id: 12, instrument: 'Equity' }] }] }));
  ddDeskApi.people = extra.people || (async () => ({ items: [] }));
  ddDeskApi.assign = async (...args) => { calls.push(['assign', ...args]); };
  ddLifecycleApi.update = extra.update || (async (...args) => { calls.push(['update', ...args]); });
  return { calls, restore() { dd.experts = was.experts; ddDeskApi.subjects = was.subjects; ddDeskApi.people = was.people; ddDeskApi.assign = was.assign; ddLifecycleApi.update = was.update; } };
}

test('deal context starts with recorded values and changes only edited fields, preserving zero and native currency decimals', () => {
  const initial = dealContextInitial(CASE);
  assert.deepEqual([initial.round, initial.cheque, initial.currency, initial.deal], ['Seed', '123.45', 'EUR', '11']);
  assert.equal(dealContextInitial({ ...CASE, cheque_cents: 0 }).cheque, '0.00');
  assert.deepEqual(dealContextPatch({ ...initial, round: 'Series A' }, CASE).body, { round_label: 'Series A' });
  assert.deepEqual(dealContextPatch({ ...initial, cheque: '0' }, CASE).body, { cheque_cents: 0, cheque_currency: 'EUR' });
  assert.deepEqual(dealContextPatch({ ...initial, cheque: '', clearCheque: true }, CASE).body, { cheque_cents: null, cheque_currency: null });
  assert.deepEqual(dealContextPatch({ ...initial, cheque: '12.345', currency: 'KWD' }, CASE).body, { cheque_cents: 12345, cheque_currency: 'KWD' });
  assert.ok(dealContextPatch({ ...initial, cheque: '12.5', currency: 'JPY' }, CASE).error, 'no silent currency rounding');
  assert.deepEqual(dealContextPatch({ ...initial, cheque: '12', currency: 'JPY' }, CASE).body, { cheque_cents: 12, cheque_currency: 'JPY' });
});

test('unknown cheque currency is retained untouched; invalid amounts/deals and no-op writes are refused', () => {
  const cs = { ...CASE, cheque_currency: null };
  const initial = dealContextInitial(cs);
  assert.deepEqual([initial.cheque, initial.currency], ['', '']);
  assert.deepEqual(dealContextPatch({ ...initial, round: 'Series B' }, cs).body, { round_label: 'Series B' });
  assert.deepEqual(dealContextPatch({ ...initial, clearCheque: true }, cs).body, { cheque_cents: null, cheque_currency: null });
  assert.ok(dealContextPatch(initial, cs).error);
  assert.ok(dealContextPatch({ ...initial, cheque: '12' }, cs).error);
  assert.ok(dealContextPatch({ ...initial, round: 'x'.repeat(81) }, cs).error);
  assert.ok(dealContextPatch({ ...initial, deal: '999' }, cs, [12]).error);
  assert.deepEqual(dealContextPatch({ ...initial, deal: '12' }, cs, [12]).body, { deal_id: 12 });
  assert.deepEqual(dealContextPatch({ ...initial, deal: '' }, cs, [12]).body, { deal_id: null });
  assert.deepEqual([priorReviewWords(null), priorReviewWords(0), priorReviewWords(1), priorReviewWords('3')],
    ['Prior reviews not recorded', '0 prior reviews', '1 prior review', '3 prior reviews']);
});

test('a context dialog keeps refused edits and sends only changed fields through the existing PATCH', async () => {
  let fail = true; const writes = []; const done = [];
  const s = stub({ update: async (...args) => { writes.push(args); if (fail) throw new Error('synthetic unavailable'); } });
  const view = await mountContracts(React.createElement(DealContextDialog, { uid: CASE.uid, data: data(), onClose() {}, onDone: (line) => done.push(line) }));
  try {
    assert.equal(view.props(node(view, 'dd-context-cheque')).value, '123.45');
    assert.match(view.text(), /Activity records which fields changed/);
    await change(view, 'dd-context-round', 'Series B');
    await view.click('Save deal context');
    assert.deepEqual(writes[0], [CASE.uid, { round_label: 'Series B' }]);
    assert.equal(done.length, 0);
    assert.equal(view.props(node(view, 'dd-context-round')).value, 'Series B');
    assert.match(view.text(), /synthetic unavailable/);
    fail = false;
    await view.click('Save deal context');
    assert.deepEqual(done, ['The deal context is recorded.']);
  } finally { await view.unmount(); s.restore(); }
});

test('an observed case refresh refuses stale context rather than writing old fields to a new read', async () => {
  const s = stub(); let refresh;
  function Refreshing() {
    const [value, setValue] = React.useState(data()); refresh = setValue;
    return React.createElement(DealContextDialog, { uid: CASE.uid, data: value, onClose() {}, onDone() {} });
  }
  const view = await mountContracts(React.createElement(Refreshing));
  try {
    await change(view, 'dd-context-round', 'Series B');
    await act(async () => refresh(data({ case: { ...CASE, updated_at: '2026-11-14T10:01:00Z' } })));
    await view.click('Save deal context');
    assert.equal(s.calls.length, 0);
    assert.match(view.text(), /case changed while this dialog was open/);
    assert.equal(view.props(node(view, 'dd-context-round')).value, 'Series B');
  } finally { await view.unmount(); s.restore(); }
});

test('read-only/scoped cases draw no edit controls and fetch no deal choices', async () => {
  let reads = 0; const s = stub({ subjects: async () => { reads++; return { items: [] }; } });
  try {
    for (const d of [data({ allowed: { update: false } }), data({ case: { ...CASE, scoped: true } })]) {
      const view = await mountContracts(React.createElement(DealContextDialog, { uid: CASE.uid, data: d, onClose() {}, onDone() {} }));
      try { assert.equal(Boolean(node(view, 'dd-context-round')), false, 'read-only case has no round input'); assert.match(view.text(), /case lead or an Admin/); }
      finally { await view.unmount(); }
    }
    assert.equal(reads, 0);
  } finally { s.restore(); }
});

test('Assign shows suggested names and prior counts before search, never email, and records the selected identity', async () => {
  const s = stub(); const done = [];
  const view = await mountContracts(React.createElement(AssignDialog, { uid: CASE.uid, data: data(), sectionId: '1', onClose() {}, onDone: (line) => done.push(line) }));
  try {
    await view.flush();
    assert.match(view.text(), /Suggested Reviewer/); assert.match(view.text(), /2 prior reviews/);
    assert.doesNotMatch(view.text(), /private-reviewer@example/);
    const nodes = view.nodes();
    assert.ok(nodes.indexOf(node(view, 'dd-assign-suggestions')) < nodes.indexOf(node(view, 'dd-assign-q')));
    await press(view, 'dd-assign-suggestion-5');
    await view.click('Assign');
    assert.deepEqual(s.calls, [['assign', CASE.uid, 1, 5, 'reviewer']]);
    assert.match(done[0], /Suggested Reviewer is assigned to Financial review/);
    assert.match(view.text(), /assignment and role are recorded/);
  } finally { await view.unmount(); s.restore(); }
});

test('a failed suggestions read keeps name search and assignment working', async () => {
  const s = stub({ experts: async () => { throw new Error('synthetic suggestions failure'); }, people: async () => ({ items: [{ id: 6, name: 'Searched Person', role: 'partner', email: 'hidden-search@example.test' }] }) });
  const view = await mountContracts(React.createElement(AssignDialog, { uid: CASE.uid, data: data(), sectionId: '1', onClose() {}, onDone() {} }));
  try {
    await settleSearch();
    assert.match(view.text(), /Suggested reviewers could not be read/);
    await change(view, 'dd-assign-q', 'Searched'); await settleSearch();
    assert.match(view.text(), /Searched Person/); assert.doesNotMatch(view.text(), /hidden-search@example/);
    await press(view, 'dd-assign-person-6'); await view.click('Assign');
    assert.deepEqual(s.calls, [['assign', CASE.uid, 1, 6, 'reviewer']]);
  } finally { await view.unmount(); s.restore(); }
});

test('changing section clears selection and an old suggestions response cannot replace the new section’s list', async () => {
  let oldResolve;
  const s = stub({ experts: async (key) => key === 'financial' ? new Promise((resolve) => { oldResolve = resolve; })
    : { suggestions: [{ id: 7, name: 'New Section Reviewer', prior_reviews: null }] } });
  const view = await mountContracts(React.createElement(AssignDialog, { uid: CASE.uid, data: data(), sectionId: '1', onClose() {}, onDone() {} }));
  try {
    await change(view, 'dd-assign-section', '2'); await view.flush();
    await act(async () => oldResolve({ suggestions: [{ id: 8, name: 'Stale Reviewer', prior_reviews: 99 }] }));
    assert.match(view.text(), /New Section Reviewer/); assert.match(view.text(), /Prior reviews not recorded/);
    assert.doesNotMatch(view.text(), /Stale Reviewer/);
    await view.click('Assign'); assert.equal(s.calls.length, 0);
    await press(view, 'dd-assign-suggestion-7'); await view.click('Assign');
    assert.deepEqual(s.calls, [['assign', CASE.uid, 2, 7, 'reviewer']]);
  } finally { await view.unmount(); s.restore(); }
});
