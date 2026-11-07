// D4670 (#4670) — Expertise › Proof and the attester's page: the link comes
// from the list (a refresh keeps it), the attester sees the exact claim and
// answers only with an emailed code, and every failure is a fixed sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import ProofZone from '../src/pages/advisor/expertise/ProofZone.jsx';
import AttestConsentPage, { ATTEST_REFUSALS } from '../src/pages/AttestConsentPage.jsx';
import { ASK_REFUSALS, refusalText } from '../src/pages/advisor/expertise/kit.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api };
const never = () => new Promise(() => {});
function stub(answers) {
  const calls = [];
  for (const k of Object.keys(originals)) if (typeof originals[k] === 'function') api[k] = (...a) => { calls.push([k, a]); return (answers[k] || never)(...a); };
  return calls;
}
const restore = () => Object.assign(api, originals);
const refused = (code, message = 'raw worker text that must not be printed') => Promise.reject(Object.assign(new Error(message), { code }));
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
async function press(view, label) {
  const node = view.nodes().find((n) => n.tagName === 'BUTTON' && walk(n).trim() === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  await act(async () => { view.props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
}
async function type(view, labelStart, value) {
  const label = view.nodes().find((n) => n.tagName === 'LABEL' && walk(n).trim().startsWith(labelStart));
  const field = label && view.nodes().filter((n) => ['INPUT', 'TEXTAREA'].includes(n.tagName)).find((n) => { for (let p = n.parentNode; p; p = p.parentNode) if (p === label) return true; return false; });
  if (!field) throw new Error(`Missing field: ${labelStart}`);
  await act(async () => { view.props(field).onChange({ target: { value, checked: value } }); });
}

const claim = (consents) => ({ id: 7, uid: 'p7', kind: 'engagement', title: 'Led the payments rebuild', organization: 'Acme', period_note: '2024', detail: null, attested: consents.some((c) => c.state === 'confirmed'), status: 'self_stated', consents });
const pending = { id: 1, uid: 'c1', attester_name: 'Sam', state: 'pending', consent_given: false, withdrawn_at: null, invite_token: 'tok-123' };

test('the link is drawn from the list, so it survives a reload of the zone', async () => {
  stub({ listMyAdvisorProof: async () => ({ items: [claim([pending])] }) });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    assert.match(view.text(), /For Sam/);
    assert.match(view.text(), /\/attest\/tok-123/);
    assert.match(view.text(), /the link alone cannot confirm anything/);
    assert.doesNotMatch(view.text(), /shown once|will not be shown again/i);
  } finally { await view.unmount(); restore(); }
});

test('an earlier confirmation that needs reconfirming says so, and does not read as confirmed', async () => {
  stub({ listMyAdvisorProof: async () => ({ items: [claim([{ id: 2, uid: 'c2', attester_name: 'Old', state: 'needs_reconfirmation', consent_given: false, withdrawn_at: null, invite_token: null }])] }) });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    assert.match(view.text(), /Old: Confirmed before verification, or about an earlier wording: ask again/);
    assert.match(view.text(), /Self-stated/);
    assert.doesNotMatch(view.text(), /Confirmed by Old/);
  } finally { await view.unmount(); restore(); }
});

test('asking needs their email, and a refusal is a fixed sentence keyed on its code', async () => {
  const calls = stub({ listMyAdvisorProof: async () => ({ items: [claim([])] }), requestAdvisorProofConsent: () => refused('attester_is_requester') });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    await press(view, 'Ask someone to confirm');
    await type(view, 'Who confirms this', 'Sam');
    const form = view.nodes().find((n) => n.tagName === 'FORM' && /Record the ask/.test(walk(n)));
    await act(async () => { view.props(form).onSubmit({ preventDefault() {} }); });
    assert.ok(view.text().includes(ASK_REFUSALS.attester_email_required), 'the fixed sentence for a missing address');
    assert.equal(calls.filter(([k]) => k === 'requestAdvisorProofConsent').length, 0, 'nothing is sent without an address');
    await type(view, 'Their email', 'me@example.com');
    await act(async () => { view.props(form).onSubmit({ preventDefault() {} }); });
    await view.flush();
    assert.equal(calls.filter(([k]) => k === 'requestAdvisorProofConsent').at(-1)[1][1].attester_email, 'me@example.com');
    assert.match(view.text(), /That address is your own\. Someone else confirms your claim\./);
    assert.doesNotMatch(view.text(), /raw worker text/);
  } finally { await view.unmount(); restore(); }
  assert.equal(refusalText({ code: 'something_else', message: 'leak' }, 'Fixed.'), 'Fixed.');
});

