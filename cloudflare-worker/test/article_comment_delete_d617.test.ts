/**
 * D617 (#1314) — only the author or a Super Admin deletes a review comment,
 * an unknown id is 404, and the delete is audited without the text.
 *
 * `articles` comes from the real migrations, as article_publish_at_d484.test.ts does.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/article_comment_delete_d617.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminArticles from '../src/routes/admin_articles.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const AUTHOR = 2;
const OTHER = 3;
const TEXT = 'Please name the round.';

const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: DatabaseSync, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
                                       created_at TEXT DEFAULT (datetime('now')))`);
  const u = db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, 'admin', ?, ?)`);
  u.run(SUPER, 'u-super', 'Sam Super', 'super@axal.test');
  u.run(AUTHOR, 'u-author', 'Ada Author', 'author@axal.test');
  u.run(OTHER, 'u-other', 'Otto Other', 'other@axal.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  exec(db, migration('068_news_articles.sql'));
  exec(db, migration('092_article_editor_fields.sql'));
  exec(db, migration('093_article_views.sql'));
  const article = db.prepare(
    `INSERT INTO articles (slug, title, status, author_user_id, body_markdown) VALUES ('round-note', 'Round note', 'in_review', ?, '# Hello')`,
  ).run(AUTHOR);
  return { db, articleId: Number(article.lastInsertRowid) };
}

function addComment(db: DatabaseSync, articleId: number, authorId: number, body = TEXT): number {
  const row = db.prepare(
    `INSERT INTO article_review_comments (article_id, author_id, body) VALUES (?, ?, ?)`,
  ).run(articleId, authorId, body);
  return Number(row.lastInsertRowid);
}

const env = (db: DatabaseSync) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function del(db: DatabaseSync, cid: number | string, as: number) {
  const jwt = await new SignJWT({ user_id: as, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await adminArticles.request(`/comments/${cid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

const stillThere = (db: DatabaseSync, cid: number) =>
  db.prepare('SELECT id, body FROM article_review_comments WHERE id = ?').get(cid) as any;

const audits = (db: DatabaseSync) =>
  db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action = 'article_comment_deleted' ORDER BY id`).all() as any[];

test('D617: the author deletes their comment, and the audit row has no text', async () => {
  const { db, articleId } = freshDb();
  const cid = addComment(db, articleId, AUTHOR);
  const r = await del(db, cid, AUTHOR);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(stillThere(db, cid), undefined);
  const rows = audits(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, AUTHOR);
  assert.deepEqual(JSON.parse(rows[0].details), { article_id: articleId, comment_id: cid });
  assert.equal(String(rows[0].details).includes(TEXT), false);
});

test('D617: a Super Admin deletes another admin\'s comment, and that delete is audited', async () => {
  const { db, articleId } = freshDb();
  const cid = addComment(db, articleId, AUTHOR);
  const r = await del(db, cid, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stillThere(db, cid), undefined);
  const rows = audits(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, SUPER);
  assert.deepEqual(JSON.parse(rows[0].details), { article_id: articleId, comment_id: cid });
  assert.equal(String(rows[0].details).includes(TEXT), false);
});

test('D617: another admin is refused, and an unknown id is not a successful delete', async () => {
  const { db, articleId } = freshDb();
  const cid = addComment(db, articleId, AUTHOR);
  const refused = await del(db, cid, OTHER);
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.equal(refused.body.error, 'not_your_comment');
  assert.equal(stillThere(db, cid).body, TEXT);
  assert.equal(audits(db).length, 0);

  const missing = await del(db, 999, SUPER);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'comment_not_found');
  assert.equal(missing.body.ok, undefined);
  assert.equal(audits(db).length, 0);
});
