/**
 * #5356 part 1 (D5356) — GET /api/learning/me names, for each in-progress course, the lesson to resume and its saved
 * position, by the same rule "Next for you" uses (services/learningResume.ts):
 *   - two started lessons in one course: the newest wins;
 *   - a completed lesson is skipped;
 *   - no started lesson: the first required lesson not completed;
 *   - a removed lesson, or one whose item is unpublished, is never named (the next rule, or the course page, answers);
 *   - another learner's rows are never read;
 *   - "Next for you" names the same lesson for the same course.
 * Synthetic people and content only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_resume_5356.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import learning from '../src/routes/learning.ts';
import plan from '../src/routes/learning_plan.ts';
import { resumeLessons } from '../src/services/learningResume.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, MEMBER = 10, PEER = 11;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [MEMBER]: 'founder', [PEER]: 'investor' };

function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  const files = readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations);
  for (const f of files.filter((x) => migrationNumber(x) > BASELINE_CUTOFF && !(migrationNumber(x) >= 388 && /^\d+_learning_/.test(x)))) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // The Learning migrations, whole and in order, as the deploy applies them (758 among them).
  for (const f of files.filter((x) => migrationNumber(x) >= 388 && /^\d+_learning_/.test(x))) {
    db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  }
  return db;
}
const BUILT = builtFromMigrations();

async function tokenFor(who: number, support = false) {
  return new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: SUPER } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

async function call(router: any, db: DatabaseSync, who: number, path: string) {
  const res: Response = await router.request(path, { headers: { Authorization: `Bearer ${await tokenFor(who)}` } }, envOf(db))
    .catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

/** One published course: a video lesson, a reading lesson, a second video lesson, and an optional exercise. */
function course(db: DatabaseSync) {
  const id = (db.prepare("SELECT id FROM learning_courses WHERE uid = 'c-open'").get() as any).id;
  db.prepare("INSERT INTO learning_course_modules (uid, course_id, title, position) VALUES ('m1', ?, 'Basics', 0)").run(id);
  const mod = (db.prepare("SELECT id FROM learning_course_modules WHERE uid = 'm1'").get() as any).id;
  const l = db.prepare('INSERT INTO learning_lessons (uid, module_id, title, position, kind, ref_uid, required) VALUES (?, ?, ?, ?, ?, ?, ?)');
  l.run('l1', mod, 'Term sheets', 0, 'video', 'v-one', 1);
  l.run('l2', mod, 'Valuation', 1, 'reading', 'r-two', 1);
  l.run('l3', mod, 'Closing', 2, 'video', 'v-three', 1);
}
let clock = 0;
const progress = (db: DatabaseSync, who: number, kind: string, uid: string, status: string, position: number | null = null) => {
  clock += 1;
  const at = `2026-11-09 10:${String(clock).padStart(2, '0')}:00`;
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, position_seconds, started_at, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'completed' THEN ? END, ?)
    ON CONFLICT (user_id, subject_kind, subject_uid) DO UPDATE SET status = excluded.status, position_seconds = excluded.position_seconds, updated_at = excluded.updated_at`)
    .run(who, kind, uid, status, position, at, status, at, at);
};
function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  for (const [id, uid, name] of [[SUPER, 'u-super', 'Super Holder'], [MEMBER, 'u-mia', 'Mia Member'], [PEER, 'u-pia', 'Pia Peer']] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, uid, `${uid}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  db.exec(`INSERT INTO learning_courses (uid, slug, title, status, visibility, created_by) VALUES ('c-open', 'fundraising-101', 'Fundraising 101', 'published', 'open', 1);
    INSERT INTO learning_items (uid, kind, title, status, visibility, duration_seconds, created_by) VALUES
      ('v-one', 'video', 'Term sheets', 'published', 'open', 600, 1),
      ('r-two', 'reading', 'Valuation', 'published', 'open', NULL, 1),
      ('v-three', 'video', 'Closing', 'published', 'open', 900, 1);`);
  course(db);
  return db;
}
const resumeOf = async (db: DatabaseSync, who = MEMBER) => (await resumeLessons(envOf(db), who)).get('c-open') ?? null;
const meRow = async (db: DatabaseSync, who = MEMBER) => (await call(learning, db, who, '/me')).body.in_progress.find((r: any) => r.subject_kind === 'course' && r.subject_uid === 'c-open');

