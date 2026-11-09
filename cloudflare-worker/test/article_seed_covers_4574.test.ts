/**
 * D4574 H3 (#4574): the two article seed covers are static assets, not base64
 * in the Worker script. The seed copies a cover into R2 from the assets
 * binding; an answer that is not a JPEG (a missing file answers the SPA shell)
 * is never written as a cover, and the seed tries again on a later request.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/article_seed_covers_4574.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { SEED_COVERS } from '../src/services/articleCoverData.ts';
import { ensureArticleCovers, seedCoverBytes } from '../src/services/articleCovers.ts';
import { d1Over } from './_d1_sqlite.mjs';

const PUBLIC = new URL('../../frontend/public', import.meta.url).pathname;
const fileOf = (asset: string) => `${PUBLIC}${asset}`;

test('the seed covers name asset files that exist and are JPEGs; no bytes are embedded in the script', () => {
  assert.equal(SEED_COVERS.length, 2);
  for (const s of SEED_COVERS) {
    assert.match(s.asset, /^\/article-covers\/[a-z0-9-]+\.jpg$/);
    assert.ok(existsSync(fileOf(s.asset)), s.asset);
    const b = readFileSync(fileOf(s.asset));
    assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff], s.asset);
    assert.equal((s as any).b64, undefined);
  }
  // The guard the bytes would trip: the data file stays small.
  const src = readFileSync(new URL('../src/services/articleCoverData.ts', import.meta.url), 'utf8');
  assert.ok(src.length < 4096, `articleCoverData.ts is ${src.length} bytes`);
  assert.doesNotMatch(src, /\/9j\//, 'a base64 JPEG is back in the script');
});

function fixture(serve: 'files' | 'shell' | 'none') {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE articles (id INTEGER PRIMARY KEY, slug TEXT, status TEXT, cover_r2_key TEXT, cover_mime TEXT, updated_at TEXT)`);
  SEED_COVERS.forEach((s, i) => db.prepare(`INSERT INTO articles (id, slug, status) VALUES (?, ?, 'published')`).run(i + 1, s.slug));
  const puts: Array<{ key: string; size: number; type: string }> = [];
  const fetched: string[] = [];
  const env: any = {
    DB: d1Over(db),
    FILES: { put: async (key: string, bytes: Uint8Array, o: any) => { puts.push({ key, size: bytes.length, type: o?.httpMetadata?.contentType }); } },
    ASSETS: serve === 'none' ? undefined : {
      fetch: async (req: Request) => {
        const path = new URL(req.url).pathname;
        fetched.push(path);
        if (serve === 'shell' || !existsSync(fileOf(path))) return new Response('<!doctype html><title>Axal</title>', { headers: { 'content-type': 'text/html' } });
        return new Response(readFileSync(fileOf(path)), { headers: { 'content-type': 'image/jpeg' } });
      },
    },
  };
  return { db, env, puts, fetched };
}

test('the seed copies each cover from the assets binding into R2 and points the article at it', async () => {
  const f = fixture('files');
  assert.equal(await ensureArticleCovers(f.env), true);
  assert.deepEqual(f.fetched, SEED_COVERS.map((s) => s.asset));
  assert.deepEqual(f.puts.map((p) => [p.key, p.type]), [['articles/1/cover-seed.jpg', 'image/jpeg'], ['articles/2/cover-seed.jpg', 'image/jpeg']]);
  assert.deepEqual(f.puts.map((p) => p.size), SEED_COVERS.map((s) => readFileSync(fileOf(s.asset)).length));
  assert.deepEqual((f.db.prepare('SELECT cover_r2_key FROM articles ORDER BY id').all() as any[]).map((r) => r.cover_r2_key), ['articles/1/cover-seed.jpg', 'articles/2/cover-seed.jpg']);
  // Once done, a later request reads nothing.
  assert.equal(await ensureArticleCovers(f.env), false);
  assert.equal(f.fetched.length, 2);
});

test('the SPA shell answering for a missing file is never written as a cover, and the seed retries', async () => {
  const f = fixture('shell');
  // Mutation checked: drop the content-type and magic checks → the HTML shell is written to R2 as a JPEG.
  assert.equal(await ensureArticleCovers(f.env), false);
  assert.deepEqual(f.puts, []);
  assert.deepEqual((f.db.prepare('SELECT cover_r2_key FROM articles').all() as any[]).map((r) => r.cover_r2_key), [null, null]);
  // Mutation checked: mark the seed ready after a miss → this second request never looks again.
  await ensureArticleCovers(f.env);
  assert.equal(f.fetched.length, 4, 'a missed cover is tried again on the next request');
  const none = fixture('none');
  assert.equal(await seedCoverBytes(none.env, SEED_COVERS[0].asset), null);
  assert.equal(await ensureArticleCovers(none.env), false);
});

test('each check stands on its own: a JPEG type over other bytes, and JPEG bytes under another type, are both refused', async () => {
  const jpeg = readFileSync(fileOf(SEED_COVERS[0].asset));
  const env = (body: BodyInit, type: string): any => ({ ASSETS: { fetch: async () => new Response(body, { headers: { 'content-type': type } }) } });
  // Mutation checked: drop the magic-byte check → the HTML body under an image type is accepted.
  assert.equal(await seedCoverBytes(env('<!doctype html>', 'image/jpeg'), SEED_COVERS[0].asset), null);
  // Mutation checked: drop the content-type check → bytes under an HTML type are accepted.
  assert.equal(await seedCoverBytes(env(jpeg, 'text/html'), SEED_COVERS[0].asset), null);
  assert.equal((await seedCoverBytes(env(jpeg, 'image/jpeg'), SEED_COVERS[0].asset))?.length, jpeg.length);
});
