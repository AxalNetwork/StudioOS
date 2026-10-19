/**
 * Three chips that could not answer their own question, and the timestamp bug
 * that would have made two of them silently answer everything.
 *
 * `/validate/verdict`'s `As of last week` and `Changed this month`, and
 * `/validate/hypotheses`' `Recently moved`, were registered `unbuilt` under a
 * reason that was correct: a claim's verdict "is recomputed from its evidence on
 * every request and never stored, so no earlier state of the board exists to
 * compare against", and "snapshotting it is a change to the model, not a
 * predicate this row can carry". Since #180 an `unbuilt` entry draws a DISABLED
 * chip whose reason lives only in a hover title — inert rather than invisible,
 * which is better and is still not an answer. Migration 255 made the model
 * change; this pins what the SPA does with it.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_verdict_history.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RECENTLY_MOVED_DAYS, daysBefore, historyReaches, laneChangedSince,
  parseObserved, startOfMonth, verdictAsOf, verdictChangedSince,
} from '../src/lib/verdictHistory.js';
import { codeOnlyJsx } from './_codeOnly.mjs';

const src = (p) => codeOnlyJsx(readFileSync(resolve(process.cwd(), p), 'utf8'));

/** SQLite's shape: UTC, a space, no zone. */
const at = (s) => ({ observed_at: s });
const claim = (history, verdict, lane) => ({ history, verdict, lane });

const NOW = new Date('2026-09-14T12:00:00Z');

test('a SQLite timestamp is parsed, never compared as a string', () => {
  // THE BUG THIS PREVENTS LOOKS LIKE A WORKING FEATURE. `datetime('now')`
  // produces `2026-09-14 11:20:00` — a space — and `'T'` sorts AFTER `' '`, so
  // `'2026-09-14 11:20:00' < '2026-09-07T00:00:00.000Z'` is TRUE. A window
  // compared lexicographically would therefore include every row ever written,
  // and "changed this month" would be true for every claim, forever.
  // One second AFTER the boundary, written the way SQLite writes it.
  const sqlite = '2026-09-07 12:00:01';
  const boundary = daysBefore(NOW, 7).toISOString();   // 2026-09-07T12:00:00.000Z
  assert.ok(sqlite < boundary,
    'the trap this test exists for has stopped existing — re-derive the rule');

  const parsed = parseObserved(sqlite);
  assert.ok(parsed instanceof Date && !Number.isNaN(parsed.getTime()));
  assert.ok(parsed.getTime() > daysBefore(NOW, 7).getTime(),
    'parsed as UTC, the same timestamp is correctly AFTER the boundary — as a '
    + 'string it compared as before it, which would have put every row inside '
    + 'every window');
  assert.equal(parseObserved(null), null);
  assert.equal(parseObserved('not a date'), null);
});

test('a claim with nothing on record that far back is refused, not back-filled', () => {
  // THE WHOLE POINT OF THE REFUSAL. Showing today's verdict under "as of last
  // week" is a specific, confident, wrong answer — which is exactly what the
  // `unbuilt` reason was protecting against. `known: false` is how the view
  // leaves the claim out instead.
  const young = claim([at('2026-09-13 09:00:00')], 'validated', 'validated');
  assert.deepEqual(verdictAsOf(young, daysBefore(NOW, 7)), { known: false });
  assert.equal(verdictChangedSince(young, daysBefore(NOW, 7)), false,
    'a claim with no observation that old must not be reported as changed');
  assert.equal(laneChangedSince(young, daysBefore(NOW, 7)), false);

  // THE INVARIANT THE FIXTURES HAVE TO RESPECT: the board records BEFORE it
  // reads, so the last observation always equals the claim's current state. A
  // fixture whose current verdict has no matching final row describes a board
  // that cannot happen, and would test the predicate against fiction.
  const old = claim([
    { observed_at: '2026-09-01 09:00:00', verdict: 'unproven', lane: 'testing' },
    { observed_at: '2026-09-11 09:00:00', verdict: 'validated', lane: 'validated' },
  ], 'validated', 'validated');
  assert.deepEqual(verdictAsOf(old, daysBefore(NOW, 7)),
    { known: true, verdict: 'unproven', lane: 'testing' },
    'the view a week ago is the row in force then, not the newest one');
  assert.equal(verdictChangedSince(old, daysBefore(NOW, 7)), true);
});

test('the observation in force is the latest one at or before the moment', () => {
  const h = claim([
    { observed_at: '2026-09-01 09:00:00', verdict: 'unproven', lane: 'none' },
    { observed_at: '2026-09-05 09:00:00', verdict: 'unproven', lane: 'testing' },
    { observed_at: '2026-09-12 09:00:00', verdict: 'validated', lane: 'validated' },
  ], 'validated', 'validated');
  assert.equal(verdictAsOf(h, new Date('2026-09-03T00:00:00Z')).lane, 'none');
  assert.equal(verdictAsOf(h, new Date('2026-09-07T00:00:00Z')).lane, 'testing');
  assert.equal(verdictAsOf(h, new Date('2026-09-13T00:00:00Z')).lane, 'validated');
});

