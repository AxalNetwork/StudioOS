// D4811 (#4811) part 6 — the high-risk governance moves (boards CT-12, CT-16):
// Scope → Review → Result. A version that is not a signed copy is refused
// inline; the reason shows its problem only after Continue; the confirm button
// stays disabled until the exact word is typed; the Result says what the
// Worker said. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { adminGovernanceApi } from '../src/lib/api/adminGovernance.js';
import HighRiskMove, { MOVE_WORD, reviewRows, scopeProblem } from '../src/pages/admin/contracts/HighRiskMove.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...adminGovernanceApi };
const restore = () => Object.assign(adminGovernanceApi, originals);
const doc = (o = {}) => ({ uid: 'g1', title: 'GP consent', status: 'approved', envelope_id: null, ...o });
const versions = [{ version: 2, signed: false }, { version: 1, signed: true }];
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));

test('the rules: evidence named, the reason bounded, each move its own word, the review in plain words', () => {
  assert.deepEqual(MOVE_WORD, { executed: 'EXECUTED', archived: 'ARCHIVE' });
  const ok = { evidence: { kind: 'version', version: 1 }, reason: 'Signed at the board.' };
  assert.equal(scopeProblem('executed', ok, versions, doc()), null);
  assert.match(scopeProblem('executed', { ...ok, evidence: { kind: 'version', version: 2 } }, versions, doc()), /v2 was not uploaded as the signed copy/);
  assert.match(scopeProblem('executed', { ...ok, evidence: null }, versions, doc()), /Choose the execution evidence/);
  assert.match(scopeProblem('executed', { ...ok, evidence: { kind: 'envelope' } }, versions, doc()), /No envelope is linked/);
  assert.equal(scopeProblem('executed', { ...ok, evidence: { kind: 'envelope' } }, versions, doc({ envelope_id: 40 })), null);
  assert.match(scopeProblem('archived', { reason: 'short' }, versions, doc()), /at least 10 characters/);
  assert.equal(scopeProblem('archived', { reason: 'Superseded by the A&R.' }, versions, doc()), null, 'archive needs no evidence');
  const rows = reviewRows('executed', doc(), { kind: 'version', version: 1 });
  assert.deepEqual(rows.map(([k]) => k), ['What changes', 'Who is told', 'What is recorded']);
  assert.match(rows[0][1], /v1 \(signed copy\) as the version in force/);
  assert.match(rows[1][1], /No one is notified/);
  assert.match(reviewRows('archived', doc(), null)[2][1], /the reason, in the record's audit trail/);
});

test('mounted: a draft version is refused inline; Continue checks the reason; the word unlocks the button; the Result reads the Worker', async () => {
  const calls = [];
  adminGovernanceApi.update = async (...a) => { calls.push(a); return { document: doc({ status: 'archived' }) }; };
  let closed = 0, done = 0;
  const view = await mountContracts(React.createElement(HighRiskMove, { to: 'executed', document: doc(), versions, onClose: () => { closed += 1; }, onDone: () => { done += 1; } }), '/admin/contracts/governance');
  try {
    await view.flush();
    assert.match(view.text(), /High-risk action/);
    const select = view.nodes().find((n) => n.tagName === 'SELECT');
    assert.equal(view.props(select).value, 1, 'the signed copy is chosen first');
    await act(async () => { view.props(select).onChange({ target: { value: '2' } }); });
    assert.match(view.text(), /v2 was not uploaded as the signed copy/, 'a draft version is refused inline (CT-12B)');
    const cont = () => view.nodes().find((n) => n.tagName === 'BUTTON' && walk(n) === 'Continue');
    assert.equal(view.props(cont()).disabled, true);
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'SELECT')).onChange({ target: { value: '1' } }); });
    assert.doesNotMatch(view.text(), /Say why/, 'the reason is not scolded before Continue');
    await view.click('Continue');
    assert.match(view.text(), /Say why, in at least 10 characters/);
    assert.match(view.text(), /1\. Scope/);
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'TEXTAREA')).onChange({ target: { value: 'Signed at the board meeting.' } }); });
    await view.click('Continue');
    const confirm = () => view.nodes().find((n) => n.tagName === 'BUTTON' && walk(n) === 'Mark executed');
    assert.equal(view.props(confirm()).disabled, true, 'nothing can be sent before the word is typed');
    const word = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.autoComplete === 'off');
    await act(async () => { view.props(word).onChange({ target: { value: 'executed' } }); });
    assert.equal(view.props(confirm()).disabled, true, 'the word is exact');
    await act(async () => { view.props(word).onChange({ target: { value: 'EXECUTED' } }); });
    await act(async () => { view.props(confirm()).onClick({}); });
    await view.flush();
    assert.deepEqual(calls.at(-1), ['g1', { status: 'executed', reason: 'Signed at the board meeting.', confirm: 'EXECUTED', evidence: { kind: 'version', version: 1 } }]);
    assert.match(view.text(), /“GP consent” is executed\./);
    assert.equal(done, 0, 'the record reloads only when the result is closed');
    await view.click('Close');
    assert.deepEqual([done, closed], [1, 1]);
  } finally { await view.unmount(); restore(); }
});

test('archive: no evidence asked; a refusal is shown as the Worker wrote it, with a way back', async () => {
  adminGovernanceApi.update = async () => { throw Object.assign(new Error('Type ARCHIVE to confirm. Nothing was saved.'), { status: 422 }); };
  const view = await mountContracts(React.createElement(HighRiskMove, { to: 'archived', document: doc(), versions, onClose() {}, onDone() {} }), '/admin/contracts/governance');
  try {
    await view.flush();
    assert.doesNotMatch(view.text(), /Execution evidence/);
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'TEXTAREA')).onChange({ target: { value: 'Superseded by the A&R version.' } }); });
    await view.click('Continue');
    await act(async () => { view.props(view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.autoComplete === 'off')).onChange({ target: { value: 'ARCHIVE' } }); });
    await view.click('Archive');
    await view.flush();
    assert.match(view.text(), /Type ARCHIVE to confirm\. Nothing was saved\./);
    assert.ok(view.nodes().some((n) => n.tagName === 'BUTTON' && walk(n) === 'Back to the form'));
  } finally { await view.unmount(); restore(); }
});
