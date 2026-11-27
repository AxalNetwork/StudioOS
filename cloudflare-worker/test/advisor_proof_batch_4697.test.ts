/**
 * #4697 — Expertise › Proof reads its consents in one statement, not one per
 * item. Synthetic fixtures only: the real router over the migrated schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());

function fixture(items: number) {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor','a@example.test','advisor',1),(22,'Other','o@example.test','advisor',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test'),(202,'a-2',22,'Other','o@example.test');
  `);
  const item = db.prepare('INSERT INTO advisor_proof_items(id,uid,advisor_id,title,created_at) VALUES (?,?,?,?,?)');
  const consent = db.prepare('INSERT INTO advisor_proof_consents(uid,proof_item_id,attester_name,consent_given,created_at) VALUES (?,?,?,?,?)');
  for (let i = 1; i <= items; i += 1) {
    item.run(i, `pr-${i}`, 201, `Claim ${i}`, `2026-10-01T09:00:${String(i % 60).padStart(2, '0')}.000Z`);
    // Two asks per item, inserted newest first, so the read has to put them back in order.
    consent.run(`c-${i}-b`, i, `Second ${i}`, 0, '2026-10-02T09:00:00.000Z');
    consent.run(`c-${i}-a`, i, `First ${i}`, 0, '2026-10-01T09:00:00.000Z');
  }
  // Another advisor's item and consent: never read for this advisor.
  item.run(9999, 'theirs', 202, 'Theirs', '2026-10-01T09:00:00.000Z');
  consent.run('c-theirs', 9999, 'Not yours', 0, '2026-10-01T09:00:00.000Z');
  const binding = d1Over(db);
  const reads: string[] = [];
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: { ...binding, prepare(sql: string) {
    if (/advisor_proof_consents/.test(sql) && /^\s*SELECT/i.test(sql)) reads.push(sql);
    return binding.prepare(sql);
  } } };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const get = async (path: string) => {
    const jwt = await new SignJWT({ user_id: 21 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    return { status: res.status, body: await res.json() as any };
  };
  return { get, reads };
}

test('the consent reads do not grow with the number of proof items', async () => {
  // Mutation checked: the per-item loop restored -> 1 item reads 1, 50 read 50, 200 read 200.
  const counts: Record<number, number> = {};
  for (const n of [1, 50, 200]) {
    const f = fixture(n);
    const r = await f.get('/me/proof');
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, n);
    counts[n] = f.reads.filter((sql) => /json_each/.test(sql) || /WHERE proof_item_id = \?/.test(sql)).length;
  }
  assert.deepEqual(counts, { 1: 1, 50: 1, 200: 1 }, 'one batched read for a page of 1, 50 or 200 items');
});

test('the batch reads only this advisor\'s items, and keeps each item\'s consents in its own order', async () => {
  const f = fixture(3);
  const r = await f.get('/me/proof');
  const byUid = Object.fromEntries(r.body.items.map((x: any) => [x.uid, x.consents.map((c: any) => c.attester_name)]));
  assert.deepEqual(byUid, { 'pr-1': ['First 1', 'Second 1'], 'pr-2': ['First 2', 'Second 2'], 'pr-3': ['First 3', 'Second 3'] });
  assert.doesNotMatch(JSON.stringify(r.body), /Not yours|theirs/);
  const batched = f.reads.find((sql) => /json_each/.test(sql))!;
  assert.match(batched, /p\.advisor_id = \?/, 'the batch re-checks the owner');
  assert.doesNotMatch(batched, /\$\{/, 'no interpolated IN list');
});

test('timing: a 200-item proof page, read over the in-memory D1 shim', async () => {
  // A measurement, recorded in D4697.md, not a pass/fail threshold: the shim has no
  // network, so it shows the work removed, not production latency.
  const f = fixture(200);
  const runs: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const t = performance.now();
    assert.equal((await f.get('/me/proof')).status, 200);
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  console.log(`[4697] /me/proof, 200 items, median of 5: ${runs[2].toFixed(1)} ms`);
});
