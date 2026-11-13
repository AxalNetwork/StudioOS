/**
 * D5043 (#5043) — a cross-branch move whose destination invitation did not land can be finished.
 *
 * The whole Worker is bundled (the D259 harness) and the two branches are REAL `branchOps`
 * methods over their own in-memory databases, behind stub bindings that can be taken down,
 * so what is asserted is the route, the HQ record and what each branch actually stored:
 *
 *   - the move records an operation before it touches the source, and the record proves the
 *     move-out before any retry;
 *   - "Retry invitation" takes the operation uid only: the email, name, role, destination and
 *     reason are the record's, never the body's;
 *   - a retry is idempotent (a landed invitation is answered again, with no branch call), one at
 *     a time, and cannot write a second invitation even when HQ never heard the first answer;
 *   - an active account that appeared on the destination is refused, by name;
 *   - stored and sent are two facts, and the link travels only when the mail did not leave;
 *   - every attempt is audited, and an audit write that fails does not undo a landed invitation;
 *   - the move's own bar (TOTP, recent step-up, Super Admin, the recovery cool-off) holds.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/account_move_recovery_5043.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';
import { moveAccountOut, inviteAccount } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};'
  + ' export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';
const out = join(mkdtempSync(join(tmpdir(), 'd5043-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  loader: { '.woff2': 'binary', '.png': 'binary' }, target: 'node22',
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
  plugins: [{
    name: 'workers-shims',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
    },
  }],
  external: ['node:*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const worker = (await import(pathToFileURL(out).href)).default;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);
const MIG_263 = read('cloudflare-worker/sql/migrations/263_branch_invitations.sql');
const MIG_MOVE_REF = read('cloudflare-worker/sql/migrations/202611091211_branch_invitation_move_ref.sql');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ_RPC_SECRET = 'synthetic-test-value-not-a-credential';
const HQ = 1;          // the Super Admin
const PLAIN = 2;       // an administrator without the elevation
const MOVER = 51;      // the account's id on FR's database
const REASON = 'Founder relocated to the DACH territory, ticket 902';
const EMAIL = 'remy@fr.example';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/** A D1 over node:sqlite. `failWrites` makes matching INSERTs throw, to model an audit store that is down. */
function makeD1(db: any, opts: { failWrites?: RegExp } = {}) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return (db.prepare(sql).get(...b) as any) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async raw() { return (db.prepare(sql).all(...b) as any[]).map((r) => Object.values(r)); },
        async run() {
          if (opts.failWrites && opts.failWrites.test(sql)) throw new Error('D1_ERROR: simulated write failure');
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const o: any[] = []; for (const s of stmts) o.push(await s.run()); return o; },
  };
}

function hqDb() {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(HQ, 'admin', 'Hana HQ', 'hana@axal.example');
  u.run(PLAIN, 'admin', 'Pat Plain', 'pat@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HQ);
  const s = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`,
  );
  s.run('totp-1', HQ);
  s.run('totp-2', PLAIN);
  return db;
}

function branchDb(withMover: boolean) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        name TEXT, email TEXT);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
                                actor TEXT, user_id INTEGER);
  `);
  db.exec(MIG_263);
  db.exec(MIG_MOVE_REF);
  if (withMover) {
    db.prepare('INSERT INTO users (id, role, is_active, name, email) VALUES (?,?,?,?,?)')
      .run(MOVER, 'founder', 1, 'Remy Blanc', EMAIL);
  }
  return db;
}

type Mode = 'up' | 'down' | 'write_then_drop';

/** A branch Worker: the real RPC methods over its own database, reachable or not. */
async function branch(code: string, db: any) {
  const env = {
    DB: makeD1(db), BRANCH_CODE: code, BRANCH_NAME: `Axal VC ${code}`, APP_URL: `https://${code}.axal.vc`,
    HQ_RPC_SECRET_HASH: await sha256Hex(HQ_RPC_SECRET),
  } as any;
  const state = { mode: 'up' as Mode, calls: [] as Array<{ method: string; req: any }> };
  const stub = {
    async moveAccountOut(secret: string, req: any) {
      state.calls.push({ method: 'moveAccountOut', req });
      if (state.mode === 'down') throw new Error('Network connection lost.');
      return moveAccountOut(env, secret, req);
    },
    async inviteAccount(secret: string, req: any) {
      state.calls.push({ method: 'inviteAccount', req });
      if (state.mode === 'down') throw new Error('Network connection lost.');
      const res = await inviteAccount(env, secret, req);
      if (state.mode === 'write_then_drop') throw new Error('Network connection lost.');
      return res;
    },
  };
  return { stub, state, db };
}

