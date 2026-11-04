/**
 * D4297 (#4297, D4289 P8) — the public side of the Influencer program: the
 * @handle page (IN7), /influencers (IN8), the application sheet (IN9) and its
 * states (IN9r), and the Refer & Earn card (IN10).
 *
 * What this file holds the pages to (#4297's "Done when"):
 *   · each page's states, drawn from stubbed reads;
 *   · the disclosure wherever a handle or an offer appears;
 *   · no hard-coded price or rate: the tiers' rates come from the tiers read,
 *     the plans' prices from the plans read, and changing the read changes the page.
 * Every person here is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/influencer_public_d4297.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installAppDom } from './_appDom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import HandlePage from '../src/pages/influencer/HandlePage.jsx';
import InfluencersPage from '../src/pages/influencer/InfluencersPage.jsx';
import InfluencerCard from '../src/pages/influencer/InfluencerCard.jsx';
import { resetPlansRead } from '../src/lib/planPrices.js';
import {
  REGISTER_TO_APPLY, applyBody, commonDuration, disclosureFor, disclosureOf, emptyForm, rateRange, standing, stepError, tierRows,
} from '../src/pages/influencer/influencerPublicModel.js';
import { BUILD_LINKS } from '../src/lib/siteLinks.js';
import { ogEntryFor } from '../src/lib/ogRegistry.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const MEMBER = { id: 50, role: 'founder', name: 'Max Member', email: 'max@example.com' };
const VERSION = '2026-11-03';
const DISCLOSURE = 'Jane Rivera earns a commission when you subscribe. Axal memberships are software, not an investment.';

const TIERS = { tiers: [
  { tier: 'affiliate_creator', label: 'Affiliate Creator', percentage_bps: 2000, duration_invoices: 12, currency: 'USD' },
  { tier: 'verified_influencer', label: 'Verified Influencer', percentage_bps: 2500, duration_invoices: 12, currency: 'USD' },
  { tier: 'strategic_creator', label: 'Strategic Creator', percentage_bps: 3000, duration_invoices: 12, currency: 'USD' },
  { tier: 'strategic_partner', label: 'Strategic Partner', percentage_bps: null, duration_invoices: null, currency: 'USD' },
] };
const price = (cents) => [{ interval: 'month', interval_count: 1, unit_amount: cents, currency: 'usd' }];
const PLANS = { plans: [
  { licence_key: 'founder:growth', prices: price(4900) }, { licence_key: 'investor:professional', prices: price(9900) },
  { licence_key: 'advisor', prices: price(2900) }, { licence_key: 'partner', prices: price(3900) },
] };
const LIVE = {
  state: 'live', handle: 'jane', channel: null, name: 'Jane Rivera', photo: null, line: 'I make videos about building and funding software companies.',
  tier: 'verified_influencer', tier_label: 'Verified Influencer', disclosure: DISCLOSURE, ref: 'h:jane',
  offer: { uid: 'off_1', discount: '20% off for 3 months', who_for: 'Once per member', plans: ['Investor Pro'], ends_at: '2027-01-01T00:00:00Z' },
};
const ME = (o = {}) => ({ membership: null, application: null, reapply_after: null, consent_version: VERSION, ...o });

function worker(o = {}) {
  const { handle = LIVE, tiers = TIERS, plans = PLANS, me = ME(), user = null, apply = () => response({ application: { uid: 'app_1', status: 'applied' } }, 201) } = o;
  const call = (v, ...a) => { const out = typeof v === 'function' ? v(...a) : v; return out && typeof out.json === 'function' ? out : response(out); };
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = url.split('?');
    if (method === 'POST' && path === '/api/influencer/apply') return call(apply, options);
    if (method !== 'GET') return never();
    if (path === '/api/auth/me') return user ? response(user) : never();
    if (path.startsWith('/api/public/handle/')) return call(handle);
    if (path === '/api/influencer/tiers') return call(tiers);
    if (path === '/api/influencer/me') return call(me);
    if (path === '/api/public/plans-and-packs') return call(plans);
    return never();
  };
}

async function mounted(url, handle, { user = null } = {}) {
  const requests = [];
  const { restore, timers } = installAppDom({ fetch: async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); } });
  resetPlansRead();
  if (user) localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const routes = h(Routes, null,
    h(Route, { path: '/influencers', element: h(InfluencersPage) }),
    h(Route, { path: '/referrals', element: h(InfluencerCard) }),
    h(Route, { path: '/:at', element: h(HandlePage) }),
    h(Route, { path: '/:at/:channel', element: h(HandlePage) }),
    h(Route, { path: '/register', element: h('p', { 'data-testid': 'register' }, 'register') }));
  const tree = user ? h(AuthProvider, null, routes) : routes;
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, tree)));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, text: () => text(document.body),
    textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, target) { const p = props(byId(id)); assert.ok(p.onChange, `no ${id} to change`); await act(async () => { p.onChange({ target }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); timers.clear(); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('tiers: every rate and duration is the read\'s; a tier left to terms reads "Set per agreement"', () => {
  assert.deepEqual(tierRows(TIERS.tiers).map((t) => [t.label, t.rate, t.duration, t.who]), [
    ['Affiliate Creator', '20%', '12 invoices', 'Anyone admitted'],
    ['Verified Influencer', '25%', '12 invoices', 'An audience HQ has checked'],
    ['Strategic Creator', '30%', '12 invoices', 'By invitation'],
    ['Strategic Partner', 'Set per agreement', 'Set per agreement', 'Organisations, by agreement'],
  ]);
  assert.equal(rateRange(TIERS.tiers), '20–30%');
  assert.equal(rateRange([{ percentage_bps: 1500 }, { percentage_bps: 1500 }]), '15%');
  assert.equal(rateRange([{ percentage_bps: null }]), null, 'no stated rate is no range, never 0%');
  assert.equal(commonDuration(TIERS.tiers), '12 invoices');
  assert.equal(commonDuration([{ duration_invoices: 6 }, { duration_invoices: 12 }]), null);
});

test('standing: admitted, in review, more needed, declined until a date, or free to apply', () => {
  assert.deepEqual(standing(ME({ membership: { status: 'active', tier_label: 'Verified Influencer', handle: 'jane' } })), { kind: 'admitted', tier: 'Verified Influencer', paused: false, handle: 'jane' });
  assert.equal(standing(ME({ membership: { status: 'ended' } })).kind, 'none', 'an ended membership may apply again');
  assert.deepEqual(standing(ME({ application: { status: 'applied', created_at: '2026-10-20 10:00:00', updated_at: '2026-10-20 10:00:00' } })), { kind: 'review', sent: '20 Oct 2026' });
  assert.equal(standing(ME({ application: { status: 'more_requested', reason: 'Add a sponsored post.' } })).question, 'Add a sponsored post.');
  assert.deepEqual(standing(ME({ application: { status: 'declined', reason: 'Most of your audience is under 18.' }, reapply_after: '2027-02-02' })), { kind: 'declined', reason: 'Most of your audience is under 18.', after: '2 Feb 2027' });
  assert.equal(standing(ME({ application: { status: 'declined', reason: 'x' }, reapply_after: null })).kind, 'none', 'past the wait, apply again');
  assert.equal(standing(null).kind, 'none');
});

test('the sheet\'s steps refuse what the Worker would, and the body carries the version read', () => {
  const f = emptyForm();
  assert.match(stepError(0, f), /https:\/\//);
  f.channels[0].url = 'https://youtube.example/@jane';
  f.channels[0].audience = '12.5';
  assert.match(stepError(0, f), /whole number/);
  f.channels[0].audience = '48200';
  assert.equal(stepError(0, f), null);
  assert.match(stepError(1, f), /audience is/);
  f.regions = ['Europe']; f.topics = ['Startups'];
  assert.match(stepError(1, f), /why Axal/i);
  f.why = 'My viewers ask how to run a raise.';
  assert.equal(stepError(1, f), null);
  f.consent = { disclosure: true, no_deal_promotion: true };
  assert.equal(stepError(2, f), 'Tick every rule first.');
  f.consent.no_self_referral = true;
  assert.equal(stepError(2, f), null);
  assert.deepEqual(applyBody(f, VERSION), {
    channels: [{ kind: 'youtube', url: 'https://youtube.example/@jane', audience: 48200 }], regions: ['Europe'], topics: ['Startups'],
    why: 'My viewers ask how to run a raise.', consent_version: VERSION, consent: { disclosure: true, no_deal_promotion: true, no_self_referral: true },
  });
  f.channels[0].audience = '';
  assert.ok(!('audience' in applyBody(f, VERSION).channels[0]), 'an empty audience is left out, never 0');
});

test('the disclosure: the Worker\'s sentence, or the same sentence from the name', () => {
  assert.equal(disclosureOf(LIVE), DISCLOSURE);
  assert.equal(disclosureOf({ name: 'Jane Rivera' }), DISCLOSURE);
  assert.equal(disclosureFor(''), 'This influencer earns a commission when you subscribe. Axal memberships are software, not an investment.');
});

test('no price, rate or bonus amount is typed in the public influencer pages', () => {
  for (const f of ['pages/influencer/HandlePage.jsx', 'pages/influencer/InfluencersPage.jsx', 'pages/influencer/ApplySheet.jsx', 'pages/influencer/InfluencerCard.jsx', 'pages/influencer/influencerPublicModel.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /[$€£]\s?\d/, `${f} types an amount`);
    assert.doesNotMatch(src, /\b\d{1,2}(?:–\d{1,2})?%/, `${f} types a rate`);
  }
});

test('/influencers is a public route, in the footer\'s links and the link-preview registry', () => {
  assert.match(read('routes/influencerProgram.jsx'), /<Route path="\/influencers" element=\{<InfluencersPage \/>\} \/>/);
  assert.ok(BUILD_LINKS.some((l) => l.to === '/influencers'));
  assert.equal(ogEntryFor('/influencers')?.title, 'Influencers');
  assert.equal(REGISTER_TO_APPLY, '/register?program=influencer&next=%2Finfluencers%3Fapply%3D1');
  assert.match(read('pages/ReferralsPage.jsx'), /<InfluencerCard \/>/);
});

/* ------------------------------------------------------------------ *
 * IN7 · the @handle page
 * ------------------------------------------------------------------ */

