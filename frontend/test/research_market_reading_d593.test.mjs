/**
 * D593 — the Market reading page against its canvas
 * (`design/canvases/integrated/Pages · Market reading.dc.html`): the scope line,
 * the fourth comparables column, the licence accent, a Scope field, the desktop
 * layout, honest attach states and a single h1.
 *
 * Rendered with react-dom/server (no DOM): `MarketReadingView` draws the whole
 * page, shell included, from a payload shaped like `GET
 * /research/market-readings/:uid`. Run dates are counted back from today, so
 * the age bands hold whatever day this runs.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_market_reading_d593.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import WorkspaceShell from '../src/workspaces/WorkspaceShell.jsx';
import { ACCENT } from '../src/workspaces/shellConfig.js';
import MarketReading, { MarketReadingView, accentVars } from '../src/pages/research/MarketReading.jsx';
import {
  attachState,
  openProposals,
  readingFields,
  readingSubmission,
  scopeValue,
  staleAttachmentSentence,
} from '../src/pages/research/marketReadingRead.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// The canvas's own reading (BASE in its renderVals), at 24 days: Current.
const reading = (o = {}) => ({
  uid: 'rm_4k2',
  metric: 'Design system build',
  offering_uid: 'off_91',
  scope: 'Design & product services',
  range_low_cents: 3_800_000,
  range_high_cents: 6_200_000,
  comparable_count: 11,
  catalog_price_cents: 4_500_000,
  ran_at: ago(24),
  ...o,
});
const QUOTES = [
  { id: 7, status: 'sent', proposal_name: 'Website rebuild' },
  { id: 9, status: 'draft', proposal_name: null },
];
const ON_7 = { uid: 'att_1', quote_id: 7, created_at: '2026-09-30', proposal_name: 'Website rebuild' };

const routed = (el, path = '/research/markets/rm_4k2') => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [path] }, el),
);

function page({ role = 'partner', item = reading(), attachments = [], proposals = QUOTES, form, ...rest } = {}) {
  return routed(React.createElement(MarketReadingView, {
    role,
    payload: { item, attachments, proposals },
    form: form || readingFields(item),
    ...rest,
  }));
}

/** The outer HTML of the element that carries `data-testid="<id>"`. */
function part(html, id) {
  const at = html.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `the page draws no ${id}`);
  const start = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  throw new Error(`${id} never closes`);
}

/** What a reader sees, one space between adjacent elements. */
const words = (html) => renderedText(html.replace(/></g, '> <')).replace(/\s+/g, ' ').trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The class list of the element whose whole text is `label`. */
function classOf(html, label) {
  const m = new RegExp(`<(a|button|span)\\b[^>]*class="([^"]*)"[^>]*>${escapeRe(label)}</\\1>`).exec(html);
  assert.ok(m, `no control reading "${label}"`);
  return m[2];
}

const has = (cls, token) => cls.split(/\s+/).includes(token);

// ---- 1. The header line ------------------------------------------------------

test('the header line is the scope or Not recorded; the catalog price is a line of its own', () => {
  const line = (item) => words(part(page({ item }), 'market-reading-scope'));
  assert.equal(line(reading()), 'Scope: Design & product services · Catalog lists $45,000');
  // A scoped reading with no catalog price shows no chip: the chip used to
  // stand for the missing price, and printed beside a scope that was there.
  assert.equal(line(reading({ catalog_price_cents: null })), 'Scope: Design & product services');
  // No scope is Not recorded, whether or not the offering is catalogued.
  assert.equal(line(reading({ scope: null })), 'Scope: Not recorded · Catalog lists $45,000');
  assert.equal(line(reading({ scope: null, catalog_price_cents: null })), 'Scope: Not recorded');
  // The catalog price stays out of the range.
  assert.match(words(part(page(), 'market-reading-tiles')), /Comparable range \$38,000 – \$62,000 11 comparables/);
});

// ---- 2. The comparables table ------------------------------------------------

