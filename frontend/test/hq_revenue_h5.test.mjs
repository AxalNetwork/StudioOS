/**
 * HQ · Revenue — canvas H5, and the four figures it draws that do not exist.
 *
 * WHAT THIS FILE IS FOR. A revenue page fails silently. Nobody notices a
 * wrong number the way they notice a blank screen, and the wrong number
 * here is the easy one to produce: `?? 0` on a figure with no source turns
 * "nobody can say what subscriptions earned" into "subscriptions earned
 * nothing". Of the five zones the artboard draws, two have a store, one has
 * half a store, and two have none — so most of what follows asserts that a
 * figure is ABSENT and its reason is on the screen.
 *
 * The zone titles are read OFF THE ARTBOARD rather than retyped, so the page
 * cannot drift from the design without this failing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = raw('frontend/src/pages/hq/RevenuePage.jsx');
const SRC = codeOnly(PAGE);
const APP = codeOnly(raw('frontend/src/App.jsx'));
const API = codeOnly(raw('frontend/src/lib/api.js'));
const ROUTE = raw('cloudflare-worker/src/routes/admin_revenue.ts');
const INDEX = raw('cloudflare-worker/src/index.ts');
const CANVAS = raw('design/canvases/integrated/Admin · Super.dc.html');

/** H5 alone, bounded at both ends — the file holds seven artboards. */
function h5() {
  const a = CANVAS.indexOf('Revenue — the money rails');
  assert.ok(a >= 0, 'the H5 artboard could not be found in the canvas');
  const b = CANVAS.indexOf('Content Studio and Platform', a);
  assert.ok(b > a, 'H6 no longer follows H5 — this slice would run past the artboard');
  // Unescaped, because the canvas is HTML: the artboard's own words are
  // "Token P&L by subsidiary" and the file stores "P&amp;L". Comparing the
  // escaped form would mean the test agreed with the encoding rather than
  // with the design.
  return CANVAS.slice(a, b).replaceAll('&amp;', '&');
}

test('every zone the artboard draws is on the page', () => {
  const board = h5();
  for (const zone of ['By stream', 'Token P&L by subsidiary', 'Statements and Stripe', 'Open disputes']) {
    assert.ok(board.includes(zone), `the artboard no longer draws ${zone}`);
    assert.ok(PAGE.includes(zone), `the page dropped the ${zone} zone`);
  }
  // The artboard's four stream columns.
  for (const col of ['Stream', 'Gross', 'Cost', 'Net']) {
    assert.ok(board.includes(col), `the artboard no longer draws the ${col} column`);
  }
  assert.match(PAGE, /Stream/, 'the stream table lost its header');
});

test('the four figures with no source render absent, each with its own reason', () => {
  // A blanket apology is not an explanation. Each absent figure carries the
  // server's reason for THAT figure, so the page can be read without
  // knowing the schema.
  assert.match(SRC, /data\.subscriptions_reason/, 'the subscriptions row does not say why it is blank');
  assert.match(SRC, /data\.statements_reason/, 'the statements zone does not say why it is blank');
  assert.match(SRC, /promos\.budget_reason/, 'the promo zone does not say why there is no budget');
  assert.match(SRC, /data\.derived_metrics_reason/, 'the per-subsidiary zone does not cite U1');
});

