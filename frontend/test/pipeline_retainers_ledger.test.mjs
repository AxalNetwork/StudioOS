/**
 * Pipeline · Retainers — a ledger that adds up, on the PP06 board (#5939, D4838 part 6).
 *
 * THE STORES WERE ALREADY THERE. Migration 208 built `partner_retainers` (the
 * shape, the cadence, the amount, the retained hours) and `retainer_usage` (one
 * row per period of hours actually used), and this zone has read them since.
 *
 * THE BOARD MOVED. This file used to pin the zone to the integrated canvas's
 * `p4` artboard: four tiles (MRR, Renewing in 30 d, Under-consuming, Over
 * scope), a six-column "book" with a Read column, and an under-consuming line at
 * 60%. #5939 redrew the zone to Pipeline v2's PP06 and PP06m: an attention band
 * first, then Current recurring revenue · Active retainers · Renewal value next
 * 30d · Utilization risk, then a ledger of Client · Monthly equivalent · Scope ·
 * Utilization · Renewal · Health. The low-use line is the Pipeline root's 50%
 * (`commandCentre.js`), imported. What follows checks what the redraw kept:
 *
 *   · THE COUNTS AND THEIR OWN FILTERS NARROW THE SAME LIVE BOOK. An ended
 *     retainer is in no band item and no consumption count.
 *   · A LEDGER IS A LIST THAT ADDS UP. The total is the RESPONSE's `mrr_cents`,
 *     not a second sum over whichever rows a filter left visible, and it is
 *     drawn only over the whole book.
 *   · NOTHING HERE IS EVER ZERO BY ABSENCE. A retainer with no amount is skipped
 *     rather than summed as free; a retainer with no retained hours has NO
 *     utilisation rather than 0%; a period with nothing logged is unrecorded.
 *
 * The rendered checks for the band, the quarterly figure and the sheet are in
 * `pipeline_retainers_pp06_5939.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { escapeRe } from './_escapeRe.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const OLD_CANVAS = raw('design/canvases/integrated/Pages · Partner Pipeline.dc.html');
const CANVAS = raw('design/incoming/Pipeline v2 Page.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/pipeline/RetainersZone.jsx');
const zone = codeOnly(zoneRaw);
const model = read('frontend/src/pages/partner/pipeline/retainersModel.js');
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
  .replace(/^\s*(?:--|\/\/|\*)/gm, '')
  .replace(/\s+/g, ' ');

/**
 * The one spelling this repo does not take from the canvas everywhere. The
 * boards write "utilization"; stores and response fields write "utilisation".
 */
const sz = (s) => s.replace(/([Uu])tiliz/g, '$1tilis');

const PP06 = between(CANVAS, '/* ---------- P4 retainers ---------- */', '/* ---------- P5 analytics ---------- */');
const P4 = OLD_CANVAS.slice(
  OLD_CANVAS.indexOf('<section class="ab" id="p4">'),
  OLD_CANVAS.indexOf('<section class="ab" id="p5">'),
);
const P4DATA = between(OLD_CANVAS, '// ── P4 ──', '// ── P5 ──');

