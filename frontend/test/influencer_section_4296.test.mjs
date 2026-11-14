// D4289 P7 (#4296): the member's Influencer section, IN0–IN6.
//   - the sidebar row: every role's shell, only while `/me`'s influencer_active is 1, label first;
//   - the routes: six addresses, guarded on the membership (not a role), full bleed, a rail key;
//   - each tab draws its states from stubbed reads: first day, data, Not recorded, Unreadable,
//     "Fewer than 5"; money per currency, never summed; Eadwyn's line as the reply says it;
//   - Request payout stays off until the identity check, the tax form and a payout method are done;
//   - no referred member's identity is drawn; the mounted page reads only what its tab needs.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/influencer_section_4296.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  INFLUENCER_ROW, SHARED_FULL_BLEED, SHARED_FULL_BLEED_PREFIXES, SIDEBAR_GROUPS, influencerActiveOf, withDiligenceRow, withInfluencerRow,
} from '../src/sidebarConfig.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import {
  TABS, accentFor, audienceView, countText, figure, isFirstDay, milestoneView, money, moneyFigure, moneyLines, offerStatus, offerView,
  overviewView, payoutBody, payoutGate, retentionView, tabFor,
} from '../src/pages/influencer/section/influencerSectionModel.js';
import OverviewTab from '../src/pages/influencer/section/OverviewTab.jsx';
import LinksTab from '../src/pages/influencer/section/LinksTab.jsx';
import OffersTab from '../src/pages/influencer/section/OffersTab.jsx';
import EarningsTab from '../src/pages/influencer/section/EarningsTab.jsx';
import AudienceTab from '../src/pages/influencer/section/AudienceTab.jsx';
import ResourcesTab from '../src/pages/influencer/section/ResourcesTab.jsx';
import InfluencerSectionPage from '../src/pages/influencer/section/InfluencerSectionPage.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const ok = (data) => ({ status: 'ok', data });
const FAILED = { status: 'error' };
const html = (el, path = '/influencer') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* Synthetic only. A referred member's identity appears in no read; these strays prove nothing draws one. */
const STRAY = { name: 'Pat Example', email: 'pat@example.test', user_id: 991, referred_id: 992 };
const NR = (source) => ({ available: false, reason: 'not_recorded', source });
const UNR = { available: false, reason: 'unreadable' };
const F5 = { fewer_than: 5 };
const ACCENT = accentFor('founder');
const HEADER = { handle: 'jane', chip: '@jane', url: 'https://axal.vc/@jane', shortUrl: 'axal.vc/@jane', tier: 'Verified Influencer', paused: false };

/** `main`'s reply: everything P2/P3 add is Not recorded. */
const MAIN_EMPTY = {
  as_of: '2026-11-03T10:00:00.000Z',
  range: { from: '2026-08-11', to: '2026-11-03', grain: 'week', channel: null },
  visits: NR('handle_visits'),
  signups: { total: 0, series: [{ week: '2026-10-27', value: 0 }] },
  paid_members: NR('subscription_commissions'),
  revenue: NR('subscription_commissions'),
  commission: { by_currency: [], series: [] },
  bonuses: NR('subscription_commissions'),
  funnel: { visits: NR('handle_visits'), signups: 0, paid: NR('subscription_commissions') },
  channels: NR('handle_visits'),
  audience: {
    by_plan_family: [], by_region: [], by_month_joined: [],
    retention: NR('subscription_commissions'), visit_to_paid_median_days: NR('handle_visits'),
  },
  line: 'From your link records, as of 2026-11-03: nothing to report yet for 2026-08-11 to 2026-11-03.',
};

