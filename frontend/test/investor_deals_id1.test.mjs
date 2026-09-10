/**
 * Deals · Pipeline — canvas **ID1**, `/deals/pipeline`.
 *
 * WHAT THIS FILE GUARDS. The zone shipped as one card — a heading, five
 * columns of two-fact cards, a footnote — against an artboard that draws a
 * four-up strip, a six-column instrument with an SLA band per row, the note
 * that carries the finding, and an AI band. So most of what follows checks
 * that the BODY is there and that its figures come from the record rather than
 * from the artboard's fixtures.
 *
 * THE FIXTURES ARE THE TRAP. `Pages · Investor Deals.dc.html` ships six named
 * companies, four named passes and a `$2,985,000` total, and every one of them
 * is a design placeholder. A page that renders any of them is not a page with
 * a bug, it is a page telling a customer about deals that do not exist.
 *
 * THE STAGE MAPPING IS TESTED AS BEHAVIOUR, NOT AS TEXT. `lib/dealFlow.js` is
 * pure and importable, so `dealStage` is driven with real rows instead of
 * matched with a regex — a source assertion cannot tell a correct branch from
 * one that happens to contain the right words.
 *
 * Labels, columns and thresholds are read OFF THE ARTBOARD rather than
 * retyped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { dealStage, dealMoneyExact, slaBand, slaPreset, DEFAULT_SLA } from '../src/lib/dealFlow.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = read('frontend/src/pages/investor/deals/PipelineZone.jsx');
const Z = codeOnly(ZONE);
const ROUTES = codeOnly(read('frontend/src/workspaces/investor/InvestorDealsRoutes.jsx'));
const WORKSPACE = codeOnly(read('frontend/src/pages/investor/InvestorDealsWorkspace.jsx'));
const RESEARCH = read('cloudflare-worker/src/routes/research.ts');
const CANVAS = read('design/canvases/integrated/Pages · Investor Deals.dc.html');

/** The ID1 fixture object alone, bounded at both ends. */
function id1() {
  const a = CANVAS.indexOf("id:'id1'");
  assert.ok(a >= 0, 'the ID1 artboard is gone from the canvas');
  const b = CANVAS.indexOf("id:'id2'", a);
  assert.ok(b > a, 'ID2 no longer follows ID1 — this slice would run past the artboard');
  return CANVAS.slice(a, b);
}

test('the zone draws the artboard’s instrument, column for column', () => {
  const board = id1();
  // The artboard's own head, parsed rather than retyped.
  const head = /head:\[([^\]]*)\]/.exec(board);
  assert.ok(head, 'the ID1 artboard no longer declares an instrument head');
  const columns = head[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(columns, ['Company', 'Sector', 'Stage', 'Ask', 'In stage', 'Owner']);

  // And the page's own head, as a sequence — order is part of the artboard.
  const at = ZONE.indexOf("head={view === 'passed'");
  assert.ok(at >= 0, 'the instrument head is gone');
  const boardHead = /: \[([^\]]*)\]\}/.exec(ZONE.slice(at));
  assert.ok(boardHead, 'the pipeline head is no longer a literal array');
  assert.deepEqual(
    boardHead[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    columns,
    'the instrument head drifted from the artboard',
  );
  // The artboard's grid, verbatim.
  const cols = /cols:'([^']*)'/.exec(board);
  assert.ok(cols, 'the artboard no longer declares a grid');
  assert.ok(ZONE.includes(`'${cols[1]}'`), `the instrument grid is not the artboard's ${cols[1]}`);
});

