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
  assert.match(code, /<BucketOverview/, 'the root must render the shared overview');
  assert.match(code, /unbuilt=\{unbuiltFrom\(COPY\[prefix\]\)\}/,
    'the advisor overview must derive its gaps from COPY, the map its zone pages render');
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

// The two helpers below locate their span with string search and then apply a
// LITERAL regex. Building the pattern from an argument instead — `new
// RegExp(`const ${name} = …`)` — is what Semgrep's detect-non-literal-regexp
// rule flags, and the repo has already answered it that way once (the
// exported-symbol helper in cloudflare-worker/test/super_admin.test.ts).
// Harmless here, since every argument is a literal written above, but a
// standing finding on every PR is a cost of its own.

/** The members of a top-level `const NAME = new Set([...])`. */
function setMembers(code, name) {
  const marker = `const ${name} = new Set([`;
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `${name} is gone, or is no longer a Set literal`);
  const end = code.indexOf('])', start);
  assert.notEqual(end, -1, `${name} is not a closed Set literal`);
  const members = code.slice(start + marker.length, end);
  return [...members.matchAll(/'([a-z][a-z-]*)'/g)].map((x) => x[1]);
}

/** Keys at exactly the given indent, quoted or bare: `  foo:` / `    'this-week': {`. */
const keysAt = (body, spaces) => {
  const indent = ' '.repeat(spaces);
  return body
    .split('\n')
    .filter((line) => line.startsWith(indent) && !line.startsWith(`${indent} `))
    .map((line) => /^\s*'?([a-z][a-z-]*)'?:/.exec(line))
    .filter(Boolean)
    .map((m) => m[1]);
};

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

test('the shared overview marks an unbuilt zone and shows its own page heading', () => {
  // The coupling moved into BucketOverview when the partner buckets joined:
  // one component renders every licence's grid, so the honest-state handling
  // is written once and a new bucket cannot forget it.
  const overview = codeOnly(read('frontend/src/workspaces/BucketOverview.jsx'));
  assert.match(overview, /export function unbuiltFrom\(copy\)/,
    'the derivation must live beside the component, not be hand-written per caller');
  assert.match(overview, /\.map\(\(\[slug, v\]\) => \[slug, v\.heading\]\)/,
    'unbuiltFrom must take the heading the zone page renders, verbatim');
  assert.match(overview, /const gap = unbuilt\[zone\.slug\]/);
  assert.match(overview, /const line = gap \|\| descriptions\[zone\.slug\]/,
    'a gap line must WIN over a description, never merely supplement it');
  assert.match(overview, /Not built/, 'an unbuilt card must be visibly marked');
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
  assert.match(code, /unbuilt=\{unbuiltFrom\(ZONE_COPY\)\}/,
    'the Research overview must derive its gaps from ZONE_COPY');
  assert.match(code, /const INTRO = \{ \.\.\.ZONE_BLURB, \.\.\.unbuiltFrom\(ZONE_COPY\) \}/,
    'the zone HEADER line must come from the same two maps: a withdrawn zone said "cited answers over your own documents" above its own empty card');
  assert.doesNotMatch(
    block(code, 'ZONE_BLURB'),
    /relationship or only a file/i,
    'competitor_candidates carries no relationship-vs-research flag',
  );
});

test('Client prep blames the access rule, not a table that is actually there', () => {
  // THE CLAIM THIS KILLS was on production until 2026-09-05: "nothing joins a
  // booking to the client's own record". Checked against production D1 rather
  // than schema.sql, the join is two hops —
  // advisor_bookings.founder_user_id → users.founder_id → projects.founder_id
  // — over the same column canAccessFounderResource reads before deciding. A
  // card that blames a missing table for an access decision sends the next
  // reader to write a migration that would change nothing.
  //
  // ASSERTED ON codeOnly, NOT THE RAW FILE, and the distinction is the point:
  // the file's docblock quotes the dead sentence on purpose so the correction
  // survives being re-read. What must never come back is the RENDERED copy.
  const code = codeOnly(researchWs);
  for (const dead of [
    /nothing joins a booking to the client/,
    /the project read that would reach it excludes advisors/,
  ]) {
    assert.doesNotMatch(code, dead, `a falsified claim is still rendered: ${dead}`);
  }

  // Scoped to ZONE_COPY, whose bounds `block` asserts at both ends. Searching
  // the rest of the file instead is how a sibling test matched an unrelated key
  // three hundred lines further down and failed for the wrong reason.
  const copy = block(code, 'ZONE_COPY');
  assert.match(copy, /access decision, not an absent table/,
    'the card must name the access decision as the obstacle');
  assert.match(copy, /carries their founder id and a project carries the same id/,
    'the card must say the join exists, since claiming otherwise is what was wrong');
});

