// D1221 (#2458) — Calls for Capital (CLS1–CLS15): the page Raise's "Calls" tab
// opens is Capital relationships' Calls tab, off and on; one sent call at its
// address below it; a call's amounts are Indicated, never committed; and
// "Not read here yet" on readiness, delivery and co-founders — never a zero.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calls_for_capital_d1221.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CallsTab from '../src/pages/raise/calls/CallsTab.jsx';
import { LIST_PATH, READINESS, callHref, callRow, callsState, stateWord } from '../src/pages/raise/calls/callsModel.js';
import { CYCLES } from '../src/pages/cycles/cycleModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (calls) => renderToStaticMarkup(h(MemoryRouter, null, h(CallsTab, { calls })));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a sent call and a draft both open under Calls (D1224), a bad uid nowhere', () => {
  assert.equal(callHref({ uid: 'c_1', state: 'sent' }), '/raise/capital-relationships/calls/c_1');
  // D1224 (#3223): a draft opens in the Raise shell too, on the new-call sheet.
  assert.equal(callHref({ uid: 'c_1', state: 'draft' }), '/raise/capital-relationships/calls/c_1');
  assert.equal(callHref({ uid: '../x', state: 'sent' }), LIST_PATH);
  assert.deepEqual(['draft', 'awaiting_counsel', 'open', 'expired', 'closed', 'odd'].map(stateWord), ['Draft', 'Awaiting counsel', 'Open', 'Expired', 'Closed', 'Not recorded']);
});

test('the page state: off, unreadable, empty or the list; a count the read did not return stays null', () => {
  assert.equal(callsState({ enabled: false }).kind, 'off');
  assert.equal(callsState({ state: 'unreadable' }).kind, 'unreadable');
  assert.equal(callsState(undefined).kind, 'unreadable', 'no read is never "none"');
  assert.equal(callsState({ enabled: true, items: [] }).kind, 'empty');
  const r = callRow({ uid: 'a', name: 'Seed', state: 'sent', effective_state: 'open', sent_at: '2026-10-01', amount_cents: 150000000, committed_cents: 10000000, recipients: 12, opened: null });
  assert.equal(r.state, 'Open', 'the effective state wins');
  assert.equal(r.opened, null);
  assert.equal(r.indicatedCents, 10000000);
  assert.equal(callRow({ uid: 'b' }).name, 'Untitled call');
});

test('the readiness list is the canvas’s seven', () => {
  // D1223 (#3222): readiness, delivery and co-founders are read now (D1222), so the waits are gone.
  assert.deepEqual(READINESS, ['Round target', 'Round terms', 'Pitch deck version', 'Data room', 'Use of funds', 'Traction', 'Target close']);
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('switched off (CLS1): what a call is, why it is off, New call disabled with its reason, and readiness waits', () => {
  const out = html({ enabled: false });
  assert.match(out, /Calls for Capital/);
  assert.match(out, /private invitation to verified investors/);
  assert.match(out, /#1008, item 19/);
  assert.match(out, /<button[^>]*disabled=""[^>]*data-testid="calls-new"/);
  assert.ok(!out.includes('Coming soon'), 'the one-line "Coming soon" is gone');
  // D1223: the readiness card draws D1222's read (calls_page_d1223 holds its items).
  assert.ok(out.includes('data-testid="calls-readiness"'));
});

test('the list (CLS2): every count the read carries, Indicated never Committed, each sent call at its address', () => {
  const out = html({ enabled: true, items: [
    { uid: 'c1', name: 'Seed round', state: 'sent', effective_state: 'open', sent_at: '2026-10-01', target_close: '2026-12-15', amount_cents: 150000000, committed_cents: 10000000, recipients: 12, opened: 9, data_room_requests: 4, responded: 3, unanswered_questions: 2 },
    { uid: 'd1', name: 'Draft call', state: 'draft', amount_cents: 50000000, committed_cents: 0 },
  ] });
  assert.ok(out.includes('href="/raise/capital-relationships/calls/c1"'));
  assert.ok(out.includes('href="/raise/capital-relationships/calls/d1"'));
  assert.match(out, /Indicated/);
  assert.ok(!/committed/i.test(out.replace(/not payments or commitments/, '')), 'no amount is called committed');
  // D1223: the canvas's table (CLS2); an open call keeps New call off until it closes.
  assert.match(out, /One call at a time\. Seed round is open\./);
});

test('empty and unreadable say so; neither draws a list', () => {
  assert.match(html({ enabled: true, items: [] }), /No call for capital yet/);
  const bad = html({ state: 'unreadable' });
  assert.match(bad, /could not be read/);
  assert.ok(!bad.includes('calls-list'));
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: Raise’s Calls tab, the one-call route, the redirect, the tab body, the canvas and the docs', () => {
  assert.deepEqual([CYCLES.raise.history.path, CYCLES.raise.history.hash], ['/raise/capital-relationships/calls', '']);
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/raise/capital-relationships/calls/:uid" element={guard(labRoles(['admin', 'founder']), <RaiseCallPage />)} />`));
  assert.ok(app.includes('<HistoryRedirect to="/raise/capital-relationships/calls" hash="" />'));
  assert.ok(read('frontend/src/pages/raise/caprel/CapRelTool.jsx').includes('<CallsTab calls={read.data?.parts?.calls}'));
  assert.ok(read('frontend/src/pages/founder/RoundCallPage.jsx').includes("'/raise/capital-relationships/calls/'+encodeURIComponent(uid)"));
  for (const f of ['Calls for Capital Page.dc.html', 'Calls for Capital · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/Calls for Capital · Boards.dc.html').includes('name="Calls for Capital Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1221.md'));
  assert.ok(existsSync('documentation/audits/CALLS_FOR_CAPITAL_MAP_2026-10-26.md'));
});