test('the strip is PP06’s four, and the window is the shared 30 days', () => {
  const tiles = [...between(PP06, 'class="kpi4"', '<section').matchAll(/\['([^']+)', '/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['Current recurring revenue', 'Active retainers', 'Renewal value next 30d', 'Utilization risk']);
  const labels = [...between(model, 'export function retainerStrip', '\nexport const TAB_LABEL').matchAll(/tile\(([`'])([^`']+)\1/g)]
    .map((m) => m[2].replace('${RENEWAL_WINDOW_DAYS}', '30'));
  for (const t of tiles) assert.ok(labels.includes(t), `the strip lost ${t}`);
  // The old artboard's tiles are not drawn.
  assert.ok(!/label="(MRR|Under-consuming|On a retainer)"/.test(zone), 'the strip went back to the p4 tiles');
  assert.ok(!/<StatCard/.test(zone), 'the strip went back to the generic card the artboards replaced');
  // ONE RENEWAL WINDOW, the command centre's, spelled nowhere else.
  assert.ok(!/days <= \d+/.test(zone) && !/days <= \d+/.test(model), 'a second renewal window appeared');
  assert.match(model, /import \{[^}]*\bRENEWAL_WINDOW_DAYS\b[^}]*\} from '\.\/commandCentre\.js'/);

  // THE WORKER STILL OWNS ITS OWN COUNTS, and they are not this page's. Its
  // under-consuming count is below 60, which is not the root's low-use rule, so
  // the zone does not draw it (the Worker is outside #5939).
  const readRoute = between(worker, "partnerPipeline.get('/retainers'", 'mrr_basis:');
  assert.ok(/x\.utilisation_pct != null && x\.utilisation_pct > 100/.test(readRoute),
    'the worker’s over-scope threshold moved off 100%');
  assert.doesNotMatch(zone, /under_consuming_count|at_risk_mrr_cents/,
    'the zone draws a Worker count taken at a different threshold from its band');
});

test('active retainers are counted by shape, because a seat is not a retainer', () => {
  assert.ok(flat(P4DATA).includes('an embedded seat is recurring revenue but it is not a retainer'),
    'the artboard stopped saying why the note is counted by shape');
  const strip = between(model, 'export function retainerStrip', '\nexport const TAB_LABEL');
  assert.ok(/c\.retainer\b/.test(strip) && /c\.embedded_seat\b/.test(strip),
    'the strip stopped breaking the book down by shape');
  assert.ok(/plural\(num\(c\.embedded_seat\), 'embedded seat'\)/.test(strip),
    'one embedded seat now reads as “1 embedded seats”');
  assert.ok(/shape_counts: byShape,/.test(worker), 'the read stopped returning shape_counts');
  const byShape = between(worker, 'const byShape: Record<string, number>', 'return c.json({');
  assert.ok(/if \(!x\.retainer\.active\) \{ endedCount \+= 1; continue; \}[\s\S]*?byShape\[shape\] \+= 1/.test(byShape),
    'the shape counts are no longer taken over the live book');
});

test('the counts and their own filters narrow the same live book', () => {
  const readRoute = between(worker, "partnerPipeline.get('/retainers'", 'mrr_basis:');
  assert.ok(/scanAll\(/.test(readRoute), 'the counts stopped walking the whole book');
  assert.ok(/if \(!x\.retainer\.active\) \{ endedCount \+= 1; continue; \}[\s\S]*?under \+= 1[\s\S]*?over \+= 1/.test(readRoute),
    'the worker stopped excluding ended retainers from its counts');

  // ZONE: every band item, the risk tile and the ledger's filter read the same
  // sets, and each set is taken with a predicate that requires an active retainer.
  const sets = between(model, 'export function attentionSets', '\n}');
  assert.ok(/rows\.filter\(b\.rule\)/.test(sets), 'a band item no longer filters with its rule');
  const narrowing = between(zone, 'const visible = useMemo(() => {', '}, [view, sets, items]);');
  assert.ok(/return sets\[view\];/.test(narrowing), 'the ledger filter is not the band item’s own rows');
  const rules = read('frontend/src/pages/partner/pipeline/commandCentre.js');
  for (const name of ['isOverServiced', 'isRenewingSoon', 'isLowUse']) {
    const def = between(rules, `export function ${name}(`, '\n}');
    assert.ok(/retainerActive\(r\)/.test(def), `${name} no longer excludes ended retainers`);
  }
  // A RETAINER WITH NO RECORDED UTILISATION IS IN NEITHER CONSUMPTION RULE.
  for (const name of ['isOverServiced', 'isLowUse']) {
    assert.ok(/pct !== null/.test(between(rules, `export function ${name}(`, '\n}')),
      `${name} stopped excluding retainers that have no utilisation`);
  }
  assert.ok(flat(zoneRaw).includes('a fee-based deal is a different shape, not a badly consumed one'),
    'the zone stopped saying why an hourless retainer is in neither item');
});

test('the toolbar chips select the band’s rows, and the ops row is the one export', () => {
  const chips = [...between(P4DATA, "r_views: views([", '])').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['All', 'Renewing 30d', 'Under-consuming', 'Over scope']);
  const row = between(filters, "'pipeline/retainers': [", '],');
  assert.deepEqual([...row.matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]), chips,
    'the chip row drifted from the artboard');
  assert.ok(!/unbuilt/.test(row), 'a retainers chip went back to being prose');
  // THE CHIP KEYS ARE THE BAND'S KEYS, so the two controls are one view.
  const keys = [...row.matchAll(/key: '([^']+)'/g)].map((m) => m[1]).filter((k) => k !== 'all');
  const band = [...between(model, 'export const BAND = [', '];').matchAll(/key: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...band].sort(), 'a toolbar chip has no band item, or a band item no chip');
  const narrowing = between(zone, 'const visible = useMemo(() => {', '}, [view, sets, items]);');
  for (const key of keys) {
    assert.ok(new RegExp(`view === '${escapeRe(key)}'`).test(narrowing), `the ${key} chip selects nothing`);
  }

  assert.ok(P4.includes('Export MRR schedule'), 'the artboard’s ops row changed');
  const opRow = between(actions, "'pipeline/retainers': [", '],');
  assert.deepEqual([...opRow.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ['Export MRR schedule']);
  assert.ok(!/unbuilt/.test(opRow), 'the MRR export became prose over a store that holds it');
  const view = between(zone, "partnerZoneActions('pipeline/retainers'", '} });');
  for (const col of ['Amount (cents)', 'Cadence', 'Monthly equivalent (cents)', 'Retained hours', 'Utilisation %', 'Renews']) {
    assert.ok(view.includes(col), `the exported schedule stopped carrying ${col}`);
  }
});

test('the ledger is PP06’s columns, with a total over the whole book', () => {
  const head = [...between(PP06, '<thead><tr>', '</tr></thead>').matchAll(/<th(?:\s[^>]*)?>([^<]*)</g)].map((m) => m[1].trim());
  assert.deepEqual(head, ['Client', 'Monthly equivalent', 'Scope', 'Utilization · this period', 'Renewal', 'Health']);
  const zoneHead = between(zone, "{['Client',", '].map(');
  assert.deepEqual([...zoneHead.matchAll(/'([^']+)'/g)].map((m) => m[1]), head);

  // A LEDGER ADDS UP, over the book the response totalled — so the total row is
  // drawn only when no filter is narrowing the rows above it.
  const total = between(zone, '<tfoot>', '</tfoot>');
  assert.ok(/view === 'all' \? \(\s*<tfoot>/.test(zone), 'the total is drawn under a filtered ledger');
  assert.ok(total.includes('Total · active'), 'the ledger stopped drawing its total row');
  assert.ok(/d\?\.mrr_cents != null \? moneyCents\(d\.mrr_cents\)/.test(total),
    'the total row stopped taking the monthly figure from the response');
  assert.ok(!/amount_cents/.test(total), 'the total row re-sums the amounts, so it can disagree with the tile');
});

test('nothing on this page is zero because it is absent', () => {
  for (const [name, src] of [['zone', zoneRaw], ['model', raw('frontend/src/pages/partner/pipeline/retainersModel.js')]]) {
    for (const field of ['hours_used', 'amount_cents', 'retained_hours', 'utilisation_pct', 'monthly_amount_cents', 'current_monthly_cents']) {
      assert.ok(!new RegExp(`${escapeRe(field)}\\)?\\s*(\\?\\?|\\|\\|)\\s*0\\b`).test(src),
        `${field} is being coerced to zero in the ${name}`);
    }
  }
  // THREE STATES, NOT TWO: no retained hours is a different shape of deal, and
  // retained hours with nothing logged is a period nobody has filled in. The
  // Scope cell says the first; the Utilization cell prints the Worker's note.
  const scope = between(model, 'export function scopeText', '\n}');
  assert.ok(/'Not sold by the hour'/.test(scope), 'a retainer sold as a fee now reads as a badly consumed one');
  assert.ok(/<NotComputable why=\{compact \? null : row\.utilisation_note\}>Not recorded<\/NotComputable>/.test(zone),
    'an unlogged period no longer prints the Worker’s reason');

  // THE RENEWAL VALUE COUNTS WHAT IT CAN AND SAYS SO.
  const renewal = between(model, 'const renewing = sets.renewing;', 'const measured');
  assert.ok(/with no amount not in it/.test(renewal), 'the renewal value stopped naming the unpriced rows it skipped');

  // AND THE WORKER HOLDS THE SAME LINE on both money figures.
  assert.ok(/mrr_cents: counted \? mrrCents : null,/.test(worker),
    'an unpriced book now reports $0 of recurring revenue');
  assert.ok(/at_risk_mrr_cents: atRiskPriced \? atRiskCents : null,/.test(worker),
    'unpriceable churn risk now reports as $0 at risk');
});

test('utilization is in words over a capped bar, and quarterly is divided by three', () => {
  // THE BAR CAPS AT 100, so an over-scope row reads full rather than overflowing.
  assert.ok(/Math\.min\(u, 100\)/.test(PP06), 'the board’s bar stopped capping');
  assert.ok(/width: `\$\{Math\.min\(100, u\.pct\)\}%`/.test(zone), 'the ledger’s bar no longer caps at 100');
  // AND THE BAR IS DECORATION: the words carry the reading.
  for (const word of ['over scope', 'low use', 'healthy']) {
    assert.ok(PP06.includes(`'${word}'`), `the board stopped reading a row as ${word}`);
    assert.ok(model.includes(`word: '${word}'`), `the zone stopped reading a row as ${word}`);
  }
  assert.ok(/aria-hidden="true">\s*<div className=\{`h-full rounded-full \$\{bar\}`\}/.test(zone),
    'the colour bar is read out as if it carried meaning');

  assert.match(worker, /const proj = retainerProjection\(/, 'the ledger uses the same projection as Delivery');
  assert.doesNotMatch(between(worker, "partnerPipeline.get('/retainers'", 'mrr_basis:'), /\/ 3\b/);
  assert.match(model, /const cents = num\(t\.monthly_amount_cents\);/, 'the ledger stopped using the Worker’s monthly figure');
  const ledger = between(zone, 'data-testid="retainer-ledger"', '</section>');
  assert.doesNotMatch(ledger, /amount_cents\)\s*\/|cadence === 'quarterly'/, 'the ledger divides an amount itself');
  assert.doesNotMatch(model, /amount_cents\)?\s*\/\s*3/, 'the model divides an amount itself');
  assert.ok(flat(zone).includes('Quarterly amounts are divided by three'),
    'the stated limits stopped saying how a quarterly retainer is counted');
  assert.ok(flat(zone).includes('nothing is annualised, because a renewal date is not a commitment to renew'),
    'the stated limits stopped refusing to annualise');
});

test('the page argues the board’s argument without borrowing its numbers', () => {
  assert.ok(sz(P4).includes('Utilisation is the point'), 'the artboard’s thesis changed');
  assert.ok(flat(sz(zone)).includes('Utilisation is the point'), 'the zone stopped making the artboard’s argument');
  assert.ok(flat(zone).includes('a churn risk no complaint has surfaced yet'));
  // THE FIXTURES' FIGURES STAY IN THE FIXTURES.
  for (const n of ['118%', 'Halden Robotics', 'Kestrel Bio', 'Orbit Grid', '$41,200', 'Thornfield', 'Novacraft']) {
    assert.ok(!zone.includes(n), `the zone prints a canvas sample (${n}) as this firm’s`);
  }
  assert.ok(PP06.includes('Halden Robotics'), 'the board’s sample moved');
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
  assert.ok(flat(surface).includes('Open with what the client has NOT used, never with what they owe'),
    'the draft may now open with what the client owes');
  assert.ok(flat(surface).includes('has no utilisation at all'),
    'the draft may now read a fee-based retainer as under-consumption');
  assert.ok(flat(surface).includes('never state a renewal date that is not recorded'),
    'the draft may now invent a renewal date');
  assert.ok(/r\.ended_at IS NULL/.test(surface), 'the gather is drafting renewals for ended retainers');
  assert.ok(/ORDER BY r\.renews_at IS NULL, r\.renews_at/.test(surface),
    'the gather stopped putting the soonest renewal first');
});
