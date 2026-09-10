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
//
// THE ZONE MOVED, AND THAT IS WHAT THIS BLOCK NOW RECORDS. Its four tests read
// `SignalsPage`'s `MARKETS_STRIP` — the two age-band tiles drawn over the
// `market_intel_rows` sector feed when `/research/markets` mounted it embedded.
// The `pr3` artboard is about a different object: comparable RANGES for the
// firm's own service lines, each attachable to a proposal. A sector signal is
// not a price. So the zone mounts `pages/research/MarketZone`, the feed keeps
// `/signals` with no zone header at all, and the machinery that bridged them is
// gone from `SignalsPage`.
//
// EVERY RULE THOSE FOUR TESTS HELD IS STILL HELD, one file over, and each is
// worth more on the new page than it was on the old one:
//   · the windows are the artboard's own numbers, transcribed and not chosen;
//   · age is never read off `updated_at`;
//   · a tile counts the whole population and never the chip-narrowed list;
//   · a tile with no store is not drawn.

const market = read('frontend/src/pages/research/MarketZone.jsx');

test('the age windows are still the artboard’s own numbers', () => {
  // `Pages · Partner Research` declares `const STALE_AT = 90, AGE_AT = 30`.
  // Transcribed, never chosen — and now exported, because the guard below and
  // the zone's own copy would otherwise be two numbers that can part company.
  assert.match(market, /export const STALE_AT = 90;/, 'the stale window has moved off its artboard');
  assert.match(market, /export const AGE_AT = 30;/, 'the ageing window has moved off its artboard');
});

test('age comes from the run date and never from a touched-at column', () => {
  // `updated_at` moves when a row is edited, so every reading would look
  // current the moment anyone touched one — the same trap the signals feed had
  // with its ingestion timestamp, where one run stamped every row it saw.
  assert.match(market, /const daysSince = \(iso\) => \{/, 'the age helper is gone');
  assert.match(market, /daysSince\(r\.ran_at\)/, 'age is no longer computed from the run date');
  assert.doesNotMatch(codeOnly(market), /updated_at/, 'age is being read off a touched-at column');
});

test('a reading that has never been run is its own answer, not a stale one', () => {
  // NULL DOES NOT FALL INTO `stale`. A service line nobody has priced the
  // market for has not gone out of date — there is nothing to have aged — and
  // bucketing it as stale would tell a firm to re-run a reading it has never
  // run once.
  assert.match(market, /if \(days === null\) return null;/,
    'a never-run reading is being sorted into an age band');
  const band = market.slice(market.indexOf('export function ageBand('), market.indexOf('const BAND_PILL'));
  assert.match(band, /if \(days > STALE_AT\) return 'stale';/, 'the stale band no longer uses the artboard’s window');
  assert.match(band, /if \(days > AGE_AT\) return 'ageing';/, 'the ageing band no longer uses the artboard’s window');
});

test('the tiles count every reading, never the rows a chip left showing', () => {
  // `visible` is already narrowed by the selected chip, so counting it would
  // make `Attachable now` read zero the moment a reader clicked `Stale`. A tile
  // that changes because you looked at it is not reporting what it claims to.
  const code = codeOnly(market);
  const tiles = code.slice(code.indexOf('const attachable = rows.filter('), code.indexOf('const openForm ='));
  assert.ok(tiles.length > 0, 'the tile counts are gone');
  assert.doesNotMatch(tiles, /\bvisible\b/, 'the tile counts read the chip-narrowed list');
  assert.match(tiles, /const stale = rows\.filter\(\(r\) => r\.band === 'stale'\);/,
    'the stale tile no longer counts the stale band');
  assert.match(tiles, /const neverRun = rows\.filter\(\(r\) => r\.band === null\);/,
    'the never-run tile no longer counts the readings with no run date');
});

test('age gates attachment rather than labelling it', () => {
  // The artboard's own subtitle, and the whole composition: a stale reading is
  // BLOCKED from a proposal, not marked. "A client shown a range from May,
  // presented as current reasoning behind a September quote, is a worse outcome
  // than a proposal with no market figure at all."
  const code = codeOnly(market);
  assert.match(code, /stale: 'Blocked from proposals'/,
    'a stale reading is labelled rather than blocked');
  assert.match(code, /text: 'Re-run before attaching'/,
    'the attachment column no longer says what to do about a stale reading');
  // THREE OUTCOMES, NOT TWO. "Nothing to attach" is not a weaker "blocked":
  // one is a reading that went out of date and one is a service line nobody
  // has ever priced.
  assert.match(code, /text: 'Nothing to attach'/,
    'a never-run reading reads as blocked instead of as never run');
});

test('the signals feed keeps its own page and loses the zone header', () => {
  // The machinery that drew a zone header over the feed is gone with the mount
  // that used it, rather than left behind looking maintained.
  const sig = codeOnly(read('frontend/src/pages/SignalsPage.jsx'));
  for (const gone of ['MARKETS_STRIP', 'AGE_WINDOWS', 'function ageInDays', 'zoneActions', 'zoneFilters']) {
    assert.ok(!sig.includes(gone), `SignalsPage still carries ${gone}, for a mount that no longer exists`);
  }
  // And the reason survives where a reader will look for it.
  assert.match(signalsRaw, /THE ZONE-HEADER MACHINERY THAT STOOD HERE IS GONE/,
    'the record of why the strip left this page has been deleted with it');
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
  // THE TILE WITHHOLDS ITS FIGURE UNTIL THE LIST HAS ANSWERED. This assertion
  // read `value={visibleSaved.length}` until 2026-09-10, which was true of the
  // code and false of the screen: BOTH `api.competitors.list()` call sites
  // caught a failed read into `{ analyses: [] }`, so a 500 rendered
  // `Saved analyses 0` — the reader told they had run nothing when the server
  // had simply not answered. The rule did not change, the code did; the
  // replacement is strictly stronger, because the old one permitted the zero.
  assert.match(tiles['Saved analyses'],
    /value=\{savedState === 'ready' \? visibleSaved\.length : 'Not recorded'\}/,
    'the analyses tile reports a figure before the list has answered');
  // ...and never bare (D68). Both non-ready states say WHICH one they are:
  // "could not be read" and "still reading" are different facts, and only one
  // of them is worth waiting on.
  for (const state of ['failed', 'loading']) {
    assert.match(tiles['Saved analyses'], new RegExp(`savedState === '${state}' \\?`),
      `the tile does not say why it is withholding the count while ${state}`);
  }
  // The two tiles whose STORE does not exist stay UNDRAWN — a product gap is
  // not the reader's missing fact and cannot borrow its wording (D56/D68).
  // That is what the old blanket ban on the phrase in this strip protected;
  // it is pinned per tile now, since one tile legitimately uses it above.
  assert.deepEqual(Object.keys(tiles).filter((k) => tiles[k].includes('Not recorded')),
    ['Saved analyses'],
    'a tile with no store states its own absence instead of staying undrawn');
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
