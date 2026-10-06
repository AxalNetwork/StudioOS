/**
 * D558 (#1159) — Learning programs: migration 389, the Super Admin's
 * authoring (`routes/admin_learning_programs.ts`), self-enrolment and the
 * assigned admin's read-only learner view (`routes/learning_programs.ts`),
 * and `canSeeLearning` opening program content to enrolled members.
 *
 * Run on a database built from the baseline and every migration through 390,
 * as production builds it. What is pinned:
 *
 *   - an unassigned admin gets 403; an assigned admin sees only their own
 *     program's members; the Super Admin sees every program;
 *   - a member self-enrols only into a published open program;
 *   - program content opens to an enrolled member only, directly or through a
 *     course the program holds, and closes again when they are removed;
 *   - every Super Admin write records its actor; no payload carries an email;
 *   - 389 applies cleanly.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_programs_d558.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import learning from '../src/routes/learning.ts';
import adminLearning from '../src/routes/admin_learning.ts';
import assessment from '../src/routes/learning_assessment.ts';
import adminAssessment from '../src/routes/admin_learning_assessment.ts';
import programs from '../src/routes/learning_programs.ts';
import adminPrograms from '../src/routes/admin_learning_programs.ts';
import { canSeeLearning } from '../src/services/learningAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(n + '_')) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, ASSIGNED = 2, OTHER_ADMIN = 3, MEMBER = 10, PEER = 11, OUTSIDER = 12;
const ROLE: Record<number, string> = {
  [SUPER]: 'admin', [ASSIGNED]: 'admin', [OTHER_ADMIN]: 'admin', [MEMBER]: 'founder', [PEER]: 'investor', [OUTSIDER]: 'founder',
};
const UID: Record<number, string> = {
  [SUPER]: 'u-super', [ASSIGNED]: 'u-assigned', [OTHER_ADMIN]: 'u-other-admin', [MEMBER]: 'u-mia', [PEER]: 'u-pia', [OUTSIDER]: 'u-otto',
};

function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 388)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // The Learning migrations, whole and in order, as the deploy applies them.
  db.exec(sqlOf('388'));
  db.exec(sqlOf('389'));
  db.exec(sqlOf('390'));
  return db;
}
const BUILT = builtFromMigrations();

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  const users = [[SUPER, 'Super Holder'], [ASSIGNED, 'Ada Assigned'], [OTHER_ADMIN, 'Olu Other'], [MEMBER, 'Mia Member'],
    [PEER, 'Pia Peer'], [OUTSIDER, 'Otto Outside']] as const;
  for (const [id, name] of users) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(id, UID[id], `${UID[id]}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  return db;
}

async function tokenFor(who: number) {
  return new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

/** Every response body this file reads, so the no-email check covers them all. */
const SEEN: string[] = [];

async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await tokenFor(who)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  const text = await res.text();
  SEEN.push(text);
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body };
}
const author = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminLearning, db, who, path, init);
const authorA = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminAssessment, db, who, path, init);
const sa = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminPrograms, db, who, path, init);
const learn = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(learning, db, who, path, init);
const assess = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(assessment, db, who, path, init);
const prog = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(programs, db, who, path, init);

/** A published program-only video, a published program-only course with one reading lesson, an exam and an exercise. */
async function content(db: DatabaseSync) {
  const video = (await author(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'Cohort welcome', video_url: 'https://youtu.be/w', visibility: 'program' } })).body.item;
  await author(db, SUPER, `/items/${video.uid}/publish`, { method: 'POST' });
  const reading = (await author(db, SUPER, '/items', { method: 'POST', body: { kind: 'reading', title: 'Regional rules', body: 'Text', visibility: 'program' } })).body.item;
  await author(db, SUPER, `/items/${reading.uid}/publish`, { method: 'POST' });
  const course = (await author(db, SUPER, '/courses', { method: 'POST', body: { slug: 'nordic-101', title: 'Nordic 101', visibility: 'program' } })).body.course;
  const mod = (await author(db, SUPER, `/courses/${course.uid}/modules`, { method: 'POST', body: { title: 'Basics' } })).body.course.modules[0];
  const lesson = (await author(db, SUPER, `/modules/${mod.uid}/lessons`, { method: 'POST', body: { kind: 'reading', title: 'Read the rules', ref_uid: reading.uid } })).body.course.modules[0].lessons[0];
  await author(db, SUPER, `/courses/${course.uid}/publish`, { method: 'POST' });
  const exam = (await authorA(db, SUPER, '/exams', { method: 'POST', body: { title: 'Nordic check', pass_mark_percent: 50 } })).body.exam;
  const tree = (await authorA(db, SUPER, `/exams/${exam.uid}/questions`, { method: 'POST', body: { prompt: 'Capital?', kind: 'single', options: ['Oslo', 'Rome'], correct: [0] } })).body.exam;
  await authorA(db, SUPER, `/exams/${exam.uid}/publish`, { method: 'POST' });
  const exercise = (await authorA(db, SUPER, '/exercises', { method: 'POST', body: { title: 'Plan', submission_kind: 'text' } })).body.exercise;
  await authorA(db, SUPER, `/exercises/${exercise.uid}/publish`, { method: 'POST' });
  db.exec(`UPDATE learning_exams SET visibility = 'program'; UPDATE learning_exercises SET visibility = 'program';`);
  return { video, reading, course, lesson, exam, q1: tree.questions[0], exercise };
}

