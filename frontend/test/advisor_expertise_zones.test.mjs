/**
 * Expertise: five zones, three of them now backed by a real store.
 *
 * WHAT THESE PIN, and each is something that could plausibly go the other way:
 *
 *   * /office-hours is retired without dropping anything — its one capability
 *     that lived nowhere else moved to the tab already built around it;
 *   * a zone with a store gets its own page, and a zone without one keeps a
 *     card that names the missing store rather than borrowing a page that
 *     would render someone's guess;
 *   * absent money reads as absent — no `$0` fallback anywhere;
 *   * the attester's page is reachable by someone with no account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { allZoneRoutes } from '../src/workspaces/shellConfig.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const bucketRoutes = codeOnly(read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx'));
const app = read('frontend/src/App.jsx');
const api = codeOnly(read('frontend/src/lib/api.js'));

/** The `ZONE` dispatch map, as a `{prefix: [slug…]}` object. */
function dispatchMap() {
  const block = bucketRoutes.slice(
    bucketRoutes.indexOf('const ZONE = {'),
    bucketRoutes.indexOf('const COPY = {'),
  );
  const out = {};
  for (const m of block.matchAll(/'(\/[a-z]+)': \{([^}]*)\}/g)) {
    out[m[1]] = [...m[2].matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((x) => x[1]);
  }
  return out;
}

test('every Expertise zone the shell declares is either backed or honestly empty', () => {
  const zones = allZoneRoutes('advisor')
    .filter((r) => r.startsWith('/expertise/'))
    .map((r) => r.slice('/expertise/'.length));
  assert.deepEqual(zones, ['profile', 'services', 'proof', 'thinking', 'visibility']);

  // The dispatch map and the COPY block must together cover the whole zone
  // list. A zone in neither would fall through to the generic "Nothing here
  // yet" card — which is honest, but says nothing useful about WHY.
  const backed = dispatchMap()['/expertise'] || [];
  assert.deepEqual(backed, ['profile', 'services', 'proof'],
    'exactly the three zones migrations 202-204 gave a store');

  const copyStart = bucketRoutes.indexOf("  '/expertise': {\n    thinking:");
  assert.ok(copyStart > -1, 'the Expertise COPY block must still start with thinking');
  const expertiseCopy = bucketRoutes.slice(
    copyStart,
    bucketRoutes.indexOf("  '/cohorts': {", copyStart),
  );
  assert.ok(expertiseCopy.length > 0, 'the slice must not invert');
  for (const z of zones.filter((x) => !backed.includes(x))) {
    assert.ok(expertiseCopy.includes(`    ${z}: {`),
      `${z} has no store and must say which one is missing`);
  }
});

test('every Practice zone is served — none is left claiming a store that exists', () => {
  const zones = allZoneRoutes('advisor')
    .filter((r) => r.startsWith('/practice/'))
    .map((r) => r.slice('/practice/'.length));
  assert.deepEqual(zones, ['opportunities', 'engagements', 'delivery', 'sessions', 'earnings']);

  // Three come from the legacy Advisory workspace, two from their own pages.
  // Together that must be all five: Practice has no unbacked zone left.
  const live = bucketRoutes.slice(bucketRoutes.indexOf('const LIVE = {'),
    bucketRoutes.indexOf('const ZONE = {'));
  const fromWorkspace = zones.filter((z) => live.includes(`'${z}'`));
  const fromOwnPage = dispatchMap()['/practice'] || [];
  assert.deepEqual(fromWorkspace, ['opportunities', 'engagements', 'delivery']);
  assert.deepEqual(fromOwnPage, ['sessions', 'earnings']);
  assert.deepEqual([...fromWorkspace, ...fromOwnPage].sort(), [...zones].sort());

  // And the copy that said they had "no store at all" is gone. It was true
  // when written and false the moment migration 205 shipped; a card naming a
  // closed gap tells an advisor a working feature is missing.
  assert.doesNotMatch(bucketRoutes, /Earnings is not built yet/);
  assert.doesNotMatch(bucketRoutes, /Booked sessions are not a surface yet/);
  assert.doesNotMatch(bucketRoutes, /no session price, paid booking or payout record/);
});

test('the two unbacked zones name the store that is absent, not a vague "coming soon"', () => {
  // The whole value of the empty card is that it is specific. "Not built yet"
  // is indistinguishable from a bug; "the articles table has no advisor owner"
  // is a fact a reader can check.
  assert.match(bucketRoutes, /`articles` table exists and records a date and a publication state, but it has no advisor owner/);
  assert.match(bucketRoutes, /no impression or profile-view counter anywhere in the product/);
});

