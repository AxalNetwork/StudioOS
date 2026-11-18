// D4825 (#4825) — Expertise › Proof drawn to EX-08 to EX-10: each card leads
// with one state from the Worker's own, names who was asked or who confirmed,
// dates it and says whether it is public; publishing and cancelling call the
// routes #5315 added, and nothing publishes on its own; the attester's page
// says how they appear, what confirming means, how it is used and how to
// withdraw, and answers with "Confirm this statement" or "I can’t confirm this".
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { advisorProofApi } from '../src/lib/api/advisorProof.js';
import ProofZone from '../src/pages/advisor/expertise/ProofZone.jsx';
import AttestConsentPage from '../src/pages/AttestConsentPage.jsx';
import {
  PROOF_ACTION_REFUSALS, PROOF_CARD_STATES, proofCardState, proofDate, proofPublicLine, proofWhenLine, proofWhoLine,
} from '../src/pages/advisor/expertise/proofModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...api };
const proofOriginals = { ...advisorProofApi };
const never = () => new Promise(() => {});
function stub(answers) {
  const calls = [];
  for (const k of Object.keys(originals)) if (typeof originals[k] === 'function') api[k] = (...a) => { calls.push([k, a]); return (answers[k] || never)(...a); };
  for (const k of Object.keys(proofOriginals)) advisorProofApi[k] = (...a) => { calls.push([k, a]); return (answers[k] || never)(...a); };
  return calls;
}
const restore = () => { Object.assign(api, originals); Object.assign(advisorProofApi, proofOriginals); };
const refused = (code) => Promise.reject(Object.assign(new Error('raw worker text that must not be printed'), { code }));
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
const buttons = (view, label) => view.nodes().filter((n) => n.tagName === 'BUTTON' && walk(n).trim() === label);
async function press(view, label) {
  const node = buttons(view, label)[0];
  if (!node) throw new Error(`Missing button: ${label}`);
  await act(async () => { view.props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
}
const by = (view, id) => view.nodes().find((n) => view.props(n)?.['data-testid'] === id);

const consent = (o) => ({ uid: `c${o.id}`, attester_role: null, requested_at: null, consent_given_at: null, withdrawn_at: null, cancelled_at: null, invite_token: null, statement: null, ...o });
const item = (id, consents, o = {}) => ({ id, uid: `p${id}`, kind: 'engagement', title: `Claim ${id}`, organization: 'Acme', period_note: '2026', detail: null,
  attested: consents.some((c) => c.state === 'confirmed'), published: false, consents, ...o });

const CONFIRMED = consent({ id: 11, attester_name: 'Jane Smith', attester_role: 'Partner, Acme', state: 'confirmed', consent_given_at: '2026-11-09T16:02:00Z', requested_at: '2026-11-07T10:14:00Z' });
const PENDING = consent({ id: 21, attester_name: 'K. Osei', attester_role: 'CEO, Lumen', state: 'pending', requested_at: '2026-11-05T09:00:00Z', invite_token: 'tok-21' });
const STALE = consent({ id: 31, attester_name: 'Old', state: 'needs_reconfirmation', consent_given_at: '2026-03-12T09:00:00Z' });
const DECLINED = consent({ id: 41, attester_name: 'R. Haddad', state: 'declined', withdrawn_at: '2026-11-02T09:00:00Z' });

// ─────────────────────────────────────────────────────────── the model

test('a card leads with one state, in a fixed order, and never says Verified', () => {
  // Mutation checked: pending tested before attested → a confirmed claim with
  // a second open ask reads Awaiting; declined folded into self-stated → no Declined.
  assert.equal(proofCardState(item(1, [PENDING, CONFIRMED])).state, 'confirmed');
  assert.equal(proofCardState(item(2, [STALE, PENDING])).state, 'awaiting');
  assert.equal(proofCardState(item(3, [DECLINED, STALE])).state, 'needs_reconfirmation');
  assert.equal(proofCardState(item(4, [DECLINED])).state, 'declined');
  assert.equal(proofCardState(item(5, [consent({ id: 51, attester_name: 'C', state: 'cancelled', cancelled_at: '2026-11-03T00:00:00Z' })])).state, 'self_stated');
  assert.equal(proofCardState(item(6, [])).state, 'self_stated');
  for (const s of Object.values(PROOF_CARD_STATES)) assert.doesNotMatch(s.label, /verif/i);
  assert.equal(PROOF_CARD_STATES.awaiting.label, 'Awaiting confirmation');
});

test('who and when come from the consent the card is about, and a missing date is said, not invented', () => {
  const confirmed = proofCardState(item(1, [CONFIRMED]));
  assert.deepEqual(proofWhoLine(confirmed), { lead: 'Confirmed by', who: 'Jane Smith · Partner, Acme' });
  assert.equal(proofWhenLine(confirmed), 'Confirmed 9 Nov 2026 with an emailed code');
  const asked = proofCardState(item(2, [PENDING]));
  assert.deepEqual(proofWhoLine(asked), { lead: 'Asked', who: 'K. Osei · CEO, Lumen' });
  assert.equal(proofWhenLine(asked), 'Asked 5 Nov 2026 · no answer yet');
  assert.equal(proofWhenLine(proofCardState(item(3, [consent({ id: 9, attester_name: 'X', state: 'pending' })]))), 'Asked · no answer yet');
  assert.equal(proofWhenLine(proofCardState(item(4, [DECLINED]))), 'Declined 2 Nov 2026');
  assert.equal(proofWhoLine(proofCardState(item(5, []))), null);
  assert.equal(proofDate('not a date'), null);
  assert.match(proofPublicLine({ published: true }), /^Public/);
  assert.match(proofPublicLine({ published: false }), /^Private/);
});

// ─────────────────────────────────────────────────────────── EX-08, mounted

test('the list names who confirmed, when, and whether it is public; only confirmed proof offers Publish', async () => {
  const items = [item(1, [CONFIRMED]), item(2, [PENDING]), item(3, [])];
  const calls = stub({
    listMyAdvisorProof: async () => ({ items, counts: { total: 3, attested: 1, awaiting: 1, self_stated: 2 } }),
    setPublication: () => refused('proof_confirmation_required'),
  });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    const card1 = walk(by(view, 'advisor-proof-card-1'));
    assert.match(card1, /Confirmed by Jane Smith · Partner, Acme/);
    assert.match(card1, /Confirmed 9 Nov 2026 with an emailed code/);
    assert.match(card1, /Private: only you see it/);
    const card2 = walk(by(view, 'advisor-proof-card-2'));
    assert.match(card2, /Awaiting confirmation/);
    assert.match(card2, /Asked K\. Osei · CEO, Lumen/);
    assert.match(card2, /Asked 5 Nov 2026 · no answer yet/);
    assert.match(walk(by(view, 'advisor-proof-card-3')), /Self-stated[\s\S]*No one has been asked/);
    assert.doesNotMatch(view.text(), /verified/i, 'nothing on the list says Verified');
    assert.ok(by(view, 'advisor-proof-publish-1'), 'a confirmed claim can be published');
    assert.ok(!by(view, 'advisor-proof-publish-2') && !by(view, 'advisor-proof-publish-3'), 'nothing else can');
    assert.equal(calls.filter(([k]) => k === 'setPublication').length, 0, 'nothing publishes on its own');
    await press(view, 'Publish proof'); await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'setPublication').at(-1)[1], [1, true]);
    assert.ok(view.text().includes(PROOF_ACTION_REFUSALS.proof_confirmation_required), 'the fixed sentence for the refusal');
    assert.doesNotMatch(view.text(), /raw worker text/);
  } finally { await view.unmount(); restore(); }
});

