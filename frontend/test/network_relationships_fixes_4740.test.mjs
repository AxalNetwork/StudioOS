/**
 * #4740 (S1 audit, 2026-11-06) — six UI-integration fixes over work merged by
 * #4354, #4501 and #4054, all frontend-only (the Worker routes were already
 * mounted):
 *
 *   1. IntroductionsDesk "Ask Eadwyn to draft the intro" (RI4, D4330 part 8b):
 *      quotes the run first, opens the draft in the composer once confirmed,
 *      and a refusal shows the mapped copy.
 *   2. WhoKnowsStrip's AskIntroSheet "Ask Eadwyn to draft from this record"
 *      (RI3, D4330): the same quote-then-run, into the reason field.
 *   3. RecordEmailSheet: a failed shares read is Unreadable for a member,
 *      never the false "has not shared" line (`RecordEmailSheet.jsx`).
 *   4. IntroductionsDesk's IntroCompose: an unreadable mailbox list is its
 *      own alert state, never indistinguishable from "no mailbox yet".
 *   5. IntroductionsDesk reads `?intro=<uid>` (the Worker's introLink,
 *      D4329) and highlights that row, or says it is no longer on the desk.
 *   6. IntroductionsDesk's summary card over `relationshipsApi.summary()`
 *      (D4464): counts render, a field `recorded: false` is "Not recorded",
 *      never 0, and a failed read is Unreadable.
 *
 * Every person, company and uid here is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { relationshipsApi } from '../src/lib/api/relationships.js';
import { mailApi } from '../src/lib/api/mail.js';
import IntroductionsDesk from '../src/pages/relationships/IntroductionsDesk.jsx';
import { AskIntroSheet } from '../src/pages/relationships/WhoKnowsStrip.jsx';
import { NOT_RECORDED } from '../src/pages/relationships/relationshipsModel.js';
import RecordEmailSheet, { NOT_SHARED } from '../src/pages/email/RecordEmailSheet.jsx';

const h = React.createElement;

/** Stubs on the shared clients; every call is kept, same shape as relationships_ui_3572.test.mjs. */
function stubs(answers) {
  const calls = [];
  const saved = { r: { ...relationshipsApi }, m: { ...mailApi } };
  for (const [k, fn] of Object.entries(answers)) {
    const [group, name] = k.split('.');
    const target = group === 'mail' ? mailApi : relationshipsApi;
    target[name] = async (...a) => { calls.push([k, ...a]); return fn(...a); };
  }
  return { calls, restore: () => { Object.assign(relationshipsApi, saved.r); Object.assign(mailApi, saved.m); } };
}
const by = (m, id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
const press = async (m, id, arg) => { const n = by(m, id); assert.ok(n, `missing ${id}`); m.props(n).onClick?.(arg); await m.flush(); await m.flush(); };
/** A press whose handler chains more than one await (quote → confirm → composer, …) needs more ticks than `press` gives. */
const settle = async (m, n = 4) => { for (let i = 0; i < n; i += 1) await m.flush(); };

const ASK = {
  uid: 'r1', status: 'accepted', created_at: '2026-11-02 10:00:00', team_key: 'v:1',
  requester: { id: 4, name: 'Omar Reyes' }, teammate: { id: 2, name: 'Lena Hart' }, person: { name: 'Alex Example', company: 'Bluefern Capital' },
  outcome: { value: null, label: 'Not recorded' }, follow_up: null,
};
const QUIET_SUMMARY = async () => ({ sharing: {}, teammates_sharing: null, requests: {}, recording: {} });

test('RI4: "Ask Eadwyn to draft the intro" quotes first, opens the composer with the draft, and a refusal shows the mapped copy', async () => {
  // Mutation checked: swapping the estimate-before-run order (running the real draft on the first
  // press) makes the `estimated` guard below throw, so the recorded call order fails loudly.
  let estimated = false;
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received: [{ ...ASK }], follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': QUIET_SUMMARY,
    'r.draftIntro': async (uid, body) => {
      if (body?.estimate) { estimated = true; return { estimate: { hold_microusd: 20_000, model: 'm' } }; }
      assert.equal(estimated, true, 'the quote must run before the draft');
      return { draft: { kind: 'intro', proposal: true, model: 'm', subject: 'Intro: Alex ↔ Omar', body: 'Drafted body text.' } };
    },
    'mail.accounts': async () => ({ accounts: [{ uid: 'acc-1', address: 'lena@example.invalid', can_send: true }] }),
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.equal(Boolean(by(m, 'in-draft-intro-r1')), true, '"Ask Eadwyn to draft the intro" is enabled, part 8b has merged');
    await press(m, 'in-draft-intro-r1');
    assert.ok(by(m, 'in-draft-intro-r1-confirm'), 'the quote is shown before the draft runs');
    await press(m, 'in-draft-intro-r1-confirm-run');
    await settle(m);
    const calls = s.calls.filter((c) => c[0] === 'r.draftIntro');
    assert.deepEqual(calls.map((c) => [c[1], !!c[2]?.estimate]), [['r1', true], ['r1', false]], 'the quote call, then the run');
    assert.equal(m.props(by(m, 'record-compose-subject')).value, 'Intro: Alex ↔ Omar');
    assert.equal(m.props(by(m, 'record-compose-body-field')).value, 'Drafted body text.');
  } finally { s.restore(); await m.unmount(); }
});

