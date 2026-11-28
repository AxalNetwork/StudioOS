/**
 * D9068 (#9068): the member side of introductions through Axal. The pure rules in `introRequestModel.js`, and the
 * real pages mounted with `fetch` stubbed, on synthetic records only:
 *
 *   · readiness is the server's, worst first, and an unreadable answer is never ready;
 *   · the sheet keeps the draft when the server refuses a submit for readiness, when a submit fails, and when its
 *     answer is lost (it reads the request back instead of sending a second submit);
 *   · the desk draws each lane's count from the Worker's `lanes`;
 *   · nothing on these pages calls an operator route or sends anything.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/intro_requests_member_9068.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';

register(new URL('./_airailRender-hook.mjs', import.meta.url));
const M = await import('../src/pages/introRequests/introRequestModel.js');
const { default: IntroRequestSheet } = await import('../src/pages/introRequests/IntroRequestSheet.jsx');
const { default: RequesterReadinessPage } = await import('../src/pages/introRequests/RequesterReadinessPage.jsx');
const { default: IntroRequestsDesk } = await import('../src/pages/introRequests/IntroRequestsDesk.jsx');
const { default: IntroRequestDetail } = await import('../src/pages/introRequests/IntroRequestDetail.jsx');

const h = React.createElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const refusal = (status, error, message) => json({ error, message }, status);

/* ---------- synthetic records ---------- */

const POLICY = { uid: 'pol-synthetic', version: 1, requirements: ['professional_profile', 'capacity'], validity_days: null };
const readiness = (a, b, ready = false) => ({
  policy: POLICY,
  requirements: [
    { key: 'professional_profile', status: a, valid_until: null, value: a === 'missing' ? null : { headline: 'Synthetic headline' }, has_evidence_ref: false, reviewed_at: a === 'met' ? '2026-11-20 10:00:00' : null },
    { key: 'capacity', status: b, valid_until: null, value: b === 'missing' ? null : { capacity: 'founder' }, has_evidence_ref: false, reviewed_at: b === 'met' ? '2026-11-20 10:00:00' : null },
  ],
  ready,
});
const READY = readiness('met', 'met', true);
const DRAFT = {
  uid: 'ir_synthetic0001', service_type: 'directory_introduction', state: 'draft', next_actor: 'requester', revision: 3,
  target: { kind: 'directory_person', entry_uid: 'p-synthetic', display_name: 'Person Example', provisional_uid: null, provisional_status: null, organization_entry_uid: null, organization_name: null, recipient_identified: true },
  purpose: 'Synthetic purpose', shareable_brief: 'Synthetic brief', consent_status: 'not_asked', outcome_note: null, operator_assigned: false,
  policy_version: null, created_at: '2026-11-27 09:00:00', updated_at: '2026-11-27 09:05:00', submitted_at: null, closed_at: null,
  private_notes: 'Synthetic private note', events: [{ type: 'draft_created', from_state: null, to_state: 'draft', by: 'requester', at: '2026-11-27 09:00:00', detail: {} }],
};

/* ---------- the pure rules ---------- */

test('readiness aggregate: worst first, and nothing unreadable is ever ready', () => {
  assert.equal(M.aggregateReadiness(READY), 'ready');
  assert.equal(M.aggregateReadiness(null), 'unr', 'a failed read');
  assert.equal(M.aggregateReadiness({ ...READY, ready: undefined }), 'unr', 'no server answer for ready');
  assert.equal(M.aggregateReadiness({ ...readiness('missing', 'missing'), ready: undefined }), 'unr', 'no server answer, whatever the rows say');
  assert.equal(M.aggregateReadiness(readiness('met', 'mystery', true)), 'unr', 'a status the page does not know');
  assert.equal(M.aggregateReadiness(readiness('missing', 'mystery')), 'unr', 'an unknown status outranks an incomplete one');
  assert.equal(M.aggregateReadiness(readiness('met', 'met', false)), 'unr', 'rows and the server disagree: not ready');
  assert.equal(M.aggregateReadiness(readiness('rejected', 'expired')), 'blk');
  assert.equal(M.aggregateReadiness(readiness('expired', 'missing')), 'exp');
  assert.equal(M.aggregateReadiness(readiness('missing', 'missing')), 'ns');
  assert.equal(M.aggregateReadiness(readiness('missing', 'awaiting_review')), 'inc');
  assert.equal(M.aggregateReadiness(readiness('met', 'awaiting_review')), 'rev');
  assert.equal(M.requirementStatus('mystery').word, 'Unreadable');
  assert.deepEqual(M.blockingItems(readiness('met', 'awaiting_review')).map((b) => [b.key, b.status.word]), [['capacity', 'Submitted']]);
  const g = M.groupRequirements(readiness('missing', 'met').requirements);
  assert.deepEqual([g.needs_you.length, g.reviewer.length, g.done.length], [1, 0, 1]);
});