function mountAttest() {
  return mountContracts(React.createElement(Routes, null, React.createElement(Route, { path: '/attest/:token', element: React.createElement(AttestConsentPage) })), '/attest/tok-123');
}
const attestRead = (o = {}) => ({ advisor_name: 'Ada', attester_name: 'Sam', email_hint: 's***@example.com', claim: { kind: 'engagement', title: 'Led the payments rebuild', organization: 'Acme', period_note: '2024', detail: 'Rebuilt it.' }, claim_sha256: 'abc', claim_changed: false, state: 'pending', statement: null, history: [{ kind: 'asked', created_at: '2026-11-06T10:00:00Z' }], ...o });

test('the attester sees the exact claim and answers only with the emailed code', async () => {
  const calls = stub({
    getAdvisorProofConsentClaim: async () => attestRead(),
    requestAdvisorProofConsentCode: async () => ({ sent: true, email_hint: 's***@example.com' }),
    respondToAdvisorProofConsent: () => refused('code_wrong'),
  });
  const view = await mountAttest();
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Ada asked you to confirm this/);
    assert.match(text, /Led the payments rebuild/);
    assert.match(text, /Acme · 2024/);
    assert.match(text, /Rebuilt it\./);
    assert.match(text, /we email a six-digit code to s\*\*\*@example\.com/);
    const confirm = view.nodes().find((n) => n.tagName === 'BUTTON' && walk(n).trim() === 'Confirm');
    assert.equal(view.props(confirm).disabled, true, 'no code, no answer');
    await press(view, 'Email me a code'); await view.flush();
    assert.equal(calls.filter(([k]) => k === 'requestAdvisorProofConsentCode').length, 1);
    await type(view, 'Code', '123456');
    const box = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.type === 'checkbox');
    await act(async () => { view.props(box).onChange({ target: { checked: true } }); });
    await press(view, 'Confirm'); await view.flush();
    const sent = calls.filter(([k]) => k === 'respondToAdvisorProofConsent').at(-1)[1][1];
    assert.deepEqual([sent.code, sent.claim_sha256], ['123456', 'abc'], 'the code and the claim it was shown travel with the answer');
    assert.ok(view.text().includes(ATTEST_REFUSALS.code_wrong), 'the fixed sentence for a wrong code');
    assert.doesNotMatch(view.text(), /raw worker text/);
  } finally { await view.unmount(); restore(); }
});

test('a changed claim cannot be confirmed, and a confirmed one offers withdrawal with the history shown', async () => {
  stub({ getAdvisorProofConsentClaim: async () => attestRead({ claim_changed: true }) });
  let view = await mountAttest();
  try {
    await view.flush();
    assert.match(view.text(), /changed this claim since asking you/);
    assert.equal(view.nodes().some((n) => n.tagName === 'BUTTON' && walk(n).trim() === 'Email me a code'), false);
  } finally { await view.unmount(); restore(); }
  stub({ getAdvisorProofConsentClaim: async () => attestRead({ state: 'confirmed', history: [{ kind: 'asked', created_at: 'x' }, { kind: 'confirmed', created_at: 'y' }] }) });
  view = await mountAttest();
  try {
    await view.flush();
    assert.match(view.text(), /You confirmed this/);
    assert.match(view.text(), /Asked · time not recorded.*Confirmed · time not recorded/s);
    assert.ok(view.nodes().some((n) => n.tagName === 'BUTTON' && walk(n).trim() === 'Withdraw my confirmation'));
  } finally { await view.unmount(); restore(); }
  stub({ getAdvisorProofConsentClaim: () => refused('consent_not_found') });
  view = await mountAttest();
  try {
    await view.flush();
    assert.match(view.text(), /This request does not exist, or the claim it was about was removed\./);
  } finally { await view.unmount(); restore(); }
});
