// D4811 (#4811) part 21 — Unlink on a governance record's Related tab (board
// CT-11): each row the viewer may open offers Unlink; a Restricted row offers
// none. The dialog is Scope (which link, and why) → Review (both documents
// unchanged, only the reference removed) → Result (the Worker's answer, its
// refusal shown as sent). Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import { reviewStateGoing, unlinkReason } from '../src/pages/admin/contracts/UnlinkRelation.jsx';
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
const entities = [{ key: 'gp', name: 'Axal VC GP LLC', withheld: 0, documents: [{ uid: 'g1', title: 'GP LLC Operating Agreement' }, { uid: 'g2', title: 'GP resolution 2026-07' }] }];
const listing = { entities, categories: [{ key: 'operating_agreement', label: 'Operating agreements' }], statuses: [], super_admin: false, group: { links: [] } };
const doc = { uid: 'g1', entity_key: 'gp', category: 'operating_agreement', title: 'GP LLC Operating Agreement', status: 'approved', effective_date: null,
  confidential: false, template_slug: null, envelope_id: null, executed_version: null, next_statuses: [], versions: 2, latest: null, updated_at: null };
const rel = (o) => ({ id: 1, kind: 'governance', ref: 'g2', title: 'GP resolution 2026-07', status: 'executed', entity_key: 'gp', category: 'resolution', restricted: false, missing: false,
  state: 'reviewed', flag_version: 2, flagged_at: '2026-11-05T10:00:00Z', reviewed_version: 2, reviewed_at: '2026-11-06T10:00:00Z', reviewed_by: 'Kim Made-up', review_note: 'Checked §9.2', ...o });
const related = () => ({ uid: 'g1', governed_by: [], banner: { affected: 0, version: null, dismissed: false }, dependants: [
  rel(),
  rel({ id: 2, kind: 'template', ref: 'capital_call_notice', title: 'Capital Call Notice', status: null, state: 'not_affected', flag_version: null, reviewed_version: null, reviewed_by: null, review_note: null }),
  rel({ id: 3, ref: null, title: null, status: null, restricted: true, review_note: null }),
] });
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };
const page = () => React.createElement(Routes, null,
  React.createElement(Route, { path: '/admin/contracts/governance/doc/:uid', element: React.createElement(GovernanceTab) }));
const nodeText = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(nodeText).join('') : node.textContent || '');
const click = async (view, node) => { await act(async () => { view.props(node).onClick({ preventDefault() {} }); }); await view.flush(); };
const buttonNamed = (view, re) => view.nodes().find((n) => n.tagName === 'BUTTON' && re.test(nodeText(n)));
const dialogText = (view) => nodeText(view.nodes().find((n) => view.props(n)?.['data-testid'] === 'governance-unlink') || null);

test('the words: the reason as the Worker reads it; what goes with the link', () => {
  assert.deepEqual(unlinkReason('  wrong   link  '), { text: 'wrong link', ok: true });
  assert.equal(unlinkReason('too short').ok, false, '9 characters');
  assert.equal(unlinkReason('x'.repeat(500)).ok, true);
  assert.equal(unlinkReason('x'.repeat(501)).ok, false);
  assert.equal(unlinkReason(undefined).ok, false);
  assert.equal(reviewStateGoing(rel()), 'its review against v2 by Kim Made-up, with its note');
  assert.equal(reviewStateGoing(rel({ state: 'review_suggested', flag_version: 3 })), 'its "may require review" flag (since v3)');
  assert.equal(reviewStateGoing(rel({ state: 'not_affected' })), null, 'a link with no review state names none');
});

test('mounted: each row the admin may open offers Unlink; a Restricted row offers none', async () => {
  stub({ list: async () => listing, read: async () => ({ document: doc, versions: [] }), related: async () => related() });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1?tab=related', admin);
  try {
    await view.flush();
    const unlinks = view.nodes().filter((n) => n.tagName === 'BUTTON' && /^Unlink /.test(view.props(n)?.['aria-label'] || ''));
    assert.deepEqual(unlinks.map((n) => view.props(n)['aria-label']), ['Unlink GP resolution 2026-07', 'Unlink Capital Call Notice']);
    assert.match(view.text(), /Restricted record · Super Admin only/);
  } finally { await view.unmount(); restore(); }
});

