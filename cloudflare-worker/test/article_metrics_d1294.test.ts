/**
 * D1294 (#3390, part 4 of #2383) — the authors read, daily views with no
 * personal data, follower reach (migration 637), and the performance read.
 *
 * Real SQLite: `articles` from migrations 068, 092, 093, 346 and 636, the news
 * tables from `ensureNewsSchema`, migration 637, and the routes themselves.
 * 636 is what the article read selects (comment threads and featured).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_metrics_d1294.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import adminRouter from '../src/routes/admin_articles.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import articles from '../src/routes/articles.ts';
import { NOT_RECORDED_YET, countDailyView, median, rangeOf, viewDay, weekOf } from '../src/services/articleMetrics.ts';
import { SUBMISSIONS_PER_WEEK } from '../src/services/newsSchema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

// The router throws its auth errors for index.ts's handler to map; this does the same mapping.
const adminArticles = new Hono();
adminArticles.route('/', adminRouter);
adminArticles.onError((e: any, c: any) => (AUTH_ERROR_STATUSES[e?.message] ? c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message]) : c.json({ detail: 'error' }, 500)));

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const ANN = 5;
const BEN = 6;
const READER = 7;
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, display_name TEXT, headline TEXT, socials TEXT, headshot_r2_key TEXT)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  for (const [id, role, name] of [[ADMIN, 'admin', 'Sue'], [ANN, 'founder', 'Ann'], [BEN, 'investor', 'Ben'], [READER, 'founder', 'Rae']] as const) {
    db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)`).run(id, `u-${id}`, role, name, `${name.toLowerCase()}@axal.example`);
  }
  exec(db, migration('068_news_articles.sql'));
  exec(db, migration('092_article_editor_fields.sql'));
  exec(db, migration('093_article_views.sql'));
  exec(db, migration('346_article_publish_at.sql'));
  exec(db, migration('636_article_featured_and_comment_threads.sql'));
  exec(db, migration('637_article_daily_views.sql'));
  db.exec(`CREATE TABLE IF NOT EXISTS article_submission_log (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL, article_id INTEGER NOT NULL,
                                                            submitted_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS article_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL, rev INTEGER NOT NULL, title TEXT NOT NULL,
                                                       subtitle TEXT, body_markdown TEXT NOT NULL, status_at_save TEXT NOT NULL, saved_by INTEGER NOT NULL, reason TEXT,
                                                       created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS follows (id INTEGER PRIMARY KEY AUTOINCREMENT, follower_user_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
                                             created_at TEXT DEFAULT (datetime('now')), UNIQUE (follower_user_id, entity_type, entity_id))`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')))`);
  return db;
}

let seq = 0;
function article(db: InstanceType<typeof DatabaseSync>, author: number, status: string, cols: Record<string, unknown> = {}): number {
  seq += 1;
  const keys = ['slug', 'title', 'status', 'author_user_id', 'body_markdown', ...Object.keys(cols)];
  const vals = [`a-${seq}`, `Article ${seq}`, status, author, '# Hello', ...Object.values(cols)];
  const r = db.prepare(`INSERT INTO articles (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(vals as any[]));
  return Number(r.lastInsertRowid);
}
const slugOf = (db: InstanceType<typeof DatabaseSync>, id: number) => (db.prepare('SELECT slug FROM articles WHERE id = ?').get(id) as any).slug as string;

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function token(as: number, extra: Record<string, unknown> = {}) {
  const role = as === ADMIN ? 'admin' : as === BEN ? 'investor' : 'founder';
  return new SignJWT({ user_id: as, role, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: InstanceType<typeof DatabaseSync>, path: string, as: number | null = ADMIN, method = 'GET') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as != null) headers.Authorization = `Bearer ${await token(as)}`;
  const res = await adminArticles.request(path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

function installCache() {
  const store = new Map<string, Response>();
  (globalThis as any).caches = { default: { async match(req: Request) { return store.get(req.url)?.clone(); }, async put(req: Request, res: Response) { store.set(req.url, res.clone()); } } };
}

/** One public read, settling its waitUntil work (the counts). */
async function publicRead(db: InstanceType<typeof DatabaseSync>, slug: string, headers: Record<string, string> = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} };
  const res = await articles.request(`/${slug}`, { headers }, env(db), ctx as any);
  await Promise.all(pending);
  return res.status;
}
const daily = (db: InstanceType<typeof DatabaseSync>) => (db.prepare('SELECT article_id, day, views FROM article_daily_views ORDER BY article_id, day').all() as any[]).map((r) => ({ ...r }));

