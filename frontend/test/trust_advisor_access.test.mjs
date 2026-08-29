/**
 * An advisor could see the Trust Center link and not the Trust Center.
 *
 * `services/trust.ts`'s ROLE_MATRIX gives advisors four obligations, two of
 * them REQUIRED — `mentor_nda_v1` and `mentor_disclaimer_v1`. `GET /trust/me`
 * is `requireAuth`, so the server would have answered. But the SPA route guard
 * on /trust listed admin, founder, partner, investor and exploring, and not
 * advisor — while the "Trust Center" link in the user dropdown (App.jsx, in the
 * account menu) carries no role gating at all.
 *
 * So every advisor saw a link to the only page listing what they owe, clicked
 * it, and was bounced. Not a missing feature — an unreachable one, in the
 * blank-page class.
 *
 * These tests pin the three facts that made it a bug, so the guard cannot
 * narrow again without one of them being reconsidered first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const page = read('frontend/src/pages/TrustCenterPage.jsx');
const service = read('cloudflare-worker/src/services/trust.ts');

const trustRoute = () => app.split('\n').find((l) => l.includes('path="/trust"'));

test('the advisor obligations that make this a bug still exist', () => {
  const matrix = service.slice(service.indexOf('const ROLE_MATRIX'), service.indexOf('export function obligationsForRole'));
  const advisor = matrix.slice(matrix.indexOf('advisor: ['), matrix.indexOf('partner: ['));
  for (const key of ['mentor_nda_v1', 'mentor_disclaimer_v1']) {
    assert.ok(advisor.includes(key), `advisor no longer owes ${key}`);
    assert.match(advisor, new RegExp(`${key}',?\\s*required: 1`), `${key} is no longer required`);
  }
});

test('an advisor can reach /trust', () => {
  const line = trustRoute();
  assert.ok(line, '/trust is not routed');
  assert.ok(line.includes("'advisor'"),
    'advisors owe two required obligations and this is the only page listing them');
});

test('every role the ungated dropdown link is shown to can open the page', () => {
  // The link has no role check, so the guard is the whole gate. Any signed-in
  // role that reaches the dropdown must be on it.
  assert.match(app, /<Link to="\/trust"/);
  const line = trustRoute();
  for (const role of ['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring']) {
    assert.ok(line.includes(`'${role}'`), `${role} sees the link and cannot open the page`);
  }
});

test('widening the guard did not invent an obligation advisors do not have', () => {
  // The Identity tab is shown to KYC_ELIGIBLE_ROLES. Advisors' matrix carries
  // no kyc_v1 row, so adding them there would show an obligation the platform
  // does not place on them.
  const set = page.slice(page.indexOf('const KYC_ELIGIBLE_ROLES'), page.indexOf('\n', page.indexOf('const KYC_ELIGIBLE_ROLES')));
  assert.ok(!set.includes('advisor'), 'advisors have no kyc_v1 obligation');
  const matrix = service.slice(service.indexOf('advisor: ['), service.indexOf('partner: ['));
  assert.ok(!matrix.includes('kyc_v1'), 'if advisors now owe KYC, add them to KYC_ELIGIBLE_ROLES');
  // And the comment that used to say "every persona that can reach the Trust
  // Center is KYC-eligible" must no longer say that, because it is now false.
  assert.doesNotMatch(page, /every persona that can reach the Trust Center[\s\S]{0,40}is KYC-eligible/);
});

test('Trust Center is still reached from the dropdown, not the sidebar', () => {
  // trust_center_navigation.test.mjs pins it out of every sidebar; this is the
  // other half of that arrangement and the reason the guard matters so much.
  assert.doesNotMatch(read('frontend/src/sidebarConfig.js'), /to: '\/trust'/);
});