test('Client prep gives the two roles that see it their own reason', () => {
  // `canAccessFounderResource` (cloudflare-worker/src/auth.ts) returns true
  // outright for `partner` and matches an advisor on neither branch, so ONE
  // sentence cannot be true for both — and RESEARCH_ZONES gives this zone to
  // both roles. The old card stated the advisor's obstacle to a partner, and
  // pointed them at Practice · Sessions, a bucket only the advisor shell has.
  const code = codeOnly(researchWs);
  assert.match(code, /function ClientPrepScopeNote\(\{ role \}\)/,
    'the role-specific reason must be a component, not another line of shared copy');
  assert.match(code, /slug === 'client-prep' && <ClientPrepScopeNote role=\{role\} \/>/,
    'the note must actually render on the zone');

  const start = code.indexOf('function ClientPrepScopeNote');
  const end = code.indexOf('const LIVE_ZONES');
  assert.ok(start > -1 && end > start,
    'the ClientPrepScopeNote slice must be bounded at BOTH ends — an open-ended slice reads '
    + 'the rest of the file and passes on some other component\'s copy');
  // Collapsed, because these assert RENDERED prose and JSX text wraps wherever
  // the line runs out. Matching source line breaks means a reflow that changes
  // no rendered word fails the test, which trains the next reader to loosen it.
  const note = code.slice(start, end).replace(/\s+/g, ' ');
  assert.ok(note.length > 200 && note.length < 4000, 'the note slice must not run away');
  assert.match(note, /role !== 'advisor' && role !== 'partner'/,
    'no other role may be told a reason that is not theirs');
  // PINNED BECAUSE EVERY OTHER ASSERTION HERE IS ABOUT PRESENCE AND ORDER, and
  // flipping this one line to `role === 'partner'` changes neither: the two
  // reasons swap readers in silence, and an advisor is told permission is not
  // their obstacle when it is precisely their obstacle. Caught by mutation
  // only after it had already slipped through the first eight.
  assert.match(note, /const advisor = role === 'advisor';/,
    'the branch predicate must select on the advisor — every ordering check below '
    + 'reads the advisor branch as the ternary\'s first arm');
  // The advisor half: refused by rule, and the grant shape that would open it
  // exists for investors (data_room_grants) with no advisor equivalent.
  assert.match(note, /revocable, expiring, and logged/,
    'the advisor must be told what would open it, not merely that it is shut');
  // The partner half: they PASS the guard, so permission is not the obstacle.
  // Verified in production — no partner_* table carries a project_id.
  assert.match(note, /passes the founder-data guard as studio staff/,
    'a partner must not be told a rule refuses them when it does not');
  assert.match(note, /assembly gap rather than a permission one/,
    'the partner obstacle is the missing link, and the card must say which it is');

  // Practice · Sessions is advisor-only (shellConfig: no /practice on partner),
  // so it may only be named inside the advisor branch — everything before the
  // `) : (` that opens the partner one.
  const practiceAt = note.indexOf('Practice · Sessions');
  const partnerBranchAt = note.indexOf(') : (');
  assert.notEqual(practiceAt, -1, 'the advisor still has a half, and should be sent to it');
  assert.notEqual(partnerBranchAt, -1, 'the ternary that splits the two branches is gone');
  assert.ok(practiceAt < partnerBranchAt,
    'Practice · Sessions may only be named in the advisor branch — a partner has no /practice');
  assert.doesNotMatch(block(code, 'ZONE_COPY'), /Practice · Sessions/,
    'the shared card must not point a partner at a bucket their shell does not carry');
});

test('the Network overview shares one INTRO map and marks Organizations where it reads nothing', () => {
  const code = codeOnly(networkWs);
  assert.match(code, /^const INTRO = \{/m, 'INTRO must be module-scope so the overview and the zone header share it');
  assert.match(code, /descriptions=\{INTRO\}/, 'the overview must read INTRO rather than restating it');

  // The three lines must exist once, not once per surface: duplicated copy is
  // how an overview card and the zone header it opens drift apart.
  const line = 'People you know and how strongly, from the records you keep here.';
  assert.equal(code.split(line).length - 1, 1, 'the Relationships line is duplicated; share INTRO instead');

  assert.match(
    code,
    /ORG_BACKED\.has\(role\) \? \{\} : \{ organizations: ORG_NO_STORE \}/,
    'the Organizations gap must be per-role, from the same ORG_BACKED set the zone body and rail use',
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
