/**
 * #9190 (D9190): the type stored for an uploaded file is checked, the same way
 * on every data room path, and an article image is size-checked before it is
 * decoded and must be the image type it declares. Real SQLite and mounted
 * routes; every person, venture and file is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/upload_type_checks_9190.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import room, { replaceDataRoomFile, storedFileType } from '../src/routes/data_room.ts';
import articles from '../src/routes/articles.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys, addColumnsFrom } from './_baseline.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import { loadSchema } from './_schema_once.mjs';
import { forgetArticleStorage } from '../src/services/storageUsage.ts';

// ---- Data room -------------------------------------------------------------

const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const migration = (name: string) => readFileSync('cloudflare-worker/sql/migrations/' + name, 'utf8');
const roomApp = new Hono<any>(); roomApp.route('/api/data-room', room);

function roomFixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'data_room_files', 'data_room_folders', 'data_room_grants', 'data_room_access_log', 'activity_logs', 'dd_requests', 'project_members']) {
    db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  }
  addColumnsFrom(db, migration('442_raise_cycle_stores.sql'), 'data_room_files');
  addColumnsFrom(db, migration('463_raise_record_stores.sql'), 'data_room_files');
  addColumnsFrom(db, migration('596_data_room_file_source.sql'), 'data_room_files');
  db.exec(stripForeignKeys(tableFromBaseline(migration('463_raise_record_stores.sql'), 'data_room_file_versions')));
  db.prepare("INSERT INTO users (id,role,name,email,password_hash,founder_id,is_active) VALUES (1,'founder','Synthetic founder','synthetic-1@example.test','synthetic-hash',11,1)").run();
  db.exec("INSERT INTO projects (id,uid,name,founder_id) VALUES (1,'room-one','Synthetic venture',11)");
  const puts: { key: string; contentType: string }[] = [];
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    FILES: { async put(key: string, _b: unknown, o: any) { puts.push({ key, contentType: o?.httpMetadata?.contentType }); }, async delete() {} } };
  const upload = async (data: string) => {
    const r = await roomApp.request('/api/data-room/room-one/files', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(1, 'founder')}` },
      body: JSON.stringify({ name: 'Synthetic upload', data }) }, env);
    return { status: r.status, body: await r.json() as any };
  };
  const stored = (uid: string) => (db.prepare('SELECT content_type FROM data_room_files WHERE uid = ?').get(uid) as any)?.content_type;
  return { db, env, puts, upload, stored };
}

const B64 = Buffer.from('synthetic bytes').toString('base64');

test('a first upload declaring a type outside the allow-list is stored, and served, as application/octet-stream', async () => {
  const f = roomFixture(); try {
    for (const declared of ['image/svg+xml', 'application/x-shockwave-flash', 'application/xhtml+xml', 'text/x-synthetic']) {
      const r = await f.upload(`data:${declared};base64,${B64}`);
      assert.equal(r.status, 201, declared);
      assert.equal(f.stored(r.body.uid), 'application/octet-stream', `${declared}: the row`);
      assert.equal(f.puts.at(-1)!.contentType, 'application/octet-stream', `${declared}: the object's metadata`);
    }
  } finally { f.db.close(); }
});

test('a type on the allow-list is stored as declared, lower-cased and without parameters', async () => {
  const f = roomFixture(); try {
    const r = await f.upload(`data:Application/PDF;charset=binary;base64,${B64}`);
    assert.equal(r.status, 201);
    assert.equal(f.stored(r.body.uid), 'application/pdf');
    assert.equal(f.puts.at(-1)!.contentType, 'application/pdf');
  } finally { f.db.close(); }
});

test('a data URI with no `;` does not store a malformed type', async () => {
  const f = roomFixture(); try {
    const r = await f.upload(`data:application/pdf,${B64}`);
    assert.equal(r.status, 201);
    assert.equal(f.stored(r.body.uid), 'application/pdf', 'the type is read up to the comma, not sliced at -1');
    const bare = await f.upload(`data:,${B64}`);
    assert.equal(bare.status, 201);
    assert.equal(f.stored(bare.body.uid), 'application/octet-stream');
  } finally { f.db.close(); }
});

test('version replace takes its type from the same check as the first upload', async () => {
  const f = roomFixture(); try {
    const first = await f.upload(`data:application/pdf;base64,${B64}`);
    const fileId = Number((f.db.prepare('SELECT id FROM data_room_files WHERE uid = ?').get(first.body.uid) as any).id);
    const project = { id: 1, uid: 'room-one' };
    const bytes = new TextEncoder().encode('synthetic replacement');
    // The old pattern let any well-formed type through; the allow-list does not.
    await replaceDataRoomFile(f.env, { project, userId: 1, fileId, bytes, contentType: 'image/svg+xml' });
    assert.equal(f.stored(first.body.uid), 'application/octet-stream');
    assert.equal(f.puts.at(-1)!.contentType, 'application/octet-stream');
    await replaceDataRoomFile(f.env, { project, userId: 1, fileId, bytes, contentType: 'text/csv' });
    assert.equal(f.stored(first.body.uid), 'text/csv');
    for (const t of ['image/svg+xml', 'not a type', null, undefined, 42]) assert.equal(storedFileType(t), 'application/octet-stream', String(t));
  } finally { f.db.close(); }
});

// ---- Article images --------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'upload-types-9190-'));
const seedPath = join(scratch, 'schema.sqlite');
{ const schema = new DatabaseSync(seedPath, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); loadSchema(schema); schema.close(); }
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const ARTICLE_SECRET = 'synthetic-9190-only-not-a-real-credential'.repeat(2);

function articleFixture() {
  forgetArticleStorage(5);
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seedPath, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.prepare("INSERT INTO users(id, role, name, email, is_active, subscription_tier) VALUES (2, 'founder', 'Synthetic author', 'synthetic-2@example.invalid', 1, 'studio')").run();
  db.prepare("INSERT INTO articles(id, slug, title, body_markdown, status, author_user_id) VALUES (5, 'synthetic-note', 'Synthetic note', 'Body', 'draft', 2)").run();
  const r2 = new Map<string, Uint8Array>();
  const FILES = {
    list: async () => ({ objects: [], truncated: false }),
    put: async (key: string, bytes: Uint8Array) => { r2.set(key, new Uint8Array(bytes)); },
    get: async () => null, delete: async () => {},
  };
  const env: any = { DB: d1Over(db), JWT_SECRET: ARTICLE_SECRET, ENVIRONMENT: 'development', FILES };
  const app = new Hono<any>().route('/api/articles', articles);
  const upload = async (data_uri: string) => {
    const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(ARTICLE_SECRET));
    const res = await app.request('https://axal.vc/api/articles/5/image', { method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ data_uri }) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  return { db, r2, upload };
}

const SIGNATURE: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/webp': [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')],
  'image/gif': [...Buffer.from('GIF89a')],
};
const uriOf = (mime: string, bytes: number[]) => `data:${mime};base64,${Buffer.from([...bytes, 1, 2, 3, 4]).toString('base64')}`;

test('an article image whose bytes are its declared type is stored', async () => {
  const f = articleFixture(); try {
    for (const mime of Object.keys(SIGNATURE)) {
      const r = await f.upload(uriOf(mime, SIGNATURE[mime]));
      assert.equal(r.status, 200, mime);
      assert.match(r.body.url, /^\/api\/articles\/5\/image\/img-/);
    }
    assert.equal(f.r2.size, 4);
    const gif87 = await f.upload(uriOf('image/gif', [...Buffer.from('GIF87a')]));
    assert.equal(gif87.status, 200, 'the older GIF signature too');
  } finally { f.db.close(); }
});

test('an article image whose bytes do not match its declared type answers 400 and stores nothing', async () => {
  const f = articleFixture(); try {
    for (const declared of Object.keys(SIGNATURE)) {
      for (const actual of Object.keys(SIGNATURE)) {
        if (actual === declared) continue;
        const r = await f.upload(uriOf(declared, SIGNATURE[actual]));
        assert.equal(r.status, 400, `${actual} bytes declared ${declared}`);
        assert.equal(r.body.error, 'mime_mismatch');
        assert.match(r.body.message, /not the image type it says/);
      }
    }
    const markup = await f.upload(`data:image/png;base64,${Buffer.from('<p>synthetic</p>').toString('base64')}`);
    assert.equal(markup.status, 400);
    assert.equal(markup.body.error, 'mime_mismatch');
    assert.equal(f.r2.size, 0);
  } finally { f.db.close(); }
});

test('an oversized article image answers 413 without calling the decoder', async () => {
  const f = articleFixture();
  const realAtob = globalThis.atob;
  // Sign-in decodes small strings with atob too; the spy counts only the image payload.
  let decoded = 0;
  globalThis.atob = ((s: string) => { if (s.length > 1_000_000) decoded++; return realAtob(s); }) as typeof atob;
  try {
    const MAX = 5 * 1024 * 1024;
    const over = 'A'.repeat(4 * Math.ceil(MAX / 3) + 4);
    const r = await f.upload(`data:image/png;base64,${over}`);
    assert.equal(r.status, 413);
    assert.equal(r.body.error, 'too_large');
    assert.equal(decoded, 0, 'the length is refused before atob runs');
    // The largest image the limit allows still decodes: PNG bytes, padded to exactly MAX.
    const exact = new Uint8Array(MAX); exact.set(SIGNATURE['image/png']);
    const ok = await f.upload(`data:image/png;base64,${Buffer.from(exact).toString('base64')}`);
    assert.equal(ok.status, 200, 'an image of exactly the limit is accepted');
    assert.equal(decoded, 1);
    assert.equal(f.r2.size, 1);
  } finally { globalThis.atob = realAtob; f.db.close(); }
});
