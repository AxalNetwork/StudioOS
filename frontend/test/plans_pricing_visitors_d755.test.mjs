// D755 §13 (#1915, CR5 PR 3) — visitors: /plans-and-pricing opens without
// sign-in and shows the plans (from the public read, since the catalog needs a
// session) and the Token packs, with Sign in to buy. The member-only parts are
// not drawn and not read. /products keeps its #hash, the public /pricing page
// reads its prices from the same read, and the door pages link to the packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import BundleCard from '../src/components/products/BundleCard.jsx';
import { visitorPlanProducts, planForProduct, planOf, planAi, pricedTier, VISITOR_SIGN_IN } from '../src/lib/plansPricing.js';
import { isBundleProduct, bundleContentFor } from '../src/components/products/productsShared.js';
import { TOKEN_PACKS_PATH } from '../src/lib/aiTokens.js';
import { sameOriginNextPath } from '../src/lib/pendingNext.js';
import { AI_TOKENS } from '../src/lib/siteDoors.js';
import { FOUNDER_TIERS, INVESTOR_TIERS } from '../src/data/pricing.js';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const ready = (data) => ({ status: 'ready', data });

// D783 (#2124): a plan includes 25% of its price each month; no plan, none.
const A = (m) => ({ share: 0.25, monthly_microusd: m, source: m ? 'plan' : 'none' });
const month = (cents, id) => ({ price_id: id, unit_amount: cents, currency: 'usd', interval: 'month', interval_count: 1 });
const year = (cents, id) => ({ price_id: id, unit_amount: cents, currency: 'usd', interval: 'year', interval_count: 1 });
const READ = {
  plans: [
    { family: 'founder', licence_key: 'founder:free', product_id: null, plan_name: null, free: true, prices: [], allowance: A(0) },
    { family: 'founder', licence_key: 'founder:growth', product_id: 'prod_g', plan_name: 'Validate + Build', free: false, prices: [month(2500, 'price_gm'), year(24000, 'price_gy')], allowance: A(6_250_000) },
    { family: 'investor', licence_key: 'investor:professional', product_id: 'prod_ip', plan_name: 'Investor — Professional', free: false, prices: [month(14900, 'price_ip')], allowance: A(37_250_000) },
    { family: 'partner', licence_key: 'partner', product_id: 'prod_p', plan_name: 'Operating Partner', free: false, prices: [month(9900, 'price_p')], allowance: A(24_750_000) },
    { family: 'market_intelligence', licence_key: null, product_id: 'prod_mi', plan_name: 'Market Intelligence Pro', free: false, prices: [month(1500, 'price_mi')], allowance: A(3_750_000) },
  ],
  packs: [], covers: 'Covers Eadwyn.', resets: 'Resets daily.',
};

test('a visitor\'s plan cards come from the public read, shaped as the catalog spells products', () => {
  const products = visitorPlanProducts(ready(READ));
  assert.deepEqual(products.map((p) => p.id), ['prod_g', 'prod_ip', 'prod_p', 'prod_mi'], 'the paid plans, in the read\'s order; no free plan, which has its own card');
  for (const p of products) {
    assert.ok(isBundleProduct(p), `${p.name} renders as a plan card`);
    assert.deepEqual(planOf(p.metadata), { family: planForProduct(p, ready(READ)).family, licence_key: planForProduct(p, ready(READ)).licence_key }, `${p.name}: the metadata rebuilt is the plan's`);
  }
  assert.deepEqual(products[0].prices[0], { id: 'price_gm', active: true, type: 'recurring', interval: 'month', unit_amount: 2500, currency: 'usd' });
  assert.ok(bundleContentFor(products[0])?.features?.length > 0, 'the design copy follows the metadata');
  assert.deepEqual(visitorPlanProducts({ status: 'unreadable', data: null }), [], 'no read, no card');
});

test('a signed-out render of a plan card shows its price, its allowance and the way in', () => {
  const [growth] = visitorPlanProducts(ready(READ));
  const plan = planForProduct(growth, ready(READ));
  const t = text(html(h(BundleCard, { product: growth, globalCycle: 'monthly', onPreview() {}, onSubscribe() {}, ai: planAi(plan, ready(READ), { licence: null }), family: plan.family })));
  assert.match(t, /^Founder Validate \+ Build \$25\.00 \/mo/);
  assert.ok(t.includes('AI allowance Includes $6.25 of AI each month: 25% of the price. Past it, runs use your tokens.'), t);
  assert.ok(!t.includes('Your plan'), 'a visitor has no plan');
});

test('Sign in round-trips: Subscribe returns to the plans, Buy returns to the Token packs', () => {
  assert.equal(VISITOR_SIGN_IN, '/login?next=%2Fpricing%2Fproducts');
  const back = (href) => sameOriginNextPath(new URLSearchParams(href.split('?')[1]).get('next'), 'https://axal.vc');
  assert.equal(back(VISITOR_SIGN_IN), '/pricing/products');
  const buy = `/login?next=${encodeURIComponent(TOKEN_PACKS_PATH)}`;
  assert.equal(buy, '/login?next=%2Fpricing%2Fproducts%23token-packs');
  assert.equal(back(buy), '/pricing/products#token-packs', 'the hash survives the sign-in');
  assert.ok(read('frontend/src/components/products/TokenPacksSection.jsx').includes("'/login?next=' + encodeURIComponent(TOKEN_PACKS_PATH)"), 'CR7\'s Sign in to buy is that link');
  assert.ok(read('frontend/src/pages/LoginPage.jsx').includes("sameOriginNextPath(new URLSearchParams(window.location.search).get('next'), window.location.origin)"));
});

