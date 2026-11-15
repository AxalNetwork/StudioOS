/**
 * D5920 (#5920, board L08 of Licences v2) — a territory licence's Agreement block leads with the executed agreement,
 * keeps the draft, the one sent for signature and the executed agreement as separate states, and lists every
 * version. The contract read is stubbed; every licence, template and envelope is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_agreement_lifecycle_5920.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { api } from '../src/lib/api.js';
import { ContractStep } from '../src/pages/admin/licences/ContractStep.jsx';
import {
  NOT_INSTRUMENTED, currentContract, executedAgreement, stageCards, versionRows, versionState,
} from '../src/pages/admin/licences/agreementLifecycleModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const k = (o) => ({
  uid: o.uid, template_slug: 'subsidiary-licence', template_version: 7, template_title: 'Subsidiary Licence Agreement',
  body_sha256: '9c41aa00bb11cc22dd33', unfilled_fields: [], status: 'draft', envelope_uid: null, superseded_at: null,
  created_at: '2026-01-01T10:00:00Z', sent_at: null, signed_at: null, countersignature: { recorded: false, reason: 'Not recorded.' }, ...o,
});
// v1 executed then superseded by v2, executed; v3 re-issued (supersedes v2) and still a draft.
const V1 = k({ uid: 'c1', status: 'signed', created_at: '2026-01-05T10:00:00Z', sent_at: '2026-01-06T10:00:00Z', signed_at: '2026-01-08T10:00:00Z', envelope_uid: 'env-1', superseded_at: '2026-02-01T10:00:00Z' });
const V2 = k({ uid: 'c2', status: 'signed', created_at: '2026-02-01T10:00:00Z', sent_at: '2026-02-20T10:00:00Z', signed_at: '2026-03-02T10:00:00Z', envelope_uid: 'env-2', superseded_at: '2026-11-03T10:00:00Z' });
const V3 = k({ uid: 'c3', status: 'draft', created_at: '2026-11-03T10:00:00Z', unfilled_fields: ['governing_law', 'signatory_title'] });

/* ── the model ─────────────────────────────────────────────────────────────── */

test('the executed agreement is the newest executed contract, even after a re-issue superseded it', () => {
  const all = [V3, V2, V1];
  assert.equal(executedAgreement(all).uid, 'c2');
  assert.equal(executedAgreement(all).agreement_version, 2);
  assert.equal(currentContract(all).uid, 'c3');
  assert.deepEqual(versionRows(all).map((r) => `${r.version} ${r.state} ${r.date}`), [
    'v3 Draft Instantiated 3 Nov 2026', 'v2 Executed Executed 2 Mar 2026', 'v1 Superseded Executed 8 Jan 2026',
  ]);
  assert.equal(executedAgreement([V3]), null);
  assert.equal(executedAgreement([]), null);
});

test('draft, sent for signature and executed are separate states, and Ledger terms is Not instrumented', () => {
  assert.deepEqual(stageCards([V3, V2, V1]).map((c) => [c.label, c.state, c.line]), [
    ['Ledger terms', NOT_INSTRUMENTED, 'No read compares the ledger terms with an agreement.'],
    ['Draft agreement', 'Draft', 'v3 · 2 fields missing'],
    ['Sent for signature', 'None', 'Nothing is out for signature.'],
    ['Executed', 'Executed', 'v2 · 2 Mar 2026'],
  ]);
  const sent = k({ uid: 's1', status: 'sent', sent_at: '2026-11-04T09:00:00Z', envelope_uid: 'env-s' });
  assert.deepEqual(stageCards([sent]).map((c) => c.state), [NOT_INSTRUMENTED, 'None', 'Sent for signature', 'None']);
  // A superseded draft is history, not an open draft.
  assert.equal(stageCards([k({ uid: 'd0', superseded_at: '2026-02-01T00:00:00Z' })])[1].state, 'None');
  assert.equal(versionState(k({ uid: 'v', status: 'void' }), null), 'Void');
  // A draft or a sent contract that a re-issue replaced before execution is Superseded; a current sent one is out for signature.
  assert.equal(versionState(k({ uid: 'd1', superseded_at: '2026-02-01T00:00:00Z' }), null), 'Superseded');
  assert.equal(versionState(k({ uid: 's2', status: 'sent', superseded_at: '2026-02-01T00:00:00Z' }), null), 'Superseded');
  assert.equal(versionState(sent, null), 'Sent for signature');
  assert.deepEqual(versionRows([sent]).map((r) => r.state), ['Sent for signature']);
  assert.equal(stageCards([k({ uid: 'one', unfilled_fields: ['x'] })])[1].line, 'v1 · 1 field missing');
  assert.equal(stageCards([k({ uid: 'ok' })])[1].line, 'v1 · ready to send');
});

