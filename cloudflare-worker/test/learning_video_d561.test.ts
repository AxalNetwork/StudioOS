/**
 * D561 (#1162) — a Learning video uploaded to R2 by the Super Admin, played
 * back through a gated route with HTTP Range, and swept when no item uses it.
 *
 * The routers run on node:sqlite with the schema built from the baseline and
 * migration 388 (the columns this uses came with D557). R2 is an in-memory
 * stand-in with the surface the routes call: multipart uploads, head, ranged
 * get, delete and list.
 *
 * Run alone:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/learning_video_d561.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import learning from '../src/routes/learning.ts';
import adminLearning from '../src/routes/admin_learning.ts';
import { adminLearningVideo, learningVideo } from '../src/routes/learning_video.ts';
import { parseRange, sweepLearningVideos, keyBelongsTo, VIDEO_MAX_BYTES } from '../src/services/learningVideo.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 10;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [PLAIN_ADMIN]: 'admin', [MEMBER]: 'founder' };

const BUILT = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) <= 388)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
})();

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views naming absent objects */ } }
  db.exec(`
    INSERT INTO users (id, email, name, role, is_active) VALUES
      (${SUPER}, 'super@example.test', 'Super Holder', 'admin', 1),
      (${PLAIN_ADMIN}, 'plain@example.test', 'Plain Admin', 'admin', 1),
      (${MEMBER}, 'member@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
  `);
  return db;
}

/** R2, in memory: the calls the routes and the sweep make, nothing more. */
class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; contentType: string; uploaded: Date }>();
  uploads = new Map<string, { key: string; contentType: string; parts: Map<number, Uint8Array> }>();
  /** Report a different size for a key, standing in for a 2 GB object nobody wants to allocate. */
  sizeOverride = new Map<string, number>();
  async createMultipartUpload(key: string, opts: any) {
    const uploadId = `up-${this.uploads.size + 1}-${Math.random().toString(36).slice(2)}`;
    this.uploads.set(uploadId, { key, contentType: opts?.httpMetadata?.contentType, parts: new Map() });
    return { key, uploadId };
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const u = this.uploads.get(uploadId);
    const open = () => { if (!u || u.key !== key) throw new Error('NoSuchUpload'); return u; };
    return {
      uploadPart: async (n: number, data: ArrayBuffer) => { open().parts.set(n, new Uint8Array(data)); return { partNumber: n, etag: `etag-${n}` }; },
      complete: async (parts: Array<{ partNumber: number; etag: string }>) => {
        const up = open();
        const chunks = parts.slice().sort((a, b) => a.partNumber - b.partNumber).map((p) => {
          const b = up.parts.get(p.partNumber);
          if (!b || p.etag !== `etag-${p.partNumber}`) throw new Error('InvalidPart');
          return b;
        });
        const total = chunks.reduce((s, b) => s + b.length, 0);
        const bytes = new Uint8Array(total);
        let at = 0;
        for (const b of chunks) { bytes.set(b, at); at += b.length; }
        this.objects.set(key, { bytes, contentType: up.contentType, uploaded: new Date() });
        this.uploads.delete(uploadId);
        return {};
      },
      abort: async () => { open(); this.uploads.delete(uploadId); },
    };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: this.sizeOverride.get(key) ?? o.bytes.length, httpMetadata: { contentType: o.contentType }, uploaded: o.uploaded } : null;
  }
  async get(key: string, opts?: any) {
    const o = this.objects.get(key);
    if (!o) return null;
    const r = opts?.range;
    const slice = r ? o.bytes.slice(r.offset, r.offset + r.length) : o.bytes;
    return { body: new Blob([slice]).stream(), size: o.bytes.length };
  }
  async delete(key: string) { this.objects.delete(key); }
  async list({ prefix }: { prefix: string }) {
    return {
      objects: [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded })),
      truncated: false,
    };
  }
  /** Put an object directly, as if an earlier upload had made it. */
  put(key: string, bytes: Uint8Array, contentType = 'video/mp4', uploaded = new Date()) {
    this.objects.set(key, { bytes, contentType, uploaded });
  }
}

