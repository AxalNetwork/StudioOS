/**
 * Advisor bucket roots render overviews, not the first zone.
 *
 * The canvas specifies a landing page for each bucket — Practice, Expertise,
 * Network, Research — and the sidebar row must open that overview, not jump
 * straight to the first zone. This test pins the routing and the overview
 * bodies so a later change cannot quietly restore the old redirects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const bucketRoutes = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
const networkWs = read('frontend/src/workspaces/NetworkWorkspace.jsx');
const researchWs = read('frontend/src/workspaces/ResearchWorkspace.jsx');
const shell = read('frontend/src/workspaces/WorkspaceShell.jsx');

test('Practice root is a route, not a redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/practice"'));
  assert.ok(line, '/practice has no route');
  assert.doesNotMatch(line, /Navigate to="\/practice\//, '/practice must not redirect to a zone');
  assert.match(line, /AdvisorBucketRoutes/, '/practice must render the bucket shell');
});

test('Expertise root is a route, not a redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/expertise"'));
  assert.ok(line, '/expertise has no route');
  assert.doesNotMatch(line, /Navigate to="\/expertise\//, '/expertise must not redirect to a zone');
  assert.match(line, /AdvisorBucketRoutes/, '/expertise must render the bucket shell');
});

test('Cohorts root is a route, not a redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/cohorts"'));
  assert.ok(line, '/cohorts has no route');
  assert.doesNotMatch(line, /Navigate to="\/cohorts\//, '/cohorts must not redirect to a zone');
  assert.match(line, /AdvisorBucketRoutes/, '/cohorts must render the bucket shell');
});

test('bucket roots render an overview grid, not a zone body', () => {
  const code = codeOnly(bucketRoutes);
  assert.match(code, /isRoot &&/, 'AdvisorBucketRoutes must detect the bucket root');
  assert.match(code, /<BucketOverview bucket=\{bucket\} \/>/, 'the root must render the overview');
  assert.match(code, /bucket\.zones\.map/, 'the overview must list every zone');
});

test('Network root renders an overview for advisors', () => {
  const code = codeOnly(networkWs);
  assert.match(code, /isRoot/, 'NetworkWorkspace must detect the bucket root');
  assert.match(code, /<NetworkOverview/, 'the root must render the overview');
});

test('Research root renders an overview for advisors', () => {
  const code = codeOnly(researchWs);
  assert.match(code, /isRoot/, 'ResearchWorkspace must detect the bucket root');
  assert.match(code, /<ResearchOverview/, 'the root must render the overview');
});

test('the shell crumb links to the bucket root, not the first zone', () => {
  const code = codeOnly(shell);
  assert.match(code, /to=\{bucket\.prefix\}/, 'the crumb must link to the bucket root');
  assert.doesNotMatch(code, /to=\{`\$\{bucket\.prefix\}\/\$\{bucket\.zones\[0\]\.slug\}`\}/,
    'the crumb must not link to the first zone');
});

test('the shell passes activeSlug through to ZoneNav', () => {
  const code = codeOnly(shell);
  assert.match(code, /activeSlug=\{activeSlug\}/, 'WorkspaceShell must forward activeSlug');
});

// ---------------------------------------------------------------------------
// An overview card must never promise what the page behind it denies.
//
// The overview grid ships one line per zone, and it is the surface an advisor
// reads BEFORE choosing where to click — so a card describing a zone that
// renders "no store behind this yet" is the absent-is-not-empty rule broken at
// the one point where it is most persuasive. It shipped that way once: four
// cards (Thinking, Visibility, Guidance, Calendar) advertised stores that do
// not exist, Earnings claimed "what the platform took" beside a rail saying
// Axal takes no cut, and Services claimed "how often it is booked" over a
// `units_sold` that is null by design.
//
// The fix is structural rather than editorial: a zone with no store is absent
// from `ZONE_BLURB` and its card is written from `COPY` — the same object its
// own page renders from. These tests pin that coupling, so building a store
// (or losing one) fails here until the copy moves with it.
// ---------------------------------------------------------------------------

const advisorCode = codeOnly(bucketRoutes);

/** The body of a top-level `const NAME = {` … `\n};` block. */
function block(code, name) {
  const start = code.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} is gone, or is no longer an object literal`);
  const end = code.indexOf('\n};', start);
  assert.notEqual(end, -1, `${name} is not a closed object literal`);
  return code.slice(start, end);
}

/** The members of a top-level `const NAME = new Set([...])`. */
function setMembers(code, name) {
  const m = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(code);
  assert.ok(m, `${name} is gone, or is no longer a Set literal`);
  return [...m[1].matchAll(/'([a-z][a-z-]*)'/g)].map((x) => x[1]);
}

/** Keys at a given indent, quoted or bare: `  foo:` / `    'this-week': {`. */
const keysAt = (body, spaces) =>
  [...body.matchAll(new RegExp(`^ {${spaces}}'?([a-z][a-z-]*)'?:`, 'gm'))].map((m) => m[1]);

/** Zones with a real page: the LIVE sets plus the ZONE component maps. */
function backedSlugs() {
  const live = [...block(advisorCode, 'LIVE').matchAll(/'([a-z][a-z-]*)'/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith('/'));
  return [...new Set([...live, ...keysAt(block(advisorCode, 'ZONE'), 4)])];
}

/** Zones with no store: exactly those carrying a COPY card. */
const unbackedSlugs = () => keysAt(block(advisorCode, 'COPY'), 4);

test('every zone with a store has an overview blurb, and no zone without one does', () => {
  const blurbs = keysAt(block(advisorCode, 'ZONE_BLURB'), 2);
  const backed = backedSlugs();
  const unbacked = unbackedSlugs();

  assert.ok(backed.length >= 8, `parse failed — only ${backed.length} backed zones found`);
  assert.ok(unbacked.length >= 1, 'parse failed — no COPY zones found');

  assert.deepEqual(
    [...blurbs].sort(),
    [...backed].sort(),
    'ZONE_BLURB must name exactly the zones that have a page: build a store and the blurb moves in, lose one and it moves out',
  );

  const overlap = blurbs.filter((s) => unbacked.includes(s));
  assert.deepEqual(
    overlap,
    [],
    `these zones render "no store behind this yet" and must not be described as working features: ${overlap.join(', ')}`,
  );
});

test('an unbuilt zone card is written from COPY and marked, not hand-written', () => {
  assert.match(
    advisorCode,
    /const unbuilt = COPY\[bucket\.prefix\]\?\.\[zone\.slug\]/,
    'the card must read the same COPY entry its zone page renders',
  );
  assert.match(
    advisorCode,
    /unbuilt \? unbuilt\.heading : ZONE_BLURB\[zone\.slug\]/,
    'an unbuilt card must show the COPY heading, never a blurb of its own',
  );
  assert.match(advisorCode, /Not built/, 'an unbuilt card must be visibly marked');
});

test('the Research overview describes only its two live zones, and reads ZONE_COPY for the rest', () => {
  const code = codeOnly(researchWs);
  const live = setMembers(code, 'LIVE_ZONES');
  const blurbs = keysAt(block(code, 'ZONE_BLURB'), 2);

  assert.deepEqual(
    [...blurbs].sort(),
    [...live].sort(),
    'only the zones in LIVE_ZONES may carry a blurb: Ask, Library, Client prep, Funds, Diligence and Benchmarking are withdrawn or unbuilt (D9/D12)',
  );
  assert.match(
    code,
    /\(ZONE_COPY\[zone\.slug\] \|\| ZONE_COPY\.ask\)\.heading/,
    'an unbuilt Research card must show the same heading its own page renders, with the same fallback',
  );
  assert.doesNotMatch(
    block(code, 'ZONE_BLURB'),
    /relationship or only a file/i,
    'competitor_candidates carries no relationship-vs-research flag',
  );
});

test('the Network overview shares one INTRO map and marks Organizations where it reads nothing', () => {
  const code = codeOnly(networkWs);
  assert.match(code, /^const INTRO = \{/m, 'INTRO must be module-scope so the overview and the zone header share it');
  assert.match(code, /INTRO\[zone\.slug\]/, 'the overview must read INTRO rather than restating it');

  // The three lines must exist once, not once per surface: duplicated copy is
  // how an overview card and the zone header it opens drift apart.
  const line = 'People you know and how strongly, from the records you keep here.';
  assert.equal(code.split(line).length - 1, 1, 'the Relationships line is duplicated; share INTRO instead');

  assert.match(
    code,
    /zone\.slug === 'organizations' && !ORG_BACKED\.has\(role\)/,
    'the Organizations card must consult the same ORG_BACKED set the zone body and rail use',
  );
});

test('no overview blurb claims a platform cut or a booking count', () => {
  // Two recorded decisions, both contradicted by the first draft of this grid:
  // Axal records amounts and settles nothing (no fee, no cut, no payout), and
  // `units_sold` is null by design because a booking records a topic, not a
  // service.
  const blurbBody = block(advisorCode, 'ZONE_BLURB');
  for (const claim of [
    /platform took/i,
    /\bwe take\b/i,
    /\bour cut\b/i,
    /how often it is booked/i,
    /units? sold/i,
    /times booked/i,
  ]) {
    assert.doesNotMatch(blurbBody, claim, `an overview blurb re-asserts ${claim}`);
  }
});
