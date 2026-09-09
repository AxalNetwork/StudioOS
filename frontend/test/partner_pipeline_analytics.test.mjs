/**
 * PIPELINE · ANALYTICS ANSWERS THE FIRM'S OWN PIPELINE, NOT THE BOARD'S DEMAND.
 *
 * The Partner Pipeline canvas puts one question on `/pipeline/analytics`: "Win
 * rate, cycle time and forecast — and the loss pattern that explains all
 * three." The route rendered `PartnerInsightsPage` — Demand Insights, which
 * answers where founder demand is concentrated across the WHOLE board. Both
 * surfaces are honest; they are answers to different questions, and the zone
 * card underneath had to describe the wrong one to stay truthful.
 *
 * `GET /api/quotes/analytics` had computed win rate, median cycle and the
 * weighted forecast since build queue #122, and had two consumers — neither in
 * the Partner shell. This file pins the wiring and the breakdowns added
 * alongside it.
 *
 * TWO ASSERTIONS HERE WERE REWRITTEN WHEN THE GAP THEY GUARDED CLOSED. This
 * file used to require `loss_reasons: null` and require that the words "Loss
 * reasons" never appear on the page, because `quotes` recorded a status and a
 * decision date and nothing about why. Migration 234 added `quotes.loss_reason`
 * and the Proposals zone writes it against a closed vocabulary, so both
 * assertions had become guards on a claim that was no longer true. They now
 * hold the opposite and stronger line: the taxonomy is READ, a loss nobody
 * explained is counted separately from `other`, and the stale gap sentence is
 * banned outright — a reason kept past the gap it describes reads as current.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const ZONE = read('frontend/src/pages/partner/pipeline/AnalyticsZone.jsx');
const ROUTES = read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx');
const NEEDS_ROUTE = read('cloudflare-worker/src/routes/needs.ts');
const INSIGHTS = read('frontend/src/pages/PartnerInsightsPage.jsx');
const APP = read('frontend/src/App.jsx');

/** The analytics handler's body, so a match elsewhere in the file cannot pass. */
function analyticsHandler() {
  const at = NEEDS_ROUTE.indexOf("quotesRouter.get('/analytics'");
  assert.ok(at > 0, "the /quotes/analytics handler is gone — has it been renamed?");
  const end = NEEDS_ROUTE.indexOf('async function quoteTransition', at);
  assert.ok(end > at, 'could not bound the analytics handler');
  return NEEDS_ROUTE.slice(at, end);
}

test('/pipeline/analytics mounts the pipeline analytics zone, not Demand Insights', () => {
  const code = codeOnly(ROUTES);
  assert.match(code, /analytics:\s*\(\)\s*=>\s*<PartnerPipelineAnalytics\s*\/>/,
    'the analytics zone must render the pipeline scorecard');
  assert.doesNotMatch(code, /analytics:\s*\([^)]*\)\s*=>\s*<PartnerInsightsPage/,
    'Demand Insights answers a different question and keeps its own mount at /partner/insights');
});

test('Demand Insights keeps its own route, so nothing was retired to make room', () => {
  assert.match(codeOnly(APP), /path="\/partner\/insights"/,
    'moving the zone must not take Demand Insights off the product');
});

test('the zone reads the pipeline endpoint, and re-reads when the chip changes', () => {
  const code = codeOnly(ZONE);
  assert.match(code, /api\.quotesAnalytics\(windowOf\(view\)\)/,
    'the chip row selects a window the WORKER applies, so the chip must reach the request — '
    + 'and through the map, because the worker coerces an unknown key to all time rather than '
    + 'refusing, which would put all-time figures under a chip that says This quarter');
  assert.match(code, /const WINDOWS = \{[\s\S]{0,300}?prev_quarter:[\s\S]{0,200}?ytd:[\s\S]{0,200}?shape:/,
    'the page no longer names the windows its own chip row offers');
  for (const wrong of ['insightsHeatmap', 'insightsTrends', 'insightsFeed']) {
    assert.doesNotMatch(code, new RegExp(`api\\.${wrong}`),
      `${wrong} is board-wide demand — it is not this firm's pipeline`);
  }
  // THE CHIPS CANNOT NARROW ROWS HERE — this page holds aggregates, not rows —
  // so a `load` that did not depend on `view` would leave every chip showing
  // the first window's figures.
  assert.match(code, /const load = useCallback\([\s\S]{0,900}?\}, \[view\]\);/,
    'the reader’s chosen window is not a dependency of the read');
  assert.match(code, /useEffect\(\(\) => \{ load\(\); \}, \[load\]\);/);
  // And the api method sends it, without sending the default.
  assert.match(codeOnly(read('frontend/src/lib/api.js')),
    /quotesAnalytics: \(period\) => request\(\s*\n?\s*period && period !== 'all'/,
    'the two older callers must keep getting the unnarrowed response');
});

test('the zone card describes the zone that is actually rendered', () => {
  const code = codeOnly(ROUTES);
  const at = code.indexOf('const ZONE_LINES');
  assert.ok(at > 0);
  const line = code.slice(at).match(/analytics:\s*'([^']+)'/);
  assert.ok(line, 'the analytics zone still needs a line on the bucket overview');
  assert.doesNotMatch(line[1], /Demand Insights/,
    'the card described Demand Insights for as long as the zone rendered it; both moved together');
  assert.match(line[1], /win rate/i);
});

