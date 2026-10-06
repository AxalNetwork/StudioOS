/**
 * D557 (#1158) — the Learning center's core: migration 388, the member routes
 * (`routes/learning.ts`) and the Super Admin's authoring (`routes/admin_learning.ts`).
 *
 * Run on a database built from the schema baseline and every migration
 * through 388, as production builds it. What is pinned:
 *
 *   - gates: a member cannot write; a plain admin cannot author; the Super
 *     Admin can, and every write is recorded with its actor;
 *   - content: a video link only from the allow-list; a draft or program item
 *     invisible to members; progress is the caller's own only;
 *   - the catalog: one source failing is `unreadable` while the others answer;
 *   - hygiene: the search term is bound and escaped, and 388 applies cleanly.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_core_d557.test.ts
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
import { allowedVideoUrl, canSeeLearning } from '../src/services/learningAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const SQL_388 = readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith('388_')) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 10, OTHER = 11;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [PLAIN_ADMIN]: 'admin', [MEMBER]: 'founder', [OTHER]: 'investor' };

function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort(compareMigrations)
    .filter((f) => migrationNumber(f) > BASELINE_CUTOFF && migrationNumber(f) < 388);
  for (const f of files) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec(SQL_388);
  // The Learning migrations after 388 (D559's 390, …), whole, as the deploy applies them.
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > 388 && /^\d+_learning_/.test(x))) {
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
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active) VALUES
      (${SUPER}, 'super@example.test', 'Super Holder', 'admin', 1),
      (${PLAIN_ADMIN}, 'plain@example.test', 'Plain Admin', 'admin', 1),
      (${MEMBER}, 'member@example.test', 'Mia Member', 'founder', 1),
      (${OTHER}, 'other@example.test', 'Otto Other', 'investor', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO articles (slug, title, subtitle, excerpt, body_markdown, status, author_user_id, published_at, read_minutes) VALUES
      ('raise-seed', 'How to raise a seed', 'A guide', 'Seed rounds, plainly.', 'x', 'published', ${MEMBER}, '2026-10-01 10:00:00', 6),
      ('draft-article', 'Not yet', NULL, NULL, 'x', 'draft', ${MEMBER}, NULL, 3),
      ('no-time', 'Untimed', NULL, NULL, 'x', 'published', ${OTHER}, '2026-09-01 10:00:00', 0);
    INSERT INTO admin_publications (slug, title, audience, section, status, created_by, published_at) VALUES
      ('q3-pulse', 'Q3 market pulse', 'founder', 'market_pulse', 'published', ${SUPER}, '2026-09-30 09:00:00'),
      ('internal-memo', 'Internal memo', 'internal', 'market_pulse', 'published', ${SUPER}, '2026-09-30 09:00:00');
    INSERT INTO events (slug, title, summary, starts_at, visibility, status, admin_published) VALUES
      ('demo-day', 'Demo day', 'Pitches', '2099-01-01 18:00:00', 'public', 'published', 1),
      ('past-meetup', 'Past meetup', NULL, '2001-01-01 18:00:00', 'public', 'published', 1);
  `);
  return db;
}

async function tokenFor(who: number) {
  return new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await tokenFor(who)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const admin = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminLearning, db, who, path, init);
const member = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(learning, db, who, path, init);

/** A published course with one reading lesson; returns the uids. */
async function publishedCourse(db: DatabaseSync, slug = 'fundraising-101') {
  const reading = (await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'reading', title: 'Term sheets', body: '# Read me', topic: 'fundraising', level: 'intro' } })).body.item;
  await admin(db, SUPER, `/items/${reading.uid}/publish`, { method: 'POST' });
  const course = (await admin(db, SUPER, '/courses', { method: 'POST', body: { slug, title: 'Fundraising 101', level: 'intro',
    resources: [{ title: 'Template', url: 'https://example.com/t.pdf' }] } })).body.course;
  const withModule = (await admin(db, SUPER, `/courses/${course.uid}/modules`, { method: 'POST', body: { title: 'Basics' } })).body.course;
  const mod = withModule.modules[0];
  const withLesson = (await admin(db, SUPER, `/modules/${mod.uid}/lessons`, { method: 'POST', body: { kind: 'reading', title: 'Read the terms', ref_uid: reading.uid } })).body.course;
  await admin(db, SUPER, `/courses/${course.uid}/publish`, { method: 'POST' });
  return { reading, course, mod, lesson: withLesson.modules[0].lessons[0] };
}