test('no absent figure is defaulted to a number', () => {
  // hq_home.test.mjs's rule, held here. `|| 0` and `?? 0` on a figure with
  // no source is the single change that would turn this page into a set of
  // confident false statements.
  assert.doesNotMatch(SRC, /\|\|\s*0\b/, 'an absent figure falls back to 0');
  assert.doesNotMatch(SRC, /\?\?\s*0\b/, 'an absent figure falls back to 0');
  // And never a dash standing in for a value: a dash is indistinguishable
  // from a real value someone chose to draw.
  assert.doesNotMatch(SRC, /value=\{['"][—–-]['"]\}/, 'an em-dash is standing in for a missing figure');
  // The three Stats that must stay permanently blank are written as `null`,
  // which is what makes them render <Unrecorded/> rather than anything else.
  for (const label of ['Margin', 'Owed by subsidiaries', 'Budget left']) {
    const at = SRC.indexOf(`label="${label}"`);
    assert.ok(at >= 0, `the ${label} stat is gone`);
    assert.match(SRC.slice(at, at + 160), /value=\{null\}/,
      `the ${label} stat acquired a value — there is no source for one`);
  }
});

test('the two currencies are never added together', () => {
  // Licence fees are denominated per licence and the token cost is USD. A
  // single headline figure would be wrong by the exchange rate and stated
  // to the cent — which is worse than not showing one.
  assert.match(SRC, /fees\.by_currency\.map/, 'the stream table no longer renders a row per currency');
  assert.doesNotMatch(SRC, /total_cents|platformRevenue|platform_revenue/,
    'a single cross-currency total appeared');
  // Said on the page, not only in a comment a reader never sees.
  assert.match(PAGE, /not added together/, 'the page does not tell the reader the rows are not summed');
  assert.match(ROUTE, /GROUP BY currency/, 'the route stopped bucketing licence fees per currency');
});

test('disputes are read from their own endpoint, so Stripe cannot blank the page', () => {
  assert.match(SRC, /api\.adminBillingListDisputes\(/, 'the disputes zone does not read the disputes endpoint');
  assert.match(SRC, /const \[disputes, setDisputes\] = useState/, 'disputes share the summary\'s state');
  // The summary itself must NOT fetch them: a page-load endpoint that fans
  // out to Stripe fails as one unit.
  assert.doesNotMatch(ROUTE, /stripeCall|\/disputes\?limit/,
    'the summary endpoint calls Stripe — one outage would blank four D1 zones');
  assert.match(ROUTE, /disputes_endpoint/, 'the route no longer points at where disputes live');
  // Its own failure has its own retry, not the page's.
  assert.match(SRC, /onRetry=\{loadDisputes\}/, 'an unreadable disputes zone cannot be retried on its own');
});

test('the page is wired: api method, route, and a super-admin gate', () => {
  assert.match(API, /hqRevenue: \(\) => request\('\/admin\/revenue\/summary'\)/,
    'the api method is gone or points elsewhere');
  assert.match(APP, /path="\/admin\/revenue"/, 'the route is not registered');
  assert.match(APP, /HqRevenuePage/, 'the page is not mounted');
  // Mounted BEFORE the /api/admin catch-all, or the catch-all answers first
  // and the route is dead.
  const revenueAt = INDEX.indexOf("app.route('/api/admin/revenue'");
  const catchAllAt = INDEX.indexOf("app.route('/api/admin', admin)");
  assert.ok(revenueAt >= 0, 'the worker route is not mounted');
  assert.ok(catchAllAt > revenueAt, 'the revenue route is mounted after the /api/admin catch-all, so it never runs');
  // D35 — the elevation is re-checked server-side, never assumed from the shell.
  assert.match(ROUTE, /requireSuperAdmin\(c\)/, 'the route does not re-check the Super Admin elevation');
});

test('an unreadable summary says so without claiming the business earned nothing', () => {
  assert.match(SRC, /const UNAVAILABLE = Symbol\('unavailable'\)/, 'the failed-read state is gone');
  const at = SRC.indexOf('data === UNAVAILABLE');
  assert.ok(at >= 0, 'nothing renders when the summary cannot be read');
  const branch = SRC.slice(at, at + 420);
  assert.match(branch, /<Unreadable/, 'a failed read renders something other than Unreadable');
  assert.match(branch, /This is not a claim that nothing was earned\./,
    'the unreadable state does not distinguish itself from an empty one');
});

test('the honesty pair is imported, not declared again', () => {
  // The plan's cross-cutting item: `Unrecorded`/`Unreadable` were written
  // four times over and had already drifted in wording. This page would
  // have made five.
  assert.match(SRC, /import \{[^}]*Unrecorded[^}]*Unreadable[^}]*\} from '\.\.\/\.\.\/ui'/,
    'the page does not import the shared honesty pair');
  assert.doesNotMatch(SRC, /function Unrecorded\(|function Unreadable\(/,
    'the page declares its own copy of a shared component');
  // And the two pages that had local copies now import them too.
  for (const p of ['frontend/src/pages/hq/HqHomePage.jsx', 'frontend/src/pages/hq/SecurityPage.jsx']) {
    const s = codeOnly(raw(p));
    assert.doesNotMatch(s, /function Unreadable\(/, `${p} still declares its own Unreadable`);
    assert.match(s, /Unreadable/, `${p} no longer renders an Unreadable at all`);
    assert.match(s, /claim="/, `${p} does not pass the clause that differs between them`);
  }
});
