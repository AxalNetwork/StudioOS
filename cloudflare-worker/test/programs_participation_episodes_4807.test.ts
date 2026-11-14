/**
 * D4807 (#4807) — historical participation reads episodes that later changes
 * cannot rewrite.
 *
 * `peopleIn` (People taking part) used to read a mentor assignment's and a
 * Learning enrolment's mutable row, so a reassignment or re-enrolment made
 * after a period closed changed that closed period's count. It now reads the
 * episode views over 565's and 560's event tables, which nothing updates.
 *
 * Real SQLite over the real schema and the real migration. Every name is
 * invented. The mutable rows are overwritten the way the routes overwrite
 * them (a re-assign sets `assigned_at` and clears `unassigned_at`; a
 * re-enrolment sets `enrolled_at`), and the closed period's count must not move.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/programs_participation_episodes_4807.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { peopleIn } from '../src/services/programCatalogue.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION = '202611072215_programs_participation_episodes_4807.sql';

const FROM = '2026-09-01 00:00:00';
const TO = '2026-10-01 00:00:00'; // the closed period: September 2026

function build(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}
const count = (db: DatabaseSync, from = FROM, to = TO) => peopleIn({ DB: d1Over(db) } as any, from, to);

let uid = 0;
/** What the assign route writes: the row, and one `assigned` event. */
function assign(db: DatabaseSync, advisor: number, cycle: number, at: string) {
  uid += 1;
  const r = db.prepare('INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(`as-${uid}`, advisor, cycle, at);
  const id = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO advisor_cohort_assignment_events (assignment_id, advisor_user_id, cohort_cycle_id, kind, created_at) VALUES (?, ?, ?, 'assigned', ?)")
    .run(id, advisor, cycle, at);
  return id;
}
/** What the end route writes: the row's end, and one `ended` event. */
function end(db: DatabaseSync, id: number, at: string) {
  const a = db.prepare('SELECT advisor_user_id, cohort_cycle_id FROM advisor_cohort_assignments WHERE id = ?').get(id) as any;
  db.prepare('UPDATE advisor_cohort_assignments SET unassigned_at = ?, is_active = 0 WHERE id = ?').run(at, id);
  db.prepare("INSERT INTO advisor_cohort_assignment_events (assignment_id, advisor_user_id, cohort_cycle_id, kind, created_at) VALUES (?, ?, ?, 'ended', ?)")
    .run(id, a.advisor_user_id, a.cohort_cycle_id, at);
}
/** What a re-assign writes: it overwrites the row and adds an `assigned` event. */
function reassign(db: DatabaseSync, id: number, at: string) {
  const a = db.prepare('SELECT advisor_user_id, cohort_cycle_id FROM advisor_cohort_assignments WHERE id = ?').get(id) as any;
  db.prepare('UPDATE advisor_cohort_assignments SET assigned_at = ?, unassigned_at = NULL, is_active = 1 WHERE id = ?').run(at, id);
  db.prepare("INSERT INTO advisor_cohort_assignment_events (assignment_id, advisor_user_id, cohort_cycle_id, kind, created_at) VALUES (?, ?, ?, 'assigned', ?)")
    .run(id, a.advisor_user_id, a.cohort_cycle_id, at);
}

function program(db: DatabaseSync, id: number, status: string) {
  db.prepare("INSERT INTO learning_programs (id, uid, name, status, created_by) VALUES (?, ?, 'P', ?, 1)").run(id, `lp-${id}`, status);
}
function enrol(db: DatabaseSync, programId: number, user: number, at: string) {
  db.prepare("INSERT INTO learning_enrolment_events (program_id, user_id, kind, by_user_id, at) VALUES (?, ?, 'enrolled', ?, ?)").run(programId, user, user, at);
  const row = db.prepare('SELECT id FROM learning_enrollments WHERE program_id = ? AND user_id = ?').get(programId, user) as any;
  if (row) db.prepare("UPDATE learning_enrollments SET enrolled_at = ?, status = 'active', updated_at = ? WHERE id = ?").run(at, at, row.id);
  else db.prepare("INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, enrolled_at, status, updated_at) VALUES (?, ?, ?, ?, 'active', ?)").run(programId, user, user, at, at);
}
function remove(db: DatabaseSync, programId: number, user: number, at: string) {
  db.prepare("INSERT INTO learning_enrolment_events (program_id, user_id, kind, by_user_id, at) VALUES (?, ?, 'removed', 1, ?)").run(programId, user, at);
  db.prepare("UPDATE learning_enrollments SET status = 'removed', updated_at = ? WHERE program_id = ? AND user_id = ?").run(at, programId, user);
}

test('the migration file exists under its stamped name and creates both views', () => {
  const sql = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations', MIGRATION), 'utf8');
  assert.match(sql, /CREATE VIEW IF NOT EXISTS advisor_cohort_episodes/);
  assert.match(sql, /CREATE VIEW IF NOT EXISTS learning_enrolment_episodes/);
  const db = build();
  const views = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all() as any[]).map((v) => v.name);
  assert.ok(views.includes('advisor_cohort_episodes') && views.includes('learning_enrolment_episodes'));
});

