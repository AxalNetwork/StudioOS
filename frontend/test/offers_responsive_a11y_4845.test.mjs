/**
 * #4845 (D4845) — Offers UI/UX audit 5/5: responsive and accessibility QA,
 * pinned as markup and class-level regressions (no screenshot harness).
 *
 * What is proved, against the Offers v2 canvas (OF-08 states, OF-09 phone,
 * OF-10 rules):
 *   1. Zone navigation: below 640px the grouped row is one 44px switcher that
 *      names the current zone (OF-09a); it opens the same routes under visible
 *      group labels, one `aria-current`, Escape closes it and returns focus.
 *      From 640px the grouped row is drawn, its pills and labels at 12px.
 *   2. Failed reads: Proof, Audience fit, Visibility and Product testing say
 *      "<what> could not be read." with a written sentence and Try again, and
 *      never the response's text (#4844's two follow-ups: Visibility's older
 *      card, and Product testing's raw message). An unlinked account still
 *      gets its own line. Loading is announced in words.
 *   3. Failed save: Product testing's Submit for approval says a fixed
 *      sentence, not the response's text.
 *   4. Phone layouts: Visibility's attribution table becomes labelled records
 *      with named selects; Perk lifecycle becomes labelled records; no Offers
 *      zone file keeps a sideways-scrolling table.
 *   5. Keyboard: Catalog's row menu moves focus in, Arrow keys move, Escape
 *      returns focus to ⋯.
 *   6. Targets, type and contrast: primaries 48px and other actions 44px on a
 *      phone, the Sheet's × 44px on a phone, no text under 12px and no
 *      `axal-faint` (2.6:1) text in the Offers zone files, and the greys the
 *      zones use for secondary text measured at 4.5:1 or more.
 *   7. Dark mode: every new surface carries its `dark:` pair.
 *   8. Heading order: a zone's headings start at h2 under the shell's h1 and
 *      never skip a level.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/offers_responsive_a11y_4845.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { stubApi, httpError } from './_offers_4688.mjs';
import { codeOnly } from './_codeOnly.mjs';
import ZoneNav from '../src/workspaces/ZoneNav.jsx';
import { bucketsFor } from '../src/workspaces/shellConfig.js';
import { MineTab } from '../src/pages/ServiceCatalogPage.jsx';
import ProofZone from '../src/pages/partner/offers/ProofZone.jsx';
import AudienceFitZone from '../src/pages/partner/offers/AudienceFitZone.jsx';
import VisibilityZone from '../src/pages/partner/offers/VisibilityZone.jsx';
import TestingZone from '../src/pages/partner/offers/TestingZone.jsx';
import { READ_FAILURE_DEFAULT, readFailureText, zoneReadError } from '../src/pages/partner/offers/useGuardedWrite.jsx';
import { offerButtonClass, offerGhostButtonClass, offerInputClass, offerDangerButtonClass } from '../src/pages/partner/kit.jsx';
import { Instrument } from '../src/workspaces/canvasKit.jsx';
import Sheet from '../src/ui/Sheet.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const OFFERS = bucketsFor('partner').find((b) => b.prefix === '/offers');

// ── A stub DOM with attributes, focus and selectors (the #4844 suite's) ──────

function matches(n, selector) {
  return selector.split(',').some((part) => {
    const sel = part.trim();
    const tag = /^[a-z]+/i.exec(sel)?.[0];
    if (tag && n.tagName !== tag.toUpperCase()) return false;
    const nots = [...sel.matchAll(/:not\(\[([\w-]+)(?:="([^"]*)")?\]\)/g)];
    const rest = sel.replace(/:not\([^)]*\)/g, '');
    const has = [...rest.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    const attr = (name) => n.attrs?.get(name);
    for (const [, name, value] of has) {
      if (!n.attrs?.has(name) || (value !== undefined && attr(name) !== value)) return false;
    }
    for (const [, name, value] of nots) {
      if (n.attrs?.has(name) && (value === undefined || attr(name) === value)) return false;
    }
    return Boolean(tag || has.length);
  });
}

async function mount(element, path = '/offers') {
  const restoreDoc = installDocument();
  const keydown = [];
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = createElement(tag);
    n.attrs = new Map();
    n.setAttribute = function setAttribute(k, v) { this.attrs.set(k, String(v)); };
    n.getAttribute = function getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; };
    n.hasAttribute = function hasAttribute(k) { return this.attrs.has(k); };
    n.removeAttribute = function removeAttribute(k) { this.attrs.delete(k); };
    n.querySelectorAll = function querySelectorAll(sel) { return walk(this).slice(1).filter((c) => c.nodeType === 1 && matches(c, sel)); };
    n.querySelector = function querySelector(sel) { return this.querySelectorAll(sel)[0] || null; };
    n.focus = function focus() { document.activeElement = this; };
    n.contains = function contains(o) { for (let p = o; p; p = p.parentNode) if (p === this) return true; return false; };
    Object.defineProperty(n, 'children', { get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    Object.defineProperty(n, 'isConnected', { get() { let p = this; while (p.parentNode) p = p.parentNode; return p === document.body; } });
    return n;
  };
  document.body = document.createElement('body');
  document.body.style = { overflow: 'auto', paddingRight: '' };
  document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
  document.addEventListener = (type, fn) => { if (type === 'keydown') keydown.push(fn); };
  document.removeEventListener = (type, fn) => { const i = keydown.indexOf(fn); if (i >= 0) keydown.splice(i, 1); };
  const page = document.createElement('div');
  document.body.appendChild(page);
  const container = document.createElement('div');
  page.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [path] }, element)); });
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const nodes = () => walk(container);
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const button = (label) => nodes().find((n) => n.tagName === 'BUTTON' && text(n).trim() === label);
  const labelled = (label) => {
    const l = nodes().find((n) => n.tagName === 'LABEL' && text(n).trim().startsWith(label));
    return l?.childNodes.find((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
  };
  const v = {
    page, nodes, props, byTestId, button, labelled,
    text: () => text(container),
    textOf: text,
    // Settles the stubbed API's promises and React's updates; no timer, no clock.
    async flush() { for (let i = 0; i < 2; i += 1) await act(async () => { for (let j = 0; j < 10; j += 1) await Promise.resolve(); }); },
    async press(label) {
      const b = button(label);
      if (!b) throw new Error(`Missing button: ${label}`);
      b.focus();
      await act(async () => { props(b).onClick?.({ stopPropagation() {}, preventDefault() {} }); });
    },
    async fill(label, value) {
      const c = labelled(label);
      if (!c) throw new Error(`Missing field: ${label}`);
      await act(async () => { props(c).onChange({ target: { value } }); });
    },
    value: (label) => props(labelled(label)).value,
    async key(key, extra = {}) {
      let prevented = false;
      await act(async () => { for (const fn of [...keydown]) fn({ key, defaultPrevented: false, preventDefault() { prevented = true; }, ...extra }); });
      return prevented;
    },
    async tab(dialog, shiftKey = false) {
      await act(async () => { props(dialog).onKeyDown({ key: 'Tab', shiftKey, preventDefault() {} }); });
    },
    async unmount() { await act(async () => root.unmount()); restoreDoc(); },
  };
  await v.flush();
  return v;
}
const RAW = 'D1_ERROR: no such column: secret_internal_flag at offset 42';
const headingsOf = (v, root) => (root ? v.nodes().filter((n) => /^H[1-6]$/.test(n.tagName) && root.contains(n)) : [])
  .map((n) => Number(n.tagName[1]));

/** h2 first under the shell's h1, never an h1 inside a zone, never a skipped level. */
function assertHeadingOrder(levels, where) {
  assert.ok(levels.length > 0, `${where} has headings`);
  assert.equal(levels[0], 2, `${where} starts at h2 under the shell's h1`);
  assert.ok(!levels.includes(1), `${where} draws no second h1`);
  for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] - levels[i - 1] <= 1, `${where} skips from h${levels[i - 1]} to h${levels[i]}`);
}

