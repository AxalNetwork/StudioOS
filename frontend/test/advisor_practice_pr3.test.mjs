/**
 * Practice · Delivery — canvas PR3, `/practice/delivery`.
 *
 * WHAT THIS FILE IS FOR. The store side is already driven against real SQLite by
 * `cloudflare-worker/test/advisor_deliverables_scope.test.ts`, including the one
 * invariant the whole zone rests on: no advisor route writes `opened_at`. What
 * that test cannot see is the half of the invariant that lives in the browser —
 * a button on this page, or a method in `api.js`, would break it just as
 * completely — and it cannot see a formatter that turns an absence into a
 * reassuring number.
 *
 * The five that matter, each a decision that could have gone the other way and
 * would fail silently if it had:
 *
 *   * NO CONTROL HERE MARKS ANYTHING OPENED. Three of four tiles report whether
 *     a client read something. Migration 208's header, inherited by 239, says
 *     `opened_at` is the client's to set; an advisor-side write would be the
 *     practice reporting a metric about itself. PR3c gives the founder the
 *     control, and this file holds the front end to the same rule.
 *   * A DRAFT HAS NO SEAM LINE. The artboard's sharpest row is "Not opened in 4
 *     days", and the row above it has never been sent. A seam under that row
 *     would put a reassuring line beneath the one thing needing no chasing —
 *     and, worse, the same line under the row that does.
 *   * `Median to open` IS NULL, NEVER ZERO, before the first open. "0 h" says a
 *     deliverable was read the instant it was sent (D56/D68).
 *   * THE CANVAS'S `Draft` CHIP MATCHES NO ROW IN ITS OWN FIXTURE. It is
 *     resolved to `not_started` rather than reproduced, so the chip answers.
 *   * A CONSENT CHIP IS DRAWN ON THE CANVAS AND NOT HERE, because nothing in
 *     this product records that a session was recorded with consent. The AI band
 *     above it is the same gap, and the artboard's own note says the gate
 *     working IS the feature.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

// The pure module, not the page: importing the page pulls React and a `.css`
// through its component tree, which the loader cannot resolve.
import {
  STATE_LABEL, STATE_TONE, daysSince, medianLabel, nudgeBody, nudgeTargets,
  seamLine, sentLine, shortMoment, versionCountLabel, versionTag,
} from '../src/pages/advisor/practice/deliveryTrail.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/advisor/practice/DeliveryZone.jsx');
const P = codeOnly(PAGE);
const TRAIL = read('frontend/src/pages/advisor/practice/deliveryTrail.js');
const ROUTES = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
const APP = read('frontend/src/App.jsx');
const API = read('frontend/src/lib/api.js');
const ACTIONS = read('frontend/src/workspaces/advisorZoneActions.js');
const FILTERS = read('frontend/src/workspaces/advisorZoneFilters.js');
const CANVAS = read('design/canvases/integrated/Advisor Detail · Practice.dc.html');

// The artboard, in its TWO halves, sliced so every canvas assertion below reads
// PR3 and not a neighbour that happens to share a word. `ART` is the markup —
// headings, the ops row, the row template — and `DATA` is the fixture the
// template loops over, which lives in the canvas's own data block further down
// the file. A single slice between the two `<section>` markers gets the markup
// only, and asserting a fixture value against it fails a page that is correct.
const ART = CANVAS.slice(CANVAS.indexOf('<section class="ab" id="pr3">'),
  CANVAS.indexOf('<section class="ab" id="pr4">'));
const DATA = CANVAS.slice(CANVAS.indexOf('// ── PR3 · Delivery ──'),
  CANVAS.indexOf('// ── PR4 · Sessions ──'));
assert.ok(ART.length > 1000 && DATA.length > 1000, 'both artboard halves must be found');

const version = (over = {}) => ({
  uid: 'v-1', version: 1, label: null, summary: null,
  sent_at: null, opened_at: null, signed_off_at: null, ...over,
});
const item = (over = {}) => ({
  id: 1, uid: 'd-1', title: 'Pricing tier model', client_name: 'Meridian Labs',
  engagement_id: 7, client_user_email: 'ops@meridian.example', state: 'not_started',
  version_count: 2, latest_version: version(), versions: [version()], ...over,
});

const NOW = Date.parse('2026-08-26T12:00:00Z');

// ---------------------------------------------------------------------------
// The invariant: the client gives the receipt, and the front end cannot forge it
// ---------------------------------------------------------------------------
test('nothing on the advisor side can mark a work product opened', () => {
  // TWO HALVES, AND THE WORKER TEST ONLY GUARDS ONE. A page that POSTed an open,
  // or an `api.js` method that offered to, would break D72 without touching a
  // single line the worker suite reads.
  //
  // The search is over `api.*` CALL NAMES rather than prose: this page's own
  // docblock has to be able to say the words "marks anything opened" to explain
  // why it does not, and an assertion that forbade the phrase would forbid the
  // explanation. That is the self-matching trap this repo keeps re-finding.
  const calls = [...P.matchAll(/api\.(\w+)/g)].map((m) => m[1]);
  assert.ok(calls.length > 0, 'the page must call the API at all');
  for (const name of calls) {
    assert.ok(!/open/i.test(name), `${name} looks like an open-receipt write from the advisor side`);
  }

  // AND THE CLIENT LIBRARY OFFERS NONE, so no future page can reach for one by
  // accident. Every advisor deliverable method is listed and none of them opens.
  const methods = [...API.matchAll(/^\s{2}(\w*[Aa]dvisorDeliverable\w*)\s*[:(]/gm)].map((m) => m[1]);
  assert.ok(methods.length >= 5, `expected the five deliverable methods, found ${methods.join(', ')}`);
  for (const name of methods) {
    assert.ok(!/open/i.test(name), `api.${name} would let the advisor stamp the client's receipt`);
  }
});

// ---------------------------------------------------------------------------
// The seam line — the artboard's sharpest row, and the one above it
// ---------------------------------------------------------------------------
test('a draft has no seam line, and a sent-unopened row says how long it has waited', () => {
  // NOT SENT: nothing to report. A line here is the failure mode — the artboard
  // draws the draft row in red precisely because nothing has gone out.
  assert.equal(seamLine(item({ state: 'not_started' }), NOW), null);
  assert.equal(seamLine(item({ latest_version: null }), NOW), null);

  // SENT, NOT OPENED: the canvas's own string shape, "Not opened in 4 days".
  const sent4 = item({ state: 'sent', latest_version: version({ sent_at: '2026-08-22T12:00:00Z' }) });
  assert.equal(seamLine(sent4, NOW), 'Not opened in 4 days');
  const sent1 = item({ state: 'sent', latest_version: version({ sent_at: '2026-08-25T12:00:00Z' }) });
  assert.equal(seamLine(sent1, NOW), 'Not opened in 1 day', 'singular, not "1 days"');

  // SENT TODAY: a wait of zero is not a wait, and "Not opened in 0 days" reads
  // as an accusation on the day it went out.
  const today = item({ state: 'sent', latest_version: version({ sent_at: '2026-08-26T09:00:00Z' }) });
  assert.equal(seamLine(today, NOW), 'Sent today, not opened yet');

  // OPENED: the day it was read, and the state pill above it agrees.
  const opened = item({
    state: 'opened',
    latest_version: version({ sent_at: '2026-08-19T12:00:00Z', opened_at: '2026-08-20T12:00:00Z' }),
  });
  assert.match(seamLine(opened, NOW), /^Opened /);
});

test('a wait is never negative, and an unparseable stamp is never a number', () => {
  // A CLOCK SKEW MUST NOT READ AS A NEGATIVE WAIT. `sent_at` comes from the
  // worker's `nowIso()` and `now` from the browser, so a stamp a few seconds in
  // the reader's future is ordinary, and "Not opened in -1 days" is not.
  assert.equal(daysSince('2026-08-27T12:00:00Z', NOW), 0);
  assert.equal(daysSince('2026-08-24T12:00:00Z', NOW), 2);
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince('not a date', NOW), null);
  assert.equal(shortMoment('not a date'), null, 'never the literal string "Invalid Date"');
  assert.equal(shortMoment(null), null);
  assert.ok(typeof shortMoment('2026-08-20T12:00:00Z') === 'string');
});

// ---------------------------------------------------------------------------
// The median — a real measurement here, and null before the first open
// ---------------------------------------------------------------------------
test('the median reads as hours, then days, and as nothing at all before the first open', () => {
  // NULL, NOT ZERO. `0 h` would say a deliverable was read the instant it was
  // sent; the endpoint returns null before any open for exactly this reason, and
  // the page renders `Not recorded` from it (D56/D68).
  assert.equal(medianLabel(null), null);
  assert.equal(medianLabel(undefined), null);
  assert.equal(medianLabel('nonsense'), null);
  // The canvas's own tile value is "19 h".
  assert.equal(medianLabel(19), '19 h');
  assert.equal(medianLabel(47.4), '47 h');
  // Past two days an hour count stops being readable.
  assert.equal(medianLabel(48), '2 d');
  assert.equal(medianLabel(60), '2.5 d');
  // A real zero is possible in principle and must not be swallowed by the
  // null check — a deliverable opened inside the same minute rounds to 0 h, and
  // that is a measurement rather than an absence.
  assert.equal(medianLabel(0), '0 h');
});

test('the tile renders the absence rather than a plausible zero', () => {
  // The page must pair the null with `Unrecorded`, not with `?? 0`, which is how
  // "nothing has been opened" becomes "opened instantly".
  assert.match(P, /medianLabel\(totals\.median_to_open_hours\) \?\? <Unrecorded>Not recorded<\/Unrecorded>/);
  assert.ok(!/medianLabel\([^)]*\)\s*\?\?\s*0/.test(P), 'a zero median is a false measurement');
});

// ---------------------------------------------------------------------------
// The version trail's own strings
// ---------------------------------------------------------------------------
test('a version renders its own name where it has one, and its order where it does not', () => {
  // The canvas's draft row carries `version:'v2 draft'` — a NAME the advisor
  // typed — while its others carry `v1`..`v4`, which is the ORDER. Migration 239
  // keeps them as separate columns; this is the fallback that makes one chip.
  assert.equal(versionTag(version({ version: 2, label: 'v2 draft' })), 'v2 draft');
  assert.equal(versionTag(version({ version: 4, label: '' })), 'v4');
  assert.equal(versionTag(version({ version: 4, label: '   ' })), 'v4', 'whitespace is not a name');
  assert.equal(versionTag(null), null);

  assert.equal(versionCountLabel(1), '1 version');
  assert.equal(versionCountLabel(4), '4 versions');
  assert.equal(versionCountLabel(0), '0 versions');

  // "Not sent" IS THE ARTBOARD'S OWN RED ROW, not an error state: a work product
  // whose latest version has never gone out is a draft.
  assert.equal(sentLine(version({ sent_at: null })), 'Not sent');
  assert.equal(sentLine(null), 'No version recorded');
  assert.match(sentLine(version({ sent_at: '2026-08-20T12:00:00Z' })), /^Sent /);
});

test('the draft row is the alarming one, as the canvas draws it', () => {
  // The canvas row style is red only for `state:'Not started'`; every other row
  // is the neutral hairline. A tone map that made `sent` the danger state would
  // shout at every row the client simply has not got to yet.
  assert.equal(STATE_TONE.not_started, 'danger');
  assert.notEqual(STATE_TONE.sent, 'danger');
  assert.equal(STATE_TONE.opened, 'ok');
  assert.deepEqual(Object.keys(STATE_LABEL).sort(), ['not_started', 'opened', 'sent']);
  // And the page tints that row rather than only labelling it.
  assert.match(P, /state === 'not_started'/);
});

// ---------------------------------------------------------------------------
// The nudge — the first advisor→client send, and who it cannot reach
// ---------------------------------------------------------------------------
test('the nudge targets exactly the unopened rows, and names the ones it cannot reach', () => {
  const rows = [
    item({ id: 1, state: 'sent', client_user_email: 'a@x.example' }),
    item({ id: 2, state: 'sent', client_user_email: null }),
    item({ id: 3, state: 'opened', client_user_email: 'c@x.example' }),
    item({ id: 4, state: 'not_started', client_user_email: 'd@x.example' }),
  ];
  const { reachable, missed } = nudgeTargets(rows);
  // OPENED AND DRAFT ROWS ARE NEITHER. A nudge about something already read is
  // noise, and one about something never sent is nonsense.
  assert.deepEqual(reachable.map((r) => r.id), [1]);
  assert.deepEqual(missed.map((r) => r.id), [2]);

  // THE MISSED SET IS THE ONE CASE THE STORE'S SEND RULE CANNOT PREVENT — an
  // engagement unlinked AFTER a send — and it is reported, never skipped
  // quietly. A bulk action that delivers to some of its set and drops the rest
  // in silence is worse than no button.
  assert.match(P, /targets\.missed\.length > 0/);
  assert.match(P, /cannot be nudged/);

  // AND IT CONFIRMS BEFORE IT SENDS: the op opens a card naming the recipients,
  // and a second button does the sending.
  assert.match(P, /setNudging\(true\)/);
  assert.match(P, /disabled: targets\.reachable\.length === 0/);
});

test('the nudge body names the work product and the version, and nothing is sent beyond the thread', () => {
  const body = nudgeBody(item({
    title: 'Board brief · Aug',
    latest_version: version({ version: 1, sent_at: '2026-08-22T12:00:00Z' }),
  }));
  assert.match(body, /Board brief · Aug/);
  assert.match(body, /\(v1\)/);
  // The channel is the inbox that already exists (migration 185), keyed on the
  // client's address, with the engagement as the subject.
  assert.match(P, /api\.messageStartThread\(/);
  assert.match(P, /subject_type: 'engagement'/);
  assert.match(P, /to_email: item\.client_user_email/);
});

// ---------------------------------------------------------------------------
// The canvas, read rather than remembered
// ---------------------------------------------------------------------------
test('the four tiles and five chips are the artboard\'s, in its order', () => {
  const tiles = [...DATA.matchAll(/label:'([^']+)', value:/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ['Work products', 'Unopened', 'Median to open', 'Never opened']);
  for (const label of tiles) {
    assert.match(P, new RegExp(`label="${label}"`), label);
  }

  const chips = /d_views: views\(\[([^\]]*)\]\)/.exec(DATA);
  assert.ok(chips, 'the artboard must declare its chip row');
  const labels = [...chips[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['All', 'Unopened', 'Opened', 'Draft', 'By client']);
  const row = FILTERS.slice(FILTERS.indexOf("'practice/delivery': ["));
  const declared = [...row.slice(0, row.indexOf('],')).matchAll(/canvas: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(declared, labels, 'the chip row must be the canvas\'s own, in order');
});

test('the canvas\'s Draft chip is resolved to a state the store can answer', () => {
  // THE CANVAS CONTRADICTS ITSELF HERE AND THE PAGE PICKS A SIDE. It offers a
  // `Draft` chip and defines a `Draft` pill, but its own draft row is
  // `state:'Not started'` — so the chip as drawn matches nothing. Migration 239
  // makes the state real: a latest version never sent IS the draft.
  assert.match(DATA, /version:'v2 draft', versions:'2 versions', sent:'Not sent', state:'Not started'/);
  assert.ok(!/state:'Draft'/.test(DATA), 'no row in the artboard carries the chip\'s own state');
  // The page maps the chip onto the state, in the page, where the chip row is
  // mounted — `profile_zone_filters.test.mjs` requires the page that declares a
  // filter live to be the page that names its key.
  assert.match(P, /filter === 'draft'\) return rows\.filter\(\(i\) => i\.state === 'not_started'\)/);
  assert.match(P, /filter === 'unopened'\) return rows\.filter\(\(i\) => i\.state === 'sent'\)/);
  // `by_client` REORDERS rather than narrows, as on Engagements.
  assert.match(P, /filter === 'by_client'/);
  assert.match(P, /localeCompare/);
});

test('the two ops are the canvas\'s strings, rendered without a split', () => {
  const ops = [...ART.matchAll(/class="bulk">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(ops, ['Bulk: nudge unopened', 'Export as client pack']);
  // BOTH FIT THE 24-CHARACTER CAP, unlike PR1's and PR2's, so neither needs the
  // `canvas:`/`label:` split and neither may have one — a split here would
  // render a string the canvas never drew for no reason at all.
  const block = ACTIONS.slice(ACTIONS.indexOf("'practice/delivery': ["));
  const entry = block.slice(0, block.indexOf('],') + 1);
  for (const op of ops) {
    assert.ok(op.length <= 24, `${op} is ${op.length} characters`);
    assert.ok(entry.includes(`label: '${op}'`), op);
  }
  assert.ok(!entry.includes('canvas:'), 'neither op needs the provenance split');
  // The nudge is a handler and the pack is an export (D67).
  assert.match(entry, /kind: 'handler', handler: 'nudgeUnopened'/);
  assert.match(entry, /kind: 'export'/);
});

test('the consent chip the canvas draws is not drawn here, and the page says why', () => {
  // The artboard's fifth row carries `consent:'From recorded session · consent
  // Aug 24'` and an `sc-if` to render it. Nothing in this product records that a
  // session was recorded, or that consent was given to record one, so a chip
  // saying so would be the page inventing the store the AI band needs.
  assert.match(DATA, /consent:'From recorded session/);
  assert.match(ART, /sc-if value="\{\{ i\.consent \}\}"/);
  assert.ok(!/From recorded session/.test(P), 'a consent chip over no consent store');
  // AND THE ABSENCE IS STATED RATHER THAN LEFT AS A MISSING ELEMENT: the AI band
  // becomes the five-piece account, and the zone's limits repeat it.
  for (const claim of [
    /Consent-gated at the source|consent-gated/,
    /Five pieces/,
    /There is no consent-gated session summary/,
  ]) {
    assert.match(PAGE, claim);
  }
  assert.ok(!/class="prop"/.test(P), 'the artboard\'s proposal band is not drawn');
});

test('the list card and the trail card carry the artboard\'s own headings', () => {
  assert.match(ART, /<span class="zt">All work products<\/span>/);
  assert.match(ART, /Version history and open state · only here/);
  assert.match(ART, /<span class="zt">Version trail<\/span>/);
  assert.match(P, /title="All work products"/);
  assert.match(P, /Version history and open state/);
  assert.match(P, /title="Version trail"/);
  // ROW CARDS, NOT A TABLE. This artboard draws no `class="th"` — it is a
  // collection of cards — and a table here would be a shape the canvas rejects.
  assert.ok(!/class="th"/.test(ART), 'PR3 draws no table header');
  assert.ok(!/<th/.test(P) && !/\bclassName="th"/.test(P), 'the zone renders row cards');
});

// ---------------------------------------------------------------------------
// The review loop that survived the replacement
// ---------------------------------------------------------------------------
test('the post-session review loop moved onto this page rather than being deleted', () => {
  // DECISION 1 OF THIS PR. `ROUTE_MAP` records that the loop came to Delivery
  // when `/office-hours` retired, as "its one capability that lived nowhere
  // else". An artboard that does not draw a working feature is not an
  // instruction to delete it; the legacy tab is a redirect now, so without this
  // section the capability would have gone with it.
  assert.match(P, /api\.fileAdvisorReview\(/);
  for (const tile of ['Sessions held', 'Reviewed', 'Average rating']) {
    assert.match(P, new RegExp(`label="${tile}"`), tile);
  }

  // AND ITS D56/D68 VIOLATION DID NOT COME WITH IT. The legacy page rendered an
  // em-dash for an absent average rating; absent is "Not recorded" with a
  // reason, never a dash that looks like a value.
  assert.match(P, /avg == null \? <Unrecorded>Not recorded<\/Unrecorded> : avg\.toFixed\(1\)/);
  const legacy = codeOnly(read('frontend/src/pages/advisor/advisory/DeliveryPage.jsx'));
  assert.ok(/—/.test(legacy), 'the legacy page is the one that renders the dash; this is its baseline');
  const avgBlock = P.slice(P.indexOf('label="Average rating"'), P.indexOf('label="Average rating"') + 400);
  assert.ok(!/—/.test(avgBlock), 'the ported tile must not carry the dash forward');
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
test('the zone mounts its own page, and the legacy workspace serves it no longer', () => {
  assert.match(ROUTES, /const PracticeDeliveryZone = lazy\(\(\) => import\('\.\.\/\.\.\/pages\/advisor\/practice\/DeliveryZone'\)\)/);
  const zone = ROUTES.slice(ROUTES.indexOf('const ZONE = {'));
  const practice = zone.slice(zone.indexOf("'/practice': {"), zone.indexOf('},', zone.indexOf("'/practice': {")));
  assert.match(practice, /delivery: PracticeDeliveryZone/);

  // THE LEGACY SET IS EMPTY AND STILL PRESENT. Emptying it is what moves the
  // zone; keeping the key and the `embedded` branch is what lets a bucket whose
  // zone IS served by its own workspace keep working, and what lets the three
  // canvas PRs' guards go on reading this block.
  const live = ROUTES.slice(ROUTES.indexOf('const LIVE = {'), ROUTES.indexOf('const ZONE = {'));
  assert.match(live, /'\/practice': new Set\(\[\]\)/);
  for (const slug of ['delivery', 'opportunities', 'engagements']) {
    assert.ok(!live.includes(`'${slug}'`), `${slug} must not be quoted anywhere in the LIVE block`);
  }

  // The blurb is the artboard's sentence, and the artboard is where it is read
  // from rather than remembered.
  const sub = /line-height:1\.5">([^<]+)<\/div>/.exec(ART);
  assert.ok(sub, 'the artboard must carry its own blurb');
  const blurb = ROUTES.slice(ROUTES.indexOf('const ZONE_BLURB = {'), ROUTES.indexOf('const LIVE = {'));
  assert.ok(blurb.includes(`delivery: '${sub[1]}'`), `the blurb must be the artboard's: ${sub[1]}`);

  // And the old URL redirects rather than answering the same question twice.
  assert.match(APP, /path="\/advisor\/advisory\/delivery" element=\{<Navigate to="\/practice\/delivery" replace \/>\}/);
});

test('the zone states its limits, including the one the store cannot remove', () => {
  for (const claim of [
    // The receipt's real limit: a client with no account can never open
    // anything, which is why the store refuses to send to one.
    /Axal account/,
    // The page does not write the receipt, and says so where the tiles are read.
    /nothing on this page marks a work product opened/,
  ]) {
    assert.match(PAGE, claim);
  }
  assert.match(PAGE, /StatedLimit/);
});

// ---------------------------------------------------------------------------
// The module's own split from its sibling
// ---------------------------------------------------------------------------
test('an instant is formatted locally, unlike the calendar days on Engagements', () => {
  // A REAL DISTINCTION, NOT AN INCONSISTENCY, and the module has to say which it
  // is. `engagementBoard.shortDay` string-parses `2026-11-04` because
  // `new Date('2026-11-04')` is midnight UTC and would render "Nov 3" for every
  // reader west of Greenwich. `sent_at` and `opened_at` are instants written by
  // `nowIso()`, so they genuinely have a local day and the reader's is right.
  assert.match(codeOnly(TRAIL), /toLocaleDateString/);
  // `codeOnly` IS LOAD-BEARING HERE. `engagementBoard.js` names
  // `toLocaleDateString` in the comment explaining why it does not call it, so a
  // raw search finds the word in the file that proves the opposite — the
  // self-matching trap, which this repo keeps re-finding. What must be absent is
  // the CALL.
  const board = codeOnly(read('frontend/src/pages/advisor/practice/engagementBoard.js'));
  assert.ok(!/toLocaleDateString/.test(board), 'a stored calendar day must not go through a local formatter');
  assert.match(TRAIL, /INSTANTS|instants/);
});
