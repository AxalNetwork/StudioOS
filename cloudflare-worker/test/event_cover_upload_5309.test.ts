/**
 * #5309 (D5309, D3724 §gaps 8 to 11): the uploaded event cover and four drawn
 * variants per press. Synthetic data, the mounted Worker routes and the real
 * migrated schema in memory; `env.AI` is a stub, R2 is a map and `fetch` throws.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/event_cover_upload_5309.test.ts
 *
 *   · the upload refuses the wrong type, a file too large, an image too small,
 *     missing or over-long alt text, a bad focal point and a crop at the wrong
 *     shape — each before a byte is stored;
 *   · it stores ONE image, answers its URL, alt text, focal point and three
 *     crops, and writes nothing on the event until Save does;
 *   · only the host or an admin uploads, and a draft's upload is not public;
 *   · four variants are quoted in one figure, charged once however often the
 *     same quote is pressed, and the brand kit's colours reach the prompt;
 *   · a missing cover reads as missing: no URL, no alt text, and never a 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import events from '../src/routes/events.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { FACE_MODEL } from '../src/services/ai/postDraw.ts';
import { UPLOAD_MESSAGES, VARIANTS_PER_DRAW, cropsAsk, imageSize, rectsAsk } from '../src/services/eventCovers.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'synthetic-5309-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';
const SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const HOST = 2, OTHER = 3, ADMIN = 9;
const PROJECT = 11;

/** A PNG header of exactly these pixel dimensions, with a body of filler. The routes read the header, never the body. */
function png(width: number, height: number, bodyBytes = 64): Uint8Array {
  const b = new Uint8Array(33 + bodyBytes);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  const be32 = (at: number, v: number) => { b[at] = (v >>> 24) & 255; b[at + 1] = (v >>> 16) & 255; b[at + 2] = (v >>> 8) & 255; b[at + 3] = v & 255; };
  be32(16, width); be32(20, height);
  b[24] = 8; b[25] = 6;
  return b;
}

/** A JPEG whose first start-of-frame carries these dimensions. */
function jpeg(width: number, height: number): Uint8Array {
  const b = new Uint8Array(2 + 2 + 17);
  b[0] = 0xff; b[1] = 0xd8;
  b[2] = 0xff; b[3] = 0xc0;
  b[4] = 0; b[5] = 17;
  b[6] = 8;
  b[7] = (height >> 8) & 255; b[8] = height & 255;
  b[9] = (width >> 8) & 255; b[10] = width & 255;
  return b;
}

async function fixture({ brandKit = false, drawFails = 0 } = {}) {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role] of [[HOST, 'founder'], [OTHER, 'founder'], [ADMIN, 'admin']] as const) insert.run(id, role, null, `Synthetic ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN);
  db.prepare("INSERT INTO projects(id, name) VALUES (?, 'Synthetic venture')").run(PROJECT);
  db.prepare("INSERT INTO events(id, slug, host_user_id, project_id, title, starts_at, status, visibility) VALUES (1, 'synthetic-meetup', ?, ?, 'Synthetic meetup', '2026-12-01T18:00:00Z', 'draft', 'private')").run(HOST, PROJECT);
  if (brandKit) {
    db.prepare("INSERT INTO deck_brand_kits(project_id, display_font, body_font, palette_json, image_style, reference_uids_json, logo_uid) VALUES (?, 'Inter', 'Inter', ?, 'photo', '[]', NULL)")
      .run(PROJECT, JSON.stringify({ ground: '#0B1020', ink: '#F5F7FF', accent: '#4B6BFF', secondary: 'not-a-colour', highlight: '#FFB020' }));
  }
  for (const u of [HOST, OTHER, ADMIN]) db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(?,?)').run(u, 50_000_000);
  for (const key of ['founder:free', 'founder:studio', 'admin:free', 'admin:studio']) db.prepare('INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,0,0,2)').run(key);
  const calls: Array<{ model: string; what: string; text: string }> = [];
  let draws = 0;
  const AI = withGuard({
    run: async (model: string, input: any) => {
      const text = JSON.stringify(input ?? {});
      if (model === FACE_MODEL) { calls.push({ model, what: 'face', text }); return { answer: 'NO' }; }
      if (model === SCOUT) {
        const what = /nudity/.test(text) ? 'screen' : 'alt';
        calls.push({ model, what, text });
        return { response: what === 'screen' ? 'NO' : 'A harbour at dawn in warm colours.', usage: { prompt_tokens: 40, completion_tokens: 8 } };
      }
      draws += 1;
      calls.push({ model, what: 'draw', text });
      if (draws <= drawFails) throw new Error('the image model did not answer');
      return { image: TINY_PNG };
    },
  });
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES };
  const app = new Hono<any>().route('/api/events', events);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const charged = () => (db.prepare("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE guard_for IS NULL AND task = 'event_cover'").get() as any).n as number;
  const holds = () => (db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status IN ('pending','review')").get() as any).n as number;
  return { db, env, app, calls, r2, close, charged, holds };
}
type F = Awaited<ReturnType<typeof fixture>>;

const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

async function get(f: F, who: number | null, path: string) {
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${await token(who)}` } : {};
  const res = await f.app.request(ORIGIN + path, { headers }, f.env);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer())) as any, headers: res.headers };
}

