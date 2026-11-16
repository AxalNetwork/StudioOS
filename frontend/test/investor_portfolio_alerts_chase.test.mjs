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
const MODEL = codeOnly(read('frontend/src/pages/portfolio/portfolioModel.js'));
const API = read('frontend/src/lib/api.js');
const POSITIONS_ROUTE = read('cloudflare-worker/src/routes/positions.ts');
// D4644 (#4644) moved the as-of mark rule out of the route and into one
// service every consumer reads, so the pin that the marks are cut at the date
// follows it there. The guarantee is the same one; the file that holds it is
// not the route any more.
const VALUATION = read('cloudflare-worker/src/services/portfolioValuation.ts');

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

test('the attention rules are evaluated and named, and a failed source is never a zero', () => {
  // D4817 part 2 (#5311, PF-02): the four alert rules became the addendum's
  // attention rules (PFA06), evaluated in the shared model so Positions and
  // the Overview read one rule set (audit F-05).
  assert.match(POSITIONS, /data-testid="positions-attention-rules"/, 'the rules section is gone');
  assert.match(POSITIONS, /attentionRulesOf\(reads, rows\)/, 'the page no longer evaluates the shared rules');
  for (const name of ['Runway under 6 months', 'Update older than 30 days', 'Health turned red within 90 days', 'Latest mark below cost']) {
    assert.ok(MODEL.includes(name), `the "${name}" rule is gone`);
  }
  // The runway rule reads the self-reported figure off the latest update's own
  // KPIs — never the health snapshot, which does not carry one.
  assert.match(MODEL, /const RUNWAY_KEYS = \['runway_months', 'runway'\];/, 'the runway rule reads the wrong store');
  assert.match(MODEL, /runwayFor\(p, updates\)/, 'the runway rule does not read the founder update');
  // #6210: the health list supplies the dated transition to both views.
  assert.doesNotMatch(POSITIONS, /api\.portfolioHealthGet\(/, 'Positions makes an extra history call');
  assert.match(MODEL, /recentAttentionChange\(r\.health\)/, 'the flip rule bypasses the shared health read');
  // A rule whose source failed says so rather than reporting zero.
  assert.match(POSITIONS, /Not a claim that nothing fired/, 'a failed source must not read as a clear rule');
});

test('the book reads as of a date, and the route cuts both stores at it', () => {
  // D4817 part 2 (#5311, PF-02): the quarter-end export became the register's
  // "Read the book as of" (addendum PFA06): the positions list honours the date.
  assert.match(POSITIONS, /api\.positionsList\(asOf \|\| undefined\)/, 'the register never passes the date');
  assert.match(API, /positionsList: \(asOf\) =>/, 'api.js lost the list\'s as_of read');
  assert.match(API, /positionsAnalytics: \(asOf\)/, 'api.js lost the as_of read');
  assert.match(POSITIONS_ROUTE, /const listAsOf = isoDate\(c\.req\.query\('as_of'\)\);/, 'the list stopped honouring the date');
  // The route's half: the marks are read at-or-before the date, and the flows
  // after it are excluded.
  assert.match(VALUATION, /as_of_date <= \?/, 'the marks are not cut at the date');
  assert.match(POSITIONS_ROUTE, /latestProjectMarks\(/, 'the route no longer reads the one as-of mark rule');
  assert.match(POSITIONS_ROUTE, /if \(asOf && date && date > asOf\) continue;/, 'the flows are not cut at the date');
  assert.match(POSITIONS_ROUTE, /as_of: asOf,/, 'the route stopped echoing the date the figures speak for');
});

test('the chase is wired to the log, per row and in bulk', () => {
  assert.match(UPDATES, /api\.portfolioChase\(overdueRows\.map/, 'Chase all overdue must hand the page’s own overdue set');
  // D4817 part 4 (#5311, PF-04): the inbox row names its company by `projectId`.
  assert.match(UPDATES, /api\.portfolioChase\(\[row\.projectId\]\)/, 'the per-row chase is gone');
  assert.match(UPDATES, /api\.portfolioChases\(\)/, 'the chase log is never read back');
  assert.match(API, /portfolioChase: \(projectIds\) =>/, 'api.js lost the chase write');
  // The rail no longer denies the outbound the page now has.
  assert.ok(!/Nothing is sent to a founder from this page/.test(UPDATES),
    'the rail still denies the chase the page now performs');
});
