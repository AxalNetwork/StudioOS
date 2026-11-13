/**
 * D448 — an admin target, the freeze, the audit row, and one open count.
 *
 * Run on node:sqlite. No live branch. The HQ-held door is not built here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import moderation from '../src/routes/spinout_moderation.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { MODERATION_AWAITING_SQL } from '../src/services/moderationOpen.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d448-0123456789-abcdef';
const ADMIN_ID = 7;
const PEER_ID = 11;
const MEMBER_ID = 8;
const FROZEN_ID = 12;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl('users'));
  db.exec(`CREATE TABLE spinout_moderation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    summary TEXT,
    details TEXT,
    lab_access_before INTEGER,
    lab_access_after INTEGER,
    opened_by INTEGER NOT NULL,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_by INTEGER,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    actor TEXT,
    user_id INTEGER
  )`);
  db.exec(`CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY)`);
  db.exec(`CREATE TABLE admin_notices (
    uid TEXT, user_id INTEGER, subject TEXT, respond_by TEXT, status TEXT
  )`);
  const u = db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, spinout_lab_active) VALUES (?, ?, ?, ?, 1, ?)`,
  );
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test', 1);
  u.run(PEER_ID, 'admin', 'Peer Admin', 'peer@example.test', 0);
  u.run(MEMBER_ID, 'founder', 'Member', 'member@example.test', 1);
  u.run(FROZEN_ID, 'admin', 'Frozen', 'frozen@example.test', 1);
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
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
    async batch(x: any[]) { return x; },
  };
}

function envOf(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any;
}

async function jwt(userId: number) {
  return new SignJWT({ user_id: userId })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  db: InstanceType<typeof DatabaseSync>,
  userId: number,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await jwt(userId)}`);
  const res = await moderation.fetch(
    new Request(`http://x${path}`, { ...init, headers }),
    envOf(db),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function post(db: InstanceType<typeof DatabaseSync>, userId: number, target: number, body: Record<string, unknown>) {
  return call(db, userId, `/${target}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('a plain admin cannot reinstate a peer admin, and nothing is written', async () => {
  const db = freshDb();
  const r = await post(db, ADMIN_ID, PEER_ID, { action: 'reinstate', reason_code: 'other', severity: 'low' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'super_admin_required');
  assert.match(r.body.message, /super admin/i);
  assert.equal(r.body.detail, r.body.message);
  const lab = db.prepare('SELECT spinout_lab_active FROM users WHERE id = ?').get(PEER_ID) as { spinout_lab_active: number };
  assert.equal(lab.spinout_lab_active, 0);
  const cases = db.prepare('SELECT COUNT(*) AS n FROM spinout_moderation_cases').get() as { n: number };
  assert.equal(cases.n, 0);
  const audits = db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as { n: number };
  assert.equal(audits.n, 0);
});

test('a decision records the actor and the target, and the caller can still read their own history', async () => {
  const db = freshDb();
  const acted = await post(db, ADMIN_ID, MEMBER_ID, { action: 'flag', reason_code: 'spam', severity: 'high' });
  assert.equal(acted.status, 200, JSON.stringify(acted.body));
  const row = db.prepare(
    `SELECT action, details, actor, user_id FROM activity_logs WHERE action = 'spinout_moderation'`,
  ).get() as { action: string; details: string; actor: string; user_id: number };
  assert.ok(row, 'the decision wrote no activity_logs row');
  assert.equal(row.user_id, ADMIN_ID);
  assert.match(row.actor, /^[0-9a-f]{16}$/);
  const details = JSON.parse(row.details);
  assert.equal(details.target_user_id, MEMBER_ID);
  assert.equal(Object.hasOwn(details, 'user_id'), false);
  const audit = db.prepare(
    `SELECT admin_user_id, viewed_user_id, action FROM admin_audit_log WHERE action = 'spinout_moderation'`,
  ).get() as { admin_user_id: number; viewed_user_id: number; action: string };
  assert.equal(audit.admin_user_id, ADMIN_ID);
  assert.equal(audit.viewed_user_id, MEMBER_ID);

  const own = await call(db, ADMIN_ID, `/${ADMIN_ID}`);
  assert.equal(own.status, 200);
  const peer = await call(db, ADMIN_ID, `/${PEER_ID}`);
  assert.equal(peer.status, 403);
  assert.equal(peer.body.error, 'super_admin_required');
  assert.equal(peer.body.cases, undefined);
});

test('a frozen admin cannot post, and closing a sanction does not reinstate', async () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO admin_notices (uid, user_id, subject, respond_by, status)
     VALUES ('n-frozen', ?, 'Fees', '2020-01-01 00:00:00', 'overdue')`,
  ).run(FROZEN_ID);
  const frozen = await post(db, FROZEN_ID, MEMBER_ID, { action: 'suspend', reason_code: 'abuse', severity: 'high' });
  assert.equal(frozen.status, 423);
  assert.equal(frozen.body.code, 'admin_frozen');
  const none = db.prepare('SELECT COUNT(*) AS n FROM spinout_moderation_cases').get() as { n: number };
  assert.equal(none.n, 0);

  const suspended = await post(db, ADMIN_ID, MEMBER_ID, { action: 'suspend', reason_code: 'abuse', severity: 'high' });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
  const off = db.prepare('SELECT spinout_lab_active FROM users WHERE id = ?').get(MEMBER_ID) as { spinout_lab_active: number };
  assert.equal(off.spinout_lab_active, 0);
  const closed = await post(db, ADMIN_ID, MEMBER_ID, { action: 'close', reason_code: 'other', severity: 'low' });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const still = db.prepare('SELECT spinout_lab_active FROM users WHERE id = ?').get(MEMBER_ID) as { spinout_lab_active: number };
  assert.equal(still.spinout_lab_active, 0);
  const open = db.prepare(
    `SELECT COUNT(*) AS n FROM spinout_moderation_cases WHERE resolved_at IS NULL`,
  ).get() as { n: number };
  assert.equal(open.n, 0);

  const list = await call(db, ADMIN_ID, '/');
  assert.equal(list.body.open_count, 0);
  assert.equal(list.body.sanctions_count, 0);
});

test('the console open count and the approvals lane agree on a flag, not on an ejection', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO spinout_moderation_cases
       (user_id, status, reason_code, severity, opened_by, created_at, resolved_at)
     VALUES (?, ?, 'spam', 'medium', ?, ?, ?)`,
  );
  ins.run(MEMBER_ID, 'under_review', ADMIN_ID, '2026-09-01 00:00:00', null);
  ins.run(MEMBER_ID, 'suspended', ADMIN_ID, '2026-09-02 00:00:00', null);
  ins.run(MEMBER_ID, 'ejected', ADMIN_ID, '2026-09-03 00:00:00', null);
  ins.run(MEMBER_ID, 'under_review', ADMIN_ID, '2026-08-01 00:00:00', '2026-08-02 00:00:00');
  const list = await call(db, ADMIN_ID, '/');
  assert.equal(list.status, 200);
  assert.equal(list.body.open_count, 1);
  assert.equal(list.body.sanctions_count, 2);
  const direct = db.prepare(
    `SELECT COUNT(*) AS n FROM spinout_moderation_cases WHERE ${MODERATION_AWAITING_SQL}`,
  ).get() as { n: number };
  assert.equal(direct.n, list.body.open_count);
  const lane = APPROVAL_SOURCES.find((s) => s.key === 'moderation');
  assert.ok(lane);
  const laneCount = db.prepare(lane.countSql).get() as { n: number };
  assert.equal(laneCount.n, list.body.open_count);
  assert.equal(lane.countSql.includes(MODERATION_AWAITING_SQL), true);
});
