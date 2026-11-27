// D4811 (#4811) part 20 — a signed copy names the counsel-approved version it
// is a copy of (board CT-12 B): the upload offers approved versions only (a
// draft is never offered), says so when none is approved, sends the choice,
// shows the Worker's refusal beside the form; a version reads "copy of
// approved vN" and the approved one carries the Approved marker. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import { versionMarkers } from '../src/pages/admin/contracts/GovernanceWorkspace.jsx';
import { reviewRows } from '../src/pages/admin/contracts/HighRiskMove.jsx';
import { approvedChoices, signedCopyLine } from '../src/pages/admin/contracts/governanceModel.js';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

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
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));

const base = { content_type: 'application/pdf', file_bytes: 2048, created_at: '2026-11-01T10:00:00Z', signed_on: null, signatory: null, attested: false, copy_of: null };
const v1 = { ...base, version: 1, signed: false, counsel_approved: true };
const v2 = { ...base, version: 2, signed: false, counsel_approved: true };
const v3 = { ...base, version: 3, signed: false, counsel_approved: false };
const doc = { uid: 'd1', entity_key: 'management', category: 'resolution', title: 'Sole-Member Consent', status: 'approved', effective_date: null,
  confidential: false, template_slug: null, envelope_id: null, executed_version: null, next_statuses: ['executed', 'archived'], versions: 3, latest: v3, updated_at: '2026-11-06T10:00:00Z' };
const listing = { entities: [{ key: 'management', name: 'Axal VC Management LLC', documents: [doc], withheld: 0 }],
  categories: [{ key: 'resolution', label: 'Resolutions' }], statuses: ['draft', 'review', 'approved', 'executed', 'archived'], super_admin: false };
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };

test('the rules: approved versions only, newest first; a copy names its version; the Approved marker', () => {
  assert.deepEqual(approvedChoices([v1, v3, v2, { ...v2, version: 4, signed: true }]).map((v) => v.version), [2, 1]);
  assert.deepEqual(approvedChoices([{ ...v1, counsel_approved: null }]), [], 'approvals not read: nothing is offered');
  const copy = { ...base, version: 4, signed: true, signed_on: '2026-11-05', signatory: 'S. Example, Manager', attested: true, copy_of: 2 };
  assert.equal(signedCopyLine(copy), 'Signed 5 Nov 2026 by S. Example, Manager · attested complete · copy of approved v2');
  assert.equal(signedCopyLine({ ...copy, signed_on: null }), 'Signature date and signatory not recorded · copy of approved v2');
  assert.equal(signedCopyLine({ ...copy, copy_of: null }), 'Signed 5 Nov 2026 by S. Example, Manager · attested complete');
  assert.match(reviewRows('executed', doc, { kind: 'version', version: 4 }, [copy])[0][1], /v4 \(signed copy; .*copy of approved v2\)/);
  assert.deepEqual(versionMarkers(doc, v2, 3), ['Approved']);
  assert.deepEqual(versionMarkers(doc, v3, 3), ['Latest']);
});

async function openUpload(versions, answers = {}) {
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions }), ...answers });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  await view.flush();
  const row = view.nodes().filter((n) => n.tagName === 'BUTTON').find((n) => walk(n).startsWith('Sole-Member Consent'));
  await act(async () => { view.props(row).onClick({}); });
  await view.flush();
  await view.click('Upload a version');
  const file = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'file');
  await act(async () => { view.props(file).onChange({ target: { files: [{ name: 'signed.pdf', size: 2048 }] } }); });
  const box = view.nodes().filter((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox')[0];
  await act(async () => { view.props(box).onChange({ target: { checked: true } }); });
  const dateInput = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'date');
  await act(async () => { view.props(dateInput).onChange({ target: { value: '2026-11-05' } }); });
  const who = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.placeholder === 'S. Example, Manager');
  await act(async () => { view.props(who).onChange({ target: { value: 'S. Example, Manager' } }); });
  const attest = view.nodes().filter((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox').find((n) => walk(n.parentNode).includes('I confirm'));
  await act(async () => { view.props(attest).onChange({ target: { checked: true } }); });
  return { view, calls };
}

test('mounted: the selector offers approved versions only, defaults to the newest, and sends the choice; a refusal shows beside the form', async () => {
  const { view, calls } = await openUpload([v3, v2, v1], {
    uploadVersion: async () => Promise.reject(Object.assign(new Error('v1 is not approved by counsel, so it cannot establish execution. Choose v2, or get v1 approved first. Nothing was uploaded.'), { status: 409 })),
  });
  try {
    const select = view.nodes().find((n) => n.tagName === 'SELECT' && /counsel approved/.test(walk(n)));
    const options = walk(select);
    assert.match(options, /v2 · counsel approved/);
    assert.match(options, /v1 · counsel approved/);
    assert.doesNotMatch(options, /v3/, 'a draft is never offered');
    assert.match(view.text(), /Signed copy of/);
    assert.equal(view.props(select).value, '2');
    await act(async () => { view.props(select).onChange({ target: { value: '1' } }); });
    await view.click('Upload as v4');
    await view.flush();
    assert.equal(calls.find(([k]) => k === 'uploadVersion')[1][1].copy_of, '1');
    assert.match(view.text(), /Choose v2, or get v1 approved first\./);
  } finally { await view.unmount(); restore(); }
});

test('mounted: with no approved version, the form says so and names none', async () => {
  const { view, calls } = await openUpload([v3], { uploadVersion: async () => ({}) });
  try {
    assert.equal(view.nodes().some((n) => n.tagName === 'SELECT' && /counsel approved/.test(walk(n))), false);
    assert.match(view.text(), /No version of this record is approved by counsel, so this copy names none\./);
    await view.click('Upload as v2');
    await view.flush();
    assert.equal(calls.find(([k]) => k === 'uploadVersion')[1][1].copy_of, '');
  } finally { await view.unmount(); restore(); }
});

test('the API sends copy_of only with a signed copy that names one', async () => {
  const sent = [];
  const undo = installDocument();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init.body); return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const file = new File(['%PDF'], 'a.pdf');
    const evidence = { signed_on: '2026-11-05', signatory: 'S. Example', attest: true };
    await govOriginals.uploadVersion('d1', { file, signed: true, ...evidence, copy_of: 2 });
    await govOriginals.uploadVersion('d1', { file, signed: true, ...evidence, copy_of: '' });
    await govOriginals.uploadVersion('d1', { file, signed: false, copy_of: 2 });
    assert.equal(sent[0].get('copy_of'), '2');
    assert.equal(sent[1].has('copy_of'), false);
    assert.equal(sent[2].has('copy_of'), false);
  } finally { globalThis.fetch = realFetch; undo(); }
});
