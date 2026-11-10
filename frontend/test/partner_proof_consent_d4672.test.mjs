// D4672 (#4672) — Offers · Proof from both sides, rendered: the client sees the
// exact revision they are asked about and answers only with an emailed code; a
// closed, superseded or expired request offers nothing that could reopen it; and
// the firm reads every consent state in its own words, never as another.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import PartnerAttestConsentPage, { PARTNER_ATTEST_REFUSALS, PARTNER_CONSENT_STATE_LABELS } from '../src/pages/PartnerAttestConsentPage.jsx';
import ProofZone, { consentState, CONSENT_ROW_PILL } from '../src/pages/partner/offers/ProofZone.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api };
const never = () => new Promise(() => {});
function stub(answers) {
  const calls = [];
  for (const k of Object.keys(originals)) if (typeof originals[k] === 'function') api[k] = (...a) => { calls.push([k, a]); return (answers[k] || never)(...a); };
  return calls;
}
const restore = () => Object.assign(api, originals);
const refused = (code) => Promise.reject(Object.assign(new Error('raw worker text that must not be printed'), { code }));
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
const button = (view, label) => view.nodes().find((n) => n.tagName === 'BUTTON' && walk(n).trim() === label);
async function press(view, label) {
  const node = button(view, label);
  if (!node) throw new Error(`Missing button: ${label}`);
  await act(async () => { view.props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
}
async function type(view, labelStart, value) {
  const label = view.nodes().find((n) => n.tagName === 'LABEL' && walk(n).trim().startsWith(labelStart));
  const field = label && view.nodes().filter((n) => n.tagName === 'INPUT').find((n) => { for (let p = n.parentNode; p; p = p.parentNode) if (p === label) return true; return false; });
  if (!field) throw new Error(`Missing field: ${labelStart}`);
  await act(async () => { view.props(field).onChange({ target: { value, checked: value } }); });
}

const mountPage = () => mountContracts(React.createElement(Routes, null,
  React.createElement(Route, { path: '/attest/partner/:token', element: React.createElement(PartnerAttestConsentPage) })), '/attest/partner/link-1');
const claimRead = (o = {}) => ({
  firm_name: 'Ours Studio', consenter_name: 'Dana', email_hint: 'd***@client.example',
  claim: { kind: 'case_study', title: 'Cut settlement time by half', detail: 'Rebuilt the rails.', outcome_note: '48h → 22h', engagement_id: 701 },
  revision: 2, claim_sha256: 'sha-2', claim_changed: false, state: 'requested', consent_text: null, expires_at: '2026-12-09T00:00:00Z',
  history: [{ kind: 'asked', revision: 2, created_at: '2026-11-09T10:00:00Z' }], ...o,
});

test('the client sees the exact claim and its version, and answers only with the emailed code', async () => {
  const calls = stub({
    getPartnerProofConsentClaim: async () => claimRead(),
    requestPartnerProofConsentCode: async () => ({ sent: true, email_hint: 'd***@client.example' }),
    respondToPartnerProofConsent: async () => ({ state: 'confirmed' }),
  });
  const view = await mountPage();
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Ours Studio asked whether they may show this publicly/);
    assert.match(text, /Case study · version 2/);
    assert.match(text, /Cut settlement time by half/);
    assert.match(text, /48h → 22h/);
    assert.match(text, /we email a six-digit code to d\*\*\*@client\.example/);
    assert.equal(view.props(button(view, 'Yes, they may')).disabled, true, 'no code, no answer');
    await press(view, 'Email me a code'); await view.flush();
    await type(view, 'Code', '123456');
    await type(view, 'I confirm this is accurate', true);
    await press(view, 'Yes, they may'); await view.flush();
    const sent = calls.filter(([k]) => k === 'respondToPartnerProofConsent').at(-1)[1][1];
    assert.equal(sent.code, '123456');
    assert.equal(sent.claim_sha256, 'sha-2', 'the answer does not name the revision the client was shown');
    assert.match(sent.consent_text, /I confirm this is accurate/);
  } finally { await view.unmount(); restore(); }
});