async function world(opts: { hqFailWrites?: RegExp } = {}) {
  const hq = hqDb();
  const fr = await branch('fr', branchDb(true));
  const dach = await branch('dach', branchDb(false));
  const kv = new Map<string, string>();
  const env = {
    JWT_SECRET, ENVIRONMENT: 'development', HQ_RPC_SECRET,
    DB: makeD1(hq, { failWrites: opts.hqFailWrites }),
    RATE_LIMITS: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
    BRANCH_FR: fr.stub,
    BRANCH_DACH: dach.stub,
  } as any;
  return { hq, fr, dach, env };
}

async function jwtFor(userId: number, session = true): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', ...(session ? { jti: `totp-${userId}` } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function req(env: any, method: string, path: string, body?: unknown, as = HQ, session = true) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(as, session)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    const waits: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
    const res = await worker.fetch(new Request(`https://axal.vc${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env, ctx);
    await Promise.allSettled(waits);
    let parsed: any = null;
    try { parsed = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: parsed };
  } finally {
    silence.forEach((m) => m.mock.restore());
  }
}

const move = (env: any) => req(env, 'POST', `/api/admin/branches/fr/accounts/${MOVER}/move`,
  { destination_code: 'dach', reason: REASON });
const retry = (env: any, uid: string, body?: unknown, as = HQ, session = true) =>
  req(env, 'POST', `/api/admin/account-moves/${uid}/retry-invitation`, body, as, session);

const opRow = (hq: any, uid: string) => hq.prepare('SELECT * FROM hq_account_moves WHERE uid = ?').get(uid) as any;
const invitations = (db: any) => db.prepare('SELECT * FROM branch_invitations ORDER BY id').all() as any[];
const retryAudits = (hq: any) => (hq.prepare(
  "SELECT filters_json FROM admin_audit_log WHERE action = 'hq_account_move_invite_retried' ORDER BY id",
).all() as any[]).map((r) => JSON.parse(r.filters_json));
const inviteCalls = (b: any) => b.state.calls.filter((x: any) => x.method === 'inviteAccount').length;

/** A move whose source closes the account and whose destination is down. */
async function partialMove() {
  const w = await world();
  w.dach.state.mode = 'down';
  const r = await move(w.env);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...w, uid: String(r.body?.operation?.uid), first: r };
}

/* ------------------------------------------------------------------ *
 * 1. The partial move is recorded, and readable after a refresh       *
 * ------------------------------------------------------------------ */

test('source succeeds, destination unavailable: the reply says so and HQ records a recoverable operation', async () => {
  const { hq, fr, dach, uid, first, env } = await partialMove();
  assert.equal(first.body.moved_out, true);
  assert.equal(first.body.invited.ok, false);
  assert.equal(first.body.invited.code, 'destination_unreachable');
  assert.match(first.body.invited.reason, /Retry the invitation alone/);
  assert.match(uid, /^mvop_[0-9a-f]{20}$/);
  assert.equal(first.body.operation.recoverable, true);

  assert.equal(fr.db.prepare('SELECT is_active FROM users WHERE id = ?').get(MOVER).is_active, 0);
  assert.equal(invitations(dach.db).length, 0);

  const row = opRow(hq, uid);
  assert.equal(row.status, 'invite_failed');
  assert.ok(row.moved_out_at, 'the source answered and HQ did not stamp the proof');
  assert.equal(row.target_email, EMAIL, 'the record does not hold what the source answered');
  assert.equal(row.branch_user_id, MOVER);
  assert.equal(row.last_error_code, 'destination_unreachable');
  // The move's invitation call carried the operation, so the destination can dedupe.
  assert.equal(dach.state.calls[0].req.move_ref, uid);

  // A refresh finds it.
  const list = await req(env, 'GET', '/api/admin/account-moves');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const item = list.body.items.find((x: any) => x.uid === uid);
  assert.ok(item, 'the open partial move is not on the list a refresh reads');
  assert.equal(item.state, 'invitation_failed');
  assert.deepEqual([item.from, item.to, item.moved_out, item.target.email], ['fr', 'dach', true, EMAIL]);
  assert.match(item.records_note, /stay with fr/);
});

test('retry while the destination is still unavailable: refused 502, recorded, audited, nothing stored', async () => {
  const { hq, dach, uid, env } = await partialMove();
  const r = await retry(env, uid);
  assert.equal(r.status, 502, JSON.stringify(r.body));
  assert.equal(r.body.error, 'destination_unreachable');
  assert.equal(r.body.operation.state, 'invitation_failed');
  const row = opRow(hq, uid);
  assert.equal(row.status, 'invite_failed');
  assert.equal(row.attempts, 2);
  assert.equal(invitations(dach.db).length, 0);
  assert.deepEqual(retryAudits(hq).map((a) => a.outcome), ['destination_unreachable']);
});

test('retry after the destination recovers: the invitation is stored from the RECORD, stored and sent kept apart', async () => {
  const { hq, dach, uid, env } = await partialMove();
  dach.state.mode = 'up';
  // The body is ignored: an address sent by the browser never reaches the invitation.
  const r = await retry(env, uid, { email: 'attacker@evil.example', name: 'Mallory', role: 'admin', destination_code: 'fr' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.retried, true);
  assert.equal(r.body.invited.ok, true);
  assert.equal(r.body.invited.stored, true);
  // No mail sender in this env: the invitation exists and nobody was told, and the link travels.
  assert.equal(r.body.invited.email_sent, false);
  assert.match(String(r.body.invited.reason), /no mail sender configured/);
  assert.match(String(r.body.invited.invite_link), /^https:\/\/dach\.axal\.vc\/join\/invt_[0-9a-f]+$/);
  assert.equal(r.body.operation.state, 'invitation_not_sent');

  const inv = invitations(dach.db);
  assert.equal(inv.length, 1);
  assert.deepEqual([inv[0].email, inv[0].role, inv[0].moved_from_code, inv[0].move_ref], [EMAIL, 'founder', 'fr', uid]);
  assert.equal(inv[0].reason, REASON);
  const call = dach.state.calls.at(-1).req;
  assert.equal(call.email, EMAIL);
  assert.ok(!JSON.stringify(call).includes('attacker'), 'a browser-sent field reached the destination');

  const row = opRow(hq, uid);
  assert.deepEqual([row.status, row.invite_uid, row.invite_email_sent], ['invited', inv[0].uid, 0]);
  assert.deepEqual(retryAudits(hq).map((a) => [a.outcome, a.email_sent]), [['invited', false]]);
  // Mail did not leave, so it stays on the list with its manual next step.
  const list = await req(env, 'GET', '/api/admin/account-moves');
  assert.equal(list.body.items.find((x: any) => x.uid === uid)?.state, 'invitation_not_sent');
});

test('duplicate retry: the landed invitation is answered again and no branch is called', async () => {
  const { hq, dach, uid, env } = await partialMove();
  dach.state.mode = 'up';
  assert.equal((await retry(env, uid)).status, 200);
  const before = inviteCalls(dach);
  const again = await retry(env, uid);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.retried, false);
  assert.equal(again.body.invited.stored, true);
  assert.equal(inviteCalls(dach), before, 'a replay called the destination again');
  assert.equal(invitations(dach.db).length, 1);
  assert.equal(opRow(hq, uid).attempts, 2, 'a replay counted as an attempt');
  assert.deepEqual(retryAudits(hq).map((a) => a.outcome), ['invited', 'already_invited']);
});

test('invite already exists: the destination wrote it and the answer was lost; the retry reuses it, never a second', async () => {
  const w = await world();
  w.dach.state.mode = 'write_then_drop';
  const first = await move(w.env);
  const uid = first.body.operation.uid;
  assert.equal(first.body.invited.ok, false, 'HQ heard nothing, so it must not claim the invitation landed');
  assert.equal(invitations(w.dach.db).length, 1, 'the destination did write it');
  const tokenBefore = invitations(w.dach.db)[0].token_hash;

  w.dach.state.mode = 'up';
  const r = await retry(w.env, uid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invited.reused, true);
  const inv = invitations(w.dach.db);
  assert.equal(inv.length, 1, 'the retry wrote a second invitation for the same move');
  assert.equal(r.body.invited.uid, inv[0].uid);
  // Its message never left and HQ never saw its link, so the link is re-issued and shown.
  assert.notEqual(inv[0].token_hash, tokenBefore);
  const token = String(r.body.invited.invite_link).split('/join/')[1];
  assert.equal(inv[0].token_hash, await sha256Hex(token));
});

test('the destination account became active independently: refused by name, recorded, nothing stored', async () => {
  const { hq, dach, uid, env } = await partialMove();
  dach.state.mode = 'up';
  dach.db.prepare('INSERT INTO users (id, role, is_active, name, email) VALUES (?,?,?,?,?)')
    .run(9, 'founder', 1, 'Remy (registered)', EMAIL);
  const r = await retry(env, uid);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'destination_active');
  assert.match(r.body.message, /already has an active account/);
  assert.equal(invitations(dach.db).length, 0);
  assert.equal(opRow(hq, uid).last_error_code, 'destination_active');
  assert.deepEqual(retryAudits(hq).map((a) => a.outcome), ['destination_active']);
});

test('an audit store that fails does not undo a landed invitation', async () => {
  const w = await world();
  w.dach.state.mode = 'down';
  const uid = (await move(w.env)).body.operation.uid;
  w.dach.state.mode = 'up';
  // Both audit tables refuse every write from here on.
  w.env.DB = makeD1(w.hq, { failWrites: /INSERT INTO (activity_logs|admin_audit_log)/ });
  const r = await retry(w.env, uid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invited.stored, true);
  assert.equal(invitations(w.dach.db).length, 1);
  assert.equal(opRow(w.hq, uid).status, 'invited');
});

/* ------------------------------------------------------------------ *
 * 2. Stale, replayed and unproven operations                          *
 * ------------------------------------------------------------------ */

test('stale and replayed ids: malformed 400, unknown 404, and a move the source refused cannot be retried', async () => {
  const w = await world();
  assert.equal((await retry(w.env, 'not-an-op')).status, 400);
  const unknown = await retry(w.env, 'mvop_0123456789abcdef0123');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'move_not_found');

  // The source refuses (already inactive): the operation is recorded as refused and proves nothing.
  w.fr.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(MOVER);
  const refused = await move(w.env);
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  const row = w.hq.prepare('SELECT * FROM hq_account_moves ORDER BY id DESC LIMIT 1').get() as any;
  assert.deepEqual([row.status, row.moved_out_at], ['source_refused', null]);
  const r = await retry(w.env, row.uid);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'move_out_not_proven');
  assert.equal(inviteCalls(w.dach), 0);
  const list = await req(w.env, 'GET', '/api/admin/account-moves');
  assert.ok(!list.body.items.some((x: any) => x.uid === row.uid), 'a refused move is listed as open');
});

test('a move recorded but never confirmed by the source cannot be retried', async () => {
  const w = await world();
  w.hq.prepare(
    `INSERT INTO hq_account_moves (uid, from_code, to_code, branch_user_id, reason, actor_user_id, actor_name, status, target_email)
     VALUES ('mvop_aaaaaaaaaaaaaaaaaaaa', 'fr', 'dach', ?, ?, ?, 'Hana HQ', 'started', ?)`,
  ).run(MOVER, REASON, HQ, EMAIL);
  const r = await retry(w.env, 'mvop_aaaaaaaaaaaaaaaaaaaa');
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'move_out_not_proven');
  assert.equal(inviteCalls(w.dach), 0);
});

test('one retry at a time: a fresh claim refuses a second; an abandoned one can be taken again', async () => {
  const { hq, dach, uid, env } = await partialMove();
  dach.state.mode = 'up';
  hq.prepare("UPDATE hq_account_moves SET status = 'inviting', updated_at = datetime('now') WHERE uid = ?").run(uid);
  const busy = await retry(env, uid);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, 'retry_in_progress');
  assert.equal(inviteCalls(dach), 1, 'a second retry reached the destination while one was in flight');

  hq.prepare("UPDATE hq_account_moves SET updated_at = datetime('now', '-10 minutes') WHERE uid = ?").run(uid);
  const taken = await retry(env, uid);
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  assert.equal(invitations(dach.db).length, 1);
});

/* ------------------------------------------------------------------ *
 * 3. The move's bar                                                    *
 * ------------------------------------------------------------------ */

test('a plain administrator, a session without TOTP and a stale step-up are refused before any branch call', async () => {
  const { hq, dach, uid, env } = await partialMove();
  dach.state.mode = 'up';
  const calls = inviteCalls(dach);
  assert.equal((await retry(env, uid, undefined, PLAIN)).status, 403);
  const noTotp = await retry(env, uid, undefined, HQ, false);
  assert.equal(noTotp.status, 403);
  hq.prepare("UPDATE user_sessions SET created_at = datetime('now', '-2 hours'), last_step_up_at = datetime('now', '-2 hours') WHERE jti = 'totp-1'").run();
  const stale = await retry(env, uid);
  assert.equal(stale.status, 403, `a stale step-up was not refused: ${JSON.stringify(stale.body)}`);
  assert.equal(stale.body?.code, 'step_up_required');
  assert.equal(inviteCalls(dach), calls);
  assert.equal(opRow(hq, uid).status, 'invite_failed');
  // The open list is Super Admin's too.
  assert.equal((await req(env, 'GET', '/api/admin/account-moves', undefined, PLAIN)).status, 403);
});

test('inside the recovery cool-off the retry is paused 423 and no branch is called', async () => {
  const { hq, dach, uid, env } = await partialMove();
  dach.state.mode = 'up';
  hq.prepare(
    `INSERT INTO user_recovery_state (user_id, cooling_off_until, updated_at)
     VALUES (?, datetime('now', '+1 day'), datetime('now'))`,
  ).run(HQ);
  const calls = inviteCalls(dach);
  const r = await retry(env, uid);
  assert.equal(r.status, 423);
  assert.equal(inviteCalls(dach), calls);
});

/* ------------------------------------------------------------------ *
 * 4. The branch side, directly                                         *
 * ------------------------------------------------------------------ */

test('inviteAccount: a sent invitation for the same move is answered again with no new token', async () => {
  const dach = await branch('dach', branchDb(false));
  const ref = 'mvop_bbbbbbbbbbbbbbbbbbbb';
  const first = await dach.stub.inviteAccount(HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', email: EMAIL, move_ref: ref });
  dach.db.prepare('UPDATE branch_invitations SET email_sent = 1').run();
  const token = invitations(dach.db)[0].token_hash;
  const again = await dach.stub.inviteAccount(HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', email: EMAIL, move_ref: ref });
  assert.equal(again.uid, first.uid);
  assert.equal(again.reused, true);
  assert.equal(again.email_sent, true);
  assert.equal(again.invite_link, undefined, 'a link was re-issued for an invitation already in their inbox');
  assert.equal(invitations(dach.db)[0].token_hash, token);
  assert.equal(invitations(dach.db).length, 1);
});

test('inviteAccount: an accepted invitation for the same move is the move finished, not a conflict', async () => {
  const dach = await branch('dach', branchDb(false));
  const ref = 'mvop_cccccccccccccccccccc';
  const first = await dach.stub.inviteAccount(HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', email: EMAIL, move_ref: ref });
  dach.db.prepare("UPDATE branch_invitations SET status = 'accepted'").run();
  dach.db.prepare('INSERT INTO users (id, role, is_active, name, email) VALUES (?,?,?,?,?)').run(3, 'founder', 1, 'Remy', EMAIL);
  const again = await dach.stub.inviteAccount(HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', email: EMAIL, move_ref: ref });
  assert.deepEqual([again.uid, again.reused, again.accepted], [first.uid, true, true]);
  // Without the move's ref the same active account is a refusal, as before.
  await assert.rejects(() => dach.stub.inviteAccount(HQ_RPC_SECRET, { hq_actor_name: 'Hana HQ', email: EMAIL }),
    /already has an active account/);
});

test('the retry route takes no address, name or role from the request', () => {
  const src = read('cloudflare-worker/src/routes/admin_support_sessions.ts');
  const at = src.indexOf("r.post('/account-moves/:uid/retry-invitation'");
  assert.ok(at > 0, 'the retry route is gone');
  const handler = src.slice(at);
  assert.ok(!/c\.req\.json\(/.test(handler), 'the retry handler reads a request body');
  assert.match(handler, /email: row\.target_email/);
});
