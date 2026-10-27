/**
 * D1292 (#3388) — Content queue part 2: who decided, recorded; no admin
 * approves or publishes their own article without a Super Admin's recorded
 * reason; and an approved text cannot change under a schedule.
 *
 * Real SQLite: `articles` from migrations 068, 092, 093, 346 and 635, the
 * rest of the news tables from `ensureNewsSchema`, and the routes themselves.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_approvals_d1292.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminArticles, { publishDueArticles, selfApprovalCheck, OVERRIDE_REASON_MIN } from '../src/routes/admin_articles.ts';
import articles from '../src/routes/articles.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;   // a Super Admin
const ADMIN = 2;   // an Admin
const AUTHOR = 5;  // a founder who writes
const ROLE: Record<number, string> = { [SUPER]: 'admin', [ADMIN]: 'admin', [AUTHOR]: 'founder' };
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const exec = (db: InstanceType<typeof DatabaseSync>, sql: string) => { for (const st of splitStatements(sql)) db.exec(st); };
const M635 = readFileSync(new URL('../sql/migrations/635_article_approved_by.sql', import.meta.url), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, uid TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT)`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT)`);
  for (const [id, name] of [[SUPER, 'Sue'], [ADMIN, 'Abe'], [AUTHOR, 'Ann']] as const) {
    db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)').run(id, `u-${id}`, ROLE[id], name, `${name.toLowerCase()}@axal.example`);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  exec(db, migration('068_news_articles.sql'));
  exec(db, migration('092_article_editor_fields.sql'));
  exec(db, migration('093_article_views.sql'));
  exec(db, migration('346_article_publish_at.sql'));
  exec(db, M635);
  // D1293's unpublish clears featured_at and featured_by, so the table has them.
  exec(db, migration('636_article_featured_and_comment_threads.sql'));
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
                                       created_at TEXT DEFAULT (datetime('now')))`);
  return db;
}

let seq = 0;
function article(db: InstanceType<typeof DatabaseSync>, status: string, author = AUTHOR, extra: Record<string, unknown> = {}): number {
  seq += 1;
  const cols = ['slug', 'title', 'status', 'author_user_id', 'body_markdown', ...Object.keys(extra)];
  const vals = [`a-${seq}`, `Article ${seq}`, status, author, `# Hello ${seq}\n\n${'Text. '.repeat(50)}`, ...Object.values(extra)];
  const r = db.prepare(`INSERT INTO articles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(vals as any[]));
  return Number(r.lastInsertRowid);
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: d1Over(db) }) as any;

async function call(db: InstanceType<typeof DatabaseSync>, path: string, body: unknown, as: number, { app = adminArticles as any, method = 'POST' } = {}) {
  const jwt = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }, env(db));
  let json: any = null;
  try { json = await res.json(); } catch { /* status says it */ }
  return { status: res.status, body: json };
}

const rowOf = (db: InstanceType<typeof DatabaseSync>, id: number) =>
  db.prepare('SELECT status, approved_at, approved_by, publish_at, publish_at_set_by, published_at FROM articles WHERE id = ?').get(id) as any;
