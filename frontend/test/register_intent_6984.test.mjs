/**
 * #6984 (X2) — the role and plan a visitor chose on a public button travel into sign-up, and /register says them.
 *
 *   · each paid plan on /for-founders and /for-investors opens /register with its plan and interval (`registerPathFor`,
 *     as Pricing's cards do), and that plan is named in the register context line; a free plan keeps the lane link;
 *   · Pricing's closing "Get started" keeps the active tab's role; the Institutional card asks on the invest topic;
 *   · a stored lane is used only when it is under 24 hours old and the address names none; an address lane wins;
 *   · the context line names a plan only when the catalogue read returned it.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/register_intent_6984.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { planCards, closingRegisterPath, PRICING_TABS } from '../src/lib/pricingModel.js';
import { planIntentFrom } from '../src/lib/planIntent.js';
import { sanitizeNextPath } from '../src/lib/pendingNext.js';
import { RegistrationContext, RegistrationPlanBlock } from '../src/components/auth/RegistrationPlan.jsx';
import { INTENT_TTL_MS, LANES, laneForVisit, registerContextLine } from '../src/lib/registerCopy.js';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';

const { default: DoorPage, resolvePlans, pricedCatalogue } = await import('../src/pages/site/DoorPage.jsx');
const { DOORS } = await import('../src/lib/siteDoors.js');

const h = React.createElement;
const price = (unit_amount, interval) => ({ price_id: `price_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 1_000_000 });
const plan = (key, month, year) => ({
  family: key.split(':')[0], licence_key: key, product_id: `prod_${key}`, plan_name: key, free: false,
  prices: [month && price(month, 'month'), year && price(year, 'year')].filter(Boolean),
  monthly: month ? { unit_amount: month, currency: 'usd', allowance_microusd: 1_000_000 } : null,
  yearly: year ? { unit_amount: year, currency: 'usd', allowance_microusd: 1_000_000 } : null,
  catalogue: { key },
});
const READ = { plans: [plan('founder:growth', 2000, 20400), plan('founder:studio', 10000, 96000), plan('investor:professional', 25000, null)], packs: [] };
const DOOR_READ = { status: 'ready', data: READ }; // the door's plans read (`usePlansRead`)
const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
const unamp = (s) => s.replace(/&amp;/g, '&');

// The register page's step-1 head, mounted for real: RegisterPage itself reads `import.meta.env` at load and cannot be
// imported here, so its wiring is pinned in source below. Lane from `laneForVisit`, as the page does.
function Register({ search, api, saved = null, now }) {
  const [selection, setSelection] = React.useState(null);
  const lane = laneForVisit(search, saved, now).lane;
  const intent = planIntentFrom(search);
  return h('div', null, h(RegistrationContext, { lane, selection: intent ? selection : null }),
    h(RegistrationPlanBlock, { intent, lane, onSelection: setSelection, api }));
}
async function mountRegister(search, read = READ, saved = null, now = undefined) {
  const restore = installDocument(search);
  const api = { plansAndPacks: async () => { if (read instanceof Error) throw read; return read; } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(Register, { search, api, saved, now }))));
  await settle();
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return { by, close: async () => { await act(async () => root.unmount()); restore(); } };
}

// ------------------------------------------------------------ audience pages

test('every paid plan on /for-founders and /for-investors opens /register with its plan, interval and lane; the free plan keeps the lane link', () => {
  const want = { founders: { lane: 'founder', paid: { growth: 'founder:growth', studio: 'founder:studio' } }, investors: { lane: 'investor', paid: { professional: 'investor:professional' } } };
  for (const [k, { lane, paid }] of Object.entries(want)) {
    const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: [DOORS[k].path] }, h(DoorPage, { door: k })));
    const cards = [...html.matchAll(/data-tier="([a-z]+)"[\s\S]*?class="ax-btn ax-door-plan-cta" href="([^"]+)"/g)].map((m) => [m[1], unamp(m[2])]);
    const seenPaid = [];
    for (const [tier, href] of cards) {
      if (DOORS[k].plans.find((p) => p.tier === tier)?.custom) continue;
      const u = new URL(href, 'https://x.test');
      assert.equal(u.pathname, '/register', `${k} ${tier}`);
      assert.equal(u.searchParams.get('lane'), lane, `${k} ${tier}: the lane travels`);
      if (paid[tier]) {
        seenPaid.push(tier);
        assert.deepEqual(planIntentFrom(u.search), { planKey: paid[tier], interval: 'monthly' }, `${k} ${tier}: the plan and interval travel`);
        const next = u.searchParams.get('next');
        assert.ok(sanitizeNextPath(next), `${k} ${tier}: next is same-origin`);
        assert.equal(new URL(next, 'https://x.test').searchParams.get('checkout'), paid[tier]);
      } else {
        assert.equal(href, `/register?lane=${lane}`, `${k} ${tier}: a free plan keeps the lane link`);
      }
    }
    assert.deepEqual(seenPaid.sort(), Object.keys(paid).sort(), `${k}: every paid plan was found`);
  }
  // With a price read, the amount the door showed travels as `seen`, as on Pricing.
  const priced = resolvePlans(DOORS.founders, pricedCatalogue(DOOR_READ)).find((p) => p.tier === 'studio');
  const next = new URL(new URL(priced.to, 'https://x.test').searchParams.get('next'), 'https://x.test');
  assert.equal(next.searchParams.get('seen'), '10000');
});

test('the plan a door button carries is named in the register context line, with the role', async () => {
  for (const [k, tier, line] of [
    ['founders', 'growth', 'You are signing up as a founder. Plan: Validate + Build, monthly.'],
    ['founders', 'studio', 'You are signing up as a founder. Plan: Raise + Grow, monthly.'],
    ['investors', 'professional', 'You are signing up as an investor. Plan: Investor Pro, monthly.'],
  ]) {
    const to = resolvePlans(DOORS[k], pricedCatalogue(DOOR_READ)).find((p) => p.tier === tier).to;
    const m = await mountRegister(to.slice(to.indexOf('?')));
    try {
      assert.equal(text(m.by('register-context')), line, `${k} ${tier}`);
    } finally { await m.close(); }
  }
});

// ------------------------------------------------------------------ Pricing

test('Pricing\'s closing button keeps the tab\'s role; the Institutional card opens contact on the invest topic', async () => {
  assert.equal(closingRegisterPath('investor'), '/register?lane=investor');
  assert.equal(closingRegisterPath('founder'), '/register?lane=founder');
  assert.equal(closingRegisterPath('advisor'), '/register?lane=advisor');
  assert.equal(closingRegisterPath('operating-partner'), '/register?lane=partner');
  assert.equal(closingRegisterPath('models'), '/register', 'Models names no role');
  for (const t of PRICING_TABS) if (t.family) assert.ok(LANES.includes(t.family), `${t.key}: its lane is one /register accepts`);

  const inst = planCards(READ, PLAN_CARDS.investor, { billing: 'monthly', signedIn: false, tab: 'investor' }).cards.find((c) => c.id === 'institutional');
  assert.equal(inst.button.to, '/contact?topic=invest');

  // Mounted: a visitor on the investor tab.
  const restore = installDocument();
  const createEl = document.createElement.bind(document);
  document.createElement = (tag) => { const n = createEl(tag); n.querySelector = () => null; return n; };
  const saved = { ...publicPricingApi };
  publicPricingApi.plansAndPacks = async () => READ;
  publicPricingApi.aiModels = async () => ({ models: [] });
  const container = document.createElement('div'); const root = createRoot(container);
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/pricing?for=investor'] }, h(PricingBody, null))));
    await settle(8);
    assert.equal(props(by('pricing-closing-start')).href, '/register?lane=investor');
  } finally { await act(async () => root.unmount()); Object.assign(publicPricingApi, saved); restore(); }
});

// -------------------------------------------------------------- stored lane

test('a stored lane older than 24 hours is ignored; a URL lane overrides a stored one; an entry with no time is expired', () => {
  const now = Date.UTC(2026, 10, 22, 12);
  const investor = (age) => ({ lane: 'investor', ts: now - age });
  assert.deepEqual(laneForVisit('', investor(INTENT_TTL_MS + 1), now), { lane: null, store: false }, 'older than 24 hours');
  assert.deepEqual(laneForVisit('', investor(INTENT_TTL_MS), now), { lane: null, store: false }, 'exactly 24 hours is not under 24');
  assert.deepEqual(laneForVisit('', investor(INTENT_TTL_MS - 1), now), { lane: 'investor', store: false }, 'under 24 hours is used');
  assert.deepEqual(laneForVisit('?lane=founder', investor(60_000), now), { lane: 'founder', store: true }, 'the address wins and is stored');
  assert.deepEqual(laneForVisit('?lane=founder', investor(INTENT_TTL_MS * 9), now), { lane: 'founder', store: true });
  assert.equal(laneForVisit('', { lane: 'investor' }, now).lane, null, 'no timestamp: expired');
  assert.equal(laneForVisit('', { lane: 'investor', ts: now + 60_000 }, now).lane, null, 'a time in the future is not trusted');
  assert.equal(laneForVisit('', { lane: 'admin', ts: now }, now).lane, null, 'a stored value that is not a lane');
  assert.equal(laneForVisit('?lane=admin', investor(1000), now).lane, 'investor', 'an address value that is not a lane names none');
  assert.equal(laneForVisit('', null, now).lane, null);
});

test('RegisterPage reads its lane through laneForVisit and stores only an address lane, with its time', () => {
  const page = readFileSync('frontend/src/pages/RegisterPage.jsx', 'utf8');
  assert.match(page, /const visit = laneForVisit\(window\.location\.search, saved\);/);
  assert.match(page, /if \(visit\.store\) \{\s*try \{ localStorage\.setItem\('gvpn:intent', JSON\.stringify\(\{ lane: visit\.lane, ts: Date\.now\(\) \}\)\); \} catch \{\}/);
  assert.doesNotMatch(page, /saved\?\.lane/, 'the stored lane is never read past the 24-hour rule');
  assert.match(page, /<RegistrationContext lane=\{lane\} selection=\{planIntent \? selection : null\} \/>/);
  // S1: the existing layout and the membership steps line stay.
  assert.match(page, /data-testid="register-membership-steps">\{MEMBERSHIP_STEPS\}/);
});

test('a plain /register after an old investor click does not say investor', async () => {
  const now = Date.UTC(2026, 10, 22, 12);
  const m = await mountRegister('', READ, { lane: 'investor', ts: now - INTENT_TTL_MS - 1000 }, now);
  try { assert.equal(m.by('register-context'), undefined); } finally { await m.close(); }
  const f = await mountRegister('', READ, { lane: 'investor', ts: now - 60_000 }, now);
  try { assert.equal(text(f.by('register-context')), 'You are signing up as an investor.'); } finally { await f.close(); }
});

// ------------------------------------------------------- the context line

test('the context line never shows a plan the catalogue does not return', async () => {
  assert.equal(registerContextLine('founder', { state: 'unavailable', name: 'Raise + Grow', interval: 'monthly' }), 'You are signing up as a founder.');
  assert.equal(registerContextLine('founder', { state: 'unreadable', name: 'Raise + Grow', interval: 'monthly' }), 'You are signing up as a founder.');
  assert.equal(registerContextLine('founder', { state: 'ready', name: 'Raise + Grow', interval: 'yearly' }), 'You are signing up as a founder. Plan: Raise + Grow, yearly.');
  assert.equal(registerContextLine(null, null), null);
  assert.equal(registerContextLine('lp', null), 'You are signing up as an LP.');
  const search = '?lane=founder&plan=founder%3Astudio&interval=yearly';
  for (const [read, want] of [
    [{ plans: [plan('founder:growth', 2000, 20400)], packs: [] }, 'You are signing up as a founder.'], // not sold
    [new Error('down'), 'You are signing up as a founder.'], // could not be read
    [{ plans: [plan('founder:studio', 10000, null)], packs: [] }, 'You are signing up as a founder.'], // no yearly price
    [READ, 'You are signing up as a founder. Plan: Raise + Grow, yearly.'],
  ]) {
    const m = await mountRegister(search, read);
    try { assert.equal(text(m.by('register-context')), want); } finally { await m.close(); }
  }
  const unknown = await mountRegister('?lane=founder&plan=founder%3Anope&interval=monthly');
  try { assert.doesNotMatch(text(unknown.by('register-context')), /Plan:/); } finally { await unknown.close(); }
});
