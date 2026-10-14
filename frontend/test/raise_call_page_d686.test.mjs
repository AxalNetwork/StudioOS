/**
 * D686 §5.6 (#1598), §3.1 item 14 — a founder's Call for Capital inside the
 * Raise shell at /raise/calls/:uid: responses with search, filters, paging and
 * pills, the closed and paused banners, and the redirects between the two
 * addresses.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_call_page_d686.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { RaiseCallView, responseOf, whoOf, visibleRows, callBanner, PAGE_SIZE } from '../src/pages/founder/RaiseCallPage.jsx';

const on = new Proxy({}, { get: () => () => {} });
const call = { uid: 'c1', project_id: 7, name: 'Seed', amount_cents: 50000000, instrument: 'safe', terms: 'Cap $8M', minimum_cheque_cents: 2500000,
  target_close: '2099-01-15', state: 'sent', sent_at: '2098-10-12 09:00:00', closed_at: null };
const chosen = (n, o = {}) => ({ origin: 'chosen', investor_user_id: n, name: `Investor ${n}`, email: `i${n}@example.test`, opened_at: null, data_room_requested_at: null, commitment_cents: null, ...o });
const match = (o = {}) => ({ origin: 'match', opened_at: null, data_room_requested_at: null, commitment_cents: null, ...o });
const progress = { received: 4, opened: 3, data_room_requests: 1, commitments: 1, committed_cents: 10000000, target_cents: 50000000 };
const data = (o = {}) => ({ call, viewer: 'founder', read_only: false, progress, questions: [],
  recipients: [chosen(1, { opened_at: '2098-10-13' }), chosen(2, { opened_at: '2098-10-13', data_room_requested_at: '2098-10-13' }), chosen(3, { opened_at: '2098-10-13', commitment_cents: 10000000 }), match()], ...o });
const view = (d, s = {}) => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(RaiseCallView, {
    state: { data: d, q: '', filter: 'all', page: 0, busy: false, error: '', message: '', answers: {}, target: '', extending: false, ...s }, on })));
  return { html, text: renderedText(html) };
};

test('each response reads as its furthest step, with its pill; a matching investor stays nameless', () => {
  assert.deepEqual(responseOf(chosen(1, { commitment_cents: 10000000 })), { kind: 'committed', text: 'Committed US$100,000.00', pill: 'Committed' });
  assert.deepEqual(responseOf(chosen(1, { committed_at: '2098-10-14', commitment_cents: 10000000 })).text, 'Committed US$100,000.00 · 14 Oct', 'a stored date is drawn');
  assert.deepEqual(responseOf(chosen(1, { data_room_requested_at: '2098-10-13', opened_at: '2098-10-12' })).text, 'Asked for the data room · 13 Oct');
  assert.deepEqual(responseOf(chosen(1, { opened_at: '2098-10-13' })).text, 'Opened · 13 Oct');
  assert.deepEqual(responseOf(chosen(1)).text, 'Not opened yet');
  assert.equal(whoOf(match()), 'Matching investor · name hidden until they respond');
  assert.equal(whoOf(chosen(1)), 'Investor 1 · i1@example.test');
});

test('filters, search and order: committed first, then data room, opened, not opened', () => {
  const rs = data().recipients;
  assert.deepEqual(visibleRows(rs).map((r) => r.investor_user_id ?? 'm'), [3, 2, 1, 'm']);
  assert.deepEqual(visibleRows(rs, { filter: 'committed' }).map((r) => r.investor_user_id), [3]);
  assert.deepEqual(visibleRows(rs, { filter: 'data_room' }).map((r) => r.investor_user_id), [2]);
  assert.deepEqual(visibleRows(rs, { filter: 'opened' }).map((r) => r.investor_user_id), [3, 2, 1]);
  assert.deepEqual(visibleRows(rs, { q: 'i2@example' }).map((r) => r.investor_user_id), [2]);
  assert.deepEqual(visibleRows(rs, { q: 'data room' }).map((r) => r.investor_user_id), [2], 'search reads the response line too');
});

test('the page: sub line, committed of target, rows and pills, paging, footer counts and actions', () => {
  const { html, text } = view(data());
  assert.match(text, /Sent 12 Oct · closes 15 Jan · SAFE · Cap \$8M/);
  assert.match(text, /Committed US\$100,000\.00 of US\$500,000\.00/);
  assert.match(html, /placeholder="Search responses…"/);
  for (const label of ['All', 'Committed', 'Data room', 'Opened']) assert.match(html, new RegExp(`aria-pressed="(true|false)"[^>]*>${label}</button>`));
  assert.match(html, /aria-pressed="true"[^>]*>All<\/button>/);
  assert.match(text, /Investor 3 · i3@example\.testCommitted US\$100,000\.00Committed/);
  assert.match(text, /Matching investor · name hidden until they respondNot opened yetNot opened/);
  assert.match(text, /1–4 of 4/);
  assert.match(text, /Every response is also an entry in Capital relationships\./);
  assert.match(text, /Received 4 · opened 3 · data room 1 · committed 1/);
  assert.match(text, /Extend the date/);
  assert.match(text, /Close the call/);
  const many = data({ recipients: Array.from({ length: PAGE_SIZE + 3 }, (_, i) => chosen(i + 1)) });
  const second = view(many, { page: 1 }).text;
  assert.match(second, /26–28 of 28/);
  assert.match(second, /Investor 26 · /);
  assert.doesNotMatch(second, /Investor 1 · /);
  assert.match(view(data({ recipients: [] })).text, /No recipients are recorded yet\./);
  assert.match(view(data(), { q: 'nobody' }).text, /No response matches\./);
});

test('questions: Unanswered with Answer, or Answered', () => {
  const { text } = view(data({ questions: [{ uid: 'q1', question: 'What is the burn?', name: 'Investor 1', asked_at: '2098-10-13' }, { uid: 'q2', question: 'Pro rata?', answer: 'Yes' }] }));
  assert.match(text, /What is the burn\?Investor 1 · 13 OctUnanswered/);
  assert.match(text, /AnswerAnswer/);
  assert.match(text, /Pro rata\?Answered Yes/);
  const answered = view(data({ questions: [{ uid: 'q2', question: 'Pro rata?', answer: 'Yes' }] })).html;
  assert.doesNotMatch(answered, />Answer<\/button>/, 'an answered question offers no second answer');
});

test('closed, expired and paused calls are read-only, each with its own banner', () => {
  const closed = view(data({ call: { ...call, state: 'closed', closed_at: '2098-11-02 10:00:00' }, read_only: true })).text;
  assert.match(closed, /This call closed on 2 Nov with US\$100,000\.00 committed\. It is read-only\./);
  assert.match(closed, /Open a new call/);
  assert.doesNotMatch(closed, /Extend the date|Close the call/);
  assert.equal(callBanner({ ...call, target_close: '2098-01-15' }, progress, '2098-02-01'), 'This call closed on 15 Jan with US$100,000.00 committed. It is read-only.');
  assert.equal(callBanner(call, progress, '2098-02-01'), null);
  const paused = view(data({ call: { ...call, state: 'awaiting_counsel' }, read_only: true })).text;
  assert.match(paused, /Responses are paused until counsel approves the extended terms/);
  assert.doesNotMatch(paused, /Open a new call|Close the call/);
});

test('the route sits in the Raise shell; a founder at /round-calls/:uid is sent there, others stay', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/raise\/calls\/:uid" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <RaiseCallPage \/>\)\} \/>/);
  assert.ok(app.indexOf('<Route path="/raise/calls/:uid"') < app.indexOf('<Route path="/raise/:slug"'), 'declared beside the module route');
  const page = readFileSync('frontend/src/pages/founder/RaiseCallPage.jsx', 'utf8');
  assert.match(page, /<CycleHeader cycle="raise" cards=\{cards\} active="capital-relationships"/);
  assert.match(page, /<RailFrame rail=\{rail\}/);
  assert.match(page, /if \(d && d\.viewer !== 'founder'\) return <Navigate to=\{`\/round-calls\/\$\{encodeURIComponent\(uid\)\}`\} replace \/>;/);
  const old = readFileSync('frontend/src/pages/founder/RoundCallPage.jsx', 'utf8');
  assert.match(old, /to=\{\(projectId\?'\/raise\/calls\/':'\/round-calls\/'\)\+call\.uid\}/, 'the founder\'s own list opens each call in the Raise shell');
  assert.match(old, /if\(read\.data\?\.viewer==='founder'&&read\.data\.call\.state!=='draft'\)return <Navigate to=\{'\/raise\/calls\/'\+encodeURIComponent\(uid\)\} replace\/>;/);
  const sheet = readFileSync('frontend/src/pages/founder/RoundCallSheet.jsx', 'utf8');
  assert.equal((sheet.match(/to=\{'\/raise\/calls\/'\+/g) || []).length, 2, 'the open-call notice and the outcome link open the Raise page');
  assert.doesNotMatch(sheet, /'\/round-calls\/'\+/);
});
