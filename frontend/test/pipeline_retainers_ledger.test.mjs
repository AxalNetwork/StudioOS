/**
 * Pipeline · Retainers — the `p4` artboard, and a ledger that adds up.
 *
 * THE STORES WERE ALREADY THERE. Migration 208 built `partner_retainers` (the
 * shape, the cadence, the amount, the retained hours) and `retainer_usage` (one
 * row per period of hours actually used), and this zone has read them since.
 * What was missing was the artboard: four `StatCard`s whose second tile read
 * `On a retainer` — a label that is not on this artboard — no chip row at all,
 * no toolbar, and a list of rows where the artboard draws a LEDGER with a
 * total.
 *
 * A LEDGER IS A LIST THAT ADDS UP. That is the whole difference, and it is why
 * `The book` carries a `Total` row: a reader checking the MRR tile against the
 * rows can do the addition. The total is the RESPONSE's `mrr_cents` rather than
 * a second sum computed over whichever rows a chip left visible — two figures
 * for one book, disagreeing by exactly the rows the reader filtered out, is
 * worse than one.
 *
 * AND THE COUNTS AND THEIR OWN CHIPS NARROW THE SAME LIST. `Over scope` reads
 * the worker's `over_scope_count`, which is computed over live retainers; the
 * chip beside it used to list ended ones too, so a reader pressing a `1` could
 * be shown two rows. Both sides derive from `live` now.
 *
 * NOTHING HERE IS EVER ZERO BY ABSENCE. A retainer with no amount is skipped
 * from the total rather than summed as free; a retainer with no retained hours
 * has NO utilisation rather than 0%; a period with nothing logged is unrecorded
 * rather than "they used none". The strip, the rows and the total row each hold
 * that line separately, so this file checks each of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { escapeRe } from './_escapeRe.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/canvases/integrated/Pages · Partner Pipeline.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/pipeline/RetainersZone.jsx');
const zone = codeOnly(zoneRaw);
const worker = raw('cloudflare-worker/src/routes/partner_pipeline.ts');
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
  .replace(/^\s*(?:--|\/\/)/gm, '')
  .replace(/\s+/g, ' ');

/**
 * The one spelling this repo does not take from the canvas.
 *
 * The artboard writes "utilization"; every store, response field and page in
 * this repo writes "utilisation" — `utilisation_pct` is the column name Health
 * and this zone both read. Normalising here keeps the assertion on the words
 * that carry meaning rather than turning a house spelling into a drift alarm.
 */
const sz = (s) => s.replace(/([Uu])tiliz/g, '$1tilis');

const P4 = CANVAS.slice(
  CANVAS.indexOf('<section class="ab" id="p4">'),
  CANVAS.indexOf('<section class="ab" id="p5">'),
);
assert.ok(P4.includes('/pipeline/retainers'), 'the p4 artboard could not be found in the canvas');
// The strip, rows and notes live in the data block above the artboards.
const P4DATA = between(CANVAS, '// ── P4 ──', '// ── P5 ──');