test('a live handle: the card, the offer, Join with the reference, the disclosure, and prices from the plans read', async () => {
  const view = await mounted('/@jane', worker());
  try {
    assert.match(view.textOf('handle-live'), /Jane Rivera invites you to Axal VC/);
    assert.match(view.textOf('handle-tier'), /Verified Influencer/);
    assert.match(view.textOf('handle-offer'), /20% off for 3 months.*Investor Pro · Once per member · Ends 1 Jan 2027/);
    assert.equal(view.props('handle-join').href, '/register?ref=h%3Ajane');
    assert.match(view.textOf('handle-join'), /Join with Jane’s offer/);
    assert.equal(view.textOf('handle-disclosure'), DISCLOSURE, 'the disclosure stands beside the offer');
    assert.match(view.textOf('handle-plan-investor:professional'), /\$99 \/ month/);
    assert.match(view.textOf('handle-plan-founder:growth'), /\$49 \/ month/);
  } finally { await view.close(); }
  const other = await mounted('/@jane', worker({ plans: { plans: [{ licence_key: 'investor:professional', prices: price(12000) }] } }));
  try {
    assert.match(other.textOf('handle-plan-investor:professional'), /\$120 \/ month/, 'the price follows the read');
    assert.match(other.textOf('handle-plan-advisor'), /Price not read/, 'a plan the read does not price says so, never a zero');
  } finally { await other.close(); }
});

