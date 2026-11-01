/**
 * D1506 (#3757, A13 part 2): what an image's bytes may carry into a deck, and
 * where the export browser may go. Synthetic bytes, the mounted Worker routes
 * and the real migrated schema in memory; R2 is a map and `fetch` answers only
 * the hosts the test names (DNS over HTTPS included, `_doh_fake.mjs`).
 *
 *   · EXIF, XMP, IPTC and comments leave a JPEG; text, EXIF and time chunks a
 *     PNG; EXIF and XMP chunks a WebP (with their VP8X flags); the pixels and
 *     the colour profile stay, and the size reads the same;
 *   · over 50 MP is refused; the size comes from the header; an upload is
 *     stored once per venture (migration 718's sha256);
 *   · an outside image is fetched over https from a public address only, with
 *     each redirect checked, and copied in when a deck is saved; one that
 *     cannot be copied refuses the save, naming it;
 *   · the export browser may load the page's own origin, the web fonts and
 *     data: and blob: URLs only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/untrusted_uploads_d1506.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImages from '../src/routes/deck_images.ts';
import deckExports from '../src/routes/deck_exports.ts';
import decks, { signDeckPrintToken, verifyDeckPrintToken } from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import {
  MAX_PIXELS, fetchExternalImage, imageUrlRefusal, measure, prepareImage, sha256Hex, stripJpeg, stripMetadata, stripPng, stripWebp,
} from '../src/services/decks/imageSafety.ts';
import { checkedExportImageCopies, copyExternalImages, externalImageUrls, isOwnImageUrl } from '../src/services/decks/imageCopy.ts';
import { exportAllowPatterns, renderUrl } from '../src/services/browserRun.ts';
import { imageInfo } from '../src/services/ai/shapes.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { dohAnswer } from './_doh_fake.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const cat = (...p: Uint8Array[]) => new Uint8Array(Buffer.concat(p.map((x) => Buffer.from(x))));
const be16 = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const le32 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const le24 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);

/** A JPEG segment: marker, then its length and payload. */
const seg = (marker: number, payload: Uint8Array) => cat(new Uint8Array([0xff, marker]), be16(payload.length + 2), payload);
/** A JPEG holding every kind of metadata, 640 × 480. */
function jpeg(width = 640, height = 480) {
  return cat(
    new Uint8Array([0xff, 0xd8]),
    seg(0xe0, cat(enc('JFIF\0'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]))),
    seg(0xe1, cat(enc('Exif\0\0'), enc('GPS 51.5N camera-serial-SYNTH'))),
    seg(0xe1, cat(enc('http://ns.adobe.com/xap/1.0/\0'), enc('<x:xmpmeta>Synthetic Author</x:xmpmeta>'))),
    seg(0xed, enc('Photoshop 3.0\0IPTC by-line')),
    seg(0xe2, cat(enc('ICC_PROFILE\0'), new Uint8Array([1, 1, 9, 9]))),
    seg(0xfe, enc('a comment with a name')),
    seg(0xc0, cat(new Uint8Array([8]), be16(height), be16(width), new Uint8Array([1, 1, 0x11, 0]))),
    seg(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0])),
    new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56]),
    new Uint8Array([0xff, 0xd9]),
  );
}
/** A PNG chunk (its CRC is not checked here). */
const chunk = (type: string, data: Uint8Array) => cat(be32(data.length), enc(type), data, be32(0));
function png(width = 32, height = 16) {
  return cat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', cat(be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0]))),
    chunk('tEXt', enc('Author\0Synthetic Author')),
    chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')),
    chunk('eXIf', enc('MM\0*GPS')),
    chunk('tIME', new Uint8Array([7, 234, 11, 1, 0, 0, 0])),
    chunk('iCCP', enc('sRGB\0\0profile')),
    chunk('IDAT', new Uint8Array([1, 2, 3, 4])),
    chunk('IEND', new Uint8Array()),
  );
}
/** A WebP with a VP8X header (EXIF and XMP flags set), an EXIF and an XMP chunk, 100 × 50. */
function webp(width = 100, height = 50) {
  const riff = (type: string, data: Uint8Array) => cat(enc(type), le32(data.length), data, data.length % 2 ? new Uint8Array([0]) : new Uint8Array());
  const body = cat(
    enc('WEBP'),
    riff('VP8X', cat(new Uint8Array([0x0c, 0, 0, 0]), le24(width - 1), le24(height - 1))),
    riff('VP8L', new Uint8Array([0x2f, 0, 0, 0, 0])),
    riff('EXIF', enc('Exif GPS SYNTH')),
    riff('XMP ', enc('<x:xmpmeta>Synthetic</x:xmpmeta>')),
  );
  return cat(enc('RIFF'), le32(body.length), body);
}

