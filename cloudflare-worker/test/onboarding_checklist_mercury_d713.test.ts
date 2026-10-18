/**
 * D713 (#1778) decision 10 — the existing founder's bank item is Mercury's.
 *
 * The key stays `ef.plaid`, so saved progress survives; the label reads
 * "Connect Mercury (verify revenue)" (revenue, not cash: cash is not a
 * permitted use); and the item auto-completes on an ACTIVE `mercury` row of
 * the founder's own, never on a `plaid` row, an errored Mercury row or another
 * member's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/onboarding_checklist_mercury_d713.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CATALOG, loadChecklist } from '../src/services/onboardingChecklist.ts';
import { d1Over } from './_d1_sqlite.mjs';

const FOUNDER = 10, OTHER = 11;

function env() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE integrations (id INTEGER PRIMARY KEY, user_id INTEGER, provider_key TEXT, status TEXT, UNIQUE(user_id, provider_key));`);
  return { db, env: { DB: d1Over(db) } as any };
}
const item = async (e: any) => (await loadChecklist(e, { id: FOUNDER, role: 'founder' }, 'founder_existing')).items.find((i) => i.key === 'ef.plaid')!;

test('ef.plaid keeps its key and reads "Connect Mercury (verify revenue)"; no item names Plaid', () => {
  const row = CATALOG.existingFounder.find((i) => i.key === 'ef.plaid');
  assert.ok(row, 'the key survives');
  assert.equal(row!.label, 'Connect Mercury (verify revenue)');
  assert.equal(row!.autoDetect, true);
  for (const items of Object.values(CATALOG)) for (const i of items) assert.doesNotMatch(i.label, /plaid|cash/i, i.key);
});

test('the item completes on the founder\'s own active mercury row, and on nothing else', async () => {
  const { db, env: e } = env();
  const ins = db.prepare('INSERT INTO integrations (user_id, provider_key, status) VALUES (?, ?, ?)');
  ins.run(FOUNDER, 'plaid', 'active');
  ins.run(FOUNDER, 'mercury', 'error');
  ins.run(OTHER, 'mercury', 'active');
  assert.equal((await item(e)).status, 'pending');
  db.exec(`UPDATE integrations SET status = 'active' WHERE user_id = ${FOUNDER} AND provider_key = 'mercury'`);
  const done = await item(e);
  assert.deepEqual([done.status, done.source], ['completed', 'auto']);
});
