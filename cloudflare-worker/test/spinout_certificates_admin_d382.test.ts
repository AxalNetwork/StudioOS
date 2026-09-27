/**
 * D382 — the certificate registry's admin routes, as the admin tab uses them.
 *
 * Driven against the real Hono route (`routes/spinout_certificates.ts`) and
 * real `node:sqlite` (every table from `schema_baseline.sql`), with a minted
 * admin JWT. What is pinned:
 *
 *   1. Issue with only `user_id` builds the credential from the graduate's own
 *      records (the graduation path), attributes it to the admin, and logs it.
 *   2. Each refusal is a code and our sentence: not_graduated, and
 *      reissue_blocked for a graduate whose revoked credential holds the id.
 *   3. Revoke needs a reason, and records who revoked.
 *   4. The list returns who issued each row, and the graduates with no
 *      certificate at all — the queue the tab's Issue buttons act on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import certificates from '../src/routes/spinout_certificates.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_ID = 900;
const GRAD_ID = 117;
const OTHER_GRAD_ID = 118;
const NON_GRAD_ID = 119;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'spinout_lab_milestones', 'activity_logs', 'spinout_applications',
    'projects', 'user_spinout_flags', 'spinout_certificates']) db.exec(ddl(t));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test');
  u.run(GRAD_ID, 'founder', 'Ada Graduate', 'ada@example.test');
  u.run(OTHER_GRAD_ID, 'founder', 'Bo Graduate', 'bo@example.test');
  u.run(NON_GRAD_ID, 'founder', 'Cy Midway', 'cy@example.test');
  const m = db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, ?, ?, ?)`);
  m.run(GRAD_ID, 4, 'incorporation_completed', '2026-07-31 14:00:00');
  m.run(OTHER_GRAD_ID, 4, 'incorporation_completed', '2026-08-02 10:00:00');
  m.run(NON_GRAD_ID, 1, 'project_created', '2026-07-02 10:00:00');
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

async function call(db: InstanceType<typeof DatabaseSync>, path: string, init: RequestInit = {}, role = 'admin') {
  const jwt = await new SignJWT({ user_id: role === 'admin' ? ADMIN_ID : GRAD_ID, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await certificates.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const post = (db: any, path: string, body: unknown, role?: string) =>
  call(db, path, { method: 'POST', body: JSON.stringify(body) }, role);
const logs = (db: InstanceType<typeof DatabaseSync>, action: string) =>
  db.prepare(`SELECT * FROM activity_logs WHERE action = ?`).all(action) as any[];

// ---------------------------------------------------------------------------

test('issue with only user_id builds the credential from the graduate’s records, attributed to the admin', async () => {
  const db = freshDb();
  const r = await post(db, '/certificates', { user_id: GRAD_ID });
  assert.equal(r.status, 201);
  assert.equal(r.body.outcome, 'issued');
  assert.equal(r.body.certificate.public_name, 'Ada Graduate', 'the name came from somewhere other than the record');
  assert.equal(r.body.certificate.public_issued_on, '2026-07-31', 'the date is the milestone’s, not today');
  const row = db.prepare(`SELECT issued_by_user_id FROM spinout_certificates WHERE user_id = ?`).get(GRAD_ID) as any;
  assert.equal(row.issued_by_user_id, ADMIN_ID, 'an admin issue was not attributed to the admin');
  const l = logs(db, 'spinout_certificate_issued');
  assert.equal(l.length, 1, 'the issue was not recorded in the admin log');
  assert.equal(JSON.parse(l[0].details).target_user_id, GRAD_ID);
  assert.equal(l[0].user_id, ADMIN_ID);
});

test('issuing twice returns the existing credential and logs nothing new', async () => {
  const db = freshDb();
  await post(db, '/certificates', { user_id: GRAD_ID });
  const r = await post(db, '/certificates', { user_id: GRAD_ID });
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, 'already_issued');
  assert.equal(logs(db, 'spinout_certificate_issued').length, 1);
});

test('a founder who did not graduate is refused with a code and our sentence', async () => {
  const db = freshDb();
  const r = await post(db, '/certificates', { user_id: NON_GRAD_ID });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'not_graduated');
  assert.match(r.body.message, /incorporation_completed/);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_certificates`).get().n, 0);
});

test('revoke needs a reason, and records who revoked', async () => {
  const db = freshDb();
  const issued = await post(db, '/certificates', { user_id: GRAD_ID });
  const id = issued.body.certificate.id;
  const bare = await post(db, `/certificates/${id}/revoke`, {});
  assert.equal(bare.status, 400);
  assert.equal(bare.body.error, 'reason_required');
  assert.equal((db.prepare(`SELECT status FROM spinout_certificates WHERE id = ?`).get(id) as any).status, 'issued',
    'a revoke without a reason still revoked');
  const r = await post(db, `/certificates/${id}/revoke`, { reason: 'Company withdrew from the cohort' });
  assert.equal(r.status, 200);
  assert.equal(r.body.certificate.status, 'revoked');
  const l = logs(db, 'spinout_certificate_revoked');
  assert.equal(l.length, 1, 'the revocation was not recorded');
  assert.equal(JSON.parse(l[0].details).reason, 'Company withdrew from the cohort');
  // Revoking an already-revoked row logs nothing further.
  await post(db, `/certificates/${id}/revoke`, { reason: 'Again' });
  assert.equal(logs(db, 'spinout_certificate_revoked').length, 1);
});

test('issuing after a revoke is refused as reissue_blocked, not reported as already issued', async () => {
  const db = freshDb();
  const issued = await post(db, '/certificates', { user_id: GRAD_ID });
  await post(db, `/certificates/${issued.body.certificate.id}/revoke`, { reason: 'Issued in error' });
  const r = await post(db, '/certificates', { user_id: GRAD_ID });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'reissue_blocked');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM spinout_certificates`).get().n, 1, 'a second row was written');
});

test('the manual issue path refuses the same collision instead of throwing', async () => {
  const db = freshDb();
  const issued = await post(db, '/certificates', { user_id: GRAD_ID });
  await post(db, `/certificates/${issued.body.certificate.id}/revoke`, { reason: 'Issued in error' });
  const r = await post(db, '/certificates', {
    user_id: GRAD_ID, conferred_at: '2026-07-31', public_name: 'Ada Graduate', public_cohort: null,
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'reissue_blocked');
});

test('the list names who issued each row and the graduates still waiting', async () => {
  const db = freshDb();
  await post(db, '/certificates', { user_id: GRAD_ID });
  const r = await call(db, '/certificates');
  assert.equal(r.status, 200);
  assert.equal(r.body.certificates.length, 1);
  assert.equal(r.body.certificates[0].issued_by_name, 'Admin One');
  assert.deepEqual(r.body.awaiting.map((a: any) => a.user_id), [OTHER_GRAD_ID],
    'the queue is not exactly the graduates with no certificate');
  assert.equal(r.body.awaiting[0].name, 'Bo Graduate');
  assert.equal(r.body.eligible_total, 2);
  assert.deepEqual(r.body.unavailable, {});
});

test('a graduate with a revoked credential is not in the Issue queue', async () => {
  const db = freshDb();
  const issued = await post(db, '/certificates', { user_id: GRAD_ID });
  await post(db, `/certificates/${issued.body.certificate.id}/revoke`, { reason: 'Issued in error' });
  const r = await call(db, '/certificates');
  assert.ok(!r.body.awaiting.some((a: any) => a.user_id === GRAD_ID),
    'a revoked graduate is offered an Issue that would collide');
});

test('an unreadable graduate list is reported, never an empty queue', async () => {
  const db = freshDb();
  db.exec('DROP TABLE spinout_lab_milestones');
  const r = await call(db, '/certificates');
  assert.equal(r.status, 200);
  assert.equal(r.body.awaiting, null);
  assert.equal(r.body.eligible_total, null);
  assert.ok(r.body.unavailable.awaiting, 'the failure has no reason on the wire');
});

test('every admin route still refuses a founder', async () => {
  const db = freshDb();
  assert.equal((await call(db, '/certificates', {}, 'founder')).status, 403);
  assert.equal((await post(db, '/certificates', { user_id: GRAD_ID }, 'founder')).status, 403);
  assert.equal((await post(db, '/certificates/1/revoke', { reason: 'x' }, 'founder')).status, 403);
});