// ── 1. Zone navigation (OF-09a) ──────────────────────────────────────────────

const navMarkup = (path, activeSlug) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [path] }, h(ZoneNav, { bucket: OFFERS, role: 'partner', activeSlug })),
);
const tag = (html, testid) => (html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`)) || [''])[0];

// Mutation checked: the switcher not hidden from 640px (fails); the grouped row not hidden below 640px (fails);
// the switcher under 44px (fails); the switcher not naming the zone (fails); a pill or group label back at 10–11px (fails).
test('zone row: below 640px one 44px switcher names the zone; from 640px the grouped row, at 12px', () => {
  const html = navMarkup('/offers/proof', undefined);
  assert.match(tag(html, 'zone-switcher'), /class="sm:hidden"/, 'the switcher is the phone row');
  assert.match(tag(html, 'zone-nav-groups'), /class="hidden [^"]*sm:flex/, 'the grouped row is from 640px');
  const button = tag(html, 'zone-switcher-button');
  assert.match(button, /min-h-\[44px\]/);
  assert.match(button, /w-full/);
  assert.match(button, /aria-expanded="false"/);
  assert.match(button, /dark:bg-gray-900/, 'the switcher has its dark ground');
  const named = html.slice(html.indexOf('data-testid="zone-switcher-button"'), html.indexOf('</button>', html.indexOf('data-testid="zone-switcher-button"')));
  assert.match(named.replace(/<[^>]+>/g, ''), /Offers · Proof, choose another section/, 'the button says where you are and what it does');
  assert.match(navMarkup('/offers', null).replace(/<[^>]+>/g, ''), /Offers · Overview/, 'the root names Overview');
  // The desktop pills and group labels: 12px, never below.
  const row = html.slice(html.indexOf('data-testid="zone-nav-groups"'));
  assert.ok(!/text-\[(9|10|10\.5|11|11\.5)px\]/.test(row), 'nothing in the row is under 12px');
  for (const zone of OFFERS.zones) assert.match(tag(html, `link-zone-${zone.slug}`), /text-\[12px\]/, `${zone.slug} pill is 12px`);
});

// Mutation checked: the panel's links not closing the panel (fails); Escape not returning focus (fails); a group
// label not visible / not naming its group (fails); two links current (fails).
test('zone row: the switcher opens every zone under a visible group label, one current, and Escape gives focus back', async () => {
  const v = await mount(h(ZoneNav, { bucket: OFFERS, role: 'partner' }), '/offers/visibility');
  try {
    const button = v.byTestId('zone-switcher-button');
    button.focus();
    await act(async () => { v.props(button).onClick(); });
    assert.equal(v.props(button)['aria-expanded'], true);
    const panel = v.byTestId('zone-switcher-panel');
    assert.equal(v.props(button)['aria-controls'], v.props(panel).id, 'the button controls the panel');
    const links = panel.querySelectorAll('a');
    assert.deepEqual(links.map((a) => v.textOf(a).trim()), ['Overview', 'Catalog', 'Perk deals', 'Proof', 'Visibility', 'Audience fit', 'Product testing']);
    for (const a of links) assert.match(v.props(a).className, /min-h-\[44px\]/, `${v.textOf(a)} is a 44px target`);
    const current = links.filter((a) => v.props(a)['aria-current'] === 'page');
    assert.deepEqual(current.map((a) => v.textOf(a).trim()), ['Visibility'], 'one link is current');
    // Each group is named by its visible label.
    const groups = v.nodes().filter((n) => v.props(n).role === 'group' && panel.contains(n));
    assert.deepEqual(groups.map((g) => v.textOf(v.nodes().find((n) => v.props(n).id === v.props(g)['aria-labelledby'])).trim()), ['Sell', 'Prove', 'Target', 'Test']);
    // Escape inside the panel closes it and returns focus to the button.
    links[2].focus();
    await act(async () => { v.props(panel).onKeyDown({ key: 'Escape', preventDefault() {} }); });
    assert.equal(Boolean(v.byTestId('zone-switcher-panel')), false, 'Escape closed the list');
    assert.ok(document.activeElement === v.byTestId('zone-switcher-button'), 'focus went back to the switcher');
    // Choosing a zone closes the list.
    await act(async () => { v.props(v.byTestId('zone-switcher-button')).onClick(); });
    await act(async () => { v.props(v.byTestId('link-zone-switch-proof')).onClick?.({ preventDefault() {}, button: 0 }); });
    assert.equal(Boolean(v.byTestId('zone-switcher-panel')), false, 'choosing a zone closed the list');
  } finally { await v.unmount(); }
});

// ── 2. Failed reads, loading (OF-08) ─────────────────────────────────────────

test('readFailureText: a written sentence by kind, never the response; the unlinked refusal is kept for its own line', () => {
  assert.equal(readFailureText(httpError(500, RAW)), READ_FAILURE_DEFAULT);
  assert.equal(readFailureText(httpError(400, RAW)), READ_FAILURE_DEFAULT);
  assert.match(readFailureText(httpError(401, RAW)), /Sign in again/);
  assert.match(readFailureText(httpError(403, RAW)), /cannot read it/);
  assert.match(readFailureText(httpError(429, RAW)), /Wait a moment/);
  assert.match(readFailureText(new TypeError('Failed to fetch')), /could not be reached/);
  assert.equal(zoneReadError(httpError(400, 'No partner profile is attached to this account')), 'No partner profile is attached to this account');
  assert.equal(zoneReadError(httpError(503, RAW)), READ_FAILURE_DEFAULT);
});

const ZONES = [
  ['Proof', ProofZone, { listPartnerProof: async () => { throw httpError(500, RAW); } }],
  ['Audience fit', AudienceFitZone, { listPartnerFitRules: async () => { throw httpError(500, RAW); } }],
  ['Visibility', VisibilityZone, {
    getPartnerVisibility: async () => { throw httpError(500, RAW); },
    listPartnerAttribution: async () => ({ items: [], page: 1, page_size: 20, total: 0 }),
  }],
];

// Mutation checked: Visibility without `what` (draws "This did not load", fails); a zone keeping `e?.message` as its
// error (the raw text appears, fails); `zoneReadError` returning the raw message (fails); Testing back on `refusalText` (fails).
for (const [name, Zone, methods] of ZONES) {
  test(`${name}: a failed read is #5129's Unavailable, with a written sentence and Try again, never the response's text`, async () => {
    const restore = stubApi(methods);
    const v = await mount(h(Zone));
    try {
      const text = v.text();
      const state = v.nodes().find((n) => v.props(n)['data-platform-state'] === 'unavailable' && v.props(n).role === 'alert');
      assert.ok(state, 'Unavailable, announced');
      assert.match(v.textOf(state), /^Unavailable/, 'the state says its word, not only its colour');
      assert.ok(v.textOf(state).includes(READ_FAILURE_DEFAULT), 'the written sentence');
      assert.ok(!text.includes(RAW) && !/D1_ERROR|secret_internal_flag/.test(text), 'the response text never reaches the member');
      assert.ok(!text.includes('This did not load'), 'not the older card');
      assert.ok(state.querySelectorAll('button').some((b) => /Try again/.test(v.textOf(b))), 'Try again is offered');
      assert.ok(!v.nodes().some((n) => /-empty$/.test(v.props(n)['data-testid'] || '')), 'never the empty state');
    } finally { await v.unmount(); restore(); }
  });
}

