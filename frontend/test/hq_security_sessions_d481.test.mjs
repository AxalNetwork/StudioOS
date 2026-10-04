/**
 * D481 — HQ · Security's Sessions zone acts, and the zones that name what
 * the platform does not record.
 *
 * Every assertion renders the component with a payload shaped like the
 * worker's and reads the TEXT a person would see (`renderedText`). The worker
 * half — the revoke, the audit row, the gates, the anomaly arithmetic — is
 * proved against a real database in
 * cloudflare-worker/test/hq_security_sessions_d481.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import {
  SessionsPanel, TokenAnomalies, NotRecordedList, DsrSubject, DsrKindsNotRecorded, runSessionAct,
  UNAVAILABLE as UNAVAILABLE_FROM_PAGE,
} from '../src/pages/hq/SecurityPage.jsx';

const html = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (C, props) => renderedText(html(C, props));

const LIST = {
  window_days: 30,
  total: 3,
  expiry_minutes: 30,
  rows: [
    { id: 11, user_id: 901, email: 'super@axal.example', name: 'Sam Super', role: 'admin', user_agent: 'Chrome', ip: '203.0.113.1', factor: 'totp', created_at: '2026-10-04 08:02:00', last_seen_at: '2026-10-04 09:00:00', is_current: true },
    { id: 12, user_id: 903, email: 'fran@example.com', name: 'Fran Target', role: 'founder', user_agent: 'Safari', ip: '203.0.113.7', factor: 'password', created_at: '2026-10-02 07:50:00', last_seen_at: '2026-10-04 08:30:00', is_current: false },
    { id: 13, user_id: 904, email: 'olu@example.com', name: null, role: 'founder', user_agent: null, ip: null, factor: null, created_at: null, last_seen_at: '2026-10-04 08:10:00', is_current: false },
  ],
  impersonations: {
    available: true,
    rows: [{ id: 7, admin_user_id: 901, target_user_id: 903, context: 'ticket HQ-4471', started_at: '2026-10-04 09:41:00', admin_email: 'super@axal.example', admin_name: 'Sam Super', target_email: 'fran@example.com', target_name: 'Fran Target' }],
  },
};

// ─────────────────────────────────────────────────────── sessions ──

test('the list renders every session with its acts; the caller\'s own reads Current and offers none', () => {
  const h = html(SessionsPanel, { list: LIST, onAct: async () => ({}) });
  const t = renderedText(h);
  assert.match(t, /Fran Target/);
  assert.match(t, /olu@example\.com/, 'a row with no name must fall back to the address');
  assert.match(t, /no device recorded · no address recorded/, 'an absent device or address rendered blank');
  assert.match(t, /3 active in 30 days, not revoked/);
  // Two actionable rows, each with Revoke and Sign out account; the current
  // row has neither, and no checkbox.
  // Counted on the buttons themselves: rendered text runs adjacent labels together.
  const labels = [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
  assert.equal(labels.filter((l) => l === 'Revoke').length, 2, 'Revoke is offered on the wrong rows');
  assert.equal(labels.filter((l) => l === 'Sign out account').length, 2);
  assert.match(t, /Current/);
  const own = h.slice(h.indexOf('data-testid="hq-session-11"'), h.indexOf('data-testid="hq-session-12"'));
  assert.doesNotMatch(own, /type="checkbox"/, 'the caller\'s own session can be selected for revoke');
  assert.doesNotMatch(renderedText(own), /Revoke|Sign out account/, 'the caller\'s own session offers a revoke');
});

test('a live support session sits in the list with End, as H23 draws it', () => {
  const h = html(SessionsPanel, { list: LIST, onAct: async () => ({}) });
  const live = h.slice(h.indexOf('data-testid="hq-live-impersonation-7"'));
  assert.match(renderedText(live), /Sam Super · impersonating Fran Target/);
  assert.match(renderedText(live), /ticket HQ-4471/);
  assert.match(renderedText(live), /End/);
});

test('every act is disabled until a reason is typed — the server\'s rule, on the button', () => {
  const h = html(SessionsPanel, { list: LIST, onAct: async () => ({}) });
  const buttons = [...h.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.ok(buttons.length >= 6, 'the acts are missing');
  for (const b of buttons) assert.match(b, /disabled=""/, `an act is live with no reason: ${b}`);
  assert.match(renderedText(h), /Reason · required for any act below, stored with it/);
});

test('a FAILED list read is Unreadable — never an empty list, never "Not recorded"', () => {
  // The page's own sentinel. Read from the module rather than re-created: a
  // fresh Symbol would never equal it and the test would pass vacuously.
  const t = text(SessionsPanel, { list: undefined, onAct: async () => ({}) });
  assert.match(t, /Loading/, 'fixture: no list yet is loading');
  const failed = html(SessionsPanel, { list: UNAVAILABLE_FROM_PAGE, onAct: async () => ({}) });
  const ft = renderedText(failed);
  assert.match(ft, /The session list could not be read\. This is not a claim that nobody is signed in\./);
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(ft, /Not recorded/, 'a failed read rendered as a store that keeps nothing');
  assert.doesNotMatch(ft, /No session was seen|0 active/, 'a failed read rendered as nobody signed in');
});

test('an unreadable support-session table is Unreadable on its own, and the list beside it still renders', () => {
  const list = { ...LIST, impersonations: { available: false, reason: 'The impersonation_sessions table could not be read on this database.' } };
  const t = text(SessionsPanel, { list, onAct: async () => ({}) });
  assert.match(t, /The support-session list could not be read\. This is not a claim that no support session is live\./);
  assert.doesNotMatch(t, /Not recorded/);
  assert.match(t, /Fran Target/, 'one unreadable half took the other with it');
});

test('a read that returned no rows says the table was read — a different fact from a failed read', () => {
  const t = text(SessionsPanel, { list: { ...LIST, total: 0, rows: [], impersonations: { available: true, rows: [] } }, onAct: async () => ({}) });
  assert.match(t, /The table was read; it held no active row/);
});

test('each act goes to its own route — Sign out account is D165\'s per-account sign-out', async () => {
  const seen = [];
  const client = new Proxy({}, { get: (_t, name) => async (...args) => { seen.push([name, ...args]); return {}; } });
  await runSessionAct(client, 'revoke', 12, 'reason text');
  await runSessionAct(client, 'revoke_selected', [12, 13], 'reason text');
  await runSessionAct(client, 'end', 7, 'reason text');
  await runSessionAct(client, 'sign_out', 903, 'reason text');
  assert.deepEqual(seen, [
    ['hqRevokeSession', 12, 'reason text'],
    ['hqRevokeSessions', [12, 13], 'reason text'],
    ['hqEndImpersonation', 7, 'reason text'],
    ['hqForceReauthUser', 903, 'reason text'],
  ]);
  await assert.rejects(runSessionAct(client, 'delete', 12, 'reason text'));
});

// ───────────────────────────────────────────────── token anomalies ──

const ANOMALIES = {
  available: true, window_hours: 24, baseline_days: 7, multiple: 4, floor_tokens: 20000,
  accounts_checked: 12, count: 1, no_baseline: 2,
  rows: [{ user_id: 903, email: 'fran@example.com', name: 'Fran Target', tokens_24h: 30000, daily_avg_baseline: 5000, ratio: 6 }],
  how: 'An account is flagged when its last 24 hours used at least 4× its own average day.',
};

test('token anomalies render the figure, the account behind it, the no-baseline count and the rule', () => {
  const t = text(TokenAnomalies, { block: ANOMALIES });
  assert.match(t, /Token anomalies/);
  assert.match(t, /Fran Target — 30,000 tokens in 24 hours, 6× an average day of 5,000/);
  assert.match(t, /12 accounts checked/);
  assert.match(t, /2 accounts crossed the floor with no usage in the 7 days before/);
  assert.match(t, /flagged when its last 24 hours used at least 4×/, 'the threshold is not shown beside the figure');
});

test('an unreadable token read is Unreadable — no figure, no zero, no "Not recorded"', () => {
  const block = { available: false, reason: 'ai_usage_logs could not be read on this database.' };
  const h = html(TokenAnomalies, { block });
  const t = renderedText(h);
  assert.match(t, /could not be read\. No account was checked — this is not a claim that nothing spiked\./);
  assert.match(h, /role="alert"/);
  assert.doesNotMatch(t, /Not recorded/, 'a failed read rendered as a store that keeps nothing');
  assert.doesNotMatch(t, /\b0\b/, 'an unreadable read rendered a zero');
});

test('zero anomalies over a readable table is a measured zero, and says how many were checked', () => {
  const t = text(TokenAnomalies, { block: { ...ANOMALIES, count: 0, rows: [], no_baseline: 0 } });
  assert.match(t, /Token anomalies\s*0last 24 hours/);
  assert.match(t, /12 accounts checked/);
});

// ─────────────────────────────────────── not recorded, with reasons ──

test('the tiles the platform does not record render "Not recorded" with the server\'s reason', () => {
  const items = [
    { what: 'Accreditation lapsed', reason: 'No attestation date is stored.' },
    { what: 'Failover test', reason: 'No standby exists to fail over to.' },
  ];
  const t = text(NotRecordedList, { items, testid: 'x' });
  assert.match(t, /Accreditation lapsed — Not recorded\. No attestation date is stored\./);
  assert.match(t, /Failover test — Not recorded\. No standby exists to fail over to\./);
  assert.doesNotMatch(t, /\d/, 'a stated absence carried a number');
});

test('a DSR row names its kind from the row; access and portability render Not recorded with reasons', () => {
  const row = { id: 1, name: 'Fran Target', email: 'fran@example.com', role: 'founder', kind: 'erasure' };
  assert.match(text(DsrSubject, { row }), /Fran Target · Founder · erasure/);
  // The kind is the row's, not a literal: a row of another kind says so.
  assert.match(text(DsrSubject, { row: { ...row, kind: 'access' } }), /· access$/);
  assert.match(text(DsrSubject, { row: { ...row, kind: undefined } }), /kind not recorded/);

  const kinds = [
    { kind: 'erasure', recorded: true },
    { kind: 'access', recorded: false, reason: 'The ledger records deletion requests only.' },
    { kind: 'portability', recorded: false, reason: 'No request for a copy is taken or timed.' },
  ];
  const t = text(DsrKindsNotRecorded, { kinds });
  assert.match(t, /Access — Not recorded\. The ledger records deletion requests only\./);
  assert.match(t, /Portability — Not recorded\. No request for a copy is taken or timed\./);
  assert.doesNotMatch(t, /Erasure/, 'the recorded kind was listed as missing');
});
