// D4811 (#4811) part 16 — the Legal Review tab (board CT-08): the eleven
// fields of the latest review bound to the reviewed version's hash, the state
// pill (an approval of an older version never reads as current), the request
// form any HQ admin uses, the decision form only the assigned counsel sees,
// and the counsel list only the Super Admin keeps. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { adminLegalReviewsApi } from '../src/lib/api/adminLegalReviews.js';
import LegalReviewPanel from '../src/pages/admin/contracts/LegalReviewPanel.jsx';
import { canDecide, lastReviewLine, reviewBadge, reviewFields, versionBound } from '../src/pages/admin/contracts/legalReviewModel.js';
import { mountContracts } from './_contracts_dom.mjs';

const originals = { ...adminLegalReviewsApi };
const restore = () => Object.assign(adminLegalReviewsApi, originals);
const walk = (x) => (x.nodeType === 3 || !x.childNodes?.length ? x.textContent || '' : x.childNodes.map(walk).join(''));
const SHA = '77c0' + 'e'.repeat(56) + '12de';
const pending = { id: 31, version: 3, version_sha256: SHA, review_type: 'amendment', jurisdiction: 'Delaware, United States', due_on: '2026-11-12',
  reviewer: { id: 3, name: 'R. Okafor', firm: 'Example LLP' }, requested_by: 2, requested_at: '2026-10-29T10:00:00Z', decision: null,
  findings: null, required_changes: null, sources: null, next_review_on: null, decided_by: null, decided_at: null, state: 'pending' };
const approvedOld = { ...pending, id: 20, version: 1, decision: 'approved', decided_at: '2023-04-18T10:00:00Z', review_type: 'pre_execution', state: 'approved_superseded' };
const object = { kind: 'governance', ref: 'g1', title: 'GP OA', version: 3, sha256: SHA };
const counsel = [{ user_id: 3, name: 'R. Okafor', firm: 'Example LLP', email_hint: 'c…@example.test' }];

test('the rules: eleven fields in the canvas\'s order; an older approval is marked as older; only the assigned counsel decides', () => {
  const f = reviewFields(pending);
  assert.deepEqual(f.map(([k]) => k), ['Review status', 'Reviewer', 'Review type', 'Jurisdiction', 'Version reviewed', 'Review date', 'Findings', 'Required changes', 'Source references', 'Next review', 'Approval decision']);
  assert.equal(f[1][1], 'R. Okafor · Example LLP');
  assert.equal(f[4][1], 'v3 · sha 77c0…12de');
  assert.equal(f[5][1], 'Due 12 Nov 2026');
  assert.equal(f[10][1], null, 'not decided: never read as approved');
  assert.match(f[10][2], /Only the assigned counsel/);
  assert.deepEqual(reviewBadge('pending'), { label: 'In counsel review', tone: 'amber' });
  assert.deepEqual(reviewBadge('approved'), { label: 'Counsel approved', tone: 'seal' });
  assert.equal(reviewBadge('approved_superseded').tone, 'muted', 'an approval of an older version is not the seal');
  assert.match(reviewBadge('approved_superseded').label, /older version/);
  assert.equal(lastReviewLine([pending, approvedOld]), 'Counsel approved · v1 · 18 Apr 2023 (an older version)');
  assert.equal(lastReviewLine([pending]), 'In counsel review');
  assert.equal(lastReviewLine([]), null);
  assert.equal(canDecide(pending, { id: 3, counsel: true }), true);
  assert.equal(canDecide(pending, { id: 4, counsel: true }), false, 'another counsel');
  assert.equal(canDecide(pending, { id: 3, counsel: false }), false);
  assert.equal(canDecide({ ...pending, state: 'superseded' }, { id: 3, counsel: true }), false);
  assert.equal(versionBound(null), null);
});

