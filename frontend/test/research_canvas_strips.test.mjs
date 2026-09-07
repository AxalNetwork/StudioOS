/**
 * Markets and Companies — the canvas strip each artboard specifies, and the
 * licences that can honestly draw one.
 *
 * D56 states the rule these two zones follow: a zone draws its canvas stat
 * strip when AT LEAST ONE tile in it has a store, with the rest saying "Not
 * recorded" in words; when none does, the absence is one sentence instead of
 * four tiles saying the same thing four times. Ask is guarded in
 * `research_zones.test.mjs`; these are the other two zones that pass C9 closed.
 *
 * PROBE THE RENDERED FORM, NOT THE LITERAL. `codeOnly` deliberately keeps
 * indented `{/* *\/}` comments — a naive stripper once ate half a page — and
 * both files under test name the words they refuse to use, in comments
 * explaining why. Every ban here therefore names a code shape (`label="X"`,
 * `>X<`) that prose cannot produce.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const read = (p) => codeOnly(raw(p));
const signals = read('frontend/src/pages/SignalsPage.jsx');
const companies = read('frontend/src/components/CompetitorAnalysis.jsx');
// The RAW source, for the one thing `codeOnly` deliberately destroys: a tile
// that is no longer drawn keeps its reason in a docblock, and the assertions
// that the reason survived have to read the comments to see it.
const signalsRaw = raw('frontend/src/pages/SignalsPage.jsx');
const companiesRaw = raw('frontend/src/components/CompetitorAnalysis.jsx');

/**
 * A docblock as one line, so a label that wrapped across `*`-prefixed lines is
 * still findable. `Net revenue retention` breaks over two lines at this width,
 * and a raw `includes` on the slice misses it — which is a wrapping accident,
 * not a lost record.
 */
