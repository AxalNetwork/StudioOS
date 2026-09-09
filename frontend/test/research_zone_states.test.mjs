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
import { RESEARCH_STORE_GAPS } from '../src/workspaces/noStoreCopy.js';

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
  // `unbuiltFrom` turns into gap cards. A zone in either renders `NoStoreYet`
  // INSTEAD of its body, and the sentence it renders is about the store not
  // existing. None of these three may enter that path — that is the line this
  // file has always drawn, and `RESEARCH_STORE_GAPS` (below) is deliberately
  // not it: that object renders ABOVE a body the zone keeps.
  const copy = codeOnly(read('frontend/src/workspaces/noStoreCopy.js'));
  for (const word of ['MARKETS', 'COMPANIES', 'ASK']) {
    assert.doesNotMatch(copy, new RegExp(`RESEARCH_${word}_COPY`),
      `a no-store card was written for ${word}, which reads a live store`);
  }
  // And the map `unbuiltFrom` reads must stay empty of them. A zone landing in
  // ZONE_COPY loses its body entirely — the one outcome the row counts forbid.
  // Brace-balanced, not a regex. `const ZONE_COPY = {};` is one line and a
  // lazy `[\s\S]*?` up to the next `\n};` runs straight past it into the
  // close of `ZONE_BLURB` twenty lines below — which reported the blurb map's
  // contents as ZONE_COPY's and failed on correct code.
  const at = WORKSPACE.indexOf('const ZONE_COPY = {');
  assert.ok(at >= 0, 'ZONE_COPY is gone — recheck how an unbacked zone is declared');
  let depth = 0;
  let inner = '';
  for (let i = WORKSPACE.indexOf('{', at); i < WORKSPACE.length; i += 1) {
    const ch = WORKSPACE[i];
    if (ch === '{') { depth += 1; if (depth === 1) continue; }
    else if (ch === '}') { depth -= 1; if (depth === 0) break; }
    inner += ch;
  }
  assert.equal(inner.trim(), '',
    'ZONE_COPY gained an entry; a zone in it renders NoStoreYet instead of its body');
});

test('all three record what they ARE blocked on, where a reader can see it', () => {
  // THE OTHER HALF OF THE SAME HONESTY, and the half that was missing. Each of
  // these zones serves a real feed and each has a canvas-specified capability
  // with no store behind it — recorded until now only in `founderZoneFilters.js`,
  // which no customer opens. Saying nothing there leaves a reader comparing the
  // artboard to the page with missing controls and no reason given.
  for (const slug of ['markets', 'companies', 'ask']) {
    const gap = RESEARCH_STORE_GAPS[slug];
    assert.ok(gap, `${slug} records no store gap`);
    for (const field of ['eyebrow', 'blocks', 'heading', 'what', 'why']) {
      assert.ok(typeof gap[field] === 'string' && gap[field].length > 0,
        `${slug}'s gap has no ${field}`);
    }
    // The eyebrow may NOT be the component's default. "No store behind this
    // yet" over a zone that reads one is the false sentence this whole file
    // exists to keep off the page — and it is what you get by forgetting the
    // prop, which is why it is asserted rather than assumed.
    assert.notEqual(gap.eyebrow, 'No store behind this yet',
      `${slug} would render the whole-zone sentence over a zone that reads a store`);
  }
  // THE MIRROR, and it belongs here because this feature is what put a default
  // behind that prop. Every caller that renders `NoStoreYet` INSTEAD of a body
  // — advisor Expertise, Network Organizations, Research Client prep — passes
  // no eyebrow and is correct to say the whole-zone sentence. Deleting the
  // default empties the label on all of them at once, and no test covered it:
  // the two that match that string read pages which hardcode it themselves.
  const component = read('frontend/src/workspaces/NoStoreYet.jsx');
  assert.match(component, /eyebrow = 'No store behind this yet',/,
    'NoStoreYet lost its default eyebrow, so every whole-zone gap card now renders a blank label');
});

test('the recorded gap cannot drift from the filter table that found it', () => {
  // One absence, two audiences: `founderZoneFilters.js` states it for whoever
  // maintains the header row, and `RESEARCH_STORE_GAPS` states it for whoever
  // reads the page. They are separate strings in separate files, so the only
  // thing stopping them parting company is this assertion. The phrase per zone
  // is the load-bearing noun of the absence, not a whole sentence — a reworded
  // explanation should pass, a differently-scoped one should not.
  const filters = codeOnly(read('frontend/src/workspaces/founderZoneFilters.js'));
  const SHARED = {
    markets: 'deep-dive',
    companies: 'direct or adjacent',
    ask: 'no past question, kept answer or discarded one',
  };
  for (const [slug, phrase] of Object.entries(SHARED)) {
    assert.ok(filters.includes(phrase),
      `the filter table no longer says "${phrase}" for ${slug}`);
    assert.ok(RESEARCH_STORE_GAPS[slug].why.includes(phrase),
      `${slug}'s page copy no longer says "${phrase}", so the two records have drifted`);
  }
});

test('the gap renders above the body, and the rail reports it too', () => {
  // Above, never instead. `{body}` has to survive: dropping it is how "record
  // the gap" turns into "delete the feed", which for markets would take the
  // largest store in the product off the screen.
  assert.match(WORKSPACE, /const storeGap = !isRoot && slug \? RESEARCH_STORE_GAPS\[slug\] : null;/,
    'the per-zone gap lookup is gone');
  // ANCHORED TO THE BRACE. `/storeGap && \(/` alone still matches
  // `{false && storeGap && (`, so a guard that switches the whole block off
  // passed this — found by mutation. Requiring `storeGap` to be the FIRST
  // operand after the brace is what makes a disabling conjunct fail.
  assert.match(WORKSPACE, /\{storeGap && \(/, 'the gap is no longer rendered unconditionally');
  assert.match(WORKSPACE, /eyebrow=\{storeGap\.eyebrow\}/,
    'the gap renders without its own eyebrow, so it claims the zone has no store at all');
  assert.match(WORKSPACE, /\{body\}/, 'the live body is no longer rendered beneath the gap');
  // The rail's stated stance is "which zones have a store behind them", so a
  // zone blocked on one belongs in its report. One object feeds both surfaces,
  // so the rail cannot be gentler than the page.
  assert.match(WORKSPACE, /storeGap \? \[\[`No \$\{storeGap\.blocks\}`, storeGap\.why\]\] : \[\]/,
    'the rail no longer reports the zone as blocked on a store');
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