test('the comparables table has the canvas\'s four columns, and still nothing under them', () => {
  const html = page();
  const head = part(html, 'market-reading-comparables-head');
  assert.deepEqual(
    [...head.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]),
    ['Date', 'Engagement went for', 'Source', 'URL or file'],
  );
  assert.match(head, /^<div[^>]*class="[^"]*\bhidden\b[^"]*\bsm:grid\b/, 'the 390 boards draw no header row');
  const text = words(html);
  assert.match(text, /11 counted · 0 named/);
  assert.match(text, /The count has no names behind it/);
  assert.match(text, /never type a count so the form accepts/);
  assert.doesNotMatch(html, /Add an engagement/);
});

// ---- 3. The licence accent ---------------------------------------------------

test('the page root carries the licence\'s ACCENT values, for both grounds', () => {
  for (const role of ['partner', 'founder', 'advisor', 'investor']) {
    const a = ACCENT[role];
    const root = part(page({ role }), 'market-reading');
    const style = /^<div[^>]*style="([^"]*)"/.exec(root)?.[1] || '';
    assert.ok(style.includes(`--mr-accent:${a.ink}`), `${role}: the fill is not its ACCENT ink`);
    assert.ok(style.includes(`--mr-accent-deep:${a.deep}`), `${role}: no deep accent`);
    assert.ok(style.includes(`--mr-accent-line:${a.border}`), `${role}: no accent border`);
    assert.ok(style.includes(`--mr-accent-dark:${a.deepDark}`), `${role}: no dark-ground accent`);
  }
  // An admin reaches this page as a founder (App.jsx `researchRole`); an
  // unknown role still gets an accent rather than none.
  assert.deepEqual(accentVars('nobody'), accentVars('founder'));
});

test('buttons, the ZONEDRAFT pill, Accept, the focus ring and the back link read the accent, light and dark', () => {
  const current = page({ role: 'partner' });
  const stale = page({ role: 'partner', item: reading({ ran_at: ago(130) }) });

  const fills = [
    ['Record this reading', current],
    ['Record a fresh reading', stale],
    ['ZONEDRAFT', current],
    ['Draft', current],
  ];
  for (const [label, html] of fills) {
    const cls = classOf(html, label);
    assert.ok(has(cls, 'bg-[var(--mr-accent)]'), `${label}: not the licence fill`);
    assert.ok(has(cls, 'dark:bg-[var(--mr-accent)]'), `${label}: no dark fill`);
  }
  const accept = classOf(current, 'Accept');
  for (const token of [
    'border-[color:var(--mr-accent-line)]', 'text-[color:var(--mr-accent-deep)]',
    'dark:border-[color:var(--mr-accent-dark)]/40', 'dark:text-[color:var(--mr-accent-dark)]',
  ]) assert.ok(has(accept, token), `Accept lacks ${token}`);

  const back = classOf(current, '‹ Markets');
  assert.ok(has(back, 'text-[color:var(--mr-accent)]') && has(back, 'dark:text-[color:var(--mr-accent-dark)]'),
    'the back link is not the licence accent on both grounds');

  for (const field of ['Scope', 'Low (USD)', 'High (USD)', 'Comparables', 'Run date']) {
    const cls = new RegExp(`<input aria-label="${escapeRe(field)}"[^>]*class="([^"]*)"`).exec(current)?.[1] || '';
    assert.ok(has(cls, 'focus:ring-[color:var(--mr-accent)]'), `${field}: the focus ring is not the accent`);
    assert.ok(has(cls, 'dark:focus:ring-[color:var(--mr-accent-dark)]'), `${field}: no dark focus ring`);
  }
  for (const label of ['Record this reading', 'Draft', 'Accept']) {
    assert.ok(has(classOf(current, label), 'focus-visible:outline-[color:var(--mr-accent)]'), `${label}: no accent focus ring`);
  }

  // A partner sees amber: nothing on the page body is violet any more.
  for (const html of [current, stale]) assert.doesNotMatch(part(html, 'market-reading'), /violet/);
});

// ---- 4. The Scope field ------------------------------------------------------

