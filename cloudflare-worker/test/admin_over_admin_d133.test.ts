/**
 * D133 — the admin-over-admin reach D132 left behind.
 *
 * WHAT THIS GUARDS, AND WHY IT IS A SEPARATE FILE FROM D132's.
 * `monitoring_analytics.ts`'s header, shipped in D132, states the rule that
 * decides all of this: *"a route that reaches `admin_audit_log a LEFT JOIN
 * users u` is a cross-admin read whatever it renders, and gating some of them
 * is gating none of them."* That pass applied the rule inside one file. Four
 * surfaces outside it were the same claim and were missed:
 *
 *   1. `POST /impersonate/:userId` — the only target check was
 *      `isSuperAdmin(target) && !isSuperAdmin(caller)`, so a plain admin could
 *      TAKE OVER a peer's session. Strictly worse than reading their record,
 *      and it sat one route away from the `toggle-active` fix D132 shipped.
 *   2. `GET /users/:user_id/profile` — no role check on the target at all, and
 *      it returns the target's last 100 `activity_logs` matched on
 *      `user_id OR actor`: pointed at a peer, that admin's own ACTOR-side feed.
 *   3. `GET /cohort/impersonation-audit` — `impersonation_sessions` joined to
 *      `users` twice, for actor and target names. The D132 shape, one file over.
 *   4. `moveAccountOut` — the RPC deactivates by id with no role check; only
 *      its HQ route's `requireSuperAdmin` stood in the way, and an entrypoint
 *      is "callable by any Worker in the account".
 *
 * AND THE CEILING THAT WAS NEVER THERE. "Only one super admin exists" was
 * migration 207's one-shot `DELETE` plus a sentence in a React component.
 * `POST /super-admins/:userId` counted nothing, so a holder could elevate a
 * second, a third, an nth.
 *
 * EVERY REFUSAL HAS A COMPANION. A gate that refuses everybody is not a gate:
 * each test that proves a plain admin is stopped is paired with one proving the
 * super admin is not, and with one proving an ORDINARY target still works —
 * because the claim is "no peer", not "no impersonation".
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_over_admin_d133.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import admin from '../src/routes/admin.ts';
import adminCohort from '../src/routes/admin_cohort.ts';
import superAdmins from '../src/routes/admin_super_admins.ts';
import { moveAccountOut } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ_SECRET = 'hq-rpc-secret-value-for-tests';
const SUPER = 1;        // HQ — the one elevated account
const PLAIN = 2;        // a subsidiary admin
const OTHER_ADMIN = 22; // another subsidiary's admin — the target that must be safe
const MEMBER = 30;      // a founder — the control target, which must stay reachable
const REASON = 'cap table export is failing for them, ticket 4471';

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

const ERRORS = {
  Unauthorized: 401,
  'Admin required': 403,
  'Super admin required': 403,
  'HQ only': 403,
  'TOTP required': 403,
  step_up_required: 403,
} as Record<string, 401 | 403>;

function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  // The status comes from `app.onError` in index.ts, which is not in the chain
  // for a directly dispatched sub-app. Replicated so a refusal is not asserted
  // as a 500.
  a.onError((err: any, c) => {
    const s = ERRORS[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  return a;
}
const app = appFor(admin);
const cohort = appFor(adminCohort);
const holders = appFor(superAdmins);

/**
 * `user_sessions` carries what `requireFactor` and `requireStepUp` read — the
 * impersonation route is behind both, so a fixture without a TOTP session would
 * refuse for the WRONG reason and prove nothing about the new guard.
 */
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT,
      -- The columns the profile drawer's own SELECT names. A fixture narrower
      -- than the handler would fail on the schema before reaching the guard,
      -- which is a refusal for the wrong reason and proves nothing.
      uid TEXT, email_verified INTEGER, founder_id INTEGER, partner_id INTEGER,
      kyc_status TEXT, kyc_provider TEXT, kyc_submitted_at TEXT, kyc_reviewed_at TEXT,
      kyc_rejection_reason TEXT, admin_notes TEXT, founder_public_id TEXT,
      partner_public_id TEXT, last_active_at TEXT, created_at TEXT
    );
    CREATE TABLE super_admins (
      user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT
    );
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    -- audit() writes here on every grant, revoke and transfer. Without it the
    -- refusal tests would still pass (they return before the audit) while the
    -- ones that SUCCEED would fail on the schema — so the table is what lets a
    -- success be asserted as a success.
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      filters_json TEXT, exported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  u.run(OTHER_ADMIN, 'admin', 'Otto', 'otto@axal.example');
  u.run(MEMBER, 'founder', 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN, OTHER_ADMIN]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  a: any, e: any, actor: number, path: string, method = 'GET', json?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(actor)}` };
  if (json) headers['content-type'] = 'application/json';
  const res = await a.request(
    path, { method, headers, body: json ? JSON.stringify(json) : undefined }, e,
  );
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const imp = (id: number) => `/impersonate/${id}?context=${encodeURIComponent(REASON)}`;

/* ------------------------------------------------------------------ *
 * 1. Impersonation — taking over a peer's session                     *
 * ------------------------------------------------------------------ */

test('a subsidiary admin cannot open a support session as another admin', async () => {
  const db = freshDb();
  const { status, body } = await call(app, env(db), PLAIN, imp(OTHER_ADMIN), 'POST');
  assert.equal(status, 403, 'a plain admin took over another admin\'s session');
  assert.equal(body?.code, 'super_admin_required');
});

test('the super admin can — supervising an admin is the tier\'s job', async () => {
  const db = freshDb();
  const { status } = await call(app, env(db), SUPER, imp(OTHER_ADMIN), 'POST');
  assert.notEqual(status, 403,
    'the guard stopped HQ, which is worse than the hole it closes');
});

test('the holder-vs-holder refusal still answers first, in its own words', async () => {
  // The new guard would refuse this too — a holder is also `role = 'admin'` —
  // so merging them would have cost the operator the sentence that says WHICH
  // line they crossed. Specific first, general second.
  const db = freshDb();
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(OTHER_ADMIN);
  const { status, body } = await call(app, env(db), PLAIN, imp(OTHER_ADMIN), 'POST');
  assert.equal(status, 403);
  assert.equal(body?.code, 'cannot_impersonate_super_admin',
    'the specific refusal was swallowed by the general one');
});

test('an ORDINARY target is still impersonable by a subsidiary admin', async () => {
  // The control. The claim is "no peer", not "no impersonation" — a guard that
  // stopped support entirely would pass every refusal test above.
  const db = freshDb();
  const { status } = await call(app, env(db), PLAIN, imp(MEMBER), 'POST');
  assert.notEqual(status, 403,
    'a subsidiary admin lost support access to their own territory\'s members');
});

/* ------------------------------------------------------------------ *
 * 2. The profile drawer — a peer's own activity feed                  *
 * ------------------------------------------------------------------ */

test('a subsidiary admin cannot open another admin\'s record', async () => {
  const db = freshDb();
  const { status, body } = await call(app, env(db), PLAIN, `/users/${OTHER_ADMIN}/profile`);
  assert.equal(status, 403, 'a plain admin read another admin\'s activity feed');
  assert.equal(body?.code, 'super_admin_required');
});

test('the super admin can open an admin\'s record', async () => {
  const db = freshDb();
  const { status } = await call(app, env(db), SUPER, `/users/${OTHER_ADMIN}/profile`);
  assert.notEqual(status, 403);
});

test('an admin can still open their OWN record', async () => {
  // Reading your own drawer is not a cross-admin read, so the self case passes
  // ahead of the check rather than being carved out of it afterwards.
  const db = freshDb();
  const { status } = await call(app, env(db), PLAIN, `/users/${PLAIN}/profile`);
  assert.notEqual(status, 403, 'an admin was locked out of their own record');
});

test('a subsidiary admin still opens a MEMBER\'s record', async () => {
  const db = freshDb();
  const { status } = await call(app, env(db), PLAIN, `/users/${MEMBER}/profile`);
  assert.notEqual(status, 403,
    'a subsidiary admin lost the directory they are supposed to manage');
});

/* ------------------------------------------------------------------ *
 * 3. The impersonation audit — the D132 shape, one file over          *
 * ------------------------------------------------------------------ */

test('a subsidiary admin cannot read every admin\'s impersonation history', async () => {
  const db = freshDb();
  const { status } = await call(cohort, env(db), PLAIN, '/impersonation-audit');
  assert.equal(status, 403, 'a plain admin read which accounts every peer supported');
});

test('the super admin can still read the impersonation history', async () => {
  const db = freshDb();
  const { status } = await call(cohort, env(db), SUPER, '/impersonation-audit');
  assert.notEqual(status, 403,
    'the gate stopped HQ — supervision is the one thing it must not take away');
});

/* ------------------------------------------------------------------ *
 * 4. moveAccountOut — the control that was only the route's           *
 * ------------------------------------------------------------------ */

async function branchEnv(db: InstanceType<typeof DatabaseSync>) {
  return {
    DB: makeD1(db), JWT_SECRET, BRANCH_CODE: 'fr',
    HQ_RPC_SECRET_HASH: await sha256Hex(HQ_SECRET),
  } as any;
}

test('moveAccountOut refuses an ADMIN target inside the RPC, not only at the route', async () => {
  // An entrypoint is callable by any Worker in the account, so a control that
  // lives only on the HQ route is a control this function does not have.
  const db = freshDb();
  const e = await branchEnv(db);
  await assert.rejects(
    () => moveAccountOut(e, HQ_SECRET, {
      hq_actor_name: 'Sue Hart', target_user_id: OTHER_ADMIN,
      destination_code: 'dach', reason: REASON,
    } as any),
    /administers|administrator/i,
    'the RPC deactivated a branch\'s own administrator',
  );
  assert.equal(
    (db.prepare('SELECT is_active FROM users WHERE id = ?').get(OTHER_ADMIN) as any)?.is_active,
    1, 'the refusal still wrote the deactivation',
  );
});

test('moveAccountOut still moves an ordinary account', async () => {
  const db = freshDb();
  await moveAccountOut(await branchEnv(db), HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: MEMBER,
    destination_code: 'dach', reason: REASON,
  } as any);
  assert.equal(
    (db.prepare('SELECT is_active FROM users WHERE id = ?').get(MEMBER) as any)?.is_active,
    0, 'the guard stopped an ordinary move, which is the feature',
  );
});

/* ------------------------------------------------------------------ *
 * 5. One super admin, enforced rather than asserted                   *
 * ------------------------------------------------------------------ */

test('a second super admin cannot be elevated while one holds the platform', async () => {
  const db = freshDb();
  const { status, body } = await call(holders, env(db), SUPER, `/${OTHER_ADMIN}`, 'POST');
  assert.equal(status, 409, 'the platform now has two super admins');
  assert.equal(body?.code, 'super_admin_exists');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM super_admins').get() as any)?.n, 1,
    'a second holder row was written',
  );
});

test('the holder can TRANSFER it, and the set is never two nor empty', async () => {
  // THIS TEST EXISTS BECAUSE A MUTATION CAUGHT THE CEILING BEING A WALL.
  // Its first version revoked SUPER's row and then asserted the grant was not
  // refused — which passed for the wrong reason: a caller with no elevation is
  // stopped by `requireWriteBar` with 403, and 403 is not 409. It proved
  // nothing, and it hid the real defect: with one holder, revoke refuses three
  // ways, so a bare ceiling freezes the elevation forever.
  const db = freshDb();
  // D221 — the transfer carries its reason; without one it is refused before
  // anything moves (asserted in `hq_team_actions_d221.test.ts`).
  const { status, body } = await call(
    holders, env(db), SUPER, `/${OTHER_ADMIN}?transfer=1`, 'POST',
    { reason: 'Sue hands HQ to Otto for the autumn cohort' },
  );
  assert.equal(status, 200, 'the holder could not hand the platform on');
  assert.equal(body?.transferred_from, SUPER);
  const rows = db.prepare('SELECT user_id FROM super_admins ORDER BY user_id').all() as any[];
  assert.deepEqual(rows.map((r) => r.user_id), [OTHER_ADMIN],
    'a transfer left the set at something other than exactly the successor');
});

test('a transfer is refused to anyone who is not the current holder', async () => {
  // AND THE CONTROL THAT DOES IT IS THE WRITE BAR, NAMED RATHER THAN ASSUMED.
  // A mutation showed the transfer branch's own identity conjunct was dead:
  // `requireWriteBar` refuses a non-holder long before the ceiling is reached,
  // so the status here is 403 and not 409. Asserting the exact status is what
  // stops this test passing for a reason it does not state.
  const db = freshDb();
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)')
    .run(41, 'admin', 'Third', 'third@axal.example');
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
     VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
  ).run(41, 'totp-41');
  // PLAIN is not the holder, so even with the flag this must not move anything.
  const { status } = await call(holders, env(db), PLAIN, `/41?transfer=1`, 'POST');
  assert.equal(status, 403,
    'a non-holder reached the transfer branch — the write bar is what must stop them');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM super_admins').get() as any)?.n, 1,
    'the holder set changed on a refused transfer',
  );
});
