/**
 * D120 — the cross-host support session, and the four ways it fails silently.
 *
 * WHAT IS BEING GUARDED. HQ opens a session as an arbitrary user on a branch it
 * cannot otherwise reach. Every assertion here exists because the failure it
 * catches produces a WORKING feature that is wrong, not a broken one:
 *
 *   1. THE AUTHENTICATION IS THE WHOLE CONTROL. `rpc/index.ts` says an
 *      entrypoint is "callable by any Worker in the account". Drop
 *      `authenticateHq` and the feature still works perfectly — for anybody.
 *      An absent `HQ_RPC_SECRET_HASH` must refuse rather than default open,
 *      because a null there means the leg was never provisioned, which is
 *      exactly when a default-open turns the control off unnoticed.
 *   2. SINGLE USE HAS TO BE ATOMIC. A read-then-write leaves a window where two
 *      redeems of one code both succeed, and both sessions look legitimate.
 *   3. THE EXPIRY HAS TO COMPARE LIKE WITH LIKE. This one caught a real defect
 *      while it was being written: an ISO `expires_at` compared against
 *      `CURRENT_TIMESTAMP` is TEXT comparison between two different formats,
 *      and 'T' > ' ', so an expired code reads as live until the UTC date rolls
 *      over. The five-minute TTL would have been a one-day TTL.
 *   4. THE ID SPACES DO NOT MEET. HQ's user ids and a branch's are unrelated
 *      numbers. Anything stored here that could be JOINed to local `users` will
 *      eventually name the wrong person with complete confidence, which is the
 *      rule `admin_escalations.ts:77-80` already states for the other direction.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/support_session_d120.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { decodeJwt } from 'jose';

import {
  authenticateHq, openSupportSession, redeemSupportCode,
  SUPPORT_REASON_MIN, SUPPORT_SESSION_MINUTES,
} from '../src/rpc/branchOps.ts';
import { verifySecret, sha256Hex } from '../src/rpc/secret.ts';
import { pickAuthToken } from '../src/auth.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIG_262 = read('cloudflare-worker/sql/migrations/262_support_handoff_codes.sql');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ_SECRET = 'hq-rpc-secret-value-for-tests';
const TARGET = 42;
const ELEVATED = 43;
const DORMANT = 44;

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

/** A branch database with the one account HQ will support. */
function branchDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT,
                                factor TEXT, assurance_level TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
                                actor TEXT, user_id INTEGER);
  `);
  db.exec(MIG_262);
  const u = db.prepare('INSERT INTO users (id, role, is_active, name, email) VALUES (?,?,?,?,?)');
  u.run(TARGET, 'founder', 1, 'Remy Blanc', 'remy@fr.example');
  u.run(ELEVATED, 'admin', 1, 'Odd Row', 'odd@fr.example');
  u.run(DORMANT, 'founder', 0, 'Gone Away', 'gone@fr.example');
  // The state D106 calls out: a `super_admins` row on a BRANCH database, which
  // `hydrateSuperAdmin` reports as 0 there by construction. The guard has to
  // read the table itself or it can never fire.
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ELEVATED);
  return db;
}

/** `env` for a branch, with the HQ leg provisioned unless told otherwise. */
async function branchEnv(db: InstanceType<typeof DatabaseSync>, opts: { hash?: string | null } = {}) {
  const hash = opts.hash === undefined ? await sha256Hex(HQ_SECRET) : opts.hash;
  return {
    DB: makeD1(db),
    JWT_SECRET,
    BRANCH_CODE: 'fr',
    ...(hash === null ? {} : { HQ_RPC_SECRET_HASH: hash }),
  } as any;
}

const REASON = 'Founder cannot open their data room, ticket 4471';

/* ------------------------------------------------------------------ *
 * 1. The authentication leg                                           *
 * ------------------------------------------------------------------ */

test('the shared verifier names its three refusals apart', async () => {
  const hash = await sha256Hex(HQ_SECRET);
  assert.equal(await verifySecret(HQ_SECRET, hash), 'ok');
  assert.equal(await verifySecret('wrong', hash), 'mismatch');
  assert.equal(await verifySecret('', hash), 'no_secret');
  // A VERIFIER THAT CANNOT ASK MUST NOT SAY YES. Both spellings of "no hash"
  // answer the same way — null from a column, undefined from an unset secret.
  assert.equal(await verifySecret(HQ_SECRET, null), 'no_hash');
  assert.equal(await verifySecret(HQ_SECRET, undefined), 'no_hash');
  assert.equal(await verifySecret(HQ_SECRET, '   '), 'no_hash');
});

test('authenticateHq accepts the right secret and refuses everything else', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  assert.equal(await authenticateHq(env, HQ_SECRET), 'fr');
  await assert.rejects(() => authenticateHq(env, 'not-the-secret'), /wrong secret/);
  await assert.rejects(() => authenticateHq(env, ''), /no secret/);
});

test('a branch with NO hash refuses rather than defaulting open', async () => {
  const db = branchDb();
  const env = await branchEnv(db, { hash: null });
  // The message names what is missing: an operator reading it should reach for
  // the provisioning run, not for a branch they think is down.
  await assert.rejects(() => authenticateHq(env, HQ_SECRET), /HQ_RPC_SECRET_HASH/);
  // And the secret being correct changes nothing — there is nothing to check it
  // against, which is the point.
  await assert.rejects(() => openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: TARGET, reason: REASON,
  }), /HQ_RPC_SECRET_HASH/);
});

test('authenticateHq refuses on HQ, where the entrypoint is not live', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  delete env.BRANCH_CODE;
  await assert.rejects(() => authenticateHq(env, HQ_SECRET), /only live on a branch/);
});

/* ------------------------------------------------------------------ *
 * 2. What the branch checks for itself                                *
 * ------------------------------------------------------------------ */

test('the reason is enforced on the branch, not only at HQ', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(() => openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: TARGET, reason: 'too short',
  }), new RegExp(`at least ${SUPPORT_REASON_MIN} characters`));
  // Nothing was written: a refused authorisation must not leave a usable code.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_handoff_codes').get().n, 0);
});

test('an unknown, dormant or elevated target is refused', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const open = (target: number) => openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: target, reason: REASON,
  });
  await assert.rejects(() => open(9999), /holds no account/);
  await assert.rejects(() => open(DORMANT), /deactivated/);
  // THE GUARD THAT COULD NOT FIRE IF IT ASKED `isSuperAdmin`. On a branch
  // `hydrateSuperAdmin` returns 0 unconditionally (D106), so this has to read
  // `super_admins` directly — and a row there is a state to investigate.
  await assert.rejects(() => open(ELEVATED), /super_admins row/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_handoff_codes').get().n, 0);
});

test('an authorisation stores the DIGEST of the code, never the code, and no token', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', hq_actor_ref: '7', target_user_id: TARGET, reason: REASON,
  });
  assert.match(offer.code, /^[0-9a-f]{48}$/, 'the code is not 192 bits of hex');
  assert.equal(offer.branch, 'fr');
  assert.equal(offer.target.id, TARGET);

  const row = db.prepare('SELECT * FROM support_handoff_codes').get() as any;
  assert.equal(row.code_hash, await sha256Hex(offer.code));
  assert.notEqual(row.code_hash, offer.code, 'the raw code is in the table');
  // A READ OF THIS TABLE MUST NOT AUTHENTICATE ANYBODY. No column may carry the
  // code or a session, so the row is evidence and never a credential.
  const columns = Object.keys(row);
  assert.ok(!columns.includes('token'), 'a token column exists on the hand-off table');
  for (const [k, v] of Object.entries(row)) {
    assert.notEqual(v, offer.code, `${k} carries the raw code`);
  }
  // The actor is a NAME. `hq_actor_ref` is HQ's id as opaque text and is never
  // joined — asserted as TEXT so a later "tidy" to INTEGER, which would invite
  // a JOIN, fails here.
  assert.equal(row.hq_actor_name, 'Sue Hart');
  assert.equal(typeof row.hq_actor_ref, 'string');
  assert.equal(row.reason, REASON);

  // The authorisation is audited on its own, so a code requested and never used
  // is visible as exactly that.
  const logged = db.prepare("SELECT * FROM activity_logs WHERE action = 'hq_support_authorised'").all();
  assert.equal(logged.length, 1);
});

/* ------------------------------------------------------------------ *
 * 3. Redeem: single use, expiry, and the session it mints             *
 * ------------------------------------------------------------------ */

test('redeeming mints a session whose factor closes every TOTP door', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: TARGET, reason: REASON,
  });
  const session = await redeemSupportCode(env, offer.code);

  assert.equal(session.target.id, TARGET);
  assert.equal(session.hq_actor_name, 'Sue Hart');
  assert.equal(session.reason, REASON);

  const claims = decodeJwt(session.token) as any;
  assert.equal(Number(claims.user_id), TARGET);
  assert.equal(claims.jti, session.jti);
  // NO `impersonated_by`. The only id HQ could put there is an HQ id, which on
  // this database names whoever holds that number. Every consumer was checked:
  // none needs a resolvable id, and none is improved by a wrong one.
  assert.equal(claims.impersonated_by, undefined,
    'the branch token carries an HQ user id that resolves to a local stranger');
  // Thirty minutes, not the ordinary session length.
  assert.ok((claims.exp - claims.iat) <= SUPPORT_SESSION_MINUTES * 60 + 5,
    'the support session outlives its 30-minute limit');

  // `factor` IS THE GATE, NOT A LABEL: `requireFactor` reads this column by jti
  // and fails closed, so a support session satisfies `requireFactor('totp')`
  // nowhere. Change this value and every TOTP-gated branch route opens to HQ.
  const sess = db.prepare('SELECT * FROM user_sessions WHERE jti = ?').get(session.jti) as any;
  assert.equal(sess.factor, 'hq_support');
  assert.notEqual(sess.factor, 'totp');
  assert.equal(sess.user_id, TARGET);

  // The impersonation row: admin_user_id 0, because nobody in THIS database
  // opened it, and AUTOINCREMENT starts at 1 so 0 can never collide.
  const imp = db.prepare('SELECT * FROM impersonation_sessions').get() as any;
  assert.equal(imp.admin_user_id, 0, 'an HQ user id was written where a local id would be read');
  assert.equal(imp.target_user_id, TARGET);
  assert.match(imp.context, /^hq_support:Sue Hart\|/);

  const opened = db.prepare("SELECT * FROM activity_logs WHERE action = 'hq_support_session_opened'").all();
  assert.equal(opened.length, 1);
});

test('a code is single use — the second redeem refuses and mints nothing', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: TARGET, reason: REASON,
  });
  await redeemSupportCode(env, offer.code);
  await assert.rejects(() => redeemSupportCode(env, offer.code), /not valid/);
  // One session, not two. The claim is the UPDATE itself, so a second caller
  // loses the race rather than reading a row that is about to change.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM impersonation_sessions').get().n, 1);
});

test('an EXPIRED code refuses — the comparison must not be format-blind', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: TARGET, reason: REASON,
  });
  // AGE THE ROW IN WHATEVER FORMAT THE WRITER CHOSE. The first version of this
  // test overwrote `expires_at` with `datetime('now','-1 minute')` outright,
  // which forced the SQLite format on to the row no matter what the code had
  // written — so it proved the comparison side and was blind to the write side,
  // and the exact bug it exists for walked straight through it. Reading the
  // stored value and ageing it in kind is what makes the assertion able to
  // fail: an ISO writer now yields an ISO past value, compared as TEXT against
  // a space-separated one, which reads as LIVE and redeems.
  const stored = String((db.prepare('SELECT expires_at FROM support_handoff_codes').get() as any).expires_at);
  const aged = /T/.test(stored)
    ? new Date(Date.parse(stored) - 3_600_000).toISOString()
    : (db.prepare("SELECT datetime('now', '-1 hour') AS v").get() as any).v;
  db.prepare('UPDATE support_handoff_codes SET expires_at = ?').run(aged);

  // SAME UTC DAY, deliberately: the broken comparison only misbehaves until the
  // date rolls over, so a test that aged the row by a day would pass either way.
  assert.equal(aged.slice(0, 10), stored.slice(0, 10), 'the ageing crossed a UTC day');

  await assert.rejects(() => redeemSupportCode(env, offer.code), /not valid/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
});

test('an unknown code refuses, and says no more than that', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(
    () => redeemSupportCode(env, 'f'.repeat(48)),
    (e: Error) => {
      // ONE MESSAGE FOR ALL THREE FAILURE MODES. Telling "expired" from "never
      // existed" tells an unauthenticated caller which codes have been issued.
      assert.match(e.message, /not valid/);
      assert.ok(!/expired|used|unknown/i.test(e.message), 'the refusal distinguishes failure modes');
      return true;
    },
  );
  await assert.rejects(() => redeemSupportCode(env, ''), /no code/);
});

test('a target deactivated between authorisation and redeem is refused', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: TARGET, reason: REASON,
  });
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(TARGET);
  await assert.rejects(() => redeemSupportCode(env, offer.code), /no longer active/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
});

/* ------------------------------------------------------------------ *
 * 4. The precedence trap the redeem route exists to avoid             *
 * ------------------------------------------------------------------ */

test('pickAuthToken arbitrates by an equality that means nothing across id spaces', () => {
  // At HQ these two ids name the same human, which is what makes the rule
  // sound there. On a branch they are unrelated numbers, so BOTH outcomes are
  // reached by accident:
  //   ids collide  -> 'bearer', the right answer for the wrong reason;
  assert.equal(pickAuthToken({ bearer: { user_id: 42, impersonated_by: 7 }, cookie: { user_id: 7 } }), 'bearer');
  //   ids differ   -> 'cookie', and the support session silently does not apply.
  assert.equal(pickAuthToken({ bearer: { user_id: 42, impersonated_by: 9 }, cookie: { user_id: 7 } }), 'cookie');
  // Which is why the branch token carries no `impersonated_by` at all and the
  // redeem route leaves only one candidate in the jar. With no cookie there is
  // nothing to arbitrate and the answer cannot depend on a coincidence.
  assert.equal(pickAuthToken({ bearer: { user_id: 42 }, cookie: null }), 'bearer');
});

test('the redeem route clears the other identity and sets this branch\'s cookies', () => {
  const src = read('cloudflare-worker/src/routes/auth.ts');
  const at = src.indexOf("auth.post('/support/redeem'");
  assert.ok(at > 0, 'the redeem route is gone');
  // Bounded to this handler so a NEIGHBOURING sign-in path's calls cannot
  // satisfy it — every one of them makes the same two calls.
  const handler = src.slice(at, at + 3200);
  assert.match(handler, /revokeStaleCrossIdentitySession\(c, session\.target\.id\)/,
    'redeem leaves a competing branch session in the jar, so pickAuthToken decides by coincidence');
  assert.match(handler, /setAuthCookies\(c, session\.token, csrf\)/);
  // A token must never be handed back in a redirect or a link from here.
  assert.ok(!/redirect\(/.test(handler), 'the redeem route redirects, which risks a token in a URL');
});

test('HQ refuses to redeem: the hand-off belongs to the branch it was opened for', () => {
  const src = read('cloudflare-worker/src/routes/auth.ts');
  const at = src.indexOf("auth.post('/support/redeem'");
  const handler = src.slice(at, at + 3200);
  assert.match(handler, /hq_only_surface/);
  assert.match(handler, /const code = branchOf\(c\.env\)/);
});
