/**
 * D753 F6 (#1877) — Discover's grid and filter menu, with counts that are
 * true: every row's count is the length of the list that choice shows
 * (`filterCatalogue`, the one rule), taken after the member's search. No
 * Claude row that describes data Axal VC does not hold is drawn.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/connectors_discover_d753.test.mjs
 *
 * Nothing here calls the Worker: `fetch` throws, so an accidental read fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import { CATEGORY_ORDER, buildCatalogue } from '../src/pages/account/connectorsModel.js';
import {
  NO_CATEGORY, NO_FILTER, TYPES, activeFilters, cyclesOf, discoverFacets, discoverGrid, filterCatalogue, isNew, isReadOnly,
  isVerified, makerLine, menuKey, signInKind, topSlice,
} from '../src/pages/account/discoverModel.js';
import { ConnectorFilterMenu, ActiveFilters } from '../src/pages/account/ConnectorFilterMenu.jsx';
import { ConnectorCard } from '../src/pages/account/AccountConnectors.jsx';
import VerifiedBadge from '../src/ui/VerifiedBadge.jsx';
import { renderedText } from './_renderedText.mjs';

globalThis.fetch = () => { throw new Error('D753 F6 tests make no read'); };

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const routed = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/connectors?tab=discover'] }, el));
const NOW = Date.parse('2026-10-09T12:00:00Z');

// The D651 fixture (connectors_page_d651.test.mjs), unchanged.
const P = (key, display_name, integration_type, status, tier, auth_type, extra = {}) => ({
  key, display_name, integration_type, status, tier, auth_type,
  description: `${display_name} description.`, capabilities: [`${display_name} cap one`, `${display_name} cap two`],
  docs_url: `https://example.test/${key}`, has_implementation: status !== 'coming_soon', locked_for_user: false, ...extra,
});
const PROVIDERS = [
  P('hubspot', 'HubSpot', 'crm', 'live', 'growth', 'oauth2', { supports_pat: true }),
  P('calendly', 'Calendly', 'scheduling', 'live', 'free', 'oauth2', { supports_pat: true }),
  P('salesforce', 'Salesforce', 'crm', 'coming_soon', 'studio', 'oauth2'),
  P('carta', 'Carta', 'cap_table', 'beta', 'studio', 'oauth2', { locked_for_user: true }),
  P('slack', 'Slack', 'messaging', 'beta', 'free', 'oauth2'),
  P('crunchbase', 'Crunchbase', 'data_feed', 'beta', 'growth', 'api_key'),
  P('stripe', 'Stripe', 'data_feed', 'live', 'growth', 'oauth2'),
  P('affinity', 'Affinity', 'crm', 'coming_soon', 'studio', 'api_key'),
];
const ITEMS = [
  { uid: 'u-stripe', provider_key: 'stripe', status: 'active', last_synced_at: '2026-10-09 11:48:00', last_error: null, config: {} },
  { uid: 'u-hub', provider_key: 'hubspot', status: 'error', last_synced_at: '2026-10-07 12:00:00', last_error: 'invalid_grant: token expired', config: {} },
  { uid: 'u-slack', provider_key: 'slack', status: 'active', last_synced_at: null, last_error: null, config: {} },
];
const FIRST = { google: { configured: true, connected: true, google_email: 'me@example.test' }, microsoft: { configured: false, connected: false }, linkedin: null };
// D753 (#1955): the first-party rows' categories come from the Worker, not `FIRST_PARTY`.
const FIRST_CARDS = [{ key: 'google', category: 'Calendar and workspace' }, { key: 'microsoft', category: 'Calendar and workspace' }, { key: 'linkedin', category: 'Data' }];
const D651 = buildCatalogue({ providers: PROVIDERS, items: ITEMS, waitlist: [{ provider_key: 'affinity' }], firstParty: FIRST, firstPartyCards: FIRST_CARDS });

// Rows shaped like #1878's fields.
const EXTRA = [
  P('gusto', 'Gusto', 'custom', 'live', 'free', 'oauth2', { category: 'Payroll', feed_modules: [{ key: 'tech', href: '/build/tech-stack' }, { key: 'ops', href: '/build/ops' }], sign_in: { kind: 'key' }, added: '2026-07', made_by: { name: 'Axal VC' } }),
  P('mystery', 'Mystery', 'custom', 'live', 'free', 'oauth2', { feed_modules: [{ key: 'people', href: '/network/people' }, { key: 'x', href: null }, 'raise_round'], read_only: true, added: '2026-01' }),
  P('docsend', 'DocSend', 'custom', 'beta', 'free', 'oauth2', { category: 'Docs', feed_modules: [{ key: 'dr', href: '/raise/data-room' }], trust: { read_only: true }, verified: true, verified_on: '2026-10-12', tagline: 'Share your deck with a link.' }),
  P('notion', 'Notion', 'custom', 'live', 'free', 'oauth2', { category: 'Docs', verified: true, added: '2026-09' }),
];
const CAT = buildCatalogue({ providers: [...PROVIDERS, ...EXTRA], items: ITEMS, waitlist: [{ provider_key: 'affinity' }], firstParty: FIRST, firstPartyCards: FIRST_CARDS });
const SUGG = [{ provider_key: 'calendly', reason: 'Customer research has no recorded interviews yet.' }, { key: 'crunchbase' }, { provider_key: 'calendly' }];
const keys = (list) => list.map((p) => p.key);
const facetsFor = (cat, opts = {}) => discoverFacets(cat, opts.suggestions === undefined ? SUGG : opts.suggestions, { now: NOW, ...opts });
const whereRows = (f) => [f.all, ...f.categories, ...f.cycles, ...f.signIn];
const CLAUDE_ONLY = ['Topic', 'Department', 'Industry', 'Everyday life', 'Trending', 'Custom', 'In-chat UI', 'Desktop extensions'];

test('1. every count equals the list it would show, for every choice and search', () => {
  const base = facetsFor(CAT);
  const wheres = whereRows(base).map((r) => r.id);
  const types = base.types.map((r) => r.id);
  for (const q of ['', 'cal', 'zzz']) {
    for (const where of wheres) {
      for (const type of types) {
        const f = facetsFor(CAT, { q, where, type });
        for (const row of whereRows(f)) {
          assert.equal(row.count, filterCatalogue(CAT, { q, where: row.id, type, suggestions: SUGG, now: NOW }).length, `${q}|${row.id}|${type}`);
        }
        for (const row of f.types) {
          assert.equal(row.count, filterCatalogue(CAT, { q, where, type: row.id, suggestions: SUGG, now: NOW }).length, `${q}|${where}|${row.id}`);
        }
        const drawn = discoverGrid(CAT, { q, where, type, suggestions: SUGG, now: NOW }).flatMap((s) => s.cards || []);
        const list = filterCatalogue(CAT, { q, where, type, suggestions: SUGG, now: NOW });
        if (where === 'all' && type === 'all') {
          const shown = discoverGrid(CAT, { q, where, type, suggestions: SUGG, now: NOW }).filter((s) => s.id !== 'suggested').flatMap((s) => s.cards);
          assert.deepEqual(keys(shown).sort(), keys(list).sort(), `${q}: top and coming soon hold the whole list`);
        } else {
          assert.deepEqual(keys(drawn), keys(list), `${q}|${where}|${type}: the cards are the list, in order`);
        }
      }
    }
  }
});

test('2. the categories add up to All, and the D651 fixture reads as the canvas counts', () => {
  for (const [id] of TYPES) {
    const f = facetsFor(CAT, { type: id });
    if (f.all.count === null) continue;
    const sum = f.categories.reduce((n, r) => n + r.count, 0);
    assert.equal(sum, f.all.count, `type ${id}`);
  }
  const d = facetsFor(D651, { suggestions: [] });
  assert.equal(d.all.count, 11);
  assert.deepEqual(d.categories.map((r) => [r.label, r.count]),
    [['CRM', 3], ['Payments', 1], ['Calendar', 1], ['Calendar and workspace', 2], ['Messaging', 1], ['Cap table', 1], ['Data', 2]]);
});

test('3. which rows show: zero hides, All and the active choice stay', () => {
  const d = facetsFor(D651, { suggestions: [] });
  const t = Object.fromEntries(d.types.map((r) => [r.id, r.count]));
  for (const gone of ['read_only', 'new', 'verified', 'suggested']) assert.equal(gone in t, false, gone);
  assert.deepEqual(t, { all: 11, connected: 4, available: 2, live: 6, beta: 3, coming_soon: 2, needs_plan: 1 });
  const empty = facetsFor([], { suggestions: [] });
  assert.equal(empty.all.count, 0);
  assert.deepEqual(empty.types.map((r) => r.id), ['all']);
  const searched = facetsFor(D651, { suggestions: [], q: 'zzz', where: 'category:CRM', type: 'connected' });
  assert.ok(searched.categories.some((r) => r.id === 'category:CRM' && r.active && r.count === 0), 'the active category at zero');
  assert.ok(searched.types.some((r) => r.id === 'connected' && r.active && r.count === 0), 'the active type at zero');
});

test('4. unknown is not zero: a failed read reads Not recorded, with its reason, and stays', () => {
  const f = facetsFor(CAT, { suggestions: null, suggestionsNote: 'Choose a company in the sidebar to see what its empty modules could be fed by.' });
  const s = f.types.find((r) => r.id === 'suggested');
  assert.deepEqual([s.count, s.reason], [null, 'Choose a company in the sidebar to see what its empty modules could be fed by.']);
  const c = facetsFor(CAT, { connectionsRead: false }).types.find((r) => r.id === 'connected');
  assert.deepEqual([c.count, c.reason], [null, 'Your connections could not be read.']);
});

test('5. the category order: the Worker\'s when served, else CATEGORY_ORDER; Payroll appended, never dropped', () => {
  const served = [...CATEGORY_ORDER].reverse();
  const withOrder = facetsFor(CAT, { categoryOrder: served }).categories.map((r) => r.label);
  const present = withOrder.filter((c) => c !== 'Payroll' && c !== NO_CATEGORY);
  assert.deepEqual(present, served.filter((c) => present.includes(c)));
  const fallback = facetsFor(CAT).categories.map((r) => r.label);
  assert.deepEqual(fallback.filter((c) => CATEGORY_ORDER.includes(c)), CATEGORY_ORDER.filter((c) => fallback.includes(c)));
  for (const list of [withOrder, fallback]) {
    assert.ok(list.includes('Payroll'), 'Payroll is not in the order, and is appended');
    assert.equal(list.at(-1), NO_CATEGORY, 'a connector with no category counts last, under its own row');
  }
});

test('6. cycle: the first path segment of each feed href, once per connector', () => {
  const by = (k) => CAT.find((p) => p.key === k);
  assert.deepEqual(cyclesOf(by('gusto')), ['build'], 'two Build modules count the connector once');
  assert.deepEqual(cyclesOf(by('mystery')), ['network'], 'a null href and a string entry give nothing');
  assert.deepEqual(cyclesOf(by('docsend')), ['raise']);
  assert.deepEqual(cyclesOf(by('linkedin')), [], 'no feed_modules, no cycle');
  const f = facetsFor(CAT);
  assert.deepEqual(f.cycles.map((r) => [r.id, r.count]), [['cycle:build', 1], ['cycle:raise', 1], ['cycle:network', 1]]);
});

test('7. sign-in: sign_in.kind wins, then each fallback', () => {
  assert.equal(signInKind({ sign_in: { kind: 'key' }, auth_type: 'oauth2' }), 'key');
  assert.equal(signInKind({ connection_source: 'mercury_entity_connections', key: 'mercury' }), 'entity');
  assert.equal(signInKind({ first_party: true }), 'first_party');
  assert.equal(signInKind({ auth_type: 'api_key' }), 'key');
  assert.equal(signInKind({ key: 'hubspot', supports_pat: true }), 'oauth_or_key', 'token_first');
  assert.equal(signInKind({ key: 'calendly', auth_type: 'oauth2', supports_pat: true }), 'oauth_or_key');
  assert.equal(signInKind({ key: 'slack', auth_type: 'oauth2' }), 'oauth');
});

test('8. types: verified needs a real date, new counts 90 days from the month\'s first day, read-only reads two fields', () => {
  assert.equal(isVerified({ verified: true }), false);
  assert.equal(isVerified({ verified: true, verified_on: '2026-13-01' }), false);
  assert.equal(isVerified({ verified: true, verified_on: '2026-10-12' }), true);
  assert.equal(isVerified({ verified: false, verified_on: '2026-10-12' }), false);
  assert.equal(isNew({ added: '2026-07' }, Date.parse('2026-09-29T00:00:00Z')), true, 'day 90');
  assert.equal(isNew({ added: '2026-07' }, Date.parse('2026-09-30T00:00:00Z')), false, 'day 91');
  assert.equal(isNew({ added: '2026-7' }, NOW), false);
  assert.equal(isNew({ added: '2026-13' }, NOW), false);
  assert.equal(isReadOnly({ read_only: true }), true);
  assert.equal(isReadOnly({ trust: { read_only: true } }), true);
  assert.equal(isReadOnly({ pulls: [], status: 'read_only' }), false);
  assert.ok(!keys(filterCatalogue(D651, { type: 'available', now: NOW })).includes('carta'), 'a locked row is not available now');
});

test('9. no Claude-only row, in the facets, the menu or the phone sheet; Community is absent', () => {
  const f = facetsFor(CAT);
  const labels = [...whereRows(f), ...f.types].map((r) => r.label).join(' | ');
  const menu = routed(h(ConnectorFilterMenu, { facets: f, value: NO_FILTER, onChange() {}, initialOpen: true }));
  const sheet = routed(h(ConnectorFilterMenu, { facets: f, value: NO_FILTER, onChange() {}, phone: true, initialOpen: true, shown: 15 }));
  for (const word of CLAUDE_ONLY) {
    for (const [where, s] of [['facets', labels], ['menu', renderedText(menu)], ['sheet', renderedText(sheet)]]) {
      assert.equal(s.includes(word), false, `${word} in the ${where}`);
    }
  }
  for (const s of [labels, renderedText(menu), renderedText(sheet)]) assert.equal(s.includes('Community'), false);
});

test('10. topSlice: 8 cards, and how many more', () => {
  const n = (k) => Array.from({ length: k }, (_, i) => ({ key: `k${i}` }));
  assert.deepEqual([0, 8, 9].map((k) => topSlice(n(k)).more), [0, 0, 1]);
  assert.equal(topSlice(n(9)).cards.length, 8);
});

test('11. the menu keyboard', () => {
  const opts = { size: 5, subSize: 3, parents: { 2: 'cycle' }, checked: 1 };
  const at = (index, extra = {}) => ({ open: true, index, sub: null, subIndex: 0, ...extra });
  assert.equal(menuKey({ open: false }, 'ArrowDown', opts).index, 1, 'opens on the checked row');
  assert.equal(menuKey({ open: false }, 'ArrowUp', opts).index, 4, 'ArrowUp opens on the last row');
  assert.equal(menuKey(at(4), 'ArrowDown', opts).index, 0, 'wraps down');
  assert.equal(menuKey(at(0), 'ArrowUp', opts).index, 4, 'wraps up');
  assert.equal(menuKey(at(3), 'Home', opts).index, 0);
  assert.equal(menuKey(at(0), 'End', opts).index, 4);
  assert.equal(menuKey(at(2), 'ArrowRight', opts).sub, 'cycle', 'ArrowRight opens Cycle');
  assert.equal(menuKey(at(2), 'Enter', opts).sub, 'cycle', 'Enter on Cycle opens it');
  assert.equal(menuKey(at(1), 'Enter', opts).choose, true);
  for (const k of ['ArrowLeft', 'Escape']) {
    const r = menuKey(at(2, { sub: 'cycle', subIndex: 2 }), k, opts);
    assert.deepEqual([r.open, r.sub, r.index, r.prevent], [true, null, 2, true], `${k} returns to the parent row`);
  }
  assert.equal(menuKey(at(2, { sub: 'cycle', subIndex: 2 }), 'ArrowDown', opts).subIndex, 0, 'the submenu wraps');
  const esc = menuKey(at(1), 'Escape', opts);
  assert.deepEqual([esc.open, esc.returnFocus], [false, true], 'Escape at the top closes and returns focus');
  const tab = menuKey(at(1), 'Tab', opts);
  assert.deepEqual([tab.open, tab.returnFocus], [false, false], 'Tab closes and lets focus move on');
});

test('12. the desktop menu: groups, radios, the submenu, counts and dark classes', () => {
  const f = facetsFor(CAT);
  const out = routed(h(ConnectorFilterMenu, { facets: f, value: NO_FILTER, onChange() {}, initialOpen: true, initialSub: 'cycle' }));
  assert.match(out, /role="menu" aria-label="Filter connectors"[^>]*data-testid="connectors-filter-menu"/);
  assert.match(out, /role="group" aria-label="Category"/);
  assert.match(out, /role="group" aria-label="Type"/);
  assert.match(out, /role="menuitemradio" aria-checked="true"[^>]*data-testid="filter-where-all"/);
  assert.match(out, /role="menuitemradio" aria-checked="true"[^>]*data-testid="filter-type-all"/);
  assert.match(out, /role="menuitem" aria-haspopup="menu" aria-expanded="true"[^>]*data-testid="filter-parent-cycle"/);
  assert.match(out, /data-testid="connectors-filter-sub-cycle"/);
  assert.match(out, /ml-auto font-mono text-\[12px\] tabular-nums/);
  assert.match(out, /dark:bg-gray-900/);
  assert.match(out, /role="separator"/);
  const src = read('frontend/src/pages/account/ConnectorFilterMenu.jsx');
  assert.match(src, /useEscapeClose\(\(\) => close\(true\), \{ active: open && !phone \}\)/);
  assert.match(src, /if \(returnFocus\) trigger\.current\?\.focus\?\.\(\)/);
  const unknown = routed(h(ConnectorFilterMenu, { facets: facetsFor(CAT, { suggestions: null, suggestionsNote: 'No company chosen.' }), value: NO_FILTER, onChange() {}, initialOpen: true }));
  assert.match(unknown, /title="No company chosen\."[\s\S]*?Not recorded/);
});

test('13. the phone sheet: a dialog of four fieldsets of radios, 52px rows, and the count to show', () => {
  const out = routed(h(ConnectorFilterMenu, { facets: facetsFor(CAT), value: NO_FILTER, onChange() {}, phone: true, initialOpen: true, shown: 15 }));
  assert.match(out, /role="dialog"/);
  assert.match(out, /data-testid="connectors-filter-sheet"/);
  assert.match(out, /type="radio"[^>]*name="connectors-where"/);
  assert.match(out, /type="radio"[^>]*name="connectors-type"/);
  assert.equal((out.match(/<legend/g) || []).length, 4);
  assert.match(out, /min-h-\[52px\]/);
  assert.match(out, /aria-haspopup="dialog"/);
  const d651 = routed(h(ConnectorFilterMenu, { facets: facetsFor(D651, { suggestions: [] }), value: NO_FILTER, onChange() {}, phone: true, initialOpen: true, shown: filterCatalogue(D651, { now: NOW }).length }));
  assert.match(renderedText(d651), /Show 11 connectors/);
  assert.equal((d651.match(/<legend/g) || []).length, 3, 'a group with no row is not drawn: D651 has no cycle');
});

test('14. VerifiedBadge: drawn only with a real date, titled with what was checked', () => {
  const out = renderToStaticMarkup(h(VerifiedBadge, { on: '2026-10-12' }));
  assert.match(out, /role="img"/);
  assert.match(out, /aria-label="Verified"/);
  assert.match(out, /<title>Verified: a live connect on production passed on 12 October 2026\.<\/title>/);
  assert.match(out, /dark:text-violet-300/);
  assert.equal(renderToStaticMarkup(h(VerifiedBadge, { on: null })), '');
  assert.equal(renderToStaticMarkup(h(VerifiedBadge, { on: '2026-1-2' })), '');
  assert.equal(renderToStaticMarkup(h(VerifiedBadge, { on: '2026-02-30' })), '');
  assert.match(read('frontend/src/ui/index.js'), /export \{ default as VerifiedBadge, verifiedDay \} from '\.\/VerifiedBadge';/);
  assert.match(read('frontend/src/ui/README.md'), /`VerifiedBadge\.jsx`/);
});

test('15. the card: an article with one stretched link, decorative corners, lifted buttons, the maker only when named', () => {
  const by = (k) => CAT.find((p) => p.key === k);
  const add = routed(h(ConnectorCard, { p: by('calendly'), onNotify() {}, onUnnotify() {} }));
  assert.match(add, /<article[^>]*data-testid="connector-card-calendly" data-action="add"/);
  assert.match(add, /<a[^>]*href="\/account\/connectors\/calendly"[^>]*data-testid="connector-open-calendly"|<a[^>]*data-testid="connector-open-calendly"[^>]*href="\/account\/connectors\/calendly"/);
  assert.match(add, /after:absolute after:inset-0/);
  assert.match(add, /<span aria-hidden="true" class="grid h-\[26px\] w-\[26px\]/);
  assert.doesNotMatch(add, /<button/);
  const conn = routed(h(ConnectorCard, { p: by('stripe'), onNotify() {}, onUnnotify() {} }));
  assert.doesNotMatch(conn, /<button/);
  assert.match(conn, /<span class="sr-only"> · Connected<\/span>/);
  const notify = routed(h(ConnectorCard, { p: by('salesforce'), onNotify() {}, onUnnotify() {} }));
  assert.match(notify, /<button[^>]*class="[^"]*relative z-10[^"]*"[^>]*>Notify me/);
  assert.doesNotMatch(add, /by Calendly/);
  assert.equal(makerLine(by('calendly')), '');
  const gusto = routed(h(ConnectorCard, { p: by('gusto'), onNotify() {}, onUnnotify() {} }));
  assert.match(renderedText(gusto), /by Axal VC/);
  assert.doesNotMatch(routed(h(ConnectorCard, { p: by('notion') })), /aria-label="Verified"/, 'verified: true with no date draws no badge');
  const docsend = routed(h(ConnectorCard, { p: by('docsend') }));
  assert.match(docsend, /<span class="relative z-10"><svg role="img" aria-label="Verified"/);
  assert.match(docsend, /line-clamp-2[^>]*>Share your deck with a link\./, 'the tagline, clamped');
  const chips = renderToStaticMarkup(h(ActiveFilters, { chips: activeFilters({ where: 'category:CRM', type: 'connected' }, facetsFor(CAT, { where: 'category:CRM', type: 'connected' })), onClear() {} }));
  assert.match(chips, /aria-label="Clear CRM"[\s\S]*aria-label="Clear Connected"[\s\S]*Clear filters/);
  assert.equal(renderToStaticMarkup(h(ActiveFilters, { chips: [], onClear() {} })), '');
});

test('16. nothing is wider than a 390px phone, and the grid has two columns at most', () => {
  const page = read('frontend/src/pages/account/AccountConnectors.jsx');
  const block = page.slice(page.indexOf('const discover = ('), page.indexOf('let content;'));
  const sources = {
    'ui/VerifiedBadge.jsx': read('frontend/src/ui/VerifiedBadge.jsx'),
    'discoverModel.js': read('frontend/src/pages/account/discoverModel.js'),
    'ConnectorFilterMenu.jsx': read('frontend/src/pages/account/ConnectorFilterMenu.jsx'),
    'the Discover block': block,
  };
  for (const [name, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/(?:^|[\s"'`])(?:min-|max-)?w-\[(\d+)px\]/g)) assert.ok(Number(m[1]) <= 358, `${name}: ${m[0].trim()}`);
    assert.doesNotMatch(src, /overflow-x-auto/, name);
  }
  assert.doesNotMatch(page, /xl:grid-cols-3/);
  assert.match(block, /grid grid-cols-1 gap-2\.5 sm:grid-cols-2/);
});
