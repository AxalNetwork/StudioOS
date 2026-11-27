// D4811 (#4811) part 2 — Corporate Governance's attention view (boards CT-03
// to CT-06): the group header and its drillable counts, the ownership chart
// read from the Worker's intercompany links (never hard-coded), one entity's
// expected records and their six states, a drill-down, and what an admin who
// is not the Super Admin is told of a confidential record. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import {
  RECORD_STATES, drillRecords, groupCounts, groupSentence, issueLine, nextLine, recordAction, recordVersion,
} from '../src/pages/admin/contracts/governanceModel.js';
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

const categories = [
  { key: 'operating_agreement', label: 'Operating agreements' }, { key: 'formation_certificate', label: 'Formation certificates' },
  { key: 'member_register', label: 'Member registers' }, { key: 'resolution', label: 'Resolutions' }, { key: 'signing_authority', label: 'Signing authority records' },
];
const brief = (o) => ({ uid: 'u1', title: 'T', status: 'approved', effective_date: null, version: 1, versions: 1, confidential: false, ...o });
const rec = (category, label, state, o = {}) => ({ category, label, conditional: false, state, restricted: false, recorded: 0, current: null, attention: null, ...o });
const counts = (records) => {
  const c = { review_required: 0, missing: 0, not_recorded: 0, restricted: 0, incomplete: 0, current: 0 };
  for (const r of records) { c[r.state] += 1; if (r.restricted && r.state !== 'restricted') c.restricted += 1; }
  return c;
};
const entity = (key, name, records, facts = {}, o = {}) => ({ key, name, documents: [], withheld: 0,
  attention: { records, counts: counts(records), facts: { latest_executed: null, last_review: null, outstanding_issue: null, next_action: null, ...facts } }, ...o });

const gpRecords = [
  rec('operating_agreement', 'GP LLC Operating Agreement', 'current', { recorded: 1, current: brief({ uid: 'g1', title: 'GP OA v1', status: 'executed', effective_date: '2023-04-20' }) }),
  rec('formation_certificate', 'Certificate of Formation', 'incomplete', { recorded: 1, current: brief({ uid: 'g2', title: 'GP certificate', status: 'draft', version: null, versions: 0 }), attention: brief({ uid: 'g2', title: 'GP certificate', status: 'draft', version: null, versions: 0 }) }),
  rec('member_register', 'Member Register', 'not_recorded', { conditional: true }),
  rec('resolution', 'Parent Member Consent and GP resolutions', 'review_required', { recorded: 2, current: brief({ uid: 'g3', title: 'Consent 2023', status: 'executed' }), attention: brief({ uid: 'g4', title: 'Resolution 2026-07', status: 'review' }) }),
  rec('signing_authority', 'Authorized signatories', 'missing'),
];
const listing = (o = {}) => ({
  entities: [
    entity('holdings', 'Axal VC Holdings LLC', [rec('operating_agreement', 'Operating Agreement', 'current', { recorded: 1, current: brief({ uid: 'h1', title: 'Holdings OA', status: 'executed' }) }),
      rec('member_register', 'Member Register', 'restricted', { restricted: true })], {}, { withheld: 1 }),
    entity('management', 'Axal VC Management LLC', [rec('signing_authority', 'Delegation of Authority', 'missing')],
      { outstanding_issue: { kind: 'missing', category: 'signing_authority', label: 'Delegation of Authority' }, next_action: { kind: 'add', category: 'signing_authority', label: 'Delegation of Authority' } }),
    entity('gp', 'Axal VC GP LLC', gpRecords, { latest_executed: brief({ uid: 'g1', title: 'GP OA v1', status: 'executed', effective_date: '2023-04-20' }),
      outstanding_issue: { kind: 'missing', category: 'signing_authority', label: 'Authorized signatories' }, next_action: { kind: 'add', category: 'signing_authority', label: 'Authorized signatories' } }),
  ],
  categories, statuses: ['draft', 'review', 'approved', 'executed', 'archived'], super_admin: false,
  group: { links: [{ parent: 'holdings', child: 'management', percent: 100 }, { parent: 'holdings', child: 'gp', percent: null }] }, ...o,
});
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };
const superAdmin = { ...admin, is_super_admin: 1 };
const textOf = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(textOf).join(''));

