/**
 * D4856 (#4856): HQ › Platform › Storage names who the bytes belong to. Members,
 * staff and unattributed owners each report accounts, files, measured bytes and
 * unknown-size files, and the total is their sum.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/storage_populations_4856.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { readPlatformStorage } from '../src/services/storageHq.ts';

test.after(() => removeMigratedDatabases());

const MB = 1_000_000;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,subscription_tier,subscription_status,investor_tier,investor_subscription_status) VALUES
      (11,'Member','member@example.test','founder',101,1,'free','active','free','free'),
      (12,'Idle','idle@example.test','investor',NULL,1,'free','active','free','free'),
      (15,'Staff','staff@example.test','admin',NULL,1,'free','active','free','free');
  `);
  const put = (owner: number, n: number, bytes: number | null) => db.prepare(
    'INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES (?,?,?,?,?)',
  ).run(`f-${owner}-${n}`, owner, 'Filler', `research/${owner}/${n}`, bytes);
  const native = d1Over(db);
  let fail: RegExp | null = null;
  const env: any = { DB: { prepare(sql: string) { if (fail?.test(sql)) throw new Error('synthetic-private-failure'); return native.prepare(sql); }, batch: (s: any[]) => native.batch(s) } };
  return { db, env, put, fail: (r: RegExp | null) => { fail = r; } };
}

test('100 MB of member storage and 900 MB of staff storage: members 100 MB, staff 900 MB, total 1 GB', async () => {
  // Mutation checked: staff routed into members → members 1 GB; staff dropped from the total → total 100 MB.
  const f = fixture();
  f.put(11, 1, 100 * MB);
  f.put(15, 1, 900 * MB);
  const body = await readPlatformStorage(f.env);
  const p = body.populations!;
  assert.equal(p.members.measured_bytes, 100 * MB);
  assert.equal(p.staff.measured_bytes, 900 * MB);
  assert.equal(p.total.measured_bytes, 1000 * MB);
  assert.equal(body.totals.measured_bytes, 1000 * MB);
  assert.deepEqual([p.members.accounts, p.members.accounts_with_files, p.staff.accounts, p.staff.accounts_with_files], [2, 1, 1, 1]);
});

test('the total is the sum of the populations, in files, bytes and unknown-size files', async () => {
  // Mutation checked: unattributed left out of the sum → the total falls short of the platform's.
  const f = fixture();
  f.put(11, 1, 10); f.put(11, 2, null);
  f.put(15, 1, 20); f.put(15, 2, null); f.put(15, 3, null);
  f.put(999, 1, 40); f.put(999, 2, null);
  const body = await readPlatformStorage(f.env);
  const p = body.populations!;
  for (const key of ['files', 'measured_bytes', 'unknown_size_files'] as const) {
    assert.equal(p.members[key] + p.staff[key] + p.unattributed[key], p.total[key], `${key}: populations add up`);
    assert.equal(p.total[key], body.totals[key], `${key}: the total is the platform's`);
  }
  assert.deepEqual([p.members.files, p.members.measured_bytes, p.members.unknown_size_files], [2, 10, 1]);
  assert.deepEqual([p.staff.files, p.staff.measured_bytes, p.staff.unknown_size_files], [3, 20, 2]);
  assert.deepEqual([p.unattributed.accounts, p.unattributed.files, p.unattributed.measured_bytes, p.unattributed.unknown_size_files], [1, 2, 40, 1]);
  assert.equal(body.measured_is_floor, true, 'unknown-size files make the bytes a floor, never counted as 0 in a total claimed exact');
});

test('an empty platform reports measured zeros, and unreadable plans report no populations, never zeros', async () => {
  // Mutation checked: populations built from an empty plan map when the plans failed → zeros instead of null.
  const f = fixture();
  const empty = await readPlatformStorage(f.env);
  assert.deepEqual([empty.populations!.members.measured_bytes, empty.populations!.staff.accounts], [0, 1]);
  f.fail(/account_subscriptions/);
  const none = await readPlatformStorage(f.env);
  assert.equal(none.populations, null);
  assert.equal(none.populations_reason, 'The plans could not be read.');
  assert.equal(none.totals.measured_bytes, 0, 'the platform total still stands');
  assert.ok(!('members_with_files' in none.totals) && !('members' in none.totals), 'no count that mixes populations is left in totals');
});
