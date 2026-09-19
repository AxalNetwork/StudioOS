/**
 * D121 — moving an account between branches, and the four ways it goes wrong
 * quietly.
 *
 *   1. AN UNAUTHENTICATED METHOD THAT DEACTIVATES ACCOUNTS. D120 closed exactly
 *      this hole for `openSupportSession`; these two are at least as privileged,
 *      so the same secret gates them and an absent hash refuses rather than
 *      defaulting open. Drop `authenticateHq` from either and the feature still
 *      works perfectly — for any Worker in the account.
 *   2. A MOVE THAT HAPPENS TWICE. The second run would write a second
 *      invitation on the destination and a second pair of audit rows for a
 *      person who left the first time, so an already-inactive target refuses.
 *   3. AN INVITATION NOBODY WAS TOLD ABOUT, REPORTED AS SENT. Every mailer in
 *      `services/email.ts` returns `false` when the Gmail credentials are unset
 *      rather than throwing, and a freshly provisioned branch has none. If
 *      `email_sent` did not record that, HQ would believe a person had been
 *      contacted who had not. Migration 236 states the rule; this asserts it.
 *   4. THE PERSON TOLD THE WRONG THING. An account told only that it was
 *      deactivated reads as suspended. Its audit row names the destination and
 *      says the records stay put, because D.6 is a re-invite and NOT a record
 *      migration — the one fact an operator is most likely to get wrong when
 *      explaining it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/account_move_d121.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { moveAccountOut, inviteAccount, MOVE_REASON_MIN } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIG_263 = read('cloudflare-worker/sql/migrations/263_branch_invitations.sql');

const HQ_SECRET = 'hq-rpc-secret-value-for-tests';
const MOVER = 51;
const GONE = 52;
const REASON = 'Founder relocated to the DACH territory, ticket 902';

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

function branchDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        name TEXT, email TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
                                actor TEXT, user_id INTEGER);
  `);
  db.exec(MIG_263);
  const u = db.prepare('INSERT INTO users (id, role, is_active, name, email) VALUES (?,?,?,?,?)');
  u.run(MOVER, 'founder', 1, 'Remy Blanc', 'remy@fr.example');
  u.run(GONE, 'founder', 0, 'Already Gone', 'gone@fr.example');
  return db;
}

/**
 * The DESTINATION branch: its own database, and it does NOT hold the person
 * being moved. That is not a convenience — it is what a destination is. The
 * first version of this file reused the source's fixture, which already had the
 * account active, and `inviteAccount` correctly refused; the test was wrong
 * about the world, not the code about the rule.
 */
function destinationDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        name TEXT, email TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
                                actor TEXT, user_id INTEGER);
  `);
  db.exec(MIG_263);
  return db;
}

async function branchEnv(db: InstanceType<typeof DatabaseSync>, opts: { hash?: string | null; code?: string } = {}) {
  const hash = opts.hash === undefined ? await sha256Hex(HQ_SECRET) : opts.hash;
  return {
    DB: makeD1(db),
    BRANCH_CODE: opts.code ?? 'fr',
    BRANCH_NAME: 'Axal VC France',
    APP_URL: 'https://fr.axal.vc',
    ...(hash === null ? {} : { HQ_RPC_SECRET_HASH: hash }),
  } as any;
}

const move = (env: any, over: Record<string, unknown> = {}) => moveAccountOut(env, HQ_SECRET, {
  hq_actor_name: 'Sue Hart', target_user_id: MOVER, reason: REASON, destination_code: 'dach', ...over,
} as any);

/* ------------------------------------------------------------------ *
 * 1. Both methods authenticate                                        *
 * ------------------------------------------------------------------ */

test('a wrong secret refuses both methods, and nothing is written', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(() => moveAccountOut(env, 'not-the-secret', {
    hq_actor_name: 'Sue Hart', target_user_id: MOVER, reason: REASON, destination_code: 'dach',
  }), /wrong secret/);
  await assert.rejects(() => inviteAccount(env, 'not-the-secret', {
    hq_actor_name: 'Sue Hart', email: 'new@dach.example',
  }), /wrong secret/);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get(MOVER).is_active, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM branch_invitations').get().n, 0);
});

test('a branch with NO hash refuses both rather than defaulting open', async () => {
  const db = branchDb();
  const env = await branchEnv(db, { hash: null });
  await assert.rejects(() => move(env), /HQ_RPC_SECRET_HASH/);
  await assert.rejects(() => inviteAccount(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', email: 'new@dach.example',
  }), /HQ_RPC_SECRET_HASH/);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get(MOVER).is_active, 1);
});

/* ------------------------------------------------------------------ *
 * 2. moveAccountOut                                                   *
 * ------------------------------------------------------------------ */

test('the reason is enforced on the branch, and a refusal writes nothing', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(() => move(env, { reason: 'too short' }),
    new RegExp(`at least ${MOVE_REASON_MIN} characters`));
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get(MOVER).is_active, 1,
    'a refused move deactivated the account anyway');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get().n, 0);
});

test('an unknown target, a missing destination and the SAME branch are all refused', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(() => move(env, { target_user_id: 9999 }), /holds no account/);
  await assert.rejects(() => move(env, { destination_code: 'NOT A CODE' }), /valid destination/);
  // Moving a branch's account to itself is a no-op dressed as a move: it would
  // close the account and invite it back, for nothing.
  await assert.rejects(() => move(env, { destination_code: 'fr' }), /already where this account lives/);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get(MOVER).is_active, 1);
});

test('an already-inactive target refuses rather than moving twice', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(() => move(env, { target_user_id: GONE }), /already deactivated/);
  // And the refusal says what to do instead, because the operator's next move
  // is the invitation alone, not a second move-out.
  await assert.rejects(() => move(env, { target_user_id: GONE }), /invite them on the destination/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get().n, 0);
});

test('a move closes the account and tells the person WHERE they are going', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  const res = await move(env);

  assert.equal(res.moved_out, true);
  assert.equal(res.branch, 'fr');
  assert.equal(res.target.email, 'remy@fr.example');
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get(MOVER).is_active, 0);

  // TWO ROWS, the shape admin.ts's own deactivation uses: one for the operator,
  // one addressed to the person.
  const rows = db.prepare('SELECT * FROM activity_logs ORDER BY id').all() as any[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, 'hq_account_moved_out');
  assert.match(rows[0].details, /Moved to dach by Sue Hart/);
  assert.ok(rows[0].details.includes(REASON), 'the reason is not on the record it exists for');

  assert.equal(rows[1].action, 'account_status_changed');
  assert.match(rows[1].details, /moving to dach/,
    'the person is told they were deactivated and not where they are going, which reads as a suspension');
  // D.6 IS A RE-INVITE, NOT A RECORD MIGRATION, and this is the sentence that
  // stops someone being told their work moved with them.
  assert.match(rows[1].details, /projects, deals and documents stay with this branch/i);

  // The actor is a NAME. An HQ id here would be joinable to a local users row.
  for (const r of rows) {
    assert.match(r.actor, /^hq:Sue Hart$/);
    assert.ok(!/^\d+$/.test(String(r.actor)), 'an HQ user id reached a branch audit row');
  }
});

/* ------------------------------------------------------------------ *
 * 3. inviteAccount                                                    *
 * ------------------------------------------------------------------ */

test('an invitation stores a token DIGEST and reports that nobody was told', async () => {
  const db = destinationDb();
  const env = await branchEnv(db, { code: 'dach' });
  const res = await inviteAccount(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', email: '  Remy@FR.Example  ', name: 'Remy Blanc',
    role: 'founder', moved_from_code: 'fr', reason: REASON,
  });

  assert.match(res.uid, /^inv_[0-9a-f]{20}$/);
  // Normalised on the way in, so the unique index and the accept-time match agree.
  assert.equal(res.email, 'remy@fr.example');

  const row = db.prepare('SELECT * FROM branch_invitations').get() as any;
  assert.equal(row.email, 'remy@fr.example');
  assert.equal(row.moved_from_code, 'fr');
  assert.equal(row.invited_by_name, 'Sue Hart');
  // THIS ASSERTION USED TO BE UNABLE TO FAIL, and the mutation that proved it
  // is the reason the token is prefixed. Two UUIDs with the dashes stripped are
  // exactly 64 hex characters, so `/^[0-9a-f]{64}$/` matched the RAW TOKEN just
  // as happily as the digest — storing the credential instead of its hash
  // walked straight through. The token now carries `invt_`, so the column
  // holding something that is not a bare digest is visible.
  assert.match(row.token_hash, /^[0-9a-f]{64}$/, 'the column does not hold a sha256 digest');
  assert.ok(!row.token_hash.startsWith('invt_'), 'the RAW TOKEN is stored instead of its digest');
  // And the link the operator is told to pass on is actually handed to them —
  // which is what makes `token_hash` provably the digest OF that token.
  assert.ok(res.invite_link, 'the mail did not send and no link was returned, so the advice is a dead end');
  const token = String(res.invite_link).split('/invite/')[1];
  assert.match(token, /^invt_[0-9a-f]+$/);
  assert.equal(row.token_hash, await sha256Hex(token),
    'the stored value is not the digest of the token that was issued');

  // THE HONEST STATE, and the one this test exists for. No Gmail credentials in
  // this env, so the mailer returns false — the row must say so rather than
  // letting HQ believe a person was contacted.
  assert.equal(res.email_sent, false);
  assert.equal(row.email_sent, 0);
  assert.match(String(res.email_reason), /no mail sender configured/);
  // And the invitation still EXISTS. A send failure must not lose it — the
  // link can be passed on by hand, and discarding it would make the move
  // unrecoverable.
  assert.equal(row.status, 'pending');
  assert.ok(row.expires_at && !/T/.test(row.expires_at),
    'expires_at is an ISO string, which compares wrong against datetime() (D120)');
});

test('an email that already has an ACTIVE account here is refused', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  await assert.rejects(() => inviteAccount(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', email: 'remy@fr.example',
  }), /already has an active account/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM branch_invitations').get().n, 0);
  // But a DEACTIVATED one is invitable — that is the whole move-back case, and
  // refusing it would make a mistaken move impossible to undo.
  const ok = await inviteAccount(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', email: 'gone@fr.example',
  });
  assert.equal(ok.email, 'gone@fr.example');
});

test('a malformed email is refused before a row is written', async () => {
  const db = branchDb();
  const env = await branchEnv(db);
  for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.com']) {
    await assert.rejects(() => inviteAccount(env, HQ_SECRET, {
      hq_actor_name: 'Sue Hart', email: bad,
    }), /valid email/);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM branch_invitations').get().n, 0);
});

/* ------------------------------------------------------------------ *
 * 4. The route reports the two legs separately                        *
 * ------------------------------------------------------------------ */

test('the move route never folds the invitation into its own success', () => {
  const src = read('cloudflare-worker/src/routes/admin_support_sessions.ts');
  const at = src.indexOf("r.post('/branches/:code/accounts/:userId/move'");
  assert.ok(at > 0, 'the move route is gone');
  // BOUNDED AT THE ROUTE'S REAL END, NOT A CHARACTER COUNT. This was
  // `at + 6000` and the handler grew past it (D163 added two lines), so the
  // last assertion below — the one about `records_note` — started reading a
  // window that stopped 300 characters short of the thing it names, and failed
  // on code that was correct. A magic-number window silently stops covering
  // what it claims to; the next route declaration, or the end of the file, is
  // the boundary that cannot drift.
  const rest = src.slice(at);
  const end = rest.slice(1).search(/\nr\.(post|get|patch|delete)\(/);
  const handler = end === -1 ? rest : rest.slice(0, end + 1);

  // Both bindings resolved BEFORE either is called: closing the source when the
  // destination is not bound would be half a move that cannot complete.
  const sourceCall = handler.indexOf('moveAccountOut(');
  const bindingCheck = handler.indexOf('!source || !destination');
  assert.ok(bindingCheck > 0 && bindingCheck < sourceCall,
    'the destination binding is checked after the source account is already closed');

  // The invitation is caught and reported, never thrown — the D111/D112 shape.
  const inviteCall = handler.indexOf('inviteAccount(');
  assert.ok(inviteCall > sourceCall, 'the invitation runs before the move-out, leaving two live homes');
  // THE CATCH MUST NOT RETHROW, and matching the reporting text alone could
  // not see that: a `throw e;` inserted above it left the string in place and
  // the assertion passed. The catch block is read as a whole instead.
  const catchAt = handler.indexOf('} catch (e) {', inviteCall);
  const catchBlock = handler.slice(catchAt, handler.indexOf('\n    }', catchAt));
  assert.ok(!/\bthrow\b/.test(catchBlock),
    'an unreachable destination throws instead of being reported, so a completed move-out looks like nothing happened');
  assert.match(catchBlock, /ok: false,/);
  assert.match(catchBlock, /Retry the invitation alone/,
    'the operator is not told that moving them out again would be refused');
  assert.match(handler, /email_sent: Boolean\(inv\?\.email_sent\)/,
    'the route reports the invitation as sent without asking whether it was');

  // The gate stack is D120's, not a weaker one.
  for (const gate of ["requireFactor(c, 'totp')", 'requireStepUp(c)', 'requireSuperAdmin(c)']) {
    assert.ok(handler.includes(gate), `the move route is missing ${gate}`);
  }
  // And the re-invite fact reaches the operator rather than living only in docs.
  assert.match(handler, /records_note/);
});
