/**
 * Pipeline · Analytics — the `p5` artboard, and the block it stopped refusing.
 *
 * THE ARTBOARD'S SUBTITLE IS AN INSTRUCTION, not a description: "Depth adds the
 * one thing that changes behaviour: the loss pattern broken out by shape, with
 * the on-price count stated per shape rather than asserted as a universal."
 * That sentence is the whole page, and it was the one thing this zone could not
 * do — `quotes` carried a status and a decision date and nothing about why, so
 * every on-price figure would have been inferred. Migration 234 added
 * `quotes.loss_reason`; the Proposals zone writes it against a closed
 * vocabulary; this zone counts it.
 *
 * THE DENOMINATOR IS THE WHOLE DESIGN PROBLEM, twice over. `bdAnalytics` was
 * already careful about the win rate's — decided quotes only, with the excluded
 * counts shown. The loss taxonomy has the same problem one level down: nobody
 * is obliged to record a reason, so a count of on-price losses is a count over
 * the losses somebody EXPLAINED. Stated as a share of every loss it would be
 * exactly the universal the artboard warns against, which is why the unstated
 * losses get their own row and every read names its sample.
 *
 * AND THE CHIP ROW NARROWS DECISIONS, NOT THE FORECAST. An open quote has no
 * decision date to place in any window. If a period chip filtered it out the
 * forecast would empty the moment a reader pressed one; if it silently did not,
 * the reader would think it had. Both the worker and the page say which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Pipeline.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/pipeline/AnalyticsZone.jsx');
const zone = codeOnly(zoneRaw);
const engine = raw('cloudflare-worker/src/services/bdAnalytics.ts');
const route = raw('cloudflare-worker/src/routes/needs.ts');
const pipelineRoute = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

/** The source between two markers, with BOTH ends proven to exist. */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/** Prose flattened out of comment markers, line wraps and `\uXXXX` escapes. */
const flat = (s) => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/^\s*(?:--|\/\/|\*)/gm, '')
  .replace(/\s+/g, ' ');

/** The house spelling: the artboard writes "utilization", the repo "utilisation". */
const sz = (s) => s.replace(/([Uu])tiliz/g, '$1tilis');

const P5 = CANVAS.slice(
  CANVAS.indexOf('<section class="ab" id="p5">'),
  CANVAS.indexOf('</body>'),
);
assert.ok(P5.includes('/pipeline/analytics'), 'the p5 artboard could not be found in the canvas');
// The strip, rows and notes live in the data block, not the markup.
const P5DATA = CANVAS.slice(CANVAS.indexOf('// ── P5 ──'), CANVAS.lastIndexOf('};'));

