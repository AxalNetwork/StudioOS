/**
 * D568 (#1174) — the Account center: the canvas's six sections on `/account`,
 * each wired to the route that serves it, and the states every card must keep
 * apart (loading, empty, "Not recorded", unreadable).
 *
 * The fixtures are the routes' own response shapes, read off the Worker:
 * `pickIdentity` / `pickDetails` / `getCorporateProfile` (settings.ts,
 * profileExpansion.ts), `loadHistory` and `reaskList` (profile_history.ts),
 * `/push/subscriptions` (notifications.ts), `/settings/security`,
 * `/follows/mine`, `rowToOrder` (orders.ts) and the three plan status routes
 * (billing.ts). The last block checks the route source still serves those
 * fields, so a fixture cannot drift from the route without a failure here.
 *
 * THE ZONE IS WEST OF GREENWICH, as in `trust_center_panel.test.mjs`: a date
 * of birth formatted as an instant reads a day early there, and a run in UTC
 * would pass against that bug. Every fixture instant is at noon UTC, so it is
 * the same calendar day in Los Angeles. The model reads the zone at call time.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_center_d568.test.mjs
 */
process.env.TZ = 'America/Los_Angeles';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  channelOn, changedFields, dayLabel, deviceLabel, fieldErrorsFrom, filterFollows, filterOrders, followRows,
  historyLines, latestArchetype, money, orderRow, planSummary, refusalText, splitPersonalPatch, corporateIsEmpty,
  billingSourceFor,
} from '../src/pages/account/accountCenterModel.js';
import { AccountSectionNav, accountRailCoverage } from '../src/pages/account/AccountCenter.jsx';
import ProfileIdentityCanvas, {
  PersonalDetailsCard, IdentityCard, CompanyProfileCard, PublicArchetypeCard, ChangeHistoryCard,
} from '../src/pages/account/AccountProfile.jsx';
import { PushDevicesCard, SessionsCard } from '../src/pages/account/AccountDevices.jsx';
import { PlanHeader, OrdersCard } from '../src/pages/account/AccountBilling.jsx';
import { FollowingList } from '../src/pages/account/AccountFollowing.jsx';
import DeveloperSection, { DeveloperPanel } from '../src/pages/account/AccountDeveloper.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const noop = () => {};
const ready = (data) => ({ status: 'ready', data, message: '', reload: noop, set: noop });
const loading = () => ({ status: 'loading', data: null, message: '', reload: noop, set: noop });
const unreadable = (message = 'The store is down.', httpStatus = 503) => ({ status: 'unreadable', data: null, message, httpStatus, reload: noop, set: noop });

// --- Fixtures, in the routes' own shapes ------------------------------------

const ACCOUNT = { id: 41, uid: '3f9a00c2', email: 'ana@example.com', name: 'Ana Quintero', role: 'founder', email_verified: true, totp_configured: true, totp_recovery_codes_remaining: 8 };
const IDENTITY = {
  display_name: 'Ana Q.', headline: 'Founder', pronouns: null, archetype_sex: null, profile_slug: 'ana-q',
  timezone: 'Europe/Zurich', locale: 'fr', full_legal_name: 'Ana Maria Quintero', date_of_birth: '1990-05-12',
  nationality: 'CH', profile_completion_pct: 60, missing_required_fields: [],
};
const IDENTITY_BLANK = { ...IDENTITY, display_name: null, profile_slug: null, locale: null, full_legal_name: null, date_of_birth: null, nationality: null };
const DETAILS = {
  tax_residency_country: 'CH', tax_id_last4: null, has_tax_id: false, phone_last4: '1234', has_phone: true,
  address_line1: null, address_line2: null, city: 'Lausanne', state_or_region: null, postal_code: null, country: 'CH',
  profile_completion_pct: 60,
};
const DETAILS_BLANK = { ...DETAILS, tax_residency_country: null, phone_last4: null, has_phone: false, city: null, country: null };
const CORP_EMPTY = {
  profile_completion_pct: 60, entity_name: null, entity_type: null, registration_number: null, tax_id_last4: null, has_tax_id: false,
  registered_country: null, registered_address_line1: null, registered_address_line2: null, registered_city: null,
  registered_state: null, registered_postal: null, signing_authority_name: null, signing_authority_title: null,
  signing_authority_email: null, ubos: [], directors: [], insurance_carriers: [], ubo_disclosed: false,
  aml_high_risk_jurisdiction: false, sanctions_last_checked_at: null, updated_at: null,
};
const CORP = { ...CORP_EMPTY, entity_name: 'Quintero Labs SA', signing_authority_title: 'CEO', registration_number: 'CHE-123.456.789', registered_country: 'CH', updated_at: '2026-09-01 10:00:00' };
const snap = (id, persona, trigger, slug, at, confidence = 0.82) => ({
  id, persona, engine_version: 'v2', trigger, displayed_slug: slug, computed_slug: slug, secondary_slug: null,
  confidence, margin: 0.1, traits: {}, skills: {}, values: {}, axal_values: {}, hysteresis: null, computed_at: at,
});
const HISTORY = { items: [
  snap(3, 'founder', 'answer', 'fo_missionary', '2026-10-01T12:00:00.000Z'),
  snap(2, 'founder', 'scheduled', 'fo_rocketeer', '2026-09-03T12:00:00.000Z', 0.7),
  snap(1, 'founder', 'answer', 'fo_rocketeer', '2026-07-14T12:00:00.000Z', 0.6),
] };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const SUBS = { subscriptions: [
  { id: 7, user_agent: IPHONE, created_at: '2026-09-12 12:00:00', last_sent_at: '2026-10-01 12:00:00', last_error: null },
  { id: 8, user_agent: ANDROID, created_at: '2026-09-20 12:00:00', last_sent_at: null, last_error: 'HTTP 410 from the push service' },
] };
const SECURITY = {
  email_verified: true, totp_configured: true, totp_paired_at: '2026-06-01 10:00:00', totp_recovery_codes_remaining: 8,
  active_sessions: 3, sms_configured: true, sms_last4: '4321', sms_country: 'CH', tfa_methods: ['totp', 'sms'],
};
const FOLLOWS = {
  users: [
    { id: 11, handle: 'u-zed', name: 'Zed Okafor', headline: 'Operator in residence', role: 'advisor' },
    { id: 12, handle: 'u-amy', name: 'Amy Lin', headline: null, role: 'investor' },
  ],
  projects: [{ id: 5, handle: 'p-tidal', name: 'Tidal Grid', sector: 'climate_tech', stage: 'seed' }],
};
const item = (name, unit) => ({ price_id: `price_${name}`, product_id: `prod_${name}`, name, kind: 'one_time', quantity: 1, unit_amount: unit, line_total: unit });
const ORDERS = { orders: [
  { order_ref: 'AX-1001', status: 'paid', created_at: '2026-10-02 12:00:00', paid_at: '2026-10-02 12:01:00', currency: 'eur', subtotal: 12000, discount_cents: 0, vat_cents: 600, total: 12600, promo_code: null, items: [item('Incorporation pack', 12000)] },
  { order_ref: 'AX-0990', status: 'pending', created_at: '2025-12-12 12:00:00', paid_at: null, currency: 'eur', subtotal: 5000, discount_cents: 0, vat_cents: 250, total: 5250, promo_code: null, items: [item('Expert session', 3000), item('Deck review', 2000)] },
  { order_ref: 'AX-0950', status: 'failed', created_at: '2025-11-01 12:00:00', paid_at: null, currency: 'usd', subtotal: 3000, discount_cents: 0, vat_cents: 0, total: 3000, promo_code: null, items: [] },
] };