// ───────────────────────────────────────────────────────────── migration 637 ──

test('migration 637: a daily row is an article, a day and a count, with no column for a person, and it refuses a malformed day', () => {
  const db = freshDb();
  const cols = (db.prepare('PRAGMA table_info(article_daily_views)').all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['article_id', 'day', 'views'], 'no IP, user agent, cookie, account or referrer');
  const reach = (db.prepare('PRAGMA table_info(article_follower_reach)').all() as any[]).map((c) => c.name);
  assert.deepEqual(reach, ['id', 'article_id', 'published_at', 'followers', 'notified', 'created_at'], 'counts only, no follower id');
  const id = article(db, ANN, 'published');
  assert.throws(() => db.prepare('INSERT INTO article_daily_views (article_id, day, views) VALUES (?, ?, 1)').run(id, '26/10/2026'));
  assert.throws(() => db.prepare('INSERT INTO article_follower_reach (article_id, published_at, followers, notified) VALUES (?, ?, 1, 2)').run(id, '2026-10-26'));
});

// ───────────────────────────────────────────────────────────── the daily count ──

test('the public read counts one view on today’s UTC row; an admin, the author and an impersonated session are not counted', async () => {
  installCache();
  const db = freshDb();
  const id = article(db, ANN, 'published', { published_at: '2026-10-01T09:00:00Z' });
  const slug = slugOf(db, id);
  const bearer = async (as: number, extra = {}) => ({ Authorization: `Bearer ${await token(as, extra)}` });
  assert.equal(await publicRead(db, slug), 200);
  await publicRead(db, slug, await bearer(READER));
  await publicRead(db, slug, await bearer(ADMIN));
  await publicRead(db, slug, await bearer(ANN));
  await publicRead(db, slug, await bearer(READER, { impersonated_by: ADMIN }));
  assert.deepEqual(daily(db), [{ article_id: id, day: viewDay(), views: 2 }], 'the anonymous reader and the member only');
  assert.equal((db.prepare('SELECT views FROM articles WHERE id = ?').get(id) as any).views, 5, 'the all-time count is unchanged in meaning: every load');
  const draft = article(db, ANN, 'approved');
  await publicRead(db, slugOf(db, draft));
  assert.equal(daily(db).length, 1, 'an article that is not published is never counted');
});

test('the day boundary is midnight UTC', async () => {
  const db = freshDb();
  const id = article(db, ANN, 'published');
  const slug = slugOf(db, id);
  await countDailyView(env(db), slug, null, new Date('2026-10-26T23:59:59.999Z'));
  await countDailyView(env(db), slug, null, new Date('2026-10-27T00:00:00.000Z'));
  await countDailyView(env(db), slug, null, new Date('2026-10-27T04:59:59+05:00'));
  assert.deepEqual(daily(db), [{ article_id: id, day: '2026-10-26', views: 2 }, { article_id: id, day: '2026-10-27', views: 1 }]);
  assert.equal(viewDay(new Date('2026-10-26T23:30:00-02:00')), '2026-10-27');
});

// ───────────────────────────────────────────────────────────── the authors read ──