test('a request keeps request, target response, contact and introduction apart', () => {
  const f = M.fourFields({ ...DRAFT, state: 'awaiting_target', next_actor: 'target', consent_status: 'asked', events: [{ type: 'contact_attempted', at: '2026-11-27 10:00:00', detail: {} }] });
  assert.deepEqual([f.request.word, f.response.word, f.contact.word, f.introduction.word], ['Awaiting target', 'Awaiting answer', 'Contact recorded', 'Not made']);
  const none = M.fourFields(DRAFT);
  assert.deepEqual([none.contact.word, none.introduction.word], ['No contact yet', 'Not made']);
  assert.equal(M.fourFields({ ...DRAFT, consent_status: 'weird' }).response.word, 'Unreadable');
  assert.equal(M.nextLine({ state: 'submitted', next_actor: 'operator' }), 'Axal assigns an operator');
  assert.equal(M.withdrawCopy({ state: 'contacted' }).stage, 'after contact');
  assert.equal(M.withdrawCopy({ state: 'in_review' }).stage, 'before contact');
  assert.equal(M.targetLine({ target: { kind: 'none', display_name: null, organization_name: 'Org Example' } }).name, 'Person to be identified at Org Example');
});

test('the share preview carries the target brief only, never the private note', () => {
  const rows = M.sharePreview(READY, DRAFT);
  assert.deepEqual(rows.map((r) => r.label), ['Headline', 'Profile link', 'Capacity', 'Organisation you represent', 'Purpose', 'Brief']);
  assert.ok(!JSON.stringify(rows).includes('Synthetic private note'));
  assert.equal(M.refusalSentence({ status: 409, code: 'revision_conflict' }).startsWith('This request changed'), true);
  assert.equal(M.refusalSentence({}), 'The answer did not arrive. Nothing is lost here.');
  assert.equal(M.refusalSentence({ status: 500, message: 'raw provider text' }), 'Not saved. What you typed is kept here.');
  assert.match(M.newIdempotencyKey(() => 'abc'), /^ir-abc$/);
});

/* ---------- mounting a page with fetch stubbed ---------- */