test('the analytics query LEFT joins the need, so no quote falls out of the denominator', () => {
  const body = analyticsHandler();
  const joins = body.match(/JOIN founder_needs/g) || [];
  assert.equal(joins.length, 3, 'admin, company-scoped and unscoped all read the need category');
  const left = body.match(/LEFT JOIN founder_needs n ON n\.id = q\.need_id/g) || [];
  assert.equal(left.length, 3,
    'an INNER join would silently drop a quote whose need row is missing and change the win '
    + "rate's denominator — the one figure this endpoint exists to compute");
});

test('the endpoint returns three breakdowns, and the loss taxonomy is read', () => {
  const body = analyticsHandler();
  // THE TWO WINDOWED BREAKDOWNS AND THE ONE THAT IS NOT. `by_quarter` IS the
  // time series, so narrowing it to the chip would leave one bar.
  assert.match(body, /by_shape:\s*analyseByShape\(inWindow\)/);
  assert.match(body, /by_quarter:\s*analyseByQuarter\(q\)/);
  assert.match(body, /pipeline,/);
  assert.match(body, /const pipeline = analysePipeline\(inWindow\);/);
  // AN OPEN QUOTE IS IN NO QUARTER, so the forecast reads the whole set.
  assert.match(body, /forecast:\s*weightedPipeline\(q\)/,
    'a period chip must not silently empty the forecast');
  assert.match(body, /forecast_scope: 'all_open'/,
    'a forecast the chip does not narrow has to say so in the response');

  // MIGRATION 234 CLOSED THE GAP THIS USED TO GUARD.
  assert.match(body, /loss_reasons: losses\.reasons/,
    'the taxonomy is stored now — returning null would be a stale refusal');
  assert.doesNotMatch(body, /loss_reasons:\s*null/,
    'the endpoint claims a gap migration 234 closed');
  assert.match(body, /losses_unstated: losses\.unstated/,
    'a loss nobody explained is its own count, never an "other"');
  assert.match(body, /on_price_losses: losses\.on_price/);
  assert.match(body, /loss_reason/, 'the query must actually read the column');
  const selects = body.match(/q\.loss_reason/g) || [];
  assert.equal(selects.length, 3,
    'admin, company-scoped and unscoped all have to read the reason, or the taxonomy '
    + 'silently empties for two of the three readers');
});

test('the loss taxonomy is drawn, and the loss nobody explained is its own row', () => {
  const code = codeOnly(ZONE);
  // THE ARTBOARD'S CARD, which this zone refused for as long as the column
  // did not exist.
  assert.match(code, /title="Loss reasons"/, 'the artboard’s loss card is missing');
  assert.match(code, /The taxonomy, not a summary sentence/,
    'the artboard’s subtitle for the loss card is gone');
  assert.match(code, /d\?\.loss_reasons/, 'the chart is not reading the response’s taxonomy');

  // THE ROW THAT IS NOT A CATEGORY.
  assert.match(code, /No reason recorded/,
    'a loss nobody explained has been folded into the taxonomy');
  assert.match(code, /losses_unstated/, 'the unexplained losses are not counted');
  assert.doesNotMatch(code, /losses_unstated\s*(\|\||\?\?)\s*0\b[^)]*LOSS_LABEL/,
    'an unexplained loss is being labelled as a taxonomy entry');

  // AND THE OLD REFUSAL IS GONE RATHER THAN LEFT STANDING. A reason kept past
  // the gap it describes reads to the next reader as current.
  assert.doesNotMatch(ZONE, /LOSS REASONS ARE NOT SHOWN/,
    'the zone still records a gap migration 234 closed');
  assert.doesNotMatch(ZONE, /no reason, no competitor, no losing price/i,
    'the zone still claims quotes carry nothing about why a bid was lost');
});

test('no win rate is ever displayed as 0% when nothing was decided', () => {
  const code = codeOnly(ZONE);
  assert.doesNotMatch(code, /win_rate_pct\s*(\|\||\?\?)\s*0/,
    '0% claims a loss; no decisions is not a loss. Every display site guards on null');

  // EVERY SITE THAT RENDERS THE FIGURE, each pinned where it lives rather than
  // counted — a count passes while the one unguarded site is the one that
  // moved.
  //
  //   the strip tile   `p?.win_rate_pct`
  //   the shape column `s.win_rate_pct`
  //   the quarter bar  `point.win_rate_pct`
  assert.match(code, /value=\{p\?\.win_rate_pct != null \?/, 'the strip tile is unguarded');
  assert.match(code, /nr=\{p\?\.win_rate_pct == null\}/,
    'a window with nothing decided must read as unrecorded, not as an empty tile');
  assert.match(code, /s\.win_rate_pct == null\s*\n?\s*\? \{ nr: true \}/,
    'a shape with nothing decided is drawing a rate');
  // AND THE BAR IS NOT DRAWN AT ALL where there is no rate: a zero-height
  // column reads as having lost every bid rather than as having made none.
  assert.match(code, /if \(!point \|\| point\.win_rate_pct == null\) \{/,
    'a shape that decided nothing in a quarter still draws a bar');
});

test('PartnerInsightsPage no longer carries an embedded flag nothing passes', () => {
  const code = codeOnly(INSIGHTS);
  assert.doesNotMatch(code, /function PartnerInsightsPage\(\s*\{/,
    'nothing mounts this page inside a shell any more, so the prop had no caller');
  assert.doesNotMatch(code, /\bembedded\b/,
    'a prop no route passes reads as a seam someone has dealt with');
});
