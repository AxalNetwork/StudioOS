/**
 * D786 (#2211) part 1 — the one /pricing page's routes and data layer: the
 * three redirects keep the query and the hash, the catalogue lives at
 * /pricing/products, every internal link moved, and pricingModel.js answers
 * each tab (a role with no plan says so; a visitor lands on Founder).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pricing_page_d786.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { InvestorPricingRedirect, PlansAndPricingRedirect } from '../src/pages/pricingRedirects.jsx';
import { ParamRedirect } from '../src/pages/cycles/ParamRedirect.jsx';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import {
  NO_PLAN_LINE, PRICING_TABS, initialTab, landingTab, modelsTab, roleTab, tabFromSearch, useLandingTab,
} from '../src/lib/pricingModel.js';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';

const h = React.createElement;
const SRC = new URL('../src/', import.meta.url).pathname;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// ================================================================ the redirects

/** Where `url` lands under the App's own redirect elements. */
async function landing(url) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const seen = {};
  function Where() { const l = useLocation(); seen.at = `${l.pathname}${l.search}${l.hash}`; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/plans-and-pricing', element: h(PlansAndPricingRedirect) }),
    h(Route, { path: '/plans-and-pricing/:productId', element: h(ParamRedirect, { to: '/pricing/products/:productId' }) }),
    h(Route, { path: '/pricing/investor', element: h(InvestorPricingRedirect) }),
    h(Route, { path: '*', element: h(Where) }),
  ))));
  await act(async () => root.unmount());
  restore();
  return seen.at;
}

test('the three redirects land on /pricing, /pricing/products/:id and ?for=investor, the query and hash kept', async () => {
  assert.equal(await landing('/plans-and-pricing'), '/pricing');
  assert.equal(await landing('/plans-and-pricing?for=models&ref=mail#faq'), '/pricing?for=models&ref=mail#faq');
  assert.equal(await landing('/plans-and-pricing/prod_42?cycle=yearly#top'), '/pricing/products/prod_42?cycle=yearly#top');
  assert.equal(await landing('/plans-and-pricing/a%2Fb'), '/pricing/products/a%2Fb', 'the id stays one encoded segment');
  assert.equal(await landing('/pricing/investor'), '/pricing?for=investor');
  assert.equal(await landing('/pricing/investor?ref=mail#plans'), '/pricing?ref=mail&for=investor#plans');
  assert.equal(await landing('/pricing/investor?for=founder'), '/pricing?for=investor', 'the address names the Investor tab');
});

test('App mounts the catalogue at /pricing/products and the old addresses as redirects', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/pricing\/products" element=\{user \? guard\(\[[^\]]+\], <ProductsPage \/>\) : <ProductsPage \/>\} \/>/);
  assert.match(app, /<Route path="\/pricing\/products\/:productId" element=\{guard\(\[[^\]]+\], <ProductsPage \/>\)\} \/>/);
  assert.match(app, /<Route path="\/plans-and-pricing" element=\{<PlansAndPricingRedirect \/>\} \/>/);
  assert.match(app, /<Route path="\/plans-and-pricing\/:productId" element=\{<ParamRedirect to="\/pricing\/products\/:productId" \/>\} \/>/);
  assert.match(app, /<Route path="\/pricing\/investor" element=\{<InvestorPricingRedirect \/>\} \/>/);
  assert.match(app, /<Route path="\/products\/:productId" element=\{<ParamRedirect to="\/pricing\/products\/:productId" \/>\} \/>/);
  assert.match(app, /pathname: '\/pricing\/products', search: loc\.search, hash: loc\.hash/, '/products keeps its query and hash');
  assert.doesNotMatch(app, /InvestorPricingPage/);
});