test('a live handle with no offer still carries the disclosure; prices that cannot be read say so', async () => {
  const view = await mounted('/@jane/yt', worker({ handle: { ...LIVE, offer: null, disclosure: undefined }, plans: () => response({ error: 'down' }, 503) }));
  try {
    assert.ok(!view.has('handle-offer'));
    assert.match(view.textOf('handle-join'), /Join with Jane Rivera/);
    assert.equal(view.textOf('handle-disclosure'), DISCLOSURE);
    assert.match(view.textOf('handle-prices-unread'), /doesn’t mean it’s free/);
    assert.ok(view.requests.some((r) => r.url.startsWith('/api/public/handle/jane/yt')), 'the channel is read');
  } finally { await view.close(); }
});

test('the handle page\'s states: unknown, paused (no name, no offer), failed', async () => {
  const unknown = await mounted('/@janey', worker({ handle: () => response({ state: 'unknown' }, 404) }));
  try {
    assert.match(unknown.textOf('handle-unknown'), /This page doesn’t exist.*axal\.vc\/@janey is not an Axal Influencer handle.*Join anyway/);
  } finally { await unknown.close(); }
  const paused = await mounted('/@pia', worker({ handle: { state: 'unavailable' } }));
  try {
    assert.match(paused.textOf('handle-unavailable'), /No offer is shown and no sign-up is credited/);
    assert.ok(!/Jane|invites you|20% off/.test(paused.text()), 'no name and no offer while paused');
    assert.ok(!paused.has('handle-disclosure'), 'no handle drawn, so no disclosure owed');
  } finally { await paused.close(); }
  const failed = await mounted('/@jane', worker({ handle: () => response({ error: 'down' }, 503) }));
  try {
    assert.match(failed.textOf('handle-error'), /could not be read/);
  } finally { await failed.close(); }
});

