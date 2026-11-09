/**
 * D5039 (#5039, Revenue v2 part 1) — the read-only cockpit, held to the canvas
 * (`design/incoming/Revenue v2 Page.dc.html`, boards RV01 to RV14) and to the
 * rules the task set:
 *
 *   - Invoiced, Collected, Outstanding, Overdue and the trend are Not recorded
 *     while no ledger backs them, and never €0;
 *   - currencies are never summed;
 *   - every figure has a temporal label, and the period ones follow the Period;
 *   - eight value states, each a word and a shape;
 *   - Needs attention holds only what the reads show, and is absent when empty;
 *   - Remaining is never worked out from an unreported Issued figure;
 *   - each explanation lives once, in the Data coverage drawer;
 *   - readable type, no window.confirm.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { REVENUE_PAGE_FILES, revenuePageSource } from './_revenuePage.mjs';
import {
  LEDGER_REASON, PERIOD_KEY_RE, UNAVAILABLE, VALUE_STATES, VALUE_STATE_KEYS, attentionItems, ceilingFacts, coverageCount,
  coverageSources, currencyPosition, licencesWithoutCeiling, moneyFigure, outstandingByCurrency, periodOptions, receivableCounts,
  receivableRows, shiftPeriod, subsidiaryRows, summaryCurrencies, valueState,
} from '../src/pages/hq/revenue/revenueModel.js';
import { ExecutiveSummary, NeedsAttention } from '../src/pages/hq/revenue/ExecutiveSummary.jsx';
import { RevenueStreams, RevenueTrend } from '../src/pages/hq/revenue/RevenueStreams.jsx';
import { ReceivablesSection, StatementDrawHeld } from '../src/pages/hq/revenue/Receivables.jsx';
import { SubsidiariesSection } from '../src/pages/hq/revenue/Subsidiaries.jsx';
import { PromotionsSection } from '../src/pages/hq/revenue/Promotions.jsx';
import { DataCoverageDrawer, RevenueHeader } from '../src/pages/hq/revenue/RevenueHeader.jsx';
import { When } from '../src/pages/hq/revenue/RevenueStates.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const NOW = Date.UTC(2026, 10, 8, 14, 30);
const DAY = 86_400_000;

const SUMMARY = {
  quarter: { key: '2026-Q4', label: 'Q4 2026', start: '2026-10-01', end: '2027-01-01' },
  current_period: '2026-Q4',
  period_requested: false,
  read_at: new Date(NOW - 4 * 60_000).toISOString(),
  temporal: { licence_fees: 'as_of_now', token_cost: 'period', usage_coverage: 'period', promos: 'as_of_now', subscriptions: 'not_recorded' },
  licence_fees: {
    available: true, basis: 'One quarter of each active annual fee.', suspended_licences: 0, active_without_fee: 0,
    by_currency: [
      { currency: 'EUR', licences: 9, annual_cents: 38_500_000, quarter_cents: 9_625_000 },
      { currency: 'GBP', licences: 1, annual_cents: 1_200_000, quarter_cents: 300_000 },
    ],
  },
  token_cost: { available: true, currency: 'USD', calls: 398, cost_usd: 0.36, billed_available: true, member_runs: 1, runs_not_recorded: 1, margin_microusd: null },
  promos: { available: true, active_codes: 2, redemptions: 5, budget_reason: 'Budget reason.' },
  usage_coverage: {
    available: true, period: '2026-Q4', revenue_reason: 'Every stream arrives unmeasured.',
    by_licence: [
      { licence_uid: 'fr', licence_ref: 'AXL-FR', brand_name: 'France', reported: true, streams_reported: 2, streams_measurable: 0, reported_at: new Date(NOW - 2 * DAY).toISOString() },
      { licence_uid: 'dach', licence_ref: 'AXL-DE', brand_name: 'DACH', reported: true, streams_reported: 2, streams_measurable: 0, reported_at: new Date(NOW - 23 * DAY).toISOString() },
      { licence_uid: 'pt', licence_ref: 'AXL-PT', brand_name: 'Portugal', reported: false, streams_reported: 0, streams_measurable: 0, reported_at: null },
    ],
  },
  subscriptions_available: false,
  subscriptions_reason: 'Subscription revenue is not totalled anywhere in the database.',
  token_pl_per_subsidiary_reason: 'No account names its licence (U1).',
};
const stmt = (o) => ({
  uid: 's', licence_uid: 'fr', brand_name: 'France', period: '2026-Q3', gross_cents: 9_500_000, revenue_share_bps: 1200,
  owed_cents: 1_140_000, paid_cents: 760_000, disputed_cents: 0, outstanding_cents: 380_000, currency: 'EUR', status: 'issued',
  complete: true, unreported_streams: 0, estimated_streams: 0, created_at: '2026-10-10 10:00:00', ...o,
});
const STATEMENTS = {
  available: true, current_period: '2026-Q4',
  items: [
    stmt({ uid: 'paid', status: 'paid', paid_cents: 1_140_000, outstanding_cents: 0 }),
    stmt({ uid: 'issued' }),
    stmt({ uid: 'disputed', licence_uid: 'dach', brand_name: 'DACH', disputed_cents: 50_000, outstanding_cents: 330_000, dispute_note: 'Gross overstated' }),
    stmt({ uid: 'void', status: 'void', outstanding_cents: 1_140_000 }),
    stmt({ uid: 'gbp', licence_uid: 'uk', brand_name: 'UK', currency: 'GBP', outstanding_cents: 100_000 }),
    stmt({ uid: 'draft', status: 'draft', period: '2026-Q4', outstanding_cents: 900_000 }),
  ],
};
const PERIOD_STATEMENTS = { available: true, current_period: '2026-Q4', items: [stmt({ uid: 'q4', period: '2026-Q4', status: 'draft' })] };
const nowSec = Math.floor(NOW / 1000);
const DISPUTES = { ok: true, disputes: [
  { id: 'dp_late', amount: 120_000, currency: 'eur', status: 'needs_response', reason: 'product_not_received', due_by: nowSec - 3600, has_evidence: false },
  { id: 'dp_won', amount: 999, currency: 'eur', status: 'won', due_by: null, has_evidence: true },
] };
const REFUNDS = { available: true, window_days: 30, source: 'Refunds issued through HQ, from their audit rows.', count: 1, unreadable_rows: 0, by_currency: [{ currency: 'EUR', count: 1, amount_cents: 82_000 }], items: [] };
const ceiling = (o) => ({
  licence_uid: 'fr', brand_name: 'France', period: '2026-Q4', ceiling_cents: 1_000_000, currency: 'EUR', issued_cents: null,
  issued_available: false, remaining_cents: null, issued_reported_at: null, pushed_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T09:00:00Z', ...o,
});
const CEILINGS = { available: true, current_period: '2026-Q4', items: [
  ceiling({}),
  ceiling({ licence_uid: 'dach', brand_name: 'DACH', issued_cents: 210_000, issued_available: true, remaining_cents: 390_000, issued_reported_at: new Date(NOW - 23 * DAY).toISOString() }),
] };

/* ── the vocabulary ─────────────────────────────────────────────────── */

