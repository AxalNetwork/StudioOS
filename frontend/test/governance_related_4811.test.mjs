// D4811 (#4811) part 8 — a governance record's related documents (board
// CT-11): the banner ("N related documents may require review", nothing
// changed in them) with Review affected documents and Dismiss for me; the
// Related tab listing what the record governs with each one's state; Mark
// reviewed against the version that raised it, with an optional note; a
// Restricted dependant named as such and not markable; linking a record or a
// template. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Routes, Route } from 'react-router-dom';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import { bannerLine, relationTitle, stateLine } from '../src/pages/admin/contracts/RelatedDocuments.jsx';
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
const entities = [{ key: 'gp', name: 'Axal VC GP LLC', withheld: 0, documents: [
  { uid: 'g1', title: 'GP LLC Operating Agreement' }, { uid: 'g2', title: 'GP resolution 2026-07' }, { uid: 'g3', title: 'Signatory list' }] }];
const listing = { entities, categories, statuses: [], super_admin: false, group: { links: [] } };
const doc = { uid: 'g1', entity_key: 'gp', category: 'operating_agreement', title: 'GP LLC Operating Agreement', status: 'approved', effective_date: null,
  confidential: false, template_slug: null, envelope_id: null, executed_version: null, next_statuses: [], versions: 2, latest: null, updated_at: null };
const rel = (o) => ({ id: 1, kind: 'governance', ref: 'g2', title: 'GP resolution 2026-07', status: 'executed', entity_key: 'gp', category: 'resolution', restricted: false, missing: false,
  state: 'review_suggested', flag_version: 2, flagged_at: '2026-11-05T10:00:00Z', reviewed_version: null, reviewed_at: null, reviewed_by: null, review_note: null, ...o });
const related = (o = {}) => ({ uid: 'g1', governed_by: [], banner: { affected: 2, version: 2, dismissed: false }, dependants: [
  rel(),
  rel({ id: 2, kind: 'template', ref: 'capital_call_notice', title: 'Capital Call Notice', status: null }),
  rel({ id: 3, ref: null, title: null, status: null, restricted: true }),
  rel({ id: 4, kind: 'template', ref: 'distribution_notice', title: 'Distribution Notice', status: null, state: 'reviewed', reviewed_version: 1, reviewed_at: '2026-10-01T10:00:00Z', reviewed_by: 'Kim Made-up', review_note: 'Checked §9.2' }),
  rel({ id: 5, kind: 'template', ref: 'gone', title: null, status: null, missing: true, state: 'not_affected', flag_version: null }),
], ...o });
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };
const page = () => React.createElement(Routes, null,
  React.createElement(Route, { path: '/admin/contracts/governance/doc/:uid', element: React.createElement(GovernanceTab) }));
const nodeText = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(nodeText).join('') : node.textContent || '');
const click = async (view, node) => { await act(async () => { view.props(node).onClick({ preventDefault() {} }); }); await view.flush(); };

test('the words: the banner, each state, and what a row can name', () => {
  assert.equal(bannerLine({ affected: 4, version: 2 }), '4 related documents may require review.');
  assert.equal(bannerLine({ affected: 1, version: 2 }), '1 related document may require review.');
  assert.equal(bannerLine({ affected: 0, version: null }), null, 'nothing to review: no banner, never "0 documents"');
  assert.equal(bannerLine(null), null);
  assert.equal(stateLine(rel()).text, '◷ May require review');
  assert.match(stateLine(rel()).detail, /^since v2/);
  assert.deepEqual(stateLine(rel({ state: 'reviewed', reviewed_version: 2, reviewed_by: null, reviewed_at: null })), { tone: 'plain', text: '✓ Reviewed against v2', detail: 'reviewer not recorded · date not recorded' });
  assert.equal(stateLine(rel({ state: 'not_affected' })).text, 'Not affected');
  assert.equal(relationTitle(rel({ restricted: true, title: null })), 'Restricted record · Super Admin only');
  assert.equal(relationTitle(rel({ kind: 'template', missing: true, title: null })), 'Template no longer in the library');
  assert.equal(relationTitle(rel({ missing: true, title: null })), 'Record not found');
});

