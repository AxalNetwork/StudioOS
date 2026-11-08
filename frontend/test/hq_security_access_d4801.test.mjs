/**
 * D4801 (#4801, D4803 A1 · B1 · C1) — Security v2, part 2: the Access
 * workspace and the high-risk action flows.
 *
 * Three kinds of check, each reading what a person would see:
 *   - the pure rules (`parseUserAgent`, `accessModel.js`, the dialogs' copy)
 *     with payloads shaped like `admin_security.ts`'s replies;
 *   - server renders of the workspace and of the page's Access tab;
 *   - mounted journeys in the repo's synthetic document
 *     (`_contracts_dom.mjs`, with focus), where a dialog is opened, typed in,
 *     sent, answered or refused, and closed — and focus is followed.
 *
 * The Worker half (the routes' codes, the audit rows, the gates) is proved
 * against a real database in cloudflare-worker/test/hq_security_sessions_d481.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import { SecurityConsole, UNAVAILABLE, runSessionAct } from '../src/pages/hq/SecurityPage.jsx';
import AccessWorkspace from '../src/pages/hq/security/AccessWorkspace.jsx';
import { actionCopy, resultTitle } from '../src/pages/hq/security/AccessActions.jsx';
import { parseUserAgent } from '../src/pages/hq/security/parseUserAgent.js';
import {
  EMERGENCY_PHRASE, MIN_REASON, RESULTS, SESSION_BULK_LIMIT, SESSION_STATUS, bulkResult, bulkScope, formatUtc,
  formatInZone, parseServerTime, relativeTo, resultOfError, sessionExpiresAt, sessionStatus, writeAccess,
} from '../src/pages/hq/security/accessModel.js';
import { buildOverview } from '../src/pages/hq/security/overviewModel.js';
import OverviewWorkspace from '../src/pages/hq/security/OverviewWorkspace.jsx';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-11-07T14:30:00Z');

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  firefoxWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

const LIST = () => ({
  token_hours: 24,
  total: 4,
  expiry_minutes: 30,
  rows: [
    { id: 11, user_id: 901, email: 'super@axal.example', name: 'Sam Super', role: 'admin', user_agent: UA.chromeMac, ip: '203.0.113.1', factor: 'totp', created_at: '2026-11-07 08:02:00', last_seen_at: '2026-11-07 14:29:30', is_current: true },
    { id: 12, user_id: 903, email: 'fran@example.com', name: 'Fran Target', role: 'founder', user_agent: UA.firefoxWin, ip: '203.0.113.71', factor: 'password', created_at: '2026-11-07 09:47:12', last_seen_at: '2026-11-07 13:58:04', is_current: false },
    { id: 13, user_id: 904, email: 'olu@example.com', name: null, role: 'founder', user_agent: null, ip: null, factor: null, created_at: null, last_seen_at: '2026-11-07 08:10:00', is_current: false },
    { id: 14, user_id: 903, email: 'fran@example.com', name: 'Fran Target', role: 'founder', user_agent: UA.safariIos, ip: '203.0.113.72', factor: 'password', created_at: '2026-11-07 07:00:00', last_seen_at: '2026-11-07 12:00:00', is_current: false },
  ],
  impersonations: {
    available: true,
    rows: [{ id: 7, admin_user_id: 901, target_user_id: 903, context: 'ticket HQ-4471', started_at: '2026-11-07 14:02:00', admin_email: 'super@axal.example', admin_name: 'Sam Super', target_email: 'fran@example.com', target_name: 'Fran Target' }],
  },
});

const ws = (props = {}) => renderToStaticMarkup(h(AccessWorkspace, {
  list: LIST(), unavailable: UNAVAILABLE, onAct: async () => ({}), onRetry: () => {}, now: NOW, ...props,
}));
const between = (html, from, to) => {
  const a = html.indexOf(from);
  assert.ok(a >= 0, `missing ${from}`);
  const b = to ? html.indexOf(to, a + from.length) : html.length;
  return html.slice(a, b < 0 ? html.length : b);
};
const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => renderedText(m[1]).trim());

// ──────────────────────────────────────────────────────── UA parsing ──

test('the user agent is parsed into browser and OS — common browsers, common systems, and unknown', () => {
  const cases = [
    [UA.chromeMac, 'Chrome 131', 'macOS'],
    [UA.firefoxWin, 'Firefox 132', 'Windows 10 or 11'],
    [UA.safariIos, 'Safari 17', 'iOS 17.1'],
    [UA.chromeAndroid, 'Chrome 130', 'Android 14'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'Edge 131', 'Windows 10 or 11'],
    ['Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 OPR/95.0.0.0', 'Opera 95', 'Windows 7'],
    ['Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36', 'Samsung Internet 23', 'Android 13'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1', 'Chrome 120', 'iOS 17.0'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/119.0 Mobile/15E148 Safari/605.1.15', 'Firefox 119', 'iOS 16.6'],
    ['Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1', 'Safari 12', 'iPadOS 12.2'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36', 'Chrome 118', 'ChromeOS'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox 121', 'Linux'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15', 'Safari 17', 'macOS'],
  ];
  for (const [ua, browser, os] of cases) {
    const p = parseUserAgent(ua);
    assert.equal(p.browser, browser, ua);
    assert.equal(p.os, os, ua);
    assert.equal(p.label, `${browser} · ${os}`);
    assert.equal(p.missing, false);
  }
  // Unknown is null, never a guess; a missing string is its own fact.
  assert.deepEqual(parseUserAgent('curl/8.4.0'), { browser: null, os: null, label: null, missing: false });
  assert.deepEqual(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) SomeBot/1.0'), { browser: null, os: 'Windows 10 or 11', label: 'Windows 10 or 11', missing: false });
  for (const none of [null, undefined, '', '   ']) assert.equal(parseUserAgent(none).missing, true);
});

// ───────────────────────────────────────────────────── time and status ──

test('server times are read as UTC and drawn precisely, with the zone named', () => {
  // Off UTC on purpose: in a UTC process a time read as local would read the same.
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
  assert.equal(parseServerTime('2026-11-07 09:47:12').toISOString(), '2026-11-07T09:47:12.000Z', 'a zone-less D1 time was read as local time');
  assert.equal(parseServerTime('2026-11-07T09:47:12Z').toISOString(), '2026-11-07T09:47:12.000Z');
  assert.equal(parseServerTime('2026-11-07T09:47:12').toISOString(), '2026-11-07T09:47:12.000Z', 'a zone-less ISO time was read as local time');
  for (const bad of [null, undefined, '', 'yesterday']) assert.equal(parseServerTime(bad), null);
  assert.equal(formatUtc('2026-11-07 09:47:12'), 'Sat 7 Nov 2026, 09:47:12 UTC');
  assert.equal(formatUtc('2026-11-07 09:47:12', { seconds: false }), 'Sat 7 Nov 2026, 09:47 UTC');
  assert.equal(formatUtc(null), null);
  assert.equal(formatInZone('2026-11-07 09:47:12', 'America/New_York'), 'Sat 7 Nov 2026, 04:47:12 (America/New_York)');
  assert.equal(relativeTo('2026-11-07 13:58:04', NOW), '32 min ago');
  assert.equal(relativeTo('2026-11-07 12:00:00', NOW), '2 h 30 min ago');
  assert.equal(relativeTo('2026-11-07 14:29:50', NOW), 'just now');
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

test('Expires is created + token_hours, and the four statuses are the one set of words', () => {
  const row = LIST().rows[1];
  assert.equal(sessionExpiresAt(row, 24).toISOString(), '2026-11-08T09:47:12.000Z');
  assert.equal(sessionExpiresAt({ created_at: null }, 24), null);
  assert.equal(sessionExpiresAt(row, null), null);
  assert.deepEqual(Object.keys(SESSION_STATUS), ['current', 'active', 'expired', 'revoked']);
  assert.deepEqual(Object.values(SESSION_STATUS).map((s) => s.word), ['Current', 'Active', 'Expired', 'Revoked']);
  const opts = { now: NOW, tokenHours: 24 };
  assert.equal(sessionStatus(row, opts), 'active');
  assert.equal(sessionStatus(LIST().rows[0], opts), 'current');
  assert.equal(sessionStatus(row, { ...opts, now: Date.parse('2026-11-08T09:47:12Z') }), 'expired', 'a token at its expiry still read Active');
  assert.equal(sessionStatus(row, { ...opts, changed: { sessions: { 12: true } } }), 'revoked');
  assert.equal(sessionStatus(LIST().rows[3], { ...opts, changed: { accounts: { 903: true } } }), 'revoked', 'a signed-out account kept an Active row');
  assert.equal(sessionStatus(LIST().rows[0], { ...opts, changed: { all: true } }), 'revoked', 'emergency left your own row Current');
});

// ───────────────────────────────────────────────────── the table ──

test('the sessions table: its columns in order, human device first, precise times, status and expiry', () => {
  const html = ws();
  const head = between(html, '<thead', '</thead>');
  assert.deepEqual([...head.matchAll(/<th scope="col"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => renderedText(m[1]).trim()),
    ['', 'Account / role', 'Browser and OS', 'Started', 'Last active', 'Status', 'Expires', 'Actions']);
  assert.match(html, /<caption[^>]*>Active sessions on HQ-held accounts, newest seen first\. Times are UTC\.<\/caption>/);

  const fran = renderedText(between(html, 'data-testid="hq-session-12"', '</tr>'));
  assert.match(fran, /Fran Target/);
  assert.match(fran, /Founder/);
  assert.match(fran, /Firefox 132 · Windows 10 or 11/);
  assert.match(fran, /Sat 7 Nov 2026, 09:47:12 UTC/, 'Started is not precise and zoned');
  assert.match(fran, /Sat 7 Nov 2026, 13:58:04 UTC/);
  assert.match(fran, /32 min ago/);
  assert.match(fran, /Sun 8 Nov 2026, 09:47:12 UTC/, 'Expires is not created + 24 h');
  assert.match(between(html, 'data-testid="hq-session-12"', '</tr>'), /data-state="healthy"[\s\S]*?Active/);
  // The raw user agent and the IP are not in the row: they wait under View details.
  assert.doesNotMatch(fran, /Mozilla|Gecko|203\.0\.113/, 'the raw user agent or IP leaked into the row');

  // A row with no name falls back to the address; no user agent and no start are said, not blank.
  const olu = renderedText(between(html, 'data-testid="hq-session-13"', '</tr>'));
  assert.match(olu, /olu@example\.com/);
  assert.match(olu, /No user agent stored/);
  assert.match(olu, /Not stamped/);
  assert.match(olu, /ExpiresUnknown/);
  assert.match(renderedText(html), /4 active · token under 24h old, not revoked, account not signed out/);
});

test('your own row reads Current, can\'t be selected, and offers Sign out account only', () => {
  const html = ws();
  const own = between(html, 'data-testid="hq-session-11"', '</tr>');
  assert.match(own, /data-state="pending"[\s\S]*?Current/);
  assert.match(renderedText(own), /Sam Super \(you\)/);
  assert.doesNotMatch(own, /type="checkbox"/, 'your own session can be selected for a bulk revoke');
  const acts = buttons(own);
  assert.ok(acts.some((b) => /^Sign out account…/.test(b)), 'your own row lost Sign out account');
  assert.ok(!acts.some((b) => /Revoke/.test(b)), 'your own row offers a revoke the server refuses');
  // Every other active row offers both acts and a checkbox.
  for (const id of [12, 13, 14]) {
    const row = between(html, `data-testid="hq-session-${id}"`, '</tr>');
    assert.match(row, /type="checkbox"/);
    assert.ok(buttons(row).some((b) => /^Revoke this session…/.test(b)));
    assert.ok(buttons(row).some((b) => /^Sign out account…/.test(b)));
  }
});

test('an expired row reads Expired and offers no revoke', () => {
  const html = ws({ now: Date.parse('2026-11-08T09:00:00Z') });
  const row = between(html, 'data-testid="hq-session-14"', '</tr>');
  assert.match(row, /data-status="expired"/);
  assert.match(renderedText(row), /Expired/);
  assert.ok(!buttons(row).some((b) => /Revoke/.test(b)));
  assert.match(row, /type="checkbox"[^>]*disabled=""/, 'an expired session can be selected for a revoke');
});

test('View details holds the raw user agent, IP, session id, times in your zone, and what is Not instrumented', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    const btn = m.find((n) => n.tagName === 'BUTTON' && /^View details/.test(m.text(n)) && m.inRow(n, 12));
    assert.equal(m.props(btn)['aria-expanded'], false);
    await act(async () => { m.props(btn).onClick(); });
    assert.equal(m.props(btn)['aria-expanded'], true);
    const d = m.find((n) => m.props(n)?.['data-testid'] === 'hq-session-details-12');
    const t = m.text(d);
    assert.match(t, /Session ID12/);
    assert.match(t, /203\.0\.113\.71/);
    assert.match(t, /User agentMozilla\/5\.0 \(Windows NT 10\.0; Win64; x64; rv:132\.0\) Gecko\/20100101 Firefox\/132\.0/);
    assert.match(t, /Started \+ 24 h, the token's lifetime\. Derived; nothing stores it\./);
    assert.match(t, /Sign-in factorpassword/);
    assert.match(t, /LocationNot instrumented[\s\S]*only the IP address is stored/);
    assert.match(t, /Device nameNot instrumented[\s\S]*only the raw user agent is stored/);
    assert.match(t, /Revoked byNot instrumented[\s\S]*the admin audit log does/);
  } finally { await m.done(); restore(); }
});

// ───────────────────────────────────────────────────── the states ──

test('loading claims nothing; unreadable draws no list, no count, no act, and Retry — never 0', () => {
  const loading = renderedText(ws({ list: null }));
  assert.match(loading, /Loading sessions — nothing is claimed yet\./);
  assert.doesNotMatch(loading, /active ·|No session was seen/);

  const failed = ws({ list: UNAVAILABLE });
  const t = renderedText(failed);
  assert.match(t, /The session list could not be read\. This is not a claim that nobody is signed in\./);
  assert.match(failed, /role="alert"/);
  assert.ok(buttons(between(failed, 'data-testid="hq-sessions"', 'data-testid="hq-support-sessions"')).includes('Retry'));
  assert.doesNotMatch(failed, /data-testid="hq-sessions-table"|data-testid="hq-sessions-count"|data-testid="hq-sessions-revoke-selected"/);
  assert.doesNotMatch(between(failed, 'data-testid="hq-sessions"', 'data-testid="access-reach"'), /Revoke|Sign out|End support/);
  assert.doesNotMatch(renderedText(between(failed, 'data-testid="hq-sessions"', 'data-testid="access-reach"')), /\b0\b/, 'an unreadable list drew a 0');
  assert.doesNotMatch(t, /Not recorded|No session was seen/);

  // A count the reply did not carry is Unavailable with Retry, never 0.
  const noCount = ws({ list: { ...LIST(), total: null } });
  assert.match(between(noCount, 'data-testid="hq-sessions-count"', '</span></span>'), /data-state="unavailable"/);
  assert.doesNotMatch(renderedText(between(noCount, 'data-testid="hq-sessions-count"', 'active ·')), /\b0\b/);
});

test('empty is what was read: no row at all, or only your own; no support session is a measured zero', () => {
  const none = renderedText(ws({ list: { ...LIST(), total: 0, rows: [], impersonations: { available: true, rows: [] } } }));
  assert.match(none, /No session was seen in this window\. The table was read; it held no active row\./);
  const onlyYou = ws({ list: { ...LIST(), total: 1, rows: [LIST().rows[0]], impersonations: { available: true, rows: [] } } });
  assert.match(renderedText(onlyYou), /Only your own session is active\. The table was read/);
  assert.match(between(onlyYou, 'data-testid="hq-support-sessions"', '</h2>') + between(onlyYou, '</h2>', 'No one is acting'), /data-state="measured_zero"/);
  assert.match(renderedText(onlyYou), /No one is acting as another user right now/);
  // An unreadable support table is its own fact, and the sessions beside it still render.
  const half = ws({ list: { ...LIST(), impersonations: { available: false, reason: 'x' } } });
  assert.match(renderedText(half), /The support-session list could not be read\. This is not a claim that no support session is live\./);
  assert.match(renderedText(half), /Fran Target/);
  assert.doesNotMatch(between(half, 'data-testid="hq-support-sessions"', 'data-testid="access-reach"'), /data-state="measured_zero"/);
});

test('read-only until step-up: a session not signed in with the authenticator offers no live act', () => {
  const list = LIST(); list.rows[0].factor = 'password';
  assert.equal(writeAccess(list), 'needs_totp');
  assert.equal(writeAccess(LIST()), 'ready');
  assert.equal(writeAccess({ rows: LIST().rows.slice(1) }), 'unknown');
  const html = ws({ list });
  assert.match(renderedText(html), /Read-only until step-up/);
  assert.match(renderedText(html), /Your session was not signed in with your authenticator/);
  for (const b of [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]) {
    const label = renderedText(b[1]);
    if (/Revoke|Sign out|End support|Emergency/.test(label)) assert.match(b[0], /disabled=""/, `a live act under read-only: ${label}`);
  }
  // Ready: the acts are live, and no read-only line is drawn.
  const ok = ws();
  assert.doesNotMatch(renderedText(ok), /Read-only until step-up/);
  assert.doesNotMatch(between(ok, 'data-testid="hq-session-12"', '</tr>'), /disabled=""/);
  // Unknown: said, and the server decides.
  assert.match(renderedText(ws({ list: { ...LIST(), rows: LIST().rows.slice(1) } })), /can't tell whether it was signed in with your\s+authenticator/);
});

test('the support-sessions table names people, and the card says what each act reaches', () => {
  const html = ws();
  const row = renderedText(between(html, 'data-testid="hq-live-impersonation-7"', '</tr>'));
  assert.match(row, /Sam Super/);
  assert.match(row, /Fran Target/);
  assert.match(row, /Sat 7 Nov 2026, 14:02:00 UTC/);
  assert.match(row, /ticket HQ-4471/);
  assert.match(row, /Open/);
  assert.match(row, /End support session…/);
  assert.match(row, /Sign out Fran Target…/);
  assert.doesNotMatch(row, /fran@example\.com/, 'a listed person was named by address');
  const reach = renderedText(between(html, 'data-testid="access-reach"', '</section>'));
  assert.match(reach, /Revoke this session\s*One session row\./);
  assert.match(reach, /Sign out account\s*Every session that account holds, on every device/);
  assert.match(reach, /End support session\s*Closes the support-session record[\s\S]*stays valid until it expires, at most 30 minutes/);
  assert.match(reach, /Emergency re-authentication\s*Every HQ-held account; branch databases are not touched; you will be signed out too\./);
  assert.match(reach, /at\s+least 8 characters/);
});

// ─────────────────────────────────────────────── the dialogs' copy ──

test('each act states its exact scope and whether you are affected', () => {
  const s = { id: 12, userId: 903, name: 'Fran Target', device: 'Firefox 132 · Windows 10 or 11' };
  const revoke = actionCopy({ kind: 'revoke', session: s, self: false });
  assert.equal(revoke.scope.title, 'Affects exactly one session');
  assert.deepEqual(revoke.scope.items, ['Fran Target · Firefox 132 · Windows 10 or 11 · session 12', 'Its token is refused from its next request', 'Fran Target\'s other sessions stay signed in']);
  assert.deepEqual(revoke.you, { affected: false, text: 'You are not affected.' });
  // Another of your own sessions: the wording says so, and that this one stays.
  assert.match(actionCopy({ kind: 'revoke', session: s, self: true }).you.text, /another of your own sessions\. The session you are using now is not this one and stays signed in/);

  const out = actionCopy({ kind: 'sign_out', userId: 903, name: 'Fran Target', self: false, listed: 2 });
  assert.equal(out.scope.title, 'Every session Fran Target holds, on every device');
  assert.match(out.scope.items.join('|'), /2 of their sessions are in the list read on this page; any it does not show are reached too/);
  assert.equal(out.you.affected, false);
  const own = actionCopy({ kind: 'sign_out', userId: 901, name: 'Sam Super', self: true, listed: 1 });
  assert.equal(own.you.affected, true);
  assert.match(own.you.text, /You will be signed out too: this is your own account, this session included/);

  const end = actionCopy({ kind: 'end', impId: 7, admin: 'Sam Super', target: 'Fran Target', started: 'Sat 7 Nov 2026, 14:02:00 UTC' }, { expiryMinutes: 30, now: NOW });
  assert.equal(end.scope.title, 'Closes one support-session record');
  assert.match(end.scope.items.join('|'), /stays valid until it expires: at most 30 minutes after it was minted, no later than Sat 7 Nov 2026, 15:00 UTC/);
  assert.match(end.scope.items.join('|'), /Fran Target is not signed out of their own sessions/);
  assert.match(end.you.text, /Your own admin session continues/);

  const em = actionCopy({ kind: 'emergency' });
  assert.equal(em.reach, 'Every HQ-held account; branch databases are not touched; you will be signed out too');
  assert.equal(em.scope.title, 'Signs out every HQ-held account');
  assert.match(em.scope.items.join('|'), /Branch databases are not touched/);
  assert.equal(em.you.affected, true);
  assert.match(em.you.text, /You will be signed out too/);

  const bulk = actionCopy({ kind: 'revoke_selected', sessions: [{ ...s, self: false }, { ...s, id: 14, device: 'Safari 17 · iOS 17.1', self: false }, { id: 13, userId: 904, name: 'olu@example.com', device: 'No user agent stored', self: false }] });
  assert.equal(bulk.scope.title, '3 sessions on 2 accounts');
  assert.match(bulk.you.text, /your current session can't be selected/);
  assert.equal(bulkScope([{ userId: 1 }]), '1 session on 1 account');

  for (const c of [revoke, out, own, end, em, bulk]) {
    assert.doesNotMatch(JSON.stringify(c), /tenant/i, 'an act claimed a reach over tenants');
  }
});

// ─────────────────────────────────────────────────── the results ──

test('every thrown answer becomes its own result, and no answer is never Done', () => {
  const e = (status, code, message = 'x') => Object.assign(new Error(message), { status, code });
  assert.equal(resultOfError(Object.assign(new Error('The server did not respond within 30s.'), { code: 'timeout' })).result, 'unknown');
  assert.equal(resultOfError(new Error('Failed to fetch')).result, 'unknown', 'a dropped connection read as a refusal');
  assert.equal(resultOfError(e(401, undefined, 'Session expired')).result, 'expired');
  assert.equal(resultOfError(e(409, 'already_revoked')).result, 'already_revoked');
  assert.equal(resultOfError(e(409, 'already_ended')).result, 'already_revoked');
  assert.equal(resultOfError(e(404, 'session_not_found')).result, 'not_found');
  assert.equal(resultOfError(e(404, 'user_not_found')).result, 'not_found');
  assert.equal(resultOfError(e(409, 'past_ceiling')).result, 'expired');
  assert.equal(resultOfError(e(409, 'own_current_session')).result, 'refused');
  assert.equal(resultOfError(e(403, undefined, 'TOTP required')).result, 'refused');
  assert.equal(resultOfError(e(400, 'reason_required')).result, 'refused');
  assert.equal(resultOfError(e(503, 'impersonations_unreadable')).result, 'failed');
  assert.equal(resultOfError(e(500)).result, 'failed');
  // Eight results, eight distinct words.
  assert.deepEqual(Object.keys(RESULTS), ['done', 'partial', 'refused', 'failed', 'unknown', 'already_revoked', 'not_found', 'expired']);
  assert.equal(new Set(Object.values(RESULTS).map((r) => r.word)).size, 8);
});

test('a bulk reply becomes per-row outcomes: Done, Partly done, Already revoked, Not found, and No answer', () => {
  const r = bulkResult({ results: [{ id: 12, outcome: 'revoked' }, { id: 14, outcome: 'already_revoked' }, { id: 13, outcome: 'not_found' }] }, [12, 14, 13]);
  assert.equal(r.result, 'partial');
  assert.equal(r.revoked, 1);
  assert.deepEqual(r.rows.map((x) => x.outcome), ['revoked', 'already_revoked', 'not_found']);
  assert.equal(bulkResult({ results: [{ id: 12, outcome: 'revoked' }] }, [12]).result, 'done');
  assert.equal(bulkResult({ results: [{ id: 12, outcome: 'already_revoked' }] }, [12]).result, 'already_revoked');
  assert.equal(bulkResult({ results: [{ id: 12, outcome: 'not_found' }] }, [12]).result, 'not_found');
  assert.equal(bulkResult({ results: [{ id: 12, outcome: 'not_found' }, { id: 14, outcome: 'already_revoked' }] }, [12, 14]).result, 'partial');
  // A row the reply does not mention is never assumed revoked.
  const silent = bulkResult({ results: [{ id: 12, outcome: 'revoked' }] }, [12, 14]);
  assert.equal(silent.result, 'partial');
  assert.equal(silent.rows[1].outcome, 'missing');
  assert.equal(bulkResult({}, [12]).result, 'unknown');
  assert.equal(resultTitle({ kind: 'revoke_selected' }, r), 'Revoked 1 of 3 sessions');
});

// ─────────────────────────────────────────────── mounted journeys ──

async function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const r = createRoot(container);
  const calls = [];
  const replies = [];
  const onAct = props.onAct || ((kind, arg, reason) => {
    calls.push([kind, arg, reason]);
    return new Promise((res, rej) => replies.push({ res, rej }));
  });
  const refreshed = [];
  await act(async () => {
    r.render(h(MemoryRouter, null, h(AccessWorkspace, {
      unavailable: UNAVAILABLE, onRetry: () => refreshed.push('retry'), onRefresh: () => refreshed.push('refresh'), now: NOW, ...props, onAct,
    })));
  });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const text = (n) => (n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(text).join(''));
  const find = (pred) => nodes().find(pred);
  const byId = (id) => find((n) => props_(n)?.['data-testid'] === id);
  const inRow = (n, id) => { for (let p = n; p; p = p.parentNode) if (props_(p)?.['data-testid'] === `hq-session-${id}`) return true; return false; };
  const button = (re, within) => (within ? walk(within) : nodes()).find((n) => n.tagName === 'BUTTON' && re.test(text(n)));
  const click = async (n) => { await act(async () => { props_(n).onClick({ currentTarget: n, preventDefault() {} }); }); };
  const type = async (n, value) => { await act(async () => { props_(n).onChange({ target: { value } }); }); };
  const key = async (n, k, extra = {}) => { await act(async () => { props_(n).onKeyDown({ key: k, preventDefault() {}, ...extra }); }); };
  const dialog = () => find((n) => props_(n)?.role === 'dialog');
  return {
    container, nodes, props: props_, text, find, byId, inRow, button, click, type, key, dialog, calls, replies, refreshed,
    done: async () => { await act(async () => r.unmount()); },
  };
}

const REASON = 'Unrecognised device reported';

test('mounted: Revoke one — reason required in the dialog, no success before the server answers, then Revoked', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    const opener = m.find((n) => n.tagName === 'BUTTON' && /^Revoke this session…/.test(m.text(n)) && m.inRow(n, 12));
    opener.focus();
    await m.click(opener);
    const d = m.dialog();
    assert.ok(d, 'no in-page dialog opened');
    assert.equal(m.props(d)['aria-modal'], 'true');
    assert.equal(m.text(m.find((n) => m.props(n)?.id === m.props(d)['aria-labelledby'])), 'Revoke this session?');
    assert.equal(m.props(document.activeElement)?.id, m.props(d)['aria-labelledby'], 'focus did not move into the dialog');
    assert.match(m.text(d), /Affects exactly one session/);
    assert.match(m.text(d), /Fran Target · Firefox 132 · Windows 10 or 11 · session 12/);
    assert.match(m.text(d), /You are not affected\./);
    assert.match(m.text(d), /Needs a session signed in with your authenticator \(TOTP\) and a recent step-up/);
    // The reason field is labelled, and a short reason stops at Scope.
    const field = m.byId('action-reason');
    const label = m.find((n) => n.tagName === 'LABEL' && m.props(n).htmlFor === m.props(field).id);
    assert.match(m.text(label), /^Reason/);
    await m.type(field, 'short');
    await m.click(m.byId('action-continue'));
    assert.equal(m.props(m.dialog())['data-step'], 1, 'a short reason reached Review');
    assert.match(m.text(m.dialog()), /✕ Add a reason of at least 8 characters\./);
    assert.equal(m.props(m.byId('action-reason'))['aria-invalid'], 'true');
    assert.match(m.props(m.byId('action-reason'))['aria-describedby'], /-error/);
    assert.equal(m.calls.length, 0);
    await m.type(m.byId('action-reason'), REASON);
    await m.click(m.byId('action-continue'));
    assert.equal(m.props(m.dialog())['data-step'], 2);
    assert.match(m.text(m.dialog()), new RegExp(`Reason${REASON}`));
    assert.match(m.text(m.dialog()), /ScopeOne session/);
    assert.equal(m.calls.length, 0, 'Review sent the request');
    // Sent: waiting, nothing shown as done, and Esc cannot hide the answer.
    await m.click(m.byId('action-confirm'));
    assert.deepEqual(m.calls, [['revoke', 12, REASON]]);
    assert.match(m.text(m.dialog()), /Waiting for the server\. Nothing is shown as done until it answers\./);
    assert.equal(m.byId('action-result'), undefined, 'a result was drawn before the server answered');
    assert.equal(m.props(m.byId('hq-session-12'))['data-status'], 'active', 'the row changed before the server answered');
    await m.key(m.dialog(), 'Escape');
    assert.ok(m.dialog(), 'Esc closed the dialog while the request was in flight');
    await act(async () => { m.replies[0].res({ ok: true, session_id: 12, revoked_at: '2026-11-07 14:30:05' }); });
    const res = m.byId('action-result');
    assert.equal(m.props(res)['data-result'], 'done');
    assert.equal(m.props(m.dialog())['data-step'], 3);
    assert.match(m.text(m.dialog()), /Session revoked/);
    assert.match(m.text(res), /Confirmed by the server; reply received Sat 7 Nov 2026, 14:30:00 UTC\./);
    assert.match(m.text(res), /Revoked at Sat 7 Nov 2026, 14:30:05 UTC\. The account's other sessions are untouched\./);
    // The row now reads Revoked — the dialog's word — and offers no revoke.
    assert.equal(m.props(m.byId('hq-session-12'))['data-status'], 'revoked');
    assert.equal(m.props(m.byId('hq-session-14'))['data-status'], 'active', 'one revoke marked the account\'s other session');
    assert.match(m.text(m.byId('access-changed')), /1 change confirmed since this list was read/);
    await m.click(m.byId('action-done'));
    assert.equal(m.dialog(), undefined);
    // Its Revoke button is gone with the revoke, so focus goes to the table's caption (SEC).
    assert.equal(opener.isConnected, false);
    assert.equal(document.activeElement?.tagName, 'CAPTION', 'focus was lost when the opener went');
  } finally { await m.done(); restore(); }
});

for (const [name, err, result, title] of [
  ['own current session (409)', { status: 409, code: 'own_current_session', message: 'That is the session you are using.' }, 'refused', 'Refused — that is the session you are using'],
  ['timeout', { code: 'timeout', message: 'The server did not respond within 30s.' }, 'unknown', 'Outcome unknown — re-read before retrying'],
  ['already revoked (409)', { status: 409, code: 'already_revoked', message: 'That session was already revoked.' }, 'already_revoked', 'Already revoked — nothing changed'],
  ['not found (404)', { status: 404, code: 'session_not_found', message: 'No session holds that id.' }, 'not_found', 'Not found — nothing changed'],
  ['a server error (500)', { status: 500, message: 'Internal error' }, 'failed', 'Couldn\'t complete it — the server reported an error'],
  ['your session expired (401)', { status: 401, message: 'Session expired' }, 'expired', 'Your session has expired — nothing was done'],
]) {
  test(`mounted: Revoke one, ${name} — its own result, and the row is not marked`, async () => {
    const restore = installDocument('', { focus: true });
    const m = await mount({ list: LIST(), onAct: async () => { throw Object.assign(new Error(err.message), err); } });
    try {
      await m.click(m.find((n) => n.tagName === 'BUTTON' && /^Revoke this session…/.test(m.text(n)) && m.inRow(n, 12)));
      await m.type(m.byId('action-reason'), REASON);
      await m.click(m.byId('action-continue'));
      await m.click(m.byId('action-confirm'));
      assert.equal(m.props(m.byId('action-result'))['data-result'], result);
      assert.equal(m.text(m.find((n) => m.props(n)?.id === m.props(m.dialog())['aria-labelledby'])), title);
      assert.doesNotMatch(m.text(m.dialog()), /Confirmed by the server/, 'a non-success read as confirmed');
      assert.match(m.text(m.dialog()), new RegExp(`Server said${err.message.replace(/[.()]/g, '\\$&')}`));
      if (result === 'already_revoked') assert.equal(m.props(m.byId('hq-session-12'))['data-status'], 'revoked', 'an already-revoked row still read Active');
      else assert.equal(m.props(m.byId('hq-session-12'))['data-status'], 'active', 'a row was marked revoked without a confirmed revoke');
      if (result === 'unknown') {
        assert.match(m.text(m.dialog()), /The server didn't confirm the change\. Nothing is shown as done\./);
        assert.match(m.text(m.dialog()), /State nowUnknown — re-read before retrying/);
        assert.ok(m.byId('action-reread'));
        await m.click(m.byId('action-retry'));
        assert.equal(m.props(m.dialog())['data-step'], 2, 'Try again did not return to Review');
      }
    } finally { await m.done(); restore(); }
  });
}

test('mounted: a write-bar refusal makes the page read-only until step-up', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST(), onAct: async () => { throw Object.assign(new Error('TOTP required'), { status: 403 }); } });
  try {
    await m.click(m.find((n) => n.tagName === 'BUTTON' && /^Sign out account…/.test(m.text(n)) && m.inRow(n, 12)));
    await m.type(m.byId('action-reason'), REASON);
    await m.click(m.byId('action-continue'));
    await m.click(m.byId('action-confirm'));
    assert.equal(m.text(m.find((n) => m.props(n)?.id === m.props(m.dialog())['aria-labelledby'])), 'Refused — needs your authenticator and a fresh step-up');
    await m.click(m.byId('action-done'));
    assert.ok(m.byId('access-read-only'), 'the refusal did not make the page read-only');
  } finally { await m.done(); restore(); }
});

test('mounted: Sign out account — every session of that account reads Revoked; devices reached is Not instrumented', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    await m.click(m.find((n) => n.tagName === 'BUTTON' && /^Sign out account…/.test(m.text(n)) && m.inRow(n, 12)));
    assert.match(m.text(m.dialog()), /Sign out Fran Target everywhere\?/);
    assert.match(m.text(m.dialog()), /2 of their sessions are in the list read on this page/);
    await m.type(m.byId('action-reason'), REASON);
    await m.click(m.byId('action-continue'));
    await m.click(m.byId('action-confirm'));
    assert.deepEqual(m.calls, [['sign_out', 903, REASON]]);
    await act(async () => { m.replies[0].res({ ok: true, user_id: 903, revoked_at: 1793975405 }); });
    assert.match(m.text(m.dialog()), /Fran Target signed out everywhere/);
    assert.match(m.text(m.dialog()), /Which devices this reached: Not instrumented/);
    assert.equal(m.props(m.byId('hq-session-12'))['data-status'], 'revoked');
    assert.equal(m.props(m.byId('hq-session-14'))['data-status'], 'revoked');
    assert.equal(m.props(m.byId('hq-session-13'))['data-status'], 'active', 'another account was marked signed out');
    assert.ok(m.byId('action-done'));
  } finally { await m.done(); restore(); }
});

test('mounted: signing out your own account says you are signed out too, and ends at Sign in again', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    await m.click(m.find((n) => n.tagName === 'BUTTON' && /^Sign out account…/.test(m.text(n)) && m.inRow(n, 11)));
    assert.equal(m.props(m.byId('action-you'))['data-affected'], 'true');
    await m.type(m.byId('action-reason'), REASON);
    await m.click(m.byId('action-continue'));
    assert.match(m.text(m.dialog()), /YouSigned out — this is your own account/);
    await m.click(m.byId('action-confirm'));
    await act(async () => { m.replies[0].res({ ok: true, user_id: 901, revoked_at: 1793975405 }); });
    assert.equal(m.props(m.byId('action-sign-in')).href, '/login');
    assert.equal(m.byId('action-done'), undefined);
  } finally { await m.done(); restore(); }
});

test('mounted: emergency re-authentication — HQ-held wording, typed confirmation, the count only after it runs', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    await m.click(m.byId('access-emergency-open'));
    const t = m.text(m.dialog());
    assert.match(t, /Signs out every HQ-held account/);
    assert.match(t, /Every active account held in the HQ database must sign in again/);
    assert.match(t, /Branch databases are not touched/);
    assert.match(t, /You will be signed out too\./);
    assert.doesNotMatch(t, /tenant/i);
    await m.type(m.byId('action-reason'), 'Credential leak suspected, INC-112');
    await m.click(m.byId('action-continue'));
    const review = m.text(m.dialog());
    assert.match(review, /ScopeEvery HQ-held account; branch databases are not touched; you will be signed out too/);
    assert.match(review, /Not affectedAccounts held in branch databases/);
    assert.match(review, /How manyNot instrumented[\s\S]*shown after it runs/);
    assert.match(review, /YouSigned out after this completes/);
    assert.doesNotMatch(review, /\d+ active|\d+ HQ accounts/, 'a count was drawn before the run');
    // The typed confirmation: wrong text sends nothing.
    await m.type(m.byId('action-phrase'), 'sign out hq');
    await m.click(m.byId('action-confirm'));
    assert.equal(m.calls.length, 0, 'emergency ran without the typed confirmation');
    assert.match(m.text(m.dialog()), new RegExp(`Type ${EMERGENCY_PHRASE} exactly to confirm`));
    const phraseLabel = m.find((n) => n.tagName === 'LABEL' && m.props(n).htmlFor === m.props(m.byId('action-phrase')).id);
    assert.match(m.text(phraseLabel), /Type SIGN OUT HQ to confirm/);
    await m.type(m.byId('action-phrase'), EMERGENCY_PHRASE);
    await m.click(m.byId('action-confirm'));
    assert.deepEqual(m.calls, [['emergency', undefined, 'Credential leak suspected, INC-112']]);
    assert.equal(m.byId('action-result'), undefined);
    await act(async () => { m.replies[0].res({ ok: true, affected: 14, revoked_at: 1793975405 }); });
    assert.match(m.text(m.byId('action-affected')), /Accounts signed out:14— every active HQ-held account, including yours\. Branch databases were not touched\./);
    assert.equal(m.props(m.byId('action-sign-in')).href, '/login');
    for (const id of [11, 12, 13, 14]) assert.equal(m.props(m.byId(`hq-session-${id}`))['data-status'], 'revoked');
  } finally { await m.done(); restore(); }
});

test('mounted: an emergency reply without a count draws Unavailable, never 0', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST(), onAct: async () => ({ ok: true }) });
  try {
    await m.click(m.byId('access-emergency-open'));
    await m.type(m.byId('action-reason'), 'Credential leak suspected');
    await m.click(m.byId('action-continue'));
    await m.type(m.byId('action-phrase'), EMERGENCY_PHRASE);
    await m.click(m.byId('action-confirm'));
    const t = m.text(m.byId('action-affected'));
    assert.match(t, /Unavailable/);
    assert.doesNotMatch(t, /\b0\b/);
  } finally { await m.done(); restore(); }
});

test('mounted: End support session — closed, the token still valid until …, and a Sign out account shortcut (C1)', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    await m.click(m.button(/^End support session…/));
    assert.match(m.text(m.dialog()), /Sam Super acting as Fran Target · started Sat 7 Nov 2026, 14:02:00 UTC/);
    assert.match(m.text(m.dialog()), /This is your own support session\. Closing it does not end your admin session\./);
    await m.type(m.byId('action-reason'), 'Support ticket resolved');
    await m.click(m.byId('action-continue'));
    await m.click(m.byId('action-confirm'));
    assert.deepEqual(m.calls, [['end', 7, 'Support ticket resolved']]);
    await act(async () => { m.replies[0].res({ ok: true, impersonation_session_id: 7, target_user_id: 903 }); });
    assert.match(m.text(m.dialog()), /Support session record closed — its token is still valid/);
    assert.match(m.text(m.dialog()), /Its token stays valid until it expires — no later than Sat 7 Nov 2026, 15:00 UTC\./);
    assert.doesNotMatch(m.text(m.dialog()), /\bended\b(?! support)/i);
    const row = m.byId('hq-live-impersonation-7');
    assert.match(m.text(row), /Record closed/);
    assert.match(m.text(row), /Token still valid until no later than Sat 7 Nov 2026, 15:00 UTC/);
    // The shortcut opens Sign out account for the person the support session acted as.
    await m.click(m.byId('action-end-sign-out'));
    assert.match(m.text(m.dialog()), /Sign out Fran Target everywhere\?/);
    assert.equal(m.props(m.dialog())['data-step'], 1);
  } finally { await m.done(); restore(); }
});

for (const [code, status, result, title] of [
  ['past_ceiling', 409, 'expired', 'Past its ceiling — nothing changed'],
  ['already_ended', 409, 'already_revoked', 'Already ended — nothing changed'],
  ['session_not_found', 404, 'not_found', 'Not found — nothing changed'],
]) {
  test(`mounted: End support session, ${code} — its own result, the record not marked closed`, async () => {
    const restore = installDocument('', { focus: true });
    const m = await mount({ list: LIST(), onAct: async () => { throw Object.assign(new Error('refused'), { status, code }); } });
    try {
      await m.click(m.button(/^End support session…/));
      await m.type(m.byId('action-reason'), 'Support ticket resolved');
      await m.click(m.byId('action-continue'));
      await m.click(m.byId('action-confirm'));
      assert.equal(m.props(m.byId('action-result'))['data-result'], result);
      assert.equal(m.text(m.find((n) => m.props(n)?.id === m.props(m.dialog())['aria-labelledby'])), title);
      assert.equal(m.byId('action-end-sign-out'), undefined);
      if (code !== 'already_ended') assert.match(m.text(m.byId('hq-live-impersonation-7')), /Open/);
    } finally { await m.done(); restore(); }
  });
}

test('mounted: bulk revoke — review lists each row with the one reason, then per-row outcomes', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    const box = (id) => m.find((n) => n.tagName === 'INPUT' && m.props(n).type === 'checkbox' && m.inRow(n, id));
    for (const id of [12, 14, 13]) await act(async () => { m.props(box(id)).onChange(); });
    assert.match(m.text(m.byId('hq-sessions-revoke-selected')), /Revoke selected \(3\)…/);
    await m.click(m.byId('hq-sessions-revoke-selected'));
    assert.match(m.text(m.dialog()), /3 sessions on 2 accounts/);
    assert.match(m.text(m.dialog()), /Each revoke is recorded separately, with the one reason below/);
    await m.type(m.byId('action-reason'), 'Lost laptop reported in ops');
    await m.click(m.byId('action-continue'));
    const review = m.text(m.dialog());
    assert.match(review, /ReasonLost laptop reported in ops/);
    assert.match(review, /LimitUp to 100 sessions per request/);
    const listed = m.text(m.byId('action-review-rows'));
    assert.match(listed, /Fran Target · Firefox 132 · Windows 10 or 11 · session 12/);
    assert.match(listed, /Fran Target · Safari 17 · iOS 17\.1 · session 14/);
    assert.match(listed, /olu@example\.com · No user agent stored · session 13/);
    await m.click(m.byId('action-confirm'));
    assert.deepEqual(m.calls, [['revoke_selected', [12, 14, 13], 'Lost laptop reported in ops']]);
    await act(async () => {
      m.replies[0].res({ ok: true, revoked: 1, results: [{ id: 12, outcome: 'revoked' }, { id: 14, outcome: 'already_revoked' }, { id: 13, outcome: 'not_found' }] });
    });
    assert.equal(m.text(m.find((n) => m.props(n)?.id === m.props(m.dialog())['aria-labelledby'])), 'Revoked 1 of 3 sessions');
    assert.equal(m.props(m.byId('action-result'))['data-result'], 'partial');
    assert.equal(m.props(m.byId('action-row-12'))['data-outcome'], 'revoked');
    assert.match(m.text(m.byId('action-row-12')), /session 12Revoked \(/);
    assert.match(m.text(m.byId('action-row-14')), /had already been revoked — nothing changed[\s\S]*Already revoked/);
    assert.match(m.text(m.byId('action-row-13')), /no session holds this id — nothing changed[\s\S]*Not found/);
    assert.equal(m.props(m.byId('hq-session-12'))['data-status'], 'revoked');
    assert.equal(m.props(m.byId('hq-session-14'))['data-status'], 'revoked');
    assert.equal(m.props(m.byId('hq-session-13'))['data-status'], 'active', 'a not-found row was marked revoked');
    assert.match(m.text(m.byId('hq-sessions-revoke-selected')), /\(0\)/, 'the selection survived the revoke');
  } finally { await m.done(); restore(); }
});

test('bulk select respects SESSION_BULK_LIMIT: select-all takes 100 and says so', async () => {
  assert.equal(SESSION_BULK_LIMIT, 100);
  assert.equal(MIN_REASON, 8);
  const restore = installDocument('', { focus: true });
  const base = LIST().rows[1];
  const rows = [LIST().rows[0], ...Array.from({ length: 120 }, (_, i) => ({ ...base, id: 100 + i, user_id: 2000 + i }))];
  const m = await mount({ list: { ...LIST(), total: 121, rows } });
  try {
    await act(async () => { m.props(m.byId('hq-sessions-select-all')).onChange(); });
    assert.match(m.text(m.byId('hq-sessions-revoke-selected')), /\(100\)/);
    assert.match(m.text(m.byId('access-limit')), /100 selected — the most one request can revoke/);
    const left = m.find((n) => n.tagName === 'INPUT' && m.props(n).type === 'checkbox' && m.inRow(n, 219));
    assert.equal(m.props(left).disabled, true, 'a 101st session could be selected');
    await act(async () => { m.props(left).onChange(); });
    assert.match(m.text(m.byId('hq-sessions-revoke-selected')), /\(100\)/);
  } finally { await m.done(); restore(); }
});

test('mounted: keyboard — Tab and Shift+Tab wrap inside the dialog, Esc closes it, focus returns (or goes to the caption)', async () => {
  const restore = installDocument('', { focus: true });
  const m = await mount({ list: LIST() });
  try {
    const opener = m.find((n) => n.tagName === 'BUTTON' && /^Revoke this session…/.test(m.text(n)) && m.inRow(n, 13));
    opener.focus();
    await m.click(opener);
    const close = m.byId('action-close');
    const last = m.byId('action-continue');
    assert.equal(m.props(close)['aria-label'], 'Cancel and close');
    last.focus();
    await m.key(m.dialog(), 'Tab');
    assert.ok(document.activeElement === close, 'Tab from the last control left the dialog');
    await m.key(m.dialog(), 'Tab', { shiftKey: true });
    assert.ok(document.activeElement === last, 'Shift+Tab from the first control left the dialog');
    await m.key(m.dialog(), 'Escape');
    assert.equal(m.dialog(), undefined, 'Esc did not close the dialog');
    assert.ok(document.activeElement === opener, 'focus did not return to the opener');

    // The opener gone (its row revoked), focus lands on the table's caption.
    await m.click(opener);
    opener.parentNode.removeChild(opener);
    await m.key(m.dialog(), 'Escape');
    assert.equal(document.activeElement?.tagName, 'CAPTION', 'focus was lost with the opener');
  } finally { await m.done(); restore(); }
});

// ────────────────────────────────────────────── the page and the wording ──

const OVERVIEW = () => ({
  audit: { total: 1 }, impersonations: { available: true, active: 1, recent: [] },
  sessions: { available: true, active: 4, token_hours: 24 }, mfa: { admins_total: 2, admins_with_mfa: 0 },
  kyc: {}, kyc_not_recorded: [], dsr: { clock_days: 30, kinds: [], rows: [], by_branch: [], branches: { bound: 0, reason: 'r' } },
  security_events: { available: true, today: 0, failed_signins_24h: 0, retention_days: 400, not_counted: [] },
  ai_safety: { window_days: 7, verdicts: { available: false, reason: 'r' }, enforcement: { available: false, reason: 'r' }, guard: { available: false, reason: 'r' }, token_anomalies: { available: false, reason: 'r' }, not_counted: [] },
  sanctions: { available: false, reason: 'r' }, backup_dr: { backup: { available: false, reason: 'r' }, drill: { available: false, reason: 'r' }, not_recorded: [] },
});
const FEED = () => ({ filter: 'all', filters: [], rows: [], limit: 60, more: false, sources: [], data_access: { expiry_minutes: 30, impersonations: { available: true, items: [] }, exports: { available: true, items: [] } } });
const page = (tab, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(SecurityConsole, {
  tab, data: OVERVIEW(), load: () => {}, feed: FEED(), filter: 'all', setFilter: () => {}, loadFeed: () => {},
  sessionList: LIST(), loadSessions: () => {}, onSessionAct: async () => ({}), readAt: {}, ...props,
})));

test('no "all tenants" anywhere: not on any workspace, not in the dialogs, not in the source', () => {
  for (const tab of ['overview', 'events', 'access', 'privacy', 'trust', 'ai-safety', 'resilience']) {
    assert.doesNotMatch(renderedText(page(tab)), /all tenants|every tenant/i, `${tab} overstates the emergency's reach`);
  }
  const dir = resolve(root, 'src/pages/hq/security');
  const files = ['src/pages/hq/SecurityPage.jsx', ...readdirSync(dir).filter((f) => /\.jsx?$/.test(f)).map((f) => `src/pages/hq/security/${f}`)];
  for (const f of files) assert.doesNotMatch(readFileSync(resolve(root, f), 'utf8'), /all tenants|every tenant|Force re-auth ·/i, f);
});

test('the Access tab: the page-level reason fields are gone, the workspace and the tiles are there, unread is never 0', () => {
  const html = page('access');
  assert.doesNotMatch(renderedText(html), /Reason · required for any act below|I understand this signs out/, 'a page-level reason field is back');
  for (const id of ['access-workspace', 'hq-sessions-table', 'hq-support-sessions', 'access-reach', 'hq-force-reauth', 'hq-data-access']) {
    assert.match(html, new RegExp(`data-testid="${id}"`));
  }
  assert.match(renderedText(html), /Live support sessions/);
  const ov = OVERVIEW(); ov.sessions = { available: false, reason: 'unreadable here' }; ov.impersonations = { available: false, reason: 'x' };
  const unread = page('access', { data: ov, sessionList: UNAVAILABLE });
  const tiles = between(unread, '>Active sessions<', '>Admins with MFA<');
  assert.match(tiles, /data-state="unavailable"/);
  assert.doesNotMatch(renderedText(tiles), /\b0\b|Not recorded/, 'an unreadable tile drew 0 or "Not recorded"');
});

test('Overview\'s Emergency card is worded for HQ-held accounts and points to Access', () => {
  const m = buildOverview({ overview: { state: 'ready', value: OVERVIEW(), at: null }, feed: { state: 'ready', value: FEED(), at: null } });
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(OverviewWorkspace, { model: m, onRetry: {} })));
  const card = between(html, 'data-testid="security-overview-emergency"', '</section>');
  assert.match(renderedText(card), /Signs out every HQ-held account, you included\. Branch databases are not touched\./);
  assert.match(card, /href="\/\?tab=access#emergency"|href="\?tab=access#emergency"/);
});

test('emergency goes through the page\'s one door to its own route', async () => {
  const seen = [];
  const client = new Proxy({}, { get: (_t, name) => async (...args) => { seen.push([name, ...args]); return {}; } });
  await runSessionAct(client, 'emergency', undefined, 'reason text');
  assert.deepEqual(seen, [['hqSecurityForceReauth', 'reason text']]);
});
