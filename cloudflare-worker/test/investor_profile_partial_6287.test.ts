import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import type { Env } from '../src/types';
import { investorProfile } from '../src/routes/investor_signals';
import { d1Over } from './_d1_sqlite.mjs';

test('#6287 firm edits preserve omitted thesis, onboarding, and consent fields', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, role TEXT, is_active INTEGER, jwt_min_iat INTEGER);
      INSERT INTO users VALUES (42, 'investor@example.test', 'investor', 1, 0);
    `);
    const secret = 'synthetic-test-secret-6287-not-for-deployment';
    const auth = await new SignJWT({ user_id: 42, role: 'investor' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    const env = { JWT_SECRET: secret, ENVIRONMENT: 'development', DB: d1Over(db) } as unknown as Env;

    const update = (body: Record<string, unknown>) => investorProfile.request('/me', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, env);
    async function read() {
      const res = await investorProfile.request('/me', { headers: { Authorization: `Bearer ${auth}` } }, env);
      assert.equal(res.status, 200);
      return (await res.json() as { profile: Record<string, unknown> }).profile;
    }
    const initial = await update({
      investor_type: 'individual', firm_name: 'Original Firm', ticket_band: '$10k-$50k',
      sectors: ['Climate'], stages: ['Seed'], geos: ['Europe'], thesis_text: 'Climate resilience',
      anti_thesis_sectors: ['Crypto'], anti_thesis_stages: ['Growth'], value_weights: { impact: 0.5 },
      contribute_to_signals: false, accreditation_status: 'accredited', country: 'Canada',
    });
    assert.equal(initial.status, 200);
    const before = await read();
    assert.ok(before.completed_at);

    const edited = await update({ firm_name: 'New Firm', investor_type: 'institution', ticket_band: '$50k-$250k' });
    assert.equal(edited.status, 200);
    const after = await read();
    assert.equal(after.firm_name, 'New Firm');
    assert.equal(after.investor_type, 'institution');
    assert.equal(after.ticket_band, '$50k-$250k');
    assert.equal(after.ticket_min_usd, 50_000);
    assert.equal(after.ticket_max_usd, 250_000);
    for (const key of [
      'sectors', 'stages', 'geos', 'thesis_text', 'thesis_keywords', 'anti_thesis_sectors',
      'anti_thesis_stages', 'value_weights', 'contribute_to_signals', 'accreditation_status', 'country',
    ]) assert.deepEqual(after[key], before[key], key);

    const clears = await update({ ticket_band: null, sectors: [] });
    assert.equal(clears.status, 200);
    const cleared = await read();
    assert.equal(cleared.ticket_band, null);
    assert.equal(cleared.ticket_min_usd, null);
    assert.equal(cleared.ticket_max_usd, null);
    assert.deepEqual(cleared.sectors, []);
    assert.deepEqual(cleared.stages, ['Seed']);
    assert.equal(cleared.investor_type, 'institution');
    assert.equal(cleared.contribute_to_signals, false);
  } finally {
    db.close();
  }
});
