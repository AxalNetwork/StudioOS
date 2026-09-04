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
 * the Partner shell. This file pins the wiring, the two breakdowns added
 * alongside it, and the one thing the zone must keep refusing to invent.
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

test('the zone reads the pipeline endpoint and none of the demand ones', () => {
  const code = codeOnly(ZONE);
  assert.match(code, /api\.quotesAnalytics\(\)/);
  for (const wrong of ['insightsHeatmap', 'insightsTrends', 'insightsFeed']) {
    assert.doesNotMatch(code, new RegExp(`api\\.${wrong}`),
      `${wrong} is board-wide demand — it is not this firm's pipeline`);
  }
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

test('the endpoint returns both breakdowns and refuses to invent a loss taxonomy', () => {
  const body = analyticsHandler();
  assert.match(body, /by_shape:\s*analyseByShape\(q\)/);
  assert.match(body, /by_quarter:\s*analyseByQuarter\(q\)/);
  assert.match(body, /loss_reasons:\s*null/,
    'quotes record a status and a decision date and nothing about why');
  assert.match(body, /loss_reasons_note:/,
    'a null with no reason attached reads as a bug rather than a stated gap');
});

test('the zone names the loss-reason gap rather than leaving the block blank', () => {
  assert.match(ZONE, /Loss reasons/,
    'the canvas leads with the taxonomy; a zone that simply omits it looks unfinished');
  assert.match(ZONE, /StatedLimit/,
    'the gap belongs in the stated-limit block, which is what that component is for');
});

test('no win rate is ever displayed as 0% when nothing was decided', () => {
  const code = codeOnly(ZONE);
  assert.doesNotMatch(code, /win_rate_pct\s*(\|\||\?\?)\s*0/,
    '0% claims a loss; no decisions is not a loss. Every display site guards on != null');
  // Both display sites — the headline card and the by-shape column.
  const guarded = code.match(/win_rate_pct != null \?/g) || [];
  assert.ok(guarded.length >= 3, `expected every win-rate display to be null-guarded, found ${guarded.length}`);
});

test('PartnerInsightsPage no longer carries an embedded flag nothing passes', () => {
  const code = codeOnly(INSIGHTS);
  assert.doesNotMatch(code, /function PartnerInsightsPage\(\s*\{/,
    'nothing mounts this page inside a shell any more, so the prop had no caller');
  assert.doesNotMatch(code, /\bembedded\b/,
    'a prop no route passes reads as a seam someone has dealt with');
});
