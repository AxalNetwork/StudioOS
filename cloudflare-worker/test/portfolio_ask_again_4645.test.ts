/**
 * #4645 (D4645) — "Ask again" is one reminder per ask per window, and it says
 * what it actually delivered.
 *
 * WHAT WAS WRONG. The cooldown was checked, then every recipient was notified,
 * and only then was `asked_again_at` written — by id, unconditionally. So:
 *
 *   · two presses at once (a double click, a retried request) both passed the
 *     check and both notified everyone, and the second write overwrote the
 *     first's timestamp;
 *   · a `notify` that threw part-way through left `asked_again_at` unset, so a
 *     retry re-sent to everyone already told, and nothing recorded how far the
 *     first attempt had got;
 *   · the response's `asked_again` was the LENGTH OF THE RECIPIENT LIST — a
 *     claim of delivery the handler never checked.
 *
 * WHAT IS PINNED
 *   · The cooldown is claimed in SQL before anything is sent; of two
 *     concurrent presses exactly one sends and the other gets a 409.
 *   · The claim respects a reply arriving between the check and the write.
 *   · The response reports recipients, notified and failed apart, and a
 *     recipient whose delivery fails is counted rather than thrown.
 *   · It does not claim exactly-once delivery for onward channels.
 *
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_ask_again_4645.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import updates from '../src/routes/portfolio_updates.ts';
import { ASK_AGAIN_DAYS } from '../src/services/updateShare.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))!), 'utf8');
const ddl = (prefix: string) => file(prefix).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 20, ALEX = 21, BEA = 22, CASS = 23, STRANGER = 24;
const LONG_AGO = '2026-01-01T00:00:00Z';

const app = new Hono<any>();
app.route('/api/portfolio-updates', updates);
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);`);
  db.exec(ddl('125'));
  // The whole file, not just its CREATEs: 437's ALTERs add `sent_at`, and
  // 202611091055's add the delivery columns `update_recipients` now carries.
  db.exec(file('437'));
  db.exec(file('202611091055'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  for (const [id, name] of [[ALEX, 'Alex'], [BEA, 'Bea'], [CASS, 'Cass']] as const) u.run(id, 'investor', null, name, `${String(name).toLowerCase()}@fund.example`);
  u.run(STRANGER, 'founder', 13, 'Sam', 'sam@else.example');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture', 10)").run();
  db.prepare(`INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, title, status, sent_at)
              VALUES (1, 'u1', 7, ?, 'October', 'sent', ?)`).run(FOUNDER, LONG_AGO);
  db.prepare(`INSERT INTO update_asks (id, uid, update_id, kind, text, asked_again_at)
              VALUES (1, 'ask-1', 1, 'market', 'Someone in Spain', NULL)`).run();
  const rcp = db.prepare('INSERT INTO update_recipients (update_id, audience, user_id, email) VALUES (?,?,?,?)');
  rcp.run(1, 'investor', ALEX, null);
  rcp.run(1, 'investor', BEA, null);
  rcp.run(1, 'investor', CASS, null);
  // A recipient with no account: the handler reads only rows that name a user.
  rcp.run(1, 'investor', null, 'nobody@fund.example');
  return db;
}

async function call(db: DatabaseSync, userId: number, path: string, env: Record<string, unknown> = {},
                    before?: (sql: string) => void) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const base = d1Over(db);
  // `before` sees every statement as it is prepared, which is how a write by
  // someone else is placed at an exact point inside the handler.
  const DB = before
    ? new Proxy(base as any, {
      get(target, prop, recv) {
        if (prop === 'prepare') return (sql: string) => { before(sql); return (target as any).prepare(sql); };
        return Reflect.get(target, prop, recv);
      },
    })
    : base;
  const res = await app.fetch(new Request(`http://t/api/portfolio-updates${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB, ...env } as any, ctx as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { return { status: res.status, body: text as any }; }
}

const askAgain = (db: DatabaseSync, who = FOUNDER, before?: (sql: string) => void) =>
  call(db, who, '/asks/ask-1/ask-again', {}, before);
const askedAgainAt = (db: DatabaseSync) => (db.prepare('SELECT asked_again_at FROM update_asks WHERE id = 1').get() as any)?.asked_again_at ?? null;
const inboxCount = (db: DatabaseSync) => {
  try { return (db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get() as any).n as number; } catch { return null; }
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('one press sends, and the response reports the recipients, what was notified and what failed', async () => {
  const db = fixture();
  const res = await askAgain(db);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.recipients, 3, 'the three recipients that name an account');
  assert.equal(res.body.notified + res.body.failed, 3, 'every recipient is accounted for');
  assert.ok(typeof res.body.asked_again_at === 'string', 'the claim\'s own time is reported');
  assert.equal(askedAgainAt(db), res.body.asked_again_at, 'and is what was written');
  // The old field claimed delivery from the list's length alone.
  assert.equal(res.body.asked_again, undefined);
  assert.match(res.body.delivery, /not guaranteed exactly once/,
    'onward delivery is not represented as exactly-once');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a claim that lands between the check and the write wins; the late press sends nothing', async () => {
  const db = fixture();
  const base = inboxCount(db) ?? 0;
  // Someone else claims the window after this request's `canAskAgain` has
  // passed and just before its own claim runs — the exact interleaving the old
  // code lost, because its write was unconditional and by id.
  const theirs = new Date().toISOString();
  let raced = false;
  const res = await askAgain(db, FOUNDER, (sql) => {
    if (!raced && sql.startsWith('UPDATE update_asks SET asked_again_at')) {
      raced = true;
      db.prepare('UPDATE update_asks SET asked_again_at = ? WHERE id = 1').run(theirs);
    }
  });
  assert.ok(raced, 'the claim was reached');
  assert.equal(res.status, 409, 'the late press is refused');
  assert.match(res.body.detail, /asked again a moment ago/, 'and is told why, with what to do');
  assert.equal(askedAgainAt(db), theirs, 'the other claim stands; this press overwrote nothing');
  assert.equal(inboxCount(db) ?? 0, base, 'and nobody was notified twice');
});

test('two presses at once: exactly one sends', async () => {
  const db = fixture();
  const base = inboxCount(db) ?? 0;
  const [a, b] = await Promise.all([askAgain(db), askAgain(db)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'one wins, the other is refused');
  const winner = a.status === 200 ? a : b;
  assert.equal(winner.body.recipients, 3);
  assert.equal(askedAgainAt(db), winner.body.asked_again_at, 'the loser did not overwrite the winner\'s time');
  const written = (inboxCount(db) ?? 0) - base;
  assert.equal(written, winner.body.notified, 'each recipient got one inbox row from this window, not two');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('an answered ask is not asked again, and a reply that lands after the check still stops it', async () => {
  const already = fixture();
  already.prepare(`INSERT INTO update_ask_replies (uid, ask_id, replier_user_id, message) VALUES ('rep1', 1, ?, 'Here you go')`).run(ALEX);
  const first = await askAgain(already);
  assert.equal(first.status, 409, 'an answered ask is not asked again');
  assert.equal(askedAgainAt(already), null, 'and nothing was claimed');

  // The harder one: the reply lands AFTER `canAskAgain` has been checked
  // against a count read earlier in the handler. The claim re-asserts it in
  // its own WHERE, so a reminder cannot go out to people whose ask has in fact
  // just been answered — the count the handler read is already stale.
  const db = fixture();
  const base = inboxCount(db) ?? 0;
  let raced = false;
  const res = await askAgain(db, FOUNDER, (sql) => {
    if (!raced && sql.startsWith('UPDATE update_asks SET asked_again_at')) {
      raced = true;
      db.prepare(`INSERT INTO update_ask_replies (uid, ask_id, replier_user_id, message) VALUES ('rep2', 1, ?, 'Just saw this')`).run(BEA);
    }
  });
  assert.ok(raced, 'the claim was reached');
  assert.equal(res.status, 409, 'the reminder is dropped for an ask answered a moment ago');
  assert.equal(askedAgainAt(db), null, 'nothing was claimed');
  assert.equal(inboxCount(db) ?? 0, base, 'and nobody was reminded about an ask that has an answer');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the cooldown is counted from the last ask, and a second reminder waits the whole window', async () => {
  const db = fixture();
  assert.equal((await askAgain(db)).status, 200);
  assert.equal((await askAgain(db)).status, 409, 'not twice in one window');

  // Move the claim a day short of the window: still refused.
  const shy = new Date(Date.now() - (ASK_AGAIN_DAYS - 1) * 86_400_000).toISOString();
  db.prepare('UPDATE update_asks SET asked_again_at = ? WHERE id = 1').run(shy);
  assert.equal((await askAgain(db)).status, 409, `${ASK_AGAIN_DAYS - 1} days is not the window`);

  // A full window later it is allowed again.
  const past = new Date(Date.now() - (ASK_AGAIN_DAYS + 1) * 86_400_000).toISOString();
  db.prepare('UPDATE update_asks SET asked_again_at = ? WHERE id = 1').run(past);
  const again = await askAgain(db);
  assert.equal(again.status, 200, 'a full window later the reminder is allowed');
  assert.notEqual(askedAgainAt(db), past, 'and the claim moves on');
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('a recipient whose delivery fails is counted, not thrown, and the rest still get theirs', async () => {
  const db = fixture();
  // The inbox table is dropped, so every `notify` fails. `notify` is
  // best-effort by contract and answers null rather than throwing; the
  // handler must report that instead of 500ing after it has claimed.
  db.exec('CREATE TABLE notifications_inbox (id INTEGER PRIMARY KEY, blocked INTEGER NOT NULL)');
  const res = await askAgain(db);
  assert.equal(res.status, 200, 'the reminder still answers');
  assert.equal(res.body.recipients, 3);
  assert.equal(res.body.notified + res.body.failed, 3, 'every recipient is still accounted for');
  assert.ok(res.body.failed >= 1, 'and a failure is reported rather than hidden');
  // The claim stands: a retry must not re-send to whoever did get theirs.
  assert.ok(askedAgainAt(db), 'the window is claimed even when delivery failed');
  assert.equal((await askAgain(db)).status, 409);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('only the people who may operate the update can ask again', async () => {
  const db = fixture();
  assert.equal((await askAgain(db, STRANGER)).status, 403);
  assert.equal(askedAgainAt(db), null, 'a refused caller claims nothing');
  assert.equal((await call(db, FOUNDER, '/asks/no-such-ask/ask-again')).status, 404);
});
