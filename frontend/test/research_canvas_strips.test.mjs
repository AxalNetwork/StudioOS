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

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));
const signals = read('frontend/src/pages/SignalsPage.jsx');
const companies = read('frontend/src/components/CompetitorAnalysis.jsx');

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

test('markets’ two sourced tiles read the bands and its two gaps say so', () => {
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
  // The two gaps are rendered from the table, so the ban belongs on the table:
  // neither may acquire a value, which is the only way a figure gets modelled.
  const table = signals.slice(signals.indexOf('const MARKETS_STRIP = {'));
  const gaps = [...table.matchAll(/\{ label: '([^']+)', note: '/g)].map((m) => m[1]);
  assert.deepEqual(gaps,
    ['Sectors covered', 'Net revenue retention', 'Widest range', 'Retainer rate'],
    'the four stated gaps are no longer the artboards’ own third and fourth tiles');
  assert.match(strip, /<Stat key=\{g\.label\} label=\{g\.label\} value="Not recorded" mono=\{false\} note=\{g\.note\} \/>/,
    'a gap tile must render the words "Not recorded", never a figure');
});

test('founder and investor get markets’ absence once, naming what they lose', () => {
  const limit = signals.slice(signals.indexOf('{embedded && !strip && ('), signals.indexOf('{/* KPI strip */}'));
  assert.ok(limit.length > 0 && limit.length < 1400, 'the stated-limit slice must not run away');
  assert.match(limit, /saved deep-dive/, 'the sentence must name the one object all eight tiles are downstream of');
  assert.match(limit, /instrument card/i,
    'the artboards also ask for a table of analyses; the sentence stands in for that too');
  // And no second strip is drawn for them: `<Stat` appears only inside the
  // advisor/partner branch above.
  const after = signals.slice(signals.indexOf('{embedded && !strip && ('));
  assert.doesNotMatch(after, /<Stat\s/,
    'founder and investor must reach no stat tile on this zone');
});

// ── Companies ─────────────────────────────────────────────────────────────

test('companies draws its strip on founder only, and only on the zone route', () => {
  assert.match(companies, /const COMPANIES_STRIP_LICENCES = new Set\(\['founder'\]\);/,
    'the licence set that gates the Companies strip is gone or has changed shape');
  // `chromeless` is the zone route. `/build/competitors` mounts this page bare
  // and `ProjectDetail` mounts it `embedded`; neither canvas asked for a strip.
  assert.match(companies, /const zoneCanvas = chromeless;/,
    'the strip must be gated on the zone route, not on `embedded` or `bare`');
  assert.equal((companies.match(/COMPANIES_STRIP_LICENCES\.has\(role\)/g) || []).length, 2,
    'exactly two branches read the set: the strip and the sentence that replaces it');
});

test('companies counts analyses under a label that says analyses', () => {
  // THE LEVEL MISMATCH, WHICH IS THE WHOLE POINT OF THIS ZONE'S TREATMENT. The
  // artboard's `Tracked` means a company; `competitor_analyses` is keyed on
  // `user_id` and names no company, and one analysis covers several. Counting
  // analyses under the canvas's word would report the wrong number under the
  // right label — so the label moves, the way `Year` became `Added` on Library.
  const strip = companies.slice(companies.indexOf('{zoneCanvas && COMPANIES_STRIP_LICENCES.has(role) && ('));
  const tiles = tilesIn(strip.slice(0, strip.indexOf('{zoneCanvas && !COMPANIES_STRIP_LICENCES')));
  assert.deepEqual(
    Object.keys(tiles),
    ['Saved analyses', 'Changed this month', 'Comparables', 'Last refreshed'],
    'the strip is no longer four tiles with the first relabelled to what the store holds',
  );
  assert.ok(!strip.includes('label="Tracked"'),
    '`Tracked` counts companies and this row is an analysis — the label must not come back');
  assert.match(tiles['Saved analyses'], /value=\{visibleSaved\.length\}/,
    'the analyses tile no longer counts the analyses actually loaded');
  for (const label of ['Changed this month', 'Comparables']) {
    assert.match(tiles[label], /value="Not recorded"/,
      `${label} has no source at this level and must say "Not recorded"`);
    assert.doesNotMatch(tiles[label], /value=\{/,
      `${label} has no source, so any expression in its value is a modelled figure`);
  }
});

test('“Last refreshed” reads a real timestamp and says so when there is none', () => {
  // Zero saved analyses must not render the epoch. `reduce` starts at 0, so the
  // falsy check is what stands between an empty account and "1970-01-01".
  assert.match(companies, /const lastRefreshed = visibleSaved\.reduce\(/,
    'the refresh date must be derived from the saved rows');
  assert.match(companies, /Date\.parse\(`\$\{a\.updated_at\}Z`\)/,
    'these timestamps carry no zone and must be read as UTC, as the saved list already does');
  const strip = companies.slice(companies.indexOf('{zoneCanvas && COMPANIES_STRIP_LICENCES.has(role) && ('));
  const tiles = tilesIn(strip.slice(0, strip.indexOf('{zoneCanvas && !COMPANIES_STRIP_LICENCES')));
  assert.match(tiles['Last refreshed'], /lastRefreshed \? new Date\(lastRefreshed\)/,
    'the tile must render a date only when one exists');
  assert.match(tiles['Last refreshed'], /: 'Not recorded'/,
    'an account with nothing saved must read "Not recorded", never the epoch');
});

test('advisor gets companies’ absence once, and reaches no tile', () => {
  const limit = companies.slice(companies.indexOf('{zoneCanvas && !COMPANIES_STRIP_LICENCES'));
  const body = limit.slice(0, limit.indexOf('</StatedLimit>'));
  assert.ok(body.length > 0 && body.length < 1400, 'the stated-limit slice must not run away');
  // NAMES ITS FOUR TILES, not the missing thing in one word. A bare
  // `/relationship/i` passed a rewrite that dropped three of the four labels,
  // because the word survived elsewhere in the paragraph — the same "literal
  // present for an unrelated reason" trap the header of this file warns about,
  // met from the other side. If a company register ever lands, this sentence is
  // what has to change, so it names what it is standing in for.
  for (const label of ['Relationships', 'Researching', 'Prospects', 'Headcounts missing']) {
    assert.ok(body.includes(label),
      `the sentence must name "${label}" — it is standing in for that tile`);
  }
  assert.match(body, /names no company/,
    'the sentence must say why: an analysis names no company');
  assert.doesNotMatch(body, /<Stat\s/, 'the advisor branch must draw no tile');
});
