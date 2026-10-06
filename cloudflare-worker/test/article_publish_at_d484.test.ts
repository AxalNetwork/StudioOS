/**
 * D484 (#1025) — an approved article carries the time it goes out, the
 * per-minute cron publishes it then, and H6 reads the times.
 *
 * Real SQLite: `articles` from migration 068 plus 092, 093 and 346, the rest
 * of the news tables from `ensureNewsSchema`, and the routes themselves.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_publish_at_d484.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminArticles, {
  publishApprovedArticle, publishDueArticles, PUBLISH_AT_MAX_DAYS, PUBLISH_DUE_BATCH,
} from '../src/routes/admin_articles.ts';
import content from '../src/routes/admin_content.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const AUTHOR = 5;
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

function freshDb(opts: { m346?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'admin', 'Sue', 'sue@axal.example')`).run(ADMIN, 'u-admin');
  db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'founder', 'Ann', 'ann@axal.example')`).run(AUTHOR, 'u-author');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  exec(db, migration('068_news_articles.sql'));
  exec(db, migration('092_article_editor_fields.sql'));
  exec(db, migration('093_article_views.sql'));
  if (opts.m346 !== false) exec(db, migration('346_article_publish_at.sql'));
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
                                       created_at TEXT DEFAULT (datetime('now')))`);
  return db;
}

let seq = 0;
function article(db: InstanceType<typeof DatabaseSync>, status: string, publishAt: string | null = null): number {
  seq += 1;
  const r = db.prepare(
    `INSERT INTO articles (slug, title, status, author_user_id, body_markdown${publishAt !== null ? ', publish_at, publish_at_set_by' : ''})
     VALUES (?, ?, ?, ?, '# Hello'${publishAt !== null ? ', ?, ?' : ''})`,
  ).run(...([`a-${seq}`, `Article ${seq}`, status, AUTHOR, ...(publishAt !== null ? [publishAt, ADMIN] : [])] as any[]));
  return Number(r.lastInsertRowid);
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function call(db: InstanceType<typeof DatabaseSync>, path: string, body?: unknown, as = ADMIN, app: any = adminArticles) {
  const jwt = await new SignJWT({ user_id: as, role: as === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const rowOf = (db: InstanceType<typeof DatabaseSync>, id: number) =>
  db.prepare('SELECT status, publish_at, publish_at_set_by, published_at, body_html FROM articles WHERE id = ?').get(id) as any;

// ───────────────────────────────────────────────────────────── the route ──

test('an approved article takes a publish time, stored as UTC, with who set it, and the act is audited', async () => {
  const db = freshDb();
  const id = article(db, 'approved');
  const local = new Date(Date.now() + 26 * 3_600_000);
  // The same instant written with a +02:00 offset is stored as its UTC form.
  const shifted = new Date(local.getTime() + 2 * 3_600_000).toISOString().replace('Z', '+02:00');
  const r = await call(db, `/${id}/schedule`, { publish_at: shifted });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(rowOf(db, id).publish_at, local.toISOString());
  assert.equal(rowOf(db, id).publish_at_set_by, ADMIN);
  assert.equal(rowOf(db, id).status, 'approved', 'scheduling does not publish');
  const log = db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'article.%'`).all() as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'article.schedule');
  assert.equal(log[0].user_id, ADMIN);
  assert.deepEqual(JSON.parse(log[0].details), { article_id: id, publish_at: local.toISOString(), previous: null });

  const cleared = await call(db, `/${id}/schedule`, { publish_at: null });
  assert.equal(cleared.status, 200);
  assert.equal(rowOf(db, id).publish_at, null);
  assert.equal(rowOf(db, id).publish_at_set_by, null);
  const last = db.prepare(`SELECT action, details FROM activity_logs ORDER BY id DESC LIMIT 1`).get() as any;
  assert.equal(last.action, 'article.unschedule');
  assert.equal(JSON.parse(last.details).previous, local.toISOString());
});

test('a time with no zone, in the past, more than a year ahead, or missing is refused, and nothing is written', async () => {
  const db = freshDb();
  const id = article(db, 'approved');
  const cases: Array<[unknown, number, string]> = [
    [{ publish_at: inHours(3).replace('Z', '') }, 400, 'bad_publish_at'],
    [{ publish_at: 'tomorrow at nine' }, 400, 'bad_publish_at'],
    [{ publish_at: 1767225600000 }, 400, 'bad_publish_at'],
    [{ publish_at: inHours(-1) }, 400, 'publish_at_past'],
    [{ publish_at: inHours(PUBLISH_AT_MAX_DAYS * 24 + 1) }, 400, 'publish_at_too_far'],
    [{}, 400, 'publish_at_required'],
  ];
  for (const [body, status, code] of cases) {
    const r = await call(db, `/${id}/schedule`, body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(r.body.error, code, JSON.stringify(body));
  }
  assert.equal((await call(db, `/${id}/schedule`, { publish_at: inHours(PUBLISH_AT_MAX_DAYS * 24 - 1) })).status, 200,
    'just inside a year is allowed');
  db.prepare('UPDATE articles SET publish_at = NULL WHERE id = ?').run(id);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM activity_logs`).get().n, 1, 'only the accepted write was audited');
});

test('only an approved article takes a time, and only an admin sets one', async () => {
  const db = freshDb();
  for (const status of ['draft', 'submitted', 'in_review', 'published', 'rejected']) {
    const id = article(db, status);
    const r = await call(db, `/${id}/schedule`, { publish_at: inHours(5) });
    assert.equal(r.status, 409, status);
    assert.equal(r.body.error, 'invalid_status');
    assert.equal(rowOf(db, id).publish_at, null);
  }
  assert.equal((await call(db, '/999/schedule', { publish_at: inHours(5) })).status, 404);
  const id = article(db, 'approved');
  const r = await call(db, `/${id}/schedule`, { publish_at: inHours(5) }, AUTHOR);
  assert.notEqual(r.status, 200, 'an author scheduled their own article');
  assert.equal(rowOf(db, id).publish_at, null);
});

// ──────────────────────────────────────────────────────────────── the cron ──

test('the cron publishes approved articles whose time has passed, and nothing else', async () => {
  const db = freshDb();
  const due = article(db, 'approved', inHours(-0.5));
  const later = article(db, 'approved', inHours(2));
  const untimed = article(db, 'approved');
  const pulled = article(db, 'draft', inHours(-1)); // a time on a draft is never acted on
  const r = await publishDueArticles(env(db), new Date());
  assert.deepEqual(r, { readable: true, due: 1, published: 1 });
  assert.equal(rowOf(db, due).status, 'published');
  assert.ok(rowOf(db, due).published_at, 'the publish time is stamped');
  assert.match(rowOf(db, due).body_html, /<h1[^>]*>Hello<\/h1>/, 'rendered on the same path as a manual publish');
  for (const id of [later, untimed]) assert.equal(rowOf(db, id).status, 'approved');
  assert.equal(rowOf(db, pulled).status, 'draft');
  const rev = db.prepare(`SELECT saved_by, reason FROM article_revisions WHERE article_id = ?`).all(due) as any[];
  assert.deepEqual(rev.map((x) => [x.saved_by, x.reason]), [[ADMIN, 'publish']],
    'the revision is recorded as the admin who set the time');

  // Two ticks in a row publish once: the second finds nothing due.
  assert.deepEqual(await publishDueArticles(env(db), new Date()), { readable: true, due: 0, published: 0 });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?`).get(due) as any).n, 1);
});

test('the cron publishes the oldest times first, a batch per tick', async () => {
  const db = freshDb();
  const ids = Array.from({ length: PUBLISH_DUE_BATCH + 2 }, (_, i) => article(db, 'approved', inHours(-(i + 1))));
  const first = await publishDueArticles(env(db), new Date());
  assert.deepEqual(first, { readable: true, due: PUBLISH_DUE_BATCH, published: PUBLISH_DUE_BATCH });
  // The two most recent times (the first two inserted) are left for the next tick.
  assert.equal(rowOf(db, ids[0]).status, 'approved');
  assert.equal(rowOf(db, ids[1]).status, 'approved');
  assert.equal(rowOf(db, ids[ids.length - 1]).status, 'published');
  assert.deepEqual(await publishDueArticles(env(db), new Date()), { readable: true, due: 2, published: 2 });
});

test('a manual publish and the cron racing publish once', async () => {
  const db = freshDb();
  const id = article(db, 'approved', inHours(-1));
  const manual = await call(db, `/${id}/publish`, {});
  assert.equal(manual.status, 200);
  assert.deepEqual(await publishDueArticles(env(db), new Date()), { readable: true, due: 0, published: 0 });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?`).get(id) as any).n, 1);
});

test('a publisher holding a stale row loses the race: no second publish, revision or notification', async () => {
  const db = freshDb();
  const id = article(db, 'approved', inHours(-1));
  const stale = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as any; // read while still approved
  assert.equal(await publishApprovedArticle(env(db), stale, ADMIN), true);
  const firstPublishedAt = rowOf(db, id).published_at;
  assert.equal(await publishApprovedArticle(env(db), stale, ADMIN), false, 'the second caller published again');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM article_revisions WHERE article_id = ?`).get(id) as any).n, 1);
  assert.equal(rowOf(db, id).published_at, firstPublishedAt);
});

test('unpublishing clears the time, so the next tick does not publish it again', async () => {
  const db = freshDb();
  const id = article(db, 'approved', inHours(-1));
  await publishDueArticles(env(db), new Date());
  assert.equal(rowOf(db, id).status, 'published');
  const r = await call(db, `/${id}/unpublish`, {});
  assert.equal(r.status, 200);
  assert.equal(rowOf(db, id).status, 'approved');
  assert.equal(rowOf(db, id).publish_at, null);
  assert.equal(rowOf(db, id).publish_at_set_by, null);
  assert.deepEqual(await publishDueArticles(env(db), new Date()), { readable: true, due: 0, published: 0 });
  assert.equal(rowOf(db, id).status, 'approved');
});

test('a database without migration 346 publishes nothing on the cron, and still unpublishes', async () => {
  const db = freshDb({ m346: false });
  const id = article(db, 'published');
  assert.deepEqual(await publishDueArticles(env(db), new Date()), { readable: false, due: 0, published: 0 });
  assert.equal((await call(db, `/${id}/unpublish`, {})).status, 200);
  assert.equal((db.prepare('SELECT status FROM articles WHERE id = ?').get(id) as any).status, 'approved');
});

// ──────────────────────────────────────────────────────────────── H6 ──

test('H6 reads the times: how many approved articles have one, how many wait, and the soonest', async () => {
  const db = freshDb();
  exec(db, migration('259_hq_escalations.sql'));
  const soon = article(db, 'approved', inHours(3));
  const later = article(db, 'approved', inHours(30));
  article(db, 'approved');
  article(db, 'published', inHours(-5));
  const { status, body } = await call(db, '/summary', undefined, ADMIN, content);
  assert.equal(status, 200, JSON.stringify(body));
  const pt = body.board.publish_time;
  assert.equal(pt.recorded, true);
  assert.equal(pt.scheduled, 2);
  assert.equal(pt.unscheduled, 1);
  assert.deepEqual(pt.next.map((n: any) => n.id), [soon, later], 'soonest first, published articles excluded');
  assert.equal(pt.next[0].publish_at, rowOf(db, soon).publish_at);
  assert.match(pt.note, /goes out when it passes/);
  const lane = body.board.lanes.find((l: any) => l.key === 'scheduled');
  assert.match(lane.note, /goes out at that time/);
});

test('H6 without migration 346 says the times could not be read, never "none scheduled"', async () => {
  const db = freshDb({ m346: false });
  exec(db, migration('259_hq_escalations.sql'));
  article(db, 'approved');
  const { body } = await call(db, '/summary', undefined, ADMIN, content);
  assert.equal(body.board.publish_time.recorded, false);
  assert.match(body.board.publish_time.reason, /migration 346/);
  assert.equal(body.board.publish_time.scheduled, undefined);
});