test('eight value states, in the canvas order, each a word and its own shape', () => {
  assert.deepEqual(VALUE_STATE_KEYS, ['recorded', 'zero', 'incomplete', 'not_recorded', 'not_reported', 'stale', 'unavailable', 'loading']);
  assert.deepEqual(VALUE_STATE_KEYS.map((k) => VALUE_STATES[k].word), ['Recorded', 'Zero', 'Incomplete', 'Not recorded', 'Not reported', 'Stale', 'Unavailable', 'Loading']);
  const shapes = VALUE_STATE_KEYS.map((k) => VALUE_STATES[k].shape);
  assert.equal(new Set(shapes).size, 8, 'two states share a shape, so they differ by colour alone');
  assert.throws(() => valueState('recordd'), /Unknown value state/);
});

test('a missing amount is never a zero: null is Not recorded, 0 is Zero, a floor carries its "+"', () => {
  assert.deepEqual(moneyFigure(null, 'EUR'), { state: 'not_recorded', text: null });
  assert.deepEqual(moneyFigure(undefined, 'EUR', { absent: 'not_reported' }), { state: 'not_reported', text: null });
  assert.equal(moneyFigure(0, 'EUR').state, 'zero');
  assert.equal(moneyFigure(0, 'EUR').text, '€0.00');
  const floor = moneyFigure(12_840_000, 'EUR', { incomplete: true });
  assert.equal(floor.state, 'incomplete');
  assert.match(floor.text, /^€128,400\.00\+$/);
});