/* ------------------------------------------------------------------ *
 * IN8 and IN9 · /influencers and the sheet
 * ------------------------------------------------------------------ */

test('/influencers signed out: the tiers from the read, the earn line from the rates, and Apply registers for the program', async () => {
  const view = await mounted('/influencers', worker());
  try {
    assert.match(view.textOf('influencers-tier-verified_influencer'), /Verified Influencer.*25%.*12 invoices.*An audience HQ has checked/);
    assert.match(view.textOf('influencers-tier-strategic_partner'), /Set per agreement.*Set per agreement/);
    assert.equal(view.textOf('influencers-earn'), '20–30% of each subscription, for 12 invoices per member.');
    assert.equal(view.props('influencers-apply').href, REGISTER_TO_APPLY);
    assert.match(view.textOf('influencers-bonuses'), /10, 25, 50 and 100 paid members\. Your terms set each amount\./);
    assert.ok(!view.requests.some((r) => r.url.startsWith('/api/influencer/me')), 'no member read while signed out');
  } finally { await view.close(); }
  const other = await mounted('/influencers', worker({ tiers: { tiers: [{ tier: 'affiliate_creator', label: 'Affiliate Creator', percentage_bps: 1500, duration_invoices: 6 }] } }));
  try {
    assert.equal(other.textOf('influencers-earn'), '15% of each subscription, for 6 invoices per member.', 'the rates follow the read');
  } finally { await other.close(); }
  const down = await mounted('/influencers', worker({ tiers: () => response({ error: 'tiers_unreadable' }, 503) }));
  try {
    assert.match(down.textOf('influencers-tiers-unread'), /could not be read.*not the same as having none/);
    assert.match(down.textOf('influencers-earn'), /A share of each subscription/, 'no rate is guessed');
  } finally { await down.close(); }
});

