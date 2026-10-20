/**
 * D700 (#1662) — the account menu's pages on a phone, and `/account` as a
 * tappable index of its sections, drawn to `Account Menu · Mobile.dc.html` (AM)
 * and `Account Mobile Page.dc.html` (AMP), boards A1m–A10m.
 *
 * PR 1 held the A1m index and its two reads' lines, the `/account` address
 * rules, the end of D607's phone select, the founder plan's one name, the
 * A1m–A3m bars against the canvas, Usage's Not recorded storage line, and that
 * no phone read gains a company. PR 2 adds A4m–A10m: the seven bars against
 * the canvas (now read from `design/canvases/integrated/`), the member routes,
 * the calendar's Not recorded duration, decision 10's departures and the bar's
 * Eadwyn button. `usePhoneWidth()` answers false in a
 * server render (D699), so each page's phone view is rendered directly with
 * its reads handed in, and the default export stands for the desktop.
 *
 * SettingsPage.jsx cannot be imported under node (lib/stripe.js reads
 * import.meta.env at load), so the frame it draws on a phone lives in
 * `AccountCenter.jsx` and is rendered here, and SettingsPage is read as source.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_phone_d700.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  ACCOUNT_PHONE_PAGES, FOLLOWING_FALLBACK, NO_PLAN, PATH_TO_SECTION, PLAN_FALLBACK,
  accountPathFor, accountViewFor, followingLine, planLine,
} from '../src/pages/account/accountPhone.js';
import { AccountPhoneFrame, AccountPhoneIndex, AccountSectionNav } from '../src/pages/account/AccountCenter.jsx';
import UsageSection, { UsagePhoneView, storageGroup } from '../src/pages/account/AccountUsage.jsx';
import { ConnectorsPhoneView, ConnectorsView } from '../src/pages/account/AccountConnectors.jsx';
import { buildCatalogue } from '../src/pages/account/connectorsModel.js';
import { planSummary } from '../src/pages/account/accountCenterModel.js';
import { PhoneRows } from '../src/ui/phone/PhoneRows.jsx';
import { existsSync } from 'node:fs';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { escapeRe } from './_escapeRe.mjs';
import { __resetEadwynPanelForTest, useEadwynPanel, useEadwynRailServes } from '../src/ui/eadwynPanel.js';
import TrustCenterPage, { TrustPhoneView } from '../src/pages/TrustCenterPage.jsx';
import PerksPage, { PerksPhoneView } from '../src/pages/PerksPage.jsx';
import CalendarPage, { CalendarPhoneView, NO_END_REASON } from '../src/pages/CalendarPage.jsx';
import MyEventsPage, { EventsPhoneView } from '../src/pages/events/MyEventsPage.jsx';
import LearningHome, { LearningPhoneView } from '../src/pages/learning/LearningHome.jsx';
import { COMING_SOON_LINE } from '../src/pages/learning/learningAccess.js';
import { TAB_NOT_LIVE } from '../src/pages/learning/learningModel.js';
import { HelpPhoneView } from '../src/pages/docs/DocsLayout.jsx';
import { helpAreas } from '../src/pages/docs/guidePlacement.js';
import { SECTIONS as HELP_SECTIONS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { PricingPhoneView, TOKENS_LINE } from '../src/pages/account/PricingPhone.jsx';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el, entry = '/account') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const noop = () => {};
const ready = (data) => ({ status: 'ready', data, message: '', reload: noop, set: noop });
const LOADING = { status: 'loading', data: null, message: '', reload: noop, set: noop };
const UNREADABLE = { status: 'unreadable', data: null, message: 'The store is down.', reload: noop, set: noop };

// --- The canvas, parsed rather than retyped --------------------------------

const CANVAS = read('design/canvases/integrated/Account Mobile Page.dc.html');
const PAGES_BLOCK = (() => {
  const a = CANVAS.indexOf('const PAGES = {');
  const b = CANVAS.indexOf('const d = PAGES[page]', a);
  assert.ok(a > 0 && b > a, 'the canvas PAGES table moved — the markers no longer bound it');
  return CANVAS.slice(a, b);
})();
const CANVAS_PAGES = (() => {
  const heads = [...PAGES_BLOCK.matchAll(/^ {6}(\w+): \['([^']*)', '([^']*)', \[$/gm)];
  return Object.fromEntries(heads.map((m, i) => {
    const chunk = PAGES_BLOCK.slice(m.index, heads[i + 1]?.index ?? PAGES_BLOCK.length);
    return [m[1], { title: m[2], sub: m[3], sections: [...chunk.matchAll(/\bS\('([^']+)'/g)].map((s) => s[1]), chunk }];
  }));
})();

test('the canvas was parsed, ten boards, so a silent zero-match cannot pass', () => {
  assert.deepEqual(Object.keys(CANVAS_PAGES), ['account', 'usage', 'connectors', 'trust', 'perks', 'calendar', 'events', 'learning', 'help', 'pricing']);
  assert.ok(Object.values(CANVAS_PAGES).every((p) => p.sections.length >= 2));
});

test('ACCOUNT_PHONE_PAGES is the canvas, byte for byte: title, sub and section titles for all ten boards', () => {
  assert.deepEqual(Object.keys(ACCOUNT_PHONE_PAGES), Object.keys(CANVAS_PAGES));
  for (const [key, c] of Object.entries(CANVAS_PAGES)) {
    const p = ACCOUNT_PHONE_PAGES[key];
    assert.equal(p.title, c.title, `${key} title`);
    assert.equal(p.sub, c.sub, `${key} sub`);
    assert.deepEqual(p.sections, c.sections, `${key} sections`);
  }
  // Decision 3: the member routes, not the public pages AM:24 names.
  assert.equal(ACCOUNT_PHONE_PAGES.events.route, '/my/events');
  assert.equal(ACCOUNT_PHONE_PAGES.pricing.route, '/plans-and-pricing');
});

// --- 1. The index -------------------------------------------------------------

// `follows.ts` /mine's shape: { users, projects }.
const FOLLOWS = { users: [
  { id: 7, handle: 'u7', name: 'Mara Ilves', headline: 'Founder', role: 'founder' },
  { id: 8, handle: 'u8', name: 'Teo Brandt', headline: null, role: 'investor' },
], projects: [{ id: 3, handle: 'p3', name: 'Quill Labs', sector: 'fintech', stage: 'seed' }] };
const GROWTH = { tier: 'growth', status: 'active', renews_at: '2026-11-01T12:00:00Z', trial_ends_at: null, has_customer: true, spinout_lab: null };

const rowsOf = (markup) => [...markup.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2]).trim()]);

test('1. A1m: a founder\'s index draws the Settings rows in order, the plan by D683\'s name, the count, and More', () => {
  const markup = html(h(AccountPhoneIndex, { role: 'founder', follows: ready(FOLLOWS), billing: ready(GROWTH) }));
  assert.deepEqual(rowsOf(markup), [
    ['/account/profile', 'Profile and identity Personal details, identity, company profile ›'],
    ['/account/notifications', 'Notifications Each type, in-app, email and push ›'],
    ['/account/security-privacy', 'Sign-in and security Password, authenticator app, SMS ›'],
    ['/account/billing', 'Billing and orders Validate + Build · $20 / month ›'],
    ['/account/following', 'Following 3 people and companies ›'],
    ['/account/onboarding', 'Onboarding ›'],
    ['/account/appearance', 'Appearance ›'],
    ['/account/activity', 'Activity Log ›'],
  ]);
  const titles = [...markup.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['Settings', 'More'], 'no Developer section for a founder');
  assert.doesNotMatch(markup, /Usage|Connectors/, 'A2m and A3m are not repeated on the index');

  const admin = html(h(AccountPhoneIndex, { role: 'admin', follows: ready(FOLLOWS), billing: ready({ plan_group: null, status: 'free', has_customer: false }) }));
  assert.deepEqual([...admin.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]), ['Settings', 'Developer', 'More']);
  assert.ok(rowsOf(admin).some(([to, t]) => to === '/account/developer' && t === 'API and search indexes Feature flags, account fields and the search indexes ›'));
  assert.doesNotMatch(admin, /developer mode/, 'no developer-mode switch exists, so the row does not name one');
});

// --- 2. No number from a failed read -------------------------------------------

test('2. the Following and plan lines hold no number while their read loads or fails', () => {
  for (const f of [LOADING, UNREADABLE, ready(null), ready({ users: [] })]) {
    assert.equal(followingLine(f), FOLLOWING_FALLBACK);
    assert.doesNotMatch(followingLine(f), /\d/);
  }
  assert.equal(FOLLOWING_FALLBACK, 'People and companies you follow');
  assert.equal(followingLine(ready({ users: [FOLLOWS.users[0]], projects: [] })), '1 person or company');
  assert.equal(followingLine(ready({ users: [], projects: [] })), '0 people and companies', 'a read that answered none is a real zero');
  const many = Array.from({ length: 500 }, (_, i) => ({ id: i }));
  assert.equal(followingLine(ready({ users: many.slice(0, 320), projects: many.slice(320) })), '500+ people and companies');
  assert.equal(followingLine(ready({ users: many.slice(0, 499), projects: [] })), '499 people and companies');

  for (const b of [LOADING, UNREADABLE]) {
    assert.equal(planLine('founder', b), PLAN_FALLBACK);
    assert.doesNotMatch(planLine('founder', b), /\$/);
  }
  assert.equal(PLAN_FALLBACK, 'Your plan, orders and invoices');
  assert.equal(planLine('founder', ready({ ...GROWTH, tier: 'free' })), 'Free');
  assert.equal(planLine('founder', ready({ ...GROWTH, tier: 'studio' })), 'Raise + Grow · $100 / month');
  assert.equal(planLine('admin', ready({ plan_group: null, status: 'free', has_customer: false })), NO_PLAN);
  assert.equal(NO_PLAN, 'No subscription plan applies');
  assert.equal(planLine('investor', ready({ tier: 'professional', raw_tier: 'professional', status: 'active', has_customer: true, quotas: {} })), 'Investor · Professional');
  assert.equal(planLine('partner', ready({ plan_group: 'partner', status: 'active', has_customer: true })), 'Partner · Pro');

  const failed = html(h(AccountPhoneIndex, { role: 'founder', follows: UNREADABLE, billing: UNREADABLE }));
  assert.match(text(failed), /Billing and orders Your plan, orders and invoices ›/);
  assert.match(text(failed), /Following People and companies you follow ›/);
  assert.doesNotMatch(text(failed), /\$|\d+ people/);
});

// --- 3. The select is gone -----------------------------------------------------

test('3. AccountSectionNav draws no Section select below lg, and its column keeps hidden lg:block', () => {
  const sections = [{ id: 'account', label: 'Profile and identity' }, { id: 'billing', label: 'Billing and orders' }, { id: 'onboarding', label: 'Onboarding', group: 'more' }];
  const markup = html(h(AccountSectionNav, { sections, active: 'billing', onSelect: noop }));
  assert.doesNotMatch(markup, /<select|account-section-menu|account-section-select/);
  assert.match(markup, /<nav [^>]*data-testid="account-section-nav"[^>]*>\s*<div class="[^"]*\bhidden\b[^"]*\blg:block\b/);
  const src = read('frontend/src/pages/account/AccountCenter.jsx');
  assert.doesNotMatch(src, /const current = sections\.find|const option = /, 'the select\'s two helpers went with it');
});

// --- 4. Addresses ------------------------------------------------------------

test('4. the address rules: a phone\'s bare /account is the index; the profile pane gets /account/profile', () => {
  assert.equal(accountViewFor({ pathname: '/account', phone: true }), 'index');
  assert.equal(accountViewFor({ pathname: '/account', phone: false }), 'account');
  assert.equal(accountViewFor({ pathname: '/account', hash: '#security-recovery-codes', phone: true }), 'security-privacy');
  assert.equal(accountViewFor({ pathname: '/account', hash: '#security-recovery-codes', phone: false }), 'security-privacy');
  assert.equal(accountViewFor({ pathname: '/account/profile', phone: true }), 'account');
  assert.equal(accountViewFor({ pathname: '/account/billing', phone: true }), 'billing');
  assert.equal(accountViewFor({ pathname: '/settings/sign-in', phone: true }), 'security-privacy', 'the /settings prefix keeps resolving for its one hop');
  assert.equal(accountViewFor({ pathname: '/account/nope', phone: true }), 'index');
  assert.equal(accountPathFor({ section: 'account', phone: true }), '/account/profile');
  assert.equal(accountPathFor({ section: 'account', phone: false }), '/account');
  assert.equal(accountPathFor({ section: 'index', phone: true }), '/account');
  assert.equal(accountPathFor({ section: 'security-privacy', phone: true }), '/account/security-privacy');
  // Every alias in the moved map resolves to a section the page has.
  for (const [seg, id] of Object.entries(PATH_TO_SECTION)) assert.equal(accountViewFor({ pathname: `/account/${seg}`, phone: true }), id);
});

const SECTIONS = [
  { id: 'account', label: 'Profile and identity' }, { id: 'notifications', label: 'Notifications' },
  { id: 'billing', label: 'Billing and orders' }, { id: 'usage', label: 'Usage' }, { id: 'following', label: 'Following' },
];

test('4. the phone frame: the index at /account with no pane; a section page with Back, its label and its pane', () => {
  const asked = [];
  const renderPane = (id) => { asked.push(id); return h('div', { 'data-pane': id }, `pane:${id}`); };
  const index = html(h(AccountPhoneFrame, {
    view: 'index', sections: SECTIONS, renderPane,
    index: h(AccountPhoneIndex, { role: 'founder', follows: ready(FOLLOWS), billing: ready(GROWTH) }),
    top: h('div', { 'data-testid': 'strip' }),
  }));
  const t = text(index);
  assert.match(t, /^ ‹ Back Account Settings you manage for yourself\. /);
  assert.match(index, /data-testid="strip"/, 'the trust strip and banner stay on the index, above the sections');
  assert.match(index, /data-testid="account-phone-index"/);
  assert.deepEqual(asked, [], 'no section pane on the index');
  assert.ok(index.indexOf('data-testid="strip"') < index.indexOf('data-testid="account-phone-index"'));

  const billing = html(h(AccountPhoneFrame, { view: 'billing', sections: SECTIONS, renderPane, index: h('div', null, 'INDEX') }), '/account/billing');
  assert.match(text(billing), /^ ‹ Back Billing and orders pane:billing $/);
  assert.deepEqual(asked, ['billing']);
  assert.doesNotMatch(billing, /INDEX|Settings you manage/, 'a section page has no sub and no index');

  // Usage carries its own A2m bar, so the frame draws none over it.
  const usage = text(html(h(AccountPhoneFrame, { view: 'usage', sections: SECTIONS, renderPane }), '/account/usage'));
  assert.equal(usage.trim(), 'pane:usage');
  // A section the role cannot open is the index, never its pane.
  asked.length = 0;
  html(h(AccountPhoneFrame, { view: 'developer', sections: SECTIONS, renderPane }));
  assert.deepEqual(asked, []);
});

test('4. SettingsPage reads its section from the address on every change, and writes it with accountPathFor', () => {
  const src = read('frontend/src/pages/SettingsPage.jsx');
  const page = src.slice(src.indexOf('export default function SettingsPage'), src.indexOf('function AccountPanes('));
  // In the render body, not a once-only initialiser.
  assert.match(page, /\n  const active = accountViewFor\(\{ pathname: location\.pathname, hash: location\.hash, phone \}\);/);
  assert.doesNotMatch(page, /initialSection|useState\(initial/);
  // D753 — the canonicalising call keeps a connector's key.
  assert.match(page, /const want = accountPathFor\(\{ section: active, phone, key: connectorKey \}\);/);
  assert.match(page, /\}, \[active, phone, location\.pathname\]\);/, 'the URL effect re-runs when the path moves');
  assert.doesNotMatch(src, /const PATH_TO_SECTION/, 'the map moved to accountPhone.js');
  // On a phone a section is pushed, so Back returns to the index; desktop replaces, as before.
  assert.match(page, /navigate\(\{ pathname: accountPathFor\(\{ section: id, phone \}\) \}, \{ replace: !phone \}\)/);
  assert.match(page, /<ProfileCompletionBanner onJump=\{\(\) => setActive\('account'\)\} \/>/);
  // The phone view is drawn inside the rail frame, and the desktop keeps its heading.
  assert.ok(page.indexOf('<RailFrame') < page.indexOf('<AccountPhoneFrame'));
  // D753 — on a connector's page its name is the one <h1>, so the heading is drawn only without a key.
  assert.match(page, /\{phone \? \(\s*<AccountPhoneFrame[\s\S]*?\) : \(\s*<div className="min-w-0" data-testid="settings-page"[^>]*>[\s\S]*?\{!connectorKey && <>\s*<h1 [^>]*>Account<\/h1>/);
});

// --- 5. The bars, A1m–A3m ------------------------------------------------------

const LLAMA = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WHISPER = '@cf/openai/whisper';
const BUDGET = {
  licence: 'founder:growth', source: 'environment',
  daily_microusd: 1_000_000, monthly_microusd: 5_000_000,
  day_spend_microusd: 420_000, month_spend_microusd: 3_100_000,
  day_reserved_microusd: 0, month_reserved_microusd: 50_000, topup_reserved_microusd: 0,
  balance_microusd: 10_000_000, held_for_review: [],
};
const PRODUCT = { configured: true, state: 'ready', product: { price_id: 'price_abc123', currency: 'usd', unit_amount: 1000 } };
// D755 (#1915): A10m's Plans rows are the public plans-and-packs read's.
// D783 (#2124): a plan includes 25% of its price each month; no plan, none. No day figure.
const ALLOW = (m) => ({ share: 0.25, monthly_microusd: m, source: m ? 'plan' : 'none' });
const PLANS = {
  plans: [
    { family: 'founder', licence_key: 'founder:free', product_id: null, plan_name: null, free: true, prices: [], allowance: ALLOW(0) },
    { family: 'investor', licence_key: 'investor:free', product_id: null, plan_name: null, free: true, prices: [], allowance: ALLOW(0) },
    { family: 'other', licence_key: 'other', product_id: null, plan_name: null, free: true, prices: [], allowance: ALLOW(0) },
    { family: 'advisor', licence_key: 'advisor', product_id: 'prod_adv', plan_name: 'Advisor', free: false, prices: [{ price_id: 'price_adv', unit_amount: 4900, currency: 'usd', interval: 'month', interval_count: 1 }], allowance: ALLOW(12_250_000) },
    { family: 'founder', licence_key: 'founder:growth', product_id: 'prod_g', plan_name: 'Validate + Build', free: false, prices: [{ price_id: 'price_g', unit_amount: 2000, currency: 'usd', interval: 'month', interval_count: 1 }], allowance: ALLOW(5_000_000) },
    { family: 'partner', licence_key: 'partner', product_id: 'prod_p', plan_name: 'Operating Partner', free: false, prices: [{ price_id: 'price_p', unit_amount: 9900, currency: 'usd', interval: 'month', interval_count: 1 }], allowance: ALLOW(24_750_000) },
  ],
  packs: [], covers: 'Covers Eadwyn.', resets: 'Resets at 00:00 UTC.',
};
const SPEND = {
  ok: true, recorded: true,
  month: { key: '2026-10', spend_usd: 0.91, cap_usd: 5, enforced_usd: null, calls: 9 },
  days: [], days_recorded: true, by_surface: [], by_surface_recorded: true, by_task: [], by_task_recorded: true,
  by_model: [
    { model: LLAMA, calls: 7, spend_usd: 0.88, prompt_tokens: 1_234_567, completion_tokens: 340_000, uncounted_calls: 0, cached_calls: 0, fallback_calls: 0 },
    { model: WHISPER, calls: 2, spend_usd: 0.02, prompt_tokens: 0, completion_tokens: 0, uncounted_calls: 2, cached_calls: 0, fallback_calls: 0 },
  ],
  by_model_recorded: true, last_run: null, last_run_recorded: true,
};
const RATES = { ok: true, models: [
  { id: LLAMA, name: 'Llama 3.3 70B Fast', in_per_1m_usd: 0.29, out_per_1m_usd: 2.25 },
  { id: WHISPER, name: 'Whisper Large v3 Turbo', per_audio_minute_usd: 0.0005 },
] };
const area = (key, files, b, unknown = 0) => ({ key, files, bytes: b, unknown_size_files: unknown, recorded: true });
const STORAGE = {
  total_bytes: 1_288_490_189, files: 148, unknown_size_files: 0,
  areas: [area('data_room', 64, 859_832_320), area('diligence_files', 31, 100), area('research_library', 22, 50_331_648),
    area('message_attachments', 27, 100_663_296), area('interview_recordings', 4, 32_505_856)],
};
const NOW = new Date(Date.UTC(2026, 9, 8, 18, 48));
const usageProps = { budget: ready(BUDGET), product: ready(PRODUCT), spend: ready(SPEND), rates: ready(RATES), storage: ready(STORAGE), now: NOW };

const barOf = (markup) => text(markup.slice(0, markup.indexOf('</h1>') + 300));
const sectionTitles = (markup) => [...markup.matchAll(/<h2 class="text-\[10px\][^"]*">([^<]+)<\/h2>/g)].map((m) => m[1]);

test('5. A1m: the bar and the sections are the canvas\'s, with More the one named departure', () => {
  const c = CANVAS_PAGES.account;
  const index = html(h(AccountPhoneFrame, { view: 'index', sections: SECTIONS, renderPane: noop,
    index: h(AccountPhoneIndex, { role: 'admin', follows: ready(FOLLOWS), billing: ready(GROWTH) }) }));
  assert.match(barOf(index), new RegExp(`^ ‹ Back ${c.title} ${c.sub.replace('.', '\\.')}`));
  // Decision 10: More is A1m's one added section, after the canvas's two.
  assert.deepEqual(sectionTitles(index), [...c.sections, 'More']);
});

test('5. A2m: Usage on a phone draws the canvas bar and its three sections, then keeps the desktop cards', () => {
  const c = CANVAS_PAGES.usage;
  const markup = html(h(UsagePhoneView, usageProps), '/account/usage');
  assert.match(text(markup), new RegExp(`^ ‹ Back ${c.title} ${c.sub.replace('.', '\\.')} `));
  assert.deepEqual(sectionTitles(markup), c.sections);
  const t = text(markup);
  assert.match(t, /Today Resets at 00:00 UTC · in 5 h 12 min \$0\.42 of \$1\.00/);
  assert.match(t, /This month Resets on the 1st at 00:00 UTC \$3\.10 of \$5\.00/);
  assert.match(t, /Held by runs in progress Returned if a run does not finish in 5 minutes \$0\.05/);
  assert.match(t, /Top-up balance Runs use your allowance first, then your top-up \$10\.00/);
  assert.match(markup, /<a href="\/plans-and-pricing#token-packs"[^>]*data-testid="usage-add-tokens">Add tokens<\/a>/);
  assert.match(markup, /style="width:42%"/, 'Today\'s 7px bar');
  // Kept below, in today's form: the four cards the board does not draw.
  for (const card of ['usage-card-days', 'usage-card-where', 'usage-card-rates', 'usage-card-last-run']) assert.match(markup, new RegExp(`data-testid="${card}"`), card);
  assert.ok(markup.indexOf('usage-phone-storage') < markup.indexOf('usage-card-days'), 'the canvas sections come first');
  assert.doesNotMatch(markup, /usage-card-allowance|usage-card-models"|usage-card-storage/, 'the cards the sections replace are not drawn twice');
  // Without a configured top-up there is no button, and the line says why.
  const off = text(html(h(UsagePhoneView, { ...usageProps, product: ready({ configured: false }) })));
  assert.doesNotMatch(off, /Add tokens/);
  // D755 (#1916): one sentence, lib/aiTokens.js's.
  assert.match(off, /Top-up isn't available yet\. Runs use your included allowance only\./);
  // A paused allowance still says so, above the figures.
  const paused = text(html(h(UsagePhoneView, { ...usageProps, budget: ready({ ...BUDGET, held_for_review: [{ id: 1 }] }) })));
  assert.match(paused, /AI allowance Runs paused A run cost more than it held\./);
});

test('5b. D751 (#1881): a suggested connector Axal cannot connect reads Not set up here, and a Super Admin\'s row goes to its keys', () => {
  const P = (key, display_name, integration_type, status, extra = {}) => ({
    key, display_name, integration_type, status, tier: 'free', auth_type: 'oauth2', description: `${display_name} description.`,
    capabilities: [], has_implementation: true, locked_for_user: false, ...extra,
  });
  const catalogue = buildCatalogue({
    providers: [P('github', 'GitHub', 'code', 'beta', { configured: false })],
    items: [], waitlist: [], firstParty: { microsoft: { configured: false, connected: false } },
  });
  const data = { status: 'ready', catalogue, items: [], itemsFailed: false, reload: noop,
    suggestions: [{ provider_key: 'github', reason: 'Build has no code yet.' }, { provider_key: 'microsoft', reason: 'No calendar yet.' }] };
  // The row's element, from its opening tag to the first close of that tag, found by text, not a built pattern.
  const row = (markup, key) => {
    const i = markup.indexOf(` data-testid="connector-suggested-${key}"`);
    if (i < 0) return '';
    const start = markup.lastIndexOf('<', i);
    const tag = /^<(a|div|button)\b/.exec(markup.slice(start))?.[1];
    const end = tag ? markup.indexOf(`</${tag}>`, i) : -1;
    return end < 0 ? '' : markup.slice(start, end + tag.length + 3);
  };
  const plain = html(h(ConnectorsPhoneView, { data }), '/account/connectors');
  const gh = row(plain, 'github');
  assert.match(text(gh), /GitHub .*Not set up here/, 'the reason first, as the card says it');
  assert.doesNotMatch(text(gh), /Beta/);
  assert.match(text(row(plain, 'microsoft')), /Not set up here/);
  assert.doesNotMatch(plain, /Add its keys in Integration keys/);
  const sup = html(h(ConnectorsPhoneView, { data, superAdmin: true }), '/account/connectors');
  assert.match(row(sup, 'github'), /^<a[^>]*href="\/admin\?tab=integration-keys"/);
  assert.match(text(row(sup, 'github')), /Add its keys in Integration keys\./);
  assert.doesNotMatch(row(sup, 'microsoft'), /integration-keys/, 'a first-party client is not a console key yet');
});

test('5. A3m: Connectors on a phone draws the canvas bar, Yours and Suggested for you, then keeps Discover', () => {
  const c = CANVAS_PAGES.connectors;
  const P = (key, display_name, integration_type, status, tier, extra = {}) => ({
    key, display_name, integration_type, status, tier, auth_type: 'oauth2', description: `${display_name} description.`,
    capabilities: [], docs_url: `https://example.test/${key}`, has_implementation: status !== 'coming_soon', locked_for_user: false, ...extra,
  });
  const catalogue = buildCatalogue({
    providers: [P('hubspot', 'HubSpot', 'crm', 'live', 'growth'), P('calendly', 'Calendly', 'scheduling', 'live', 'free'), P('stripe', 'Stripe', 'data_feed', 'live', 'growth')],
    items: [
      { uid: 'u1', provider_key: 'stripe', status: 'active', last_synced_at: '2026-10-09 11:48:00', last_error: null, config: {} },
      { uid: 'u2', provider_key: 'hubspot', status: 'error', last_synced_at: '2026-10-07 12:00:00', last_error: 'invalid_grant: token expired', config: {} },
    ],
    waitlist: [], firstParty: {},
  });
  const data = { status: 'ready', catalogue, items: [], itemsFailed: false, reload: noop,
    suggestions: [{ provider_key: 'calendly', module: 'customer_research', reason: 'Your interview pipeline has no booking link yet.' }] };
  const markup = html(h(ConnectorsPhoneView, { data }), '/account/connectors');
  assert.match(text(markup), new RegExp(`^ ‹ Back ${c.title} ${c.sub.replace('.', '\\.')} `));
  assert.deepEqual(sectionTitles(markup), c.sections);
  const t = text(markup);
  assert.match(t, /Yours 1–2 of 2/, 'the count line is the section\'s action');
  assert.match(t, /HubSpot Sign-in expired · [^›]*Needs attention/, 'a row that needs attention leads with its reason');
  assert.match(t, /Suggested for you Calendly Your interview pipeline has no booking link yet\. \+/);
  assert.match(markup, /data-testid="connectors-phone-browse">Browse connectors<\/button>/);
  assert.match(markup, /id="connectors-discover"/, 'Discover is kept below');
  assert.ok(markup.indexOf('connectors-phone-suggested') < markup.indexOf('connectors-discover'));
  assert.doesNotMatch(markup, /role="tablist" aria-label="Connectors"/, 'no Yours/Discover tabs on a phone');
  // D753 F6 (#1877): the phone's Discover filters through the bottom-sheet menu, not a sideways chip strip.
  assert.match(markup, /data-testid="button-connectors-filter"[^>]*aria-haspopup="dialog"|aria-haspopup="dialog"[^>]*data-testid="button-connectors-filter"/);
  assert.doesNotMatch(markup, /connectors-chips/);
  // A failed suggestions read keeps today's reason, never an empty list.
  const none = text(html(h(ConnectorsPhoneView, { data: { ...data, suggestions: null, suggestionsNote: 'Choose a company in the sidebar to see what its empty modules could be fed by.' } })));
  assert.match(none, /Suggested for you Browse connectors Not recorded · Choose a company in the sidebar/, 'the CTA, then the note, in the canvas\'s order');
});

test('5. at desktop width neither section draws the bar, and each keeps its own heading', () => {
  const usage = html(h(UsageSection, { role: 'founder' }), '/account/usage');
  assert.doesNotMatch(usage, /‹ Back/);
  assert.match(usage, /<h2 [^>]*>Usage<\/h2><p [^>]*>What you have used across all your companies\.<\/p>/);
  const data = { status: 'loading', catalogue: [], reload: noop };
  const connectors = html(h(ConnectorsView, { data }), '/account/connectors');
  assert.doesNotMatch(connectors, /‹ Back/);
  assert.match(connectors, /<h2 [^>]*>Connectors<\/h2>\s*<p [^>]*>Bring your tools into StudioOS, and send your work back to them\.<\/p>/);
});

// --- 7. Not recorded, never 0 ----------------------------------------------------

test('7. a storage read with files and no total reads Not recorded with its reason, never 0', () => {
  const g = storageGroup({ storage: ready({ ...STORAGE, total_bytes: null, unknown_size_files: 3 }) });
  const markup = html(h(PhoneRows, { groups: [g] }));
  const all = markup.slice(markup.indexOf('All your files'), markup.indexOf('Files with no size recorded'));
  assert.match(all, /title="Some files were stored before sizes were recorded\."[^>]*>Not recorded</);
  assert.doesNotMatch(text(all), /\b0\b|0 B/);
  assert.match(text(markup), /Files with no size recorded 3 files/);
  assert.match(text(markup), /All your files Data room, Diligence files, Research library, Message attachments, Interview recordings/);
  assert.match(text(markup), /Other files you keep on StudioOS are not counted yet\. No plan sets a storage limit\./);
  // With a total, the value is the total and the file count; with no unsized files there is no such row.
  const whole = text(html(h(PhoneRows, { groups: [storageGroup({ storage: ready(STORAGE) })] })));
  assert.match(whole, /All your files [^›]*1\.2 GB · 148/);
  assert.doesNotMatch(whole, /Files with no size recorded/);
  assert.match(text(html(h(PhoneRows, { groups: [storageGroup({ storage: UNREADABLE })] }))), /Storage could not be read\. This is not a claim that you stored nothing\./);
});

test('8. Usage\'s Models rows: the canvas note, no invented rows, and Not counted for an uncounted model', () => {
  const t = text(html(h(UsagePhoneView, usageProps)));
  assert.match(t, /Llama 3\.3 70B Fast 7 runs · 1\.2M in · 340k out \$0\.88/);
  assert.match(t, /Whisper Large v3 Turbo 2 runs · Not counted in · Not counted out \$0\.02/);
  assert.match(t, /Estimated from the run log\. Runs still in progress are not in these yet\./);
  assert.ok(CANVAS_PAGES.usage.chunk.includes("{ note: 'Estimated from the run log. Runs still in progress are not in these yet.' }"), 'the note is AMP\'s');
  assert.doesNotMatch(t, /min transcribed|Safety check on every run/);
  assert.doesNotMatch(t, /Whisper Large v3 Turbo 2 runs · 0 in/);
});

// --- 9. One plan name --------------------------------------------------------

test('9. planSummary names the founder tiers by D683\'s names', () => {
  assert.equal(planSummary('founder', { tier: 'growth', status: 'active' }).tier, 'Validate + Build');
  assert.equal(planSummary('founder', { tier: 'studio', status: 'active' }).tier, 'Raise + Grow');
  assert.equal(planSummary('founder', { tier: 'free', status: 'free' }).tier, 'Free');
});

// --- 10 (part). Each bar names itself for Eadwyn ------------------------------

test('10 (part). every phone bar this PR draws passes PhoneBar an eadwynLabel equal to its title, and draws no Eadwyn button itself', () => {
  for (const f of ['frontend/src/pages/account/AccountCenter.jsx', 'frontend/src/pages/account/AccountUsage.jsx', 'frontend/src/pages/account/AccountConnectors.jsx', 'frontend/src/pages/SettingsPage.jsx']) {
    const src = read(f);
    for (const bar of src.matchAll(/<PhoneBar [^>]*\/>/g)) {
      const title = bar[0].match(/title=\{([^}]+)\}/)?.[1];
      assert.ok(title, `${f}: ${bar[0]}`);
      assert.ok(bar[0].includes(`eadwynLabel={${title}}`), `${f}: ${bar[0]}`);
    }
    assert.doesNotMatch(src, /Open Eadwyn for this page/, `${f} draws no Eadwyn button of its own`);
  }
  // The owner requested no rail on Perks or Learning home.
  const page = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(page, /<RailFrame\s+rail=\{safeActive !== 'connectors' && \(\s*<WorkerRail\s+workspace="Account"/);
});

// --- 11. No read gains a scope -----------------------------------------------

test('11. no phone view passes a company or venture to a read', () => {
  const phoneOf = (f, from, to) => {
    const src = read(f);
    const a = src.indexOf(from);
    const b = to ? src.indexOf(to, a) : src.length;
    assert.ok(a >= 0 && b > a, `${f}: the phone block moved`);
    return src.slice(a, b);
  };
  const blocks = [
    read('frontend/src/pages/account/accountPhone.js'),
    phoneOf('frontend/src/pages/account/AccountUsage.jsx', '// D700 (#1662) — A2m', null),
    phoneOf('frontend/src/pages/account/AccountConnectors.jsx', 'export default function ConnectorsSection()', 'export function ConnectorsView('),
    phoneOf('frontend/src/pages/account/AccountCenter.jsx', 'export function AccountPhoneIndex(', '/**\n * The rail\'s Coverage lines'),
    phoneOf('frontend/src/pages/SettingsPage.jsx', 'function AccountPhoneIndexReads(', '// ---------- Sections'),
  ];
  for (const b of blocks) assert.doesNotMatch(b, /ompany(Id|_id)|venture|useActiveCompany|getActiveCompanyId|X-Company-Id/);
  const reads = blocks.join('\n');
  assert.match(reads, /api\.followsMine\(\)/);
  assert.match(reads, /useBillingStatus\(role\)/);
  assert.match(reads, /const data = useConnectors\(\);/, 'the connectors read is the member\'s, as on desktop');
});

// =============================================================================
// PR 2 — A4m–A10m
// =============================================================================

const OBLIGATIONS = [
  { obligation_key: 'tos_v1', required: true, status: 'satisfied' },
  { obligation_key: 'founder_nda_v1', required: true, status: 'satisfied', expires_at: '2099-05-01T00:00:00Z' },
  { obligation_key: 'kyc_v1', required: true, status: 'in_review' },
  { obligation_key: 'kyb_v1', required: true, status: 'pending' },
];
const PERK = (uid, partner_name, offer, extra) => ({ uid, partner_name, offer, category: 'Cloud', kind: 'credits', credits: 500, claimable: true, claimed: false, rating: null, ...extra });
const CATALOG = {
  balance: 1200, allowance_configured: true, claimant: true, categories: ['Cloud', 'Legal'],
  items: [PERK('p1', 'Nimbus', '$5,000 cloud credits'), PERK('p2', 'Lexa', '20% off formation legal', { category: 'Legal', kind: 'tier', required_tier: null, claimable: true })],
};
const MINE = { items: [{ uid: 'c1', perk_uid: 'p9', offer: 'Free banking', partner_name: 'Bankr', code: 'NCL-4471', state: 'issued', expires_at: '2026-12-30T00:00:00Z' }], ledger: [], balance: 1200, stats: { claimed: 1, credits_spent: 0, expiring: 0, expiring_within_days: 30 } };
const CAL_NOW = new Date(2026, 9, 17, 9, 0);
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const CAL_EVENTS = [
  { id: 1, kind: 'founder_checkin', title: 'Interview with Ana', start_at: at(17, 14), end_at: at(17, 14, 45) },
  { id: 2, kind: 'partner_office_hour', title: 'Demo Day rehearsal', start_at: at(19, 10), end_at: null },
  { id: 3, kind: 'ic_meeting', title: 'Next month', start_at: at(30, 10), end_at: at(30, 11) },
];
const PROVIDERS = [
  { name: 'Google Calendar', state: 'connected', status: { connected: true, last_synced_at: '2026-10-17T08:57:00Z' } },
  { name: 'Microsoft 365', state: 'failed', status: { connected: true } },
];
const EV_NOW = new Date(Date.UTC(2026, 9, 17, 12));
const TICKETS = [
  { id: 't1', title: 'Pricing pressure-test workshop', starts_at: '2026-10-24T15:00:00Z', status: 'confirmed', location_kind: 'Online' },
  { id: 't2', title: 'Demo Day', starts_at: '2026-11-18T15:00:00Z', status: 'waitlisted' },
  { id: 't3', title: 'Fundraising basics', starts_at: '2026-10-03T15:00:00Z', status: 'attended' },
];
const HOSTING = [{ id: 41, title: 'Founder dinner', starts_at: '2026-11-02T18:00:00Z', status: 'published', visibility: 'members' }];
const SUGGESTED = [{ id: 51, slug: 'office-hours-block', title: 'Office hours block', starts_at: '2026-12-02T15:00:00Z' }];
const LEARN = {
  me: { status: 'ready', in_progress: [{ subject_kind: 'course', subject_uid: 'c1', title: 'Customer discovery', percent: 68, href: '/learning/courses/discovery' }] },
  programs: { enrolled: { status: 'ready', rows: [] }, open: { status: 'ready', programs: [] } },
  upcoming: { status: 'ready', rows: [{ uid: 'w1', title: 'Pricing teardown', starts_at: '2026-10-28T16:00:00Z', href: '/learning/webinars/w1', status: 'scheduled' }] },
};
const HELP_AREAS = helpAreas(filterSectionsForRole(HELP_SECTIONS, 'founder'));
const POPULAR = { status: 'ok', cards: [{ anchor: 'getting-started/first-steps', title: 'First steps', views: 42, area: 'Getting started' }] };

const PHONE_VIEWS = {
  trust: () => h(TrustPhoneView, { status: 'ready', obligations: OBLIGATIONS }),
  perks: () => h(PerksPhoneView, { catalog: ready(CATALOG), mine: ready(MINE) }),
  calendar: () => h(CalendarPhoneView, { events: { status: 'ready', items: CAL_EVENTS }, providers: PROVIDERS, now: CAL_NOW }),
  events: () => h(EventsPhoneView, { events: { status: 'ready', hosting: HOSTING, attending: TICKETS }, suggested: SUGGESTED, now: EV_NOW }),
  learning: () => h(LearningPhoneView, { gated: false, ...LEARN, now: Date.parse('2026-10-17T12:00:00Z') }),
  help: () => h(HelpPhoneView, { popular: POPULAR, areas: HELP_AREAS }),
  pricing: () => h(PricingPhoneView, { pricing: ready(PLANS), budget: ready(BUDGET), product: ready(PRODUCT) }),
};
// Decision 10's departures in a section list, named rather than matched loosely.
const DEPARTED_SECTIONS = {
  events: (c) => [...c, 'Hosting'],
  help: (c) => ['Popular this week', ...c.slice(1)],
};

test('5. A4m–A10m: each phone view draws ‹ Back, the canvas\'s title and sub, then its sections in order', () => {
  for (const [key, view] of Object.entries(PHONE_VIEWS)) {
    const c = CANVAS_PAGES[key];
    const markup = html(view());
    assert.equal(barOf(markup).trim().startsWith(`‹ Back ${c.title} ${c.sub}`), true, `${key}: ${barOf(markup)}`);
    const want = DEPARTED_SECTIONS[key] ? DEPARTED_SECTIONS[key](c.sections) : c.sections;
    assert.deepEqual(sectionTitles(markup), want, key);
    assert.match(markup, /class="-m-4 md:-m-6 lg:m-0 |class="min-h-screen bg-white dark:bg-gray-950"/, `${key}: no phone gutter`);
  }
  // A gated profile's Learning is Browse alone.
  const gated = html(h(LearningPhoneView, { gated: true }));
  assert.deepEqual(sectionTitles(gated), ['Browse']);
});

test('5. the two account canvases are in integrated/ and no longer in incoming/', () => {
  for (const f of ['Account Menu · Mobile.dc.html', 'Account Mobile Page.dc.html']) {
    assert.ok(existsSync(resolve(process.cwd(), 'design/canvases/integrated', f)), `${f} is not in integrated/`);
    assert.ok(!existsSync(resolve(process.cwd(), 'design/incoming', f)), `${f} is still in incoming/`);
  }
  // AM imports AMP by name, so they moved together and the import resolves.
  assert.match(read('design/canvases/integrated/Account Menu · Mobile.dc.html'), /Account Mobile Page/);
});

test('5. at desktop width the pages draw no bar and keep their own heading', () => {
  const perks = html(h(PerksPage, { user: { role: 'founder' } }), '/perks');
  assert.doesNotMatch(perks, /‹ Back/);
  assert.match(perks, /<h1 [^>]*>.*Perks &amp; Products<\/h1>/);
  const cal = html(h(CalendarPage), '/calendar');
  assert.doesNotMatch(cal, /‹ Back/);
  assert.match(cal, /<h1>Calendar<\/h1>/);
  const events = html(h(MyEventsPage), '/my/events');
  assert.doesNotMatch(events, /‹ Back/);
  assert.match(events, /<h1 [^>]*>Events<\/h1>/);
  const learning = html(h(LearningHome, { gated: true }), '/learning');
  assert.doesNotMatch(learning, /‹ Back/);
  assert.match(learning, /<h1 [^>]*>Learning<\/h1>/);
  assert.doesNotMatch(html(h(TrustCenterPage), '/trust'), /‹ Back/);
  // Trust, Help and Products are read as source: each branches on the phone
  // before its desktop return, which keeps its heading.
  const trust = read('frontend/src/pages/TrustCenterPage.jsx');
  assert.match(trust, /const phone = usePhoneWidth\(\) && !chromeless;/, 'the investor workspace keeps its chromeless frame');
  assert.match(trust, /if \(phone\) \{\s*return \(\s*<TrustPhoneView[\s\S]*?\n  return \(\s*<div className="p-6">[\s\S]*?<ShieldCheck className="w-7 h-7 text-emerald-600" \/> Trust Center/);
  const docs = read('frontend/src/pages/docs/DocsLayout.jsx');
  assert.match(docs, /\) : phone \? \(\s*<HelpPhoneHome[\s\S]*?\) : \(\s*<HelpHome/, 'only the home has a phone view; a guide page is unchanged');
  const products = read('frontend/src/pages/ProductsPage.jsx');
  assert.match(products, /\{!phone && \(\s*<>\s*<h1 [^>]*>\s*<Package size=\{26\}[^>]*\/> Plans &amp; Pricing/);
  // D755 §13: the phone's account bar is a member's; a visitor gets the page.
  assert.match(products, /return phone && member \? <PricingPhone pricing=\{pricing\} budget=\{budget\}>\{page\}<\/PricingPhone> : page;/);
});

test('5. A4m–A10m: each section reads its values from the page\'s sources', () => {
  const trust = text(html(PHONE_VIEWS.trust()));
  assert.match(trust, /Trust score 50 of 100 You have 2 open requirements Not compliant/, 'needs plus in progress, with verdictFor\'s word');
  assert.match(trust, /Identity verification \(KYC\) Required in review/);
  const trustRows = html(PHONE_VIEWS.trust());
  assert.match(trustRows, /style="width:50%"/, 'the score\'s bar');
  assert.match(text(html(h(TrustPhoneView, { status: 'ready', obligations: OBLIGATIONS.slice(0, 2) }))), /100 of 100 Every required obligation is satisfied\. Compliant/);

  const perks = text(html(PHONE_VIEWS.perks()));
  assert.match(perks, /Credits Balance US\$1 of perk value each 1,200 credits/);
  assert.match(perks, /Nimbus · \$5,000 cloud credits Cloud 500 credits/);
  assert.match(perks, /Lexa · 20% off formation legal Legal · your plan Claim/);
  assert.match(perks, /My perks Free banking · code NCL-4471 Expires 2026-12-30/);
  const noAllowance = text(html(h(PerksPhoneView, { catalog: ready({ ...CATALOG, allowance_configured: false }), mine: ready(MINE) })));
  assert.match(noAllowance, /Credits No perk-credit allowance is set up on this platform yet, so every balance is zero\./);
  assert.doesNotMatch(noAllowance, /Balance US\$1/);
  assert.match(text(html(h(PerksPhoneView, { catalog: UNREADABLE, mine: LOADING }))), /Your balance could not be read\./);

  const cal = text(html(PHONE_VIEWS.calendar()));
  assert.match(cal, /Today 2:00 PM · Interview with Ana Check-in 45m/);
  assert.match(cal, /This week Mon 10:00 AM · Demo Day rehearsal Office hour Not recorded/);
  assert.doesNotMatch(cal, /Next month/, 'This week is the next seven days only');
  assert.match(cal, /Google Calendar Synced [^·]+ Connected Microsoft 365 Last sync not recorded Sync failed/, 'providerState\'s own words');

  const events = text(html(PHONE_VIEWS.events()));
  // Dates are the runtime's locale (en-US under node).
  assert.match(events, /Upcoming Oct 24 · Pricing pressure-test workshop [^›]*Going Nov 18 · Demo Day [^›]*Waitlist Dec 2 · Office hours block [^›]*RSVP/);
  assert.match(events, /Past Oct 3 · Fundraising basics [^›]*Attended/);
  assert.match(html(PHONE_VIEWS.events()), /href="\/events\/office-hours-block"/);

  const learning = text(html(PHONE_VIEWS.learning()));
  assert.match(learning, /Continue learning Customer discovery Course 68%/);
  assert.match(learning, /Upcoming webinars Pricing teardown [^›]*Register/);
  assert.match(learning, /Browse Courses › Articles and publications › Exercises and exams/);
  for (const tab of ['courses', 'articles', 'exercises']) assert.match(html(PHONE_VIEWS.learning()), new RegExp(`href="/learning\\?tab=${tab}"`));
  assert.ok(learning.includes(`Exercises and exams ${TAB_NOT_LIVE.exercises}`), 'Exercises carries its TAB_NOT_LIVE line for every profile');

  const help = text(html(PHONE_VIEWS.help()));
  assert.match(help, /Popular this week First steps 42 views · Getting started/);
  const area = HELP_AREAS[0];
  assert.ok(help.includes(`${area.title} ${area.guides.length} guides`), 'each area with its count');
  assert.match(html(PHONE_VIEWS.help()), /href="\/help\/tickets\?new=1"[^>]*>[\s\S]*?Open a ticket[\s\S]*?Replies appear in My tickets/);

  const pricing = text(html(PHONE_VIEWS.pricing()));
  // D755 §11: every family's plans, each with its price and its own allowance; the member's plan under "Your plan".
  assert.match(pricing, /Plans Founder Free No plan: every run uses your tokens\. \$0 Founder · Validate \+ Build Your plan · Includes \$5\.00 of AI each month: 25% of the price\. Past it, runs use your tokens\. \$20 \/ month Investor Free No plan: every run uses your tokens\. \$0 Advisor · Advisor Includes \$12\.25 of AI each month: 25% of the price\. Past it, runs use your tokens\. \$49 \/ month Operating Partner · Operating Partner Includes \$24\.75 of AI each month: 25% of the price\. Past it, runs use your tokens\. \$99 \/ month Exploring and other accounts No plan: every run uses your tokens\. \$0 Manage plan/);
  assert.match(html(PHONE_VIEWS.pricing()), /href="\/account\/billing"[^>]*>Manage plan</);
  assert.ok(pricing.includes(`Tokens Past your allowance ${TOKENS_LINE} Add tokens`));
  assert.ok(CANVAS_PAGES.pricing.chunk.includes(TOKENS_LINE), 'the Tokens line is AMP\'s');
  assert.match(html(PHONE_VIEWS.pricing()), /<a href="\/plans-and-pricing#token-packs"[^>]*>[\s\S]*?Past your allowance/);
  // D755 §11: every account type sees the Plans, the phone included.
  assert.deepEqual(sectionTitles(html(h(PricingPhoneView, { pricing: ready(PLANS), budget: ready({ ...BUDGET, licence: 'advisor' }), product: ready(PRODUCT) }))), ['Plans', 'Tokens']);
  assert.match(text(html(h(PricingPhoneView, { pricing: ready(PLANS), budget: ready(BUDGET), product: ready({ configured: false }) }))), /Top-up isn't available yet\. Runs use your included allowance only\./);
});

// --- 6. Member routes --------------------------------------------------------------

test('6. the member routes mount the pages that draw A7m and A10m; the public pages draw no account bar', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/my\/events" element=\{guard\(\[[^\]]+\], <MyEventsPage \/>\)\} \/>/);
  // D755 §13: /plans-and-pricing opens to visitors; a product's page still needs sign-in.
  assert.match(app, /<Route path="\/plans-and-pricing" element=\{user \? guard\(\[[^\]]+\], <ProductsPage \/>\) : <ProductsPage \/>\} \/>/);
  assert.match(app, /<Route path="\/plans-and-pricing\/:productId" element=\{guard\(\[[^\]]+\], <ProductsPage \/>\)\} \/>/);
  assert.match(read('frontend/src/pages/events/MyEventsPage.jsx'), /<EventsPhoneView /);
  assert.match(read('frontend/src/pages/account/PricingPhone.jsx'), /<AccountPhonePage pageKey="pricing"/);
  for (const f of ['frontend/src/pages/events/PublicEventsPage.jsx', 'frontend/src/pages/PricingPage.jsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /ui\/phone|accountPhone|AccountPhonePage|PricingPhone/, `${f} draws an account phone bar`);
  }
});

// --- 7. Not recorded, never 0 ----------------------------------------------------

test('7. a calendar event with no end reads Not recorded for its duration, with its reason', () => {
  const markup = html(PHONE_VIEWS.calendar());
  const row = markup.slice(markup.indexOf('Demo Day rehearsal'), markup.indexOf('calendar-phone-sources'));
  assert.match(row, new RegExp(`title="${NO_END_REASON}"[^>]*>Not recorded<`));
  assert.doesNotMatch(text(row), /\b0m\b|\b0 min\b|NaN/);
  // An end at or before the start is no duration either.
  const odd = text(html(h(CalendarPhoneView, { events: { status: 'ready', items: [{ ...CAL_EVENTS[0], end_at: CAL_EVENTS[0].start_at }] }, providers: [], now: CAL_NOW })));
  assert.match(odd, /Interview with Ana Check-in Not recorded/);
  // A failed read says so, and is not an empty day.
  const failed = text(html(h(CalendarPhoneView, { events: { status: 'unreadable', items: [] }, providers: PROVIDERS, now: CAL_NOW })));
  assert.match(failed, /Today The calendar could not be read\. This is not a claim that nothing is scheduled\./);
  assert.doesNotMatch(failed, /Nothing scheduled today/);
});

// --- 8. The departures hold ----------------------------------------------------

test('8. Trust lists only what /trust/me returns: no 83(b) row, and the pill is verdictFor\'s word', () => {
  const markup = html(PHONE_VIEWS.trust());
  assert.equal([...markup.matchAll(/data-testid="trust-phone-obligation"/g)].length, OBLIGATIONS.length);
  assert.doesNotMatch(markup, /83\(b\)/);
  assert.ok(CANVAS_PAGES.trust.chunk.includes('83(b) election'), 'the canvas draws the row this departs from');
  assert.doesNotMatch(text(markup), /\bPartial\b/);
  // A failed matrix is Unreadable, never an empty list.
  const failed = text(html(h(TrustPhoneView, { status: 'unreadable' })));
  assert.match(failed, /Your obligations could not be read\./);
  assert.doesNotMatch(failed, /No obligations outstanding/);
  assert.match(read('frontend/src/pages/TrustCenterPage.jsx'), /setMatrix\(\{ obligations: \[\], role, failed: true \}\)/);
});

test('8. Help: Popular this week first, no For you now, and contact stays in tickets', () => {
  const markup = html(PHONE_VIEWS.help());
  assert.equal(sectionTitles(markup)[0], 'Popular this week');
  assert.doesNotMatch(markup, /For you now/);
  assert.doesNotMatch(markup, /mailto:support@axal\.vc|Email support/);
  assert.match(markup, /Open a ticket/);
  assert.doesNotMatch(markup, /From the address on your account/);
  assert.ok(CANVAS_PAGES.help.chunk.includes("'From the address on your account'"));
  // A failed popular read says so; a row opens its area in place.
  assert.match(text(html(h(HelpPhoneView, { popular: { status: 'error', cards: [] }, areas: HELP_AREAS }))), /The most-read guides could not be read\./);
  const opened = [];
  const groups = html(h(HelpPhoneView, { popular: POPULAR, areas: HELP_AREAS, openArea: HELP_AREAS[0].id, onArea: (id) => opened.push(id) }));
  assert.match(text(groups), new RegExp(`${HELP_AREAS[0].title} ${HELP_AREAS[0].guides.length} guides Open`));
  assert.match(read('frontend/src/pages/docs/DocsLayout.jsx'), /\{!trimmedQuery && area && <AreaGuides area=\{area\} \/>\}/);
});

test('8. Plans (D755 §11): every row carries its own allowance; the member\'s licence marks one row', () => {
  const markup = html(PHONE_VIEWS.pricing());
  // D783: members have no daily limit, so no row names a day; each paid row says its month.
  assert.equal([...text(markup).matchAll(/ a day/g)].length, 0, 'no plan says a day allowance');
  assert.equal([...text(markup).matchAll(/ of AI each month: 25% of the price/g)].length, 3, 'Validate + Build, Advisor and Operating Partner each say their month');
  assert.equal([...markup.matchAll(/data-testid="pricing-phone-current"/g)].length, 1);
  // While the member's allowance is out, no row is current; the allowances still show.
  const noBudget = html(h(PricingPhoneView, { pricing: ready(PLANS), budget: LOADING, product: ready(PRODUCT) }));
  assert.doesNotMatch(noBudget, /pricing-phone-current/);
  assert.match(text(noBudget), /Includes \$5\.00 of AI each month/);
  // While the read is out, no row and no "$0.00": the plans say they could not be read.
  const out = html(h(PricingPhoneView, { pricing: UNREADABLE, budget: ready(BUDGET), product: ready(PRODUCT) }));
  assert.doesNotMatch(out, /pricing-phone-(current|tier)/);
  assert.doesNotMatch(text(out), /\$0\.00/);
  // The current row follows the licence, not a role ladder.
  const adv = text(html(h(PricingPhoneView, { pricing: ready(PLANS), budget: ready({ ...BUDGET, licence: 'advisor' }), product: ready(PRODUCT) })));
  assert.match(adv, /Advisor · Advisor Your plan · Includes \$12\.25 of AI each month/);
});

test('8. a gated Learning draws the coming-soon line and Browse, Articles open, and reads none of the others', () => {
  const markup = html(h(LearningPhoneView, { gated: true }));
  const t = text(markup);
  assert.ok(t.includes(COMING_SOON_LINE));
  assert.match(t, /Courses Coming soon › Articles and publications › Exercises and exams/);
  assert.doesNotMatch(t, /Continue learning|My programs|Upcoming webinars/);
  // The container makes no Learning read but Articles for a gated profile, as today.
  const home = read('frontend/src/pages/learning/LearningHome.jsx');
  assert.match(home, /useLearningRead\(readMe, \[\], \{ enabled: !gated, scope: 'me' \}\)/);
  assert.match(home, /useMyPrograms\(!gated\)/);
  assert.match(home, /\{!gated && <OpenPrograms \{\.\.\.programs\} \/>\}/);
});

test('8. Events: no Replay, and Hosting when the caller hosts an event', () => {
  const t = text(html(PHONE_VIEWS.events()));
  assert.doesNotMatch(t, /Replay/);
  assert.match(t, /Hosting Nov 2 · Founder dinner published · members Manage › New event/);
  assert.match(html(PHONE_VIEWS.events()), /href="\/events\/41\/manage"/);
  assert.ok(CANVAS_PAGES.events.chunk.includes("'Replay'"), 'the canvas draws the pill this departs from');
});

// --- 10. The Eadwyn button ---------------------------------------------------------

const PR2_FILES = [
  'frontend/src/pages/account/AccountPhonePage.jsx', 'frontend/src/pages/TrustCenterPage.jsx', 'frontend/src/pages/PerksPage.jsx',
  'frontend/src/pages/CalendarPage.jsx', 'frontend/src/pages/events/MyEventsPage.jsx', 'frontend/src/pages/learning/LearningHome.jsx',
  'frontend/src/pages/docs/DocsLayout.jsx', 'frontend/src/pages/account/PricingPhone.jsx', 'frontend/src/pages/ProductsPage.jsx',
];

test('10. A4m–A10m share one bar, which names itself to Eadwyn by its title; no page draws a button of its own', () => {
  const frame = read('frontend/src/pages/account/AccountPhonePage.jsx');
  assert.match(frame, /<PhoneBar back=\{\{ label: 'Back' \}\} title=\{page\.title\} sub=\{page\.sub\} eadwynLabel=\{page\.title\} \/>/);
  for (const f of PR2_FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /Open Eadwyn for this page/, `${f} draws an Eadwyn button of its own`);
    for (const bar of src.matchAll(/<PhoneBar [^>]*\/>/g)) assert.match(bar[0], /eadwynLabel=\{page\.title\}/, `${f}: ${bar[0]}`);
  }
  // The owner requested no rail on Perks or Learning home.
  const perks = read('frontend/src/pages/PerksPage.jsx');
  assert.doesNotMatch(perks, /<WorkerRail\b/);
  const learning = read('frontend/src/pages/learning/LearningHome.jsx');
  assert.match(learning, /<RailFrame data-testid="learning-home">\s*\{phone \? \(\s*<LearningPhoneView/);
  assert.doesNotMatch(learning, /<WorkerRail\b/);
  // The five pages that mount no rail still mount none (decision 12).
  for (const f of ['TrustCenterPage.jsx', 'CalendarPage.jsx', 'events/MyEventsPage.jsx', 'docs/DocsLayout.jsx', 'ProductsPage.jsx']) {
    assert.doesNotMatch(read(`frontend/src/pages/${f}`), /<WorkerRail\b/, `${f} gained a rail`);
  }
});

async function phoneButtons(element, { served, url }) {
  __resetEadwynPanelForTest();
  const out = {};
  // Stands in for a founder `WorkerRail`, which is what makes the panel available.
  const Rail = () => { useEadwynRailServes(served); return null; };
  const Probe = () => { out.panel = useEadwynPanel(); return null; };
  const mounted = await mountContracts(h(React.Fragment, null, h(Rail), h(Probe), element), url);
  try {
    await mounted.flush();
    const open = mounted.nodes().filter((n) => n.tagName === 'BUTTON' && mounted.props(n)['aria-label'] === 'Open Eadwyn for this page');
    if (open[0]) await act(async () => mounted.props(open[0]).onClick());
    return { count: open.length, label: out.panel?.label };
  } finally {
    await mounted.unmount();
    __resetEadwynPanelForTest();
  }
}

test('10. with the panel serving the viewer, the bar on /account, a section, /perks and /learning holds the button; otherwise none does', async () => {
  const cases = [
    ['/account', 'Account', h(AccountPhoneFrame, { view: 'index', sections: SECTIONS, renderPane: noop, index: h('div') })],
    ['/account/billing', 'Billing and orders', h(AccountPhoneFrame, { view: 'billing', sections: SECTIONS, renderPane: () => h('div') })],
    ['/perks', 'Perks', PHONE_VIEWS.perks()],
    ['/learning', 'Learning', PHONE_VIEWS.learning()],
  ];
  for (const [url, label, element] of cases) {
    const on = await phoneButtons(element, { served: true, url });
    assert.equal(on.count, 1, `${url}: no Eadwyn button for a served founder`);
    assert.equal(on.label, label, `${url}: the panel opened without the bar's title`);
    const off = await phoneButtons(element, { served: false, url });
    assert.equal(off.count, 0, `${url}: a viewer the panel does not serve got a button`);
  }
});

// --- 11 (PR 2). No read gains a scope ------------------------------------------------

test('11. the A4m–A10m phone views pass no company or venture to a read', () => {
  const block = (f, from, to) => {
    const src = read(f);
    const a = src.indexOf(from);
    const b = to ? src.indexOf(to, a) : src.length;
    assert.ok(a >= 0 && b > a, `${f}: the phone block moved`);
    return src.slice(a, b);
  };
  const blocks = [
    block('frontend/src/pages/TrustCenterPage.jsx', '// D700 (#1662) — A4m', 'export default function TrustCenterPage('),
    block('frontend/src/pages/PerksPage.jsx', ' * D700 (#1662) — A5m', ' * The standalone `/perks` page'),
    block('frontend/src/pages/CalendarPage.jsx', '// D700 (#1662) — A6m', 'export default function CalendarPage('),
    block('frontend/src/pages/events/MyEventsPage.jsx', '// D700 (#1662) — A7m', 'export default function MyEventsPage('),
    block('frontend/src/pages/learning/LearningHome.jsx', '// D700 (#1662) — A8m', '/** What the rail says'),
    block('frontend/src/pages/docs/DocsLayout.jsx', '// D700 (#1662) — A9m', 'export default function DocsLayout('),
    read('frontend/src/pages/account/PricingPhone.jsx'),
    read('frontend/src/pages/account/AccountPhonePage.jsx'),
  ];
  for (const b of blocks) assert.doesNotMatch(b, /ompany(Id|_id)|venture|useActiveCompany|getActiveCompanyId|X-Company-Id/);
  const pricing = read('frontend/src/pages/account/PricingPhone.jsx');
  // D755: the public read and the member's own allowance; no billing read, no ladder of typed prices.
  assert.match(pricing, /publicPricingApi\.plansAndPacks\(\)/);
  assert.match(pricing, /aiBudgetApi\.mine\(\)/);
  assert.match(pricing, /aiBudgetApi\.topUp\(\)/);
  assert.doesNotMatch(pricing, /from '[^']*data\/pricing'|TIER_PLANS|useBillingStatus/);
});
