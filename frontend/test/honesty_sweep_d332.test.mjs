/**
 * D332 — "Unreadable", never zero, across referrals, events and calendar.
 *
 * The worker half (notifications.ts) has its own test on real SQLite
 * (`cloudflare-worker/test/notifications_unreadable_d332.test.ts`), and
 * DocsLayout's status line has its own re-aimed test
 * (`docs_still_stuck_status.test.mjs`). This file covers the rest: source
 * assertions over CODE ONLY, since none of these pages take their `api`
 * client as an injectable prop — there is no seam for a live-response test
 * without restructuring each page, which is out of this task's scope.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { formatEventPrice } from '../src/lib/money.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── money.js — a pure function, actually executed ───────────────────────────

test('formatEventPrice respects the event\'s own currency, never a bare $', () => {
  assert.equal(formatEventPrice(2000, 'usd'), '$20.00');
  assert.equal(formatEventPrice(2000, 'eur'), '€20.00');
  assert.equal(formatEventPrice(2000, 'gbp'), '£20.00');
  // No currency recorded — defaults to usd, still through the formatter.
  assert.equal(formatEventPrice(500, null), '$5.00');
});

// ── ReferralsPage.jsx ────────────────────────────────────────────────────────

test('ReferralsPage: a failed invites read is tracked, never folded into empty', () => {
  const src = codeOnly(raw('frontend/src/pages/ReferralsPage.jsx'));
  assert.match(src, /invitesUnreadable/, 'no state distinguishes a failed invites read from a genuinely empty one');
  assert.ok(!/api\.emailInvites\(\)\.catch\(\(\) => \(\{ invites: \[\] \}\)\)/.test(src),
    'a failed invites read is still silently rewritten as an empty list');
});

test('ReferralsPage: a load failure suppresses the stat tiles instead of showing zeroes', () => {
  const src = codeOnly(raw('frontend/src/pages/ReferralsPage.jsx'));
  const i = src.indexOf('loading ? (');
  assert.ok(i > 0, 'the loading/error/content branch could not be found');
  const branch = src.slice(i, i + 400);
  assert.match(branch, /loadError \? \(/, 'the tiles render even when a load error is present');
});

// ── MyEventsPage.jsx ─────────────────────────────────────────────────────────

test('MyEventsPage: a failed events read renders Unreadable, not "not hosting any events yet"', () => {
  const src = codeOnly(raw('frontend/src/pages/events/MyEventsPage.jsx'));
  assert.match(src, /loadError/, 'no state survives a failed read past the toast');
  assert.match(src, /import \{ Unreadable \} from '\.\.\/\.\.\/ui'/, 'the honest-failure component is never imported');
  const i = src.indexOf('loading ? (');
  const branch = src.slice(i, i + 300);
  assert.match(branch, /loadError \? \(/, 'the hosting/attending lists still render on a load failure');
});

// ── PublicEventsPage.jsx — currency ──────────────────────────────────────────

test('PublicEventsPage: a priced event goes through the shared currency-aware formatter', () => {
  const src = codeOnly(raw('frontend/src/pages/events/PublicEventsPage.jsx'));
  assert.match(src, /import \{ formatEventPrice \} from '\.\.\/\.\.\/lib\/money'/,
    'the shared formatter is not imported');
  assert.match(src, /formatEventPrice\(ev\.price_cents, ev\.currency\)/,
    'the price is not drawn through formatEventPrice with the event\'s own currency');
  assert.ok(!/\$\{\(ev\.price_cents \/ 100\)\.toFixed\(2\)\}/.test(src),
    'a bare $-prefixed price literal is still in the file');
});

test('PublicEventDetailPage: the local formatMoney duplicate is gone, in favour of the shared one', () => {
  const src = raw('frontend/src/pages/events/PublicEventDetailPage.jsx');
  assert.match(src, /import \{ formatEventPrice as formatMoney \} from '\.\.\/\.\.\/lib\/money'/,
    'the page declared its own copy of the formatter again');
  assert.ok(!/function formatMoney\(cents, currency\)/.test(src),
    'a second, local formatMoney definition exists alongside the shared one');
});

// ── CalendarPage.jsx — provider status ───────────────────────────────────────

test('CalendarPage: a failed provider-status read is never coerced into "not configured"', () => {
  const src = codeOnly(raw('frontend/src/pages/CalendarPage.jsx'));
  assert.ok(!/setGoogle\(\{ available: false, connected: false, error: e\.message \}\)/.test(src),
    'a failed Google status read still sets available: false, which reads as "no OAuth credentials"');
  assert.ok(!/setMicrosoft\(\{ available: false, connected: false, error: e\.message \}\)/.test(src),
    'a failed Microsoft status read still sets available: false');
  assert.match(src, /unreadable: true, connected: false/, 'a failed status read carries no distinct flag at all');
  // providerState must check the new flag BEFORE the unconfigured branch —
  // checking it after would never be reached, since `unreadable` fixtures
  // also carry no `available`/`configured` key (both undefined, not false).
  const fnAt = src.indexOf('function providerState');
  const fn = src.slice(fnAt, src.indexOf('}', src.indexOf('return', fnAt) + 200));
  const unreadableAt = fn.indexOf('unreadable');
  const unconfiguredAt = fn.indexOf('unconfigured');
  assert.ok(unreadableAt >= 0 && unconfiguredAt >= 0 && unreadableAt < unconfiguredAt,
    'providerState does not check the unreadable flag before the unconfigured one');
});

test('CalendarPage: the unreadable provider state offers a real retry, not a dead end', () => {
  const src = codeOnly(raw('frontend/src/pages/CalendarPage.jsx'));
  assert.match(src, /onRetry=\{loadGoogle\}/, 'the Google card is never given a way to retry its own status read');
  assert.match(src, /onRetry=\{loadMicrosoft\}/, 'the Microsoft card is never given a way to retry its own status read');
  const specAt = src.indexOf('unreadable: {');
  assert.ok(specAt > 0, 'the unreadable spec entry is missing');
  const entry = src.slice(specAt, src.indexOf('},', specAt));
  assert.match(entry, /actions: \[\['Retry', .*, onRetry\]\]/, 'the unreadable card offers no retry action');
});

// ── WellbeingPage.jsx ─────────────────────────────────────────────────────────

test('WellbeingPage: a request failure of any kind reaches the error state, not insufficient_data', () => {
  const src = codeOnly(raw('frontend/src/pages/WellbeingPage.jsx'));
  assert.ok(!/insufficient_data: true, cohort_size: 0, submissions: 0/.test(src),
    'a caught error is still synthesized into the worker\'s own "small cohort" shape');
  assert.ok(!/quiet404/.test(src),
    'a 404 on /resources or /daily is still quietly rewritten into an empty-but-successful shape');
});