async function tokenFor(who: number) {
  return new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

type Init = { method?: string; body?: unknown; raw?: Uint8Array; headers?: Record<string, string> };
async function call(app: any, db: DatabaseSync, r2: FakeR2 | undefined, who: number, path: string, init: Init = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await tokenFor(who)}`, ...(init.headers || {}) };
  let body: any;
  if (init.raw) { body = init.raw; headers['Content-Type'] = 'application/octet-stream'; headers['Content-Length'] ??= String(init.raw.length); }
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers['Content-Type'] = 'application/json'; }
  const res: Response = await app.request(path, { method: init.method || 'GET', headers, body },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: r2 } as any)
    .catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return res;
}
const json = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => null) as any });
const upload = (db: DatabaseSync, r2: FakeR2 | undefined, who: number, path: string, init?: Init) => call(adminLearningVideo, db, r2, who, path, init);
const authoring = (db: DatabaseSync, who: number, path: string, init?: Init) => call(adminLearning, db, undefined, who, path, init);

async function videoItem(db: DatabaseSync): Promise<string> {
  const r = await json(await authoring(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'Pitching', topic: 'fundraising', level: 'intro' } }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.item.uid;
}

/** Upload `bytes` to an item in parts of `partSize`, through the routes; returns the completed answer. */
async function uploadVideo(db: DatabaseSync, r2: FakeR2, uid: string, bytes: Uint8Array, partSize = 4, contentType = 'video/mp4') {
  const start = await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads`, { method: 'POST', body: { content_type: contentType, size_bytes: bytes.length } }));
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const parts = [];
  for (let i = 0, n = 1; i < bytes.length; i += partSize, n++) {
    const p = await json(await upload(db, r2, SUPER,
      `/items/${uid}/video/uploads/part?key=${encodeURIComponent(start.body.key)}&upload_id=${encodeURIComponent(start.body.upload_id)}&part_number=${n}`,
      { method: 'PUT', raw: bytes.slice(i, i + partSize) }));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    parts.push({ part_number: p.body.part_number, etag: p.body.etag });
  }
  const done = await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads/complete`, { method: 'POST', body: { key: start.body.key, upload_id: start.body.upload_id, parts } }));
  return { start: start.body, done };
}

const BYTES = new Uint8Array(Array.from({ length: 10 }, (_, i) => 65 + i)); // "ABCDEFGHIJ"

// --- Upload -------------------------------------------------------------------

test('only the Super Admin uploads', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  for (const who of [PLAIN_ADMIN, MEMBER]) {
    const r = await upload(db, r2, who, `/items/${uid}/video/uploads`, { method: 'POST', body: { content_type: 'video/mp4', size_bytes: 10 } });
    assert.equal(r.status, 403, `user ${who} reached the upload`);
  }
  assert.equal(r2.uploads.size, 0, 'nothing was started for a refused caller');
});

test('a wrong type, an oversized file and a non-video item are refused before anything is stored', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  const start = (body: unknown, item = uid) => upload(db, r2, SUPER, `/items/${item}/video/uploads`, { method: 'POST', body }).then(json);
  assert.equal((await start({ content_type: 'video/quicktime', size_bytes: 10 })).body.error, 'bad_video_type');
  assert.equal((await start({ content_type: 'image/png', size_bytes: 10 })).status, 415);
  const big = await start({ content_type: 'video/mp4', size_bytes: VIDEO_MAX_BYTES + 1 });
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'video_too_large');
  assert.equal((await start({ content_type: 'video/mp4', size_bytes: VIDEO_MAX_BYTES })).status, 201, '2 GB itself is allowed');
  const reading = (await json(await authoring(db, SUPER, '/items', { method: 'POST', body: { kind: 'reading', title: 'Notes', body: 'x' } }))).body.item.uid;
  assert.equal((await start({ content_type: 'video/mp4', size_bytes: 10 }, reading)).body.error, 'not_a_video');
  assert.equal(r2.objects.size, 0);
});

test('an upload attaches the video to its item, records the actor, and lets the item publish', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  assert.equal((await json(await authoring(db, SUPER, `/items/${uid}/publish`, { method: 'POST' }))).body.error, 'no_video', 'nothing to play yet');

  const { start, done } = await uploadVideo(db, r2, uid, BYTES);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(start.key.startsWith(`learning/videos/${uid}/`), 'the object lives under its item');
  const row: any = db.prepare('SELECT video_source, r2_key, video_url FROM learning_items WHERE uid = ?').get(uid);
  assert.equal(row.video_source, 'r2');
  assert.equal(row.r2_key, start.key);
  assert.equal(row.video_url, null);
  assert.deepEqual([...r2.objects.get(start.key)!.bytes], [...BYTES], 'the parts were joined in order');

  const audit: any = db.prepare(`SELECT admin_user_id, filters_json FROM admin_audit_log WHERE action = 'learning.video.attached'`).get();
  assert.equal(audit.admin_user_id, SUPER, 'the actor is recorded');
  assert.equal(JSON.parse(audit.filters_json).key, start.key);

  assert.equal((await authoring(db, SUPER, `/items/${uid}/publish`, { method: 'POST' })).status, 200, 'an uploaded video publishes');
});

test('a step cannot reach another item\'s upload, and a part is held to its limits', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const mine = await videoItem(db);
  const theirs = await videoItem(db);
  const start = (await json(await upload(db, r2, SUPER, `/items/${theirs}/video/uploads`, { method: 'POST', body: { content_type: 'video/mp4', size_bytes: 10 } }))).body;
  const part = (item: string, n = 1, init: Init = { method: 'PUT', raw: BYTES }) =>
    upload(db, r2, SUPER, `/items/${item}/video/uploads/part?key=${encodeURIComponent(start.key)}&upload_id=${encodeURIComponent(start.upload_id)}&part_number=${n}`, init).then(json);
  assert.equal((await part(mine)).body.error, 'bad_key', 'another item\'s key is refused');
  const complete = await json(await upload(db, r2, SUPER, `/items/${mine}/video/uploads/complete`, { method: 'POST', body: { key: start.key, upload_id: start.upload_id, parts: [{ part_number: 1, etag: 'etag-1' }] } }));
  assert.equal(complete.body.error, 'bad_key');
  assert.equal((await part(theirs, 0)).body.error, 'bad_part_number');
  assert.equal((await part(theirs, 1, { method: 'PUT', raw: BYTES, headers: { 'Content-Length': String(96 * 1024 * 1024) } })).status, 413);
  assert.equal((await part(theirs)).status, 200);
  assert.equal(keyBelongsTo(mine, `learning/videos/${mine}/../${theirs}/x.mp4`), false);
  assert.equal(keyBelongsTo(mine, `learning/videos/${mine}/${'a'.repeat(32)}.mp4`), true);
});

test('a completed object over 2 GB, or of another type, is removed and the item is left as it was', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  const start = (await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads`, { method: 'POST', body: { content_type: 'video/mp4', size_bytes: 10 } }))).body;
  await upload(db, r2, SUPER, `/items/${uid}/video/uploads/part?key=${encodeURIComponent(start.key)}&upload_id=${encodeURIComponent(start.upload_id)}&part_number=1`, { method: 'PUT', raw: BYTES });
  r2.sizeOverride.set(start.key, VIDEO_MAX_BYTES + 1);
  const done = await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads/complete`, { method: 'POST', body: { key: start.key, upload_id: start.upload_id, parts: [{ part_number: 1, etag: 'etag-1' }] } }));
  assert.equal(done.status, 413);
  assert.equal(r2.objects.has(start.key), false, 'the oversized object is deleted');
  assert.equal((db.prepare('SELECT video_source FROM learning_items WHERE uid = ?').get(uid) as any).video_source, null);
});

test('an upload can be aborted, and is then closed', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  const start = (await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads`, { method: 'POST', body: { content_type: 'video/webm', size_bytes: 10 } }))).body;
  assert.match(start.key, /\.webm$/);
  const ab = await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads/abort`, { method: 'POST', body: { key: start.key, upload_id: start.upload_id } }));
  assert.equal(ab.status, 200);
  const late = await json(await upload(db, r2, SUPER, `/items/${uid}/video/uploads/part?key=${encodeURIComponent(start.key)}&upload_id=${encodeURIComponent(start.upload_id)}&part_number=1`, { method: 'PUT', raw: BYTES }));
  assert.equal(late.body.error, 'upload_not_open');
});

// --- Playback ---------------------------------------------------------------------

async function publishedVideo(db: DatabaseSync, r2: FakeR2) {
  const uid = await videoItem(db);
  await uploadVideo(db, r2, uid, BYTES);
  await authoring(db, SUPER, `/items/${uid}/publish`, { method: 'POST' });
  return uid;
}
const play = (db: DatabaseSync, r2: FakeR2, who: number, uid: string, range?: string) =>
  call(learningVideo, db, r2, who, `/items/${uid}/video`, range ? { headers: { Range: range } } : {});

test('a Range request answers 206 with the right Content-Range and those bytes', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await publishedVideo(db, r2);
  const res = await play(db, r2, MEMBER, uid, 'bytes=2-5');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(res.headers.get('content-length'), '4');
  assert.equal(await res.text(), 'CDEF');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.match(res.headers.get('cache-control') || '', /^private\b/, 'never cached by a shared cache');
  assert.equal(res.headers.get('content-type'), 'video/mp4');

  const open = await play(db, r2, MEMBER, uid, 'bytes=7-');
  assert.equal(open.headers.get('content-range'), 'bytes 7-9/10');
  assert.equal(await open.text(), 'HIJ');
  const suffix = await play(db, r2, MEMBER, uid, 'bytes=-3');
  assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
  const past = await play(db, r2, MEMBER, uid, 'bytes=20-30');
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('content-range'), 'bytes */10');
  const whole = await play(db, r2, MEMBER, uid);
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), 'ABCDEFGHIJ');
  assert.equal(whole.headers.get('content-length'), '10');
});

test('playback is gated by canSeeLearning, and a refused video is a 404', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  await uploadVideo(db, r2, uid, BYTES);
  assert.equal((await play(db, r2, MEMBER, uid)).status, 404, 'a draft video is not played to a member');
  assert.equal((await play(db, r2, SUPER, uid)).status, 200, 'the Super Admin previews a draft');
  await authoring(db, SUPER, `/items/${uid}/publish`, { method: 'POST' });
  db.prepare(`UPDATE learning_items SET visibility = 'program' WHERE uid = ?`).run(uid);
  assert.equal((await play(db, r2, MEMBER, uid)).status, 404, 'program content stays hidden');
  db.prepare(`UPDATE learning_items SET visibility = 'open' WHERE uid = ?`).run(uid);
  assert.equal((await play(db, r2, MEMBER, uid)).status, 200);
  const anon = await learningVideo.request(`/items/${uid}/video`, {}, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: r2 } as any).catch((e: any) => e);
  assert.notEqual(anon.status, 200, 'a signed-out request is refused');
  const linkOnly = await videoItem(db);
  await authoring(db, SUPER, `/items/${linkOnly}`, { method: 'PATCH', body: { video_url: 'https://youtu.be/abc' } });
  await authoring(db, SUPER, `/items/${linkOnly}/publish`, { method: 'POST' });
  assert.equal((await play(db, r2, MEMBER, linkOnly)).status, 404, 'a linked video has no stream here');
});

test('the item read points at the stream route, never at the bucket', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await publishedVideo(db, r2);
  const item = await json(await call(learning, db, r2, MEMBER, `/items/${uid}`));
  assert.equal(item.body.item.video_stream_url, `/api/learning/items/${uid}/video`);
  assert.doesNotMatch(JSON.stringify(item.body), /learning\/videos\//, 'the bucket key is never sent');
});

test('a link replaces an uploaded video; clearing the link leaves an upload alone', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const uid = await videoItem(db);
  await uploadVideo(db, r2, uid, BYTES);
  await authoring(db, SUPER, `/items/${uid}`, { method: 'PATCH', body: { video_url: null } });
  assert.equal((db.prepare('SELECT video_source FROM learning_items WHERE uid = ?').get(uid) as any).video_source, 'r2');
  await authoring(db, SUPER, `/items/${uid}`, { method: 'PATCH', body: { video_url: 'https://vimeo.com/1' } });
  const row: any = db.prepare('SELECT video_source, r2_key FROM learning_items WHERE uid = ?').get(uid);
  assert.equal(row.video_source, 'url');
  assert.equal(row.r2_key, null);
});

// --- Ranges ----------------------------------------------------------------------

test('parseRange', () => {
  assert.equal(parseRange(null, 10), null);
  assert.equal(parseRange('bytes=0-0,5-6', 10), null, 'multi-range is answered whole');
  assert.equal(parseRange('items=0-1', 10), null);
  assert.deepEqual(parseRange('bytes=0-99', 10), { start: 0, end: 9 }, 'an end past the object is clamped');
  assert.equal(parseRange('bytes=10-', 10), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 10), 'unsatisfiable');
  assert.deepEqual(parseRange('bytes=-50', 10), { start: 0, end: 9 });
  assert.equal(parseRange('bytes=5-2', 10), null);
});

// --- Cleanup ---------------------------------------------------------------------

test('the daily sweep removes what no item needs and keeps what one does', async () => {
  const db = seeded();
  const r2 = new FakeR2();
  const live = await videoItem(db);
  const { start } = await uploadVideo(db, r2, live, BYTES);
  const now = new Date('2026-12-01T03:40:00Z');
  const longAgo = new Date('2026-11-01T00:00:00Z');
  const hex = (c: string) => c.repeat(32);
  // Replaced a day and more ago, and replaced a moment ago.
  r2.put(`learning/videos/${live}/${hex('a')}.mp4`, BYTES, 'video/mp4', longAgo);
  r2.put(`learning/videos/${live}/${hex('b')}.mp4`, BYTES, 'video/mp4', new Date(now.getTime() - 60_000));
  // An item that no longer exists.
  r2.put(`learning/videos/gone/${hex('c')}.mp4`, BYTES, 'video/mp4', longAgo);
  // Archived 45 days ago, and archived 5 days ago.
  const oldArchive = await videoItem(db);
  const oldKey = `learning/videos/${oldArchive}/${hex('d')}.mp4`;
  r2.put(oldKey, BYTES, 'video/mp4', longAgo);
  db.prepare(`UPDATE learning_items SET video_source = 'r2', r2_key = ?, status = 'archived', updated_at = '2026-10-17T00:00:00.000Z' WHERE uid = ?`).run(oldKey, oldArchive);
  const newArchive = await videoItem(db);
  const newKey = `learning/videos/${newArchive}/${hex('e')}.mp4`;
  r2.put(newKey, BYTES, 'video/mp4', longAgo);
  db.prepare(`UPDATE learning_items SET video_source = 'r2', r2_key = ?, status = 'archived', updated_at = '2026-11-26T00:00:00.000Z' WHERE uid = ?`).run(newKey, newArchive);
  // Make the live upload old, so its age is not why it survives.
  r2.objects.get(start.key)!.uploaded = longAgo;

  const r = await sweepLearningVideos({ DB: d1Over(db), FILES: r2 } as any, now);
  assert.equal(r.checked, 6);
  assert.deepEqual([...r2.objects.keys()].sort(), [start.key, `learning/videos/${live}/${hex('b')}.mp4`, newKey].sort());
  assert.equal(r.deleted, 3);
  const cleared: any = db.prepare('SELECT video_source, r2_key FROM learning_items WHERE uid = ?').get(oldArchive);
  assert.deepEqual({ ...cleared }, { video_source: null, r2_key: null }, 'an item whose video was swept no longer points at it');
});
