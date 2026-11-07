/**
 * #4650 (Learning audit 5/5, D4650) — the next learning action and its reason.
 *
 *   1. rule order: an unfinished course's next required lesson first, then the
 *      next incomplete content of an enrolled program, then the next planned
 *      item; each with its reason and what "Add to my plan" plans;
 *   2. eligibility first: content the member cannot see (a draft, a program
 *      they are not in) is never suggested;
 *   3. completion by D4643's definitions: a program exam is next until an
 *      attempt PASSES (a failed one does not finish it);
 *   4. nothing found is the empty state naming what was checked, and another
 *      member's progress or plan never moves this member's answer.
 *
 * Synthetic people and content only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_next_4650.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import plan from '../src/routes/learning_plan.ts';
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

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  for (const [id, uid, name] of [[SUPER, 'u-super', 'Super Holder'], [MEMBER, 'u-mia', 'Mia Member'], [PEER, 'u-pia', 'Pia Peer']] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, uid, `${uid}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  // The catalogue: what a member may and may not plan.
  db.exec(`INSERT INTO learning_courses (uid, slug, title, status, visibility, created_by) VALUES
      ('c-open', 'fundraising-101', 'Fundraising 101', 'published', 'open', 1),
      ('c-draft', 'secret-draft', 'Secret Draft', 'draft', 'open', 1);
    INSERT INTO learning_items (uid, kind, title, status, visibility, created_by) VALUES
      ('v-open', 'video', 'Pitch Basics', 'published', 'open', 1),
      ('v-program', 'video', 'Cohort Only', 'published', 'program', 1);
    INSERT INTO learning_exams (uid, title, status, visibility, created_by) VALUES ('x-open', 'Term Sheets Quiz', 'published', 'open', 1);`);
  return db;
}

async function tokenFor(who: number, support = false) {
  return new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: SUPER } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

async function call(db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown; support?: boolean } = {}) {
  const res: Response = await plan.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await tokenFor(who, init.support)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, envOf(db)).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body };
}


const next = async (db: DatabaseSync, who: number) => (await call(db, who, '/next')).body;
/** A published course of three required lessons and one optional, in an open course. */
function course(db: DatabaseSync, uid = 'c-open') {
  const id = (db.prepare('SELECT id FROM learning_courses WHERE uid = ?').get(uid) as any).id;
  db.prepare("INSERT INTO learning_course_modules (uid, course_id, title, position) VALUES (?, ?, 'Basics', 0)").run(`m-${uid}`, id);
  const mod = (db.prepare('SELECT id FROM learning_course_modules WHERE uid = ?').get(`m-${uid}`) as any).id;
  const l = db.prepare("INSERT INTO learning_lessons (uid, module_id, title, position, kind, ref_uid, required) VALUES (?, ?, ?, ?, 'reading', 'itm', ?)");
  l.run(`${uid}-l1`, mod, 'Term sheets', 0, 1); l.run(`${uid}-l2`, mod, 'Valuation', 1, 1); l.run(`${uid}-l3`, mod, 'Closing', 2, 1); l.run(`${uid}-opt`, mod, 'Extra', 3, 0);
}
const progress = (db: DatabaseSync, who: number, kind: string, uid: string, status: string) =>
  db.prepare("INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, completed_at) VALUES (?, ?, ?, ?, CASE WHEN ? = 'completed' THEN '2026-11-01' END)").run(who, kind, uid, status, status);
function program(db: DatabaseSync, contents: Array<[string, string]>, enrol: number[] = [MEMBER]) {
  db.exec("INSERT INTO learning_programs (uid, name, status, created_by) VALUES ('p-one', 'Founder track', 'published', 1)");
  const pid = (db.prepare("SELECT id FROM learning_programs WHERE uid = 'p-one'").get() as any).id;
  contents.forEach(([kind, uid], i) => db.prepare('INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid, position) VALUES (?, ?, ?, ?)').run(pid, kind, uid, i));
  for (const u of enrol) db.prepare("INSERT INTO learning_enrollments (program_id, user_id, status, enrolled_by) VALUES (?, ?, 'active', 1)").run(pid, u);
}