test('mentors: a reassignment after the period closed does not change it; a second mentor and an earlier end behave', async () => {
  const db = build();
  const a = assign(db, 10, 1, '2026-09-10 10:00:00');     // took part in September, ended in September
  end(db, a, '2026-09-20 10:00:00');
  assign(db, 11, 1, '2026-08-01 10:00:00');               // assigned before, still open in September
  const gone = assign(db, 12, 1, '2026-07-01 10:00:00');  // ended before September
  end(db, gone, '2026-08-20 10:00:00');
  assign(db, 13, 1, '2026-10-15 10:00:00');               // assigned after September
  assert.equal(await count(db), 2, 'September: advisors 10 and 11');

  reassign(db, a, '2026-11-02 10:00:00');                 // overwrites assigned_at, clears unassigned_at
  end(db, a, '2026-11-20 10:00:00');
  reassign(db, gone, '2026-11-03 10:00:00');              // the one who left before September comes back later
  assert.equal(await count(db), 2, 'the same two, after the later changes');
  // The mutable row alone would now say advisor 12 took part in September (assigned 2026-11-03, no end): it did not.
  const row = db.prepare('SELECT assigned_at, unassigned_at, is_active FROM advisor_cohort_assignments WHERE id = ?').get(gone) as any;
  assert.equal(row.unassigned_at, null);
  assert.equal(await count(db, '2026-11-01 00:00:00', '2026-12-01 00:00:00'), 4, 'and November is its own period: 10, 12, 11 and 13');
});

test('mentors: an earlier episode whose end was never stored is bounded by the next assignment, not left open', async () => {
  const db = build();
  // 565's backfill can recover an earlier episode's start but not its end: an `assigned` event with no `ended`.
  const id = assign(db, 10, 1, '2026-11-02 10:00:00');
  db.prepare("INSERT INTO advisor_cohort_assignment_events (assignment_id, advisor_user_id, cohort_cycle_id, kind, created_at) VALUES (?, 10, 1, 'assigned', '2026-09-05 10:00:00')").run(id);
  const eps = db.prepare('SELECT started_at, ended_at FROM advisor_cohort_episodes WHERE assignment_id = ? ORDER BY started_at').all(id) as any[];
  assert.deepEqual(eps.map((e) => ({ ...e })), [
    { started_at: '2026-09-05 10:00:00', ended_at: '2026-11-02 10:00:00' },
    { started_at: '2026-11-02 10:00:00', ended_at: null },
  ], 'the earlier episode ends no later than the next assignment; only the last stays open');
  assert.equal(await count(db), 1, 'September');
  assert.equal(await count(db, '2026-11-05 00:00:00', '2026-11-20 00:00:00'), 1, 'November: the open one');
  assert.equal(await count(db, '2026-08-01 00:00:00', '2026-09-01 00:00:00'), 0, 'before either started');
});

test('Learning: a re-enrolment after the period closed does not change it; a draft program never counts', async () => {
  const db = build();
  program(db, 1, 'published'); program(db, 2, 'draft');
  enrol(db, 1, 20, '2026-09-05 10:00:00'); remove(db, 1, 20, '2026-09-15 10:00:00'); // in September
  enrol(db, 1, 21, '2026-07-01 10:00:00'); remove(db, 1, 21, '2026-08-10 10:00:00'); // out before September
  enrol(db, 1, 22, '2026-08-20 10:00:00');                                           // open through September
  enrol(db, 2, 23, '2026-09-05 10:00:00');                                           // a draft program
  assert.equal(await count(db), 2, 'September: learners 20 and 22');

  enrol(db, 1, 20, '2026-11-03 10:00:00');   // re-enrolment overwrites enrolled_at
  enrol(db, 1, 21, '2026-11-04 10:00:00');   // the one who left before September comes back
  remove(db, 1, 22, '2026-12-01 10:00:00');  // left after September
  assert.equal(await count(db), 2, 'the same two, after the later changes');
  const row = db.prepare('SELECT enrolled_at, status FROM learning_enrollments WHERE program_id = 1 AND user_id = 21').get() as any;
  assert.equal(row.status, 'active');
  assert.ok(String(row.enrolled_at).startsWith('2026-11-04'), 'the row alone would now put learner 21 in November, not September');
});

test('timestamps in either form compare: an ISO "T…Z" stamp and a SQLite datetime stamp', async () => {
  const db = build();
  program(db, 1, 'published');
  enrol(db, 1, 20, '2026-09-05T10:00:00.000Z');
  remove(db, 1, 20, '2026-09-15 10:00:00');
  assert.equal(await count(db), 1);
  assert.equal(await count(db, '2026-09-16 00:00:00', '2026-09-30 00:00:00'), 0, 'after the removal');
});
