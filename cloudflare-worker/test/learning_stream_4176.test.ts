/**
 * #4176 (D4176, part 1 of #3726) — Learning video on Cloudflare Stream.
 *
 * S1's list, each mutation-checked:
 *   · the webhook signature: HMAC over `time.body`, five minutes, constant time;
 *     no secret is 503, a bad or stale signature 401 and nothing changes;
 *   · `requireSignedURLs` on every direct upload; the upload's refusals;
 *   · a playback token is minted only after the access check;
 *   · the binding in both wrangler tables;
 *   · precedence: a ready Stream video plays first; a link clears it;
 *   · a generated caption never overwrites an author's transcript.
 * Plus: the webhook is idempotent and supersedes the previous video; the
 * current video cannot be abandoned; chapters are validated.
 *
 * Synthetic fixtures only. `env.STREAM` is a fake; `fetch` throws.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import learning from '../src/routes/learning.ts';
import { adminLearningStream, learningStreamHooks } from '../src/routes/learning_stream.ts';
import { captionReady, parseChapters, stripMarkup, verifyWebhook, vttToText } from '../src/services/learningStream.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4176-stream-0123456789';
const HOOK_SECRET = 'synthetic-webhook-secret-4176';
const SUPER = 1, MEMBER = 10;
const V1 = 'a'.repeat(32), V2 = 'b'.repeat(32);

function fakeStream() {
  const calls: { op: string; args: unknown[] }[] = [];
  let next = [V1, V2, 'c'.repeat(32)];
  const video = (uid: string) => ({
    details: async () => { calls.push({ op: 'details', args: [uid] }); return { uid, readyToStream: false, status: { state: 'inprogress' } }; },
    update: async (p: unknown) => { calls.push({ op: 'update', args: [uid, p] }); return {}; },
    generateToken: async () => { calls.push({ op: 'token', args: [uid] }); return `tok-${uid.slice(0, 4)}`; },
    delete: async () => { calls.push({ op: 'delete', args: [uid] }); return {}; },
    captions: {
      generate: async (lang: string) => { calls.push({ op: 'generate', args: [uid, lang] }); return { language: lang, label: 'English (auto-generated)', status: 'inprogress' }; },
      upload: async (lang: string) => { calls.push({ op: 'upload', args: [uid, lang] }); return {}; },
      delete: async (lang: string) => { calls.push({ op: 'captiondelete', args: [uid, lang] }); return {}; },
    },
  });
  return {
    calls,
    binding: {
      createDirectUpload: async (opts: any) => { calls.push({ op: 'direct', args: [opts] }); const uid = next.shift()!; return { uid, uploadURL: `https://upload.videodelivery.net/${uid}` }; },
      video,
    },
  };
}

function fixture(withStream = true) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Sam Super', 'admin', 1), (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO learning_items (uid, kind, title, visibility, status, created_by, published_at, transcript) VALUES
      ('vid-1', 'video', 'Pricing basics', 'open', 'published', 1, '2026-10-01', NULL),
      ('vid-draft', 'video', 'Draft video', 'open', 'draft', 1, NULL, NULL),
      ('read-1', 'reading', 'A reading', 'open', 'published', 1, '2026-10-01', NULL);
  `);
  const s = fakeStream();
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', STREAM_WEBHOOK_SECRET: HOOK_SECRET, ...(withStream ? { STREAM: s.binding } : {}) };
  const app = new Hono<any>()
    .route('/api/admin/learning', adminLearning).route('/api/admin/learning', adminLearningStream)
    .route('/api/learning', learning).route('/api/learning', learningStreamHooks);
  return { db, env, app, s };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (who != null) {
    h.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: who === SUPER ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await f.app.request(path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }, f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any, headers: res.headers };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function signed(body: string, secret = HOOK_SECRET, time = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `time=${time},sig1=${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${body}`)))}`;
}
async function hook(f: F, payload: unknown, sig?: string) {
  const body = JSON.stringify(payload);
  return call(f, null, 'POST', '/api/learning/stream/webhook', body, { 'Webhook-Signature': sig ?? await signed(body) });
}
const READY = (uid: string, duration = 251.6) => ({ uid, readyToStream: true, status: { state: 'ready' }, duration, size: 1000,
  input: { width: 1920, height: 1080 }, playback: { hls: `https://customer-abc123.cloudflarestream.com/${uid}/manifest/video.m3u8` } });

async function upload(f: F, uid = 'vid-1') {
  const r = await call(f, SUPER, 'POST', `/api/admin/learning/items/${uid}/stream/uploads`, { size_bytes: 1000, content_type: 'video/mp4', name: 'Pricing.mp4' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.stream_uid as string;
}

test('the binding is in both wrangler tables, and every route is 503 without it', async () => {
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  // Mutation checked: drop [env.production.stream] → production has no Stream and this fails.
  assert.match(toml, /^\[stream\]\nbinding = "STREAM"$/m);
  assert.match(toml, /^\[env\.production\.stream\]\nbinding = "STREAM"$/m);
  const f = fixture(false);
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/uploads', { size_bytes: 1, content_type: 'video/mp4' })).body.error, 'stream_unavailable');
  assert.equal((await call(f, SUPER, 'GET', '/api/admin/learning/items/vid-1/stream')).status, 503);
  assert.equal((await hook(f, READY(V1))).status, 503);
  const item = await call(f, MEMBER, 'GET', '/api/learning/items/vid-1');
  assert.equal(item.status, 200);
  assert.equal(item.body.item.video_stream, null, 'without the binding the item plays as before');
});

test('a direct upload asks Stream for signed URLs only, and refuses what it cannot take', async () => {
  const f = fixture();
  const sid = await upload(f);
  const direct = f.s.calls.find((c) => c.op === 'direct')!.args[0] as any;
  // Mutation checked: drop requireSignedURLs → this fails.
  assert.equal(direct.requireSignedURLs, true);
  assert.equal(direct.meta.item_uid, 'vid-1');
  assert.equal((f.db.prepare('SELECT state, origin FROM learning_stream_videos WHERE stream_uid = ?').get(sid) as any).state, 'awaiting_upload');
  assert.equal((await call(f, MEMBER, 'POST', '/api/admin/learning/items/vid-1/stream/uploads', { size_bytes: 1000, content_type: 'video/mp4' })).status, 403);
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/uploads', { size_bytes: 300 * 1024 * 1024, content_type: 'video/mp4' })).body.error, 'video_too_large');
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/uploads', { size_bytes: 1000, content_type: 'image/png' })).status, 415);
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/read-1/stream/uploads', { size_bytes: 1000, content_type: 'video/mp4' })).body.error, 'not_a_video');
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/uploads/tus', undefined, { 'Upload-Length': '400000000' })).body.error, 'stream_tus_unavailable');
});

test('the webhook: a bad, stale or missing signature changes nothing; a good one is idempotent and supersedes the old video', async () => {
  const f = fixture();
  const first = await upload(f);
  const body = JSON.stringify(READY(first));
  // Mutation checked: skip verifyWebhook → the forged hook lands and this fails.
  assert.equal((await hook(f, READY(first), await signed(body, 'wrong-secret'))).status, 401);
  assert.equal((await hook(f, READY(first), await signed(body, HOOK_SECRET, Math.floor(Date.now() / 1000) - 600))).status, 401, 'outside five minutes');
  assert.equal((f.db.prepare('SELECT stream_uid FROM learning_items WHERE uid = ?').get('vid-1') as any).stream_uid, null, 'nothing changed');
  assert.equal(await verifyWebhook(HOOK_SECRET, 'time=1,sig1=zz', body), false);
  delete f.env.STREAM_WEBHOOK_SECRET;
  assert.equal((await hook(f, READY(first))).body.error, 'webhook_unconfigured');
  f.env.STREAM_WEBHOOK_SECRET = HOOK_SECRET;

  assert.deepEqual((await hook(f, READY(first))).body, { ok: true });
  assert.deepEqual((await hook(f, READY(first))).body, { ok: true }, 'delivered twice');
  const row = f.db.prepare('SELECT state, duration_seconds, width, playback_host FROM learning_stream_videos WHERE stream_uid = ?').get(first) as any;
  assert.deepEqual({ ...row }, { state: 'ready', duration_seconds: 252, width: 1920, playback_host: 'customer-abc123.cloudflarestream.com' });
  assert.deepEqual({ ...(f.db.prepare('SELECT stream_uid, duration_seconds FROM learning_items WHERE uid = ?').get('vid-1') as any) }, { stream_uid: first, duration_seconds: 252 });

  const second = await upload(f);
  await hook(f, READY(second, 300));
  assert.equal((f.db.prepare('SELECT stream_uid FROM learning_items WHERE uid = ?').get('vid-1') as any).stream_uid, second);
  assert.equal((f.db.prepare('SELECT state FROM learning_stream_videos WHERE stream_uid = ?').get(first) as any).state, 'superseded');
  assert.deepEqual((await hook(f, READY('f'.repeat(32)))).body, { ignored: true }, 'a video this store never made changes nothing');
  await hook(f, { uid: second, readyToStream: false, status: { state: 'error', errorReasonCode: 'ERR_X', errorReasonText: 'Bad file' } });
  assert.equal((f.db.prepare('SELECT state FROM learning_stream_videos WHERE stream_uid = ?').get(second) as any).state, 'error');
});

test('playback: the token is minted only after the access check; a ready Stream video plays first; a link clears it', async () => {
  const f = fixture();
  const sid = await upload(f, 'vid-1');
  assert.deepEqual((await call(f, MEMBER, 'GET', '/api/learning/items/vid-1')).body.item.video_stream, { state: 'processing' });
  await hook(f, READY(sid));
  const tokensBefore = f.s.calls.filter((c) => c.op === 'token').length;
  const ready = (await call(f, MEMBER, 'GET', '/api/learning/items/vid-1')).body.item.video_stream;
  assert.equal(ready.state, 'ready');
  assert.match(ready.iframe_url, /^https:\/\/customer-abc123\.cloudflarestream\.com\/tok-aaaa\/iframe$/);
  assert.match(ready.hls_url, /tok-aaaa\/manifest\/video\.m3u8$/);
  assert.ok(!JSON.stringify(ready).includes(sid), 'the video id itself is never sent, only the token');
  assert.equal(f.s.calls.filter((c) => c.op === 'token').length, tokensBefore + 1);

  // A draft's Stream video: the member is refused before any token is minted.
  const draftSid = await upload(f, 'vid-draft');
  await hook(f, READY(draftSid));
  const before = f.s.calls.filter((c) => c.op === 'token').length;
  // Mutation checked: mint the token before canSeeLearning → a token is minted for the refused read and this fails.
  assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/vid-draft')).status, 404);
  assert.equal(f.s.calls.filter((c) => c.op === 'token').length, before, 'no token for a read that is refused');

  const linked = await call(f, SUPER, 'PATCH', '/api/admin/learning/items/vid-1', { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  // Mutation checked: keep stream_uid when a link is set → the Stream video still plays and this fails.
  assert.equal((f.db.prepare('SELECT stream_uid FROM learning_items WHERE uid = ?').get('vid-1') as any).stream_uid, null);
  assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/vid-1')).body.item.video_stream, null, 'the link plays now');
});

test('a generated caption fills an empty transcript and never overwrites an author\'s', async () => {
  const f = fixture();
  const sid = await upload(f);
  await hook(f, READY(sid));
  const gen = await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/captions/generate', { language: 'en' });
  assert.equal(gen.status, 202, JSON.stringify(gen.body));
  const vid = (f.db.prepare('SELECT id FROM learning_stream_videos WHERE stream_uid = ?').get(sid) as any).id;
  const vtt = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nWelcome to <b>pricing</b>.\n\n2\n00:00:02.000 --> 00:00:04.000\nWe cover churn.\n';
  assert.equal(vttToText(vtt), 'Welcome to pricing. We cover churn.');
  // Mutation checked: keep the stray angle brackets → '<script' survives and this fails.
  assert.equal(vttToText('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<<script>script>alert(1)</b>'), 'scriptalert(1)', 'no markup and no angle bracket survives');
  for (const t of ['x<<<y>>>z', 'a > b < c', '<scr<script>ipt>', '>>><'] as const) assert.doesNotMatch(stripMarkup(t), /[<>]/, t);
  assert.equal(stripMarkup('<v Ana>Hello</v> there'), 'Hello there');
  assert.equal(vttToText('WEBVTT\n\n00:00.000 --> 00:01.000\nThe arrow --> stays in words.'), 'The arrow -- stays in words.', 'only a timing line is dropped');
  assert.deepEqual(await captionReady(f.env, vid, 'en', vtt), { transcriptFilled: true });
  assert.equal((f.db.prepare('SELECT transcript FROM learning_items WHERE uid = ?').get('vid-1') as any).transcript, 'Welcome to pricing. We cover churn.');
  f.db.prepare("UPDATE learning_items SET transcript = 'The author wrote this.' WHERE uid = 'vid-1'").run();
  // Mutation checked: drop `(transcript IS NULL OR transcript = '')` → the author's transcript is replaced and this fails.
  assert.deepEqual(await captionReady(f.env, vid, 'en', 'WEBVTT\n\n00:00.000 --> 00:01.000\nMachine words.'), { transcriptFilled: false });
  assert.equal((f.db.prepare('SELECT transcript FROM learning_items WHERE uid = ?').get('vid-1') as any).transcript, 'The author wrote this.');
  assert.equal((await call(f, SUPER, 'PUT', '/api/admin/learning/items/vid-1/stream/captions/fr', 'not a vtt', { 'content-type': 'text/vtt' })).body.error, 'bad_vtt');
  assert.equal((await call(f, SUPER, 'PUT', '/api/admin/learning/items/vid-1/stream/captions/fr', 'WEBVTT\n\n00:00.000 --> 00:01.000\nBonjour', { 'content-type': 'text/vtt' })).status, 200);
  assert.equal((await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/captions/generate', { language: 'not a tag!' })).body.error, 'bad_language');
});

test('the current video cannot be abandoned; the thumbnail and chapters are checked', async () => {
  const f = fixture();
  const sid = await upload(f);
  assert.equal((await call(f, SUPER, 'PATCH', '/api/admin/learning/items/vid-1/stream/thumbnail', { thumbnail_pct: 0.5 })).body.error, 'not_ready');
  await hook(f, READY(sid));
  assert.equal((await call(f, SUPER, 'POST', `/api/admin/learning/items/vid-1/stream/${sid}/abandon`)).body.error, 'stream_in_use');
  const spare = await upload(f);
  assert.deepEqual((await call(f, SUPER, 'POST', `/api/admin/learning/items/vid-1/stream/${spare}/abandon`)).body, { abandoned: true });
  assert.ok(f.s.calls.some((c) => c.op === 'delete' && c.args[0] === spare));
  assert.equal((await call(f, SUPER, 'PATCH', '/api/admin/learning/items/vid-1/stream/thumbnail', { thumbnail_pct: 2 })).body.error, 'bad_thumbnail');
  assert.equal((await call(f, SUPER, 'PATCH', '/api/admin/learning/items/vid-1/stream/thumbnail', { thumbnail_pct: 0.25 })).status, 200);
  assert.deepEqual(parseChapters([{ start_seconds: 0, title: 'Intro' }, { start_seconds: 60, title: 'Churn' }]), [{ start_seconds: 0, title: 'Intro' }, { start_seconds: 60, title: 'Churn' }]);
  assert.equal(parseChapters([{ start_seconds: 60, title: 'A' }, { start_seconds: 60, title: 'B' }]), null, 'strictly increasing');
  assert.equal(parseChapters(Array.from({ length: 101 }, (_, i) => ({ start_seconds: i, title: 'x' }))), null, 'at most 100');
  assert.equal((await call(f, SUPER, 'PATCH', '/api/admin/learning/items/vid-1', { chapters: [{ start_seconds: 5, title: '' }] })).body.error, 'bad_chapters');
  assert.equal((await call(f, SUPER, 'PATCH', '/api/admin/learning/items/vid-1', { chapters: [{ start_seconds: 0, title: 'Intro' }] })).status, 200);
  assert.deepEqual((await call(f, MEMBER, 'GET', '/api/learning/items/vid-1')).body.item.chapters, [{ start_seconds: 0, title: 'Intro' }]);
  const status = await call(f, SUPER, 'GET', '/api/admin/learning/items/vid-1/stream');
  assert.equal(status.body.current, sid);
  assert.ok(!JSON.stringify(status.body).includes('tok-'), 'the admin status carries no token');
});