// --- The model ---------------------------------------------------------------

test('a channel is ON unless the stored value is exactly false, as notify.ts delivers it', () => {
  assert.equal(channelOn({}, 'deal_assigned', 'email'), true, 'an unset channel is delivered');
  assert.equal(channelOn(null, 'deal_assigned', 'email'), true);
  assert.equal(channelOn({ deal_assigned: { email: false } }, 'deal_assigned', 'email'), false);
  assert.equal(channelOn({ deal_assigned: { email: true } }, 'deal_assigned', 'email'), true);
  assert.equal(channelOn({ deal_assigned: { email: false } }, 'deal_assigned', 'in_app'), true, 'one channel off leaves the others on');
  // The Worker's rule this mirrors.
  const notify = read('cloudflare-worker/src/services/notify.ts');
  assert.match(notify, /if \(enabled === undefined \|\| enabled === true\) out\.push\(ch\);/);
});

test('a push device is named from its stored user agent, and only from that', () => {
  assert.deepEqual(deviceLabel(IPHONE), { name: 'Safari on iPhone', os: 'iOS 17.4' });
  assert.deepEqual(deviceLabel(ANDROID), { name: 'Chrome on Android phone', os: 'Android 14' });
  assert.deepEqual(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'), { name: 'Chrome on Mac', os: 'macOS' });
  assert.deepEqual(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0'), { name: 'Edge on Windows PC', os: 'Windows' });
  assert.equal(deviceLabel(''), null);
  assert.equal(deviceLabel(null), null);
});

test('dates: a stored instant reads as its day, and a date of birth never moves a day', () => {
  assert.equal(dayLabel('2026-10-02 12:00:00'), '2 Oct 2026');
  assert.equal(dayLabel('2026-10-01T12:00:00.000Z'), '1 Oct 2026');
  // A stored instant is the reader's day: 03:00 UTC on the 2nd is the evening
  // of the 1st in Los Angeles. A bare date of birth is not an instant.
  assert.equal(dayLabel('2026-10-02 03:00:00'), '1 Oct 2026');
  assert.equal(dayLabel('1990-05-12'), '12 May 1990');
  assert.equal(dayLabel(null), null);
  assert.equal(dayLabel('not a date'), null);
});

test('money: minor units with their currency; no total is not a zero', () => {
  assert.equal(money(12600, 'eur'), '€126.00');
  assert.equal(money(3000, 'usd'), 'US$30.00');
  assert.equal(money(0, 'gbp'), '£0.00', 'a real zero total is a zero');
  assert.equal(money(null, 'eur'), null);
  assert.equal(money(undefined, 'eur'), null);
  assert.equal(money('', 'eur'), null);
});

test('history lines name the archetype when it moved and the trigger otherwise, newest first', () => {
  const lines = historyLines(HISTORY.items);
  assert.deepEqual(lines.map((l) => l.what), [
    'Archetype changed to The Missionary',
    'Profile re-scored on the scheduled run',
    'Profile first scored · The Rocketeer',
  ]);
  assert.deepEqual(lines.map((l) => l.id), [3, 2, 1]);
  const mixed = historyLines([snap(9, 'investor', 'answer', 'inv_thesis_backer', 'x'), ...HISTORY.items]);
  assert.match(mixed[0].what, /\(Investor\)$/, 'two personas: each line says whose profile moved');
  assert.deepEqual(historyLines([]), []);
});

test('the shown archetype is the newest one for the role\'s persona, with its confidence as a percentage', () => {
  assert.deepEqual(latestArchetype(HISTORY.items, 'founder'), { slug: 'fo_missionary', label: 'The Missionary', confidencePct: 82, persona: 'founder', at: '2026-10-01T12:00:00.000Z' });
  const both = [snap(9, 'investor', 'answer', 'inv_thesis_backer', 'y', 0.5), ...HISTORY.items];
  assert.equal(latestArchetype(both, 'founder').slug, 'fo_missionary', 'the founder sees the founder profile');
  assert.equal(latestArchetype(both, 'investor').slug, 'inv_thesis_backer');
  assert.equal(latestArchetype([snap(1, 'founder', 'answer', null, 'z')], 'founder'), null, 'a snapshot with no displayed archetype is not one');
  assert.equal(latestArchetype([snap(1, 'founder', 'answer', 'fo_architect', 'z', null)], 'founder').confidencePct, null);
});

test('the profile writers each get their own keys, and only changed ones', () => {
  const before = { name: 'Ana', profile_slug: 'ana', locale: 'fr', phone_e164: '', city: 'Lausanne', country: 'CH' };
  const after = { name: 'Ana Q', profile_slug: 'ana', locale: 'fr', phone_e164: '+41791234567', city: '  ', country: 'CH' };
  const patch = changedFields(before, after, Object.keys(before));
  assert.deepEqual(patch, { name: 'Ana Q', phone_e164: '+41791234567', city: null }, 'an emptied field is sent as null');
  assert.deepEqual(splitPersonalPatch({ ...patch, locale: 'en', profile_slug: 'ana-q', country: 'FR' }), {
    account: { name: 'Ana Q' },
    identity: { locale: 'en', profile_slug: 'ana-q' },
    details: { phone_e164: '+41791234567', city: null, country: 'FR' },
  });
});

test('a route refusal becomes field errors, or a form-level error when it names no field', () => {
  assert.deepEqual(fieldErrorsFrom({ message: 'x', field: 'nationality', data: { errors: { nationality: 'Use a two-letter code' } } }), { nationality: 'Use a two-letter code' });
  assert.deepEqual(fieldErrorsFrom({ message: 'Bad date', field: 'date_of_birth', data: {} }), { date_of_birth: 'Bad date' });
  assert.deepEqual(fieldErrorsFrom({ message: 'Update failed', data: {} }), { _form: 'Update failed' });
  assert.equal(corporateIsEmpty(CORP_EMPTY), true);
  assert.equal(corporateIsEmpty(CORP), false);
});

test('follows: people and startups, linked to their public profiles, sorted by name', () => {
  const rows = followRows(FOLLOWS);
  assert.deepEqual(rows.map((r) => [r.key, r.kind, r.href]), [
    ['user:11', 'person', '/u/u-zed'], ['user:12', 'person', '/u/u-amy'], ['project:5', 'company', '/startups/p-tidal'],
  ]);
  assert.equal(rows[1].sub, 'Investor', 'no headline: the role names the person');
  assert.equal(rows[2].sub, 'Climate Tech · Seed');
  assert.deepEqual(filterFollows(rows).map((r) => r.name), ['Amy Lin', 'Tidal Grid', 'Zed Okafor']);
  assert.deepEqual(filterFollows(rows, { kind: 'company' }).map((r) => r.name), ['Tidal Grid']);
  assert.deepEqual(filterFollows(rows, { query: 'operator' }).map((r) => r.name), ['Zed Okafor']);
  assert.deepEqual(followRows({}), []);
});

test('orders: the store\'s three statuses, filters by status and year, newest first', () => {
  const rows = ORDERS.orders.map(orderRow);
  assert.deepEqual(rows.map((r) => [r.ref, r.item, r.amount, r.status.label, r.year, r.paid]), [
    ['AX-1001', 'Incorporation pack', '€126.00', 'Paid', '2026', true],
    ['AX-0990', 'Expert session + 1 more', '€52.50', 'Pending', '2025', false],
    ['AX-0950', null, 'US$30.00', 'Failed', '2025', false],
  ]);
  assert.deepEqual(filterOrders(rows, { status: 'paid' }).map((r) => r.ref), ['AX-1001']);
  assert.deepEqual(filterOrders(rows, { year: '2025' }).map((r) => r.ref), ['AX-0990', 'AX-0950']);
  assert.deepEqual(filterOrders(rows, { sort: 'oldest' }).map((r) => r.ref), ['AX-0950', 'AX-0990', 'AX-1001']);
  assert.deepEqual(filterOrders(rows, { query: 'deck' }).map((r) => r.ref), [], 'search reads the first item and the reference');
  assert.deepEqual(filterOrders(rows, { query: 'ax-09' }).map((r) => r.ref), ['AX-0990', 'AX-0950']);
  assert.equal(orderRow({ ...ORDERS.orders[0], status: 'refunded' }).status.label, 'Not recorded', 'a status the store does not write is not guessed');
});

test('the plan line reads each role\'s own status route and portal', () => {
  assert.deepEqual(billingSourceFor('founder'), { status: 'tierStatus', portal: 'tierPortal', pricing: '/pricing' });
  assert.deepEqual(billingSourceFor('investor'), { status: 'investorBillingStatus', portal: 'investorPortal', pricing: '/pricing/investor' });
  assert.deepEqual(billingSourceFor('partner'), { status: 'planStatus', portal: 'tierPortal', pricing: '/pricing' });
  const f = planSummary('founder', { tier: 'growth', status: 'active', renews_at: '2026-11-01T12:00:00Z', trial_ends_at: null, has_customer: true, spinout_lab: null });
  assert.equal(f.plan, 'Founder workspace'); assert.equal(f.tier, 'Growth'); assert.equal(f.paid, true); assert.equal(f.hasCustomer, true);
  const i = planSummary('investor', { tier: 'free', raw_tier: 'professional', status: 'canceled', renews_at: null, has_customer: true, quotas: { seats: 1, seat_count: 1 } });
  assert.equal(i.tier, 'Free'); assert.equal(i.subscribedTier, 'Professional'); assert.deepEqual(i.seats, { used: 1, cap: 1 });
  const none = planSummary('admin', { plan_group: null, status: 'free', has_customer: false });
  assert.equal(none.plan, null);
  const p = planSummary('partner', { plan_group: 'partner', plan: 'partner_pro', status: 'trialing', renews_at: 'x', trial_ends_at: '2026-10-20T12:00:00Z', has_customer: true });
  assert.equal(p.plan, 'Partner'); assert.equal(p.tier, 'Pro'); assert.equal(p.status, 'trialing');
  assert.equal(planSummary('partner', { plan_group: 'advisor', status: 'free' }).tier, 'Starter');
  assert.equal(refusalText({ code: 'no_subscription', message: 'no_subscription' }), 'There is no billing account to manage yet. The portal opens once you have subscribed.');
  assert.equal(refusalText({ message: 'The billing portal could not be opened.' }), 'The billing portal could not be opened.');
});

// --- The section list --------------------------------------------------------

const SECTIONS = [
  { id: 'account', label: 'Profile and identity' }, { id: 'notifications', label: 'Notifications' },
  { id: 'security-privacy', label: 'Sign-in and security' }, { id: 'billing', label: 'Billing and orders' },
  { id: 'following', label: 'Following' }, { id: 'onboarding', label: 'Onboarding', group: 'more' },
];

test('the section list draws the canvas sections first, the kept ones under More, and marks the open one', () => {
  const markup = html(h(AccountSectionNav, { sections: SECTIONS, active: 'billing', onSelect: noop }));
  const order = [...markup.matchAll(/data-testid="account-nav-([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['account', 'notifications', 'security-privacy', 'billing', 'following', 'onboarding']);
  assert.match(markup, /aria-current="page"[^>]*data-testid="account-nav-billing"/);
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  assert.match(text(h(AccountSectionNav, { sections: SECTIONS, active: 'account', onSelect: noop })), /Following More Onboarding/);
  // The column is the lg shape; below lg the Section menu stands in for it.
  assert.match(markup, /<nav [^>]*data-testid="account-section-nav"[^>]*>\s*<div class="[^"]*\bhidden\b[^"]*\blg:block\b/);
});

// D607 (#1165) — the 2026-10-06 export's phone rule: `.op-secnav` is hidden and
// `.op-secdrop` draws one row, "Section", the open section's name and ▾. It is a
// native select under that drawing, so the phone opens its own picker.
const findEl = (el, pred) => {
  if (!el || typeof el !== 'object') return null;
  if (Array.isArray(el)) { for (const c of el) { const f = findEl(c, pred); if (f) return f; } return null; }
  return pred(el) ? el : findEl(el.props?.children, pred);
};

test('below lg the section list is one Section menu that names the open section', () => {
  const markup = html(h(AccountSectionNav, { sections: SECTIONS, active: 'billing', onSelect: noop }));
  const menu = markup.match(/<div data-testid="account-section-menu" class="([^"]*)">([\s\S]*?)<\/select><\/div>/);
  assert.ok(menu, 'no Section menu');
  assert.match(menu[1], /\blg:hidden\b/, 'the menu shows from lg too');
  assert.match(menu[1], /min-h-\[44px\]/, 'the canvas draws the row 44px tall, a touch target');
  const face = menu[2].replace(/<select[\s\S]*$/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(face, 'Section Billing and orders ▾');
  // The same sections in the same order, the kept ones under More, the open one picked.
  const opts = [...menu[2].matchAll(/<option value="([a-z-]+)"( selected="")?>/g)].map((m) => m[1] + (m[2] ? '*' : ''));
  assert.deepEqual(opts, ['account', 'notifications', 'security-privacy', 'billing*', 'following', 'onboarding']);
  assert.match(menu[2], /<optgroup label="More"><option value="onboarding">Onboarding<\/option><\/optgroup>/);
  assert.match(menu[2], /<select aria-label="Account section"/);
  // D568's sideways row of chips is gone.
  assert.doesNotMatch(markup, /overflow-x-auto/);

  // A pick opens that section, the way a click on the column does.
  const picked = [];
  const tree = AccountSectionNav({ sections: SECTIONS, active: 'billing', onSelect: (id) => picked.push(id) });
  findEl(tree, (el) => el.type === 'select').props.onChange({ target: { value: 'onboarding' } });
  assert.deepEqual(picked, ['onboarding']);

  // A section id the list does not hold names the first section, never a blank row.
  const stray = html(h(AccountSectionNav, { sections: SECTIONS, active: 'nope', onSelect: noop }));
  assert.match(stray, /Section<\/span><span class="[^"]*">Profile and identity<\/span>/);
  assert.match(stray, /<option value="account" selected="">/);
});

test('the rail is given counts and states, never the email address', () => {
  const lines = accountRailCoverage({ ...ACCOUNT, totp_recovery_codes_remaining: 1 }, 'Following');
  assert.deepEqual(lines, ['Open section: Following', 'Email verified', 'Authenticator paired', '1 recovery code left']);
  assert.ok(!lines.join(' ').includes('ana@example.com'));
  assert.deepEqual(accountRailCoverage(null), []);
});

// --- Profile and identity ----------------------------------------------------

test('Personal details: what each store holds, Not recorded where it holds nothing', () => {
  const full = text(h(PersonalDetailsCard, { account: ACCOUNT, identity: ready(IDENTITY), details: ready(DETAILS), onSave: noop }));
  assert.match(full, /Full name Ana Quintero/);
  assert.match(full, /Other members see “Ana Q\.”, your profile's display name\./);
  assert.match(full, /Username ana-q/);
  assert.match(full, /Email ana@example\.com Verified/);
  assert.match(full, /Phone •••• 1234/, 'the route serves the last four digits only');
  assert.match(full, /Location Lausanne, Switzerland/);
  assert.match(full, /Language Français/);
  const blank = text(h(PersonalDetailsCard, { account: { ...ACCOUNT, email_verified: false }, identity: ready(IDENTITY_BLANK), details: ready(DETAILS_BLANK), onSave: noop }));
  assert.match(blank, /Username Not recorded/);
  assert.match(blank, /Phone Not recorded/);
  assert.match(blank, /Location Not recorded/);
  assert.match(blank, /Language Not recorded/);
  assert.match(blank, /Unverified/);
  assert.doesNotMatch(blank, /Other members see/);
});

test('Personal details: a read in flight draws a skeleton, a failed one says Unreadable and editing waits', () => {
  const waiting = html(h(PersonalDetailsCard, { account: ACCOUNT, identity: loading(), details: ready(DETAILS), onSave: noop }));
  assert.match(waiting, /motion-safe:animate-pulse/);
  assert.match(waiting, /data-testid="button-edit-personal"[^>]*disabled=""|disabled=""[^>]*data-testid="button-edit-personal"/);
  const failed = text(h(PersonalDetailsCard, { account: ACCOUNT, identity: unreadable('Settings store unavailable'), details: ready(DETAILS), onSave: noop }));
  assert.match(failed, /Username Unreadable/);
  assert.match(failed, /Your username and language could not be read\. Settings store unavailable/);
  assert.doesNotMatch(failed, /Username Not recorded/, 'a failed read is not an empty one');
  assert.match(failed, /Phone •••• 1234/, 'the other store still answers');
});

test('Identity: legal name, a birth date that does not shift a day, and countries by name', () => {
  const t = text(h(IdentityCard, { identity: ready(IDENTITY), details: ready(DETAILS), onSave: noop }));
  assert.match(t, /Used by Trust Center/);
  assert.match(t, /Legal name Ana Maria Quintero/);
  assert.match(t, /Date of birth 12 May 1990/);
  assert.match(t, /Nationality Switzerland/);
  assert.match(t, /Tax residence Switzerland/);
  const none = text(h(IdentityCard, { identity: ready(IDENTITY_BLANK), details: ready(DETAILS_BLANK), onSave: noop }));
  assert.match(none, /Legal name Not recorded Date of birth Not recorded Nationality Not recorded Tax residence Not recorded/);
});

test('Company profile: empty, filled, loading and unreadable are four different cards', () => {
  const empty = html(h(CompanyProfileCard, { corporate: ready(CORP_EMPTY), onSave: noop }));
  assert.match(empty, /data-testid="company-profile-empty"/);
  assert.match(text(h(CompanyProfileCard, { corporate: ready(CORP_EMPTY), onSave: noop })), /No company profile yet\. Add one if you represent a company\. Add company profile/);
  assert.doesNotMatch(empty, /button-edit-company/, 'nothing to edit until one is added');
  const filled = text(h(CompanyProfileCard, { corporate: ready(CORP), onSave: noop }));
  assert.match(filled, /Company Quintero Labs SA Role CEO Registration CHE-123\.456\.789 Country Switzerland/);
  assert.match(html(h(CompanyProfileCard, { corporate: ready(CORP), onSave: noop })), /data-testid="button-edit-company"/);
  assert.match(html(h(CompanyProfileCard, { corporate: loading(), onSave: noop })), /data-testid="account-loading"/);
  const bad = text(h(CompanyProfileCard, { corporate: unreadable(''), onSave: noop }));
  assert.match(bad, /Your company profile could not be read\. This is not a claim that you have none\./);
  assert.doesNotMatch(bad, /No company profile yet/);
});

test('Public archetype: the archetype, its confidence and the publish switch; or why there is none', () => {
  const on = html(h(PublicArchetypeCard, { role: 'founder', history: ready(HISTORY), published: ready({ published: true }), onToggle: noop }));
  assert.match(text(h(PublicArchetypeCard, { role: 'founder', history: ready(HISTORY), published: ready({ published: true }), onToggle: noop })), /The Missionary 82% Published on my profile/);
  assert.match(on, /role="switch" aria-checked="true"/);
  const off = text(h(PublicArchetypeCard, { role: 'founder', history: ready(HISTORY), published: ready({ published: false }), onToggle: noop }));
  assert.match(off, /Not shown on my profile/);
  const none = text(h(PublicArchetypeCard, { role: 'founder', history: ready({ items: [] }), published: ready({ published: false }), onToggle: noop }));
  assert.match(none, /Not recorded · no archetype has been scored from your answers yet\. Answer the profiling questions in Studio/);
  const noConsent = html(h(PublicArchetypeCard, { role: 'founder', history: ready(HISTORY), published: unreadable('down'), onToggle: noop }));
  assert.doesNotMatch(noConsent, /role="switch"/, 'no switch over a consent that could not be read');
  assert.match(noConsent, /Whether your archetype is published could not be read/);
  assert.match(text(h(PublicArchetypeCard, { role: 'founder', history: unreadable(''), published: ready({ published: true }), onToggle: noop })), /Your profile could not be read\. This is not a claim that you have no archetype\./);
});

test('Change history: one dated line per snapshot, an empty history, a failed one, and Ask me again', () => {
  const t = text(h(ChangeHistoryCard, { history: ready(HISTORY) }));
  // en-GB spells September "Sept" in current ICU and "Sep" in older ones.
  assert.match(t, /1 Oct 2026 Archetype changed to The Missionary 3 Sept? 2026 Profile re-scored on the scheduled run 14 Jul 2026 Profile first scored · The Rocketeer/);
  assert.match(t, /Ask me again/);
  assert.match(t, /“Ask me again” lists the answers old enough to be asked again\. Studio asks them; nothing changes from here\./);
  assert.match(text(h(ChangeHistoryCard, { history: ready({ items: [] }) })), /No change to your profile has been recorded yet\./);
  const bad = text(h(ChangeHistoryCard, { history: unreadable('Your profile history could not be read. Try again in a moment.') }));
  assert.match(bad, /Your profile history could not be read\. Your profile history could not be read\. Try again in a moment\./);
  assert.doesNotMatch(bad, /No change to your profile/);
  assert.match(html(h(ChangeHistoryCard, { history: loading() })), /data-testid="account-loading"/);
});

test('the profile section renders every card in its loading state before any read lands', () => {
  const markup = html(h(ProfileIdentityCanvas, { data: ACCOUNT, onAccountChange: noop, onSaved: noop }));
  for (const id of ['card-personal-details', 'card-identity', 'card-company-profile', 'card-public-archetype', 'card-change-history']) {
    assert.match(markup, new RegExp(`data-testid="${id}"`), `${id} is drawn`);
  }
  assert.match(markup, /@container/, 'the two-column grids are sized by the pane, not the window');
  assert.match(markup, /@2xl:grid-cols-2/);
});

// --- Notifications: push devices ---------------------------------------------

test('push devices: named from the user agent; a device no push has reached says so', () => {
  const push = { supported: true, subscribed: true, permission: 'granted' };
  const t = text(h(PushDevicesCard, { subs: ready(SUBS), push, busy: false, outcome: null, confirming: false }));
  assert.match(t, /2 registered/);
  assert.match(t, /Safari on iPhone · iOS 17\.4 last push delivered 1 Oct 2026 · registered 12 Sept? 2026/);
  assert.match(t, /Chrome on Android phone · Android 14 Not recorded · no push delivered yet · registered 20 Sept? 2026/);
  assert.match(t, /The last push failed: HTTP 410 from the push service/);
  assert.match(t, /This browser receives push\. Remove/);
  assert.match(t, /A device other than this one is removed from that device/);
});

test('push devices: removing this browser is confirmed first; a browser off push can turn it on', () => {
  const push = { supported: true, subscribed: true, permission: 'granted' };
  const ask = html(h(PushDevicesCard, { subs: ready(SUBS), push, busy: false, outcome: null, confirming: false }));
  assert.match(ask, /data-testid="button-push-remove"/);
  assert.doesNotMatch(ask, /button-push-remove-confirm/);
  const confirm = text(h(PushDevicesCard, { subs: ready(SUBS), push, busy: false, outcome: null, confirming: true }));
  assert.match(confirm, /Stop push on this browser\? Notifications still reach your inbox\. Cancel Remove this browser/);
  const off = html(h(PushDevicesCard, { subs: ready(SUBS), push: { supported: true, subscribed: false, permission: 'default' }, busy: false, outcome: null, confirming: false }));
  assert.match(off, /data-testid="button-push-enable"/);
  assert.match(text(h(PushDevicesCard, { subs: ready(SUBS), push: { supported: true, subscribed: false, permission: 'denied' } })), /Push is blocked in this browser’s settings/);
  assert.match(text(h(PushDevicesCard, { subs: ready(SUBS), push: { supported: false, subscribed: false } })), /This browser cannot receive push\./);
  const unknown = text(h(PushDevicesCard, { subs: ready(SUBS), push: { unknown: true } }));
  assert.match(unknown, /Whether this browser receives push could not be read\./, 'an unanswered check is not "cannot receive push"');
  assert.doesNotMatch(unknown, /cannot receive push|Turn on push here/);
});

test('push devices: empty, unreadable and loading', () => {
  const push = { supported: true, subscribed: false, permission: 'default' };
  assert.match(html(h(PushDevicesCard, { subs: ready({ subscriptions: [] }), push })), /data-testid="push-devices-empty"/);
  assert.match(text(h(PushDevicesCard, { subs: ready({ subscriptions: [] }), push })), /No device is registered for push\./);
  const bad = text(h(PushDevicesCard, { subs: unreadable('Your push subscriptions could not be read right now. Try again in a moment.'), push }));
  assert.match(bad, /Your push devices could not be read\. Your push subscriptions could not be read right now/);
  assert.doesNotMatch(bad, /No device is registered/);
  assert.match(html(h(PushDevicesCard, { subs: loading(), push: null })), /data-testid="account-loading"/);
});

// --- Sign-in and security: sessions -----------------------------------------

test('sessions: the count the route serves, the two settings no route stores, and a confirmed sign-out', () => {
  const t = text(h(SessionsCard, { security: ready(SECURITY) }));
  assert.match(t, /Session length Not recorded/);
  assert.match(t, /New-device alerts Not recorded/);
  assert.match(t, /Active sessions 3 active/);
  assert.match(t, /Signs you out on every device, including this one\. Sign out everywhere/);
  const markup = html(h(SessionsCard, { security: ready(SECURITY) }));
  assert.match(markup, /title="no session length is stored per account; every session has the platform&#x27;s one length"/);
  assert.match(markup, /title="no alert setting is stored, and no new-device alert is sent yet"/);
  assert.match(markup, /data-testid="button-sign-out-everywhere"/);
  assert.doesNotMatch(markup, /button-sign-out-everywhere-confirm/, 'one click asks; it does not sign out');
  const bad = text(h(SessionsCard, { security: unreadable('') }));
  assert.match(bad, /Active sessions Unreadable/);
  assert.match(bad, /This is not a claim that you have no sessions\./);
  assert.doesNotMatch(bad, /0 active/);
});

// --- Billing and orders ------------------------------------------------------

test('the plan line: tier, seats, renewal; Not recorded for a paid plan with no renewal date', () => {
  const founder = text(h(PlanHeader, { role: 'founder', billing: ready({ tier: 'growth', status: 'active', renews_at: '2026-11-01T12:00:00Z', trial_ends_at: null, has_customer: true, spinout_lab: null }) }));
  assert.match(founder, /Founder workspace Growth renews 1 Nov 2026/);
  assert.match(founder, /Plans & Pricing Manage billing ↗/);
  const inst = text(h(PlanHeader, { role: 'investor', billing: ready({ tier: 'institutional', raw_tier: 'institutional', status: 'active', renews_at: null, trial_ends_at: null, has_customer: true, quotas: { seats: 4, seat_count: 2 } }) }));
  assert.match(inst, /Investor Institutional 2 of 4 seats · renewal not recorded/);
  assert.match(html(h(PlanHeader, { role: 'investor', billing: ready({ tier: 'institutional', status: 'active', renews_at: null, has_customer: true, quotas: {} }) })), /title="this plan has no renewal date recorded"/);
  assert.match(html(h(PlanHeader, { role: 'investor', billing: ready({ tier: 'free', status: 'free', has_customer: false, quotas: {} }) })), /href="\/pricing\/investor"/);
  const lapsed = text(h(PlanHeader, { role: 'investor', billing: ready({ tier: 'free', raw_tier: 'professional', status: 'canceled', renews_at: null, has_customer: true, quotas: { seats: 1, seat_count: 1 } }) }));
  assert.match(lapsed, /Investor Free Cancelled subscribed as Professional, Free applies · 1 of 1 seat · free plan, nothing renews/);
  const trial = text(h(PlanHeader, { role: 'partner', billing: ready({ plan_group: 'partner', plan: 'partner_pro', status: 'trialing', renews_at: '2026-10-20T12:00:00Z', trial_ends_at: '2026-10-20T12:00:00Z', has_customer: true }) }));
  assert.match(trial, /Partner Pro Trial trial ends 20 Oct 2026/);
});

test('the plan line: no plan, no billing account, loading and unreadable', () => {
  const none = html(h(PlanHeader, { role: 'admin', billing: ready({ plan_group: null, status: 'free', has_customer: false }) }));
  assert.match(text(h(PlanHeader, { role: 'admin', billing: ready({ plan_group: null, status: 'free', has_customer: false }) })), /No subscription plan applies to this account\./);
  assert.match(none, /disabled=""[^>]*data-testid="button-manage-billing"|data-testid="button-manage-billing"[^>]*disabled=""/, 'no billing account: nothing for the portal to open');
  assert.match(text(h(PlanHeader, { role: 'admin', billing: ready({ plan_group: null, status: 'free', has_customer: false }) })), /Manage billing opens once you have a billing account\./);
  const live = html(h(PlanHeader, { role: 'founder', billing: ready({ tier: 'growth', status: 'active', renews_at: '2026-11-01T12:00:00Z', has_customer: true }) }));
  assert.doesNotMatch(live, /disabled=""[^>]*data-testid="button-manage-billing"|data-testid="button-manage-billing"[^>]*disabled=""/);
  assert.match(html(h(PlanHeader, { role: 'founder', billing: loading() })), /data-testid="account-loading"/);
  const bad = text(h(PlanHeader, { role: 'founder', billing: unreadable('') }));
  assert.match(bad, /Your plan could not be read\. This is not a claim that you have no plan\./);
  assert.doesNotMatch(bad, /Free/);
});

test('orders: the list in the store\'s shape, an invoice only on a paid order, and the three other states', () => {
  const markup = html(h(OrdersCard, { orders: ready(ORDERS) }));
  const t = text(h(OrdersCard, { orders: ready(ORDERS) }));
  assert.match(t, /3 of 3/);
  assert.match(t, /2 Oct 2026 Incorporation pack €126\.00 Paid Invoice/);
  assert.match(t, /12 Dec 2025 Expert session \+ 1 more €52\.50 Pending/);
  assert.match(t, /1 Nov 2025 Not recorded US\$30\.00 Failed/);
  assert.match(markup, /data-testid="button-invoice-AX-1001"/);
  assert.doesNotMatch(markup, /button-invoice-AX-0990|button-invoice-AX-0950/);
  assert.match(markup, /data-testid="chip-order-paid"/);
  assert.doesNotMatch(t, /Refunded/, 'the store has no refunded state');
  assert.match(text(h(OrdersCard, { orders: ready({ orders: [] }) })), /No orders yet\./);
  const bad = text(h(OrdersCard, { orders: unreadable('') }));
  assert.match(bad, /Your orders could not be read\. This is not a claim that you have bought nothing\./);
  assert.match(html(h(OrdersCard, { orders: loading() })), /data-testid="account-loading"/);
});

// --- Following ---------------------------------------------------------------

test('following: people and companies with Unfollow on the row; the follow date is Not recorded', () => {
  const props = { follows: ready(FOLLOWS), query: '', kind: 'all', onQuery: noop, onKind: noop, onUnfollow: noop, onUndo: noop };
  const markup = html(h(FollowingList, props));
  const t = text(h(FollowingList, props));
  assert.match(t, /3 of 3/);
  assert.match(t, /Amy Lin Person since not recorded Investor/);
  assert.match(t, /Tidal Grid Company since not recorded Climate Tech · Seed/);
  assert.match(markup, /href="\/u\/u-zed"/);
  assert.match(markup, /href="\/startups\/p-tidal"/);
  assert.match(markup, /data-testid="button-unfollow-user:11"/);
  assert.match(markup, /title="the follow list does not return when you followed"/);
  assert.match(t, /Sorted by name\. The date of each follow is not recorded/);
  const gone = text(h(FollowingList, { ...props, removed: { 'user:11': true } }));
  assert.match(gone, /Zed Okafor .* Unfollowed Undo/);
  assert.match(text(h(FollowingList, { ...props, kind: 'company' })), /1 of 3/);
});

test('following: empty, unreadable and loading', () => {
  const base = { query: '', kind: 'all', onQuery: noop, onKind: noop, onUnfollow: noop, onUndo: noop };
  assert.match(text(h(FollowingList, { ...base, follows: ready({ users: [], projects: [] }) })), /You follow nobody yet\..*Browse the directory/);
  const bad = text(h(FollowingList, { ...base, follows: unreadable('') }));
  assert.match(bad, /Who you follow could not be read\. This is not a claim that you follow nobody\./);
  assert.doesNotMatch(bad, /You follow nobody yet/);
  assert.match(html(h(FollowingList, { ...base, follows: loading() })), /data-testid="account-loading"/);
});

// --- Developer ---------------------------------------------------------------

test('developer: hidden from every role the routes refuse', () => {
  assert.equal(html(h(DeveloperSection, { role: 'founder' })), '');
  assert.equal(html(h(DeveloperSection, { role: 'investor' })), '');
  assert.match(html(h(DeveloperSection, { role: 'admin' })), /data-testid="account-developer"/, 'drawn for an admin, loading');
});

test('developer: flags, the account row, and Not recorded for what no store holds', () => {
  const dev = ready({ feature_flags: { beta_board: true, new_rail: false }, raw_user: { id: 1, uid: 'abc', email: 'root@example.com', name: 'Root', role: 'admin', email_verified: 1, kyc_status: 'approved', created_at: '2026-01-05 12:00:00', last_active_at: null } });
  const props = { dev, onToggleFlag: noop, flagBusy: false, flagOutcome: null, onResync: noop, resync: { busy: false, outcome: null, requestedAt: null } };
  const t = text(h(DeveloperPanel, props));
  const markup = html(h(DeveloperPanel, props));
  assert.match(t, /API key Not recorded · there is no key store yet; the API tier \(T20\) has not shipped\./);
  assert.match(t, /Webhook URL Not recorded/);
  assert.match(t, /Rate limit Not recorded/);
  assert.match(t, /2 stored/);
  assert.match(markup, /data-testid="switch-flag-beta_board"/);
  assert.match(markup, /role="switch" aria-checked="true"[^>]*data-testid="switch-flag-beta_board"/);
  assert.match(t, /Email verified Yes/);
  assert.match(t, /Created 5 Jan 2026/);
  assert.match(t, /Last active Not recorded/);
  assert.match(t, /last run not recorded/);
  assert.match(t, /No part of the product reads these flags yet/);
  const empty = text(h(DeveloperPanel, { ...props, dev: ready({ feature_flags: {}, raw_user: null }) }));
  assert.match(empty, /No feature flags are stored on your account\./);
  const bad = text(h(DeveloperPanel, { ...props, dev: unreadable('') }));
  assert.match(bad, /Your developer settings could not be read\. This is not a claim that none is set\./);
  // The page's own clock, read in the reader's zone: built from local parts so
  // the run passes in any time zone.
  const requested = text(h(DeveloperPanel, { ...props, resync: { busy: false, requestedAt: new Date(2026, 9, 6, 9, 41), outcome: { tone: 'ok', text: 'Re-sync request logged. The next scheduled cron will pick this up.' } } }));
  assert.match(requested, /requested from this page at 09:41/);
  assert.match(requested, /Re-sync request logged\. The next scheduled cron will pick this up\./);
});

// --- Wiring: the page, the route, and the Worker routes behind each method ---

test('SettingsPage lists the canvas sections in its order, and mounts each section', () => {
  const page = read('frontend/src/pages/SettingsPage.jsx');
  const block = page.slice(page.indexOf('const SECTIONS = ['), page.indexOf('];', page.indexOf('const SECTIONS = [')));
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 6), ['Profile and identity', 'Notifications', 'Sign-in and security', 'Billing and orders', 'Following', 'Developer']);
  assert.match(block, /\{ id: 'developer', label: 'Developer', roles: \['admin'\] \}/);
  for (const id of ['onboarding', 'integrations', 'appearance', 'activity']) {
    assert.match(block, new RegExp(`\\{ id: '${id}', label: '[^']+', group: 'more' \\}`), `${id} is kept, under More`);
  }
  for (const [path, id] of [['following', 'following'], ['developer', 'developer'], ["'sign-in'", 'security-privacy'], ['orders', 'billing'], ['activity', 'activity']]) {
    assert.match(page, new RegExp(`\\n  ${path.replace(/[-']/g, (c) => (c === '-' ? '\\-' : "'"))}: '${id}',`), `${path} resolves to ${id}`);
  }
  for (const mount of ['<AccountSectionNav ', '<ProfileIdentityCanvas', '<PushDevices />', '<SessionsCard security={security} />', '<PlanHeader role={role} billing={billing} />', '<Orders />', '<FollowingSection />', '<DeveloperSection role={data.role} />']) {
    assert.ok(page.includes(mount), `${mount} is mounted`);
  }
  assert.match(page, /<ProfileTabs key=\{profileRev\}/, 'the editors below the profile cards remount after a card saves');
  assert.doesNotMatch(page, /function SectionDropdown/);
});

test('the notification matrix reads its own route, says when it cannot, and puts a refused write back', () => {
  // SettingsPage.jsx cannot be imported under node (lib/stripe.js reads
  // import.meta.env at load), so the matrix is pinned in its source, as D333's
  // tests pin its locks.
  const page = read('frontend/src/pages/SettingsPage.jsx');
  const m = page.slice(page.indexOf('function NotificationsSection('), page.indexOf('// Task #55 — per-role public-profile field map'));
  assert.ok(m.length > 2000, 'could not read NotificationsSection');
  assert.match(m, /const read = useAccountRead\(\(\) => api\.getNotificationPrefs\(\)\);/);
  assert.match(m, /const prefs = written \|\| served;/, 'drawn from what the route served until this page writes');
  assert.match(m, /if \(read\.status === 'loading'\) \{\s*return <Card title="Notifications"[^>]*><Skeleton\.Text lines=\{5\} \/><\/Card>;/);
  assert.match(m, /if \(read\.status === 'unreadable'\) \{[\s\S]{0,200}<Unreadable what="Your notification settings" claim=\{read\.message \|\| 'This is not a claim that any switch is on or off\.'\}/);
  assert.match(m, /await api\.putNotificationPrefs\(next\);[\s\S]{0,200}\} catch \(e\) \{\s*setPrefs\(before\);/, 'a refused write puts the switches back');
  assert.match(m, /\{channelOn\(prefs, ev\.key, 'in_app'\) \? 'On' : 'Off'\}/, 'push follows in-app');
  assert.match(m, /NOTIFICATION_CHANNELS\.filter\(\(c\) => c\.key !== 'slack' \|\| slackConnected\)/);
  const channels = page.slice(page.indexOf('const NOTIFICATION_CHANNELS = ['), page.indexOf('];', page.indexOf('const NOTIFICATION_CHANNELS = [')));
  assert.deepEqual([...channels.matchAll(/key: '([a-z_]+)'/g)].map((x) => x[1]), ['in_app', 'email', 'slack'], 'the canvas order, and no SMS column notify.ts cannot send');
  const notify = read('cloudflare-worker/src/services/notify.ts');
  assert.match(notify, /export type NotifyChannel = 'in_app' \| 'email' \| 'slack';/);
});

test('the Worker AI rail sits beside the page, in the shared frame (D556), with a literal accent', () => {
  const page = read('frontend/src/pages/SettingsPage.jsx');
  const rail = page.slice(page.indexOf('<WorkerRail'), page.indexOf('/>', page.indexOf('<WorkerRail')));
  assert.match(rail, /workspace="Account"/);
  assert.match(rail, /role="founder"/);
  assert.match(rail, /coverage=\{accountRailCoverage\(data, activeLabel\)\}/);
  // RailFrame docks it to the edge and collapses it through --fwr-track.
  assert.match(page, /<RailFrame\s+rail=\{\(\s*<WorkerRail\s+workspace="Account"/);
  assert.doesNotMatch(page, /grid-cols-\[minmax\(0,1fr\)_var\(--fwr-track/, 'no bare rail column beside the frame');
  // The voice rule, on the copy this page hands the rail.
  assert.doesNotMatch(rail, /advis|recommend|fiduciary/i);
});

test('the sign-in pane uses the signed-in enrolment routes, never the login-flow ones', () => {
  // /auth/setup-totp needs the one-shot email verification token and
  // /auth/sms/verify-challenge mints a NEW session; neither belongs on a page
  // the reader is already signed in to. Enrolment is /settings/totp/enrol/*
  // (TotpEnrollment) and /auth/sms/{start,confirm}-enrollment (SmsPanel).
  const page = read('frontend/src/pages/SettingsPage.jsx');
  assert.doesNotMatch(page, /api\.(setupTotp|verifyTotp|smsStartChallenge|smsVerifyChallenge|authFactors)\(/);
  assert.match(page, /<TotpEnrollment/);
  assert.match(page, /api\.smsStartEnrollment\(phone, country, null\)/);
  const auth = read('cloudflare-worker/src/routes/auth.ts');
  assert.match(auth, /if \(user\.verification_token !== tokenHash\) \{ await sql\.end\(\); return c\.json\(\{ error: 'Invalid setup token\.' \}, 403\); \}/);
  const sms = read('cloudflare-worker/src/routes/auth_sms.ts');
  assert.match(sms, /\/\/ -------- login challenge \(unauthenticated; mirrors \/login\)/);
  // One sign-out-everywhere control, confirmed in place.
  assert.equal((page.match(/Sign out everywhere/g) || []).length, 2, 'the card that holds it and the sessions card that points to it');
  assert.doesNotMatch(page, /api\.revokeAllSessions\(/);
});

test('App.jsx gates /account/developer the way its route does', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/account\/developer" element=\{guard\(\['admin'\], <SettingsPage \/>\)\} \/>/);
  assert.ok(app.indexOf('path="/account/developer"') < app.indexOf('path="/account/:section"'));
  const settings = read('cloudflare-worker/src/routes/settings.ts');
  const dev = settings.slice(settings.indexOf("settings.get('/developer'"), settings.indexOf("settings.put('/developer'"));
  assert.match(dev, /if \(\(user\.role \|\| ''\)\.toLowerCase\(\) !== 'admin'\) return c\.json\(\{ error: 'Admin role required' \}, 403\);/);
});

test('each fixture field is one the route serves', () => {
  const settings = read('cloudflare-worker/src/routes/settings.ts');
  for (const k of ['display_name', 'profile_slug', 'locale', 'full_legal_name', 'date_of_birth', 'nationality']) {
    assert.match(settings.slice(settings.indexOf('function pickIdentity('), settings.indexOf('function pickDetails(')), new RegExp(`${k}:`));
  }
  for (const k of ['tax_residency_country', 'phone_last4', 'has_phone', 'city', 'country']) {
    assert.match(settings.slice(settings.indexOf('function pickDetails('), settings.indexOf("settings.get('/profile/identity'")), new RegExp(`${k}:`));
  }
  const security = settings.slice(settings.indexOf("settings.get('/security'"), settings.indexOf("settings.get('/integrations'"));
  for (const k of ['active_sessions', 'sms_configured', 'sms_last4', 'sms_country']) assert.match(security, new RegExp(`${k}:`));
  assert.match(settings, /settings\.get\('\/profile\/corporate'[\s\S]{0,200}getCorporateProfile\(c\.env, user\.id\)/);
  const corp = read('cloudflare-worker/src/services/profileExpansion.ts');
  for (const k of ['entity_name', 'signing_authority_title', 'registration_number', 'registered_country', 'updated_at']) {
    assert.match(corp, new RegExp(`\\n  ${k}: string \\| null;`));
  }
  const history = read('cloudflare-worker/src/services/profileHistory.ts');
  assert.match(history, /ORDER BY id DESC/, 'newest first');
  for (const k of ['displayed_slug', 'confidence', 'computed_at', 'trigger']) assert.match(history.slice(history.indexOf('export interface SnapshotRow')), new RegExp(`\\n  ${k}: `));
  assert.match(read('cloudflare-worker/src/services/profileEvolution.ts'), /return \{ reask_after_days: PROFILE_V2_PARAMS\.reask_after_days, count: due\.size, items \};/);
  assert.match(read('cloudflare-worker/src/routes/notifications.ts'), /SELECT id, user_agent, created_at, last_sent_at, last_error\s+FROM push_subscriptions WHERE user_id = \?/);
  const follows = read('cloudflare-worker/src/routes/follows.ts');
  assert.match(follows, /id: u\.id, handle: u\.uid,/);
  assert.match(follows, /projects\.push\(\{ id: p\.id, handle: p\.uid, name: p\.name, sector: p\.sector, stage: p\.stage \}\);/);
  assert.match(follows, /return c\.json\(\{ users, projects \}\);/, 'the follow date is selected but not returned');
  const orders = read('cloudflare-worker/src/services/orders.ts');
  assert.match(orders, /export type OrderStatus = 'pending' \| 'paid' \| 'failed';/);
  assert.match(orders, /total: row\.total_cents,/);
  const billing = read('cloudflare-worker/src/routes/billing.ts');
  assert.match(billing, /if \(!user\.stripe_customer_id\) return c\.json\(\{ error: 'no_subscription' \}, 400\);/);
  assert.match(billing, /return c\.json\(\{ plan_group: null, status: 'free', has_customer: !!user\.stripe_customer_id \}\);/);
});

test('every method the sections call reaches the route it was read against', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { api } = await import('../src/lib/api.js');
    await api.getIdentitySettings();
    await api.updateIdentitySettings({ locale: 'en' });
    await api.getProfileDetails();
    await api.updateProfileDetails({ city: 'Bern' });
    await api.getCorporateProfile();
    await api.updateCorporateProfile({ entity_name: 'X SA' });
    await api.profileHistory();
    await api.profileReask();
    await api.archetypePublished();
    await api.setArchetypePublished(true);
    await api.getNotificationPrefs();
    await api.putNotificationPrefs({ deal_assigned: { email: false } });
    await api.pushSubscriptions();
    await api.getSecuritySettings();
    await api.signOutEverywhere();
    await api.tierStatus();
    await api.investorBillingStatus();
    await api.planStatus();
    await api.tierPortal();
    await api.investorPortal();
    await api.myOrders();
    await api.followsMine();
    await api.unfollow('user', 11);
    await api.follow('project', 5);
    await api.getDeveloperSettings();
    await api.updateDeveloperSettings({ feature_flags: { a: true } });
    await api.resyncDeveloperIndices();
    await api.updateSettings({ name: 'Ana' });
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map(([m, u]) => [m, u]), [
    ['GET', '/settings/profile/identity'], ['PUT', '/settings/profile/identity'],
    ['GET', '/settings/profile/details'], ['PUT', '/settings/profile/details'],
    ['GET', '/settings/profile/corporate'], ['PUT', '/settings/profile/corporate'],
    ['GET', '/profile/history'], ['GET', '/profile/reask'],
    ['GET', '/profile/archetype-published'], ['PUT', '/profile/archetype-published'],
    ['GET', '/notifications/prefs'], ['PUT', '/notifications/prefs'],
    ['GET', '/notifications/push/subscriptions'],
    ['GET', '/settings/security'], ['POST', '/auth/sign-out-everywhere'],
    ['GET', '/billing/tier/status'], ['GET', '/billing/investor/status'], ['GET', '/billing/plan/status'],
    ['POST', '/billing/tier/portal'], ['POST', '/billing/investor/portal'],
    ['GET', '/orders/mine'], ['GET', '/follows/mine'], ['DELETE', '/follows'], ['POST', '/follows'],
    ['GET', '/settings/developer'], ['PUT', '/settings/developer'], ['POST', '/settings/developer/resync-indices'],
    ['PATCH', '/settings'],
  ]);
  const body = (i) => JSON.parse(calls[i][2]);
  assert.deepEqual(body(9), { published: true });
  assert.deepEqual(body(11), { prefs: { deal_assigned: { email: false } } });
  assert.deepEqual(body(22), { entity_type: 'user', entity_id: 11 });
  // And the Worker mounts each of those paths.
  const index = read('cloudflare-worker/src/index.ts');
  for (const mount of ["app.route('/api/profile', profileHistoryRoutes)"]) assert.ok(index.includes(mount), mount);
});
