/**
 * #4648 (Learning audit 3/5) — the home's totals agree with the lists they point to.
 *
 *   · "Courses in progress" (`GET /me/stats`) counts the same course rows Continue learning lists (`GET /me`), whatever
 *     else the learner has recorded: the list is not cut short by the other rows a learner accumulates;
 *   · a completed course, another learner's rows and a course row without its course are counted the same way by both;
 *   · "Lessons completed this month" equals the completed lesson rows of `GET /me` whose completion fell this month.
 *
 * Synthetic fixtures. The month is the one the route itself names (`monthOf`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import learningLists, { monthOf } from '../src/routes/learning_lists.ts';
import learning from '../src/routes/learning.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4648-totals-0123456789abc';
const MEMBER = 10, OTHER = 11;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (1, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1),
      (${OTHER}, 'u-otto', 'otto@example.test', 'Otto Other', 'investor', 1);
    INSERT INTO learning_courses (id, uid, slug, title, status, created_by, published_at) VALUES
      (1, 'course-1', 'term-sheets', 'Term sheets', 'published', 1, '2026-10-01'),
      (2, 'course-2', 'cap-tables', 'Cap tables', 'published', 1, '2026-10-02'),
      (3, 'course-3', 'safes', 'SAFEs', 'published', 1, '2026-10-03');
  `);
  return db;
}
const row = (db: DatabaseSync, user: number, kind: string, uid: string, status: string, at: string, completedAt: string | null = null) =>
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, started_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(user, kind, uid, status, at, completedAt, at);

async function get(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>().route('/api/learning', learning).route('/api/learning', learningLists);
  const tok = await new SignJWT({ user_id: who, role: who === MEMBER ? 'founder' : 'investor' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/learning${path}`, { headers: { Authorization: `Bearer ${tok}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const courseRows = (me: any) => me.body.in_progress.filter((x: any) => x.subject_kind === 'course');

test('Courses in progress equals the course rows Continue learning lists, also for a learner with hundreds of other records', async () => {
  const db = fixture();
  const old = '2026-01-05T10:00:00.000Z';
  row(db, MEMBER, 'course', 'course-1', 'started', old);
  row(db, MEMBER, 'course', 'course-2', 'started', old);
  // A learner who has watched a lot: newer item rows than either course.
  const ins = db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, started_at, updated_at) VALUES (?, 'item', ?, 'started', ?, ?)`);
  for (let i = 0; i < 502; i += 1) ins.run(MEMBER, `item-${i}`, '2026-10-30T10:00:00.000Z', '2026-10-30T10:00:00.000Z');
  const stats = await get(db, MEMBER, '/me/stats');
  const me = await get(db, MEMBER, '/me');
  assert.equal(stats.body.courses_in_progress, 2);
  // Mutation checked: the old single LIMIT 500 over every kind drops both courses here and this fails.
  assert.deepEqual(courseRows(me).map((x: any) => x.subject_uid).sort(), ['course-1', 'course-2']);
  assert.equal(courseRows(me).length, stats.body.courses_in_progress, 'the tile and the list count the same rows');
});

test('a completed course, another learner\'s course and a course row with no course are counted alike by the tile and the list', async () => {
  const db = fixture();
  const at = '2026-10-20T10:00:00.000Z';
  row(db, MEMBER, 'course', 'course-1', 'completed', at, at);
  row(db, MEMBER, 'course', 'course-2', 'started', at);
  row(db, MEMBER, 'course', 'course-gone', 'started', at); // its course was deleted: still the learner's record
  row(db, OTHER, 'course', 'course-3', 'started', at);
  const stats = await get(db, MEMBER, '/me/stats');
  const me = await get(db, MEMBER, '/me');
  assert.equal(stats.body.courses_in_progress, 2, 'the completed course and the other learner\'s are not counted');
  assert.equal(courseRows(me).length, 2);
  assert.deepEqual(courseRows(me).map((x: any) => x.subject_uid).sort(), ['course-2', 'course-gone']);
  assert.equal(courseRows(me).find((x: any) => x.subject_uid === 'course-gone').course_slug, null, 'and it says its course is not recorded rather than vanishing');
});

test('Lessons completed this month equals the completed lesson rows of the record that fell in this month', async () => {
  const db = fixture();
  const month = monthOf(new Date());
  const thisMonth = `${month}-02T09:00:00.000Z`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 15)).toISOString();
  row(db, MEMBER, 'lesson', 'l-1', 'completed', thisMonth, thisMonth);
  row(db, MEMBER, 'lesson', 'l-2', 'completed', thisMonth, thisMonth);
  row(db, MEMBER, 'lesson', 'l-3', 'completed', last, last);
  row(db, MEMBER, 'lesson', 'l-4', 'started', thisMonth);
  const stats = await get(db, MEMBER, '/me/stats');
  const me = await get(db, MEMBER, '/me');
  const inMonth = me.body.completed.filter((x: any) => x.subject_kind === 'lesson' && String(x.completed_at).slice(0, 7) === month);
  assert.equal(stats.body.lessons_completed_this_month, 2);
  assert.equal(inMonth.length, stats.body.lessons_completed_this_month);
});
