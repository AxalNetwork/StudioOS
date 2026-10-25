/** D1073 — an authenticated stale client gets 410, never a synthetic review.
 * Real SQLite captures any status/evidence change or schema bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import trust from '../src/routes/trust.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';

const app = new Hono<any>();
app.route('/api/trust', trust);
app.onError((e, c) => {
  if (e.message === 'Unauthorized') return c.json({ error: 'unauthorized' }, 401);
  throw e;
});
const keys = ['tos_v1', 'privacy_v1', 'founder_nda_v1', 'investor_nda_v1', 'mentor_nda_v1', 'mentor_disclaimer_v1', 'kyc_v1', 'accreditation_v1', 'kyb_v1', 'partner_msa_v1'];
function fixture(role = 'founder', withObligations = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  db.exec(tableFromBaseline(baseline, 'users'));
  db.prepare('INSERT INTO users (id,role,email,name,password_hash,is_active) VALUES (1,?,?,?,?,1)').run(role, 'synthetic@example.test', 'Synthetic member', 'synthetic-not-a-password-hash');
  if (withObligations) {
    db.exec(tableFromBaseline(baseline, 'legal_obligations'));
    for (const [i, key] of keys.entries()) db.prepare('INSERT INTO legal_obligations (user_id,obligation_key,required,status,evidence_meta) VALUES (1,?,1,?,?)')
      .run(key, ['pending', 'in_review', 'satisfied', 'waived', 'expired'][i % 5], '{"source":"synthetic-fixture"}');
  }
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const call = async (key: string, authenticated = true) => {
    const headers = authenticated ? { Authorization: `Bearer ${await token(1, role)}` } : {};
    const response = await app.request(`/api/trust/obligation/${key}/start`, { method: 'POST', headers }, env);
    return { status: response.status, body: await response.json() as any };
  };
  return { db, call };
}

test('all legacy start keys return a stable 410 without changing status, evidence or timestamps', async () => {
  const { db, call } = fixture();
  try {
    const before = db.prepare('SELECT * FROM legal_obligations ORDER BY obligation_key').all();
    for (const key of [...keys, 'unknown-key']) {
      const r = await call(key);
      assert.equal(r.status, 410, key);
      assert.equal(r.body.error, 'obligation_start_retired');
      assert.match(r.body.message, /signing or verification flow/);
      assert.deepEqual(db.prepare('SELECT * FROM legal_obligations ORDER BY obligation_key').all(), before);
    }
  } finally { db.close(); }
});

test('retirement does not bootstrap a trust store and is the same for every signed-in role', async () => {
  for (const role of ['founder', 'investor', 'admin', 'partner', 'advisor', 'exploring']) {
    const { db, call } = fixture(role, false);
    try {
      const before = db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all();
      assert.equal((await call('kyb_v1')).status, 410, role);
      assert.deepEqual(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(), before);
    } finally { db.close(); }
  }
});

test('the retired endpoint still requires authentication', async () => {
  const { db, call } = fixture();
  try { assert.equal((await call('kyc_v1', false)).status, 401); }
  finally { db.close(); }
});
