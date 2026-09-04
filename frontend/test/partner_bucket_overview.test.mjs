/**
 * Partner bucket roots render the canvas overview pages, not the first zone
 * and not a legacy destination.
 *
 * The Partner Operator canvas specifies a landing page per bucket — P3
 * Pipeline ("Win the work"), P4 Delivery ("Ship the work"), P5 Offers
 * ("Package what we sell"), P6 Network ("Work our relationships"), P7
 * Research ("Know the client's world"). The sidebar row must open that
 * overview. What it did instead, per the bug report:
 *
 *   - Research pointed at /signals
 *   - Network fell through the role branch to a bare NetworkPage (or bounced
 *     an admin preview to /studio)
 *   - Offers redirected /offers to /offers/catalog
 *   - Delivery redirected /delivery to /delivery/board
 *   - /pipeline rendered the investor deal pipeline for partners
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = read('frontend/src/App.jsx');
const bucketRoutes = codeOnly(read('frontend/src/workspaces/partner/PartnerBucketRoutes.jsx'));
const sidebar = codeOnly(read('frontend/src/sidebarConfig.js'));
const shell = codeOnly(read('frontend/src/workspaces/WorkspaceShell.jsx'));

test('Delivery and Offers roots are routes, not redirects', () => {
  for (const prefix of ['/delivery', '/offers']) {
    const line = app.split('\n').find((l) => l.includes(`path="${prefix}"`));
    assert.ok(line, `${prefix} has no route`);
    assert.doesNotMatch(line, /Navigate to=/, `${prefix} must not redirect to a zone`);
    assert.match(line, /PartnerBucketRoutes/, `${prefix} must render the bucket shell`);
  }
});

test('the partner /pipeline root renders the partner bucket, not the investor page', () => {
  const line = app.split('\n').find((l) => l.includes('path="/pipeline"'));
  assert.ok(line, '/pipeline has no route');
  assert.match(line, /effectiveRole === 'partner' \? <PartnerBucketRoutes \/>/,
    'partners must branch to PartnerBucketRoutes');
  assert.match(line, /investorWorkspace\('deals', <PipelineWorkspace \/>\)/,
    'investors keep the deal pipeline');
  // Exactly one /pipeline route — a duplicate would shadow by rank order.
  const count = app.split('\n').filter((l) => l.includes('path="/pipeline"')).length;
  assert.equal(count, 1, 'there must be exactly one /pipeline route');
});

test('partner /network renders the network shell, outside the preview redirect', () => {
  const line = app.split('\n').find((l) => l.includes('path="/network"'));
  assert.ok(line, '/network has no route');
  assert.match(line, /effectiveRole === 'partner' \? <NetworkWorkspace role="partner" \/>/,
    'partners must get the zone shell');
  // The branch sits BEFORE partnerPrivateWorkspace, so an admin previewing
  // the Partner role lands on the overview instead of bouncing to /studio.
  assert.ok(
    line.indexOf("effectiveRole === 'partner'") < line.indexOf('partnerPrivateWorkspace'),
    'the partner branch must come before the preview redirect',
  );
});

test('partner sidebar rows point at bucket roots', () => {
  const partner = sidebar.slice(sidebar.indexOf('\n  partner: ['), sidebar.indexOf('\n  investor: ['));
  for (const root of ['/pipeline', '/delivery', '/offers', '/network', '/research']) {
    assert.match(partner, new RegExp(`to: '${root}'`), `no partner row points at ${root}`);
  }
  for (const legacy of ["/needs'", "/partner/operations/overview'", "/services'", "/signals'"]) {
    assert.doesNotMatch(partner, new RegExp(`to: '${legacy}`),
      `a partner row still points at legacy ${legacy}`);
  }
});

test('PartnerBucketRoutes renders an overview grid at each bucket root', () => {
  assert.match(bucketRoutes, /isRoot/, 'the root must be detected');
  assert.match(bucketRoutes, /<BucketOverview\s+bucket=\{bucket\}\s+role="partner"/,
    'the root must render the shared overview with the partner accent');
  assert.match(bucketRoutes, /unbuilt=\{gapsFor\(prefix, bucket\)\}/,
    'every partner zone without a live page must carry its own gap line');
  assert.match(bucketRoutes, /activeSlug=\{isRoot \? null : undefined\}/,
    'the root must light no zone pill');
  assert.match(bucketRoutes, /title=\{isRoot \? bucket\?\.label : undefined\}/,
    'the root must title itself with the bucket, not the first zone');
});

test('WorkspaceShell resolves no zone when activeSlug is null', () => {
  assert.match(shell, /activeSlug === null \? null : zoneForPath/,
    'overview mode must clear the crumb, title and badge zone');
});

test('the shared overview component exists and takes a role accent', () => {
  const overview = codeOnly(read('frontend/src/workspaces/BucketOverview.jsx'));
  assert.match(overview, /ACCENT\[role\]/, 'the accent must come from the role');
  assert.match(overview, /zonePath\(bucket, zone\)/, 'each card must link to its zone route');
});

// ---------------------------------------------------------------------------
// The partner grid describes what the firm HAS, not what the canvas drew.
//
// Eight of the thirteen partner zones have no surface: negotiations,
// deliverables, capacity, catalog, visibility and proof each carry a COPY
// card, and status-reports and audience-fit fall through to the generic one.
// The first draft of ZONE_LINES described all eight as working features —
// "live deals at terms", "where the firm is over-committed", "the record lead
// scoring reads against" — on the surface a partner reads before choosing
// where to click.
// ---------------------------------------------------------------------------

const partnerCode = codeOnly(bucketRoutes);

/** The body of a top-level `const NAME = {` … `\n};` block. */
function blockOf(code, name) {
  const start = code.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} is gone`);
  // BRACE-BALANCED, not `indexOf('\n};')`.
  //
  // The line-based form worked until `COPY` became `const COPY = {};` — every
  // zone having a store is the whole point of #45 — at which point there was no
  // `\n};` to find and the scan ran on into the NEXT map, so `COPY` reported
  // `ZONE_LINES`'s slugs and the overlap test failed on a file that was
  // correct. An empty map is a legitimate state and the parser has to survive
  // it, or the guard fails exactly when the thing it guards has been fixed.
  const open = code.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  assert.fail(`${name} is not a closed object literal`);
  return '';
}

/**
 * Blank out string VALUES — a literal that is not immediately followed by `:`.
 * Without this, prose is read as code: `proposals: 'The proposal desk: what is
 * open'` contributed a zone named `desk`, and the guard failed on a map that
 * was correct. Quoted KEYS ('perk-deals':) survive, because those are what we
 * are counting.
 */
