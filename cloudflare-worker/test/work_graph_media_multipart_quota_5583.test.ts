/**
 * D5583 part 3 — a multipart media upload against D1170's actual migrated member meter: the guard refuses at begin
 * and again at finish, a refusal at finish keeps the upload open with nothing landed, and the object is charged
 * once. Synthetic rows; the migrated schema (which includes this part's session tables) from `openSchema`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { d1Over } from './_d1_sqlite.mjs';
import { openSchema } from './_schema_once.mjs';
import { asset, world, BOB, CTX, SCOPE } from './_work_graph_world_5581.ts';
import { MEDIA_MULTIPART_DEPS, MEDIA_MULTIPART_LIMITS, beginMediaMultipart, finishMediaMultipart, uploadMediaPart } from '../src/services/workGraphMediaMultipart.ts';
import { storageUsedBytes } from '../src/services/storageUsage.ts';
import { storagePlan } from '../src/services/storagePlans.ts';
import { blobKey } from '../src/services/workGraphBlobs.ts';

const PART = 256;
const L = { ...MEDIA_MULTIPART_LIMITS, partBytes: PART, minBytes: PART + 1 };
let ids = 0;
MEDIA_MULTIPART_DEPS.newId = () => `mpq${++ids}`;
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, len: number) => [...be32(len), ...new TextEncoder().encode(type), ...new Uint8Array(len).fill(len & 255), 0, 0, 0, 0];
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', 13), ...chunk('IDAT', 700), ...chunk('IEND', 0)]);
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const request = (assetUid: string) => ({ assetUid, expectedHead: null, by: BOB, kind: 'image' as const, objectClass: 'master' as const,
  declaredMime: 'image/png', provenance: { origin: 'upload' as const, rights: { basis: 'owned' as const, usageScope: ['deck'] } }, use: 'deck',
  digest: hex(PNG), byteLength: PNG.length });
const refusal = (p: Promise<unknown>) => p.then(() => { throw new Error('the guard admitted an over-limit object'); }, (e: unknown) => e);

test('the member guard refuses at begin and at finish; a refused finish lands nothing and can finish once there is room; the object counts once', async () => {
  const base = world(); base.db.close();
  const db = openSchema(); const env = { ...base.env, DB: d1Over(db), ENVIRONMENT: 'development' };
  const w = { ...base, db, env };
  db.exec(`INSERT INTO founders(id,name,email) VALUES (101,'Synthetic Owner','owner@example.test'),(102,'Synthetic Uploader','uploader@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (11,'Synthetic Owner','owner@example.test','founder',101,1),(12,'Synthetic Uploader','uploader@example.test','founder',102,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (70,'synthetic-media-company','Synthetic Media');
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin,created_at) VALUES ('synthetic-owner',70,11,1,'2026-01-01'),('synthetic-uploader',70,12,0,'2026-01-02');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (700,'synthetic-media-project','Synthetic Media Project',101,70);`);
  const allowance = storagePlan('founder:free')!.allowance_bytes!;
  db.prepare('INSERT INTO research_documents(uid,owner_user_id,title,r2_key,size_bytes) VALUES (?,?,?,?,?)').run('synthetic-fill', 11, 'Synthetic filler', 'research/11/synthetic-fill', allowance - PNG.length + 1);
  const id = await asset(w as never, 'mpq');

  const atBegin = await refusal(beginMediaMultipart(env as never, CTX, request(id), L));
  assert.ok(atBegin instanceof Response); assert.equal(atBegin.status, 413);
  assert.equal(((await atBegin.json()) as { error: string }).error, 'storage_full');
  assert.equal(base.r2.ops.mpCreate, 0, 'no R2 upload opened for a refused begin');

  db.prepare('UPDATE research_documents SET size_bytes = ? WHERE uid = ?').run(allowance - PNG.length * 2, 'synthetic-fill');
  const begun = await beginMediaMultipart(env as never, CTX, request(id), L);
  assert.ok(begun.ok, JSON.stringify(begun)); assert.equal(begun.quota.passed, 'measured'); assert.equal(begun.quota.incoming, PNG.length);
  for (let n = 1; n <= begun.partCount; n++) {
    const bytes = PNG.slice((n - 1) * PART, n * PART);
    const r = await uploadMediaPart(env as never, CTX, { uploadUid: begun.uploadUid, partNumber: n, bytes, partDigest: hex(bytes), by: BOB });
    assert.ok(r.ok, JSON.stringify(r));
  }
  // Other files filled the plan while the parts were sent: the finish asks the guard again, as any write does.
  db.prepare('UPDATE research_documents SET size_bytes = ? WHERE uid = ?').run(allowance - PNG.length + 1, 'synthetic-fill');
  const atFinish = await refusal(finishMediaMultipart(env as never, CTX, { ...request(id), uploadUid: begun.uploadUid }));
  assert.ok(atFinish instanceof Response); assert.equal(atFinish.status, 413);
  assert.equal(base.r2.ops.mpComplete, 0); assert.equal(base.r2.objects.has(blobKey(SCOPE, hex(PNG), 'master')), false);
  assert.equal((db.prepare('SELECT status FROM work_graph_media_uploads WHERE upload_uid = ?').get(begun.uploadUid) as { status: string }).status, 'open');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM work_graph_integrity_events WHERE refusal_code = 'storage_full'").get() as { n: number }).n, 2);

  db.prepare('UPDATE research_documents SET size_bytes = ? WHERE uid = ?').run(allowance - PNG.length, 'synthetic-fill');
  const done = await finishMediaMultipart(env as never, CTX, { ...request(id), uploadUid: begun.uploadUid });
  assert.ok(done.ok, JSON.stringify(done)); assert.equal(done.ownerUserId, 11); assert.equal(done.quota.incoming, PNG.length);
  assert.equal((await storageUsedBytes(env as never, 11))?.measured_bytes, allowance, 'the object is charged once, to the company owner');
  assert.equal((await storageUsedBytes(env as never, 12))?.measured_bytes, 0, 'never to the uploader');
  const notice = db.prepare("SELECT payload FROM notifications_inbox WHERE user_id = 11 AND type = 'storage_threshold' ORDER BY id DESC LIMIT 1").get() as { payload: string } | undefined;
  assert.equal(notice ? JSON.parse(notice.payload).threshold : null, 100, 'the landing sends the crossing notice once');
  db.close();
});
