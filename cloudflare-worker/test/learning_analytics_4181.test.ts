/**
 * D4181 (#4181, #3726 L6) — one video's analytics from the player's positions,
 * through the real mounted route on the real schema.
 *
 *   1. Super Admin only: a plain admin, a member and nobody signed in are refused.
 *   2. Fewer than five viewers carries no figure at all ("Not enough views to show").
 *   3. Views, completion, median watch time and the drop-off over 20 spans;
 *      the biggest drop names its chapter; no member is named.
 *   4. A null duration reads "Not recorded" for the curve; a reading is refused;
 *      a viewer whose position is unknown is a view, left out of the curve.
 *
 * Every principal and figure is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/learning_analytics_4181.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import { BUCKETS, MIN_VIEWERS, NOT_ENOUGH, NOT_RECORDED, chapterAt, dropOff, reachedSeconds, videoAnalytics } from '../src/services/learningAnalytics.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4181-analytics-0123456789';
const SUPER = 1, ADMIN = 2, MEMBER = 10;
const CHAPTERS = [{ start_seconds: 0, title: 'Opening' }, { start_seconds: 300, title: 'The script' }];

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1),
      (${ADMIN}, 'u-admin', 'admin@example.test', 'Ada Admin', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO learning_items (uid, kind, title, visibility, status, created_by, published_at, duration_seconds) VALUES
      ('vid-1', 'video', 'Synthetic pricing', 'open', 'published', 1, '2026-10-01', 600),
      ('vid-few', 'video', 'Synthetic few', 'open', 'published', 1, '2026-10-01', 600),
      ('vid-nolen', 'video', 'Synthetic no length', 'open', 'published', 1, '2026-10-01', NULL),
      ('read-1', 'reading', 'Synthetic reading', 'open', 'published', 1, '2026-10-01', NULL);
  `);
  db.prepare('UPDATE learning_items SET chapters_json = ? WHERE uid = ?').run(JSON.stringify(CHAPTERS), 'vid-1');
  const add = db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, percent, position_seconds) VALUES (?, 'item', ?, ?, ?, ?)`);
  // vid-1: ten viewers. Four complete it; two stop just past 300 s (the script); two at 120 s; one only a percent (25% = 150 s); one says nothing.
  const vid1: [string, number | null, number | null][] = [
    ['completed', 100, 600], ['completed', 100, null], ['completed', null, null], ['completed', 100, 590],
    ['started', null, 310], ['started', null, 320], ['started', 20, 120], ['started', null, 120], ['started', 25, null], ['started', null, null],
  ];
  vid1.forEach(([s, p, pos], i) => add.run(100 + i, 'vid-1', s, p, pos));
  for (let i = 0; i < 4; i += 1) add.run(200 + i, 'vid-few', 'started', 50, 300);
  for (let i = 0; i < 6; i += 1) add.run(300 + i, 'vid-nolen', i < 3 ? 'completed' : 'started', null, 60 * (i + 1));
  // Another video's and a lesson's rows are never counted.
  add.run(999, 'vid-other', 'completed', 100, 600);
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, percent, position_seconds) VALUES (998, 'lesson', 'vid-1', 'completed', 100, 600)`).run();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/admin/learning', adminLearning);
  return { db, env, app };
}
type F = ReturnType<typeof fixture>;

async function get(f: F, who: number | null, uid: string) {
  const h: Record<string, string> = {};
  if (who != null) {
    h.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === MEMBER ? 'founder' : 'admin' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await f.app.request(`/api/admin/learning/items/${uid}/analytics`, { headers: h }, f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('D4181 1: the Super Admin only', async () => {
  const f = fixture();
  assert.equal((await get(f, SUPER, 'vid-1')).status, 200);
  for (const who of [ADMIN, MEMBER]) assert.equal((await get(f, who, 'vid-1')).status, 403, String(who));
  assert.equal((await get(f, null, 'vid-1')).status, 401);
});

test('D4181 2: fewer than five viewers carries no figure at all', async () => {
  const f = fixture();
  const r = await get(f, SUPER, 'vid-few');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.analytics, { enough: false, reason: NOT_ENOUGH, min_viewers: MIN_VIEWERS });
  assert.equal(MIN_VIEWERS, 5);
  assert.equal(videoAnalytics(Array.from({ length: 5 }, () => ({ status: 'started', percent: 10, position_seconds: 10 })), 100).enough, true, 'five is enough');
});

test('D4181 3: views, completion, median watch time and the drop-off; the biggest drop names its chapter; no member is named', async () => {
  const f = fixture();
  const r = await get(f, SUPER, 'vid-1');
  const a = r.body.analytics;
  assert.equal(a.enough, true);
  assert.equal(a.views, 10, 'every member who started, and no other video\'s or lesson\'s row');
  assert.equal(a.completion_pct, 40);
  // Reached, sorted: 120, 120, 150 (25%), 310, 320, then 600 x4 (completed); one unknown. Median of nine: 320.
  assert.deepEqual(a.median_watch_seconds, { available: true, value: 320 });
  const d = a.drop_off.value;
  assert.equal(a.drop_off.available, true);
  assert.equal(d.buckets.length, BUCKETS);
  assert.deepEqual([d.viewers, d.unrecorded], [9, 1]);
  assert.deepEqual(d.buckets[0], { start_seconds: 0, end_seconds: 30, still_watching_pct: 100 });
  assert.equal(d.buckets[4].still_watching_pct, 78, 'past 120 s: seven of nine (two stopped at 120)');
  assert.equal(d.buckets[5].still_watching_pct, 67, 'past 150 s: six of nine (one stopped at exactly 150)');
  assert.equal(d.buckets[10].still_watching_pct, 67, 'at 300 s: six of nine');
  assert.equal(d.buckets[11].still_watching_pct, 44, 'at 330 s: four of nine, the two who stopped in the script are gone');
  assert.equal(d.buckets[19].still_watching_pct, 44);
  assert.deepEqual(d.biggest_drop, { at_seconds: 330, points: 23, chapter: 'The script' });
  assert.deepEqual(a.chapters, CHAPTERS);
  const text = JSON.stringify(r.body);
  for (const leak of ['user_id', 'Mia', '"100"', 'email']) assert.ok(!text.includes(leak), `no member: ${leak}`);
  // The query itself reads no user id: nothing per viewer can reach the reply.
  const src = readFileSync('cloudflare-worker/src/routes/admin_learning.ts', 'utf8');
  const handler = src.slice(src.indexOf("r.get('/items/:uid/analytics'"), src.indexOf('/** Apply the defined fields'));
  assert.ok(handler.includes('FROM learning_progress'));
  assert.doesNotMatch(handler, /user_id/, 'the analytics read selects no user id');
});

test('D4181 4: no length reads Not recorded; a reading is refused; an unknown position is a view left out of the curve', async () => {
  const f = fixture();
  const n = (await get(f, SUPER, 'vid-nolen')).body.analytics;
  assert.deepEqual(n.drop_off, { available: false, reason: NOT_RECORDED });
  assert.equal(n.views, 6);
  assert.deepEqual(n.median_watch_seconds, { available: true, value: 210 }, 'positions still give a median without the length');
  const reading = await get(f, SUPER, 'read-1');
  assert.deepEqual([reading.status, reading.body.error], [422, 'not_a_video']);
  assert.equal((await get(f, SUPER, 'nope')).status, 404);
  // The pure rules.
  assert.equal(reachedSeconds({ status: 'completed', percent: null, position_seconds: null }, 600), 600);
  assert.equal(reachedSeconds({ status: 'completed', percent: null, position_seconds: null }, null), null, 'completed with no length says no second');
  assert.equal(reachedSeconds({ status: 'started', percent: 50, position_seconds: 100 }, 600), 300, 'the furthest of position and percent');
  assert.equal(reachedSeconds({ status: 'started', percent: null, position_seconds: 900 }, 600), 600, 'never past the end');
  assert.equal(reachedSeconds({ status: 'started', percent: null, position_seconds: null }, 600), null);
  const four = videoAnalytics([
    ...Array.from({ length: 4 }, () => ({ status: 'started', percent: null, position_seconds: 100 })),
    { status: 'started', percent: null, position_seconds: null },
  ], 600);
  assert.equal(four.enough, true);
  if (four.enough) assert.deepEqual(four.drop_off, { available: false, reason: NOT_ENOUGH }, 'the curve has the same floor over known positions');
  assert.equal(chapterAt(CHAPTERS, 299), 'Opening');
  assert.equal(chapterAt(CHAPTERS, 300), 'The script', 'a chapter starts at its own second');
  assert.equal(dropOff([10, 10, 10, 10, 10], 100).biggest_drop?.points, 100);
});