test('a lane move with no verdict move is what Recently moved reads', () => {
  // `laneFor` puts a claim in `none` until its first supporting interview lands
  // and in `testing` after — with `verdictFor` answering `unproven` throughout.
  // A chip about the board's columns that asked about verdicts would miss every
  // one of those, which is the most common move a board makes.
  const moved = claim([
    { observed_at: '2026-09-10 09:00:00', verdict: 'unproven', lane: 'none' },
    { observed_at: '2026-09-12 09:00:00', verdict: 'unproven', lane: 'testing' },
  ], 'unproven', 'testing');
  assert.equal(laneChangedSince(moved, daysBefore(NOW, RECENTLY_MOVED_DAYS)), true);
  assert.equal(verdictChangedSince(moved, daysBefore(NOW, RECENTLY_MOVED_DAYS)), false,
    'the verdict did not move, and the point is that the lane did');

  // A claim that has only ever been observed once has not moved. Counting its
  // first appearance would report every claim as recently moved for as long as
  // the record is younger than the window.
  const fresh = claim([{ observed_at: '2026-09-12 09:00:00', verdict: 'unproven', lane: 'none' }],
    'unproven', 'none');
  assert.equal(laneChangedSince(fresh, daysBefore(NOW, RECENTLY_MOVED_DAYS)), false);

  // THE BOUNDARY CASE THE PARSE EXISTS FOR. One second after the window opens,
  // written the way SQLite writes it: as an instant it is inside, as a string it
  // compares BEFORE the ISO boundary (space sorts under 'T') and would be
  // excluded. This is the only fixture where the two answers differ.
  const boundary = daysBefore(NOW, RECENTLY_MOVED_DAYS);
  const stamp = `${boundary.toISOString().slice(0, 10)} ${boundary.toISOString().slice(11, 19)}`;
  const [d, t] = stamp.split(' ');
  const justInside = claim([
    { observed_at: '2026-08-01 09:00:00', verdict: 'unproven', lane: 'none' },
    { observed_at: `${d} ${t.slice(0, 6)}${String(Number(t.slice(6)) + 1).padStart(2, '0')}`, verdict: 'unproven', lane: 'testing' },
  ], 'unproven', 'testing');
  assert.equal(laneChangedSince(justInside, boundary), true,
    'a move one second inside the window was excluded — the stamp is being '
    + 'compared as a string, and `2026-… …` sorts before `2026-…T…`');

  // And a move OUTSIDE the window is not recent.
  const oldMove = claim([
    { observed_at: '2026-07-01 09:00:00', verdict: 'unproven', lane: 'none' },
    { observed_at: '2026-07-03 09:00:00', verdict: 'unproven', lane: 'testing' },
  ], 'unproven', 'testing');
  assert.equal(laneChangedSince(oldMove, daysBefore(NOW, RECENTLY_MOVED_DAYS)), false);
});

test('`historyReaches` is what lets the page say when the record starts', () => {
  assert.equal(historyReaches(null, daysBefore(NOW, 7)), false,
    'no record at all cannot cover any window');
  assert.equal(historyReaches('2026-09-13 09:00:00', daysBefore(NOW, 7)), false);
  assert.equal(historyReaches('2026-09-01 09:00:00', daysBefore(NOW, 7)), true);
  assert.equal(historyReaches('2026-09-01 09:00:00', startOfMonth(NOW)), false,
    'the record starts nine hours into the month, so it does not cover the whole of it');
  assert.equal(historyReaches('2026-08-20 09:00:00', startOfMonth(NOW)), true);
});

// D704: 'all four verdict chips and all four hypothesis chips are live' read
// the `validate/verdict` and `validate/hypotheses` zone filters, which went with
// their zones. The three views now sit on Experiments and evidence's
// Hypotheses table, which validate_sections_d697 test 3 pins.

test('NO_VERDICT_SNAPSHOT is deleted, not reworded', () => {
  // THE ASSERTION THAT OUTLIVES THE OTHERS, and the file's own established
  // pattern: `NO_WEEK_STAMP`, `NO_CADENCE_STORE` and `NO_SESSION_RECORD` each
  // went the same way when their store arrived. A shared reason that survives
  // its own fix does not sit harmlessly — it gets cited by the next chip, and
  // then the next chip is refusing for a reason that stopped being true.
  const filters = src('frontend/src/workspaces/founderZoneFilters.js');
  assert.doesNotMatch(filters, /^const NO_VERDICT_SNAPSHOT/m,
    'the constant is back; migration 255 stores the snapshot it says does not exist');
  assert.doesNotMatch(filters, /unbuilt: NO_VERDICT_SNAPSHOT/,
    'a chip is refusing on a reason whose store now exists');
});

test('the Hypotheses section reads the history through the shared rules, not its own', () => {
  // One store, one set of predicates. D704 deleted the verdict zone and the
  // hypothesis board; #1659's section is where the views draw now, and a second
  // copy of "what was this on Tuesday" there is how it would start disagreeing
  // with the Worker's read about the same claim.
  const sections = src('frontend/src/pages/cycles/ValidateSections.jsx');
  assert.match(sections, /from '\.\.\/\.\.\/lib\/verdictHistory'/);
  assert.ok(sections.includes('historyReaches'), 'historyReaches is no longer used — the section has grown its own rule');
  assert.doesNotMatch(sections, /new Date\(String\([^)]*observed_at/,
    'the section parses an observation itself; `parseObserved` owns the space-vs-T trap');
});

test('the board carries the history and says when the record starts', () => {
  const route = src('cloudflare-worker/src/routes/founder_validate.ts');
  assert.match(route, /verdict_history_since: history\.since/,
    'the board must return when the record starts, or a window with no rows in it '
    + 'reads as "nothing changed" rather than "not recorded yet"');
  assert.match(route, /recordVerdictChanges\(env, projectId/);
  assert.match(route, /h\.history = /, 'the per-claim history must reach the page');
});
