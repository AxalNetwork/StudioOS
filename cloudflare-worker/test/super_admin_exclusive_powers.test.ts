/**
 * The four powers that belong to the super admin alone (D132).
 *
 * THE TIER MODEL, stated by the product owner and pinned here so it is a fact
 * about the code rather than an intention: **one** super admin — HQ — and
 * **many** admins, each a subsidiary. HQ supervises all of them. A subsidiary
 * admin manages their own territory's members and never a peer's record.
 *
 * Two of the four powers already held and two did not, and the asymmetry is
 * what this file exists for:
 *
 *   · **Open** — `/users/:userId/role` already refuses to mint or demote an
 *     admin, for anyone, with its own stated reason: it *"prevents one admin
 *     from quietly silencing another."* Pinned, not changed.
 *   · **Ban / close** — `/users/:userId/toggle-active` carried ONLY a
 *     self-check. **Deactivating an admin silences them exactly as effectively
 *     as demoting one**, so the policy held on one route and was reachable on
 *     the next. That is the defect this closes.
 *   · **Supervise** — `/audit`, `/audit/export.csv` and `/exports/recent` read
 *     `admin_audit_log` joined to `users`, so a plain admin read every other
 *     admin's export history by name and email. All three raised to super
 *     admin. The third was not in the plan: it is the same join again, served
 *     as a 10,000-row download, and it turned up by reading the route file
 *     rather than the plan's summary of it.
 *   · **Supervise (session)** — already super-admin + TOTP + step-up, and it
 *     already refuses a target holding a `super_admins` row. Not touched here.
 *
 * THE SUPER ADMIN KEEPS EVERY ONE OF THEM. Each refusal test has a companion
 * that drives the same call as the elevated account and asserts it succeeds —
 * because a guard that also stopped HQ would be a worse bug than the one it
 * fixed, and a one-directional test would not notice.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/super_admin_exclusive_powers.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import admin from '../src/routes/admin.ts';
import monitoringAnalytics from '../src/routes/monitoring_analytics.ts';

const app = new Hono<any>();
app.route('/', admin);
// `requireAdmin` / `requireSuperAdmin` refuse by throwing; the status comes from
// `app.onError` in index.ts, which is not in the chain for a directly dispatched
// sub-app. Replicated so a refusal is not asserted as a 500.
app.onError((err: any, c) => {
  const status = ({
    Unauthorized: 401,
    'Admin required': 403,
    'Super admin required': 403,
    'HQ only': 403,
  } as Record<string, 401 | 403>)[String(err?.message || '')];
  if (status) return c.json({ detail: err.message }, status);
  throw err;
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;        // HQ — the one elevated account
const PLAIN = 2;        // a subsidiary admin
const OTHER_ADMIN = 22; // another subsidiary's admin — the target that must be safe
const MEMBER = 30;      // a founder in PLAIN's own territory — must stay manageable

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  u.run(OTHER_ADMIN, 'admin', 'Otto', 'otto@axal.example');
  u.run(MEMBER, 'founder', 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function toggleActive(
  e: any, actor: number, targetId: number,
): Promise<{ status: number; body: any }> {
  const res = await app.request(
    `/users/${targetId}/toggle-active`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${await token(actor)}` } },
    e,
  );
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const activeOf = (db: InstanceType<typeof DatabaseSync>, id: number): number =>
  Number((db.prepare('SELECT is_active FROM users WHERE id = ?').get(id) as any)?.is_active);

/* ------------------------------------------------------------------ *
 * BAN / CLOSE — the power that was not exclusive
 * ------------------------------------------------------------------ */

test('a subsidiary admin cannot deactivate another admin', async () => {
  // THE DEFECT, REPRODUCED. Before D132 this returned 200 and Otto was
  // deactivated — one admin silencing another, which is exactly what the role
  // route refuses to allow by demotion.
  const db = freshDb();
  const r = await toggleActive(env(db), PLAIN, OTHER_ADMIN);
  assert.equal(r.status, 403);
  assert.equal(r.body?.code, 'super_admin_required');
  assert.equal(activeOf(db, OTHER_ADMIN), 1,
    'the refusal must happen BEFORE the write — a 403 over a completed update is not a guard');
});

test('the super admin can deactivate an admin', async () => {
  // THE OTHER DIRECTION, AND IT IS NOT OPTIONAL. "The super admin has the
  // capacity to ban and close admin accounts" — a guard that also stopped HQ
  // would break the tier it exists to protect.
  const db = freshDb();
  const r = await toggleActive(env(db), SUPER, OTHER_ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body?.is_active, false);
  assert.equal(activeOf(db, OTHER_ADMIN), 0);
});

test('a subsidiary admin still manages their own territory\'s members', async () => {
  // THE LINE THE GUARD MUST NOT CROSS. *"Admins of subsidiaries should be able
  // to manage their own accounts under the supervision of the super admin."*
  // The guard tests the TARGET's role, so every non-admin account in the
  // deployment stays exactly as manageable as it was.
  const db = freshDb();
  const r = await toggleActive(env(db), PLAIN, MEMBER);
  assert.equal(r.status, 200, 'a founder is this admin\'s to manage; the guard is about admin targets');
  assert.equal(activeOf(db, MEMBER), 0);
});