test('the strip is the artboard’s four, and the fourth is the page’s argument', () => {
  const labels = [...between(P5DATA, 'a_stats: [', 'a_shape:').matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Win rate', 'Median cycle', 'Weighted forecast', 'On-price losses']);
  const tiles = [...zone.matchAll(/<AnalyticsTile\b[\s\S]{0,700}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, labels, 'the strip is no longer the artboard’s four tiles in its order');
  assert.ok(!/<StatCard/.test(zone), 'the strip went back to the generic card the artboards replaced');

  // THE FOURTH TILE IS A FRACTION OF LOSSES, which is what the artboard draws
  // (`onPrice + ' of ' + LOST`) — a bare count would not say how many bids it
  // is out of.
  assert.ok(/value:String\(onPrice\) \+ ' of ' \+ LOST/.test(P5DATA),
    'the artboard’s on-price tile stopped being a fraction');
  const fourth = between(zone, 'label="On-price losses"', '/>');
  assert.ok(/\$\{d\?\.on_price_losses \?\? 0\} of \$\{lostCount\}/.test(fourth),
    'the on-price tile is no longer a fraction of the losses in the window');
  // AND IT NAMES THE LOSSES NOBODY EXPLAINED, because the count is over the
  // ones somebody did.
  assert.ok(/losses_unstated/.test(fourth),
    'the tile presents an explained-loss count without saying how many were never explained');
  // NOTHING LOST IS NOT ZERO ON PRICE.
  assert.ok(/nr=\{!lostCount\}/.test(fourth), 'a window with no losses reports 0 of 0 rather than nothing');
});

test('the loss taxonomy is read, not inferred, and is spelled in one place', () => {
  // ONE VOCABULARY ACROSS THE WRITER AND THE READER. Spelling it twice is how
  // a chart ends up with three bars over a four-value column.
  assert.ok(/export const LOSS_REASONS: readonly string\[\] = \['price', 'scope_mismatch', 'timing', 'other'\];/.test(engine),
    'the loss taxonomy moved or changed');
  assert.ok(/import \{ LOSS_REASONS \} from '\.\.\/services\/bdAnalytics';/.test(pipelineRoute),
    'the writer keeps its own copy of the taxonomy again');
  assert.ok(!/const LOSS_REASONS = \[/.test(pipelineRoute),
    'a second taxonomy literal is back in the route that writes it');

  // A VALUE OUTSIDE THE TAXONOMY IS AN UNEXPLAINED LOSS, not a fifth category:
  // one bad write must not be able to invent a pattern.
  const reader = between(engine, 'function lossReasonOf', '}\n');
  assert.ok(/LOSS_REASONS\.includes\(v\) \? v : null/.test(reader),
    'an off-taxonomy string is being counted as a reason');

  // EVERY ENTRY COMES BACK INCLUDING THE ZEROES.
  const analyser = between(engine, 'export function analyseLossReasons', '\n}');
  assert.ok(/for \(const r of LOSS_REASONS\) counts\[r\] = 0;/.test(analyser),
    'the taxonomy no longer starts from zero for every entry');
  // ANCHORED ON THE COMMA. Unanchored, an appended `.filter((r) => r.count > 0)`
  // satisfies the pattern while dropping exactly the rows this asserts are kept
  // — which is what a mutation of that shape did before this line was tightened.
  assert.ok(/reasons: LOSS_REASONS\.map\(\(reason\) => \(\{ reason, count: counts\[reason\] \}\)\),\n/.test(analyser),
    'the chart would drop the reasons nobody has picked, implying they were never options');
  assert.ok(/if \(reason\) counts\[reason\] \+= 1;\s*\n?\s*else unstated\+\+;/.test(analyser),
    'an unexplained loss is being folded into the taxonomy');
  assert.ok(flat(engine).includes('a bar chart missing its zero rows implies the reasons it omits were never options'),
    'the engine stopped saying why the empty rows are returned');
});

test('the on-price count is stated per shape, over explained losses only', () => {
  // THE ARTBOARD'S OWN INSTRUCTION, and its own two readings.
  assert.ok(flat(P5).includes('with the on-price count stated per shape rather than asserted as a universal'),
    'the artboard’s subtitle changed');
  assert.ok(P5DATA.includes("'One bid, one won. Too few to claim a pattern.'"),
    'the artboard stopped refusing a pattern under two bids');
  assert.ok(P5DATA.includes("'no loss was on price.'"), 'the artboard’s zero-on-price reading is gone');

  // THE ENGINE CARRIES BOTH NUMBERS, because the fraction's denominator is the
  // losses somebody explained.
  assert.ok(/on_price_losses: v\.onPrice,/.test(engine) && /losses_with_reason: v\.reasoned,/.test(engine),
    'the shape breakdown stopped carrying the on-price fraction');
  assert.ok(flat(engine).includes('a fraction whose denominator must be the losses somebody explained, not every loss'),
    'the engine stopped saying what the denominator is');

  // AND THE ZONE'S READ HOLDS BOTH RULES.
  const readFn = between(zone, 'function shapeRead(s) {', '\n}');
  assert.ok(/decided === 1/.test(readFn) && /Too few to claim a pattern/.test(readFn),
    'a single decision now reads as a pattern');
  assert.ok(/s\.losses_with_reason === 0/.test(readFn),
    'a shape whose losses nobody explained still reports an on-price share');
  // THE DENOMINATOR IS BUILT ONCE and every on-price sentence uses it, so the
  // count cannot quietly become a share of losses nobody explained — which is
  // the universal the artboard refuses. (`s.rejected` is still allowed to
  // appear: "no reason is recorded against any of the 3 losses" is a statement
  // about the RECORD, not an on-price share.)
  assert.ok(/const of = `of the \$\{s\.losses_with_reason\} explained loss/.test(readFn),
    'the on-price denominator is no longer the explained losses');
  for (const sentence of readFn.match(/return[^;]*on_price_losses[^;]*;/g) || []) {
    assert.ok(/\$\{of\}/.test(sentence),
      `an on-price reading states its own denominator instead of the explained one: ${sentence.slice(0, 90)}`);
  }
  assert.ok((readFn.match(/on_price_losses/g) || []).length >= 2,
    'the read stopped distinguishing zero on price from some on price');
});

test('the chip row narrows decisions in the worker, and never the forecast', () => {
  const chips = [...between(P5DATA, 'a_views: views([', '])').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['Q3 2026', 'Q2 2026', 'Year to date', 'By shape']);
  const row = between(filters, "'pipeline/analytics': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips,
    'the chip row drifted from the artboard');
  assert.ok(!/unbuilt/.test(row), 'an analytics chip went back to being prose');
  // THE QUARTERS ARE RELATIVE TO TODAY. `Q3 2026` is when the artboard was
  // drawn; a page whose first chip named a fixed quarter would be wrong for
  // every reader after it.
  assert.deepEqual([...row.matchAll(/key: '([^']+)'/g)].map((m) => m[1]),
    ['quarter', 'prev_quarter', 'ytd', 'shape']);
  assert.ok(!/Q3 2026'/.test(zone), 'the zone prints the canvas’s own quarter as this firm’s');

  // THE PAGE'S WINDOW MAP IS EXACTLY THE CHIP ROW IT RENDERS. Parsed on both
  // sides rather than spot-checked: a map that kept three of the four keys, or
  // renamed one, satisfies every substring assertion while a chip silently
  // falls back to another window's figures.
  const windows = [...between(zone, 'const WINDOWS = {', '};').matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(windows, [...row.matchAll(/key: '([^']+)'/g)].map((m) => m[1]),
    'the page’s window map and its chip row have drifted apart');
  // AND A KEY OUTSIDE THE MAP FALLS BACK TO A KEY INSIDE IT. The worker coerces
  // an unknown period to all time rather than refusing, so a page that
  // forwarded one would show all-time figures under a chip that says otherwise.
  assert.ok(/const windowOf = \(v\) => \(Object\.prototype\.hasOwnProperty\.call\(WINDOWS, v\) \? v : '(\w+)'\);/
    .test(zone), 'a chip key the page does not know is being forwarded unchecked');
  const fallback = zone.match(/hasOwnProperty\.call\(WINDOWS, v\) \? v : '(\w+)'\)/)[1];
  assert.ok(windows.includes(fallback), `the fallback window '${fallback}' is not one of the page’s own`);

  // THE WINDOW IS APPLIED IN THE WORKER, from one clock.
  const filter = between(engine, 'export function inDecisionPeriod', '\n}');
  assert.ok(/if \(period === 'all' \|\| period === 'shape'\) return rows;/.test(filter),
    'the grouping chip is being treated as a time window');
  assert.ok(/if \(!DECIDED\.has\(status\)\) return true;/.test(filter),
    'an undecided quote is being filtered out of a window it cannot belong to');
  assert.ok(/if \(Number\.isNaN\(t\)\) return false;/.test(filter),
    'a decided quote with no readable date is being credited to the current window');
  assert.ok(flat(engine).includes('the window narrows what has been DECIDED and leaves what is still open alone'),
    'the engine stopped saying what the window applies to');

  // AND THE FORECAST SAYS IT IGNORES THE CHIP, in the response and on the page.
  assert.ok(/forecast_scope: 'all_open'/.test(route));
  assert.ok(/forecast: weightedPipeline\(q\)/.test(route),
    'the forecast is being narrowed by a chip that cannot place an open quote');
  const forecastTile = between(zone, 'label="Weighted forecast"', '/>');
  assert.ok(/every window/.test(forecastTile),
    'the forecast tile no longer says the chip does not narrow it');
});

test('the by-shape table is the artboard’s four columns', () => {
  const card = between(P5, '<span class="zt">By shape</span>', '</sc-for>');
  const cols = card.match(/grid-template-columns:([^;"]+)/)?.[1].trim();
  assert.equal(cols, '1.1fr .6fr .6fr 1.5fr', 'the artboard’s by-shape grid changed');
  const head = [...card.matchAll(/class="th"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(head, ['Shape', 'Win', 'Cycle', 'Read']);

  const inst = between(zone, 'testid="by-shape"', 'note={');
  assert.ok(inst.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  assert.deepEqual([...between(inst, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]), head);
  assert.ok(inst.includes('meta="On-price losses stated per shape"'),
    'the artboard’s subtitle for the by-shape card is gone');
  assert.ok(P5.includes('On-price losses stated per shape'));
  // A SHAPE WITH NO NAME IS UNRECORDED, not a blank row — the LEFT join that
  // keeps it in the denominator is the reason it is here at all.
  assert.ok(/s\.shape == null\s*\n?\s*\? \{ nr: true,/.test(inst),
    'a quote whose need is unreadable now draws an empty shape cell');
});

test('the quarter chart is the artboard’s series, and an absent shape draws nothing', () => {
  const card = between(P5, '<span class="zt">Quarter over quarter</span>', '</div>\n      </div>');
  assert.ok(card.includes('Win rate by shape'), 'the artboard’s chart subtitle changed');
  assert.ok(zone.includes('Win rate by shape'), 'the zone stopped naming what the chart plots');
  // THE ARTBOARD'S THREE COLOURS, in its order.
  assert.ok(/\['#fcd34d','#d97706','#92400e'\]/.test(P5DATA), 'the artboard’s series colours changed');
  assert.ok(/const SERIES = \['#fcd34d', '#d97706', '#92400e'\];/.test(zone),
    'the zone no longer uses the artboard’s series colours');
  // THE LEGEND IS PINNED BY ITS OWN MARK, not by the word: the sentence
  // explaining it lives in a comment, and `codeOnly` strips comments — so a
  // word-match would pass over a chart that had lost its swatches.
  assert.ok(/a_legend:/.test(P5DATA), 'the artboard’s legend is gone');
  const legend = between(zone, 'data-testid="chart-legend"', '</div>');
  assert.ok(/series\.map/.test(legend) && /background: s\.color/.test(legend),
    'the legend stopped drawing one swatch per series');
  assert.ok(/shapeName\(s\.shape\)/.test(legend), 'the legend swatches lost their labels');

  // THE SERIES ARE THIS FIRM'S SHAPES, not the fixture's three.
  for (const n of ['Fixed-scope', 'Embedded seats']) {
    assert.ok(P5DATA.includes(n), `the artboard no longer names ${n}`);
    assert.ok(!zone.includes(n), `the zone prints the canvas’s own ${n} series as this firm’s`);
  }

  // A SHAPE THAT DECIDED NOTHING IN A QUARTER DRAWS NO BAR. A zero-height
  // column reads as having lost every bid rather than as having made none —
  // the same distinction the strip's null guard makes.
  const chart = between(zone, 'const point = (q.by_shape || [])', '})}');
  assert.ok(/if \(!point \|\| point\.win_rate_pct == null\) \{/.test(chart),
    'a shape with no decisions in a quarter is drawing a bar');
  assert.ok(!/win_rate_pct \?\? 0|win_rate_pct \|\| 0/.test(zoneRaw),
    'a missing win rate is being coerced to zero');
  // AND EACH QUARTER'S SERIES IS ORDERED THE SAME WAY THE TABLE IS, so one
  // colour means one row in both.
  assert.ok(/\.sort\(byShapeName\)/.test(engine), 'the quarter series stopped sharing the table’s ordering');
  const quarterFn = between(engine, 'export function analyseByQuarter', '\n}');
  assert.ok(/win_rate_pct: s\.decided > 0 \? pct\(s\.accepted \/ s\.decided\) : null/.test(quarterFn),
    'a shape that decided nothing now carries a rate');
});

test('the ops row is the artboard’s two, and the export carries the loss columns', () => {
  assert.ok(P5.includes('Export chart') && P5.includes('Save benchmark'),
    'the artboard’s ops row changed');
  const opRow = between(actions, "'pipeline/analytics': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]),
    ['Export chart', 'Save benchmark']);
  // `Save benchmark` STAYS PROSE, and for a reason that is still true: the
  // benchmark register exists to hold a figure WITH its source and sample, and
  // this page has neither to give it.
  assert.ok(/'Save benchmark', unbuilt:/.test(opRow),
    'the benchmark op went live over a register built to refuse unsourced figures');
  assert.ok(!/'Export chart',[^}]*unbuilt/.test(opRow), 'the chart export became prose');

  // THE EXPORT IS THE FIGURES THE CHART IS DRAWN FROM — including both loss
  // columns, or a reader cannot check the per-shape claim the page makes.
  const view = between(zone, "partnerZoneActions('pipeline/analytics'", '} });');
  for (const col of ['Win rate %', 'Median cycle (days)', 'Losses', 'Losses with a reason', 'On price']) {
    assert.ok(view.includes(col), `the exported chart stopped carrying ${col}`);
  }
});

test('the AI band is the artboard’s, and the narrator is told what it may not read', () => {
  assert.ok(P5.includes('Proposal · the quarter, narrated'));
  assert.ok(P5.includes('Accept read'));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="pipeline/analytics"'));
  assert.ok(band.includes('label="Proposal · the quarter, narrated"'));
  assert.ok(band.includes('accept="Accept read"'));

  assert.ok(spec.includes("'pipeline/analytics': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'pipeline/analytics': {", "'pipeline/leads': {");
  // THE FAILURE MODE HERE IS CONFIDENCE, NOT INVENTION: every figure is handed
  // over, so what a model does by default is read a pattern out of three
  // decisions and phrase it as a finding.
  assert.ok(flat(surface).includes('say the sample is too small to read rather than stating a pattern'),
    'the draft may now claim a pattern from a handful of decisions');
  assert.ok(flat(surface).includes('A loss with no recorded reason is not a loss on price'),
    'the draft may now read an unexplained loss as a price loss');
  assert.ok(flat(surface).includes('it is an assumption, not a prediction'),
    'the draft may now present the forecast as a prediction');
  assert.ok(flat(surface).includes('never propose a discount as the way to move it'),
    'the draft may now recommend discounting');
  // AND THE GATHER HANDS OVER THE RECORD, not the summary — including the
  // still-open bids, marked as belonging to no quarter.
  assert.ok(/q\.loss_reason/.test(surface), 'the gather stopped reading the loss reason');
  assert.ok(/NO REASON RECORDED, do not read this as a price loss/.test(surface),
    'the gather stopped marking an unexplained loss');
  assert.ok(/STILL OPEN, in no quarter and in no win rate/.test(surface),
    'an open bid is being handed over without saying it counts toward nothing');
});

test('the page keeps the artboard’s argument and none of its figures', () => {
  assert.ok(sz(flat(P5)).includes('the loss pattern broken out by shape'));
  assert.ok(flat(zone).includes('the loss pattern that explains'),
    'the zone stopped making the artboard’s argument');
  // THE FIXTURE'S NUMBERS AND CLIENTS STAY IN THE FIXTURE.
  for (const n of ['Aperture', 'Kelp Bio', 'Solano Health', 'Thornfield']) {
    assert.ok(CANVAS.includes(n), `the canvas no longer carries ${n}`);
    assert.ok(!zone.includes(n), `the zone prints the canvas’s own ${n} as this firm’s`);
  }
  // AND NO MONEY OR PERCENTAGE LITERAL AT ALL. Every figure on this page is
  // the response's; a typed one would be the fixture's, whatever it said.
  assert.ok(!/\$[\d,]{3,}/.test(zone), 'a money figure is hardcoded into the zone');
  assert.ok(!/>\s*\d{1,3}%\s*</.test(zone), 'a percentage is hardcoded into the zone');
  // AND DEMAND INSIGHTS IS STILL NAMED as the different question it answers.
  assert.ok(/\/partner\/insights/.test(zone),
    'the zone stopped pointing at the board-wide surface it used to render');
});
