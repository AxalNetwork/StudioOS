/**
 * D255 — the persona retag route names its subject, batches its writes, and
 * refuses a target that joins to nobody.
 *
 * `POST /api/personas/admin/:user_id/retag` used to: (1) trust `user_id`
 * with no existence check — `user_personas` has no foreign key — so a retag
 * against a made-up id wrote a row that referenced nobody; (2) make two
 * separate D1 writes rather than one batch; (3) never read the row's
 * previous persona, so its audit row could not say what changed FROM; and
 * (4) record the audit as `INSERT INTO activity_logs (..., user_id)` with
 * `user_id` holding the ADMIN's id — the target reachable only inside
 * free-text `details`, unqueryable by who was retagged.
 *
 * Driven against the real Hono route (`routes/personas.ts`) and real
 * `node:sqlite` (schema from `schema_baseline.sql`), with a minted admin JWT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import personas from '../src/routes/personas.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_ID = 910;
const SUPER_ADMIN_ID = 911;
const TARGET_ID = 920;
const OTHER_ADMIN_ID = 930;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(ddl('users'));
  db.exec(ddl('user_personas'));
  db.exec(ddl('activity_logs'));
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Holder', 'holder@example.test', 1)`,
  ).run(ADMIN_ID);
  return db;
}

// `super_admins` isn't declared before this point — create it separately so
// freshDb() can seed a super admin without every test needing the elevation.
function ensureSuperAdminsTable(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`CREATE TABLE IF NOT EXISTS super_admins (user_id INTEGER PRIMARY KEY)`);
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
    async batch(stmts: any[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

async function adminToken(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: InstanceType<typeof DatabaseSync>, asUserId: number, path: string, body: unknown) {
  const jwt = await adminToken(asUserId);
  const res = await personas.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body: json };
}

test('retag: an unknown target is refused with 404, and nothing is written anywhere', async () => {
  const db = freshDb();
  ensureSuperAdminsTable(db);
  const { status, body } = await call(db, ADMIN_ID, `/admin/999999/retag`, { persona_id: 'founder_new' });
  assert.equal(status, 404);
  assert.equal(body.error, 'user_not_found');
  const rows = db.prepare('SELECT * FROM user_personas').all();
  assert.deepEqual(rows, [], 'a refused retag must not insert a user_personas row');
  const logs = db.prepare('SELECT * FROM activity_logs').all();
  assert.deepEqual(logs, [], 'a refused retag must not write an audit row');
});

test('retag: writes the persona and exactly one activity_logs row naming the target, with from/to', async () => {
  const db = freshDb();
  ensureSuperAdminsTable(db);
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', 'Target', 'target@example.test', 1)`)
    .run(TARGET_ID);
  db.prepare(
    `INSERT INTO user_personas (user_id, persona_id, is_primary) VALUES (?, 'founder_new', 1)`,
  ).run(TARGET_ID);

  const { status, body } = await call(db, ADMIN_ID, `/admin/${TARGET_ID}/retag`, { persona_id: 'operator_advisor' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const primary: any = db.prepare(
    `SELECT persona_id FROM user_personas WHERE user_id = ? AND is_primary = 1`,
  ).get(TARGET_ID);
  assert.equal(primary.persona_id, 'operator_advisor');

  const logs: any[] = db.prepare(
    `SELECT * FROM activity_logs WHERE action = 'persona_retagged' AND entity_type = 'user'`,
  ).all();
  assert.equal(logs.length, 1, 'exactly one persona_retagged audit row naming a user entity');
  assert.equal(logs[0].entity_id, String(TARGET_ID));
  const meta = JSON.parse(logs[0].metadata);
  assert.equal(meta.from, 'founder_new');
  assert.equal(meta.to, 'operator_advisor');
});

test('retag: to the same persona already stored writes nothing', async () => {
  const db = freshDb();
  ensureSuperAdminsTable(db);
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', 'Target', 'target@example.test', 1)`)
    .run(TARGET_ID);
  db.prepare(
    `INSERT INTO user_personas (user_id, persona_id, is_primary) VALUES (?, 'founder_new', 1)`,
  ).run(TARGET_ID);

  const { status, body } = await call(db, ADMIN_ID, `/admin/${TARGET_ID}/retag`, { persona_id: 'founder_new' });
  assert.equal(status, 200);
  assert.equal(body.unchanged, true);

  const rows = db.prepare('SELECT * FROM user_personas').all();
  assert.equal(rows.length, 1, 'no second row and no re-write of the existing one');
  const logs = db.prepare(`SELECT * FROM activity_logs WHERE action = 'persona_retagged'`).all();
  assert.deepEqual(logs, [], 'a no-op retag must not write an audit row');
});

test('retag: an admin target is refused for a peer admin, and allowed for a super admin', async () => {
  const db = freshDb();
  ensureSuperAdminsTable(db);
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Other Admin', 'other@example.test', 1)`)
    .run(OTHER_ADMIN_ID);

  const peer = await call(db, ADMIN_ID, `/admin/${OTHER_ADMIN_ID}/retag`, { persona_id: 'founder_new' });
  assert.equal(peer.status, 403);
  assert.equal(peer.body.code, 'super_admin_required');
  assert.deepEqual(db.prepare('SELECT * FROM user_personas').all(), [],
    'a refused admin-target retag must not write a persona row');

  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Super', 'super@example.test', 1)`)
    .run(SUPER_ADMIN_ID);
  db.prepare(`INSERT INTO super_admins (user_id) VALUES (?)`).run(SUPER_ADMIN_ID);
  const asSuper = await call(db, SUPER_ADMIN_ID, `/admin/${OTHER_ADMIN_ID}/retag`, { persona_id: 'founder_new' });
  assert.equal(asSuper.status, 200);
});
