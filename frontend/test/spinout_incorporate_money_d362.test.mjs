/**
 * D362 — Incorporate's money integrity.
 *
 * WHAT THIS PINS.
 *   - The price the page shows is the catalog's: GET /legal/incorporation/quote
 *     resolves it with the same function POST /incorporation/order charges
 *     with, and never falls back to the wizard's JURISDICTION_COSTS estimates.
 *     The page draws no hard-coded package and keeps amounts in integer cents.
 *   - Paid comes from the server's order only. The page no longer writes
 *     `paid` / `paid_at` into incorporation_meta, which any browser could set,
 *     and records the milestone only after the server confirms the order.
 *   - The jurisdiction is the Lab application's. Wyoming has no Worker
 *     jurisdiction or catalog SKU, so it yields no Pay button and a reason.
 *   - The milestone-timing question is named on screen as an open owner
 *     decision, not answered.
 *
 * The pure rules (lib/incorporationPricing.js) run for real. The page and the
 * route are source text: the page imports the Stripe loader and legal.ts cannot
 * load under the test runner (legalEntitiesAccess.test.ts says why).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PAID_STATUSES, fmtCents, formationJurisdiction } from '../src/lib/incorporationPricing.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/SpinoutLabIncorporatePage.jsx');
const LEGAL = read('cloudflare-worker/src/routes/legal.ts');
const API = read('frontend/src/lib/api.js');

const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `end anchor not found after ${start}: ${end}`);
  return src.slice(a, b);
}

test('the quote prices from the catalog, the same way the order charges', () => {
  const route = between(LEGAL, "legal.get('/incorporation/quote'", "legal.get('/incorporate/status'");
  assert.match(route, /await requireAuth\(c\)/);
  assert.match(route, /const resolved = await resolveIncorporationPrice\(c\.env, j\.id\);/);
  assert.doesNotMatch(code(route), /JURISDICTION_COSTS/, 'a wizard estimate is not a price');
  assert.match(route, /amount_cents: null,[\s\S]*reason: 'catalog_price_missing'/);
  assert.match(route, /error: 'unknown_jurisdiction', message: '[^']+'/);
  // The order route uses the same resolver, so quote and invoice agree.
  const order = between(LEGAL, "legal.post('/incorporation/order'", "legal.get('/incorporation/quote'");
  assert.match(order, /const resolved = await resolveIncorporationPrice\(c\.env, j\.id\);/);
  // Its client method landed with it.
  assert.match(API, /legalIncorporationQuote: \(jurisdictionId\) =>\s*request\(`\/legal\/incorporation\/quote\?jurisdiction_id=\$\{encodeURIComponent\(jurisdictionId\)\}`\)/);
});

test('the page draws no hard-coded price and keeps cents as integers', () => {
  const c = code(PAGE);
  assert.doesNotMatch(c, /PKG/, 'the $1,200 + $110 package is gone');
  assert.doesNotMatch(c, /1200|1,200|\b110\b/);
  assert.match(c, /const priceCents = quote\.status === 'ok' && Number\.isInteger\(quote\.q\?\.amount_cents\) \? quote\.q\.amount_cents : null;/);
  assert.equal(fmtCents(131000, 'usd'), '$1,310');
  assert.equal(fmtCents(null), null);
  assert.equal(fmtCents(1310.5), null, 'a non-integer amount is refused, not rounded into a price');
  assert.equal(fmtCents(0, 'usd'), '$0');
});

test('Pay is offered only with a catalog price and a formable jurisdiction', () => {
  assert.match(PAGE, /disabled=\{!canEdit \|\| payBusy \|\| priceCents === null \|\| !juris\.jurisdictionId\} onClick=\{pay\} data-testid="button-pay"/);
  const pay = between(code(PAGE), 'const pay = async () => {', 'const selectEntity');
  assert.match(pay, /const jurisdictionId = juris\.jurisdictionId;/);
  assert.match(pay, /if \(!jurisdictionId \|\| priceCents === null\) throw/);
  assert.doesNotMatch(pay, /'us_de_ccorp'|'us_de_llc'/, 'the jurisdiction comes from the application, not a literal');
});

test('paid is the server order; the page writes no paid flag', () => {
  const c = code(PAGE);
  assert.match(c, /const paid = Boolean\(order\);/);
  assert.doesNotMatch(c, /meta\.paid/);
  assert.doesNotMatch(c, /paid: true/);
  assert.doesNotMatch(c, /paid_at: new Date\(/);
  const onPaid = between(c, 'const onPaid = async () => {', 'const pay = async');
  assert.match(onPaid, /const mine = await refreshOrder\(\);/);
  // The milestone follows the server's confirmation, inside the found branch.
  const found = between(onPaid, 'if (mine) {', '} else {');
  assert.match(found, /markMilestone\(userRef\.current, 'incorporation_completed'\)/);
  assert.equal((onPaid.match(/markMilestone\(/g) || []).length, 1);
  // No order row yet (a lagging webhook): wait, and claim nothing. Bounded to
  // the else branch itself — the catch below also waits, and an assertion
  // over the whole handler let a paid claim here pass (D362 mutation tally).
  const notFound = between(onPaid, '} else {', '}\n    } catch');
  assert.match(notFound, /setAwaitingServer\(true\)/);
  assert.doesNotMatch(notFound, /setOrder\(|markMilestone\(/);
  assert.deepEqual(PAID_STATUSES, ['paid', 'packet_processing', 'packet_ready']);
});

test('the jurisdiction is the application\'s; Wyoming stops at its line with a reason', () => {
  const de = formationJurisdiction('Delaware C-Corp — Delaware, USA', 'ccorp');
  assert.deepEqual([de.state, de.jurisdictionId, de.fromApplication], ['Delaware', 'us_de_ccorp', true]);
  assert.equal(formationJurisdiction('Delaware C-Corp — Delaware, USA', 'llc').jurisdictionId, 'us_de_llc');
  const wy = formationJurisdiction('Wyoming C-Corp — Wyoming, USA', 'ccorp');
  assert.equal(wy.state, 'Wyoming');
  assert.equal(wy.jurisdictionId, null, 'no Worker jurisdiction and no catalog SKU: nothing to charge');
  assert.match(wy.reason, /Wyoming/);
  const none = formationJurisdiction(null, 'ccorp');
  assert.deepEqual([none.state, none.jurisdictionId, none.fromApplication], ['Delaware', 'us_de_ccorp', false]);
  assert.match(PAGE, /formationJurisdiction\(state\?\.application\?\.jurisdiction, selected\)/);
  assert.doesNotMatch(code(PAGE), /State of Delaware|Submitted to Delaware|state: 'Delaware'|Axal \(DE\)/);
});

test('unpriced parts and the open milestone decision are said, not invented', () => {
  assert.match(PAGE, /Service and state filing split<\/span><Unrecorded reason="[^"]+"/);
  assert.match(PAGE, /Expedited processing<\/span><Unrecorded reason="[^"]+"/);
  const note = between(PAGE, 'data-testid="milestone-decision"', '</p>');
  assert.match(note, /owner decision not yet made/);
});