// ─────────────────────────────────────────────────────────── stripping and measuring

test('a JPEG loses EXIF, XMP, IPTC and comments, and keeps JFIF, the colour profile, the size and the scan', () => {
  const raw = jpeg();
  const out = stripJpeg(raw)!;
  for (const s of ['Exif', 'camera-serial', 'xmpmeta', 'Photoshop', 'a comment']) assert.equal(has(out, s), false, s);
  for (const s of ['JFIF', 'ICC_PROFILE']) assert.equal(has(out, s), true, s);
  assert.deepEqual(imageInfo(out), { mime: 'image/jpeg', width: 640, height: 480 });
  assert.deepEqual(out.subarray(out.length - 7), new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]), 'the scan is copied byte for byte');
  assert.equal(stripJpeg(enc('not a jpeg')), null);
});

test('a PNG loses its text, EXIF and time chunks, and a WebP its EXIF and XMP chunks and flags', () => {
  const p = stripPng(png())!;
  for (const s of ['tEXt', 'iTXt', 'eXIf', 'tIME', 'Synthetic Author']) assert.equal(has(p, s), false, s);
  for (const s of ['IHDR', 'iCCP', 'IDAT', 'IEND']) assert.equal(has(p, s), true, s);
  assert.deepEqual(imageInfo(p), { mime: 'image/png', width: 32, height: 16 });
  const w = stripWebp(webp())!;
  for (const s of ['EXIF', 'XMP ', 'GPS']) assert.equal(has(w, s), false, s);
  assert.equal(w[20] & 0x0c, 0, 'the VP8X EXIF and XMP flags are cleared');
  assert.equal(Buffer.from(w).readUInt32LE(4), w.length - 8, 'the RIFF size matches');
  assert.deepEqual(imageInfo(w), { mime: 'image/webp', width: 100, height: 50 });
  assert.equal(stripMetadata(png(), 'image/gif'), null);
});

test('the size comes from the header, and over 50 megapixels is refused', async () => {
  assert.deepEqual(measure(png(7000, 7000)), { ok: true, mime: 'image/png', width: 7000, height: 7000 }, '49 MP is allowed');
  assert.deepEqual(measure(png(8000, 7000)), { ok: false, code: 'image_too_large' });
  assert.equal(MAX_PIXELS, 50_000_000);
  assert.deepEqual(measure(enc('GIF89a....')), { ok: false, code: 'image_unreadable' });
  const p = await prepareImage(jpeg(1200, 800));
  assert.ok(p.ok);
  assert.deepEqual([p.width, p.height, p.mime, p.ext], [1200, 800, 'image/jpeg', 'jpg']);
  assert.equal(has(p.bytes, 'Exif'), false);
  assert.equal(p.sha256, await sha256Hex(p.bytes), 'the hash is of the stored, stripped bytes');
});

// ─────────────────────────────────────────────────────────── the safe fetch

