/**
 * D1124 (#3004) — a Learning program holds webinars (D560's store).
 *
 *  1. The contents route takes a webinar that exists, and refuses one that
 *     does not as `unknown_content`; the contents read describes it, with its
 *     start and where it opens.
 *  2. A learner's standing on it, from the host's attendance: attended,
 *     did not attend, registered, not registered.
 *  3. A program-only webinar is seen, listed and registered for by a member
 *     enrolled in a published program holding it, and by nobody else.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_program_webinars_d1124.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminPrograms from '../src/routes/admin_learning_programs.ts';
import webinars from '../src/routes/learning_webinars.ts';
import { completionFor, describeContents } from '../src/services/learningPrograms.ts';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(n + '_')) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, MEMBER = 2, OUTSIDER = 3, ABSENT = 4;
const START = '2026-11-03T16:00:00.000Z';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const n of ['388', '389', '390', '391', '560']) {
    try { db.exec(sqlOf(n)); } catch { /* a statement already on the baseline */ }
  }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const [id, role] of [[SUPER, 'admin'], [MEMBER, 'founder'], [OUTSIDER, 'founder'], [ABSENT, 'investor']] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, `u-${id}`, `u${id}@example.test`, `Person ${id}`, role);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const webinar = (uid: string, visibility: 'open' | 'program') => db.prepare(
    `INSERT INTO learning_webinars (uid, title, starts_at, ends_at, visibility, status, created_by) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?, 'published', ?)`,
  ).run(uid, `Webinar ${uid}`, START, visibility, SUPER);
  webinar('w-prog', 'program');
  webinar('w-open', 'open');
  db.exec(`INSERT INTO learning_programs (id, uid, name, status, created_by) VALUES (1, 'p-1', 'Nordics', 'published', ${SUPER})`);
  db.exec(`INSERT INTO learning_enrollments (program_id, user_id, enrolled_by, status) VALUES (1, ${MEMBER}, ${SUPER}, 'active'), (1, ${ABSENT}, ${SUPER}, 'active')`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

async function call(app: any, env: any, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, {
    method: init.method || 'GET', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('1. the contents route takes a webinar that exists; the read describes it', async () => {
  const { db, env } = fixture();
  try {
    const put = (contents: unknown) => call(adminPrograms, env, SUPER, '/programs/p-1/contents', { method: 'PUT', body: { contents } });
    assert.equal((await put([{ subject_kind: 'webinar', subject_uid: 'no-such' }])).body.error, 'unknown_content');
    const ok = await put([{ subject_kind: 'webinar', subject_uid: 'w-prog' }]);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const described = await describeContents(env, [{ subject_kind: 'webinar', subject_uid: 'w-prog', position: 0 }]);
    assert.deepEqual(described[0], {
      subject_kind: 'webinar', subject_uid: 'w-prog', position: 0, title: 'Webinar w-prog', status: 'published', kind: null,
      href: '/learning/webinars/w-prog', starts_at: START,
    });
  } finally { db.close(); }
});

test('2. a learner\'s standing on a webinar, from the host\'s attendance', async () => {
  const { db, env } = fixture();
  try {
    db.exec(`INSERT INTO learning_webinar_registrations (webinar_id, user_id, registered_at, attended) VALUES
      (1, ${MEMBER}, '2026-10-20T10:00:00Z', 1), (1, ${ABSENT}, '2026-10-21T10:00:00Z', 0), (1, ${OUTSIDER}, '2026-10-22T10:00:00Z', NULL)`);
    const contents = [{ subject_kind: 'webinar' as const, subject_uid: 'w-prog', position: 0 }];
    const learners = [MEMBER, ABSENT, OUTSIDER, SUPER].map((id) => ({ user_id: id, uid: `u-${id}`, name: null, enrolled_at: '2026-10-01' }));
    const rows = await completionFor(env, contents, learners as any);
    assert.deepEqual(rows.map((r: any) => [r.uid, r.completion[0].status, r.completion[0].registered_at]), [
      ['u-2', 'attended', '2026-10-20T10:00:00Z'], ['u-4', 'not_attended', '2026-10-21T10:00:00Z'],
      ['u-3', 'registered', '2026-10-22T10:00:00Z'], ['u-1', 'not_registered', null],
    ]);
    assert.equal(rows[0].last_activity_at, '2026-10-20T10:00:00Z', 'the registration is activity on the program');
    assert.equal(rows[3].last_activity_at, null);
  } finally { db.close(); }
});

test('3. a program-only webinar: seen, listed and registered for by an enrolled member, never by an outsider', async () => {
  const { db, env } = fixture();
  try {
    // Not held by the program yet: nobody but the Super Admin sees it.
    assert.equal((await call(webinars, env, MEMBER, '/webinars/w-prog')).status, 404);
    db.exec(`INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid, position) VALUES (1, 'webinar', 'w-prog', 0)`);
    assert.equal((await call(webinars, env, MEMBER, '/webinars/w-prog')).status, 200);
    assert.equal((await call(webinars, env, OUTSIDER, '/webinars/w-prog')).status, 404, 'not enrolled');
    const listed = (who: number) => call(webinars, env, who, '/webinars?when=upcoming').then((r) => r.body.webinars.map((w: any) => w.uid).sort());
    assert.deepEqual(await listed(MEMBER), ['w-open', 'w-prog']);
    assert.deepEqual(await listed(OUTSIDER), ['w-open']);
    assert.equal((await call(webinars, env, MEMBER, '/webinars/w-prog/registration', { method: 'POST' })).status, 201);
    assert.equal((await call(webinars, env, OUTSIDER, '/webinars/w-prog/registration', { method: 'POST' })).status, 404);
    // A program that is not published opens nothing.
    db.exec(`UPDATE learning_programs SET status = 'draft' WHERE id = 1`);
    assert.equal((await call(webinars, env, MEMBER, '/webinars/w-prog')).status, 404);
    // A removed enrolment opens nothing either.
    db.exec(`UPDATE learning_programs SET status = 'published' WHERE id = 1; UPDATE learning_enrollments SET status = 'removed' WHERE user_id = ${MEMBER}`);
    assert.equal((await call(webinars, env, MEMBER, '/webinars/w-prog')).status, 404);
    assert.equal((await call(webinars, env, OUTSIDER, '/webinars/w-open')).status, 200, 'an open webinar is everyone\'s');
    // Held through a course's webinar lesson: the program holds the course, the course the webinar.
    db.exec(`INSERT INTO learning_webinars (uid, title, starts_at, ends_at, visibility, status, created_by) VALUES ('w-lesson', 'Webinar w-lesson', '${START}', '2099-01-01T00:00:00.000Z', 'program', 'published', ${SUPER});
      INSERT INTO learning_courses (id, uid, slug, title, visibility, status, created_by) VALUES (1, 'c-1', 'c-1', 'Course', 'program', 'published', ${SUPER});
      INSERT INTO learning_course_modules (id, uid, course_id, title) VALUES (1, 'm-1', 1, 'Module');
      INSERT INTO learning_lessons (uid, module_id, title, kind, ref_uid) VALUES ('l-1', 1, 'Live session', 'webinar', 'w-lesson');
      INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid, position) VALUES (1, 'course', 'c-1', 1)`);
    assert.equal((await call(webinars, env, ABSENT, '/webinars/w-lesson')).status, 200, 'held through the course');
    assert.equal((await call(webinars, env, OUTSIDER, '/webinars/w-lesson')).status, 404);
  } finally { db.close(); }
});
