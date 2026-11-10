// D4811 (#4811) part 18 — attaching execution evidence to a legacy agreement
// marked signed with none (CT-02, CT-12 B): the repair queue's "Attach
// evidence" opens the dialog; nothing is sent until the PDF, the date, the
// signatory and the attestation are given; the client sends them as a form.
// Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { contractsApi } from '../src/lib/api.js';
import AttachEvidence from '../src/pages/admin/contracts/AttachEvidence.jsx';
import { installDocument, mountContracts } from './_contracts_dom.mjs';

const originals = { ...contractsApi };
const restore = () => Object.assign(contractsApi, originals);
const row = { uid: 'doc-bare', source: 'documents', title: 'Co-founder Agreement', status: 'signed' };

test('mounted: nothing is sent until every field is given; then the evidence is attached and named', async () => {
  const calls = [];
  contractsApi.attachEvidence = async (uid, form) => { calls.push([uid, { ...form, file: form.file?.name }]); return { evidence: { file_sha256: 'ab' + '0'.repeat(60) + 'cd', signed_on: '2026-10-02', signatory: 'A. Founder, CEO' } }; };
  let attached = 0;
  const view = await mountContracts(React.createElement(AttachEvidence, { row, onClose() {}, onAttached: () => { attached += 1; } }));
  try {
    await view.click('Attach evidence');
    assert.match(view.text(), /Choose the signed PDF\./);
    const file = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'file');
    await act(async () => { view.props(file).onChange({ target: { files: [{ name: 'signed.docx', size: 10 }] } }); });
    await view.click('Attach evidence');
    assert.match(view.text(), /The signed copy must be a PDF\./);
    await act(async () => { view.props(file).onChange({ target: { files: [{ name: 'signed.pdf', size: 10 }] } }); });
    await view.click('Attach evidence');
    assert.match(view.text(), /Give the date the copy was signed\./);
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'date')).onChange({ target: { value: '2026-10-02' } }); });
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.maxLength === 200)).onChange({ target: { value: 'A. Founder, CEO' } }); });
    await view.click('Attach evidence');
    assert.match(view.text(), /Confirm this is the complete, fully signed copy\./);
    assert.equal(calls.length, 0, 'nothing is sent while a field is missing');
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox')).onChange({ target: { checked: true } }); });
    await view.click('Attach evidence');
    await view.flush();
    assert.deepEqual(calls, [['doc-bare', { file: 'signed.pdf', signed_on: '2026-10-02', signatory: 'A. Founder, CEO', attest: true }]]);
    assert.match(view.text(), /Attached\. The signed copy \(sha ab00…00cd\) is this agreement's execution evidence, signed 2026-10-02 by A\. Founder, CEO\./);
    await view.click('Close');
    assert.equal(attached, 1, 'the desk re-reads after an attachment');
  } finally { await view.unmount(); restore(); }
});

test('the client sends the PDF and its facts as a form, the attestation only when given', async () => {
  const undo = installDocument();
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push([String(url), init.body]); return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const file = new File(['%PDF'], 'signed.pdf');
    await originals.attachEvidence('doc-bare', { file, signed_on: '2026-10-02', signatory: 'A', attest: true });
    await originals.attachEvidence('doc-bare', { file, signed_on: '2026-10-02', signatory: 'A', attest: false });
    assert.match(sent[0][0], /\/api\/admin\/contracts\/doc-bare\/evidence$/);
    assert.deepEqual([...sent[0][1].keys()], ['file', 'signed_on', 'signatory', 'attest']);
    assert.deepEqual([...sent[1][1].keys()], ['file', 'signed_on', 'signatory']);
  } finally { globalThis.fetch = realFetch; undo(); }
});
