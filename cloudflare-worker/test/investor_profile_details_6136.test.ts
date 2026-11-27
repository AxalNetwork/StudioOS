/** #6136: a Settings save of one onboarding field leaves the other onboarding fields as stored. */
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

const onboarding = {
  investor_type: 'angel', sectors: ['Fintech'], stages: ['Seed'], ticket_band: '10k_50k',
  firm_name: 'Old Fund', accreditation_status: 'accredited', country: 'Canada', lp_intent: 'maybe', lp_target_usd: 100000,
};
const DETAILS = ['firm_name', 'accreditation_status', 'country', 'lp_intent', 'lp_target_usd'] as const;

test('each onboarding field can be corrected alone without blanking the others', async () => {
  const edits: Record<string, unknown> = {
    firm_name: 'New Fund', accreditation_status: 'qp', country: 'France', lp_intent: 'deal_only', lp_target_usd: 250000,
  };
  for (const key of DETAILS) {
    const { env } = fixture();
    assert.equal((await call(env, 'PUT', path, onboarding)).status, 200);
    // What the Settings card sends: the full-replace thesis columns plus the one field.
    const saved = await call(env, 'PUT', path, { investor_type: 'angel', sectors: ['Fintech'], stages: ['Seed'], ticket_band: '10k_50k', [key]: edits[key] });
    assert.equal(saved.status, 200);
    for (const other of DETAILS) {
      assert.equal(saved.body.profile[other], other === key ? edits[key] : (onboarding as any)[other], `${key} save → ${other}`);
    }
    assert.deepEqual((await call(env, 'GET', path)).body.profile.country, key === 'country' ? 'France' : 'Canada');
  }
});

test('a blank value sent for one field clears only that field', async () => {
  const { env } = fixture();
  await call(env, 'PUT', path, onboarding);
  const saved = await call(env, 'PUT', path, { investor_type: 'angel', sectors: ['Fintech'], stages: ['Seed'], ticket_band: '10k_50k', lp_target_usd: null, firm_name: null });
  assert.equal(saved.body.profile.lp_target_usd, null);
  assert.equal(saved.body.profile.firm_name, null);
  assert.equal(saved.body.profile.country, 'Canada');
  assert.equal(saved.body.profile.accreditation_status, 'accredited');
  assert.equal(saved.body.profile.lp_intent, 'maybe');
});