test('the form records a scope, and a blank one is saved as none rather than carried forward', () => {
  assert.equal(readingFields(reading()).scope, 'Design & product services');
  assert.equal(readingFields(reading({ scope: null })).scope, '');
  assert.match(page(), /<input aria-label="Scope"[^>]*value="Design &amp; product services"/);
  assert.match(page({ item: reading({ scope: null }) }), /<input aria-label="Scope"[^>]*value=""/);

  // What is sent is what is in the box: trimmed, and blank is null, even
  // over a reading that had a scope.
  const item = reading();
  const form = { ...readingFields(item), scope: '  Brand & identity  ' };
  assert.equal(readingSubmission(item, form).body.scope, 'Brand & identity');
  assert.equal(readingSubmission(item, { ...form, scope: '' }).body.scope, null);
  assert.equal(readingSubmission(item, { ...form, scope: '   ' }).body.scope, null);
  assert.equal(scopeValue('x'.repeat(250)).length, 200, 'the Worker keeps 200 characters');

  // The rest of the body is unchanged by the move out of the page.
  assert.deepEqual(readingSubmission(item, form).body, {
    offering_uid: 'off_91', metric: 'Design system build', range_low_cents: 3_800_000,
    range_high_cents: 6_200_000, comparable_count: 11, ran_at: item.ran_at, scope: 'Brand & identity',
  });
  assert.equal(readingSubmission(item, { ...form, high: '1000' }).error,
    'High is below low. Nothing is saved until the range reads forward.');
  assert.equal(readingSubmission(item, { ...form, n: '0' }).error,
    'How many engagements the range came from. Refused if 0.');
  assert.equal(readingSubmission(item, { ...form, ran_at: '' }).error, 'A reading needs the date you ran it.');

  // And the page posts that body, not the opened reading's scope.
  const src = codeOnly(read('frontend/src/pages/research/MarketReading.jsx'));
  assert.match(src, /api\.research\.marketReadingCreate\(submission\.body\)/);
  assert.doesNotMatch(src, /scope: item\.scope/);
});

// ---- 5. Layout ---------------------------------------------------------------

test('tiles run four across on a desktop, with Age and Proposal at 20px', () => {
  const tiles = part(page(), 'market-reading-tiles');
  assert.match(tiles, /^<div[^>]*class="grid grid-cols-2 gap-3 xl:grid-cols-4"/);
  const valueClass = (k) => new RegExp(`>${k}</div><div class="([^"]*)"`).exec(tiles)?.[1] || '';
  for (const k of ['Age', 'Proposal']) {
    assert.ok(has(valueClass(k), 'sm:text-[20px]'), `${k} is not 20px on a desktop`);
    assert.ok(has(valueClass(k), 'text-[17px]'), `${k} is not 17px on a phone`);
  }
  for (const k of ['Comparable range', 'Run date']) {
    assert.ok(has(valueClass(k), 'sm:text-[17px]'), `${k} is not 17px on a desktop`);
    assert.ok(!valueClass(k).includes('20px'), `${k} took the larger size`);
  }
});

test('the record form is one row on a desktop and two by two on a phone, the button last', () => {
  const row = part(page(), 'market-reading-form-row');
  assert.match(row, /^<div[^>]*class="[^"]*\bgrid-cols-2\b[^"]*\bxl:grid-cols-\[repeat\(4,minmax\(0,1fr\)\)_auto\]/);
  const order = [...row.matchAll(/<input aria-label="([^"]+)"|<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1] || m[2]);
  assert.deepEqual(order, ['Low (USD)', 'High (USD)', 'Comparables', 'Run date', 'Record this reading']);
  const button = classOf(row, 'Record this reading');
  assert.ok(has(button, 'col-span-2') && has(button, 'xl:col-span-1'), 'the button is not under the fields on a phone and beside them on a desktop');
});

test('high below low is a danger box with a mark, announced, and nothing else raises one', () => {
  const backwards = page({ form: { ...readingFields(reading()), low: '62000', high: '38000' } });
  const alert = /<div role="alert" class="([^"]*)">(.*?)<\/div>/.exec(backwards);
  assert.ok(alert, 'the error is not announced');
  for (const token of ['border-red-200', 'bg-red-50', 'text-red-700', 'dark:border-red-900', 'dark:bg-red-950/40', 'dark:text-red-300']) {
    assert.ok(has(alert[1], token), `the danger box lacks ${token}`);
  }
  assert.match(alert[2], /^<span aria-hidden="true"[^>]*>!<\/span>/);
  assert.equal(words(alert[2]), '! High is below low. Nothing is saved until the range reads forward.');
  assert.match(backwards, /<button type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(page(), /role="alert"/);
});

