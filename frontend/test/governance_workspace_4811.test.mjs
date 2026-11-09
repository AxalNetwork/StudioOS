// D4811 (#4811) part 5 — one governance record's workspace (board CT-07) at
// /admin/contracts/governance/doc/:uid: the six tabs, the Overview facts
// (unknowns said, never blank), Versions with In force / Latest / Signed copy
// markers, the Activity trail read only when its tab opens, and Legal Review
// saying Not recorded and why, and Related (part 8) saying no link is recorded. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import { executedLine, shortHash, versionMarkers, WORKSPACE_TABS } from '../src/pages/admin/contracts/GovernanceWorkspace.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const never = () => new Promise(() => {});
const govOriginals = { ...adminGovernanceApi }, apiOriginals = { ...api }, contractOriginals = { ...contractsApi };
function stub(answers = {}) {
  const calls = [];
  for (const key of Object.keys(govOriginals)) adminGovernanceApi[key] = (...args) => { calls.push([key, args]); return (answers[key] || never)(...args); };
  for (const key of Object.keys(apiOriginals)) if (typeof apiOriginals[key] === 'function') api[key] = () => never();
  for (const key of Object.keys(contractOriginals)) contractsApi[key] = () => never();
  return calls;
}
const restore = () => { Object.assign(adminGovernanceApi, govOriginals); Object.assign(api, apiOriginals); Object.assign(contractsApi, contractOriginals); };
const categories = [{ key: 'operating_agreement', label: 'Operating agreements' }, { key: 'resolution', label: 'Resolutions' }];
const entities = [{ key: 'gp', name: 'Axal VC GP LLC', documents: [], withheld: 0 }];
const listing = { entities, categories, statuses: [], super_admin: false, group: { links: [] } };
const v = (n, o = {}) => ({ version: n, signed: false, file_bytes: 2048, content_type: 'application/pdf', file_sha256: `${'a'.repeat(4)}${'0'.repeat(56)}${'b'.repeat(4)}`, note: null, created_at: '2026-10-01T10:00:00Z', ...o });
const doc = (o = {}) => ({ uid: 'g1', entity_key: 'gp', category: 'operating_agreement', title: 'GP LLC Operating Agreement', status: 'executed', effective_date: '2023-04-20',
  confidential: false, template_slug: null, envelope_id: null, executed_version: 1, next_statuses: ['archived'], versions: 2, latest: v(2), updated_at: '2026-10-02T10:00:00Z', ...o });
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };
const page = () => React.createElement(Routes, null,
  React.createElement(Route, { path: '/admin/contracts/governance/doc/:uid', element: React.createElement(GovernanceTab) }));

test('the rules: six tabs in the canvas order; version markers; executed evidence in words', () => {
  assert.deepEqual(WORKSPACE_TABS.map(([, l]) => l), ['Overview', 'Document', 'Versions', 'Legal Review', 'Activity', 'Related']);
  const d = doc();
  assert.deepEqual(versionMarkers(d, v(1, { signed: true }), 2), ['In force', 'Signed copy']);
  assert.deepEqual(versionMarkers(d, v(2), 2), ['Latest']);
  assert.equal(executedLine(d), 'v1 · signed copy');
  assert.equal(executedLine(doc({ executed_version: null, envelope_id: 40 })), 'Completed envelope #40');
  assert.equal(executedLine(doc({ status: 'approved' })), null, 'not executed: no evidence line');
  assert.equal(shortHash(v(1).file_sha256), 'sha aaaa…bbbb');
  assert.equal(shortHash(null), null);
});

test('mounted: Overview says each fact or why it is unknown; Versions marks In force; Activity is read only when opened', async () => {
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc(), versions: [v(2), v(1, { signed: true })] }),
    activity: async () => ({ uid: 'g1', events: [{ action: 'governance_document_status', line: 'Moved from Approved to Executed', at: '2026-10-02 10:00:00', actor: 'Alex Made-up', version: null }] }),
    related: async () => ({ uid: 'g1', dependants: [], governed_by: [], banner: { affected: 0, version: null, dismissed: false } }) });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1', admin);
  try {
    await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'read').at(-1)[1], ['g1']);
    let text = view.text();
    assert.match(text, /Contracts › Corporate Governance › Axal VC GP LLC/);
    assert.match(text, /GP LLC Operating Agreement/);
    assert.match(text, /Operating agreements · Axal VC GP LLC/);
    assert.match(text, /Executed versionv1 · signed copy/);
    assert.match(text, /Last reviewNot recorded.*legal-review record is not built yet/);
    assert.match(text, /Linked templateNot recorded.*No template linked/);
    assert.equal(calls.filter(([k]) => k === 'activity').length, 0, 'the trail is not read until its tab opens');
    const tab = (id) => view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.id === `gw-tab-${id}`);
    assert.equal(view.props(tab('overview'))['aria-selected'], true);
    await act(async () => { view.props(tab('versions')).onClick({}); }); await view.flush();
    text = view.text();
    assert.match(text, /v2Latest/);
    assert.match(text, /v1In forceSigned copy/);
    assert.match(text, /sha aaaa…bbbb/);
    await act(async () => { view.props(tab('activity')).onClick({}); }); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'activity').length, 1);
    assert.match(view.text(), /Moved from Approved to Executed.*Alex Made-up/);
    await act(async () => { view.props(tab('legal-review')).onClick({}); }); await view.flush();
    assert.match(view.text(), /Not recorded.*waits on who records counsel approval/);
    await act(async () => { view.props(tab('related')).onClick({}); }); await view.flush();
    // D4811 part 8: Related reads the links; with none recorded it says so, and guesses nothing from titles.
    assert.match(view.text(), /No document is linked to this record yet.*nothing is inferred from titles/);
  } finally { await view.unmount(); restore(); }
});

test('a record this admin may not open says so; a record with no file says so on Document and Versions', async () => {
  stub({ list: async () => listing, read: () => Promise.reject(Object.assign(new Error('That governance document is not available.'), { status: 404 })) });
  let view = await mountContracts(page(), '/admin/contracts/governance/doc/secret', admin);
  try {
    await view.flush();
    assert.match(view.text(), /could not be read|not available/);
    assert.doesNotMatch(view.text(), /Executed version/);
  } finally { await view.unmount(); restore(); }
  stub({ list: async () => listing, read: async () => ({ document: doc({ status: 'draft', executed_version: null, versions: 0, latest: null }), versions: [] }) });
  view = await mountContracts(page(), '/admin/contracts/governance/doc/g1?tab=document', admin);
  try {
    await view.flush();
    assert.match(view.text(), /No file has been uploaded for this record yet\./);
    assert.equal(view.props(view.nodes().find((n) => view.props(n)?.id === 'gw-tab-document'))['aria-selected'], true, '?tab=document opens on Document');
  } finally { await view.unmount(); restore(); }
});
