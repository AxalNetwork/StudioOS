/**
 * D4811 (#4811) part 20 — a signed copy names the approved version it is a
 * copy of (CT-12 B, CT-92 "Execution evidence"): only a version counsel
 * approved at its exact hash can be named; a draft, a signed copy or an
 * unknown version is refused with the fix; the record's versions say which
 * are approved; Mark executed logs the named version with the evidence hash.
 * Real migrated schema, in memory; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/signed_copy_of_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { copyOfChoice } from '../src/services/governance.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-signed-copy-of-only-not-a-real-credential'.repeat(2);
const ADMIN = 2;
const OA = '00000000-0000-4000-8000-0000000000c1';
const pdf = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n% ${tag}\n1 0 obj<<>>endobj\n%%EOF`);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Alex Made-up', 'alex@example.test', 1)").run(ADMIN);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'sess', 'totp', ?)").run(ADMIN, new Date().toISOString().replace('T', ' ').slice(0, 19));
  db.prepare("INSERT INTO governance_documents (uid, entity_key, category, title, status, confidential) VALUES (?, 'management', 'resolution', 'Sole-Member Consent', 'draft', 0)").run(OA);
  const FILES = { async put() {}, async get() { return null; }, async head() { return null; }, async delete() {} };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, env };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: ADMIN, jti: 'sess' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const draft = (tag: string) => { const fd = new FormData(); fd.append('file', new File([pdf(tag)], 'v.pdf')); return fd; };
const signed = (copyOf?: string) => {
  const fd = draft('signed'); fd.append('signed', 'true'); fd.append('signed_on', '2026-10-02'); fd.append('signatory', 'S. Example, Manager'); fd.append('attest', 'true');
  if (copyOf !== undefined) fd.append('copy_of', copyOf);
  return fd;
};
const approve = (f: F, version: number, sha: string, decision = 'approved') => f.db.prepare(
  `INSERT INTO legal_reviews (object_kind, object_ref, version, version_sha256, review_type, jurisdiction, reviewer_id, requested_by, decision, decided_by, decided_at)
   VALUES ('governance', ?, ?, ?, 'pre_execution', 'Delaware, United States', 3, 2, ?, 3, '2026-10-01T10:00:00Z')`).run(OA, version, sha, decision);
const shaOf = (f: F, v: number) => (f.db.prepare('SELECT file_sha256 AS s FROM governance_document_versions WHERE document_uid = ? AND version = ?').get(OA, v) as any).s;

test('the rule: empty names none; unknown, a signed copy, or an unapproved version is refused with the fix', () => {
  const vs: any[] = [{ version: 1, signed: 0 }, { version: 2, signed: 0 }, { version: 3, signed: 0 }, { version: 4, signed: 1 }];
  assert.deepEqual(copyOfChoice('', vs, new Set([2])), { ok: true, version: null });
  assert.deepEqual(copyOfChoice(null, vs, new Set()), { ok: true, version: null });
  assert.deepEqual(copyOfChoice('2', vs, new Set([2])), { ok: true, version: 2 });
  assert.deepEqual(copyOfChoice('v2', vs, new Set([2])), { ok: true, version: 2 });
  const draft3 = copyOfChoice('3', vs, new Set([1, 2])) as any;
  assert.equal(draft3.status, 409); assert.equal(draft3.code, 'copy_of_not_approved');
  assert.match(draft3.message, /v3 is not approved by counsel.*Choose v2, or get v3 approved first\./);
  assert.match((copyOfChoice('3', vs, new Set()) as any).message, /Get v3 approved first\./);
  assert.equal((copyOfChoice('9', vs, new Set([2])) as any).code, 'copy_of_unknown');
  assert.match((copyOfChoice('9', vs, new Set([2])) as any).message, /no v9/);
  assert.equal((copyOfChoice('abc', vs, new Set([2])) as any).code, 'copy_of_unknown');
  assert.equal((copyOfChoice('4', vs, new Set([4])) as any).code, 'copy_of_signed');
});

test('a signed copy names an approved version; a draft never; executing logs the binding', async () => {
  const f = fixture();
  for (const t of ['one', 'two']) assert.equal((await call(f, 'POST', `/documents/${OA}/versions`, undefined, draft(t))).status, 201);
  approve(f, 1, shaOf(f, 1));
  approve(f, 2, 'f'.repeat(64)); // a review of other bytes never counts
  approve(f, 2, shaOf(f, 2), 'not_approved'); // nor a refusal
  let read = await call(f, 'GET', `/documents/${OA}`);
  assert.deepEqual(read.body.versions.map((v: any) => [v.version, v.counsel_approved]), [[2, false], [1, true]]);
  const refused = await call(f, 'POST', `/documents/${OA}/versions`, undefined, signed('2'));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error, 'copy_of_not_approved');
  assert.match(refused.body.message, /Choose v1, or get v2 approved first/);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM governance_document_versions').get() as any).n, 2, 'a refusal records nothing');
  const ok = await call(f, 'POST', `/documents/${OA}/versions`, undefined, signed('1'));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.version.copy_of, 1);
  assert.equal(ok.body.version.counsel_approved, false);
  const log = JSON.parse((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_version_uploaded' ORDER BY id DESC").get() as any).details);
  assert.equal(log.copy_of, 1);
  read = await call(f, 'GET', `/documents/${OA}`);
  assert.equal(read.body.versions[0].copy_of, 1);
  assert.equal(read.body.versions[1].copy_of, null, 'a draft names nothing');
  assert.throws(() => f.db.prepare('UPDATE governance_document_versions SET copy_of_version = 2 WHERE version = 3').run(), 'the version stays append-only');
  for (const s of ['review', 'approved']) assert.equal((await call(f, 'PATCH', `/documents/${OA}`, { status: s })).status, 200);
  const ex = await call(f, 'PATCH', `/documents/${OA}`, { status: 'executed', reason: 'Signed by the sole member on 2 October.', confirm: 'EXECUTED', evidence: { kind: 'version', version: 3 } });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  const done = JSON.parse((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_document_status' ORDER BY id DESC").get() as any).details);
  assert.deepEqual([done.evidence, done.evidence_sha256, done.copy_of], ['v3', shaOf(f, 3), 1]);
});

test('a signed copy that names nothing still uploads (older flows), and reads as naming none', async () => {
  const f = fixture();
  const ok = await call(f, 'POST', `/documents/${OA}/versions`, undefined, signed());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.version.copy_of, null);
});