test('the words: six record states, each a glyph and words; a percent not recorded is never a number', () => {
  assert.deepEqual(Object.keys(RECORD_STATES), ['current', 'review_required', 'missing', 'not_recorded', 'restricted', 'incomplete']);
  for (const s of Object.values(RECORD_STATES)) assert.ok(s.glyph && s.label, 'never colour alone');
  assert.equal(RECORD_STATES.missing.label, 'Missing — expected');
  assert.equal(RECORD_STATES.not_recorded.label, 'Not recorded — add if applicable');
  const ents = listing().entities;
  assert.equal(groupSentence(ents, listing().group.links), 'Axal VC Holdings LLC owns 100% of Axal VC Management LLC. Axal VC Holdings LLC owns a share (percent not recorded) of Axal VC GP LLC.');
  assert.equal(groupSentence(ents, []), null, 'no links recorded: nothing is drawn as 100%');
  assert.deepEqual(groupCounts(ents), { entities: 3, review_required: 1, missing: 2, restricted: 1, incomplete: 1 });
  assert.deepEqual(drillRecords(ents, 'missing').map((r) => r.record.label), ['Delegation of Authority', 'Authorized signatories']);
  const confidentialCurrent = rec('member_register', 'Member Register', 'current', { restricted: true, current: brief() });
  assert.equal(drillRecords([entity('holdings', 'H', [confidentialCurrent])], 'restricted').length, 1, 'a Super Admin\'s confidential record still counts as restricted');
  assert.equal(recordAction(gpRecords[4], 'GP').label, 'Add governance record');
  assert.equal(recordAction(gpRecords[2], 'GP').label, 'Add if applicable');
  assert.deepEqual([recordAction(gpRecords[1], 'GP').label, recordAction(gpRecords[1], 'GP').uid], ['Upload file', 'g2']);
  assert.deepEqual([recordAction(gpRecords[3], 'GP').label, recordAction(gpRecords[3], 'GP').uid], ['Open review', 'g4'], 'the action opens the record that needs review, not the executed one');
  assert.equal(recordAction(rec('member_register', 'Member Register', 'restricted', { restricted: true }), 'H'), null, 'nothing to open for a restricted record');
  assert.equal(recordVersion(gpRecords[3]), '2 recorded · v1 · Executed');
  assert.equal(recordVersion(gpRecords[4]), null);
  assert.equal(issueLine({ kind: 'missing', label: 'Authorized signatories' }), 'No Authorized signatories recorded');
  assert.equal(nextLine({ kind: 'review', label: 'GP resolutions', title: 'Resolution 2026-07' }), 'Finish the review of Resolution 2026-07');
  assert.equal(nextLine(null), null);
});

test('the overview: drillable counts, the chart from the ownership links, the entities table, and no passive "None recorded" where the system knows', async () => {
  stub({ list: async () => listing() });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Axal VC group/);
    const drill = (k) => view.nodes().find((n) => view.props(n)?.['data-testid'] === `governance-drill-${k}`);
    assert.equal(view.props(drill('missing')).href, '/admin/contracts/governance?records=missing', 'each count links to its records');
    assert.match(textOf(drill('missing')), /Missing — expected2/);
    assert.match(textOf(drill('review_required')), /Need legal review1/);
    assert.equal(view.props(drill('entities')).href, '#governance-entities');
    const chart = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'governance-group-chart');
    assert.equal(view.props(chart).role, 'img');
    assert.match(view.props(chart)['aria-label'], /owns 100% of Axal VC Management LLC/);
    assert.match(textOf(chart), /percent not recorded/, 'an unrecorded percent says so');
    assert.match(text, /No Delegation of Authority recorded/);
    assert.match(text, /Add Authorized signatories →/);
    assert.match(text, /GP OA v1/);
    assert.match(text, /None recorded as executed/);
    assert.match(text, /None you can open/, 'an entity whose only executed record is confidential does not claim none exists');
    assert.match(text, /Not recorded.*Legal Review tab/, 'last review is unknown here, never a date');
    assert.match(text, /Restricted: only the Super Admin can open it\./, 'the empty category of the collection says Restricted, not None recorded');
    assert.doesNotMatch(text, /View restricted ownership details/, 'only the Super Admin is offered the ownership');
    assert.doesNotMatch(text, /score/i);
  } finally { await view.unmount(); restore(); }
});

