// D4811 (#4811) part 14 — one agreement's workspace (board CT-07) at
// /admin/contracts/agreements/doc/:uid: its header states where it stands,
// six tabs read what the quick panel reads, nothing unknown reads as blank or
// 0, the quick panel opens it ("Open workspace →"), and the workspace sends
// resend and void back to the panel (?agreement=<uid>). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import { AGREEMENT_TABS, activityRows, panelHref, providerLabel } from '../src/pages/admin/contracts/AgreementWorkspace.jsx';
import { mountContracts } from './_contracts_dom.mjs';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
// D4811 part 19: the Related tab reads which governance records govern the agreement; none here.
adminGovernanceApi.governing = async (kind, ref) => ({ kind, ref, governing: [] });

const originals = { ...api }, contractOriginals = { ...contractsApi };
const never = () => new Promise(() => {});
function setup(apiAnswers = {}, contractAnswers = {}) {
  const calls = [];
  for (const key of Object.keys(originals)) if (typeof originals[key] === 'function') api[key] = (...args) => { calls.push([key, args]); return (apiAnswers[key] || never)(...args); };
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = (...args) => { calls.push([key, args]); return (contractAnswers[key] || never)(...args); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(contractsApi, contractOriginals); };
const user = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 1 };
const routed = () => React.createElement(AuthProvider, null, React.createElement(Routes, null,
  React.createElement(Route, { path: '/admin/contracts', element: React.createElement(Desk) }),
  React.createElement(Route, { path: '/admin/contracts/agreements/doc/:uid', element: React.createElement(Desk, { section: 'agreement' }) })));
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));

const row = { uid: 'env-1', source: 'esign', title: 'Subscription Booklet & LPA', doc_type: 'subscription', doc_type_label: 'Subscription agreement', status: 'sent',
  sent_at: '2026-10-28T10:00:00Z', signed_at: null, project_name: null, recipient_name: 'Helvetia Capital AG', provider: 'native' };
const history = { sender: { name: 'Admin' }, parties: [], timeline: [{ action: 'envelope_created', ts: '2026-10-27T09:00:00Z' }, { action: 'email_sent', ts: '2026-10-28T10:00:00Z' }, { action: 'mystery_event', ts: null }], voids: [] };

test('the rules: six tabs in the canvas\'s order; events oldest first, an undated one last; the panel address', () => {
  assert.deepEqual(AGREEMENT_TABS.map(([, l]) => l), ['Overview', 'Document', 'Versions', 'Legal Review', 'Activity', 'Related']);
  assert.deepEqual(activityRows(history).map((r) => [r.what, r.at]), [['Created', '2026-10-27T09:00:00Z'], ['Sent', '2026-10-28T10:00:00Z'], ['mystery_event', null]]);
  assert.deepEqual(activityRows({ timeline: [{ action: 'email_sent', ts: '2026-10-28 10:00:00' }], voids: [{ ts: '2026-10-27 10:00:00', reason: 'Wrong recipient' }] }).map((r) => r.what),
    ['Voided · Wrong recipient', 'Sent'], 'voids sort with the events');
  assert.deepEqual(activityRows(null), []);
  assert.equal(panelHref('env 1'), '/admin/contracts?agreement=env%201');
  assert.equal(providerLabel('docusign'), 'DocuSign');
  assert.equal(providerLabel('mystery'), null, 'an unknown provider is not guessed');
});

test('mounted: the workspace reads the agreement; each tab says what is recorded and what is not', async () => {
  const calls = setup({ adminGetContract: async () => row },
    { stats: never, history: async () => history, signedPdf: async () => ({ available: false, reason: 'Not signed yet.' }), files: async () => ({ files: [] , reason: null }) });
  const view = await mountContracts(routed(), '/admin/contracts/agreements/doc/env-1', user);
  try {
    await view.flush(); await view.flush();
    assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'agreement-workspace'));
    assert.deepEqual(calls.find(([k]) => k === 'adminGetContract')[1], ['env-1']);
    const text = view.text();
    assert.match(text, /Contracts › Agreements › Subscription agreement/);
    assert.match(text, /Subscription Booklet & LPA/);
    assert.match(text, /Sent .*2026 · Awaiting signature/);
    const header = view.nodes().find((n) => n.tagName === 'HEADER' && walk(n).includes('Subscription Booklet & LPA'));
    assert.match(walk(header), /Sent \d+ \w+ 2026 · Awaiting signature/, 'the header states where it stands');
    assert.match(text, /Unlinked recipient/);
    assert.match(text, /Executed.*Not recorded.*No signature date is recorded\./, 'D4811 part 22: the date fact reads Executed');
    assert.match(text, /Last legal review.*Not recorded/);
    const link = view.nodes().find((n) => n.tagName === 'A' && walk(n) === 'Resend or void in the panel');
    assert.equal(view.props(link).href, '/admin/contracts?agreement=env-1');
    const tab = async (label) => { const b = view.nodes().find((n) => view.props(n)?.role === 'tab' && walk(n) === label); await act(async () => { view.props(b).onClick(); }); };
    await tab('Document'); assert.match(view.text(), /Not signed yet\./);
    await tab('Versions'); assert.match(view.text(), /No rendered file is recorded for this agreement\./);
    await tab('Legal Review'); assert.match(view.text(), /An agreement is not reviewed on its own/);
    await tab('Activity'); assert.match(view.text(), /Created · .*Sent · .*mystery_event · Not recorded/);
    await tab('Related'); assert.match(view.text(), /Subscription agreement in Templates/);
    assert.match(view.text(), /Governance records that govern it.*No governance record names this agreement as one it governs\./);
  } finally { await view.unmount(); restore(); }
});

test('an unreadable agreement says so; the quick panel opens the workspace; ?agreement= opens the panel', async () => {
  setup({ adminGetContract: async () => Promise.reject(new Error('down')) }, { stats: never, history: never, signedPdf: never, files: never });
  let view = await mountContracts(routed(), '/admin/contracts/agreements/doc/env-1', user);
  try {
    await view.flush();
    assert.match(view.text(), /Unreadable\. Agreement could not be read\./);
  } finally { await view.unmount(); restore(); }
  setup({ adminGetContract: async () => row }, { stats: never, agreements: async () => ({ total: 0, items: [] }), templates: never, history: never, signedPdf: never, files: never });
  view = await mountContracts(routed(), '/admin/contracts?agreement=env-1', user);
  try {
    await view.flush(); await view.flush();
    assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'contract-agreement-sheet'), '?agreement= opens the quick panel');
    const door = view.nodes().find((n) => n.tagName === 'A' && walk(n) === 'Open workspace →');
    assert.equal(view.props(door).href, '/admin/contracts/agreements/doc/env-1');
  } finally { await view.unmount(); restore(); }
});
