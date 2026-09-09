/**
 * Offers · Visibility — the `po3` artboard, and the three columns it cannot fill.
 *
 * WHAT THIS ZONE ALREADY HAD. Migration 209 gave it `partner_surfaces` and
 * `engagement_sources`, and the second is a JOIN rather than a model: an
 * engagement nobody attributed counts toward no surface at all. So the artboard's
 * hardest claim — "Volume is not the ranking" — was already true here before this
 * artboard was composed onto it. What was missing was the artboard: a strip, the
 * linkage note, and the instrument in its five columns.
 *
 * WHAT IT STILL CANNOT HAVE, AND WHY THAT IS THE POINT. The artboard's five
 * columns are `Surface · Views · Leads · Engagements · Lead → engagement`, and
 * three of them have no store anywhere in this product: a view count needs an
 * impression pipeline rather than a table, and nothing records which surface a
 * founder arrived through, so the ratio has an absent denominator as well as an
 * absent numerator.
 *
 * THE ARTBOARD MAKES THE SAME CALL THIS FILE HOLDS THE PAGE TO. Two of its own
 * five sample surfaces have `views:null` and it renders an em dash for them,
 * on the stated grounds that "inventing one would make the widest column the
 * least true". Here that applies to every row rather than to two of them — so
 * the column is drawn and stated absent, which is D68's distinction: the gap is
 * the PRODUCT'S, so it is named once in the instNote rather than dressed as this
 * firm's finding, and it is never filled with a zero a reader would take for
 * "nobody came" when it means "nobody counted".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));

const CANVAS = raw('design/incoming/Pages · Partner Offers.dc.html');
const zoneRaw = raw('frontend/src/pages/partner/offers/VisibilityZone.jsx');
const zone = read('frontend/src/pages/partner/offers/VisibilityZone.jsx');
const filters = read('frontend/src/workspaces/partnerZoneFilters.js');
const actions = read('frontend/src/workspaces/partnerZoneActions.js');
const spec = raw('cloudflare-worker/src/routes/research.ts');

const PO3 = CANVAS.slice(CANVAS.indexOf("{ id:'po3'"), CANVAS.indexOf("{ id:'po4'"));
assert.ok(PO3.includes("route:'/offers/visibility'"), 'the po3 artboard could not be found in the canvas');

/**
 * The source between two markers, with BOTH ends proven to exist.
 *
 * A bare `slice(indexOf(a), indexOf(b))` where `b` is absent returns everything
 * from `a` to the end of the file, and a slice that reaches EOF picks up its
 * neighbours' code — which is how one assertion in the Network suite passed by
 * reading the next route's owner predicate. Worse here: `codeOnly` DELETES
 * whole-line `//` comments, so a marker chosen out of the file as read is not
 * necessarily a marker present in the text being sliced.
 */
function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

/** The single `<Instrument … />` element, bounded at its own closing tag. */
const INST = (() => {
  const at = zone.indexOf('<Instrument');
  assert.ok(at > 0, 'the instrument is gone from the zone');
  const end = zone.indexOf('/>', zone.indexOf('note={', at));
  return zone.slice(at, end);
})();

/**
 * The `{…}` entries of the array that opens at `after`, as source strings.
 *
 * PARSED RATHER THAN MATCHED, for two escapes this suite caught in its own
 * mutation run:
 *
 *   A substring search for `{ nr: true }` counts occurrences without knowing
 *   WHICH column each sits in, so swapping the engagement cell into the Views
 *   slot — the one failure that would make this zone lie about reach — left the
 *   count unchanged and the test green.
 *
 *   And `slice(indexOf(chip), 400)` runs past the end of its own entry into the
 *   next one, so a chip given a live `key` still read as `unbuilt:` because its
 *   NEIGHBOUR carried the word. Every entry here ends at its own closing brace.
 */
function entriesIn(src, after) {
  const at = src.indexOf(after);
  assert.ok(at >= 0, `the list is gone: ${after}`);
  let depth = 0;
  let start = -1;
  const out = [];
  for (let i = at + after.length; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === ']' && depth === 0) break;
    if (ch === '{') { if (depth === 0) start = i; depth += 1; }
    else if (ch === '}') { depth -= 1; if (depth === 0) out.push(src.slice(start, i + 1)); }
  }
  assert.ok(out.length > 0, `no entry could be read out of ${after}`);
  return out;
}

