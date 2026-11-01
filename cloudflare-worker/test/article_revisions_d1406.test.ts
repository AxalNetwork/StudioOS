/**
 * D1406 (#3892) — the article author's backend: `publish_at` on the author
 * reads, the author's revision reads, and an autosave revision.
 *
 * Real SQLite: `articles` from migrations 068, 092, 093, 346, 635 and 636,
 * the per-day views of 637, and the routes themselves. Every person below is
 * made up.
 *
 *   · `/mine` and `/draft/:id` return `publish_at`, and who set it by display
 *     name, never an email;
 *   · the revision reads: the author and an admin pass; a stranger and an
 *     investor get 404; a support session gets 403; newest first, at most 50;
 *   · autosave: a body change writes one `autosave` revision once the newest
 *     revision is more than 15 minutes old; an unchanged body writes none;
 *   · `articleMetrics` reads the same with autosave rows as without.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_revisions_d1406.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import articles, { AUTHOR_REVISIONS_MAX } from '../src/routes/articles.ts';
import { performanceRead } from '../src/services/articleMetrics.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;     // an Admin
const AUTHOR = 5;    // a founder who writes
const STRANGER = 6;  // another founder
const INVESTOR = 7;  // an investor
const GONE = 9;      // an account no longer there
const ROLE: Record<number, string> = { [ADMIN]: 'admin', [AUTHOR]: 'founder', [STRANGER]: 'founder', [INVESTOR]: 'investor' };
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  for (const [id, name] of [[ADMIN, 'Abe Made-up'], [AUTHOR, 'Ann Made-up'], [STRANGER, 'Sid Made-up'], [INVESTOR, 'Ivy Made-up']] as const) {
    db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)').run(id, `u-${id}`, ROLE[id], name, `${name.split(' ')[0].toLowerCase()}@example.test`);
  }
  for (const m of ['068_news_articles.sql', '092_article_editor_fields.sql', '093_article_views.sql', '346_article_publish_at.sql',
    '635_article_approved_by.sql', '636_article_featured_and_comment_threads.sql', '637_article_daily_views.sql']) exec(db, migration(m));
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
                                       created_at TEXT DEFAULT (datetime('now')))`);
  return db;
}

let seq = 0;
function article(db: InstanceType<typeof DatabaseSync>, status: string, extra: Record<string, unknown> = {}): number {
  seq += 1;
  const cols = ['slug', 'title', 'status', 'author_user_id', 'body_markdown', ...Object.keys(extra)];
  const vals = [`a-${seq}`, `Article ${seq}`, status, AUTHOR, `# Hello ${seq}\n\n${'Text. '.repeat(50)}`, ...Object.values(extra)];
  const r = db.prepare(`INSERT INTO articles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(vals as any[]));
  return Number(r.lastInsertRowid);
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function call(db: InstanceType<typeof DatabaseSync>, path: string, as: number, { method = 'GET', body, claims = {} }: { method?: string; body?: unknown; claims?: Record<string, unknown> } = {}) {
  const jwt = await new SignJWT({ user_id: as, role: ROLE[as], ...claims })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await (articles as any).request(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

const revisions = (db: InstanceType<typeof DatabaseSync>, id: number) =>
  (db.prepare('SELECT rev, reason FROM article_revisions WHERE article_id = ? ORDER BY rev').all(id) as any[]).map((r) => ({ rev: r.rev, reason: r.reason }));
/** Moves every stored revision of the article `minutes` into the past. */
const age = (db: InstanceType<typeof DatabaseSync>, id: number, minutes: number) =>
  db.prepare("UPDATE article_revisions SET created_at = datetime(created_at, ?) WHERE article_id = ?").run(`-${minutes} minutes`, id);

// ───────────────────────────────────────────────────────── publish_at ──

