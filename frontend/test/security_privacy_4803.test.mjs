/**
 * D4803 (#4803, slice 3) — Security v2's Privacy workspace (SE06a–d, SE11d),
 * read the way a person reads it:
 *   - the pure model with payloads shaped like `/overview`'s `dsr`;
 *   - server renders of the workspace in its states;
 *   - a mounted journey: choose a request, read its detail, open Record
 *     outcome (the dialog's own rules are in `admin_ops_d4675.test.mjs`).
 *
 * The rules under test: the due date is a date (received + 30 days, from the
 * server), an unknown clock is Unknown and never "0 days"; a figure whose read
 * did not answer is Unavailable, not 0; Withdrawn is the requester's act;
 * closing records a decision and erases nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import {
  closeResultOf, closedState, dayOf, dsrLabel, dsrRows, dsrSummary, dueDayOf, historyOf, nextAction, openState, remainingOf,
} from '../src/pages/hq/security/privacyModel.js';
import PrivacyWorkspace, { DsrDetail } from '../src/pages/hq/security/PrivacyWorkspace.jsx';
import { SecurityConsole, UNAVAILABLE } from '../src/pages/hq/SecurityPage.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);

// ───────────────────────────────────────────────────────────── fixtures ──

const OPEN = (over = {}) => ({
  id: 2214, email: 'founder@lumen.example', name: null, role: 'founder', kind: 'erasure',
  requested_at: '2026-10-20 10:14:00', request_id: 31, days_left: 12, deadline_at: '2026-11-19T10:14:00.000Z',
  prior_requests: 0, last_outcome: null, last_outcome_at: null, ...over,
});
const RECENT = (rows) => ({ available: true, window_days: 90, truncated: false, rows });
const CLOSED = (over = {}) => ({
  id: 28, user_id: 900, email: 'lp@fund.example', name: 'Lee P.', requested_at: '2026-09-01 08:00:00', outcome: 'fulfilled',
  closed_at: '2026-09-20 12:00:00', closed_by: 'ops@axal.vc', close_reason: 'records purged, ticket DSR-14', ...over,
});
const DSR = (over = {}) => ({
  available: true, clock_days: 30, kinds: [], by_branch: [], ledger_available: true,
  rows: [OPEN()],
  recent: RECENT([CLOSED(), CLOSED({ id: 29, outcome: 'withdrawn', closed_by: null, close_reason: null, closed_at: '2026-10-01 09:00:00' })]),
  ...over,
});

// ──────────────────────────────────────────────────────────────── model ──

test('dates are dates, and the remaining time says overdue, today, or unknown — never 0 for unknown', () => {
  assert.equal(dsrLabel(31), 'DSR-0031');
  assert.equal(dsrLabel(null), null);
  assert.equal(dayOf('2026-10-20 10:14:00'), '20 Oct 2026');
  assert.equal(dueDayOf('2026-11-19T10:14:00.000Z'), 'Thu 19 Nov 2026');
  assert.equal(dueDayOf(null), null);
  assert.equal(remainingOf(12), '12 days');
  assert.equal(remainingOf(1), '1 day');
  assert.equal(remainingOf(0), 'Due today');
  assert.equal(remainingOf(-1), 'Overdue by 1 day');
  assert.equal(remainingOf(-3), 'Overdue by 3 days');
  assert.equal(remainingOf(null), 'Unknown');
});

test('states: open, due soon, overdue and unknown; closed outcomes, withdrawn as the requester\'s', () => {
  assert.equal(openState(OPEN()).state, 'pending');
  assert.deepEqual(openState(OPEN({ days_left: 7 })), { state: 'action_required', word: 'Due soon' });
  assert.deepEqual(openState(OPEN({ days_left: -2 })), { state: 'action_required', word: 'Overdue' });
  assert.equal(openState(OPEN({ days_left: null })).state, 'unknown');
  assert.equal(closedState('fulfilled').state, 'verified');
  assert.equal(closedState('withdrawn').word, 'Withdrawn');
  assert.equal(closedState('mystery').state, 'unknown');
  const rows = dsrRows(DSR());
  const w = rows.find((r) => r.raw.outcome === 'withdrawn');
  assert.equal(w.closedBy, 'The requester', 'a withdrawal was credited to someone else');
});

test('rows: open first, soonest due first, unknown due last; then closed', () => {
  const rows = dsrRows(DSR({ rows: [OPEN({ id: 1, days_left: 20 }), OPEN({ id: 2, days_left: null }), OPEN({ id: 3, days_left: -1 })] }));
  assert.deepEqual(rows.map((r) => [r.open, r.userId]), [[true, 3], [true, 1], [true, 2], [false, 900], [false, 900]]);
  assert.deepEqual(dsrRows({ available: false, reason: 'x' }), []);
});

test('the summary counts only what was read, and says so when it was not', () => {
  const s = dsrSummary(DSR({ rows: [OPEN({ days_left: 3 }), OPEN({ id: 5, days_left: -1, deadline_at: '2026-11-08T00:00:00Z' }), OPEN({ id: 6, days_left: null })] }));
  assert.deepEqual([s.open, s.dueSoon, s.overdue, s.unknownDue], [3, 1, 1, 1]);
  assert.equal(s.nextDue, 'Sun 8 Nov 2026', 'the next due date is not the soonest');
  assert.deepEqual([s.closed, s.closedByHq, s.withdrawn], [2, 1, 1]);
  const lost = dsrSummary(DSR({ recent: { available: false, reason: 'No ledger.' } }));
  assert.equal(lost.closed, null, 'an unreadable history read as 0 closed');
  assert.equal(lost.recentReason, 'No ledger.');
  const none = dsrSummary({ available: false, reason: 'down' });
  assert.deepEqual([none.open, none.dueSoon, none.overdue], [null, null, null], 'an unreadable list read as zeros');
});

test('history: received, earlier requests (unknown when the ledger is unreadable), and who closed it', () => {
  const [open] = dsrRows(DSR({ rows: [OPEN({ prior_requests: 2, last_outcome: 'denied', last_outcome_at: '2026-08-01 10:00:00' })] }));
  const hist = historyOf(open).map((x) => x.text);
  assert.match(hist[0], /Request received/);
  assert.match(hist[1], /2 earlier requests from this subject, the last closed as Denied on 1 Aug 2026/);
  const [unread] = dsrRows(DSR({ rows: [OPEN({ prior_requests: null })] }));
  assert.match(historyOf(unread)[1].text, /unknown/, 'an unreadable ledger read as "never asked before"');
  const [first] = dsrRows(DSR({ rows: [OPEN()] }));
  assert.equal(historyOf(first).length, 1, 'a first request drew an earlier-request line');
  const closed = dsrRows(DSR()).filter((r) => !r.open);
  assert.match(historyOf(closed[0]).at(-1).text, /Closed as Fulfilled by ops@axal.vc: records purged/);
  assert.match(historyOf(closed[1]).at(-1).text, /^Withdrawn by the requester$/);
  assert.match(nextAction(dsrRows(DSR({ rows: [OPEN({ days_left: -1 })] }))[0]), /legal due date has passed/);
});

test('a close\'s answer is done, unconfirmed, changed or refused — and only certain refusals are certain', () => {
  assert.equal(closeResultOf({ ok: true }, null).result, 'done');
  assert.equal(closeResultOf({ code: 'outcome_unconfirmed', error: 'x' }, null).result, 'unconfirmed');
  assert.equal(closeResultOf(null, new TypeError('Failed to fetch')).result, 'unconfirmed');
  assert.equal(closeResultOf(null, Object.assign(new Error('x'), { status: 503, code: 'ledger_unavailable' })).result, 'unconfirmed');
  const gone = closeResultOf(null, Object.assign(new Error('Nothing was recorded.'), { status: 409, code: 'no_open_request', data: { last_outcome: 'fulfilled', last_outcome_at: '2026-11-09 14:28:00' } }));
  assert.equal(gone.result, 'changed');
  assert.match(gone.now.line, /Fulfilled by another admin at Mon 9 Nov 2026, 14:28 UTC/);
  const step = closeResultOf(null, Object.assign(new Error('TOTP required'), { status: 403, code: 'totp_required' }));
  assert.equal(step.result, 'refused');
  assert.match(step.message, /authenticator app/);
});

// ───────────────────────────────────────────────────────────── renders ──

test('the workspace: four figures, the table with dates, the rule, and phone cards from the same rows', () => {
  const out = html(h(PrivacyWorkspace, { dsr: DSR() }));
  for (const id of ['dsr-summary', 'dsr-open', 'dsr-due-soon', 'dsr-overdue', 'dsr-closed', 'dsr-table', 'dsr-cards']) {
    assert.match(out, new RegExp(`data-testid="${id}"`), `${id} is missing`);
  }
  const t = renderedText(out);
  assert.match(t, /next due Thu 19 Nov 2026/);
  assert.match(t, /1 closed by HQ · 1 withdrawn/);
  assert.match(t, /DSR-0031/);
  assert.match(t, /Due date = received \+ 30 days/);
  assert.equal((out.match(/data-state="measured_zero"/g) || []).length >= 2, true, 'a real zero (due soon, overdue) is not drawn as one');
});

test('unreadable list, unreadable history and an empty, measured list are three different things', () => {
  const u = renderedText(html(h(PrivacyWorkspace, { dsr: DSR({ available: false, rows: [], reason: 'The open erasure requests could not be read.' }) })));
  assert.match(u, /could not be read/);
  assert.doesNotMatch(u, /No request is open/);
  const lost = html(h(PrivacyWorkspace, { dsr: DSR({ recent: { available: false, reason: 'No ledger.' } }) }));
  assert.match(lost, /data-testid="dsr-recent-unreadable"/);
  assert.match(lost, /data-testid="dsr-closed"[\s\S]*?Unavailable/);
  const empty = renderedText(html(h(PrivacyWorkspace, { dsr: DSR({ rows: [], recent: RECENT([]) }) })));
  assert.match(empty, /No request is open, and none was closed in the last 90 days/);
  assert.match(renderedText(html(h(PrivacyWorkspace, { dsr: null, unreadable: true, onReread() {} }))), /not a claim that none are open or overdue/);
  assert.match(html(h(PrivacyWorkspace, { dsr: null })), /data-testid="privacy-reading"/);
});

test('the detail: lifecycle, facts, the no-erase warning and Record outcome; a closed one has no action', () => {
  const [open, closed] = dsrRows(DSR());
  const out = renderedText(html(h(DsrDetail, { row: open, onRecord() {}, onBack() {} })));
  assert.match(out, /Tue 20 Oct 2026, 10:14 UTC/);
  assert.match(out, /HQ-held account · user 2214/);
  assert.match(out, /Closing records a decision\. It does not erase data\./);
  assert.match(out, /Record outcome…/);
  assert.match(out, /views are not listed/);
  const c = html(h(DsrDetail, { row: closed, onRecord() {}, onBack() {} }));
  assert.doesNotMatch(c, /dsr-record/, 'a closed request offers Record outcome');
  assert.match(renderedText(c), /Closed byops@axal.vc|Closed by\s*ops@axal\.vc/);
});

const consoleHtml = (tab, data) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [`/admin/security?tab=${tab}`] },
    h(SecurityConsole, {
      tab, data, load: () => {}, feed: null, filter: 'all', setFilter: () => {},
      loadFeed: () => {}, sessionList: null, loadSessions: () => {}, onSessionAct: async () => ({}),
    })),
);

test('on the page: Privacy leads, the old zone is behind the disclosure with no second close control', () => {
  const out = consoleHtml('privacy', { dsr: DSR() });
  assert.ok(out.indexOf('privacy-workspace') < out.indexOf('privacy-how'));
  assert.ok(out.indexOf('privacy-how') < out.indexOf('data-testid="hq-dsr"'), 'the previous zone is not behind the disclosure');
  assert.doesNotMatch(out, /hq-dsr-actions|Record as fulfilled/, 'the old inline close is still offered beside the dialog');
  const t = renderedText(consoleHtml('privacy', UNAVAILABLE));
  const lead = t.slice(0, t.indexOf('How this is measured') >= 0 ? t.indexOf('How this is measured') : t.length);
  assert.match(lead, /data subject requests could not be read/i);
  assert.doesNotMatch(lead, /not a claim that nothing happened/, 'the page banner was drawn as well');
});

// ───────────────────────────────────────────────────── mounted journey ──

test('choose a request, read its detail, open Record outcome; on phone the list gives way to the detail', async () => {
  const restore = installDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const button = (text) => walk(document.body).find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === text);
  const click = async (n) => { assert.ok(n && props(n)?.onClick, 'nothing to click'); await act(async () => { props(n).onClick({ preventDefault() {} }); }); };
  try {
    await act(async () => { root.render(h(PrivacyWorkspace, { dsr: DSR(), send: async () => ({ ok: true }) })); });
    assert.equal(byId('dsr-detail'), undefined);
    await click(button('DSR-0031'));
    assert.ok(byId('dsr-detail'), 'choosing a request drew no detail');
    assert.match(String(props(byId('dsr-list')).className), /hidden md:flex/, 'on phone the list stays beside the detail');
    await click(byId('dsr-record'));
    assert.ok(byId('dsr-dialog'), 'Record outcome opened no dialog');
    assert.match(textOf(byId('dsr-scope')), /Records Fulfilled against DSR-0031/);
    await click(byId('action-close'));
    assert.equal(byId('dsr-dialog'), undefined);
    await click(byId('dsr-back'));
    assert.equal(byId('dsr-detail'), undefined, '‹ Privacy did not go back to the list');
  } finally {
    await act(async () => root.unmount());
    restore();
  }
});
