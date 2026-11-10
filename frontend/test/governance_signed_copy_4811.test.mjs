// D4811 (#4811) part 12 — the execution evidence on a signed copy (board
// CT-12 B): the upload asks when it was signed, by whom and for the
// attestation before anything is sent; a version names its signer, or says
// they were not recorded; Mark executed's review names them too. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { api, contractsApi } from '../src/lib/api.js';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import GovernanceTab from '../src/pages/admin/contracts/GovernanceTab.jsx';
import { reviewRows } from '../src/pages/admin/contracts/HighRiskMove.jsx';
import { signedCopyLine, signedCopyProblem } from '../src/pages/admin/contracts/governanceModel.js';
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

const copy = { version: 2, signed: true, signed_on: '2026-11-05', signatory: 'S. Example, Manager', attested: true, content_type: 'application/pdf', file_bytes: 2048, created_at: '2026-11-06T10:00:00Z' };
const legacy = { version: 1, signed: true, signed_on: null, signatory: null, attested: false, content_type: 'application/pdf', file_bytes: 2048, created_at: '2026-11-01T10:00:00Z' };
const doc = { uid: 'd1', entity_key: 'holdings', category: 'operating_agreement', title: 'Holdings OA', status: 'draft', effective_date: null,
  confidential: false, template_slug: null, envelope_id: null, executed_version: null, next_statuses: ['review', 'archived'], versions: 2, latest: copy, updated_at: '2026-11-06T10:00:00Z' };
const listing = { entities: [{ key: 'holdings', name: 'Axal VC Holdings LLC', documents: [doc], withheld: 0 }],
  categories: [{ key: 'operating_agreement', label: 'Operating agreements' }], statuses: ['draft', 'review', 'approved', 'executed', 'archived'], super_admin: false };
const admin = { id: 2, role: 'admin', name: 'Admin', is_super_admin: 0 };

test('the rules: who signed and when, or that it was not recorded; a signed upload lacks nothing before it is sent', () => {
  assert.equal(signedCopyLine(copy), 'Signed 5 Nov 2026 by S. Example, Manager · attested complete');
  assert.equal(signedCopyLine({ ...copy, attested: false }), 'Signed 5 Nov 2026 by S. Example, Manager');
  assert.equal(signedCopyLine(legacy), 'Signature date and signatory not recorded', 'an older copy is not given a date or a person');
  assert.equal(signedCopyLine({ ...copy, signed: false }), null);
  const full = { signed: true, signed_on: '2026-11-05', signatory: 'S. Example', attest: true };
  assert.equal(signedCopyProblem(full, '2026-11-09'), null);
  assert.equal(signedCopyProblem({ signed: false }, '2026-11-09'), null, 'an unsigned draft needs none of it');
  assert.equal(signedCopyProblem({ ...full, signed_on: '' }, '2026-11-09'), 'Give the date the copy was signed.');
  assert.equal(signedCopyProblem({ ...full, signed_on: '2026-11-10' }, '2026-11-09'), 'The signature date is after today.');
  assert.equal(signedCopyProblem({ ...full, signed_on: '2026-11-09' }, '2026-11-09'), null, 'today is allowed');
  assert.equal(signedCopyProblem({ ...full, signatory: ' x ' }, '2026-11-09'), 'Name who signed it, with their capacity.');
  assert.equal(signedCopyProblem({ ...full, attest: false }, '2026-11-09'), 'Confirm this is the complete, fully signed copy.');
  const [[, changes]] = reviewRows('executed', doc, { kind: 'version', version: 2 }, [legacy, copy]);
  assert.match(changes, /v2 \(signed copy; Signed 5 Nov 2026 by S\. Example, Manager · attested complete\)/);
  assert.match(reviewRows('executed', doc, { kind: 'version', version: 1 }, [legacy, copy])[0][1], /v1 \(signed copy; Signature date and signatory not recorded\)/);
});

test('mounted: the version names its signer; a signed upload asks for the evidence and sends it', async () => {
  const calls = stub({ list: async () => listing, read: async () => ({ document: doc, versions: [copy, legacy] }), uploadVersion: async () => ({}) });
  const view = await mountContracts(React.createElement(GovernanceTab), '/admin/contracts/governance', admin);
  try {
    await view.flush();
    const row = view.nodes().filter((n) => n.tagName === 'BUTTON').find((n) => walk(n).startsWith('Holdings OA'));
    await act(async () => { view.props(row).onClick({}); });
    await view.flush();
    const byId = (id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);
    assert.equal(walk(byId('signed-copy-2')), 'Signed 5 Nov 2026 by S. Example, Manager · attested complete');
    assert.equal(walk(byId('signed-copy-1')), 'Signature date and signatory not recorded');
    await view.click('Upload a version');
    assert.equal(byId('governance-signed-copy'), undefined, 'the evidence fields wait for "signed copy"');
    const file = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'file');
    await act(async () => { view.props(file).onChange({ target: { files: [{ name: 'signed.pdf', size: 2048 }] } }); });
    const signedBox = view.nodes().filter((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox')[0];
    await act(async () => { view.props(signedBox).onChange({ target: { checked: true } }); });
    assert.ok(byId('governance-signed-copy'), 'the evidence fields appear');
    await view.click('Upload as v3');
    assert.match(view.text(), /Give the date the copy was signed\./);
    assert.equal(calls.filter(([k]) => k === 'uploadVersion').length, 0, 'nothing is sent while the evidence is incomplete');
    // The panel's Field wraps its input in a div, so the inputs are found by type and placeholder.
    const dateInput = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'date');
    await act(async () => { view.props(dateInput).onChange({ target: { value: '2026-11-05' } }); });
    const who = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.placeholder === 'S. Example, Manager');
    await act(async () => { view.props(who).onChange({ target: { value: 'S. Example, Manager' } }); });
    await view.click('Upload as v3');
    assert.match(view.text(), /Confirm this is the complete, fully signed copy\./);
    const attest = view.nodes().filter((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox').find((n) => walk(n.parentNode).includes('I confirm'));
    await act(async () => { view.props(attest).onChange({ target: { checked: true } }); });
    await view.click('Upload as v3');
    await view.flush();
    const [uid, body] = calls.find(([k]) => k === 'uploadVersion')[1];
    assert.equal(uid, 'd1');
    assert.deepEqual({ ...body, file: body.file.name }, { file: 'signed.pdf', signed: true, note: '', signed_on: '2026-11-05', signatory: 'S. Example, Manager', attest: true });
  } finally { await view.unmount(); restore(); }
});

test('the API sends the evidence only with a signed copy', async () => {
  const sent = [];
  const undo = installDocument();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(init.body); return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const file = new File(['%PDF'], 'a.pdf');
    await govOriginals.uploadVersion('d1', { file, signed: true, signed_on: '2026-11-05', signatory: 'S. Example', attest: true });
    await govOriginals.uploadVersion('d1', { file, signed: false, signed_on: '2026-11-05', signatory: 'S. Example', attest: true });
    await govOriginals.uploadVersion('d1', { file, signed: true, signed_on: '2026-11-05', signatory: 'S. Example', attest: false });
    assert.deepEqual([...sent[0].keys()], ['file', 'signed', 'signed_on', 'signatory', 'attest']);
    assert.deepEqual([...sent[1].keys()], ['file']);
    assert.deepEqual([...sent[2].keys()], ['file', 'signed', 'signed_on', 'signatory'], 'no attestation is sent unless it was given');
  } finally { globalThis.fetch = realFetch; undo(); }
});
