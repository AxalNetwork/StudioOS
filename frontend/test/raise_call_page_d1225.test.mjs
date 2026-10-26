/**
 * D1225 (#3224, Calls part 4) — the founder's one call, drawn to the owner's
 * canvas: CLS8 open, CLS9's other states, CLS10's dialogs, CLS11's recipient
 * drawer with delivery, and CLS14's co-founder and admin.
 *
 * Mounted on a stubbed `fetch` that answers `GET /api/round-calls/:uid` as
 * D1222's founder read does. Every venture, call and investor is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_call_page_d1225.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import RaiseCallPage from '../src/pages/founder/RaiseCallPage.jsx';
import {
  callLine, extensionValid, funnelSentence, funnelOf, furthestOf, lastActivity, refusalOf, stateNote, stateOf, stripOf, visibleRows,
} from '../src/pages/founder/raiseCallModel.js';

const h = React.createElement;
const FOUNDER = { id: 11, role: 'founder', name: 'Fay Founder', email: 'fay@example.test' };
const ADMIN = { id: 12, role: 'admin', name: 'Ada Admin', email: 'ada@example.test' };
const FUTURE = '2099-11-15';

const call = (o = {}) => ({
  uid: 'call-1', project_id: 7, name: 'Seed extension', amount_cents: 150000000, instrument: 'safe', valuation_cap_cents: 1000000000,
  discount_bps: null, pre_money_cents: null, minimum_cheque_cents: 2500000, target_close: FUTURE, state: 'sent',
  sent_at: '2099-10-01 09:00:00', closed_at: null, counsel_requested_at: null, ...o,
});
const chosen = (n, o = {}) => ({ origin: 'chosen', investor_user_id: n, name: `Firm ${n}`, email: `f${n}@example.test`, opened_at: null,
  data_room_requested_at: null, commitment_cents: null, committed_at: null, responded_at: null, last_response_at: null, delivery_state: 'notified', reasons: [], ...o });
// A matching investor who has not responded: the Worker sends no name, no id, no email.
const hidden = (o = {}) => ({ origin: 'match', opened_at: '2099-10-03 10:00:00', data_room_requested_at: null, commitment_cents: null, committed_at: null,
  responded_at: null, last_response_at: null, delivery_state: 'notified', reasons: ['Stage fits', 'Sector fits'], ...o });
const RECIPIENTS = [
  chosen(1, { opened_at: '2099-10-03', data_room_requested_at: '2099-10-08', commitment_cents: 25000000, committed_at: '2099-10-24', responded_at: '2099-10-08' }),
  chosen(2, { opened_at: '2099-10-04', responded_at: '2099-10-25' }),
  chosen(3, { delivery_state: 'not_delivered' }),
  hidden(),
];
const QUESTIONS = [
  { uid: 'q1', question: 'Is the SAFE post-money?', name: 'Firm 2', email: 'f2@example.test', asked_at: '2099-10-25 10:00:00', answer: null, answered_at: null },
  { uid: 'q2', question: 'When is the first close?', name: 'Firm 1', email: 'f1@example.test', asked_at: '2099-10-20 10:00:00', answer: 'Mid November.', answered_at: '2099-10-23 10:00:00' },
];
const read = (o = {}) => ({
  call: call(o.call), viewer: 'founder', relation: 'owner',
  can: { draft: true, answer: true, audience: true, send: true, extend: true, close: true },
  read_only: false, recipients: RECIPIENTS, questions: QUESTIONS,
  progress: { received: 4, opened: 3, data_room_requests: 1, commitments: 1, not_delivered: 1, committed_cents: 25000000, target_cents: 150000000 },
  ...o, ...(o.call ? { call: call(o.call) } : {}),
});

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});

async function mounted(page, { user = FOUNDER, manage, answer } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const writes = [];
  globalThis.fetch = async (u, options = {}) => {
    const url = String(u); const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    if (url === '/api/auth/me') return response(user);
    if (method !== 'GET') writes.push({ method, url, body });
    if (method === 'POST' && url === '/api/round-calls/call-1/manage') return manage ? manage(body) : response({});
    if (method === 'PUT' && url.startsWith('/api/round-calls/call-1/questions/')) return answer ? answer(body) : response({});
    if (method === 'GET' && url === '/api/round-calls/call-1') return typeof page === 'function' ? page() : response(page);
    return never();
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/calls/call-1'] },
    h(AuthProvider, null, h(Routes, null, h(Route, { path: '/raise/calls/:uid', element: h(RaiseCallPage) }), h(Route, { path: '/round-calls/:uid', element: h('p', null, 'investor page') }))))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    writes, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the state and the line, in the canvas\'s words', () => {
  assert.equal(stateOf(call()), 'Open');
  assert.equal(stateOf(call({ target_close: '2000-01-01' })), 'Expired');
  assert.equal(stateOf(call({ state: 'awaiting_counsel' })), 'Awaiting counsel');
  assert.equal(stateOf(call({ state: 'closed' })), 'Closed');
  assert.equal(stateOf(call({ state: 'draft' })), 'Draft');
  assert.equal(callLine(call()), 'Sent 1 Oct 2099 · closes 15 Nov 2099 · SAFE · cap $10,000,000 · minimum $25,000');
  const p = { committed_cents: 40000000 };
  assert.equal(stateNote(call({ state: 'closed', closed_at: '2099-06-30 10:00:00' }), p).line, 'This call closed on 30 Jun 2099 with $400,000 indicated. It is read-only.');
  assert.equal(stateNote(call({ target_close: '2000-11-15' }), p).line, 'This call closed on 15 Nov 2000 with $400,000 indicated. It is read-only.');
  assert.match(stateNote(call({ state: 'awaiting_counsel', counsel_requested_at: '2099-10-26 09:00:00' }), p).line, /asked to extend to 15 Nov 2099 on 26 Oct$/);
  assert.equal(stateNote(call(), p), null);
});

test('a matching investor is nameless, with no step and no time, until they respond', () => {
  const h0 = hidden();
  assert.equal(furthestOf(h0).label, 'Not shown until they respond');
  assert.deepEqual(visibleRows([h0], { q: 'stage' }), [], 'search never reaches a hidden match');
  assert.deepEqual(visibleRows([h0], { filter: 'opened' }), [], 'nor does a filter on what they did');
  assert.equal(lastActivity(h0), null, 'nor when they opened it');
  assert.deepEqual(visibleRows([chosen(9, { opened_at: '2099-10-02' }), h0], { sort: 'latest' }).map((r) => r.investor_user_id ?? 'm'), [9, 'm'], 'a hidden match sorts last on Latest');
  assert.equal(furthestOf(RECIPIENTS[0]).label, 'Indicated an amount');
  assert.equal(furthestOf(RECIPIENTS[1]).label, 'Asked a question');
  assert.equal(furthestOf(RECIPIENTS[2]).label, 'Not opened');
  assert.deepEqual(visibleRows(RECIPIENTS, { filter: 'not_told' }).map((r) => r.investor_user_id), [3]);
  assert.deepEqual(visibleRows(RECIPIENTS).map((r) => r.investor_user_id ?? 'm'), [1, 2, 3, 'm'], 'furthest along, the hidden last');
});

test('the strip and funnel: Indicated of the target; a draft\'s not-told is Not recorded, never 0', () => {
  const s = stripOf(read());
  assert.equal(s.indicated.value, '$250,000');
  assert.equal(s.indicated.sub, 'of $1,500,000 · indicative');
  assert.equal(s.recipients.sub, '3 chosen · 1 matching');
  assert.equal(s.waiting.value, 1);
  assert.equal(stripOf(read({ progress: { ...read().progress, not_delivered: null } })).notTold.value, null);
  assert.equal(funnelSentence(funnelOf(read())), 'Of 4 recipients, 3 opened the call, 1 asked for the data room and 1 indicated an amount.');
  assert.equal(extensionValid(call(), '2099-11-14'), false);
  assert.equal(extensionValid(call(), '2099-11-29'), true);
  assert.deepEqual(refusalOf({ status: 409, data: { code: 'call_changed' } }), { text: 'This call changed since you opened it. Reload to see its current state.', reload: true });
});

/* ------------------------------------------------------------------ *
 * CLS8, mounted
 * ------------------------------------------------------------------ */

