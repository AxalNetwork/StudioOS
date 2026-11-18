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

const CANVAS = raw('design/canvases/integrated/Pages · Partner Offers.dc.html');
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

// #4843 (D4843): the po3 strip, linkage note and five-column instrument are superseded by the
// Offers v2 board OF-05 (one attribution-first table, Views and Trend as Not measured ⓘ). Their
// rules — no figure for Views or Leads, Engagements the ordering, unattributed rows never shared
// out — are held by `offers_visibility_of05_4843.test.mjs`. The chips, ops, band and draft below
// are unchanged by OF-05 and stay held here.
test('the po3 strip and instrument are gone, replaced by the OF-05 table', () => {
  assert.ok(!zone.includes('<Instrument'), 'the superseded instrument came back');
  assert.ok(!zone.includes('<VisTile'), 'the superseded strip came back');
  assert.ok(zone.includes('data-testid="visibility-sources"'), 'the OF-05 table is gone');
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
  // It used to check `<UnlinkedZone title="Visibility" actions={rowActions} />`
  // — the card that stood INSTEAD of the zone. The row goes to the toolbar the
  // live branch already uses, and the gate is a line above the body.
  assert.match(zone, /actions=\{rowActions\}/,
    'the gate branch no longer draws the same header row as the live one');
  assert.match(zone, /notice=\{unlinked \? <NoPartnerProfile \/> : null\}/,
    'the gate stopped saying why the zone is empty');
  assert.match(zone, /filters=\{unlinked \? \[\] :/,
    'a filter chip is drawn over rows this account cannot read');
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

test('the strip is gone with its tiles: no StatCard or VisTile, and an absence is a NotMeasured, never a zero', () => {
  const at = zone.indexOf("} from '../kit';");
  assert.ok(at > 0, 'the kit import is gone');
  assert.ok(!/\bStatCard\b/.test(zone.slice(0, at)), 'StatCard is imported again and nothing uses it');
  assert.ok(!/function VisTile/.test(zoneRaw), 'the superseded tile came back');
  assert.match(zone, /<NotMeasured why=\{r\.viewsWhy\}/, 'Views no longer draws its absence with the reason');
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
  // It used to check `<UnlinkedZone title="Visibility" actions={rowActions} />`
  // — the card that stood INSTEAD of the zone. The row goes to the toolbar the
  // live branch already uses, and the gate is a line above the body.
  assert.match(zone, /actions=\{rowActions\}/,
    'the gate branch no longer draws the same header row as the live one');
  assert.match(zone, /notice=\{unlinked \? <NoPartnerProfile \/> : null\}/,
    'the gate stopped saying why the zone is empty');
  assert.match(zone, /filters=\{unlinked \? \[\] :/,
    'a filter chip is drawn over rows this account cannot read');
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