async function mount(element, url, path, route) {
  const restoreDoc = installDocument();
  const prevMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const full = String(u).replace(/^.*?\/api(?=\/)/, '');
    const [p, query = ''] = full.split('?');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: p, query, body });
    const out = await route(method, p, body, query);
    return out instanceof Response ? out : json(out ?? {});
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
      h(Route, { path, element }),
      h(Route, { path: '/network/introductions/requests/:uid', element: h('p', null, 'RECEIPT PAGE') }))));
  });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await act(async () => { await tick(); }); };
  await settle();
  return {
    calls,
    settle,
    text: () => textOf(container).replace(/\s+/g, ' ').trim(),
    buttons: (label) => walk(container).filter((n) => n.tagName === 'BUTTON' && textOf(n).replace(/\s+/g, ' ').trim() === label),
    props,
    async click(node, what) {
      assert.ok(node, `${what} is drawn`);
      assert.ok(!props(node).disabled, `${what} can be used`);
      await act(async () => { props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = orig; globalThis.matchMedia = prevMatch; restoreDoc(); },
  };
}
const sheetAt4 = (route) => mount(h(IntroRequestSheet), `/network/introductions/requests/new?draft=${DRAFT.uid}&step=4`, '/network/introductions/requests/new', route);

test('sheet: the server refuses a submit for readiness, and the draft is kept with what blocks it', async () => {
  const m = await sheetAt4((method, p) => {
    if (method === 'GET' && p === `/intro-requests/${DRAFT.uid}`) return { request: DRAFT };
    if (method === 'GET' && p === '/intro-requests/readiness') return READY;
    if (method === 'POST' && p === `/intro-requests/${DRAFT.uid}/submit`)
      return { request: { ...DRAFT, state: 'readiness_needed', revision: 4 }, readiness: readiness('met', 'expired') };
    throw new Error(`unexpected ${method} ${p}`);
  });
  try {
    assert.match(m.text(), /✓ Ready to request/);
    await m.click(m.buttons('Submit request').at(-1), 'Submit request');
    const submits = m.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/submit'));
    assert.equal(submits.length, 1);
    assert.deepEqual(submits[0].body, { expected_revision: 3 }, 'the revision read is the one sent');
    assert.match(m.text(), /Not submitted\. The server checked your readiness and items remain\. Your draft, person and purpose are kept\./);
    assert.match(m.text(), /Capacity ⌛ Expired/);
    assert.doesNotMatch(m.text(), /RECEIPT PAGE/);
    // The server's answer, not the earlier read, decides: Submit is off until readiness is met again.
    assert.ok(m.buttons('Submit request').every((b) => m.props(b).disabled), 'Submit stays off');
  } finally { await m.unmount(); }
});

test('sheet: a refused submit keeps the draft, and a lost answer is read back, never sent twice', async () => {
  let mode = 'refuse';
  let state = DRAFT;
  const m = await sheetAt4((method, p) => {
    if (method === 'GET' && p === `/intro-requests/${DRAFT.uid}`) return { request: state };
    if (method === 'GET' && p === '/intro-requests/readiness') return READY;
    if (method === 'POST' && p === `/intro-requests/${DRAFT.uid}/submit`) {
      if (mode === 'refuse') return refusal(403, 'support_session_read_only', 'raw server words');
      throw new TypeError('network down');
    }
    throw new Error(`unexpected ${method} ${p}`);
  });
  try {
    await m.click(m.buttons('Submit request').at(-1), 'Submit request');
    assert.match(m.text(), /Not submitted\. A support session can read requests but not change them\. Your draft is kept\./);
    assert.doesNotMatch(m.text(), /raw server words/, 'our sentence, never the raw message');

    mode = 'lost';
    await m.click(m.buttons('Submit request').at(-1), 'Submit request');
    assert.match(m.text(), /We could not confirm the request\./);
    const before = m.calls.filter((c) => c.path.endsWith('/submit')).length;
    await m.click(m.buttons('Check what was recorded')[0], 'Check what was recorded');
    assert.equal(m.calls.filter((c) => c.path.endsWith('/submit')).length, before, 'checking sends no second submit');
    assert.match(m.text(), /Not submitted\. Your draft is intact; you can submit again\./);

    // Found submitted on the read back: the receipt opens.
    mode = 'lost';
    await m.click(m.buttons('Submit request').at(-1), 'Submit request');
    state = { ...DRAFT, state: 'submitted', next_actor: 'operator', revision: 4 };
    await m.click(m.buttons('Check what was recorded')[0], 'Check what was recorded');
    assert.match(m.text(), /RECEIPT PAGE/);
  } finally { await m.unmount(); }
});

test('sheet: readiness that cannot be read is Unreadable and Submit stays off', async () => {
  const m = await sheetAt4((method, p) => {
    if (method === 'GET' && p === `/intro-requests/${DRAFT.uid}`) return { request: DRAFT };
    if (method === 'GET' && p === '/intro-requests/readiness') return refusal(503, 'intro_policy_unavailable', 'no policy');
    throw new Error(`unexpected ${method} ${p}`);
  });
  try {
    assert.match(m.text(), /Unreadable/);
    assert.match(m.text(), /It is never counted as ready, so submitting stays off\./);
    assert.doesNotMatch(m.text(), /✓ Ready to request|Ready to submit/);
    assert.ok(m.buttons('Submit request').length && m.buttons('Submit request').every((b) => m.props(b).disabled));
  } finally { await m.unmount(); }
});

test('readiness page: a failed read is never shown as ready; a good one groups the rows', async () => {
  let fail = true;
  const m = await mount(h(RequesterReadinessPage), '/network/introductions/readiness', '/network/introductions/readiness', (method, p) => {
    if (method === 'GET' && p === '/intro-requests/readiness') return fail ? new Response('{}', { status: 500 }) : readiness('met', 'awaiting_review');
    throw new Error(`unexpected ${method} ${p}`);
  });
  try {
    assert.match(m.text(), /Unreadable/);
    assert.doesNotMatch(m.text(), /✓ Ready to request|Every required item is approved/);
    fail = false;
    await m.click(m.buttons('Try again')[0], 'Try again');
    assert.match(m.text(), /In review/);
    assert.match(m.text(), /With a reviewer · 1/);
    assert.match(m.text(), /Done · 1/);
    assert.match(m.text(), /1 of 2 required items are approved/);
  } finally { await m.unmount(); }
});

test('desk: each lane shows the count the server sent, and a lane with none says so', async () => {
  const m = await mount(h(IntroRequestsDesk), '/network/introductions/requests?lane=target', '/network/introductions/requests', (method, p, _b, q) => {
    if (method === 'GET' && p === '/intro-requests') {
      assert.equal(q, 'next_actor=target');
      return { total: 0, lanes: { requester: 2, operator: 5, target: 0, none: 7 }, items: [], next_cursor: null };
    }
    throw new Error(`unexpected ${method} ${p}`);
  });
  try {
    assert.match(m.text(), /2 Needs you 5 Awaiting Axal 0 Awaiting target 7 History/);
    assert.match(m.text(), /14 requests · counted by the server/);
    assert.match(m.text(), /Nothing in Awaiting target right now\./);
  } finally { await m.unmount(); }
});

test('detail: a withdraw that loses a race shows the newer state instead of withdrawing blind', async () => {
  const contacted = { ...DRAFT, state: 'contacted', next_actor: 'operator', revision: 7, submitted_at: '2026-11-27 09:10:00', operator_assigned: true };
  let current = { ...contacted, revision: 6, state: 'in_review' };
  const m = await mount(h(IntroRequestDetail), `/network/introductions/requests/${DRAFT.uid}`, '/network/introductions/requests/:uid', (method, p, body) => {
    if (method === 'GET' && p === `/intro-requests/${DRAFT.uid}`) { const r = current; current = contacted; return { request: r }; }
    if (method === 'POST' && p.endsWith('/withdraw')) { assert.deepEqual(body, { expected_revision: 6 }); return refusal(409, 'revision_conflict', 'raw'); }
    throw new Error(`unexpected ${method} ${p}`);
  });
  try {
    assert.match(m.text(), /In review/);
    await m.click(m.buttons('Withdraw request')[0], 'Withdraw request');
    assert.match(m.text(), /before contact/);
    await m.click(m.buttons('Withdraw request').at(-1), 'confirm Withdraw request');
    assert.match(m.text(), /The request changed before your withdrawal arrived\./);
    assert.match(m.text(), /Contacted/);
  } finally { await m.unmount(); }
});

/* ---------- source rules ---------- */

test('the member pages call no operator route and send nothing', () => {
  const dir = 'frontend/src/pages/introRequests';
  const files = readdirSync(dir).filter((f) => /\.(jsx?|mjs)$/.test(f));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = codeOnly(readFileSync(`${dir}/${f}`, 'utf8'));
    assert.doesNotMatch(src, /\/operator\//, `${f} calls an operator route`);
    assert.doesNotMatch(src, /contact-attempts|recordContactAttempt|\b(e|err|error)\??\.message\b/, `${f} sends outreach or shows a raw message`);
  }
  const client = codeOnly(readFileSync('frontend/src/lib/api/introRequests.js', 'utf8'));
  assert.doesNotMatch(client, /\/operator/, 'the member client names an operator route');
});