test('mounted: Scope → Review → Result; the reason gates Continue; Review says both documents are unchanged; success re-reads the list', async () => {
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions: [] }), related: async () => related(),
    unlinkRelated: async () => ({ unlinked: { id: 1, kind: 'governance' }, banner: { affected: 0, version: null, dismissed: false } }) });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1?tab=related', admin);
  try {
    await view.flush();
    await click(view, view.nodes().find((n) => view.props(n)?.['aria-label'] === 'Unlink GP resolution 2026-07'));
    let text = dialogText(view);
    assert.match(text, /1\. Scope/);
    assert.match(text, /Link: “GP LLC Operating Agreement” governs the governance record “GP resolution 2026-07”\./);
    assert.match(text, /Its review against v2 by Kim Made-up, with its note/);
    const cont = () => buttonNamed(view, /^Continue$/);
    assert.equal(view.props(cont()).disabled, true, 'no reason: Continue is disabled');
    const area = view.nodes().find((n) => n.tagName === 'TEXTAREA');
    await act(async () => { view.props(area).onChange({ target: { value: 'too short' } }); });
    assert.equal(view.props(cont()).disabled, true, 'a reason under 10 characters does not continue');
    await act(async () => { view.props(area).onChange({ target: { value: '  Linked to the wrong   resolution  ' } }); });
    assert.equal(view.props(cont()).disabled, false);
    await click(view, cont());
    text = dialogText(view);
    assert.match(text, /What changes: the reference between “GP LLC Operating Agreement” and “GP resolution 2026-07” is removed\. Only the reference is removed\./);
    assert.match(text, /What does not: both documents are unchanged/);
    assert.match(text, /The Activity tab keeps the linking, the reviews and this unlink\./);
    assert.equal(calls.filter(([k]) => k === 'unlinkRelated').length, 0, 'nothing is sent before the Review step is confirmed');
    const reads = calls.filter(([k]) => k === 'related').length;
    await click(view, buttonNamed(view, /^Unlink$/));
    assert.deepEqual(calls.filter(([k]) => k === 'unlinkRelated').at(-1)[1], ['g1', 1, 'Linked to the wrong resolution']);
    assert.match(dialogText(view), /Unlinked\. “GP resolution 2026-07” is no longer listed as governed by “GP LLC Operating Agreement”\. Neither document was changed\./);
    await click(view, buttonNamed(view, /^Close$/));
    assert.ok(calls.filter(([k]) => k === 'related').length > reads, 'the list is read again after an unlink');
  } finally { await view.unmount(); restore(); }
});

test('mounted: a refusal is shown as the Worker sent it, and the list is not re-read', async () => {
  const refusal = Object.assign(new Error('That related document is not linked to this record. Nothing was removed.'), { status: 404 });
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions: [] }), related: async () => related(),
    unlinkRelated: async () => { throw refusal; } });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1?tab=related', admin);
  try {
    await view.flush();
    await click(view, view.nodes().find((n) => view.props(n)?.['aria-label'] === 'Unlink Capital Call Notice'));
    assert.doesNotMatch(dialogText(view), /Its state:/, 'a link with no review state names none');
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'TEXTAREA')).onChange({ target: { value: 'No longer governed by it' } }); });
    await click(view, buttonNamed(view, /^Continue$/));
    await click(view, buttonNamed(view, /^Unlink$/));
    assert.match(dialogText(view), /That related document is not linked to this record\. Nothing was removed\./);
    assert.ok(buttonNamed(view, /^Back to the form$/), 'a refusal offers the way back');
    const reads = calls.filter(([k]) => k === 'related').length;
    await click(view, buttonNamed(view, /^Close$/));
    assert.equal(calls.filter(([k]) => k === 'related').length, reads, 'nothing changed: no re-read');
  } finally { await view.unmount(); restore(); }
});
