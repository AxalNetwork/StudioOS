/**
 * Expertise: five zones, three of them now backed by a real store.
 *
 * WHAT THESE PIN, and each is something that could plausibly go the other way:
 *
 *   * the frozen surface stays frozen — /office-hours still renders
 *     AdvisorExpertiseWorkspace, and that component is neither edited nor
 *     imported by the new pages;
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

test('every Expertise zone the shell declares is either backed or honestly empty', () => {
  const zones = allZoneRoutes('advisor')
    .filter((r) => r.startsWith('/expertise/'))
    .map((r) => r.slice('/expertise/'.length));
  assert.deepEqual(zones, ['profile', 'services', 'proof', 'thinking', 'visibility']);

  // The dispatch map and the COPY block must together cover the whole zone
  // list. A zone in neither would fall through to the generic "Nothing here
  // yet" card — which is honest, but says nothing useful about WHY.
  const dispatch = bucketRoutes.slice(
    bucketRoutes.indexOf('const EXPERTISE_ZONE = {'),
    bucketRoutes.indexOf('const COPY = {'),
  );
  const backed = zones.filter((z) => dispatch.includes(`${z}:`));
  assert.deepEqual(backed, ['profile', 'services', 'proof'],
    'exactly the three zones migrations 202-204 gave a store');

  const expertiseCopy = bucketRoutes.slice(
    bucketRoutes.indexOf("  '/expertise': {\n    thinking:"),
    bucketRoutes.indexOf("  '/cohorts': {"),
  );
  for (const z of zones.filter((x) => !backed.includes(x))) {
    assert.ok(expertiseCopy.includes(`    ${z}: {`),
      `${z} has no store and must say which one is missing`);
  }
});

test('the two unbacked zones name the store that is absent, not a vague "coming soon"', () => {
  // The whole value of the empty card is that it is specific. "Not built yet"
  // is indistinguishable from a bug; "the articles table has no advisor owner"
  // is a fact a reader can check.
  assert.match(bucketRoutes, /`articles` table exists and records a date and a publication state, but it has no advisor owner/);
  assert.match(bucketRoutes, /no impression or profile-view counter anywhere in the product/);
});

test('/office-hours is untouched — the frozen surface still renders its own component', () => {
  // Task #124 freezes /office-hours, and UNRESOLVED_ITEMS U4 records that
  // Practice and Expertise sit over one API with it. The new zones are a
  // SECOND surface over the same store, never a rewrite of the first.
  const line = app.split('\n').find((l) => l.includes('path="/office-hours"'));
  assert.ok(line, '/office-hours must still be routed');
  assert.match(line, /AdvisorExpertiseWorkspace/,
    'an advisor at /office-hours still gets the component that was there');

  assert.doesNotMatch(bucketRoutes, /AdvisorExpertiseWorkspace/,
    'the bucket routes no longer mount it — /expertise/* has its own pages now');

  // And the component itself still carries the embedded seam it was given in
  // #393, because /office-hours is not the only thing that could mount it.
  const workspace = codeOnly(read('frontend/src/pages/advisor/AdvisorExpertiseWorkspace.jsx'));
  assert.match(workspace, /\{ embedded = false \}/);
  assert.match(workspace, /embedded=\{embedded\}/);
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