test('/office-hours is retired, and its one unique capability moved rather than vanished', () => {
  // This test previously pinned the opposite — that the frozen surface still
  // rendered its own component. Task #124's freeze is lifted, so it pins the
  // retirement instead. UNRESOLVED_ITEMS U4 is resolved with it.
  const line = app.split('\n').find((l) => l.includes('path="/office-hours"'));
  assert.ok(line, 'the path must still resolve — a retired page is not a 404');
  assert.match(line, /<Navigate to="\/practice\/opportunities" replace \/>/);

  // RETIRING IS NOT THE SAME AS DROPPING. Of everything that page rendered,
  // exactly one thing lived nowhere else: the advisor's own review of a
  // session. ProfileFitSection was already on the advisor's studio home, and
  // the profile form, slot publishing and the booking list all have working
  // equivalents under /expertise and /practice — which is the point, since the
  // ones on that page were broken against the DTOs.
  const delivery = codeOnly(read('frontend/src/pages/advisor/advisory/DeliveryPage.jsx'));
  assert.match(delivery, /api\.fileAdvisorReview\(/,
    'the advisor review moved to Delivery, the tab already built around it');
  assert.match(codeOnly(read('frontend/src/pages/advisor/AdvisorStudioHome.jsx')),
    /ProfileFitSection/, 'the fit profile was already here — nothing to move');
});

test('an unpriced service is never rendered as free', () => {
  const kit = codeOnly(read('frontend/src/pages/advisor/expertise/kit.jsx'));
  // `money` returns null for an absent amount so the caller must decide what
  // absent looks like. A `?? 0` or a `|| 0` anywhere in that chain would turn
  // "no price set" into "$0.00", which is a different claim entirely.
  assert.match(kit, /if \(cents == null\) return null;/);

  const services = codeOnly(read('frontend/src/pages/advisor/expertise/ServicesZone.jsx'));
  assert.match(services, /money\(row\.price_cents, row\.currency\) \?\? <Unrecorded \/>/,
    'an absent price falls back to Not recorded, not to a zero');
  for (const page of readdirSync(resolve(process.cwd(), 'frontend/src/pages/advisor/expertise'))) {
    const src = codeOnly(read(`frontend/src/pages/advisor/expertise/${page}`));
    assert.doesNotMatch(src, /price_cents\s*\|\|\s*0/, `${page} coerces an absent price to zero`);
    assert.doesNotMatch(src, /price_cents\s*\?\?\s*0/, `${page} coerces an absent price to zero`);
  }
});

test('a failed read is not rendered as an empty store', () => {
  // The reported defect, in the user's words: "it does show anything, it looks
  // blank, probably not connected to anything". ZoneBody reads `error` BEFORE
  // `isEmpty` so a page can only claim a store is empty once it has read one.
  const kit = read('frontend/src/pages/advisor/expertise/kit.jsx');
  const body = kit.slice(kit.indexOf('export function ZoneBody'));
  const errorAt = body.indexOf('if (error)');
  const emptyAt = body.indexOf('if (isEmpty)');
  assert.ok(errorAt > -1 && emptyAt > -1);
  assert.ok(errorAt < emptyAt, 'the error branch must be reached before the empty branch');

  // And every zone page routes its failure through it rather than swallowing
  // the rejection into a [] that reads as "you have none".
  for (const page of ['ServicesZone.jsx', 'ProofZone.jsx', 'ProfileZone.jsx']) {
    const src = codeOnly(read(`frontend/src/pages/advisor/expertise/${page}`));
    assert.match(src, /<ZoneBody/, `${page} must use the shared four-state body`);
    assert.match(src, /catch \(e\) \{/, `${page} must catch its own read failure`);
  }
});

/**
 * Every `<ZoneBody …>` opening tag under pages/advisor, as raw source. The
 * tag spans several lines at most call sites, so this balances angle brackets
 * at brace depth 0 rather than reading a line.
 */
function zoneBodyTags(code) {
  const tags = [];
  let at = code.indexOf('<ZoneBody');
  while (at !== -1) {
    let depth = 0;
    let end = at;
    for (let i = at; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) { end = i; break; }
    }
    tags.push(code.slice(at, end + 1));
    at = code.indexOf('<ZoneBody', end + 1);
  }
  return tags;
}

/** The `loading={…}` expression of one tag, brace-balanced. */
function loadingExpr(tag) {
  const key = 'loading={';
  const at = tag.indexOf(key);
  if (at === -1) return null;
  let depth = 1;
  for (let i = at + key.length; i < tag.length; i += 1) {
    if (tag[i] === '{') depth += 1;
    else if (tag[i] === '}') { depth -= 1; if (depth === 0) return tag.slice(at + key.length, i); }
  }
  return null;
}

test('no zone holds `loading` true past its own error', () => {
  // THE BUG THIS PINS SHUT, which shipped and was reported from production as
  // /expertise/profile spinning forever. ZoneBody tests `loading` before
  // `error` (asserted above), so a caller that ORs a data-presence check into
  // `loading` makes its OWN error card unreachable: the failed read sets
  // `error` and leaves the data null, `!data` stays true, and the skeleton
  // renders for good with the captured message never shown.
  //
  // The rule: a `loading` expression may OR something in only if it also
  // subordinates it to the error state (`… && !x.error`), so an error always
  // beats the skeleton. ProfileZone keeps its draft guard that way, because
  // every field in its body reads `draft.<key>` unconditionally and would
  // throw on a null.
  const OR = /\|\|/;
  const SUBORDINATED = /&&\s*!\s*(?:[\w$]+\.)*error\b/;

  const dir = resolve(process.cwd(), 'frontend/src/pages/advisor');
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsx')) files.push(full);
    }
  };
  walk(dir);

  let checked = 0;
  for (const full of files) {
    const code = codeOnly(readFileSync(full, 'utf8'));
    for (const tag of zoneBodyTags(code)) {
      const expr = loadingExpr(tag);
      assert.ok(expr !== null, `${full} has a ZoneBody with no loading prop`);
      checked += 1;
      if (!OR.test(expr)) continue;
      assert.match(expr, SUBORDINATED,
        `${full}: loading={${expr.trim()}} ORs a guard in without subordinating it `
        + 'to the error state, so this zone can never render its own error card');
    }
  }
  // A parse that found nothing would pass silently, which is the failure mode
  // this whole file exists to prevent.
  assert.ok(checked >= 10, `expected every advisor ZoneBody call site, parsed ${checked}`);
});

