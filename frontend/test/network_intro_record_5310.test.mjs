/**
 * #5310 part 3 — NW3.2 / NW3.4: one introduction request's record
 * (`design/incoming/network-workspace/NW3-Intro-detail.dc.html`), on stubbed reads.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/network_intro_record_5310.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { banner, headline, lifecycle, nextStep, people, timeline } from '../src/pages/relationships/introRecordModel.js';

const h = React.createElement;
const base = (over = {}) => ({
  uid: 'r1', requester: { id: 4, name: 'Maya Example' }, teammate: { id: 2, name: 'Tom Example' },
  person: { name: 'Priya Example', company: 'Kelp Example' }, note: 'We pilot with two labs.', context_note: null, decision_note: null,
  status: 'pending', decided_at: null, accepted_at: null, made_at: null, withdrawn_at: null,
  outcome: { value: null, label: 'Not recorded', note: null, recorded_by_user_id: null, recorded_at: null },
  follow_up: null, mail_sent_uid: null, delivery: null, created_at: '2026-10-31 10:02:00', ...over,
});
const ACCEPTED = base({ status: 'accepted', decided_at: '2026-11-03 11:04:00', accepted_at: '2026-11-03 11:04:00', decision_note: 'Happy to.' });

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

// Mutation checked: accepted drawn as made (fails); a declined request's later steps drawn as waiting (fails);
// a withdrawn request's decision step drawn as waiting (fails).
test('NW3.2 lifecycle: only recorded steps are done; an ending ends the steps after it', () => {
  assert.deepEqual(lifecycle(ACCEPTED).map((s) => s.state), ['done', 'done', 'done', 'todo', 'todo']);
  assert.deepEqual(lifecycle(base({ status: 'declined', decided_at: '2026-11-02 09:00:00' })).map((s) => [s.label, s.state]),
    [['Requested', 'done'], ['Declined', 'done'], ['Accepted', 'ended'], ['Made', 'ended'], ['Outcome', 'ended']]);
  assert.deepEqual(lifecycle(base({ status: 'withdrawn', withdrawn_at: '2026-11-01 08:00:00' })).map((s) => s.state), ['done', 'ended', 'ended', 'ended', 'ended']);
  const made = base({ status: 'made', decided_at: 'x', accepted_at: '2026-11-03 11:04:00', made_at: '2026-11-06 09:41:00', outcome: { value: 'meeting_held', label: 'Meeting held', recorded_at: '2026-11-10 10:00:00' } });
  assert.deepEqual(lifecycle(made).map((s) => s.state), ['done', 'done', 'done', 'done', 'done']);
});

// Mutation checked: the asker shown the introducer's delivery (fails); "you" lost on the reader's own step (fails);
// Made claimed before made_at (fails).
test('NW3.2 timeline: recorded entries from the reader\'s side; the asker never reads the send', () => {
  const asker = timeline(ACCEPTED, 'asker');
  assert.deepEqual(asker.map((t) => [t.key, t.recorded, t.title]), [
    ['requested', true, 'Requested by you'], ['accepted', true, 'Accepted by Tom Example'],
    ['email', false, 'Introduction email · sent from the introducer’s own mailbox'], ['made', false, 'Made'], ['outcome', false, 'Outcome · meeting held, replied, no reply or not a fit'],
  ]);
  assert.equal(asker[0].note, 'We pilot with two labs.');
  assert.equal(asker[0].at, '2026-10-31 10:02');
  assert.match(asker[2].note, /does not read it/);
  const pending = { ...ACCEPTED, delivery: { state: 'record_pending', operation_uid: 'op1' } };
  assert.equal(timeline(pending, 'asker')[2].recorded, false, 'the asker reads no delivery even when one exists');
  const teammate = timeline(pending, 'teammate');
  assert.equal(teammate[0].title, 'Requested by Maya Example');
  assert.equal(teammate[1].title, 'Accepted by you');
  assert.deepEqual([teammate[2].recorded, teammate[2].note], [true, 'Sent: your mail server took this intro. Its record here is not updated yet. Updating it sends nothing.']);
  assert.equal(teammate[3].note, 'Not recorded yet');
});

// Mutation checked: the reconciliation banner shown to the asker (fails); Update the record offered without a record_pending send (fails);
// withdraw offered on an accepted request (fails); the outcome offered before made (fails).
test('NW3.4 and next step: reconciliation is the introducer\'s; each action is one the Worker allows that side', () => {
  const pending = { ...ACCEPTED, delivery: { state: 'record_pending', operation_uid: 'op1' } };
  assert.deepEqual(banner(pending, 'teammate'), { tone: 'reconcile', text: 'Sent: your mail server took this intro. Its record here is not updated yet. Updating it sends nothing.', action: 'reconcile' });
  assert.equal(banner(pending, 'asker').tone, 'wait');
  assert.match(banner(ACCEPTED, 'asker').text, /^Tom accepted this introduction\. It has not been made yet\. Accepting is Tom’s yes/);
  assert.equal(banner(base({ status: 'made', made_at: '2026-11-06 09:41:00' }), 'asker'), null);
  assert.deepEqual(nextStep(pending, 'teammate').actions, ['reconcile', 'follow_up']);
  assert.deepEqual(nextStep(ACCEPTED, 'teammate').actions, ['follow_up']);
  assert.deepEqual(nextStep(base(), 'asker').actions, ['withdraw']);
  assert.deepEqual(nextStep(base(), 'teammate').actions, []);
  assert.deepEqual(nextStep(ACCEPTED, 'asker').actions, ['follow_up']);
  assert.deepEqual(nextStep(base({ status: 'made', made_at: 'x' }), 'asker').actions, ['outcome', 'follow_up']);
  assert.deepEqual(nextStep(base({ status: 'declined' }), 'asker'), { text: 'This request has ended: Declined.', actions: [] });
  assert.equal(headline(ACCEPTED, 'asker'), 'You → Priya Example, via Tom Example');
  assert.equal(headline(ACCEPTED, 'teammate'), 'Maya Example → Priya Example, via you');
  assert.deepEqual(people(ACCEPTED, 'asker').map((p) => [p.role, p.name]), [['Target', 'Priya Example'], ['Introducer', 'Tom Example'], ['Requester', 'You']]);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

async function mount(props) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const { default: Sheet } = await import('../src/pages/relationships/IntroRecordSheet.jsx');
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(Sheet, props))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  return {
    has: (id) => !!byId(id), textOf: (id) => text(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange?.({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// Mutation checked: the record read for another uid (fails); a failed read drawn as an empty record (fails);
// reconcile calling resend (no such call; asserted by the call log); withdraw shown to the teammate (fails).
test('NW3.2 mounted: the record from its own read, reconciliation for the introducer, and a failed read says so', async () => {
  const calls = [];
  const rec = { ...ACCEPTED, uid: 'r7', delivery: { state: 'record_pending', operation_uid: 'op1' } };
  const api = {
    introRequest: async (uid) => { calls.push(['read', uid]); return { request: rec }; },
    reconcileIntroDelivery: async (uid) => { calls.push(['reconcile', uid]); return { request: { ...rec, status: 'made', made_at: '2026-11-06 09:41:00', delivery: null } }; },
    withdrawIntro: async () => { calls.push(['withdraw']); return {}; },
  };
  const v = await mount({ uid: 'r7', side: 'teammate', api, onClose() {} });
  try {
    assert.deepEqual(calls, [['read', 'r7']]);
    assert.ok(v.has('intro-record-banner-reconcile'));
    assert.match(v.textOf('intro-record-banner-reconcile'), /No “Resend”/);
    assert.equal(v.has('intro-record-withdraw'), false, 'withdraw is the asker\'s, while pending');
    await v.click('intro-record-reconcile');
    assert.deepEqual(calls.at(-1), ['reconcile', 'r7']);
    assert.equal(v.has('intro-record-banner-reconcile'), false, 'made: the banner is gone');
    assert.equal(v.textOf('intro-record-step-made').includes('✓'), true);
  } finally { await v.close(); }
  const failed = await mount({ uid: 'r9', side: 'asker', api: { introRequest: async () => { throw new Error('down'); } }, onClose() {} });
  try {
    assert.ok(failed.has('intro-record-unreadable'));
    assert.equal(failed.has('intro-record-timeline'), false, 'nothing is drawn in its place');
  } finally { await failed.close(); }
});

// Mutation checked: the follow-up date not sent (fails). Withdraw by the prop's uid instead of the record's is
// equivalent: the sheet is opened for that record, so the two are the same request.
test('NW3.2 mounted: the asker withdraws a pending request and sets their follow-up from the record', async () => {
  const calls = [];
  const api = {
    introRequest: async () => ({ request: base() }),
    withdrawIntro: async (uid) => { calls.push(['withdraw', uid]); return { request: base({ status: 'withdrawn', withdrawn_at: '2026-11-01 08:00:00' }) }; },
    setIntroFollowUp: async (uid, d) => { calls.push(['follow', uid, d]); return { request: { ...ACCEPTED, follow_up: { due_on: d, state: 'due' } } }; },
  };
  const v = await mount({ uid: 'r1', side: 'asker', api, onClose() {} });
  try {
    await v.click('intro-record-withdraw');
    assert.deepEqual(calls.at(-1), ['withdraw', 'r1']);
    assert.match(v.textOf('intro-record-next'), /This request has ended: Withdrawn\./);
  } finally { await v.close(); }
  const w = await mount({ uid: 'r2', side: 'asker', api: { ...api, introRequest: async () => ({ request: { ...ACCEPTED, uid: 'r2' } }) }, onClose() {} });
  try {
    await w.change('intro-record-follow-date', '2026-11-20');
    await w.click('intro-record-follow-save');
    assert.deepEqual(calls.at(-1), ['follow', 'r2', '2026-11-20']);
  } finally { await w.close(); }
});
