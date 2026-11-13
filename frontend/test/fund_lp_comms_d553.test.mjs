/**
 * D553 (#1146) — the LP register's type column and filter, the comms log, and
 * "Draft reminder" / "Log as sent" on a capital-call line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  LP_TYPES, LP_TYPE_LABELS, UNTYPED, lpTypeLabel, typeChips, matchesType, reminderSubject, COMM_KIND_LABELS,
} from '../src/pages/investor/fundLpCommsModel.js';
import { LpTypeCell, CommsLog } from '../src/pages/investor/InvestorFundLPs.jsx';
import { LineTable } from '../src/pages/investor/InvestorFundCalls.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the type sets mirror the Worker service and migration 387', () => {
  const svc = read('cloudflare-worker/src/services/fundLpComms.ts');
  // Two literal patterns. A RegExp built from the export's name is what
  // Semgrep's detect-non-literal-regexp reports (alert 6208).
  const quoted = (block) => [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const lp = svc.match(/export const LP_TYPES = \[([^\]]*)\]/);
  const kinds = svc.match(/export const COMM_KINDS = \[([^\]]*)\]/);
  assert.ok(lp, 'LP_TYPES is exported as an array');
  assert.ok(kinds, 'COMM_KINDS is exported as an array');
  assert.deepEqual(LP_TYPES, quoted(lp[1]));
  assert.deepEqual(Object.keys(COMM_KIND_LABELS), quoted(kinds[1]));
});

test('a missing type reads Not recorded, never a guessed type; chips list held types and the untyped', () => {
  assert.equal(lpTypeLabel({ lp_type: 'family_office' }), 'Family office');
  assert.equal(lpTypeLabel({ lp_type: null }), null);
  assert.equal(lpTypeLabel({ lp_type: 'whale' }), null, 'a value outside the set is not shown as a type');
  const rows = [{ lp_type: 'institution' }, { lp_type: null }, { lp_type: 'corporate' }, { lp_type: 'institution' }];
  assert.deepEqual(typeChips(rows), [
    { key: 'institution', label: 'Institution' },
    { key: 'corporate', label: 'Corporate' },
    { key: UNTYPED, label: 'Type not recorded' },
  ]);
  assert.deepEqual(typeChips([{ lp_type: 'corporate' }]), [{ key: 'corporate', label: 'Corporate' }], 'no untyped chip when every LP is typed');
  assert.deepEqual(typeChips([]), []);
  assert.equal(matchesType({ lp_type: null }, UNTYPED), true);
  assert.equal(matchesType({ lp_type: 'corporate' }, UNTYPED), false);
  assert.equal(matchesType({ lp_type: 'corporate' }, 'corporate'), true);
  assert.equal(matchesType({ lp_type: 'corporate' }, 'institution'), false);
});

test('the type cell shows Not recorded and offers every type, with the stored one selected', () => {
  const none = html(h(LpTypeCell, { lp: { id: 7, name: 'Family Co', lp_type: null }, onChange: () => {} }));
  assert.match(none, /data-testid="text-lp-type-7"[^>]*>Not recorded</);
  for (const t of LP_TYPES) {
    assert.ok(none.includes(`<option value="${t}">${LP_TYPE_LABELS[t]}</option>`), t);
  }
  const typed = html(h(LpTypeCell, { lp: { id: 8, name: 'Big Pension', lp_type: 'institution' }, onChange: () => {} }));
  assert.match(typed, /data-testid="text-lp-type-8"[^>]*>Institution</);
  assert.match(typed, /<option value="institution" selected="">Institution<\/option>/);
});

test('the comms log: each state; a failed read is not "nothing was sent"', () => {
  assert.match(html(h(CommsLog, { comms: { status: 'loading', data: null } })), /i6-skeleton/);
  const bad = text(h(CommsLog, { comms: { status: 'unreadable', data: null }, onRetry: () => {} }));
  assert.match(bad, /could not be read\. This is not a claim that nothing was sent/);
  assert.doesNotMatch(bad, /Nothing has been logged/);
  assert.match(text(h(CommsLog, { comms: { status: 'ready', data: { items: [] } } })), /Nothing has been logged as sent on this fund/);
  const ok = text(h(CommsLog, { comms: { status: 'ready', data: { items: [
    { id: 1, sent_at: '2026-10-01 00:00:00', lp_name: 'Family Co', kind: 'call_reminder', subject: 'Reminder: capital call 3', capital_call_id: 901, logged_by_name: 'Gee Pee' },
    { id: 2, sent_at: '2026-09-01 00:00:00', lp_name: null, lp_email: 'x@lp.example', lp_id: 4, kind: 'update', subject: 'Q3 letter', capital_call_id: null, logged_by_name: null },
  ] } } }));
  assert.match(ok, /2026-10-01 Family Co Call reminder Reminder: capital call 3 Line #901 Gee Pee/);
  assert.match(ok, /2026-09-01 x@lp\.example Update Q3 letter None Not recorded/);
  assert.match(ok, /no message body is kept/);
});

const LINES = [
  { id: 900, limited_partner_id: 100, lp_name: 'Ell Pee', state: 'overdue', owed_cents: 100000, received_cents: 25000, commitment_cents: 100000, call_number: 3 },
  { id: 902, limited_partner_id: 102, lp_name: 'Paid Co', state: 'paid', owed_cents: 50000, received_cents: 50000, commitment_cents: 50000, call_number: 3 },
];

test('Draft reminder and Log as sent sit on an unpaid line only', () => {
  const markup = html(h(LineTable, { lines: LINES, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {} }));
  assert.match(markup, /data-testid="button-draft-reminder-900"/);
  assert.match(markup, /data-testid="button-log-sent-900"/);
  assert.doesNotMatch(markup, /button-draft-reminder-902|button-log-sent-902/, 'a paid line has nothing to remind about');
});

test('the draft band is the funds/calls surface scoped to that one line, and says nothing is sent', () => {
  const markup = html(h(LineTable, { lines: LINES, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {},
    followUp: { lineId: 900, mode: 'draft' } }));
  const src = read('frontend/src/pages/investor/InvestorFundCalls.jsx');
  assert.match(src, /<ZoneDraft\s+surface="funds\/calls"\s+scopeKey=\{String\(line\.id\)\}/);
  assert.match(markup, /Draft the reminder/);
  assert.match(markup, /A draft only\. Nothing is sent/);
  assert.equal((markup.match(/Draft the reminder/g) || []).length, 1, 'one band, on the chosen line');
});

test('Log as sent: a subject and a date, prefilled; the log keeps no message', () => {
  assert.equal(reminderSubject({ call_number: 3 }), 'Reminder: capital call 3');
  assert.equal(reminderSubject({ call_number: null }), 'Reminder: capital call');
  const markup = html(h(LineTable, { lines: LINES, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {},
    followUp: { lineId: 900, mode: 'log', lp: 'Ell Pee', subject: 'Reminder: capital call 3', date: '2026-10-05', busy: false, error: '', logged: false } }));
  assert.match(markup, /data-testid="form-log-sent"/);
  assert.match(markup, /data-testid="input-comm-subject"[^>]*value="Reminder: capital call 3"/);
  assert.match(markup, /The log keeps the subject and the date, never the message/);
  assert.doesNotMatch(markup, /<textarea/, 'there is nowhere to paste a message body');
  const done = text(h(LineTable, { lines: LINES, showCall: false, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {},
    followUp: { lineId: 900, mode: 'log', lp: 'Ell Pee', subject: 'Reminder: capital call 3', date: '2026-10-05', logged: true } }));
  assert.match(done, /Logged on the comms log: “Reminder: capital call 3”, sent 2026-10-05/);
  const src = read('frontend/src/pages/investor/InvestorFundCalls.jsx');
  assert.match(src, /kind: 'call_reminder', subject: followUp\.subject\.trim\(\),\s+sent_at: followUp\.date, capital_call_id: followUp\.lineId/);
});

test('the client calls the Worker routes', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { calls.push([init.method || 'GET', String(url), init.body]); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.fundsSetLpType(1, 101, 'corporate');
    await api.fundsCommsList(1);
    await api.fundsCommsList(1, 101);
    await api.fundsLogComm(1, { lp_id: 101, kind: 'update', subject: 'S' });
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map(([m, u]) => [m, u.replace(/^.*\/api/, '')]), [
    ['PUT', '/funds/1/lps/101/type'],
    ['GET', '/funds/1/comms'],
    ['GET', '/funds/1/comms?lp=101'],
    ['POST', '/funds/1/comms'],
  ]);
  assert.deepEqual(JSON.parse(calls[0][2]), { lp_type: 'corporate' });
});

test('the pages no longer say no reminder can be drafted, and still say nothing is sent', () => {
  const calls = read('frontend/src/pages/investor/InvestorFundCalls.jsx');
  assert.doesNotMatch(calls, /Eadwyn drafts no reminder for this page yet/);
  assert.match(calls, /nothing here sends it/);
  const lps = read('frontend/src/pages/investor/InvestorFundLPs.jsx');
  assert.match(lps, /An LP nobody has typed reads "Not recorded"/);
});