test('the SLA thresholds are the shared preset, never numbers typed here', () => {
  const board = id1();
  // The artboard's own two, so a change there fails here rather than drifting.
  assert.match(board, /SLA_AMBER \+ ' days in stage, red at ' \+ SLA_RED/);
  const p = slaPreset(DEFAULT_SLA);
  assert.equal(p.amber, 14, 'the standard preset no longer matches the artboard’s amber');
  assert.equal(p.red, 30, 'the standard preset no longer matches the artboard’s red');
  // The page reads the preset. A literal 14 or 30 beside `days` would be a
  // second definition of "sat too long" that could drift from the chip row's.
  assert.match(Z, /slaPreset\(preset\)/, 'the zone stopped reading the shared preset');
  assert.match(Z, /bands\.amber/);
  assert.match(Z, /bands\.red/);
  assert.doesNotMatch(Z, /\b(14|30)\b\s*(?:days|d\b)/i, 'a threshold is typed into the page');
});

test('a passed deal is not on the board, and has no stage at all', () => {
  // BEHAVIOUR, not source. `rejected` must return null; every other status
  // must return a stage the board actually draws.
  assert.equal(dealStage({ status: 'rejected' }), null);
  assert.equal(dealStage({ status: 'rejected', capital_committed: 900 }), null,
    'a passed deal with money against it was put back in the funnel');
  assert.equal(dealStage({ status: 'applied' }), 'sourcing');
  assert.equal(dealStage({ status: 'scored' }), 'screening');
  assert.equal(dealStage({ status: 'funded' }), 'closing');
  assert.equal(dealStage({ status: 'active' }), 'diligence');
  assert.equal(dealStage({ status: 'active', capital_committed: 1 }), 'commit',
    'committed capital no longer separates commit from diligence');
  // The page's live set is the one with a stage.
  assert.match(Z, /all\.filter\(\(d\) => dealStage\(d\) !== null\)/);
  assert.match(Z, /all\.filter\(\(d\) => dealStage\(d\) === null\)/);
});

test('an unknown age gets no band, and no figure falls back to a number', () => {
  // `slaBand` refuses to invent urgency, and the strip refuses to invent a
  // figure. Both are the same rule from two directions.
  assert.equal(slaBand(undefined), 'none');
  assert.equal(slaBand(null), 'none');
  assert.equal(slaBand(NaN), 'none');
  assert.equal(slaBand(99), 'red');
  assert.equal(slaBand(20), 'amber');
  assert.equal(slaBand(1), 'ok');
  assert.equal(dealMoneyExact(0), null, 'a deal with no ask rendered as $0');
  assert.equal(dealMoneyExact(null), null);
  assert.equal(dealMoneyExact(435000), '$435,000');
  assert.doesNotMatch(Z, /\|\|\s*0\b/, 'an absent figure falls back to 0');
  assert.doesNotMatch(Z, /\?\?\s*0\b/, 'an absent figure falls back to 0');
  // AND THE TOTAL SAYS HOW MUCH OF THE BOARD IT COVERS. `|| 0` inside the sum
  // would have been arithmetically harmless and a false claim on screen: the
  // artboard's "$… in asks" reads as the whole board's figure, and it is only
  // the figure for the deals that recorded one.
  assert.match(Z, /else missing \+= 1;/, 'a deal with no recorded ask is summed as zero');
  assert.match(Z, /with none recorded/, 'the total no longer says what it excludes');
  // A row with no recorded age renders as unrecorded rather than as fresh.
  assert.match(Z, /return \{ text: '', nr: true \};/);
});