test('the Period selector offers exact quarter keys, the Worker\'s own rule', () => {
  assert.deepEqual(periodOptions('2026-Q4').map((p) => p.key), ['2026-Q4', '2026-Q3', '2026-Q2', '2026-Q1', '2025-Q4', '2025-Q3', '2025-Q2', '2025-Q1']);
  assert.equal(periodOptions('2026-Q4')[0].current, true);
  assert.equal(periodOptions('2026-Q4')[0].label, 'Q4 2026');
  assert.deepEqual(periodOptions('Q4 2026'), [], 'a malformed key offers nothing rather than a guess');
  assert.equal(shiftPeriod('2026-Q1', -1), '2025-Q4');
  const worker = raw('cloudflare-worker/src/routes/admin_revenue.ts');
  const m = /export const SUMMARY_PERIOD_RE = (\/.*\/);/.exec(worker);
  assert.ok(m, 'the Worker no longer exports its period rule');
  assert.equal(m[1], String(PERIOD_KEY_RE), 'the page and the Worker disagree on what a period is');
});

test('temporal labels: the period is its own label, the rest say they ignore it', () => {
  assert.equal(text(html(React.createElement(When, { kind: 'period', period: '2026-Q4' }))).trim(), 'Q4 2026 — The selected period.');
  for (const [kind, word] of [['live', 'Live'], ['d30', 'Last 30 days'], ['now', 'As of now']]) {
    const t = text(html(React.createElement(When, { kind })));
    assert.match(t, new RegExp(`${word} — .*ignores the period`));
  }
});

/* ── the first viewport ─────────────────────────────────────────────── */

test('the ledger positions are Not recorded with one link to why, never €0', () => {
  const h = html(React.createElement(ExecutiveSummary, { summary: SUMMARY, refunds: REFUNDS, disputes: DISPUTES, period: '2026-Q4' }));
  const tiles = h.split('data-testid="hq-revenue-ledger-tiles"')[1].split('data-testid="hq-revenue-position-')[0];
  const t = text(tiles);
  for (const label of ['Invoiced', 'Collected', 'Outstanding', 'Overdue']) {
    assert.match(t, new RegExp(`${label} Not recorded`), `${label} is drawn as a figure`);
  }
  assert.doesNotMatch(tiles, /[€£$]\s?0|0\.00/, 'a ledger position was drawn as a zero');
  assert.equal((tiles.match(/data-why="ledger"/g) || []).length, 4, 'each tile points to the one explanation');
  assert.ok(!t.includes(LEDGER_REASON), 'the explanation is repeated on the tile instead of living in the drawer');
  // Invoiced and Collected follow the period; Outstanding and Overdue are points in time.
  assert.match(t, /Invoiced Not recorded[^]*?Q4 2026/);
  assert.match(t, /Outstanding Not recorded[^]*?As of now/);
});

test('each currency is its own row, never converted or added together', () => {
  assert.deepEqual(summaryCurrencies({ summary: SUMMARY, refunds: REFUNDS, disputes: DISPUTES }), ['EUR', 'GBP']);
  const h = html(React.createElement(ExecutiveSummary, { summary: SUMMARY, refunds: REFUNDS, disputes: DISPUTES, period: '2026-Q4' }));
  const eur = text(h.split('data-testid="hq-revenue-position-EUR"')[1].split('data-testid="hq-revenue-position-GBP"')[0]);
  const gbp = text(h.split('data-testid="hq-revenue-position-GBP"')[1]);
  assert.match(eur, /Contracted run-rate €96,250\.00 As of now/);
  assert.match(eur, /Refunds €820\.00 Last 30 days/);
  assert.match(eur, /Open disputes 1 Live/, 'a won dispute was counted, or the open one dropped');
  assert.match(eur, /€1,200\.00 at risk/);
  assert.match(gbp, /Contracted run-rate £3,000\.00/);
  assert.match(gbp, /Refunds £0\.00[^]*?Zero/, 'a currency with no refund in a read that answered is a measured zero');
  assert.doesNotMatch(eur, /£/);
  assert.doesNotMatch(gbp, /€/);
  // A failed read is Unavailable in every currency, never a zero.
  const failed = currencyPosition('EUR', { summary: SUMMARY, refunds: UNAVAILABLE, disputes: null });
  assert.equal(failed.refund.state, 'unavailable');
  assert.equal(failed.refund.text, null);
  assert.equal(failed.dispute.state, 'loading');
});

