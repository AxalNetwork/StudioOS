/**
 * D4846 part 2 (#6032; Build v2 boards BD14 A, B and C, BD14m) — Build's system
 * states: one rendering per state across the overview, the module page, the
 * phone module page and the parts' boundary; one notice when some module
 * reads failed; the tablet tier between the phone page and the desktop; and
 * the dark-mode pairs.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_states_bd14_6032.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  BUILD_STATES, BUILD_STATE_WORDS, PLATFORM_KIND, cellState, moduleReads, pillState, stateOfWord, withRowState,
} from '../src/pages/cycles/buildSystemStates.js';
import { BUILD_CHIP_CLASSES, BuildPartialNotice, BuildStateTag, phoneStateRow } from '../src/pages/cycles/BuildStates.jsx';
import CycleOverview from '../src/pages/cycles/CycleOverview.jsx';
import { RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { PartBoundary } from '../src/pages/cycles/buildParts.jsx';
import { BELOW_MD_QUERY, TABLET_CARD_COLS, TABLET_FIGURE_COLS, TABLET_QUERY, layoutTier, tabletFrom, tabletLastSpan } from '../src/ui/phone/tabletTier.js';
import { BELOW_MD_QUERY as REEXPORTED_BELOW_MD, useTabletWidth } from '../src/ui/phone/usePhoneWidth.js';
import { OVERVIEWS, card } from './_cycle_fixtures.mjs';

const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const html = (el, entry = '/build') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const count = (s, needle) => s.split(needle).length - 1;
const buildStatesIn = (markup) => [...markup.matchAll(/data-build-state="([a-z_]+)"/g)].map((m) => m[1]);

/* ---------------- the model ---------------- */

test('every word Build reads send maps to exactly one state, and the six states are BD14 A\'s', () => {
  assert.deepEqual(BUILD_STATES, ['not_recorded', 'not_expected', 'unavailable', 'waiting', 'attention', 'read_only']);
  assert.deepEqual(Object.keys(BUILD_STATE_WORDS), BUILD_STATES);
  assert.equal(BUILD_STATE_WORDS.unavailable, 'Unavailable', 'the screen word for a failed read is Unavailable (#5129, Q2 = A)');
  const table = {
    'Not recorded': 'not_recorded',
    'Not expected yet': 'not_expected', 'Not required': 'not_expected',
    Unavailable: 'unavailable', 'Could not be read': 'unavailable', Unreadable: 'unavailable',
    Processing: 'waiting', Waiting: 'waiting', Pending: 'waiting', 'Waiting for review': 'waiting',
    'Needs attention': 'attention', Missing: 'attention', Blocked: 'attention',
    'Read only': 'read_only', 'Read-only': 'read_only',
  };
  for (const [word, state] of Object.entries(table)) {
    assert.equal(stateOfWord(word), state, word);
    assert.equal(stateOfWord(`  ${word.toUpperCase()} `), state, `${word}, in any case and padding`);
    assert.equal(cellState(word).state, state, `${word} as a cell`);
    assert.equal(cellState({ text: word, tone: 'bad' }).state, state, `${word} as a toned cell: the word decides, not the tone`);
  }
  for (const state of BUILD_STATES) assert.ok(Object.values(table).includes(state), `${state} is reachable`);
  // Each state draws through exactly one shape: D5129's chip for the platform three, Build's own for the rest.
  assert.deepEqual(PLATFORM_KIND, { not_recorded: 'not_recorded', not_expected: 'not_applicable', unavailable: 'unavailable', waiting: null, attention: null, read_only: null });
});

