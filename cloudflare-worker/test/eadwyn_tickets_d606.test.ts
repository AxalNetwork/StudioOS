/**
 * D606 (#1107, #1108) — what the Eadwyn Tickets screens read from the Worker.
 *
 *   - The review queue's lists say how many are waiting (`total`), not only
 *     how many came back: a list reads the oldest 200, so a queue past the
 *     200th would otherwise show a short number. A task carries its GitHub
 *     issue's number, as a feature does.
 *   - Each approved suggestion carries `reward`, the credits its grant paid
 *     (the ledger row D544's approval writes, keyed `task:<id>`), and says
 *     when the grant was taken back or the ledger could not be read.
 *   - `GET /api/community-tasks/rewards` gives every signed-in member the
 *     amounts the panels state, from D540's rules; a failed read is a
 *     refusal, never zeros.
 *
 * The real routers run over node:sqlite with `users`, `tickets`,
 * `activity_logs` and the ledger from `schema_baseline.sql`, plus migrations
 * 381 (the rules) and 383 (the review store, its triggers included).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/eadwyn_tickets_d606.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import reviews from '../src/routes/admin_ticket_reviews.ts';
import communityTasks, { PANEL_REWARD_KEYS } from '../src/routes/community_tasks.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, FOUNDER = 10, OTHER = 11;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [FOUNDER]: 'founder', [OTHER]: 'founder' };
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
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT);`);
  db.exec(read('cloudflare-worker/sql/migrations/381_credit_reward_rules.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/383_community_tasks.sql'));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `U${id}`, `u${id}@example.test`);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

const ticket = (db: any, type: string, o: { user?: number; issue?: number | null; title?: string } = {}) =>
  Number(db.prepare(`INSERT INTO tickets (title, description, priority, type, user_id, submitted_by, github_issue_number, github_issue_url)
                     VALUES (?, 'Details', 'high', ?, ?, 'U', ?, ?)`)
    .run(o.title ?? `A ${type}`, type, o.user ?? FOUNDER, o.issue ?? null,
      o.issue ? `https://github.com/acme/tickets/issues/${o.issue}` : null).lastInsertRowid);
const taskRowFor = (db: any, ticketId: number) => Number((db.prepare('SELECT id FROM community_tasks WHERE ticket_id = ?').get(ticketId) as any).id);
const decide = (db: any, taskId: number, status: 'approved' | 'declined', reason: string | null = null) =>
  db.prepare(`UPDATE community_tasks SET status = ?, decline_reason = ?, decided_by = ?, decided_at = '2026-10-05T10:00:00.000Z' WHERE id = ?`)
    .run(status, reason, SUPER, taskId);
const grant = (db: any, userId: number, ref: string, delta: number) =>
  Number(db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note, rule_key) VALUES (?, ?, 'grant', ?, 'x', 'task_approved')`)
    .run(userId, delta, ref).lastInsertRowid);
const revoke = (db: any, userId: number, grantId: number, delta: number) =>
  db.prepare(`INSERT INTO perk_credit_ledger (user_id, delta, kind, source_ref, note) VALUES (?, ?, 'admin_adjust', ?, 'taken back')`)
    .run(userId, -delta, `revoke:${grantId}`);

function makeD1(db: InstanceType<typeof DatabaseSync>, failOn?: RegExp) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const boom = () => { if (failOn && failOn.test(sql)) throw new Error('D1_ERROR: disk I/O error'); };
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { boom(); return db.prepare(sql).get(...b) ?? null; },
        async all() { boom(); return { results: db.prepare(sql).all(...b) }; },
        async run() {
          boom();
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

async function call(router: any, db: any, path: string, who: number | null, failOn?: RegExp) {
  const headers: Record<string, string> = {};
  if (who !== null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await router.request(path, { headers }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, failOn) } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

// ---- the review queue's lists ------------------------------------------------------

test('the feature list says how many are waiting, past the 200 it returns, and leaves decided ones out', async () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO tickets (title, priority, type, user_id) VALUES (?, 'low', 'feature', ?)`);
  for (let i = 0; i < 203; i++) ins.run(`Feature ${i}`, FOUNDER);
  const decided = Number((db.prepare(`SELECT id FROM tickets ORDER BY id LIMIT 1`).get() as any).id);
  db.prepare(`INSERT INTO feature_request_reviews (ticket_id, status, decided_by, decided_at) VALUES (?, 'approved', ?, '2026-10-05')`).run(decided, SUPER);
  ticket(db, 'bug');
  const r = await call(reviews, db, '/features', SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 200);
  assert.equal(r.body.count, 200);
  assert.equal(r.body.total, 202, 'the decided feature or the bug was counted, or the page capped the total');
});

test('the task list carries each issue number and a total of pending suggestions only', async () => {
  const db = freshDb();
  const a = ticket(db, 'task', { issue: 1301, title: 'Share a cap-table template' });
  const b = ticket(db, 'task', { title: 'Post your first update' });
  const c = ticket(db, 'task', { title: 'Declined idea' });
  decide(db, taskRowFor(db, c), 'declined', 'Not useful to others');
  ticket(db, 'feature');
  const r = await call(reviews, db, '/tasks', SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, 2);
  assert.equal(r.body.count, 2);
  const by = Object.fromEntries(r.body.items.map((x: any) => [x.ticket_id, x]));
  assert.equal(by[a].github_issue_number, 1301);
  assert.equal(by[a].github_issue_url, 'https://github.com/acme/tickets/issues/1301');
  assert.equal(by[b].github_issue_number, null);
  assert.deepEqual(r.body.audiences, ['all', 'founder', 'investor', 'advisor', 'partner', 'explorer']);
});

test('the lists stay the Super Admin\'s', async () => {
  const db = freshDb();
  for (const path of ['/features', '/tasks']) {
    const r = await quiet(() => call(reviews, db, path, FOUNDER));
    assert.equal(r.status, 403, path);
    assert.equal('total' in (r.body || {}), false);
  }
});

// ---- what each approved suggestion was paid ------------------------------------------

test('an approved suggestion carries the credits its grant paid; pending and declined carry none', async () => {
  const db = freshDb();
  const paid = taskRowFor(db, ticket(db, 'task', { title: 'Paid' }));
  const back = taskRowFor(db, ticket(db, 'task', { title: 'Taken back' }));
  const unpaid = taskRowFor(db, ticket(db, 'task', { title: 'Approved, nothing paid' }));
  const pending = taskRowFor(db, ticket(db, 'task', { title: 'Pending' }));
  const declined = taskRowFor(db, ticket(db, 'task', { title: 'Declined' }));
  for (const id of [paid, back, unpaid]) decide(db, id, 'approved');
  decide(db, declined, 'declined', 'Not useful to others');
  grant(db, FOUNDER, `task:${paid}`, 10);
  const g = grant(db, FOUNDER, `task:${back}`, 12);
  revoke(db, FOUNDER, g, 12);
  // Someone else's grant under the same key shape is not this member's.
  grant(db, OTHER, `task:${unpaid}`, 10);
  const r = await call(communityTasks, db, '/', FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.my_suggestions.map((s: any) => [s.id, s.reward]));
  assert.deepEqual(by[paid], { credits: 10, revoked: false });
  assert.deepEqual(by[back], { credits: 12, revoked: true });
  assert.deepEqual(by[unpaid], { credits: null, revoked: false }, 'another member\'s grant was read as this one\'s');
  assert.equal(by[pending], null);
  assert.equal(by[declined], null);
});

test('a ledger that cannot be read says so on each approved suggestion, and the list is still served', async () => {
  const db = freshDb();
  const ok = taskRowFor(db, ticket(db, 'task', { title: 'Approved' }));
  const pending = taskRowFor(db, ticket(db, 'task', { title: 'Pending' }));
  decide(db, ok, 'approved');
  grant(db, FOUNDER, `task:${ok}`, 10);
  const r = await quiet(() => call(communityTasks, db, '/', FOUNDER, /FROM perk_credit_ledger g/));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.my_suggestions.map((s: any) => [s.id, s.reward]));
  assert.deepEqual(by[ok], { credits: null, credits_unreadable: true });
  assert.equal(by[pending], null);
});

// ---- what the panels state ---------------------------------------------------------

test('the rewards read gives the four amounts the panels state, as the rules hold them today', async () => {
  const db = freshDb();
  db.prepare(`UPDATE credit_reward_rules SET credits = 175 WHERE key = 'bug_high'`).run();
  db.prepare(`UPDATE credit_reward_rules SET active = 0 WHERE key = 'bug_low'`).run();
  const r = await call(communityTasks, db, '/rewards', FOUNDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.rewards), [...PANEL_REWARD_KEYS]);
  assert.deepEqual(r.body.rewards, {
    task_approved: { credits: 10, active: true },
    bug_high: { credits: 175, active: true },
    bug_medium: { credits: 60, active: true },
    bug_low: { credits: 20, active: false },
  });
  assert.doesNotMatch(JSON.stringify(r.body), /feature_shipped|updated_by/);
});

test('a rule the table lacks is null, never zero; a failed read is a refusal; signed out is refused', async () => {
  const db = freshDb();
  db.prepare(`DELETE FROM credit_reward_rules WHERE key = 'task_approved'`).run();
  const r = await call(communityTasks, db, '/rewards', FOUNDER);
  assert.equal(r.status, 200);
  assert.equal(r.body.rewards.task_approved, null);
  const bad = await quiet(() => call(communityTasks, db, '/rewards', FOUNDER, /FROM credit_reward_rules/));
  assert.equal(bad.status, 500);
  assert.equal(bad.body.error, 'rewards_unreadable');
  assert.equal('rewards' in bad.body, false);
  assert.doesNotMatch(JSON.stringify(bad.body), /disk I\/O/);
  const out = await call(communityTasks, db, '/rewards', null);
  assert.equal(out.status, 401);
});