test('Product testing: a failed read says a written sentence inside Unavailable, not the server\'s words', async () => {
  const v = await mount(h(TestingZone, { api: { programmes: async () => { throw httpError(500, 'Programme row 7 failed CHECK constraint partner_scope'); } } }));
  try {
    const text = v.text();
    assert.ok(v.nodes().some((n) => v.props(n)['data-platform-state'] === 'unavailable'), 'Unavailable');
    assert.ok(text.includes(READ_FAILURE_DEFAULT));
    assert.ok(!/CHECK constraint|partner_scope|row 7/.test(text), 'the raw message is gone (#4844 follow-up)');
    assert.ok(!v.byTestId('testing-empty'), 'not the empty state');
  } finally { await v.unmount(); }
});

test('an unlinked account still reads its own line, not Unavailable', async () => {
  const restore = stubApi({ listPartnerFitRules: async () => { throw httpError(400, 'No partner profile is attached to this account'); } });
  const v = await mount(h(AudienceFitZone));
  try {
    assert.ok(v.byTestId('no-partner-profile'));
    assert.ok(!v.nodes().some((n) => v.props(n)['data-platform-state'] === 'unavailable'));
  } finally { await v.unmount(); restore(); }
});

test('Visibility: loading is announced in words, as the other zones are', async () => {
  const restore = stubApi({ getPartnerVisibility: () => new Promise(() => {}), listPartnerAttribution: () => new Promise(() => {}) });
  const v = await mount(h(VisibilityZone));
  try {
    const busy = v.nodes().find((n) => v.props(n)['data-section-state'] === 'loading');
    assert.ok(busy, 'the shared loading state');
    assert.equal(v.props(busy).role, 'status');
    assert.match(v.textOf(busy), /Loading your surfaces…/);
  } finally { await v.unmount(); restore(); }
});