test('mounted: the banner names the count; Review affected documents opens the flagged ones; Dismiss for me hides it', async () => {
  let dismissed = false;
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions: [] }),
    related: async () => related({ banner: { affected: 2, version: 2, dismissed } }), dismissRelated: async () => { dismissed = true; return { banner: { dismissed: true } }; } });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1', admin);
  try {
    await view.flush();
    let text = view.text();
    assert.match(text, /2 related documents may require review\..*Nothing has been changed in the related documents/);
    assert.match(text, /Related5/, 'the Related tab counts the linked documents');
    const review = view.nodes().find((n) => n.tagName === 'BUTTON' && /Review affected documents/.test(nodeText(n)));
    await click(view, review);
    text = view.text();
    assert.match(text, /Showing: may require review \(3\)/);
    assert.doesNotMatch(text, /Distribution Notice/, 'a reviewed document is not in the affected view');
    assert.match(text, /GP resolution 2026-07.*Capital Call Notice.*Restricted record · Super Admin only/);
    const dismiss = view.nodes().find((n) => n.tagName === 'BUTTON' && /Dismiss for me/.test(nodeText(n)));
    await click(view, dismiss);
    assert.equal(calls.filter(([k]) => k === 'dismissRelated').length, 1);
    assert.doesNotMatch(view.text(), /may require review\. This record/, 'dismissed: the banner is gone for this admin');
    assert.match(view.text(), /◷ May require review/, 'the flags stay');
  } finally { await view.unmount(); restore(); }
});

test('mounted: each row says its state; Mark reviewed sends the note; a Restricted row cannot be marked', async () => {
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions: [] }), related: async () => related(),
    markReviewed: async () => ({ relation: {} }), linkable: async () => ({ templates: [{ slug: 'capital_call_notice', title: 'Capital Call Notice' }, { slug: 'side_letter', title: 'Side Letter' }], envelopes: [] }) });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1?tab=related', admin);
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Governed by this record5 documents/);
    assert.match(text, /✓ Reviewed against v1Kim Made-up/);
    assert.match(text, /Note: Checked §9\.2/);
    assert.match(text, /Template no longer in the library.*Not affected/);
    assert.match(text, /Only the Super Admin can open it, so only they can mark it reviewed\./);
    const marks = view.nodes().filter((n) => n.tagName === 'BUTTON' && /^Mark .* reviewed$/.test(view.props(n)?.['aria-label'] || ''));
    assert.deepEqual(marks.map((n) => view.props(n)['aria-label']), ['Mark GP resolution 2026-07 reviewed', 'Mark Capital Call Notice reviewed'], 'the restricted and the reviewed rows have no Mark reviewed');
    await click(view, marks[0]);
    const area = view.nodes().find((n) => n.tagName === 'TEXTAREA');
    await act(async () => { view.props(area).onChange({ target: { value: '  Checked against §9.2  ' } }); });
    const save = view.nodes().find((n) => n.tagName === 'BUTTON' && /Mark reviewed against v2/.test(nodeText(n)));
    await click(view, save);
    assert.deepEqual(calls.filter(([k]) => k === 'markReviewed').at(-1)[1], ['g1', 1, 'Checked against §9.2']);
    assert.ok(calls.filter(([k]) => k === 'related').length >= 2, 'the list is read again after a change');
  } finally { await view.unmount(); restore(); }
});

test('mounted: linking offers the entity\'s other records, then templates not yet linked, and sends the choice', async () => {
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions: [] }),
    related: async () => related({ banner: { affected: 0, version: null, dismissed: false }, dependants: [rel({ state: 'not_affected', flag_version: null })] }),
    relate: async () => ({ relation: {} }), linkable: async () => ({ templates: [{ slug: 'capital_call_notice', title: 'Capital Call Notice' }], envelopes: [] }) });
  const view = await mountContracts(page(), '/admin/contracts/governance/doc/g1?tab=related', admin);
  try {
    await view.flush();
    assert.doesNotMatch(view.text(), /may require review\./, 'no flagged document: no banner');
    const selects = () => view.nodes().filter((n) => n.tagName === 'SELECT');
    const docSelect = selects()[1];
    const values = nodeText(docSelect);
    assert.match(values, /Signatory list · Axal VC GP LLC/);
    assert.doesNotMatch(values, /GP LLC Operating Agreement ·/, 'a record is not offered to govern itself');
    assert.doesNotMatch(values, /GP resolution 2026-07 ·/, 'an already linked record is not offered again');
    await act(async () => { view.props(docSelect).onChange({ target: { value: 'g3' } }); });
    const form = view.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => { view.props(form).onSubmit({ preventDefault() {} }); }); await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'relate').at(-1)[1], ['g1', { kind: 'governance', ref: 'g3' }]);
    await act(async () => { view.props(selects()[0]).onChange({ target: { value: 'template' } }); }); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'linkable').length, 1, 'the library is read only when templates are chosen');
    assert.match(nodeText(selects()[1]), /Capital Call Notice/);
  } finally { await view.unmount(); restore(); }
});
