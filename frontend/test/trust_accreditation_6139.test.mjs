/**
 * D6139 part 1 (#6139): accreditation evidence on /trust/me. The five states
 * the issue names (upload, in review, accepted with expiry, sent back with the
 * reason, expired) from GET /trust/accreditation/evidence/mine, the upload
 * itself through the real client over a synthetic fetch, and the honest
 * failure states. Synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { h, mountForm, textOf, propsOf } from './_form_d695.mjs';
import AccreditationEvidence from '../src/pages/trust/AccreditationEvidence.jsx';
import { accreditationState, accreditationUploadOpen, ACCREDITATION_BASES, REQUIREMENTS } from '../src/pages/trust/memberTrustModel.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { onboardingStatus } from '../src/lib/lpCommitmentModel.js';
import FundOnboardingSection from '../src/pages/investor/fund/FundOnboardingSection.jsx';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const FUTURE = '2027-11-27T12:00:00.000Z';
const PAST = '2026-10-01T00:00:00.000Z';
const letter = (status, extra = {}) => ({ id: extra.id || 1, basis: 'cpa_letter', basis_label: 'Letter from a CPA', file_name: 'letter.pdf', uploaded_at: '2026-11-20T10:00:00.000Z', status, reviewed_at: null, expires_at: null, review_reason: null, ...extra });
const read = (status, items = [], expires_at = null) => ({ obligation: { required: true, status, expires_at }, items, retention: { accreditation_months: 12, investor_record_months: null } });

test('the state comes from the requirement and the newest letter, one rule for every reader', () => {
  const key = (r) => accreditationState(r, NOW).key;
  assert.equal(key(read('pending')), 'upload');
  assert.equal(key(read('in_review', [letter('submitted')])), 'in_review');
  assert.equal(key(read('in_review', [letter('in_review')])), 'in_review');
  assert.equal(key(read('satisfied', [letter('accepted', { expires_at: FUTURE })], FUTURE)), 'accepted');
  assert.equal(key(read('pending', [letter('sent_back', { review_reason: 'Not signed.' })])), 'sent_back');
  assert.equal(key(read('expired', [letter('expired', { expires_at: PAST })], PAST)), 'expired');
  // The nightly sweep has not run yet: satisfied but past its date is expired, not accepted.
  assert.equal(key(read('satisfied', [letter('expired', { expires_at: PAST })], PAST)), 'expired');
  assert.equal(key(read('waived')), 'not_asked');
  assert.equal(key({ obligation: null, items: [] }), 'not_asked');
  assert.equal(key({ obligation: { required: false, status: 'pending' }, items: [] }), 'not_asked');
  // A renewal: in review while the period runs keeps the period; sent back keeps it too, with the reason.
  const renewal = accreditationState(read('satisfied', [letter('submitted', { id: 2 }), letter('accepted', { expires_at: FUTURE })], FUTURE), NOW);
  assert.deepEqual([renewal.key, renewal.expiresAt, renewal.letter.id], ['in_review', FUTURE, 2]);
  const back = accreditationState(read('satisfied', [letter('sent_back', { id: 2, review_reason: 'Dated last year.' }), letter('accepted', { expires_at: FUTURE })], FUTURE), NOW);
  assert.deepEqual([back.key, back.sentBack?.review_reason], ['accepted', 'Dated last year.']);
  // Upload is offered everywhere except while a letter is with the fund team.
  assert.deepEqual(['upload', 'in_review', 'accepted', 'sent_back', 'expired', 'not_asked'].map((k) => accreditationUploadOpen({ key: k })), [true, false, true, true, true, false]);
  assert.deepEqual(ACCREDITATION_BASES.map(([v]) => v), ['cpa_letter', 'attorney_letter', 'broker_dealer_letter', 'registered_adviser_letter']);
  assert.equal(REQUIREMENTS.accreditation_v1[3], '/trust/me?tab=verifications', 'the requirement action leads to the upload, not the Help Center');
});

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function mounted(mine, { onUpload } = {}) {
  const original = globalThis.fetch; const calls = [];
  let current = mine;
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url, 'https://fixture.example.test').pathname; const method = init.method || 'GET';
    calls.push([method, p, init.body]);
    if (p === '/api/trust/accreditation/evidence/mine') return typeof current === 'number' ? response({ error: 'synthetic' }, current) : response(current);
    if (p === '/api/trust/accreditation/evidence' && method === 'POST') { const out = onUpload ? onUpload(init.body) : { status: 201, body: {} }; if (out.next) current = out.next; return response(out.body, out.status); }
    return response({});
  };
  let changed = 0;
  try {
    const v = await mountForm(h(AccreditationEvidence, { onChanged: () => { changed += 1; } }));
    await v.flush();
    return { ...v, calls, changed: () => changed, async unmount() { await v.unmount(); globalThis.fetch = original; } };
  } catch (e) { globalThis.fetch = original; throw e; }
}
const stateOf = (v) => propsOf(v.by('accreditation-evidence'))['data-state'];
const hasForm = (v) => Boolean(v.by('accreditation-upload'));

test('each of the five states shows on the page, with its date, period or reason', async () => {
  const cases = [
    [read('pending'), 'upload', /No letter on file/, true],
    [read('in_review', [letter('in_review')]), 'in_review', /In review.*uploaded on 20 Nov 2026.*checking it/s, false],
    [read('satisfied', [letter('accepted', { reviewed_at: '2026-11-25T00:00:00.000Z', expires_at: '2099-11-25T00:00:00.000Z' })], '2099-11-25T00:00:00.000Z'), 'accepted', /Accepted until 25 Nov 2099.*accepted on 25 Nov 2026/s, true],
    [read('pending', [letter('sent_back', { reviewed_at: '2026-11-26T00:00:00.000Z', review_reason: 'The letter is not signed.' })]), 'sent_back', /Sent back.*26 Nov 2026: The letter is not signed\./s, true],
    [read('expired', [letter('expired', { expires_at: PAST })], PAST), 'expired', /Expired.*ended on 1 Oct 2026/s, true],
  ];
  for (const [mine, key, words, form] of cases) {
    const v = await mounted(mine);
    try {
      assert.equal(stateOf(v), key);
      assert.match(v.text(), words, key);
      assert.equal(hasForm(v), form, `${key}: upload offered`);
      assert.match(v.text(), /12-month accreditation period plus the platform’s investor-record retention period, which is not set yet/);
      if (mine.items.length) assert.match(v.text(), /Your letters.*Letter from a CPA.*Uploaded 20 Nov 2026/s);
      assert.doesNotMatch(v.text(), /accreditation-evidence\//);
    } finally { await v.unmount(); }
  }
});

test('the upload sends who wrote the letter and the file, then reads again and refreshes the page', async () => {
  // Mutation checked: the basis check dropped → a POST is sent without one.
  let sent = null;
  const v = await mounted(read('pending'), { onUpload: (fd) => { sent = fd; return { status: 201, body: { item: letter('submitted') }, next: read('in_review', [letter('submitted')]) }; } });
  try {
    const select = v.nodes().find((n) => n.tagName === 'SELECT');
    const input = v.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).type === 'file');
    assert.equal(propsOf(input).accept, 'application/pdf,image/png,image/jpeg');
    await v.submit();
    assert.match(v.text(), /Choose who wrote the letter/);
    assert.equal(sent, null, 'nothing is sent without a basis');
    await import('react').then(({ act }) => act(async () => propsOf(select).onChange({ target: { value: 'attorney_letter' } })));
    await v.submit();
    assert.match(v.text(), /Choose the letter to upload/);
    const file = new File([new TextEncoder().encode('%PDF-1.7')], 'letter.pdf', { type: 'application/pdf' });
    await import('react').then(({ act }) => act(async () => propsOf(input).onChange({ target: { files: [file] } })));
    await v.submit(); await v.flush();
    assert.ok(sent instanceof FormData);
    assert.equal(sent.get('basis'), 'attorney_letter');
    assert.equal(sent.get('file').name, 'letter.pdf');
    assert.equal(stateOf(v), 'in_review');
    assert.equal(hasForm(v), false, 'no second upload while one is in review');
    assert.equal(v.changed(), 1, 'the page re-reads its requirements');
  } finally { await v.unmount(); }
});

test('a refused upload says the Worker\'s sentence and keeps the state', async () => {
  const v = await mounted(read('pending'), { onUpload: () => ({ status: 415, body: { error: 'letter_type', message: 'Upload the letter as a PDF, PNG or JPEG file.', detail: 'Upload the letter as a PDF, PNG or JPEG file.' } }) });
  try {
    const select = v.nodes().find((n) => n.tagName === 'SELECT');
    const input = v.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).type === 'file');
    const { act } = await import('react');
    await act(async () => propsOf(select).onChange({ target: { value: 'cpa_letter' } }));
    await act(async () => propsOf(input).onChange({ target: { files: [new File(['x'], 'x.gif', { type: 'image/gif' })] } }));
    await v.submit(); await v.flush();
    assert.match(v.text(), /Upload the letter as a PDF, PNG or JPEG file\./);
    assert.equal(stateOf(v), 'upload');
    assert.equal(v.changed(), 0);
  } finally { await v.unmount(); }
});

test('a failed or malformed read is Unreadable, never "no letter on file"', async () => {
  for (const mine of [503, {}]) {
    const v = await mounted(mine);
    try {
      assert.match(textOf(v.by('accreditation-evidence')), /Unreadable\. Your accreditation letters could not be read/);
      assert.doesNotMatch(v.text(), /No letter on file/);
      assert.equal(hasForm(v), false);
    } finally { await v.unmount(); }
  }
});

// ── The LP workspace's onboarding row reads the same state ─────────────────

const lpCtx = (accreditation, application = { accredited: 1 }) => ({ kyc: { loaded: true }, application, applicationLoaded: true, holdings: [], accreditation });
const loaded = (r) => ({ loaded: true, state: accreditationState(r, NOW) });

test('the LP onboarding row shows the letter\'s state once one is on record, and self-certification before', () => {
  // Mutation checked: accreditationRowStatus returning null for `accepted` → the row reads self-certified.
  assert.deepEqual(onboardingStatus('Accredited status', lpCtx(loaded(read('satisfied', [letter('accepted', { expires_at: '2099-11-25T00:00:00.000Z' })], '2099-11-25T00:00:00.000Z')))), ['green', 'Verified until 25 Nov 2099']);
  assert.deepEqual(onboardingStatus('Accredited status', lpCtx(loaded(read('in_review', [letter('submitted')])))), ['amber', 'Letter in review']);
  assert.deepEqual(onboardingStatus('Accredited status', lpCtx(loaded(read('pending', [letter('sent_back', { review_reason: 'x' })])))), ['amber', 'Letter sent back · upload in Trust']);
  assert.deepEqual(onboardingStatus('Accredited status', lpCtx(loaded(read('expired', [letter('expired', { expires_at: PAST })], PAST)))), ['amber', 'Expired · upload in Trust']);
  // No letter, or a failed read: the application's self-certification, never "verified".
  for (const acc of [loaded(read('pending')), { loaded: false, state: null }, undefined]) {
    assert.deepEqual(onboardingStatus('Accredited status', lpCtx(acc)), ['amber', 'Self-certified, not verified']);
  }
});

test('the LP workspace stops saying "not verified here" once a letter is on record', () => {
  const html = (accreditation) => renderToStaticMarkup(React.createElement(FundOnboardingSection, { kyc: { loaded: true }, application: { accredited: 1 }, applicationLoaded: true, portal: null, accreditation }));
  assert.match(html(loaded(read('pending'))), /not verified here/);
  const withLetter = html(loaded(read('in_review', [letter('submitted')])));
  assert.doesNotMatch(withLetter, /not verified here/);
  assert.match(withLetter, /verified from the letter you uploaded in Trust/);
  assert.match(withLetter, /Letter in review/);
  assert.match(html({ loaded: false, state: null }), /could not be read just now/);
  assert.doesNotMatch(html({ loaded: false, state: null }), /not verified here/);
  const page = readFileSync('frontend/src/pages/SpinoutLabLpWorkspacePage.jsx', 'utf8');
  assert.match(page, /trustAccreditationApi\.mine\(\)/);
  assert.match(page, /accreditation=\{accreditation\}/);
});
