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

/** `score_snapshots`' CREATE TABLE, verbatim. The claim is checked, not repeated. */
function snapshotDdl() {
  const at = SCHEMA.indexOf('CREATE TABLE score_snapshots (');
  assert.ok(at >= 0, 'score_snapshots is no longer in the baseline');
  const end = SCHEMA.indexOf(');', at);
  assert.ok(end > at, 'score_snapshots’ definition is unterminated');
  return SCHEMA.slice(at, end);
}

test('the six dimensions the page claims are the six the schema stores', () => {
  // THE CLAIM THAT REPLACED A FALSE ONE, verified against the column list
  // rather than asserted. Every dimension must have a `<dim>_total` column.
  const ddl = snapshotDdl();
  const DIMS = ['market', 'team', 'product', 'capital', 'fit', 'distribution'];
  for (const d of DIMS) {
    assert.ok(ddl.includes(`${d}_total`), `score_snapshots has no ${d}_total — recheck the rubric claim`);
  }
  assert.ok(ddl.includes('total_score') && ddl.includes('tier'));
  // The artboard asks for six, and six is what is there.
  assert.match(id2(), /label:'Rubric', value:'6 dims'/);
  const at = ROUTE.indexOf('const RUBRIC = [');
  assert.ok(at >= 0, 'the rubric is no longer declared in the route');
  const block = ROUTE.slice(at, ROUTE.indexOf('];', at));
  assert.deepEqual(
    [...block.matchAll(/key: '(\w+)'/g)].map((m) => m[1]),
    DIMS,
    'the route’s rubric drifted from the columns the scorer writes',
  );
});

test('a flag store exists and is read, rather than being called absent', () => {
  const ddl = snapshotDdl();
  assert.ok(ddl.includes('anomaly_flags'), 'score_snapshots no longer carries anomaly_flags');
  assert.ok(ddl.includes('admin_review_status'), 'score_snapshots no longer carries a review status');
  assert.match(ROUTE, /r\.admin_review_status \?\? null/, 'the route stopped reading the review status');
  assert.match(ROUTE, /review_status === 'flagged'/, 'nothing counts an open flag');
  assert.match(Z, /flags\?\.available \? String\(flags\.open\)/, 'the strip stopped showing open flags');
  // A flag is shown with what it IS, not as a colour nobody can act on.
  assert.match(Z, /\$\{f\.type\} · \$\{f\.severity\}/, 'a flag renders without its type and severity');
  assert.match(ZONE, /never a verdict on the company/i,
    'the page no longer says what a flag is not, so it reads as a finding about the company');
  assert.match(ZONE, /the scorer disagreeing with itself/i,
    'the page no longer says what a flag actually is');
});

test('the two unbuilt reasons are the narrow true ones, not the wide false ones', () => {
  const ops = INVESTOR_ZONE_ACTIONS['deals/screening'];
  assert.ok(Array.isArray(ops) && ops.length === 3, 'the screening ops row changed shape');
  const byLabel = Object.fromEntries(ops.map((o) => [o.label, o]));
  // THE EXACT SENTENCES THAT WERE WRONG. Either coming back is the regression.
  for (const [label, banned] of [
    ['New batch run', /no scoring run is stored/],
    ['Edit rubric', /^no rubric is stored$/],
  ]) {
    assert.doesNotMatch(byLabel[label].unbuilt, banned,
      `${label} is back to the reason the schema contradicts`);
  }
  // And the replacements have to name the real, narrower gap.
  assert.match(byLabel['New batch run'].unbuilt, /one project/, 'the batching gap is no longer named');
  assert.match(byLabel['Edit rubric'].unbuilt, /weights/, 'the weighting gap is no longer named');
  assert.match(byLabel['Edit rubric'].unbuilt, /six dimensions are real/,
    'the row no longer concedes that the dimensions exist');
  assert.equal(byLabel.Export.kind, 'export');
});