test('no state turns an unknown into a negative: missing is Not recorded, failed is Unavailable, any other word stays a value', () => {
  for (const missing of [null, undefined, '', { text: '' }, { text: null }]) {
    assert.deepEqual(cellState(missing), { state: 'not_recorded', label: 'Not recorded' }, JSON.stringify(missing));
  }
  // Values, including a measured zero and every neutral or positive word, are never a state.
  for (const value of [0, '0', 7, 'Done', 'Built', 'Tested', 'Not started', 'In progress', 'Upcoming', 'Filed', 'Stored', 'Due soon',
    'Overdue', 'None', 'Missingno', 'Waiting room', 'Not recorded yet?', { text: 'Account setup', tone: 'warn' }]) {
    assert.equal(cellState(value), null, JSON.stringify(value));
  }
  // A cell of several links is a value however its text reads.
  assert.equal(cellState({ text: 'Blocked', links: [{ text: 'Blocked', href: '/build/x' }] }), null);
  // A failed read always says Unavailable, whatever the Worker's word; it is never Not recorded, None or 0.
  for (const failed of ['Unreadable', 'Could not be read', { text: 'Unavailable', tone: 'warn' }]) {
    assert.deepEqual(cellState(failed), { state: 'unavailable', label: 'Unavailable' });
  }
  // The others keep the Worker's own words in the state's shape.
  assert.deepEqual(cellState('Blocked'), { state: 'attention', label: 'Blocked' });
  assert.deepEqual(cellState('Waiting for review'), { state: 'waiting', label: 'Waiting for review' });
  assert.deepEqual(cellState('Not required'), { state: 'not_expected', label: 'Not required' });
  // Nothing missing or unknown is ever Needs attention.
  for (const unknown of [null, '', 'Mystery', 0, { text: 'Later' }]) assert.notEqual(cellState(unknown)?.state, 'attention');
});

test('a phone row keeps its own pill unless the pill is a state, which then moves to `state` (BD14m)', () => {
  const plain = { title: 'Account setup', pill: { label: 'Done', tone: 'ok' } };
  assert.equal(withRowState(plain), plain, 'a value pill is left alone');
  assert.equal(phoneStateRow(plain), plain);
  const blocked = withRowState({ title: 'Data import', description: 'Due 1 Dec', pill: { label: 'Blocked', tone: 'danger' } });
  assert.deepEqual(blocked, { title: 'Data import', description: 'Due 1 Dec', state: { state: 'attention', label: 'Blocked' } });
  assert.equal(pillState(undefined), null);
  assert.equal(pillState({ label: 'Not expected yet' }).state, 'not_expected');
});

test('the module reads: "N of M modules read", only when one failed; loading cards count neither way', () => {
  const cards = OVERVIEWS.build.cards.map((c) => (c.slug === 'operating-systems' ? { ...c, state: 'unreadable', series: null } : c));
  const one = moduleReads(cards);
  assert.equal(one.lead, '5 of 6 modules read');
  assert.equal(one.rest, 'Operating systems could not be read.');
  assert.equal(one.show, true);
  assert.deepEqual(one.failed, [{ slug: 'operating-systems', name: 'Operating systems' }]);
  const all = moduleReads(OVERVIEWS.build.cards);
  assert.equal(all.show, false, 'every module read: no notice');
  assert.equal(all.lead, '6 of 6 modules read');
  // An empty, Not recorded or plan-locked card was read; a state the page does not know was not.
  const mixed = moduleReads([
    { ...card('build', 'Solution design', 0), state: 'empty', series: null },
    { ...card('build', 'Prototype / MVP', 1), state: 'not_recorded', series: null },
    { ...card('build', 'Product roadmap', 2), plan: { locked: true, name: 'Pro' } },
    { ...card('build', 'Founding team', 3), state: 'mystery' },
    { ...card('build', 'Company creation', 4), state: 'unreadable' },
    null,
  ]);
  assert.equal(mixed.lead, '3 of 5 modules read');
  assert.equal(mixed.rest, 'Founding team and Company creation could not be read.');
  assert.equal(moduleReads([]).show, false);
  assert.equal(moduleReads(null).show, false);
  assert.equal(moduleReads([{ slug: 'x', name: 'X', state: 'unreadable' }]).lead, '0 of 1 module read');
});

/* ---------------- the chips ---------------- */