test('the authors read: stages, views, followers, this week’s submissions against the cap, approvals and the median time to a decision', async () => {
  const db = freshDb();
  const space = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
  const day = 86_400_000;
  const a1 = article(db, ANN, 'published', { views: 120, submitted_at: '2026-10-01T10:00:00Z', approved_at: '2026-10-02T10:00:00Z', published_at: '2026-10-03T10:00:00Z' });
  const a2 = article(db, ANN, 'rejected', { submitted_at: '2026-10-05T10:00:00Z', rejected_at: '2026-10-09T10:00:00Z' });
  const a3 = article(db, ANN, 'submitted', { submitted_at: space(day) });
  article(db, ANN, 'draft');
  const b1 = article(db, BEN, 'in_review', { submitted_at: space(2 * day) });
  for (const ago of [day, 2 * day, 3 * day]) db.prepare('INSERT INTO article_submission_log (author_id, article_id, submitted_at) VALUES (?, ?, ?)').run(ANN, a3, space(ago));
  db.prepare('INSERT INTO article_submission_log (author_id, article_id, submitted_at) VALUES (?, ?, ?)').run(ANN, a1, space(8 * day));
  db.prepare('INSERT INTO article_submission_log (author_id, article_id, submitted_at) VALUES (?, ?, ?)').run(BEN, b1, space(2 * day));
  for (const f of [BEN, READER, ANN]) db.prepare("INSERT INTO follows (follower_user_id, entity_type, entity_id) VALUES (?, 'user', ?)").run(f, ANN);
  void a2;

  const r = await call(db, '/authors');
  assert.equal(r.status, 200);
  const ann = r.body.authors.find((a: any) => a.user_id === ANN);
  const ben = r.body.authors.find((a: any) => a.user_id === BEN);
  assert.deepEqual(ann.stages, { published: 1, rejected: 1, submitted: 1 }, 'a draft is not counted');
  assert.equal(ann.waiting, 1);
  assert.equal(ann.views_all_time, 120);
  assert.equal(ann.followers, 2, 'the author following themselves is not a follower');
  assert.deepEqual(ann.this_week, { used: 3, limit: SUBMISSIONS_PER_WEEK, at_limit: true }, 'the 8-day-old submission is outside the cap’s window');
  assert.deepEqual(ben.this_week, { used: 1, limit: SUBMISSIONS_PER_WEEK, at_limit: false });
  assert.deepEqual(ann.approval, { approved: 1, decided: 2 });
  assert.equal(ann.median_hours_to_decision, 60, 'median of 24 h and 96 h');
  assert.equal(ben.median_hours_to_decision, null, 'no decision yet: null, never 0');
  assert.equal(ben.followers, 0, 'a follows read that answered: a real zero');
  assert.equal(r.body.summary.at_weekly_limit, 1);
  assert.equal(r.body.summary.with_published, 1);
  assert.equal(r.body.summary.waiting_from_first_time, 1, 'Ben has nothing published, and one article waiting');
  assert.doesNotMatch(JSON.stringify(r.body), /@axal\.example/, 'no email is returned');
  assert.equal(r.body.authors[0].user_id, ANN, 'most published first');
});

test('Authors and Performance are an admin’s, and are not taken as an article id', async () => {
  const db = freshDb();
  for (const path of ['/authors', '/performance']) {
    assert.equal((await call(db, path, ANN)).status, 403, path);
    assert.equal((await call(db, path, null)).status, 401, path);
    assert.equal((await call(db, path)).status, 200, path);
  }
});

// ───────────────────────────────────────────────────────────── performance ──

test('performance before any daily row says Not recorded, never 0; decisions per week are counted and timed', async () => {
  const db = freshDb();
  article(db, ANN, 'published', { submitted_at: '2026-10-05T10:00:00Z', approved_at: '2026-10-06T10:00:00Z', published_at: '2026-10-07T10:00:00Z', sector: 'B2B software' });
  const rej = article(db, BEN, 'rejected', { submitted_at: '2026-10-12T10:00:00Z', rejected_at: '2026-10-14T10:00:00Z' });
  db.prepare("INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason, created_at) VALUES (?, 1, 't', 'b', 'changes_requested', ?, 'request_changes', '2026-10-13 09:00:00')").run(rej, ADMIN);
  db.prepare('INSERT INTO article_submission_log (author_id, article_id, submitted_at) VALUES (?, ?, ?)').run(BEN, rej, '2026-10-12 10:00:00');
  // Rejected on the 15th, then resubmitted and approved: the rejection was a decision that week. It is not timed.
  article(db, ANN, 'approved', { submitted_at: '2026-10-16T10:00:00Z', rejected_at: '2026-10-15T10:00:00Z', approved_at: '2026-10-28T10:00:00Z' });
  // Approved, then sent back to Submitted by an edit: the old approval times nothing.
  article(db, ANN, 'submitted', { submitted_at: '2026-10-10T10:00:00Z', approved_at: '2026-10-08T10:00:00Z' });

  const r = await call(db, '/performance?from=2026-10-05&to=2026-10-18');
  assert.equal(r.status, 200);
  assert.equal(r.body.views_recorded_since, null);
  assert.equal(r.body.views_reason, NOT_RECORDED_YET);
  assert.deepEqual(r.body.weeks.map((w: any) => w.week), ['2026-10-05', '2026-10-12']);
  assert.ok(r.body.weeks.every((w: any) => w.views === null), 'no daily row: null, never 0');
  assert.equal(r.body.views_by_sector, null);
  assert.equal(r.body.top_articles, null);
  assert.deepEqual(r.body.weeks.map((w: any) => [w.published, w.approved, w.rejected, w.changes_requested, w.submitted]), [[1, 2, 0, 0, 0], [0, 0, 2, 1, 1]]);
  assert.equal(r.body.decisions.median_hours_to_decision, 36, 'median of 24 h and 48 h');
  assert.equal(r.body.decisions.timed, 2);
  assert.deepEqual(Object.keys(r.body.not_recorded).sort(), ['newsletter_clicks', 'read_through', 'sources', 'unique_readers']);
});

