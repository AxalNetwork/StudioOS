/**
 * D470 — a reviewer on a board item, and the reads that must stay honest.
 *
 * A missing assignment table is unreadable, not "nobody assigned". A reviewer
 * is an active admin. The same person assigned again does not append another
 * event. Suspension gates the write and not the history read.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/approval_assignments_d470.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import branchApprovalRoutes from '../src/routes/branch_approvals.ts';
import branchApprovalAssignmentRoutes from '../src/routes/branch_approval_assignments.ts';
import { ASSIGNMENTS_UNREADABLE } from '../src/services/approvalAssignments.ts';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIG_341 = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/migrations/341_approval_assignments.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    name TEXT,
    email TEXT,
    jwt_min_iat INTEGER
  );
  CREATE TABLE branch_licence (
    id INTEGER PRIMARY KEY,
    status TEXT,
    suspended_at TEXT,
    suspended_note TEXT
  );
  CREATE TABLE job_postings (
    id INTEGER PRIMARY KEY,
    host_user_id INTEGER,
    title TEXT,
    status TEXT,
    created_at TEXT
  );
  CREATE TABLE activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    details TEXT,
    actor TEXT,
    user_id INTEGER
  );
`;

function freshDb(withAssignments = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(SCHEMA);
  if (withAssignments) db.exec(MIG_341);
  db.exec(`
    INSERT INTO users (id, role, is_active, name, email) VALUES
      (1, 'admin', 1, 'Ada Admin', 'ada@fr.example'),
      (2, 'admin', 1, 'Bea Admin', 'bea@fr.example'),
      (3, 'admin', 1, 'Cy Admin', 'cy@fr.example'),
      (4, 'founder', 1, 'Fay Founder', 'fay@fr.example'),
      (5, 'admin', 0, 'Ian Inactive', 'ian@fr.example');
    INSERT INTO branch_licence (id, status) VALUES (1, 'active');
    INSERT INTO job_postings (id, host_user_id, title, status, created_at) VALUES
      (10, 1, 'Open role', 'pending_review', '2020-01-01 00:00:00'),
      (11, 1, 'Live role', 'published', '2020-01-01 00:00:00');
  `);
  return db;
}

async function token(userId: number) {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function client(db: InstanceType<typeof DatabaseSync>) {
  const env = { DB: d1Over(db), BRANCH_CODE: 'fr', JWT_SECRET };
  const app = new Hono<any>();
  app.route('/api/branch', branchApprovalRoutes);
  app.route('/api/branch', branchApprovalAssignmentRoutes);
  return async (path: string, init: RequestInit = {}, userId: number | null = 1) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId !== null) headers.Authorization = `Bearer ${await token(userId)}`;
    const res = await app.request(`/api/branch${path}`, { ...init, headers }, env);
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: res.status, body };
  };
}

function postAssign(
  call: (path: string, init?: RequestInit, userId?: number | null) => Promise<{ status: number; body: any }>,
  body: unknown,
  userId = 1,
) {
  return call('/approvals/assignments', { method: 'POST', body: JSON.stringify(body) }, userId);
}

test('a missing assignment table is unreadable, and the items do not say nobody is assigned', async () => {
  const db = freshDb(false);
  const call = client(db);
  const got = await call('/approvals');
  assert.equal(got.status, 200);
  assert.equal(got.body.assignments.available, false);
  assert.equal(got.body.assignments.reason, ASSIGNMENTS_UNREADABLE);
  assert.equal(/no such table/i.test(String(got.body.assignments.reason)), false);
  const job = (got.body.items || []).find((it: any) => it.lane === 'jobs' && it.id === 10);
  assert.ok(job, 'the open job left the board');
  assert.equal(Object.prototype.hasOwnProperty.call(job, 'assignee'), false);
  const posted = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: 10 }],
  });
  assert.equal(posted.status, 503);
  assert.equal(posted.body.error, 'assignments_unreadable');
  assert.equal(posted.body.message, ASSIGNMENTS_UNREADABLE);
  assert.equal(/no such table/i.test(String(posted.body.message)), false);
});

test('assignment names an active admin, records one event, and refuses everyone else', async () => {
  const db = freshDb(true);
  const call = client(db);

  const board = await call('/approvals');
  assert.equal(board.status, 200);
  assert.equal(board.body.assignments.available, true);
  assert.equal(board.body.decides, false);
  const reviewerIds = (board.body.reviewers || []).map((r: any) => r.id).sort();
  assert.deepEqual(reviewerIds, [1, 2, 3]);
  const open = (board.body.items || []).find((it: any) => it.lane === 'jobs' && it.id === 10);
  assert.equal(open.assignee, null);

  const assigned = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: 10 }, { lane: 'jobs', item_id: 10 }],
  });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.assigned.length, 1);
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const assignee = () => (db.prepare('SELECT assignee_user_id FROM approval_assignments').get() as { assignee_user_id: number }).assignee_user_id;
  assert.equal(count('SELECT COUNT(*) AS n FROM approval_assignments'), 1);
  assert.equal(count('SELECT COUNT(*) AS n FROM approval_events'), 1);
  assert.equal(assignee(), 2);
  const log = db.prepare("SELECT action, details, user_id FROM activity_logs").all() as any[];
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'approval_assignment');
  assert.equal(log[0].user_id, 1);
  const details = JSON.parse(log[0].details);
  assert.equal(details.target_user_id, 2);
  assert.equal(details.lane, 'jobs');
  assert.equal(details.item_id, 10);

  const after = await call('/approvals');
  const row = (after.body.items || []).find((it: any) => it.lane === 'jobs' && it.id === 10);
  assert.equal(row.assignee.user_id, 2);
  assert.equal(row.assignee.name, 'Bea Admin');

  const history = await call('/approvals/history?lane=jobs&item_id=10');
  assert.equal(history.status, 200);
  assert.equal(history.body.available, true);
  assert.equal(history.body.items.length, 1);
  assert.equal(history.body.items[0].kind, 'assigned');
  assert.equal(history.body.items[0].assignee_name, 'Bea Admin');

  const again = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: 10 }],
  });
  assert.equal(again.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_events').get().n, 1);

  const moved = await postAssign(call, {
    assignee_user_id: 3,
    items: [{ lane: 'jobs', item_id: 10 }],
  });
  assert.equal(moved.status, 200);
  assert.equal(db.prepare('SELECT assignee_user_id FROM approval_assignments').get().assignee_user_id, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_events').get().n, 2);

  const founderCaller = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: 10 }],
  }, 4);
  assert.equal(founderCaller.status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_events').get().n, 2);

  const founderTarget = await postAssign(call, {
    assignee_user_id: 4,
    items: [{ lane: 'jobs', item_id: 10 }],
  });
  assert.equal(founderTarget.status, 400);
  assert.equal(founderTarget.body.error, 'not_a_reviewer');

  const inactive = await postAssign(call, {
    assignee_user_id: 5,
    items: [{ lane: 'jobs', item_id: 10 }],
  });
  assert.equal(inactive.status, 400);
  assert.equal(inactive.body.error, 'not_a_reviewer');

  const missing = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: 999 }],
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'not_on_board');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_assignments').get().n, 1);

  const asText = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: '10' }],
  });
  assert.equal(asText.status, 400);
  assert.equal(asText.body.error, 'bad_item');

  db.prepare("UPDATE branch_licence SET status = 'suspended', suspended_note = 'paused' WHERE id = 1").run();
  const frozen = await postAssign(call, {
    assignee_user_id: 2,
    items: [{ lane: 'jobs', item_id: 10 }],
  });
  assert.equal(frozen.status, 423);
  assert.equal(db.prepare('SELECT assignee_user_id FROM approval_assignments').get().assignee_user_id, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approval_events').get().n, 2);
  const whileSuspended = await call('/approvals/history?lane=jobs&item_id=10');
  assert.equal(whileSuspended.status, 200);
  assert.equal(whileSuspended.body.available, true);
  assert.equal(whileSuspended.body.items.length, 2);
});
