/**
 * Deals · Screening — canvas **ID2**, `/deals/screening`.
 *
 * WHAT THIS FILE GUARDS, AND WHY IT IS DIFFERENT FROM ID1'S. The Pipeline zone
 * had to be stopped from drawing the artboard's fixtures. This one had to be
 * stopped from repeating a claim the repo was already making and that was
 * FALSE: the ops row said "no scoring run is stored" and "no rubric is
 * stored", and `score_snapshots` carries six dimensions per snapshot with
 * their sub-scores, a tier, an `admin_review_status` and `anomaly_flags`. An
 * unbuilt reason that overstates the gap is as misleading as a control that
 * does nothing — it tells the next reader not to look.
 *
 * So the assertions below run in both directions: the four things that ARE
 * stored must be read, and the three that are NOT — batching, editable
 * weights, person-written red-flag rules — must be stated rather than drawn.
 *
 * THE TWO HONESTY RULES THIS ZONE TURNS ON:
 *
 *   A SANDBOX SNAPSHOT IS NOT A SCREENING RESULT. `is_sandbox` marks a
 *   practice run. Counting one would let a rehearsal move the desk's numbers.
 *
 *   A DEAL WITH NO SNAPSHOT IS NOT BADLY SCORED. It has not been screened, and
 *   a zero there is a verdict nobody gave — which is also the instruction the
 *   AI band carries, for the same reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { PASS_TAXONOMY, passReasonRevisit } from '../src/lib/dealFlow.js';
import { INVESTOR_ZONE_FILTERS } from '../src/workspaces/investorZoneFilters.js';
import { INVESTOR_ZONE_ACTIONS } from '../src/workspaces/investorZoneActions.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = read('frontend/src/pages/investor/deals/ScreeningZone.jsx');
const Z = codeOnly(ZONE);
const ROUTE = read('cloudflare-worker/src/routes/deals.ts');
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const ROUTES = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));
const WORKSPACE = codeOnly(read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx'));
const SCHEMA = read('cloudflare-worker/sql/schema_baseline.sql');
const CANVAS = read('design/canvases/integrated/Pages · Investor Deals.dc.html');

/** The ID2 fixture object alone, bounded at both ends. */
function id2() {
  const a = CANVAS.indexOf("id:'id2'");
  assert.ok(a >= 0, 'the ID2 artboard is gone from the canvas');
  const b = CANVAS.indexOf("id:'id3'", a);
  assert.ok(b > a, 'ID3 no longer follows ID2 — this slice would run past the artboard');
  return CANVAS.slice(a, b);
}

/** The screening handler alone, so a score read elsewhere in deals.ts cannot satisfy or fail it. */
function screeningHandler() {
  const at = ROUTE.indexOf("deals.get('/screening'");
  assert.ok(at >= 0, 'the screening route is gone');
  return ROUTE.slice(at, ROUTE.indexOf('\ndeals.', at + 10));
}

