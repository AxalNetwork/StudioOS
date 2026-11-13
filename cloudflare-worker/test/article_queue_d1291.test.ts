/**
 * D1291 (#3387, part 1 of #2383) — the content queue read: stages (ready and
 * scheduled split from approved), search, filters, sort, paging with a total,
 * counts per stage over the whole table with the oldest wait, and a date
 * range for the calendar with Publications' chips beside it.
 *
 * Real SQLite through the real router: `articles` from migrations 068, 092,
 * 093 and 346, the rest of the news tables from `ensureNewsSchema`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_queue_d1291.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import adminArticles from '../src/routes/admin_articles.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, ANN = 5, BO = 6, MEMBER = 7;
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

/** Ten articles across every status, two authors, comments, rounds and publications. */
function fixture(opts: { publications?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  const user = db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)');
  user.run(ADMIN, 'u-admin', 'admin', 'Sue', 'sue@axal.example');
  user.run(ANN, 'u-ann', 'founder', 'Ann Ruiz', 'ann@axal.example');
  user.run(BO, 'u-bo', 'investor', 'Bo Kim', 'bo@axal.example');
  user.run(MEMBER, 'u-member', 'founder', 'Mia', 'mia@axal.example');
  exec(db, migration('068_news_articles.sql'));
  exec(db, migration('092_article_editor_fields.sql'));
  exec(db, migration('093_article_views.sql'));
  exec(db, migration('346_article_publish_at.sql'));
  db.exec(`CREATE TABLE IF NOT EXISTS article_review_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL, author_id INTEGER NOT NULL, body TEXT NOT NULL, anchor TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS article_submission_log (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL, article_id INTEGER NOT NULL, submitted_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  if (opts.publications !== false) {
    db.exec(`CREATE TABLE admin_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, title TEXT, status TEXT, published_at TEXT)`);
    const pub = db.prepare('INSERT INTO admin_publications (slug, title, status, published_at) VALUES (?, ?, ?, ?)');
    pub.run('q3-letter', 'Q3 letter', 'published', '2026-10-18 09:00:00');
    pub.run('draft-pub', 'Draft', 'draft', '2026-10-19 09:00:00'); // a draft is never a chip, whatever its date
    pub.run('old', 'Old letter', 'published', '2026-08-01 09:00:00');
  }
  const ins = db.prepare(`INSERT INTO articles (id, slug, title, status, author_user_id, reviewer_user_id, body_markdown, sector, read_minutes, views,
                                                submitted_at, reviewed_at, approved_at, published_at, publish_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, '# x', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const A = (id: number, title: string, status: string, author: number, o: Record<string, any> = {}) =>
    ins.run(id, `a-${id}`, title, status, author, o.reviewer ?? null, o.sector ?? null, o.read ?? 3, o.views ?? 0,
      o.submitted ?? null, o.reviewed ?? null, o.approved ?? null, o.published ?? null, o.publishAt ?? null, o.updated ?? '2026-10-01T00:00:00.000Z');
  A(1, 'Alpha ports', 'submitted', ANN, { sector: 'fintech', submitted: '2026-10-01T09:00:00.000Z', read: 4 });
  A(2, 'beta 100% grid', 'submitted', BO, { sector: 'climate', submitted: '2026-10-05T09:00:00.000Z' });
  A(3, 'Gamma rounds', 'in_review', ANN, { reviewer: ADMIN, submitted: '2026-10-03T09:00:00.000Z', reviewed: '2026-10-06T09:00:00.000Z' });
  A(4, 'Delta asked', 'changes_requested', BO, { reviewer: ADMIN, submitted: '2026-10-02T09:00:00.000Z' });
  A(5, 'Epsilon ready', 'approved', ANN, { submitted: '2026-10-04T09:00:00.000Z', approved: '2026-10-07T09:00:00.000Z' });
  A(6, 'Zeta scheduled', 'approved', BO, { submitted: '2026-10-04T10:00:00.000Z', approved: '2026-10-08T09:00:00.000Z', publishAt: '2026-11-03T10:00:00.000Z' });
  A(7, 'Eta out', 'published', ANN, { submitted: '2026-09-20T09:00:00.000Z', published: '2026-10-20T09:00:00.000Z', publishAt: '2026-10-19T10:00:00.000Z', views: 120 }); // went out a day late: the day it went out counts
  A(8, 'Theta old', 'published', ANN, { submitted: '2026-09-01T09:00:00.000Z', published: '2026-09-15T09:00:00.000Z' });
  A(9, 'Iota no', 'rejected', BO, { submitted: '2026-09-10T09:00:00.000Z' });
  A(10, 'Kappa draft', 'draft', ANN);
  const comment = db.prepare('INSERT INTO article_review_comments (article_id, author_id, body, resolved_at) VALUES (?, ?, ?, ?)');
  comment.run(1, ADMIN, 'open one', null);
  comment.run(1, ADMIN, 'resolved', '2026-10-02T00:00:00.000Z');
  comment.run(2, ADMIN, 'resolved', '2026-10-06T00:00:00.000Z');
  const round = db.prepare('INSERT INTO article_submission_log (author_id, article_id) VALUES (?, ?)');
  round.run(ANN, 1);
  for (let i = 0; i < 3; i += 1) round.run(ANN, 3);
  round.run(BO, 4); round.run(BO, 4);
  return db;
}

// The router as index.ts mounts it: an auth refusal answers its status.
const app = new Hono<any>();
app.route('/', adminArticles);
app.onError((err, c) => {
  const status = AUTH_ERROR_STATUSES[err.message];
  if (!status) throw err;
  return c.json({ detail: err.message }, status);
});

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function get(db: InstanceType<typeof DatabaseSync>, qs = '', as = ADMIN) {
  const jwt = await new SignJWT({ user_id: as }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/queue${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${jwt}` } }, env(db));
  let body: any = null;
  try { body = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body };
}
const ids = (r: any) => r.body.items.map((i: any) => i.id);

test('a member is refused; an admin reads the open queue, oldest waiting first, with its total', async () => {
  const db = fixture();
  assert.equal((await get(db, '', MEMBER)).status, 403);
  const r = await get(db);
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), [1, 4, 3, 5, 6, 2], 'submitted, in review, changes requested, ready and scheduled; oldest submission first');
  assert.equal(r.body.total, 6);
  assert.deepEqual([r.body.limit, r.body.offset], [50, 0]);
});

test('each stage, with ready and scheduled split from approved; `status` keeps its old meaning', async () => {
  const db = fixture();
  const cases: [string, number[]][] = [
    ['stage=submitted', [1, 2]], ['stage=in_review', [3]], ['stage=changes_requested', [4]],
    ['stage=ready', [5]], ['stage=scheduled', [6]], ['stage=published', [8, 7]], ['stage=rejected', [9]],
    ['stage=all', [8, 9, 7, 10, 1, 4, 3, 5, 6, 2]],
    ['status=approved', [5, 6]], ['status=draft&stage=all', [10]],
  ];
  for (const [qs, want] of cases) assert.deepEqual(ids(await get(db, qs)), want, qs);
  const scheduled = (await get(db, 'stage=scheduled')).body.items[0];
  assert.equal(scheduled.stage, 'scheduled');
  assert.equal((await get(db, 'stage=ready')).body.items[0].stage, 'ready');
});

test('search on title and author name; % and _ are what was typed, never wildcards', async () => {
  const db = fixture();
  assert.deepEqual(ids(await get(db, 'q=alpha')), [1]);
  assert.deepEqual(ids(await get(db, 'q=Bo%20Kim')), [4, 6, 2], 'by author name');
  assert.deepEqual(ids(await get(db, 'q=100%25')), [2]);
  assert.deepEqual(ids(await get(db, 'q=%25')), [2], 'a lone % matches only a title with a %');
  assert.deepEqual(ids(await get(db, 'q=_')), [], 'a lone _ matches no single character');
});

test('filters: author, profile, sector, reviewer, the submitted range and open comments', async () => {
  const db = fixture();
  assert.deepEqual(ids(await get(db, `author=${BO}`)), [4, 6, 2]);
  assert.deepEqual(ids(await get(db, 'profile=founder')), [1, 3, 5]);
  assert.deepEqual(ids(await get(db, 'sector=climate')), [2]);
  assert.deepEqual(ids(await get(db, `reviewer=${ADMIN}`)), [4, 3]);
  assert.deepEqual(ids(await get(db, 'submitted_from=2026-10-03&submitted_to=2026-10-04')), [3, 5, 6], 'both days included');
  assert.deepEqual(ids(await get(db, 'open_comments=1')), [1], 'a resolved comment is not open');
  assert.deepEqual(ids(await get(db, 'open_comments=0')), [4, 3, 5, 6, 2]);
});

test('sorts: waiting, newest, goes out (unscheduled last), rounds and title', async () => {
  const db = fixture();
  assert.deepEqual(ids(await get(db, 'sort=newest')), [2, 6, 5, 3, 4, 1]);
  assert.deepEqual(ids(await get(db, 'stage=all&sort=goes_out')), [8, 7, 6, 9, 10, 1, 4, 3, 5, 2], 'by the day it goes out, then the rest as they wait');
  assert.deepEqual(ids(await get(db, 'sort=rounds')).slice(0, 3), [3, 4, 1]);
  assert.deepEqual(ids(await get(db, 'sort=title')), [1, 2, 4, 5, 3, 6], 'case-insensitive');
});

test('paging: the total is the whole match, not the page; a page past the end still says the total', async () => {
  const db = fixture();
  const p1 = await get(db, 'limit=2');
  const p2 = await get(db, 'limit=2&offset=2');
  const past = await get(db, 'limit=2&offset=40');
  assert.deepEqual([ids(p1), ids(p2), ids(past)], [[1, 4], [3, 5], []]);
  assert.deepEqual([p1.body.total, p2.body.total, past.body.total], [6, 6, 6]);
  assert.equal((await get(db, 'stage=rejected&q=zzz')).body.total, 0, 'nothing matches: a measured 0');
});

test('the row carries what the board draws', async () => {
  const db = fixture();
  const one = (await get(db, 'stage=all')).body.items.find((r: any) => r.id === 1);
  for (const k of ['publish_at', 'published_at', 'sector', 'read_minutes', 'author_role', 'views', 'open_comments', 'rounds', 'goes_out', 'reviewer_name']) assert.ok(k in one, k);
  assert.deepEqual([one.sector, one.read_minutes, one.author_role, one.open_comments, one.rounds, one.author_name], ['fintech', 4, 'founder', 1, 1, 'Ann Ruiz']);
  const three = (await get(db, 'stage=in_review')).body.items[0];
  assert.deepEqual([three.rounds, three.reviewer_name], [3, 'Sue']);
  const seven = (await get(db, 'stage=published')).body.items.find((r: any) => r.id === 7);
  assert.deepEqual([seven.views, seven.goes_out], [120, '2026-10-20T09:00:00.000Z']);
});

test('counts per stage over the whole table, whatever the filters, with the oldest wait or why none', async () => {
  const db = fixture();
  const now = Date.now();
  const r = await get(db, 'q=alpha&limit=1');
  const c = r.body.counts;
  assert.equal(c.available, true);
  assert.deepEqual(Object.fromEntries(Object.entries(c.stages).map(([k, v]: any) => [k, v.count])),
    { submitted: 2, in_review: 1, changes_requested: 1, ready: 1, scheduled: 1, published: 2, rejected: 1 });
  assert.equal(c.total, 9, 'a draft is in no stage');
  assert.equal(c.stages.submitted.oldest_since, '2026-10-01T09:00:00.000Z');
  assert.equal(c.stages.in_review.oldest_since, '2026-10-06T09:00:00.000Z');
  assert.equal(c.stages.ready.oldest_since, '2026-10-07T09:00:00.000Z');
  assert.equal(c.stages.scheduled.oldest_since, '2026-10-08T09:00:00.000Z');
  const hours = Math.floor((now - Date.parse('2026-10-01T09:00:00.000Z')) / 3_600_000);
  assert.ok(Math.abs(c.stages.submitted.oldest_hours - hours) <= 1);
  assert.deepEqual([c.stages.changes_requested.oldest_since, c.stages.changes_requested.oldest_hours, c.stages.changes_requested.oldest_reason],
    [null, null, 'No column records when changes were requested'], 'never an age of 0');
  db.exec("DELETE FROM articles WHERE status = 'rejected'");
  const empty = (await get(db)).body.counts.stages.rejected;
  assert.deepEqual([empty.count, empty.oldest_since, empty.oldest_reason], [0, null, 'Nothing in this stage']);
});

test('a date range across a month: what goes out in it, by publish_at or published_at, with Publications beside it', async () => {
  const db = fixture();
  const r = await get(db, 'from=2026-10-15&to=2026-11-10');
  assert.deepEqual(ids(r), [7, 6], 'published 20 Oct and scheduled 3 Nov; 15 Sep is outside');
  assert.equal(r.body.query.stage, 'calendar');
  assert.deepEqual(r.body.publications, { available: true, reason: null, items: [{ id: 1, slug: 'q3-letter', title: 'Q3 letter', published_at: '2026-10-18 09:00:00' }] });
  assert.deepEqual(ids(await get(db, 'from=2026-11-03&to=2026-11-03')), [6], 'one day, both ends included');
  assert.equal((await get(db)).body.publications, undefined, 'no range, no chips');
  assert.deepEqual(ids(await get(db, 'stage=calendar')), [8, 7, 6], 'the calendar view is what goes out: scheduled and published, never ready');
  assert.deepEqual(ids(await get(db, 'from=2026-10-19&to=2026-10-19')), [], 'a published article sits on the day it went out, not the day it was set for');
});

test('a failed Publications read is said in its block and leaves the rows standing', async () => {
  const db = fixture({ publications: false });
  const r = await get(db, 'from=2026-10-15&to=2026-11-10');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.publications, { available: false, reason: 'unreadable' });
  assert.deepEqual(ids(r), [7, 6]);
});

test('a bad value is refused by name, never ignored', async () => {
  const db = fixture();
  const cases: [string, string][] = [
    ['stage=approvedish', 'invalid_stage'], ['sort=random', 'invalid_sort'], ['status=x', 'invalid_status'],
    ['from=2026-10-01', 'invalid_range'], ['from=2026-10-10&to=2026-10-01', 'invalid_range'],
    ['from=2026-01-01&to=2026-06-01', 'invalid_range'], ['from=2026-02-30&to=2026-03-01', 'invalid_range'],
    ['author=abc', 'invalid_filter'], ['open_comments=yes', 'invalid_filter'], ['submitted_from=10/01/2026', 'invalid_filter'],
  ];
  for (const [qs, code] of cases) {
    const r = await get(db, qs);
    assert.deepEqual([r.status, r.body.code], [400, code], qs);
  }
  assert.equal((await get(db, 'from=2026-08-01&to=2026-10-31')).status, 200, '92 days is allowed');
});