test('Needs attention is only what the reads show, most urgent first, and absent when nothing needs action', () => {
  const items = attentionItems({ summary: SUMMARY, statements: STATEMENTS, disputes: DISPUTES, ceilings: CEILINGS, period: '2026-Q4', currentPeriod: '2026-Q4', nowMs: NOW });
  assert.deepEqual(items.map((i) => i.key), [
    'dispute-overdue:dp_late', 'statement-disputed:disputed', 'report-stale:dach', 'report-missing:pt',
  ]);
  assert.equal(items[0].severity, 'critical');
  assert.equal(items[0].action.to, '/admin/revenue/disputes/dp_late');
  // Nothing to act on: no section at all.
  const quiet = attentionItems({
    summary: { ...SUMMARY, usage_coverage: { ...SUMMARY.usage_coverage, by_licence: [SUMMARY.usage_coverage.by_licence[0]] } },
    statements: { available: true, items: [stmt({ uid: 'v', status: 'void', disputed_cents: 500 })] },
    disputes: { ok: true, disputes: [] }, ceilings: { available: true, current_period: '2026-Q4', items: [ceiling({})] },
    period: '2026-Q4', currentPeriod: '2026-Q4', nowMs: NOW,
  });
  assert.deepEqual(quiet, [], 'a void statement, a pushed ceiling or a fresh report needs no action');
  assert.equal(html(React.createElement(NeedsAttention, { items: [] })), '');
  // An unpushed ceiling for the current quarter is not enforced, and is listed.
  const unpushed = attentionItems({ summary: null, statements: null, disputes: null, ceilings: { available: true, current_period: '2026-Q4', items: [ceiling({ pushed_at: null })] }, period: '2026-Q4', currentPeriod: '2026-Q4', nowMs: NOW });
  assert.equal(unpushed[0].key, 'ceiling-unpushed:fr');
  // A past period's reports are not stale for being old.
  const past = attentionItems({ summary: SUMMARY, statements: null, disputes: null, ceilings: null, period: '2026-Q3', currentPeriod: '2026-Q4', nowMs: NOW });
  assert.equal(past.length, 0);
});

/* ── streams and trend ──────────────────────────────────────────────── */

test('streams: Coverage replaces Read, the licence row is a contracted run-rate, and nothing is invoiced without a ledger', () => {
  const h = html(React.createElement(RevenueStreams, { summary: SUMMARY, periodStatements: PERIOD_STATEMENTS, period: '2026-Q4' }));
  assert.match(h, />Contracted run-rate<\/th>/);
  assert.match(h, />Coverage<\/th>/);
  assert.doesNotMatch(h, />Read<\/th>/);
  const t = text(h);
  assert.match(t, /Licence fees · EUR 9 active licences · As of now[^]*?€96,250\.00 Not recorded[^]*?Not recorded[^]*?Run-rate only/);
  assert.match(t, /Revenue-share statements · EUR[^]*?owed \(claim\)[^]*?paid, recorded by HQ/);
  assert.match(t, /Subscriptions[^]*?Not recorded[^]*?Missing ledger/);
  assert.doesNotMatch(t, /total/i, 'a total row appeared across a run-rate and a claim');
});

test('the trend draws nothing where no series exists: no chart, no zeros, one honest state', () => {
  const h = html(React.createElement(RevenueTrend, { period: '2026-Q4' }));
  assert.doesNotMatch(h, /<svg[^>]*role="img"/, 'a chart was drawn with no series behind it');
  assert.doesNotMatch(text(h), /\b0(\.0)?k?\b/);
  assert.match(text(h), /No monthly series recorded/);
  assert.match(h, /data-why="ledger"/);
});

/* ── receivables ────────────────────────────────────────────────────── */

test('receivables: disputed first, no Overdue without a due date, and outstanding per currency over open claims only', () => {
  const rows = receivableRows(STATEMENTS);
  assert.deepEqual(rows.map((r) => r.status), ['disputed', 'issued', 'issued', 'draft', 'paid', 'void']);
  const counts = receivableCounts(rows);
  assert.equal(counts.all, 6);
  assert.equal(counts.overdue, undefined, 'an Overdue count appeared, but no statement records a due date');
  const totals = outstandingByCurrency(rows);
  assert.deepEqual(totals.map((t) => [t.currency, t.cents]), [['EUR', 710_000], ['GBP', 100_000]], 'drafts or voids were counted, or currencies merged');
  const h = html(React.createElement(ReceivablesSection, { statements: STATEMENTS, onOpen() {} }));
  const t = text(h);
  assert.match(t, /Due Status/);
  assert.match(t, /As of now/);
  assert.doesNotMatch(t, /Overdue/);
  assert.match(t, /Outstanding in EUR €7,100\.00[^]*?Outstanding in GBP £1,000\.00/);
  assert.match(t, /not summed across them/);
});

