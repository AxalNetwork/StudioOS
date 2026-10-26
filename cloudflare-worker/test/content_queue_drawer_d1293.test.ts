/**
 * D1293 (#3389, Content queue part 3) — the review drawer's data: featured,
 * unpublish with a reason, comment replies and who resolved, edited marks,
 * revision text and the rendered body.
 *
 * `articles` comes from the real migrations, 636 included, as
 * article_comment_edit_d623.test.ts does.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/content_queue_drawer_d1293.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import adminArticles, { FEATURED_MAX } from '../src/routes/admin_articles.ts';
import articles from '../src/routes/articles.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const ADMIN = 2;
const AUTHOR = 3;
const OTHER = 4;
const REASON = 'The figures in the second section are out of date.';
const REPLY = 'Updated the figures; see the second section.';
const BODY_MD = '# Heading\n\nSome **bold** text.';

const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: DatabaseSync, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT, display_name TEXT, headline TEXT, socials TEXT,
                               headshot_r2_key TEXT)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
                                       created_at TEXT DEFAULT (datetime('now')))`);
  const u = db.prepare(`INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)`);
  u.run(SUPER, 'u-super', 'admin', 'Sam Super', 'super@axal.test');
  u.run(ADMIN, 'u-admin', 'admin', 'Alex Admin', 'admin@axal.test');
  u.run(AUTHOR, 'u-author', 'founder', 'Ada Author', 'author@axal.test');
  u.run(OTHER, 'u-other', 'founder', 'Otto Other', 'other@axal.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  exec(db, migration('068_news_articles.sql'));
  exec(db, migration('092_article_editor_fields.sql'));
  exec(db, migration('093_article_views.sql'));
  exec(db, migration('346_article_publish_at.sql'));
  exec(db, migration('636_article_featured_and_comment_threads.sql'));
  return db;
}

function addArticle(db: DatabaseSync, slug: string, status = 'published', opts: { tags?: string[]; publishedAt?: string } = {}) {
  return Number(db.prepare(
    `INSERT INTO articles (slug, title, status, author_user_id, body_markdown, tags, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(slug, `Title ${slug}`, status, AUTHOR, BODY_MD, opts.tags ? JSON.stringify(opts.tags) : null,
    opts.publishedAt ?? (status === 'published' ? '2026-10-01T00:00:00Z' : null)).lastInsertRowid);
}

// `beforeUnpublish` runs just before the unpublish UPDATE, as a second admin's
// unpublish landing between the route's read and its write would.
let beforeUnpublish: (() => void) | null = null;
function raced(db: DatabaseSync) {
  const d1 = d1Over(db);
  return {
    ...d1,
    prepare(sql: string) {
      const st = d1.prepare(sql);
      if (!sql.includes("SET status='approved', featured_at = NULL")) return st;
      return { ...st, bind: (...a: any[]) => { const b = st.bind(...a); return { ...b, run: async () => { beforeUnpublish?.(); return b.run(); } }; } };
    },
  };
}
const env = (db: DatabaseSync) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: raced(db) }) as any;

async function call(app: any, db: DatabaseSync, method: string, path: string, as: number, body?: unknown) {
  const role = as === AUTHOR || as === OTHER ? 'founder' : 'admin';
  const jwt = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}
// The refusals index.ts's onError maps; a bare sub-app would answer 500.
const ERRORS = { Unauthorized: 401, 'Admin required': 403 } as Record<string, 401 | 403>;
function appFor(router: any) {
  const a = new Hono<any>();
  a.onError((err: any, c) => c.json({ detail: err?.message }, ERRORS[err?.message] ?? 500));
  a.route('/', router);
  return a;
}
const adminApp = appFor(adminArticles);
const memberApp = appFor(articles);
const admin = (db: DatabaseSync, method: string, path: string, as: number, body?: unknown) => call(adminApp, db, method, path, as, body);
const member = (db: DatabaseSync, method: string, path: string, as: number, body?: unknown) => call(memberApp, db, method, path, as, body);

const featuredRow = (db: DatabaseSync, id: number) =>
  db.prepare('SELECT featured_at, featured_by, status FROM articles WHERE id = ?').get(id) as any;
const audits = (db: DatabaseSync, action: string) =>
  db.prepare('SELECT details, user_id FROM activity_logs WHERE action = ? ORDER BY id').all(action) as any[];
const inbox = (db: DatabaseSync, userId: number) => {
  try { return db.prepare('SELECT type, title, body, link FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[]; }
  catch { return []; }
};

test('the migration adds the five columns and backfills nothing', () => {
  const db = freshDb();
  const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name));
  for (const c of ['featured_at', 'featured_by']) assert.ok(cols('articles').has(c), c);
  for (const c of ['parent_id', 'resolved_by', 'edited_at']) assert.ok(cols('article_review_comments').has(c), c);
  const id = addArticle(db, 'tagged', 'published', { tags: ['featured'] });
  assert.equal(featuredRow(db, id).featured_at, null, 'an author\'s "featured" tag is not a Super Admin\'s pick');
});

test('feature: Super Admin only; a published article; a fourth is refused; unfeature frees a place', async () => {
  const db = freshDb();
  const ids = ['a', 'b', 'c', 'd'].map((s) => addArticle(db, s));
  const draft = addArticle(db, 'draft-one', 'approved');

  const byAdmin = await admin(db, 'POST', `/${ids[0]}/feature`, ADMIN, { featured: true });
  assert.equal(byAdmin.status, 403);
  assert.equal(byAdmin.body.error, 'super_admin_only');
  assert.equal(featuredRow(db, ids[0]).featured_at, null);

  const notPublished = await admin(db, 'POST', `/${draft}/feature`, SUPER, { featured: true });
  assert.equal(notPublished.status, 409);
  assert.equal(notPublished.body.error, 'invalid_status');
  assert.equal(featuredRow(db, draft).featured_at, null);

  const bad = await admin(db, 'POST', `/${ids[0]}/feature`, SUPER, { featured: 'yes' });
  assert.equal(bad.status, 400);

  assert.equal(FEATURED_MAX, 3);
  for (const id of ids.slice(0, 3)) {
    const r = await admin(db, 'POST', `/${id}/feature`, SUPER, { featured: true });
    assert.equal(r.status, 200, String(id));
    assert.equal(r.body.changed, true);
    assert.equal(featuredRow(db, id).featured_by, SUPER);
  }
  const fourth = await admin(db, 'POST', `/${ids[3]}/feature`, SUPER, { featured: true });
  assert.equal(fourth.status, 409);
  assert.equal(fourth.body.error, 'featured_full');
  assert.equal(featuredRow(db, ids[3]).featured_at, null, 'the fourth is not featured');

  const again = await admin(db, 'POST', `/${ids[0]}/feature`, SUPER, { featured: true });
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false, 'featuring a featured article changes nothing');

  const notOn = await admin(db, 'POST', `/${ids[3]}/feature`, SUPER, { featured: false });
  assert.equal(notOn.body.changed, false, 'unfeaturing an article not featured changes nothing');
  const off = await admin(db, 'POST', `/${ids[0]}/feature`, SUPER, { featured: false });
  assert.equal(off.body.changed, true);
  assert.equal(featuredRow(db, ids[0]).featured_at, null);
  assert.equal(featuredRow(db, ids[0]).featured_by, null);
  const now = await admin(db, 'POST', `/${ids[3]}/feature`, SUPER, { featured: true });
  assert.equal(now.status, 200, 'the freed place takes the fourth');

  assert.deepEqual(audits(db, 'article.feature').map((a) => JSON.parse(a.details).article_id), [ids[0], ids[1], ids[2], ids[3]]);
  assert.deepEqual(audits(db, 'article.unfeature').map((a) => JSON.parse(a.details).article_id), [ids[0]]);
});

test('the public featured strip reads featured_at; an author\'s featured tag is ignored', async () => {
  const db = freshDb();
  const tagged = addArticle(db, 'tagged', 'published', { tags: ['featured'], publishedAt: '2026-10-05T00:00:00Z' });
  const picked = addArticle(db, 'picked', 'published', { publishedAt: '2026-09-01T00:00:00Z' });
  addArticle(db, 'newest', 'published', { publishedAt: '2026-10-09T00:00:00Z' });
  db.prepare('UPDATE articles SET featured_at = ?, featured_by = ? WHERE id = ?').run('2026-10-10T00:00:00Z', SUPER, picked);
  const res = await articles.request('/?featured=1&limit=3', {}, env(db));
  assert.equal(res.status, 200);
  const items = (await res.json() as any).items;
  assert.deepEqual(items.map((a: any) => a.slug), ['picked', 'newest', 'tagged'], 'the pick first, then most recent; the tag earns nothing');
  assert.deepEqual(items.map((a: any) => a.featured), [true, false, false]);
  assert.ok(tagged > 0);
});

test('unpublish: a reason is required; the author gets its own notice with it; featured is cleared; audited without the text', async () => {
  const db = freshDb();
  const id = addArticle(db, 'live');
  db.prepare('UPDATE articles SET featured_at = ?, featured_by = ? WHERE id = ?').run('2026-10-10T00:00:00Z', SUPER, id);

  for (const body of [{}, { reason: 'short' }, { reason: '       ' }]) {
    const r = await admin(db, 'POST', `/${id}/unpublish`, ADMIN, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'reason_too_short');
    assert.equal(featuredRow(db, id).status, 'published', 'nothing was unpublished');
  }

  const ok = await admin(db, 'POST', `/${id}/unpublish`, ADMIN, { reason: REASON });
  assert.equal(ok.status, 200);
  const row = featuredRow(db, id);
  assert.equal(row.status, 'approved');
  assert.equal(row.featured_at, null, 'unpublishing takes it off the strip');
  assert.equal(row.featured_by, null);

  const notices = inbox(db, AUTHOR);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, 'articles_author_unpublished', 'its own kind, not "Changes requested"');
  assert.equal(notices[0].title, 'Your article was unpublished');
  assert.ok(notices[0].body.includes(REASON), 'the author reads the reason');

  const audit = audits(db, 'article.unpublish');
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].details), { article_id: id, was_featured: true });
  assert.ok(!audit[0].details.includes('figures'), 'the reason stays out of the audit row');

  const twice = await admin(db, 'POST', `/${id}/unpublish`, ADMIN, { reason: REASON });
  assert.equal(twice.status, 409);

  // Two admins unpublishing at once: the one whose write changes nothing
  // sends no second notice and writes no second audit row.
  const other = addArticle(db, 'live-two');
  beforeUnpublish = () => { db.prepare("UPDATE articles SET status = 'approved' WHERE id = ?").run(other); };
  try {
    const lost = await admin(db, 'POST', `/${other}/unpublish`, SUPER, { reason: REASON });
    assert.equal(lost.status, 409);
    assert.equal(lost.body.status, 'approved');
  } finally { beforeUnpublish = null; }
  assert.equal(inbox(db, AUTHOR).length, 1, 'no second notice');
  assert.equal(audits(db, 'article.unpublish').length, 1, 'no second audit row');
});

test('author replies: only the article\'s author, to a thread on that article; the admin is told without the text', async () => {
  const db = freshDb();
  const id = addArticle(db, 'in-review', 'in_review');
  const elsewhere = addArticle(db, 'elsewhere', 'in_review');
  const posted = await admin(db, 'POST', `/${id}/comments`, ADMIN, { body: 'Please name the source.', anchor: 'p2' });
  assert.equal(posted.status, 201);
  const cid = posted.body.id;
  const foreign = (await admin(db, 'POST', `/${elsewhere}/comments`, ADMIN, { body: 'Elsewhere.' })).body.id;

  const byOther = await member(db, 'POST', `/${id}/comments/${cid}/replies`, OTHER, { body: REPLY });
  assert.equal(byOther.status, 403);
  assert.equal(byOther.body.error, 'not_your_article');
  const byAdmin = await member(db, 'POST', `/${id}/comments/${cid}/replies`, ADMIN, { body: REPLY });
  assert.equal(byAdmin.status, 403, 'an admin answers through the admin route');
  const wrongArticle = await member(db, 'POST', `/${id}/comments/${foreign}/replies`, AUTHOR, { body: REPLY });
  assert.equal(wrongArticle.status, 404);
  const empty = await member(db, 'POST', `/${id}/comments/${cid}/replies`, AUTHOR, { body: '  ' });
  assert.equal(empty.status, 400);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM article_review_comments WHERE parent_id IS NOT NULL').get() as any).n, 0);

  const ok = await member(db, 'POST', `/${id}/comments/${cid}/replies`, AUTHOR, { body: REPLY });
  assert.equal(ok.status, 201);
  const reply = db.prepare('SELECT author_id, parent_id, body, anchor FROM article_review_comments WHERE id = ?').get(ok.body.id) as any;
  assert.deepEqual({ ...reply }, { author_id: AUTHOR, parent_id: cid, body: REPLY, anchor: null });

  const toReply = await member(db, 'POST', `/${id}/comments/${ok.body.id}/replies`, AUTHOR, { body: REPLY });
  assert.equal(toReply.status, 404, 'one level only: a reply is not a thread');

  const told = inbox(db, ADMIN);
  assert.equal(told.length, 1);
  assert.equal(told[0].type, 'articles_admin_comment_reply');
  assert.equal(told[0].link, `/admin/articles/${id}`);
  assert.ok(!JSON.stringify(told[0]).includes('figures'), 'the reply text stays out of the notice');

  const draft = await member(db, 'GET', `/draft/${id}`, AUTHOR);
  assert.deepEqual(draft.body.comments.map((c: any) => [c.id, c.parent_id]), [[cid, null], [ok.body.id, cid]]);

  // An admin answers the same thread with parent_id; a parent on another article is refused.
  const adminReply = await admin(db, 'POST', `/${id}/comments`, ADMIN, { body: 'Thanks.', parent_id: cid, anchor: 'p9' });
  assert.equal(adminReply.status, 201);
  assert.deepEqual({ ...(db.prepare('SELECT parent_id, anchor FROM article_review_comments WHERE id = ?').get(adminReply.body.id) as any) }, { parent_id: cid, anchor: null });
  const toAdminReply = await member(db, 'POST', `/${id}/comments/${adminReply.body.id}/replies`, AUTHOR, { body: REPLY });
  assert.equal(toAdminReply.status, 404, 'an admin\'s reply is not a thread either');
  const crossed = await admin(db, 'POST', `/${id}/comments`, ADMIN, { body: 'Thanks.', parent_id: foreign });
  assert.equal(crossed.status, 404);

  // Deleting the thread takes its replies with it.
  const del = await admin(db, 'DELETE', `/comments/${cid}`, ADMIN);
  assert.equal(del.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM article_review_comments WHERE article_id = ?').get(id) as any).n, 0);
});

test('resolve records who; reopening clears it; an edit stamps edited_at; a reply is not resolved on its own', async () => {
  const db = freshDb();
  const id = addArticle(db, 'in-review', 'in_review');
  const cid = (await admin(db, 'POST', `/${id}/comments`, ADMIN, { body: 'Name the lead.' })).body.id;
  const rid = (await member(db, 'POST', `/${id}/comments/${cid}/replies`, AUTHOR, { body: REPLY })).body.id;
  const row = () => db.prepare('SELECT resolved_at, resolved_by, edited_at FROM article_review_comments WHERE id = ?').get(cid) as any;

  assert.equal((await admin(db, 'PUT', `/comments/${cid}`, SUPER, { resolved: true })).status, 200);
  assert.ok(row().resolved_at);
  assert.equal(row().resolved_by, SUPER);
  assert.equal(row().edited_at, null, 'resolving is not an edit');

  const read = await admin(db, 'GET', `/${id}`, ADMIN);
  const head = read.body.comments.find((c: any) => c.id === cid);
  assert.equal(head.resolved_by_name, 'Sam Super');

  assert.equal((await admin(db, 'PUT', `/comments/${cid}`, ADMIN, { resolved: false })).status, 200);
  assert.equal(row().resolved_at, null);
  assert.equal(row().resolved_by, null);

  assert.equal((await admin(db, 'PUT', `/comments/${cid}`, ADMIN, { body: 'Name the lead investor.' })).status, 200);
  assert.ok(row().edited_at, 'the text change is marked');

  const onReply = await admin(db, 'PUT', `/comments/${rid}`, ADMIN, { resolved: true });
  assert.equal(onReply.status, 400);
  assert.equal(onReply.body.error, 'reply_not_resolvable');
});

test('revisions: the list names the saver; the text is returned to an admin only; the drawer gets the rendered body', async () => {
  const db = freshDb();
  const id = addArticle(db, 'in-review', 'in_review');
  db.prepare(`INSERT INTO article_revisions (article_id, rev, title, subtitle, body_markdown, status_at_save, saved_by, reason)
              VALUES (?, 1, 'First', NULL, 'Old body.', 'submitted', ?, 'submit')`).run(id, AUTHOR);
  db.prepare(`INSERT INTO article_revisions (article_id, rev, title, subtitle, body_markdown, status_at_save, saved_by, reason)
              VALUES (?, 2, 'Second', NULL, 'Body by a gone account.', 'in_review', 999, 'manual')`).run(id);

  const read = await admin(db, 'GET', `/${id}`, ADMIN);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.revisions.map((r: any) => [r.rev, r.saved_by_name]), [[2, null], [1, 'Ada Author']]);
  assert.ok(!('body_markdown' in read.body.revisions[0]), 'the list stays light; the text is its own read');
  assert.match(read.body.article.rendered_html, /<h1[^>]*>Heading<\/h1>/);
  assert.match(read.body.article.rendered_html, /<strong>bold<\/strong>/);
  assert.equal(read.body.article.body_markdown, BODY_MD, 'beside the markdown');

  const one = await admin(db, 'GET', `/${id}/revisions/1`, ADMIN);
  assert.equal(one.status, 200);
  assert.equal(one.body.revision.body_markdown, 'Old body.');
  assert.equal(one.body.revision.saved_by_name, 'Ada Author');

  const missing = await admin(db, 'GET', `/${id}/revisions/7`, ADMIN);
  assert.equal(missing.status, 404);
  const bad = await admin(db, 'GET', `/${id}/revisions/zero`, ADMIN);
  assert.equal(bad.status, 400);

  for (const who of [AUTHOR, OTHER]) {
    const refused = await admin(db, 'GET', `/${id}/revisions/1`, who);
    assert.equal(refused.status, 403, `member ${who}`);
    assert.ok(!JSON.stringify(refused.body || {}).includes('Old body'), 'and no text');
  }
});
