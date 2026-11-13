/**
 * D1223 (#3222, part 2 of #2458) — the Calls for Capital page complete, off and
 * on (CLS1–CLS3, CLS12, CLS15):
 *
 *   - CLS1: each readiness item's state from D1222's read, each opening its
 *     tool; New call disabled with its reason;
 *   - CLS2: the canvas's table with the not-delivered count, the open call's
 *     strip; CLS3 empty; CLS12 loading and errors, each read failing alone;
 *   - CLS15: cards below `md`, the table above;
 *   - a call's amounts are Indicated, never Committed, and no count is drawn
 *     as 0 when the read did not return it.
 *
 * Every name and figure here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/calls_page_d1223.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import CallsTab from '../src/pages/raise/calls/CallsTab.jsx';
import {
  READINESS_TOOL, callRow, callsState, daysUntil, indicatedPct, newCallState, notDeliveredLine, notDeliveredTotal, openStrip, readinessView,
} from '../src/pages/raise/calls/callsModel.js';

const h = React.createElement;

// D1222's readiness answer for a venture with no use of funds or traction yet.
const READY = () => ({
  project_id: 7, enabled: false, ready: 4, counted: 6,
  items: [
    { key: 'round', label: 'Round target', ready: true, reason: null },
    { key: 'terms', label: 'Round terms', ready: null, reason: 'Round terms are written in the call itself.' },
    { key: 'deck', label: 'Pitch deck version', ready: true, reason: null },
    { key: 'data_room', label: 'Data room', ready: true, reason: null },
    { key: 'use_of_funds', label: 'Use of funds', ready: false, reason: null },
    { key: 'traction', label: 'Traction', ready: false, reason: null },
    { key: 'close', label: 'Target close', ready: true, reason: null },
  ],
});

// `parts.calls` with calls on: an open call, a draft (whose COUNTs the read returns as 0) and a closed one.
const SENT = { uid: 'c_open', name: 'Seed extension', state: 'sent', effective_state: 'open', sent_at: '2026-10-01', target_close: '2026-11-15', amount_cents: 150000000, committed_cents: 40000000, recipients: 30, opened: 21, data_room_requests: 6, responded: 9, not_delivered: 1, unanswered_questions: 2 };
const DRAFT = { uid: 'c_draft', name: 'Bridge', state: 'draft', sent_at: null, target_close: '2027-01-31', amount_cents: 50000000, committed_cents: 0, recipients: 0, opened: 0, data_room_requests: 0, responded: 0, not_delivered: null, unanswered_questions: 0 };
const CLOSED = { uid: 'c_closed', name: 'Seed', state: 'closed', sent_at: '2026-06-02', target_close: '2026-06-30', amount_cents: 120000000, committed_cents: 90000000, recipients: 22, opened: 17, data_room_requests: 5, responded: 8, not_delivered: 0, unanswered_questions: 0 };
const ON = (items = [SENT, DRAFT, CLOSED]) => ({ enabled: true, items });

const ssr = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(CallsTab, { readiness: READY(), projectId: 7, today: '2026-10-21', ...props })));

async function mount(props) {
  const restore = installDocument();
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, h(CallsTab, props))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, text: (n = container) => txt(n).replace(/\s+/g, ' ').trim(),
    async clickText(label) {
      const btn = walk(container).find((n) => n.tagName?.toLowerCase() === 'button' && txt(n).trim() === label);
      if (!btn) throw new Error(`No button ${label}`);
      await act(async () => { await pr(btn).onClick?.({ preventDefault() {} }); }); await settle();
    },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

// ------------------------------------------------------------------ the model

test('a call not yet sent draws no count, and never the 0 the read returns for it', () => {
  const d = callRow(DRAFT);
  for (const k of ['indicatedCents', 'recipients', 'opened', 'dataRoom', 'responded', 'notDelivered', 'unanswered']) assert.equal(d[k], null, k);
  assert.equal(d.targetCents, 50000000, 'the target is the call\'s own, sent or not');
  const s = callRow(SENT);
  assert.deepEqual([s.recipients, s.opened, s.dataRoom, s.responded, s.notDelivered, s.unanswered, s.indicatedCents], [30, 21, 6, 9, 1, 2, 40000000]);
  assert.equal(callRow({ ...SENT, not_delivered: null }).notDelivered, null, 'a count the read did not return stays null');
});

test('not delivered: summed over the calls that returned it, null when none did', () => {
  const rows = callsState(ON()).rows;
  assert.equal(notDeliveredTotal(rows), 1);
  assert.equal(notDeliveredLine(rows), '1 invitation could not be delivered on Axal. Open the call to see which.');
  assert.equal(notDeliveredTotal(callsState(ON([DRAFT])).rows), null, 'a draft has sent nothing: no total, never 0');
  assert.equal(notDeliveredLine(callsState(ON([DRAFT])).rows), null);
  assert.equal(notDeliveredLine(callsState(ON([CLOSED])).rows), 'Every invitation your calls sent was delivered on Axal.');
  assert.equal(notDeliveredLine(callsState(ON([SENT, { ...CLOSED, not_delivered: 2 }])).rows), '3 invitations could not be delivered on Axal. Open the call to see which.');
});

test('New call: on, or off with its one reason', () => {
  assert.deepEqual(newCallState(callsState({ enabled: false })), { enabled: false, reason: 'Calls are not switched on yet.' });
  assert.deepEqual(newCallState(callsState(ON())), { enabled: false, reason: 'One call at a time. Seed extension is open.' });
  assert.deepEqual(newCallState(callsState(ON([DRAFT, CLOSED]))), { enabled: true, reason: null });
  assert.deepEqual(newCallState(callsState({ enabled: true, items: [] })), { enabled: true, reason: null });
  assert.equal(newCallState(callsState({ state: 'unreadable' })).reason, 'New call stays off until the calls can be read.');
  assert.equal(newCallState({ kind: 'loading', rows: [] }, 'loading').reason, 'New call waits until your calls are read.');
  assert.equal(newCallState({ kind: 'unreadable', rows: [] }, 'unreadable').enabled, false);
});

test('the open call\'s strip: Indicated of target, responses, questions and days to close', () => {
  const s = openStrip(callsState(ON()).rows, '2026-10-21');
  assert.deepEqual({ ...s }, { name: 'Seed extension', sent: '2026-10-01', indicatedCents: 40000000, targetCents: 150000000, pct: 27, responses: '9 of 30', unanswered: 2, closesIn: '25 days', close: '2026-11-15' });
  assert.equal(openStrip(callsState(ON([DRAFT, CLOSED])).rows), null, 'no open call, no strip');
  assert.equal(daysUntil('2026-10-22', '2026-10-21'), 1);
  assert.equal(daysUntil('not a date', '2026-10-21'), null);
  assert.equal(openStrip(callsState(ON([{ ...SENT, target_close: '2026-10-21' }])).rows, '2026-10-21').closesIn, 'Closes today');
  assert.equal(indicatedPct({ indicatedCents: null, targetCents: 100 }), null);
  assert.equal(indicatedPct({ indicatedCents: 50, targetCents: 0 }), null, 'no target, no percentage');
  assert.equal(openStrip(callsState(ON([{ ...SENT, responded: null }])).rows, '2026-10-21').responses, null);
});

test('readiness: each item ready, missing or set in the call, opening its tool for this venture; the Worker\'s count', () => {
  const v = readinessView({ status: 'ready', data: READY() }, 7);
  assert.equal(v.summary, '4 of 6 ready');
  assert.deepEqual(v.items.map((i) => [i.key, i.word]), [
    ['round', 'Ready'], ['terms', 'Set in the call'], ['deck', 'Ready'], ['data_room', 'Ready'], ['use_of_funds', 'Missing'], ['traction', 'Missing'], ['close', 'Ready'],
  ]);
  assert.equal(v.items.find((i) => i.key === 'use_of_funds').href, '/raise/use-of-funds?project_id=7');
  assert.equal(v.items.find((i) => i.key === 'traction').tool, 'Fundraising readiness');
  assert.equal(v.items.find((i) => i.key === 'terms').reason, 'Round terms are written in the call itself.');
  for (const k of ['round', 'terms', 'deck', 'data_room', 'use_of_funds', 'traction', 'close']) assert.ok(READINESS_TOOL[k], k);
  assert.equal(readinessView({ status: 'ready', data: READY() }, 'x').items[0].href, '/raise/capital-relationships/commitments', 'a bad venture id is not carried');
  assert.equal(readinessView({ status: 'ready', data: { ...READY(), counted: undefined } }).summary, null, 'no count the Worker did not send');
  assert.equal(readinessView({ status: 'ready', data: {} }).status, 'unreadable');
  assert.equal(readinessView({ status: 'unreadable' }).status, 'unreadable');
  assert.equal(readinessView({ status: 'loading' }).status, 'loading');
});

// ------------------------------------------------------------------ rendered

test('CLS1, switched off: the banner, what a call does, Get ready with each item\'s state and tool, Meanwhile, New call off with its reason', () => {
  const out = ssr({ calls: { enabled: false } });
  assert.match(out, /Calls for Capital are not switched on yet/);
  assert.match(out, /<button[^>]*disabled=""[^>]*data-testid="calls-new"/);
  assert.match(out, /data-testid="calls-new-reason">Calls are not switched on yet\.</);
  assert.match(out, /data-testid="calls-readiness-count">4 of 6 ready</);
  assert.match(out, /data-testid="calls-ready-state-use_of_funds">Missing</);
  assert.match(out, /data-testid="calls-ready-state-deck">Ready</);
  assert.match(out, /data-testid="calls-ready-state-terms">Set in the call</);
  assert.ok(out.includes('data-testid="calls-ready-open-use_of_funds" href="/raise/use-of-funds?project_id=7"'));
  assert.ok(out.includes('Counsel checks the terms, then you send'));
  assert.ok(out.includes('data-testid="calls-meanwhile"'));
  assert.ok(!out.includes('Not read here yet'), 'readiness is read now');
});

test('CLS2, the list: the strip, the canvas\'s columns, the not-delivered count; Indicated, never Committed; no 0 for a draft', () => {
  const out = ssr({ calls: ON() });
  for (const col of ['Call', 'State', 'Sent', 'Closes', 'Recipients', 'Opened', 'Data room', 'Indicated', 'Questions waiting']) assert.ok(out.includes(`>${col}</th>`), col);
  assert.match(out, /data-testid="calls-strip-responses".*9 of 30/);
  assert.match(out, /data-testid="calls-strip-closes".*25 days/);
  assert.match(out, /data-testid="calls-not-delivered">1 invitation could not be delivered on Axal/);
  assert.match(out, /data-testid="calls-row-not-delivered-c_open">1 not delivered</);
  assert.ok(!out.includes('calls-row-not-delivered-c_closed'), 'zero failures draw no warning');
  assert.ok(!/committed/i.test(out.replace(/not payments or commitments/, '')), 'no amount is called committed');
  const draft = out.slice(out.indexOf('data-testid="calls-row-c_draft"'), out.indexOf('data-testid="calls-row-c_closed"'));
  assert.ok(draft.includes('Not sent'));
  assert.doesNotMatch(draft, />0</, 'a draft draws no 0 for a count it has not got');
  assert.match(out, /data-testid="calls-new-reason">One call at a time\. Seed extension is open\.</);
  assert.ok(out.includes('href="/raise/capital-relationships/calls/c_open"'));
  assert.ok(out.includes('Readiness for the next call'));
});

test('CLS3 empty: the card with New call beside Get ready; New call on', () => {
  const out = ssr({ calls: { enabled: true, items: [] } });
  assert.match(out, /No call for capital yet\./);
  assert.ok(out.includes('data-testid="calls-empty-new"'));
  assert.ok(out.includes('data-testid="calls-new" href="/raise/call"'));
  assert.ok(out.includes('data-testid="calls-readiness"'));
});

test('CLS12: loading reads "Reading…" with New call off; a failed calls read keeps readiness and says New call stays off', () => {
  const loading = ssr({ calls: undefined, status: 'loading' });
  assert.match(loading, /data-testid="calls-loading"/);
  assert.match(loading, /Reading…/);
  assert.match(loading, /New call waits until your calls are read\./);
  const failed = ssr({ calls: undefined, status: 'unreadable' });
  assert.match(failed, /data-testid="calls-unreadable"/);
  assert.match(failed, /This is not a claim that there are none\./);
  assert.match(failed, /New call stays off until the calls can be read\./);
  assert.ok(failed.includes('data-testid="calls-readiness"'), 'one failed read never blanks the page');
  assert.ok(!failed.includes('calls-list'));
  assert.match(ssr({ calls: { state: 'unreadable' } }), /data-testid="calls-unreadable"/);
});

test('CLS15, the phone: cards below md, the table above, each row at least 44px', () => {
  const out = ssr({ calls: ON() });
  assert.match(out, /class="hidden overflow-x-auto md:block"/);
  assert.match(out, /data-testid="calls-cards"/);
  assert.match(out, /class="[^"]*md:hidden[^"]*" data-testid="calls-cards"/);
  assert.match(out, /data-testid="calls-card-c_open"[\s\S]*?\$400,000 indicated of \$1,500,000 · 9 of 30 went past opening · 1 not delivered/);
  assert.match(out, /data-testid="calls-card-c_draft"[\s\S]*?Target \$500,000 · not sent/);
  assert.match(out, /min-h-\[44px\][^"]*" data-testid="calls-ready-round"/);
});

test('mounted: readiness is read for the venture, and a failed read says so and reads again on Retry', async () => {
  let calls = 0; let fail = true;
  const loadReadiness = async (projectId) => { calls += 1; assert.equal(projectId, 7); if (fail) throw new Error('down'); return READY(); };
  const m = await mount({ calls: { enabled: false }, projectId: 7, loadReadiness });
  assert.equal(calls, 1);
  assert.ok(m.by('calls-readiness-unreadable'));
  assert.ok(m.by('calls-off'), 'the calls still draw');
  fail = false;
  await m.clickText('Retry');
  assert.equal(calls, 2);
  assert.equal(m.text(m.by('calls-ready-state-traction')), 'Missing');
  await m.unmount();
});

test('the page passes the dark-mode guard, and CapRelTool hands it the read state and the venture', () => {
  execFileSync(process.execPath, ['scripts/check-dark-mode.mjs'], { stdio: 'pipe' });
  const tool = readFileSync('frontend/src/pages/raise/caprel/CapRelTool.jsx', 'utf8');
  assert.ok(tool.includes('<CallsTab calls={read.data?.parts?.calls} status={read.status} projectId={projectId} onRetry={read.retry} />'));
});