/** A published program holding `subjects`, with ASSIGNED as its admin. */
async function program(db: DatabaseSync, body: Record<string, unknown>, subjects: Array<[string, string]>, adminWho: number | null = ASSIGNED) {
  const made = await sa(db, SUPER, '/programs', { method: 'POST', body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const uid = made.body.program.uid;
  const put = await sa(db, SUPER, `/programs/${uid}/contents`, { method: 'PUT', body: { contents: subjects.map(([k, u]) => ({ subject_kind: k, subject_uid: u })) } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  if (adminWho) assert.equal((await sa(db, SUPER, `/programs/${uid}/admins`, { method: 'POST', body: { user_uid: UID[adminWho] } })).status, 200);
  await sa(db, SUPER, `/programs/${uid}`, { method: 'PATCH', body: { status: 'published' } });
  return uid as string;
}

// ---- the migration ---------------------------------------------------------------

test('389 applies to a database built from the migrations, with its sets as CHECKs', () => {
  const db = seeded();
  for (const t of ['learning_programs', 'learning_program_contents', 'learning_program_admins', 'learning_enrollments']) {
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t), `${t} is missing`);
  }
  assert.throws(() => db.exec(`INSERT INTO learning_programs (uid, name, enrolment, created_by) VALUES ('p', 'P', 'public', 1)`), /CHECK/);
  db.exec(`INSERT INTO learning_programs (uid, name, created_by) VALUES ('p', 'P', 1)`);
  const p = db.prepare(`SELECT enrolment, status FROM learning_programs WHERE uid = 'p'`).get() as any;
  assert.deepEqual([p.enrolment, p.status], ['invite', 'draft'], 'a new program is a draft, by invitation');
  db.exec(`INSERT INTO learning_enrollments (program_id, user_id, enrolled_by) VALUES (1, ${MEMBER}, ${SUPER})`);
  assert.throws(() => db.exec(`INSERT INTO learning_enrollments (program_id, user_id, enrolled_by) VALUES (1, ${MEMBER}, ${SUPER})`), /UNIQUE/);
  assert.throws(() => db.exec(`UPDATE learning_enrollments SET status = 'gone'`), /CHECK/);
  db.exec(`INSERT INTO learning_program_admins (program_id, user_id, assigned_by) VALUES (1, ${ASSIGNED}, ${SUPER})`);
  assert.throws(() => db.exec(`INSERT INTO learning_program_admins (program_id, user_id, assigned_by) VALUES (1, ${ASSIGNED}, ${SUPER})`), /UNIQUE/);
  assert.throws(() => db.exec(`INSERT INTO learning_program_contents (program_id, subject_kind, subject_uid) VALUES (1, 'article', 'x')`), /CHECK/);
});

// ---- the Super Admin's writes ------------------------------------------------------

test('only the Super Admin authors programs, and every write records its actor', async () => {
  const db = seeded();
  const { video } = await content(db);
  for (const who of [MEMBER, ASSIGNED]) {
    assert.equal((await sa(db, who, '/programs', { method: 'POST', body: { name: 'Nordics' } })).status, 403, `user ${who} created a program`);
    assert.equal((await sa(db, who, '/programs')).status, 403, `user ${who} listed every program`);
  }
  const uid = await program(db, { name: 'Nordics', region: 'Nordics', enrolment: 'invite' }, [['item', video.uid]]);
  assert.equal((await sa(db, SUPER, `/programs/${uid}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } })).status, 200);
  assert.equal((await sa(db, SUPER, `/programs/${uid}/enrollments/${UID[MEMBER]}`, { method: 'DELETE' })).status, 200);
  assert.equal((await sa(db, SUPER, `/programs/${uid}/admins/${UID[ASSIGNED]}`, { method: 'DELETE' })).status, 200);
  const audit = db.prepare(`SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action LIKE 'learning.program.%' ORDER BY id`).all() as any[];
  assert.deepEqual(audit.map((a) => [a.admin_user_id, a.action]), [
    [SUPER, 'learning.program.create'], [SUPER, 'learning.program.contents'], [SUPER, 'learning.program.admin.assign'],
    [SUPER, 'learning.program.update'], [SUPER, 'learning.program.enrol'], [SUPER, 'learning.program.unenrol'],
    [SUPER, 'learning.program.admin.unassign'],
  ]);
  assert.ok(audit.every((a) => a.filters_json.includes(uid)), 'an audit row does not name its program');
  const row = db.prepare(`SELECT status, enrolled_by FROM learning_enrollments WHERE user_id = ?`).get(MEMBER) as any;
  assert.deepEqual([row.status, row.enrolled_by], ['removed', SUPER], 'unenrolling deleted the row instead of marking it');
});

test('an assigned admin must be an admin; contents must exist, once each, and not be a webinar yet', async () => {
  const db = seeded();
  const { video, course } = await content(db);
  const uid = (await sa(db, SUPER, '/programs', { method: 'POST', body: { name: 'Nordics' } })).body.program.uid;
  const member = await sa(db, SUPER, `/programs/${uid}/admins`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  assert.deepEqual([member.status, member.body.error], [400, 'not_an_admin']);
  assert.equal((await sa(db, SUPER, `/programs/${uid}/admins`, { method: 'POST', body: { user_uid: 'nobody' } })).status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_program_admins').get() as any).n, 0);
  const put = (contents: unknown) => sa(db, SUPER, `/programs/${uid}/contents`, { method: 'PUT', body: { contents } });
  assert.equal((await put([{ subject_kind: 'webinar', subject_uid: 'w1' }])).body.error, 'webinar_not_built');
  assert.equal((await put([{ subject_kind: 'item', subject_uid: 'no-such' }])).body.error, 'unknown_content');
  assert.equal((await put([{ subject_kind: 'item', subject_uid: video.uid }, { subject_kind: 'item', subject_uid: video.uid }])).body.error, 'duplicate_content');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_program_contents').get() as any).n, 0, 'a refused list was stored');
  const ok = await put([{ subject_kind: 'course', subject_uid: course.uid }, { subject_kind: 'item', subject_uid: video.uid }]);
  assert.deepEqual(ok.body.contents.map((x: any) => [x.subject_kind, x.position, x.title]), [['course', 0, 'Nordic 101'], ['item', 1, 'Cohort welcome']]);
});

// ---- members ------------------------------------------------------------------------

test('a member self-enrols only into a published open program', async () => {
  const db = seeded();
  const { video } = await content(db);
  const open = await program(db, { name: 'Open cohort', enrolment: 'open' }, [['item', video.uid]]);
  const invite = await program(db, { name: 'Invite cohort', enrolment: 'invite' }, [['item', video.uid]]);
  const draft = (await sa(db, SUPER, '/programs', { method: 'POST', body: { name: 'Draft cohort', enrolment: 'open' } })).body.program.uid;
  assert.deepEqual((await prog(db, MEMBER, '/programs')).body.programs.map((p: any) => [p.name, p.enrolled]), [['Open cohort', false]],
    'the open list showed an invite-only or draft program');
  const r1 = await prog(db, MEMBER, `/programs/${open}/enrol`, { method: 'POST' });
  assert.equal(r1.status, 201);
  assert.equal((await prog(db, MEMBER, `/programs/${open}/enrol`, { method: 'POST' })).status, 200, 'a second enrol is not idempotent');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_enrollments WHERE user_id = ?').get(MEMBER) as any).n, 1);
  const inv = await prog(db, MEMBER, `/programs/${invite}/enrol`, { method: 'POST' });
  assert.deepEqual([inv.status, inv.body.error], [403, 'invite_only']);
  assert.equal((await prog(db, MEMBER, `/programs/${draft}/enrol`, { method: 'POST' })).status, 404, 'a draft program took an enrolment');
  assert.deepEqual((await prog(db, MEMBER, '/programs/enrolled')).body.programs.map((p: any) => p.name), ['Open cohort']);
  await sa(db, SUPER, `/programs/${open}/enrollments/${UID[MEMBER]}`, { method: 'DELETE' });
  const back = await prog(db, MEMBER, `/programs/${open}/enrol`, { method: 'POST' });
  assert.deepEqual([back.status, back.body.error], [403, 'removed'], 'a removed member enrolled themselves back');
  const self = db.prepare('SELECT enrolled_by FROM learning_enrollments WHERE user_id = ?').get(MEMBER) as any;
  assert.equal(self.enrolled_by, MEMBER, 'a self-enrolment did not record the member as its actor');
});

test('program content opens to an enrolled member only, directly or through a held course, and closes on removal', async () => {
  const db = seeded();
  const { video, reading, course, lesson, exam, exercise } = await content(db);
  const uid = await program(db, { name: 'Nordics', enrolment: 'invite' },
    [['item', video.uid], ['course', course.uid], ['exam', exam.uid], ['exercise', exercise.uid]]);
  const closed = async (who: number) => {
    assert.equal((await learn(db, who, `/items/${video.uid}`)).status, 404, 'a held item opened');
    assert.equal((await learn(db, who, `/items/${reading.uid}`)).status, 404, 'an item held through a course opened');
    assert.equal((await learn(db, who, `/courses/${course.slug}`)).status, 404, 'a held course opened');
    assert.equal((await assess(db, who, `/exams/${exam.uid}`)).status, 404, 'a held exam opened');
    assert.equal((await assess(db, who, `/exercises/${exercise.uid}`)).status, 404, 'a held exercise opened');
    const cat = (await learn(db, who, '/catalog?kind=video')).body;
    assert.deepEqual([cat.items.length, cat.sources.video.total], [0, 0], 'the catalog listed or counted a held video');
    assert.equal((await learn(db, who, '/progress', { method: 'POST', body: { subject_kind: 'lesson', subject_uid: lesson.uid, status: 'started' } })).status, 404);
  };
  await closed(MEMBER);
  await sa(db, SUPER, `/programs/${uid}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  assert.equal((await learn(db, MEMBER, `/items/${video.uid}`)).status, 200, 'an enrolled member could not open a held item');
  assert.equal((await learn(db, MEMBER, `/items/${reading.uid}`)).status, 200, 'an enrolled member could not open an item held through a course');
  assert.equal((await learn(db, MEMBER, `/courses/${course.slug}`)).status, 200);
  assert.equal((await assess(db, MEMBER, `/exams/${exam.uid}`)).status, 200);
  assert.equal((await assess(db, MEMBER, `/exercises/${exercise.uid}`)).status, 200);
  const cat = (await learn(db, MEMBER, '/catalog?kind=video')).body;
  assert.deepEqual([cat.items.map((x: any) => x.id), cat.sources.video.total], [[video.uid], 1]);
  assert.equal('enrolled' in (await learn(db, MEMBER, `/items/${video.uid}`)).body.item, false, 'the item payload leaked the enrolled flag');
  await closed(PEER);
  await sa(db, SUPER, `/programs/${uid}`, { method: 'PATCH', body: { status: 'draft' } });
  assert.equal((await learn(db, MEMBER, `/items/${video.uid}`)).status, 404, 'a draft program opened its content');
  await sa(db, SUPER, `/programs/${uid}`, { method: 'PATCH', body: { status: 'published' } });
  await sa(db, SUPER, `/programs/${uid}/enrollments/${UID[MEMBER]}`, { method: 'DELETE' });
  await closed(MEMBER);
  // The function itself: the route's `enrolled` column is what opens program content.
  assert.equal(canSeeLearning({ role: 'founder' }, { status: 'published', visibility: 'program', enrolled: 1 }), true);
  assert.equal(canSeeLearning({ role: 'founder' }, { status: 'published', visibility: 'program', enrolled: 0 }), false);
  assert.equal(canSeeLearning({ role: 'founder' }, { status: 'draft', visibility: 'program', enrolled: 1 }), false);
});

// ---- the assigned admin's read-only view --------------------------------------------

test('an unassigned admin gets 403; an assigned admin sees only their program; the Super Admin sees all', async () => {
  const db = seeded();
  const { video, reading, course, lesson, exam, q1, exercise } = await content(db);
  const nordics = await program(db, { name: 'Nordics', enrolment: 'invite' },
    [['course', course.uid], ['item', video.uid], ['exam', exam.uid], ['exercise', exercise.uid]]);
  const baltics = await program(db, { name: 'Baltics', enrolment: 'invite' }, [['item', video.uid]], OTHER_ADMIN);
  await sa(db, SUPER, `/programs/${nordics}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  await sa(db, SUPER, `/programs/${nordics}/enrollments`, { method: 'POST', body: { user_uid: UID[PEER] } });
  await sa(db, SUPER, `/programs/${baltics}/enrollments`, { method: 'POST', body: { user_uid: UID[OUTSIDER] } });

  // Mia: the video done, the course's one required lesson done, the exam passed, the exercise submitted.
  await learn(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: video.uid, status: 'completed' } });
  await learn(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'lesson', subject_uid: lesson.uid, status: 'completed' } });
  const att = (await assess(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' })).body;
  await assess(db, MEMBER, `/exams/${exam.uid}/attempts/${att.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [0] } } });
  await assess(db, MEMBER, `/exercises/${exercise.uid}/submissions`, { method: 'POST', body: { body: 'My plan' } });
  void reading;

  for (const who of [OTHER_ADMIN, MEMBER]) {
    const r1 = await prog(db, who, `/programs/${nordics}/learners`);
    assert.equal(r1.status, 403, `user ${who} read the learners of a program not assigned to them`);
    assert.equal((await prog(db, who, `/programs/${nordics}/learners/${UID[MEMBER]}`)).status, 403);
  }
  assert.deepEqual((await prog(db, ASSIGNED, '/programs/mine')).body.programs.map((p: any) => p.name), ['Nordics']);
  assert.deepEqual((await prog(db, SUPER, '/programs/mine')).body.programs.map((p: any) => p.name).sort(), ['Baltics', 'Nordics']);
  assert.equal((await prog(db, MEMBER, '/programs/mine')).status, 403);

  const view = await prog(db, ASSIGNED, `/programs/${nordics}/learners`);
  assert.equal(view.status, 200);
  assert.deepEqual(view.body.learners.map((l: any) => l.uid).sort(), [UID[MEMBER], UID[PEER]], 'the view held a learner of another program');
  const mia = view.body.learners.find((l: any) => l.uid === UID[MEMBER]);
  const byKind = Object.fromEntries(mia.completion.map((x: any) => [x.subject_kind, x]));
  assert.deepEqual([byKind.course.status, byKind.course.completed, byKind.course.required, byKind.course.percent], ['completed', 1, 1, 100]);
  assert.equal(byKind.item.status, 'completed');
  assert.deepEqual([byKind.exam.status, byKind.exam.best_score_percent, byKind.exam.attempts], ['passed', 100, 1]);
  assert.equal(byKind.exercise.status, 'submitted');
  const pia = view.body.learners.find((l: any) => l.uid === UID[PEER]);
  assert.deepEqual(pia.completion.map((x: any) => x.status), ['not_started', 'not_started', 'not_attempted', 'not_submitted']);
  assert.equal(pia.completion.find((x: any) => x.subject_kind === 'exam').best_score_percent, null, 'no attempt read as a score of 0');
  assert.deepEqual(Object.keys(mia).sort(), ['completion', 'enrolled_at', 'name', 'uid']);

  const one = await prog(db, ASSIGNED, `/programs/${nordics}/learners/${UID[PEER]}`);
  assert.equal(one.body.learner.name, 'Pia Peer');
  assert.equal((await prog(db, ASSIGNED, `/programs/${nordics}/learners/${UID[OUTSIDER]}`)).status, 404, 'a learner of another program was served');
  assert.equal((await prog(db, SUPER, `/programs/${baltics}/learners`)).body.learners[0].uid, UID[OUTSIDER], 'the Super Admin could not read every program');

  // D559's review routes now admit the assigned admin, for their own learners only.
  assert.equal((await assess(db, OTHER_ADMIN, `/review/exams/${exam.uid}/attempts`)).status, 403);
  const rev = await assess(db, ASSIGNED, `/review/exams/${exam.uid}/attempts`);
  assert.deepEqual(rev.body.attempts.map((a: any) => a.learner_uid), [UID[MEMBER]]);
  const subs = await assess(db, ASSIGNED, `/review/exercises/${exercise.uid}/submissions`);
  assert.deepEqual(subs.body.submissions.map((s: any) => s.learner_uid), [UID[MEMBER]]);
  await sa(db, SUPER, `/programs/${nordics}/enrollments/${UID[MEMBER]}`, { method: 'DELETE' });
  assert.deepEqual((await assess(db, ASSIGNED, `/review/exams/${exam.uid}/attempts`)).body.attempts, [], 'a removed learner\'s work stayed readable');
  assert.deepEqual((await prog(db, ASSIGNED, `/programs/${nordics}/learners`)).body.learners.map((l: any) => l.uid), [UID[PEER]],
    'a removed learner stayed in the learner view');
});

test('a program the caller is not in is not found; an enrolled member sees their own completion', async () => {
  const db = seeded();
  const { video } = await content(db);
  const invite = await program(db, { name: 'Invite cohort', enrolment: 'invite' }, [['item', video.uid]]);
  assert.equal((await prog(db, MEMBER, `/programs/${invite}`)).status, 404, 'an invite-only program was shown to an outsider');
  assert.equal((await prog(db, ASSIGNED, `/programs/${invite}`)).status, 200, 'the assigned admin could not open their program');
  await sa(db, SUPER, `/programs/${invite}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  await learn(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: video.uid, status: 'started', percent: 40 } });
  const mine = await prog(db, MEMBER, `/programs/${invite}`);
  assert.equal(mine.status, 200);
  assert.deepEqual([mine.body.enrolled, mine.body.my_completion[0].status, mine.body.my_completion[0].percent], [true, 'in_progress', 40]);
  assert.equal(mine.body.contents[0].href, `/learning/items/${video.uid}`);
});

// ---- #1251: My programs in one read --------------------------------------------------

/** `prog`, over a D1 binding the caller supplies (to count or fail its queries). */
async function progOver(DB: any, who: number, path: string) {
  const res: Response = await programs.request(path, { headers: { Authorization: `Bearer ${await tokenFor(who)}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB } as any);
  const text = await res.text();
  SEEN.push(text);
  return { status: res.status, body: JSON.parse(text) };
}
/** A D1 binding over `db` that counts statements, and throws on one whose SQL matches `fail`. */
function watched(db: DatabaseSync, fail?: RegExp) {
  const inner = d1Over(db);
  const w = {
    queries: 0,
    prepare(sql: string) {
      w.queries += 1;
      if (fail && fail.test(sql)) throw new Error('injected failure');
      return inner.prepare(sql);
    },
    batch: (xs: any[]) => inner.batch(xs),
  };
  return w;
}

test('#1251: GET /programs/enrolled answers each program\'s contents and the caller\'s completion, as the detail read does', async () => {
  const db = seeded();
  const { video, reading, course, lesson, exam, q1, exercise } = await content(db);
  const nordics = await program(db, { name: 'Nordics', enrolment: 'invite' },
    [['course', course.uid], ['item', video.uid], ['exam', exam.uid], ['exercise', exercise.uid]]);
  const baltics = await program(db, { name: 'Baltics', enrolment: 'invite' }, [['item', reading.uid], ['item', video.uid]]);
  const other = await program(db, { name: 'Iberia', enrolment: 'invite' }, [['exam', exam.uid]]);
  for (const uid of [nordics, baltics]) await sa(db, SUPER, `/programs/${uid}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  for (const uid of [nordics, baltics, other]) await sa(db, SUPER, `/programs/${uid}/enrollments`, { method: 'POST', body: { user_uid: UID[PEER] } });

  // Mia: the video at 40%, the course's lesson done. Pia: everything done, which Mia must not see.
  await learn(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: video.uid, status: 'started', percent: 40 } });
  await learn(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'lesson', subject_uid: lesson.uid, status: 'completed' } });
  await learn(db, PEER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: video.uid, status: 'completed' } });
  await learn(db, PEER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: reading.uid, status: 'completed' } });
  const att = (await assess(db, PEER, `/exams/${exam.uid}/attempts`, { method: 'POST' })).body;
  await assess(db, PEER, `/exams/${exam.uid}/attempts/${att.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [0] } } });
  await assess(db, PEER, `/exercises/${exercise.uid}/submissions`, { method: 'POST', body: { body: 'Pia plan' } });

  const list = await prog(db, MEMBER, '/programs/enrolled');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.programs.map((p: any) => p.name), ['Baltics', 'Nordics'], 'a program the member is not in was listed');
  for (const p of list.body.programs) {
    const detail = (await prog(db, MEMBER, `/programs/${p.uid}`)).body;
    assert.deepEqual(p.contents, detail.contents, `${p.name}: the contents differ from the detail read`);
    assert.deepEqual(p.my_completion, detail.my_completion, `${p.name}: the completion differs from the detail read`);
  }
  const n = list.body.programs.find((p: any) => p.name === 'Nordics');
  assert.deepEqual(n.contents.map((x: any) => [x.subject_kind, x.title, x.status]),
    [['course', 'Nordic 101', 'published'], ['item', 'Cohort welcome', 'published'], ['exam', 'Nordic check', 'published'], ['exercise', 'Plan', 'published']]);
  assert.deepEqual(n.my_completion.map((x: any) => x.status), ['completed', 'in_progress', 'not_attempted', 'not_submitted'],
    'the member read another learner\'s completion');
  assert.equal(n.my_completion[1].percent, 40);
  const b = list.body.programs.find((p: any) => p.name === 'Baltics');
  assert.deepEqual(b.contents.map((x: any) => x.subject_uid), [reading.uid, video.uid], 'a program\'s contents were mixed with another\'s');
  assert.deepEqual(b.my_completion.map((x: any) => x.status), ['not_started', 'in_progress']);
  // Pia's own reply carries her own completion.
  const pia = (await prog(db, PEER, '/programs/enrolled')).body.programs.find((p: any) => p.name === 'Nordics');
  assert.deepEqual(pia.my_completion.map((x: any) => x.status), ['not_started', 'completed', 'passed', 'submitted']);
  // A content row whose store row is gone says so on its own line, and the rest still draws.
  db.prepare('DELETE FROM learning_items WHERE uid = ?').run(reading.uid);
  const gone = (await prog(db, MEMBER, '/programs/enrolled')).body.programs.find((p: any) => p.name === 'Baltics');
  assert.deepEqual(gone.contents.map((x: any) => x.status), ['missing', 'published']);
});

