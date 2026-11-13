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
    state: { data: d, q: '', filter: 'all', sort: 'latest', page: 0, busy: false, error: '', message: '', answers: {}, target: '', extending: false, ...s }, on })));
  return { html, text: renderedText(html) };
};

// D1225 (#3224) redrew the page to CLS8–CLS11 and CLS14: its responses,
// filters, banners, questions and dialogs are pinned in
// `frontend/test/raise_call_page_d1225.test.mjs`. The route, the redirects and
// the sheet stay pinned here.

test('the route sits in the Raise shell; a founder at /round-calls/:uid is sent there, others stay', () => {
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  // D1227 (#3226): the page lives at Capital relationships › Calls; /raise/calls/:uid forwards there.
  assert.match(app, /<Route path="\/raise\/capital-relationships\/calls\/:uid" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <RaiseCallPage \/>\)\} \/>/);
  assert.ok(app.indexOf('<Route path="/raise/capital-relationships/calls/:uid"') < app.indexOf('<Route path="/raise/:slug"'), 'declared beside the module route');
  const page = readFileSync('frontend/src/pages/founder/RaiseCallPage.jsx', 'utf8');
  assert.match(page, /<CycleHeader cycle="raise" cards=\{cards\} active="capital-relationships"/);
  assert.match(page, /<RailFrame rail=\{rail\}/);
  assert.match(page, /if \(d && d\.viewer !== 'founder'\) return <Navigate to=\{`\/round-calls\/\$\{encodeURIComponent\(uid\)\}`\} replace \/>;/);
  const old = readFileSync('frontend/src/pages/founder/RoundCallPage.jsx', 'utf8');
  // D1227 (#3226): the sent call's address is under Capital relationships › Calls.
  assert.match(old, /to=\{\(projectId&&call\.state!=='draft'\?'\/raise\/capital-relationships\/calls\/':'\/round-calls\/'\)\+call\.uid\}/, 'the founder\'s list opens a sent call in the Raise shell, and a draft on its own page, where Continue draft is');
  // D1221 (#2458): a founder's sent call opens at its address under Capital relationships › Calls (CLS8).
  // D1224 (#3223): a draft too; the shell's page opens the new-call sheet on it.
  assert.match(old, /if\(read\.data\?\.viewer==='founder'\)return <Navigate to=\{'\/raise\/capital-relationships\/calls\/'\+encodeURIComponent\(uid\)\} replace\/>;/);
  assert.match(page, /continueDraft: \(\) => setSheet\(\{ initialCall: read\.data\?\.call \|\| null \}\)/, 'the Draft state\'s Continue draft opens the sheet on the draft');
  const sheet = readFileSync('frontend/src/pages/founder/RoundCallSheet.jsx', 'utf8');
  assert.match(sheet, /<Link className=\{primary\} to=\{callHref\(call\)\}>Open the call<\/Link>/, 'the open-call notice opens the call under Calls');
  assert.equal((sheet.match(/to=\{callHref\(\{uid:s\.uid,state:'sent'\}\)\}/g) || []).length, 2, 'the send result\'s See who and Open the call open it under Calls');
  assert.doesNotMatch(sheet, /'\/round-calls\/'\+/);
});

// ── S1 review of #1598 ───────────────────────────────────────────────────────

test('money reads "$100,000", and "$1,234.50" only when there are cents', async () => {
  const { moneyCents } = await import('../src/pages/founder/roundCallParts.jsx');
  assert.deepEqual([moneyCents(10000000), moneyCents(123450), moneyCents(0), moneyCents(null)], ['$100,000', '$1,234.50', '$0', 'Not recorded']);
});

test('Continue draft reads the call\'s page, so its approval and recorded audience come back; the deck row says Change; the flags are frozen', async () => {
  const src = readFileSync('frontend/src/pages/founder/RoundCallSheet.jsx', 'utf8');
  assert.match(src, /if\(initialCall\)return \{page:await roundCallsApi\.page\(initialCall\.uid\)\};/);
  const sheet = await import('../src/pages/founder/RoundCallSheet.jsx');
  assert.equal(Object.isFrozen(sheet.CALL_FIELDS), true);
  const deck = { id: 4, version: 4, title: 'Deck', created_at: '2098-10-12' };
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(sheet.RoundCallSheetView, { on: new Proxy({}, { get: () => () => {} }), state: {
    step: 1, fields: { name: 'n', amount: '1', instrument: 'safe', terms: 't', minimum: '1', target: '2099-01-01', deck_id: '4', room: false },
    context: { project: { id: 1, name: 'V' }, decks: [deck], chosen: [], data_room: null }, chosen: [], includeMatches: false, matches: null, page: null,
    busy: false, error: '', outcome: null, uid: 'c', editing: null, choosing: false, note: null, projectId: 1 } })));
  // D1224: the canvas's deck card, frozen when sent, with Change version.
  assert.match(html, /Deck · v4 · frozen when sent<\/p>[\s\S]*<button type="button"[^>]*>Change version<\/button>/);
  assert.doesNotMatch(html, />Edit<\/button>/);
});