test('an outside image URL: https only, a name not an address, no userinfo, no other port, no private name', () => {
  assert.equal(imageUrlRefusal('https://img.example.test/a.png'), null);
  assert.equal(imageUrlRefusal('https://cdn.example.test/a.png?w=800'), null, 'an image CDN query is fine');
  for (const [u, code] of [['http://img.example.test/a.png', 'not_https'], ['https://10.0.0.7/a.png', 'ip_literal'], ['https://[::1]/a.png', 'ip_literal'],
    ['https://u:p@img.example.test/a.png', 'userinfo'], ['https://img.example.test:8443/a.png', 'port'], ['https://localhost/a.png', 'private_name'],
    ['https://metadata.internal/a.png', 'private_name'], ['https://intranet/a.png', 'private_name'], ['javascript:alert(1)', 'not_https']] as const) {
    assert.equal(imageUrlRefusal(u), code, u);
  }
});

const PUBLIC: any = async () => ['93.184.216.34'];
const resolverOf = (map: Record<string, string[]>): any => async (h: string) => map[h] ?? ['93.184.216.34'];

test('the fetch: public addresses only, each redirect checked, at most three, and a size cap', async () => {
  const body = png();
  const seen: string[] = [];
  const fetcher: any = async (u: string, init: any) => {
    seen.push(u);
    assert.equal(init.redirect, 'manual', 'redirects are never followed by the platform');
    if (u === 'https://ok.example.test/a.png') return new Response(body, { status: 200 });
    if (u === 'https://hop.example.test/1') return new Response(null, { status: 302, headers: { Location: 'https://inside.example.test/x.png' } });
    if (u.startsWith('https://loop.example.test/')) return new Response(null, { status: 301, headers: { Location: `https://loop.example.test/${seen.length}` } });
    if (u === 'https://big.example.test/a.png') return new Response(new Uint8Array(64), { status: 200, headers: { 'Content-Length': '99999999' } });
    if (u === 'https://stream.example.test/a.png') return new Response(new Uint8Array(4096), { status: 200 });
    return new Response('', { status: 404 });
  };
  const r = await fetchExternalImage('https://ok.example.test/a.png', PUBLIC, fetcher);
  assert.ok(r.ok && r.bytes.length === body.length);
  assert.deepEqual(await fetchExternalImage('https://inside.example.test/x.png', resolverOf({ 'inside.example.test': ['10.0.0.7'] }), fetcher), { ok: false, code: 'host_refused' });
  assert.deepEqual(await fetchExternalImage('https://hop.example.test/1', resolverOf({ 'inside.example.test': ['10.0.0.7'] }), fetcher), { ok: false, code: 'host_refused' }, 'a redirect into a private address is refused');
  assert.equal(seen.includes('https://inside.example.test/x.png'), false, 'the private target was never fetched');
  const hopsBefore = seen.length;
  assert.deepEqual(await fetchExternalImage('https://loop.example.test/0', PUBLIC, fetcher), { ok: false, code: 'too_many_redirects' });
  assert.equal(seen.length - hopsBefore, 4, 'the first request and three redirects, no more');
  assert.deepEqual(await fetchExternalImage('https://big.example.test/a.png', PUBLIC, fetcher), { ok: false, code: 'image_too_large' });
  assert.deepEqual(await fetchExternalImage('https://stream.example.test/a.png', PUBLIC, fetcher, 8000, 1000), { ok: false, code: 'image_too_large' }, 'the body is cut as it streams');
  assert.deepEqual(await fetchExternalImage('https://ok.example.test/a.png', async () => { throw new Error('dns'); }, fetcher), { ok: false, code: 'host_refused' });
});