/* ── the block ─────────────────────────────────────────────────────────────── */

const original = { ...api };
const restore = () => Object.assign(api, original);
const licence = { uid: 'lic_1' };
const answer = (contracts, o = {}) => ({ licence_uid: 'lic_1', contracts, contracts_available: true, templates: [{ slug: 'subsidiary-licence', title: 'Subsidiary Licence Agreement', version: 7 }], ...o });

test('L08: the executed agreement leads, with its version and dates, then the stages, then the versions', async (t) => {
  t.after(restore);
  api.licenceContract = async () => answer([V3, V2, V1]);
  const page = await mountContracts(React.createElement(ContractStep, { licence }), '/admin/licences/lic_1/agreement');
  t.after(() => page.unmount());
  await page.flush();
  const text = page.text();
  assert.match(text, /Current agreementSubsidiary Licence Agreement · Agreement v2Executed 2 Mar 2026View agreement ›Template subsidiary-licence v7 · fingerprint 9c41aa00bb11 · sent 2026-02-20/);
  assert.match(text, /Whether the current terms differ from the executed agreement: Not instrumented/);
  assert.match(text, /Ledger termsNot instrumented.*Draft agreementDraftv3 · 2 fields missingSent for signatureNoneNothing is out for signature\.ExecutedExecutedv2 · 2 Mar 2026/);
  assert.match(text, /Versions.*v3DraftInstantiated 3 Nov 2026subsidiary-licence v7v2ExecutedExecuted 2 Mar 2026subsidiary-licence v7v1SupersededExecuted 8 Jan 2026/);
  // The open draft's own block keeps its controls and reads its state in words.
  assert.match(text, /v3 · Draft/);
  const lead = text.slice(0, text.indexOf('Ledger terms'));
  assert.ok(lead.indexOf('Agreement v2') < lead.indexOf('Whether the current terms'), 'the executed agreement leads the block');
  assert.doesNotMatch(text, /\bsigned\b|\bSigned\b/);
});

test('none executed reads None; a failed read is Unreadable with Try again, which reads again', async (t) => {
  t.after(restore);
  api.licenceContract = async () => answer([]);
  const none = await mountContracts(React.createElement(ContractStep, { licence }), '/x');
  await none.flush();
  assert.match(none.text(), /Current agreementNone\. No agreement has been executed for this licence\./);
  assert.match(none.text(), /ExecutedNoneNo agreement has been executed\./);
  await none.unmount();

  let calls = 0;
  api.licenceContract = async () => { calls += 1; if (calls === 1) throw Object.assign(new Error('down'), { status: 503 }); return answer([V2]); };
  const page = await mountContracts(React.createElement(ContractStep, { licence }), '/x');
  t.after(() => page.unmount());
  await page.flush();
  assert.match(page.text(), /Unreadable\. This licence’s agreements could not be read\. This is not a claim that none exists\./);
  assert.doesNotMatch(page.text(), /None\. No agreement has been executed/);
  await page.click('Try again');
  await page.flush();
  assert.equal(calls, 2);
  assert.match(page.text(), /Agreement v1Executed 2 Mar 2026/);
});

test('an unreadable contracts store is Unreadable too, never None', async (t) => {
  t.after(restore);
  api.licenceContract = async () => answer([], { contracts_available: false, contracts_reason: 'The licence_contracts table could not be read on this database (migration 259).' });
  const page = await mountContracts(React.createElement(ContractStep, { licence }), '/x');
  t.after(() => page.unmount());
  await page.flush();
  assert.match(page.text(), /Unreadable\. The licence_contracts table could not be read/);
  assert.doesNotMatch(page.text(), /No agreement has been executed/);
});

test('the block is still the Contract step, and #5051\'s blocks are where they were', () => {
  const detail = readFileSync(new URL('../src/pages/admin/licences/LicenceDetail.jsx', import.meta.url), 'utf8');
  assert.match(detail, /\{step === 5 && <ContractStep licence=\{d\} onSaved=\{refresh\} \/>\}/);
  assert.match(detail, /\{step === 5 && <LicenceAgreements licence=\{d\} \/>\}/);
  assert.ok(detail.indexOf('<ContractStep') < detail.indexOf('<LicenceAgreements'));
});
