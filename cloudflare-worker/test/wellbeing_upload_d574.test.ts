/**
 * D574 part 4 — a file in the Wellbeing resource library.
 *
 * The real router on node:sqlite, the baseline's `wellbeing_resources` with
 * migration 395, and R2 as an in-memory stand-in for put, head, ranged get
 * and delete. Covers the admin gate, the type and size limits, a re-upload
 * replacing (and deleting) the old object, removal, the member read with its
 * draft rule and Range, and the file leaving with its resource.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import wellbeing from '../src/routes/wellbeing.ts';
import { RESOURCE_FILE_MAX_BYTES, RESOURCE_FILE_PREFIX, mediaType } from '../src/services/wellbeing/resourceFiles.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 1, ADMIN = 2;
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const M395 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/395_wellbeing_weekly_and_library.sql'), 'utf8');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

class FakeR2 {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, data: ArrayBuffer, opts: any) { this.objects.set(key, { bytes: new Uint8Array(data), contentType: opts?.httpMetadata?.contentType }); }
  async head(key: string) { const o = this.objects.get(key); return o ? { size: o.bytes.length, httpMetadata: { contentType: o.contentType } } : null; }
  async get(key: string, opts?: any) {
    const o = this.objects.get(key);
    if (!o) return null;
    const r = opts?.range;
    return { body: new Blob([r ? o.bytes.slice(r.offset, r.offset + r.length) : o.bytes]).stream() };
  }
  async delete(key: string) { this.objects.delete(key); }
}

function setup() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);`);
  db.exec(ddl('wellbeing_daily_pulses'));
  db.exec(ddl('wellbeing_resources'));
  db.exec(M395);
  db.prepare(`INSERT INTO users (id, role, email) VALUES (?, 'founder', 'm@example.test'), (?, 'admin', 'a@example.test')`).run(MEMBER, ADMIN);
  const id = (db.prepare(`INSERT INTO wellbeing_resources (uid, category, name, status) VALUES ('res1', 'reading', 'Sleep handout', 'published') RETURNING id`).get() as any).id;
  const r2 = new FakeR2();
  return { db, r2, id, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: r2 } as any };
}
async function call(e: any, method: string, path: string, who: number, opts: { raw?: Uint8Array; type?: string; length?: number; json?: unknown; headers?: Record<string, string> } = {}) {
  const tok = await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) };
  let body: any;
  if (opts.raw) {
    body = opts.raw;
    if (opts.type) headers['Content-Type'] = opts.type;
    headers['Content-Length'] = String(opts.length ?? opts.raw.length);
  } else if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers['Content-Type'] = 'application/json'; }
  const res = await wellbeing.request(path, { method, headers, body }, e);
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() as any : new Uint8Array(await res.arrayBuffer()) };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, er = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = er; }
};
const PDF = new TextEncoder().encode('%PDF-1.4 handout bytes');

test('an admin attaches a file; the row carries its type, size and gated path, never the key', async () => {
  const { r2, id, env, db } = setup();
  assert.equal(mediaType('Application/PDF; charset=binary'), 'application/pdf');
  const r = await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: PDF, type: 'application/pdf' }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.file, { type: 'application/pdf', size: PDF.length, url: '/api/wellbeing/resources/res1/file' });
  const key = (db.prepare('SELECT file_key FROM wellbeing_resources WHERE id = ?').get(id) as any).file_key;
  assert.ok(!JSON.stringify(r.body).includes(key), 'the bucket key reached the response');
  assert.ok(key.startsWith(`${RESOURCE_FILE_PREFIX}res1/`) && key.endsWith('.pdf'));
  assert.equal(r2.objects.get(key)?.contentType, 'application/pdf');
  assert.match(String(r.body.edited_at), /^\d{4}-/);
});

test('only an admin uploads, only the allowed types, only as large as declared and at most 95 MB', async () => {
  const { r2, id, env } = setup();
  assert.equal((await quiet(() => call(env, 'PUT', `/resources/${id}/file`, MEMBER, { raw: PDF, type: 'application/pdf' }))).status, 403);
  const html = await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: PDF, type: 'text/html' }));
  assert.equal(html.status, 415);
  assert.equal(html.body.error, 'unsupported_type');
  const big = await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: PDF, type: 'application/pdf', length: RESOURCE_FILE_MAX_BYTES + 1 }));
  assert.equal(big.status, 413);
  assert.equal((await quiet(() => call(env, 'PUT', '/resources/9999/file', ADMIN, { raw: PDF, type: 'application/pdf' }))).body.error, 'resource_not_found');
  assert.equal(r2.objects.size, 0, 'a refused upload stored something');
});

test('a re-upload replaces the file and deletes the old object; removing it clears the row', async () => {
  const { r2, id, env, db } = setup();
  await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: PDF, type: 'application/pdf' }));
  const first = (db.prepare('SELECT file_key FROM wellbeing_resources WHERE id = ?').get(id) as any).file_key;
  const audio = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const again = await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: audio, type: 'audio/mpeg' }));
  assert.equal(again.body.file.type, 'audio/mpeg');
  assert.ok(!r2.objects.has(first), 'the replaced file was left in the bucket');
  assert.equal(r2.objects.size, 1);
  const removed = await quiet(() => call(env, 'DELETE', `/resources/${id}/file`, ADMIN));
  assert.equal(removed.status, 200);
  assert.equal(removed.body.file, null);
  assert.equal(r2.objects.size, 0);
  assert.equal((await quiet(() => call(env, 'DELETE', `/resources/${id}/file`, MEMBER))).status, 403);
});

test('a member reads a published file with Range; a draft\'s file is the admins\' alone', async () => {
  const { id, env, db } = setup();
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: bytes, type: 'audio/mpeg' }));
  const whole = await quiet(() => call(env, 'GET', '/resources/res1/file', MEMBER));
  assert.equal(whole.status, 200);
  assert.deepEqual([...whole.body], [...bytes]);
  assert.equal(whole.headers.get('content-type'), 'audio/mpeg');
  assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
  assert.match(String(whole.headers.get('cache-control')), /^private/);
  const part = await quiet(() => call(env, 'GET', '/resources/res1/file', MEMBER, { headers: { Range: 'bytes=2-5' } }));
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.deepEqual([...part.body], [2, 3, 4, 5]);
  assert.equal((await quiet(() => call(env, 'GET', '/resources/res1/file', MEMBER, { headers: { Range: 'bytes=20-' } }))).status, 416);

  db.prepare(`UPDATE wellbeing_resources SET status = 'draft' WHERE id = ?`).run(id);
  assert.equal((await quiet(() => call(env, 'GET', '/resources/res1/file', MEMBER))).status, 404, 'a member read a draft\'s file');
  assert.equal((await quiet(() => call(env, 'GET', '/resources/res1/file', ADMIN))).status, 200);
  assert.equal((await quiet(() => call(env, 'GET', '/resources/nope/file', MEMBER))).status, 404);
});

test('deleting a resource deletes its file', async () => {
  const { r2, id, env } = setup();
  await quiet(() => call(env, 'PUT', `/resources/${id}/file`, ADMIN, { raw: PDF, type: 'application/pdf' }));
  assert.equal(r2.objects.size, 1);
  assert.equal((await quiet(() => call(env, 'DELETE', `/resources/${id}`, ADMIN))).status, 200);
  assert.equal(r2.objects.size, 0);
});
