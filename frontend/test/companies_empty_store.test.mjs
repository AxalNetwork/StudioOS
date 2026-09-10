/**
 * `/research/companies` — empty is a fact about the store, not a blank screen.
 *
 * WHY THIS ZONE AND NOT ANOTHER. An audit measured the three Research zones a
 * request asked to record as "blocked on a store" and found the opposite: all
 * three are live over real D1 tables (Markets holds 196,956 rows). Two of them
 * — Companies and Ask — held **zero** rows, which the record called "empty,
 * not unbuilt: a different fact with a different fix". Ask already had its
 * first-run state (`AskZone.jsx`, the card pointing at the library). Companies
 * had none at all, and that is what this file guards.
 *
 * WHAT WAS ACTUALLY BROKEN, and it was worse than a missing empty state:
 *
 *   · `api.competitors.list().catch(() => ({ analyses: [] }))` at BOTH await
 *     sites. A server error became an empty list.
 *   · the saved-analyses card rendered under `{visibleSaved.length > 0 && …}`,
 *     so an empty list rendered NOTHING.
 *
 * Together those made a failed read, a still-loading page and a genuinely
 * empty store the identical screen — blank — with a `Saved analyses 0` tile
 * above it stating the reader has run none, which is a claim the page could
 * not actually support. Four states now, and the tile withholds its figure
 * until the list has answered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SRC = 'frontend/src/components/CompetitorAnalysis.jsx';
const rawSrc = raw(SRC);
const src = codeOnly(rawSrc);

test('a failed list read is never turned into an empty list', () => {
  // The bug, in one line, at two call sites. Either one left behind puts the
  // page back to reporting a server error as "you have run nothing".
  assert.doesNotMatch(src, /competitors\.list\(\)\.catch\(\(\) => \(\{ analyses: \[\] \}\)\)/,
    'a competitors.list() failure is being swallowed into an empty list again');
  assert.doesNotMatch(src, /competitors\.list\(\)\.catch\(\(\) => null\)/,
    'a competitors.list() failure is being swallowed into null again');
  const calls = [...src.matchAll(/api\.competitors\.list\(\)\.catch\(\(\) => ([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3, `expected every competitors.list() call to carry a catch; found ${calls.length}`);
  for (const handler of calls) {
    assert.equal(handler, 'READ_FAILED',
      `a competitors.list() call catches into ${handler} instead of the shared sentinel`);
  }
  assert.match(src, /const READ_FAILED = Symbol\(/, 'the sentinel is gone');
});

test('loading, failed, empty and populated are four different screens', () => {
  const states = [...src.matchAll(/savedState === '(\w+)'/g)].map((m) => m[1]);
  for (const s of ['failed', 'ready']) {
    assert.ok(states.includes(s), `nothing renders on savedState '${s}'`);
  }
  assert.match(src, /useState\('loading'\)/, 'the list no longer starts in a loading state');
  // The three gated blocks, each with its own condition — and crucially the
  // populated one is no longer the ONLY one.
  assert.match(src, /\{savedState === 'failed' && \(/, 'the failed state has no card');
  assert.match(src, /\{savedState === 'ready' && visibleSaved\.length === 0 && \(/, 'the empty state has no card');
  assert.match(src, /\{savedState === 'ready' && visibleSaved\.length > 0 && \(/,
    'the populated list is not gated on a successful read');
  assert.doesNotMatch(src, /\{visibleSaved\.length > 0 && \(/,
    'the list is back to rendering on length alone, so empty and failed are blank again');
});

test('the failed state says it is the request, and offers the one control that clears it', () => {
  assert.match(rawSrc, /Your saved analyses could not be read\./);
  assert.match(rawSrc, /This is a problem with the request, not with your account/);
  assert.match(src, /onClick=\{reloadSaved\}/, 'the retry button is not wired to the reload');
  assert.match(src, /const reloadSaved = useCallback\(async \(\) => \{/, 'reloadSaved is gone');
  assert.match(src, /setSavedState\('loading'\);\s*\n\s*applySaved\(await api\.competitors\.list\(\)/,
    'retry does not return the card to its loading state before re-reading');
});

test('the empty state says what the store holds and points at what fills it', () => {
  assert.match(rawSrc, /No saved analyses yet\./);
  assert.match(rawSrc, /They are stored against you, so this list stays empty until you run the first one\./);
  assert.match(rawSrc, /Run the first one/);
  // The control is the run form on this same page, not an invented one.
  assert.match(src, /formRef\.current\?\.scrollIntoView\(/, 'the first-run button goes nowhere');
  assert.match(src, /<div ref=\{formRef\} className=\{`\$\{CARD\} p-5 mb-5`\}>/,
    'the run form lost the ref the empty state scrolls to');
});

test('embedded with rows elsewhere is a third sentence, not the first-run one', () => {
  // `visibleSaved` is filtered to one startup when embedded. "You have run
  // none" would be false for someone with ten analyses against other
  // startups, and it is the sentence they would have got.
  assert.match(src, /embedded && saved\.length > 0/, 'the embedded case no longer branches on the unfiltered list');
  assert.match(rawSrc, /No analyses for this startup yet\./);
  assert.match(rawSrc, /Analyses are stored per startup, so this one starts empty\./);
});

test('the tile withholds its figure until the list has answered', () => {
  // A `0` under "Saved analyses" is a claim about the reader. Before the list
  // answers it is a claim about the request, and the two are not the same.
  assert.match(src, /value=\{savedState === 'ready' \? visibleSaved\.length : 'Not recorded'\}/,
    'the tile prints a count it cannot support');
  assert.doesNotMatch(rawSrc, /note=\{`across \$\{visibleSaved\.length === 1 \? 'one run' : 'your runs'\}`\}/,
    'the note describes runs that may not exist');
  assert.match(rawSrc, /nothing run yet/);
  assert.match(rawSrc, /the list could not be read/);
});

test('the capability gap sits above the body, and never replaces it', () => {
  // TWO REGISTRIES, AND THIS ASSERTION FIRST CONFLATED THEM.
  //
  // `RESEARCH_STORE_GAPS` is NOT "this zone has no store". It is the opposite
  // case: a zone with a live store whose CANVAS asks for a capability nothing
  // holds — for `markets` a saved market analysis, for `companies` a
  // comparable and an analysis-level relation. Its own docblock says why both
  // possible shortcuts are wrong: "no store behind this yet" over a 197k-row
  // signals feed is false, and saying nothing leaves a reader comparing the
  // design to the page with four missing controls and no reason.
  //
  // So the invariant is not that these zones are absent from that object — it
  // is that their entry describes a CAPABILITY and the body still renders
  // underneath. A gap card that replaced the body would hide a live feed.
  const copy = raw('frontend/src/workspaces/noStoreCopy.js');
  const gaps = copy.match(/export const RESEARCH_STORE_GAPS = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.ok(gaps.length > 200, 'RESEARCH_STORE_GAPS did not parse');
  const entries = [...gaps.matchAll(/^  (\w+): \{/gm)].map((m) => m[1]);
  assert.deepEqual(entries.sort(), ['companies', 'markets'],
    'the capability-gap registry changed — `ask` left it when migration 221 gave it a store, and whoever closes one of these deletes its entry in the same commit');
  for (const slug of entries) {
    const entry = gaps.slice(gaps.indexOf(`  ${slug}: {`));
    assert.match(entry, /blocks: '/, `${slug} does not name the store it is blocked on`);
  }

  // The body renders regardless — the gap is drawn beside it, not instead.
  const workspace = raw('frontend/src/workspaces/ResearchWorkspace.jsx');
  assert.match(workspace, /const storeGap = !isRoot && slug \? RESEARCH_STORE_GAPS\[slug\] : null;/,
    'the capability gap is no longer looked up separately from the body');
  const live = workspace.match(/const LIVE_ZONES = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  for (const slug of ['companies', 'markets', 'ask']) {
    assert.ok(live.includes(`'${slug}'`),
      `${slug} left LIVE_ZONES — it reads a real store, and an empty one is still a store`);
  }
});
