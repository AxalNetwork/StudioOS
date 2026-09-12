/**
 * Practice · Engagements — canvas PR2, `/practice/engagements`.
 *
 * WHAT THIS FILE IS FOR. Unlike PR1, this zone has a store of its own, and
 * `cloudflare-worker/test/advisor_engagements_scope.test.ts` already drives every
 * write against real SQLite. So the server side cannot lie quietly. What CAN is
 * the page: it renders a board over a lane vocabulary the worker owns, a date
 * line whose meaning changes per lane, and a control whose options must match
 * what the worker will accept. Each of those fails silently — a wrong date looks
 * like a date, and a button that 409s looks like a button.
 *
 * The four that matter, each a decision that could have gone the other way:
 *
 *   * THE LANE CONTROL OFFERS WHAT THE WORKER ACCEPTS, derived from the worker
 *     rather than copied. A signed engagement must never be offered "Ended":
 *     that ending is the renewal decision that went the wrong way, and the whole
 *     point of the store is that it lands in the denominator.
 *   * FIVE LANES, FOUR COLUMNS. `renewal_due` renders inside Signed in amber.
 *     Drawing it as a fifth column, or dropping it, are both wrong.
 *   * A CALENDAR DAY IS NOT AN INSTANT. `new Date('2026-11-04')` is midnight
 *     UTC, so every reader west of Greenwich would see the day before.
 *   * NO AI BAND. `class="prop"` is on PR1 and PR3 of this canvas and not here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

// The pure module, not the page: importing the page pulls React and a `.css`
// through its component tree, which the loader cannot resolve.
import {
  BOARD_LANES, SIGNED_LANES, boardLaneOf, canDecideRenewal, clientNote,
  dueLine, laneMoves, shapeNote, shortDay,
} from '../src/pages/advisor/practice/engagementBoard.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/advisor/practice/EngagementsZone.jsx');
const P = codeOnly(PAGE);
const ROUTES = read('frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx');
const WORKER = read('cloudflare-worker/src/routes/advisors.ts');
const APP = read('frontend/src/App.jsx');

const eng = (over = {}) => ({
  id: 1, client_name: 'Meridian Labs', lane: 'signed', shape: 'retainer',
  cycles: 1, outcome: 'active', term_ends_at: null, proposed_at: null, ended_at: null,
  ...over,
});

// ---------------------------------------------------------------------------
// The lane control, against the worker's own rules
// ---------------------------------------------------------------------------
test('the lane vocabulary is exactly the worker\'s, not a copy of it', () => {
  // DERIVED. A lane added to `ENGAGEMENT_LANES` and not to this page is a state
  // the board cannot draw; one added here and not there is a button that 400s.
  const m = /export const ENGAGEMENT_LANES = \[([^\]]*)\]/.exec(WORKER);
  assert.ok(m, 'the worker must export its lane vocabulary');
  const stored = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  // Every stored lane maps into one of the four columns, and every column is
  // reachable from some stored lane.
  const columns = BOARD_LANES.map((l) => l.key);
  for (const lane of stored) {
    assert.ok(columns.includes(boardLaneOf(lane)), `${lane} maps to no board column`);
  }
  assert.deepEqual([...new Set(stored.map(boardLaneOf))].sort(), [...columns].sort());
  // FIVE STORED, FOUR DRAWN — the one that folds is `renewal_due`, and it folds
  // into Signed. If the canvas ever gives it a column this assertion is the
  // place that says so.
  assert.equal(stored.length, 5);
  assert.equal(columns.length, 4);
  assert.equal(boardLaneOf('renewal_due'), 'signed');
});

test('a signed engagement is never offered a move to Ended', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. The worker answers 409 on that move and
  // names the renewal route; offering the button anyway puts a control on the
  // page whose only outcome is an error — and the reason it errors is that the
  // move would take a lost renewal out of the rate's denominator.
  for (const lane of ['signed', 'renewal_due']) {
    assert.ok(!laneMoves(lane).includes('ended'), lane);
  }
  // And the worker is the authority for that rule, not this test's memory of it.
  assert.match(WORKER, /if \(lane === 'ended' && SIGNED_LANES\.has\(row\.lane\)\) \{/);
});

test('an unsigned engagement may be abandoned from the board, because that is not a lost renewal', () => {
  for (const lane of ['drafting', 'proposed']) {
    assert.ok(laneMoves(lane).includes('ended'), lane);
  }
});

test('an ended engagement offers no move at all, rather than a disabled one', () => {
  assert.deepEqual(laneMoves('ended'), []);
  // A greyed control implies there is a move to make. The card renders the row
  // of buttons only when there is one.
  assert.match(P, /\{moves\.length > 0 && \(/);
});

test('every lane move the control offers is one the worker will accept', () => {
  // The worker's rules, restated as a predicate and checked against every pair
  // rather than against the three cases a reader happens to think of.
  const lanes = ['drafting', 'proposed', 'signed', 'renewal_due', 'ended'];
  for (const from of lanes) {
    for (const to of laneMoves(from)) {
      assert.ok(lanes.includes(to), `${from} → ${to} is not a lane`);
      assert.notEqual(from, 'ended', 'ended is terminal in the worker');
      if (SIGNED_LANES.has(from)) {
        assert.notEqual(to, 'ended', `${from} → ended must go through the renewal route`);
      }
    }
  }
  // `canDecideRenewal` and the offered moves must agree about which rows are
  // under contract, or the page would show a renewal form where the worker
  // refuses one.
  for (const lane of lanes) {
    assert.equal(canDecideRenewal(lane), SIGNED_LANES.has(lane), lane);
  }
});

// ---------------------------------------------------------------------------
// The date line — five forms, and a timezone trap
// ---------------------------------------------------------------------------
test('a calendar day is parsed from the string, never through Date', () => {
  assert.equal(shortDay('2026-11-04'), 'Nov 4');
  assert.equal(shortDay('2026-01-01'), 'Jan 1');
  assert.equal(shortDay(''), null);
  assert.equal(shortDay(null), null);
  assert.equal(shortDay('next November'), null);
  // THE BUG THIS GUARDS. `new Date('2026-11-04')` is midnight UTC, so
  // `toLocaleDateString` in any negative offset renders Nov 3 — a contract that
  // renews on the 4th would read as the 3rd for every reader in the Americas.
  // These are days an advisor typed, not instants, so no timezone gets a say.
  const src = codeOnly(read('frontend/src/pages/advisor/practice/engagementBoard.js'));
  assert.doesNotMatch(src, /new Date\(/);
  assert.doesNotMatch(src, /toLocaleDateString/);
});

test('the date line says something different in every lane, and never invents a date', () => {
  assert.equal(dueLine(eng({ lane: 'drafting' })), 'Not sent');
  assert.equal(dueLine(eng({ lane: 'proposed', proposed_at: '2026-08-21' })), 'Sent Aug 21');
  assert.equal(dueLine(eng({ lane: 'signed', term_ends_at: '2026-11-04' })), 'Renews Nov 4');
  // RENEWS vs ENDS IS `lane`'S JOB. Both read `term_ends_at`; which one it means
  // is why the store keeps `renewal_due` instead of comparing the date against a
  // clock that moves under it.
  assert.equal(dueLine(eng({ lane: 'renewal_due', term_ends_at: '2026-08-29' })), 'Ends Aug 29');
  assert.equal(dueLine(eng({ lane: 'ended', ended_at: '2026-06-30' })), 'Ended Jun 30');
  // A MISSING DATE SAYS SO. An engagement whose term end was never recorded is
  // not one that renews today.
  assert.equal(dueLine(eng({ lane: 'signed', term_ends_at: null })), 'No term end recorded');
  assert.equal(dueLine(eng({ lane: 'proposed', proposed_at: null })), 'Sent, date not recorded');
  assert.equal(dueLine(eng({ lane: 'ended', ended_at: null })), 'Ended, date not recorded');
});

test('a per-call engagement reads as per-call, and still shows a date it has', () => {
  // The canvas's Thornbury card: shape per_call, no term, due line "Per call".
  assert.equal(dueLine(eng({ shape: 'per_call', term_ends_at: null })), 'Per call');
  // ...and nothing stored is dropped on the floor if one has a date anyway.
  assert.equal(dueLine(eng({ shape: 'per_call', term_ends_at: '2026-09-11' })), 'Per call · renews Sep 11');
});

// ---------------------------------------------------------------------------
// The tiles
// ---------------------------------------------------------------------------
test('the Active tile note is the shape breakdown, and a zero is dropped rather than printed', () => {
  // The canvas's own note, from the counts the endpoint returns.
  assert.equal(shapeNote({ retainer: 2, sprint: 1, equity: 1, per_call: 1 }),
    '2 retainers, 1 sprint, 1 equity, 1 per-call');
  // `equity` AND `per-call` DO NOT PLURALISE, which the canvas string confirms.
  assert.equal(shapeNote({ equity: 3, per_call: 2 }), '3 equity, 2 per-call');
  assert.equal(shapeNote({ retainer: 0, sprint: 0, equity: 0, per_call: 0 }), null,
    'an all-zero breakdown is no breakdown, not a row of zeroes');
  assert.equal(shapeNote(undefined), null);
});

test('Active counts lanes, not outcomes, and the page reads the totals the worker computed', () => {
  // The canvas comment, enforced on the page this time: "A draft that was never
  // sent and a proposal awaiting an answer are not engagements." A RENEWED
  // contract is the most active thing on the board and its outcome is
  // 'renewed', so an outcome filter would under-report by the best clients.
  assert.match(P, /label="Active" value=\{totals\.active \?\? 0\}/);
  assert.doesNotMatch(P, /label="Active"[^/]*outcome === 'active'/);
  // And the rate comes from the endpoint, which is where its denominator is
  // argued — not re-derived here, where the two could disagree.
  assert.match(P, /totals\.renewal_rate == null \? <Unrecorded>/);
  assert.doesNotMatch(P, /renewed \/ decided/);
});

test('a rate with no decision behind it reports nothing, never 0%', () => {
  // D56/D68. A practice that has not reached its first renewal has not failed
  // to renew, and the worker returns null for exactly that reason.
  assert.match(P, /totals\.renewal_rate == null/);
  assert.doesNotMatch(P, /renewal_rate \?\? 0/);
  assert.doesNotMatch(P, /renewal_rate \|\| 0/);
});

test('a tile note names one client and counts several, rather than printing a list', () => {
  assert.equal(clientNote([{ client_name: 'Novacraft Labs', term_ends_at: '2026-08-29' }], 'ends'),
    'Novacraft Labs, ends Aug 29');
  assert.equal(clientNote([{ client_name: 'Novacraft Labs' }], 'ends'), 'Novacraft Labs',
    'and with no date it names the client without inventing one');
  assert.equal(clientNote([{ client_name: 'A' }, { client_name: 'B' }], 'ends'), '2 clients');
  assert.equal(clientNote([], 'ends'), null);
  assert.equal(clientNote(undefined, 'ends'), null);
});

// ---------------------------------------------------------------------------
// One record, three projections
// ---------------------------------------------------------------------------
test('there is ONE fetch, because the canvas says one record', () => {
  // "ONE engagement record: the board, renewal history and scope all derive
  // from it." Three fetches would let the three views disagree.
  const calls = [...P.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]);
  const reads = calls.filter((n) => n.startsWith('list') || n.startsWith('get'));
  assert.deepEqual(reads, ['listMyAdvisorEngagements']);
});

test('every write the page makes is a method the api layer actually has', () => {
  const apiSrc = read('frontend/src/lib/api.js');
  for (const name of [...new Set([...P.matchAll(/api\.(\w+)\(/g)].map((m) => m[1]))]) {
    assert.match(apiSrc, new RegExp(`\\b${name}:`), `api.js has no ${name}`);
  }
});

test('the renewal history lists every engagement that ran a term, not only the renewed ones', () => {
  // `cycles > 0` is the canvas's own filter and it is the honest one: an
  // engagement that ended after two cycles belongs in the history that judges
  // the practice. Filtering on an outcome would hide the failures.
  assert.match(P, /ordered\.filter\(\(e\) => Number\(e\.cycles \|\| 0\) > 0\)/);
  assert.doesNotMatch(P, /renewals = useMemo\([^;]*outcome === 'renewed'/);
});

test('the scope card shows contracts, not drafts', () => {
  // The canvas takes the first three ACTIVE engagements. A draft carries a
  // proposal, which is not terms both sides hold.
  assert.match(P, /scopes = useMemo\(\(\) => visible\.filter\(\(e\) => SIGNED_LANES\.has\(e\.lane\)\)\.slice\(0, 3\)/);
});

test('an exclusion nobody wrote reads as not recorded, never as an em-dash', () => {
  // The canvas fixture literally renders `—` for an ended row's exclusion.
  // D56/D68: this page may not. The dash also must not sneak in as a fallback.
  assert.match(P, /<Unrecorded>No exclusion recorded<\/Unrecorded>/);
  assert.doesNotMatch(P, /scope_excludes \|\| '—'/);
  assert.doesNotMatch(P, /scope_excludes \|\| '-'/);
  // And it keeps its own colour, because the canvas gives exclusions one: they
  // are the half of a scope that does the work.
  const scopeBlock = P.slice(P.indexOf('title="Scope on file"'), P.indexOf('Exclusions are stored'));
  assert.match(scopeBlock, /text-amber-700/);
});

test('the by-client chip reorders and does not narrow', () => {
  // Every other chip in these tables filters. A chip called "By client" that
  // dropped rows would be lying about what it did — and an empty result from a
  // filter reads as an answer, which is the failure `zoneFilterBuilder`'s own
  // docblock is about.
  assert.match(P, /const byClient = filter === 'by_client';/);
  assert.match(P, /localeCompare/);
  const narrowing = P.slice(P.indexOf('const visible = useMemo'), P.indexOf('const totals ='));
  assert.ok(!narrowing.includes('by_client'),
    'by_client must not appear in the narrowing memo — it is a sort');
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

test('every board lane carries its own empty state', () => {
  // The canvas fixture never shows one, because its data fills all four lanes —
  // which is exactly why this is easy to ship without. A lane with no cards and
  // no sentence reads as a rendering failure.
  assert.match(P, /Nothing here\./);
  const laneBlock = P.slice(P.indexOf('BOARD_LANES.map'), P.indexOf('</Card>', P.indexOf('BOARD_LANES.map')));
  assert.match(laneBlock, /cards\.length === 0/);
});

test('the page draws no AI band, because this artboard specifies none', () => {
  // `class="prop"` appears on PR1 and PR3 of this canvas and not on PR2. A
  // draft panel here would be an instrument the artboard does not draw.
  assert.ok(!P.includes('ZoneDraft'), 'PR2 has no proposal band on the canvas');
  const canvas = read('design/canvases/integrated/Advisor Detail · Practice.dc.html');
  const pr2 = canvas.slice(canvas.indexOf('id="pr2"'), canvas.indexOf('id="pr3"'));
  assert.ok(!pr2.includes('class="prop"'), 'the canvas would have to change first');
});

test('engagements is mounted as its own page, and left the legacy workspace', () => {
  const live = ROUTES.slice(ROUTES.indexOf('const LIVE = {'), ROUTES.indexOf('const ZONE = {'));
  assert.ok(!live.includes("'engagements'"),
    'the legacy five-tab Advisory workspace is a session list, not this artboard');
  const zone = ROUTES.slice(ROUTES.indexOf('const ZONE = {'));
  const practice = zone.slice(zone.indexOf("'/practice': {"), zone.indexOf('},', zone.indexOf("'/practice': {")));
  assert.match(practice, /engagements: PracticeEngagementsZone/);
  assert.match(ROUTES, /const PracticeEngagementsZone = lazy\(/, 'and it is actually imported');
});

test('both replaced legacy routes redirect rather than serving a second answer', () => {
  // Decision 1 of this series: each legacy tab becomes a redirect in the PR that
  // replaces it. PR1 shipped its zone and left `/advisor/advisory/opportunities`
  // serving the old inbox, so two pages answered the same question with
  // different instruments. Both are redirects now.
  for (const slug of ['opportunities', 'engagements']) {
    assert.match(APP, new RegExp(
      `path="/advisor/advisory/${slug}" element=\\{<Navigate to="/practice/${slug}" replace />\\}`,
    ), slug);
  }
  // Delivery still serves the workspace — its artboard has not landed.
  assert.match(APP, /path="\/advisor\/advisory\/delivery" element=\{guard\(/);
  // And the workspace's own default tab is not a redirect, which would bounce
  // twice.
  assert.match(APP, /path="\/advisor\/advisory" element=\{<Navigate to="\/advisor\/advisory\/clients" replace \/>\}/);
});

test('the zone blurb is the artboard\'s, with no claim about the reader\'s own book', () => {
  // The canvas blurb says "including the two that ended". Two is the fixture's
  // count; printed here it would be a figure about this advisor's clients.
  const blurb = ROUTES.slice(ROUTES.indexOf('const ZONE_BLURB = {'), ROUTES.indexOf('const LIVE = {'));
  assert.match(blurb, /engagements: 'Every client with their scope, contract state and renewal date/);
  assert.match(blurb, /because a practice is judged on renewals/);
  assert.ok(!/including the two that ended/.test(blurb), 'a fixture count is not this advisor\'s data');
});

test('the page states what it cannot do, including the divergence it chose', () => {
  for (const claim of [
    /Nothing sends a renewal notice/,
    /a name here, and a platform account only sometimes/,
    /advances by control, not by drag/,
  ]) {
    assert.match(PAGE, claim);
  }
});
