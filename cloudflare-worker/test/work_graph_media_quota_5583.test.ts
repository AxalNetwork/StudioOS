/** D5583 part 2 — cumulative media storage uses D1170's actual migrated member meter; synthetic rows only.
 *
 * From cloudflare-worker/test/README.md (moved by #6472): D5583 part 2: actual migrated cumulative
 * owner quota, dedup, owner transfer and legacy blob migration integrity, synthetic data only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1, d1Over } from './_d1_sqlite.mjs';
import { openSchema } from './_schema_once.mjs';
import { asset, world, CTX, BOB, SCHEMA, SCOPE } from './_work_graph_world_5581.ts';
import { storeMediaUpload } from '../src/services/workGraphMediaStorage.ts';
import { storageUsedBytes, readStorageByOwner } from '../src/services/storageUsage.ts';
import { sha256Hex } from '../src/services/workGraphContracts.ts';
import { blobKey } from '../src/services/workGraphBlobs.ts';
import { storagePlan } from '../src/services/storagePlans.ts';
const chunk = (name: string, n = 0) => [0,0,0,n,...new TextEncoder().encode(name),...new Uint8Array(n),0,0,0,0];
const PNG = Uint8Array.from([137,80,78,71,13,10,26,10,...chunk('IHDR',13),...chunk('IEND')]);
const request = (assetUid: string) => ({ assetUid, expectedHead: null, by: BOB, kind: 'image' as const, objectClass: 'master' as const, declaredMime: 'image/png', bytes: PNG,
  provenance: { origin: 'upload' as const, rights: { basis: 'owned' as const, usageScope: ['deck'] } }, use: 'deck' });

function quotaFixture() {
  const base = world(); base.db.close();
  const db = openSchema(); const env = { ...base.env, DB: d1Over(db), ENVIRONMENT: 'development' };
  const w = { ...base, db, env };
  db.exec(`INSERT INTO founders(id,name,email) VALUES (101,'Synthetic Owner','owner@example.test'),(102,'Synthetic Uploader','uploader@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Synthetic Owner','owner@example.test','founder',101,1),(12,'Synthetic Uploader','uploader@example.test','founder',102,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (70,'synthetic-media-company','Synthetic Media');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin,created_at) VALUES ('synthetic-owner',70,11,1,'2026-01-01'),('synthetic-uploader',70,12,0,'2026-01-02');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (700,'synthetic-media-project','Synthetic Media Project',101,70);`);
  return { base, db, env, w };
}

test('a physical object counts once to the company owner, cumulative quota refuses before write, owner transfer follows D1170', async () => {
  const { base, db, env, w } = quotaFixture();
  const allowance = storagePlan('founder:free')!.allowance_bytes!;
  db.prepare('INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES (?,?,?,?,?)').run('synthetic-fill',11,'Synthetic filler','research/11/synthetic-fill',allowance - PNG.length * 2);
  const id = await asset(w, 'quota');
  const first = await storeMediaUpload(env, CTX, request(id)); assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.ownerUserId, 11); assert.equal(first.quota.passed, 'measured'); assert.equal(first.quota.incoming, PNG.length);
  const again = await storeMediaUpload(env, CTX, request(id)); assert.ok(again.ok && again.reused); assert.equal(again.quota.incoming, 0);
  assert.equal(base.r2.ops.put, 1);
  assert.equal((await storageUsedBytes(env, 11))?.measured_bytes, allowance - PNG.length);
  assert.equal((await storageUsedBytes(env, 12))?.measured_bytes, 0);
  db.prepare('UPDATE research_documents SET size_bytes = size_bytes + ? WHERE uid = ?').run(PNG.length,'synthetic-fill');
  const error = await storeMediaUpload(env, CTX, { ...request(id), objectClass: 'rendition' }).then(() => { throw new Error('quota admitted an over-limit object'); }, (error: unknown) => error);
  assert.ok(error instanceof Response); assert.equal(error.status, 413);
  const body = await error.json() as { error: string }; assert.equal(body.error,'storage_full');
  assert.equal(base.r2.ops.put, 1, 'quota refusal wrote no R2 object');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE refusal_code = 'storage_full'").get() as { n: number }).n, 1);
  db.exec("UPDATE user_company_links SET is_primary_admin = CASE user_id WHEN 12 THEN 1 ELSE 0 END WHERE company_id = 70");
  assert.equal((await storageUsedBytes(env, 11))?.measured_bytes, allowance - PNG.length);
  assert.equal((await storageUsedBytes(env, 12))?.measured_bytes, PNG.length, 'current owner, not admission snapshot');
  const transferred = await storeMediaUpload(env, CTX, request(id)); assert.ok(transferred.ok && transferred.reused); assert.equal(transferred.ownerUserId, 12);
  const rendition = await storeMediaUpload(env, CTX, { ...request(id), objectClass: 'rendition' }); assert.ok(rendition.ok);
  assert.equal((await storageUsedBytes(env,12))?.measured_bytes, PNG.length * 2);
  const companyWide = await asset(w, 'company-wide', { scope: { ...SCOPE, projectId: null } });
  const thumbnail = await storeMediaUpload(env, CTX, { ...request(companyWide), objectClass: 'thumbnail' }); assert.ok(thumbnail.ok); assert.match(thumbnail.key, /media\/p0\/thumbnail/);
  assert.equal((await storageUsedBytes(env,12))?.measured_bytes, PNG.length * 3);
  const hq = await readStorageByOwner(env); assert.equal(hq.unreadable.length,0); assert.equal(hq.owners.get(12)?.measured_bytes,PNG.length * 3);
  db.exec('UPDATE user_company_links SET is_primary_admin = 0 WHERE company_id = 70; UPDATE projects SET founder_id = NULL WHERE id = 700');
  const unowned = await storeMediaUpload(env, CTX, { ...request(id), objectClass: 'snapshot' }); assert.ok(unowned.ok);
  assert.equal(unowned.ownerUserId, null); assert.equal(unowned.quota.passed, 'no_owner');
  const withoutOwner = await readStorageByOwner(env); assert.equal(withoutOwner.unowned.measured_bytes, PNG.length * 4);
  db.close();
});

test('adopting an intact orphan still records the quota threshold notice when it becomes charged', async () => {
  const { base, db, env, w } = quotaFixture();
  const allowance = storagePlan('founder:free')!.allowance_bytes!;
  db.prepare('INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES (?,?,?,?,?)').run('synthetic-adopt-fill',11,'Synthetic filler','research/11/synthetic-adopt-fill',allowance - PNG.length);
  const id = await asset(w, 'adopt'); const digest = await sha256Hex(PNG);
  base.r2.plant(blobKey(SCOPE,digest,'master'), PNG.slice(), digest);
  const result = await storeMediaUpload(env, CTX, request(id)); assert.ok(result.ok && result.reused);
  assert.equal(result.quota.incoming, PNG.length); assert.equal(base.r2.ops.put, 0);
  assert.equal((await storageUsedBytes(env,11))?.measured_bytes, allowance);
  const notice = db.prepare("SELECT payload FROM notifications_inbox WHERE user_id = 11 AND type = 'storage_threshold' ORDER BY id DESC LIMIT 1").get() as { payload: string } | undefined;
  assert.equal(notice ? JSON.parse(notice.payload).threshold : null, 100);
  db.close();
});

test('the class migration preserves generic rows and keeps immutable attribution and physical identity', () => {
  const migration = readFileSync(new URL('../sql/migrations/202611220358_5583_media_blob_classes.sql', import.meta.url),'utf8');
  const oldSchema = SCHEMA.slice(0,SCHEMA.indexOf('-- D5583 part 2:'));
  const { db } = makeD1(oldSchema);
  const digest = 'a'.repeat(64);
  db.prepare('INSERT INTO work_graph_blobs(tenant_id,company_id,digest,byte_length,created_at) VALUES (?,?,?,?,?)').run(7,70,digest,123,'2026-11-01');
  db.exec(migration);
  const row = db.prepare('SELECT object_class,project_id,digest,byte_length,admitted_owner_user_id FROM work_graph_blobs').get();
  assert.deepEqual({ ...row }, { object_class: 'generic',project_id:0,digest,byte_length:123,admitted_owner_user_id:null });
  assert.throws(()=>db.prepare('UPDATE work_graph_blobs SET byte_length = 0').run(),/only deleted_at/);
  assert.throws(()=>db.prepare('UPDATE work_graph_blobs SET project_id = 700').run(),/only deleted_at/);
  assert.throws(()=>db.prepare("UPDATE work_graph_blobs SET object_class = 'thumbnail'").run(),/only deleted_at/);
  assert.throws(()=>db.prepare('UPDATE work_graph_blobs SET admitted_owner_user_id = 11').run(),/only deleted_at/);
  assert.throws(()=>db.prepare('DELETE FROM work_graph_blobs').run(),/never deleted/);
  db.prepare('UPDATE work_graph_blobs SET deleted_at = ?').run('2026-11-22');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM work_graph_blobs WHERE deleted_at IS NOT NULL').get() as { n:number }).n,1);
  db.close();
});