function flat(doc) {
  return doc.replace(/^\s*\*/gm, '').replace(/[`\s]+/g, ' ');
}

/** Each `<Stat …/>` bounded at its OWN `/>`, keyed by label. */
function tilesIn(code, from = 0) {
  return Object.fromEntries(code.slice(from).split(/<Stat\s/).slice(1).map((segment) => {
    const tile = segment.slice(0, segment.indexOf('/>'));
    return [tile.match(/label="([^"]+)"/)?.[1], tile];
  }));
}

// ── Markets ───────────────────────────────────────────────────────────────

test('markets draws its strip on the two licences whose first tile is an age band', () => {
  // Founder's and investor's eight tiles all count a saved deep-dive — an
  // analysis or a thesis kept with its method and run date. Nothing stores one;
  // this page reads a signals feed, which is a different object.
  assert.match(signals, /const MARKETS_STRIP = \{/, 'the per-licence strip table is gone');
  const table = signals.slice(signals.indexOf('const MARKETS_STRIP = {'));
  const licences = [...table.slice(0, table.indexOf('\n};')).matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]);
  assert.deepEqual(licences, ['advisor', 'partner'],
    'only advisor and partner have a tile with a store; adding a licence needs one too');
  // The zone route only. `/signals` is a standalone page whose canvas never
  // asked for this strip, and it must not sprout one.
  assert.match(signals, /const strip = embedded \? MARKETS_STRIP\[role\] : null;/,
    'the strip must be gated on the zone route, not drawn on /signals');
});

test('the age windows are still the artboards’ own numbers', () => {
  // Transcribed, never chosen: `Pages · Advisor Research` declares STALE_AT 120
  // / AGE_AT 30, `Pages · Partner Research` 90 and 30. The tiles count the same
  // bands the header chips filter on, so a moved number moves both silently.
  assert.match(signals, /advisor: \{ ageing: 30, stale: 120 \}/, 'the advisor window has moved off its artboard');
  assert.match(signals, /partner: \{ ageing: 30, stale: 90 \}/, 'the partner window has moved off its artboard');
});

test('the bands count the whole population, never the rows a chip left showing', () => {
  // `visible` is already narrowed by the selected chip, so counting it would
  // make `Current` read zero the moment a reader clicked `Stale`. A tile that
  // changes because you looked at it is not reporting what it claims to.
  assert.match(signals, /const bands = !strip \|\| !window_ \? null : signals\.reduce\(/,
    'the age bands must be counted over the loaded signals, not the filtered view');
  const band = signals.slice(signals.indexOf('const bands ='), signals.indexOf('undated: 0 }'));
  assert.doesNotMatch(band, /\bvisible\b/, 'the band counts must not read the chip-narrowed list');
  assert.match(band, /if \(days === null\) acc\.undated \+= 1;/,
    'an undated signal belongs to no band and must be counted apart, as the chip filter treats it');
});

test('markets draws its two sourced tiles and no unsourced one', () => {
  const strip = signals.slice(signals.indexOf('{strip && bands && ('));
  // The two sourced tiles take their label FROM the licence table, never a
  // literal: `Current` and `Attachable now` count the same band and ask
  // different questions of it, and one hard-coded word would answer the wrong
  // one on one of the two licences.
  assert.match(strip, /label=\{strip\.fresh\.label\}/, 'the fresh tile has been given a literal label');
  assert.match(strip, /label=\{strip\.stale\.label\}/, 'the stale tile has been given a literal label');
  assert.match(strip, /value=\{loading && !data \? undefined : bands\.fresh\}/,
    'the fresh tile no longer counts the fresh band');
  assert.match(strip, /value=\{loading && !data \? undefined : bands\.stale\}/,
    'the stale tile no longer counts the stale band');

  // REVERSED, DELIBERATELY. The artboards' third and fourth tiles — `Sectors
  // covered`, `Net revenue retention`, `Widest range`, `Retainer rate` — used
  // to be rendered from a `gaps` array, each reading the words "Not recorded"
  // with its reason beneath. This test REQUIRED that. Refusing to model a
  // figure nobody stores was right and has not changed; printing the refusal
  // where the figure belongs put commentary about the design on the page.
  // They are not drawn, and the table's own docblock carries the four reasons.
  const table = signals.slice(signals.indexOf('const MARKETS_STRIP = {'));
  const decl = table.slice(0, table.indexOf('\n};'));
  assert.doesNotMatch(decl, /gaps:/, 'the gaps array is back in the strip table');
  assert.doesNotMatch(strip, /Not recorded/, 'a tile states its own absence again');
  // The reasons still have to be recorded somewhere a builder reads.
  const doc = signalsRaw.slice(signalsRaw.indexOf('* The two strip tiles per licence'),
    signalsRaw.indexOf('const MARKETS_STRIP = {'));
  assert.ok(doc.length > 0 && doc.length < 1600, 'the docblock slice must not run away');
  for (const label of ['Sectors covered', 'Net revenue retention', 'Widest range', 'Retainer rate']) {
    assert.ok(flat(doc).includes(label), `the record of why "${label}" is absent has been lost`);
  }
});

test('founder and investor reach no markets tile and no paragraph about one', () => {
  // ALSO REVERSED. This required a `<StatedLimit>` naming the saved deep-dive
  // and the instrument card the artboards ask for. Saying an absence once beat
  // saying it four times; not saying it on the customer surface beats both.
  const after = signals.slice(signals.indexOf('{strip && bands && ('));
  assert.doesNotMatch(after, /<StatedLimit/, 'the canvas-narration panel is back');
  assert.doesNotMatch(signals, /import \{ StatedLimit \}/, 'the narration component is imported again');
  // And no second strip is drawn for them: `<Stat` appears only inside the
  // advisor/partner branch above.
  const tail = after.slice(after.indexOf('{/* KPI strip */}'));
  assert.doesNotMatch(tail, /<Stat\s/, 'founder and investor must reach no stat tile on this zone');
});

// ── Companies ─────────────────────────────────────────────────────────────

test('companies draws its strip on founder only, and only on the zone route', () => {
  assert.match(companies, /const COMPANIES_STRIP_LICENCES = new Set\(\['founder'\]\);/,
    'the licence set that gates the Companies strip is gone or has changed shape');
  // `chromeless` is the zone route. `/build/competitors` mounts this page bare
  // and `ProjectDetail` mounts it `embedded`; neither canvas asked for a strip.
  assert.match(companies, /const zoneCanvas = chromeless;/,
    'the strip must be gated on the zone route, not on `embedded` or `bare`');
  // ONE branch now, not two. The second read the same set to draw a paragraph
  // for advisor explaining the canvas; advisor simply gets no strip.
  assert.equal((companies.match(/COMPANIES_STRIP_LICENCES\.has\(role\)/g) || []).length, 1,
    'a second branch reads the set again — the advisor narration is back');
});

test('companies counts analyses under a label that says analyses', () => {
  // THE LEVEL MISMATCH, WHICH IS THE WHOLE POINT OF THIS ZONE'S TREATMENT. The
  // artboard's `Tracked` means a company; `competitor_analyses` is keyed on
  // `user_id` and names no company, and one analysis covers several. Counting
  // analyses under the canvas's word would report the wrong number under the
  // right label — so the label moves, the way `Year` became `Added` on Library.
  const strip = companies.slice(companies.indexOf('{zoneCanvas && COMPANIES_STRIP_LICENCES.has(role) && ('));
  const tiles = tilesIn(strip.slice(0, strip.indexOf('{!bare && (')));
  // `Changed this month` and `Comparables` are GONE, not "Not recorded".
  assert.deepEqual(Object.keys(tiles), ['Saved analyses', 'Last refreshed'],
    'the strip draws a tile the store cannot fill, or has lost one it can');
  assert.ok(!strip.includes('label="Tracked"'),
    '`Tracked` counts companies and this row is an analysis — the label must not come back');
  assert.match(tiles['Saved analyses'], /value=\{visibleSaved\.length\}/,
    'the analyses tile no longer counts the analyses actually loaded');
  assert.doesNotMatch(strip, /Not recorded/, 'a tile states its own absence again');
  for (const label of ['Changed this month', 'Comparables']) {
    assert.ok(!strip.includes(`label="${label}"`), `${label} has no source and is drawn anyway`);
  }
});

test('“Last refreshed” is drawn only when a real timestamp exists', () => {
  // Zero saved analyses must not render the epoch. `reduce` starts at 0, and
  // that falsy check used to pick the string "Not recorded"; now it decides
  // whether the tile is rendered at all — an empty account gets one tile, not
  // a second one announcing that it has nothing.
  assert.match(companies, /const lastRefreshed = visibleSaved\.reduce\(/,
    'the refresh date must be derived from the saved rows');
  assert.match(companies, /Date\.parse\(`\$\{a\.updated_at\}Z`\)/,
    'these timestamps carry no zone and must be read as UTC, as the saved list already does');
  const strip = companies.slice(companies.indexOf('{zoneCanvas && COMPANIES_STRIP_LICENCES.has(role) && ('));
  const block = strip.slice(0, strip.indexOf('{!bare && ('));
  assert.match(block, /\{lastRefreshed > 0 && \(/,
    'the tile renders without first proving a timestamp exists — the epoch would ship');
  assert.match(block, /value=\{new Date\(lastRefreshed\)\.toISOString\(\)\.slice\(0, 10\)\}/,
    'the tile no longer renders the derived date');
});

test('advisor reaches no companies tile and no paragraph about one', () => {
  // REVERSED. This required a `<StatedLimit>` naming `Relationships`,
  // `Researching`, `Prospects` and `Headcounts missing`. The component's own
  // docblock still names all four and says why none can be drawn; the customer
  // surface no longer does.
  assert.doesNotMatch(companies, /<StatedLimit/, 'the canvas-narration panel is back');
  assert.doesNotMatch(companies, /import \{ StatedLimit \}/, 'the narration component is imported again');
  const doc = companiesRaw.slice(0, companiesRaw.indexOf('const COMPANIES_STRIP_LICENCES'));
  for (const label of ['Relationships', 'Researching', 'Prospects', 'Headcounts missing']) {
    assert.ok(flat(doc).includes(label), `the record of why "${label}" is absent has been lost`);
  }
  assert.match(doc, /nothing here stores a relationship or a company/,
    'the docblock must still say why: an analysis names no company');
});