test('/mine and /draft/:id return publish_at, and who set it by name, never an email', async () => {
  const db = freshDb();
  const when = '2026-11-20T09:00:00.000Z';
  const scheduled = article(db, 'approved', { publish_at: when, publish_at_set_by: ADMIN, approved_at: '2026-10-30T10:00:00.000Z' });
  const draft = article(db, 'draft');
  const orphan = article(db, 'approved', { publish_at: when, publish_at_set_by: GONE });

  const mine = await call(db, '/mine', AUTHOR);
  assert.equal(mine.status, 200);
  const byId = Object.fromEntries(mine.body.items.map((a: any) => [a.id, a]));
  assert.deepEqual([byId[scheduled].publish_at, byId[scheduled].publish_at_set_by], [when, 'Abe Made-up'], 'an approved row with a time reads back as set');
  assert.deepEqual([byId[draft].publish_at, byId[draft].publish_at_set_by], [null, null], 'a draft has none');
  assert.deepEqual([byId[orphan].publish_at, byId[orphan].publish_at_set_by], [when, null], 'a gone account is null, not guessed');

  const one = await call(db, `/draft/${scheduled}`, AUTHOR);
  assert.deepEqual([one.body.article.publish_at, one.body.article.publish_at_set_by], [when, 'Abe Made-up']);
  assert.equal((await call(db, `/draft/${draft}`, AUTHOR)).body.article.publish_at, null);
  assert.doesNotMatch(JSON.stringify(mine.body) + JSON.stringify(one.body), /@example\.test/, 'no email in the author reads');
});

// ───────────────────────────────────────────────────── the revision reads ──

test('the revision reads: the author and an admin pass; a stranger and an investor get 404; a support session gets 403', async () => {
  const db = freshDb();
  const created = await call(db, '/draft', AUTHOR, { method: 'POST', body: { title: 'First words', body_markdown: 'One. '.repeat(60) } });
  assert.equal(created.status, 201);
  const id = created.body.article.id;
  db.prepare("INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason) VALUES (?, 2, 'Later words', 'Two.', 'changes_requested', ?, 'request_changes')").run(id, ADMIN);
  db.prepare("INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason) VALUES (?, 3, 'Orphan', 'Three.', 'draft', ?, 'autosave')").run(id, GONE);

  const list = await call(db, `/${id}/revisions`, AUTHOR);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.revisions.map((r: any) => [r.rev, r.title, r.status_at_save, r.reason, r.saved_by_name]), [
    [3, 'Orphan', 'draft', 'autosave', null],
    [2, 'Later words', 'changes_requested', 'request_changes', 'Abe Made-up'],
    [1, 'First words', 'draft', 'manual', 'Ann Made-up'],
  ], 'newest first, each saver by name; a gone account is null');
  assert.deepEqual(Object.keys(list.body.revisions[0]).sort(), ['created_at', 'reason', 'rev', 'saved_by_name', 'status_at_save', 'title'], 'the list carries no text');
  assert.doesNotMatch(JSON.stringify(list.body), /@example\.test/, 'no email');

  const one = await call(db, `/${id}/revisions/1`, AUTHOR);
  assert.equal(one.status, 200);
  assert.equal(one.body.revision.body_markdown, 'One. '.repeat(60));
  assert.equal(one.body.revision.saved_by_name, 'Ann Made-up');
  assert.equal((await call(db, `/${id}/revisions/99`, AUTHOR)).body.error, 'revision_not_found');

  assert.equal((await call(db, `/${id}/revisions`, ADMIN)).status, 200, 'an admin passes');
  assert.equal((await call(db, `/${id}/revisions/2`, ADMIN)).status, 200);
  for (const who of [STRANGER, INVESTOR]) {
    assert.deepEqual([(await call(db, `/${id}/revisions`, who)).status, (await call(db, `/${id}/revisions/1`, who)).status], [404, 404], `user ${who}`);
  }
  assert.equal((await call(db, '/999/revisions', AUTHOR)).status, 404, 'no such article');
  const support = await call(db, `/${id}/revisions`, AUTHOR, { claims: { impersonated_by: ADMIN } });
  assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  const supportOne = await call(db, `/${id}/revisions/1`, AUTHOR, { claims: { impersonated_by: ADMIN } });
  assert.deepEqual([supportOne.status, supportOne.body.error], [403, 'support_session_refused']);
});

test('the list returns at most 50, newest first', async () => {
  const db = freshDb();
  const id = article(db, 'draft');
  const ins = db.prepare("INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason) VALUES (?, ?, 't', 'b', 'draft', ?, 'autosave')");
  for (let rev = 1; rev <= 60; rev++) ins.run(id, rev, AUTHOR);
  const list = await call(db, `/${id}/revisions`, AUTHOR);
  assert.equal(AUTHOR_REVISIONS_MAX, 50);
  assert.equal(list.body.revisions.length, 50);
  assert.deepEqual([list.body.revisions[0].rev, list.body.revisions.at(-1).rev], [60, 11]);
});

