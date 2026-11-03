/**
 * #4179 (D4179, part 4 of #3726) — copying R2 learning videos to Stream.
 *
 *   · the copy route: Super Admin only, one item a call; 404, 409 not_r2,
 *     409 already_copied; Stream is asked to fetch a signed source URL and to
 *     require signed playback; a refused upload records nothing;
 *   · the source route: the token is its only key, purpose-scoped, one hour,
 *     one item's one object, and only while that object is the item's upload;
 *   · verification: a copy is verified (and the item moves to it) only when
 *     ready with a duration above 0, and only while the item plays the file
 *     that was copied;
 *   · the sweep: an unverified copy's object is never deleted; a verified
 *     copy's original goes only after retention (owner step F); superseded and
 *     expired Stream videos are deleted at Stream;
 *   · the studio's content read carries each item's copy state.
 *
 * Synthetic fixtures only. `env.STREAM` and `env.FILES` are fakes; no test
 * reaches Stream.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import { adminLearningStream, learningStreamHooks } from '../src/routes/learning_stream.ts';
import {
  R2_KEPT_AFTER_COPY_DAYS, SOURCE_TOKEN_PURPOSE, applyStatus, copyStateOf, signSourceToken, verifySourceToken,
} from '../src/services/learningStream.ts';
import { sweepLearningVideos } from '../src/services/learningVideo.ts';
import { signDownloadToken } from '../src/services/analyticsReports.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4179-copy-0123456789';
const SUPER = 1, MEMBER = 10;
const KEY = `learning/videos/vid-1/${'1'.repeat(32)}.mp4`;
const KEY2 = `learning/videos/vid-2/${'2'.repeat(32)}.mp4`;
const COPY = 'c'.repeat(32), COPY2 = 'd'.repeat(32);
const BYTES = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6, 7, 8]);
const DAY = 86400_000;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1), (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO learning_items (uid, kind, title, visibility, status, created_by, video_source, r2_key) VALUES
      ('vid-1', 'video', 'Pricing basics', 'open', 'published', 1, 'r2', '${KEY}'),
      ('vid-2', 'video', 'Second video', 'open', 'draft', 1, 'r2', '${KEY2}'),
      ('vid-link', 'video', 'A link', 'open', 'published', 1, 'url', NULL),
      ('read-1', 'reading', 'A reading', 'open', 'published', 1, NULL, NULL);
  `);
  const r2 = new Map<string, { bytes: Uint8Array; uploaded: Date }>([[KEY, { bytes: BYTES, uploaded: new Date(Date.now() - 90 * DAY) }], [KEY2, { bytes: BYTES, uploaded: new Date(Date.now() - 90 * DAY) }]]);
  const FILES = {
    head: async (k: string) => (r2.has(k) ? { size: r2.get(k)!.bytes.length, httpMetadata: { contentType: 'video/mp4' } } : null),
    get: async (k: string, o?: any) => {
      const f = r2.get(k); if (!f) return null;
      const b = o?.range ? f.bytes.slice(o.range.offset, o.range.offset + o.range.length) : f.bytes;
      return { body: new Blob([b]).stream() };
    },
    list: async () => ({ objects: [...r2.entries()].map(([key, v]) => ({ key, uploaded: v.uploaded })), truncated: false }),
    delete: async (k: string) => { r2.delete(k); },
  };
  const calls: { op: string; args: unknown[] }[] = [];
  let next = [COPY, COPY2];
  let fail = false;
  const STREAM = {
    createDirectUpload: async () => ({}),
    upload: async (url: string, opts: unknown) => { calls.push({ op: 'upload', args: [url, opts] }); if (fail) throw new Error('synthetic refusal'); return { uid: next.shift() }; },
    video: (uid: string) => ({
      details: async () => ({ uid }), update: async () => ({}), generateToken: async () => 't',
      delete: async () => { calls.push({ op: 'delete', args: [uid] }); return {}; },
      captions: { generate: async () => ({}), delete: async () => ({}) },
    }),
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES, STREAM };
  const app = new Hono<any>()
    .route('/api/admin/learning', adminLearning).route('/api/admin/learning', adminLearningStream)
    .route('/api/learning', learningStreamHooks);
  return { db, env, app, r2, calls, failNext: () => { fail = true; } };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (who != null) {
    h.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === SUPER ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await f.app.request(`https://axal.vc${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }, f.env);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer())) as any, headers: res.headers };
}
const copy = (f: F, item = 'vid-1') => call(f, SUPER, 'POST', '/api/admin/learning/stream/migrations', { item_uid: item });
const row = (f: F, sid: string) => f.db.prepare('SELECT * FROM learning_stream_videos WHERE stream_uid = ?').get(sid) as any;
const item = (f: F, uid = 'vid-1') => f.db.prepare('SELECT video_source, r2_key, stream_uid FROM learning_items WHERE uid = ?').get(uid) as any;
const READY = (uid: string, duration: number) => ({ uid, readyToStream: true, status: { state: 'ready' }, duration });

// ─────────────────────────────────────────────── the copy route

test('a copy is Super Admin only, one item a call, and Stream fetches a signed source with signed playback', async () => {
  const f = fixture();
  assert.equal((await call(f, MEMBER, 'POST', '/api/admin/learning/stream/migrations', { item_uid: 'vid-1' })).status, 403);
  assert.equal((await copy(f, 'nope')).status, 404);
  assert.equal((await copy(f, 'vid-link')).body.error, 'not_r2', 'a link has no file to copy');
  assert.equal((await copy(f, 'read-1')).body.error, 'not_r2');
  const r = await copy(f);
  assert.deepEqual([r.status, r.body.copy], [202, { stream_uid: COPY, state: 'copying' }]);
  const [url, opts] = f.calls.find((c) => c.op === 'upload')!.args as [string, any];
  assert.match(url, /^https:\/\/axal\.vc\/api\/learning\/stream\/source\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(url.includes(KEY), false, 'the bucket key is never in the URL');
  // Mutation checked: drop requireSignedURLs → this fails.
  assert.equal(opts.requireSignedURLs, true);
  assert.deepEqual(opts.meta, { item_uid: 'vid-1', origin: 'r2_copy' });
  assert.deepEqual([row(f, COPY).origin, row(f, COPY).state, row(f, COPY).source_r2_key, row(f, COPY).verified_at], ['r2_copy', 'processing', KEY, null]);
  assert.equal(item(f).stream_uid, null, 'the item plays its file until the copy is verified');
  assert.equal(r2Has(f, KEY), true, 'the R2 object is kept');
  // Mutation checked: drop the open-copy check → a second Stream video is made and this fails.
  assert.equal((await copy(f)).body.error, 'already_copied');
  assert.equal(f.calls.filter((c) => c.op === 'upload').length, 1);
});
const r2Has = (f: F, k: string) => f.r2.has(k);
const b64u = (u: Uint8Array) => Buffer.from(u).toString('base64url');
async function hmacToken(keyText: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const p = new TextEncoder().encode(payload);
  return `${b64u(p)}.${b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, p)))}`;
}

test('a copy Stream refuses records nothing, and a failed copy can be tried again', async () => {
  const f = fixture();
  f.failNext();
  const r = await copy(f);
  assert.deepEqual([r.status, r.body.error], [502, 'stream_copy_failed']);
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM learning_stream_videos WHERE origin = 'r2_copy'").get() as any).n, 0);
  const g = fixture();
  await copy(g);
  await applyStatus(g.env, { uid: COPY, status: { state: 'error', errorReasonCode: 'ERR_SYNTH', errorReasonText: 'Synthetic failure.' } });
  assert.equal((await copy(g)).status, 202, 'an errored copy does not block a retry');
});

// ─────────────────────────────────────────────── the source route

test('the source token is its only key: purpose-scoped, one hour, one item and one object, still the item’s', async () => {
  const f = fixture();
  const token = (await signSourceToken(f.env, 'vid-1', KEY))!;
  const ok = await call(f, null, 'GET', `/api/learning/stream/source/${token}`);
  assert.equal(ok.status, 200);
  assert.deepEqual([...ok.body], [...BYTES]);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  const part = await call(f, null, 'GET', `/api/learning/stream/source/${token}`, undefined, { range: 'bytes=4-7' });
  assert.deepEqual([part.status, part.headers.get('content-range')], [206, `bytes 4-7/${BYTES.length}`]);
  const refused = async (t: string) => (await call(f, null, 'GET', `/api/learning/stream/source/${t}`)).status;
  // Another item's object under this item's name, or a key outside the item's prefix: refused.
  assert.equal(await refused((await signSourceToken(f.env, 'vid-1', KEY2))!), 404);
  assert.equal(await refused((await signSourceToken(f.env, 'vid-1', 'learning/videos/vid-1/../vid-2/x.mp4'))!), 404);
  // A token of another purpose, made with the same secret, is not a source token.
  // Mutation checked: verify with the plain secret (no purpose) and without the payload's purpose check → this fails.
  assert.equal(await refused(await signDownloadToken(f.env, KEY, 3600)), 404);
  // The same secret, the same payload shape, no purpose in the key: refused.
  // Mutation checked: derive the key from the plain secret → this fails.
  assert.equal(await verifySourceToken(f.env, await signDownloadToken(f.env, `${SOURCE_TOKEN_PURPOSE}|vid-1|${KEY}`, 3600)), null);
  // The purpose's own key, another purpose in the payload: refused.
  // Mutation checked: drop the payload's purpose check → this fails.
  const other = await hmacToken(`${SOURCE_TOKEN_PURPOSE}:${JWT_SECRET}`, `analytics-download|vid-1|${KEY}|${Math.floor(Date.now() / 1000) + 600}`);
  assert.equal(await verifySourceToken(f.env, other), null);
  assert.ok(await verifySourceToken(f.env, await hmacToken(`${SOURCE_TOKEN_PURPOSE}:${JWT_SECRET}`, `${SOURCE_TOKEN_PURPOSE}|vid-1|${KEY}|${Math.floor(Date.now() / 1000) + 600}`)), 'the same construction with this purpose verifies');
  // Tampered and expired.
  const [p, s] = token.split('.');
  assert.equal(await refused(`${p}.${s.slice(0, -2)}AA`), 404);
  assert.equal(await verifySourceToken(f.env, (await signSourceToken(f.env, 'vid-1', KEY, Date.now() - 2 * 3600_000))!), null, 'an hour-old token is spent');
  // The item replaced its file: the old token reads nothing.
  f.db.prepare('UPDATE learning_items SET r2_key = ? WHERE uid = ?').run(`learning/videos/vid-1/${'9'.repeat(32)}.mp4`, 'vid-1');
  assert.equal(await refused(token), 404);
  assert.equal(await refused('not-a-token'), 404);
});

// ─────────────────────────────────────────────── verification

test('a copy is verified only when ready with a duration above 0, and the item moves to it only while it plays the copied file', async () => {
  const f = fixture();
  await copy(f);
  await applyStatus(f.env, READY(COPY, 0));
  assert.equal(row(f, COPY).verified_at, null, 'ready with no duration is not verified');
  assert.equal(item(f).stream_uid, null);
  assert.equal(copyStateOf(row(f, COPY)).state, 'copying');
  await applyStatus(f.env, READY(COPY, 241.4));
  assert.ok(row(f, COPY).verified_at);
  assert.equal(item(f).stream_uid, COPY, 'the item plays the verified copy');
  assert.deepEqual([item(f).video_source, item(f).r2_key], ['r2', KEY], 'and keeps its file until retention');
  const listed = (await call(f, SUPER, 'GET', '/api/admin/learning/items')).body.items;
  assert.deepEqual(listed.find((i: any) => i.uid === 'vid-1').stream_copy.state, 'verified');
  assert.deepEqual(listed.find((i: any) => i.uid === 'vid-2').stream_copy, { state: 'none' });
  assert.equal('stream_copy' in listed.find((i: any) => i.uid === 'vid-link'), false);
  assert.equal(JSON.stringify(listed).includes(KEY), false, 'the content read never sends the bucket key');

  // A copy of a file the item has since replaced is verified but plays nothing.
  const g = fixture();
  await copy(g, 'vid-2');
  g.db.prepare('UPDATE learning_items SET r2_key = ? WHERE uid = ?').run(`learning/videos/vid-2/${'8'.repeat(32)}.mp4`, 'vid-2');
  await applyStatus(g.env, READY(COPY, 30));
  assert.ok(row(g, COPY).verified_at);
  // Mutation checked: drop the "still plays the copied object" check → the item moves to an old file's copy and this fails.
  assert.equal(item(g, 'vid-2').stream_uid, null);
});

test('the content table reads Copying…, Verified and Copy failed with the route’s words', async () => {
  const f = fixture();
  await copy(f);
  let listed = (await call(f, SUPER, 'GET', '/api/admin/learning/items')).body.items;
  assert.deepEqual(listed.find((i: any) => i.uid === 'vid-1').stream_copy, { state: 'copying', stream_uid: COPY });
  await applyStatus(f.env, { uid: COPY, status: { state: 'error', errorReasonCode: 'ERR_SYNTH', errorReasonText: 'Synthetic failure.' } });
  listed = (await call(f, SUPER, 'GET', '/api/admin/learning/items')).body.items;
  assert.deepEqual(listed.find((i: any) => i.uid === 'vid-1').stream_copy, { state: 'failed', stream_uid: COPY, error_code: 'ERR_SYNTH', error_message: 'Synthetic failure.' });
});

// ─────────────────────────────────────────────── the sweep

test('the sweep never deletes an unverified copy’s object, even one no item plays', async () => {
  const f = fixture();
  await copy(f);
  // The item moves to a link: its file is no longer in use, and is 90 days old.
  f.db.prepare("UPDATE learning_items SET video_source = 'url', r2_key = NULL WHERE uid = 'vid-1'").run();
  const r = await sweepLearningVideos(f.env, new Date());
  // Mutation checked: drop the unverified-copy hold → the object is deleted and this fails.
  assert.equal(r2Has(f, KEY), true);
  assert.equal(r.kept_unverified, 1);
  // An errored copy is not verified either: it holds its object too.
  await applyStatus(f.env, { uid: COPY, status: { state: 'error' } });
  await sweepLearningVideos(f.env, new Date());
  assert.equal(r2Has(f, KEY), true);
});

test('a verified copy’s original is deleted only after retention, and the item then plays Stream alone', async () => {
  const f = fixture();
  await copy(f);
  await applyStatus(f.env, READY(COPY, 120));
  await sweepLearningVideos(f.env, new Date(Date.now() + (R2_KEPT_AFTER_COPY_DAYS - 1) * DAY));
  // Mutation checked: delete on verification (no retention) → this fails.
  assert.equal(r2Has(f, KEY), true, 'kept inside the retention window');
  const r = await sweepLearningVideos(f.env, new Date(Date.now() + (R2_KEPT_AFTER_COPY_DAYS + 1) * DAY));
  assert.equal(r2Has(f, KEY), false);
  assert.equal(r.copied_deleted, 1);
  assert.deepEqual({ ...item(f) }, { video_source: null, r2_key: null, stream_uid: COPY });
  assert.equal(R2_KEPT_AFTER_COPY_DAYS, 30, 'owner step F: S1’s pick (a)');
  // The item can still be published: it has a Stream video.
  f.db.prepare("UPDATE learning_items SET status = 'draft' WHERE uid = 'vid-1'").run();
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/publish')).status, 200);
});

test('a verified copy the item does not play keeps the original until the usual rules remove it', async () => {
  const f = fixture();
  await copy(f);
  await applyStatus(f.env, READY(COPY, 60));
  f.db.prepare("UPDATE learning_items SET stream_uid = NULL WHERE uid = 'vid-1'").run();
  await sweepLearningVideos(f.env, new Date(Date.now() + 60 * DAY));
  assert.equal(r2Has(f, KEY), true, 'the item still plays its file');
});

test('at Stream: superseded for over 30 days and upload links past expiry are deleted; the current video never is', async () => {
  const f = fixture();
  const old = new Date(Date.now() - 40 * DAY).toISOString();
  const recent = new Date(Date.now() - 5 * DAY).toISOString();
  f.db.prepare(`INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, created_by, updated_at) VALUES ('vid-1', ?, 'upload', 'superseded', 1, ?)`).run('e'.repeat(32), old);
  f.db.prepare(`INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, created_by, updated_at) VALUES ('vid-1', ?, 'upload', 'superseded', 1, ?)`).run('f'.repeat(32), recent);
  f.db.prepare(`INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, created_by, upload_expires_at) VALUES ('vid-2', ?, 'upload', 'awaiting_upload', 1, ?)`).run('0'.repeat(32), old);
  f.db.prepare(`INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, created_by, upload_expires_at) VALUES ('vid-2', ?, 'upload', 'awaiting_upload', 1, ?)`).run('9'.repeat(32), new Date(Date.now() + DAY).toISOString());
  // The item's current video is never swept, whatever its row says.
  // Mutation checked: drop the current-video exclusion → it is deleted at Stream and this fails.
  f.db.prepare(`INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, created_by, updated_at) VALUES ('vid-2', ?, 'upload', 'superseded', 1, ?)`).run('b'.repeat(32), old);
  f.db.prepare(`UPDATE learning_items SET stream_uid = ? WHERE uid = 'vid-2'`).run('b'.repeat(32));
  // A ready video the item plays, even with an old row date, is never swept.
  f.db.prepare(`INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, created_by, updated_at) VALUES ('vid-1', ?, 'upload', 'ready', 1, ?)`).run('a'.repeat(32), old);
  f.db.prepare(`UPDATE learning_items SET stream_uid = ? WHERE uid = 'vid-1'`).run('a'.repeat(32));
  const r = await sweepLearningVideos(f.env, new Date());
  assert.deepEqual(f.calls.filter((c) => c.op === 'delete').map((c) => c.args[0]).sort(), ['0'.repeat(32), 'e'.repeat(32)]);
  assert.equal(r.stream_deleted, 2);
  assert.deepEqual((f.db.prepare('SELECT stream_uid FROM learning_stream_videos ORDER BY stream_uid').all() as any[]).map((x) => x.stream_uid), ['9'.repeat(32), 'a'.repeat(32), 'b'.repeat(32), 'f'.repeat(32)]);
});
