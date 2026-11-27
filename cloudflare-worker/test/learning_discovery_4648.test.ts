/**
 * #4648 (Learning audit 3/5) — discovery and reporting.
 *
 *   · /exercises and /exams take `q`: it keeps the accessible rows whose title contains it; the total counts the same
 *     rows; paging still works inside a search; `%`, `_` and `\` in a query mean themselves; a draft, an archived item
 *     and a programme item the member is not enrolled in are never found by a search;
 *   · /me/stats no longer reports a sum of resume positions as watch time. It counts the videos whose position was saved
 *     this month, once each: pauses, seeks, rewinds, replays and duplicate saves of one video move no figure, a save in
 *     last month does not count this month, and the boundary is the calendar month in UTC.
 *
 * Synthetic fixtures. Dates are built from `monthOf`, which reads the clock only to name the month the route uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import learningLists, { MAX_QUERY, monthOf, searchOf } from '../src/routes/learning_lists.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4648-learning-0123456789';
const MEMBER = 10, OTHER = 11;
const ROLE: Record<number, string> = { [MEMBER]: 'founder', [OTHER]: 'investor' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (1, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1),
      (${OTHER}, 'u-otto', 'otto@example.test', 'Otto Other', 'investor', 1);
    INSERT INTO learning_exercises (id, uid, title, submission_kind, visibility, status, created_by, published_at) VALUES
      (1, 'ex-1', 'Write your one-liner', 'text', 'open', 'published', 1, '2026-10-01'),
      (2, 'ex-2', 'Write a pricing memo', 'text', 'open', 'published', 1, '2026-10-02'),
      (3, 'ex-3', 'Cap table review', 'text', 'open', 'published', 1, '2026-10-03'),
      (4, 'ex-4', 'Write the draft', 'text', 'open', 'draft', 1, NULL),
      (5, 'ex-5', 'Write the programme task', 'text', 'program', 'published', 1, '2026-10-04'),
      (6, 'ex-6', 'Write the archived task', 'text', 'open', 'archived', 1, '2026-09-01'),
      (7, 'ex-7', '100% retention', 'text', 'open', 'published', 1, '2026-10-05'),
      (8, 'ex-8', 'a_b names', 'text', 'open', 'published', 1, '2026-10-06'),
      (9, 'ex-9', 'axb names', 'text', 'open', 'published', 1, '2026-10-07');
    INSERT INTO learning_exams (id, uid, title, pass_mark_percent, max_attempts, visibility, status, created_by, published_at) VALUES
      (1, 'exam-1', 'Term sheets', 70, 3, 'open', 'published', 1, '2026-10-01'),
      (2, 'exam-2', 'Term sheet traps', 70, 3, 'open', 'published', 1, '2026-10-02'),
      (3, 'exam-3', 'Cap tables', 70, NULL, 'open', 'published', 1, '2026-10-03'),
      (4, 'exam-4', 'Term sheet draft', 70, NULL, 'open', 'draft', 1, NULL),
      (5, 'exam-5', 'Term sheet programme', 70, NULL, 'program', 'published', 1, '2026-10-04');
    INSERT INTO learning_programs (id, uid, name, status, created_by) VALUES (1, 'prog-1', 'Lagos cohort', 'published', 1);
    INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid) VALUES (1, 'exercise', 'ex-5'), (1, 'exam', 'exam-5');
  `);
  return db;
}

async function call(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>().route('/api/learning', learningLists);
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/learning${path}`, { headers: { Authorization: `Bearer ${tok}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const uids = (r: any) => r.body.items.map((x: any) => x.uid);
const enc = encodeURIComponent;

test('exercises: a query keeps the matching accessible rows and the total counts the same rows', async () => {
  const db = fixture();
  const all = await call(db, MEMBER, '/exercises');
  assert.equal(all.body.total, 6, 'draft, archived and the programme item are not listed');
  const r = await call(db, MEMBER, `/exercises?q=${enc('write')}`);
  // Mutation checked: the pattern not bound into the statement → every accessible row comes back and this fails.
  assert.deepEqual(uids(r), ['ex-2', 'ex-1'], 'newest first, only titles containing the query');
  assert.equal(r.body.total, 2, 'the total is the matching total, not the list\'s');
  assert.equal(r.body.q, 'write');
  // Case does not matter; the query is trimmed.
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('  WRITE  ')}`)), ['ex-2', 'ex-1']);
  // Nothing matches: an empty page and a total of 0, not an error.
  const none = await call(db, MEMBER, `/exercises?q=${enc('zzzz')}`);
  assert.deepEqual([none.status, none.body.items, none.body.total], [200, [], 0]);
  // A blank query is no query.
  assert.equal((await call(db, MEMBER, `/exercises?q=${enc('   ')}`)).body.total, 6);
});

test('a search never finds what the member cannot access: a draft, an archived item, a programme item they are not in', async () => {
  const db = fixture();
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('draft')}`)), []);
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('archived')}`)), []);
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('programme')}`)), []);
  assert.deepEqual(uids(await call(db, MEMBER, `/exams?q=${enc('programme')}`)), []);
  assert.deepEqual(uids(await call(db, MEMBER, `/exams?q=${enc('draft')}`)), []);
  db.exec(`INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, status) VALUES (1, ${MEMBER}, 1, 'active')`);
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('programme')}`)), ['ex-5'], 'enrolled, it is found');
  assert.deepEqual(uids(await call(db, MEMBER, `/exams?q=${enc('programme')}`)), ['exam-5']);
  assert.deepEqual(uids(await call(db, OTHER, `/exercises?q=${enc('programme')}`)), [], 'another member is not enrolled');
  assert.equal((await call(db, MEMBER, `/exams?q=${enc('draft')}`)).body.total, 0, 'and the total never counts a hidden row');
});

test('exams: the same query, the same total; paging works inside a search', async () => {
  const db = fixture();
  const r = await call(db, MEMBER, `/exams?q=${enc('term sheet')}`);
  assert.deepEqual(uids(r), ['exam-2', 'exam-1']);
  assert.equal(r.body.total, 2);
  const p1 = await call(db, MEMBER, `/exams?q=${enc('term')}&limit=1&offset=0`);
  const p2 = await call(db, MEMBER, `/exams?q=${enc('term')}&limit=1&offset=1`);
  const p3 = await call(db, MEMBER, `/exams?q=${enc('term')}&limit=1&offset=2`);
  assert.deepEqual([uids(p1), uids(p2), uids(p3)], [['exam-2'], ['exam-1'], []]);
  assert.deepEqual([p1.body.total, p2.body.total, p3.body.total], [2, 2, 2], 'the total does not move with the page');
  assert.equal((await call(db, MEMBER, '/exams')).body.total, 3, 'without a query every accessible exam');
});

test('`%`, `_` and `\\` in a query mean themselves; an over-long query is cut, never an error', async () => {
  const db = fixture();
  // Mutation checked: the wildcards not escaped → `%` matches every title.
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('%')}`)), ['ex-7'], '% is a percent sign, not "anything"');
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('a_b')}`)), ['ex-8'], '_ is an underscore: "axb names" is not a match');
  assert.deepEqual(uids(await call(db, MEMBER, `/exercises?q=${enc('\\')}`)), [], 'a backslash is a backslash');
  const long = await call(db, MEMBER, `/exercises?q=${enc('x'.repeat(5000))}`);
  assert.deepEqual([long.status, long.body.total, long.body.q.length], [200, 0, MAX_QUERY]);
  assert.deepEqual(searchOf(undefined), { q: '', pattern: '%%' });
  assert.deepEqual(searchOf(42), { q: '', pattern: '%%' });
  assert.equal(searchOf("50%_\\").pattern, '%50\\%\\_\\\\%');
});

// ---------------------------------------------------------------- the metric

const THIS = monthOf(new Date());
const prevMonth = () => { const [y, m] = THIS.split('-').map(Number); return monthOf(new Date(Date.UTC(y, m - 2, 1))); };
const lastSecondOfPrev = () => new Date(Date.UTC(Number(THIS.slice(0, 4)), Number(THIS.slice(5, 7)) - 1, 1) - 1000).toISOString();
const firstSecondOfThis = () => `${THIS}-01T00:00:00.000Z`;
const stats = async (db: DatabaseSync) => (await call(db, MEMBER, '/me/stats')).body;
const save = (db: DatabaseSync, who: number, kind: string, uid: string, pos: number | null, at: string) => db.exec(
  `INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, position_seconds, started_at, updated_at) VALUES (${who}, '${kind}', '${uid}', 'started', ${pos === null ? 'NULL' : pos}, '${at}', '${at}')
   ON CONFLICT (user_id, subject_kind, subject_uid) DO UPDATE SET position_seconds = excluded.position_seconds, updated_at = excluded.updated_at`);

test('videos played this month: seeks, rewinds, replays and duplicate saves of one video count it once; positions are never summed', async () => {
  const db = fixture();
  const at = (n: number) => `${THIS}-02T10:00:0${n}.000Z`;
  assert.equal((await stats(db)).videos_played_this_month, 0, 'a readable store with nothing is a known 0');
  // One video: play to 90 s, seek to 3000 s, rewind to 10 s, replay to 200 s: the same row, saved many times.
  for (const [i, pos] of [90, 3000, 10, 200].entries()) save(db, MEMBER, 'item', 'it-a', pos, at(i));
  // Mutation checked: SUM(position_seconds) instead of a count → 200 here, 3200 had the saves been rows.
  assert.equal((await stats(db)).videos_played_this_month, 1);
  save(db, MEMBER, 'item', 'it-b', 45, at(5));
  assert.equal((await stats(db)).videos_played_this_month, 2, 'a second video is a second video, whatever its length');
  // A row with no position, or a zero one (a video opened and left), and a reading or a lesson, are not a video played.
  save(db, MEMBER, 'item', 'it-c', null, at(6));
  save(db, MEMBER, 'item', 'it-d', 0, at(6));
  save(db, MEMBER, 'lesson', 'l-1', 120, at(6));
  save(db, OTHER, 'item', 'it-e', 500, at(6));
  const s = await stats(db);
  assert.equal(s.videos_played_this_month, 2, 'only positive positions on items, only the caller\'s');
  assert.equal('watch_seconds_this_month' in s, false);
});

test('videos played: the month is the calendar month in UTC; last month\'s save does not count, its first second does', async () => {
  const db = fixture();
  save(db, MEMBER, 'item', 'it-prev', 100, lastSecondOfPrev());
  assert.equal((await stats(db)).videos_played_this_month, 0, 'the last second of last month is last month');
  save(db, MEMBER, 'item', 'it-first', 100, firstSecondOfThis());
  assert.equal((await stats(db)).videos_played_this_month, 1, 'the first second of this month is this month');
  assert.equal(prevMonth() < THIS, true);
  assert.equal((await stats(db)).month, THIS);
  // A video last played last month and resumed this month is played this month (its position was saved again).
  save(db, MEMBER, 'item', 'it-prev', 150, `${THIS}-03T09:00:00.000Z`);
  assert.equal((await stats(db)).videos_played_this_month, 2);
});

test('an unreadable figure is null, never 0: the store failing is not the same as nothing played', async () => {
  const db = fixture();
  db.exec('ALTER TABLE learning_progress RENAME TO learning_progress_gone');
  const s = await stats(db);
  assert.equal(s.videos_played_this_month, null);
  assert.equal(s.courses_in_progress, null);
  assert.equal(s.lessons_completed_this_month, null);
  assert.deepEqual(s.exams, { passed: 0, sat: 0 }, 'the exam store is another store and still reads');
});
