/**
 * Practice · Opportunities — canvas PR1, `/practice/opportunities`.
 *
 * WHAT THIS FILE IS FOR. The artboard is a decision LOG, and every interesting
 * thing about it is a DERIVATION over two reads that already existed. There is
 * no new endpoint and no new table, so nothing on the server side can fail
 * loudly if a derivation is wrong — the page would simply report a different
 * number with the same confidence. These tests pin the derivations.
 *
 * The three that matter, and each is a decision that could plausibly have gone
 * the other way:
 *
 *   * EXPIRY IS DERIVED. No `expired` status exists. A booking still `pending`
 *     after its slot has STARTED is one the advisor never answered, which is
 *     the artboard's own point — "a decline preserves the referral, silence
 *     spends it". Get this wrong and silence reads as a refusal.
 *   * TWO CANCELLATIONS ARE NOT DECLINES. `routes/advisors.ts` writes
 *     `cancel_reason` itself as `slot_cancelled` and `capacity_race`. Counting
 *     either as a refusal makes the accept rate wrong in the advisor's favour
 *     or against it, depending on which way they lean.
 *   * THE MEDIAN IS NOT COMPUTED. There is no `decided_at`. `updated_at` is
 *     last-touched and Sessions moves it again on every billing edit, so a
 *     median off that column would report billing, not decisions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

// The pure module, not the page: importing the page pulls React and a `.css`
// through its component tree, which the loader cannot resolve. The split is
// deliberate — see `opportunityLog.js`'s own docblock.
import { classifyBooking, SYSTEM_CANCELS } from '../src/pages/advisor/practice/opportunityLog.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/advisor/practice/OpportunitiesZone.jsx');
const P = codeOnly(PAGE);
const ROUTES = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');

const NOW = Date.parse('2026-09-11T12:00:00Z');
const BEFORE = '2026-09-11T18:00:00Z';   // slot still ahead
const AFTER = '2026-09-11T06:00:00Z';    // slot already started

// An ADAPTED view, the shape `bookingView` emits — `startsAt`, not
// `slot_starts_at`. That the adapter fills it from the right key is
// `advisor_booking_contract.test.mjs`'s job, not this file's.
const booking = (over = {}) => ({ status: 'pending', cancel_reason: null, startsAt: BEFORE, ...over });

// ---------------------------------------------------------------------------
// The derivation itself
// ---------------------------------------------------------------------------
test('a request still pending before its slot is awaiting, and after it is expired', () => {
  assert.equal(classifyBooking(booking({ startsAt: BEFORE }), NOW), 'awaiting');
  assert.equal(classifyBooking(booking({ startsAt: AFTER }), NOW), 'expired',
    'the slot passed with no answer — silence, not a refusal');
});

test('every status that means the advisor said yes classifies as accepted', () => {
  for (const status of ['confirmed', 'completed', 'no_show']) {
    assert.equal(classifyBooking(booking({ status }), NOW), 'accepted', status);
  }
  // `no_show` is the one that could plausibly have gone the other way. The
  // advisor DID accept; what happened at the session belongs to Engagements.
  // The row carries the detail so the log does not quietly upgrade it.
  assert.match(PAGE, /Accepted, then recorded a no-show/);
});

test('the system-cancel set is exactly what the worker writes, not a guess', () => {
  // DERIVED FROM THE WORKER, not copied from it. `routes/advisors.ts` writes
  // `cancel_reason` itself in exactly two places; if a third is ever added,
  // the new reason would silently be counted as a DECLINE — an advisor
  // refusing work they never saw. This fails instead.
  const worker = read('cloudflare-worker/src/routes/advisors.ts');
  const written = new Set(
    [...worker.matchAll(/cancel_reason = (?:COALESCE\(cancel_reason, )?'([a-z_]+)'/g)].map((m) => m[1]),
  );
  assert.deepEqual([...written].sort(), [...SYSTEM_CANCELS].sort());
});

test('the two cancellations the WORKER writes are withdrawn, not declined', () => {
  for (const reason of ['slot_cancelled', 'capacity_race']) {
    assert.equal(classifyBooking(booking({ status: 'cancelled', cancel_reason: reason }), NOW),
      'withdrawn', reason);
  }
  // A reason a PERSON typed is a real decline.
  assert.equal(
    classifyBooking(booking({ status: 'cancelled', cancel_reason: 'Wanted implementation' }), NOW),
    'declined',
  );
  // ...and so is a cancellation with no reason at all: it is still an answer.
  assert.equal(classifyBooking(booking({ status: 'cancelled', cancel_reason: null }), NOW), 'declined');
});

test('the accept rate is over answered requests only', () => {
  // Reading the expression rather than re-implementing it: the denominator is
  // what makes this right or wrong, and it must exclude both the withdrawn
  // (not the advisor's answer) and the expired (no answer at all).
  assert.match(P, /const decided = counts\.accepted \+ counts\.declined;/);
  assert.doesNotMatch(P, /const decided = [^;]*counts\.(expired|withdrawn)/,
    'silence and a withdrawn slot are not decisions the advisor made');
  assert.match(P, /acceptRate = decided > 0/, 'and an empty denominator reports nothing, not 0%');
});

// ---------------------------------------------------------------------------
// What the page must NOT claim
// ---------------------------------------------------------------------------
test('the median decision tile says it is not recorded rather than deriving one', () => {
  assert.match(PAGE, /Median decision/);
  assert.match(PAGE, /No decision timestamp is stored/);
  // THE BAN IS ON THE ARITHMETIC, NOT THE WORD. "Median decision" is the
  // tile's own label, so banning /median/ fails against correct code — the
  // self-matching trap. What must not happen is `updated_at` being turned
  // into a NUMBER, which is the only way to take a median of it. The page may
  // still sort it as a string and format it for display, and does both.
  assert.doesNotMatch(P, /Date\.parse\([^)]*updated_at/,
    'parsing updated_at into a number is how a median off a last-touched column starts');
  assert.doesNotMatch(P, /Number\([^)]*updated_at/);
});

test('the queue is ordered by what expires first, not by what arrived', () => {
  assert.match(P, /queue = useMemo\(\(\) => rows\.filter\(\(r\) => r\.bucket === 'awaiting'\)\.sort/);
  // `created_at` is the arrival stamp. Sorting on it is the artboard's
  // explicit "not what arrived first".
  const sortBlock = P.slice(P.indexOf('const queue = useMemo'), P.indexOf('const soon'));
  assert.ok(sortBlock.includes('startsAt'), 'the slot start is the expiry clock');
  assert.ok(!sortBlock.includes('created_at'), 'arrival order is what the canvas rules out');
});

test('the absences are stated on the page, not silently omitted', () => {
  for (const claim of [
    /investor/i,                      // no investor path to a booking
    /referral|Referred by/i,          // no column records where a request came from
    /used 6/,                         // the artboard's template usage count
  ]) {
    assert.match(PAGE, claim, 'the artboard draws it and the schema cannot — say so');
  }
});

// ---------------------------------------------------------------------------
// Shape and wiring
// ---------------------------------------------------------------------------
test('the zone renders a body only — the shell is the workspace\'s job', () => {
  for (const forbidden of ['AdvisorWorkspaceShell', 'WorkerRail']) {
    assert.ok(!P.includes(forbidden), `${forbidden} would draw a second copy of the chrome`);
  }
  assert.match(P, /<ZoneBody/);
  // `loading=` must not be satisfied by an error: a failed read renders the
  // error, never an endless skeleton.
  assert.match(P, /loading=\{state\.loading\}/);
  assert.match(P, /error=\{state\.error\}/);
});

test('opportunities is mounted as its own page, not the legacy workspace', () => {
  const live = ROUTES.slice(ROUTES.indexOf('const LIVE = {'), ROUTES.indexOf('const ZONE = {'));
  assert.ok(!live.includes("'opportunities'"),
    'the legacy five-tab Advisory workspace is not this artboard');
  // ZONE is keyed by bucket, then by zone name — `'/practice': { opportunities: … }`.
  const zone = ROUTES.slice(ROUTES.indexOf('const ZONE = {'));
  const practice = zone.slice(zone.indexOf("'/practice': {"), zone.indexOf('},', zone.indexOf("'/practice': {")));
  assert.match(practice, /opportunities: PracticeOpportunitiesZone/);
  assert.match(ROUTES, /const PracticeOpportunitiesZone = lazy\(/, 'and it is actually imported');
});

test('the draft surface the page mounts is one the worker actually serves', () => {
  assert.match(PAGE, /surface="practice\/opportunities"/);
  const research = read('cloudflare-worker/src/routes/research.ts');
  const surfaces = research.slice(research.indexOf('DRAFT_SURFACES'));
  assert.ok(surfaces.includes("'practice/opportunities'"),
    'a ZoneDraft over a surface with no DRAFT_SURFACES key is a button that 404s');
});

test('a failed services read does not empty the log or claim the advisor has none', () => {
  // The templates are a SECOND source. An advisor with unreadable services
  // still has a decision log, and "could not be read" is not "you have none".
  assert.match(P, /servicesUnavailable/);
  assert.match(PAGE, /could not be read\. That is not a claim that you have none/);
});
