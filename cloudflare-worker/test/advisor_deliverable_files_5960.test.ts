/**
 * #5960 (D5960) — a deliverable version's document may be a stored file instead of a web link.
 *
 *   · a version is created with a file and no link, with a link and no file, and refused 422 `empty_version` with
 *     neither (and 422 `two_documents` with both);
 *   · a file over 10 MB is refused 413 and a disallowed type 400, with nothing written to R2 or D1;
 *   · send and mark-ready accept a file-backed version;
 *   · only the owning advisor and the version's recorded recipient download it; anyone else, and an unsent
 *     version for the recipient, get the list's 404;
 *   · a failed R2 read is an error, never an empty file; no response carries the R2 key or the hash.
 *
 * On the migrated schema with an in-memory R2. Synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_deliverable_files_5960.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const ADVISOR = 21;
const CLIENT = 22;
const OTHER_ADVISOR = 23;
const STRANGER = 24;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
const TEXT = new TextEncoder().encode('just some text, not a document');

function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  const r2: any = {
    objects, failPut: false, failGet: false, lose: false,
    async put(key: string, bytes: Uint8Array) { if (r2.failPut) throw new Error('r2 down'); objects.set(key, new Uint8Array(bytes)); return {}; },
    async get(key: string) {
      if (r2.failGet) throw new Error('r2 down');
      if (r2.lose) return null;
      const b = objects.get(key);
      return b ? { body: new Blob([b]).stream() } : null;
    },
    async delete(key: string) { objects.delete(key); },
  };
  return r2;
}

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor One','a@example.test','advisor',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (22,'Client','c@example.test','founder',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (23,'Advisor Two','b@example.test','advisor',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (24,'Stranger','s@example.test','founder',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor One','a@example.test',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (202,'a-2',23,'Advisor Two','b@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    UPDATE users SET advisor_id = 202 WHERE id = 23;
    INSERT INTO advisor_engagements(id, uid, advisor_id, founder_user_id, client_name, lane, shape, cycles, created_at, updated_at)
      VALUES (301, 'e-1', 201, 22, 'Client Co', 'signed', 'retainer', 1, '2026-01-01', '2026-01-01');
  `);
  const r2 = fakeR2();
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: r2 };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const token = (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const raw = async (who: number, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token(who)}` };
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    return app.request(`/api/advisors${path}`, { method, headers, body: payload }, env, ctx);
  };
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const res = await raw(who, method, path, body);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any, text }; } catch { return { status: res.status, body: null, text }; }
  };
  const form = (fields: Record<string, string>, file?: { bytes: Uint8Array; name: string; type: string }) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    if (file) f.append('file', new File([file.bytes], file.name, { type: file.type }));
    return f;
  };
  const deliverable = async () => {
    const d = await call(ADVISOR, 'POST', '/me/deliverables', { title: 'Synthetic memo', engagement_id: 301, link_url: 'https://example.test/v1', summary: 'First draft' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    return d.body;
  };
  const versions = () => db.prepare('SELECT COUNT(*) AS n FROM advisor_deliverable_versions').get() as any;
  return { db, r2, raw, call, form, deliverable, versions };
}

const pdf = { bytes: PDF, name: 'Q4-strategy-memo-v2.pdf', type: 'application/pdf' };

// Mutation checked: the file branch dropped (a file-only version refused, fails); the empty_version check dropped
// (fails); the both-refusal dropped (fails); the file name, type or size missing from the DTO (fails).
test('#5960 a version takes a file or a link, never neither or both', async () => {
  const f = fixture();
  const d = await f.deliverable();
  const withFile = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Tightened pricing' }, pdf));
  assert.equal(withFile.status, 201, withFile.text);
  assert.equal(withFile.body.document, 'file');
  assert.deepEqual(withFile.body.file, { name: 'Q4-strategy-memo-v2.pdf', type: 'application/pdf', size: PDF.length });
  assert.equal(withFile.body.link_url, null);
  assert.equal(f.r2.objects.size, 1);

  const withLink = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { summary: 'Linked', link_url: 'https://example.test/v3' });
  assert.equal(withLink.status, 201);
  assert.deepEqual([withLink.body.document, withLink.body.file], ['link', null]);

  // A link is still an https link only (D4712).
  const plain = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, { summary: 'Plain', link_url: 'http://example.test/v4' });
  assert.deepEqual([plain.status, plain.body.code], [422, 'empty_version']);
  const neither = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Nothing attached' }));
  assert.deepEqual([neither.status, neither.body.code], [422, 'empty_version']);
  const both = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Both', link_url: 'https://example.test/x' }, pdf));
  assert.deepEqual([both.status, both.body.code], [422, 'two_documents']);
  assert.equal(f.r2.objects.size, 1, 'a refused version stores nothing');

  // The first version can carry a file too.
  const first = await f.call(ADVISOR, 'POST', '/me/deliverables', f.form({ title: 'Deck review', engagement_id: '301', summary: 'v1' }, pdf));
  assert.equal(first.status, 201, first.text);
  const v1 = f.db.prepare('SELECT file_name, file_type, file_size, link_url FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = 1').get(first.body.id) as any;
  assert.deepEqual({ ...v1 }, { file_name: 'Q4-strategy-memo-v2.pdf', file_type: 'application/pdf', file_size: PDF.length, link_url: null });
});

// Mutation checked: the size check dropped (fails); the sniff dropped (fails); the put before the checks (an object
// left behind, fails); the row written when the put fails (fails).
test('#5960 a refused or unstored file leaves nothing in R2 or D1', async () => {
  const f = fixture();
  const d = await f.deliverable();
  const before = f.versions().n;
  const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(PDF);
  const tooBig = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Huge' }, { bytes: big, name: 'big.pdf', type: 'application/pdf' }));
  assert.deepEqual([tooBig.status, tooBig.body.code], [413, 'file_too_large']);
  const wrong = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Text' }, { bytes: TEXT, name: 'notes.pdf', type: 'application/pdf' }));
  assert.deepEqual([wrong.status, wrong.body.code], [400, 'file_type_invalid']);
  const declared = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Declared' }, { bytes: PDF, name: 'x.html', type: 'text/html' }));
  assert.deepEqual([declared.status, declared.body.code], [400, 'file_type_invalid']);
  f.r2.failPut = true;
  const down = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'R2 down' }, pdf));
  assert.deepEqual([down.status, down.body.code], [502, 'storage_failed']);
  assert.equal(f.r2.objects.size, 0);
  assert.equal(f.versions().n, before, 'no version row was written');
});

// Mutation checked: send keeping the link-only rule (fails); ready keeping it (fails).
test('#5960 send and mark-ready accept a file-backed version, and still refuse one with no document', async () => {
  const f = fixture();
  const d = await f.deliverable();
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Final' }, pdf));
  const ready = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/2/ready`);
  assert.equal(ready.status, 200, ready.text);
  const sent = await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/2/send`);
  assert.equal(sent.status, 200, sent.text);
  // A title-only first version has no document: still refused.
  const bare = await f.call(ADVISOR, 'POST', '/me/deliverables', { title: 'Bare', engagement_id: 301 });
  assert.equal((await f.call(ADVISOR, 'POST', `/me/deliverables/${bare.body.id}/versions/1/send`)).body.code, 'empty_version');
  assert.equal((await f.call(ADVISOR, 'POST', `/me/deliverables/${bare.body.id}/versions/1/ready`)).body.code, 'empty_version');
});

// Mutation checked: the recipient download not scoped to the recipient (the stranger reads it, fails); not scoped to
// sent (fails); the advisor download not scoped to the owner (fails); a failed read answering 200 (fails).
test('#5960 the owning advisor and the recorded recipient download it; nobody else, and never an empty file', async () => {
  const f = fixture();
  const d = await f.deliverable();
  const v2 = (await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Final' }, pdf))).body;
  const mine = await f.raw(ADVISOR, 'GET', `/me/deliverables/${d.id}/versions/2/file`);
  assert.equal(mine.status, 200);
  assert.deepEqual(new Uint8Array(await mine.arrayBuffer()), PDF);
  assert.match(mine.headers.get('content-disposition') || '', /attachment; filename="Q4-strategy-memo-v2\.pdf"/);
  assert.equal(mine.headers.get('content-type'), 'application/pdf');
  assert.equal((await f.call(OTHER_ADVISOR, 'GET', `/me/deliverables/${d.id}/versions/2/file`)).status, 404);

  // Unsent: the recipient gets the list's 404.
  assert.deepEqual([(await f.call(CLIENT, 'GET', `/received/deliverables/${v2.uid}/file`)).status], [404]);
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/2/send`);
  const theirs = await f.raw(CLIENT, 'GET', `/received/deliverables/${v2.uid}/file`);
  assert.equal(theirs.status, 200);
  assert.deepEqual(new Uint8Array(await theirs.arrayBuffer()), PDF);
  const stranger = await f.call(STRANGER, 'GET', `/received/deliverables/${v2.uid}/file`);
  assert.deepEqual([stranger.status, stranger.body.detail], [404, 'Work product not found']);

  f.r2.lose = true;
  const lost = await f.call(CLIENT, 'GET', `/received/deliverables/${v2.uid}/file`);
  assert.deepEqual([lost.status, lost.body.code], [502, 'file_unreadable']);
  f.r2.lose = false; f.r2.failGet = true;
  assert.equal((await f.call(ADVISOR, 'GET', `/me/deliverables/${d.id}/versions/2/file`)).status, 502);
});

test('#5960 no response carries the R2 key or the hash', async () => {
  const f = fixture();
  const d = await f.deliverable();
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions`, f.form({ summary: 'Final' }, pdf));
  await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/2/send`);
  const row = f.db.prepare('SELECT file_key, file_sha256 FROM advisor_deliverable_versions WHERE deliverable_id = ? AND version = 2').get(d.id) as any;
  assert.ok(row.file_key && row.file_sha256, 'both are recorded');
  for (const [who, path] of [[ADVISOR, '/me/deliverables'], [CLIENT, '/received/deliverables']] as const) {
    const text = (await f.call(who, 'GET', path)).text;
    assert.ok(text.includes('Q4-strategy-memo-v2.pdf'), `${path} names the file`);
    for (const secret of [row.file_key, row.file_sha256, 'file_key', 'sha256']) assert.ok(!text.includes(secret), `${path} carries ${secret}`);
  }
});
