/**
 * #4645 (D4645-p2) — an "Ask again" reminder is a recorded round with one
 * durable delivery per recipient, checked against the current records just
 * before each send, and an interrupted or lost reminder is reconciled rather
 * than re-sent blind.
 *
 * WHAT IS PINNED
 *   · A round reserves one delivery per current recipient of the update's
 *     current version: not a recipient of an older version, not one whose
 *     delivery of the update was declined.
 *   · A request repeated with the same key (its response was lost) answers
 *     the original round and sends nothing again.
 *   · A reply, a new version or a removed recipient that lands mid-round
 *     stops the deliveries not yet sent, each with its reason.
 *   · An attempt that never recorded an outcome is found in the inbox by its
 *     delivery uid (delivered, no second row) or left unconfirmed; it is
 *     re-sent only when asked for explicitly. A reservation never attempted
 *     is sent on resume.
 *   · The page and a refused press show the latest round's progress.
 *   · The cooldown reads a zone-less stored time as UTC, in JS and in SQL.
 *
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_ask_reminders_4645p2.test.ts
 */
// A runtime that is not on UTC is where a zone-less time read as local moves
// the cooldown; set before any Date is made.
process.env.TZ = 'America/Los_Angeles';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import updates from '../src/routes/portfolio_updates.ts';
import { ASK_AGAIN_DAYS, canAskAgain, stampMs } from '../src/services/updateShare.ts';
import { ensureInbox } from '../src/services/notify.ts';
import { STALE_ATTEMPT_MS } from '../src/services/updateLifecycle.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))!), 'utf8');
const ddl = (prefix: string) => file(prefix).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 20, ALEX = 21, BEA = 22, CASS = 23, DAN = 25;
const LONG_AGO = '2026-01-01T00:00:00Z';
const SHA = 'a'.repeat(64);

const app = new Hono<any>();
app.route('/api/portfolio-updates', updates);
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };

/**
 * An update published as version 2. Alex and Bea were delivered version 2;
 * Cass's delivery of it was declined; Dan was a recipient of version 1 only.
 */
async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);`);
  db.exec(ddl('125'));
  db.exec(file('437'));
  db.exec(file('202611091055'));
  db.exec(file('202611182124'));
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  for (const [id, name] of [[ALEX, 'Alex'], [BEA, 'Bea'], [CASS, 'Cass'], [DAN, 'Dan']] as const) u.run(id, 'investor', null, name, `${String(name).toLowerCase()}@fund.example`);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture', 10)").run();
  db.prepare(`INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, title, status, sent_at, published_version)
              VALUES (1, 'u1', 7, ?, 'October', 'sent', ?, 2)`).run(FOUNDER, LONG_AGO);
  const v = db.prepare(`INSERT INTO portfolio_update_versions (id, uid, update_id, version, title, content_sha256, published_by_user_id, published_at)
                        VALUES (?, ?, 1, ?, 'October', ?, ?, ?)`);
  v.run(1, 'v1', 1, SHA, FOUNDER, LONG_AGO);
  v.run(2, 'v2', 2, SHA, FOUNDER, LONG_AGO);
  db.prepare(`INSERT INTO update_asks (id, uid, update_id, kind, text) VALUES (1, 'ask-1', 1, 'market', 'Someone in Spain')`).run();
  db.prepare(`INSERT INTO update_asks (id, uid, update_id, kind, text) VALUES (2, 'ask-2', 1, 'hire', 'An engineer')`).run();
  const rcp = db.prepare(`INSERT INTO update_recipients (update_id, audience, user_id, version_id, recipient_key, delivery_uid, delivery_state)
                          VALUES (1, 'investor', ?, ?, ?, ?, ?)`);
  rcp.run(ALEX, 2, `user:${ALEX}`, 'd-a2', 'delivered');
  rcp.run(BEA, 2, `user:${BEA}`, 'd-b2', 'delivered');
  rcp.run(CASS, 2, `user:${CASS}`, 'd-c2', 'declined');
  rcp.run(DAN, 1, `user:${DAN}`, 'd-d1', 'delivered');
  await ensureInbox({ DB: d1Over(db) } as any);
  return db;
}

async function call(db: DatabaseSync, path: string, body: unknown = undefined, opts: { method?: string; before?: (sql: string) => void } = {}) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const base = d1Over(db);
  const before = opts.before;
  const DB = before
    ? new Proxy(base as any, {
      get(target, prop, recv) {
        if (prop === 'prepare') return (sql: string) => { before(sql); return (target as any).prepare(sql); };
        return Reflect.get(target, prop, recv);
      },
    })
    : base;
  const method = opts.method ?? 'POST';
  const res = await app.fetch(new Request(`http://t/api/portfolio-updates${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB } as any, ctx as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { return { status: res.status, body: text as any }; }
}

