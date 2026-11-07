// D4563 (#4563) — HQ Contracts › Corporate Governance: the tab's rules, its
// three entity collections, its dialogs, and its place on the desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import Desk from '../src/pages/admin/contracts/ContractsDesk.jsx';
import {
  byCategory, executedHint, fileProblem, moveLabel, ownershipPayload, recordedPercent, versionLine, draftRow,
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
const doc = (o = {}) => ({ uid: 'd1', entity_key: 'holdings', category: 'operating_agreement', title: 'Holdings OA', status: 'approved', effective_date: '2026-01-15',
  confidential: false, template_slug: null, envelope_id: null, executed_version: null, next_statuses: ['review', 'executed', 'archived'], versions: 1,
  latest: { version: 1, signed: false, file_bytes: 2048, content_type: 'application/pdf', note: null, created_at: '2026-11-01T10:00:00Z' }, updated_at: '2026-11-01T10:00:00Z', ...o });
const listing = (o = {}) => ({
  entities: [
    { key: 'holdings', name: 'Axal VC Holdings LLC', documents: [doc()], withheld: 0 },
    { key: 'management', name: 'Axal VC Management LLC', documents: [], withheld: 2 },
    { key: 'gp', name: 'Axal VC GP LLC', documents: [doc({ uid: 'd2', entity_key: 'gp', category: 'resolution', title: 'GP resolution', status: 'draft', effective_date: null, latest: null, versions: 0, next_statuses: ['review', 'archived'] })], withheld: 0 },
  ], categories, statuses: ['draft', 'review', 'approved', 'executed', 'archived'], super_admin: false, ...o,
});
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };
const superAdmin = { ...admin, is_super_admin: 1 };

test('the rules: moves, the signature hint, files, versions and ownership never guess', () => {
  assert.equal(moveLabel('approved', 'executed'), 'Mark executed');
  assert.equal(moveLabel('archived', 'draft'), 'Restore as draft');
  assert.match(executedHint({ envelope_id: null }, [{ signed: false }]), /signed copy/);
  assert.equal(executedHint({ envelope_id: null }, [{ signed: true }]), null);
  assert.equal(executedHint({ envelope_id: 4 }, []), null);
  assert.equal(fileProblem({ name: 'a.exe', size: 10 }), 'Only a PDF or Word (.docx) file can be kept here.');
  assert.match(fileProblem({ name: 'a.pdf', size: 26 * 1024 * 1024 }), /25 MB/);
  assert.equal(fileProblem({ name: 'a.docx', size: 10 }), null);
  assert.equal(versionLine({ version: 3, content_type: 'application/pdf', file_bytes: 2048, signed: true }), 'v3 · PDF · 2 KB · signed copy');
  assert.equal(versionLine(null), null);
  assert.deepEqual(byCategory([doc()], categories).map((g) => g.documents.length), [1, 0, 0, 0, 0]);
  // A blank percent stays unknown, never 0.
  assert.deepEqual(ownershipPayload([draftRow({ holder: 'A', percent: null })]).rows, [{ holder: 'A', interest: null, percent: null, note: null }]);
  assert.equal(recordedPercent([{ percent: null }]), null);
  assert.equal(recordedPercent([{ percent: 60 }, { percent: 40 }]), 100);
  assert.equal(ownershipPayload([draftRow({ percent: 10 })]).error, 'Every ownership row names its holder.');
  assert.equal(ownershipPayload([draftRow({ holder: 'A', percent: 70 }), draftRow({ holder: 'B', percent: 40 })]).error, 'The percents add up to more than 100.');
  assert.equal(ownershipPayload([draftRow({ holder: 'A', percent: 101 })]).error, 'A percent is between 0 and 100.');
  assert.deepEqual(ownershipPayload([draftRow()]).rows, [], 'an untouched row is not a holder');
});

test('three entity collections, grouped by category; a confidential document is only counted', async () => {
  const calls = stub({ list: async () => listing() });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    const text = view.text();
    for (const name of ['Axal VC Holdings LLC', 'Axal VC Management LLC', 'Axal VC GP LLC']) assert.match(text, new RegExp(name));
    for (const c of categories) assert.match(text, new RegExp(c.label));
    assert.match(text, /Holdings OA/);
    assert.match(text, /Effective 15 Jan 2026 · v1 · PDF · 2 KB/);
    assert.match(text, /GP resolution.*Effective date not recorded · No file yet/);
    assert.match(text, /2 confidential \(Super Admin only\)/);
    assert.doesNotMatch(text, /Ownership \(Super Admin\)/, 'a plain admin is not offered the ownership');
    assert.equal(calls.filter(([k]) => k === 'ownership').length, 0, 'and it is never read for them');
  } finally { await view.unmount(); restore(); }
});

test('a failed read says so and retries, never an empty collection', async () => {
  let n = 0;
  const calls = stub({ list: () => (n++ === 0 ? Promise.reject(new Error('down')) : Promise.resolve(listing())) });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    assert.match(view.text(), /could not be read/);
    assert.doesNotMatch(view.text(), /None recorded/);
    await view.click('Try again'); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'list').length, 2);
    assert.match(view.text(), /Holdings OA/);
  } finally { await view.unmount(); restore(); }
});

