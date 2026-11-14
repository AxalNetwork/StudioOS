/**
 * #3959 — a member's learning plan: migration 758, `routes/learning_plan.ts`
 * and `services/learningPlan.ts` (the calendar source and the reminder sweep).
 *
 * Run on a database built from the baseline and every migration, with the
 * Learning migrations (388 on, 758 included) applied whole. What is pinned:
 *
 *   - a subject the caller cannot see (a draft, program content they are not
 *     enrolled in) is refused 404, the same as one that does not exist;
 *   - planning a webinar registers the member once, through the capacity
 *     check, at the webinar's own time;
 *   - daily and weekly repeats expand inside the requested range only;
 *   - completion Learning already records marks the item done;
 *   - another member's plan is never read or written;
 *   - planning an exam starts no attempt;
 *   - the reminder sweep sends each occurrence's reminder once;
 *   - a support session cannot change a plan.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_plan_3959.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import plan from '../src/routes/learning_plan.ts';
import { learningEvents, occurrences, sendPlanReminders } from '../src/services/learningPlan.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, MEMBER = 10, PEER = 11;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [MEMBER]: 'founder', [PEER]: 'investor' };
const MIN = 60_000;

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

function webinar(db: DatabaseSync, uid: string, startIn: number, capacity: number | null) {
  db.prepare(`INSERT INTO learning_webinars (uid, title, starts_at, ends_at, capacity, status, visibility, created_by)
              VALUES (?, 'Raising in the Nordics', ?, ?, ?, 'published', 'open', 1)`)
    .run(uid, new Date(Date.now() + startIn).toISOString(), new Date(Date.now() + startIn + 45 * MIN).toISOString(), capacity);
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
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);

// ---- the migration ---------------------------------------------------------------

test('758 applies, and a study block is the only kind without a subject', () => {
  const db = seeded();
  db.exec(`INSERT INTO learning_plan_items (uid, user_id, item_kind, starts_at) VALUES ('p1', ${MEMBER}, 'study_block', '2030-01-07T09:00:00.000Z')`);
  const row = db.prepare('SELECT duration_min, repeat, status FROM learning_plan_items').get() as any;
  assert.deepEqual([row.duration_min, row.repeat, row.status], [30, 'none', 'planned']);
  assert.throws(() => db.exec(`INSERT INTO learning_plan_items (uid, user_id, item_kind, starts_at) VALUES ('p2', ${MEMBER}, 'course', '2030-01-07T09:00:00.000Z')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO learning_plan_items (uid, user_id, item_kind, item_uid, starts_at) VALUES ('p3', ${MEMBER}, 'study_block', 'x', '2030-01-07T09:00:00.000Z')`), /CHECK/);
  assert.throws(() => db.exec(`UPDATE learning_plan_items SET duration_min = 481`), /CHECK/);
  db.exec(`INSERT INTO learning_plan_reminders (item_id, occurrence_at) VALUES (1, '2030-01-07T09:00:00.000Z')`);
  assert.throws(() => db.exec(`INSERT INTO learning_plan_reminders (item_id, occurrence_at) VALUES (1, '2030-01-07T09:00:00.000Z')`), /UNIQUE|PRIMARY/);
});

// ---- visibility --------------------------------------------------------------------

test('a subject the caller cannot see is refused 404, the same as one that does not exist', async () => {
  // Mutation checked: resolveSubject returning the row without canSeeLearning lets the draft and the program video through.
  const db = seeded();
  const when = '2030-01-07T09:00:00.000Z';
  for (const [kind, uid] of [['course', 'c-draft'], ['video', 'v-program'], ['course', 'c-missing']]) {
    const r = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: kind, item_uid: uid, starts_at: when } });
    assert.equal(r.status, 404, `${kind} ${uid}`);
    assert.equal(r.body.error, 'not_found');
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_plan_items'), 0);
  const ok = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'course', item_uid: 'c-open', starts_at: when } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.item.title, 'Fundraising 101');
  assert.equal(ok.body.item.href, '/learning/courses/fundraising-101');
  assert.equal((await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'podcast', item_uid: 'c-open', starts_at: when } })).status, 400);
});

// ---- webinars ------------------------------------------------------------------------

test('planning a webinar registers once, through the capacity check, at the webinar\'s own time', async () => {
  // Mutation checked: dropping the capacity clause in registerForWebinar registers the second member; dropping the dedupe plans the webinar twice.
  const db = seeded();
  webinar(db, 'w-one', 3 * 24 * 60 * MIN, 1);
  const startsAt = (db.prepare(`SELECT starts_at FROM learning_webinars WHERE uid = 'w-one'`).get() as any).starts_at;
  const first = await call(db, PEER, '/', { method: 'POST', body: { item_kind: 'webinar', item_uid: 'w-one', starts_at: '2030-01-01T00:00:00.000Z', repeat: 'daily' } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.item.starts_at, startsAt, 'a webinar is planned at its own time');
  assert.deepEqual([first.body.item.repeat, first.body.item.duration_min], ['none', 45]);
  const again = await call(db, PEER, '/', { method: 'POST', body: { item_kind: 'webinar', item_uid: 'w-one', starts_at: startsAt } });
  assert.equal(again.status, 200);
  assert.equal(again.body.item.uid, first.body.item.uid);
  const full = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'webinar', item_uid: 'w-one', starts_at: startsAt } });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, 'full');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_webinar_registrations'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_plan_items'), 1);
  const moved = await call(db, PEER, `/${first.body.item.uid}`, { method: 'PATCH', body: { starts_at: '2030-01-01T00:00:00.000Z' } });
  assert.equal(moved.status, 409);
  assert.equal(moved.body.error, 'webinar_time_fixed');
});

// ---- repeats -------------------------------------------------------------------------

test('daily and weekly repeats expand inside the requested range only', async () => {
  // Mutation checked: ignoring repeat_until expands the daily item to the end of the range; ignoring repeat_weekdays repeats weekly on Monday only.
  const db = seeded();
  // 2030-01-07 is a Monday.
  const daily = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'study_block', title_override: 'Reading hour', starts_at: '2030-01-07T09:00:00.000Z', repeat: 'daily', repeat_until: '2030-01-10' } });
  assert.equal(daily.status, 201, JSON.stringify(daily.body));
  const weekly = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'video', item_uid: 'v-open', starts_at: '2030-01-07T18:00:00.000Z', repeat: 'weekly', repeat_weekdays: [1, 3], repeat_until: '2030-01-20' } });
  assert.equal(weekly.status, 201, JSON.stringify(weekly.body));
  const got = await call(db, MEMBER, '/?from=2030-01-01T00:00:00.000Z&to=2030-02-01T00:00:00.000Z');
  assert.equal(got.status, 200);
  const by = Object.fromEntries(got.body.items.map((i: any) => [i.uid, i]));
  assert.deepEqual(by[daily.body.item.uid].occurrences, ['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10'].map((d) => `${d}T09:00:00.000Z`));
  assert.deepEqual(by[weekly.body.item.uid].occurrences, ['2030-01-07', '2030-01-09', '2030-01-14', '2030-01-16'].map((d) => `${d}T18:00:00.000Z`));
  // A narrower range holds only its own occurrences.
  const narrow = await call(db, MEMBER, '/?from=2030-01-08T12:00:00.000Z&to=2030-01-10T00:00:00.000Z');
  const n = Object.fromEntries(narrow.body.items.map((i: any) => [i.uid, i.occurrences]));
  assert.deepEqual(n[daily.body.item.uid], ['2030-01-09T09:00:00.000Z']);
  assert.deepEqual(n[weekly.body.item.uid], ['2030-01-09T18:00:00.000Z']);
  assert.equal((await call(db, MEMBER, '/?from=2030-01-01T00:00:00.000Z&to=2030-06-01T00:00:00.000Z')).status, 400, 'over 92 days is refused');
  // The calendar source reads the same occurrences.
  const evs = await learningEvents(envOf(db), MEMBER, '2030-01-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z');
  assert.equal(evs.length, 8);
  assert.ok(evs.every((e: any) => e.kind === 'learning'));
  assert.ok(evs.some((e: any) => e.url === '/learning/videos/v-open'));
  assert.deepEqual(occurrences({ starts_at: '2030-01-07T09:00:00.000Z', repeat: 'none', repeat_weekdays: null, repeat_until: null }, '2030-01-08T00:00:00.000Z', '2030-01-09T00:00:00.000Z'), []);
});

// ---- done ------------------------------------------------------------------------------

test('completion Learning already records marks the item done; otherwise the member marks it', async () => {
  // Mutation checked: viewOf ignoring recordedDone leaves the watched video planned.
  const db = seeded();
  const when = '2030-01-07T09:00:00.000Z';
  const video = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'video', item_uid: 'v-open', starts_at: when } });
  const block = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'study_block', starts_at: when } });
  assert.equal(video.body.item.status, 'planned');
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, completed_at) VALUES (?, 'item', 'v-open', 'completed', datetime('now'))`).run(MEMBER);
  // Another member's completion is not this member's.
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, completed_at) VALUES (?, 'course', 'c-open', 'completed', datetime('now'))`).run(PEER);
  const course = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'course', item_uid: 'c-open', starts_at: when } });
  assert.equal(course.body.item.status, 'planned');
  const got = await call(db, MEMBER, '/?from=2030-01-01T00:00:00.000Z&to=2030-02-01T00:00:00.000Z');
  const by = Object.fromEntries(got.body.items.map((i: any) => [i.uid, i]));
  assert.deepEqual([by[video.body.item.uid].status, by[video.body.item.uid].done_recorded_by], ['done', 'learning']);
  assert.equal(by[block.body.item.uid].status, 'planned');
  const marked = await call(db, MEMBER, `/${block.body.item.uid}/done`, { method: 'POST' });
  assert.deepEqual([marked.body.item.status, marked.body.item.done_recorded_by], ['done', 'member']);
  assert.equal((await call(db, MEMBER, `/${block.body.item.uid}`, { method: 'PATCH', body: { status: 'done' } })).status, 400, 'done is set with Done, not PATCH');
});

// ---- ownership -------------------------------------------------------------------------

test('another member\'s plan is never read or written', async () => {
  // Mutation checked: ownRow without `AND user_id = ?` lets the peer move and delete the member's item.
  const db = seeded();
  const mine = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'study_block', title_override: 'Mine', starts_at: '2030-01-07T09:00:00.000Z' } });
  const uid = mine.body.item.uid;
  const peerList = await call(db, PEER, '/?from=2030-01-01T00:00:00.000Z&to=2030-02-01T00:00:00.000Z');
  assert.deepEqual(peerList.body.items, []);
  assert.equal((await call(db, PEER, `/${uid}`, { method: 'PATCH', body: { title_override: 'Taken' } })).status, 404);
  assert.equal((await call(db, PEER, `/${uid}/done`, { method: 'POST' })).status, 404);
  assert.equal((await call(db, PEER, `/${uid}`, { method: 'DELETE' })).status, 404);
  const row = db.prepare('SELECT title_override, status FROM learning_plan_items WHERE uid = ?').get(uid) as any;
  assert.deepEqual([row.title_override, row.status], ['Mine', 'planned']);
  assert.equal((await learningEvents(envOf(db), PEER, '2030-01-01T00:00:00.000Z', '2030-02-01T00:00:00.000Z')).length, 0);
  // The owner can.
  assert.equal((await call(db, MEMBER, `/${uid}`, { method: 'DELETE' })).status, 200);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_plan_items'), 0);
});

test('a support session cannot change a member\'s plan', async () => {
  const db = seeded();
  const r = await call(db, MEMBER, '/', { method: 'POST', support: true, body: { item_kind: 'study_block', starts_at: '2030-01-07T09:00:00.000Z' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'support_session_refused');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_plan_items'), 0);
});

// ---- exams -------------------------------------------------------------------------------

test('planning an exam reserves time and starts no attempt', async () => {
  const db = seeded();
  const r = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'exam', item_uid: 'x-open', starts_at: '2030-01-07T09:00:00.000Z', duration_min: 60 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.item.href, '/learning/exams/x-open');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_exam_attempts'), 0);
});

// ---- reminders ---------------------------------------------------------------------------

test('the reminder sweep sends each occurrence\'s reminder once, and none for a skipped item', async () => {
  // Mutation checked: notifying without the learning_plan_reminders claim sends the reminder on every sweep.
  const db = seeded();
  const startsAt = new Date(Math.ceil((Date.now() + 2 * 60 * MIN) / MIN) * MIN).toISOString();
  const nowMs = Date.parse(startsAt) - 30 * MIN;
  const item = await call(db, MEMBER, '/', { method: 'POST', body: { item_kind: 'study_block', title_override: 'Deck review', starts_at: startsAt, remind_min_before: 30 } });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  const skipped = await call(db, PEER, '/', { method: 'POST', body: { item_kind: 'study_block', starts_at: startsAt, remind_min_before: 30 } });
  assert.equal((await call(db, PEER, `/${skipped.body.item.uid}`, { method: 'PATCH', body: { status: 'skipped' } })).status, 200);
  const env = envOf(db);
  assert.equal(await sendPlanReminders(env, nowMs - 10 * MIN), 0, 'not before its time');
  assert.equal(await sendPlanReminders(env, nowMs), 1);
  assert.equal(await sendPlanReminders(env, nowMs + MIN), 0, 'never twice');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM learning_plan_reminders'), 1);
  const sent = db.prepare(`SELECT user_id, title, link FROM notifications_inbox WHERE type = 'learning_plan_reminder'`).all() as any[];
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].user_id, sent[0].title, sent[0].link], [MEMBER, 'Coming up: Deck review', '/learning/plan']);
});
