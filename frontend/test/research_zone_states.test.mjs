/**
 * Markets, Ask and Companies are LIVE. Empty is not unbuilt.
 *
 * WHY THIS FILE EXISTS. Asked to record the three Research zones as "blocked on
 * a store", the check found the opposite: all three sit inside
 * `ResearchWorkspace`'s `LIVE_ZONES`, each reads a real worker route over a real
 * D1 table. Measured against production on 2026-09-08:
 *
 *   Markets    signals.ts     -> signals 10, market_intel_rows 196,956
 *   Companies  competitors.ts -> competitor_analyses 0
 *   Ask        research.ts    -> research_documents 0
 *
 * So Companies and Ask are EMPTY, not unbuilt — a different fact with a
 * different fix — and Markets is genuinely populated. `NoStoreYet` renders "No
 * store behind this yet"; putting that over a live signals feed would be a false
 * sentence on the page, not merely a stale note in a doc.
 *
 * IT HAS HAPPENED BEFORE, WHICH IS THE ARGUMENT FOR A TEST RATHER THAN A NOTE.
 * `ROUTE_MAP.md:133` records a version of that document saying Ask and Library
 * "remain unbuilt" AFTER they shipped — read as written, it would have sent
 * someone to rebuild a shipped feature in the wrong place.
 *
 * WHAT WAS ACTUALLY WRONG was one layer up: `FounderResearchDesk` printed
 * "Source unavailable" whenever a key was absent from `records`, and a key is
 * absent BOTH while the request is in flight AND after it fails. A healthy page
 * said it on every card until the fetch resolved, and a store holding 196,956
 * rows said it too. Three states, three sentences.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WORKSPACE = codeOnly(read('frontend/src/workspaces/ResearchWorkspace.jsx'));
const DESK = codeOnly(read('frontend/src/pages/founder/FounderResearchDesk.jsx'));

test('markets, ask and companies stay inside LIVE_ZONES', () => {
  const live = WORKSPACE.match(/const LIVE_ZONES = new Set\(\[([^\]]*)\]\)/)?.[1] || '';
  assert.ok(live.length > 0, 'LIVE_ZONES is gone — recheck what this workspace serves');
  for (const slug of ['markets', 'companies', 'ask']) {
    assert.match(live, new RegExp(`'${slug}'`),
      `${slug} left LIVE_ZONES. It reads a real store; removing it puts "No store behind `
      + 'this yet" over a live feed. Check the store before recording the gap.');
  }
});

test('none of the three is registered as a zone with no store', () => {
  // `noStoreCopy.js` is the registry for UNBUILT zones, and `ZONE_COPY` is what
  // `unbuiltFrom` turns into gap cards. An empty store does not belong in
  // either: the sentence they render is about the store not existing.
  const copy = codeOnly(read('frontend/src/workspaces/noStoreCopy.js'));
  for (const word of ['MARKETS', 'COMPANIES', 'ASK']) {
    assert.doesNotMatch(copy, new RegExp(`RESEARCH_${word}_COPY`),
      `a no-store card was written for ${word}, which reads a live store`);
  }
});

test('the desk tells loading, failed and empty apart', () => {
  // The three-state helper. Before it, every card printed "Source unavailable"
  // while the request was still in flight.
  assert.match(DESK, /const sourceMeta = \(key, whenLoaded\)/,
    'the three-state helper is gone');
  assert.match(DESK, /if \(Object\.hasOwn\(records, key\)\) return whenLoaded;/,
    'a loaded source must report what it loaded, including zero');
  assert.match(DESK, /if \(failedKeys\.has\(key\)\) return 'Source unavailable';/,
    'only a source that actually failed may say it is unavailable');
  assert.match(DESK, /return 'Loading/, 'and an in-flight source says so');
});

test('"Source unavailable" is never reachable from a bare absence again', () => {
  // The shape this replaced: `xLoaded ? … : 'Source unavailable'`, where
  // `xLoaded` is only `Object.hasOwn(records, x)`. Any ternary that falls
  // straight from a Loaded flag to the unavailable string is the old bug.
  const offenders = [...DESK.matchAll(/(\w+Loaded)\s*\?[^:]*:\s*'Source unavailable'/g)]
    .map((m) => m[1]);
  assert.deepEqual(offenders, [],
    'these fall from "not loaded" straight to "Source unavailable", which also '
    + `covers "still loading": ${offenders.join(', ')}. Use sourceMeta().`);
});

test('which sources failed is tracked, not just that some did', () => {
  // `failed` existed and only ever set one page-wide banner, so no card could
  // tell whether ITS source was the one that broke.
  assert.match(DESK, /setFailedKeys\(new Set\(failed\)\)/,
    'the failed keys must reach state, not just the banner');
  assert.match(DESK, /const \[failedKeys, setFailedKeys\]/, 'and be held there');
  // A retry that succeeds must clear the flag, or the card lies in the other
  // direction — permanently unavailable after one transient failure.
  assert.match(DESK, /next\.delete\('documents'\)/,
    'a later success must clear the failure it recovered from');
});

test('an empty store reports zero rather than blaming the connection', () => {
  // The distinction the whole task turned on: Companies and Ask hold zero rows
  // on production today, and zero is a fact about the store.
  assert.match(DESK, /sourceMeta\('companies', `\$\{data\.companies\.length\} returned`\)/,
    'the companies card must quote its count, zero included');
  assert.doesNotMatch(DESK, /No stored market evidence is available/,
    'the brief fallback still blames the source for an empty store');
});
