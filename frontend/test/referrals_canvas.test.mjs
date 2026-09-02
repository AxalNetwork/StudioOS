/**
 * Refer & Earn canvas integration — page body matches Refer___Earn.dc sections
 * while keeping production SidebarNav (no canvas `.side` nav).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { SHARED_FULL_BLEED } from '../src/sidebarConfig.js';

const page = readFileSync(resolve(process.cwd(), 'frontend/src/pages/ReferralsPage.jsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'frontend/src/App.jsx'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'frontend/src/pages/referrals/referrals.css'), 'utf8');

const sections = [
  'Refer & Earn',
  'Referral categories',
  'Your referral link',
  'QR code',
  'Download PNG',
  'Import contacts',
  'Your referrals',
  'Reward logic',
  'Referral partner program',
  'Policy &amp; FAQ',
  'Submit a referral',
];

for (const label of sections) {
  test(`ReferralsPage renders canvas section: ${label}`, () => {
    assert.match(page, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
}

test('uses canvas stylesheet without importing canvas sidebar', () => {
  assert.match(page, /referrals\/referrals\.css/);
  assert.doesNotMatch(page, /className="[^"]*\bside\b/);
  assert.doesNotMatch(css, /\.side\b/);
});

test('/referrals is a flush full-width surface in App shell', () => {
  // Asserted through the LIST, not a path check in App.jsx, and the difference
  // matters. `fullWidthSurface` and `flushSurface` were once two hand-typed
  // arrays of the same paths, and `/grow/focus` went missing from one of them —
  // which is the whole of "Grow doesn't fit full width". They now derive from a
  // single `fullBleedSurface`, and `founder_shell.test.mjs` and
  // `investor_shell.test.mjs` both pin that derivation exactly.
  //
  // So a path may not be added by appending `pathname === '/x'` to both flags:
  // that re-creates the duplication, and it broke both of those guards. It goes
  // in a list instead. `/referrals` is in the role-agnostic one because admin,
  // founder, partner and investor all open the same page at the same path.
  assert.ok(SHARED_FULL_BLEED.includes('/referrals'),
    '/referrals must be declared full-bleed in sidebarConfig, not in App.jsx');
  assert.match(app, /\|\| SHARED_FULL_BLEED\.includes\(location\.pathname\)/,
    'App.jsx must consult the shared list');
  assert.match(app, /const flushSurface = fullBleedSurface;/,
    'flushSurface must derive from the shared test, with nothing appended');
});

test('wires canvas-only features to live APIs', () => {
  assert.match(page, /api\.referralOverview/);
  assert.match(page, /api\.emailInvites/);
  assert.match(page, /api\.emailSendReferralInvites/);
  assert.match(page, /api\.referralStrategicAccess/);
  assert.match(page, /QRCode\.toCanvas/);
  assert.match(page, /QRCode\.toDataURL/);
});

test('does not reintroduce Stripe Connect payouts UI', () => {
  const code = codeOnly(page);
  assert.doesNotMatch(code, /stripe/i);
  assert.doesNotMatch(code, /\bpayout/i);
});
