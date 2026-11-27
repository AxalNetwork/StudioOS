/** D5952: real metric envelopes, missing values, exact period/currency joins and rendered states.
 *
 * From frontend/test/README.md (moved by #6472): D5952: quarterly ledger metric states,
 * currency/period joins, per-licence receipts and AI, automatic promo report and coverage
 * metadata; rendered components over synthetic envelopes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { UNAVAILABLE, revenueScopes, revenueMetric, subscriptionLines, subsidiaryMetricRows, licenceAiRows, promoMetricFacts, coverageSources } from '../src/pages/hq/revenue/revenueModel.js';
import { ExecutiveSummary } from '../src/pages/hq/revenue/ExecutiveSummary.jsx';
import { RevenueStreams, AiEconomicsSection } from '../src/pages/hq/revenue/RevenueStreams.jsx';
import { SubsidiariesSection } from '../src/pages/hq/revenue/Subsidiaries.jsx';
import { PromotionsSection } from '../src/pages/hq/revenue/Promotions.jsx';
import { DataCoverageDrawer } from '../src/pages/hq/revenue/RevenueHeader.jsx';
const period = '2026-Q4';
const NOW = Date.parse('2026-11-22T12:00:00Z');
const metric = (key, values, extra = {}) => ({ key, state: 'complete', period, values, source: 'Recorded source', currencies: ['EUR', 'USD'], last_reconciled_at: '2026-11-21T09:00:00Z', last_reconciled_basis: 'Recorded reconciliation', incomplete_rows: 0, incomplete_detail: {}, coverage: { state: 'covered', recorded_from: '2026-10-01T00:00:00Z', recorded_by: 'Recorded coverage' }, ...extra });
const summary = (metrics) => ({ metrics, token_cost: { available: false }, usage_coverage: { available: true, period, by_licence: [] }, licence_fees: { available: true, by_currency: [], active_without_fee: 0 }, promos: { available: true, active_codes: 0, redemptions: 0 } });
const sub = (extra = {}) => metric('subscription_revenue', { by_currency: [{ currency: 'EUR', gross_cents: 12000, refund_cents: 2000, net_cents: 10000 }, { currency: 'USD', gross_cents: 0, refund_cents: 0, net_cents: 0 }] }, extra);
const html = (Component, props) => render(React.createElement(MemoryRouter, null, React.createElement(Component, props)));
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('subscriptions preserve each currency, exact period and incomplete values; never infer a zero', () => {
  const data = summary({ subscription_revenue: sub() });
  const lines = subscriptionLines(data, period).rows;
  assert.deepEqual(lines.map((r) => r.currency), ['EUR', 'USD']);
  assert.equal(lines[0].net.state, 'recorded');
  assert.equal(lines[1].net.state, 'zero');
  assert.equal(subscriptionLines(summary({ subscription_revenue: sub({ state: 'incomplete', incomplete_rows: 2 }) }), period).rows[0].net.text.endsWith('+'), true);
  for (const state of ['not_recorded', 'unreadable']) assert.equal(subscriptionLines(summary({ subscription_revenue: sub({ state }) }), period).rows.length, 0);
  assert.equal(revenueMetric(data, 'subscription_revenue', '2026-Q3').state, 'unavailable');
  assert.equal(revenueMetric(UNAVAILABLE, 'subscription_revenue', period).state, 'unavailable');
  assert.equal(revenueMetric(null, 'subscription_revenue', period).state, 'loading');
  assert.equal(revenueMetric({}, 'subscription_revenue', period).state, 'not_recorded');
  const missing = sub(); missing.values.by_currency[0].net_cents = null;
  assert.deepEqual(subscriptionLines(summary({ subscription_revenue: missing }), period).rows[0].net, { state: 'not_recorded', text: null });
});

test('rendered summary and stream table consume subscription metrics, not fixed absent placeholders', () => {
  const data = summary({ subscription_revenue: sub() });
  const output = html(ExecutiveSummary, { summary: data, refunds: null, disputes: null, period });
  assert.match(text(output), /Subscription revenue · EUR/);
  assert.match(output, /100\.00/);
  assert.doesNotMatch(output, /No local subscription ledger/);
  const streams = html(RevenueStreams, { summary: data, periodStatements: null, period });
  assert.match(text(streams), /Gross .*120\.00.*Refunds .*20\.00/);
  assert.match(streams, /data-value-state="zero"/);
});

test('subsidiary streams use their own currency and state, stale only in current quarter, no statements required', () => {
  const data = summary({ revenue_per_subsidiary: metric('revenue_per_subsidiary', { by_licence: [
    { licence_uid: 'fr', brand_name: 'France', reported: true, reported_at: '2026-11-01T00:00:00Z', streams: [{ stream: 'subscription', currency: 'EUR', gross_cents: 12000, is_estimate: false }, { stream: 'token_margin', state: 'not_available', gross_cents: null }] },
    { licence_uid: 'uk', reported: false, reported_at: null, streams: [] },
  ] }) });
  const view = subsidiaryMetricRows(data, period, period, NOW);
  assert.equal(view.rows[0].streams[0].figure.state, 'stale');
  assert.equal(view.rows[0].streams[1].figure.text, null);
  assert.equal(view.rows[1].report.state, 'not_reported');
  assert.equal(subsidiaryMetricRows(data, period, '2027-Q1', NOW, 'fr').rows[0].streams[0].figure.state, 'recorded');
  const output = html(SubsidiariesSection, { summary: data, period, currentPeriod: period, nowMs: NOW, periodStatements: { available: true, items: [] } });
  assert.match(output, /120\.00/); assert.match(output, /Stale/); assert.match(output, /Not reported/); assert.match(output, /Not drawn/);
});

test('AI licence values stay separated, count unattributed and pre-migration even when HQ has no values', () => {
  const m = metric('ai_margin_per_licence', { by_licence: [{ licence_uid: 'a', billed_microusd: 3000000, cost_microusd: 1000000, margin_microusd: 2000000 }, { licence_uid: 'b', billed_microusd: null, cost_microusd: null, margin_microusd: null }], unattributed_runs: 3, pre_migration_runs: 2 });
  const data = summary({ ai_margin_per_licence: m });
  assert.equal(licenceAiRows(data, period, 'a').rows.length, 1);
  assert.equal(licenceAiRows(data, period).rows[1].margin.text, null);
  const output = html(AiEconomicsSection, { summary: data, period, licenceUid: 'a' });
  assert.match(text(output), /Billed · USD/); assert.match(text(output), /Unattributed runs 3/); assert.match(text(output), /Pre-migration runs 2/);
  m.state = 'not_recorded'; m.values = null; m.incomplete_detail = { unattributed: 4, pre_migration: 1 };
  const unknown = html(AiEconomicsSection, { summary: data, period });
  assert.match(text(unknown), /Not recorded/); assert.match(text(unknown), /Unattributed runs 4/);
});

test('automatic promo report supplies dated issued/remaining, exact currency and updated ceiling; failures never fall back', () => {
  const row = { licence_uid: 'fr', period, ceiling_cents: 20000, currency: 'EUR', issued_cents: 99999, issued_available: true, remaining_cents: 0 };
  const m = metric('promo_issued_per_licence', { by_licence: [{ ...row, issued_cents: 5000, issued_state: 'reported', reported_at: '2026-11-21T00:00:00Z' }] });
  const data = summary({ promo_issued_per_licence: m });
  const facts = promoMetricFacts(data, row, period);
  assert.match(facts.issued.text, /50\.00/); assert.match(facts.remaining.text, /150\.00/);
  assert.equal(promoMetricFacts(data, { ...row, currency: 'USD' }, period).remaining.text, null);
  assert.equal(promoMetricFacts(data, { ...row, ceiling_cents: 30000 }, period).remaining.text, null);
  const output = html(PromotionsSection, { summary: data, ceilings: { available: true, current_period: period, items: [row] }, coverage: { available: true, by_licence: [] }, period });
  assert.match(output, /150\.00/); assert.match(output, /2026-11-21T00:00:00Z/);
  m.state = 'unreadable';
  const failed = promoMetricFacts(data, row, period);
  assert.deepEqual(failed.remaining, { state: 'unavailable', text: null });
  m.state = 'incomplete'; m.values.by_licence[0].issued_state = 'not_reported';
  assert.equal(promoMetricFacts(data, row, period).issued.text, null);
});

test('coverage contains source, period, currencies, reconciliation and gaps, with reason once', () => {
  const m = sub({ state: 'incomplete', reason: 'Two rows have no amount.', incomplete_rows: 2, incomplete_detail: { missing_amount: 2 } });
  const data = summary({ subscription_revenue: m });
  const sources = coverageSources({ summary: data, statements: null, disputes: null, refunds: null, ceilings: null, period });
  const source = sources.find((x) => x.key === 'subscriptions');
  assert.equal(source.state, 'partial');
  const output = html(DataCoverageDrawer, { sources, period, onClose() {}, onReload() {} });
  for (const word of ['Recorded source', 'EUR, USD', '2026-11-21T09:00:00Z', 'missing amount', 'Gap']) assert.match(text(output), new RegExp(word));
  assert.equal(output.split(m.reason).length - 1, 1);
  assert.doesNotMatch(html(ExecutiveSummary, { summary: data, refunds: null, disputes: null, period }), /Two rows have no amount/);
});


test('Scope can select a licence supplied only by the new per-licence metrics, with no stale-period options', () => {
  const data = summary({ ai_margin_per_licence: metric('ai_margin_per_licence', { by_licence: [{ licence_uid: 'ai-only' }] }), revenue_per_subsidiary: metric('revenue_per_subsidiary', { by_licence: [{ licence_uid: 'fr', brand_name: 'France' }] }) });
  assert.deepEqual(revenueScopes(data, period), [{ licence_uid: 'fr', name: 'France' }, { licence_uid: 'ai-only', name: 'ai-only' }]);
  assert.deepEqual(revenueScopes(data, '2026-Q3'), []);
});


test('AI licence labels reuse recorded names, including names that arrive after a bare coverage UID', () => {
  const data = summary({
    ai_margin_per_licence: metric('ai_margin_per_licence', { by_licence: [{ licence_uid: 'fr', billed_microusd: 3000000, cost_microusd: 1000000, margin_microusd: 2000000 }] }),
    revenue_per_subsidiary: metric('revenue_per_subsidiary', { by_licence: [{ licence_uid: 'fr', brand_name: 'France' }] }),
  });
  data.usage_coverage.by_licence = [{ licence_uid: 'fr' }];
  assert.deepEqual(revenueScopes(data, period), [{ licence_uid: 'fr', name: 'France' }]);
  assert.equal(licenceAiRows(data, period).rows[0].name, 'France');
  assert.match(html(AiEconomicsSection, { summary: data, period }), /France/);
});

test('coverage always has a ledger row before metric metadata is attached, across recorded and absent invoice states', () => {
  for (const inv of [undefined, { available: false, reason: 'Read failed.' }, { available: true, by_currency: [], receivable_by_currency: [] }]) {
    const data = summary({ licence_fees_invoiced: metric('licence_fees_invoiced', { by_currency: [] }) });
    data.licence_invoices = inv;
    const rows = coverageSources({ summary: data, period });
    assert.equal(rows.filter((r) => r.key === 'ledger').length, 1);
    assert.ok(rows.find((r) => r.key === 'ledger').metadata.some(([k, v]) => k === 'Source' && v === 'Recorded source'));
  }
});

test('present failed and mismatched-period subscription reads say Unavailable, never Missing ledger', () => {
  for (const m of [sub({ state: 'unreadable' }), sub({ period: '2026-Q3' })]) {
    const output = html(RevenueStreams, { summary: summary({ subscription_revenue: m }), periodStatements: null, period });
    assert.match(text(output), /Unavailable/);
    assert.doesNotMatch(output, /Missing ledger/);
  }
});