test('two started lessons in one course: the newest wins, with its item and saved position', async () => {
  const db = seeded();
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, MEMBER, 'lesson', 'l1', 'started');
  progress(db, MEMBER, 'item', 'v-one', 'started', 120);
  progress(db, MEMBER, 'lesson', 'l3', 'started');
  progress(db, MEMBER, 'item', 'v-three', 'started', 252);
  assert.deepEqual(await resumeOf(db), { lesson_uid: 'l3', lesson_title: 'Closing', lesson_kind: 'video', item_uid: 'v-three', item_kind: 'video', position_seconds: 252, rule: 'last_started' });
  // The older one touched again becomes the newest.
  progress(db, MEMBER, 'lesson', 'l1', 'started');
  assert.equal((await resumeOf(db))?.lesson_uid, 'l1');
  assert.equal((await resumeOf(db))?.position_seconds, 120);
});

test('a completed lesson is skipped; with no started lesson the first required not completed answers', async () => {
  const db = seeded();
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, MEMBER, 'lesson', 'l1', 'completed');
  let r = await resumeOf(db);
  assert.deepEqual([r?.lesson_uid, r?.rule, r?.position_seconds, r?.item_kind], ['l2', 'first_required', null, 'reading']);
  progress(db, MEMBER, 'lesson', 'l3', 'started');
  progress(db, MEMBER, 'lesson', 'l3', 'completed');
  r = await resumeOf(db);
  assert.equal(r?.lesson_uid, 'l2', 'a lesson started then completed is not resumed');
  progress(db, MEMBER, 'lesson', 'l2', 'completed');
  assert.equal(await resumeOf(db), null, 'every required lesson done: no lesson, the course link answers');
});

test('a removed lesson, or one whose item is unpublished, is never named', async () => {
  const db = seeded();
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, MEMBER, 'lesson', 'l3', 'started');
  db.exec("UPDATE learning_items SET status = 'draft' WHERE uid = 'v-three'");
  assert.deepEqual([(await resumeOf(db))?.lesson_uid, (await resumeOf(db))?.rule], ['l1', 'first_required'], 'unpublished item: the next rule');
  db.exec("UPDATE learning_items SET status = 'published' WHERE uid = 'v-three'");
  db.exec("DELETE FROM learning_lessons WHERE uid = 'l3'");
  assert.equal((await resumeOf(db))?.lesson_uid, 'l1', 'removed lesson: the next rule');
  db.exec("UPDATE learning_items SET status = 'archived'");
  assert.equal(await resumeOf(db), null, 'nothing openable: the course page');
  db.exec("UPDATE learning_items SET status = 'published'; UPDATE learning_courses SET status = 'draft'");
  assert.equal(await resumeOf(db), null, 'an unpublished course names no lesson');
});

test("another learner's rows are never read", async () => {
  const db = seeded();
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, PEER, 'course', 'c-open', 'started');
  progress(db, PEER, 'lesson', 'l3', 'started');
  progress(db, PEER, 'item', 'v-three', 'started', 400);
  progress(db, PEER, 'lesson', 'l1', 'completed');
  progress(db, PEER, 'item', 'v-one', 'started', 333);
  const mine = await resumeOf(db, MEMBER);
  assert.deepEqual([mine?.lesson_uid, mine?.rule, mine?.position_seconds], ['l1', 'first_required', null]);
  assert.equal((await resumeLessons(envOf(db), 999)).size, 0, 'a learner with no course rows resumes nothing');
});

test('GET /me: the course row carries the resume lesson; a course without one carries null; other rows are unchanged', async () => {
  const db = seeded();
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, MEMBER, 'lesson', 'l3', 'started');
  progress(db, MEMBER, 'item', 'v-three', 'started', 252);
  const row = await meRow(db);
  assert.deepEqual([row.course_slug, row.resume.lesson_uid, row.resume.position_seconds], ['fundraising-101', 'l3', 252]);
  const me = (await call(learning, db, MEMBER, '/me')).body;
  assert.ok(me.in_progress.filter((r: any) => r.subject_kind !== 'course').every((r: any) => !('resume' in r)), 'only course rows gain resume');
  for (const l of ['l1', 'l2', 'l3']) progress(db, MEMBER, 'lesson', l, 'completed');
  assert.equal((await meRow(db)).resume, null);
});

test('"Next for you" names the same lesson Continue resumes, for the same course', async () => {
  const db = seeded();
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, MEMBER, 'lesson', 'l3', 'started');
  const next = (await call(plan, db, MEMBER, '/next')).body.next;
  const row = await meRow(db);
  assert.equal(next.rule, 'continue_course');
  assert.equal(next.uid, row.resume.lesson_uid);
  assert.match(next.href, new RegExp(`/learning/courses/${row.course_slug}/${row.resume.lesson_uid}$`));
  assert.equal(next.reason, '0 of 3 required lessons complete.');
});
