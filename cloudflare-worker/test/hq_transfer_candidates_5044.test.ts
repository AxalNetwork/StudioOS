/**
 * D5044 (#5044) — the Super Admin transfer picker has its own read, filtered on the server.
 *
 * `GET /api/admin/super-admins/candidates` answers who the elevation may be handed to: active
 * administrators who do not hold it, with only the fields the picker draws. It replaces the
 * holder console's use of HQ Team's whole supervision read (`GET /api/admin/hq/admins`).
 *
 * The tables come from the baseline, verbatim (the D221 pattern, as the 5040 suite does).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_transfer_candidates_5044.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import superAdmins from '../src/routes/admin_super_admins.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 801;

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

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'Holder Hart', 'holder@axal.example', 1);
  u.run(802, 'admin', 'Sam Successor', 'sam@axal.example', 1);
  u.run(803, 'admin', 'Una Upper', 'upper@axal.example', 1);
  u.run(804, 'admin', 'Dora Deactivated', 'dora@axal.example', 0);
  u.run(805, 'founder', 'Fran Founder', 'fran@example.com', 1);
  u.run(806, 'admin', 'Second Holder', 'second@axal.example', 1);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(806);
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
              VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`).run(`totp-${HOLDER}`, HOLDER);
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
              VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`).run('totp-802', 802);
  return db;
}

async function get(db: InstanceType<typeof DatabaseSync>, actor: number, path: string) {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin', jti: `totp-${actor}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await superAdmins.fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

test('candidates are the active administrators who do not hold the elevation, picker fields only', async () => {
  const r = await get(freshDb(), HOLDER, '/candidates');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.candidates.map((c: any) => c.id).sort(), [802, 803],
    'the server offered a holder, a deactivated admin or a non-admin');
  for (const c of r.body.candidates) {
    assert.deepEqual(Object.keys(c).sort(), ['email', 'id', 'name'],
      'the picker read carries more than the picker draws');
  }
});

test('the candidate read is the Super Admin\'s, like the holder read beside it', async () => {
  const r = await get(freshDb(), 802, '/candidates');
  // The router alone has no global handler (index.ts maps 'Super admin required' to 403), so the
  // gate's throw surfaces as a non-200 here. What matters is that nothing is listed.
  assert.notEqual(r.status, 200);
  assert.equal(r.body?.candidates, undefined);
});

test('the holder read is unchanged: every holder, active or not', async () => {
  const r = await get(freshDb(), HOLDER, '/');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.holders.map((h: any) => h.id), [HOLDER, 806]);
});
