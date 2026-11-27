/**
 * #4178 (D4178, L3 of #3726) — the caption read the player times its transcript
 * from: GET /api/learning/items/:uid/captions/:lang. Each check mutation-tested:
 *   · the access check runs before Stream is asked (a hidden item is 404, no fetch);
 *   · 503 stream_captions_unavailable without the binding or the API token;
 *   · only a ready caption of the item's ready video is read; any other is 404;
 *   · the answer is { language, vtt }, private and never stored; anything but WebVTT from Stream is 502;
 *   · the token goes only to Stream's API, never into the answer.
 *
 * Synthetic fixtures only. `env.STREAM` is a fake; `fetch` is stubbed per test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import learning from '../src/routes/learning.ts';
import { adminLearningStream, learningStreamHooks } from '../src/routes/learning_stream.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4178-captions-0123456789';
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


const API_TOKEN = 'synthetic-stream-api-token-4178';
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nWelcome to pricing.\n';

/** A world with vid-1 ready on Stream (V1) and an English caption, ready. */
async function readyWorld(over: Record<string, unknown> = {}) {
  const f = fixture();
  Object.assign(f.env, { STREAM_API_TOKEN: API_TOKEN, CLOUDFLARE_ACCOUNT_ID: 'acct-4178' }, over);
  const r = await call(f, SUPER, 'POST', '/api/admin/learning/items/vid-1/stream/uploads', { size_bytes: 1000, content_type: 'video/mp4' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await hook(f, READY(V1))).status, 200);
  const v = f.db.prepare(`SELECT id FROM learning_stream_videos WHERE stream_uid = ?`).get(V1) as { id: number };
  f.db.prepare(`INSERT INTO learning_stream_captions (stream_video_id, language, label, source, state, created_by) VALUES (?, 'en', 'English', 'uploaded', 'ready', ${SUPER})`).run(v.id);
  f.db.prepare(`INSERT INTO learning_stream_captions (stream_video_id, language, label, source, state, created_by) VALUES (?, 'fr', NULL, 'generated', 'pending', ${SUPER})`).run(v.id);
  return f;
}

/** Stubs fetch for one test; records each URL and its Authorization. */
function stubFetch(answer: () => Response) {
  const seen: { url: string; auth: string | null }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') });
    return answer();
  }) as any;
  return { seen, restore: () => { globalThis.fetch = real; } };
}

async function raw(f: F, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  return f.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
}

test('a member reads a ready caption as { language, vtt }, private and never stored; the token goes only to Stream', async () => {
  const f = await readyWorld();
  const s = stubFetch(() => new Response(VTT, { status: 200 }));
  try {
    const res = await raw(f, MEMBER, '/api/learning/items/vid-1/captions/en');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type') ?? '', /^application\/json/);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { language: 'en', vtt: VTT });
    assert.ok(!text.includes(API_TOKEN));
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].url, `https://api.cloudflare.com/client/v4/accounts/acct-4178/stream/${V1}/captions/en/vtt`);
    assert.equal(s.seen[0].auth, `Bearer ${API_TOKEN}`);
  } finally { s.restore(); }
});

test('the access check runs first: a hidden item is 404 and Stream is never asked', async () => {
  const f = await readyWorld();
  f.db.prepare(`UPDATE learning_items SET status = 'draft' WHERE uid = 'vid-1'`).run();
  const s = stubFetch(() => new Response(VTT));
  try {
    const r = await call(f, MEMBER, 'GET', '/api/learning/items/vid-1/captions/en');
    assert.equal(r.status, 404);
    assert.equal(s.seen.length, 0, 'Stream was asked before the access check');
    assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/nope/captions/en')).status, 404);
  } finally { s.restore(); }
});

test('503 without the binding or the API token; 400 for a bad language; 404 for a caption that is not ready', async () => {
  const s = stubFetch(() => new Response(VTT));
  try {
    for (const over of [{ STREAM_API_TOKEN: undefined }, { CLOUDFLARE_ACCOUNT_ID: undefined }, { STREAM: undefined }]) {
      const f = await readyWorld();
      Object.assign(f.env, over);
      const r = await call(f, MEMBER, 'GET', '/api/learning/items/vid-1/captions/en');
      assert.equal(r.status, 503, JSON.stringify(over));
      assert.equal(r.body.error, 'stream_captions_unavailable');
    }
    const f = await readyWorld();
    assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/vid-1/captions/en..%2F')).status, 400);
    assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/vid-1/captions/fr')).status, 404, 'a pending caption is not read');
    assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/vid-1/captions/de')).status, 404, 'no caption in that language');
    assert.equal((await call(f, MEMBER, 'GET', '/api/learning/items/read-1/captions/en')).status, 404, 'no Stream video');
    assert.equal(s.seen.length, 0, 'none of these asked Stream');
  } finally { s.restore(); }
});

test('anything but WebVTT from Stream is 502, never passed on', async () => {
  for (const answer of [() => new Response('<html>oops</html>'), () => new Response('nope', { status: 500 }), () => { throw new Error('down'); }]) {
    const f = await readyWorld();
    const s = stubFetch(answer as any);
    try {
      const r = await call(f, MEMBER, 'GET', '/api/learning/items/vid-1/captions/en');
      assert.equal(r.status, 502);
      assert.equal(r.body.error, 'caption_unreadable');
    } finally { s.restore(); }
  }
});
