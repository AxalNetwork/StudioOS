/**
 * #4645 (D4645) — Portfolio health tells its four source states apart, scores
 * only what it measured, and attributes activity to the right project.
 *
 * WHAT IS PINNED
 *   · A recorded zero is a figure; an unreadable store is not. They were the
 *     same value before this package.
 *   · An unreadable input means NO score, no badge and no intervention flag —
 *     and no snapshot row, since `score` is NOT NULL on that table.
 *   · A missing scoring snapshot is no longer scored 50. The remaining signals
 *     carry the score, with their weights renormalised, and the response names
 *     what was missing.
 *   · With every signal present the arithmetic is unchanged from the old
 *     `computeScore`, so this is not a re-scoring of the portfolio.
 *   · Activity is counted for the project asked about. `project=1` no longer
 *     collects `project=12`.
 *
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_health_sources_4645.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import {
  ACTIVITY_WINDOW_DAYS, PRESSURE_WEIGHT, WEIGHTS, badgeFor, healthOf, readHealthSources, scorable, scoreHealth,
} from '../src/services/portfolioHealthSources.ts';
import { absent, recorded } from '../src/services/sourceState.ts';

const SCHEMA = `
  CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, deleted_at TEXT);
  CREATE TABLE score_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, total_score INTEGER);
  CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, status TEXT);
  CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, action TEXT, details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

const NOW = Date.parse('2026-11-09T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

function fixture() {
  const { DB, db } = makeD1(SCHEMA);
  db.exec("INSERT INTO projects (id, uid, name) VALUES (1, 'p-1', 'One'), (12, 'p-12', 'Twelve'), (2, 'p-2', 'Two')");
  const env: any = { DB };
  return { env, db };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('a recorded zero and an unreadable store are different answers, and only the zero is a figure', async () => {
  const f = fixture();
  // Project 2 has no scoring snapshot, no tickets and no activity: every store
  // answered, and what they answered is nothing / zero.
  const quiet = await readHealthSources(f.env, 2, NOW);
  assert.equal(quiet.scoring.state, 'not_recorded', 'no snapshot is not recorded, not zero');
  assert.equal(quiet.scoring.value, null);
  assert.match(quiet.scoring.reason!, /^Not recorded/);
  assert.deepEqual([quiet.tickets.state, quiet.tickets.value], ['recorded', { open: 0, total: 0 }],
    'COUNT answered: no tickets is a recorded zero');
  assert.deepEqual([quiet.activity.state, quiet.activity.value], ['recorded', 0],
    'no activity in the window is a recorded zero');

  // The same reads against a table that is gone.
  f.db.exec('DROP TABLE tickets');
  const broken = await readHealthSources(f.env, 2, NOW);
  assert.equal(broken.tickets.state, 'unreadable', 'a failed read is unreadable');
  assert.equal(broken.tickets.value, null, 'and carries no value at all');
  assert.match(broken.tickets.reason!, /^Unreadable/);
  assert.ok(!/SQL|no such table/i.test(broken.tickets.reason!), 'the reason is written for a person, not the driver\'s text');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('an unreadable input means no score, no badge and no intervention', () => {
  const sources = {
    scoring: recorded(10),
    tickets: absent<{ open: number; total: number }>('unreadable', 'Unreadable — the tickets could not be read'),
    activity: recorded(0),
  } as any;
  const out = scoreHealth(sources);
  assert.equal(out.score, null, 'nothing is stated');
  assert.equal(out.badge, null);
  assert.equal(out.intervention, false, 'an intervention is never raised from a store nobody could read');
  assert.match(out.reason!, /Unreadable/);
  assert.match(out.reason!, /tickets/, 'the reason names the source that failed');
  assert.equal(scorable(out), false, 'so no snapshot is written');
  // A score of 10 with unreadable tickets would otherwise have been red +
  // intervention: the old code's `|| 0` made exactly that claim.
  assert.equal(badgeFor(10).intervention, true, 'which is what the figure would have produced');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a missing scoring snapshot is not scored 50: the signals that answered carry the score', () => {
  // 30 events in the window is a full activity part (100).
  const sources: any = { scoring: absent('not_recorded', 'Not recorded'), tickets: recorded({ open: 0, total: 0 }), activity: recorded(30) };
  const out = scoreHealth(sources);
  // Renormalised: activity's 0.3 carries the whole 0.9 measured share.
  assert.equal(out.score, 90, 'full activity alone reads 90, not 50*0.6 + 30');
  assert.equal(out.badge, 'green');
  assert.equal((out.drivers as any).scoring, null, 'and no figure is invented for the missing one');
  assert.equal((out.drivers as any).sources.scoring.state, 'not_recorded');
  assert.equal((out.drivers as any).measured_weight, 0.3333, 'the response says how much of the score was measured');

  // The old arithmetic would have been 50*0.6 + 100*0.3 = 60: a company with
  // no scoring snapshot at all was handed a passing figure built on 50.
  assert.notEqual(out.score, 60);

  // A dead-quiet company with no snapshot has nothing to score at all.
  const nothing = scoreHealth({ scoring: absent('not_recorded', 'Not recorded'), tickets: recorded({ open: 0, total: 0 }), activity: absent('not_recorded', 'Not recorded') } as any);
  assert.equal(nothing.score, null);
  assert.match(nothing.reason!, /nothing to score/);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('with every signal present the score is exactly what the old computeScore produced', () => {
  for (const [scoring, activity, open, total] of [[80, 15, 2, 10], [0, 0, 0, 0], [100, 30, 5, 5], [55, 7, 1, 3]] as const) {
    const sources: any = { scoring: recorded(scoring), tickets: recorded({ open, total }), activity: recorded(activity) };
    const scoringPart = Math.max(0, Math.min(100, scoring));
    const activityPart = Math.min(100, activity * 100 / 30);
    const pressure = total > 0 ? (open / total) * 100 : 0;
    const before = Math.max(0, Math.min(100, Math.round(scoringPart * 0.6 + activityPart * 0.3 - pressure * 0.1)));
    assert.equal(scoreHealth(sources).score, before, `scoring=${scoring} activity=${activity} tickets=${open}/${total}`);
  }
  // The weights this rests on, pinned so a change to them is deliberate.
  assert.deepEqual([WEIGHTS.scoring, WEIGHTS.activity, PRESSURE_WEIGHT, ACTIVITY_WINDOW_DAYS], [0.6, 0.3, 0.1, 30]);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('activity is counted for the project asked about, not every project whose id starts with it', async () => {
  const f = fixture();
  const ins = f.db.prepare('INSERT INTO activity_logs (project_id, action, details, created_at) VALUES (?,?,?,?)');
  // Recorded on the column, which is the exact answer.
  ins.run(1, 'a', '{}', ago(1));
  ins.run(12, 'a', '{}', ago(1));
  ins.run(12, 'a', '{}', ago(2));
  // Legacy rows that named the project only inside the details.
  ins.run(null, 'a', 'project=1 done', ago(1));
  ins.run(null, 'a', 'project=1', ago(1));
  ins.run(null, 'a', 'project=12 done', ago(1));
  // Outside the window.
  ins.run(1, 'a', '{}', ago(ACTIVITY_WINDOW_DAYS + 2));

  const one = await readHealthSources(f.env, 1, NOW);
  assert.equal(one.activity.value, 3, 'project 1: its own column row and its two legacy rows, and nothing of 12\'s');
  const twelve = await readHealthSources(f.env, 12, NOW);
  assert.equal(twelve.activity.value, 3, 'project 12: two column rows and its own legacy row');
  // The old substring match gave project 1 all six of the recent rows.
  assert.notEqual(one.activity.value, 6);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the window is the one the response states, and it is read from the source\'s own dates', async () => {
  const f = fixture();
  const ins = f.db.prepare('INSERT INTO activity_logs (project_id, action, details, created_at) VALUES (?,?,?,?)');
  ins.run(1, 'a', '{}', ago(0));
  ins.run(1, 'a', '{}', ago(ACTIVITY_WINDOW_DAYS - 1));
  ins.run(1, 'a', '{}', ago(ACTIVITY_WINDOW_DAYS + 1));
  const out = await healthOf(f.env, 1, NOW);
  assert.equal(out.sources.activity.value, 2, 'the row a day past the window is out');
  assert.equal((out.drivers as any).window_days, ACTIVITY_WINDOW_DAYS, 'and the response says what the window was');
});