// ──────────────────────────────────────────────────────────── autosave ──

test('autosave: a body change writes one revision per 15 minutes; an unchanged body writes none', async () => {
  const db = freshDb();
  const id = (await call(db, '/draft', AUTHOR, { method: 'POST', body: { title: 'Notes', body_markdown: 'Start.' } })).body.article.id;
  assert.deepEqual(revisions(db, id), [{ rev: 1, reason: 'manual' }]);

  // Within 15 minutes of the newest revision: none.
  assert.equal((await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { body_markdown: 'Start. More.' } })).status, 200);
  assert.equal(revisions(db, id).length, 1, 'the creation revision is recent');

  age(db, id, 20);
  await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { body_markdown: 'Start. More. Again.' } });
  assert.deepEqual(revisions(db, id).at(-1), { rev: 2, reason: 'autosave' }, 'the newest was 20 minutes old');
  age(db, id, 5);
  await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { body_markdown: 'Five minutes later.' } });
  assert.equal(revisions(db, id).length, 2, 'two PUTs 5 minutes apart write one autosave');
  age(db, id, 11);
  await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { body_markdown: 'Sixteen minutes later.' } });
  assert.deepEqual(revisions(db, id).at(-1), { rev: 3, reason: 'autosave' }, 'a PUT 16 minutes after it writes a second');
  const stored = db.prepare('SELECT body_markdown, saved_by FROM article_revisions WHERE article_id = ? AND rev = 3').get(id) as any;
  assert.deepEqual([stored.body_markdown, stored.saved_by], ['Sixteen minutes later.', AUTHOR], 'the revision is the text as saved');

  age(db, id, 60);
  await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { title: 'Notes, renamed', body_markdown: 'Sixteen minutes later.' } });
  await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { subtitle: 'A subtitle' } });
  assert.equal(revisions(db, id).length, 3, 'an unchanged body writes none');
});

test('an approved text returned to Submitted writes its one revision, not an autosave beside it', async () => {
  const db = freshDb();
  const id = article(db, 'approved', { approved_at: '2026-10-30T10:00:00.000Z' });
  const r = await call(db, `/${id}`, AUTHOR, { method: 'PUT', body: { body_markdown: 'A new text. '.repeat(30) } });
  assert.equal(r.status, 200);
  assert.deepEqual(revisions(db, id).map((x) => x.reason), ['manual']);
  // A submitted text's edit stays submitted and is autosaved like a draft's.
  const sub = article(db, 'submitted');
  await call(db, `/${sub}`, AUTHOR, { method: 'PUT', body: { body_markdown: 'Changed while waiting.' } });
  assert.deepEqual(revisions(db, sub).map((x) => x.reason), ['autosave']);
});

test('articleMetrics reads the same with autosave rows as without', async () => {
  const db = freshDb();
  const id = article(db, 'changes_requested');
  db.prepare("INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason, created_at) VALUES (?, 1, 't', 'b', 'changes_requested', ?, 'request_changes', '2026-10-13 09:00:00')").run(id, ADMIN);
  const now = new Date('2026-10-31T12:00:00.000Z');
  const before = await performanceRead(env(db), '2026-10-01', '2026-10-31', now);
  const ins = db.prepare("INSERT INTO article_revisions (article_id, rev, title, body_markdown, status_at_save, saved_by, reason, created_at) VALUES (?, ?, 't', 'b', 'draft', ?, 'autosave', ?)");
  for (let rev = 2; rev <= 6; rev++) ins.run(id, rev, AUTHOR, `2026-10-${10 + rev} 09:00:00`);
  const after = await performanceRead(env(db), '2026-10-01', '2026-10-31', now);
  assert.deepEqual(after, before);
  const sent = (r: any) => r.weeks.reduce((n: number, w: any) => n + w.changes_requested, 0);
  assert.equal(sent(before), 1, 'the one request_changes row is counted');
  assert.equal(sent(after), 1, 'and no autosave row is');
});