test('the self-check survives, and it answers before the new guard', async () => {
  // An admin deactivating THEMSELVES is a different refusal with a different
  // reason, and it must not be swallowed by the admin-target check that now
  // sits beside it — both would match, and the one that reads correctly is
  // "Cannot deactivate yourself".
  const db = freshDb();
  const r = await toggleActive(env(db), PLAIN, PLAIN);
  assert.equal(r.status, 400);
  assert.match(String(r.body?.error), /yourself/i);
  assert.equal(activeOf(db, PLAIN), 1);
});

test('a super admin deactivating themselves is still refused', async () => {
  // The elevation does not buy a way to lock the platform out of its only
  // super admin. Same 400, same reason.
  const db = freshDb();
  const r = await toggleActive(env(db), SUPER, SUPER);
  assert.equal(r.status, 400);
  assert.match(String(r.body?.error), /yourself/i);
  assert.equal(activeOf(db, SUPER), 1);
});

test('reactivating an admin is the same power as deactivating one', async () => {
  // The route toggles, so the guard has to cover both directions or a peer
  // could quietly restore an account HQ closed.
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(OTHER_ADMIN);
  const refused = await toggleActive(env(db), PLAIN, OTHER_ADMIN);
  assert.equal(refused.status, 403, 'a peer must not reactivate an admin HQ closed');
  assert.equal(activeOf(db, OTHER_ADMIN), 0);

  const allowed = await toggleActive(env(db), SUPER, OTHER_ADMIN);
  assert.equal(allowed.status, 200);
  assert.equal(activeOf(db, OTHER_ADMIN), 1);
});

/* ------------------------------------------------------------------ *
 * OPEN — already exclusive; pinned so it stays that way
 * ------------------------------------------------------------------ */

test('minting an admin is refused for everyone, super admin included', async () => {
  // NOT A D132 CHANGE — a policy that predates it, pinned because the
  // toggle-active fix sits next to it and a later "consistency" pass might
  // decide the super admin should be allowed through here too. That would be a
  // product decision, not a tidy-up: today the only way to grant admin is SQL,
  // and the stated reason is blast radius of a compromised admin session.
  const db = freshDb();
  for (const actor of [PLAIN, SUPER]) {
    const res = await app.request(
      `/users/${MEMBER}/role?role=admin`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${await token(actor)}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
      env(db),
    );
    assert.equal(res.status, 403, `actor ${actor} must not mint an admin`);
    assert.equal((await res.json() as any)?.code, 'admin_promotion_disabled');
  }
  assert.equal(
    (db.prepare('SELECT role FROM users WHERE id = ?').get(MEMBER) as any)?.role,
    'founder',
  );
});

/* ------------------------------------------------------------------ *
 * SUPERVISE — the audit surface that was a second door
 * ------------------------------------------------------------------ */

/**
 * `monitoring_analytics` is its own router, so it gets its own app. The gate is
 * the FIRST line of each handler, before `ensureSchema` and before any query —
 * which is what lets a refusal be asserted against the same lightweight
 * fixture. A refusal that only happened after the read would have leaked the
 * rows it was meant to withhold.
 */
const mon = new Hono<any>();
mon.route('/', monitoringAnalytics);
mon.onError((err: any, c) => {
  const status = ({
    Unauthorized: 401,
    'Admin required': 403,
    'Super admin required': 403,
    'HQ only': 403,
  } as Record<string, 401 | 403>)[String(err?.message || '')];
  if (status) return c.json({ detail: err.message }, status);
  throw err;
});

async function getMon(e: any, actor: number, path: string): Promise<number> {
  const res = await mon.request(
    path, { headers: { Authorization: `Bearer ${await token(actor)}` } }, e,
  );
  return res.status;
}

// ALL THREE, because they are one query in three shapes. `/audit/export.csv`
// runs the identical join and returns up to 10,000 rows of it as a file — it
// was not in D132's plan and was found by reading the route file. Gating two
// of three would have left the largest of them open.
for (const path of ['/audit', '/audit/export.csv', '/exports/recent']) {
  test(`a subsidiary admin cannot read ${path} — it is other admins' activity`, async () => {
    // THE ROWS ARE THE POINT: `admin_audit_log a LEFT JOIN users u ON
    // u.id = a.admin_user_id`, so this read returns other admins by name and
    // email. Before D132 it answered 200 to any admin.
    const db = freshDb();
    assert.equal(await getMon(env(db), PLAIN, path), 403);
  });

  test(`the super admin can still read ${path}`, async () => {
    // Supervision is the tier's job; the gate must not take it away. Anything
    // other than 403 means the elevation got through — the handler may still
    // fail later on this fixture's schema, and that is not what is asserted.
    const db = freshDb();
    assert.notEqual(await getMon(env(db), SUPER, path), 403,
      'the super admin must pass the gate — a guard that stops HQ is worse than the leak');
  });
}
