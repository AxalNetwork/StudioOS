/**
 * D4811 (#4811) part 12 — the execution evidence an externally signed upload
 * carries (board CT-12 B): a version uploaded as the signed copy says when it
 * was signed (not after today), by whom, and is attested by the uploader; an
 * unsigned upload needs none of it; the fields are kept on the append-only
 * version row and returned with it; executing on that copy logs its hash.
 * Real migrated schema, in memory; everything is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_signed_copy_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { signedCopyOf } from '../src/services/governance.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-signed-copy-only-not-a-real-credential'.repeat(2);
const ADMIN = 2;
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
const REASON = 'Board approved on 2026-11-09; synthetic test only.';
const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Alex Made-up', 'alex@example.test', 1)").run(ADMIN);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'sess', 'totp', ?)").run(ADMIN, new Date().toISOString().replace('T', ' ').slice(0, 19));
  const FILES = { async put() {}, async get() { return null; }, async head() { return null; }, async delete() {} };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ detail: err.message, code: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, env };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: ADMIN, jti: 'sess' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() as any : null };
}
const upload = (fields: Record<string, string>) => { const fd = new FormData(); fd.append('file', new File([PDF_BYTES], 'x.pdf')); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return fd; };
const GOOD = { signed: 'true', signed_on: '2026-11-05', signatory: '  S. Example,   Manager ', attest: 'true' };

test('the rule: a date not after today, a signatory, and the attestation', () => {
  assert.deepEqual(signedCopyOf({ signed_on: '2026-11-05', signatory: ' S. Example,  Manager ', attest: 'true' }, '2026-11-09'),
    { ok: true, signed_on: '2026-11-05', signatory: 'S. Example, Manager' });
  assert.equal((signedCopyOf({ signatory: 'S. Example', attest: 'true' }, '2026-11-09') as any).code, 'signed_on_required');
  assert.equal((signedCopyOf({ signed_on: '2026-02-30', signatory: 'S. Example', attest: 'true' }, '2026-11-09') as any).code, 'signed_on_required', 'not a real date');
  assert.equal((signedCopyOf({ signed_on: '2026-11-10', signatory: 'S. Example', attest: 'true' }, '2026-11-09') as any).code, 'signed_on_future');
  assert.equal(signedCopyOf({ signed_on: '2026-11-09', signatory: 'S. Example', attest: 'true' }, '2026-11-09').ok, true, 'today is allowed');
  assert.equal((signedCopyOf({ signed_on: '2026-11-05', signatory: 'S', attest: 'true' }, '2026-11-09') as any).code, 'signatory_required');
  assert.equal((signedCopyOf({ signed_on: '2026-11-05', signatory: 'x'.repeat(201), attest: 'true' }, '2026-11-09') as any).code, 'signatory_required');
  assert.equal((signedCopyOf({ signed_on: '2026-11-05', signatory: 'S. Example' }, '2026-11-09') as any).code, 'attestation_required');
});

test('a signed upload is refused without each field, and nothing is stored; with them the version keeps them', async () => {
  const f = fixture();
  const uid = (await call(f, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'GP resolution' })).body.document.uid;
  for (const [drop, code] of [['signed_on', 'signed_on_required'], ['signatory', 'signatory_required'], ['attest', 'attestation_required']] as const) {
    const fields: Record<string, string> = { ...GOOD }; delete fields[drop];
    const r = await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload(fields));
    assert.equal(r.status, 422, drop); assert.equal(r.body.error, code);
  }
  const future = await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload({ ...GOOD, signed_on: TOMORROW }));
  assert.equal(future.body.error, 'signed_on_future');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM governance_document_versions').get() as any).n, 0, 'a refusal stores no version');
  const plain = await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload({}));
  assert.equal(plain.status, 201, 'an unsigned draft needs none of it');
  assert.deepEqual([plain.body.version.signed_on, plain.body.version.signatory, plain.body.version.attested], [null, null, false]);
  const ok = await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload({ ...GOOD, signed_on: TODAY }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.version.signed, ok.body.version.signed_on, ok.body.version.signatory, ok.body.version.attested], [true, TODAY, 'S. Example, Manager', true]);
  const row = f.db.prepare('SELECT signed_on, signatory, attested_by FROM governance_document_versions WHERE version = 2').get() as any;
  assert.deepEqual({ ...row }, { signed_on: TODAY, signatory: 'S. Example, Manager', attested_by: ADMIN });
  assert.throws(() => f.db.prepare("UPDATE governance_document_versions SET signatory = 'someone else' WHERE version = 2").run(), /append-only/, 'still append-only');
  const log = JSON.parse((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_version_uploaded' ORDER BY id DESC LIMIT 1").get() as any).details);
  assert.equal(log.signed_on, TODAY);
  assert.equal(log.sha256.length, 64);
});

test('executing on the signed copy logs its hash beside the evidence', async () => {
  const f = fixture();
  const uid = (await call(f, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'GP resolution' })).body.document.uid;
  const v = await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload(GOOD));
  for (const s of ['review', 'approved']) assert.equal((await call(f, 'PATCH', `/documents/${uid}`, { status: s })).status, 200);
  const r = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', reason: REASON, confirm: 'EXECUTED', evidence: { kind: 'version', version: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const log = JSON.parse((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_document_status' ORDER BY id DESC LIMIT 1").get() as any).details);
  assert.equal(log.evidence, 'v1');
  assert.equal(log.evidence_sha256, v.body.version.file_sha256);
});