/** The wired reply (#4295), two currencies, small groups. */
const WIRED = {
  as_of: '2026-11-03T10:00:00.000Z',
  range: { from: '2026-08-11', to: '2026-11-03', grain: 'week', channel: null },
  visits: { total: 1982, series: [{ week: '2026-10-27', value: 1034 }] },
  signups: { total: F5, series: [{ week: '2026-10-27', value: F5 }] },
  paid_members: { total: 18, series: [{ week: '2026-10-27', value: 9 }] },
  revenue: { by_currency: [{ currency: 'USD', net_cents: 358000 }, { currency: 'EUR', net_cents: 64000 }] },
  commission: {
    by_currency: [
      { currency: 'USD', pending_cents: 41200, payable_cents: 123600, in_payout_cents: 0, paid_cents: 398000, reversed_cents: 6000 },
      { currency: 'EUR', pending_cents: 4800, payable_cents: 9600, in_payout_cents: 0, paid_cents: 31000, reversed_cents: 0 },
    ],
    series: [
      { week: '2026-10-20', currency: 'EUR', earned_cents: 1600 }, { week: '2026-10-27', currency: 'EUR', earned_cents: 0 },
      { week: '2026-10-20', currency: 'USD', earned_cents: 3750 }, { week: '2026-10-27', currency: 'USD', earned_cents: 500 },
    ],
  },
  bonuses: { earned: [{ milestone: 10, currency: 'USD', amount_cents: 2500, achieved_at: '2026-09-03T00:00:00Z' }], next: { milestone: 25, kind: 'bonus', needs: 7 } },
  funnel: { visits: 1982, signups: 86, paid: 18 },
  channels: [
    { channel: 'yt', visits: 2104, signups: 98, paid: 21, ...STRAY },
    { channel: 'x', visits: 1388, signups: F5, paid: F5 },
    { channel: null, visits: 418, signups: 9, paid: F5 },
  ],
  audience: {
    by_plan_family: [{ plan_family: 'founder', members: 21, ...STRAY }, { plan_family: 'partner', members: F5 }],
    by_region: [{ country: 'PT', members: 19 }, { country: null, members: F5 }],
    by_month_joined: [{ month: '2026-09', members: 9 }, { month: '2026-10', members: F5 }],
    retention: [{ cohort: '2026-09', members: 9, months: [9, 7, F5] }, { cohort: '2026-10', members: F5, months: [F5] }],
    visit_to_paid_median_days: { days: 6, members: 18 },
  },
  line: 'From your link records, as of 2026-11-03: from 2026-08-11 to 2026-11-03, fewer than 5 sign-ups came through you, and $1,236.00 is payable.',
};

/* ------------------------------------------------------------------ *
 * IN0: the sidebar row
 * ------------------------------------------------------------------ */

test('IN0: the Influencer row is in every member role\'s shell while the membership is active, and in none while it is not', () => {
  for (const role of ['founder', 'investor', 'advisor', 'partner']) {
    const groups = SIDEBAR_GROUPS[role];
    const on = withInfluencerRow(groups, role, true);
    const rows = on.flatMap((g) => g.items || []).filter((i) => i.to === '/influencer');
    assert.equal(rows.length, 1, `${role}: one row`);
    assert.equal(on[0].items[on[0].items.length - 1], INFLUENCER_ROW, `${role}: under the profile's own rows, last in the first group`);
    assert.deepEqual(on.slice(1), groups.slice(1), `${role}: no other group changes`);
    for (const off of [false, undefined, null, 0, 1, 'true']) {
      assert.equal(withInfluencerRow(groups, role, off), groups, `${role}: hidden for ${String(off)}`);
    }
    assert.equal(withInfluencerRow(on, role, true), on, `${role}: never twice`);
  }
  assert.equal(withInfluencerRow(SIDEBAR_GROUPS.founder, '', true), SIDEBAR_GROUPS.founder, 'no shell role, no row');
  assert.equal(withInfluencerRow([], 'founder', true).length, 0);
});