test('each state draws one chip with its own word, glyph and border, and every colour has its dark pair (BD14 C)', () => {
  const marks = BUILD_STATES.map((s) => renderToStaticMarkup(h(BuildStateTag, { state: s })));
  BUILD_STATES.forEach((s, i) => {
    assert.ok(marks[i].includes(`data-build-state="${s}"`), s);
    assert.ok(text(marks[i]).includes(BUILD_STATE_WORDS[s]), `${s} says ${BUILD_STATE_WORDS[s]}`);
  });
  // The three platform states draw D5129's StateChip, the other three Build's own shape.
  assert.match(marks[0], /data-platform-state="not_recorded"/);
  assert.match(marks[1], /data-platform-state="not_applicable"/);
  assert.match(marks[2], /data-platform-state="unavailable"/);
  for (const i of [3, 4, 5]) assert.doesNotMatch(marks[i], /data-platform-state/);
  // No two states share a look: their class strings all differ.
  const classes = marks.map((m) => m.match(/class="([^"]+)"/)[1]);
  assert.equal(new Set(classes).size, BUILD_STATES.length);
  // Not expected yet is the lightest: no border colour and no fill; Not recorded is dotted; Unavailable dashed.
  assert.match(classes[1], /border-transparent bg-transparent/);
  assert.match(classes[0], /border-dotted/);
  assert.match(classes[2], /border-dashed/);
  // Unavailable is never red ink on a red fill: its word is ink, only its "!" glyph carries the hue.
  assert.doesNotMatch(classes[2], /bg-red|text-red/);
  for (const [state, cls] of Object.entries(BUILD_CHIP_CLASSES)) {
    for (const part of ['border', 'bg', 'text']) {
      assert.match(cls, new RegExp(`(^| )${part}-`), `${state} sets ${part}`);
      assert.match(cls, new RegExp(`dark:${part}-`), `${state} has a dark ${part}`);
    }
  }
  // The Worker's own word survives where the state keeps it; Unavailable always says Unavailable.
  assert.match(text(renderToStaticMarkup(h(BuildStateTag, { state: 'attention', label: 'Blocked' }))), /^Blocked$/);
  assert.match(text(renderToStaticMarkup(h(BuildStateTag, { state: 'unavailable', label: 'Unreadable' }))), /^Unavailable$/);
});

/* ---------------- the four pages ---------------- */

const failedOverview = () => ({
  ...OVERVIEWS.build,
  cards: OVERVIEWS.build.cards.map((c) => (c.slug === 'operating-systems'
    ? { ...c, state: 'unreadable', series: null, reason: 'Stripe could not be read. Last good sync 9 Oct.' } : c)),
});

test('the overview: one "5 of 6 modules read" notice over the cards, and the failed card keeps its own Retry', () => {
  const out = html(h(CycleOverview, { cycle: 'build', data: failedOverview(), onRetryCard() {} }));
  assert.equal(count(out, 'data-testid="build-partial-notice"'), 1);
  assert.match(out, /role="status"[^>]*data-platform-state="partial"[^>]*data-testid="build-partial-notice"[^>]*data-read="5" data-of="6"/);
  assert.match(text(out), /Partial: 5 of 6 modules read Operating systems could not be read\. Retry/);
  // The notice sits before the cards.
  assert.ok(out.indexOf('build-partial-notice') < out.indexOf('data-testid="cycle-cards"'));
  // The card: D5129's Unavailable block, its own reason and its own "Try again", and no red box.
  const cardHtml = out.slice(out.indexOf('data-testid="cycle-card-operating-systems"'));
  assert.match(cardHtml, /data-platform-state="unavailable" data-testid="card-unreadable"/);
  assert.match(text(cardHtml), /Unavailable Stripe could not be read\. Last good sync 9 Oct\. Try again/);
  const box = cardHtml.slice(0, cardHtml.indexOf('</article>'));
  assert.doesNotMatch(box, /bg-red-50|border-red-200|role="alert"/, 'a failed card is not drawn as a negative, and does not shout on load');
  // All read: no notice. Another cycle's overview: no notice either.
  assert.doesNotMatch(html(h(CycleOverview, { cycle: 'build', data: OVERVIEWS.build })), /build-partial-notice/);
  const raise = { ...OVERVIEWS.raise, cards: OVERVIEWS.raise.cards.map((c, i) => (i === 0 ? { ...c, state: 'unreadable', series: null } : c)) };
  assert.doesNotMatch(html(h(CycleOverview, { cycle: 'raise', data: raise }), '/raise'), /build-partial-notice/);
});