test('every chip is live, matches the artboard, and narrows something', () => {
  const board = id2();
  const labels = /fil\(\[([^\]]*)\]/.exec(board);
  assert.ok(labels, 'the ID2 artboard no longer declares a filter row');
  const canvasLabels = labels[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(canvasLabels, ['Scored', 'Rubric', 'Red flags', 'Pass reasons']);

  // The one memo that chooses what the instrument draws.
  const at = Z.indexOf('const rows = useMemo(() => {');
  assert.ok(at >= 0, 'the narrowing memo is gone');
  const narrowing = Z.slice(at, Z.indexOf('}, [', at));

  const rows = INVESTOR_ZONE_FILTERS['deals/screening'];
  assert.ok(Array.isArray(rows), 'the screening chip row is gone from the table');
  assert.deepEqual(rows.map((r) => r.canvas), canvasLabels, 'the chip row drifted from the artboard');
  for (const r of rows) {
    assert.ok(r.key, `${r.canvas} is not a live key — this zone has a store for all four`);
    assert.ok(!r.unbuilt, `${r.canvas} is live and unbuilt at once`);
    // READ INSIDE THE NARROWING MEMO, not anywhere in the file. `view ===
    // 'flags'` also appears in a render condition, so deleting the branch that
    // actually narrows left the string present and the mutation escaped.
    assert.ok(narrowing.includes(`view === '${r.key}'`) || Z.includes(`useState('${r.key}')`),
      `the ${r.key} chip is never read where the rows are chosen, so it selects nothing`);
  }
  assert.match(Z, /rows=\{rows\.map/, 'the instrument draws something other than the narrowed set');
});

test('a sandbox run is excluded and the exclusion is said out loud', () => {
  // A rehearsal that moved the desk's numbers would make them untrustworthy.
  assert.match(ROUTE, /WHERE is_sandbox = 0/, 'sandbox snapshots are back in the desk’s counts');
  assert.match(ROUTE, /sandbox_excluded: true/);
  assert.match(ROUTE, /A rehearsal is not a screening result/);
  assert.match(Z, /sandbox runs excluded/, 'the strip no longer says what it left out');
  // And the AI band reads the same way, or the memo would cite a rehearsal.
  const at = RESEARCH.indexOf("'deals/screening': {");
  assert.ok(at >= 0, 'the screening surface is not allow-listed, so the band 400s');
  const surface = RESEARCH.slice(at, RESEARCH.indexOf('\n  },', at));
  assert.match(surface, /is_sandbox = 0/, 'the memo can be drafted from a practice run');
});

test('an unscored dimension is never a zero, on the page or in the prompt', () => {
  // The single most likely wrong answer on this artboard: six numbers with a
  // gap, filled in as 0. A zero is a verdict nobody gave.
  assert.doesNotMatch(Z, /\|\|\s*0\b/, 'an absent figure falls back to 0');
  assert.doesNotMatch(Z, /\?\?\s*0\b/, 'an absent figure falls back to 0');
  assert.match(Z, /r\.total_score === null \? \{ nr: true \}/, 'an unscored deal renders as a zero');
  assert.match(ROUTE, /\? null : Number\(r\[`\$\{dim\.key\}_total`\]\)/,
    'a missing dimension total is coerced to a number');
  const at = RESEARCH.indexOf("'deals/screening': {");
  const surface = RESEARCH.slice(at, RESEARCH.indexOf('\n  },', at));
  assert.match(surface, /Do NOT score it zero/, 'the prompt lets a silent dimension be scored zero');
  assert.match(surface, /NOT SCORED/, 'the gathered row hides an unscored dimension');
  // And it must not invent a citation the product cannot support.
  assert.match(surface, /Never cite a page, a slide or a document/,
    'the memo may cite a page number nothing records');
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
  // SCOPED TO THIS HANDLER, because the same guard line appears verbatim in
  // `/pass-analytics` and `/stage-analytics` — deleting it from `/screening`
  // left the file still matching, and the mutation escaped. The slice ends at
  // the next handler's own registration.
  const handler = ROUTE.slice(literal, ROUTE.indexOf('\ndeals.', literal + 10));
  assert.match(handler, /if \(!isPrivilegedRole\(user\.role as string\)\) return c\.json\(\{ detail: 'Forbidden' \}, 403\)/,
    'the screening desk is no longer gated on a privileged role');
});