test('1. an unfinished course comes first: its next required lesson, why, and what Add to my plan plans', async () => {
  // Mutation checked: the required filter dropped -> the reason counts the optional lesson (1 of 4).
  const db = seeded();
  course(db);
  progress(db, MEMBER, 'course', 'c-open', 'started');
  progress(db, MEMBER, 'lesson', 'c-open-l1', 'completed');
  progress(db, MEMBER, 'lesson', 'c-open-opt', 'completed');
  const r = await next(db, MEMBER);
  assert.equal(r.next.rule, 'continue_course');
  assert.deepEqual([r.next.kind, r.next.uid, r.next.title, r.next.reason], ['lesson', 'c-open-l2', 'Fundraising 101: Valuation', '1 of 3 required lessons complete.']);
  assert.match(r.next.href, /\/learning\/courses\/fundraising-101\/c-open-l2$/);
  assert.deepEqual(r.next.plan, { kind: 'lesson', uid: 'c-open-l2', title: 'Valuation' });
  assert.deepEqual(r.checked, ['continue_course']);
});

test('2. then the next incomplete program content, by D4643\'s completion: a failed exam is still next', async () => {
  // Mutation checked: any submitted attempt counted as done -> the failed exam is skipped and the video is offered.
  const db = seeded();
  program(db, [['exam', 'x-open'], ['item', 'v-open']]);
  const examId = (db.prepare("SELECT id FROM learning_exams WHERE uid = 'x-open'").get() as any).id;
  db.prepare("INSERT INTO learning_exam_attempts (uid, exam_id, user_id, started_at, question_order_json, submitted_at, score_percent, passed) VALUES ('a1', ?, ?, '2026-11-01', '[]', '2026-11-01', 40, 0)").run(examId, MEMBER);
  let r = await next(db, MEMBER);
  assert.deepEqual([r.next.rule, r.next.kind, r.next.uid, r.next.reason], ['program', 'exam', 'x-open', 'Next in Founder track.']);
  db.prepare("INSERT INTO learning_exam_attempts (uid, exam_id, user_id, started_at, question_order_json, submitted_at, score_percent, passed) VALUES ('a2', ?, ?, '2026-11-02', '[]', '2026-11-02', 90, 1)").run(examId, MEMBER);
  r = await next(db, MEMBER);
  assert.deepEqual([r.next.kind, r.next.uid, r.next.title], ['video', 'v-open', 'Pitch Basics']);
  assert.deepEqual(r.checked, ['continue_course', 'program']);
});

test('3. eligibility first: a draft course in progress and a program video the member may not see are skipped', async () => {
  // Mutation checked: both visibility checks of rule 1 dropped (the course's and its lesson's) -> the draft course's lesson is offered.
  const db = seeded();
  course(db, 'c-draft');
  progress(db, MEMBER, 'course', 'c-draft', 'started');
  // A program the member is NOT in holds the program-only video; the member is in an empty one.
  program(db, [['item', 'v-program']], [PEER]);
  const r = await next(db, MEMBER);
  assert.equal(r.next, null);
  assert.deepEqual(r.checked, ['continue_course', 'program', 'plan']);
  assert.match(r.empty, /^Nothing is waiting/);
  // The peer, enrolled, is offered it.
  assert.equal((await next(db, PEER)).next.uid, 'v-program');
});

test('4. then the next planned item; nothing found is the empty state; another member never moves this answer', async () => {
  // Mutation checked: the plan query not bound to the caller -> the peer's planned exam is offered to the member.
  const db = seeded();
  const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
  db.prepare("INSERT INTO learning_plan_items (uid, user_id, item_kind, item_uid, starts_at, duration_min, repeat) VALUES ('pi-peer', ?, 'exam', 'x-open', ?, 30, 'none')").run(PEER, at);
  let r = await next(db, MEMBER);
  assert.equal(r.next, null, 'the peer\'s plan is not the member\'s');
  db.prepare("INSERT INTO learning_plan_items (uid, user_id, item_kind, item_uid, starts_at, duration_min, repeat) VALUES ('pi-mine', ?, 'video', 'v-open', ?, 30, 'none')").run(MEMBER, at);
  r = await next(db, MEMBER);
  assert.deepEqual([r.next.rule, r.next.uid, r.next.reason, r.next.plan], ['plan', 'v-open', `In your plan for ${at.slice(0, 10)}.`, null]);
});