test('none of the artboard’s fixture companies or figures reaches the page', () => {
  const board = id1();
  // Read off the artboard rather than retyped, so a renamed fixture is still
  // caught. `DEALS` and `PASSED` are declared above ID1 in the same script.
  const fixtures = [...CANVAS.matchAll(/\{ co:'([^']+)'/g)].map((m) => m[1]);
  assert.ok(fixtures.length >= 8, `expected the canvas’s sample companies, found ${fixtures.length}`);
  for (const co of fixtures) {
    assert.ok(!ZONE.includes(co), `the zone ships the artboard’s sample company ${co}`);
  }
  // And its arithmetic: the strip's totals are computed, never transcribed.
  for (const sample of ['2,985,000', '$435,000', '$2,985,000']) {
    assert.ok(!ZONE.includes(sample), `the zone ships the artboard’s sample figure ${sample}`);
  }
  assert.ok(board.includes('viewMore:'), 'the artboard no longer carries a compressed card');
});

test('the fourth tile counts something recorded, and names what is not', () => {
  // The artboard's fourth is `From the Lab · proprietary sourcing`, and NO
  // sourcing channel is stored on a deal. A tile reading "Not recorded"
  // because the PRODUCT never built the store is design commentary on a
  // customer's screen (D56), so the tile counts what the record does carry and
  // the gap is stated in the limits instead.
  assert.match(id1(), /label:'From the Lab'/, 'the artboard changed its fourth tile');
  assert.ok(!Z.includes('From the Lab'), 'the zone draws a tile it has no store for');
  assert.match(Z, /label="On-platform"/);
  assert.match(Z, /live\.filter\(\(d\) => d\.project_id\)/, 'the tile stopped counting anything');
  assert.match(ZONE, /sourcing channel is recorded on a deal/i,
    'the missing sourcing channel is no longer stated anywhere');
  assert.match(ZONE, /<StatedLimit/, 'the limits block is gone');
});

test('every chip narrows, and the narrowing is what the instrument draws', () => {
  // The defect this catches is a chip row that moves a pill and leaves the
  // table alone — four controls that look selectable and select nothing.
  assert.match(Z, /const visible = useMemo\(\(\) => \{/);
  for (const key of ['passed', 'unassigned', 'stale']) {
    assert.ok(Z.includes(`view === '${key}'`), `the ${key} chip narrows nothing`);
  }
  assert.match(Z, /rows=\{visible\.map/, 'the instrument draws something other than the narrowed set');
  assert.match(Z, /rows: visible,/, 'the export ships something other than what is on screen');
  // `Mine` is deliberately absent: the page is already scoped to `mine`, so a
  // chip for it would select everything and read as a narrowing.
  assert.match(Z, /api\.listDeals\(undefined, 'mine'\)/);
});

test('the zone is mounted on its own route and the workspace no longer draws it', () => {
  assert.match(ROUTES, /pipeline: lazy\(\(\) => import\('\.\.\/\.\.\/pages\/investor\/deals\/PipelineZone'\)\)/);
  assert.match(ROUTES, /const Zone = ZONES\[zone\?\.slug\]/);
  assert.match(ROUTES, /\{Zone && !isRoot/, 'the registry is declared and never consulted');
  // Two files mounting one zone row is two chip rows and two export buttons
  // for one route — the defect `profile_zone_actions` caught when this landed.
  assert.ok(!WORKSPACE.includes("investorZoneFilters('deals/pipeline'"),
    'the workspace still mounts the pipeline chip row');
  assert.ok(!WORKSPACE.includes("investorZoneActions('deals/pipeline'"),
    'the workspace still mounts the pipeline ops row');
  assert.ok(!WORKSPACE.includes('investor-pipeline-grid'),
    'the workspace still draws the stage columns the artboard replaced');
});

test('the AI band is allow-listed server-side and drafts from the same threshold', () => {
  assert.match(Z, /surface="deals\/pipeline"/, 'the zone dropped the artboard’s AI band');
  assert.match(RESEARCH, /'deals\/pipeline': \{/, 'the surface is not allow-listed, so the band 400s');
  // The worker's gather must use the SAME 14 days the strip counts, or the
  // band drafts about deals the page does not call stale.
  assert.match(RESEARCH, /datetime\('now', '-14 days'\)/);
  assert.equal(slaPreset(DEFAULT_SLA).amber, 14);
  // The artboard's own instruction: two options and no third.
  const at = RESEARCH.indexOf("'deals/pipeline': {");
  const surface = RESEARCH.slice(at, RESEARCH.indexOf('\n  },', at));
  assert.match(surface, /assign an owner and move it, or pass and record the reason/);
  assert.match(surface, /NO OWNER RECORDED/, 'an unowned deal is drafted as merely slow');
  assert.match(surface, /role !== 'admin' && role !== 'partner' && role !== 'investor'/,
    'the gather no longer refuses an unprivileged caller');
});
