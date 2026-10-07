/**
 * D617 (#1314) — only the author or a Super Admin deletes an article review
 * comment, and the delete is audit-logged without the comment body.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/article_review_comments_delete_d617.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminArticles from '../src/routes/admin_articles.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER_ADMIN = 1;
const COMMENT_AUTHOR_ADMIN = 2;
const OTHER_ADMIN = 3;

function setupDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      uid TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER,
      name TEXT,
      email TEXT
    );
    CREATE TABLE super_admins (
      user_id INTEGER PRIMARY KEY,
      granted_by_user_id INTEGER,
      granted_at TEXT,
      note TEXT
    );
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      author_user_id INTEGER,
      published_at TEXT,
      body_markdown TEXT
    );
    CREATE TABLE article_review_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      anchor TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT,
      project_id INTEGER,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      actor TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      viewed_user_id INTEGER,
      filters_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'admin', ?, ?)`).run(
    SUPER_ADMIN,
    'u-super',
    'Super Admin',
    'super@example.com',
  );
  db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'admin', ?, ?)`).run(
    COMMENT_AUTHOR_ADMIN,
    'u-author',
    'Author Admin',
    'author@example.com',
  );
  db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'admin', ?, ?)`).run(
    OTHER_ADMIN,
    'u-other',
    'Other Admin',
    'other@example.com',
  );

  db.prepare(`INSERT INTO super_admins (user_id) VALUES (?)`).run(SUPER_ADMIN);

  db.prepare(
    `INSERT INTO articles (id, slug, title, status, body_markdown) VALUES (10, 'test-article', 'Test Article', 'in_review', '# Content')`,
  ).run();

  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({
    JWT_SECRET,
    ENVIRONMENT: 'development',
    APP_URL: 'https://axal.vc',
    DB: d1Over(db),
  }) as any;

async function del(db: InstanceType<typeof DatabaseSync>, path: string, asUserId: number) {
  const jwt = await new SignJWT({ user_id: asUserId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

  const res = await adminArticles.request(
    path,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` },
    },
    env(db),
  );

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json };
}

function insertComment(db: InstanceType<typeof DatabaseSync>, id: number, authorId: number, body: string): void {
  db.prepare(
    `INSERT INTO article_review_comments (id, article_id, author_id, body) VALUES (?, 10, ?, ?)`,
  ).run(id, authorId, body);
}

test('the comment author deletes their own comment and delete is audit logged without text', async () => {
  const db = setupDb();
  const commentText = 'Needs more clarity on financial projections';
  insertComment(db, 101, COMMENT_AUTHOR_ADMIN, commentText);

  const res = await del(db, '/comments/101', COMMENT_AUTHOR_ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  const remaining = db.prepare('SELECT id FROM article_review_comments WHERE id = ?').get(101);
  assert.equal(remaining, undefined);

  const log = db.prepare(`SELECT * FROM activity_logs WHERE action = 'article_comment_deleted'`).get() as any;
  assert.ok(log, 'audit row must be recorded in activity_logs');
  assert.equal(log.user_id, COMMENT_AUTHOR_ADMIN);

  const details = JSON.parse(log.details);
  assert.equal(details.article_id, 10);
  assert.equal(details.comment_id, 101);
  assert.equal(details.body, undefined, 'comment body must NOT be logged in audit details');
  assert.ok(!log.details.includes(commentText), 'comment text must NOT appear in audit details payload');
});

test('a Super Admin can delete a comment authored by another user and it is audit logged', async () => {
  const db = setupDb();
  const commentText = 'Off-topic review comment';
  insertComment(db, 102, COMMENT_AUTHOR_ADMIN, commentText);

  const res = await del(db, '/comments/102', SUPER_ADMIN);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  const remaining = db.prepare('SELECT id FROM article_review_comments WHERE id = ?').get(102);
  assert.equal(remaining, undefined);

  const log = db.prepare(`SELECT * FROM activity_logs WHERE action = 'article_comment_deleted'`).get() as any;
  assert.ok(log, 'audit row must be recorded in activity_logs');
  assert.equal(log.user_id, SUPER_ADMIN);

  const details = JSON.parse(log.details);
  assert.equal(details.article_id, 10);
  assert.equal(details.comment_id, 102);
  assert.ok(!log.details.includes(commentText), 'comment text must NOT appear in audit details payload');
});

test('another admin is refused with 403 not_your_comment and comment remains intact', async () => {
  const db = setupDb();
  insertComment(db, 103, COMMENT_AUTHOR_ADMIN, 'Legitimate feedback from author');

  const res = await del(db, '/comments/103', OTHER_ADMIN);
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'not_your_comment' });

  const remaining = db.prepare('SELECT id FROM article_review_comments WHERE id = ?').get(103) as any;
  assert.ok(remaining, 'comment must NOT be deleted');

  const logs = db.prepare(`SELECT COUNT(*) as count FROM activity_logs WHERE action = 'article_comment_deleted'`).get() as any;
  assert.equal(logs.count, 0, 'no delete audit log should be recorded on refused attempt');
});

test('an unknown comment id gets 404 comment_not_found', async () => {
  const db = setupDb();

  const res = await del(db, '/comments/99999', SUPER_ADMIN);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'comment_not_found' });

  const logs = db.prepare(`SELECT COUNT(*) as count FROM activity_logs WHERE action = 'article_comment_deleted'`).get() as any;
  assert.equal(logs.count, 0);
});
