/**
 * D1172 (#3085) — HQ › Platform › Storage's rows (STG20): the owner's table by
 * price (`STORAGE_TIERS`), and `GET /api/admin/platform/storage`'s `by_tier`,
 * on the migrated schema. Every allowance is the catalogue's; no byte count
 * here is typed except the files' own sizes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/storage_tiers_d1172.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { readPlatformStorage } from '../src/services/storageHq.ts';
import { STORAGE_KINDS } from '../src/services/storageUsage.ts';
import { STORAGE_PLANS, STORAGE_TIERS, storagePlan } from '../src/services/storagePlans.ts';
import { planByKey } from '../src/services/planCatalogue.ts';

test.after(() => removeMigratedDatabases());

const FREE = storagePlan('founder:free')!.allowance_bytes!;
const START = storagePlan('founder:growth')!.allowance_bytes!;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(202,'Two','two@example.test'),(303,'Three','three@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,subscription_tier,subscription_status,investor_tier,investor_subscription_status) VALUES
      (11,'Near','near@example.test','founder',101,1,'free','active','free','free'),
      (12,'Empty','empty@example.test','founder',202,1,'free','active','free','free'),
      (13,'Over','over@example.test','founder',303,1,'growth','active','free','free'),
      (14,'Inst','inst@example.test','investor',NULL,1,'free','active','institutional','active'),
      (15,'Staff','staff@example.test','admin',NULL,1,'free','active','free','free'),
      (16,'Small','small@example.test','investor',NULL,1,'free','active','free','free');
  `);
  const fill = (id: number, bytes: number, n = 0) => db.prepare(
    'INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES (?,?,?,?,?)',
  ).run(`fill-${id}-${n}`, id, 'Filler', `research/${id}/${n}`, bytes);
  const native = d1Over(db);
  let fail: RegExp | null = null;
  const env: any = { DB: { prepare(sql: string) { if (fail?.test(sql)) throw new Error('synthetic-private-failure'); return native.prepare(sql); }, batch: (s: any[]) => native.batch(s) } };
  return { db, env, fill, fail: (r: RegExp | null) => { fail = r; } };
}

test('the tiers: the owner’s table by price, every plan but staff in exactly one, each tier one allowance from the catalogue', () => {
  assert.deepEqual(STORAGE_TIERS.map((t) => t.label), ['Free', '$20 a month', '$50 a month', '$100 a month', '$150 a month', 'LP Access', 'Negotiated']);
  const placed = STORAGE_TIERS.flatMap((t) => [...t.plans]);
  assert.deepEqual([...placed].sort(), Object.keys(STORAGE_PLANS).filter((k) => k !== 'admin').sort());
  assert.equal(new Set(placed).size, placed.length, 'no plan in two tiers');
  for (const t of STORAGE_TIERS) {
    const allowances = new Set(t.plans.map((k) => storagePlan(k)!.allowance_bytes));
    assert.equal(allowances.size, 1, `${t.key}: one allowance`);
  }
  // The price mapping is D1166 §5's: $20 is Validate + Build, Advisor Pro and Operating Partner Pro.
  assert.deepEqual(STORAGE_TIERS[1].plans.map((k) => planByKey(k)!.name), ['Validate + Build', 'Advisor Pro', 'Operating Partner Pro']);
});

test('by_tier: members, members with files, bytes in all, by kind and the median, and members by state, per tier; staff not counted', async () => {
  const f = fixture();
  f.fill(11, Math.ceil(FREE * 0.85));
  f.fill(13, START + 1);
  f.fill(14, 5000);
  f.fill(15, 7000);
  f.fill(16, 100);
  const body = await readPlatformStorage(f.env);
  assert.deepEqual(body.by_tier!.map((t) => t.tier), STORAGE_TIERS.map((t) => t.key));
  const free = body.by_tier!.find((t) => t.tier === 'free')!;
  assert.deepEqual([free.members, free.members_with_files, free.allowance_bytes], [3, 2, FREE]);
  assert.equal(free.measured_bytes, Math.ceil(FREE * 0.85) + 100);
  assert.equal(free.median_bytes, 100, 'three members: the middle one');
  assert.equal(free.by_kind!.reduce((n, k) => n + k.measured_bytes, 0), free.measured_bytes);
  assert.deepEqual(free.by_kind!.map((k) => k.key), [...STORAGE_KINDS]);
  assert.deepEqual([free.by_state!.ok, free.by_state!.near_80, free.by_state!.over], [2, 1, 0]);
  assert.deepEqual(free.plan_names, ['Free', 'Investor Basic', 'Advisor Basic', 'Partner Basic', 'No plan yet']);
  const twenty = body.by_tier!.find((t) => t.tier === 'usd_20')!;
  assert.deepEqual([twenty.members, twenty.median_bytes, twenty.by_state!.over], [1, START + 1, 1]);
  const negotiated = body.by_tier!.find((t) => t.tier === 'negotiated')!;
  assert.deepEqual([negotiated.allowance_bytes, negotiated.allowance_reason, negotiated.by_state!.not_measured], [null, 'Negotiated', 1]);
  const plus = body.by_tier!.find((t) => t.tier === 'usd_50')!;
  assert.deepEqual([plus.members, plus.measured_bytes, plus.median_bytes], [0, 0, null], 'no members: a measured 0 B, and no median');
  // Staff hold no plan: in no tier, and not among members with files.
  assert.equal(body.by_tier!.reduce((n, t) => n + t.members, 0), 5);
  assert.equal(body.totals.members_with_files, 4);
  for (const t of body.by_tier!) assert.equal(Object.values(t.by_state!).reduce((n, v) => n + v, 0), t.members, `${t.tier}: every member in one state`);
  const keys = new Set<string>();
  const walk = (v: any) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(body);
  for (const k of ['name', 'email', 'user_id', 'id', 'uid', 'filename', 'title']) assert.ok(!keys.has(k), `no ${k} key`);
  for (const leak of ['Near', 'near@example.test', 'Filler', 'research/11']) assert.ok(!JSON.stringify(body).includes(leak), `no ${leak}`);
});

test('by_tier says what it could not read: an area unreadable leaves members and blanks bytes and states; the plans unreadable blank it all', async () => {
  const f = fixture();
  f.fill(11, 100);
  f.fail(/FROM research_documents/);
  const partial = await readPlatformStorage(f.env);
  const free = partial.by_tier!.find((t) => t.tier === 'free')!;
  assert.deepEqual([free.members, free.measured_bytes, free.median_bytes, free.by_kind, free.by_state], [3, null, null, null, null]);
  f.fail(null);
  f.db.exec('DELETE FROM users WHERE id = 16');
  const two = (await readPlatformStorage(f.env)).by_tier!.find((t) => t.tier === 'free')!;
  assert.equal(two.median_bytes, 50, 'two members: the mean of the middle two');
  f.fail(/FROM research_documents/);
  assert.match(partial.by_tier_reason!, /no member’s total is complete/);
  f.fail(/account_subscriptions/);
  const none = await readPlatformStorage(f.env);
  assert.deepEqual([none.by_tier, none.totals.members_with_files, none.by_tier_reason], [null, null, 'The plans could not be read.']);
});
