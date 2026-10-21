/**
 * D814 retired by the owner in #2314: no member page or advertised entry
 * point remains; historical notification/bookmark URLs forward to Studio.
 * The partner/HQ programme-management contracts stay in D812/D815's tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = () => ({
  app: read('../src/App.jsx'),
  account: read('../src/ui/phone/AccountSheet.jsx'),
  rail: read('../src/lib/railPages.js'),
  founder: read('../src/pages/founder/FounderStudioHome.jsx'),
  founderBody: read('../src/pages/founder/FounderStudioBody.jsx'),
  investor: read('../src/pages/investor/InvestorStudioHome.jsx'),
  advisor: read('../src/pages/advisor/AdvisorStudioHome.jsx'),
  partner: read('../src/pages/partner/PartnerStudioHome.jsx'),
  redirects: read('../../cloudflare-worker/src/services/redirectRoutes.ts'),
  notifications: read('../../cloudflare-worker/src/services/testing.ts'),
});

function removed(s) {
  assert.doesNotMatch(s.app, /ProductTestingPage|<Link\b[^>]*to="\/product-testing"/, 'no member page or desktop Account entry');
  assert.doesNotMatch(s.account, /\/product-testing/, 'no phone Account entry');
  assert.doesNotMatch(s.rail, /off\('\/product-testing'/, 'no retired member rail entry');
  for (const key of ['founder', 'founderBody', 'investor', 'advisor', 'partner']) {
    assert.doesNotMatch(s[key], /ProductTestingCard|testingCard/, key + ': no card advertising the removed page');
  }
}

function forwards(s) {
  assert.match(s.notifications, /export const MY_APPLICATIONS_LINK = '\/inbox';/, 'new status notifications open Inbox');
  assert.match(s.app, /<Route path="\/product-testing" element=\{guard\(\[[^\]]+\], <Navigate to="\/studio" replace \/>\)\} \/>/, 'old member links forward to Studio behind auth');
  assert.match(s.redirects, /\{ path: '\/product-testing', keep: true \}/, 'historical notification URL stays in the redirect inventory');
}

test('the member page, desktop/phone Account entries and Studio cards are retired', () => {
  const s = sources();
  removed(s);
  // Each isolated regression must fail, then the unmodified sources pass again.
  const mutations = [
    ['app', '\nconst ProductTestingPage = () => null;'],
    ['app', '\n<Link to="/product-testing">Product testing</Link>'],
    ['account', "\n['Product testing', '/product-testing']"],
    ['rail', "\noff('/product-testing', key(P, 'Product testing'))"],
    ...['founder', 'founderBody', 'investor', 'advisor', 'partner'].map((key) => [key, '\n<ProductTestingCard />']),
  ];
  for (const [key, addition] of mutations) {
    assert.throws(() => removed({ ...s, [key]: s[key] + addition }), assert.AssertionError, key);
    removed(s);
  }
});

test('old Product testing URLs redirect to Studio and remain counted', () => {
  const s = sources();
  forwards(s);
  assert.throws(() => forwards({ ...s, notifications: s.notifications.replace("MY_APPLICATIONS_LINK = '/inbox'", "MY_APPLICATIONS_LINK = '/product-testing?tab=applications'") }), assert.AssertionError);
  forwards(s);
  const route = s.app.split('\n').find((line) => line.includes('<Route path="/product-testing"'));
  assert.throws(() => forwards({ ...s, app: s.app.replace(route, route.replace('to="/studio"', 'to="/account"')) }), assert.AssertionError);
  forwards(s);
  assert.throws(() => forwards({ ...s, redirects: s.redirects.replace("{ path: '/product-testing', keep: true }", "{ path: '/product-testing' }") }), assert.AssertionError);
  forwards(s);
});
