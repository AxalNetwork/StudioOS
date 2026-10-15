/**
 * D700 (#1662) — the account menu's pages on a phone, and `/account` as a
 * tappable index of its sections, drawn to `Account Menu · Mobile.dc.html` (AM)
 * and `Account Mobile Page.dc.html` (AMP), boards A1m–A10m.
 *
 * This file holds PR 1: the A1m index and its two reads' lines, the `/account`
 * address rules, the end of D607's phone select, the founder plan's one name,
 * the A1m–A3m bars against the canvas, Usage's Not recorded storage line, and
 * that no phone read gains a company. `usePhoneWidth()` answers false in a
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

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const html = (el, entry = '/account') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const noop = () => {};
const ready = (data) => ({ status: 'ready', data, message: '', reload: noop, set: noop });
const LOADING = { status: 'loading', data: null, message: '', reload: noop, set: noop };
const UNREADABLE = { status: 'unreadable', data: null, message: 'The store is down.', reload: noop, set: noop };

// --- The canvas, parsed rather than retyped --------------------------------

const CANVAS = read('design/incoming/Account Mobile Page.dc.html');
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
  assert.match(page, /const want = accountPathFor\(\{ section: active, phone \}\);/);
  assert.match(page, /\}, \[active, phone, location\.pathname\]\);/, 'the URL effect re-runs when the path moves');
  assert.doesNotMatch(src, /const PATH_TO_SECTION/, 'the map moved to accountPhone.js');
  // On a phone a section is pushed, so Back returns to the index; desktop replaces, as before.
  assert.match(page, /navigate\(\{ pathname: accountPathFor\(\{ section: id, phone \}\) \}, \{ replace: !phone \}\)/);
  assert.match(page, /<ProfileCompletionBanner onJump=\{\(\) => setActive\('account'\)\} \/>/);
  // The phone view is drawn inside the rail frame, and the desktop keeps its heading.
  assert.ok(page.indexOf('<RailFrame') < page.indexOf('<AccountPhoneFrame'));
  assert.match(page, /\{phone \? \(\s*<AccountPhoneFrame[\s\S]*?\) : \(\s*<div className="min-w-0" data-testid="settings-page"[^>]*>\s*<h1 [^>]*>Account<\/h1>/);
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
const PRODUCT = { configured: true, product: { price_id: 'price_abc123', currency: 'usd', unit_amount: 1000 } };
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
  assert.match(markup, /<a href="\/checkout\?ai_topup=1"[^>]*data-testid="usage-add-tokens">Add tokens<\/a>/);
  assert.match(markup, /style="width:42%"/, 'Today\'s 7px bar');
  // Kept below, in today's form: the four cards the board does not draw.
  for (const card of ['usage-card-days', 'usage-card-where', 'usage-card-rates', 'usage-card-last-run']) assert.match(markup, new RegExp(`data-testid="${card}"`), card);
  assert.ok(markup.indexOf('usage-phone-storage') < markup.indexOf('usage-card-days'), 'the canvas sections come first');
  assert.doesNotMatch(markup, /usage-card-allowance|usage-card-models"|usage-card-storage/, 'the cards the sections replace are not drawn twice');
  // Without a configured top-up there is no button, and the line says why.
  const off = text(html(h(UsagePhoneView, { ...usageProps, product: ready({ configured: false }) })));
  assert.doesNotMatch(off, /Add tokens/);
  assert.match(off, /Top-ups are not available yet\. Runs use your included allowance only\./);
  // A paused allowance still says so, above the figures.
  const paused = text(html(h(UsagePhoneView, { ...usageProps, budget: ready({ ...BUDGET, held_for_review: [{ id: 1 }] }) })));
  assert.match(paused, /AI allowance Runs paused A run cost more than it held\./);
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
  // The rail stays mounted on a phone: the phone view is inside the frame, beside it.
  const page = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(page, /<RailFrame\s+rail=\{\(\s*<WorkerRail\s+workspace="Account"/);
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