test('signed in, back from registering: the sheet opens, its three steps refuse what is missing, and Submit sends the version read', async () => {
  const view = await mounted('/influencers?apply=1', worker({ user: MEMBER }), { user: MEMBER });
  try {
    assert.ok(view.has('influencer-apply'), '?apply=1 opens the sheet');
    await view.click('influencer-apply-next');
    assert.match(view.textOf('influencer-apply-refusal'), /https:\/\//);
    await view.change('influencer-apply-url-0', { value: 'https://youtube.example/@max' });
    await view.change('influencer-apply-audience-0', { value: '48200' });
    await view.click('influencer-apply-next');
    assert.ok(view.has('influencer-apply-step-1'));
    await view.click('influencer-apply-region-Europe');
    await view.click('influencer-apply-topic-Startups');
    await view.change('influencer-apply-why', { value: 'My viewers ask how to run a raise.' });
    await view.click('influencer-apply-next');
    assert.match(view.textOf('influencer-apply-version'), /Terms version 2026-11-03\./);
    await view.change('influencer-apply-rule-disclosure', { checked: true });
    await view.change('influencer-apply-rule-no_deal_promotion', { checked: true });
    await view.click('influencer-apply-submit');
    assert.equal(view.textOf('influencer-apply-refusal'), 'Tick every rule first.');
    assert.equal(view.requests.filter((r) => r.method === 'POST').length, 0, 'nothing is sent until every rule is ticked');
    await view.change('influencer-apply-rule-no_self_referral', { checked: true });
    await view.click('influencer-apply-submit');
    const [w] = view.requests.filter((r) => r.method === 'POST' && r.url === '/api/influencer/apply');
    assert.ok(w, 'the application is sent');
    assert.deepEqual(JSON.parse(w.body), {
      channels: [{ kind: 'youtube', url: 'https://youtube.example/@max', audience: 48200 }], regions: ['Europe'], topics: ['Startups'],
      why: 'My viewers ask how to run a raise.', consent_version: VERSION, consent: { disclosure: true, no_deal_promotion: true, no_self_referral: true },
    });
    assert.ok(!view.has('influencer-apply'), 'the sheet closes once sent');
  } finally { await view.close(); }
});

test('the Worker\'s refusal reads in its own words in the sheet', async () => {
  const refuse = () => response({ error: 'terms_version', code: 'terms_version', message: 'The Influencer terms have changed since you opened them. Read them again and accept the current version.' }, 400);
  const view = await mounted('/influencers?apply=1', worker({ user: MEMBER, apply: refuse }), { user: MEMBER });
  try {
    await view.change('influencer-apply-url-0', { value: 'https://youtube.example/@max' });
    await view.click('influencer-apply-next');
    await view.click('influencer-apply-region-Europe');
    await view.click('influencer-apply-topic-Startups');
    await view.change('influencer-apply-why', { value: 'Why not.' });
    await view.click('influencer-apply-next');
    for (const k of ['disclosure', 'no_deal_promotion', 'no_self_referral']) await view.change(`influencer-apply-rule-${k}`, { checked: true });
    await view.click('influencer-apply-submit');
    assert.match(view.textOf('influencer-apply-refusal'), /terms have changed/);
  } finally { await view.close(); }
});

test('where an applicant stands on /influencers: in review, more needed (from the answers sent), declined until a date, admitted', async () => {
  const review = await mounted('/influencers', worker({ user: MEMBER, me: ME({ application: { status: 'applied', created_at: '2026-10-20 10:00:00', updated_at: '2026-10-20 10:00:00' } }) }), { user: MEMBER });
  try {
    assert.match(review.textOf('influencer-status-review'), /In review.*Application sent.*Sent 20 Oct 2026/);
    assert.ok(!review.has('influencers-apply'), 'no second application while one is open');
  } finally { await review.close(); }
  const answers = { channels: [{ kind: 'newsletter', url: 'https://news.example/max', audience: 12400 }], regions: ['Europe'], topics: ['Product'], why: 'Readers ask.' };
  const more = await mounted('/influencers', worker({ user: MEMBER, me: ME({ application: { status: 'more_requested', reason: 'Please add a link to a recent sponsored post.', answers } }) }), { user: MEMBER });
  try {
    assert.match(more.textOf('influencer-status-question'), /recent sponsored post/);
    await more.click('influencer-status-add');
    assert.equal(more.props('influencer-apply-url-0').value, 'https://news.example/max', 'the sheet starts from the answers sent');
  } finally { await more.close(); }
  const declined = await mounted('/influencers', worker({ user: MEMBER, me: ME({ application: { status: 'declined', reason: 'Most of your audience is under 18.' }, reapply_after: '2027-02-02' }) }), { user: MEMBER });
  try {
    assert.match(declined.textOf('influencer-status-reason'), /HQ’s reason: Most of your audience is under 18\. You can apply again after 2 Feb 2027\./);
    assert.ok(declined.props('influencer-status-again').disabled);
  } finally { await declined.close(); }
  const admitted = await mounted('/influencers', worker({ user: MEMBER, me: ME({ membership: { status: 'active', tier_label: 'Affiliate Creator', handle: 'max' } }) }), { user: MEMBER });
  try {
    assert.equal(admitted.props('influencers-open-section').href, '/influencer');
  } finally { await admitted.close(); }
});

/* ------------------------------------------------------------------ *
 * IN10 · the Refer & Earn card
 * ------------------------------------------------------------------ */

test('the Refer & Earn card: Apply with the read\'s rates, the application\'s state, or the section', async () => {
  const none = await mounted('/referrals', worker({ user: MEMBER }), { user: MEMBER });
  try {
    assert.equal(none.textOf('influencer-card-earn'), 'Earn 20–30% of every subscription you bring in, for 12 invoices per member.');
    await none.click('influencer-card-apply-open');
    assert.ok(none.has('influencer-apply'));
  } finally { await none.close(); }
  const review = await mounted('/referrals', worker({ user: MEMBER, me: ME({ application: { status: 'applied', created_at: '2026-10-20 10:00:00' } }) }), { user: MEMBER });
  try {
    assert.match(review.textOf('influencer-card-standing'), /In review/);
  } finally { await review.close(); }
  const admitted = await mounted('/referrals', worker({ user: MEMBER, me: ME({ membership: { status: 'paused', tier_label: 'Verified Influencer', handle: 'max' } }) }), { user: MEMBER });
  try {
    assert.match(admitted.textOf('influencer-card-tier'), /Verified Influencer/);
    assert.equal(admitted.props('influencer-card-open').href, '/influencer');
    assert.match(admitted.textOf('influencer-card-admitted'), /paused your membership/);
  } finally { await admitted.close(); }
  const down = await mounted('/referrals', worker({ user: MEMBER, me: () => response({ error: 'influencer_unreadable' }, 503) }), { user: MEMBER });
  try {
    assert.match(down.textOf('influencer-card-unread'), /not the same as having none/);
  } finally { await down.close(); }
});