test('RI4: a refused draft run shows the mapped copy, never the raw error message', async () => {
  // Mutation checked: reading `e.message` instead of `e.data.message` here makes this assertion
  // see the raw text and fail — relationshipsModel's DRAFT_REFUSED is the only other candidate and
  // the stub's thrown error carries neither, so the assertion is exact to the mapped-copy rule.
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received: [{ ...ASK }], follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': QUIET_SUMMARY,
    'r.draftIntro': async (uid, body) => {
      if (body?.estimate) return { estimate: { hold_microusd: 5_000, model: 'm' } };
      const e = new Error('RAW_INTERNAL_FAILURE_NEVER_SHOWN');
      e.data = { message: 'Eadwyn could not draft this. Try again.' };
      throw e;
    },
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    await press(m, 'in-draft-intro-r1');
    await press(m, 'in-draft-intro-r1-confirm-run');
    await settle(m);
    assert.match(m.text(), /Eadwyn could not draft this\. Try again\./);
    assert.doesNotMatch(m.text(), /RAW_INTERNAL_FAILURE_NEVER_SHOWN/);
  } finally { s.restore(); await m.unmount(); }
});

const ROW = { teammateId: 101, ref: 7, ask: 'Ask Lena for an introduction', teammate: 'Lena Hart', knows: 'Lena Hart knows Alex Example', person: 'Alex Example' };

test('RI3: "Ask Eadwyn to draft from this record" quotes first, then fills the reason field (never the context field)', async () => {
  // Mutation checked: writing the draft into `context` instead of `reason` makes the reason
  // assertion read '' and fail; dropping the `estimated` guard lets a same-tick run pass unchecked.
  let estimated = false;
  const s = stubs({
    'r.draftAskReason': async (body) => {
      if (body?.estimate) { estimated = true; return { estimate: { hold_microusd: 8_000, model: 'm' } }; }
      assert.equal(estimated, true, 'the quote must run before the draft');
      return { draft: { kind: 'ask_reason', proposal: true, model: 'm', text: 'Drafted reason text.' } };
    },
  });
  const m = await mountContracts(h(AskIntroSheet, { row: ROW, onClose() {}, testId: 'wks' }));
  try {
    await m.flush();
    assert.equal(Boolean(by(m, 'wks-draft')), true, '"Ask Eadwyn to draft from this record" is enabled, part 8b has merged');
    await press(m, 'wks-draft');
    assert.ok(by(m, 'wks-draft-confirm'), 'the quote is shown before the draft runs');
    await press(m, 'wks-draft-confirm-run');
    await settle(m);
    const calls = s.calls.filter((c) => c[0] === 'r.draftAskReason');
    assert.deepEqual(calls.map((c) => [c[1].teammate, c[1].ref, !!c[1].estimate]), [[101, 7, true], [101, 7, false]]);
    assert.equal(m.props(by(m, 'wks-reason')).value, 'Drafted reason text.');
    assert.equal(m.props(by(m, 'wks-context')).value, '', 'never into the context field — only the two of them read that one');
  } finally { s.restore(); await m.unmount(); }
});

test('RI3: a refused draft run shows the mapped copy, never the raw error message', async () => {
  const s = stubs({
    'r.draftAskReason': async (body) => {
      if (body?.estimate) return { estimate: { hold_microusd: 4_000, model: 'm' } };
      const e = new Error('RAW_INTERNAL_FAILURE_NEVER_SHOWN');
      e.data = { message: 'Eadwyn could not draft this. Try again.' };
      throw e;
    },
  });
  const m = await mountContracts(h(AskIntroSheet, { row: ROW, onClose() {}, testId: 'wks' }));
  try {
    await m.flush();
    await press(m, 'wks-draft');
    await press(m, 'wks-draft-confirm-run');
    await settle(m);
    assert.match(m.text(), /Eadwyn could not draft this\. Try again\./);
    assert.doesNotMatch(m.text(), /RAW_INTERNAL_FAILURE_NEVER_SHOWN/);
  } finally { s.restore(); await m.unmount(); }
});

