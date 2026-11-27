/** #6146: recorded event words, lazy history states and stale-response isolation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import FlowHistory from '../src/pages/investor/dealflow/FlowHistory.jsx';
import { flowEventSentence, currentReturnLine } from '../src/pages/investor/dealflow/movesModel.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';

const row = { id: 7, inFlow: true, enteredVia: 'invited' };
const node = (v, id) => v.nodes().find((n) => v.props(n)?.['data-testid'] === id);
const click = (v, id) => act(async () => v.props(node(v, id)).onClick());
const events = [{ kind: 'entered', to: 'sourcing', at: '2026-10-01 10:00:00', by: { name: 'Synthetic Actor' } },
  { kind: 'moved', from: 'sourcing', to: 'screening', at: '2026-10-02 11:00:00', by: { name: 'Second Actor' } },
  { kind: 'passed', reason: 'valuation', at: null, by: null }, { kind: 'owner', at: null }, { kind: 'note', at: null }];

test('event words use recorded stages, entry route and reason; missing fields and unknown kinds are explicit', () => {
  assert.match(flowEventSentence(events[0], 'invited'), /Entered at Sourced · Invited by the studio/);
  assert.equal(flowEventSentence(events[1]), 'Moved from Sourced to Screening.');
  assert.match(flowEventSentence(events[2]), /Passed · /);
  assert.doesNotMatch(flowEventSentence(events[2]), /Not recorded/);
  assert.equal(flowEventSentence({ kind: 'moved' }), 'Moved from Not recorded to Not recorded.');
  assert.match(flowEventSentence({ kind: 'passed' }), /Reason: Not recorded/);
  assert.equal(flowEventSentence({ kind: 'owner' }), 'Owner changed.');
  assert.equal(flowEventSentence({ kind: 'note' }), 'Note changed.');
  assert.equal(flowEventSentence({ kind: 'future' }), 'Recorded change: future.');
  assert.equal(currentReturnLine(null), null);
  assert.match(currentReturnLine({ revisit: 'next_round' }), /Current pass · returns next round/);
  assert.match(currentReturnLine({ revisit: 'date', revisit_at: '2026-12-01' }), /Current pass · return date: 2026-12-01/);
  assert.match(currentReturnLine({ revisit: 'date' }), /Not recorded/);
});

test('history is collapsed and unread until opened, then lists every event newest first without mutating the read', async () => {
  const original = dealFlowApi.events; const reads = [];
  dealFlowApi.events = async (id) => { reads.push(id); return { items: events }; };
  const view = await mountContracts(React.createElement(FlowHistory, { row, pass: { revisit: 'date', revisit_at: '2026-12-01' } }));
  try {
    assert.deepEqual(reads, []); assert.equal(Boolean(node(view, 'dealflow-history-body')), false);
    await click(view, 'dealflow-history-toggle'); await view.flush();
    assert.deepEqual(reads, [7]);
    assert.equal(view.nodes().filter((n) => view.props(n)?.['data-testid'] === 'dealflow-history-event').length, events.length);
    const text = view.text(); assert.ok(text.indexOf('Note changed') < text.indexOf('Owner changed') && text.indexOf('Owner changed') < text.indexOf('Moved from'));
    assert.match(text, /When: 2026-10-01 10:00:00 · By: Synthetic Actor/);
    assert.match(text, /When: Not recorded · By: Not recorded/);
    assert.match(text, /Current pass · return date: 2026-12-01/);
    assert.equal(events[0].kind, 'entered');
    await click(view, 'dealflow-history-toggle');
    assert.equal(Boolean(node(view, 'dealflow-history-body')), false);
  } finally { await view.unmount(); dealFlowApi.events = original; }
});

test('a failed history read is independently retryable and an empty successful read is distinct', async () => {
  const original = dealFlowApi.events; let fail = true;
  dealFlowApi.events = async () => { if (fail) throw new Error('synthetic history failure'); return { items: [] }; };
  const view = await mountContracts(React.createElement(FlowHistory, { row }));
  try {
    await click(view, 'dealflow-history-toggle'); await view.flush();
    assert.match(view.text(), /History is unreadable/); assert.doesNotMatch(view.text(), /No move recorded yet/);
    fail = false; await click(view, 'dealflow-history-retry'); await view.flush();
    assert.match(view.text(), /No move recorded yet/); assert.doesNotMatch(view.text(), /unreadable/);
  } finally { await view.unmount(); dealFlowApi.events = original; }
});

test('a row outside the firm flow has no history control and makes no events read', async () => {
  const original = dealFlowApi.events; let reads = 0; dealFlowApi.events = async () => { reads++; return { items: [] }; };
  const view = await mountContracts(React.createElement(FlowHistory, { row: { ...row, inFlow: false } }));
  try { assert.equal(Boolean(node(view, 'dealflow-history-toggle')), false); assert.equal(reads, 0); }
  finally { await view.unmount(); dealFlowApi.events = original; }
});

test('a late read from a previous deal cannot replace the current deal history', async () => {
  const original = dealFlowApi.events; let oldResolve, refresh;
  dealFlowApi.events = async (id) => id === 7 ? new Promise((resolve) => { oldResolve = resolve; }) : { items: [{ kind: 'note', by: { name: 'Current Actor' } }] };
  function Changing() { const [value, set] = React.useState(row); refresh = set; return React.createElement(FlowHistory, { row: value }); }
  const view = await mountContracts(React.createElement(Changing));
  try {
    await click(view, 'dealflow-history-toggle'); assert.match(view.text(), /Reading history/);
    await act(async () => refresh({ ...row, id: 8 })); await view.flush();
    await act(async () => oldResolve({ items: [{ kind: 'owner', by: { name: 'Stale Actor' } }] }));
    assert.match(view.text(), /Current Actor/); assert.doesNotMatch(view.text(), /Stale Actor/);
  } finally { await view.unmount(); dealFlowApi.events = original; }
});