test('no internal link names /plans-and-pricing or /pricing/investor any more', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(name)) {
        const rel = relative(SRC, p);
        if (rel === 'App.jsx' || rel === 'pages/pricingRedirects.jsx' || rel === 'pages/InvestorPricingPage.jsx' || rel === 'lib/ogRegistry.js') continue;
        // Code only: a comment may still say where a thing used to live.
        const code = readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        if (/['"`(]\/plans-and-pricing|['"`]\/pricing\/investor['"`]/.test(code)) offenders.push(rel);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});

// ================================================================ the tabs

test('five tabs in the canvas\'s order; ?for= picks one, a visitor and an unknown role land on Founder', () => {
  assert.deepEqual(PRICING_TABS.map((t) => [t.key, t.label]), [
    ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisors'], ['operating-partner', 'Operating Partners'], ['models', 'Models'],
  ]);
  assert.equal(tabFromSearch('?for=models'), 'models');
  assert.equal(tabFromSearch('?for=nonsense'), null);
  assert.equal(tabFromSearch(''), null);
  assert.equal(landingTab('investor'), 'investor');
  assert.equal(landingTab('advisor'), 'advisor');
  assert.equal(landingTab('partner'), 'operating-partner');
  for (const role of ['founder', 'admin', 'super_admin', 'exploring', null, undefined]) assert.equal(landingTab(role), 'founder', String(role));
  assert.equal(initialTab('?for=models', 'investor'), 'models', '?for= wins');
  assert.equal(initialTab('', 'investor'), 'investor');
});

test('useLandingTab reads useViewMode().shellRole, and a visitor (no provider) lands on Founder', () => {
  function Show() { return h('i', null, useLandingTab()); }
  const html = (value) => renderToStaticMarkup(value === undefined ? h(Show) : h(ViewModeContext.Provider, { value }, h(Show)));
  assert.equal(html(undefined), '<i>founder</i>');
  assert.equal(html({ shellRole: 'partner' }), '<i>operating-partner</i>');
  assert.equal(html({ shellRole: 'investor' }), '<i>investor</i>');
});

const PLANS = {
  plans: [
    { family: 'founder', licence_key: 'founder:free', free: true, prices: [] },
    { family: 'investor', licence_key: 'investor:free', free: true, prices: [] },
    { family: 'other', licence_key: 'other', free: true, prices: [] },
    { family: 'founder', licence_key: 'founder:growth', free: false, product_id: 'prod_g', prices: [{ unit_amount: 2500, interval: 'month' }] },
  ],
  packs: [],
};

test('a role tab keeps its family\'s plans; a role the catalogue sells no plan says so; an unreadable read is not "none"', () => {
  assert.deepEqual(roleTab(PLANS, 'founder').plans.map((p) => p.licence_key), ['founder:free', 'founder:growth']);
  assert.deepEqual(roleTab(PLANS, 'investor').plans.map((p) => p.licence_key), ['investor:free']);
  assert.deepEqual(roleTab(PLANS, 'advisor'), { none: true, line: NO_PLAN_LINE });
  assert.deepEqual(roleTab(PLANS, 'operating-partner'), { none: true, line: NO_PLAN_LINE });
  assert.equal(NO_PLAN_LINE, 'No plan: top up AI tokens as you go');
  // A plan for advisors, once the catalogue sells one, is shown.
  const withAdvisor = { plans: [...PLANS.plans, { family: 'advisor', licence_key: 'advisor', free: false, prices: [] }] };
  assert.deepEqual(roleTab(withAdvisor, 'advisor').plans.map((p) => p.licence_key), ['advisor']);
  const withPartner = { plans: [...PLANS.plans, { family: 'partner', licence_key: 'partner', free: false, prices: [] }] };
  assert.deepEqual(roleTab(withPartner, 'operating-partner').plans.map((p) => p.licence_key), ['partner']);
  assert.deepEqual(roleTab(null, 'founder'), { unreadable: true });
  assert.deepEqual(roleTab({ plans: 'x' }, 'advisor'), { unreadable: true });
  assert.deepEqual(roleTab(PLANS, 'models'), { unreadable: true }, 'Models is not a plan tab');
});

test('the Models tab reads the public models read, as sent', async () => {
  assert.deepEqual(modelsTab({ ok: true, models: [{ id: '@cf/x', name: 'x' }, null, { name: 'no id' }] }), { models: [{ id: '@cf/x', name: 'x' }] });
  assert.deepEqual(modelsTab(null), { unreadable: true });
  assert.deepEqual(modelsTab({ models: {} }), { unreadable: true });
  const calls = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{"ok":true,"models":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const restore = installDocument();
  try { await publicPricingApi.aiModels(); } finally { globalThis.fetch = before; restore(); }
  assert.ok(calls[0].endsWith('/api/public/ai/models'), calls[0]);
});
