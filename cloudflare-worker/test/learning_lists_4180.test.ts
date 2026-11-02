/**
 * #4180 (#3726 L5, D4180) — the Learning center's list reads.
 *
 *   · /exercises and /exams list published, visible items only: a draft, a
 *     programme item the member is not enrolled in, and an archived item stay
 *     out, the Super Admin's list included; an enrolled member sees theirs;
 *   · "your status", attempts left and the best score are the caller's own,
 *     and a best score with no submitted attempt is null, never 0;
 *   · /me/submissions and /me/attempts carry the caller's rows only, with no
 *     email and no other member's work;
 *   · /me/stats: a figure not recorded is null, never 0;
 *   · the course read gives each lesson its item's length (null otherwise);
 *   · the catalog's q reaches the transcript, with the words around it and
 *     their time, and max_minutes keeps what has a recorded length within it;
 *   · the webinar detail gives the host "Attended n of m", null when nobody
 *     recorded attendance, and nothing to anyone else.
 *
 * Synthetic fixtures only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_lists_4180.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import learning, { transcriptMatch } from '../src/routes/learning.ts';
import learningLists, { monthOf } from '../src/routes/learning_lists.ts';
import learningWebinars from '../src/routes/learning_webinars.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4180-learning-0123456789';
const SUPER = 1, MEMBER = 10, OTHER = 11, HOST = 12;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [MEMBER]: 'founder', [OTHER]: 'investor', [HOST]: 'founder' };
const NOW = new Date().toISOString();
const MONTH = monthOf(new Date());

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1),
      (${OTHER}, 'u-otto', 'otto@example.test', 'Otto Other', 'investor', 1),
      (${HOST}, 'u-hana', 'hana@example.test', 'Hana Host', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});

    INSERT INTO learning_exercises (id, uid, title, submission_kind, visibility, status, created_by, published_at) VALUES
      (1, 'ex-open', 'Write your one-liner', 'text', 'open', 'published', 1, '2026-10-01'),
      (2, 'ex-draft', 'Draft exercise', 'text', 'open', 'draft', 1, NULL),
      (3, 'ex-prog', 'Programme exercise', 'text', 'program', 'published', 1, '2026-10-02'),
      (4, 'ex-gone', 'Archived exercise', 'text', 'open', 'archived', 1, '2026-09-01');
    INSERT INTO learning_exercise_submissions (uid, exercise_id, user_id, body, status, submitted_at) VALUES
      ('s-mia-1', 1, ${MEMBER}, 'First', 'needs_work', '2026-10-03'),
      ('s-mia-2', 1, ${MEMBER}, 'Second', 'accepted', '2026-10-04'),
      ('s-otto', 1, ${OTHER}, 'Otto answer', 'submitted', '2026-10-05');

    INSERT INTO learning_exams (id, uid, title, pass_mark_percent, time_limit_minutes, max_attempts, visibility, status, created_by, published_at) VALUES
      (1, 'exam-open', 'Term sheets', 70, 20, 3, 'open', 'published', 1, '2026-10-01'),
      (2, 'exam-unl', 'Cap tables', 60, NULL, NULL, 'open', 'published', 1, '2026-10-02'),
      (3, 'exam-draft', 'Draft exam', 70, NULL, NULL, 'open', 'draft', 1, NULL),
      (4, 'exam-prog', 'Programme exam', 70, NULL, NULL, 'program', 'published', 1, '2026-10-03');
    INSERT INTO learning_exam_questions (uid, exam_id, prompt, kind, options_json, correct_json) VALUES
      ('q1', 1, 'Who leads?', 'single', '["a","b"]', '[1]'), ('q2', 1, 'Which?', 'multiple', '["a","b","c"]', '[0,2]');
    INSERT INTO learning_exam_attempts (uid, exam_id, user_id, started_at, question_order_json, submitted_at, score_percent, passed, timed_out) VALUES
      ('a-mia-1', 1, ${MEMBER}, '2026-10-05', '[]', '2026-10-05', 50, 0, 0),
      ('a-mia-2', 1, ${MEMBER}, '2026-10-06', '[]', '2026-10-06', 80, 1, 0),
      ('a-mia-open', 2, ${MEMBER}, '2026-10-07', '[]', NULL, NULL, NULL, 0),
      ('a-otto', 1, ${OTHER}, '2026-10-06', '[]', '2026-10-06', 100, 1, 0);

    INSERT INTO learning_programs (id, uid, name, status, created_by) VALUES (1, 'prog-1', 'Lagos cohort', 'published', 1);
    INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid) VALUES (1, 'exercise', 'ex-prog'), (1, 'exam', 'exam-prog');

    INSERT INTO learning_items (uid, kind, title, summary, duration_seconds, transcript, visibility, status, created_by, published_at) VALUES
      ('it-short', 'video', 'Pricing basics', 'How to price', 300, '00:00 Welcome\n04:12 We cover churn and retention here\n05:00 End', 'open', 'published', 1, '2026-10-01'),
      ('it-long', 'video', 'Board meetings', 'Running a board', 3600, 'Nothing about it', 'open', 'published', 1, '2026-10-02'),
      ('it-nolen', 'reading', 'Unmeasured', 'No length', NULL, 'churn also here', 'open', 'published', 1, '2026-10-03'),
      ('it-draft', 'video', 'Draft video', 'x', 60, 'churn in a draft', 'open', 'draft', 1, NULL);
    INSERT INTO learning_courses (id, uid, slug, title, visibility, status, created_by, published_at) VALUES
      (1, 'c-1', 'fundraising', 'Fundraising', 'open', 'published', 1, '2026-10-01');
    INSERT INTO learning_course_modules (id, uid, course_id, title) VALUES (1, 'm-1', 1, 'Basics');
    INSERT INTO learning_lessons (uid, module_id, title, position, kind, ref_uid) VALUES
      ('l-video', 1, 'Pricing', 1, 'video', 'it-short'), ('l-ex', 1, 'One-liner', 2, 'exercise', 'ex-open'), ('l-nolen', 1, 'Read', 3, 'reading', 'it-nolen');

    INSERT INTO learning_webinars (id, uid, title, visibility, status, created_by, starts_at, ends_at) VALUES
      (1, 'w-1', 'Demo day prep', 'open', 'published', ${HOST}, '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z');
    INSERT INTO learning_webinar_registrations (webinar_id, user_id, attended) VALUES (1, ${MEMBER}, NULL), (1, ${OTHER}, NULL);
  `);
  return db;
}

async function call(db: DatabaseSync, who: number, path: string) {
  const app = new Hono<any>().route('/api/learning', learning).route('/api/learning', learningLists).route('/api/learning', learningWebinars);
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/api/learning${path}`, { headers: { Authorization: `Bearer ${tok}` } }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('exercises: published and visible only; your status is your latest; a programme item appears once you are enrolled', async () => {
  const db = fixture();
  const mia = await call(db, MEMBER, '/exercises');
  assert.equal(mia.status, 200, JSON.stringify(mia.body));
  // Mutation checked: drop `x.status = 'published'` from memberSees → the draft is listed and this fails.
  assert.deepEqual(mia.body.items.map((x: any) => x.uid), ['ex-open']);
  assert.equal(mia.body.total, 1, 'the total agrees with the rows');
  assert.equal(mia.body.items[0].status, 'accepted', 'your latest submission, not anyone else\'s');
  assert.equal((await call(db, OTHER, '/exercises')).body.items[0].status, 'submitted');
  const sup = await call(db, SUPER, '/exercises');
  assert.deepEqual(sup.body.items.map((x: any) => x.uid), ['ex-open'], 'a member list: no draft for the Super Admin either');
  db.exec(`INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, status) VALUES (1, ${MEMBER}, 1, 'active')`);
  const enrolled = await call(db, MEMBER, '/exercises');
  assert.deepEqual(enrolled.body.items.map((x: any) => x.uid), ['ex-prog', 'ex-open']);
  assert.deepEqual(enrolled.body.items[0].where, { kind: 'program', title: 'Lagos cohort' });
  assert.equal(enrolled.body.items[0].status, null, 'not started is null');
  assert.deepEqual(enrolled.body.items[1].where, { kind: 'course', title: 'Fundraising' });
});

test('exams: questions, limits, attempts left and your best score; no attempt is "not recorded", never 0', async () => {
  const db = fixture();
  const r = await call(db, MEMBER, '/exams');
  assert.deepEqual(r.body.items.map((x: any) => x.uid), ['exam-unl', 'exam-open']);
  const open = r.body.items.find((x: any) => x.uid === 'exam-open');
  assert.equal(open.question_count, 2);
  assert.equal(open.time_limit_minutes, 20);
  assert.equal(open.pass_mark_percent, 70);
  assert.equal(open.attempts_left, 1);
  // Mutation checked: take MAX over every member's attempts → Otto's 100 becomes Mia's best and this fails.
  assert.equal(open.best_score_percent, 80);
  assert.equal(open.passed, true);
  const unl = r.body.items.find((x: any) => x.uid === 'exam-unl');
  assert.equal(unl.attempts_left, null, 'unlimited is null, not 0 left');
  // Mutation checked: COALESCE the best score to 0 → this reads 0 and fails.
  assert.equal(unl.best_score_percent, null, 'an open attempt has no score: not recorded, never 0');
  assert.equal(unl.passed, null);
});

test('me/submissions and me/attempts: the caller\'s own rows, no email, no other member\'s work', async () => {
  const db = fixture();
  const subs = (await call(db, MEMBER, '/me/submissions')).body.submissions;
  assert.deepEqual(subs.map((s: any) => s.uid), ['s-mia-2', 's-mia-1']);
  assert.equal(subs[0].exercise.title, 'Write your one-liner');
  const atts = (await call(db, MEMBER, '/me/attempts')).body.attempts;
  // Mutation checked: drop `a.user_id = ?` → Otto's attempt is listed and this fails.
  assert.deepEqual(atts.map((a: any) => a.uid).sort(), ['a-mia-1', 'a-mia-2', 'a-mia-open']);
  assert.equal(atts.find((a: any) => a.uid === 'a-mia-open').score_percent, null, 'an open attempt has no score');
  const all = JSON.stringify({ subs, atts });
  assert.doesNotMatch(all, /@example|Otto|s-otto|a-otto/, 'no email and nothing of another member\'s');
});

test('me/stats: recorded figures as numbers; a figure nothing recorded is null, never 0', async () => {
  const db = fixture();
  const none = (await call(db, OTHER, '/me/stats')).body;
  assert.equal(none.month, MONTH);
  assert.equal(none.courses_in_progress, 0, 'a count over a readable store is a real 0');
  // Mutation checked: answer 0 when no position is recorded → this reads 0 and fails.
  assert.equal(none.watch_seconds_this_month, null, 'no recorded position this month is null, never 0');
  assert.deepEqual(none.exams, { passed: 1, sat: 1 });
  db.exec(`
    INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, position_seconds, started_at, completed_at, updated_at) VALUES
      (${MEMBER}, 'course', 'c-1', 'started', NULL, '${NOW}', NULL, '${NOW}'),
      (${MEMBER}, 'lesson', 'l-video', 'completed', NULL, '${NOW}', '${NOW}', '${NOW}'),
      (${MEMBER}, 'lesson', 'l-old', 'completed', NULL, '2020-01-01', '2020-01-02', '2020-01-02'),
      (${MEMBER}, 'item', 'it-short', 'started', 252, '${NOW}', NULL, '${NOW}'),
      (${OTHER}, 'item', 'it-long', 'started', 999, '${NOW}', NULL, '${NOW}');
  `);
  const mia = (await call(db, MEMBER, '/me/stats')).body;
  assert.equal(mia.courses_in_progress, 1);
  assert.equal(mia.lessons_completed_this_month, 1, 'last year\'s lesson is not this month\'s');
  assert.equal(mia.watch_seconds_this_month, 252, 'only the caller\'s positions');
  assert.deepEqual(mia.exams, { passed: 1, sat: 1 }, 'an open attempt is not a sat exam');
});

test('a course gives each lesson its item\'s length; a lesson with none is null', async () => {
  const db = fixture();
  const r = await call(db, MEMBER, '/courses/fundraising');
  const lessons = r.body.modules[0].lessons;
  assert.deepEqual(lessons.map((l: any) => [l.uid, l.duration_seconds]), [['l-video', 300], ['l-ex', null], ['l-nolen', null]]);
});

test('the catalog: q reaches the transcript with its words and time; max_minutes keeps what has a recorded length within it', async () => {
  const db = fixture();
  const r = await call(db, MEMBER, '/catalog?kind=video&q=churn');
  // Mutation checked: drop `OR transcript LIKE ?` → nothing matches and this fails.
  assert.deepEqual(r.body.items.map((x: any) => x.id), ['it-short']);
  assert.equal(r.body.items[0].match.in, 'transcript');
  assert.equal(r.body.items[0].match.at_seconds, 252, '04:12');
  assert.match(r.body.items[0].match.snippet, /churn and retention/);
  assert.ok(!('transcript' in r.body.items[0]), 'the transcript itself is not sent in a list');
  const reading = await call(db, MEMBER, '/catalog?kind=reading&q=churn');
  assert.equal(reading.body.items[0].match.at_seconds, null, 'no timestamp: the time is not recorded');
  const short = await call(db, MEMBER, '/catalog?kind=video&max_minutes=30');
  assert.deepEqual(short.body.items.map((x: any) => x.id), ['it-short'], 'the hour-long video is left out');
  const readings = await call(db, MEMBER, '/catalog?kind=reading&max_minutes=30');
  assert.deepEqual(readings.body.items, [], 'a reading with no recorded length is not claimed to fit');
  const events = await call(db, MEMBER, '/catalog?kind=event&max_minutes=30');
  assert.equal(events.body.sources.event.status, 'filtered_out');
  assert.equal((await call(db, MEMBER, '/catalog?max_minutes=0')).status, 400);
  assert.equal(transcriptMatch({ title: 'Churn', transcript: 'churn' }, 'churn'), null, 'a title match is not a transcript match');
});

test('the webinar host reads "Attended n of m"; nobody recorded attendance is null; a member reads no attendance', async () => {
  const db = fixture();
  const host = (await call(db, HOST, '/webinars/w-1')).body.webinar;
  assert.equal(host.registered_count, 2);
  // Mutation checked: count NULL as not attended → 0 and this fails.
  assert.equal(host.attended_count, null, 'nobody recorded attendance');
  db.exec(`UPDATE learning_webinar_registrations SET attended = 1 WHERE user_id = ${MEMBER}`);
  db.exec(`UPDATE learning_webinar_registrations SET attended = 0 WHERE user_id = ${OTHER}`);
  assert.equal((await call(db, HOST, '/webinars/w-1')).body.webinar.attended_count, 1);
  assert.equal((await call(db, SUPER, '/webinars/w-1')).body.webinar.attended_count, 1, 'the Super Admin reads it too');
  // Mutation checked: give attendance to everyone → the member reads it and this fails.
  assert.ok(!('attended_count' in (await call(db, MEMBER, '/webinars/w-1')).body.webinar), 'a member reads no attendance');
});
