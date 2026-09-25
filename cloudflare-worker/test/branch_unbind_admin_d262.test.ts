/**
 * D262 — a branch takes the admin role off one of its own accounts when HQ
 * asks, and only when HQ asks.
 *
 * `unbindAdmin` runs on the BRANCH (`HqEntrypoint` is exported by the branch
 * and delegates here). It is the only thing that can reach an administrator
 * whose account lives in a branch database: HQ's demote, toggle-active and
 * termination act on HQ's own. So its refusals are the controls, and each is
 * asserted to write nothing.
 *
 * On `d1Over(buildFresh(...))`: the schema the deploy's step 9 rebuilds (D235),
 * so `users`, `activity_logs` and `super_admins` are production's shape. The
 * FR vars make it a branch; the hash is of an obviously synthetic secret.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_unbind_admin_d262.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { unbindAdmin, UNBIND_REASON_MIN } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';
import { requireAuth } from '../src/auth.ts';

const ROOT = process.cwd();
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HQ_SECRET = 'synthetic-hq-rpc-secret-not-a-credential';
const PRINCIPAL = 11;   // the branch's administrator
const DEPUTY = 12;      // a second administrator
const HOLDER = 13;      // an admin carrying a super_admins row, which a branch should not have
const FOUNDER = 14;     // an ordinary account
const REASON = 'Licence breach found in the Q3 review, ticket 7731';

function freshDb() {
  const db = buildFresh(BASELINE, LATER, { dqs: true });
  db.exec('PRAGMA foreign_keys = OFF;');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(PRINCIPAL, 'admin', 'Paul Principal', 'paul@fr.example');
  u.run(DEPUTY, 'admin', 'Dana Deputy', 'dana@fr.example');
  u.run(HOLDER, 'admin', 'Hugo Holder', 'hugo@fr.example');
  u.run(FOUNDER, 'founder', 'Fleur Founder', 'fleur@fr.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  return db;
}

async function envFor(db: any, opts: { hash?: string | null } = {}) {
  const hash = opts.hash === undefined ? await sha256Hex(HQ_SECRET) : opts.hash;
  return {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development',
    BRANCH_CODE: 'fr', APP_URL: 'https://fr.axal.vc', PUBLIC_BASE_URL: 'https://fr.axal.vc',
    ...(hash === null ? {} : { HQ_RPC_SECRET_HASH: hash }),
  } as any;
}

const users = (db: any) => JSON.stringify(db.prepare('SELECT id, role, is_active FROM users ORDER BY id').all());
const unboundRows = (db: any) => db.prepare(
  "SELECT action, actor, user_id, details FROM activity_logs WHERE action IN ('hq_admin_unbound', 'your_role_changed') ORDER BY id",
).all() as any[];
const req = (over: Record<string, unknown> = {}) =>
  ({ hq_actor_name: 'Sue Hart', target_user_id: PRINCIPAL, reason: REASON, ...over }) as any;

/* ------------------------------------------------------------------ *
 * 1. Each refusal writes nothing                                      *
 * ------------------------------------------------------------------ */

const REFUSALS: Array<[string, (db: any) => Promise<unknown>, RegExp]> = [
  ['a wrong secret', async (db) => unbindAdmin(await envFor(db), 'not-the-secret', req()), /wrong secret/],
  ['no secret', async (db) => unbindAdmin(await envFor(db), '', req()), /no secret/],
  ['a branch with no hash', async (db) => unbindAdmin(await envFor(db, { hash: null }), HQ_SECRET, req()), /HQ_RPC_SECRET_HASH/],
  ['a reason one character short', async (db) => unbindAdmin(await envFor(db), HQ_SECRET, req({ reason: 'x'.repeat(UNBIND_REASON_MIN - 1) })), /reason of at least 10/],
  ['a target that is not an administrator', async (db) => unbindAdmin(await envFor(db), HQ_SECRET, req({ target_user_id: FOUNDER })), /not an administrator/],
  ['a target carrying a super_admins row', async (db) => unbindAdmin(await envFor(db), HQ_SECRET, req({ target_user_id: HOLDER })), /super_admins row/],
  ['a target that does not exist', async (db) => unbindAdmin(await envFor(db), HQ_SECRET, req({ target_user_id: 999 })), /holds no account/],
  ['no operator name', async (db) => unbindAdmin(await envFor(db), HQ_SECRET, req({ hq_actor_name: '  ' })), /name of the HQ operator/],
];