test('no ownership link recorded: the chart says Not recorded and why, never a drawn 100%', async () => {
  stub({ list: async () => listing({ group: { links: [] } }) });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'governance-group-unrecorded'));
    assert.doesNotMatch(view.text(), /100%/);
  } finally { await view.unmount(); restore(); }
});

test('one entity: facts, expected records with their explanations, and Add opens the new-document panel on that record\'s category', async () => {
  const calls = stub({ list: async () => listing() });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance?entity=gp', admin);
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Contracts › Corporate Governance › Axal VC GP LLC/);
    assert.match(text, /Expected records/);
    assert.match(text, /5 record types this entity should hold/);
    assert.match(text, /This entity should hold one\. None is recorded\./);
    assert.match(text, /Only needed if the entity keeps one\./);
    assert.match(text, /A record is started but has no file yet\./);
    assert.doesNotMatch(text, /Axal VC Holdings LLC/, 'only this entity');
    const add = view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.['aria-label'] === 'Add Authorized signatories for Axal VC GP LLC');
    assert.ok(add);
    await act(async () => { view.props(add).onClick({}); });
    await view.flush();
    assert.match(view.text(), /New document · Axal VC GP LLC/);
    const select = view.nodes().find((n) => n.tagName === 'SELECT');
    assert.equal(view.props(select).value, 'signing_authority', 'pre-filled with the entity and the record type');
    const review = view.nodes().find((n) => n.tagName === 'BUTTON' && view.props(n)?.['aria-label'] === 'Open Resolution 2026-07');
    await act(async () => { view.props(review).onClick({}); });
    await view.flush();
    assert.equal(calls.filter(([k]) => k === 'read').at(-1)[1][0], 'g4');
  } finally { await view.unmount(); restore(); }
});

test('a drill-down lists the records behind its count, and an empty one says so', async () => {
  stub({ list: async () => listing() });
  let view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance?records=missing', admin);
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Missing — expected · 2/);
    assert.match(text, /Delegation of Authority.*Axal VC Management LLC/);
    assert.match(text, /Authorized signatories.*Axal VC GP LLC/);
    assert.doesNotMatch(text, /Axal VC group/, 'the list replaces the overview');
  } finally { await view.unmount(); restore(); }
  stub({ list: async () => listing({ entities: listing().entities.map((e) => ({ ...e, attention: { ...e.attention, records: e.attention.records.filter((r) => r.state !== 'restricted' && !r.restricted) } })) }) });
  view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance?records=restricted', admin);
  try {
    await view.flush();
    assert.match(view.text(), /No record is in this state\./);
  } finally { await view.unmount(); restore(); }
});

test('a restricted record tells an admin its state and nothing else; the Super Admin is offered the ownership details', async () => {
  stub({ list: async () => listing() });
  let view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance?entity=holdings', admin);
  try {
    await view.flush();
    const row = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'expected-holdings-member_register');
    assert.match(textOf(row), /Restricted.*Contents need restricted access.*Super Admin only/);
    assert.equal(row.childNodes.flatMap(function all(n) { return [n, ...(n.childNodes || []).flatMap(all)]; }).filter((n) => n.tagName === 'BUTTON').length, 0, 'no action on a record this admin cannot open');
  } finally { await view.unmount(); restore(); }
  const calls = stub({ list: async () => listing({ super_admin: true }), ownership: async () => ({ entities: [] }) });
  view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', superAdmin);
  try {
    await view.flush();
    await view.click('🔒 View restricted ownership details'); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'ownership').length, 1);
  } finally { await view.unmount(); restore(); }
});