test('IN0: the row follows /me\'s influencer_active (1/0), not a role; it is the megaphone, with label first', () => {
  assert.equal(influencerActiveOf({ influencer_active: 1 }), true);
  assert.equal(influencerActiveOf({ influencer_active: 0 }), false);
  assert.equal(influencerActiveOf({ role: 'investor' }), false);
  assert.equal(influencerActiveOf(null), false);
  assert.deepEqual(Object.keys(INFLUENCER_ROW), ['label', 'to', 'icon', 'match']);
  assert.match(read('sidebarConfig.js'), /export const INFLUENCER_ROW = Object\.freeze\(\{ label: 'Influencer', to: '\/influencer', icon: Megaphone,/);
  // Beside Diligence: the two compose in either order.
  const both = withInfluencerRow(withDiligenceRow(SIDEBAR_GROUPS.investor, 'investor', true), 'investor', true);
  const labels = both.flatMap((g) => g.items.map((i) => i.label));
  assert.ok(labels.includes('Diligence') && labels.includes('Influencer'));
  const app = read('App.jsx');
  assert.match(app, /withInfluencerRow\(list, shellRoleFor\(role, user, hqView\), influencerActiveOf\(user\)\)/, 'getSidebarGroups applies it for every shell');
  assert.equal((app.match(/return withRow\(/g) || []).length, 4, 'every return of getSidebarGroups carries the row');
});

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

test('six addresses, each guarded on the membership (authOnly + member), never on a role list', () => {
  const mod = read('routes/influencer.jsx');
  assert.deepEqual(TABS.map((t) => t.to), ['/influencer', '/influencer/links', '/influencer/offers', '/influencer/earnings', '/influencer/audience', '/influencer/resources']);
  for (const { to } of TABS) {
    assert.ok(mod.includes(`      <Route path="${to}" element={authOnly(<InfluencerSectionPage member={member} role={role} />)} />`), to);
  }
  assert.match(mod, /const member = influencerActiveOf\(user\);/);
  assert.doesNotMatch(mod, /guard\(\[/, 'no role gate');
  assert.match(mod, /lazy\(\(\) => import\('\.\.\/pages\/influencer\/section\/InfluencerSectionPage'\)\)/);
  assert.equal(tabFor('/influencer'), 'overview');
  assert.equal(tabFor('/influencer/earnings/'), 'earnings');
  assert.equal(tabFor('/influencer/nope'), 'overview');
});

test('the section owns its gutter, and keys the rail under each profile', () => {
  assert.ok(SHARED_FULL_BLEED.includes('/influencer'));
  assert.ok(SHARED_FULL_BLEED_PREFIXES.includes('/influencer/'));
  assert.equal(SHARED_FULL_BLEED_PREFIXES.some((p) => '/influencers'.startsWith(p)), false, 'the public program page is not swept in');
  assert.equal(pageKeyFor('/influencer', 'founder'), 'Founder · Influencer');
  assert.equal(pageKeyFor('/influencer/links', 'investor'), 'Investor · Influencer');
  assert.equal(pageKeyFor('/influencer/audience', 'partner'), 'Operating Partner · Influencer');
});

/* ------------------------------------------------------------------ *
 * The model's honest values
 * ------------------------------------------------------------------ */

test('a Count: a number, or "Fewer than 5"; Not recorded and Unreadable are never 0', () => {
  assert.equal(countText(1982), '1,982');
  assert.equal(countText(0), '0');
  assert.equal(countText(F5), 'Fewer than 5');
  assert.deepEqual(figure(F5), { state: 'small', text: 'Fewer than 5', value: null });
  assert.equal(figure(NR('handle_visits')).text, 'Not recorded');
  assert.equal(figure(UNR).text, 'Unreadable');
  assert.equal(figure({ available: false, reason: 'something_new' }).state, 'unreadable');
  assert.equal(figure('7').state, 'unreadable', 'a reply in another shape is not a figure');
  assert.equal(figure({ total: 0, series: [] }).text, '0', 'a counted zero is a zero');
});

test('money is per currency, one line each, never summed', () => {
  const lines = moneyLines(WIRED.commission.by_currency, 'payable_cents');
  assert.deepEqual(lines.map((l) => l.text), ['€96.00', '$1,236.00']);
  assert.equal(money(123600, 'usd'), '$1,236.00');
  assert.equal(money(null, 'USD'), 'Not recorded');
  const m = moneyFigure(WIRED.revenue, 'net_cents');
  assert.deepEqual(m.lines.map((l) => l.text), ['€640.00', '$3,580.00']);
  assert.equal(moneyFigure({ by_currency: [] }, 'net_cents').text, 'None yet');
  assert.equal(moneyFigure(NR('subscription_commissions'), 'net_cents').text, 'Not recorded');
});

/* ------------------------------------------------------------------ *
 * IN1: Overview
 * ------------------------------------------------------------------ */

test('IN1s first day: main\'s reply with nothing yet says "Share your link to start", and Not recorded where nothing stores', () => {
  assert.equal(isFirstDay(MAIN_EMPTY), true);
  assert.equal(isFirstDay(WIRED), false);
  assert.equal(isFirstDay({ ...MAIN_EMPTY, signups: UNR }), false, 'an unreadable figure is not a first day');
  const out = text(html(h(OverviewTab, { analytics: ok(MAIN_EMPTY), header: HEADER, accent: ACCENT })));
  assert.match(out, /Share your link to start/);
  assert.match(out, /Visits Not recorded/);
  assert.match(out, /Paid members Not recorded/);
  assert.match(out, /Revenue influenced Not recorded/);
  assert.match(out, /Sign-ups 0/);
  assert.doesNotMatch(out, /Visits 0/);
  assert.match(out, /Next milestone .*Not recorded/);
  assert.match(out, /Top channels .*Not recorded/);
  assert.match(out, new RegExp(MAIN_EMPTY.line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the line, as the reply wrote it');
});

test('IN1 with data: the figures, "Fewer than 5", money per currency never summed, and the line as it is', () => {
  const v = overviewView(WIRED, 'jane');
  assert.equal(v.kpis.find((k) => k.key === 'signups').text, 'Fewer than 5');
  assert.deepEqual(v.funnel.map((s) => [s.label, s.text, s.share]), [['Visits', '1,982', null], ['Sign-ups', '86', '4.3% of visits'], ['Paid', '18', '20.9% of sign-ups']]);
  assert.equal(v.milestone.next, '7 more paid members to the 25-member bonus');
  assert.equal(milestoneView({ earned: [], next: { milestone: 10, kind: 'bonus', needs: { more_than: 5 } } }).next, 'More than 5 more paid members to the 10-member bonus');
  const raw = html(h(OverviewTab, { analytics: ok(WIRED), header: HEADER, accent: ACCENT }));
  const out = text(raw);
  assert.match(out, /Visits 1,982/);
  assert.match(out, /Sign-ups Fewer than 5/);
  assert.match(out, /Revenue influenced €640\.00 \$3,580\.00 Not summed/);
  assert.match(out, /Payable €96\.00 \$1,236\.00/);
  assert.doesNotMatch(out, /\$1,332\.00|1,332/, 'USD and EUR are never added');
  assert.doesNotMatch(out, /\$4,220|4,220/, 'revenue is never added across currencies');
  assert.match(out, /@jane\/yt 2,104 98 21/);
  assert.match(out, /@jane\/x 1,388 Fewer than 5 Fewer than 5/);
  assert.match(out, /@jane · direct 418 9 Fewer than 5/);
  assert.ok(raw.includes('data-testid="weekly-EUR"') && raw.includes('data-testid="weekly-USD"'), 'one chart per currency');
  assert.ok(out.includes(`Eadwyn: ${WIRED.line}`), 'the line is the reply\'s own');
  assert.doesNotMatch(out, /Share your link to start/);
});

test('IN1s: a failed read is Unreadable with Try again; a figure that failed reads Unreadable in place', () => {
  const failed = text(html(h(OverviewTab, { analytics: FAILED, header: HEADER, accent: ACCENT, onRetry: () => {} })));
  assert.match(failed, /Your figures could not be read\. That is not the same as having none\. Retry/);
  const one = text(html(h(OverviewTab, { analytics: ok({ ...WIRED, visits: UNR, line: null }), header: HEADER, accent: ACCENT })));
  assert.match(one, /Visits Unreadable/);
  assert.doesNotMatch(one, /Eadwyn:/, 'no line, no sentence written here');
});

/* ------------------------------------------------------------------ *
 * IN2: Links
 * ------------------------------------------------------------------ */

const HANDLE = ok({ handle: 'jane', url: 'https://axal.vc/@jane', line: 'I make videos about building companies.', next_change_at: '2099-01-01T00:00:00Z', status: 'active' });
const LINKS = ok({ handle: 'jane', links: [{ uid: 'l1', channel: 'yt', utm_campaign: 'fall-series', url: 'https://axal.vc/@jane/yt' }, { uid: 'l2', channel: 'podcast', utm_campaign: null, url: 'https://axal.vc/@jane/podcast' }] });

test('IN2: each link with its figures from the channels; Not recorded on main; Unreadable for a failed read', () => {
  const wired = text(html(h(LinksTab, { handle: HANDLE, links: LINKS, analytics: ok(WIRED), accent: ACCENT, reads: {} }), '/influencer/links'));
  assert.match(wired, /@jane\/yt Campaign: fall-series 2,104 98 21/);
  assert.match(wired, /@jane\/podcast 0 0 0/, 'a counted channel list without the link: 0');
  assert.match(wired, /You can change it again in \d+ days/);
  const main = text(html(h(LinksTab, { handle: HANDLE, links: LINKS, analytics: ok(MAIN_EMPTY), accent: ACCENT, reads: {} }), '/influencer/links'));
  assert.match(main, /@jane\/yt Campaign: fall-series Not recorded Not recorded Not recorded/);
  assert.doesNotMatch(main, /@jane\/yt Campaign: fall-series 0/);
  const none = text(html(h(LinksTab, { handle: HANDLE, links: ok({ handle: 'jane', links: [] }), analytics: ok(MAIN_EMPTY), accent: ACCENT, reads: {} })));
  assert.match(none, /No channel links yet/);
  const bad = text(html(h(LinksTab, { handle: HANDLE, links: FAILED, analytics: ok(MAIN_EMPTY), accent: ACCENT, reads: {} })));
  assert.match(bad, /Your channel links could not be read/);
});

/* ------------------------------------------------------------------ *
 * IN3: Offers
 * ------------------------------------------------------------------ */

const OFFER = {
  uid: 'o1', status: 'active', code_state: 'live', featured: true, code: 'JANE20', plans: ['Investor Pro'], intervals: 'Monthly and yearly',
  discount: '20% off for 3 months', who_for: 'First purchase only · Once per member', uses: 31,
  discount_given: [{ currency: 'USD', cents: 111600 }, { currency: 'EUR', cents: 2000 }], uses_without_recorded_discount: 0,
  budget: { cents: 200000, currency: 'USD' }, remaining_budget: { cents: 88400, currency: 'USD', budget_used: false }, ends_at: '2026-12-31',
};

test('IN3: offer states — Active, Paused by HQ, Ended, Budget used up, Unreadable — and discount given per currency', () => {
  assert.equal(offerStatus(OFFER).label, 'Active');
  assert.equal(offerStatus({ ...OFFER, status: 'paused' }).label, 'Paused by HQ');
  assert.equal(offerStatus({ ...OFFER, code_state: 'paused' }).label, 'Paused by HQ');
  assert.equal(offerStatus({ ...OFFER, status: 'ended' }).label, 'Ended');
  assert.equal(offerStatus({ ...OFFER, code_state: 'expired' }).label, 'Ended');
  assert.equal(offerStatus({ ...OFFER, remaining_budget: { cents: 0, currency: 'USD', budget_used: true } }).label, 'Budget used up');
  const lost = { uid: 'o2', status: 'active', code_state: 'unreadable', code: null, plans: 'Not recorded', discount: 'Not recorded', who_for: 'Not recorded', uses: 'Not recorded', discount_given: 'Not recorded', remaining_budget: 'Not recorded', budget: { cents: 50000, currency: 'USD' }, ends_at: 'Not recorded' };
  assert.equal(offerStatus(lost).label, 'Unreadable');
  const v = offerView(OFFER);
  assert.equal(v.given, '€20.00 · $1,116.00');
  assert.equal(v.remaining, '$884.00 of $2,000.00');
  assert.equal(offerView({ ...OFFER, uses: 0, discount_given: [] }).given, 'None yet');
  const out = text(html(h(OffersTab, { offers: ok({ offers: [OFFER, lost] }), accent: ACCENT, reads: {} }), '/influencer/offers'));
  assert.match(out, /Investor Pro Active 20% off for 3 months/);
  assert.match(out, /Discount given €20\.00 · \$1,116\.00/);
  assert.doesNotMatch(out, /1,136/, 'never summed');
  assert.match(out, /Unreadable Not recorded/);
  assert.match(out, /Uses Not recorded/);
  const none = text(html(h(OffersTab, { offers: ok({ offers: [] }), accent: ACCENT, reads: {} })));
  assert.match(none, /No offer yet/);
  assert.match(none, /Ask HQ for an offer/);
  const used = text(html(h(OffersTab, { offers: ok({ offers: [{ ...OFFER, remaining_budget: { cents: 0, currency: 'USD', budget_used: true } }] }), accent: ACCENT, reads: {} })));
  assert.match(used, /Budget used up/);
  assert.match(used, /Ask HQ for more budget/);
  assert.match(text(html(h(OffersTab, { offers: FAILED, accent: ACCENT, reads: {} }))), /Your offers could not be read/);
});

/* ------------------------------------------------------------------ *
 * IN4: Earnings
 * ------------------------------------------------------------------ */

const item = (key, ready, extra = {}) => ({ key, ready, blocks: key !== 'payout_method', code: key, line: `${key} line`, ...extra });
const READY = {
  influencer: true, ready: true, currency: 'USD', minimum_cents: 5000,
  items: [item('identity', true), item('tax_form', true, { status: 'accepted', form_type: 'w8ben' }), item('terms', true, { version: 'v1' }),
    item('payout_method', true, { label: 'Bank account', last4: '4821' }), item('minimum', true, { payable_cents: 123600, currency: 'USD' }), item('monthly', true)],
};
const withItem = (key, patch, top = {}) => ({ ...READY, ...top, items: READY.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
const isDisabled = (raw) => /<button[^>]*disabled=""[^>]*data-testid="payout-request"|<button[^>]*data-testid="payout-request"[^>]*disabled=""/.test(raw);

test('IN4: Request payout stays off until the identity check, the tax form and a payout method are all done', () => {
  assert.equal(payoutGate(READY), true);
  assert.equal(payoutGate(withItem('identity', { ready: false }, { ready: false })), false);
  assert.equal(payoutGate(withItem('identity', { ready: false })), false, 'even if the Worker said ready');
  assert.equal(payoutGate(withItem('tax_form', { ready: false, status: 'submitted' })), false);
  const noMethod = withItem('payout_method', { ready: false, label: null, last4: null });
  assert.equal(payoutGate(noMethod), false);
  assert.equal(payoutGate(noMethod, { method: 'wire', label: 'Bank', last4: '12' }), false, 'a half-named method is not one');
  assert.equal(payoutGate(noMethod, { method: 'wire', label: 'Bank', last4: '1234' }), true, 'a first payout names its method in the form');
  assert.equal(payoutGate({ ...READY, ready: false }), false, 'the Worker\'s own checklist (terms, minimum, monthly) holds too');
  assert.equal(payoutGate(null), false);
  assert.deepEqual(payoutBody(READY, null), { amount_cents: 123600, currency: 'USD', payout_method: 'wire', destination_label: 'Bank account', destination_last4: '4821' });

  const page = (readiness) => html(h(EarningsTab, { analytics: ok(WIRED), readiness: ok(readiness), payouts: ok([]), tiers: ok({ tiers: [] }), membership: { tier: 'verified', tier_label: 'Verified Influencer' }, accent: ACCENT, reads: {} }), '/influencer/earnings');
  assert.equal(isDisabled(page(READY)), false);
  assert.equal(isDisabled(page(withItem('identity', { ready: false }, { ready: false }))), true);
  assert.equal(isDisabled(page(withItem('tax_form', { ready: false, status: 'missing' }, { ready: false }))), true);
  assert.equal(isDisabled(page(noMethod)), true);
  assert.match(text(page(withItem('tax_form', { ready: false, status: 'missing' }, { ready: false }))), /Upload the form/);
});

test('IN4: the tiles one line per currency, bonuses Not recorded on main, Unreadable for a failed checklist', () => {
  const out = text(html(h(EarningsTab, { analytics: ok(WIRED), readiness: ok(READY), payouts: ok([{ id: 1, amount_cents: 118000, currency: 'USD', status: 'completed', created_at: '2026-10-01 00:00:00', ...STRAY }]), tiers: ok({ tiers: [{ tier: 'verified', percentage_bps: 2500, duration_invoices: 12 }] }), membership: { tier: 'verified', tier_label: 'Verified Influencer', admitted_at: '2026-08-12' }, accent: ACCENT, reads: {} })));
  assert.match(out, /Pending · held 30 days €48\.00 \$412\.00/);
  assert.match(out, /Payable €96\.00 \$1,236\.00/);
  assert.match(out, /Reversed €0\.00 \$60\.00/);
  assert.match(out, /10 paid members \$25\.00 · earned 2026-09-03/);
  assert.match(out, /Rate 25% of each subscription Duration 12 invoices per member/);
  assert.match(out, /2026-10-01 \$1,180\.00 · completed/);
  const main = text(html(h(EarningsTab, { analytics: ok(MAIN_EMPTY), readiness: FAILED, payouts: ok([]), tiers: FAILED, membership: { tier_label: 'Affiliate Creator' }, accent: ACCENT, reads: {} })));
  assert.match(main, /Bonuses For paid members you brought in, all time\. Not recorded/);
  assert.match(main, /Payable None yet/);
  assert.match(main, /Your payout checklist could not be read/);
  assert.match(main, /Rate Not set/);
});

/* ------------------------------------------------------------------ *
 * IN5: Audience
 * ------------------------------------------------------------------ */

test('IN5: totals only; a group under 5 reads "Fewer than 5" with no number; retention "<5", never a share', () => {
  const v = audienceView(WIRED);
  assert.deepEqual(v.planFamily.rows.map((r) => [r.label, r.value, r.text]), [['Founder', 21, '21'], ['Operating Partner', null, 'Fewer than 5']]);
  assert.deepEqual(v.region.rows.map((r) => r.label), ['PT', 'No country recorded']);
  assert.deepEqual(retentionView(WIRED.audience.retention).rows.map((r) => r.cells), [['100%', '78%', '<5'], ['<5', '', '']]);
  assert.equal(v.median.text, '6 days');
  const out = text(html(h(AudienceTab, { analytics: ok(WIRED) }), '/influencer/audience'));
  assert.match(out, /Founder 21/);
  assert.match(out, /Operating Partner Fewer than 5/);
  assert.match(out, /October 2026 Fewer than 5/);
  assert.match(out, /Median 6 days/);
  const main = text(html(h(AudienceTab, { analytics: ok(MAIN_EMPTY) })));
  assert.match(main, /Still paying, by month joined Share of each month’s members still paying\. Not recorded/);
  assert.match(main, /Median Not recorded/);
  assert.match(main, /No referred member yet/);
  const odd = text(html(h(AudienceTab, { analytics: ok({ ...WIRED, audience: { ...WIRED.audience, by_region: UNR, visit_to_paid_median_days: { days: 3, members: F5 } } }) })));
  assert.match(odd, /By region Unreadable/);
  assert.match(odd, /Median Fewer than 5/);
  assert.doesNotMatch(odd, /3 days/);
});

/* ------------------------------------------------------------------ *
 * IN6: Resources, and identity
 * ------------------------------------------------------------------ */

test('IN6: static resources and the Investor Pro benefit from the membership', () => {
  const on = text(html(h(ResourcesTab, { membership: { investor_pro: true } })));
  assert.match(on, /Label every post as a paid partnership, with #ad\./);
  assert.match(on, /An Axal VC fund or any fund\./);
  assert.match(on, /Active · included with your tier/);
  assert.match(text(html(h(ResourcesTab, { membership: { investor_pro: false } }))), /Not included with your tier/);
});

test('no referred member is drawn: stray names, emails and ids in a reply never reach the page', () => {
  const all = [
    html(h(OverviewTab, { analytics: ok(WIRED), header: HEADER, accent: ACCENT })),
    html(h(LinksTab, { handle: HANDLE, links: LINKS, analytics: ok(WIRED), accent: ACCENT, reads: {} })),
    html(h(OffersTab, { offers: ok({ offers: [{ ...OFFER, ...STRAY }] }), accent: ACCENT, reads: {} })),
    html(h(EarningsTab, { analytics: ok(WIRED), readiness: ok(READY), payouts: ok([{ id: 1, amount_cents: 100, currency: 'USD', status: 'pending', created_at: '2026-10-01', ...STRAY }]), tiers: ok({ tiers: [] }), membership: {}, accent: ACCENT, reads: {} })),
    html(h(AudienceTab, { analytics: ok(WIRED) })),
  ].join('');
  assert.doesNotMatch(all, /Pat Example|pat@example\.test|991|992/);
});

/* ------------------------------------------------------------------ *
 * Mounted: guarded on the membership, reads only what the tab needs
 * ------------------------------------------------------------------ */

async function mount(path, props) {
  const restore = installDocument();
  const previous = { matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(InfluencerSectionPage, props))));
  await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const propsOf = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => propsOf(n)['data-testid'] === id);
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '').replace(/\s+/g, ' ').trim();
  return { by, text: textOf, async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); } };
}

function stubReads(over = {}) {
  const calls = [];
  const r = (name, value) => () => { calls.push(name); return value instanceof Error ? Promise.reject(value) : Promise.resolve(value); };
  const reads = {
    me: r('me', { membership: { uid: 'u1', tier: 'verified', tier_label: 'Verified Influencer', status: 'active', handle: 'jane', investor_pro: true }, application: null }),
    handle: r('handle', HANDLE.data), links: r('links', LINKS.data), offers: r('offers', { offers: [OFFER] }),
    readiness: r('readiness', READY), payouts: r('payouts', []), tiers: r('tiers', { tiers: [] }), analytics: r('analytics', WIRED),
    ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, r(k, v)])),
  };
  return { reads, calls };
}

test('mounted: not an influencer reads nothing and says so; an admitted one gets the header and only its tab\'s reads', async () => {
  const outsider = stubReads();
  let m = await mount('/influencer', { member: false, role: 'investor', reads: outsider.reads });
  assert.ok(m.by('influencer-not-member'));
  assert.deepEqual(outsider.calls, []);
  await m.close();

  const paused = stubReads({ me: { membership: { status: 'paused', tier_label: 'Affiliate Creator' }, application: null } });
  m = await mount('/influencer', { member: true, role: 'founder', reads: paused.reads });
  assert.ok(m.by('influencer-not-member'), 'the membership the page reads decides too');
  await m.close();

  const member = stubReads();
  m = await mount('/influencer/offers', { member: true, role: 'advisor', reads: member.reads });
  assert.deepEqual([...member.calls].sort(), ['handle', 'me', 'offers']);
  assert.match(m.text(m.by('influencer-header')), /Influencer @jane Copy Verified Influencer/);
  assert.match(m.text(m.by('influencer-share')), /Share/);
  assert.ok(m.by('offer-o1'));
  await m.close();

  const failing = stubReads({ analytics: new Error('boom') });
  m = await mount('/influencer/audience', { member: true, role: 'partner', reads: failing.reads });
  assert.match(m.text(m.by('block-unreadable')), /Your audience could not be read/);
  await m.close();
});
