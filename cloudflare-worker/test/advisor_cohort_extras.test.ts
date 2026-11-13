/**
 * The three numbers Cohorts · Guidance and · Calendar are most likely to lie
 * about, and the schema that backs them.
 *
 * Each of these fails silently. A median over nothing renders "0h" and reads as
 * an instant reply. A collision rule one notch too loose reports four conflicts
 * a week, every week, and the advisor stops believing the tile. A window
 * treated as an obligation does the same thing in reverse. None of it throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  guidanceCounts, oldestOpenHours, collisions, withinDays,
  type GuidanceRow, type CalendarItem,
} from '../src/routes/_advisor_cohort_helpers.ts';

const SQL = readFileSync(
  join(resolve(process.cwd()), 'cloudflare-worker', 'sql', 'migrations', '212_cohort_guidance.sql'),
  'utf8',
);
const ddl = (s: string) => s.replace(/^\s*--[^\n]*$/gm, '');

const g = (o: Partial<GuidanceRow>): GuidanceRow => ({
  id: 1, asked_by_user_id: null, answer: null,
  posted_at: '2026-09-01T09:00:00Z', answered_at: null, retired_at: null, ...o,
});

test('a median over nothing answered is NOT RECORDED, never zero', () => {
  // The assertion this file exists for. "0h" beside "Median response" reads as
  // an instant reply to every question — the most flattering possible reading
  // of having answered none of them.
  const none = guidanceCounts([g({ asked_by_user_id: 5 })]);
  assert.equal(none.medianResponseHours, null);
  assert.equal(none.open, 1);
  assert.equal(none.answered, 0);
  assert.equal(guidanceCounts([]).medianResponseHours, null);
});

test('broadcast guidance is never open and never overdue', () => {
  // `asked_by_user_id IS NULL` is the advisor posting unprompted. It has no
  // asker, so it cannot be awaiting a reply — counting it as open would report
  // an advisor as behind on their own notes.
  const c = guidanceCounts([g({}), g({ id: 2 }), g({ id: 3, asked_by_user_id: 5 })]);
  assert.equal(c.broadcast, 2);
  assert.equal(c.open, 1);
  assert.equal(oldestOpenHours([g({}), g({ id: 2 })], '2026-09-30T09:00:00Z'), null,
    'unprompted guidance is not an unanswered question, however old');
});

test('the median is a real median, and retired rows leave the arithmetic', () => {
  const rows = [
    g({ id: 1, asked_by_user_id: 5, answer: 'a', posted_at: '2026-09-01T00:00:00Z', answered_at: '2026-09-01T02:00:00Z' }),
    g({ id: 2, asked_by_user_id: 6, answer: 'b', posted_at: '2026-09-01T00:00:00Z', answered_at: '2026-09-01T06:00:00Z' }),
    g({ id: 3, asked_by_user_id: 7, answer: 'c', posted_at: '2026-09-01T00:00:00Z', answered_at: '2026-09-01T10:00:00Z' }),
  ];
  assert.equal(guidanceCounts(rows).medianResponseHours, 6);
  // Even count → mean of the middle two.
  assert.equal(guidanceCounts(rows.slice(0, 2)).medianResponseHours, 4);
  // A retired row is gone from every count, including the median.
  const withRetired = [...rows, g({ id: 4, asked_by_user_id: 8, retired_at: '2026-09-02T00:00:00Z' })];
  assert.equal(guidanceCounts(withRetired).open, 0, 'a retired question is not open');
  assert.equal(guidanceCounts(withRetired).medianResponseHours, 6);
});

test('the oldest open question is a fact; "overdue" is not computed at all', () => {
  const rows = [
    g({ id: 1, asked_by_user_id: 5, posted_at: '2026-09-01T00:00:00Z' }),
    g({ id: 2, asked_by_user_id: 6, posted_at: '2026-09-02T00:00:00Z' }),
    g({ id: 3, asked_by_user_id: 7, answer: 'done', posted_at: '2026-08-01T00:00:00Z', answered_at: '2026-08-01T01:00:00Z' }),
  ];
  assert.equal(oldestOpenHours(rows, '2026-09-03T00:00:00Z'), 48);
  // Nothing here returns an "overdue" count. The canvas draws one against a
  // "24h commitment" that nothing stores; deriving it from the canvas's example
  // would report an advisor as having broken a promise they never made.
  assert.ok(!Object.keys(guidanceCounts(rows)).includes('overdue'));
});

// ---------------------------------------------------------------------------

const item = (o: Partial<CalendarItem>): CalendarItem => ({
  kind: 'client', title: 't', starts_at: '2026-09-10T10:00:00Z',
  ends_at: '2026-09-10T11:00:00Z', ref: 'r', ...o,
});

test('a week window is not a collision — the failure that would cry wolf weekly', () => {
  // Every client slot in the month falls inside some Lab week. If overlapping a
  // WINDOW counted, this tile would read four collisions a week forever and the
  // advisor would learn to ignore it.
  const weekWindow = item({
    kind: 'cohort', title: 'Week 2', starts_at: '2026-09-08T00:00:00Z', ends_at: null,
  });
  const slot = item({ starts_at: '2026-09-10T10:00:00Z', ends_at: '2026-09-10T11:00:00Z' });
  assert.deepEqual(collisions([weekWindow, slot]), [],
    'a deadline outside the slot is not a clash');
});

test('an obligation landing inside a booked slot IS a collision', () => {
  const deadline = item({
    kind: 'cohort', title: 'Week 2 deadline', starts_at: '2026-09-10T10:30:00Z', ends_at: null,
  });
  const slot = item({ starts_at: '2026-09-10T10:00:00Z', ends_at: '2026-09-10T11:00:00Z' });
  assert.deepEqual(collisions([deadline, slot]), [[0, 1]]);
  // Two booked slots that overlap each other.
  const a = item({ starts_at: '2026-09-11T10:00:00Z', ends_at: '2026-09-11T11:00:00Z' });
  const b = item({ starts_at: '2026-09-11T10:30:00Z', ends_at: '2026-09-11T11:30:00Z' });
  assert.deepEqual(collisions([a, b]), [[0, 1]]);
});

test('two instants never collide — and the strict comparison is what does it', () => {
  // Two deadlines at the same minute is not a scheduling conflict — it is two
  // cohorts whose weeks end together, which is every cohort.
  const d1 = item({ kind: 'cohort', starts_at: '2026-09-10T23:59:00Z', ends_at: null });
  const d2 = item({ kind: 'demo_day', starts_at: '2026-09-10T23:59:00Z', ends_at: null });
  assert.deepEqual(collisions([d1, d2]), []);
  assert.deepEqual(collisions([d1, item({ kind: 'cohort', starts_at: '2026-09-12T00:00:00Z', ends_at: null })]), []);

  // THIS TEST CAUGHT A REDUNDANT GUARD RATHER THAN A BUG, and the note is worth
  // keeping. `collisions` used to open with `if (xInstant && yInstant) continue`
  // — deleting it left every assertion here passing, because an instant is
  // `[s, s]` and the strict `<` on both sides already excludes any pair of
  // them. The guard was removed; this case is still pinned, but by the
  // comparison rather than by a special case that only looked load-bearing.
  // The mutation below is the one that would matter: a non-strict comparison.
  const touching = [
    item({ starts_at: '2026-09-10T10:00:00Z', ends_at: '2026-09-10T11:00:00Z' }),
    item({ starts_at: '2026-09-10T11:00:00Z', ends_at: '2026-09-10T12:00:00Z' }),
  ];
  assert.deepEqual(collisions(touching), [],
    'loosening either comparison to <= makes instants and back-to-back slots collide');
});

test('touching is not overlapping', () => {
  const a = item({ starts_at: '2026-09-10T10:00:00Z', ends_at: '2026-09-10T11:00:00Z' });
  const b = item({ starts_at: '2026-09-10T11:00:00Z', ends_at: '2026-09-10T12:00:00Z' });
  assert.deepEqual(collisions([a, b]), [], 'back-to-back sessions are not a clash');
});

test('the window is forward-looking and ordered', () => {
  const past = item({ starts_at: '2026-09-01T10:00:00Z', ends_at: null });
  const soon = item({ starts_at: '2026-09-11T10:00:00Z', ends_at: null });
  const later = item({ starts_at: '2026-09-20T10:00:00Z', ends_at: null });
  const beyond = item({ starts_at: '2026-10-30T10:00:00Z', ends_at: null });
  const got = withinDays([beyond, later, soon, past], '2026-09-10T00:00:00Z', 14);
  assert.deepEqual(got.map((i) => i.starts_at),
    ['2026-09-11T10:00:00Z', '2026-09-20T10:00:00Z'],
    'past items are gone, far items are gone, the rest are in time order');
});

// ---------------------------------------------------------------------------

test('migration 212 is replayable and D1 will accept it', () => {
  const code = ddl(SQL);
  assert.deepEqual(code.match(/CREATE TABLE(?! IF NOT EXISTS)/g) || [], []);
  assert.deepEqual(code.match(/CREATE (?:UNIQUE )?INDEX(?! IF NOT EXISTS)/g) || [], []);
  assert.doesNotMatch(SQL, /\b(BEGIN|COMMIT|ROLLBACK)\s+TRANSACTION\b/i);
  // Fully idempotent, unlike 211 — no ALTER at all, so this one IS replayable
  // and the assertion above is the whole claim.
  assert.doesNotMatch(code, /ALTER TABLE/i);
});

test('nothing derived is stored, and the two nullable columns are the design', () => {
  const code = ddl(SQL);
  for (const banned of [/\bstatus\s+TEXT/i, /\bis_open\b/i, /\bis_overdue\b/i,
    /\bresponse_hours\b/i, /\back_count\b/i]) {
    assert.doesNotMatch(code, banned, `${banned} is computable from the rows`);
  }
  // `asked_by_user_id` must stay nullable — NULL is the advisor's own post, and
  // a NOT NULL here would make broadcast guidance unstorable.
  assert.match(code, /asked_by_user_id INTEGER REFERENCES users\(id\)/);
  assert.doesNotMatch(code, /asked_by_user_id[^,]*NOT NULL/i);
  assert.match(code, /week_number INTEGER/);
  assert.doesNotMatch(code, /week_number[^,]*NOT NULL/i);
});

test('the migration runs, and an ack cannot be recorded twice', () => {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE cohort_cycles (id INTEGER PRIMARY KEY, year INTEGER, month INTEGER,
      start_at TEXT, end_at TEXT, status TEXT);
    INSERT INTO users (id, name) VALUES (70, 'Advisor'), (72, 'Founder');
    INSERT INTO cohort_cycles (id, year, month, start_at, end_at, status)
      VALUES (9, 2026, 9, '2026-09-01T00:00:00Z', '2026-09-28T00:00:00Z', 'active');
  `);
  d.exec(SQL);
  d.exec(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, body)
          VALUES ('g1', 9, 70, 'Ship the deck before Friday')`);
  d.exec(`INSERT INTO cohort_guidance_acks (guidance_id, founder_user_id) VALUES (1, 72)`);
  assert.throws(
    () => d.exec(`INSERT INTO cohort_guidance_acks (guidance_id, founder_user_id) VALUES (1, 72)`),
    /UNIQUE/, 'acting twice must be once, or the "who acted" list double-counts',
  );
  // Deleting guidance takes its acks; the founder rows stay.
  d.exec('DELETE FROM cohort_guidance WHERE id = 1');
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM cohort_guidance_acks').get() as any).n, 0);
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n, 2);
});