test('mounted, as the assigned counsel: the fields, the earlier review, and the decision form sends what counsel chose', async () => {
  const calls = [];
  adminLegalReviewsApi.list = async () => ({ object, reviews: [pending, approvedOld], counsel, viewer: { id: 3, counsel: true, super_admin: false } });
  adminLegalReviewsApi.decide = async (...a) => { calls.push(a); return { review: { ...pending, decision: 'approved', state: 'approved' } }; };
  const view = await mountContracts(React.createElement(LegalReviewPanel, { kind: 'governance', refId: 'g1' }));
  try {
    await view.flush();
    const text = view.text();
    assert.match(text, /Review LR-31 In counsel review/);
    assert.match(text, /Version reviewedv3 · sha 77c0…12de/);
    assert.match(text, /Previous reviews.*v1 · Pre-execution review · R\. Okafor.*Counsel approved · older version/);
    assert.match(text, /Eadwyn's research in the rail is not approval/);
    assert.equal(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'counsel-list'), false, 'the counsel list is the Super Admin\'s');
    const select = view.nodes().find((n) => n.tagName === 'SELECT' && walk(n.parentNode).startsWith('Decision'));
    await act(async () => { view.props(select).onChange({ target: { value: 'approved_with_conditions' } }); });
    const area = view.nodes().filter((n) => n.tagName === 'TEXTAREA')[1];
    await act(async () => { view.props(area).onChange({ target: { value: '§7.3 must name signatories by office.' } }); });
    await view.click('Record decision');
    await view.flush();
    assert.deepEqual(calls, [[31, { decision: 'approved_with_conditions', findings: '', required_changes: '§7.3 must name signatories by office.', sources: '', next_review_on: '' }]]);
  } finally { await view.unmount(); restore(); }
});

test('mounted, as an HQ admin: no decision form; a request names counsel, type and jurisdiction; the Super Admin keeps counsel', async () => {
  const calls = [];
  let reviews = [pending];
  adminLegalReviewsApi.list = async () => ({ object, reviews, counsel, viewer: { id: 1, counsel: false, super_admin: true } });
  adminLegalReviewsApi.request = async (b) => { calls.push(['request', b]); reviews = [{ ...pending, id: 32 }, ...reviews]; return { review: reviews[0] }; };
  adminLegalReviewsApi.grantCounsel = async (...a) => { calls.push(['grant', a]); return { counsel }; };
  const view = await mountContracts(React.createElement(LegalReviewPanel, { kind: 'template', refId: 'initial_lpa' }));
  try {
    await view.flush();
    assert.equal(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'legal-review-decision'), false);
    assert.match(view.text(), /Only the assigned counsel records the decision\./);
    await view.click('Request legal review');
    assert.match(view.text(), /Review of v3 · sha 77c0…12de\. A newer version will need its own review\./);
    const send = () => view.nodes().find((n) => n.tagName === 'BUTTON' && walk(n) === 'Request review');
    assert.equal(view.props(send()).disabled, true, 'nothing is sent until counsel, type and jurisdiction are given');
    const sel = (label) => view.nodes().find((n) => n.tagName === 'SELECT' && walk(n.parentNode).startsWith(label));
    await act(async () => { view.props(sel('Counsel')).onChange({ target: { value: '3' } }); });
    await act(async () => { view.props(sel('Review type')).onChange({ target: { value: 'periodic' } }); });
    const jur = view.nodes().find((n) => n.tagName === 'INPUT' && String(view.props(n)?.placeholder || '').startsWith('e.g. Delaware'));
    await act(async () => { view.props(jur).onChange({ target: { value: 'Delaware, United States' } }); });
    await view.click('Request review');
    await view.flush();
    assert.deepEqual(calls[0], ['request', { kind: 'template', ref: 'initial_lpa', reviewer_id: 3, review_type: 'periodic', jurisdiction: 'Delaware, United States', due_on: '' }]);
    assert.match(view.text(), /Review LR-32 /);
    assert.ok(view.nodes().some((n) => view.props(n)?.['data-testid'] === 'counsel-list'));
    const id = view.nodes().find((n) => n.tagName === 'INPUT' && view.props(n)?.inputMode === 'numeric');
    await act(async () => { view.props(id).onChange({ target: { value: '9x' } }); });
    await view.click('Grant counsel');
    assert.deepEqual(calls.at(-1), ['grant', ['9', '']]);
  } finally { await view.unmount(); restore(); }
});
