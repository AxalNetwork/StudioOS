/**
 * D623 (#1344) — only the author or a Super Admin edits a review comment's
 * text. A Super Admin editing someone else's text is audited, without the
 * text. An empty body is refused. Any admin can still resolve it.
 *
 * `articles` comes from the real migrations, as article_publish_at_d484.test.ts does.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/article_comment_edit_d623.test.ts
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
const ORIGINAL = 'Please name the round.';
const REVISED = 'Please name the round and the lead.';

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
  const comment = db.prepare(
    `INSERT INTO article_review_comments (article_id, author_id, body) VALUES (?, ?, ?)`,
  ).run(Number(article.lastInsertRowid), AUTHOR, ORIGINAL);
  return { db, articleId: Number(article.lastInsertRowid), commentId: Number(comment.lastInsertRowid) };
}

const env = (db: DatabaseSync) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function put(db: DatabaseSync, cid: number | string, body: unknown, as: number) {
  const jwt = await new SignJWT({ user_id: as, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await adminArticles.request(`/comments/${cid}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

const stored = (db: DatabaseSync, cid: number) =>
  db.prepare('SELECT body, resolved_at, author_id FROM article_review_comments WHERE id = ?').get(cid) as any;

const edits = (db: DatabaseSync) =>
  db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action = 'article_comment_edited' ORDER BY id`).all() as any[];

test('D623: the author edits their own comment, and that edit is not audited', async () => {
  const { db, commentId } = freshDb();
  const r = await put(db, commentId, { body: REVISED }, AUTHOR);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored(db, commentId).body, REVISED);
  assert.equal(edits(db).length, 0);
});

test('D623: another admin is refused, and the row is unchanged', async () => {
  const { db, commentId } = freshDb();
  const r = await put(db, commentId, { body: REVISED, resolved: true }, OTHER);
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.error, 'not_your_comment');
  const row = stored(db, commentId);
  assert.equal(row.body, ORIGINAL);
  assert.equal(row.resolved_at, null);
  assert.equal(edits(db).length, 0);

  const missing = await put(db, 999, { body: REVISED }, SUPER);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'comment_not_found');
});

test('D623: a Super Admin edits another admin\'s text, with one audit row and no text in it', async () => {
  const { db, articleId, commentId } = freshDb();
  const r = await put(db, commentId, { body: REVISED }, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(stored(db, commentId).body, REVISED);
  const rows = edits(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, SUPER);
  assert.deepEqual(JSON.parse(rows[0].details), { article_id: articleId, comment_id: commentId });
  assert.equal(String(rows[0].details).includes(REVISED), false);
  assert.equal(String(rows[0].details).includes(ORIGINAL), false);

  const own = db.prepare(
    `INSERT INTO article_review_comments (article_id, author_id, body) VALUES (?, ?, ?)`,
  ).run(articleId, SUPER, 'Mine.');
  const ownId = Number(own.lastInsertRowid);
  const self = await put(db, ownId, { body: 'Mine, clarified.' }, SUPER);
  assert.equal(self.status, 200, JSON.stringify(self.body));
  assert.equal(edits(db).length, 1, 'a Super Admin editing their own comment is not this audit');
});

test('D623: an empty body is refused, and any admin can still resolve and unresolve', async () => {
  const { db, commentId } = freshDb();
  const blank = await put(db, commentId, { body: '   ' }, AUTHOR);
  assert.equal(blank.status, 400, JSON.stringify(blank.body));
  assert.equal(blank.body.error, 'empty');
  assert.equal(stored(db, commentId).body, ORIGINAL);

  const resolved = await put(db, commentId, { resolved: true }, OTHER);
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.ok(stored(db, commentId).resolved_at);
  assert.equal(stored(db, commentId).body, ORIGINAL);

  const opened = await put(db, commentId, { resolved: false }, OTHER);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(stored(db, commentId).resolved_at, null);
  assert.equal(stored(db, commentId).body, ORIGINAL);
  assert.equal(edits(db).length, 0);
});