function withoutStringValues(body) {
  return body.replace(
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g,
    (lit, at) => (/^\s*:/.test(body.slice(at + lit.length)) ? lit : "''"),
  );
}

/**
 * The zone slugs of a bucket-keyed map. These maps are two levels deep —
 * bucket prefix, then zone slug — so the slugs are exactly the depth-2 keys.
 * Depth beats a name filter: COPY's third level (heading, what, why, links)
 * drops out by structure rather than by a list someone has to remember to
 * extend, and indentation is irrelevant, so LIVE packing four zones onto two
 * lines reads the same as ZONE_LINES writing one per line.
 */
function zoneSlugs(code, name) {
  const body = withoutStringValues(blockOf(code, name));
  const out = new Set();
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '[') { depth += 1; continue; }
    if (ch === '}' || ch === ']') { depth -= 1; continue; }
    if (depth !== 2) continue;
    const prev = body[i - 1];
    if (prev !== undefined && !/[{,\s]/.test(prev)) continue;
    const m = /^(?:'([^']*)'|([A-Za-z_$][\w$-]*))\s*:/.exec(body.slice(i));
    if (!m) continue;
    out.add(m[1] ?? m[2]);
    i += m[0].length - 1;
  }
  return [...out];
}

test('ZONE_LINES describes only the zones with a live page', () => {
  const lines = zoneSlugs(partnerCode, 'ZONE_LINES');
  const live = zoneSlugs(partnerCode, 'LIVE');
  assert.ok(live.length >= 5, `parse failed — only ${live.length} live zones found`);
  assert.deepEqual(
    [...lines].sort(),
    [...live].sort(),
    'a partner zone with no page must take its line from COPY or the generic card, never a description of its own',
  );
});

test('no partner description survives for a zone that renders a no-store card', () => {
  const copySlugs = zoneSlugs(partnerCode, 'COPY');
  const lines = zoneSlugs(partnerCode, 'ZONE_LINES');
  const overlap = lines.filter((s) => copySlugs.includes(s));
  assert.deepEqual(overlap, [], `these zones render NoStoreYet and must not be described: ${overlap.join(', ')}`);

  // THREE PHRASES WERE BANNED HERE. ONE HAS LIFTED, AND ONLY ONE.
  //
  // `/live deals at terms/i` was the negotiations card's own words, banned
  // because no store carried a term. Migration 208 added `quote_negotiations`
  // (stage, ball-in-court) and `quote_terms` (a clause with our position,
  // theirs and the landing), `partner_pipeline.ts` reads them and
  // `NegotiationsZone.jsx` renders them, so the sentence is now a description
  // of a working page. It is no longer banned — but the ban is replaced rather
  // than deleted, by the assertion below that the zone is live: if the body is
  // ever removed from `LIVE`, saying "live deals at terms" becomes false again
  // and this test fails again.
  //
  // The other two stay, and neither is a formality:
  //   · `/over-committed/i` — 208 records hours and seats but NOTHING records
  //     the firm's cap, so there is still no threshold to be over. The capacity
  //     canvas hardcodes 40; a page that adopted that number would be inventing
  //     the firm's cap and then presenting it as a finding.
  //   · `/lead scoring reads against/i` — never matched the live line, which
  //     reads "reads a match against". Kept so a future rewrite cannot drift
  //     into the stronger claim.
  const liveNow = zoneSlugs(partnerCode, 'LIVE');
  assert.ok(
    liveNow.includes('negotiations'),
    'the "live deals at terms" ban lifted on the premise that negotiations is live; it is not',
  );
  for (const claim of [/over-committed/i, /lead scoring reads against/i]) {
    assert.doesNotMatch(blockOf(partnerCode, 'ZONE_LINES'), claim,
      `an overview line re-asserts ${claim}`);
  }
});
