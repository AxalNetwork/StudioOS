/**
 * D4800 (#4800, second slice) — `GET /api/admin/security/overview` names the
 * administrators without a second factor, by the same predicate as its count,
 * so the Overview's MFA finding can say who (open question A's A2).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/security_overview_mfa_names_4800.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminSecurity from '../src/routes/admin_security.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['d4800', 'overview', 'fixture', 'secret'].join('-');
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function harness() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, tfa_methods) VALUES (?, ?, ?, ?, ?, ?)');
  u.run(1, 'admin', 'Sue Super', 'sue@example.test', 1, '["totp"]');
  u.run(2, 'admin', 'Ada Admin', 'ada@example.test', 1, '[]');
  u.run(3, 'admin', 'Bo Blank', 'bo@example.test', 1, '[]');
  u.run(4, 'admin', 'Ivy Inactive', 'ivy@example.test', 0, '[]');
  u.run(5, 'founder', 'Fay Founder', 'fay@example.test', 1, '[]');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (1)').run();
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (1, 's-1', 'totp', 'totp', ?)").run(sqlNow());
  const app = new Hono<any>();
  app.route('/api/admin/security', adminSecurity);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.example.test', DB: d1Over(db) };
  async function get(path: string) {
    const token = await new SignJWT({ user_id: 1, jti: 's-1' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, env));
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  return { db, get };
}

test('the MFA part names exactly the active administrators the count says lack a second factor', async () => {
  // Mutations checked: the list read without `is_active = 1`; the list read with the opposite predicate.
  const { get } = harness();
  const ov = await get('/api/admin/security/overview');
  assert.equal(ov.status, 200, JSON.stringify(ov.body));
  const mfa = ov.body.mfa;
  assert.equal(mfa.available, true);
  assert.equal(mfa.admins_total, 3);
  assert.equal(mfa.admins_with_mfa, 1);
  assert.deepEqual(mfa.admins_without_mfa, [
    { id: 2, name: 'Ada Admin', email: 'ada@example.test' },
    { id: 3, name: 'Bo Blank', email: 'bo@example.test' },
  ]);
  assert.equal(mfa.admins_without_mfa.length, mfa.admins_total - mfa.admins_with_mfa, 'the names and the count agree');
});
