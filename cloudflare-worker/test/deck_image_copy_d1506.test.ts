/**
 * D1506 (#3757, follow-up to #3986): an outside image in a deck is copied into
 * the venture's own storage when the deck is saved, and the slide names the
 * copy; one that cannot be copied refuses the save, naming it (the owner's
 * pick, 2026-11-01). An export copies a stored version's outside images first,
 * and leaves out one it cannot copy. Synthetic bytes, the mounted Worker routes
 * and the real migrated schema in memory; R2 is a map and `fetch` answers only
 * the hosts the test names.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deck_image_copy_d1506.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import deckImages from '../src/routes/deck_images.ts';
import deckExports from '../src/routes/deck_exports.ts';
import decks from '../src/routes/decks.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { MAX_COPIES_PER_SAVE, copyRefusalMessage, externalImageUrls, isOwnImageUrl } from '../src/services/decks/imageCopy.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const cat = (...p: Uint8Array[]) => new Uint8Array(Buffer.concat(p.map((x) => Buffer.from(x))));
const be16 = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

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

test('our own stored image URLs are left alone; every other image a slide names is outside', () => {
  const own = 'https://axal.vc/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file';
  assert.ok(isOwnImageUrl(own));
  assert.ok(isOwnImageUrl('https://preview.example.test/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file', 'https://preview.example.test/api/decks/7'), 'the request host counts as ours');
  assert.equal(isOwnImageUrl('https://evil.example.test/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file'), false);
  const slides = [{ image_url: 'https://a.example.test/1.png', fields: [{ kind: 'image', value: 'https://a.example.test/2.png' }],
    blocks: [{ kind: 'image', image_url: own }, { kind: 'image', image_url: 'https://a.example.test/3.png' }], background: { image_url: 'https://a.example.test/1.png' } }];
  assert.deepEqual(externalImageUrls(slides), ['https://a.example.test/1.png', 'https://a.example.test/2.png', 'https://a.example.test/3.png']);
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
    fetched.push(url);
    if (url === 'https://img.example.test/a.jpg') return new Response(jpeg(800, 600), { status: 200 });
    if (url === 'https://img.example.test/huge.png') return new Response(png(9000, 9000), { status: 200 });
    if (url === 'https://hop.example.test/r') return new Response(null, { status: 302, headers: { Location: 'https://10.0.0.7/x.png' } });
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
const cardWith = (image_url: string) => [{ title: 'Synthetic', blocks: [{ id: 'i', kind: 'image', grid: { c1: 1, c2: 6, r1: 1, r2: 4 }, image_url, alt: 'A desk', tag: 'photo' }] }];

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
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    const stored = f.r2.get(row.r2_key)!;
    assert.equal(has(stored, 'Exif') || has(stored, 'xmpmeta'), false, 'the copy carries no metadata');
    const before = f.versions();
    // #3920: each save is made on top of the newest version.
    let current = s.body.id;
    for (const [url, reason] of [['https://10.0.0.7/x.png', null], ['https://hop.example.test/r', 'unsafe_url'],
      ['http://img.example.test/a.jpg', null], ['https://img.example.test/huge.png', 'image_too_large'], ['https://img.example.test/gone.png', 'fetch_failed']] as const) {
      const r = await call(f, `/api/decks/${current}`, { method: 'PUT', json: { slides: cardWith(url), title: 'Synthetic deck' } });
      if (reason === null) {
        // An http URL or a private address is dropped by the slide model before any copy.
        assert.equal(r.status, 200, url);
        assert.notEqual(r.body.slides[0].blocks[0].image_url, url);
        current = r.body.id; continue;
      }
      assert.deepEqual([r.status, r.body.error, r.body.image_url, r.body.reason], [422, 'image_not_copied', url, reason], url);
      assert.equal(r.body.message, copyRefusalMessage(reason));
    }
    assert.equal(f.fetched.includes('https://10.0.0.7/x.png'), false, 'a private address is never fetched, nor a redirect to one');
    assert.equal(f.versions(), before + 2, 'only the two dropped cases saved; no refused save wrote a version');
    assert.equal(f.rows().length, 1, 'no refused copy left a row');
    // The same outside picture saved again is the same stored row.
    const again = await call(f, `/api/decks/${current}`, { method: 'PUT', json: { slides: cardWith('https://img.example.test/a.jpg'), title: 'Synthetic deck' } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.slides[0].blocks[0].image_id, row.uid);
    assert.equal(f.rows().length, 1);
  } finally { f.close(); }
});

test(`a save copies at most ${MAX_COPIES_PER_SAVE} outside images, and with no storage it copies none and refuses`, async () => {
  const f = await fixture();
  try {
    const many = Array.from({ length: MAX_COPIES_PER_SAVE + 1 }, (_, i) => ({ title: `S${i}`, image_url: `https://img.example.test/a.jpg?n=${i}` }));
    const r = await call(f, '/api/decks/7', { method: 'PUT', json: { slides: many, title: 'Synthetic deck' } });
    assert.deepEqual([r.status, r.body.error, r.body.reason, r.body.image_url], [422, 'image_not_copied', 'too_many_images', `https://img.example.test/a.jpg?n=${MAX_COPIES_PER_SAVE}`]);
    assert.equal(f.fetched.length, 0, 'nothing is fetched before the count is checked');
    delete f.env.FILES;
    const none = await call(f, '/api/decks/7', { method: 'PUT', json: { slides: cardWith('https://img.example.test/a.jpg'), title: 'Synthetic deck' } });
    assert.deepEqual([none.status, none.body.reason], [422, 'storage_unavailable']);
    assert.equal(f.rows().length, 0);
  } finally { f.close(); }
});

test('a discarded copy of the same picture gives up its hash; the save stores a kept copy of its own', async () => {
  const f = await fixture();
  try {
    const s = await call(f, '/api/decks/7', { method: 'PUT', json: { slides: cardWith('https://img.example.test/a.jpg'), title: 'Synthetic deck' } });
    const [first] = f.rows();
    f.db.prepare("UPDATE deck_images SET state = 'discarded' WHERE uid = ?").run(first.uid);
    const again = await call(f, `/api/decks/${s.body.id}`, { method: 'PUT', json: { slides: cardWith('https://img.example.test/a.jpg'), title: 'Synthetic deck' } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const rows = f.rows();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sha256, null, 'the discarded row gave up its hash');
    assert.equal(rows[1].state, 'kept');
    assert.equal(again.body.slides[0].blocks[0].image_id, rows[1].uid);
  } finally { f.close(); }
});

test('an export copies an older version\'s outside images first, and one it cannot copy is left out, never fetched', async () => {
  const f = await fixture();
  try {
    f.db.prepare('UPDATE pitch_decks SET slides = ? WHERE id = 7').run(JSON.stringify([
      { title: 'A', image_url: 'https://img.example.test/a.jpg' },
      { title: 'B', image_url: 'https://10.0.0.7/x.png' },
    ]));
    const r = await call(f, '/api/decks/7/export/html', { json: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const stored = JSON.parse((f.db.prepare('SELECT slides FROM pitch_decks WHERE id = 7').get() as any).slides);
    const [row] = f.rows();
    assert.equal(stored[0].image_url, `${ORIGIN}/api/decks/images/${row.uid}/file`, 'the version now names the copy');
    assert.equal(stored[1].image_url, 'https://10.0.0.7/x.png', 'one that could not be copied stays as it was');
    assert.equal(f.fetched.includes('https://10.0.0.7/x.png'), false, 'and is never fetched');
  } finally { f.close(); }
});