// ── 3. Failed save (OF-08) ───────────────────────────────────────────────────

// Mutation checked: Submit's failure back on `refusalText(e, …)` shows the raw text (fails).
test('Product testing: a refused Submit for approval says a fixed sentence and keeps the programme', async () => {
  const programme = { uid: 'p1', product_name: 'Pricing beta', status: 'draft', places: 5, applicant_count: 0 };
  const v = await mount(h(TestingZone, { api: {
    programmes: async () => ({ items: [programme] }),
    submit: async () => { throw httpError(500, 'Worker threw at submitProgramme: TypeError undefined'); },
  } }));
  try {
    const submit = v.byTestId('testing-submit-p1');
    assert.ok(submit, 'a draft offers Submit for approval');
    await act(async () => { await v.props(submit).onClick(); });
    await v.flush();
    const note = v.textOf(v.byTestId('testing-note'));
    assert.match(note, /^Pricing beta was not sent to HQ\. Axal could not save this right now\. Try again\.$/);
    assert.ok(!/Worker threw|TypeError/.test(v.text()));
    assert.ok(v.byTestId('testing-programme-p1'), 'the programme is still listed');
  } finally { await v.unmount(); }
});

// ── 4. Phone layouts (OF-09, OF-10) ──────────────────────────────────────────

