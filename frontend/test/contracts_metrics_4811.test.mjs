// D4811 (#4811) part 3 — the Agreements metric strip (board CT-01): six cells
// from `/stats`'s `attention`, each opening the records behind its count; an
// unreturned count is Unreadable, governance on a branch is not counted, and
// an unrecorded send is named, never folded into a number. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { metricCells, attentionLabel } from '../src/pages/admin/contracts/contractMetrics.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
function setup(contractAnswers = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = () => never();
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const element = () => React.createElement(AuthProvider, null, React.createElement(Desk));
const attention = (o = {}) => ({
  awaiting: 12, executed: { total: 148, this_year: 40, this_month: 9, undated: 2 }, stalled: { count: 4, unknown: 3, days: 30 },
  repair: { count: 7, evidence: 2, unlinked: 5 },
  legal_review: { templates: 1, governance: 2, governance_scope: 'hq' }, restricted: { templates: 1, governance: 5, governance_scope: 'hq' }, ...o,
});
const byKey = (cells) => Object.fromEntries(cells.map((c) => [c.key, c]));

test('the six cells, in the canvas order, each with the filter that opens its records', () => {
  const cells = metricCells({ attention: attention() });
  assert.deepEqual(cells.map((c) => c.label), ['Awaiting signature', 'Executed', 'Stalled / overdue', 'Legal review required', 'Restricted', 'Data repair required']);
  const c = byKey(cells);
  assert.deepEqual(c.awaiting.drill, { kind: 'filter', filters: { status: 'awaiting_signature' } });
  assert.deepEqual(c.stalled.drill, { kind: 'filter', filters: { attention: 'stalled' } });
  assert.deepEqual(c.repair.drill, { kind: 'filter', filters: { attention: 'repair' } });
  assert.deepEqual(c.legal_review.drill, { kind: 'tab', tab: 'templates' });
  assert.equal(c.legal_review.value, 3);
  assert.equal(c.legal_review.also.to, '/admin/contracts/governance?records=review_required');
  assert.equal(c.restricted.also.to, '/admin/contracts/governance?records=restricted');
  assert.deepEqual(c.executed.lines, ['40 this year · 9 this month', '2 with no signature date']);
  assert.deepEqual(c.stalled.lines, ['sent over 30 days ago', '3 sends not recorded, so not judged'], 'an unrecorded send is named, not counted as fresh');
  assert.deepEqual(c.repair.lines, ['2 rows marked executed with no evidence · 5 unlinked recipients']);
});

test('unknown is not zero: an unreturned strip, an unreadable part, governance on a branch', () => {
  assert.equal(metricCells({ total: 1 }), null, 'no attention block: no cells, never a row of zeros');
  const branch = byKey(metricCells({ attention: attention({ legal_review: { templates: 1, governance: null, governance_scope: 'branch' } }) }));
  assert.equal(branch.legal_review.value, 1, 'only what this desk keeps is counted');
  assert.deepEqual(branch.legal_review.lines, ['1 template', 'governance is kept at HQ']);
  assert.equal(branch.legal_review.also, null);
  const broken = byKey(metricCells({ attention: attention({ restricted: { templates: null, governance: null, governance_scope: 'unreadable' } }) }));
  assert.equal(broken.restricted.value, null);
  assert.equal(broken.restricted.unknown, 'unreadable');
  assert.deepEqual(broken.restricted.lines, ['templates unreadable', 'governance unreadable', 'confidential or blocked']);
  assert.equal(attentionLabel('stalled'), 'Stalled: sent over 30 days ago');
  assert.equal(attentionLabel('nonsense'), null);
});

test('mounted: a cell opens its records, the list names the filter and clears it; Unreadable is drawn as a word', async () => {
  const calls = setup({
    stats: async () => ({ total: 160, pending_signature: 12, by_status: { signed: 148 }, attention: attention({ restricted: { templates: null, governance: null, governance_scope: 'unreadable' } }) }),
    agreements: async () => ({ total: 0, items: [] }),
  });
  const view = await mountContracts(element(), '/admin/contracts', user);
  try {
    await view.flush();
    const strip = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'contracts-metric-strip');
    assert.ok(strip);
    assert.equal(view.props(strip)['aria-label'], 'Agreements needing attention');
    const restricted = view.nodes().find((n) => n.tagName === 'BUTTON' && /^Restricted: unreadable/.test(view.props(n)?.['aria-label'] || ''));
    assert.ok(restricted, 'an unreadable count says so in its name');
    assert.match(view.text(), /Unreadable/);
    const stalled = view.nodes().find((n) => n.tagName === 'BUTTON' && /^Stalled \/ overdue: 4/.test(view.props(n)?.['aria-label'] || ''));
    await act(async () => { view.props(stalled).onClick({}); });
    await view.flush();
    assert.equal(calls.filter(([k]) => k === 'agreements').at(-1)[1][0].attention, 'stalled');
    assert.match(view.text(), /Showing: Stalled: sent over 30 days ago/);
    await view.click('Show all agreements');
    await view.flush();
    assert.equal(calls.filter(([k]) => k === 'agreements').at(-1)[1][0].attention, undefined, 'clearing the filter lists every agreement again');
  } finally { await view.unmount(); restore(); }
});
