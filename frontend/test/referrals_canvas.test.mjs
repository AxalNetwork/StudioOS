/**
 * Refer & Earn canvas integration — page body matches Refer___Earn.dc sections
 * while keeping production SidebarNav (no canvas `.side` nav).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

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
  assert.match(app, /location\.pathname === '\/referrals'/);
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