const VISIBILITY = {
  getPartnerVisibility: async () => ({ items: [{ id: 1, name: 'Axal directory', kind: 'directory', is_active: 1, engagement_count: 2, won_value: 5000 }], unattributed_count: 1 }),
  listPartnerAttribution: async () => ({ items: [{ engagement_id: 7, engagement_uid: 'e7', need_title: 'Pricing sprint', founder_name: 'Example Co', status: 'active', price: 4000, surface_id: null }], page: 1, page_size: 20, total: 1 }),
};

// Mutation checked: the attribution table not hidden below 640px (fails); the cards not hidden from 640px (fails);
// the select without its name (fails); a header cell without scope (fails); heading levels skipping (fails).
test('Visibility: on a phone each engagement is a labelled record with a named select; the table is from 640px, with th scope', async () => {
  const restore = stubApi(VISIBILITY);
  const v = await mount(h(VisibilityZone));
  try {
    assert.match(v.props(v.byTestId('attribution-table')).className, /\bhidden\b[^"]*\bsm:table\b/);
    assert.match(v.props(v.byTestId('attribution-cards')).className, /\bsm:hidden\b/);
    const card = v.byTestId('attribution-card-7');
    assert.match(v.textOf(card), /Pricing sprint[\s\S]*\$4K[\s\S]*Example Co · active/);
    const selects = v.nodes().filter((n) => n.tagName === 'SELECT' && /came from$/.test(v.props(n)['aria-label'] || ''));
    assert.equal(selects.length, 2, 'the table and the record each name their select');
    assert.equal(v.props(selects[0])['aria-label'], 'Where Pricing sprint came from');
    for (const s of selects) assert.match(v.props(s).className, /max-sm:min-h-\[44px\]/);
    const ths = v.nodes().filter((n) => n.tagName === 'TH');
    assert.ok(ths.length >= 9 && ths.every((n) => v.props(n).scope === 'col'), 'every header cell names its scope');
    assertHeadingOrder(headingsOf(v, v.byTestId('visibility-sources')?.parentNode), 'Visibility');
  } finally { await v.unmount(); restore(); }
});

// Mutation checked: `stack` not hiding the grid below 640px (fails); the records not labelled by the column (fails);
// Perk lifecycle not passing `stack` (fails); an Instrument without `stack` growing records (fails).
test('Perk lifecycle: below 640px each perk is a labelled record; other Instrument tables are unchanged', () => {
  const props = { testid: 'perk-lifecycle', title: 'Perk lifecycle', cols: '1fr 1fr', head: ['Perk', 'State'],
    rows: [{ key: 'a', cells: [{ text: 'Free board-pack review' }, { pill: 'Live', pillTone: 'ok' }] }] };
  const html = renderToStaticMarkup(h(Instrument, { ...props, stack: true }));
  assert.match(tag(html, 'perk-lifecycle-records'), /class="[^"]*sm:hidden/);
  assert.match(html, /class="-mx-1 overflow-x-auto px-1 hidden sm:block"/, 'the grid is from 640px');
  assert.match(html.replace(/<[^>]+>/g, '|'), /\|Perk\|+Free board-pack review\|+State\|+Live/, 'each cell under its column name');
  const plain = renderToStaticMarkup(h(Instrument, props));
  assert.ok(!plain.includes('perk-lifecycle-records') && plain.includes('class="-mx-1 overflow-x-auto px-1"'), 'opt-in only');
  assert.match(codeOnly(read('src/pages/PerksPage.jsx')), /testid="perk-lifecycle"\s+stack\s/, 'Perk deals asks for it');
});

test('no Offers zone file keeps a table that scrolls sideways on a phone', () => {
  for (const f of ['VisibilityZone', 'ProofZone', 'AudienceFitZone', 'TestingZone']) {
    assert.ok(!/overflow-x-auto/.test(codeOnly(read(`src/pages/partner/offers/${f}.jsx`))), `${f} scrolls sideways`);
  }
});

// ── 5. Keyboard: Catalog's row menu ──────────────────────────────────────────

// Mutation checked: opening not moving focus in (fails); ArrowDown not moving (fails); no wrap (fails); Escape not
// closing or not returning focus (fails); the trigger without aria-haspopup (fails).
test('Catalog: the row menu takes focus, moves by Arrow keys, and Escape returns focus to ⋯', async () => {
  const restore = stubApi({ listServiceOfferings: async () => ({ items: [{ id: 1, title: 'Board-pack review', category: 'finance', price_cents: 250000, price_usd: 2500, engagement_model: 'fixed_fee', is_active: 1 }], page: 1, page_size: 50, total: 1 }) });
  const v = await mount(h(MineTab, { user: { role: 'partner' } }));
  try {
    const triggers = v.nodes().filter((n) => v.props(n)['data-testid'] === 'catalog-more-1');
    assert.equal(v.props(triggers[0])['aria-haspopup'], 'menu');
    triggers[1].focus();
    await act(async () => { v.props(triggers[1]).onClick(); });
    const menus = v.nodes().filter((n) => v.props(n)['data-testid'] === 'catalog-menu-1');
    const menu = menus[menus.length - 1];
    assert.equal(v.props(menu).role, 'menu');
    assert.equal(v.props(menu)['aria-label'], 'Actions for Board-pack review');
    const items = menu.querySelectorAll('[role="menuitem"]');
    assert.ok(document.activeElement === items[0], 'focus moved to the first item');
    for (const i of items) assert.match(v.props(i).className, /max-sm:min-h-\[44px\][^"]*focus-visible:outline-amber-700/);
    const key = async (k) => act(async () => { v.props(menu).onKeyDown({ key: k, currentTarget: menu, preventDefault() {}, stopPropagation() {} }); });
    await key('ArrowDown');
    assert.equal(v.textOf(document.activeElement).trim(), 'Delete');
    await key('ArrowDown');
    assert.equal(v.textOf(document.activeElement).trim(), 'Unlist', 'the list wraps');
    await key('End');
    assert.equal(v.textOf(document.activeElement).trim(), 'Delete');
    await key('Escape');
    assert.equal(v.nodes().filter((n) => v.props(n)['data-testid'] === 'catalog-menu-1').length, 0, 'Escape closed the menu');
    assert.equal(v.props(document.activeElement)['data-testid'], 'catalog-more-1', 'focus returned to ⋯');
    assert.equal(v.props(v.byTestId('catalog-edit-1'))['aria-label'], 'Edit Board-pack review', 'each Edit names its service');
  } finally { await v.unmount(); restore(); }
});

// ── 6. Targets, type and contrast ────────────────────────────────────────────

const lum = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Mutation checked: the primary back at 44px (fails); the ghost or input losing its phone height (fails); the
// Sheet's × back at 36px on a phone (fails).
test('touch targets: the primary is 48px on a phone, every other action and field 44px, the Sheet × 44px', () => {
  assert.match(offerButtonClass, /max-sm:min-h-\[48px\]/);
  for (const c of [offerGhostButtonClass, offerDangerButtonClass, offerInputClass]) assert.match(c, /max-sm:min-h-\[44px\]/);
  for (const c of [offerButtonClass, offerGhostButtonClass, offerDangerButtonClass]) assert.match(c, /focus-visible:outline-amber-700/);
  const html = renderToStaticMarkup(h(Sheet, { title: 'Who is a great fit?', onClose() {}, testId: 'fit' }, h('p', null, 'Body')));
  const close = tag(html, 'fit-close');
  assert.match(close, /max-sm:h-11 max-sm:w-11/);
  assert.match(close, /focus-visible:outline-2/);
});

// Mutation checked: an `axal-faint` text or a 10–11px class back in an Offers zone file (fails); a grey that reads
// under 4.5:1 (fails).
test('type and contrast: no Offers zone text under 12px or in axal-faint, and the secondary greys read at 4.5:1', () => {
  const files = ['partner/offers/VisibilityZone', 'partner/offers/ProofZone', 'partner/offers/AudienceFitZone', 'partner/offers/TestingZone',
    'partner/offers/useGuardedWrite'].map((f) => `src/pages/${f}.jsx`).concat(['src/workspaces/partner/OfferReadiness.jsx']);
  for (const f of files) {
    const src = codeOnly(read(f));
    const pass = f.includes('AudienceFitZone') ? src.replace(/function PassReasons[\s\S]*?\n}\n/, '') : src; // #4836's overlay
    assert.ok(!/text-axal-faint/.test(pass), `${f} draws text in axal-faint (2.6:1)`);
    assert.ok(!/text-\[(9|9\.5|10|10\.5|11)px\]/.test(pass), `${f} draws text under 12px`);
  }
  // The greys these files use for secondary text, on white and on the ground.
  for (const [ink, ground] of [['#4b5563', '#ffffff'], ['#6b6577', '#ffffff'], ['#6b6577', '#f4f3f7'], ['#4b5563', '#f4f3f7'], ['#b45309', '#ffffff']]) {
    assert.ok(ratio(ink, ground) >= 4.5, `${ink} on ${ground} reads ${ratio(ink, ground).toFixed(2)}:1`);
  }
  // And the dark pair: gray-400 on the dark card.
  assert.ok(ratio('#9ca3af', '#111827') >= 4.5);
  assert.ok(ratio('#a1a1aa', '#ffffff') < 4.5, 'axal-faint really is below AA, which is why it is gone');
});

// ── 7. Dark mode ─────────────────────────────────────────────────────────────

test('dark mode: the switcher, its panel, the attribution records and the stacked labels carry their dark pairs', () => {
  const nav = read('src/workspaces/ZoneNav.jsx');
  const sw = nav.slice(nav.indexOf('function ZoneSwitcher'));
  for (const cls of ['dark:bg-gray-900', 'dark:border-gray-700', 'dark:text-gray-100', 'dark:text-gray-400', 'dark:aria-[current=page]:bg-amber-950']) assert.ok(sw.includes(cls), `switcher lacks ${cls}`);
  const vis = read('src/pages/partner/offers/VisibilityZone.jsx');
  const card = vis.slice(vis.indexOf('function AttributionCard'), vis.indexOf('export default function'));
  assert.ok(card.includes('dark:border-gray-800') && card.includes('dark:text-gray-400'));
  const kit = read('src/workspaces/canvasKit.jsx');
  assert.ok(kit.slice(kit.indexOf('stack ? (')).slice(0, 900).includes('dark:text-gray-400'));
});

// ── 8. Heading order on representative flows ─────────────────────────────────

test('heading order: populated Proof, Audience fit and Product testing start at h2 and never skip', async () => {
  const cases = [
    ['Proof', h(ProofZone), { listPartnerProof: async () => ({ items: [{ id: 1, title: 'Pricing reset', kind: 'case_study', consents: [] }], page: 1, page_size: 20, total: 1 }) }],
    ['Audience fit', h(AudienceFitZone), { listPartnerFitRules: async () => ({ items: [{ id: 1, kind: 'best_fit', value: 'B2B SaaS', statement: '', is_active: 1 }] }) }],
    ['Product testing', h(TestingZone, { api: { programmes: async () => ({ items: [{ uid: 'p1', product_name: 'Pricing beta', status: 'open', places: 5, applicant_count: 2 }] }) } }), {}],
  ];
  for (const [name, el, methods] of cases) {
    const restore = stubApi(methods);
    const v = await mount(el);
    try {
      const root = v.nodes()[0];
      assertHeadingOrder(headingsOf(v, root).filter(Boolean), name);
    } finally { await v.unmount(); restore(); }
  }
});