test('the stale sentence in the attachment card is in danger ink, and reads "an October quote"', () => {
  const card = part(page({ item: reading({ ran_at: ago(130) }) }), 'market-reading-attachment');
  const cls = /<p class="([^"]*)">A client shown a range from/.exec(card)?.[1] || '';
  assert.ok(has(cls, 'text-red-700') && has(cls, 'dark:text-red-300'), 'the stale sentence is body ink');
  // The month the quote goes out in takes its article.
  assert.match(staleAttachmentSentence('2026-05-14', new Date(2026, 9, 6)), /behind an October quote/);
  assert.match(staleAttachmentSentence('2026-04-14', new Date(2026, 7, 20)), /behind an August quote/);
  assert.match(staleAttachmentSentence('2026-05-14', new Date(2026, 8, 21)), /behind a September quote/);
});

// ---- 6. Attach states --------------------------------------------------------

test('stale beats attached beats nowhere beats attachable', () => {
  assert.equal(attachState({ stale: true, attachments: [ON_7], proposals: QUOTES }), 'blocked');
  assert.equal(attachState({ stale: true, attachments: [], proposals: [] }), 'blocked');
  assert.equal(attachState({ stale: false, attachments: [ON_7], proposals: [] }), 'attached');
  assert.equal(attachState({ stale: false, attachments: [], proposals: [] }), 'nowhere');
  assert.equal(attachState({ stale: false, attachments: undefined, proposals: undefined }), 'nowhere');
  assert.equal(attachState({ stale: false, attachments: [], proposals: QUOTES }), 'attachable');
  assert.deepEqual(openProposals(QUOTES, [ON_7]).map((q) => q.id), [9]);
  assert.deepEqual(openProposals(QUOTES, [{ quote_id: '9' }]).map((q) => q.id), [7]);
});

/** The header's attach pill and the Proposal tile, as a reader sees them. */
function attachSays(html) {
  const pills = [...part(html, 'market-reading-header').matchAll(/data-testid="pill"[^>]*>([^<]*)</g)].map((m) => m[1]);
  const tile = />Proposal<\/div><div class="[^"]*">([^<]*)<\/div><p[^>]*>([^<]*)<\/p>/.exec(part(html, 'market-reading-tiles'));
  return { pill: pills[1], tile: tile?.[1], sub: tile?.[2] };
}

/** The Proposal tile value's class list. */
const proposalInk = (html) => />Proposal<\/div><div class="([^"]*)"/.exec(part(html, 'market-reading-tiles'))?.[1] || '';

test('with no proposal to attach to, neither the header nor the tile says Attachable', () => {
  // A licence without a partner profile reads no proposals; neither does a
  // partner with no quote yet.
  for (const role of ['founder', 'partner']) {
    const html = page({ role, proposals: [] });
    assert.deepEqual(attachSays(html), {
      pill: 'No proposal to attach to', tile: 'No proposal', sub: 'this account has no quote to attach it to',
    });
    assert.doesNotMatch(words(part(html, 'market-reading-header')) + words(part(html, 'market-reading-tiles')), /Attachable/);
    // Muted, not the green that means a reading can go onto a quote.
    assert.ok(!/emerald/.test(proposalInk(html)) && has(proposalInk(html), 'text-axal-muted'), 'No proposal is painted as a good state');
    assert.match(words(part(html, 'market-reading-attachment')), /No proposal on this account\./);
    // Ageing, the card does not call it "still attachable" above that sentence.
    const ageing = part(page({ role, proposals: [], item: reading({ ran_at: ago(42) }) }), 'market-reading-attachment');
    assert.doesNotMatch(words(ageing), /still attachable/);
  }
  assert.match(words(part(page({ item: reading({ ran_at: ago(42) }) }), 'market-reading-attachment')),
    /This one is 42 days old — still attachable/, 'with a quote to take it, the ageing note stays');
  // Stale still wins over everything.
  assert.deepEqual(attachSays(page({ proposals: [], item: reading({ ran_at: ago(130) }) })), {
    pill: 'Re-run before attaching', tile: 'Blocked', sub: 're-run before attaching',
  });
  assert.equal(attachSays(page({ attachments: [ON_7], item: reading({ ran_at: ago(130) }) })).pill, 'Re-run before attaching');
  // Proposals and nothing attached: Attachable, and the picker offers a proposal.
  const free = page();
  assert.deepEqual(attachSays(free), { pill: 'Attachable', tile: 'Attachable', sub: 'range + run date travel together' });
  assert.ok(has(proposalInk(free), 'text-emerald-700') && has(proposalInk(free), 'dark:text-emerald-300'));
  const card = part(free, 'market-reading-attachment');
  assert.match(card, />Attach to a proposal<\/button>/);
  assert.doesNotMatch(card, /data-testid="pill"/, 'an unattached card shows an Attached pill');
});

