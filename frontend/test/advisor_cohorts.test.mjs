/**
 * Cohorts: three zones that read the store migration 206 shipped, and two that
 * say what is actually missing now.
 *
 * WHY THIS FILE. Every card in this bucket was written as the SPEC for the
 * migration that then closed the gap — 206's own header quotes one of them
 * back — and none was updated when it landed. `AdvisorBucketRoutes.jsx`'s
 * header states the principle these tests enforce: a card describing a closed
 * gap is worse than no card, because it tells an advisor a working feature is
 * missing.
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

const ZONE_DIR = 'frontend/src/pages/advisor/cohorts';
const zonePages = () => readdirSync(resolve(process.cwd(), ZONE_DIR))
  .filter((f) => f.endsWith('Zone.jsx'));

test('every Cohorts zone is either a page or a card naming its real gap', () => {
  const zones = allZoneRoutes('advisor')
    .filter((r) => r.startsWith('/cohorts/'))
    .map((r) => r.slice('/cohorts/'.length));
  assert.deepEqual(zones, ['founders', 'guidance', 'this-week', 'calendar', 'outcomes']);

  const zoneBlock = bucketRoutes.slice(
    bucketRoutes.indexOf('const ZONE = {'), bucketRoutes.indexOf('const COPY ='));
  const backed = zones.filter((z) => zoneBlock.includes(`${z}:`) || zoneBlock.includes(`'${z}':`));
  // ALL FIVE, since 2026-09-04. Guidance got migration 212 — the one card in
  // this bucket whose diagnosis was still accurate. Calendar needed no
  // migration at all: its card said "both halves exist and nothing joins
  // them", which was exactly right, and the zone is that join.
  assert.deepEqual(backed, ['founders', 'guidance', 'this-week', 'calendar', 'outcomes'],
    'every Cohorts zone reads a store now');

  // THE BUCKET HAS NO COPY BLOCK ANY MORE, and that is the assertion. A card
  // in front of a working page tells an advisor a feature is missing — the
  // failure this bucket hit with Founders, This week and Outcomes after 206,
  // and would hit again if either of these two were left standing.
  //
  // SCOPED TO THE COPY OBJECT, not "everything after it". The first draft of
  // this searched the whole remainder of the file and matched a `'/cohorts'`
  // key in the rail's stance map three hundred lines further down — a false
  // failure that would have sent the next reader hunting for a card that was
  // already gone.
// The no-store copy moved out of `AdvisorBucketRoutes.jsx` into
// `workspaces/noStoreCopy.js`, so the bucket BOARD and the zone CARD read one
// object and cannot state different reasons. The invariants below are
// unchanged; only the file the set is parsed from moved.
  const noStore = read('frontend/src/workspaces/noStoreCopy.js');
  const copyStart = noStore.indexOf('const ADVISOR_COPY = {');
  assert.ok(copyStart > -1, 'the prefix-keyed no-store map must still exist, even holding one bucket');
  const copyBlock = noStore.slice(copyStart, noStore.indexOf('\n};', copyStart));
  assert.ok(copyBlock.length > 0 && copyBlock.length < 4000, 'the slice must not run away');
  assert.ok(!copyBlock.includes("'/cohorts'"),
    'no Cohorts zone may carry a no-store card while its page reads a store');
});

test('the claims migration 206 falsified are gone', () => {
  // These were true when written. Each stopped being true the moment 206 and
  // its routes shipped, and each was still on screen afterwards.
  for (const dead of [
    /Cohort assignment does not exist yet/,
    /Nothing in the product links an advisor to a cohort/,
    /no table joins them/,
    /the weekly view has nothing to aggregate/i,
    /without a cohort assignment there is no batch to aggregate over/,
    /reads from the cohort assignment above, which does not exist/,
    /it does not expose them/,
    /There is no read path today/,
  ]) {
    assert.doesNotMatch(bucketRoutes, dead, `a falsified claim is still rendered: ${dead}`);
  }
});

test('the last two cards are gone, and each zone carries its own remaining limit', () => {
  // Both cards were accurate to the end — which is why the pass that closed
  // them had to close them for real rather than reword them.
  assert.doesNotMatch(bucketRoutes, /nothing records a piece of guidance addressed to a batch/);
  assert.doesNotMatch(bucketRoutes, /your own bookable slots are published from Practice · Opportunities/);
  assert.doesNotMatch(bucketRoutes, /Cohort guidance has no store/);
  assert.doesNotMatch(bucketRoutes, /The cohort calendar is not built yet/);

  // WHAT EACH ZONE STILL CANNOT SAY MOVED ONTO THE ZONE, where a reader meets
  // it in context rather than on an overview card.
  const guidance = read('frontend/src/pages/advisor/cohorts/GuidanceZone.jsx');
  assert.match(guidance, /24[- ]hour commitment|24h commitment/,
    'guidance must state that no response commitment is stored, not compute "overdue"');
  const calendar = read('frontend/src/pages/advisor/cohorts/CalendarZone.jsx');
  assert.match(calendar, /session brief/,
    'calendar must state that no session brief is stored rather than counting every session unprepared');
});

test('the rail says what is true of the zone in front of it', () => {
  // THE BUG THIS PINS SHUT was live on five shipped pages. `live` drives the
  // coverage line and read `LIVE` alone, which holds only the three legacy
  // Advisory tabs — so every ZONE-dispatched page rendered "has no store
  // behind it" while reading a real store. The rail is the one component that
  // must never be more confident than the body beside it; here it was less.
  assert.match(bucketRoutes, /const live = Boolean\(LIVE\[prefix\]\?\.has\(slug\) \|\| ZONE\[prefix\]\?\.\[slug\]\)/);
  assert.doesNotMatch(bucketRoutes, /const live = LIVE\[prefix\]\?\.has\(slug\);/);
  // And the rail's own "unavailable" no longer repeats the dead claim.
  assert.match(bucketRoutes, /An admin decides which cohort you advise/);
});

test('a refused batch renders as a boundary, never as an empty cohort', () => {
  const kit = codeOnly(read(`${ZONE_DIR}/kit.jsx`));
  assert.match(kit, /export function NoBatch/);
  assert.match(kit, /this is a boundary, not an empty cohort/);
  for (const f of zonePages()) {
    const src = codeOnly(read(`${ZONE_DIR}/${f}`));
    assert.match(src, /<ZoneBody/, `${f} must use the shared four-state body`);
    assert.match(src, /catch \(e\)/, `${f} must catch its own read failure`);
  }
  // `available: false` from the worker is a failed Lab read, and treating it
  // as empty would report that failure as a batch with no progress.
  assert.match(codeOnly(read(`${ZONE_DIR}/ThisWeekZone.jsx`)), /data\.available === false/);
});

test('founder-sourced rows carry the seam mark and say whose record it is', () => {
  const kit = codeOnly(read(`${ZONE_DIR}/kit.jsx`));
  // SeamChip's contract is that it never appears alone — it always carries a
  // sentence naming that the data is read-only and whose it is.
  assert.match(kit, /SeamChip/);
  assert.match(kit, /belongs to the Lab and to the founder/);
  for (const f of ['FoundersZone.jsx', 'ThisWeekZone.jsx', 'OutcomesZone.jsx']) {
    assert.match(codeOnly(read(`${ZONE_DIR}/${f}`)), /FromTheLab/, `${f} must mark the seam`);
  }
});

test('Outcomes says it is the program, not the reader’s batch', () => {
  // The public Lab endpoints are company-level and deliberately anonymous, so
  // they cannot be narrowed to one advisor's cohort. Showing them is fine;
  // showing them under a heading that implies "my batch" would not be.
  const src = codeOnly(read(`${ZONE_DIR}/OutcomesZone.jsx`));
  assert.match(src, /This is the program, not your batch/);
  assert.match(src, /spinoutLab\.cohort\(\)/);
  assert.match(src, /spinoutLab\.graduates\(\)/);
});

test('each zone states what it cannot show, rather than leaving a blank', () => {
  // The canvas asked Founders for company, stage, a live signal and a next
  // action. The read returns name and email. An absent column is honest; an
  // empty one reads as a founder with nothing going on.
  assert.match(codeOnly(read(`${ZONE_DIR}/FoundersZone.jsx`)), /What this page cannot show/);
  assert.match(codeOnly(read(`${ZONE_DIR}/ThisWeekZone.jsx`)), /This is the batch's week, not yours/);
});

test('every Cohorts route carries the preview gate', () => {
  for (const z of ['founders', 'guidance', 'this-week', 'calendar', 'outcomes']) {
    const line = app.split('\n').find((l) => l.includes(`path="/cohorts/${z}"`));
    assert.ok(line && line.includes('preview={advisorRolePreview}'),
      `/cohorts/${z} reads the signed-in advisor's own assignments and must be gated`);
  }
});

test('the admin grant has a page, and no zone page can reach it', () => {
  assert.match(app, /path="\/admin\/advisor-cohorts"/);
  assert.match(app, /guard\(\['admin'\], <AdvisorCohortAssignments \/>\)/);
  assert.match(codeOnly(read('frontend/src/sidebarConfig.js')), /\/admin\/advisor-cohorts/);

  for (const m of ['adminAdvisorCohortAssignments', 'adminAssignableAdvisors',
    'adminAssignAdvisorCohort', 'adminEndAdvisorCohortAssignment']) {
    assert.ok(api.includes(`${m}:`), `api.${m} is missing`);
  }
  // The admin verbs sit with the other admin* helpers, not beside the
  // advisor's own me/cohort reads — a zone page must not be one import away
  // from granting somebody access to another person's batch.
  for (const f of zonePages()) {
    const src = codeOnly(read(`${ZONE_DIR}/${f}`));
    assert.doesNotMatch(src, /adminAssignAdvisorCohort|adminEndAdvisorCohortAssignment/,
      `${f} reaches an admin grant verb`);
  }
});

test('the Spin-Out Lab is untouched', () => {
  // The boundary that matters most in this bucket, and the one most likely to
  // erode by accretion. None of these may learn about the assignment table.
  for (const f of [
    'cloudflare-worker/src/routes/spinout_lab.ts',
    'cloudflare-worker/src/routes/admin_cohort.ts',
    'cloudflare-worker/src/services/cohortTiming.ts',
    'frontend/src/pages/admin/AdminSpinoutLab.jsx',
    'frontend/src/pages/admin/AdminCohortTiming.jsx',
    'frontend/src/pages/admin/AdminCohortApplications.jsx',
  ]) {
    const src = read(f);
    assert.doesNotMatch(src, /advisor_cohort_assignments|cohort-assignments/,
      `${f} is Lab-owned and must not know about advisor cohort assignments`);
  }
});