test('a published claim offers Make private, and a pending request can be cancelled', async () => {
  const items = [item(1, [CONFIRMED], { published: true }), item(2, [PENDING])];
  const calls = stub({
    listMyAdvisorProof: async () => ({ items }),
    setPublication: async (id, published) => ({ id, published }),
    cancelConsent: async (id, consentId) => ({ id: consentId, state: 'cancelled' }),
  });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    assert.match(walk(by(view, 'advisor-proof-card-1')), /Public: shown on your profile as confirmed/);
    await press(view, 'Make private'); await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'setPublication').at(-1)[1], [1, false]);
    await act(async () => { view.props(by(view, 'advisor-proof-cancel-21')).onClick({}); }); await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'cancelConsent').at(-1)[1], [2, 21]);
    assert.match(walk(by(view, 'advisor-proof-row-note-2')), /Request to K\. Osei cancelled/);
  } finally { await view.unmount(); restore(); }
});

test('the request flow shows the exact claim the attester will see, and its four steps', async () => {
  stub({ listMyAdvisorProof: async () => ({ items: [item(3, [], { detail: 'Led a team of 14.' })] }) });
  const view = await mountContracts(React.createElement(ProofZone), '/expertise/proof');
  try {
    await view.flush();
    await press(view, 'Ask someone to confirm');
    assert.match(walk(by(view, 'advisor-proof-ask-steps-3')), /✓ Claim.*Attester.*Request.*Confirmation/s);
    const shown = walk(by(view, 'advisor-proof-ask-claim-3'));
    assert.match(shown, /Claim 3/);
    assert.match(shown, /Acme · 2026/);
    assert.match(shown, /Led a team of 14\./);
    assert.match(view.text(), /Nothing is emailed when you create the request/);
  } finally { await view.unmount(); restore(); }
});