test('statement drawing is a policy state with no action (D514)', () => {
  const h = html(React.createElement(StatementDrawHeld));
  assert.match(text(h), /Statement creation · policy decision required/);
  assert.doesNotMatch(h, /<button|<form|<select|<a /, 'the held policy offers an action');
});

/* ── subsidiaries and promotions ────────────────────────────────────── */

test('subsidiaries: reporting health first, Not drawn for a missing statement, stale only on the current quarter', () => {
  const rows = subsidiaryRows({ coverage: SUMMARY.usage_coverage, periodStatements: PERIOD_STATEMENTS, period: '2026-Q4', currentPeriod: '2026-Q4', nowMs: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.licence_uid, r]));
  assert.equal(by.fr.report.state, 'recorded');
  assert.equal(by.fr.owed.text, '€11,400.00');
  assert.equal(by.dach.report.state, 'stale');
  assert.equal(by.dach.owed.text, null);
  assert.equal(by.dach.owed.label, 'Not drawn');
  assert.equal(by.dach.gross.label, 'Amounts not reported');
  assert.equal(by.pt.report.state, 'not_reported');
  assert.equal(by.pt.coverage, 'not_reported');
  const past = subsidiaryRows({ coverage: SUMMARY.usage_coverage, periodStatements: PERIOD_STATEMENTS, period: '2026-Q3', currentPeriod: '2026-Q4', nowMs: NOW });
  assert.notEqual(past.find((r) => r.licence_uid === 'dach').report.state, 'stale');
  const t = text(html(React.createElement(SubsidiariesSection, { summary: SUMMARY, periodStatements: PERIOD_STATEMENTS, period: '2026-Q4', currentPeriod: '2026-Q4', nowMs: NOW })));
  assert.ok(t.indexOf('Report') < t.indexOf('Gross reported'), 'reporting health is not first');
});

test('promotions: badge columns, Remaining only beside a reported Issued, and the compact no-ceiling state', (t) => {
  // PromotionsSection reads its own clock (Date.now()) for "Stale · n d", and the
  // fixture is dated from NOW. Freeze the clock there, or the age drifts one day
  // per day of wall time and the assertion fails on the date alone.
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  // Even a Worker reply that carries a remaining figure is not drawn without a reported issued one.
  assert.equal(ceilingFacts(ceiling({ remaining_cents: 1_000_000 }), '2026-Q4').remaining.known, false);
  const coverage = { ...SUMMARY.usage_coverage };
  assert.deepEqual(licencesWithoutCeiling({ coverage, ceilings: CEILINGS, period: '2026-Q4' }).map((l) => l.licence_uid), ['pt']);
  // A ceiling set for another quarter is not this quarter's.
  const withQ3 = { ...CEILINGS, items: [...CEILINGS.items, ceiling({ licence_uid: 'pt', period: '2026-Q3' })] };
  assert.deepEqual(licencesWithoutCeiling({ coverage, ceilings: withQ3, period: '2026-Q4' }).map((l) => l.licence_uid), ['pt']);
  const h = html(React.createElement(PromotionsSection, { summary: SUMMARY, ceilings: CEILINGS, coverage, period: '2026-Q4', licences: null, nowMs: NOW }));
  for (const col of ['Ceiling', 'HQ', 'Branch', 'Enforcement', 'Issued', 'Remaining', 'Reporting']) assert.match(h, new RegExp(`>${col}</th>`));
  const fr = text(h.split('data-testid="hq-revenue-ceiling-state-fr-2026-Q4"')[1].split('</tr>')[0]);
  assert.match(fr, /HQ saved ✓ Branch synced ✓ Enforced[^]*?Not reported[^]*?Not recorded[^]*?Missing/);
  assert.doesNotMatch(fr, /€10,000\.00[^]*€10,000\.00/, 'the whole ceiling was drawn as Remaining');
  const dach = text(h.split('data-testid="hq-revenue-ceiling-state-dach-2026-Q4"')[1].split('</tr>')[0]);
  assert.match(dach, /€2,100\.00 €3,900\.00 Stale · 23 d/);
  const none = text(h.split('data-testid="hq-revenue-no-ceiling-pt"')[1].split('</tr>')[0]);
  assert.match(none, /No ceiling configured · Discounts currently allowed/);
  const past = html(React.createElement(PromotionsSection, { summary: SUMMARY, ceilings: CEILINGS, coverage, period: '2026-Q3', licences: null, nowMs: NOW }));
  assert.doesNotMatch(text(past), /Discounts currently allowed/, 'a past quarter says nothing about checkout now');
});