// ---- the migration ---------------------------------------------------------------

test('388 applies to a database built from the migrations, with the canvas\'s transcript and resources', () => {
  const cols = (t: string) => (BUILT.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => r.name);
  for (const t of ['learning_items', 'learning_courses', 'learning_course_modules', 'learning_lessons', 'learning_progress']) {
    assert.ok(cols(t).length > 0, `${t} is missing`);
  }
  assert.ok(cols('learning_items').includes('transcript'));
  assert.ok(cols('learning_courses').includes('resources_json'));
  const db = seeded();
  assert.throws(() => db.prepare(`INSERT INTO learning_items (uid, kind, title, created_by) VALUES ('x', 'podcast', 't', 1)`).run(), /CHECK/);
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status) VALUES (1, 'item', 'u', 'started')`).run();
  assert.throws(() => db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status) VALUES (1, 'item', 'u', 'started')`).run(), /UNIQUE/);
});

// ---- gates --------------------------------------------------------------------------

test('a member cannot write and a plain admin cannot author; the Super Admin can, and the actor is recorded', async () => {
  const db = seeded();
  const body = { kind: 'video', title: 'Pitching', video_url: 'https://youtu.be/abc123' };
  assert.equal((await admin(db, MEMBER, '/items', { method: 'POST', body })).status, 403);
  assert.equal((await admin(db, PLAIN_ADMIN, '/items', { method: 'POST', body })).status, 403);
  assert.equal((await admin(db, PLAIN_ADMIN, '/items')).status, 403, 'a plain admin cannot list drafts either');
  const made = await admin(db, SUPER, '/items', { method: 'POST', body });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.item.status, 'draft');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_items').get() as any).n, 1);
  const audit = db.prepare(`SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action LIKE 'learning.%'`).all() as any[];
  assert.deepEqual(audit.map((a) => [a.admin_user_id, a.action]), [[SUPER, 'learning.item.create']]);
  assert.match(audit[0].filters_json, new RegExp(made.body.item.uid));
});

// ---- content checks -------------------------------------------------------------------

test('a video link is accepted only over https from the allow-list', async () => {
  for (const ok of ['https://youtu.be/x', 'https://www.youtube.com/watch?v=x', 'https://player.vimeo.com/video/1',
    'https://customer-abc.cloudflarestream.com/v/manifest', 'https://videodelivery.net/abc']) {
    assert.ok(allowedVideoUrl(ok), `${ok} was refused`);
  }
  for (const no of ['http://youtu.be/x', 'https://evil.example/youtu.be', 'https://cloudflarestream.com.evil.example/x',
    'https://notyoutube.com/x', 'https://user:pw@youtu.be/x', 'https://youtu.be:8443/x', 'javascript:alert(1)', 'https://.cloudflarestream.com/x']) {
    assert.equal(allowedVideoUrl(no), null, `${no} was accepted`);
  }
  const db = seeded();
  const r = await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'Bad', video_url: 'https://evil.example/v.mp4' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_video_url');
  const up = await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'Upload', video_source: 'r2' } });
  assert.equal(up.body.error, 'video_upload_not_built');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_items').get() as any).n, 0, 'nothing refused was stored');
});

