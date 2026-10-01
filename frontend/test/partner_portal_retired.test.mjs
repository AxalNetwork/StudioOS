import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const code = (path) => read(path)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

test('/partner-portal redirects to Studio and the cockpit page is gone', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /path="\/partner-portal" element=\{guard\(\['admin', 'partner', 'investor'\], <PartnerPortalRedirect \/>\)\}/);
  assert.match(app, /function PartnerPortalRedirect\(\)[\s\S]{0,280}?pathname: '\/studio'/);
  assert.doesNotMatch(code('frontend/src/App.jsx'), /\bPartnerPortal\b/);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/PartnerPortal.jsx')), false);
  // The deal page is a different route and stays.
  assert.match(app, /path="\/partners\/portal"/);
  assert.ok(existsSync(resolve(root, 'frontend/src/pages/PartnerDealPortal.jsx')));
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
  assert.match(read('cloudflare-worker/src/services/onboardingChecklist.ts'), /key: 'op\.deal_type'[\s\S]{0,160}?route: '\/partners\/portal'/);
});