test('#1251: the enrolled read is a fixed number of queries, however many programs; a failed round blanks no program', async () => {
  const db = seeded();
  const { video, course, exam, exercise } = await content(db);
  const all = [['course', course.uid], ['item', video.uid], ['exam', exam.uid], ['exercise', exercise.uid]] as Array<[string, string]>;
  const count = async () => {
    const w = watched(db);
    const r = await progOver(w, MEMBER, '/programs/enrolled');
    assert.equal(r.status, 200);
    return [r.body.programs.length, w.queries];
  };
  const one = await program(db, { name: 'P1', enrolment: 'invite' }, all);
  await sa(db, SUPER, `/programs/${one}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  const [n1, q1] = await count();
  for (const name of ['P2', 'P3', 'P4']) {
    const uid = await program(db, { name, enrolment: 'invite' }, all);
    await sa(db, SUPER, `/programs/${uid}/enrollments`, { method: 'POST', body: { user_uid: UID[MEMBER] } });
  }
  const [n4, q4] = await count();
  assert.deepEqual([n1, n4], [1, 4]);
  assert.equal(q4, q1, `four programs took ${q4} queries and one took ${q1}: a query ran per program`);

  const w = watched(db, /FROM learning_program_contents pc/);
  const r = await progOver(w, MEMBER, '/programs/enrolled');
  assert.equal(r.status, 200, 'a failed contents read failed the whole list');
  assert.deepEqual(r.body.programs.map((p: any) => [p.name, p.contents, p.my_completion, p.contents_error]),
    ['P1', 'P2', 'P3', 'P4'].map((name) => [name, null, null, 'unavailable']));
});

test('no payload carries an email', () => {
  assert.ok(SEEN.length > 50, 'the payload check ran over too few responses');
  const leaked = SEEN.filter((t) => /@example\.test/.test(t));
  assert.deepEqual(leaked, [], 'a response carried an email');
});