test('our own stored image URLs are left alone; every other image a slide names is outside', () => {
  const own = 'https://axal.vc/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file';
  assert.ok(isOwnImageUrl(own));
  assert.ok(isOwnImageUrl('https://preview.example.test/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file', 'https://preview.example.test/api/decks/7'), 'the request host counts as ours');
  assert.equal(isOwnImageUrl('https://evil.example.test/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file'), false);
  const slides = [{ image_url: 'https://a.example.test/1.png', fields: [{ kind: 'image', value: 'https://a.example.test/2.png' }],
    blocks: [{ kind: 'image', image_url: own }, { kind: 'image', image_url: 'https://a.example.test/3.png' }], background: { image_url: 'https://a.example.test/1.png' } }];
  assert.deepEqual(externalImageUrls(slides), ['https://a.example.test/1.png', 'https://a.example.test/2.png', 'https://a.example.test/3.png']);
});

// ─────────────────────────────────────────────────────────── the export browser

test('the export browser may load the page\'s origin, the web fonts and inline data/blob URLs only', async () => {
  const pats = exportAllowPatterns('https://axal.vc/deck/print-export/tok?print_mode=pdf')!;
  const re = pats.map((p) => new RegExp(p.slice(1, p.lastIndexOf('/'))));
  const allowed = (u: string) => re.some((r) => r.test(u));
  for (const u of ['https://axal.vc/api/decks/images/x/file', 'https://fonts.googleapis.com/css2?family=Inter', 'https://fonts.gstatic.com/s/inter.woff2', 'data:image/png;base64,AA', 'blob:https://axal.vc/synthetic']) assert.ok(allowed(u), u);
  for (const u of ['https://img.example.test/a.png', 'https://axal.vc.evil.example/x', 'http://axal.vc/x', 'https://evil.example/https://axal.vc/', 'https://169.254.169.254/latest']) assert.equal(allowed(u), false, u);
  assert.deepEqual(exportAllowPatterns('not a url'), ['/^data:/', '/^blob:/']);
  const asked: any[] = [];
  const binding = { quickAction: async (_a: string, o: any) => { asked.push(o); return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), { status: 200 }); } };
  const r = await renderUrl({ BROWSER: binding } as any, 'pdf', { url: 'https://axal.vc/deck/print-export/tok' }, { kind: 'pdf', maxBytes: 100, backoffMs: 0 });
  assert.ok(r.ok);
  assert.deepEqual(asked[0].allowRequestPattern, pats, 'every render carries the allow-list');
  await renderUrl({ BROWSER: binding } as any, 'pdf', { url: 'https://axal.vc/deck/print-export/tok', allowRequestPattern: ['/.*/'] }, { kind: 'pdf', maxBytes: 100, backoffMs: 0 });
  assert.deepEqual(asked[1].allowRequestPattern, pats, 'caller options cannot broaden the server allow-list');
});

// ─────────────────────────────────────────────────────────── the routes

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const migrations = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()
  .map((n) => readFileSync(new URL('migrations/' + n, root), 'utf8'));
const JWT_SECRET = 'synthetic-d1506-only-not-a-real-credential'.repeat(2);
const ORIGIN = 'https://axal.vc';