test('D1260: Screening reads the venture scorecard, and no Lab score reaches it', () => {
  // Owner question 8 A of #2428: the Lab scorer is practice; Screening reads the scorecard.
  const handler = screeningHandler();
  for (const lab of [/score_snapshots/, /total_score/, /\btier\b/, /anomaly_flags/, /getVerifiedLatestSnapshots/, /RUBRIC/]) {
    assert.doesNotMatch(handler, lab, `the screening route reads the Lab scorer again (${lab})`);
  }
  assert.match(handler, /desk = \{\s*available: true,/, 'the desk is no longer sent');
  for (const lab of [/total_score/, /\.tier\b/, /anomaly|flags\?\./, /dimensions/, /ZoneDraft/]) {
    assert.doesNotMatch(Z, lab, `the page draws the Lab scorer again (${lab})`);
  }
  assert.match(Z, /const strips = useScopeStrips\(dealRows\.map\(\(r\) => r\.deal_id\)\)/, 'the strips are not read through the batch');
  assert.match(Z, /<DealStrip read=\{strips\} dealId=\{r\.deal_id\} \/>/, 'a row draws something other than its scorecard strip');
  // The memo that cited the Lab scorer for every deal, to any reader, is retired with it.
  assert.ok(!RESEARCH.includes("'deals/screening': {"), 'the screening memo surface is back');
});

test('D1260: the ops row and chips are the scorecard\'s, not the Lab scorer\'s', () => {
  const ops = INVESTOR_ZONE_ACTIONS['deals/screening'];
  assert.deepEqual(ops.map((o) => o.label), ['New batch run', 'Edit rubric', 'Export'], 'the ops row drifted from the canvas');
  const by = Object.fromEntries(ops.map((o) => [o.label, o]));
  // The two the Lab scorer offered stay unbuilt, for the scorecard's reasons, never the old ones.
  assert.match(by['New batch run'].unbuilt, /recomputes each venture from its own records/);
  assert.match(by['Edit rubric'].unbuilt, /chosen in Deal flow’s Your weighting dialog/);
  for (const o of ops.slice(0, 2)) assert.doesNotMatch(o.unbuilt, /six dimensions are real|rubric answers/, `${o.label} kept the Lab scorer's reason`);
  assert.equal(by.Export.kind, 'export');
  // The artboard still draws four chips; two of them were the Lab scorer's.
  const labels = /fil\(\[([^\]]*)\]/.exec(id2());
  assert.ok(labels, 'the ID2 artboard no longer declares a filter row');
  assert.deepEqual(labels[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')), ['Scored', 'Rubric', 'Red flags', 'Pass reasons']);
  const rows = INVESTOR_ZONE_FILTERS['deals/screening'];
  assert.deepEqual(rows.map((r) => [r.canvas, r.key ?? null]), [['Scored', 'scorecards'], ['Rubric', null], ['Red flags', null], ['Pass reasons', 'passes']]);
  for (const r of rows.filter((x) => !x.key)) assert.match(r.unbuilt, /Lab scorer’s/, `${r.canvas} lost its reason`);
  const at = Z.indexOf('const rows = useMemo(');
  assert.ok(at >= 0, 'the narrowing memo is gone');
  assert.match(Z.slice(at, Z.indexOf('}, [', at)), /view === 'scorecards'/, 'the Scorecards chip selects nothing');
  assert.match(Z, /rows=\{visible\.map/, 'the instrument draws something other than the narrowed set');
});

test('D1260: a scorecard with nothing to show is never a zero', () => {
  assert.doesNotMatch(Z, /\|\|\s*0\b/, 'an absent figure falls back to 0');
  assert.doesNotMatch(Z, /\?\?\s*0\b/, 'an absent figure falls back to 0');
  // An unreadable desk says so, rather than drawing no deals.
  assert.match(Z, /data-testid="screening-deals-unreadable"/);
  assert.match(ZONE, /That is not a claim that there are none/);
  // The scorecards tile counts only open scorecards with a scored scope, and is Not recorded while unread.
  assert.match(Z, /s\.state === 'open' && s\.scopes\.some\(\(x\) => x\.state === 'scored'\)/);
  assert.match(Z, /value=\{scoredCount === null \? null :/);
});

test('the pass taxonomy is the artboard’s instrument, with its re-entry conditions', () => {
  const board = id2();
  assert.ok(board.includes("instTitle:'Pass reasons"), 'the artboard changed its instrument');
  assert.match(Z, /Pass reasons — the fund’s memory/, 'the instrument lost the artboard’s title');
  assert.match(Z, /a pass is data, not a deletion/);
  // BEHAVIOUR: exactly two of the five reasons carry a re-entry condition, and
  // the note counts them rather than asserting a number.
  const revisitable = PASS_TAXONOMY.filter((r) => r.revisit);
  assert.equal(revisitable.length, 2, 'the taxonomy’s re-entry conditions changed — recheck the note');
  assert.ok(passReasonRevisit('valuation'), 'valuation lost its re-entry condition');
  assert.ok(passReasonRevisit('early'), 'too-early lost its re-entry condition');
  assert.equal(passReasonRevisit('team'), '', 'a team pass gained a re-entry condition');
  assert.match(Z, /revisitable\.length/, 'the note hardcodes how many reasons can be revisited');
  assert.match(Z, /PASS_TAXONOMY\.length/, 'the note hardcodes how many reasons there are');
  // A pass with no reason is counted on its own, never folded into a bucket.
  // THE SPREAD, not the bare name: `passes.unrecorded` also appears in
  // `passes.unrecorded_note` further down the same cell, so deleting the row
  // that renders the count left the file still matching.
  assert.match(Z, /\.\.\.\(passes\.unrecorded\s*\n?\s*\?/,
    'passes with no recorded reason are no longer given their own row');
  assert.match(Z, /not a taxonomy entry/);
});

test('one store failing costs its own zone, not the page', () => {
  // Two reads, two states. Folding them into one would mean a pass-record
  // outage hid the score history and vice versa.
  assert.match(Z, /api\.dealScreening\(\)\.then\(setDesk/);
  assert.match(Z, /api\.dealPassAnalytics\(\)\.then\(setPasses/);
  assert.match(Z, /const bothFailed = desk === UNAVAILABLE && passes === UNAVAILABLE/);
  assert.match(Z, /data-testid="screening-passes-unreadable"/,
    'an unreadable pass record renders as no passes');
  assert.match(ZONE, /not a claim that the fund has\s+passed on nothing/,
    'the unreadable state no longer says what it is not');
});

test('the zone is mounted once, gated, and registered before the id route', () => {
  assert.match(ROUTES, /screening: lazy\(\(\) => import\('\.\.\/\.\.\/pages\/investor\/deals\/ScreeningZone'\)\)/);
  assert.ok(!WORKSPACE.includes("investorZoneActions('deals/screening'"),
    'the workspace still mounts the screening ops row');
  assert.ok(!WORKSPACE.includes('investor-screening'),
    'the workspace still draws the one-record panel the artboard replaced');
  // The literal path must be registered before `/:id`, or `screening` is read
  // as a deal id and the desk 404s.
  const literal = ROUTE.indexOf("deals.get('/screening'");
  const byId = ROUTE.indexOf("deals.get('/:id'");
  assert.ok(literal > -1 && byId > -1 && literal < byId,
    '/screening is registered after /:id, so it is swallowed by the id route');
  // Scope this check to the screening handler: a guard on another route
  // cannot protect this desk. D1254 (#3277) admits related investors; mounted
  // Worker tests prove per-deal gating, verified reads and scoped aggregates.
  const handler = ROUTE.slice(literal, ROUTE.indexOf('\ndeals.', literal + 10));
  assert.match(handler, /if \(user\.role !== 'admin' && user\.role !== 'partner' && user\.role !== 'investor'\) return c\.json\(\{ detail: 'Forbidden' \}, 403\)/,
    'Screening admits only staff or relationship-scoped investors (D1254)');
});