test('a status move asks first in the panel, then sends; the Worker\'s refusal is printed as it comes', async () => {
  const calls = stub({
    list: async () => listing(),
    read: async () => ({ document: doc(), versions: [doc().latest] }),
    update: () => Promise.reject(Object.assign(new Error('Upload the signed copy, or link the signed envelope, before marking this document executed. Nothing was saved.'), { status: 409 })),
  });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
    const rowButton = view.nodes().filter((n) => n.tagName === 'BUTTON').find((n) => walk(n).startsWith('Holdings OA'));
    assert.ok(rowButton, 'the document opens from its row');
    await act(async () => { view.props(rowButton).onClick({}); });
    await view.flush();
    assert.equal(calls.filter(([k]) => k === 'read').at(-1)[1][0], 'd1');
    assert.match(view.text(), /Send to review|Return to review/);
    await view.click('Mark executed');
    assert.equal(calls.filter(([k]) => k === 'update').length, 0, 'the first press only asks');
    assert.match(view.text(), /Move “Holdings OA” from Approved to Executed\?/);
    assert.match(view.text(), /Upload the signed copy, or link the completed envelope/);
    const confirms = view.nodes().filter((n) => n.tagName === 'BUTTON' && view.props(n)?.children === 'Mark executed');
    await act(async () => { view.props(confirms.at(-1)).onClick({}); });
    await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'update').at(-1)[1], ['d1', { status: 'executed' }]);
    assert.match(view.text(), /before marking this document executed\. Nothing was saved\./);
  } finally { await view.unmount(); restore(); }
});

test('the Super Admin is offered the ownership, and an unrecorded entity reads Not recorded', async () => {
  const calls = stub({
    list: async () => listing({ super_admin: true }),
    ownership: async () => ({ entities: [
      { key: 'holdings', name: 'Axal VC Holdings LLC', ownership: [{ holder: 'Member A', interest: 'Class A units', percent: null, note: null }], updated_at: '2026-11-02T10:00:00Z' },
      { key: 'management', name: 'Axal VC Management LLC', ownership: [], updated_at: null },
      { key: 'gp', name: 'Axal VC GP LLC', ownership: [], updated_at: null },
    ] }),
    setOwnership: async () => ({ ok: true }),
  });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', superAdmin);
  try {
    await view.flush();
    await view.click('Ownership (Super Admin)'); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'ownership').length, 1, 'read only once it opens');
    const text = view.text();
    assert.match(text, /Member A · Class A units · percent not recorded/);
    assert.match(text, /No percent recorded\./);
    assert.match(text, /Not recorded.*No ownership has been recorded for this entity/);
    assert.doesNotMatch(text, /0%/, 'an unknown percent is never 0');
  } finally { await view.unmount(); restore(); }
});

test('the desk: Corporate Governance sits after Templates at its own path, HQ only', async () => {
  stub({ list: async () => listing() });
  const element = () => React.createElement(AuthProvider, null, React.createElement(Desk, { section: 'governance' }));
  const view = await mountContracts(element(), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    const link = view.nodes().find((n) => view.props(n)?.['data-testid'] === 'contracts-tab-governance');
    assert.ok(link, 'the tab is drawn');
    assert.equal(view.props(link)['aria-current'], 'page');
    assert.match(view.text(), /Templates.*Corporate Governance.*Forms/s, 'beside the template library');
    assert.match(view.text(), /Holdings OA/);
  } finally { await view.unmount(); restore(); }
  stub({ list: async () => listing() });
  const plain = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk)), '/admin/contracts?tab=templates', admin);
  try {
    await plain.flush();
    const link = plain.nodes().find((n) => plain.props(n)?.['data-testid'] === 'contracts-tab-governance');
    assert.ok(link);
    assert.equal(plain.props(link)['aria-current'], undefined, 'not current on another tab');
  } finally { await plain.unmount(); restore(); }
  stub({ list: async () => listing() });
  const branch = await mountContracts(React.createElement(AuthProvider, null, React.createElement(Desk, { section: 'governance' })), '/admin/contracts/governance', { ...admin, branch: { code: 'north' } });
  try {
    await branch.flush();
    assert.equal(branch.nodes().find((n) => branch.props(n)?.['data-testid'] === 'contracts-tab-governance'), undefined, 'a branch gets no tab');
    assert.doesNotMatch(branch.text(), /Holdings OA/);
  } finally { await branch.unmount(); restore(); }
});

test('the route: its own path (tabs are paths), behind admin and HQ only', () => {
  const src = readFileSync(new URL('../src/routes/adminGovernance.jsx', import.meta.url), 'utf8');
  assert.match(src, /<Route path="\/admin\/contracts\/governance" element=\{guard\(\['admin'\], hqOnly\(<HqContractsPage section="governance" \/>\)\)\} \/>/);
  assert.doesNotMatch(readFileSync(new URL('../src/pages/admin/contracts/GovernanceTab.jsx', import.meta.url), 'utf8'), /window\.(confirm|alert|prompt)\(/, 'every change opens an in-page dialog');
});