const askAgain = (db: DatabaseSync, body: unknown = {}, before?: (sql: string) => void) => call(db, '/asks/ask-1/ask-again', body, { before });
const inbox = (db: DatabaseSync) => db.prepare('SELECT user_id, payload FROM notifications_inbox ORDER BY id').all() as Array<{ user_id: number; payload: string }>;
const deliveries = (db: DatabaseSync) => db.prepare(
  'SELECT user_id, delivery_state, skip_reason, attempts, provider_ref, delivery_uid FROM update_ask_reminder_deliveries ORDER BY user_id',
).all() as any[];
/** The first notification inbox write fires `fn` once, just before it runs. */
const onFirstSend = (fn: () => void) => {
  let done = false;
  return (sql: string) => { if (!done && /INSERT INTO notifications_inbox/.test(sql)) { done = true; fn(); } };
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('a round reserves one delivery per current recipient of the current version, and reports each outcome', async () => {
  const db = await fixture();
  const res = await askAgain(db);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.recovered, false);
  assert.equal(res.body.version_id, 2, 'the round names the version whose recipients it reaches');
  assert.deepEqual(deliveries(db).map((d) => d.user_id), [ALEX, BEA],
    'Cass (declined) and Dan (version 1 only) are not reserved');
  assert.deepEqual([res.body.recipients, res.body.notified, res.body.failed, res.body.unconfirmed, res.body.pending, res.body.skipped],
    [2, 2, 0, 0, 0, 0]);
  assert.equal(res.body.settled, true);
  const rows = inbox(db);
  assert.deepEqual(rows.map((r) => r.user_id), [ALEX, BEA], 'one inbox row each');
  for (const d of deliveries(db)) {
    assert.equal(d.attempts, 1);
    const row = rows.find((r) => r.user_id === d.user_id)!;
    assert.equal(JSON.parse(row.payload).reminder_delivery_uid, d.delivery_uid, 'the notification carries its delivery uid');
  }
  assert.match(res.body.delivery, /not guaranteed exactly once/, 'logical deduplication is not stated as provider exactly-once');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a request repeated with the same key answers its original round and sends nothing again', async () => {
  const db = await fixture();
  const first = await askAgain(db, { request_key: 'press-0001-abcdef' });
  assert.equal(first.status, 200);
  const sent = inbox(db).length;
  const again = await askAgain(db, { request_key: 'press-0001-abcdef' });
  assert.equal(again.status, 200, 'not refused as "asked a moment ago": it is the same press');
  assert.equal(again.body.recovered, true);
  assert.equal(again.body.reminder_uid, first.body.reminder_uid, 'the same round');
  assert.equal(again.body.notified, 2);
  assert.equal(inbox(db).length, sent, 'and nobody was notified twice');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM update_ask_reminders').get() as any).n, 1, 'one round');
  // A different key inside the window is a new press, refused, with the round's progress.
  const other = await askAgain(db, { request_key: 'press-0002-abcdef' });
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'ask_not_due');
  assert.equal(other.body.reminder.reminder_uid, first.body.reminder_uid, 'a refused press still shows where the last round stands');
  assert.equal((await askAgain(db, { request_key: 'x' })).status, 400, 'a malformed key is refused before anything is written');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a reply landing mid-round stops the reminders not yet sent', async () => {
  const db = await fixture();
  const res = await askAgain(db, {}, onFirstSend(() => {
    db.prepare(`INSERT INTO update_ask_replies (uid, ask_id, replier_user_id, message) VALUES ('rep', 1, ?, 'Found one')`).run(CASS);
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(deliveries(db).map((d) => [d.user_id, d.delivery_state, d.skip_reason]),
    [[ALEX, 'delivered', null], [BEA, 'skipped', 'replied']]);
  assert.equal(res.body.skipped_reasons.replied, 1);
  assert.equal(inbox(db).length, 1);
});

test('a new version or a removed recipient mid-round stops the rest, each with its reason', async () => {
  const bumped = await fixture();
  await askAgain(bumped, {}, onFirstSend(() => {
    bumped.prepare(`INSERT INTO portfolio_update_versions (id, uid, update_id, version, title, content_sha256, published_by_user_id, published_at)
                    VALUES (3, 'v3', 1, 3, 'October', ?, ?, ?)`).run(SHA, FOUNDER, new Date().toISOString());
    bumped.prepare('UPDATE portfolio_updates SET published_version = 3 WHERE id = 1').run();
  }));
  assert.deepEqual(deliveries(bumped).map((d) => d.skip_reason), [null, 'version_changed']);

  const removed = await fixture();
  await askAgain(removed, {}, onFirstSend(() => {
    removed.prepare('DELETE FROM update_recipients WHERE user_id = ?').run(BEA);
  }));
  assert.deepEqual(deliveries(removed).map((d) => d.skip_reason), [null, 'not_current_recipient']);
  assert.equal(inbox(removed).length, 1);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('an interrupted round is reconciled: found is delivered, not found stays unconfirmed, never attempted is sent', async () => {
  const db = await fixture();
  const claimed = new Date(Date.now() - 60 * 60_000).toISOString();
  const stale = new Date(Date.now() - STALE_ATTEMPT_MS - 60_000).toISOString();
  db.prepare('UPDATE update_asks SET asked_again_at = ? WHERE id = 1').run(claimed);
  db.prepare(`INSERT INTO update_ask_reminders (id, uid, ask_id, update_id, version_id, requested_by_user_id, claimed_at)
              VALUES (1, 'round-1', 1, 1, 2, ?, ?)`).run(FOUNDER, claimed);
  const d = db.prepare(`INSERT INTO update_ask_reminder_deliveries (reminder_id, user_id, delivery_uid, delivery_state, attempts, attempt_claim, last_attempt_at)
                        VALUES (1, ?, ?, ?, ?, ?, ?)`);
  d.run(ALEX, 'rd-alex', 'attempting', 1, 'tok-a', stale);   // landed: its inbox row exists
  d.run(BEA, 'rd-bea', 'attempting', 1, 'tok-b', stale);     // the Worker stopped; no row
  d.run(CASS, 'rd-cass', 'reserved', 0, null, null);         // never attempted (Cass is no longer a recipient)
  d.run(DAN, 'rd-dan', 'attempting', 1, 'tok-d', new Date().toISOString()); // another request is on it now
  db.prepare(`INSERT INTO notifications_inbox (user_id, type, title, payload) VALUES (?, 'followed_entity_news', 'Asked again', ?)`)
    .run(ALEX, JSON.stringify({ ask_uid: 'ask-1', reminder_delivery_uid: 'rd-alex' }));
  const before = inbox(db).length;

  const res = await askAgain(db, { reminder_uid: 'round-1' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.recovered, true);
  const by = Object.fromEntries(deliveries(db).map((x) => [x.user_id, x]));
  assert.equal(by[ALEX].delivery_state, 'delivered', 'found by its delivery uid');
  assert.ok(by[ALEX].provider_ref, 'and the inbox row is recorded');
  assert.equal(by[BEA].delivery_state, 'ambiguous', 'not found: left unconfirmed, not re-sent');
  assert.equal(by[CASS].delivery_state, 'skipped', 'a reservation never attempted is checked before it is sent');
  assert.equal(by[CASS].skip_reason, 'not_current_recipient');
  assert.equal(by[DAN].delivery_state, 'attempting', 'a fresh attempt is someone else\'s and is left alone');
  assert.equal(inbox(db).length, before, 'nothing was sent to resolve an unknown outcome');
  assert.deepEqual([res.body.notified, res.body.unconfirmed, res.body.pending, res.body.skipped], [1, 1, 1, 1]);
  assert.equal(res.body.settled, false);

  // Only an explicit request re-sends the unknown one.
  const resend = await askAgain(db, { reminder_uid: 'round-1', resend_ambiguous: true });
  assert.equal(resend.status, 200);
  assert.equal(deliveries(db).find((x) => x.user_id === BEA).delivery_state, 'delivered');
  assert.deepEqual(inbox(db).slice(before).map((r) => r.user_id), [BEA], 'Bea alone, once');
  assert.equal((await askAgain(db, { reminder_uid: 'no-such-round' })).status, 404);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('the page shows each ask\'s latest round, and null for an ask never asked again', async () => {
  const db = await fixture();
  const sent = await askAgain(db);
  const page = await call(db, '/u1/page', undefined, { method: 'GET' });
  assert.equal(page.status, 200);
  assert.equal(page.body.reminders_readable, true);
  const a1 = page.body.asks.find((a: any) => a.uid === 'ask-1');
  const a2 = page.body.asks.find((a: any) => a.uid === 'ask-2');
  assert.equal(a1.reminder.reminder_uid, sent.body.reminder_uid);
  assert.deepEqual([a1.reminder.recipients, a1.reminder.notified, a1.reminder.settled], [2, 2, true]);
  assert.equal(a2.reminder, null);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the cooldown reads a zone-less stored time as UTC, in JS and in the SQL claim', async () => {
  assert.notEqual(new Date(0).getTimezoneOffset(), 0, 'this test runs off UTC');
  const sent = '2026-11-01 12:00:00';
  const due = Date.parse('2026-11-01T12:00:00Z') + ASK_AGAIN_DAYS * 86_400_000;
  assert.equal(stampMs(sent), Date.parse('2026-11-01T12:00:00Z'));
  assert.equal(stampMs('2026-11-01'), Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(canAskAgain(sent, 0, null, due), true, 'due at exactly the window, in UTC');
  assert.equal(canAskAgain(sent, 0, null, due - 60_000), false, 'and not a minute before');

  const db = await fixture();
  const old = new Date(Date.now() - (ASK_AGAIN_DAYS + 1) * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE portfolio_updates SET sent_at = ? WHERE id = 1').run(old);
  assert.equal((await askAgain(db)).status, 200, 'a zone-less sent_at past the window is claimable');
  const recent = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE update_asks SET asked_again_at = ? WHERE id = 2').run(recent);
  assert.equal((await call(db, '/asks/ask-2/ask-again')).status, 409, 'a zone-less last ask inside the window is not');
});