test('the strip is the artboard’s four tiles, in its order', () => {
  const adds = PO3.slice(PO3.indexOf('adds:['), PO3.indexOf('linkage:'));
  const labels = [...adds.matchAll(/label:'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Leads', 'Engagements', 'Best converter', 'Directory views']);
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', 'Reads through to Delivery');
  const drawn = [...strip.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
  // Deduplicated because `Best converter` is drawn twice — once with a value and
  // once absent — and it is one tile either way.
  assert.deepEqual([...new Set(drawn)], labels, 'the strip is no longer the artboard’s four tiles in its order');
});

test('the two tiles with no store read absent, and the two with one count rows', () => {
  const strip = between(zone, '<div className="grid grid-cols-2 gap-3 md:grid-cols-4">', 'Reads through to Delivery');
  // `Leads` and `Directory views` are the PRODUCT'S gaps and can never carry a
  // figure here; a zero on either would read as "nobody came".
  assert.match(strip, /<VisTile label="Leads" nr note="no store records which surface a founder arrived through" \/>/,
    'the Leads tile is being given a number the product does not record');
  assert.match(strip, /<VisTile label="Directory views" nr note="no impression pipeline — never estimated" \/>/,
    'the Directory views tile is being given a number the product does not record');
  // `Engagements` and `Best converter` are rows, so they carry values — and the
  // second falls back to absent when no engagement names a surface yet, which is
  // this reader's record rather than the product's gap.
  assert.match(strip, /label="Engagements"\s*\n\s*value=\{String\(d\?\.engagement_total \?\? 0\)\}/,
    'the Engagements tile no longer counts the attributed engagements');
  assert.match(strip, /label="Best converter" nr note="no engagement names a surface yet"/,
    'the empty case of Best converter no longer reads absent');
});

test('Best converter is the most-sourced surface, over the whole set', () => {
  const fn = between(zone, 'const best = items.reduce(', 'const rowActions =');
  assert.match(fn, /Number\(s2\.engagement_count\) > Number\(top\?\.engagement_count \?\? 0\)/,
    'Best converter is no longer ranked by engagements');
  // OVER `items`, NOT `visible`. They are the same list today — the sort is an
  // ordering, not a subset — and reading the unsorted set says the tile reports
  // on the whole catalog of surfaces rather than on whatever a chip left.
  assert.ok(!/\bvisible\b/.test(fn), 'the Best converter tile is reading a narrowed list');
});

test('the linkage note says the column counts named rows rather than a total', () => {
  // The artboard's `linkage`, and it is what makes the Engagements column
  // trustworthy: nothing appears here that does not exist in Delivery.
  assert.match(PO3, /linkage:'Every engagement in Delivery names the surface that sourced it, so this column counts named rows rather than modelling a total/,
    'the canvas’s linkage note has moved');
  const at = zone.indexOf('Reads through to Delivery:');
  assert.ok(at > 0, 'the linkage note is gone');
  const note = between(zone.slice(at), 'Reads through to Delivery:', '<Instrument');
  assert.ok(note.includes('counts named\n            rows rather than modelling a total'),
    'the linkage note no longer says what the column counts');
  assert.ok(note.includes('Nothing appears here that does not exist there'),
    'the linkage note no longer says the counts are traceable to Delivery');
  // And it names this firm's own unattributed rows, which is the part of the
  // claim the artboard's sample cannot carry: an engagement nobody attributed is
  // counted toward none of the surfaces rather than shared out across them.
  assert.ok(note.includes('are counted toward none of them'),
    'the linkage note no longer says where the unattributed rows go');
  // BETWEEN THE STRIP AND THE INSTRUMENT, which is where the artboard puts it —
  // it explains the column the instrument is about to draw.
  const strip = zone.indexOf('<VisTile label="Leads"');
  assert.ok(strip > 0 && strip < at && at < zone.indexOf('<Instrument'),
    'the linkage note has moved out from between the strip and the instrument');
});

test('the instrument draws the artboard’s five columns, in its order and at its widths', () => {
  const head = JSON.parse(`[${PO3.match(/head:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(head, ['Surface', 'Views', 'Leads', 'Engagements', 'Lead → engagement']);
  assert.ok(INST.includes(`head={${JSON.stringify(head).replace(/"/g, "'").replace(/,/g, ', ')}}`),
    'the instrument head is no longer the artboard’s five columns in its order');
  assert.ok(INST.includes(`cols="${PO3.match(/cols:'([^']+)'/)[1]}"`),
    'the instrument no longer uses the artboard’s column widths');
  assert.ok(INST.includes(`meta="${PO3.match(/instMeta:'([^']+)'/)[1]}"`),
    'the instrument’s meta line has left the artboard');
  assert.ok(INST.includes(`title="${PO3.match(/instTitle:'([^']+)'/)[1]}"`),
    'the instrument’s title has left the artboard');
});

test('Views, Leads and the ratio are absent on every row; Engagements is the one that counts', () => {
  const cells = entriesIn(INST, 'cells: [');
  assert.equal(cells.length, 5, 'the row no longer draws one cell per artboard column');
  // Position matters, not the tally: the surface name, then the three the store
  // cannot fill, with the real count in the artboard's fourth slot.
  assert.match(cells[0], /text: row\.name/, 'the first column is no longer the surface');
  for (const i of [1, 2, 4]) {
    assert.equal(cells[i].replace(/\s+/g, ' ').trim(), '{ nr: true }',
      `column ${i} is carrying a figure this product does not record`);
  }
  assert.match(cells[3], /text: String\(row\.engagement_count \?\? 0\)/,
    'the Engagements column is no longer the counted one');
  // A zero here is a real zero — `engagement_sources` is a join, so a surface
  // with no attributed engagement genuinely produced none that anybody named.
  assert.ok(!/nr: true/.test(cells[3]), 'the one column with a store has stopped reporting it');
});

test('the instNote names all three absences, and cites the artboard’s reason', () => {
  const note = INST.slice(INST.indexOf('note={'));
  assert.ok(note.includes('Views and Leads read "Not recorded" on every row'),
    'the instNote no longer says the two columns are absent on every row');
  assert.ok(note.includes('and the ratio between them with them'),
    'the instNote no longer accounts for the third column, whose denominator is one of the other two');
  assert.ok(note.includes('an impression pipeline rather than a table'),
    'the instNote no longer says why a view count cannot exist here');
  assert.ok(note.includes('which surface a founder arrived through'),
    'the instNote no longer says why a lead count cannot exist here');
  // The artboard's own words for the same call, carried over rather than
  // paraphrased — it renders an em dash for two of its five surfaces on exactly
  // this ground, and here it is every row.
  assert.match(PO3, /inventing one would make the widest column the least true/,
    'the canvas’s reason for the em dash has moved');
  assert.ok(note.includes('inventing one would make the widest column the least true'),
    'the instNote no longer carries the artboard’s reason for the absence');
  assert.ok(note.includes('here that applies to every row'),
    'the instNote no longer says the absence is wider here than on the artboard');
});

test('one chip runs, and the other three name the store they wait on', () => {
  const canvasChips = JSON.parse(`[${PO3.match(/filters: fil\(\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasChips, ['By engagements', 'By leads', 'By views', 'Weak intent']);
  const chips = entriesIn(filters, "'offers/visibility': [");
  assert.deepEqual(chips.map((e) => e.match(/canvas: '([^']+)'/)[1]), canvasChips,
    'the chip row is no longer the artboard’s four labels in its order');
  assert.match(chips[0], /\{ canvas: 'By engagements', key: 'engagements' \}/,
    'the one chip with a store has stopped running');
  // EACH ENTRY IS BOUNDED AT ITS OWN BRACE. A slice that ran on into the next
  // entry found `unbuilt:` there and passed a chip that had just been given a
  // live key — an escape this suite's own mutation run caught.
  for (const entry of chips.slice(1)) {
    const chip = entry.match(/canvas: '([^']+)'/)[1];
    assert.match(entry, /unbuilt: '/, `${chip} claims a store it does not have`);
    assert.ok(!/\bkey: '/.test(entry), `${chip} has been given a key, so it now selects something`);
  }
  // AND IT IS AN ORDERING, NOT A SUBSET, so the page holds no view state: a
  // control whose value can never change would look selectable and select
  // nothing. The zone applies the sort itself rather than trusting the query.
  assert.match(zone, /const view = 'engagements';/, 'the single ordering has become a state');
  assert.match(zone, /const visible = \[\.\.\.items\]\.sort\(ORDERINGS\[view\]\);/,
    'the ordering the chip and the heading both claim is no longer applied here');
});

test('Export runs; the two ops with no setting to change stay prose', () => {
  const canvasOps = JSON.parse(`[${PO3.match(/ops:\[([^\]]+)\]/)[1].replace(/'/g, '"')}]`);
  assert.deepEqual(canvasOps, ['Adjust placements', 'Attribution rules', 'Export']);
  const ops = entriesIn(actions, "'offers/visibility': [");
  assert.deepEqual(ops.map((e) => e.match(/label: '([^']+)'/)[1]), canvasOps,
    'the ops row is no longer the artboard’s three labels in its order');
  assert.match(ops[2], /\{ label: 'Export', kind: 'export' \}/, 'the export has stopped running');
  for (const entry of ops.slice(0, 2)) {
    const label = entry.match(/label: '([^']+)'/)[1];
    assert.match(entry, /unbuilt: '/, `${label} claims a store it does not have`);
    assert.ok(!/\bkind: '/.test(entry), `${label} has been given a control it has no setting to change`);
  }
  // The export header is hoisted above the gate branch so an unlinked account
  // draws the same row — disabled, and saying so itself.
  assert.match(zone, /const rowActions = partnerZoneActions\('offers\/visibility', \{ view: \{ header: \[/,
    'the export no longer describes the columns it would write');
  assert.match(zone, /<UnlinkedZone title="Visibility" actions=\{rowActions\} \/>/,
    'the gate branch no longer draws the same header row as the live one');
});

test('the AI band is the artboard’s, on its own allow-listed surface', () => {
  const label = PO3.match(/aiLabel:'([^']*)'/)[1];
  const accept = PO3.match(/aiAccept:'([^']*)'/)[1];
  const foot = PO3.match(/aiFoot:'([^']*)'/)[1];
  const band = between(zone, '<ZoneDraft', '/>');
  assert.ok(band.includes('surface="offers/visibility"'), 'the band is on the wrong surface');
  assert.ok(band.includes(`label="${label}"`), `the band's label left the artboard: ${label}`);
  assert.ok(band.includes(`accept="${accept}"`), `the band's accept left the artboard: ${accept}`);
  assert.ok(band.includes(`foot="${foot}"`), `the band's footnote left the artboard: ${foot}`);
});

test('the draft reads this firm’s surfaces, and is told not to model a reach it has no store for', () => {
  const at = spec.indexOf("'offers/visibility': {");
  assert.ok(at > 0, 'the visibility surface is not allow-listed, so the band 400s');
  const entry = between(spec, "'offers/visibility': {", "'network/organizations': {");
  // `partner_surfaces` keys on `partners.id`, not on the account, so a gather
  // that bound `userId` straight into the surface query would read another
  // firm's rows or none at all.
  assert.ok(entry.includes('SELECT partner_id FROM users WHERE id = ?'),
    'the gather no longer resolves the caller’s partner row');
  assert.ok(entry.includes('WHERE s.partner_id = ?'),
    'the gather is no longer scoped to the caller’s own surfaces');
  assert.ok(entry.includes('if (!me?.partner_id) return [];'),
    'an account with no partner row would now read somebody’s surfaces');
  // THE INSTRUCTION CARRIES THE ARTBOARD'S LAST CLAUSE, and it is the one that
  // matters most: a model asked to compare reach will supply a reach.
  assert.match(PO3, /Where a surface has no view counter the read says so instead of modelling one/,
    'the canvas’s instruction for the absent counter has moved');
  assert.ok(entry.includes('say so rather than estimating either, and never rank by reach'),
    'the draft is no longer told to refuse the reach it has no store for');
  // And the rows it reads carry that absence with them, so the model is not left
  // to infer it from the instruction alone.
  assert.ok(entry.includes('no view count and no lead count recorded'),
    'the gathered rows no longer state the two absences');
});

test('StatCard went with the four tiles it drew, and the docblock says so', () => {
  // `check-unused-imports` is CodeQL-backed and reports an imported-but-unused
  // name as an alert.
  //
  // READ OFF `zone`, NOT `zoneRaw`: the note recording the removal sits INSIDE
  // the import braces, so the raw text of the import block still contains the
  // word and a ban on it would fail against correct code — the exact hazard
  // `codeOnly` exists for.
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b/.test(zone.slice(0, at)),
    'StatCard is still imported and nothing uses it');
  assert.ok(zoneRaw.includes('`StatCard` went with the four tiles it drew'),
    'the removal is no longer recorded, so the next reader re-adds it');
  // `VisTile` is what replaced it, and the reason is a rendering one: `Not
  // recorded` has to be a chip rather than an em dash a reader takes for zero.
  assert.match(zoneRaw, /function VisTile\(\{ label, value, note, nr = false \}\)/,
    'the tile that can draw an absence is gone');
  assert.match(zoneRaw, /\{nr \? <NotRecorded \/> : \(/, 'the tile no longer draws the absence as a chip');
});
