/**
 * #4651 (Pricing audit 1/5) — the plan a visitor chose on /pricing survives registration, and registration says what it
 * does and does not do. Interactions are mounted (the real RegisterPage and PricingBody); the model cases are pure.
 *
 *   · a paid card carries its plan, interval and the Pricing return to /register; a free card keeps `?lane=` only;
 *   · registration shows the selected plan, how it is charged and the full commitment, or says it is not offered or
 *     could not be read, and never substitutes another plan or interval;
 *   · each audience gets its own copy, an advisor is not asked for a pitch, and the steps are separate;
 *   · a signed-in visitor on a plan link is told so and given a choice, not signed out in silence;
 *   · back on Pricing, a changed price or a plan no longer sold is said before the sheet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { planCards } from '../src/lib/pricingModel.js';
import { planIntentFrom, planKeyOfSpec, pricingReturnPath, registerPathFor, specFor } from '../src/lib/planIntent.js';
import { selectionFor } from '../src/lib/planSelection.js';
import { sanitizeNextPath, clearPendingPricingNext, storePendingNext } from '../src/lib/pendingNext.js';
import { RegistrationPlanBlock, SignedInPlanNotice } from '../src/components/auth/RegistrationPlan.jsx';
import { LANE_COPY, LANE_ROLE, LANES, registerHeading } from '../src/lib/registerCopy.js';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { checkoutApi } from '../src/lib/api/billingCheckout.js';
import { billingAlertsApi } from '../src/lib/api/billingAlerts.js';

const h = React.createElement;
const price = (unit_amount, interval) => ({ price_id: `price_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 1_000_000 });
const plan = (key, licence, month, year, extra = {}) => ({
  family: key.split(':')[0], licence_key: licence, product_id: `prod_${key}`, plan_name: key, free: false,
  prices: [month && price(month, 'month'), year && price(year, 'year')].filter(Boolean),
  monthly: month ? { unit_amount: month, currency: 'usd', allowance_microusd: 1_000_000 } : null,
  yearly: year ? { unit_amount: year, currency: 'usd', allowance_microusd: 1_000_000 } : null,
  catalogue: { key }, ...extra,
});
const STUDIO = plan('founder:studio', 'founder:studio', 10000, 96000);
const ADVISOR = plan('advisor:pro', 'advisor', 4900, null);
const READ = { plans: [STUDIO, ADVISOR], packs: [] };
const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');

// ---------------------------------------------------------------- the model

test('every paid card has the Worker catalogue key as its plan key, and every sold catalogue plan has a card', () => {
  const src = readFileSync('cloudflare-worker/src/services/planCatalogue.ts', 'utf8');
  const sellable = [...src.matchAll(/key: '([a-z]+:[a-z_-]+)'[^\n]*matches: \{/g)].map((m) => m[1]);
  assert.ok(sellable.length >= 6, `${sellable.length} sold plans read`);
  const cards = Object.values(PLAN_CARDS).flat().map(planKeyOfSpec).filter(Boolean);
  // Institutional is sold by our sales team (a `custom` card, never a price), so it has no paid card to carry a plan.
  assert.deepEqual(sellable.filter((k) => !cards.includes(k)), ['investor:institutional']);
  assert.ok(cards.every((k) => sellable.includes(k)), 'no card names a plan the Worker does not sell');
});

test('registerPathFor and planIntentFrom agree; a malformed key or interval is ignored, never guessed; `next` is the Pricing return', () => {
  for (const [tab, specs] of Object.entries(PLAN_CARDS)) for (const spec of specs) {
    const key = planKeyOfSpec(spec); if (!key) continue;
    for (const interval of ['monthly', 'yearly']) {
      const path = registerPathFor({ lane: spec.lane, tab, planKey: key, interval, seen: 96000 });
      const q = new URL(path, 'https://x.test').searchParams;
      assert.deepEqual(planIntentFrom(path.slice(path.indexOf('?'))), { planKey: key, interval }, `${key} ${interval}`);
      const next = q.get('next');
      assert.ok(sanitizeNextPath(next), `${key}: next passes the same-origin rule (${next?.length} chars)`);
      const ret = new URL(next, 'https://x.test');
      assert.deepEqual([ret.pathname, ret.searchParams.get('checkout'), ret.searchParams.get('interval'), ret.searchParams.get('for')], ['/pricing', key, interval, tab]);
      assert.equal(specFor(key).tab, tab);
    }
  }
  // A `next` that would not pass the same-origin rule is left out, never half-written; the plan itself still travels.
  const long = new URL(registerPathFor({ lane: 'founder', tab: 'x'.repeat(300), planKey: 'founder:studio', interval: 'yearly' }), 'https://x.test').searchParams;
  assert.equal(long.get('next'), null);
  assert.equal(long.get('plan'), 'founder:studio');
  assert.equal(registerPathFor({ lane: 'founder' }), '/register?lane=founder', 'no plan, the old address');
  assert.equal(registerPathFor({}), '/register');
  assert.equal(planIntentFrom('?plan=nope'), null);
  assert.equal(planIntentFrom('?plan=founder:studio&interval=weekly').interval, 'monthly', 'an unknown interval is not read as yearly');
  assert.equal(planIntentFrom('?plan=../../admin'), null);
  assert.equal(pricingReturnPath({ tab: 'founder', planKey: 'founder:studio', interval: 'yearly', seen: 96000 }), '/pricing?for=founder&checkout=founder%3Astudio&interval=yearly&seen=96000');
});

test('cards: a visitor\'s paid card carries the plan and the interval chosen, the free card the lane only; Advisor has its lane', () => {
  const cards = (billing, tab = 'founder') => planCards(READ, PLAN_CARDS[tab], { billing, signedIn: false, tab }).cards;
  const studio = (b) => cards(b).find((c) => c.id === 'studio');
  const to = (c) => new URL(c.button.to, 'https://x.test');
  // Mutation checked: the card ignoring the billing switch → a yearly choice registers as monthly.
  assert.equal(to(studio('yearly')).searchParams.get('interval'), 'yearly');
  assert.equal(to(studio('monthly')).searchParams.get('interval'), 'monthly');
  assert.equal(new URL(to(studio('yearly')).searchParams.get('next'), 'https://x.test').searchParams.get('seen'), '96000', 'the yearly amount shown');
  assert.equal(new URL(to(studio('monthly')).searchParams.get('next'), 'https://x.test').searchParams.get('seen'), '10000');
  assert.equal(cards('yearly').find((c) => c.id === 'free').button.to, '/register?lane=founder');
  const advisor = planCards(READ, PLAN_CARDS.advisor, { billing: 'monthly', signedIn: false, tab: 'advisor' }).cards;
  assert.equal(new URL(advisor.find((c) => c.id === 'pro').button.to, 'https://x.test').searchParams.get('lane'), 'advisor');
  assert.equal(advisor.find((c) => c.id === 'free').button.to, '/register?lane=advisor');
});

test('selectionFor: the plan, its monthly figure, how it is charged and the full commitment; or not offered, or unreadable; never another plan', () => {
  const yearly = selectionFor(READ, { planKey: 'founder:studio', interval: 'yearly' });
  assert.deepEqual([yearly.state, yearly.name, yearly.perMonth, yearly.basis], ['ready', 'Raise + Grow', '$80 / month', '$960 billed yearly']);
  assert.match(yearly.commitment, /full \$960 is charged at checkout, for the whole year/);
  const monthly = selectionFor(READ, { planKey: 'founder:studio', interval: 'monthly' });
  assert.deepEqual([monthly.perMonth, monthly.basis, monthly.commitment], ['$100 / month', 'billed every month', 'Charged each month at checkout.']);
  // Mutation checked: falling back to the monthly price for a yearly choice → a $100 figure is drawn for a yearly request.
  const noYear = selectionFor(READ, { planKey: 'advisor:pro', interval: 'yearly' });
  assert.equal(noYear.state, 'unavailable');
  assert.match(noYear.line, /Yearly billing is not offered for Advisor Pro.*nothing was switched/);
  assert.doesNotMatch(noYear.line, /\$49/);
  assert.equal(selectionFor({ plans: [] }, { planKey: 'founder:studio', interval: 'monthly' }).state, 'unavailable');
  assert.equal(selectionFor({ plans: [STUDIO] }, { planKey: 'founder:nope', interval: 'monthly' }).state, 'unavailable');
  const unread = selectionFor(null, { planKey: 'founder:studio', interval: 'monthly' });
  assert.equal(unread.state, 'unreadable');
  assert.match(unread.line, /not the same as it not being offered/);
  assert.equal(selectionFor(READ, null), null);
});

test('a kept Pricing return is dropped when /register opens with no plan of its own; any other kept path stays', () => {
  const restore = installDocument();
  try {
    storePendingNext('/pricing?for=founder&checkout=founder%3Astudio&interval=yearly');
    clearPendingPricingNext();
    assert.equal(localStorage.getItem('gvpn:next'), null);
    storePendingNext('/invite/accept?token=abc');
    clearPendingPricingNext();
    assert.ok(localStorage.getItem('gvpn:next'), 'an invitation return is left alone');
  } finally { restore(); }
});

// ---------------------------------------------------------------- mounted

// What RegisterPage draws under its heading, mounted for real. The page itself reads `import.meta.env` at load and
// cannot be imported here; its wiring is pinned in source below.
function Page({ search, api }) {
  const [selection, setSelection] = React.useState(null);
  const q = new URLSearchParams(search);
  const lane = LANES.includes(q.get('lane')) ? q.get('lane') : null;
  const intent = planIntentFrom(search);
  const heading = registerHeading(lane, intent ? selection : null);
  return h('div', null, h('h2', { 'data-testid': 'register-title' }, heading.title), h('p', { 'data-testid': 'register-desc' }, heading.desc),
    h(RegistrationPlanBlock, { intent, lane, onSelection: setSelection, api }));
}
async function mountRegister(search, { read, signedInUser = null } = {}) {
  const restore = installDocument(search);
  const api = { plansAndPacks: async () => { if (read instanceof Error) throw read; return read; } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, signedInUser ? h(SignedInPlanNotice, { user: signedInUser, intent: planIntentFrom(search), onSignOut() {} }) : h(Page, { search, api }))));
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return { text: () => text(container), by, props, close: async () => { await act(async () => root.unmount()); restore(); } };
}

test('RegisterPage is wired to the plan block, the lane copy and the advisor lane; an advisor sends no role the Worker would refuse', () => {
  const page = readFileSync('frontend/src/pages/RegisterPage.jsx', 'utf8');
  assert.match(page, /planIntentFrom\(/);
  assert.match(page, /<RegistrationPlanBlock intent=\{planIntent\} lane=\{lane\} onSelection=\{setSelection\} \/>/);
  assert.match(page, /registerHeading\(lane, planIntent \? selection : null\)/);
  assert.match(page, /clearPendingPricingNext\(\)/);
  assert.equal(LANE_ROLE.advisor, undefined);
  const worker = readFileSync('cloudflare-worker/src/routes/auth.ts', 'utf8');
  assert.match(worker, /\['founder', 'partner', 'investor'\]\.includes\(role\)/, 'the Worker still takes no advisor role, so none is sent');
  assert.ok(Object.keys(LANE_COPY).every((k) => LANES.includes(k)), 'every lane with copy is a lane the page accepts');
  assert.ok(LANES.includes('advisor'), 'the doors already link /register?lane=advisor');
});

test('registration shows the selected plan, how it is charged and the full yearly commitment, and the steps as separate things', async () => {
  const m = await mountRegister('?lane=founder&plan=founder%3Astudio&interval=yearly', { read: READ });
  try {
    assert.equal(text(m.by('register-plan-name')), 'Raise + Grow');
    assert.equal(text(m.by('register-plan-price')), '$80 / month · $960 billed yearly');
    assert.match(text(m.by('register-plan-commitment')), /full \$960 is charged at checkout, for the whole year/);
    assert.equal(text(m.by('register-title')), 'Create your account to get Raise + Grow', 'the heading names the plan, not a pitch');
    assert.match(m.props(m.by('register-plan-change')).href || '', /pricing\?for=founder/, 'the plan can be changed');
    const steps = ['account', 'profile', 'checkout', 'spinout'].map((k) => text(m.by(`register-step-${k}`)));
    assert.match(steps[0], /free\. No payment is taken on this page/);
    assert.match(steps[1], /Membership review.*enables your profile after you sign the agreement.*buy a plan for that profile once it is enabled/);
    assert.match(steps[2], /Payment starts only when you confirm on Stripe.s secure page.*Billed yearly/);
    assert.match(steps[3], /Optional: apply to the Spin-Out Lab.*separate application.*not part of any plan/);
  } finally { await m.close(); }
});

test('an advisor is not asked for a pitch; each audience has its own entry copy', async () => {
  const m = await mountRegister('?lane=advisor&plan=advisor%3Apro&interval=monthly', { read: READ });
  try {
    assert.equal(text(m.by('register-title')), 'Create your account to get Advisor Pro');
    assert.doesNotMatch(m.text(), /Submit your pitch|Spin-Out Lab/);
    assert.equal(m.by('register-step-spinout'), undefined, 'the Spin-Out Lab is a founder step only');
    assert.match(text(m.by('register-plan-price')), /\$49 \/ month · billed every month/);
  } finally { await m.close(); }
  for (const [lane, want, never] of [['advisor', /Create your Advisor account/, /Submit your pitch/], ['investor', /Investor|Open your LP|Join the Partner/, /Advisor account/], ['founder', /Submit your pitch/, /Advisor account/]]) {
    const v = await mountRegister(`?lane=${lane}`, { read: READ });
    try {
      const t = v.text();
      if (lane !== 'investor') assert.match(t, want, lane);
      assert.doesNotMatch(t, never, lane);
      assert.equal(v.by('register-plan'), undefined, 'no plan chosen, no selection drawn');
      assert.ok(v.by('register-steps'), 'the steps are still said');
    } finally { await v.close(); }
  }
});

test('a plan that is not offered, a yearly price it does not hold, and an unreadable catalogue are each said, and nothing is substituted', async () => {
  let m = await mountRegister('?plan=advisor%3Apro&interval=yearly', { read: READ });
  try {
    assert.equal(m.by('register-plan').props?.['data-state'] ?? m.props(m.by('register-plan'))['data-state'], 'unavailable');
    assert.match(text(m.by('register-plan-line')), /Yearly billing is not offered for Advisor Pro/);
    assert.equal(m.by('register-plan-name'), undefined);
    assert.doesNotMatch(m.text(), /\$49/, 'the monthly price is not drawn for a yearly request');
  } finally { await m.close(); }
  m = await mountRegister('?plan=founder%3Astudio&interval=monthly', { read: new Error('down') });
  try {
    assert.equal(m.props(m.by('register-plan'))['data-state'], 'unreadable');
    assert.match(text(m.by('register-plan-line')), /could not be read just now/);
  } finally { await m.close(); }
  m = await mountRegister('?plan=founder%3Astudio&interval=monthly', { read: { plans: [] } });
  try {
    assert.equal(m.props(m.by('register-plan'))['data-state'], 'unavailable');
    assert.match(text(m.by('register-plan-line')), /not offered right now.*Nothing has been chosen for you instead/);
  } finally { await m.close(); }
});

test('a signed-in visitor on a plan link is told so and given a choice: Pricing, or sign out; nothing is changed in silence', async () => {
  const m = await mountRegister('?plan=founder%3Astudio&interval=yearly', { signedInUser: { name: 'Avery', email: 'avery@example.invalid' } });
  try {
    assert.match(m.text(), /You are signed in as Avery/);
    assert.match(m.text(), /you were not signed out/);
    assert.match(m.props(m.by('register-signed-in-continue')).href ?? '', /^\/pricing\?for=founder&checkout=founder%3Astudio&interval=yearly$/);
    assert.ok(m.by('register-signed-in-signout'));
  } finally { await m.close(); }
  const src = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(src, /heldFor=\{\(\) => planIntentFrom\(window\.location\.search\)\}/, 'App holds a signed-in visitor on a plan link');
});

test('back on Pricing: a different price is said before the sheet; a plan no longer sold is said, and nothing opens in its place', async () => {
  for (const [search, plans, expectKind, expectText] of [
    ['/pricing?for=founder&checkout=founder%3Astudio&interval=yearly&seen=84000', [STUDIO], 'price', /now \$960 a year; it was \$840 when you chose it/],
    ['/pricing?for=founder&checkout=founder%3Astudio&interval=yearly&seen=96000', [STUDIO], null, null],
    ['/pricing?for=founder&checkout=founder%3Astudio&interval=yearly&seen=96000', [plan('founder:studio', 'founder:studio', 10000, null)], 'interval', /Yearly billing is not offered for Raise \+ Grow right now/],
    ['/pricing?for=founder&checkout=founder%3Astudio&interval=monthly', [plan('founder:growth', 'founder:growth', 2000, 20400)], 'gone', /no longer offered here/],
  ]) {
    const restore = installDocument();
    const createEl = document.createElement.bind(document);
    document.createElement = (tag) => { const n = createEl(tag); n.querySelector = () => null; return n; };
    const savedP = { ...publicPricingApi }; const savedC = { ...checkoutApi }; const savedB = { ...billingAlertsApi };
    publicPricingApi.plansAndPacks = async () => ({ plans: plans, packs: [] });
    publicPricingApi.aiModels = async () => ({ models: [] });
    checkoutApi.quote = async () => ({ plan_key: 'founder:studio', interval: 'yearly', subtotal: 96000 });
    checkoutApi.methods = async () => ({ methods: [] });
    const container = document.createElement('div'); const root = createRoot(container);
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
    try {
      await act(async () => root.render(h(MemoryRouter, { initialEntries: [search] }, h(PricingBody, { user: { role: 'founder', subscription_tier: 'free' } }))));
      for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      if (expectKind) {
        assert.ok(by(`pricing-returned-${expectKind}`), `${expectKind} notice`);
        assert.match(text(by(`pricing-returned-${expectKind}`)), expectText);
        if (expectKind === 'price' || expectKind === 'interval') assert.ok(expectKind === 'price' ? by('checkout-sheet') : !by('checkout-sheet'));
        if (expectKind === 'gone') assert.ok(!by('checkout-sheet'), 'no sheet for a plan that is not sold');
      } else {
        assert.ok(!['price', 'interval', 'gone'].some((k) => by(`pricing-returned-${k}`)), 'the price is the one that was chosen: no notice');
        assert.ok(by('checkout-sheet'));
      }
    } finally { await act(async () => root.unmount()); Object.assign(publicPricingApi, savedP); Object.assign(checkoutApi, savedC); Object.assign(billingAlertsApi, savedB); restore(); }
  }
});

// ------------------------------------------------- journeys (second slice)
// The browser journeys themselves (desktop and phone, Back, another plan, the email link and the Google return) are
// `frontend/tests/visual/pricing_journey_4651.spec.mjs`; these two hold the fixes it found inside test:drift too.

test('an unreadable catalogue on registration offers Try again, which reads it again and shows the chosen plan', async () => {
  const restore = installDocument('?plan=founder%3Astudio&interval=yearly&lane=founder');
  let calls = 0;
  let up = false;
  const api = { plansAndPacks: async () => { calls += 1; if (!up) throw new Error('down'); return READ; } };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(Page, { search: '?plan=founder%3Astudio&interval=yearly&lane=founder', api }))));
    await settle();
    assert.equal(props(by('register-plan'))['data-state'], 'unreadable');
    assert.ok(by('register-plan-retry'), 'an unreadable plan can be read again in place');
    const before = calls;
    up = true;
    await act(async () => { props(by('register-plan-retry')).onClick(); });
    await settle();
    assert.ok(calls > before, 'Try again read the catalogue again');
    assert.equal(props(by('register-plan'))['data-state'], 'ready');
    assert.match(text(by('register-plan-price')), /\$960 billed yearly/);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('signed out, Pricing leaves a checkout ask in the address for the member page that follows a Google return', async () => {
  const restore = installDocument();
  const createEl = document.createElement.bind(document);
  document.createElement = (tag) => { const n = createEl(tag); n.querySelector = () => null; return n; };
  const savedP = { ...publicPricingApi };
  publicPricingApi.plansAndPacks = async () => READ;
  publicPricingApi.aiModels = async () => ({ models: [] });
  const container = document.createElement('div'); const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  let where = null;
  const Probe = () => { const l = useLocation(); where = `${l.pathname}${l.search}`; return null; };
  const ask = '/pricing?for=founder&checkout=founder%3Astudio&interval=yearly&seen=96000&google=ok';
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: [ask] }, h(PricingBody, null), h(Probe))));
    for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.equal(where, ask, 'the ask is not spent on a visitor\'s cards');
    assert.ok(!['price', 'interval', 'gone'].some((k) => by(`pricing-returned-${k}`)), 'no "no longer offered" for a plan that is on sale');
    assert.ok(!by('checkout-sheet'));
  } finally { await act(async () => root.unmount()); Object.assign(publicPricingApi, savedP); restore(); }
});