/* ── coverage ───────────────────────────────────────────────────────── */

test('coverage: every source once, counted, and each explanation lives only in the drawer', () => {
  const sources = coverageSources({ summary: SUMMARY, statements: STATEMENTS, disputes: DISPUTES, refunds: REFUNDS, ceilings: CEILINGS, period: '2026-Q4' });
  assert.deepEqual(sources.map((s) => s.key), ['licence_fees', 'ledger', 'statements', 'disputes', 'refunds', 'ai_cost', 'ai_margin', 'subscriptions', 'subsidiaries', 'promotions']);
  const byKey = Object.fromEntries(sources.map((s) => [s.key, s.state]));
  assert.deepEqual(byKey, {
    licence_fees: 'complete', ledger: 'not_recorded', statements: 'complete', disputes: 'live', refunds: 'complete',
    ai_cost: 'complete', ai_margin: 'not_recorded', subscriptions: 'not_recorded', subsidiaries: 'partial', promotions: 'partial',
  });
  assert.equal(coverageCount(sources).label, '5 of 10 sources complete');
  // Loading is not complete and not missing.
  const loading = coverageSources({ summary: null, statements: null, disputes: null, refunds: null, ceilings: null, period: '2026-Q4' });
  assert.equal(coverageCount(loading).complete, 0);
  assert.equal(coverageCount(loading).loading, 9, 'every read still out is Loading; only the ledger is known Not recorded');

  const page = [
    html(React.createElement(RevenueHeader, { period: '2026-Q4', periods: periodOptions('2026-Q4'), onPeriod() {}, scope: null, scopes: [], onScope() {}, readAt: SUMMARY.read_at, nowMs: NOW, sources, onCoverage() {} })),
    html(React.createElement(ExecutiveSummary, { summary: SUMMARY, refunds: REFUNDS, disputes: DISPUTES, period: '2026-Q4' })),
    html(React.createElement(RevenueStreams, { summary: SUMMARY, periodStatements: PERIOD_STATEMENTS, period: '2026-Q4' })),
    html(React.createElement(RevenueTrend, { period: '2026-Q4' })),
    html(React.createElement(ReceivablesSection, { statements: STATEMENTS, onOpen() {} })),
    html(React.createElement(PromotionsSection, { summary: SUMMARY, ceilings: CEILINGS, coverage: SUMMARY.usage_coverage, period: '2026-Q4', licences: null, nowMs: NOW })),
  ].map(text).join(' ');
  const drawer = text(html(React.createElement(DataCoverageDrawer, { sources, period: 'Q4 2026', readAt: SUMMARY.read_at, onClose() {}, onReload() {} })));
  for (const s of sources) {
    assert.ok(drawer.includes(text(s.reason).trim()), `${s.key}'s reason is not in the drawer`);
    assert.ok(!page.includes(text(s.reason).trim()), `${s.key}'s reason is repeated on the page`);
  }
  assert.match(page, /5 of 10 sources complete/);
  assert.match(page, /Read 4 min ago · 14:26 UTC/);
});

/* ── the source ─────────────────────────────────────────────────────── */

test('the source: no window.confirm, nothing important under 12px, no number defaulted to zero', () => {
  const SRC = codeOnly(revenuePageSource());
  assert.doesNotMatch(SRC, /window\.(confirm|alert|prompt)\(/);
  for (const rel of REVENUE_PAGE_FILES.filter((f) => f.includes('/revenue/'))) {
    assert.doesNotMatch(raw(rel), /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/, `${rel} draws type under 12px`);
  }
  assert.doesNotMatch(SRC, /\|\|\s*0\b|\?\?\s*0\b/);
  assert.doesNotMatch(SRC, /total_cents|platform_revenue|platformRevenue/);
  // The period reaches the Worker, and the period's statements are their own read.
  assert.match(SRC, /api\.hqRevenue\(p \|\| undefined\)/);
  assert.match(SRC, /api\.statements\(p\)\.then\(setPeriodStatements/);
});
