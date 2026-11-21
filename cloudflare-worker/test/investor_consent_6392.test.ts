/** #6392: a partial profile save cannot reset recorded Investor Signals consent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES
    (1, 'admin', 'Admin', 'admin@example.test', 1),
    (2, 'investor', 'Investor', 'investor@example.test', 1),
    (3, 'advisor', 'Advisor', 'advisor@example.test', 1),
    (4, 'founder', 'Founder', 'founder@example.test', 1);
    INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
      VALUES (1, 'admin-totp', 'totp', 'totp', datetime('now'));`);
  return { db, env: { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any };
}
async function call(env: any, method: string, path: string, body?: unknown, userId = 2) {
  const token = await new SignJWT({ user_id: userId, ...(userId === 1 ? { jti: 'admin-totp' } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await withThrownResponses(() => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env, { waitUntil() {}, passThroughOnException() {} } as any));
  return { status: response.status, body: await response.json() as any };
}

import { investorProfile } from '../src/routes/investor_signals.ts';
const app = new Hono<any>(); app.route('/api/investor-profile', investorProfile);
const path = '/api/investor-profile/me';

test('an omitted contribution preserves an opt-out in both the stored profile and readback', async () => {
  const { db, env } = fixture();
  try {
    assert.equal((await call(env, 'PUT', path, { contribute_to_signals: false })).status, 200);
    const saved = await call(env, 'PUT', path, { thesis_text: 'Climate infrastructure' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profile.contribute_to_signals, false);
    assert.equal((await call(env, 'GET', path)).body.profile.contribute_to_signals, false);
    assert.equal((db.prepare('SELECT contribute_to_signals FROM investor_profiles WHERE user_id = 2').get() as any).contribute_to_signals, 0);
    const logs = db.prepare("SELECT details FROM activity_logs WHERE action = 'investor_profile_updated' ORDER BY id DESC").all() as any[];
    assert.match(logs[0].details, /contribute=unchanged/);
  } finally { db.close(); }
});

test('only a new profile defaults to contributing; explicit false and true still update consent', async () => {
  const { db, env } = fixture();
  try {
    assert.equal((await call(env, 'PUT', path, {})).body.profile.contribute_to_signals, true);
    assert.equal((await call(env, 'PUT', path, { contribute_to_signals: false })).body.profile.contribute_to_signals, false);
    assert.equal((await call(env, 'PUT', path, { contribute_to_signals: true })).body.profile.contribute_to_signals, true);
    assert.equal((await call(env, 'PUT', path, { firm_name: 'Example Fund' })).body.profile.contribute_to_signals, true);
    assert.equal((await call(env, 'POST', `${path}/opt-out`, {})).status, 200);
    assert.equal((await call(env, 'PUT', path, {})).body.profile.contribute_to_signals, false);
  } finally { db.close(); }
});

test('an omitted save also preserves an opt-out that reaches the database just before its upsert', async () => {
  const { db, env } = fixture();
  try {
    await call(env, 'PUT', path, { contribute_to_signals: true });
    const original = env.DB;
    env.DB = { ...original, prepare(sql: string) {
      const statement = original.prepare(sql);
      if (!sql.includes('INSERT INTO investor_profiles')) return statement;
      const run = statement.run;
      statement.run = async () => {
        db.exec('UPDATE investor_profiles SET contribute_to_signals = 0 WHERE user_id = 2');
        return run();
      };
      return statement;
    } };
    const saved = await call(env, 'PUT', path, { firm_name: 'Example Fund' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.profile.contribute_to_signals, false);
  } finally { db.close(); }
});