test('once attached, the card says so with a pill and the picker offers another proposal', () => {
  const html = page({ attachments: [ON_7] });
  assert.equal(attachSays(html).pill, 'Attached');
  const card = part(html, 'market-reading-attachment');
  assert.match(card, /data-testid="pill"[^>]*>Attached<\/span>/);
  assert.match(words(card), /Attached to Website rebuild\./);
  assert.match(card, /<select aria-label="Another proposal"/);
  assert.match(card, />Attach to another proposal<\/button>/);
  assert.doesNotMatch(card, />Attach to a proposal<\/button>/);
  assert.deepEqual([...card.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]), ['9'],
    'the proposal it is already on is offered again');

  // On every proposal the account has: no picker, and a sentence that says so.
  const everywhere = part(page({ attachments: [ON_7, { ...ON_7, uid: 'att_2', quote_id: 9, proposal_name: null }] }), 'market-reading-attachment');
  assert.doesNotMatch(everywhere, /<select/);
  assert.match(words(everywhere), /There is no other proposal on this account to attach it to\./);

  // The picker opens on a proposal it is not on yet.
  const src = codeOnly(read('frontend/src/pages/research/MarketReading.jsx'));
  assert.match(src, /const open = openProposals\(full\.proposals, full\.attachments\);\s*setQuoteId\(open\[0\] \? String\(open\[0\]\.id\) : ''\);/);
});

// ---- 7. One h1 ---------------------------------------------------------------

test('the shell keeps its h1 for every other page, and can draw the same line as a paragraph', () => {
  const shell = (props) => routed(
    React.createElement(WorkspaceShell, { role: 'partner', title: 'Markets', ...props }, React.createElement('p', null, 'BODY')),
    '/research/markets',
  );
  assert.match(shell({}), /<h1 class="m-0 text-xl font-extrabold tracking-tight">Markets<\/h1>/);
  const quiet = shell({ titleAs: 'p' });
  assert.doesNotMatch(quiet, /<h1\b/);
  assert.match(quiet, /<p class="m-0 text-xl font-extrabold tracking-tight">Markets<\/p>/);
});

test('the reading page has exactly one h1 in every state, and once loaded it is the metric', () => {
  const h1s = (html) => [...html.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);
  const loaded = page();
  assert.deepEqual(h1s(loaded), ['Design system build']);
  assert.match(loaded, /<p class="m-0 text-xl font-extrabold tracking-tight">Design system build<\/p>/);
  // Loading or failed, the page draws no heading of its own and the shell's stays.
  for (const state of [{ loading: true }, { error: 'This reading is not on your list.' }]) {
    assert.deepEqual(h1s(routed(React.createElement(MarketReadingView, { role: 'partner', ...state }))), ['Market reading']);
  }
  // The routed page itself: react-dom/server runs no effect, so it is loading.
  assert.deepEqual(h1s(routed(React.createElement(MarketReading, { role: 'partner' }))), ['Market reading']);
});