// ─────────────────────────────────────────────────────────── EX-10, mounted

function mountAttest() {
  return mountContracts(React.createElement(Routes, null, React.createElement(Route, { path: '/attest/:token', element: React.createElement(AttestConsentPage) })), '/attest/tok-9');
}
const attestRead = (o = {}) => ({ advisor_name: 'Ada', attester_name: 'Sam Example', email_hint: 's***@example.com', claim: { kind: 'role', title: 'VP Sales', organization: 'Nebula', period_note: '2019–2023', detail: null }, claim_sha256: 'abc', claim_changed: false, state: 'pending', statement: null, history: [{ kind: 'asked', created_at: null }], ...o });

test('the attester sees how they appear, what confirming means, how it is used and how to withdraw', async () => {
  const calls = stub({ getAdvisorProofConsentClaim: async () => attestRead(), respondToAdvisorProofConsent: async () => ({}) });
  const view = await mountAttest();
  try {
    await view.flush();
    const terms = walk(by(view, 'attest-terms'));
    assert.match(terms, /You’ll appear as\s*Sam Example/);
    assert.match(terms, /What confirming means\s*You say this statement is true, as written/);
    assert.match(terms, /Kept private to Ada\. Only if they choose to publish it/);
    assert.match(terms, /Withdrawing\s*Any time, from this page, with a new code/);
    assert.doesNotMatch(view.text(), /verified by/i);
    // "I already have a code": no second email for someone holding one.
    await press(view, 'I already have a code');
    assert.equal(calls.filter(([k]) => k === 'requestAdvisorProofConsentCode').length, 0);
    const field = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.autoComplete === 'one-time-code');
    await act(async () => { view.props(field).onChange({ target: { value: '654321' } }); });
    await press(view, 'I can’t confirm this'); await view.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'respondToAdvisorProofConsent').at(-1)[1][1], { code: '654321', consent_given: false });
  } finally { await view.unmount(); restore(); }
});

test('a confirmed attester sees the date and how the advisor sees it, and withdrawing needs a code', async () => {
  const calls = stub({ getAdvisorProofConsentClaim: async () => attestRead({ state: 'confirmed', history: [{ kind: 'asked', created_at: '2026-11-07T10:14:00Z' }, { kind: 'confirmed', created_at: '2026-11-09T16:02:00Z' }] }) });
  const view = await mountAttest();
  try {
    await view.flush();
    assert.match(walk(by(view, 'attest-confirmed')), /You confirmed this on 9 Nov 2026\.Ada sees “Confirmed by Sam Example”\./);
    assert.equal(buttons(view, 'Confirm this statement').length, 0, 'nothing to confirm twice');
    await press(view, 'Withdraw my confirmation…');
    assert.ok(by(view, 'attest-arrive'), 'withdrawing starts with a code, like any answer');
    assert.equal(calls.filter(([k]) => k === 'respondToAdvisorProofConsent').length, 0);
  } finally { await view.unmount(); restore(); }
});