test('the strip is the artboard’s four, and the window is the artboard’s window', () => {
  const tiles = [...zone.matchAll(/<RetainerTile\b[\s\S]{0,600}?label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['MRR', 'Renewing in 30 d', 'Under-consuming', 'Over scope'],
    'the strip is no longer the artboard’s four tiles in its order');

  // THE ARTBOARD'S OWN LABELS, one of which is built from `WINDOW`.
  for (const label of ['MRR', 'Under-consuming', 'Over scope']) {
    assert.ok(P4DATA.includes(`label:'${label}'`), `the artboard stopped drawing the ${label} tile`);
  }
  assert.ok(/label:'Renewing in ' \+ WINDOW \+ ' d'/.test(P4DATA),
    'the artboard’s renewal tile no longer derives its label from WINDOW');
  assert.ok(/const WINDOW = 30;/.test(CANVAS), 'the artboard’s renewal window moved off 30 days');
  // BOTH PLACES THE WINDOW IS SPELLED, pinned separately. The tile's list and
  // the ledger's `12d` hint are the same window, and asserting the number
  // appears somewhere lets either of them drift alone.
  assert.ok(/days >= 0 && days <= 30/.test(between(zone, 'const renewingSoon = useMemo(', '  );')),
    'the tile’s renewal window is no longer the artboard’s 30 days');
  assert.ok(/days >= 0 && days <= 30/.test(between(zone, 'testid="the-book"', 'note={')),
    'the ledger’s renewal hint is no longer the artboard’s 30 days');
  assert.ok(!/days <= (?!30\b)\d+/.test(zone), 'a second, different renewal window appeared');

  // `On a retainer` WAS NEVER ON THIS ARTBOARD. It was the second tile until
  // this zone was composed against it, and `Under-consuming` — which is the
  // figure the whole page argues for — took the slot. (The ban is on the
  // LABEL: the JSX comment recording the swap names it, and should.)
  assert.ok(!/label="On a retainer"/.test(zone), 'the strip is drawing a tile the artboard does not have');
  assert.ok(!/<StatCard/.test(zone), 'the strip went back to the generic card the artboards replaced');

  // THE THRESHOLDS ARE THE ARTBOARD'S, and the worker owns them. (They sit in
  // the fixture block above the view models, not in P4DATA.)
  assert.ok(/const under = RET\.filter\(r => utilOf\(r\) < 60\);/.test(CANVAS)
    && /const over = RET\.filter\(r => utilOf\(r\) > 100\);/.test(CANVAS),
    'the artboard’s consumption thresholds changed');
  const readRoute = between(worker, "partnerPipeline.get('/retainers'", 'mrr_basis:');
  assert.ok(/x\.utilisation_pct != null && x\.utilisation_pct < 60/.test(readRoute),
    'the worker’s under-consuming threshold moved off 60%');
  assert.ok(/x\.utilisation_pct != null && x\.utilisation_pct > 100/.test(readRoute),
    'the worker’s over-scope threshold moved off 100%');
});

test('the MRR note is a shape breakdown, because a seat is not a retainer', () => {
  // The artboard counts the strip's note BY SHAPE and says why.
  assert.ok(flat(P4DATA).includes('an embedded seat is recurring revenue but it is not a retainer'),
    'the artboard stopped saying why the MRR note is counted by shape');
  assert.ok(/\['Retainer','Embedded seat'\]\.map/.test(P4DATA),
    'the artboard’s MRR note is no longer built from the two shapes');

  const note = between(zone, 'const shapeNote = useMemo', '}, [d]);');
  assert.ok(/c\.retainer\b/.test(note) && /c\.embedded_seat\b/.test(note),
    'the note stopped breaking the book down by shape');
  assert.ok(/embedded seat\$\{c\.embedded_seat === 1 \? '' : 's'\}/.test(note),
    'one embedded seat now reads as “1 embedded seats”');

  // AND THE COUNTS COME FROM THE WORKER, over the live book — a shape note
  // computed on the page from whatever a chip left visible would disagree with
  // the amount printed above it.
  assert.ok(/shape_counts: byShape,/.test(worker), 'the read stopped returning shape_counts');
  const byShape = between(worker, 'const byShape: Record<string, number>', 'return c.json({');
  assert.ok(/for \(const x of live\)/.test(byShape),
    'the shape counts are no longer taken over the live book');
});

test('the counts and their own chips narrow the same live book', () => {
  // WORKER: `live` is the base for both consumption counts.
  const readRoute = between(worker, "partnerPipeline.get('/retainers'", 'mrr_basis:');
  assert.ok(/const live = items\.filter\(\(x: any\) => x\.retainer && !x\.retainer\.ended_at\);/.test(readRoute),
    'the worker stopped excluding ended retainers from its counts');
  assert.ok(/const under = live\.filter/.test(readRoute) && /const over = live\.filter/.test(readRoute),
    'a consumption count went back to counting the whole book');

  // ZONE: the same list, so the tile and the chip beside it cannot disagree.
  const liveDef = between(zone, 'const live = useMemo(', '  );');
  assert.ok(/items\.filter\(\(r\) => r\.retainer && !r\.retainer\.ended_at\)/.test(liveDef),
    'the zone’s live book stopped excluding ended retainers');
  for (const name of ['renewingSoon', 'overScope', 'underConsuming']) {
    const def = between(zone, `const ${name} = useMemo(`, '  );');
    assert.ok(/live\.filter/.test(def), `${name} narrows the whole book, not the live one`);
    assert.ok(!/items\.filter/.test(def), `${name} went back to narrowing every engagement`);
  }
  // A RETAINER WITH NO RETAINED HOURS IS IN NEITHER CONSUMPTION LIST: it has no
  // utilisation at all, so reading it as under-consumption would report a
  // fee-based deal as a churn risk on a number it does not have.
  for (const name of ['overScope', 'underConsuming']) {
    assert.ok(/r\.utilisation_pct != null/.test(between(zone, `const ${name} = useMemo(`, '  );')),
      `${name} stopped excluding retainers that have no utilisation`);
  }
  // The reason is prose, so it is read off the raw file — `codeOnly` strips the
  // very comment that carries it.
  assert.ok(flat(zoneRaw).includes('a fee-based deal is a different shape, not a badly consumed one'),
    'the zone stopped saying why an hourless retainer is in neither count');
});

test('all four chips select, and the ops row is the artboard’s one export', () => {
  // From THIS artboard's data block — `indexOf('r_views')` over the whole
  // canvas lands inside `pr_views`, the P2 row, and quietly checks the wrong
  // page's chips.
  const chips = [...between(P4DATA, "r_views: views([", '])').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['All', 'Renewing 30d', 'Under-consuming', 'Over scope']);
  const row = between(filters, "'pipeline/retainers': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips,
    'the chip row drifted from the artboard');
  assert.ok(!/unbuilt/.test(row), 'a retainers chip went back to being prose');
  const narrowing = between(zone, 'const visible = useMemo(() => {', '}, [view, items,');
  for (const [key, list] of [['renewing', 'renewingSoon'], ['under', 'underConsuming'], ['over', 'overScope']]) {
    assert.ok(new RegExp(`view === '${escapeRe(key)}'\\) return ${escapeRe(list)};`).test(narrowing),
      `the ${key} chip selects nothing, or selects a different list from its tile`);
  }

  // THE OPS ROW: one export on this artboard, and it is live.
  assert.ok(P4.includes('Export MRR schedule'), 'the artboard’s ops row changed');
  const opRow = between(actions, "'pipeline/retainers': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ['Export MRR schedule']);
  assert.ok(!/unbuilt/.test(opRow), 'the MRR export became prose over a store that holds it');
  // And the export carries the figures the schedule is FOR — an "MRR schedule"
  // without the amount or the renewal date is a client list.
  const view = between(zone, "partnerZoneActions('pipeline/retainers'", '} });');
  for (const col of ['Amount (cents)', 'Cadence', 'Retained hours', 'Utilisation %', 'Renews']) {
    assert.ok(view.includes(col), `the exported schedule stopped carrying ${col}`);
  }
});

test('the book is the artboard’s ledger — its grid, its columns, and a total', () => {
  const cols = between(P4, '<span class="zt">The book</span>', '<span class="th">')
    .match(/grid-template-columns:([^;"]+)/)?.[1].trim();
  assert.equal(cols, '1.05fr .7fr .7fr 1.05fr .75fr .9fr', 'the artboard’s ledger grid changed');
  const head = [...between(P4, '<span class="zt">The book</span>', '</sc-for>')
    .matchAll(/class="th"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(sz(head.join('|')).split('|'),
    ['Client', 'Monthly', 'Hours', 'Utilisation', 'Renews', 'Read']);

  const inst = between(zone, 'testid="the-book"', 'note={');
  assert.ok(inst.includes(`cols="${cols}"`), `the instrument no longer uses the artboard grid ${cols}`);
  assert.deepEqual([...between(inst, 'head={[', ']}').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    ['Client', 'Monthly', 'Hours', 'Utilisation', 'Renews', 'Read']);
  assert.ok(sz(inst).includes('meta="Utilisation against retained scope · only here"'),
    'the artboard’s subtitle for the ledger is gone');
  assert.ok(sz(P4).includes('Utilisation against retained scope · only here'));

  // A LEDGER ADDS UP: the artboard concats a Total row onto its rows, and so
  // does this — and the monthly total is the RESPONSE's, not a second sum over
  // whichever rows a chip happens to have left visible.
  assert.ok(/\.concat\(\[\{ client:'Total'/.test(P4DATA), 'the artboard’s total row is gone');
  const total = between(inst, "key: '__total'", '],\n            },');
  assert.ok(total.includes("{ text: 'Total' }"), 'the ledger stopped drawing its total row');
  assert.ok(/d\?\.mrr_cents == null \? \{ nr: true \} : \{ text: `\$\{moneyCents\(d\.mrr_cents\)\}\/mo` \}/.test(total),
    'the total row stopped taking the monthly figure from the response');
  assert.ok(!/amount_cents/.test(total),
    'the total row re-sums the amounts, so it can disagree with the tile above it');
});

test('nothing on this page is zero because it is absent', () => {
  // NO COERCION ANYWHERE IN THE ZONE. `hours_used ?? 0` says a client with no
  // logged hours used none; `amount_cents || 0` says an unpriced retainer is
  // free. Both are claims about the client, not about the record.
  for (const field of ['hours_used', 'amount_cents', 'retained_hours', 'utilisation_pct']) {
    assert.ok(!new RegExp(`${escapeRe(field)}\\s*(\\?\\?|\\|\\|)\\s*0\\b`).test(zoneRaw),
      `${field} is being coerced to zero`);
  }

  // THREE STATES IN THE HOURS CELL, not two. No retained hours is a different
  // SHAPE of deal; retained hours with nothing logged is a period nobody has
  // filled in; neither is "zero hours used".
  const hours = between(zone, 'r.retained_hours == null', 'u == null');
  assert.ok(/\{ nr: true, sub: 'not sold by the hour' \}/.test(hours),
    'a retainer sold as a fee now reads as a badly consumed one');
  assert.ok(/nothing logged/.test(hours),
    'a period nobody has filled in no longer says so');
  assert.ok(/r\.hours_used == null/.test(hours), 'the unlogged period collapsed into the hourless one');

  // THE TOTAL COUNTS WHAT IT CAN AND SAYS SO.
  const total = between(zone, 'const logged = visible.filter', 'return {');
  assert.ok(/\(r\) => r\.hours_used != null/.test(total),
    'the hours total counts rows with nothing logged');
  assert.ok(flat(between(zone, 'const logged = visible.filter', '{ text: \'\' },'))
    .includes('with hours logged'), 'the hours total stopped naming how many rows are behind it');

  // AND THE WORKER HOLDS THE SAME LINE on both money figures.
  assert.ok(/mrr_cents: counted \? mrrCents : null,/.test(worker),
    'an unpriced book now reports $0 of recurring revenue');
  assert.ok(/at_risk_mrr_cents: under\.some\(\(x: any\) => monthlyOf\(x\) != null\)/.test(worker),
    'unpriceable churn risk now reports as $0 at risk');
  assert.ok(flat(worker).includes('“no money at risk” and “we cannot price the risk” are different answers')
    || flat(worker).includes('"no money at risk" and "we cannot price the risk" are different answers'),
    'the worker stopped saying why that figure is null rather than zero');
});

test('utilisation is the artboard’s bar, capped, and quarterly is divided by three', () => {
  // THE BAR CAPS AT 100 in both, so an over-scope row reads full rather than
  // overflowing its track — the number beside it carries the overage.
  assert.ok(/utilPct:String\(Math\.min\(100, u\)\)/.test(P4DATA), 'the artboard’s bar stopped capping');
  const inst = between(zone, 'testid="the-book"', 'note={');
  assert.ok(/barPct: Math\.min\(100, u\)/.test(inst), 'the ledger’s bar no longer caps at 100');
  // TIED TO THE CELL THAT DRAWS THE BAR. The `Read` cell three lines down opens
  // `u == null ? { nr: true }` too, so a looser pattern passes while the
  // utilisation cell itself renders 0% — which is the one thing this column
  // must never say.
  assert.ok(/u == null\s*\n?\s*\? \{ nr: true \}\s*\n?\s*: \{\s*\n?\s*text: `\$\{u\}%`,\s*\n?\s*barPct:/.test(inst),
    'a retainer with no utilisation no longer reads as having none');
  assert.ok(!/barPct: 0\b/.test(inst), 'the ledger draws a utilisation bar at zero');

  // THE READ IS THE ARTBOARD'S THREE WORDS, and it is absent where there is no
  // utilisation to read.
  for (const word of ['Over scope', 'Churn risk', 'Healthy']) {
    assert.ok(P4DATA.includes(`'${word}'`), `the artboard stopped reading a row as ${word}`);
    assert.ok(inst.includes(`'${word}'`), `the ledger stopped reading a row as ${word}`);
  }

  // QUARTERLY IS NOT MONTHLY. Dividing is the difference between MRR and a
  // figure three times too big for every quarterly line — and the row and the
  // total have to divide the same way or the column will not add up.
  assert.ok(/Math\.round\(Number\(r\.amount_cents\) \/ 3\)/.test(worker),
    'the worker stopped converting a quarterly amount to a monthly one');
  assert.ok(/Math\.round\(Number\(r\.retainer\.amount_cents\) \/ 3\)/.test(inst),
    'the ledger row stopped converting a quarterly amount to a monthly one');
  assert.ok(flat(zone).includes('Quarterly amounts are divided by three'),
    'the stated limits stopped saying how a quarterly retainer is counted');
  assert.ok(flat(zone).includes('nothing is annualised, because a renewal date is not a commitment to renew'),
    'the stated limits stopped refusing to annualise');
});

test('the page argues the artboard’s argument without borrowing its numbers', () => {
  assert.ok(sz(P4).includes('Utilisation is the point'), 'the artboard’s thesis changed');
  assert.ok(flat(zone).includes('Utilisation is the point'), 'the zone stopped making the artboard’s argument');
  assert.ok(flat(zone).includes('a churn risk no complaint has surfaced yet'));
  // THE FIXTURE'S FIGURES STAY IN THE FIXTURE. 34% is Thornfield's and 118% is
  // Novacraft's — printing either would put the canvas's sample clients into
  // this firm's sentence.
  for (const n of ['34%', '118%', 'Thornfield', 'Novacraft']) {
    assert.ok(P4DATA.includes(n) || /utilOf/.test(P4DATA), `the artboard no longer carries ${n}`);
    assert.ok(!zone.includes(n), `the zone prints the canvas’s own ${n} as this firm’s`);
  }
});

test('the AI band is the artboard’s, and the draft opens on what was not used', () => {
  assert.ok(P4.includes('Proposal · renewal risk'));
  assert.ok(P4.includes('Draft the conversation'));
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="pipeline/retainers"'));
  assert.ok(band.includes('label="Proposal · renewal risk"'));
  assert.ok(band.includes('accept="Draft the conversation"'));

  assert.ok(spec.includes("'pipeline/retainers': {"), 'the draft surface is not allow-listed');
  const surface = between(spec, "'pipeline/retainers': {", '\n  },');
  // THE ONE THING A MODEL HANDED A RENEWAL DOES BY DEFAULT is write a renewal
  // notice, which is the single move this page exists to argue against.
  assert.ok(flat(surface).includes('Open with what the client has NOT used, never with what they owe'),
    'the draft may now open with what the client owes');
  assert.ok(flat(surface).includes('has no utilisation at all'),
    'the draft may now read a fee-based retainer as under-consumption');
  assert.ok(flat(surface).includes('never state a renewal date that is not recorded'),
    'the draft may now invent a renewal date');
  // AND THE GATHER READS THE LIVE BOOK, soonest renewal first.
  assert.ok(/r\.ended_at IS NULL/.test(surface), 'the gather is drafting renewals for ended retainers');
  assert.ok(/ORDER BY r\.renews_at IS NULL, r\.renews_at/.test(surface),
    'the gather stopped putting the soonest renewal first');
});