for (const [state, extra] of [['declined', {}], ['withdrawn', {}], ['superseded', { claim_changed: true }], ['expired', {}]]) {
  test(`a ${state} request says so and offers nothing that could reopen it`, async () => {
    const calls = stub({ getPartnerProofConsentClaim: async () => claimRead({ state, ...extra }) });
    const view = await mountPage();
    try {
      await view.flush();
      assert.ok(view.text().includes(PARTNER_CONSENT_STATE_LABELS[state]), `${state} is not worded`);
      for (const label of ['Email me a code', 'Yes, they may', 'No', 'Withdraw my confirmation']) {
        assert.equal(button(view, label), undefined, `${state} still offers "${label}"`);
      }
      assert.equal(calls.filter(([k]) => k === 'requestPartnerProofConsentCode').length, 0);
    } finally { await view.unmount(); restore(); }
  });
}

test('a confirmed client can only withdraw, and a refusal reads as a fixed sentence', async () => {
  stub({
    getPartnerProofConsentClaim: async () => claimRead({ state: 'confirmed' }),
    requestPartnerProofConsentCode: async () => ({ sent: true, email_hint: 'd***@client.example' }),
    respondToPartnerProofConsent: () => refused('code_wrong'),
  });
  const view = await mountPage();
  try {
    await view.flush();
    assert.equal(button(view, 'Yes, they may'), undefined, 'a confirmed request offers to confirm again');
    await type(view, 'Code', '654321');
    await press(view, 'Withdraw my confirmation'); await view.flush();
    assert.ok(view.text().includes(PARTNER_ATTEST_REFUSALS.code_wrong));
    assert.doesNotMatch(view.text(), /raw worker text/);
  } finally { await view.unmount(); restore(); }
});

test('the firm reads every consent state in its own words, and only an open ask hands out its link', async () => {
  const k = (state, o = {}) => ({ id: Math.random(), uid: state, consenter_name: `Who-${state}`, state, revision: 1, consent_given: state === 'confirmed', withdrawn_at: null, invite_token: state === 'requested' ? 'link-open' : null, ...o });
  const item = { id: 7, uid: 'p7', kind: 'case_study', title: 'A result', revision: 2, is_published: false, status: 'self_stated',
    consents: [k('requested'), k('declined', { withdrawn_at: '2026-11-01' }), k('superseded', { consent_given_at: '2026-10-01' }), k('expired')] };
  stub({ listPartnerProof: async () => ({ items: [item], published_count: 0, self_stated_count: 1 }) });
  const view = await mountContracts(React.createElement(ProofZone), '/offers/proof');
  try {
    await view.flush();
    const text = view.text();
    for (const s of ['requested', 'declined', 'superseded', 'expired']) assert.ok(text.includes(CONSENT_ROW_PILL[s].label), `${s} is not worded`);
    assert.match(text, /about an earlier version of the claim/);
    const links = view.nodes().filter((n) => n.tagName === 'INPUT' && /^Link for /.test(view.props(n)['aria-label'] || ''));
    assert.deepEqual(links.map((n) => view.props(n)['aria-label']), ['Link for Who-requested'], 'a closed or stale request handed out a link');
    assert.match(view.props(links[0]).value, /\/attest\/partner\/link-open$/);
    assert.doesNotMatch(text, /Agreed|Not answered/, 'the pre-D4672 words came back');
  } finally { await view.unmount(); restore(); }
});

test('the item-level state: an open ask awaits; asks only about an older version or a lapsed link mean ask again', () => {
  assert.equal(consentState({ consents: [{ state: 'requested' }] }), 'awaiting');
  assert.equal(consentState({ consents: [{ state: 'superseded' }] }), 'ask_again');
  assert.equal(consentState({ consents: [{ state: 'expired' }] }), 'ask_again');
  assert.equal(consentState({ consents: [] }), 'not_asked');
  assert.equal(consentState({ is_published: true, consents: [{ state: 'confirmed' }] }), 'published');
  assert.equal(consentState({ consents: [{ state: 'withdrawn', withdrawn_at: 'x' }, { state: 'requested' }] }), 'withdrawn');
});
