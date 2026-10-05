/**
 * D544 — the Super Admin's review queue for feature requests and suggested
 * tasks.
 *
 * The real router (`routes/admin_ticket_reviews.ts`) runs over node:sqlite,
 * with `tickets`, `users` and `activity_logs` from `schema_baseline.sql`, the
 * ledger plus migration 381 (D540's rules), and migration 383 itself — its
 * triggers included, so a task ticket's pending row is written the way
 * production writes it. GitHub is a stubbed `fetch` that records each call.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ticket_reviews_d544.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import reviews from '../src/routes/admin_ticket_reviews.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, ASKER = 10, OTHER = 11;
const WHY = 'Useful to every founder in the cohort';
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'tickets', 'activity_logs', 'perk_credit_ledger']) db.exec(ddl(t));
  db.exec(`CREATE UNIQUE INDEX idx_perk_ledger_idem ON perk_credit_ledger(user_id, kind, source_ref);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT);
           CREATE TABLE push_subscriptions (id INTEGER PRIMARY KEY, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT);`);
  db.exec(read('cloudflare-worker/sql/migrations/381_credit_reward_rules.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/383_community_tasks.sql'));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(SUPER, 'admin', 'Super', 'super@example.test');
  u.run(ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  u.run(ASKER, 'founder', 'Ada Asker', 'ada@example.test');
  u.run(OTHER, 'founder', 'Bo Other', 'bo@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}
const ticket = (db: any, o: { type: string; title?: string; user?: number | null; issue?: number | null }) =>
  Number(db.prepare(`INSERT INTO tickets (title, description, priority, type, user_id, submitted_by, github_issue_number, github_issue_url)
                     VALUES (?, 'Details here', 'high', ?, ?, 'Ada Asker', ?, ?)`)
    .run(o.title ?? `A ${o.type}`, o.type, o.user === undefined ? ASKER : o.user, o.issue ?? null,
      o.issue ? `https://github.com/acme/tickets/issues/${o.issue}` : null).lastInsertRowid);

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

type GhCall = { method: string; url: string; body: any };
function withGithub(status = 201) {
  const calls: GhCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ method: init.method || 'GET', url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify([{ name: 'x' }]), { status });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
const GH = { GITHUB_ACCESS_TOKEN: 'test-token', GITHUB_REPO_OWNER: 'acme', GITHUB_REPO_NAME: 'tickets' };

async function call(db: any, method: string, path: string, who: number, body?: unknown, extraEnv: Record<string, string> = GH) {
  const jwt = await new SignJWT({ user_id: who, role: who === SUPER || who === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await reviews.request(path, init, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), ...extraEnv } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};
const logs = (db: any, action: string) => db.prepare('SELECT details, user_id FROM activity_logs WHERE action = ?').all(action).map((x: any) => ({ ...x }));
const inbox = (db: any, userId: number) => {
  try { return db.prepare('SELECT title, body FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId).map((x: any) => ({ ...x })); }
  catch { return []; }
};
const grants = (db: any, userId: number) =>
  db.prepare(`SELECT delta, source_ref, rule_key FROM perk_credit_ledger WHERE user_id = ? AND kind = 'grant'`).all(userId).map((x: any) => ({ ...x }));

// ---- the store ------------------------------------------------------------------

test('a task ticket writes its pending row; a bug or a feature does not; a re-typed ticket does', () => {
  const db = freshDb();
  const t1 = ticket(db, { type: 'task', title: 'Share a cap-table template' });
  ticket(db, { type: 'bug' });
  const t3 = ticket(db, { type: 'feature' });
  const rows = () => db.prepare('SELECT ticket_id, title, body, status, audience FROM community_tasks ORDER BY id').all().map((x: any) => ({ ...x }));
  assert.deepEqual(rows(), [{ ticket_id: t1, title: 'Share a cap-table template', body: 'Details here', status: 'pending', audience: 'all' }]);
  db.prepare(`UPDATE tickets SET type = 'task' WHERE id = ?`).run(t3);
  db.prepare(`UPDATE tickets SET type = 'task' WHERE id = ?`).run(t1);
  // Re-typed away and back again: still one row.
  db.prepare(`UPDATE tickets SET type = 'feature' WHERE id = ?`).run(t3);
  db.prepare(`UPDATE tickets SET type = 'task' WHERE id = ?`).run(t3);
  assert.deepEqual(rows().map((r: any) => r.ticket_id), [t1, t3], 'one row each, never two');
});

// ---- the gate ---------------------------------------------------------------------

test('every review route is the Super Admin\'s; a plain admin and a founder are refused and nothing changes', async () => {
  const db = freshDb();
  const f = ticket(db, { type: 'feature', issue: 41 });
  ticket(db, { type: 'task' });
  const gh = withGithub();
  try {
    for (const who of [ADMIN, ASKER]) {
      for (const [m, p, b] of [['GET', '/features'], ['GET', '/tasks'], ['POST', `/features/${f}/approve`, { reason: WHY }],
        ['POST', `/features/${f}/decline`, { reason: WHY }], ['POST', '/tasks/1/approve', { reason: WHY, audience: 'all' }],
        ['POST', '/tasks/1/decline', { reason: WHY }]] as const) {
        const r = await quiet(() => call(db, m, p, who, b));
        assert.equal(r.status, 403, `${who} ${m} ${p}`);
      }
    }
  } finally { gh.restore(); }
  assert.equal(gh.calls.length, 0, 'GitHub was never called');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feature_request_reviews').get() as any).n, 0);
  assert.equal((db.prepare(`SELECT status FROM community_tasks`).get() as any).status, 'pending');
});

// ---- features ---------------------------------------------------------------------

test('the feature queue lists undecided requests with who asked and the mirrored issue', async () => {
  const db = freshDb();
  const f = ticket(db, { type: 'feature', title: 'Export the cap table', issue: 41 });
  ticket(db, { type: 'bug' });
  const r = await call(db, 'GET', '/features', SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.count, 1);
  const [x] = r.body.items;
  assert.deepEqual([x.ticket_id, x.title, x.priority, x.asked_by.user_id, x.asked_by.name, x.github_issue_url],
    [f, 'Export the cap table', 'high', ASKER, 'Ada Asker', 'https://github.com/acme/tickets/issues/41']);
});

test('approving a feature records it, adds feature:approved without touching other labels, logs and tells the user', async () => {
  const db = freshDb();
  const f = ticket(db, { type: 'feature', title: 'Export the cap table', issue: 41 });
  const gh = withGithub();
  let r;
  try { r = await call(db, 'POST', `/features/${f}/approve`, SUPER, { reason: WHY }); } finally { gh.restore(); }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.status, r.body.label_status], ['approved', 'added']);
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].method, 'POST', 'POST adds; a PUT would replace every label');
  assert.match(gh.calls[0].url, /\/repos\/acme\/tickets\/issues\/41\/labels$/);
  assert.deepEqual(gh.calls[0].body, { labels: ['feature:approved'] });
  const row = db.prepare('SELECT status, decided_by, label_status, decline_reason FROM feature_request_reviews WHERE ticket_id = ?').get(f) as any;
  assert.deepEqual({ ...row }, { status: 'approved', decided_by: SUPER, label_status: 'added', decline_reason: null });
  const l = logs(db, 'feature_request_approved');
  assert.equal(l.length, 1);
  assert.equal(l[0].user_id, SUPER);
  assert.equal(JSON.parse(l[0].details).reason, WHY);
  assert.match(inbox(db, ASKER)[0].title, /approved/);
  assert.equal((await call(db, 'GET', '/features', SUPER)).body.count, 0, 'it has left the queue');
});

test('declining a feature adds feature:declined and sends the user the reason; a second decision is refused', async () => {
  const db = freshDb();
  const f = ticket(db, { type: 'feature', title: 'Dark mode for invoices', issue: 42 });
  const gh = withGithub();
  let r, again;
  try {
    r = await call(db, 'POST', `/features/${f}/decline`, SUPER, { reason: 'Invoices already follow the system theme' });
    again = await call(db, 'POST', `/features/${f}/approve`, SUPER, { reason: WHY });
  } finally { gh.restore(); }
  assert.equal(r.status, 200);
  assert.deepEqual(gh.calls.map((x) => x.body), [{ labels: ['feature:declined'] }], 'the second decision called GitHub not at all');
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_decided');
  assert.equal(again.body.status, 'declined');
  const note = inbox(db, ASKER);
  assert.equal(note.length, 1);
  assert.match(note[0].body, /Invoices already follow the system theme/);
  assert.equal((db.prepare('SELECT decline_reason FROM feature_request_reviews WHERE ticket_id = ?').get(f) as any).decline_reason,
    'Invoices already follow the system theme');
});

test('the decision stands when GitHub fails or is not set up, and says so', async () => {
  const db = freshDb();
  const a = ticket(db, { type: 'feature', issue: 50 });
  const b = ticket(db, { type: 'feature', issue: 51 });
  const c = ticket(db, { type: 'feature', issue: null });
  const gh = withGithub(500);
  let ra, rb, rc;
  try {
    ra = await quiet(() => call(db, 'POST', `/features/${a}/approve`, SUPER, { reason: WHY }));
    rb = await call(db, 'POST', `/features/${b}/approve`, SUPER, { reason: WHY }, {});
    rc = await call(db, 'POST', `/features/${c}/approve`, SUPER, { reason: WHY });
  } finally { gh.restore(); }
  assert.deepEqual([ra.body.label_status, rb.body.label_status, rc.body.label_status], ['failed', 'not_configured', 'no_issue']);
  const stored = db.prepare('SELECT label_status FROM feature_request_reviews ORDER BY ticket_id').all().map((x: any) => x.label_status);
  assert.deepEqual(stored, ['failed', 'not_configured', 'no_issue']);
});

test('a decision needs a typed reason and a real feature request', async () => {
  const db = freshDb();
  const f = ticket(db, { type: 'feature', issue: 41 });
  const bug = ticket(db, { type: 'bug', issue: 43 });
  const short = await call(db, 'POST', `/features/${f}/approve`, SUPER, { reason: 'ok' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'reason_too_short');
  assert.equal((await call(db, 'POST', `/features/${bug}/approve`, SUPER, { reason: WHY })).status, 404, 'a bug is not a feature request');
  assert.equal((await call(db, 'POST', '/features/999/approve', SUPER, { reason: WHY })).status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM feature_request_reviews').get() as any).n, 0);
});

// ---- suggested tasks ------------------------------------------------------------------

test('approving a task publishes it to its audience and pays the suggester exactly once', async () => {
  const db = freshDb();
  ticket(db, { type: 'task', title: 'Share a cap-table template' });
  const list = await call(db, 'GET', '/tasks', SUPER);
  assert.equal(list.body.count, 1);
  assert.deepEqual(list.body.audiences, ['all', 'founder', 'investor', 'advisor', 'partner', 'explorer']);
  const id = list.body.items[0].id;
  assert.equal(list.body.items[0].asked_by.user_id, ASKER);
  const r = await call(db, 'POST', `/tasks/${id}/approve`, SUPER, { reason: WHY, audience: 'founder' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.reward.status, 'granted');
  assert.equal(r.body.reward.credits, 10);
  const row = db.prepare('SELECT status, audience, decided_by FROM community_tasks WHERE id = ?').get(id) as any;
  assert.deepEqual({ ...row }, { status: 'approved', audience: 'founder', decided_by: SUPER });
  const again = await call(db, 'POST', `/tasks/${id}/approve`, SUPER, { reason: WHY, audience: 'all' });
  assert.equal(again.status, 409);
  assert.deepEqual(grants(db, ASKER), [{ delta: 10, source_ref: `task:${id}`, rule_key: 'task_approved' }], 'paid once');
  assert.equal((db.prepare('SELECT audience FROM community_tasks WHERE id = ?').get(id) as any).audience, 'founder', 'the second approval changed nothing');
  const l = logs(db, 'community_task_approved');
  assert.equal(l.length, 1);
  assert.deepEqual([JSON.parse(l[0].details).audience, JSON.parse(l[0].details).reward], ['founder', 'granted']);
  assert.equal(logs(db, 'credit_grant')[0].user_id, SUPER, 'the reward names the Super Admin as its actor');
  assert.equal((await call(db, 'GET', '/tasks', SUPER)).body.count, 0);
  const late = await call(db, 'POST', `/tasks/${id}/decline`, SUPER, { reason: 'Changed my mind about this' });
  assert.equal(late.status, 409, 'an approved task cannot then be declined');
  assert.equal((db.prepare('SELECT status FROM community_tasks WHERE id = ?').get(id) as any).status, 'approved');
  assert.deepEqual(inbox(db, ASKER).filter((n: any) => /declined/.test(n.title)), []);
});

test('a task approval needs a known audience; a task from a staff account publishes but pays nothing', async () => {
  const db = freshDb();
  ticket(db, { type: 'task' });
  ticket(db, { type: 'task', user: ADMIN });
  const bad = await call(db, 'POST', '/tasks/1/approve', SUPER, { reason: WHY, audience: 'everyone' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_audience');
  assert.equal((db.prepare('SELECT status FROM community_tasks WHERE id = 1').get() as any).status, 'pending');
  const staff = await call(db, 'POST', '/tasks/2/approve', SUPER, { reason: WHY, audience: 'all' });
  assert.equal(staff.status, 200);
  assert.equal(staff.body.reward.code, 'not_eligible');
  assert.deepEqual(grants(db, ADMIN), []);
});

test('declining a task records the reason and sends it; it pays nothing and leaves the queue', async () => {
  const db = freshDb();
  ticket(db, { type: 'task', title: 'Post your pitch deck publicly' });
  const r = await call(db, 'POST', '/tasks/1/decline', SUPER, { reason: 'Decks are private by default here' });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT status, decline_reason FROM community_tasks WHERE id = 1').get() as any;
  assert.deepEqual({ ...row }, { status: 'declined', decline_reason: 'Decks are private by default here' });
  assert.match(inbox(db, ASKER)[0].body, /Decks are private by default here/);
  assert.deepEqual(grants(db, ASKER), []);
  assert.equal((await call(db, 'POST', '/tasks/1/approve', SUPER, { reason: WHY, audience: 'all' })).status, 409);
  assert.equal(logs(db, 'community_task_declined').length, 1);
});