test('the page opens without sign-in; a product\'s page and the checkout still need it', async () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/pricing\/products" element=\{user \? guard\(\[[^\]]+\], <ProductsPage \/>\) : <ProductsPage \/>\} \/>/);
  for (const path of ['/pricing/products/:productId', '/checkout', '/checkout/confirmation']) {
    assert.match(app, new RegExp(`<Route path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{guard\\(\\[`), `${path} stays guarded`);
  }
  const { isPublicPath } = await import('../src/lib/api.js');
  // D786: the catalogue is /pricing/products, under the one /pricing page.
  assert.equal(isPublicPath('/pricing/products'), true, 'a background 401 does not bounce a visitor');
  assert.equal(isPublicPath('/pricing/products/'), true);
  assert.equal(isPublicPath('/pricing'), true);
  assert.equal(isPublicPath('/pricing/products/prod_1'), false);
  assert.equal(isPublicPath('/checkout'), false);
});

test('each reader keeps a frame: a member the app\'s header, sidebar and footer, a visitor the public site\'s', () => {
  const app = read('frontend/src/App.jsx');
  // `guard` wraps RequireAuth, which draws ProtectedLayout: the member's branch must go through it.
  assert.match(app, /const guard = \(roles, component\) => \(\s*<RequireAuth /);
  assert.match(app, /path="\/pricing\/products" element=\{user \? guard\(/, 'a signed-in reader gets the app frame');
  const page = read('frontend/src/pages/ProductsPage.jsx');
  assert.match(page, /import SitePage from '\.\.\/components\/site\/SitePage';/);
  assert.match(page, /if \(!member\) return <SitePage title="Plans and pricing">\{page\}<\/SitePage>;/, 'a visitor gets the site nav and footer');
  assert.match(read('frontend/src/components/site/SitePage.jsx'), /<PublicNav \/>[\s\S]*<PublicFooter \/>/);
});

test('/products keeps its query and its hash when it redirects', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/products" element=\{<ProductsRedirect \/>\} \/>/);
  assert.match(app, /function ProductsRedirect\(\) \{\s*const loc = useLocation\(\);\s*return <Navigate to=\{\{ pathname: '\/pricing\/products', search: loc\.search, hash: loc\.hash \}\} replace \/>;/);
});

test('a visitor gets none of the member-only parts, and none of their reads', () => {
  const page = read('frontend/src/pages/ProductsPage.jsx');
  assert.match(page, /const member = Boolean\(user\);/);
  assert.match(page, /usePricingReads\(\{ member \}\)/, 'no /ai-budget/me for a visitor');
  assert.match(page, /if \(!member\) return; \/\/ the catalog and the licences need a session/);
  for (const [part, re] of [
    ['the promo box', /\{member && <PromoRedeemCard /],
    ['the cart bar', /\{member && \(\s*<BillingCartBar/],
    ['the add-ons', /\{member && \(addons\.length > 0/],
    ['active licences', /\{member && unlocks\.length > 0 && \(/],
    ['the cart drawer and the product modal', /\{member && \(\s*<>\s*<CartDrawer[\s\S]*?<ProductSlideOver/],
    ['the phone\'s account bar', /return phone && member \? <PricingPhone/],
  ]) assert.match(page, re, part);
  assert.match(page, /\{canAddProduct && \(/, 'the admin tools need an admin, so never a visitor');
  assert.match(page, /onSubscribe=\{member \? handleSubscribeBundle : visitorSignIn\}/);
  assert.match(page, /\(member \? \(products \|\| \[\]\)\.filter\(isBundleProduct\) : visitorPlanProducts\(pricing\)\)/);
  assert.match(read('frontend/src/pages/account/PricingPhone.jsx'), /useAccountRead\(\(\) => aiBudgetApi\.mine\(\), \{ enabled: member \}\)/);
});

test('the public /pricing page takes its prices from the read, never the typed figures', () => {
  const growth = FOUNDER_TIERS.find((t) => t.id === 'growth');
  const priced = pricedTier(growth, 'founder', ready(READ));
  assert.equal(priced.priceMonthly, 25, 'the read\'s $25, not the typed price');
  assert.equal(priced.priceAnnual, 20, '$240 a year shown as $20 a month');
  const free = pricedTier(FOUNDER_TIERS.find((t) => t.id === 'free'), 'founder', ready(READ));
  assert.equal(free.priceMonthly, 0);
  // Unpriced by the read, or the read out: no price at all, not the typed one.
  const studio = pricedTier(FOUNDER_TIERS.find((t) => t.id === 'studio'), 'founder', ready(READ));
  assert.equal(studio.priceMonthly, null);
  assert.equal(pricedTier(INVESTOR_TIERS.find((t) => t.id === 'professional'), 'investor', { status: 'unreadable' }).priceMonthly, null);
  assert.equal(pricedTier(INVESTOR_TIERS.find((t) => t.id === 'professional'), 'investor', ready(READ)).priceMonthly, 149);
  // D786 part 2: /pricing draws its cards from the same read through `planCards`
  // (pricing_page_d786_part2.test.mjs), never from the typed tiers.
  const src = read('frontend/src/pages/PricingPage.jsx');
  assert.match(src, /planCards\(plans\.body, specs,/);
  assert.match(src, /useRead\(publicPricingApi\.plansAndPacks\)/);
  assert.doesNotMatch(src, /FOUNDER_TIERS|INVESTOR_TIERS|data\/pricing/, 'the page reads no typed tier');
});

test('the door pages\' tokens block links to the Token packs', () => {
  assert.deepEqual(AI_TOKENS.link, { label: 'See the token packs', href: TOKEN_PACKS_PATH });
  assert.match(read('frontend/src/pages/site/DoorPage.jsx'), /\{tokens\.link && <a className="ax-door-tokens-link" href=\{tokens\.link\.href\}/);
});