test('the notice\'s Retry re-reads only the cards that failed; with no per-card retry it offers none', () => {
  const calls = [];
  const cards = failedOverview().cards.map((c) => (c.slug === 'founding-team' ? { ...c, state: 'unreadable', series: null } : c));
  const el = BuildPartialNotice({ cards, onRetryCard: (slug) => calls.push(slug) });
  assert.equal(el.props.lead, '4 of 6 modules read');
  el.props.onRetry();
  assert.deepEqual(calls, ['founding-team', 'operating-systems']);
  assert.equal(BuildPartialNotice({ cards }).props.onRetry, undefined);
  assert.doesNotMatch(renderToStaticMarkup(BuildPartialNotice({ cards })), /data-state-retry/);
  assert.equal(BuildPartialNotice({ cards: OVERVIEWS.build.cards, onRetryCard() {} }), null);
});

test('the overview\'s figures and Not recorded card: D5129\'s chips, no red ink for an unknown', () => {
  const data = {
    ...OVERVIEWS.build,
    figures: [...OVERVIEWS.build.figures.slice(0, 3), { key: 'f4', label: 'Days to MVP', value: null, unit: 'count', state: 'unreadable', source: 'Roadmap' }],
    cards: OVERVIEWS.build.cards.map((c, i) => (i === 0 ? { ...c, state: 'not_recorded', series: null, reason: 'No target date.' } : c)),
  };
  const out = html(h(CycleOverview, { cycle: 'build', data }));
  const fig = out.slice(out.indexOf('data-testid="cycle-figure-f4"'), out.indexOf('data-testid="cycle-cards"'));
  assert.match(fig, /data-testid="cycle-figure-f4-unavailable"[\s\S]*data-platform-state="unavailable"/);
  assert.match(text(fig), /Days to MVP Unavailable Roadmap could not be read/);
  // A failed source shows no change and does not say "nothing recorded yet": neither is known.
  assert.doesNotMatch(text(fig), /nothing recorded yet|in 30 days|change not recorded/);
  const stale = html(h(CycleOverview, { cycle: 'build', data: { ...data, figures: [{ key: 'm', label: 'MRR', value: 5, unit: 'usd', delta_30d: 4, spark: [1, 2, 3, 4], state: 'unreadable', source: 'Stripe' }] } }));
  assert.doesNotMatch(text(stale.slice(stale.indexOf('data-testid="cycle-figure-m"'), stale.indexOf('data-testid="cycle-cards"'))), /\$4|in 30 days/, 'no stale change beside Unavailable');
  // Only the "!" glyph carries the alert hue (D5129); the word and the sentence are muted ink.
  assert.doesNotMatch(fig.replace(/<svg[\s\S]*?<\/svg>/g, ''), /text-red/);
  const nr = out.slice(out.indexOf('data-testid="card-not-recorded"'));
  assert.match(nr, /^data-testid="card-not-recorded"><span class="[^"]*border-dotted[^"]*" data-platform-state="not_recorded"/);
  assert.match(text(nr.slice(nr.indexOf('>') + 1)), /^Not recorded No target date\./);
});

test('Read only on Build\'s overview is its own state, a lock and a sentence, not an amber warning', () => {
  const out = html(h(CycleOverview, { cycle: 'build', data: { ...OVERVIEWS.build, read_only: true, mode: 'summary' } }));
  const bar = out.slice(out.indexOf('<div role="status"'), out.indexOf('data-testid="cycle-figures"'));
  assert.match(bar, /data-testid="cycle-overview-read-only"/);
  assert.match(bar, /data-build-state="read_only"/);
  assert.doesNotMatch(bar.slice(0, bar.indexOf('data-build-state')), /amber/);
  assert.match(text(bar), /Read only HQ summary\./);
  assert.match(bar, /dark:bg-gray-900/);
});

