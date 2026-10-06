/**
 * D482 (#1022) — a ticket's category is one of eight, and HQ's ticket SLA
 * hours are a store HQ edits (migration 333).
 *
 * What is pinned:
 *   - 333 applies on the baseline's `tickets`: its CHECK refuses a free-text
 *     category, and it seeds today's P1/P2/P3 hours;
 *   - `POST /api/tickets` stores one of the eight, refuses anything else, and
 *     stores none (NULL, never Other) when the body names none;
 *   - `PUT /api/tickets/:id` changes the category only when the body names it,
 *     on its own or beside another field; null clears it;
 *   - `PUT /api/admin/hq-support/sla-tiers` is the Super Admin's, checks the
 *     whole set (bounds and P1 ≤ P2 ≤ P3), writes one audit row per change and
 *     none for a write that changes nothing;
 *   - `GET /api/admin/hq-support` bands tickets with the stored hours, counts
 *     open tickets by category with the uncategorised apart, and, when the
 *     store cannot be read, bands no ticket rather than falling back.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/support_category_sla_store_d482.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import tickets from '../src/routes/tickets.ts';
import support from '../src/routes/admin_hq_support.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'synthetic-d482-test-secret-0123456789';
const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const M333 = readFileSync('cloudflare-worker/sql/migrations/333_ticket_category_sla_tiers.sql', 'utf8');
const HOLDER = 1, PLAIN_ADMIN = 2, FOUNDER = 3;
const H = 3600_000;

function fresh(withStore = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'licence_admins', 'territory_licences', 'tickets', 'activity_logs', 'mi_pro_subscriptions']) {
    db.exec(tableFromBaseline(BASELINE, t));
  }
  db.exec(M333);
  if (!withStore) db.exec('DROP TABLE hq_support_sla_tiers');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'plain@example.test');
  u.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  return db;
}

const app = new Hono<any>().route('/api/tickets', tickets).route('/api/admin/hq-support', support);
app.onError((e: any, c) => {
  const status = AUTH_ERROR_STATUSES[String(e?.message || '')];
  if (status) return c.json({ error: e.message }, status);
  throw e;
});

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const TIERS = (p1: number, p2: number, p3: number) => ({ tiers: {
  P1: { hours: p1, description: 'Money, access, or data at risk' },
  P2: { hours: p2, description: 'A workflow is blocked, a workaround exists' },
  P3: { hours: p3, description: 'Wrong, but nobody is stopped' },
} });

// ---- the migration ------------------------------------------------------------------

test('333 applies to the baseline: a fixed category set, and the tiers seeded with D459\'s hours', () => {
  const db = fresh();
  const ins = db.prepare("INSERT INTO tickets (title, category) VALUES ('t', ?)");
  ins.run('billing');
  ins.run(null);
  assert.throws(() => ins.run('Billing'), /CHECK/, 'a free-text category was stored');
  assert.throws(() => ins.run('refunds'), /CHECK/);
  assert.deepEqual(db.prepare('SELECT tier, hours FROM hq_support_sla_tiers ORDER BY tier').all().map((r: any) => [r.tier, r.hours]),
    [['P1', 24], ['P2', 48], ['P3', 96]]);
  assert.throws(() => db.exec("UPDATE hq_support_sla_tiers SET hours = 0 WHERE tier = 'P1'"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO hq_support_sla_tiers (tier, hours, description) VALUES ('P4', 10, 'x')"), /CHECK/);
});

// ---- the category on a ticket ------------------------------------------------------

test('a ticket is filed with one of the eight categories, or none, and nothing else', async () => {
  const db = fresh();
  const base = { title: 'Seats', priority: 'high', type: 'task', description: 'd' };
  const ok = await call(db, FOUNDER, 'POST', '/api/tickets', { ...base, category: 'licence_seats' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const bad = await call(db, FOUNDER, 'POST', '/api/tickets', { ...base, category: 'Licence & seats' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /category must be one of: fund_administration, contracts/);
  const none = await call(db, FOUNDER, 'POST', '/api/tickets', base);
  assert.equal(none.status, 200);
  assert.deepEqual(db.prepare('SELECT title, category FROM tickets ORDER BY id').all().map((r: any) => r.category),
    ['licence_seats', null], 'a refused ticket was stored, or a ticket with none was given one');
});

test('PUT changes the category only when the body names it; alone it is a valid update; null clears it', async () => {
  const db = fresh();
  await call(db, FOUNDER, 'POST', '/api/tickets', { title: 'Bill', priority: 'low', type: 'task', category: 'billing' });
  const cat = () => (db.prepare('SELECT category, status FROM tickets WHERE id = 1').get() as any);
  const only = await call(db, FOUNDER, 'PUT', '/api/tickets/1', { category: 'contracts' });
  assert.equal(only.status, 200, JSON.stringify(only.body));
  assert.equal(cat().category, 'contracts');
  await call(db, FOUNDER, 'PUT', '/api/tickets/1', { status: 'in_progress' });
  assert.deepEqual([cat().category, cat().status], ['contracts', 'in_progress'], 'a status-only update touched the category');
  await call(db, FOUNDER, 'PUT', '/api/tickets/1', { status: 'open', category: 'onboarding' });
  assert.deepEqual([cat().category, cat().status], ['onboarding', 'open']);
  const bad = await call(db, FOUNDER, 'PUT', '/api/tickets/1', { category: 'Onboarding' });
  assert.equal(bad.status, 400);
  assert.equal(cat().category, 'onboarding');
  await call(db, FOUNDER, 'PUT', '/api/tickets/1', { category: null });
  assert.equal(cat().category, null);
  assert.equal((await call(db, FOUNDER, 'PUT', '/api/tickets/1', {})).status, 400, 'an empty update was accepted');
});

// ---- the SLA tier store ------------------------------------------------------------

test('only the Super Admin sets the tiers; the whole set is checked; each change is audited once', async () => {
  const db = fresh();
  assert.equal((await call(db, PLAIN_ADMIN, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(12, 48, 96))).status, 403);
  assert.equal((await call(db, FOUNDER, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(12, 48, 96))).status, 403);
  for (const [body, re] of [
    [TIERS(60, 48, 96), /P1 must not wait longer than P2/],
    [TIERS(24, 48, 0), /P3.hours must be a whole number from 1 to 720/],
    [TIERS(24, 48, 721), /P3.hours/],
    [TIERS(24, 48.5, 96), /P2.hours/],
    [{ tiers: { P1: { hours: 24, description: 'x' }, P2: { hours: 48, description: 'y' } } }, /tiers.P3 is missing/],
    [{ tiers: { ...TIERS(24, 48, 96).tiers, P2: { hours: 48, description: '  ' } } }, /P2.description/],
  ] as Array<[unknown, RegExp]>) {
    const r = await call(db, HOLDER, 'PUT', '/api/admin/hq-support/sla-tiers', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message ?? r.body.error, re);
  }
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs").get() as any).n, 0, 'a refused write was audited');
  assert.deepEqual(db.prepare('SELECT hours FROM hq_support_sla_tiers ORDER BY tier').all().map((r: any) => r.hours), [24, 48, 96]);

  const same = await call(db, HOLDER, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(24, 48, 96));
  assert.deepEqual([same.status, same.body.changed], [200, []]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs").get() as any).n, 0, 'a write that changed nothing was audited');

  const set = await call(db, HOLDER, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(36, 48, 96));
  assert.deepEqual([set.status, set.body.changed], [200, ['P1']]);
  assert.deepEqual(set.body.sla_policy.tiers.items.map((t: any) => [t.id, t.hours, t.due_soon_hours, t.updated_by_name]),
    [['P1', 36, 18, 'The Holder'], ['P2', 48, 24, null], ['P3', 96, 24, null]]);
  const logs = db.prepare("SELECT action, details, user_id FROM activity_logs").all() as any[];
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'hq_support.sla_tiers.update');
  assert.equal(logs[0].user_id, HOLDER);
  assert.deepEqual(JSON.parse(logs[0].details).changed, [{ tier: 'P1', hours: [24, 36], description: ['Money, access, or data at risk', 'Money, access, or data at risk'] }]);
});

test('the queues band with the stored hours, and the taxonomy counts the eight categories', async () => {
  const db = fresh();
  const t = db.prepare(`INSERT INTO tickets (id, title, status, priority, category, user_id, created_at) VALUES (?, 't', ?, ?, ?, ?, ?)`);
  const at = (h: number) => new Date(Date.now() - h * H).toISOString().replace('T', ' ').slice(0, 19);
  t.run(1, 'open', 'urgent', 'billing', FOUNDER, at(30));        // P1, 30h old
  t.run(2, 'in_progress', 'high', 'billing', FOUNDER, at(10));   // P2
  t.run(3, 'open', 'low', null, FOUNDER, at(1));                 // filed before 333: none recorded
  t.run(4, 'resolved', 'low', 'other', FOUNDER, at(1));          // not open
  const item = (body: any, id: number) => Object.values(body.tickets.buckets).flatMap((b: any) => b.items).find((x: any) => x.id === id);

  const before = (await call(db, HOLDER, 'GET', '/api/admin/hq-support')).body;
  assert.equal(item(before, 1).sla_band, 'past', 'a 30-hour P1 was not past its 24 hours');
  assert.deepEqual(before.taxonomy.items.find((x: any) => x.category === 'billing'), { category: 'billing', label: 'Billing', open: 2 });
  assert.equal(before.taxonomy.items.length, 8);
  assert.equal(before.taxonomy.items.find((x: any) => x.category === 'other').open, 0, 'a ticket with no category, or a resolved one, counted as Other');
  assert.equal(before.taxonomy.uncategorised, 1);
  assert.equal(before.sla_policy.branch_copy.held, true);

  await call(db, HOLDER, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(36, 48, 96));
  const after = (await call(db, HOLDER, 'GET', '/api/admin/hq-support')).body;
  assert.equal(item(after, 1).sla_band, 'due_soon', 'the queue did not band with the stored P1 hours');
  assert.deepEqual(after.tickets.buckets.hq_held.bands, { ok: 2, due_soon: 1, past: 0, undated: 0 });
});

test('an unreadable store bands no ticket, and says why, rather than falling back to the seed', async () => {
  const db = fresh(false);
  db.prepare(`INSERT INTO tickets (id, title, status, priority, user_id, created_at) VALUES (1, 't', 'open', 'urgent', ?, datetime('now', '-30 hours'))`).run(FOUNDER);
  const r = await call(db, HOLDER, 'GET', '/api/admin/hq-support');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.sla_policy.tiers.available, /migration 333/.test(r.body.sla_policy.tiers.reason)], [false, true]);
  assert.equal(r.body.tickets.buckets.hq_held.items[0].sla_band, null, 'a ticket was banded against hours nobody read');
  assert.equal(r.body.tickets.buckets.hq_held.bands, null);
  assert.equal(r.body.tickets.buckets.hq_held.count, 1, 'the queue itself was lost with the store');
  const put = await call(db, HOLDER, 'PUT', '/api/admin/hq-support/sla-tiers', TIERS(24, 48, 96));
  assert.deepEqual([put.status, put.body.error], [503, 'sla_tiers_unreadable']);
  // A store missing a tier cannot band that tier's tickets: it reads as incomplete.
  const partial = fresh();
  partial.exec("DELETE FROM hq_support_sla_tiers WHERE tier = 'P2'");
  const p = (await call(partial, HOLDER, 'GET', '/api/admin/hq-support')).body;
  assert.equal(p.sla_policy.tiers.available, false, 'a store missing P2 was served as whole');
  assert.match(p.sla_policy.tiers.reason, /missing a tier/);
});