const audits = (db: InstanceType<typeof DatabaseSync>) =>
  (db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'article.%' ORDER BY id`).all() as any[])
    .map((r) => ({ action: r.action, by: r.user_id, ...JSON.parse(r.details) }));
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

// ───────────────────────────────────────────────────────── the audit rows ──

test('every transition writes one audit row with the ids and both statuses, never the text or the reason', async () => {
  const db = freshDb();
  const a = article(db, 'submitted');
  assert.equal((await call(db, `/${a}/start-review`, {}, ADMIN)).status, 200);
  assert.equal((await call(db, `/${a}/approve`, {}, ADMIN)).status, 200);
  assert.equal((await call(db, `/${a}/publish`, {}, ADMIN)).status, 200);
  assert.equal((await call(db, `/${a}/unpublish`, { reason: 'Returned for a later date.' }, ADMIN)).status, 200);
  const b = article(db, 'in_review');
  assert.equal((await call(db, `/${b}/request-changes`, { reason: 'The second section repeats the first.' }, ADMIN)).status, 200);
  const c = article(db, 'submitted');
  assert.equal((await call(db, `/${c}/reject`, { reason: 'Off topic for this studio.' }, SUPER)).status, 200);

  assert.deepEqual(audits(db).map((r) => [r.action, r.article_id, r.from, r.to, r.by, r.target_user_id]), [
    ['article.start_review', a, 'submitted', 'in_review', ADMIN, AUTHOR],
    ['article.approve', a, 'in_review', 'approved', ADMIN, AUTHOR],
    ['article.publish', a, 'approved', 'published', ADMIN, AUTHOR],
    ['article.unpublish', a, 'published', 'approved', ADMIN, AUTHOR],
    ['article.request_changes', b, 'in_review', 'changes_requested', ADMIN, AUTHOR],
    ['article.reject', c, 'submitted', 'rejected', SUPER, AUTHOR],
  ]);
  assert.equal(audits(db)[2].via, 'manual');
  const raw = JSON.stringify(db.prepare('SELECT details FROM activity_logs').all());
  assert.ok(!/Hello|repeats the first|Off topic/.test(raw), 'no article text or reason in an audit row');
  const governance = db.prepare(`SELECT action, admin_user_id, viewed_user_id FROM admin_audit_log WHERE action LIKE 'article.%'`).all() as any[];
  assert.equal(governance.length, 6, 'HQ governance reads each transition');
  assert.ok(governance.every((g) => g.viewed_user_id === AUTHOR));
});

test('approve records who approved; an article approved before migration 635 says nobody', async () => {
  const db = freshDb();
  const a = article(db, 'in_review');
  await call(db, `/${a}/approve`, {}, ADMIN);
  assert.equal(rowOf(db, a).approved_by, ADMIN);
  assert.ok(rowOf(db, a).approved_at);
  const old = article(db, 'approved', AUTHOR, { approved_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(rowOf(db, old).approved_by, null, 'no backfill: Not recorded, never a guess');
  assert.match(M635, /Grep first \(D689 D-t\)/);
  assert.doesNotMatch(M635, /\bUPDATE\b/, 'the migration backfills nothing');
});

test('a refused or raced transition writes no audit row', async () => {
  const db = freshDb();
  const a = article(db, 'draft');
  assert.equal((await call(db, `/${a}/approve`, {}, ADMIN)).status, 409);
  assert.equal((await call(db, `/${a}/publish`, {}, ADMIN)).status, 409);
  assert.equal((await call(db, `/${a}/unpublish`, { reason: 'Returned for a later date.' }, ADMIN)).status, 409);
  assert.deepEqual(audits(db), []);
});

test('the scheduled publish is audited as the admin who set the time', async () => {
  const db = freshDb();
  const a = article(db, 'approved', AUTHOR, { publish_at: inHours(-1), publish_at_set_by: ADMIN });
  const r = await publishDueArticles(env(db));
  assert.equal(r.published, 1);
  const [row] = audits(db);
  assert.deepEqual([row.action, row.by, row.via, row.article_id], ['article.publish', ADMIN, 'schedule', a]);
});

// ─────────────────────────────────────────────────── the self-approval rule ──

test('an Admin cannot approve, publish or schedule their own article, and is told to ask another admin', async () => {
  const db = freshDb();
  const mine = article(db, 'in_review', ADMIN);
  const r = await call(db, `/${mine}/approve`, { override_reason: 'I am sure about this one.' }, ADMIN);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'self_approval');
  assert.match(r.body.detail, /Ask another admin\. Nothing was changed\./);
  assert.equal(rowOf(db, mine).status, 'in_review');
  const approved = article(db, 'approved', ADMIN);
  assert.equal((await call(db, `/${approved}/publish`, {}, ADMIN)).body.error, 'self_approval');
  assert.equal((await call(db, `/${approved}/schedule`, { publish_at: inHours(5) }, ADMIN)).body.error, 'self_approval');
  assert.equal((await call(db, `/${approved}/schedule`, { publish_at: null }, ADMIN)).status, 200, 'clearing a time publishes nothing');
  assert.equal(rowOf(db, approved).status, 'approved');
  assert.ok(!audits(db).some((a) => a.action === 'article.publish' || a.action === 'article.approve'));
  // Another admin decides it.
  assert.equal((await call(db, `/${mine}/approve`, {}, SUPER)).status, 200);
  assert.equal(rowOf(db, mine).approved_by, SUPER);
});

test('a Super Admin may decide their own article only with a reason, and the reason is audited', async () => {
  const db = freshDb();
  const mine = article(db, 'submitted', SUPER);
  const none = await call(db, `/${mine}/approve`, {}, SUPER);
  assert.equal(none.status, 403);
  assert.equal(none.body.error, 'self_approval_reason_required');
  const short = await call(db, `/${mine}/approve`, { override_reason: 'x'.repeat(OVERRIDE_REASON_MIN - 1) }, SUPER);
  assert.equal(short.body.error, 'self_approval_reason_required');
  assert.equal(rowOf(db, mine).status, 'submitted');

  const reason = 'Board notice; the other admin is away.';
  assert.equal((await call(db, `/${mine}/approve`, { override_reason: reason }, SUPER)).status, 200);
  assert.equal((await call(db, `/${mine}/publish`, { override_reason: reason }, SUPER)).status, 200);
  const rows = audits(db);
  assert.deepEqual(rows.map((r) => [r.action, r.self_approval_override, r.override_reason]), [
    ['article.approve', true, reason], ['article.publish', true, reason],
  ]);
  assert.equal(rowOf(db, mine).status, 'published');
});

test('selfApprovalCheck: someone else’s article needs no reason', () => {
  assert.deepEqual(selfApprovalCheck({ id: ADMIN, role: 'admin' }, { author_user_id: AUTHOR }, {}), { override: null });
  assert.deepEqual(selfApprovalCheck({ id: ADMIN, role: 'admin' }, { author_user_id: null }, {}), { override: null });
  assert.equal((selfApprovalCheck({ id: ADMIN, role: 'admin' }, { author_user_id: String(ADMIN) }, {}) as any).refused.body.error, 'self_approval');
  assert.deepEqual(selfApprovalCheck({ id: SUPER, role: 'admin', is_super_admin: 1 }, { author_user_id: SUPER }, { override_reason: '  long enough  ' }), { override: 'long enough' });
});

// ─────────────────────────────────────────────────────────── the edit lock ──

test('an edit to an approved, scheduled article returns it to Submitted with no time and no approval, and the author is told', async () => {
  const db = freshDb();
  const a = article(db, 'approved', AUTHOR, { approved_at: '2026-10-20T10:00:00.000Z', approved_by: ADMIN, publish_at: inHours(30), publish_at_set_by: ADMIN });
  const r = await call(db, `/${a}`, { title: 'A better title' }, AUTHOR, { app: articles, method: 'PUT' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.returned_to_queue, { from: 'approved', publish_at_cleared: true });
  assert.deepEqual({ ...rowOf(db, a) }, { status: 'submitted', approved_at: null, approved_by: null, publish_at: null, publish_at_set_by: null, published_at: null });
  const [row] = audits(db);
  assert.deepEqual([row.action, row.by, row.from, row.to, row.publish_at_cleared], ['article.returned_to_submitted', AUTHOR, 'approved', 'submitted', true]);
  assert.ok(!JSON.stringify(row).includes('better title'), 'the new text is not in the audit row');
  const told = db.prepare(`SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'articles_author_back_to_submitted'`).get(AUTHOR) as any;
  assert.equal(told.n, 1, 'the author is told');
  // The cron no longer publishes it.
  assert.equal((await publishDueArticles(env(db), new Date(Date.now() + 40 * 3_600_000))).published, 0);
});

test('an edit to a submitted article keeps it Submitted; a save that changes nothing changes nothing', async () => {
  const db = freshDb();
  const s = article(db, 'submitted');
  const r = await call(db, `/${s}`, { subtitle: 'New subtitle' }, AUTHOR, { app: articles, method: 'PUT' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.returned_to_queue, { from: 'submitted', publish_at_cleared: false });
  assert.equal(rowOf(db, s).status, 'submitted');

  const a = article(db, 'approved', AUTHOR, { approved_by: ADMIN, publish_at: inHours(30), publish_at_set_by: ADMIN });
  const title = (db.prepare('SELECT title FROM articles WHERE id = ?').get(a) as any).title;
  const same = await call(db, `/${a}`, { title }, AUTHOR, { app: articles, method: 'PUT' });
  assert.equal(same.status, 200);
  assert.equal(same.body.returned_to_queue, null);
  assert.equal(rowOf(db, a).status, 'approved', 'the editor saving every field unchanged does not reset an approval');
  assert.ok(rowOf(db, a).publish_at);
});

test('a draft edit is unchanged by the rule, and in review stays locked', async () => {
  const db = freshDb();
  const d = article(db, 'draft');
  const r = await call(db, `/${d}`, { title: 'Draft title' }, AUTHOR, { app: articles, method: 'PUT' });
  assert.equal(r.status, 200);
  assert.equal(r.body.returned_to_queue, null);
  assert.equal(rowOf(db, d).status, 'draft');
  const ir = article(db, 'in_review');
  assert.equal((await call(db, `/${ir}`, { title: 'X' }, AUTHOR, { app: articles, method: 'PUT' })).body.error, 'locked_for_review');
  assert.deepEqual(audits(db), []);
});

test('two admins deciding at once: the loser changes nothing, writes no audit row, and is told the status', async () => {
  const db = freshDb();
  const a = article(db, 'in_review');
  // Another admin rejects the article between this approve's read and its write.
  const base = d1Over(db) as any;
  const racing = {
    ...base,
    prepare(sql: string) {
      if (/^UPDATE articles SET status = \?/.test(sql)) db.prepare(`UPDATE articles SET status = 'rejected' WHERE id = ?`).run(a);
      return base.prepare(sql);
    },
  };
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await (adminArticles as any).request(`/${a}/approve`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}',
  }, { ...env(db), DB: racing });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'invalid_status', status: 'rejected' });
  assert.equal(rowOf(db, a).status, 'rejected', 'the approve did not overwrite the rejection');
  assert.equal(rowOf(db, a).approved_by, null);
  assert.deepEqual(audits(db), []);
});