test('confirmation is the attester’s to give, and the token is shown once', () => {
  const proof = codeOnly(read('frontend/src/pages/advisor/expertise/ProofZone.jsx'));
  // `attested` comes off the worker's row; nothing here computes it from the
  // advisor's own input, and nothing lets them set it.
  assert.match(proof, /row\.attested/);
  assert.doesNotMatch(proof, /attested:\s*(true|false)/,
    'the page must never assert attestation itself');
  assert.match(proof, /Self-stated/, 'an unconfirmed claim says so');

  // The link is state on the response, not something re-read later — the
  // worker returns request_token once and never again.
  assert.match(proof, /res\?\.request_token/);
  assert.doesNotMatch(proof, /row\.consents\[0\]\.request_token/);
  assert.match(proof, /shown once/i);
});

test('the attester can answer without an account', () => {
  assert.match(app, /path="\/attest\/:token"/, 'the public route exists');
  const line = app.split('\n').find((l) => l.includes('path="/attest/:token"'));
  assert.ok(line && !line.includes('guard('), 'and it is not behind a role guard');

  // Without this a background settings/me 401 bounces an anonymous visitor to
  // /login before they can answer — the same reason /esign/ is listed.
  assert.match(api, /currentPath\.startsWith\('\/attest\/'\)/,
    'isPublicPath must list /attest/ or the attester never reaches the page');
});

test('every new store has an api method, and none of them names an advisor', () => {
  for (const method of [
    'listMyAdvisorServices', 'createMyAdvisorService', 'updateMyAdvisorService',
    'deleteMyAdvisorService', 'listMyAdvisorProof', 'createMyAdvisorProof',
    'deleteMyAdvisorProof', 'requestAdvisorProofConsent', 'respondToAdvisorProofConsent',
    'updateMyAdvisorBookingBilling', 'getMyAdvisorEarnings',
    'listMyAdvisorCohorts', 'listMyAdvisorCohortFounders',
  ]) {
    assert.ok(api.includes(`${method}:`), `api.${method} is missing`);
  }
  // Scoping is the worker's job and it does it off the session. A client
  // method that took an advisor id would imply otherwise at the call site.
  const block = api.slice(api.indexOf('listMyAdvisorServices:'), api.indexOf('listMyAdvisorCohortFounders:'));
  assert.doesNotMatch(block, /advisor_id/, 'no client method passes an advisor id');
});