test('performance after daily rows: views by week from the first counted day, a partial week said, views by sector and the top articles', async () => {
  const db = freshDb();
  const a = article(db, ANN, 'published', { sector: 'B2B software', published_at: '2026-10-01T09:00:00Z' });
  const b = article(db, BEN, 'published', { sector: null, published_at: '2026-10-02T09:00:00Z' });
  const put = db.prepare('INSERT INTO article_daily_views (article_id, day, views) VALUES (?, ?, ?)');
  put.run(a, '2026-10-14', 5); put.run(a, '2026-10-19', 7); put.run(b, '2026-10-20', 2);
  const r = await call(db, '/performance?from=2026-10-05&to=2026-10-25');
  assert.equal(r.body.views_recorded_since, '2026-10-14');
  assert.match(r.body.views_reason, /counted from 2026-10-14/);
  assert.deepEqual(r.body.weeks.map((w: any) => [w.week, w.views, w.views_partial]), [['2026-10-05', null, false], ['2026-10-12', 5, true], ['2026-10-19', 9, false]]);
  assert.deepEqual(r.body.views_by_sector, [{ sector: 'B2B software', views: 12 }, { sector: 'No sector', views: 2 }]);
  assert.deepEqual(r.body.top_articles.map((t: any) => [t.id, t.views, t.author_name]), [[a, 12, 'Ann'], [b, 2, 'Ben']]);
  const quiet = await call(db, '/performance?from=2026-10-26&to=2026-11-01');
  assert.deepEqual(quiet.body.weeks.map((w: any) => w.views), [0], 'after the first counted day, a week with no read is a real 0');
});

test('performance refuses a range it cannot read, in words', async () => {
  const db = freshDb();
  for (const [q, code] of [['from=2026-10-26&to=2026-10-01', 'invalid_range'], ['from=26-10-2026', 'invalid_range'], ['from=2025-01-01&to=2026-10-26', 'range_too_long']]) {
    const r = await call(db, `/performance?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error, code, q);
    assert.ok(r.body.message);
  }
  assert.deepEqual(rangeOf(undefined, '2026-10-28'), { from: '2026-08-10', to: '2026-10-28' }, 'by default the twelve Monday weeks to today, this one included');
  assert.equal(weekOf('2026-10-25'), '2026-10-19', 'a Sunday belongs to the week before');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});

// ───────────────────────────────────────────────────────────── follower reach ──

test('a publish stores how many followers it reached, never the author, as counts only', async () => {
  installCache();
  const db = freshDb();
  const id = article(db, ANN, 'approved', { approved_at: '2026-10-20T10:00:00Z' });
  for (const f of [BEN, READER, ANN]) db.prepare("INSERT INTO follows (follower_user_id, entity_type, entity_id) VALUES (?, 'user', ?)").run(f, ANN);
  const r = await call(db, `/${id}/publish`, ADMIN, 'POST');
  assert.equal(r.status, 200);
  const rows = db.prepare('SELECT article_id, followers, notified, published_at FROM article_follower_reach').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].article_id, id);
  assert.equal(rows[0].followers, 2, 'the author is never counted');
  assert.ok(rows[0].notified >= 0 && rows[0].notified <= 2);
  assert.match(rows[0].published_at, /^\d{4}-\d{2}-\d{2}T/);
  const read = await call(db, `/${id}`);
  assert.deepEqual(read.body.follower_reach.map((x: any) => x.followers), [2]);
  const perf = await call(db, `/performance?from=${viewDay()}&to=${viewDay()}`);
  assert.equal(perf.body.follower_reach.publishes_recorded, 1);
  assert.equal(perf.body.follower_reach.followers, 2);
});
