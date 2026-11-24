/**
 * D6120 (#6120, Grow v2 Markets GR-21 to GR-28) — /grow/market-expansion built to its boards.
 *
 *   · the rules (`marketsModel.js`): readiness only with all four parts, the weakest part, the next step's order,
 *     Compare never comparing an unscored part, the state chips' counts, Overdue, the evidence strip's Not recorded;
 *   · the list page (`MarketsHome.jsx`): the ranked table and phone cards, Not recorded naming the unscored parts,
 *     a measured 0, first use, one market, Unavailable (never an empty list), read only, Compare as a panel;
 *   · the record page (`MarketRecord.jsx`): the part tiles, Overdue by word, Not recorded owner and due date, the
 *     side column's failures, and no control for a reader;
 *   · the wiring: Grow's def gives Markets its own page and record, and old deep links keep their addresses.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_markets_6120.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, matchRoutes } from 'react-router-dom';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';
import grow from '../src/pages/cycles/defs/grow.jsx';
import { fnOf } from '../src/pages/cycles/adapters/index.js';
import { RECORDS } from '../src/pages/cycles/adapters/grow.js';
import MarketsHome, { ComparePanel } from '../src/pages/cycles/MarketsHome.jsx';
import MarketRecord from '../src/pages/cycles/MarketRecord.jsx';
import { RecordPhoneProvider } from '../src/pages/cycles/RecordView.jsx';
import {
  compareSummary, diffWords, evidenceFor, partnerLine, handoffLinks, marketView, nextStep, planLine, sizeLabel, stateChips, stepOverdue,
} from '../src/pages/cycles/marketsModel.js';

const h = React.createElement;
const ssr = (el, path = '/grow/market-expansion?project_id=7') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const ROW = (o = {}) => ({
  uid: 'mka', name: 'Portugal', state: 'entering', decision: 'enter', decided_on: '2026-10-02',
  demand_score: 8, demand_source: 'Twelve calls', regulation_score: 7, regulation_source: 'Memo',
  partners_score: 6, partners_source: 'Two resellers', cost_score: 7, cost_source: 'Budget v3',
  country_name: 'Portugal', country_region: 'Europe', replies: [], size_cents: null,
  steps_total: 5, steps_open: 3, steps_overdue: 1, localisation_done: 1, localisation_open: ['payments', 'legal_entity'], ...o,
});
const UNSCORED = ROW({ uid: 'mkc', name: 'Chile', state: 'considering', decision: null, decided_on: null, regulation_score: null, regulation_source: null, cost_score: null, cost_source: null, country_name: null });
const records = (rows, extra = {}) => ({
  rows: rows.map((r, i) => RECORDS['market-expansion'].row(r, i)), total: rows.length, page: 1, page_size: 25, linkable: true, ...extra,
});
const add = [{ text: 'Add market', href: '/grow/market-expansion/new?project_id=7', state: {} }];
const rowHref = (row) => `/grow/market-expansion/${row.recordId}?project_id=7`;
const WRITER = { can_write: true, state_counts: { considering: 1, entering: 1, served: 0, not_now: 0 }, replies_state: 'ok', plan_state: 'ok' };

// Mutation checked: readiness summed with a part unscored (fails); weakestOf's unscored-first line dropped (fails, beside a measured 0).
test('readiness is out of 40 only with all four parts; the weakest names an unscored part first, a measured 0 as 0', () => {
  const a = marketView(ROW());
  assert.equal(a.readiness, 28);
  assert.deepEqual(a.weakest, { part: 'Partners', score: 6 });
  const c = marketView(UNSCORED);
  assert.equal(c.readiness, null);
  assert.deepEqual(c.missing, ['Regulation', 'Cost to enter']);
  assert.deepEqual(c.weakest, { part: 'Regulation', score: null });
  // An unscored part is weakest even beside a measured 0, and never read as one.
  assert.deepEqual(marketView(ROW({ demand_score: 0, regulation_score: null, regulation_source: null })).weakest, { part: 'Regulation', score: null });
  const zero = marketView(ROW({ regulation_score: 0 }));
  assert.equal(zero.readiness, 21);
  assert.deepEqual(zero.weakest, { part: 'Regulation', score: 0 });
});

// Mutation checked: the gap check after the Not now check (fails); the plan-null guard removed (fails).
test('the next step: an unscored part first, then the first entry step, then the first open check; none when Not now', () => {
  assert.deepEqual(nextStep(marketView(UNSCORED)), { text: 'Score regulation, and say where it came from', open: 'edit' });
  assert.deepEqual(nextStep(marketView(UNSCORED)), nextStep(marketView({ ...UNSCORED, state: 'not_now' })), 'scoring comes first even when Not now');
  assert.deepEqual(nextStep(marketView(ROW({ steps_total: 0, steps_open: 0, steps_overdue: 0 }))), { text: 'Add the first entry step', open: 'add-entry-step' });
  assert.deepEqual(nextStep(marketView(ROW())), { text: 'Tick Payments', open: null, hash: 'localisation' });
  assert.equal(nextStep(marketView(ROW({ state: 'not_now' }))), null);
  assert.equal(nextStep(marketView(ROW({ decision: 'exit' }))), null);
  // A list whose plan counts could not be read names no step past scoring.
  assert.equal(nextStep(marketView(ROW({ steps_total: null, localisation_done: null }))), null);
});

// Mutation checked: diffWords comparing a null as 0 (fails); compareSummary.readiness without the both-scored guard (fails).
test('Compare names differences in words and never compares an unscored part or readiness', () => {
  const a = marketView(ROW()); const c = marketView(UNSCORED);
  const b = marketView(ROW({ uid: 'mkb', name: 'Spain', demand_score: 5, partners_score: 6 }));
  assert.deepEqual(diffWords(a, b, 'demand'), { compared: true, text: 'Portugal leads on Demand by 3' });
  assert.deepEqual(diffWords(a, b, 'partners'), { compared: true, text: 'Level at 6' });
  assert.deepEqual(diffWords(a, c, 'regulation'), { compared: false, text: 'Can’t compare: Chile has no regulation score' });
  assert.deepEqual(compareSummary(a, c).readiness, { compared: false, text: 'Can’t compare until both are fully scored' });
  assert.equal(compareSummary(a, b).readiness.text, 'Portugal leads by 3');
  assert.equal(compareSummary(a, b).weakest, null, 'Spain is weakest on Demand');
  assert.equal(compareSummary(a, marketView(ROW({ uid: 'mkd', name: 'Italy', demand_score: 9 }))).weakest, 'Both weakest on Partners');
  const html = text(ssr(h(ComparePanel, { a, b: c, onClose() {} })));
  assert.match(html, /Compare Portugal and Chile/);
  assert.match(html, /Can’t compare: Chile has no regulation score/);
  assert.doesNotMatch(html, /Chile leads|Portugal leads on Regulation/);
  const stacked = ssr(h(ComparePanel, { a, b, phone: true, onClose() {} }));
  assert.match(stacked, /data-testid="market-compare-stacked"/);
  assert.doesNotMatch(stacked, /<table/);
});

// Mutation checked: stepOverdue `due >= today` → `>` (fails). (stateChips' `?? 0` dropped is equivalent: null adds as 0.)
test('the chips count every market; Overdue is a due day before today and not done; the plan line counts', () => {
  assert.deepEqual(stateChips({ considering: 2, entering: 1, served: 0, not_now: 1 }).map((c) => [c.label, c.count]),
    [['All', 4], ['Considering', 2], ['Entering', 1], ['Served', 0], ['Not now', 1]]);
  assert.equal(stateChips({ considering: 2 })[0].count, 2, 'a state the read left out adds nothing to All');
  assert.deepEqual(stateChips(undefined).map((c) => c.count), [null, null, null, null, null], 'unread counts are not zeros');
  assert.equal(stepOverdue({ due_on: '2026-11-10', done_at: null }, '2026-11-14'), 4);
  assert.equal(stepOverdue({ due_on: '2026-11-14', done_at: null }, '2026-11-14'), null);
  assert.equal(stepOverdue({ due_on: '2026-11-10', done_at: '2026-11-11' }, '2026-11-14'), null);
  assert.equal(stepOverdue({ due_on: null, done_at: null }, '2026-11-14'), null);
  const steps = [{ done_at: 'x' }, { done_at: 'y' }, { due_on: '2026-11-10' }, { due_on: '2026-11-30' }, {}];
  assert.equal(planLine(steps, 5, '2026-11-14'), '2 of 5 done · 1 overdue');
  assert.equal(planLine(steps, 40, '2026-11-14'), '2 of 40 done · 1 overdue · 5 shown');
});

test('the evidence strip counts what Research holds and says Not recorded for what no store holds', () => {
  const ev = evidenceFor({ item: { name: 'Portugal', region: 'Europe' }, as_of: { signals: '2026-11-01', companies: '2026-11-01', funds: '2026-09-30' },
    signals: [{ match: 'country' }, { match: 'country' }, { match: 'region' }], company_count: 214, fund_count: 19,
    companies_by_market: [{ name: 'Robotics', count: 38 }, { name: 'Logistics', count: 22 }, { name: 'Other', count: 1 }],
    demand: { status: 'not_recorded', reason: 'Demand data is global only.' } });
  assert.deepEqual(ev.demand.map((e) => [e.state, e.label]), [['value', 'Signals naming Portugal: 2'], ['not_recorded', 'Per-country demand'], ['not_recorded', 'Customers or sign-ups from Portugal']]);
  assert.equal(ev.demand[0].asOf, '1 Nov 2026');
  assert.equal(ev.regulation[0].label, 'Signals naming only Europe: 1');
  assert.equal(ev.regulation[1].state, 'not_recorded');
  assert.equal(ev.partners[0].label, 'Companies in Portugal: 214');
  assert.equal(ev.partners[1].state, 'not_recorded');
  assert.equal(ev.cost[1].label, 'Companies by market: Robotics 38 · Logistics 22');
  assert.equal(sizeLabel({ cents: 420000000, currency: 'EUR' }), '€4.2M');
  assert.equal(sizeLabel(null), null);
  assert.deepEqual(handoffLinks('?project_id=7').map((l) => l.href), ['/grow/distribution?project_id=7', '/grow/partnerships?project_id=7']);
});

// Mutation checked: Readiness's Not recorded branch removed (fails); NextCell ignoring canWrite (read-only test fails); the pick's label (phone test fails).
test('the list: ranked rows with Not recorded naming the unscored parts, the chips, and each row’s next step', () => {
  const html = ssr(h(MarketsHome, { records: records([ROW(), UNSCORED]), add, rowHref, parts: WRITER, query: {}, onQuery() {} }));
  const t = text(html);
  assert.match(html, /data-testid="markets-table"/);
  assert.match(t, /28 out of 40, current/);
  assert.match(t, /Not recorded/);
  assert.match(t, /Regulation, Cost to enter not scored/);
  assert.doesNotMatch(t, /Chile[^]*?\b0 \/ 40/);
  assert.match(t, /Score regulation, and say where it came from →/);
  assert.match(t, /Tick Payments →/);
  assert.match(html, /href="\/grow\/market-expansion\/mkc\?project_id=7"/);
  assert.match(t, /Portugal · Europe/);
  assert.match(t, /No country attached/);
  assert.match(t, /All 2/);
  assert.match(t, /Served 0/);
  assert.match(t, /Unscored markets sort after scored ones/);
  assert.match(html, /data-testid="markets-add"/);
  // Compare waits for two picks.
  assert.match(t, /Pick two markets to compare/);
});

test('phone: cards, 44px picks, the same next step', () => {
  const html = ssr(h(MarketsHome, { records: records([ROW(), UNSCORED]), add, rowHref, parts: WRITER, phone: true, query: {}, onQuery() {} }));
  assert.match(html, /data-testid="markets-cards"/);
  assert.doesNotMatch(html, /<table/);
  assert.equal((html.match(/data-testid="market-card"/g) || []).length, 2);
  assert.match(html, /max-lg:min-h-\[44px\]/);
  assert.match(html, /aria-label="Pick Chile to compare"/);
  assert.match(text(html), /Score regulation/);
});

// Mutation checked: the zero branch removed (fails: draws the table); `one` without `everything === 1` (fails).
test('first use has one action; one market disables Compare with its reason', () => {
  const zero = text(ssr(h(MarketsHome, { records: records([]), add, rowHref, parts: { ...WRITER, state_counts: { considering: 0, entering: 0, served: 0, not_now: 0 } }, query: {}, onQuery() {} })));
  assert.match(zero, /No markets yet/);
  assert.match(zero, /Add your first market/);
  assert.doesNotMatch(zero, /Compare/);
  const one = ssr(h(MarketsHome, { records: records([UNSCORED]), add, rowHref, parts: { ...WRITER, state_counts: { considering: 1, entering: 0, served: 0, not_now: 0 } }, query: {}, onQuery() {} }));
  assert.match(text(one), /Add a second market to compare/);
  assert.match(one, /disabled=""[^>]*data-testid="markets-compare"|data-testid="markets-compare"[^>]*disabled/);
});

test('a failed list read is Unavailable with Try again, never an empty list; a filter with no match says so', () => {
  const t = text(ssr(h(MarketsHome, { records: { state: 'unreadable', rows: [] }, recordsStatus: 'unreadable', add, rowHref, parts: WRITER, onRetryRecords() {} })));
  assert.match(t, /Unavailable/);
  assert.match(t, /The market list could not be read/);
  assert.match(t, /not shown as an empty list/);
  assert.match(t, /Try again/);
  assert.doesNotMatch(t, /No markets yet/);
  const none = text(ssr(h(MarketsHome, { records: records([]), add, rowHref, parts: WRITER, query: { filter: { state: 'served' } }, onQuery() {} })));
  assert.match(none, /No market is served\./);
  const loading = ssr(h(MarketsHome, { records: undefined, recordsStatus: 'loading', add, rowHref, parts: WRITER }));
  assert.match(loading, /aria-busy="true"/);
});

test('read only: no Add, no next step, a line that says why', () => {
  const t = text(ssr(h(MarketsHome, { records: records([ROW(), UNSCORED]), add, rowHref, parts: { ...WRITER, can_write: false }, query: {}, onQuery() {} })));
  assert.match(t, /You can read this venture’s markets/);
  assert.doesNotMatch(t, /Add market/);
  assert.doesNotMatch(t, /Score regulation/);
});

const STEP_TODAY = new Date().toISOString().slice(0, 10); // clock-ok: relative
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); // clock-ok: relative
const RECORD = (o = {}) => ({
  title: 'Portugal',
  parts: { market: {
    state: 'entering', decision: 'enter', decided_on: '2026-10-02',
    scores: [{ key: 'demand', score: 8, source: 'Twelve calls' }, { key: 'regulation', score: 0, source: 'Licence moratorium' }, { key: 'partners', score: null, source: null }, { key: 'cost', score: 7, source: 'Budget' }],
    geography_ref: null, country: null, country_state: 'none', size: null,
    steps: [{ uid: 'st1', text: 'Sign the first reseller', owner_name: null, due_on: daysAgo(4), done_at: null },
      { uid: 'st2', text: 'Hire a country lead', owner_name: 'Ana', due_on: null, done_at: null }],
    steps_total: 2, steps_state: 'ok',
    localisation: [{ key: 'language', label: 'Language', done_at: '2026-11-12T10:00:00Z' }, { key: 'payments', label: 'Payments', done_at: null }, { key: 'legal_entity', label: 'Legal entity', done_at: null }],
    localisation_state: 'ok', replies: null, replies_state: 'unreadable', ...o,
  } },
  main: [{ key: 'entry-plan', rows: [
    { a: 'Sign the first reseller', action: { key: 'mark-entry-step-done', body: { step: 'st1' } }, actions: [{ key: 'edit-entry-step', body: { step: 'st1' } }, { key: 'remove-entry-step', body: { step: 'st1' } }] },
  ] }, { key: 'localisation', rows: [{ a: 'Payments', action: { key: 'localisation-check', body: { key: 'payments', done: true } } }] }],
  actions: [
    { key: 'edit', label: 'Edit', kind: 'form', tone: 'primary' },
    { key: 'add-entry-step', label: 'Add entry step', kind: 'form' },
    { key: 'mark-entry-step-done', label: 'Mark done', kind: 'write', row_only: true },
    { key: 'edit-entry-step', label: 'Edit', kind: 'form', row_only: true },
    { key: 'remove-entry-step', label: 'Remove', kind: 'write', tone: 'danger', row_only: true },
    { key: 'localisation-check', label: 'Tick a localisation check', kind: 'write', row_only: true },
  ],
  activity: [], activity_total: 0,
});
const handlers = { onForm() {}, onWrite() {}, onShowAll() {} };

// Mutation checked: the Overdue chip keyed on `over == null` (fails); the replies Unavailable branch → "No replies" (fails).
test('the record: part tiles, a measured 0, Overdue by word, Not recorded owner and due date, Unavailable replies', () => {
  void STEP_TODAY;
  const html = ssr(h(MarketRecord, { record: RECORD(), activity: [{ a: 'Market updated by Ana', b: '2026-11-12 16:20:00' }], ...handlers }), '/grow/market-expansion/mka?project_id=7');
  const t = text(html);
  assert.equal((html.match(/data-testid="market-part"/g) || []).length, 4);
  assert.match(t, /Measured 0/);
  assert.match(t, /Source: Licence moratorium/);
  assert.match(t, /No source yet/);
  assert.match(t, /Overdue · 4 days/);
  assert.match(html, /data-overdue="true"/);
  assert.match(t, /Owner not recorded/);
  assert.match(t, /Due date not recorded/);
  assert.match(t, /1 of 3 done/);
  assert.match(t, /Replies could not be read/);
  assert.doesNotMatch(t, /No replies to a market ask yet/);
  assert.match(t, /No Research › Geographies country attached/);
  assert.match(t, /No size recorded/);
  assert.match(t, /12 Nov 16:20/);
  assert.match(t, /Current decision: Enter, decided 2 Oct 2026/);
  assert.match(html, /href="\/grow\/durable-company-building\?project_id=7&amp;add=1"/);
  assert.match(html, /href="\/grow\/distribution\?project_id=7"/);
  assert.match(html, /role="checkbox" aria-checked="false" aria-label="Mark done: Sign the first reseller"/);
  assert.match(html, /aria-label="Remove: Sign the first reseller"/);
  // Readiness is Not recorded while Partners is unscored.
  assert.match(t, /Partners not scored/);
});

test('the record for a reader draws no control; on a phone the parts and side fold into disclosure rows', () => {
  const reader = { ...RECORD(), actions: [], main: [{ key: 'entry-plan', rows: [{ a: 'Sign the first reseller' }] }, { key: 'localisation', rows: [{ a: 'Payments' }] }] };
  const html = ssr(h(MarketRecord, { record: reader, activity: [], ...handlers }));
  assert.doesNotMatch(html, /role="checkbox"/);
  assert.doesNotMatch(html, /data-testid="market-add-step"/);
  assert.doesNotMatch(html, />Remove</);
  const phone = ssr(h(RecordPhoneProvider, { phone: true }, h(MarketRecord, { record: RECORD({ replies: [], replies_state: 'ok' }), activity: [], ...handlers })));
  assert.equal((phone.match(/data-testid="market-part-row"/g) || []).length, 4);
  assert.match(phone, /<details[^>]*data-testid="market-history"/);
  const sized = text(ssr(h(MarketRecord, { record: RECORD({ size: { cents: 420000000, currency: 'EUR', source: 'Analyst note' } }), activity: [], ...handlers })));
  assert.match(sized, /€4\.2M/);
  assert.match(sized, /Source: Analyst note/);
  assert.doesNotMatch(sized, /No size recorded/);
  assert.match(text(phone), /No replies to a market ask yet/);
});

// Mutation checked: the homes entry removed (fails); the recordPage entry removed (fails); the adapter's `market: r` dropped (fails).
test('Markets owns its page and its record in Grow’s def, and the old addresses still land there', () => {
  const home = fnOf(grow.homes, 'market-expansion')?.({ parts: WRITER }, { projectId: 7 });
  assert.equal(typeof home?.body, 'function');
  assert.match(home.sub, /readiness out of 40/);
  assert.equal(typeof fnOf(grow.recordPage, 'market-expansion'), 'function');
  assert.equal(fnOf(grow.homes, 'partner-network'), null, 'other Grow modules keep the generic page');
  assert.equal(RECORDS['market-expansion'].row(ROW(), 0).market.uid, 'mka');
  const app = codeOnly(readRoutesSource());
  const routes = Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g), ([, path]) => ({ path }));
  const matched = (pathname) => matchRoutes(routes, { pathname })?.at(-1)?.route.path;
  assert.equal(matched('/grow/market-expansion'), '/grow/:slug');
  assert.equal(matched('/grow/market-expansion/mka1'), '/grow/:slug/:id');
  assert.equal(matched('/grow/market-expansion/new'), '/grow/:slug/new');
});

// D8254 (#8254). Mutation checked: a failed read (null) shown as none linked (fails); the empty state dropped (fails);
// the record not passing its partners to the evidence strip (fails); a linked partner not linking to its record (fails).
test('partners: the record lists the linked partners, an empty state when none, Unavailable when the read failed', () => {
  const linked = [{ uid: 'pta', name: 'Harbour Resellers', type: 'reseller', stage: 'signed' }, { uid: 'ptb', name: 'Anchor Agency', type: 'co_marketing', stage: 'talking' }];
  const t = text(ssr(h(MarketRecord, { record: RECORD({ partners: linked, partners_state: 'ok' }), activity: [], ...handlers })));
  const phone = text(ssr(h(RecordPhoneProvider, { phone: true }, h(MarketRecord, { record: RECORD({ partners: linked, partners_state: 'ok' }), activity: [], ...handlers }))));
  assert.match(phone, /Partners 2 linked/);
  assert.match(t, /Harbour Resellers reseller · signed/);
  assert.match(t, /Anchor Agency co marketing · talking/);
  const html = ssr(h(MarketRecord, { record: RECORD({ partners: linked, partners_state: 'ok' }), activity: [], ...handlers }), '/grow/market-expansion/mka?project_id=7');
  assert.match(html, /href="\/grow\/partner-network\/pta\?project_id=7"/);
  const none = text(ssr(h(MarketRecord, { record: RECORD({ partners: [], partners_state: 'ok' }), activity: [], ...handlers })));
  assert.match(none, /No partner is linked to this market yet/);
  assert.match(none, /Link one in Partnerships/);
  const down = text(ssr(h(MarketRecord, { record: RECORD({ partners: null, partners_state: 'unreadable' }), activity: [], ...handlers })));
  assert.match(down, /Linked partners/);
  assert.match(down, /not a claim that none is linked/);
  assert.doesNotMatch(down, /No partner is linked/);
  assert.deepEqual(partnerLine('Portugal', linked), { state: 'value', label: 'Partners linked to Portugal: 2', asOf: null });
  assert.equal(partnerLine('Portugal', []).state, 'not_recorded');
  assert.equal(partnerLine('Portugal', null).state, 'unavailable');
  assert.equal(partnerLine('Portugal', undefined).state, 'not_recorded');
  assert.match(readFileSync(new URL('../src/pages/cycles/MarketRecord.jsx', import.meta.url), 'utf8'), /evidenceFor\(geo\.data, m\.partners\)/, 'the record hands its partners to the evidence strip');
});