async function fixture() {
  __resetForTest();
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); for (const sql of migrations) db.exec(sql);
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  insert.run(2, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 'studio');
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100)");
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides, title, is_current) VALUES (7, 1, 3, ?, ?, 1)').run(JSON.stringify([{ title: 'Solution' }]), 'Synthetic deck');
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async (key: string) => (r2.has(key) ? { body: new Blob([r2.get(key)!]).stream() } : null),
    delete: async (key: string) => { r2.delete(key); },
  };
  const AI = withGuard({ run: async () => ({}) });
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', AI, FILES };
  await ensureProjectMembershipSchema(env);
  const app = new Hono<any>().route('/api/decks', deckImages).route('/api/decks', deckExports).route('/api/decks', decks);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input?.url ?? input);
    const dns = dohAnswer(url, ['inside.example.test']);
    if (dns) return dns;
    fetched.push(url);
    const own = new URL(url);
    if (own.origin === ORIGIN && own.pathname.startsWith('/api/decks/images/')) {
      const row = db.prepare('SELECT r2_key FROM deck_images WHERE uid = ?').get(own.pathname.split('/')[4]) as any;
      const bytes = row && r2.get(row.r2_key);
      return bytes ? new Response(bytes, { status: 200 }) : new Response('', { status: 404 });
    }
    if (url === 'https://img.example.test/a.jpg') return new Response(jpeg(800, 600), { status: 200 });
    if (url === 'https://img.example.test/huge.png') return new Response(png(9000, 9000), { status: 200 });
    if (url === 'https://hop.example.test/r') return new Response(null, { status: 302, headers: { Location: 'https://inside.example.test/x.png' } });
    return new Response('', { status: 404 });
  }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const rows = () => db.prepare('SELECT * FROM deck_images ORDER BY id').all() as any[];
  const versions = () => (db.prepare('SELECT COUNT(*) AS n FROM pitch_decks WHERE project_id = 1').get() as any).n as number;
  return { db, env, app, r2, rows, versions, fetched, close };
}
type F = Awaited<ReturnType<typeof fixture>>;
const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(f: F, path: string, init: { method?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(2)}` };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(ORIGIN + path, { method: init.method ?? 'POST', headers, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) }, f.env);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : null) as any };
}
const upload = (bytes: Uint8Array, name = 'a.jpg', alt = '') => { const form = new FormData(); form.set('file', new File([bytes], name)); form.set('use', 'content'); if (alt) form.set('alt', alt); return form; };
const cardWith = (image_url: string) => [{ title: 'Synthetic', blocks: [{ id: 'i', kind: 'image', grid: { c1: 1, c2: 6, r1: 1, r2: 4 }, image_url, alt: 'A desk', tag: 'photo' }] }];

test('an upload is stripped, measured and hashed; the same picture again is the same row; over 50 MP is 413', async () => {
  const f = await fixture();
  try {
    const r = await call(f, '/api/decks/7/images/upload', { form: upload(jpeg(1024, 768), 'a.jpg', 'The first alt') });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const [row] = f.rows();
    assert.deepEqual([row.width, row.height, row.mime, row.source], [1024, 768, 'image/jpeg', 'upload']);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    const stored = f.r2.get(row.r2_key)!;
    assert.equal(has(stored, 'Exif') || has(stored, 'xmpmeta'), false, 'the stored object carries no metadata');
    assert.equal(row.sha256, await sha256Hex(stored));
    const again = await call(f, '/api/decks/7/images/upload', { form: upload(jpeg(1024, 768), 'again.jpg', 'A second alt') });
    assert.deepEqual([again.status, again.body.duplicate, again.body.image.uid], [200, true, row.uid]);
    assert.equal(f.rows()[0].alt, 'The first alt', 'a kept picture uploaded again is not rewritten');
    assert.equal(f.rows().length, 1, 'one row per picture per venture');
    const huge = await call(f, '/api/decks/7/images/upload', { form: upload(png(9000, 9000), 'huge.png') });
    assert.deepEqual([huge.status, huge.body.error], [413, 'image_too_large']);
    assert.equal(f.rows().length, 1);
  } finally { f.close(); }
});

test('a save copies an outside image in and names the copy; one that cannot be copied refuses the save, naming it', async () => {
  const f = await fixture();
  try {
    const s = await call(f, '/api/decks/7', { method: 'PUT', json: { slides: cardWith('https://img.example.test/a.jpg'), title: 'Synthetic deck' } });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const block = s.body.slides[0].blocks[0];
    const [row] = f.rows();
    assert.equal(block.image_url, `${ORIGIN}/api/decks/images/${row.uid}/file`);
    assert.equal(block.image_id, row.uid);
    assert.deepEqual([row.source, row.state, row.width, row.height], ['upload', 'kept', 800, 600]);
    assert.equal(has(f.r2.get(row.r2_key)!, 'Exif'), false);
    const before = f.versions();
    // #3920: each save is made on top of the newest version.
    let current = s.body.id;
    for (const [url, reason] of [['https://inside.example.test/x.png', 'host_refused'], ['https://hop.example.test/r', 'host_refused'],
      ['http://img.example.test/a.jpg', null], ['https://img.example.test/huge.png', 'image_too_large'], ['https://img.example.test/gone.png', 'fetch_failed']] as const) {
      const r = await call(f, `/api/decks/${current}`, { method: 'PUT', json: { slides: cardWith(url), title: 'Synthetic deck' } });
      if (reason === null) { assert.equal(r.status, 200, 'an http URL is dropped by the slide model before any copy'); current = r.body.id; continue; }
      assert.deepEqual([r.status, r.body.error, r.body.image_url, r.body.reason], [422, 'image_not_copied', url, reason], url);
    }
    assert.equal(f.fetched.includes('https://inside.example.test/x.png'), false, 'a private address is never fetched');
    assert.equal(f.versions(), before + 1, 'only the http case saved; no refused save wrote a version');
    // The same outside picture saved again is the same stored row.
    const again = await call(f, `/api/decks/${current}`, { method: 'PUT', json: { slides: cardWith('https://img.example.test/a.jpg'), title: 'Synthetic deck' } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(f.rows().length, 1);
  } finally { f.close(); }
});

test('an export copies an older version\'s outside images first, and one it cannot copy is left out, never fetched unsafely', async () => {
  const f = await fixture();
  try {
    f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 7').run(JSON.stringify([
      { title: 'A', image_url: 'https://img.example.test/a.jpg' },
      { title: 'B', image_url: 'https://inside.example.test/x.png' },
    ]));
    const r = await call(f, '/api/decks/7/export/html', { json: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const stored = JSON.parse((f.db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get() as any).slides);
    const [row] = f.rows();
    assert.equal(stored[0].image_url, 'https://img.example.test/a.jpg', 'export never rewrites a historical version');
    assert.ok(f.fetched.includes(`${ORIGIN}/api/decks/images/${row.uid}/file`), 'the export uses the owned copy instead');
    assert.equal(stored[1].image_url, 'https://inside.example.test/x.png', 'one that could not be copied stays as it was');
    assert.equal(f.fetched.includes('https://inside.example.test/x.png'), false, 'and is never fetched');
  } finally { f.close(); }
});


test('concurrent copies share one row and leave only its linked storage object', async () => {
  const f = await fixture();
  try {
    const put = f.env.FILES.put;
    let count = 0;
    let release!: () => void;
    const both = new Promise<void>((resolve) => { release = resolve; });
    f.env.FILES.put = async (key: string, bytes: Uint8Array) => {
      await put(key, bytes);
      if (++count === 2) release();
      await both;
    };
    const o = { projectId: 1, deckId: 7, user: { id: 2, role: 'founder' }, requestUrl: ORIGIN, slides: cardWith('https://img.example.test/a.jpg') };
    const results = await Promise.all([copyExternalImages(f.env, o, { resolve: PUBLIC }), copyExternalImages(f.env, o, { resolve: PUBLIC })]);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    const rows = f.rows();
    assert.equal(rows.length, 1);
    assert.equal(f.r2.size, 1, 'the losing write removes its unlinked object');
    assert.ok(f.r2.has(rows[0].r2_key));
    for (const r of results) if (r.ok) assert.equal(r.slides[0].blocks[0].image_id, rows[0].uid);
  } finally { f.close(); }
});

test('a failed copy insert removes its storage object and reports a copy failure', async () => {
  const f = await fixture();
  try {
    const base = f.env.DB;
    f.env.DB = { ...base, prepare: (sql: string) => {
      const wrap = (q: any): any => ({ ...q, bind: (...args: unknown[]) => wrap(q.bind(...args)), first: (...args: unknown[]) => {
        if (/^INSERT INTO deck_images/.test(sql.trim())) throw new Error('synthetic insert failure');
        return q.first(...args);
      } });
      return wrap(base.prepare(sql));
    } };
    const r = await copyExternalImages(f.env, { projectId: 1, deckId: 7, user: { id: 2, role: 'founder' }, requestUrl: ORIGIN, slides: cardWith('https://img.example.test/a.jpg') }, { resolve: PUBLIC });
    assert.deepEqual(r, { ok: false, image_url: 'https://img.example.test/a.jpg', code: 'image_unsaved' });
    assert.equal(f.rows().length, 0);
    assert.equal(f.r2.size, 0);
  } finally { f.close(); }
});


test('browser exports use signed transient copies without rewriting deck history', async () => {
  const f = await fixture();
  try {
    const original = JSON.stringify(cardWith('https://img.example.test/a.jpg'));
    f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 7').run(original);
    let printed: any;
    let printToken = '';
    f.env.BROWSER = { quickAction: async (_action: string, options: any) => {
      printToken = new URL(options.url).pathname.split('/').pop()!;
      const r = await f.app.request(`${ORIGIN}/api/decks/print-export/${printToken}`, {}, f.env);
      assert.equal(r.status, 200);
      printed = await r.json();
      return new Response(_action === 'pdf' ? enc('%PDF-1.7 synthetic') : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]), { status: 200 });
    } };
    for (const format of ['pdf', 'pptx']) {
      const r = await call(f, '/api/decks/7/export', { json: { format } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(printed.slides[0].blocks[0].image_url, `${ORIGIN}/api/decks/images/${f.rows()[0].uid}/file`);
      assert.equal(f.db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get()?.slides, original);
    }
    const [payload, signature] = printToken.split('.');
    const tampered = Buffer.from(Buffer.from(payload, 'base64url').toString().replace(f.rows()[0].uid, crypto.randomUUID())).toString('base64url');
    assert.equal(await verifyDeckPrintToken(f.env, `${tampered}.${signature}`), null, 'the copy references are signed too');
  } finally { f.close(); }
});

test('print copy references are bounded hashes and UUIDs and cannot name another venture or an unkept image', async () => {
  const f = await fixture();
  try {
    const hash = await sha256Hex(enc('https://img.example.test/a.jpg'));
    const foreign = crypto.randomUUID();
    const discarded = crypto.randomUUID();
    f.db.prepare("INSERT INTO deck_images(uid, project_id, r2_key, mime, size_bytes, source, use, state, created_by) VALUES(?, 2, 'foreign', 'image/jpeg', 4, 'upload', 'content', 'kept', 2)").run(foreign);
    f.db.prepare("INSERT INTO deck_images(uid, project_id, r2_key, mime, size_bytes, source, use, state, created_by) VALUES(?, 1, 'discarded', 'image/jpeg', 4, 'upload', 'content', 'discarded', 2)").run(discarded);
    const original = JSON.stringify(cardWith('https://img.example.test/a.jpg'));
    f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 7').run(original);
    for (const uid of [foreign, discarded]) {
      const t = await signDeckPrintToken(f.env, 7, 180, { notes: false, sources: false }, { [hash]: uid });
      const r = await f.app.request(`${ORIGIN}/api/decks/print-export/${t}`, {}, f.env);
      assert.equal(r.status, 200);
      const deck = await r.json() as any;
      assert.equal(deck.slides[0].blocks[0].image_url, 'https://img.example.test/a.jpg', 'foreign/unkept copies never reach the print page');
    }
    assert.equal(checkedExportImageCopies({ invalid: foreign }), null);
    assert.equal(checkedExportImageCopies({ [hash]: 'https://other.example.test/image' }), null);
    assert.equal(checkedExportImageCopies(Object.fromEntries(Array.from({ length: 13 }, (_, n) => [n.toString(16).padStart(64, '0'), foreign]))), null);
    assert.deepEqual(checkedExportImageCopies({ [hash]: foreign }), { [hash]: foreign });
  } finally { f.close(); }
});
