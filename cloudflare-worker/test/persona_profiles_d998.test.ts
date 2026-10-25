/** D998: public taxonomy and Advisor onboarding on the mounted Worker and real SQLite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import route from '../src/routes/personas.ts';
import { CATALOG, loadChecklist } from '../src/services/onboardingChecklist.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
const SECRET = 'test'.repeat(16);
const app = new Hono<any>(); app.route('/api/personas', route);
app.onError((err, c) => c.json({ detail: err.message }, AUTH_ERROR_STATUSES[err.message] ?? 500));
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'super_admins']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  // D1000: sign-up reads each segment's status from migration 559's store.
  db.exec(readFileSync(new URL('../sql/migrations/559_segment_profiles.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO users(id,email,name,role,is_active) VALUES(1,'advisor@example.test','Synthetic advisor','advisor',1)");
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
async function request(env: any, method: string, path: string, body?: unknown, signed = true) {
  const token = await new SignJWT({ user_id: 1, role: 'advisor' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  return app.request('/api/personas' + path, { method, headers: { ...(signed ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}
test('taxonomy serves all five current profiles without the retired role_alignment field', async () => {
  const { db, env } = fixture();
  try {
    const response = await request(env, 'GET', '/taxonomy', undefined, false); assert.equal(response.status, 200);
    const { personas } = await response.json() as any; assert.equal(personas.length, 12);
    const counts: Record<string, number> = {}; for (const p of personas) { counts[p.profile] = (counts[p.profile] ?? 0) + 1; assert.equal('role_alignment' in p, false); }
    assert.deepEqual(counts, { investor: 6, exploring: 2, founder: 2, advisor: 1, partner: 1 });
  } finally { db.close(); }
});
test('Advisor persona completion creates the detected row without changing account role; guards remain enforced', async () => {
  const { db, env } = fixture();
  try {
    assert.equal(CATALOG.advisor.find(x => x.key === 'mt.persona')?.route, '/onboarding/persona');
    assert.equal((await request(env, 'POST', '/finalize', { persona_id: 'operator_advisor' }, false)).status, 401);
    assert.equal((await request(env, 'GET', '/admin/list')).status, 403);
    assert.equal((await request(env, 'POST', '/finalize', { persona_id: 'invalid' })).status, 400);
    const before = await loadChecklist(env, { id: 1, role: 'advisor' });
    assert.equal(before.items.find(x => x.key === 'mt.persona')?.status, 'pending');
    const r = await request(env, 'POST', '/finalize', { persona_id: 'operator_advisor', confidence: 1, source: 'self_select' }); assert.equal(r.status, 200);
    assert.equal((db.prepare('SELECT persona_id FROM user_personas WHERE user_id=1 AND is_primary=1').get() as any).persona_id, 'operator_advisor');
    assert.equal((db.prepare('SELECT role FROM users WHERE id=1').get() as any).role, 'advisor');
    const after = await loadChecklist(env, { id: 1, role: 'advisor' });
    assert.equal(after.items.find(x => x.key === 'mt.persona')?.status, 'completed');
    assert.equal((await request(env, 'POST', '/finalize', { persona_id: 'angel_scout', source: 'self_select' })).status, 200);
    assert.equal((db.prepare('SELECT role FROM users WHERE id=1').get() as any).role, 'advisor', 'a different-profile segment is descriptive, not a role grant');
  } finally { db.close(); }
});