async function post(f: F, who: number | null, path: string, json: unknown, method = 'POST') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${await token(who)}`;
  const res = await f.app.request(ORIGIN + path, { method, headers, body: JSON.stringify(json) }, f.env);
  return { status: res.status, body: await res.json() as any };
}

/**
 * The crops the editor derives: for each shape, the largest rectangle of that
 * shape inside the image, centred. The same formula as
 * `frontend/src/pages/events/eventCoverModel.js`'s `cropRect`, written out here
 * because a Worker test imports no frontend module.
 */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
function cropsFor(imageRatio: number): Record<'card' | 'social' | 'square', { x: number; y: number; w: number; h: number }> {
  const one = (want: number) => {
    const w = want <= imageRatio ? want / imageRatio : 1;
    const h = want <= imageRatio ? 1 : imageRatio / want;
    return { x: round6((1 - w) / 2), y: round6((1 - h) / 2), w: round6(w), h: round6(h) };
  };
  return { card: one(16 / 9), social: one(1.91), square: one(1) };
}
const CROPS_16_9 = cropsFor(1920 / 1080);

async function upload(f: F, who: number | null, parts: { bytes?: Uint8Array; type?: string; alt?: string | null; focal?: unknown; crops?: unknown; omitFile?: boolean } = {}) {
  const form = new FormData();
  if (!parts.omitFile) form.append('file', new Blob([(parts.bytes ?? png(1920, 1080)) as any], { type: parts.type ?? 'image/png' }), 'cover.png');
  if (parts.alt !== null) form.append('alt', parts.alt ?? 'A harbour at dawn');
  if (parts.focal !== undefined) form.append('focal', typeof parts.focal === 'string' ? parts.focal : JSON.stringify(parts.focal));
  form.append('crops', typeof parts.crops === 'string' ? parts.crops : JSON.stringify(parts.crops ?? CROPS_16_9));
  const headers: Record<string, string> = who ? { Authorization: `Bearer ${await token(who)}` } : {};
  // The storage guard refuses by THROWING a Response, which production answers
  // through `withThrownResponses` in `index.ts`; this press goes through it too.
  const res = await withThrownResponses(() => f.app.request(ORIGIN + '/api/events/1/cover/upload', { method: 'POST', headers, body: form }, f.env));
  return { status: res.status, body: await res.json() as any };
}

test('imageSize reads a PNG\'s IHDR and a JPEG\'s start of frame, and nothing else', () => {
  assert.deepEqual(imageSize(png(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(imageSize(jpeg(1200, 675)), { width: 1200, height: 675 });
  assert.equal(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0])), null, 'a GIF is not a cover');
  assert.equal(imageSize(png(0, 1080)), null, 'a zero dimension is no size');
  // Mutation check: a byte changed in the width field changes the answer.
  const b = png(1920, 1080); b[18] = 0x04;
  assert.deepEqual(imageSize(b), { width: 0x0480, height: 1080 }, 'the width is read from the header, not assumed');
});

test('cropsAsk checks each crop\'s shape against the image; rectsAsk checks the rectangles only', () => {
  const ok = cropsAsk(CROPS_16_9, 1920 / 1080);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  // Against a square image the same rectangles are the wrong shapes.
  assert.equal(cropsAsk(CROPS_16_9, 1).ok, false, 'a 16:9 card crop is not a card crop of a square image');
  assert.equal(cropsAsk({ ...CROPS_16_9, square: { x: 0, y: 0, w: 1, h: 1 } }, 1920 / 1080).ok, false, 'a full-frame square crop of a wide image is not square');
  assert.equal(cropsAsk({ card: CROPS_16_9.card, social: CROPS_16_9.social }, 1920 / 1080).ok, false, 'all three crops are required');
  assert.equal(cropsAsk({ ...CROPS_16_9, card: { x: 0.5, y: 0, w: 1, h: 1 } }, 1920 / 1080).ok, false, 'a crop outside the image is refused');
  // The same rectangles, with no image to check them against, stand as rectangles.
  assert.equal(rectsAsk(CROPS_16_9).ok, true);
  assert.equal(rectsAsk({ ...CROPS_16_9, square: { x: 0, y: 0, w: 1, h: 1 } }).ok, true, 'a Save checks no shape');
  assert.equal(rectsAsk({ ...CROPS_16_9, card: { x: 0, y: 0, w: 0, h: 1 } }).ok, false, 'an empty rectangle is never a crop');
  assert.equal(rectsAsk('[]').ok, false);
  assert.equal(rectsAsk('not json').ok, false);
});

test('the upload stores one image and answers its URL, alt text, focal point and three crops; Save writes the event', async () => {
  const f = await fixture();
  try {
    const r = await upload(f, HOST, { focal: { x: 0.25, y: 0.75 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.url, /^https:\/\/axal\.vc\/api\/events\/1\/cover\/upload-[0-9a-f-]{36}\.png$/);
    assert.equal(r.body.alt, 'A harbour at dawn');
    assert.deepEqual(r.body.focal, { x: 0.25, y: 0.75 });
    assert.deepEqual(Object.keys(r.body.crops).sort(), ['card', 'social', 'square']);
    assert.deepEqual(r.body.image, { width: 1920, height: 1080, ratio: 1920 / 1080, content_type: 'image/png' });
    assert.equal(r.body.source, 'uploaded');
    assert.equal(r.body.saved, false);
    assert.equal(f.r2.size, 1, 'one image, not three');
    assert.deepEqual([...f.r2.keys()].map((k) => k.replace(/upload-.*$/, 'upload-*')), ['events/1/covers/upload-*']);
    const row = f.db.prepare('SELECT cover_url, cover_alt, cover_source, cover_focal_json, cover_crops_json FROM events WHERE id = 1').get() as any;
    assert.deepEqual([row.cover_url, row.cover_alt, row.cover_source, row.cover_focal_json, row.cover_crops_json], [null, null, null, null, null], 'the upload writes nothing; Save does');
    // The member's own Save writes the fields the upload answered.
    const saved = await post(f, HOST, '/api/events/1', { cover_url: r.body.url, cover_alt: r.body.alt, cover_source: 'uploaded', cover_focal: r.body.focal, cover_crops: r.body.crops }, 'PATCH');
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.event.cover_alt, 'A harbour at dawn');
    assert.equal(saved.body.event.cover_source, 'uploaded');
    assert.deepEqual(saved.body.event.cover_focal, { x: 0.25, y: 0.75 });
    assert.deepEqual(Object.keys(saved.body.event.cover_crops).sort(), ['card', 'social', 'square']);
    // The stored image reads back for the host and for nobody who cannot see the draft.
    const path = new URL(r.body.url).pathname;
    const served = await get(f, HOST, path);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await get(f, null, path)).status, 404);
    assert.equal((await get(f, OTHER, path)).status, 404);
    assert.equal((await get(f, HOST, '/api/events/1/cover/upload-..%2F..%2Fsecret.png')).status, 404, 'only an upload\'s own name is read');
  } finally { f.close(); }
});

test('the upload refuses the type, the size, the alt text, the focal point and a bad crop, each before a byte is stored', async () => {
  const f = await fixture();
  try {
    const cases: Array<[Parameters<typeof upload>[2], number, string, string]> = [
      [{ omitFile: true }, 400, 'file_required', UPLOAD_MESSAGES.file_required],
      [{ bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }, 400, 'unreadable_image', UPLOAD_MESSAGES.unreadable_image],
      [{ bytes: png(800, 600) }, 400, 'too_small', UPLOAD_MESSAGES.too_small],
      [{ bytes: png(1920, 500) }, 400, 'too_small', UPLOAD_MESSAGES.too_small],
      [{ alt: null }, 400, 'alt_required', UPLOAD_MESSAGES.alt_required],
      [{ alt: '   ' }, 400, 'alt_required', UPLOAD_MESSAGES.alt_required],
      [{ alt: 'x'.repeat(201) }, 400, 'alt_too_long', UPLOAD_MESSAGES.alt_too_long],
      [{ focal: { x: 1.5, y: 0.5 } }, 400, 'bad_focal', UPLOAD_MESSAGES.bad_focal],
      [{ focal: 'not json' }, 400, 'bad_focal', UPLOAD_MESSAGES.bad_focal],
      [{ crops: { card: CROPS_16_9.card } }, 400, 'bad_crops', UPLOAD_MESSAGES.bad_crops],
      [{ crops: { ...CROPS_16_9, square: { x: 0, y: 0, w: 1, h: 1 } } }, 400, 'bad_crops', UPLOAD_MESSAGES.bad_crops],
    ];
    for (const [parts, status, code, message] of cases) {
      const r = await upload(f, HOST, parts);
      assert.equal(r.status, status, `${code}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, code, JSON.stringify(r.body));
      assert.equal(r.body.message, message);
      assert.equal(f.r2.size, 0, `${code}: nothing is stored on a refusal`);
    }
    // A JPEG of the smallest allowed size passes, which is the other side of `too_small`.
    const okJpeg = await upload(f, HOST, { bytes: jpeg(1200, 675), type: 'image/jpeg', crops: cropsFor(1200 / 675) });
    assert.equal(okJpeg.status, 201, JSON.stringify(okJpeg.body));
    assert.equal(okJpeg.body.image.content_type, 'image/jpeg');
    assert.match(okJpeg.body.url, /\.jpg$/);
  } finally { f.close(); }
  // Not multipart at all.
  const g = await fixture();
  try {
    const r = await post(g, HOST, '/api/events/1/cover/upload', { alt: 'x' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'multipart_required');
    assert.equal(g.r2.size, 0);
  } finally { g.close(); }
});