test('IntroCompose: unreadable mailboxes show the alert and Try again, never "no mailbox yet"; Try again re-reads accounts', async () => {
  // Mutation checked: swapping `status === 'error'` for `status === 'loading'` here makes the
  // alert never render and the "RecordCompose not mounted" assertion fails (it mounts instead).
  let accountsCalls = 0;
  const s = stubs({
    'r.introRequests': async () => ({ sent: [], received: [{ ...ASK }], follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': QUIET_SUMMARY,
    'mail.accounts': async () => {
      accountsCalls += 1;
      if (accountsCalls === 1) throw new Error('mailbox read failed');
      return { accounts: [{ uid: 'acc-1', address: 'lena@example.invalid', can_send: true }] };
    },
  });
  const m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    await press(m, 'in-write-r1');
    await settle(m);
    assert.ok(by(m, 'in-compose-mailboxes-unreadable'), 'the unreadable alert is drawn');
    assert.equal(m.props(by(m, 'in-compose-mailboxes-unreadable'))?.role, 'alert');
    assert.match(m.text(), /Your mailboxes could not be read/);
    assert.doesNotMatch(m.text(), /no mailbox yet/);
    assert.equal(Boolean(by(m, 'record-compose-subject')), false, 'RecordCompose is not mounted while unreadable');
    await press(m, 'in-compose-mailboxes-retry');
    await settle(m);
    assert.equal(accountsCalls, 2, 'Try again re-ran accounts()');
    assert.ok(by(m, 'record-compose-subject'), 'the composer mounts once the retry succeeds');
  } finally { s.restore(); await m.unmount(); }
});

test('?intro=<uid>: highlights the matching row; an unknown uid says it is no longer on the desk', async () => {
  // Mutation checked: comparing against the wrong field (e.g. always `undefined`) drops
  // `aria-current` and the first assertion below fails; removing the `introMissing` guard makes
  // the "not found" line always show, failing the second block's negative assertion.
  const made = async () => ({ sent: [{ ...ASK, uid: 'r2', status: 'made' }], received: [], follow_ups_due: 0 });
  let s = stubs({ 'r.introRequests': made, 'r.sharing': async () => ({ teams: [] }), 'r.summary': QUIET_SUMMARY });
  let m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions?intro=r2');
  try {
    await m.flush(); await m.flush();
    assert.equal(m.props(by(m, 'in-row-r2'))['aria-current'], 'true', 'the named row is marked current');
    assert.equal(Boolean(by(m, 'in-intro-missing')), false, 'a present uid draws no "not on your desk" line');
  } finally { s.restore(); await m.unmount(); }

  s = stubs({ 'r.introRequests': made, 'r.sharing': async () => ({ teams: [] }), 'r.summary': QUIET_SUMMARY });
  m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions?intro=ghost-uid');
  try {
    await m.flush(); await m.flush();
    assert.match(m.text(), /That introduction request is no longer on your desk\./);
    assert.ok(by(m, 'in-intro-missing'));
  } finally { s.restore(); await m.unmount(); }
});

test('D4464 summary: counts render, a field recorded:false reads Not recorded (never 0), and a failed read is Unreadable', async () => {
  // Mutation checked: returning the raw 0 for `teammates_sharing` instead of NOT_RECORDED when its
  // own `recording` flag is false makes the second assertion read `0` and fail.
  let s = stubs({
    'r.introRequests': async () => ({ sent: [], received: [], follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': async () => ({
      sharing: { opted_in: true, teams_shared: 2, teams_total: 3 },
      teammates_sharing: 0,
      requests: { sent_pending: 1, received_pending: 0, made_90d: 5 },
      recording: { teammates_sharing: { recorded: false, reason: 'Relationships could not be read. Try again.' } },
    }),
  });
  let m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.equal(m.props(by(m, 'in-summary-sharing-value')).children, '2 of 3');
    assert.equal(m.props(by(m, 'in-summary-teammates-value')).children, NOT_RECORDED, 'recorded:false is never the 0 it defaulted to');
    assert.equal(m.props(by(m, 'in-summary-made-value')).children, 5);
  } finally { s.restore(); await m.unmount(); }

  s = stubs({
    'r.introRequests': async () => ({ sent: [], received: [], follow_ups_due: 0 }),
    'r.sharing': async () => ({ teams: [] }),
    'r.summary': async () => { throw new Error('summary down'); },
  });
  m = await mountContracts(h(IntroductionsDesk, { testId: 'in' }), '/network/introductions');
  try {
    await m.flush(); await m.flush();
    assert.ok(by(m, 'in-summary-error'));
    assert.match(m.text(), /Your network summary could not be read\./);
  } finally { s.restore(); await m.unmount(); }
});

test('RecordEmailSheet: a failed shares read is Unreadable for a member, never the false "has not shared" line', async () => {
  // Mutation checked: restoring the dropped `.catch(() => ({ items: [] }))` makes `shares` resolve
  // instead of reject, the pack renders NOT_SHARED instead of UNREADABLE, and this test fails.
  let sharesCalls = 0;
  const api = {
    accounts: async () => ({ accounts: [{ uid: 'acc-1', address: 'me@example.test', can_send: true }] }),
    shares: async () => { sharesCalls += 1; throw new Error('shares_unreadable'); },
    context: async () => ({ person: { ref: 'member:u9', kind: 'member', name: 'Bo Member' }, items: [] }),
  };
  const m = await mountContracts(h(RecordEmailSheet, { person: { ref: 'member:u9', name: 'Bo' }, onClose() {}, api }), '/network/relationships');
  try {
    await m.flush(); await m.flush();
    assert.match(m.text(), /Unreadable: this person’s records could not be read/);
    assert.doesNotMatch(m.text(), new RegExp(NOT_SHARED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(sharesCalls, 1);
  } finally { await m.unmount(); }
});