for (const [label, call, message] of REFUSALS) {
  test(`D262: ${label} is refused, and nothing is written`, async () => {
    const db = freshDb();
    const before = users(db);
    await assert.rejects(() => call(db), message);
    assert.equal(users(db), before, `${label} still changed an account`);
    assert.deepEqual(unboundRows(db), [], `${label} still wrote an audit row`);
  });
}

test('D262: an administrator already deactivated is refused rather than unbound twice', async () => {
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(DEPUTY);
  const before = users(db);
  const env = await envFor(db);
  await assert.rejects(() => unbindAdmin(env, HQ_SECRET, req({ target_user_id: DEPUTY })), /already deactivated/);
  assert.equal(users(db), before);
});

/* ------------------------------------------------------------------ *
 * 2. Success                                                          *
 * ------------------------------------------------------------------ */

test('D262: HQ unbinds one administrator: demoted, deactivated, two rows as hq:<name>, and no one else touched', async () => {
  const db = freshDb();
  const r: any = await unbindAdmin(await envFor(db), HQ_SECRET, req());
  assert.deepEqual(r.unbound.map((u: any) => u.id), [PRINCIPAL]);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.branch, 'fr');

  const row: any = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(PRINCIPAL);
  assert.equal(row.role, 'exploring');
  assert.equal(Number(row.is_active), 0);
  for (const other of [DEPUTY, HOLDER]) {
    const o: any = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(other);
    assert.equal(o.role, 'admin', `account ${other} lost its role in a one-account unbind`);
    assert.equal(Number(o.is_active), 1);
  }

  const rows = unboundRows(db);
  assert.equal(rows.length, 2, 'one row for the act and one addressed to the person');
  assert.deepEqual(rows.map((x) => x.action), ['hq_admin_unbound', 'your_role_changed']);
  for (const x of rows) {
    assert.equal(x.actor, 'hq:Sue Hart');
    assert.equal(Number(x.user_id), PRINCIPAL);
    assert.match(x.details, /Licence breach found in the Q3 review/);
  }
});

test('D262: the unbound principal\'s session stops at the next request — requireAuth answers 401', async () => {
  const db = freshDb();
  const env = await envFor(db);
  const app = new Hono<any>();
  app.get('/me', async (c) => c.json({ id: (await requireAuth(c as any)).id }));
  app.onError((err: any, c) => c.json({ detail: String(err?.message) }, err?.message === 'Unauthorized' ? 401 : 500));
  const token = await new SignJWT({ user_id: PRINCIPAL, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const call = () => app.request('/me', { headers: { Authorization: `Bearer ${token}` } }, env);

  assert.equal((await call()).status, 200, 'the fixture: the principal is signed in before the unbind');
  await unbindAdmin(env, HQ_SECRET, req());
  assert.equal((await call()).status, 401, 'the principal still gets through after being unbound');
});

test('D262: with no target — termination — every active administrator is unbound, the super_admins row is skipped with its reason, ordinary accounts are left', async () => {
  const db = freshDb();
  const r: any = await unbindAdmin(await envFor(db), HQ_SECRET, { hq_actor_name: 'Sue Hart', reason: 'Licence terminated: the agreement has ended' });
  assert.deepEqual(r.unbound.map((u: any) => u.id).sort(), [PRINCIPAL, DEPUTY]);
  assert.deepEqual(r.skipped.map((s: any) => s.id), [HOLDER]);
  assert.match(r.skipped[0].reason, /super_admins row/);
  for (const id of [PRINCIPAL, DEPUTY]) {
    const row: any = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(id);
    assert.equal(row.role, 'exploring');
    assert.equal(Number(row.is_active), 0);
  }
  const holder: any = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(HOLDER);
  assert.equal(holder.role, 'admin');
  const founder: any = db.prepare('SELECT role, is_active FROM users WHERE id = ?').get(FOUNDER);
  assert.equal(founder.role, 'founder');
  assert.equal(Number(founder.is_active), 1);
  assert.equal(unboundRows(db).length, 4, 'two rows for each of the two unbound');
});
