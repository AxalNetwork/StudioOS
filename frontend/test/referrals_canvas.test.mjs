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
  // in a list instead. `/referrals` is in the role-agnostic one because every
  // signed-in licence — admin, founder, partner, investor and advisor — opens the
  // same page at the same path.
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

/**
 * `/refer` and `/payouts` exist only to arrive at `/referrals`, so the three
 * carry one role list. Two of them had drifted: both omitted `advisor` while
 * `/referrals` admitted it, so an advisor following a `/refer` link was bounced
 * by RoleGuard off a page `/referrals` would have shown them.
 *
 * PARSED PER ROUTE, NOT GREPPED FOR A LIST. A substring check for one role array
 * would pass on any route in the file that happened to carry it. Each segment is
 * cut at the next `<Route`, so a neighbour's roles cannot be read as this one's.
 */
function guardRoles(src, path) {
  for (const seg of src.split('<Route').slice(1)) {
    const p = /^\s*path="([^"]+)"/.exec(seg);
    if (!p || p[1] !== path) continue;
    const next = seg.indexOf('\n      <Route');
    const body = next >= 0 ? seg.slice(0, next) : seg;
    const arr = /guard\(\[([^\]]*)\]/.exec(body);
    if (!arr) return { roles: null, body };
    return { roles: [...arr[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), body };
  }
  return null;
}

const FAMILY = ['/referrals', '/refer', '/payouts'];

test('the /referrals family is one route with two aliases, on one role list', () => {
  const rows = FAMILY.map((p) => [p, guardRoles(app, p)]);
  for (const [p, row] of rows) {
    assert.ok(row, `${p} is no longer a route in App.jsx`);
    assert.ok(row.roles, `${p} is no longer role-guarded`);
  }

  // The aliases must still BE aliases. Without this, the equality below would
  // pin a coincidence: two unrelated routes that happen to share a role list.
  const refer = rows[1][1];
  const payouts = rows[2][1];
  assert.match(refer.body, /<ReferRedirect \/>/,
    '/refer no longer renders ReferRedirect, so it may not lead to /referrals');
  assert.match(app, /function ReferRedirect\(\)[\s\S]{0,240}?pathname: '\/referrals'/,
    'ReferRedirect no longer navigates to /referrals');
  assert.match(payouts.body, /<Navigate to="\/referrals" replace \/>/,
    '/payouts no longer redirects to /referrals');

  const [canonical, ...aliases] = rows;
  for (const [p, row] of aliases) {
    assert.deepEqual(row.roles, canonical[1].roles,
      `${p} redirects to /referrals but admits ${JSON.stringify(row.roles)} against `
      + `${JSON.stringify(canonical[1].roles)} — a role the destination admits is `
      + 'bounced before it gets there');
  }
  // Advisor is the one this drift cost, and the route's own comment explains why
  // it belongs: ReferralsPage has no role branch and every endpoint it calls is
  // requireAuth scoped to referrer_user_id.
  assert.ok(canonical[1].roles.includes('advisor'),
    '/referrals dropped advisor; Network · Relationships reads these rows');
});

test('/referrals is not wrapped in the partner-preview bounce', () => {
  // `partnerPrivateWorkspace` renders <Navigate to="/studio"> whenever
  // effectiveRole === 'partner' && user.role !== 'partner' — an admin previewing
  // Partner. It was wrapping this page, which has no role branch at all, so the
  // preview silently lost a page the plain Admin view shows. The wrapper is
  // correct on genuinely partner-scoped surfaces; this is not one of them.
  const row = guardRoles(app, '/referrals');
  assert.doesNotMatch(row.body, /partnerPrivateWorkspace/,
    '/referrals is wrapped in partnerPrivateWorkspace again, which bounces an '
    + 'admin previewing Partner to /studio over a page that has no partner scope');
  // The helper must still exist and still bounce, or the assertion above is
  // guarding against a name that no longer does anything.
  assert.match(app, /const partnerPrivateWorkspace = \(component\) => \(\s*\n\s*partnerRolePreview \? <Navigate to="\/studio" replace \/> : component/,
    'partnerPrivateWorkspace no longer bounces to /studio; this guard now pins nothing');
});