test('D1170: the upload is weighed against the uploader\'s plan, and a full plan stores nothing', async () => {
  const f = await fixture();
  try {
    // One stored research document far larger than any allowance this repo holds.
    f.db.prepare("INSERT INTO research_documents(uid, owner_user_id, title, r2_key, size_bytes) VALUES ('r-huge', ?, 'Huge', 'research/huge', ?)")
      .run(HOST, 10 * 1024 ** 4);
    const full = await upload(f, HOST);
    assert.equal(full.status, 413, JSON.stringify(full.body));
    assert.equal(full.body.error, 'storage_full');
    assert.match(full.body.message, /Nothing was saved/);
    assert.equal(f.r2.size, 0, 'a full plan stores nothing');
    // The same press from a staff account passes: staff have no allowance (D1167).
    assert.equal((await upload(f, ADMIN)).status, 201);
  } finally { f.close(); }
});

test('only the host or an admin uploads a cover', async () => {
  const f = await fixture();
  try {
    assert.equal((await upload(f, null)).status, 401);
    assert.equal((await upload(f, OTHER)).status, 403);
    assert.equal(f.r2.size, 0, 'neither stored anything');
    assert.equal((await upload(f, ADMIN)).status, 201);
  } finally { f.close(); }
});

test('four variants: one quote for all four, the brand kit\'s colours in the prompt, charged once however often the press is retried', async () => {
  const f = await fixture({ brandKit: true });
  try {
    const q = await post(f, HOST, '/api/events/1/cover/variants/quote', { prompt: 'A harbour at dawn, warm colours' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.variants, VARIANTS_PER_DRAW);
    assert.equal(q.body.hold_microusd, q.body.per_draw_microusd * VARIANTS_PER_DRAW, 'one figure for four draws');
    assert.ok(q.body.per_draw_microusd > 0);
    // §gap 10: the venture's own palette, in key order, hex values only.
    assert.deepEqual(q.body.brand_colours, ['#0b1020', '#f5f7ff', '#4b6bff', '#ffb020'], 'the kit\'s non-colour value is dropped, never guessed at');
    assert.equal(q.body.brand_colours.length, 4, 'four of the kit\'s five roles hold a colour');
    assert.equal(q.body.brand_colours_recorded, true);
    assert.ok(q.body.quote_uid, 'the quote names itself');
    assert.deepEqual(f.calls, [], 'a quote draws nothing');

    const r = await post(f, HOST, '/api/events/1/cover/variants', { prompt: 'A harbour at dawn, warm colours', quote_uid: q.body.quote_uid });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.variants.length, VARIANTS_PER_DRAW);
    assert.equal(r.body.asked, VARIANTS_PER_DRAW);
    assert.deepEqual(r.body.refused, []);
    assert.equal(r.body.saved, false);
    assert.deepEqual(r.body.variants.map((v: any) => v.index), [0, 1, 2, 3]);
    assert.equal(new Set(r.body.variants.map((v: any) => v.filename)).size, 4, 'four images, not one reused');
    for (const v of r.body.variants) {
      assert.match(v.url, /^https:\/\/axal\.vc\/api\/events\/1\/cover\/cover-[0-9a-f-]{36}\.png$/);
      assert.equal(v.alt, 'A harbour at dawn in warm colours.');
    }
    assert.equal(f.r2.size, 4);
    const prompts = f.calls.filter((c) => c.what === 'draw').map((c) => c.text);
    assert.equal(prompts.length, 4);
    for (const p of prompts) assert.match(p, /#0b1020/, 'every draw carries the brand palette');
    assert.equal(f.charged(), 4, 'four draws, four charges');
    assert.equal(f.holds(), 0, 'every hold settled');

    // The same press again on the same quote: replayed, and nothing is charged again.
    const again = await post(f, HOST, '/api/events/1/cover/variants', { prompt: 'A harbour at dawn, warm colours', quote_uid: q.body.quote_uid });
    assert.equal(f.charged(), 4, 'a retried press charges nothing again');
    assert.ok(again.status >= 400, `a replayed press is refused rather than answered with new images: ${JSON.stringify(again.body)}`);
    assert.equal(f.r2.size, 4, 'and stores nothing again');
  } finally { f.close(); }
});

test('four variants: no quote is no draw, a stale quote is refused, and a venture with no kit says so', async () => {
  const f = await fixture();
  try {
    const none = await post(f, HOST, '/api/events/1/cover/variants', { prompt: 'A harbour at dawn' });
    assert.equal(none.status, 409);
    assert.equal(none.body.error, 'quote_stale');
    assert.deepEqual(f.calls, [], 'nothing ran without a quote');
    const stale = await post(f, HOST, '/api/events/1/cover/variants', { prompt: 'A harbour at dawn', quote_uid: 'zzzz.0123456789abcdef0123456789abcdef' });
    assert.equal(stale.status, 409);
    assert.equal(f.r2.size, 0);
    // No brand kit for this venture: said, not guessed.
    const q = await post(f, HOST, '/api/events/1/cover/variants/quote', { prompt: 'A harbour at dawn' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual(q.body.brand_colours, []);
    assert.equal(q.body.brand_colours_recorded, false);
    // A prompt that names a real person is refused before any price.
    const person = await post(f, HOST, '/api/events/1/cover/variants/quote', { prompt: 'A close-up portrait of the founders on stage' });
    assert.equal(person.status, 422, JSON.stringify(person.body));
    assert.deepEqual(f.calls, [], 'still nothing ran');
    assert.equal((await post(f, OTHER, '/api/events/1/cover/variants/quote', { prompt: 'A harbour' })).status, 403);
  } finally { f.close(); }
});

test('three of four drawn is three: the press answers the images it has and names what refused', async () => {
  const f = await fixture({ drawFails: 1 });
  try {
    const q = await post(f, HOST, '/api/events/1/cover/variants/quote', { prompt: 'A harbour at dawn' });
    const r = await post(f, HOST, '/api/events/1/cover/variants', { prompt: 'A harbour at dawn', quote_uid: q.body.quote_uid });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.variants.length, 3, 'the three that drew');
    assert.equal(r.body.asked, 4);
    assert.equal(r.body.refused.length, 1);
    assert.ok(r.body.refused[0].message, 'the one that refused says why');
    assert.equal(f.r2.size, 3);
  } finally { f.close(); }
});

test('a missing cover reads as missing: no URL, no alt text, no source, and never a 0', async () => {
  const f = await fixture();
  try {
    const r = await get(f, HOST, '/api/events/1');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ev = r.body.event;
    assert.deepEqual([ev.cover_url, ev.cover_alt, ev.cover_source, ev.cover_focal, ev.cover_crops], [null, null, null, null, null]);
    assert.notEqual(ev.cover_alt, '', 'an absent description is not an empty one');
    assert.notEqual(ev.cover_alt, 0);
    // A Save cannot store an empty description, and `null` clears it.
    assert.equal((await post(f, HOST, '/api/events/1', { cover_alt: '  ' }, 'PATCH')).status, 400);
    assert.equal((await post(f, HOST, '/api/events/1', { cover_alt: 'x'.repeat(201) }, 'PATCH')).status, 400);
    assert.equal((await post(f, HOST, '/api/events/1', { cover_source: 'borrowed' }, 'PATCH')).status, 400);
    assert.equal((await post(f, HOST, '/api/events/1', { cover_focal: { x: 2, y: 0 } }, 'PATCH')).status, 400);
    assert.equal((await post(f, HOST, '/api/events/1', { cover_crops: { card: { x: 0, y: 0, w: 1, h: 1 } } }, 'PATCH')).status, 400);
    const cleared = await post(f, HOST, '/api/events/1', { cover_alt: null, cover_focal: null, cover_crops: null, cover_source: null }, 'PATCH');
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.deepEqual([cleared.body.event.cover_alt, cleared.body.event.cover_source], [null, null]);
    // Unparseable stored JSON reads as not recorded, never as a default frame.
    f.db.prepare("UPDATE events SET cover_focal_json = 'not json', cover_crops_json = '[]' WHERE id = 1").run();
    const broken = await get(f, HOST, '/api/events/1');
    assert.deepEqual([broken.body.event.cover_focal, broken.body.event.cover_crops], [null, null]);
  } finally { f.close(); }
});
