/**
 * D1411 (#3894) — an article's objects count to its author's storage plan:
 * body uploads, covers and generated images under `articles/<id>/`, read from
 * R2 (no row records their sizes). Over the migrated schema; synthetic rows
 * and an in-memory bucket whose `list` honours `prefix`, as R2's does.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/storage_articles_d1411.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { forgetArticleStorage, readStorageByOwner, readStorageUsage, storageUsedBytes } from '../src/services/storageUsage.ts';
import { assertStorageRoom } from '../src/services/storageRoom.ts';
import { storagePlan } from '../src/services/storagePlans.ts';

test.after(() => removeMigratedDatabases());

const FREE = storagePlan('founder:free')!.allowance_bytes!;
// Ann (11) wrote articles 5 and 6; Ben (22) wrote 55, whose prefix starts like 5's.
const OBJECTS: Array<[string, number]> = [
  ['articles/5/img-11111111-1111-1111-1111-111111111111.png', 1000], // a body upload
  ['articles/5/cover-22222222-2222-2222-2222-222222222222.jpg', 300], // a cover
  ['articles/6/img-33333333-3333-3333-3333-333333333333.png', 2000], // a generated image
  ['articles/6/img-44444444-4444-4444-4444-444444444444.png', 4000], // another
  ['articles/55/img-55555555-5555-5555-5555-555555555555.png', 90000], // Ben's
  ['articles/77/img-66666666-6666-6666-6666-666666666666.png', 7], // an article no longer on record
  ['news/1/cover.png', 50000], // not an article object
];

function bucket(objects: Array<[string, number]> = OBJECTS) {
  const sizes = new Map(objects);
  const calls: string[] = [];
  return {
    sizes, calls,
    async list({ prefix = '', cursor, limit = 1000 }: { prefix?: string; cursor?: string; limit?: number } = {}) {
      calls.push(prefix);
      const keys = [...sizes.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const page = keys.slice(from, from + limit);
      const truncated = from + limit < keys.length;
      return { objects: page.map((key) => ({ key, size: sizes.get(key)!, uploaded: new Date('2026-10-30T10:00:00Z') })), truncated, ...(truncated ? { cursor: String(from + limit) } : {}) };
    },
  };
}

function fixture(files: any = bucket()) {
  for (const id of [5, 6, 55, 77]) forgetArticleStorage(id);
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (11,'Ann','ann@example.test','founder',1),(22,'Ben','ben@example.test','founder',1),(33,'Cy','cy@example.test','founder',1),
      (44,'Staff','staff@example.test','admin',1);
    INSERT INTO articles(id,slug,title,body_markdown,status,author_user_id) VALUES
      (5,'a-5','Closing faster','Body.','draft',11),(6,'a-6','Shared ledgers','Body.','published',11),(55,'a-55','Ben writes','Body.','draft',22);
  `);
  const env: any = { DB: d1Over(db), FILES: files };
  const user = (id: number): any => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return { db, env, files, user };
}
const area = (body: any) => body.areas.find((a: any) => a.key === 'articles');

test('a member with two articles reads their upload, cover and two generated images under Articles', async () => {
  const f = fixture();
  const body = await readStorageUsage(f.env, f.user(11));
  assert.deepEqual(area(body), { key: 'articles', kind: 'other', files: 4, bytes: 7300, measured_bytes: 7300, unknown_size_files: 0, recorded: true });
  assert.equal(body.measured_bytes, 7300, 'they are the whole of this member\'s storage');
  assert.equal(body.kinds.find((k: any) => k.key === 'other').measured_bytes, 7300);
  assert.deepEqual(body.largest.map((l: any) => [l.area, l.name, l.bytes, l.ref]), [
    ['articles', 'Shared ledgers', 4000, '6'], ['articles', 'Shared ledgers', 2000, '6'], ['articles', 'Closing faster', 1000, '5'], ['articles', 'Closing faster', 300, '5'],
  ]);
  const personal = body.companies.find((c: any) => c.personal);
  assert.equal(personal.measured_bytes, 7300, 'an article is the member\'s own, tied to no company');
  assert.deepEqual(await storageUsedBytes(f.env, 11), { measured_bytes: 7300, unknown_size_files: 0 }, 'the upload guard weighs the same bytes');
  assert.deepEqual(f.files.calls.sort(), ['articles/5/', 'articles/6/'], 'one list per article, its own prefix; the guard\'s read is cached');
});

test('another member\'s articles never count; a member with none lists nothing', async () => {
  const f = fixture();
  assert.equal(area(await readStorageUsage(f.env, f.user(22))).bytes, 90000, 'Ben: only article 55');
  const cy = await readStorageUsage(f.env, f.user(33));
  assert.deepEqual(area(cy), { key: 'articles', kind: 'other', files: 0, bytes: 0, measured_bytes: 0, unknown_size_files: 0, recorded: true });
  f.files.calls.length = 0;
  await readStorageUsage(f.env, f.user(33));
  assert.deepEqual(f.files.calls, [], 'no article, no list');
  // Without the bucket: no article lists nothing and is known; articles make the area unknown, never 0.
  const bare = fixture(null);
  assert.equal(area(await readStorageUsage(bare.env, bare.user(33))).recorded, true);
  const unknown = await readStorageUsage(bare.env, bare.user(11));
  assert.deepEqual(area(unknown), { key: 'articles', kind: 'other', files: null, bytes: null, measured_bytes: null, unknown_size_files: null, recorded: false });
  assert.equal(unknown.total_bytes, null, 'no total is shown');
  assert.equal(await storageUsedBytes(bare.env, 11), null, 'the guard never weighs a partial sum');
});

test('a list is cached for a minute and forgotten by a write; a failed list is unknown', async () => {
  const f = fixture();
  await storageUsedBytes(f.env, 11);
  f.files.sizes.set('articles/5/img-77777777-7777-7777-7777-777777777777.png', 500);
  assert.equal((await storageUsedBytes(f.env, 11))!.measured_bytes, 7300, 'cached');
  forgetArticleStorage(5);
  assert.equal((await storageUsedBytes(f.env, 11))!.measured_bytes, 7800, 'a write to article 5 is read afresh');
  const broken = fixture({ list: async () => { throw new Error('r2 down'); } });
  assert.equal(area(await readStorageUsage(broken.env, broken.user(11))).recorded, false);
});

test('HQ\'s totals count each article\'s objects to its author, and nothing else', async () => {
  const f = fixture();
  const { owners, unreadable } = await readStorageByOwner(f.env);
  assert.deepEqual(unreadable, []);
  assert.equal(owners.get(11)!.measured_bytes, 7300);
  assert.equal(owners.get(11)!.kinds.other, 7300);
  assert.equal(owners.get(22)!.measured_bytes, 90000);
  assert.equal(owners.get(33), undefined);
  assert.equal([...owners.values()].reduce((n, o) => n + o.measured_bytes, 0), 97300, 'an article off record, and news/, count to no one');
  const bare = fixture(null);
  assert.deepEqual((await readStorageByOwner(bare.env)).unreadable, ['articles']);
});

test('a full plan refuses the next write to an article with 413, weighed with its articles', async () => {
  const f = fixture(bucket([...OBJECTS, ['articles/6/img-88888888-8888-8888-8888-888888888888.png', FREE - 7300]]));
  await assert.rejects(assertStorageRoom(f.env, { userId: 11 }, 100, f.user(11)), (e: any) => {
    assert.ok(e instanceof Response);
    assert.equal(e.status, 413);
    return true;
  });
  // Ben's plan is not Ann's.
  assert.equal((await assertStorageRoom(f.env, { userId: 22 }, 100, f.user(22))).passed, 'measured');
});