test('a draft, an archived and a program item are invisible to members; published and open is visible', async () => {
  const db = seeded();
  const item = (await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'Hidden', video_url: 'https://youtu.be/a', transcript: 'Line one' } })).body.item;
  assert.equal((await member(db, MEMBER, `/items/${item.uid}`)).status, 404, 'a member read a draft');
  assert.equal((await member(db, SUPER, `/items/${item.uid}`)).status, 200, 'the Super Admin cannot preview a draft');
  const draftCatalog = await member(db, MEMBER, '/catalog?kind=video');
  assert.equal(draftCatalog.body.items.length, 0);
  assert.equal(draftCatalog.body.sources.video.total, 0, 'the count includes what the member cannot see');
  assert.equal((await member(db, SUPER, '/catalog?kind=video')).body.items[0].status, 'draft');
  await admin(db, SUPER, `/items/${item.uid}/publish`, { method: 'POST' });
  const seen = await member(db, MEMBER, `/items/${item.uid}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.item.transcript, 'Line one');
  assert.equal(seen.body.transcript_recorded, true);
  assert.equal((await member(db, MEMBER, '/catalog?kind=video')).body.items.length, 1);
  await admin(db, SUPER, `/items/${item.uid}`, { method: 'PATCH', body: { visibility: 'program' } });
  assert.equal((await member(db, MEMBER, `/items/${item.uid}`)).status, 404, 'program content leaked before #1159');
  const prog = await member(db, MEMBER, '/catalog?kind=video');
  assert.deepEqual([prog.body.items.length, prog.body.sources.video.total], [0, 0], 'a program item was listed or counted');
  await admin(db, SUPER, `/items/${item.uid}`, { method: 'PATCH', body: { visibility: 'open' } });
  await admin(db, SUPER, `/items/${item.uid}/archive`, { method: 'POST' });
  assert.equal((await member(db, MEMBER, `/items/${item.uid}`)).status, 404, 'an archived item stayed readable');
  assert.equal((await member(db, SUPER, '/catalog?kind=video')).body.sources.video.total, 0, 'an archived item stayed in the catalog');
  assert.equal(canSeeLearning({ role: 'founder' }, { status: 'published', visibility: 'open' }), true);
  assert.equal(canSeeLearning({ role: 'admin', is_super_admin: 0 }, { status: 'draft', visibility: 'open' }), false);
});

test('publishing needs the content: a video needs its link, a reading its text, a course a lesson', async () => {
  const db = seeded();
  const v = (await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'No link' } })).body.item;
  assert.equal((await admin(db, SUPER, `/items/${v.uid}/publish`, { method: 'POST' })).body.error, 'no_video');
  const rd = (await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'reading', title: 'No text' } })).body.item;
  assert.equal((await admin(db, SUPER, `/items/${rd.uid}/publish`, { method: 'POST' })).body.error, 'no_body');
  const course = (await admin(db, SUPER, '/courses', { method: 'POST', body: { slug: 'empty', title: 'Empty' } })).body.course;
  assert.equal((await member(db, MEMBER, '/courses/empty')).status, 404, 'a member read a draft course');
  assert.equal((await member(db, SUPER, '/courses/empty')).status, 200);
  assert.equal((await admin(db, SUPER, `/courses/${course.uid}/publish`, { method: 'POST' })).body.error, 'no_lessons');
  assert.equal((await admin(db, SUPER, '/courses', { method: 'POST', body: { slug: 'empty', title: 'Dup' } })).status, 409);
  assert.equal((await admin(db, SUPER, '/courses', { method: 'POST', body: { slug: 'Bad Slug', title: 'x' } })).body.error, 'bad_slug');
  assert.equal((await admin(db, SUPER, '/courses', { method: 'POST', body: { slug: 'r', title: 'x', resources: [{ title: 't', url: 'http://x.example' }] } })).body.error, 'bad_resources');
});

test('a lesson points at an item of its own kind', async () => {
  const db = seeded();
  const video = (await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'V', video_url: 'https://youtu.be/v' } })).body.item;
  const course = (await admin(db, SUPER, '/courses', { method: 'POST', body: { slug: 'c', title: 'C' } })).body.course;
  const mod = (await admin(db, SUPER, `/courses/${course.uid}/modules`, { method: 'POST', body: { title: 'M' } })).body.course.modules[0];
  assert.equal((await admin(db, SUPER, `/modules/${mod.uid}/lessons`, { method: 'POST', body: { kind: 'reading', title: 'x', ref_uid: video.uid } })).body.error, 'bad_ref');
  // Since D559 (#1160) an exam lesson names an exam; one that does not exist is refused.
  assert.equal((await admin(db, SUPER, `/modules/${mod.uid}/lessons`, { method: 'POST', body: { kind: 'exam', title: 'x', ref_uid: 'e' } })).body.error, 'bad_ref');
  assert.equal((await admin(db, SUPER, `/modules/${mod.uid}/lessons`, { method: 'POST', body: { kind: 'webinar', title: 'Live', ref_uid: 'demo-day' } })).status, 201);
  const two = (await admin(db, SUPER, `/modules/${mod.uid}/lessons`, { method: 'POST', body: { kind: 'video', title: 'Watch', ref_uid: video.uid } })).body.course;
  const [a, b] = two.modules[0].lessons;
  assert.deepEqual([a.position, b.position], [0, 1]);
  const flipped = (await admin(db, SUPER, `/modules/${mod.uid}/lessons/order`, { method: 'POST', body: { order: [b.uid, a.uid] } })).body.course;
  assert.deepEqual(flipped.modules[0].lessons.map((l: any) => l.uid), [b.uid, a.uid]);
  assert.equal((await admin(db, SUPER, `/modules/${mod.uid}/lessons/order`, { method: 'POST', body: { order: [a.uid] } })).body.error, 'bad_order');
  assert.equal((await admin(db, SUPER, `/modules/${mod.uid}/lessons/order`, { method: 'POST', body: { order: [a.uid, 'not-a-lesson'] } })).body.error, 'bad_order');
  assert.equal((await admin(db, SUPER, `/modules/${mod.uid}`, { method: 'DELETE' })).body.error, 'module_not_empty');
});

// ---- progress -----------------------------------------------------------------------------

test('progress is the caller\'s own: the session decides whose row, and another member never sees it', async () => {
  const db = seeded();
  const { course, lesson, reading } = await publishedCourse(db);
  const w = await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'lesson', subject_uid: lesson.uid, status: 'completed', user_id: OTHER } });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const rows = db.prepare('SELECT user_id FROM learning_progress').all() as any[];
  assert.deepEqual(rows.map((x) => x.user_id), [MEMBER], 'the body named whose progress it was');
  assert.equal((await member(db, OTHER, '/me')).body.completed.length, 0);
  assert.equal((await member(db, MEMBER, '/me')).body.completed[0].title, 'Read the terms');
  const page = await member(db, MEMBER, `/courses/${course.slug}`);
  assert.deepEqual(page.body.progress, { required: 1, completed: 1, percent: 100 });
  assert.equal(page.body.modules[0].lessons[0].progress.status, 'completed');
  assert.deepEqual(page.body.course.resources, [{ title: 'Template', url: 'https://example.com/t.pdf' }]);
  assert.equal((await member(db, OTHER, `/courses/${course.slug}`)).body.progress.completed, 0);
  // Completed stays completed, and the percent never goes backwards.
  await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: reading.uid, status: 'started', percent: 60 } });
  await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: reading.uid, status: 'completed', percent: 100 } });
  const back = await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: reading.uid, status: 'started', percent: 10 } });
  assert.equal(back.body.progress.status, 'completed');
  assert.equal(back.body.progress.percent, 100);
});

test('progress on something the caller cannot see is refused, and bad input says why', async () => {
  const db = seeded();
  const draft = (await admin(db, SUPER, '/items', { method: 'POST', body: { kind: 'reading', title: 'Draft', body: 'x' } })).body.item;
  assert.equal((await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: draft.uid, status: 'started' } })).status, 404);
  assert.equal((await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: 'nope', status: 'started' } })).status, 404);
  assert.equal((await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'video', subject_uid: draft.uid, status: 'started' } })).body.error, 'bad_subject');
  assert.equal((await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: draft.uid, status: 'done' } })).body.error, 'bad_status');
  assert.equal((await member(db, MEMBER, '/progress', { method: 'POST', body: { subject_kind: 'item', subject_uid: draft.uid, status: 'started', percent: 140 } })).body.error, 'bad_percent');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_progress').get() as any).n, 0);
});

// ---- the catalog ------------------------------------------------------------------------------

test('the catalog federates courses, items, articles, publications and events, with the article row\'s author and reading time', async () => {
  const db = seeded();
  await publishedCourse(db);
  const all = await member(db, MEMBER, '/catalog');
  assert.equal(all.status, 200);
  const kinds = new Set(all.body.items.map((x: any) => x.kind));
  for (const k of ['course', 'reading', 'article', 'publication', 'event']) assert.ok(kinds.has(k), `no ${k} row`);
  assert.equal(all.body.sources.article.total, 2, 'the draft article was counted');
  const art = all.body.items.find((x: any) => x.id === 'raise-seed');
  assert.deepEqual([art.author, art.read_minutes, art.href], [{ name: 'Mia Member', role: 'founder' }, 6, '/articles/raise-seed']);
  assert.equal(all.body.items.find((x: any) => x.id === 'no-time').read_minutes, null, 'an uncomputed read time read as 0 min');
  assert.ok(!all.body.items.some((x: any) => x.id === 'internal-memo'), 'an internal publication was listed');
  assert.ok(!all.body.items.some((x: any) => x.id === 'past-meetup'), 'a past event was listed');
  assert.equal(all.body.items.find((x: any) => x.kind === 'publication').file.recorded, false);
  const filtered = await member(db, MEMBER, '/catalog?topic=fundraising');
  assert.equal(filtered.body.sources.article.status, 'filtered_out');
  assert.equal(filtered.body.sources.course.status, 'filtered_out', 'courses have no topic');
  assert.equal(filtered.body.sources.reading.total, 1);
  assert.equal((await member(db, MEMBER, '/catalog?kind=podcast')).body.error, 'bad_kind');
});

test('one source failing is unreadable while the others still answer', async () => {
  const db = seeded();
  db.exec('DROP TABLE articles');
  const r = await member(db, MEMBER, '/catalog');
  assert.equal(r.status, 200);
  assert.equal(r.body.sources.article.status, 'unreadable');
  assert.match(r.body.sources.article.reason, /not a claim that there are no articles/);
  assert.equal(r.body.sources.article.total, undefined, 'an unreadable source carried a total');
  assert.equal(r.body.sources.publication.status, 'ready');
  assert.ok(r.body.items.some((x: any) => x.kind === 'publication'));
});

test('the search term is bound and escaped: a % is a character, not a wildcard', async () => {
  const db = seeded();
  db.prepare(`INSERT INTO articles (slug, title, body_markdown, status, author_user_id, published_at) VALUES ('pct', 'Grow 100% faster', 'x', 'published', ${MEMBER}, '2026-10-02')`).run();
  const hit = await member(db, MEMBER, '/catalog?kind=article&q=100%25');
  assert.deepEqual(hit.body.items.map((x: any) => x.id), ['pct']);
  const pct = await member(db, MEMBER, '/catalog?kind=article&q=%25');
  assert.deepEqual(pct.body.items.map((x: any) => x.id), ['pct'], 'a bare % matched every article');
  const injected = await member(db, MEMBER, `/catalog?kind=article&q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(injected.status, 200);
  assert.equal(injected.body.items.length, 0);
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/routes/learning.ts'), 'utf8');
  assert.doesNotMatch(src, /prepare\(`[^`]*\$\{/, 'a value was interpolated into a prepared statement');
});
