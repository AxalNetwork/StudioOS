/**
 * D441 — a branch move invitation can be accepted where it was sent, and the
 * account is told when HQ authorises a support session.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_invitation_d441.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import invitations from '../src/routes/branch_invitations.ts';
import { openSupportSession } from '../src/rpc/branchOps.ts';
import { sha256Hex } from '../src/rpc/secret.ts';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const MIG_263 = read('cloudflare-worker/sql/migrations/263_branch_invitations.sql');
const MIG_262 = read('cloudflare-worker/sql/migrations/262_support_handoff_codes.sql');
const HQ_SECRET = 'hq-rpc-secret-value-for-tests';
const REASON = 'Founder cannot open their data room, ticket 4471';

const USERS = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'exploring',
    is_active INTEGER NOT NULL DEFAULT 1,
    email_verified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT, details TEXT, actor TEXT, user_id INTEGER
  );
`;

function branchDb(sql = USERS) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(sql);
  db.exec(MIG_263);
  return db;
}

function envFor(db: InstanceType<typeof DatabaseSync>, code: string | null = 'dach') {
  const base: any = { DB: d1Over(db), APP_URL: 'https://dach.axal.vc' };
  if (code) base.BRANCH_CODE = code;
  return base;
}

const app = new Hono<any>();
app.route('/api/branch', invitations);

let n = 0;
async function seed(db: InstanceType<typeof DatabaseSync>, over: Record<string, string> = {}) {
  n += 1;
  const raw = `invt_${n.toString(16).padStart(64, 'a')}`;
  const hash = await sha256Hex(raw);
  db.prepare(
    `INSERT INTO branch_invitations
       (uid, email, name, role, token_hash, status, invited_by_name, moved_from_code, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Sue Hart', 'fr', datetime('now', ?))`,
  ).run(
    `inv_${n.toString(16).padStart(20, 'b')}`,
    over.email ?? 'remy@fr.example',
    over.name ?? 'Remy Blanc',
    over.role ?? 'founder',
    hash,
    over.status ?? 'pending',
    over.ttl ?? '+14 days',
  );
  return raw;
}

async function accept(db: InstanceType<typeof DatabaseSync>, token: string, code: string | null = 'dach') {
  return app.request('/api/branch/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }, envFor(db, code));
}

test('a pending invitation creates the account and does not sign them in', async () => {
  const db = branchDb();
  const token = await seed(db);
  const res = await accept(db, token);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.account, 'created');
  assert.equal(body.email, 'remy@fr.example');
  assert.equal(body.role, 'founder');
  assert.equal(body.role_note, null);
  assert.equal(body.sign_in_path, '/login');
  assert.equal(body.token, undefined, 'the accept response handed back the credential');
  assert.ok(!JSON.stringify(body).includes(token), 'the raw token is in the response');

  const user = db.prepare('SELECT * FROM users').get() as any;
  assert.equal(user.email, 'remy@fr.example');
  assert.equal(user.role, 'founder');
  assert.equal(user.is_active, 1);
  assert.equal(user.email_verified, 1);
  assert.equal(db.prepare('SELECT status FROM branch_invitations').get().status, 'accepted');
});

test('a second accept does not create a second account', async () => {
  const db = branchDb();
  const token = await seed(db);
  assert.equal((await accept(db, token)).status, 200);
  const again = await accept(db, token);
  assert.equal(again.status, 410);
  const body: any = await again.json();
  assert.equal(body.error, 'invitation_used');
  assert.match(body.message, /already been used/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('an expired invitation is stamped expired and creates nobody', async () => {
  const db = branchDb();
  const token = await seed(db, { ttl: '-2 days' });
  const res = await accept(db, token);
  assert.equal(res.status, 410);
  const body: any = await res.json();
  assert.equal(body.error, 'invitation_expired');
  assert.equal(db.prepare('SELECT status FROM branch_invitations').get().status, 'expired');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('a withdrawn invitation creates nobody', async () => {
  const db = branchDb();
  const token = await seed(db, { status: 'revoked' });
  const res = await accept(db, token);
  assert.equal(res.status, 410);
  assert.equal((await res.json()).error, 'invitation_revoked');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('a token that is not the issued shape never reaches the table', async () => {
  const db = branchDb();
  await seed(db);
  const env = {
    BRANCH_CODE: 'dach',
    DB: { prepare() { throw new Error('a bad token was queried'); } },
  };
  const res = await app.request('/api/branch/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'invt_abcd' }),
  }, env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invitation_token_invalid');
  assert.equal(db.prepare('SELECT status FROM branch_invitations').get().status, 'pending');
});

test('HQ refuses before it reads the invitation', async () => {
  const env = {
    DB: { prepare() { throw new Error('HQ read a branch invitation'); } },
  };
  const token = `invt_${'c'.repeat(64)}`;
  const res = await app.request('/api/branch/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }, env);
  assert.equal(res.status, 403);
  const body: any = await res.json();
  assert.equal(body.detail, 'Branch only');
});

test('an already-active account keeps its role', async () => {
  const db = branchDb();
  db.prepare(
    `INSERT INTO users (email, name, role, is_active, email_verified) VALUES (?, ?, 'founder', 1, 1)`,
  ).run('remy@fr.example', 'Remy Blanc');
  const token = await seed(db, { role: 'admin' });
  const res = await accept(db, token);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.account, 'already_active');
  assert.equal(body.role, 'founder');
  assert.equal(body.role_note, null);
  const user = db.prepare('SELECT role, is_active FROM users').get() as any;
  assert.equal(user.role, 'founder', 'a forwarded invitation changed an active account\'s role');
  assert.equal(user.is_active, 1);
});

test('a deactivated account is restored with the invitation role', async () => {
  const db = branchDb();
  db.prepare(
    `INSERT INTO users (email, name, role, is_active, email_verified) VALUES (?, ?, 'founder', 0, 0)`,
  ).run('remy@fr.example', 'Remy Blanc');
  const token = await seed(db, { role: 'investor' });
  const res = await accept(db, token);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).account, 'reactivated');
  const user = db.prepare('SELECT role, is_active, email_verified FROM users').get() as any;
  assert.equal(user.is_active, 1);
  assert.equal(user.role, 'investor');
  assert.equal(user.email_verified, 1);
});

test('a role this branch does not grant becomes exploring, and the response says so', async () => {
  const db = branchDb();
  const token = await seed(db, { role: 'super_admin' });
  const res = await accept(db, token);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.role, 'exploring');
  assert.match(body.role_note, /does not grant/);
  assert.equal(db.prepare('SELECT role FROM users').get().role, 'exploring');
});

test('a failed create puts the invitation back to pending', async () => {
  const db = branchDb(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'exploring',
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT, details TEXT, actor TEXT, user_id INTEGER
    );
  `);
  const token = await seed(db);
  const res = await accept(db, token);
  assert.equal(res.status, 500);
  const body: any = await res.json();
  assert.equal(body.error, 'invitation_not_completed');
  assert.match(body.message, /still open/);
  const blob = JSON.stringify(body);
  assert.doesNotMatch(blob, /no such column|no column named|SQLITE/i, 'the refusal carried the database\'s own text');
  assert.equal(db.prepare('SELECT status FROM branch_invitations').get().status, 'pending',
    'the invitation stayed accepted after the account was not created');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('preview names the invitation and does not spend it', async () => {
  const db = branchDb();
  const token = await seed(db);
  const res = await app.request(
    `/api/branch/invitations/preview?token=${encodeURIComponent(token)}`,
    { method: 'GET' },
    envFor(db),
  );
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(body.email, 'remy@fr.example');
  assert.equal(body.status, 'pending');
  assert.equal(body.expired, false);
  assert.equal(body.invited_by_name, 'Sue Hart');
  assert.equal(db.prepare('SELECT status FROM branch_invitations').get().status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

/* ------------------------------------------------------------------ *
 * The support-session notice                                          *
 * ------------------------------------------------------------------ */

function supportDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT,
                                actor TEXT, user_id INTEGER);
  `);
  db.exec(MIG_262);
  db.prepare(
    `INSERT INTO users (id, role, is_active, name, email) VALUES (42, 'founder', 1, 'Remy Blanc', 'remy@fr.example')`,
  ).run();
  return db;
}

async function supportEnv(db: InstanceType<typeof DatabaseSync>, dbBinding: any = d1Over(db)) {
  return {
    DB: dbBinding,
    BRANCH_CODE: 'fr',
    HQ_RPC_SECRET_HASH: await sha256Hex(HQ_SECRET),
    APP_URL: 'https://fr.axal.vc',
  } as any;
}

test('authorising a support session tells the account', async () => {
  const db = supportDb();
  const env = await supportEnv(db);
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: 42, reason: REASON,
  });
  assert.equal(offer.target_notified, true, 'the response claims nothing about whether the person was told');
  const note = db.prepare('SELECT * FROM notifications_inbox').get() as any;
  assert.ok(note, 'no notice was written');
  assert.equal(note.user_id, 42);
  assert.equal(note.type, 'hq_branch_support_session');
  assert.equal(note.category, 'security');
  assert.equal(note.link, '/account/security');
  assert.match(note.body, /Sue Hart/);
  assert.match(note.body, /30 minutes/);
  assert.match(note.body, new RegExp(REASON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_handoff_codes').get().n, 1);
});

test('a refused authorisation tells nobody', async () => {
  const db = supportDb();
  const env = await supportEnv(db);
  await assert.rejects(() => openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: 42, reason: 'too short',
  }), /at least/);
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notifications_inbox'",
  ).get();
  assert.equal(table, undefined, 'a refused session still wrote a notice');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_handoff_codes').get().n, 0);
});

test('a notice that cannot be stored does not fail the authorisation', async () => {
  const db = supportDb();
  const real = d1Over(db);
  const env = await supportEnv(db, {
    prepare(sql: string) {
      if (/INSERT INTO notifications_inbox/.test(sql)) {
        return { bind: () => ({ run: async () => { throw new Error('inbox down'); } }) };
      }
      return real.prepare(sql);
    },
  });
  const offer = await openSupportSession(env, HQ_SECRET, {
    hq_actor_name: 'Sue Hart', target_user_id: 42, reason: REASON,
  });
  assert.equal(offer.target_notified, false, 'the response claims a notice the inbox did not take');
  assert.match(offer.code, /^[0-9a-f]{48}$/, 'the authorisation was dropped because the notice failed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM support_handoff_codes').get().n, 1);
});

test('the invitation accept route is on its own rate bucket, fail closed', () => {
  const src = read('cloudflare-worker/src/middleware/rateLimit.ts');
  const at = src.indexOf("name: 'branch_invitation'");
  assert.ok(at > 0, 'branch_invitation bucket is missing');
  const blockEnd = src.indexOf('\n  },', at);
  const bucket = src.slice(at, blockEnd);
  assert.equal((bucket.match(/name: '/g) ?? []).length, 1);
  assert.match(bucket, /limit: 10/);
  assert.match(bucket, /scope: 'ip'/);
  assert.match(bucket, /failClosed: true/);
  assert.ok(bucket.includes('(preview|accept)'), 'the bucket does not cover preview and accept');
});
