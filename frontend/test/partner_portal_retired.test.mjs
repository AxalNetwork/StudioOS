import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const code = (path) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('/partner-portal and /partners/portal redirect to Refer & earn, and both pages are gone', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/partner-portal" element=\{guard\(\['admin', 'partner', 'investor'\], <PartnerPortalRedirect \/>\)\}/);
  // #2342: the deal portal at /partners/portal was removed with its features
  // (the owner, 2026-10-21); both addresses land on /referrals, keeping the
  // query string and the hash.
  assert.match(app, /path="\/partners\/portal" element=\{guard\(\['admin', 'partner'\], <PartnerPortalRedirect \/>\)\}/);
  assert.match(app, /function PartnerPortalRedirect\(\)[\s\S]{0,280}?pathname: '\/referrals', search: loc\.search, hash: loc\.hash/);
  assert.doesNotMatch(code('frontend/src/App.jsx'), /\bPartnerPortal\b|\bPartnerDealPortal\b/);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/PartnerPortal.jsx')), false);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/PartnerDealPortal.jsx')), false);
  // The survivor is a page, not another redirect.
  assert.match(app, /path="\/referrals" element=\{guard\(\[[^\]]*'partner'[^\]]*\], <ReferralsPage \/>\)\}/);
});

test('nothing in the sidebar or partner onboarding still opens the retired page', () => {
  assert.doesNotMatch(code('frontend/src/sidebarConfig.js'), /\/partner-portal/);
  assert.doesNotMatch(code('frontend/src/pages/OnboardingPartnerPage.jsx'), /\/partner-portal/);
  assert.match(read('frontend/src/pages/OnboardingPartnerPage.jsx'), /navigate\(user\?\.role === 'exploring' \? '\/exploring' : '\/studio'\)/);
  assert.match(read('frontend/src/pages/OnboardingPartnerPage.jsx'), /Open Studio/);
});

test('advisor deep links and the partner checklist no longer name the retired page', () => {
  assert.doesNotMatch(code('frontend/src/lib/advisor/banks/partner.js'), /\/partner-portal/);
  assert.doesNotMatch(code('cloudflare-worker/src/services/advisor/banks/operatingPartner.ts'), /\/partner-portal/);
  assert.doesNotMatch(code('cloudflare-worker/src/services/onboardingChecklist.ts'), /\/partner-portal/);
  assert.match(read('cloudflare-worker/src/services/onboardingChecklist.ts'), /key: 'op\.kyb'[\s\S]{0,160}?route: '\/trust'/);
  assert.doesNotMatch(code('cloudflare-worker/src/services/onboardingChecklist.ts'), /\/partners\/portal/);
  assert.match(read('cloudflare-worker/src/services/onboardingChecklist.ts'), /key: 'op\.deal_type'[\s\S]{0,160}?route: '\/referrals'/);
  // The rev-share window warning linked the removed portal's redemption list.
  assert.doesNotMatch(code('cloudflare-worker/src/services/partnerDeals.ts'), /\/partners\/portal/);
});
