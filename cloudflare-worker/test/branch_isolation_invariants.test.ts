/**
 * D132 — HQ's supervision reaches exactly one account's worth, and no further.
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT REPEAT.
 * The tier model D132 records has two halves: HQ supervises every subsidiary,
 * and no subsidiary sees another's data. Most of the second half is already
 * pinned elsewhere and must not be pinned twice — a second copy of an
 * assertion is a second thing to update, and the one that goes stale is
 * whichever the next change misses:
 *
 *   · `branch_mode_gates.test.ts` — a `super_admins` ROW does not make a
 *     branch admin a super admin; `hydrateSuperAdmin` does not read the table
 *     on a branch at all; `requireSuperAdmin` says "HQ only" there; both
 *     refusals map to 403 through the constant; `assertBranchAppUrl`.
 *   · `branch_cookies.test.ts` — `branchOf` (unset is HQ, a malformed code
 *     THROWS rather than reading as HQ); host-only cookies whose names carry
 *     the branch code; passkey origins narrowed to the branch's own host.
 *   · `support_session_d120.test.ts` — the authentication leg, single use,
 *     the expiry format, and the SHAPE of what redeem writes.
 *
 * WHAT IS LEFT, AND IT IS THE ONE THAT MATTERS MOST. D120 writes
 * `user_sessions.factor = 'hq_support'` and its comment says that value "is a
 * real gate, not a label" because `requireFactor` reads the column and fails
 * closed. `support_session_d120.test.ts:252` asserts the STRING is written.
 * That is not the same claim: it would pass unchanged if `requireFactor`
 * stopped reading the column, if `selectJwt` stopped resolving the jti, or if
 * the session row stopped being found — every one of which opens every
 * TOTP-gated branch route to HQ while the column still reads `hq_support`.
 * A guard that pins a spelling has now walked through a correct change three
 * times in this programme; this one asks the gate instead.
 *
 * BOTH DIRECTIONS, because a refusal that refuses everybody is not a gate:
 * the same `requireFactor` on the same branch admits an ordinary TOTP session
 * minutes later, and the support session carries the TARGET's own reach —
 * a founder target cannot pass `requireAdmin`, a plain admin target can.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_isolation_invariants.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { openSupportSession, redeemSupportCode } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';
import {
  createJWT, requireFactor, requireStepUp, requireAdmin, getCurrentUser,
} from '../src/auth.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIG_262 = readFileSync(
  resolve(ROOT, 'cloudflare-worker/sql/migrations/262_support_handoff_codes.sql'), 'utf8',
);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ_SECRET = 'hq-rpc-secret-value-for-tests';
const FOUNDER = 42;
const BRANCH_ADMIN = 45;
const REASON = 'Founder cannot open their data room, ticket 4471';

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
  };
}

/**
 * A branch database with two accounts HQ might support.
 *
 * `user_sessions` carries the columns `getCurrentUser`, `requireFactor` and
 * `requireStepUp` actually read — `revoked_at` and `step_up_due_at` gate the
 * session at all, `created_at` and `last_step_up_at` decide a step-up. A
 * fixture missing one of them would send the reader down a fallback path and
 * prove something about the fallback instead.
 */
function branchDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        name TEXT, email TEXT, jwt_min_iat INTEGER);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT,
                                factor TEXT, assurance_level TEXT, revoked_at TEXT,
                                step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT,
                                created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
                                actor TEXT, user_id INTEGER);
  `);
  db.exec(MIG_262);
  const u = db.prepare('INSERT INTO users (id, role, is_active, name, email) VALUES (?,?,?,?,?)');
  u.run(FOUNDER, 'founder', 1, 'Remy Blanc', 'remy@fr.example');
  // A PLAIN branch admin — no `super_admins` row, so D120 will open a session
  // as them. That is the ordinary case the RPC's own comment names: at this
  // boundary there is nobody above HQ, so supporting a branch's administrator
  // is support, not a privilege grab.
  u.run(BRANCH_ADMIN, 'admin', 1, 'Claire Devaux', 'claire@fr.example');
  return db;
}

async function branchEnv(db: InstanceType<typeof DatabaseSync>) {
  return {
    DB: makeD1(db),
    JWT_SECRET,
    BRANCH_CODE: 'fr',
    HQ_RPC_SECRET_HASH: await sha256Hex(HQ_SECRET),
  } as any;
}

/** A Hono-shaped context carrying one Bearer, on the shape `auth_cross_identity_integration.test.ts` uses. */
function ctxFor(env: any, token: string, path = '/api/admin/users') {
  return {
    env,
    req: {
      header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
      path,
    },
  } as any;
}

/** Open and redeem in one step — every test here starts from a live session. */
async function support(env: any, targetId: number) {
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: targetId, reason: REASON,
  } as any);
  return redeemSupportCode(env, (offer as any).code);
}

/** An ordinary TOTP session for the same account, minted the way sign-in does. */
async function totpSession(env: any, db: InstanceType<typeof DatabaseSync>, userId: number, role: string) {
  const jti = `totp-${userId}-${role}`;
  const token = await createJWT(env, userId, `${userId}@fr.example`, role, undefined, jti);
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
  ).run(userId, jti);
  return token;
}

/* ------------------------------------------------------------------ *
 * The narrowing, asked of the gate rather than read off the column    *
 * ------------------------------------------------------------------ */

test('requireFactor REFUSES a support session — the gate, not the column value', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const session = await support(env, FOUNDER);

  await assert.rejects(
    () => requireFactor(ctxFor(env, session.token), 'totp'),
    /TOTP required/,
    'HQ\'s support session satisfied a TOTP gate — every step-up route on this branch is open to it',
  );
});

test('the same gate ADMITS an ordinary TOTP session on the same branch', async () => {
  // Without this the refusal above proves nothing: a `requireFactor` that threw
  // for every caller, or a fixture whose session rows are never found, would
  // pass it just as well. The pair is the assertion.
  const db = branchDb();
  const env = await branchEnv(db);
  const token = await totpSession(env, db, FOUNDER, 'founder');

  const user = await requireFactor(ctxFor(env, token), 'totp');
  assert.equal(Number(user.id), FOUNDER);
});

test('requireStepUp refuses the support session and admits a fresh TOTP one', async () => {
  // The stricter gate, and it fails for a second reason worth pinning
  // separately: `hq_support` is not in its strong-factor set, so no amount of
  // freshness makes a support session recent enough.
  const db = branchDb();
  const env = await branchEnv(db);
  const session = await support(env, FOUNDER);

  await assert.rejects(
    () => requireStepUp(ctxFor(env, session.token)),
    /step_up_required/,
    'a support session satisfied step-up, which is the gate above TOTP',
  );

  const fresh = await totpSession(env, db, FOUNDER, 'founder');
  const user = await requireStepUp(ctxFor(env, fresh));
  assert.equal(Number(user.id), FOUNDER);
});

/* ------------------------------------------------------------------ *
 * The other direction: supervision is real, and it is the target's    *
 * ------------------------------------------------------------------ */

test('the session authenticates as the TARGET, carrying their role and no elevation', async () => {
  // WHAT DECIDES THE ROLE, measured rather than assumed, because the first
  // mutation aimed at this assertion escaped and the escape was the useful
  // part. Rewriting `createJWT(…, target.role, …)` to mint 'admin' changed
  // nothing here: `getCurrentUser` does `SELECT * FROM users WHERE id =
  // payload.user_id` and hands back the ROW. The `role` claim in the token is
  // never read for authorisation, so a wrong one cannot grant reach — the
  // branch's own users table decides, which is a stronger property than the
  // one this test was written expecting. What CAN break it is the token being
  // minted for a different id, and that is the mutation this now catches.
  const db = branchDb();
  const env = await branchEnv(db);
  const session = await support(env, FOUNDER);

  const user = await getCurrentUser(ctxFor(env, session.token));
  assert.ok(user, 'the support session did not authenticate at all — HQ cannot supervise');
  assert.equal(Number(user!.id), FOUNDER);
  assert.equal(user!.role, 'founder');
  assert.ok(!(user as any).is_super_admin, 'a support session arrived elevated');
});

test('supervision reaches exactly the target\'s own role — a founder is not an admin', async () => {
  const db = branchDb();
  const env = await branchEnv(db);

  // Supporting a founder gives founder reach. `requireAdmin` is the cheapest
  // true statement of "no more than the target's own": if the minted token
  // carried anything of HQ's, this is where it would show.
  const asFounder = await support(env, FOUNDER);
  await assert.rejects(
    () => requireAdmin(ctxFor(env, asFounder.token)),
    /Admin required/,
    'a session opened as a founder passed an admin gate',
  );

  // Supporting the branch's own administrator gives administrator reach, which
  // is the whole point — HQ supervising a subsidiary is a supported operation,
  // not a leak. This half is what a narrowing done too enthusiastically breaks.
  const asAdmin = await support(env, BRANCH_ADMIN);
  const admin = await requireAdmin(ctxFor(env, asAdmin.token));
  assert.equal(Number(admin.id), BRANCH_ADMIN);
  assert.equal(admin.role, 'admin');
});