test('CLS8: the head, the strip, the funnel, the responses and the questions; no word "Committed"', async () => {
  const v = await mounted(read());
  try {
    assert.equal(v.textOf('call-state'), 'Open');
    assert.equal(v.textOf('call-line'), 'Sent 1 Oct 2099 · closes 15 Nov 2099 · SAFE · cap $10,000,000 · minimum $25,000');
    assert.match(v.textOf('call-tile-indicated'), /Indicated\$250,000of \$1,500,000 · indicative/);
    assert.match(v.textOf('call-tile-not-told'), /Not told1See who/);
    assert.match(v.textOf('call-row-1'), /Firm 1Chosen from your pipelineIndicated an amount\$250,000Recorded24 OctTold on Axal/);
    assert.match(v.textOf('call-row-3'), /Not opened.*Not told/s);
    assert.match(v.textOf('call-row-hidden-3'), /Matching investorName hidden until they respondNot shown until they respondNot shown until they respondNot shown/);
    assert.doesNotMatch(v.textOf('call-row-hidden-3'), /3 Oct/, 'a hidden match\'s opened time is never drawn');
    assert.match(v.textOf('call-questions'), /Questions1 waiting/);
    assert.match(v.textOf('call-question-q2'), /Answered 23 OctMid November\./);
    assert.match(v.textOf('call-foot'), /Investors keep what they already sent\.Extend the dateClose the call/);
    assert.doesNotMatch(v.text(), /Committed|committed/);
    await v.click('call-see-not-told');
    assert.equal(v.props('call-filter-not_told')['aria-pressed'], true);
    assert.ok(v.has('call-row-3') && !v.has('call-row-1'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * CLS10, every change in a dialog
 * ------------------------------------------------------------------ */

test('Extend opens a dialog, sends only a later date, and says it pauses until counsel approves', async () => {
  const v = await mounted(read());
  try {
    await v.click('call-extend');
    assert.ok(v.has('call-extend-dialog'));
    assert.deepEqual(v.writes, [], 'opening the dialog changes nothing');
    assert.match(v.text(), /Extending pauses responses until counsel approves the new terms\. Investors keep what they already sent\./);
    await v.change('call-extend-date', '2099-11-10');
    assert.ok(v.props('call-extend-confirm').disabled, 'an earlier date is not offered');
    await v.change('call-extend-date', '2099-11-29');
    await v.click('call-extend-confirm');
    assert.deepEqual(v.writes, [{ method: 'POST', url: '/api/round-calls/call-1/manage', body: { action: 'extend', target_close: '2099-11-29' } }]);
    assert.ok(!v.has('call-extend-dialog'));
  } finally { await v.close(); }
});

test('Close asks first; a refusal stays in the dialog with Reload', async () => {
  const v = await mounted(read(), { manage: () => response({ error: 'call_changed', code: 'call_changed' }, 409) });
  try {
    await v.click('call-close');
    assert.match(v.text(), /Close Seed extension\?.*Investors can no longer respond\. Nothing already indicated is lost\./s);
    assert.deepEqual(v.writes, []);
    await v.click('call-close-confirm');
    assert.deepEqual(v.writes, [{ method: 'POST', url: '/api/round-calls/call-1/manage', body: { action: 'close' } }]);
    assert.ok(v.has('call-close-dialog'), 'a refused close keeps the dialog');
    assert.match(v.textOf('call-close-refusal'), /This call changed since you opened it\. Reload to see its current state\.ReloadNothing you entered was saved\./);
  } finally { await v.close(); }
});

test('Answer opens a dialog with the question, and sends only the answer typed', async () => {
  const v = await mounted(read());
  try {
    await v.click('call-answer-q1');
    assert.match(v.text(), /“Is the SAFE post-money\?”/);
    assert.ok(v.props('call-answer-send').disabled, 'no empty answer');
    await v.change('call-answer-text', ' Yes, post-money. ');
    await v.click('call-answer-send');
    assert.deepEqual(v.writes, [{ method: 'PUT', url: '/api/round-calls/call-1/questions/q1', body: { answer: 'Yes, post-money.' } }]);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * CLS11, the recipient drawer
 * ------------------------------------------------------------------ */

test('a chosen recipient\'s drawer: delivery, the amount as indicative, the timeline and their questions', async () => {
  const v = await mounted(read());
  try {
    await v.click('call-open-1');
    assert.match(v.text(), /Recipient · chosen/);
    assert.equal(v.textOf('call-recipient-told'), 'Told on AxalTold on Axal');
    assert.match(v.textOf('call-recipient-amount'), /\$250,000 Recorded.*Indicative\. It is an intention, not a payment and not a signed investment\./s);
    assert.match(v.textOf('call-recipient-timeline'), /Opened the call3 Oct.*Asked for the data room8 Oct.*Indicated an amount\$250,000 · Recorded24 Oct/s);
    assert.match(v.textOf('call-recipient-questions'), /When is the first close\?.*Answered 23 Oct: Mid November\./s);
    assert.doesNotMatch(v.textOf('call-recipient-questions'), /post-money/, 'another investor\'s question is not theirs');
  } finally { await v.close(); }
  const nt = await mounted(read());
  try {
    await nt.click('call-open-3');
    assert.equal(nt.textOf('call-recipient-told'), 'Told on AxalNot told');
  } finally { await nt.close(); }
});

test('a matching recipient\'s drawer: nameless, why they match, opened not shown', async () => {
  const v = await mounted(read());
  try {
    await v.click('call-open-hidden-3');
    assert.match(v.text(), /Recipient · matching/);
    assert.match(v.textOf('call-recipient-reasons'), /Stage fitsSector fits/);
    assert.equal(v.textOf('call-recipient-opened'), 'OpenedNot shown until they respond');
    assert.doesNotMatch(v.text(), /@example\.test.*Matching investor/s);
    assert.ok(!v.has('call-recipient-email'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * CLS9 and CLS14
 * ------------------------------------------------------------------ */

test('CLS9: a draft offers Continue draft; awaiting counsel, expired and closed take no change', async () => {
  const draft = await mounted(read({ call: { state: 'draft', sent_at: null }, progress: { ...read().progress, not_delivered: null } }));
  try {
    assert.equal(draft.textOf('call-state'), 'Draft');
    assert.equal(draft.textOf('call-line'), 'Not sent.');
    assert.ok(draft.has('call-continue-draft'));
  } finally { await draft.close(); }
  const paused = await mounted(read({ call: { state: 'awaiting_counsel', counsel_requested_at: '2099-10-26 09:00:00' }, read_only: true }));
  try {
    assert.equal(paused.textOf('call-state-note'), 'Responses are paused until counsel approves the extended terms.');
    assert.ok(!paused.has('call-extend'), 'no extend while counsel has it');
    assert.ok(paused.has('call-close'), 'the Worker still takes a close');
    assert.ok(!paused.has('call-answer-q1'));
  } finally { await paused.close(); }
  const expired = await mounted(read({ call: { target_close: '2000-11-15' }, read_only: true }));
  try {
    assert.equal(expired.textOf('call-state'), 'Expired');
    assert.match(expired.textOf('call-state-note'), /with \$250,000 indicated\. It is read-only\.Open a new call/);
    assert.ok(!expired.has('call-extend') && !expired.has('call-close') && !expired.has('call-answer-q1'));
  } finally { await expired.close(); }
  const closed = await mounted(read({ call: { state: 'closed', closed_at: '2099-10-30 10:00:00' }, read_only: true }));
  try {
    assert.ok(!closed.has('call-new'), 'a closed call offers no new call (CLS9)');
    assert.ok(!closed.has('call-close'));
  } finally { await closed.close(); }
});

test('CLS14: a co-founder answers but cannot extend or close; an admin refused reads the canvas\'s card', async () => {
  const member = await mounted(read({ relation: 'member', can: { draft: true, answer: true, audience: false, send: false, extend: false, close: false } }));
  try {
    assert.ok(member.has('call-answer-q1'));
    assert.ok(!member.has('call-extend') && !member.has('call-close'));
    assert.equal(member.textOf('call-owner-only'), 'Only the venture’s owner can send, extend or close a call.');
  } finally { await member.close(); }
  const admin = await mounted(() => response({ error: 'independent_counsel_recorder_required', code: 'independent_counsel_recorder_required' }, 403), { user: ADMIN });
  try {
    assert.match(admin.textOf('call-no-permission'), /Calls belong to the venture’s founders\. Studio admins do not open them\.Go to Studio/);
  } finally { await admin.close(); }
});

test('the source: every change in a dialog, no browser pop-up, no "Committed"', () => {
  const src = ['RaiseCallPage.jsx', 'CallDialogs.jsx', 'CallRecipientDrawer.jsx', 'raiseCallModel.js']
    .map((f) => codeOnly(readFileSync(`frontend/src/pages/founder/${f}`, 'utf8'))).join('\n');
  assert.doesNotMatch(src, /window\.(confirm|alert|prompt)|useToast/);
  assert.doesNotMatch(src, /'Committed|Committed '|>Committed/);
  const page = readFileSync('frontend/src/pages/founder/RaiseCallPage.jsx', 'utf8');
  for (const write of ["action: 'extend'", "action: 'close'", 'roundCallsApi.answer(']) {
    const at = page.indexOf(write);
    assert.ok(at > 0 && /Dialog call=|AnswerDialog question=/.test(page.slice(Math.max(0, at - 300), at)), `${write} runs from its dialog`);
  }
});
