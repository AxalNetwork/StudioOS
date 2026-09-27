/**
 * D464 — the Portfolio canvas's alerts, the quarter-end export, the governed
 * write path's forms, and the chase.
 *
 *   · The admin mark and distribution forms on the positions page write
 *     through `POST /positions/:uid/marks` and `/distributions` — the routes
 *     existed and no screen called them.
 *   · The four alert rules are evaluated against the book the positions page
 *     already loads, each naming the rule and the position.
 *   · The quarter-end export reads `positions/analytics?as_of=` — and the
 *     route now cuts the flows AND the marks at the date.
 *   · The chase (IP2's "Chase all overdue" and the per-row Nudge) is logged
 *     (migration 337) and notifies the founder; the notification type's
 *     settings row is Session 4's to add.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ADMIN_PAGE = codeOnly(read('frontend/src/pages/PortfolioPositionsPage.jsx'));
const POSITIONS = codeOnly(read('frontend/src/pages/investor/InvestorPortfolioPositions.jsx'));
const UPDATES = codeOnly(read('frontend/src/pages/investor/InvestorPortfolioUpdates.jsx'));
const API = read('frontend/src/lib/api.js');
const POSITIONS_ROUTE = read('cloudflare-worker/src/routes/positions.ts');

test('the admin mark and distribution forms write through the governed path', () => {
  assert.match(ADMIN_PAGE, /api\.positionMarkCreate\(detail\.project\.uid, \{/, 'the mark form is unwired');
  assert.match(ADMIN_PAGE, /api\.positionDistributionCreate\(detail\.project\.uid, \{/, 'the distribution form is unwired');
  // The forms are the admin's — the routes refuse anyone else, so the page
  // gates on the same role rather than offering a 403 by click.
  assert.match(ADMIN_PAGE, /\{isAdmin && \(/, 'the forms must be gated on the admin');
  // And the histories the detail read already returns are rendered back.
  assert.match(ADMIN_PAGE, /detail\.marks\.map/, 'the marks history is not rendered');
  assert.match(ADMIN_PAGE, /detail\.distributions\.map/, 'the distributions history is not rendered');
});

test('the four alert rules are evaluated and named, and a failed source is never a zero', () => {
  assert.match(POSITIONS, /data-testid="ip1-alerts"/, 'the alerts section is gone');
  for (const name of ['Runway below 6 months', 'Update overdue 30 days', 'Health flipped to red', 'Valuation marked down']) {
    assert.ok(POSITIONS.includes(name), `the "${name}" rule is gone`);
  }
  // The runway rule reads the self-reported figure off the latest update's own
  // KPIs — never the health snapshot, which does not carry one.
  assert.match(POSITIONS, /row\.lastUpdateObj\?\.kpis\?\.runway_months/, 'the runway rule reads the wrong store');
  // The health flip reads the dated history, lazily and only for the red ones.
  assert.match(POSITIONS, /api\.portfolioHealthGet\(uid, 90\)/, 'the flip rule reads no history');
  // A rule whose source failed says so rather than reporting zero.
  assert.match(POSITIONS, /not a claim that nothing fired/, 'a failed source must not read as a clear rule');
});

test('the quarter-end export reads the book as of the date, and the route cuts both stores at it', () => {
  assert.match(POSITIONS, /api\.positionsAnalytics\(asOf \|\| undefined\)/, 'the export never passes the date');
  assert.match(API, /positionsAnalytics: \(asOf\)/, 'api.js lost the as_of read');
  // The route's half: the marks are read at-or-before the date, and the flows
  // after it are excluded.
  assert.match(POSITIONS_ROUTE, /as_of_date <= \?/, 'the marks are not cut at the date');
  assert.match(POSITIONS_ROUTE, /if \(asOf && date && date > asOf\) continue;/, 'the flows are not cut at the date');
  assert.match(POSITIONS_ROUTE, /as_of: asOf,/, 'the route stopped echoing the date the figures speak for');
});

test('the chase is wired to the log, per row and in bulk', () => {
  assert.match(UPDATES, /api\.portfolioChase\(overdueRows\.map/, 'Chase all overdue must hand the page’s own overdue set');
  assert.match(UPDATES, /api\.portfolioChase\(\[row\.project_id\]\)/, 'the per-row chase is gone');
  assert.match(UPDATES, /api\.portfolioChases\(\)/, 'the chase log is never read back');
  assert.match(API, /portfolioChase: \(projectIds\) =>/, 'api.js lost the chase write');
  // The rail no longer denies the outbound the page now has.
  assert.ok(!/Nothing is sent to a founder from this page/.test(UPDATES),
    'the rail still denies the chase the page now performs');
});