test('the module page: each state cell draws its one chip, and a value cell is untouched', () => {
  const cols = [{ key: 'name', label: 'Must-have' }, { key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
  const rows = [
    { id: 1, cells: { name: 'One', a: 'Not expected yet', b: { text: 'Unavailable', tone: 'warn' } } },
    { id: 2, cells: { name: 'Two', a: null, b: 'Blocked' } },
    { id: 3, cells: { name: 'Three', a: 'Waiting for review', b: 'Read only' } },
    { id: 4, cells: { name: 'Four', a: { text: 'Done', tone: 'ok' }, b: '0' } },
  ];
  const out = html(h(RecordsTable, { title: 'Must-haves', records: { cols, rows, total: 4, page: 1, page_size: 25 }, status: 'ready', query: {} }));
  assert.deepEqual(buildStatesIn(out), ['not_expected', 'unavailable', 'not_recorded', 'attention', 'waiting', 'read_only']);
  assert.match(text(out), /Four A Done B 0/);
  // The old amber "Unavailable" pill and the dashed Not recorded pill are gone from the table.
  assert.doesNotMatch(out, /border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800[^"]*">Unavailable/);
});

test('the phone module page: the same chips as the desktop table (BD14m)', () => {
  const records = {
    cols: [{ key: 'name', label: 'Filing' }, { key: 'due', label: 'Due' }, { key: 'state', label: 'State' }],
    rows: [
      { id: 1, cells: { name: 'Annual report', due: '1 Mar', state: { text: 'Unavailable', tone: 'warn' } } },
      { id: 2, cells: { name: '83(b)', due: '8 Dec', state: { text: 'Blocked', tone: 'bad' } } },
      { id: 3, cells: { name: 'EIN', due: '2 Jan', state: { text: 'Filed', tone: 'ok' } } },
    ],
    total: 3, page: 1, page_size: 25,
  };
  const out = html(h(PhoneModulePage, { cycle: 'build', slug: 'company-creation', data: { card: card('build', 'Company creation', 4) }, status: 'ready', records, query: {} }), '/build/company-creation');
  assert.deepEqual(buildStatesIn(out), ['unavailable', 'attention']);
  assert.match(text(out), /EIN 2 Jan Filed/);
  // Each state row draws a chip, not a ui/Pill: the Filed pill is the only Pill left.
  assert.equal(count(text(out), 'Filed'), 1);
});

test('a part that throws reads Unavailable with Retry, quietly on load (PartBoundary)', () => {
  const boundary = new PartBoundary({ name: 'prototype-mvp-github', children: null });
  boundary.state = { failed: true };
  const out = renderToStaticMarkup(boundary.render());
  assert.match(out, /data-testid="build-part-unreadable-prototype-mvp-github"/);
  assert.match(out, /data-platform-state="unavailable"/);
  assert.match(text(out), /Unavailable This part could not be read\. The rest of this page is current\. Retry/);
  assert.doesNotMatch(out, /role="alert"/, 'ST-09: only a Retry announces');
});

/* ---------------- the tablet tier (BD14 B) ---------------- */

/** A `matches` that evaluates the two queries this tier reads against a width, as a browser would. */
const at = (width) => (query) => {
  if (query === BELOW_MD_QUERY) return width <= 767;
  if (query === TABLET_QUERY) return width >= 768 && width <= 1023;
  throw new Error(`unexpected query ${query}`);
};

test('the tiers: phone below 768px, tablet 768px to 1023px, desktop from 1024px', () => {
  assert.equal(REEXPORTED_BELOW_MD, BELOW_MD_QUERY, 'usePhoneWidth.js keeps exporting BELOW_MD_QUERY');
  assert.equal(TABLET_QUERY, '(min-width: 768px) and (max-width: 1023px)');
  for (const [w, tier] of [[320, 'phone'], [390, 'phone'], [767, 'phone'], [768, 'tablet'], [900, 'tablet'], [1023, 'tablet'], [1024, 'desktop'], [1440, 'desktop'], [NaN, 'desktop']]) {
    assert.equal(layoutTier(w), tier, String(w));
    if (Number.isFinite(w)) assert.equal(tabletFrom(at(w)), tier === 'tablet', `tabletFrom at ${w}`);
  }
  // An environment that answers every query alike is not a tablet; neither is one that throws.
  assert.equal(tabletFrom(() => true), false);
  assert.equal(tabletFrom(() => false), false);
  assert.equal(tabletFrom(() => { throw new Error('no media'); }), false);
});

test('useTabletWidth reads the tier only where a cycle asks for it', () => {
  const probe = (enabled) => { let got; const P = () => { got = useTabletWidth(enabled); return null; }; renderToStaticMarkup(h(P)); return got; };
  const before = globalThis.window;
  try {
    globalThis.window = { matchMedia: (q) => ({ matches: at(820)(q) }) };
    assert.equal(probe(true), true, '820px is the tablet tier');
    assert.equal(probe(false), false, 'a cycle without a tablet layout never is');
    globalThis.window = { matchMedia: (q) => ({ matches: at(390)(q) }) };
    assert.equal(probe(true), false, '390px is the phone');
    globalThis.window = { matchMedia: (q) => ({ matches: at(1280)(q) }) };
    assert.equal(probe(true), false, '1280px is the desktop');
  } finally {
    if (before === undefined) delete globalThis.window; else globalThis.window = before;
  }
});

test('the route: Build\'s def names the tablet tier, and only there does the phone page give way from 768px', async () => {
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /const tablet = useTabletWidth\(def\?\.tabletPages === true\);\n\s+const phone = usePhoneWidth\(\) && !tablet;/);
  assert.match(route, /import \{ usePhoneWidth, useTabletWidth \} from '\.\.\/\.\.\/ui\/phone\/usePhoneWidth';/);
  const { default: build } = await import('../src/pages/cycles/defs/build.jsx');
  assert.equal(build.tabletPages, true);
  for (const cycle of ['validate', 'raise', 'grow']) {
    const { default: def } = await import(`../src/pages/cycles/defs/${cycle}.jsx`);
    assert.notEqual(def.tabletPages, true, `${cycle} keeps its phone page below 1024px`);
  }
});

test('768px draws two module columns and the four figures in a row, not the phone column or a squeezed desktop grid', () => {
  assert.equal(TABLET_CARD_COLS, 'md:grid-cols-2');
  assert.equal(TABLET_FIGURE_COLS[4], 'md:grid-cols-4');
  const out = html(h(CycleOverview, { cycle: 'build', data: OVERVIEWS.build }));
  const grid = out.match(/class="([^"]+)" data-testid="cycle-cards"/)[1];
  assert.equal(grid, 'grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3');
  assert.match(out.match(/class="([^"]+)" data-testid="cycle-figures"/)[1], /md:grid-cols-4/);
  // Five Build cards: the last spans the tablet row too.
  assert.equal(tabletLastSpan(5), 'md:col-span-2');
  assert.equal(tabletLastSpan(6), '');
  assert.equal(tabletLastSpan(0), '');
  const five = html(h(CycleOverview, { cycle: 'build', data: { ...OVERVIEWS.build, cards: OVERVIEWS.build.cards.slice(0, 5) } }));
  assert.match(five, /class="[^"]*lg:col-span-2 xl:col-span-2 md:col-span-2" data-testid="cycle-card-company-creation"/);
  // Other cycles never draw this page below 1024px, and keep their classes exactly.
  const raise = html(h(CycleOverview, { cycle: 'raise', data: OVERVIEWS.raise }), '/raise');
  assert.equal(raise.match(/class="([^"]+)" data-testid="cycle-cards"/)[1], 'grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-3');
  assert.doesNotMatch(raise, /md:col-span|md:grid-cols/);
});
