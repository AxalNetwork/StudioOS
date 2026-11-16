import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { filingReminderCandidates, filingReminderDates, sendFilingReminders } from '../src/services/filingReminders';
import type { Env } from '../src/types';
import { d1Over } from './_d1_sqlite.mjs';

test('D6039: a valid due day has the supplied lead date and due date', () => {
  assert.deepEqual(filingReminderDates('2026-12-04', 14), ['2026-11-20', '2026-12-04']);
  assert.deepEqual(filingReminderDates('2026-12-04', 7), ['2026-11-27', '2026-12-04']);
  assert.deepEqual(filingReminderDates('2026-02-30', 14), []);
  assert.deepEqual(filingReminderDates(null, 14), []);
});

test('D6039: the two windows select open filings and obligations for active venture founders', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id INTEGER, founder_id INTEGER, is_active INTEGER);
      CREATE TABLE projects (id INTEGER, founder_id INTEGER, entity_id INTEGER, deleted_at TEXT);
      CREATE TABLE project_members (project_id INTEGER, user_id INTEGER, status TEXT, role TEXT);
      CREATE TABLE formation_steps (id INTEGER, project_id INTEGER, title TEXT, due_date TEXT, state TEXT);
      CREATE TABLE entity_obligations (id INTEGER, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT);
      INSERT INTO users VALUES (1, 11, 1), (2, 22, 1), (3, NULL, 1), (4, NULL, 0), (5, NULL, 1), (6, NULL, 1);
      INSERT INTO projects VALUES (7, 11, 30, NULL), (8, 22, 30, NULL), (10, 22, 40, '2026-11-01');
      INSERT INTO project_members VALUES (7, 1, 'accepted', 'owner'), (7, 3, 'accepted', 'cofounder'),
        (8, 3, 'accepted', 'cofounder'), (7, 4, 'accepted', 'cofounder'), (7, 5, 'accepted', 'advisor'), (7, 6, 'pending', 'cofounder');
      INSERT INTO formation_steps VALUES (12, 7, 'First filing', '2026-11-20', 'todo'),
        (13, 7, 'Filed', '2026-11-20', 'done'), (14, 7, 'Undated', NULL, 'doing'),
        (15, 7, 'Outside window', '2026-12-05', 'todo'), (16, 10, 'Removed venture', '2026-11-20', 'todo');
      INSERT INTO entity_obligations VALUES (12, 30, 'Annual filing', '2026-12-04', 'open'),
        (17, 30, 'Waived', '2026-11-20', 'waived'), (18, 50, 'Unlinked entity', '2026-11-20', 'open');
    `);
    const env = { DB: d1Over(db) } as Env;
    const candidates = await filingReminderCandidates(env, '2026-11-20', 14);
    assert.deepEqual(candidates.map(({ source, id, project_id, userId, reminderDate }) =>
      [source, id, project_id, userId, reminderDate]), [
      ['obligation', 12, 7, 1, '2026-11-20'], ['obligation', 12, 7, 3, '2026-11-20'],
      ['step', 12, 7, 1, '2026-11-20'], ['step', 12, 7, 3, '2026-11-20'],
      ['obligation', 12, 8, 2, '2026-11-20'],
    ]);
    assert.equal((await filingReminderCandidates(env, '2026-11-20', 7)).length, 2);
    db.exec(readFileSync(new URL('../sql/migrations/202611150130_6039_filing_reminder_deliveries.sql', import.meta.url), 'utf8'));
    const deliver: Parameters<typeof sendFilingReminders>[3] = async (_env, args) => args.userId === 2 ? null : 100;
    const concurrent = await Promise.all([sendFilingReminders(env, '2026-11-20', 14, deliver), sendFilingReminders(env, '2026-11-20', 14, deliver)]);
    assert.equal(concurrent[0] + concurrent[1], 4);
    assert.equal(await sendFilingReminders(env, '2026-11-20', 14, deliver), 0);
    assert.deepEqual({ ...db.prepare('SELECT COUNT(*) AS attempts, COUNT(sent_at) AS sent FROM filing_reminder_deliveries').get() },
      { attempts: 5, sent: 4 });
    assert.equal(await sendFilingReminders(env, '2026-12-04', 14, deliver), 2);
  } finally { db.close(); }
});
