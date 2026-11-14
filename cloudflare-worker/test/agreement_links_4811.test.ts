/**
 * D4811 (#4811) part 19 — related-document links that name agreements (board
 * CT-11): a governance record governs a legacy agreement or an envelope by
 * the desk's uid; an unknown agreement is refused; a newer approved version
 * flags the agreement for review like any dependant; the agreement's
 * workspace reads which records govern it (a confidential one restricted,
 * never named). The migration rebuilds the table and keeps every row.
 * Real migrated schema, in memory; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agreement_links_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-agreement-links-only-not-a-real-credential'.repeat(2);
const ADMIN = 2;
const OA = '00000000-0000-4000-8000-0000000000b1', SECRET_REC = '00000000-0000-4000-8000-0000000000b2';
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');

function fixture(super_ = false) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Alex Made-up', 'alex@example.test', 1)").run(ADMIN);
  if (super_) db.exec(`INSERT INTO super_admins (user_id) VALUES (${ADMIN})`);
  db.prepare("INSERT INTO governance_documents (uid, entity_key, category, title, status, confidential) VALUES (?, 'gp', 'operating_agreement', 'GP OA', 'draft', 0), (?, 'gp', 'resolution', 'Confidential resolution', 'draft', 1)").run(OA, SECRET_REC);
  db.prepare("INSERT INTO documents (uid, title, doc_type, status, template_name) VALUES ('doc-lpa', 'Fund I LPA', 'safe', 'signed', 'safe')").run();
  db.prepare("INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status) VALUES (9, 'env-sub', 'other', 'Subscription Agreement', 'b', ?, 2, 'sent')").run('c'.repeat(64));
  const FILES = { async put() {}, async get() { return null; }, async head() { return null; }, async delete() {} };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, env };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: ADMIN }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const upload = () => { const fd = new FormData(); fd.append('file', new File([PDF], 'v.pdf')); return fd; };

test('the table takes agreements: a legacy document and an envelope link; an unknown one is refused', async () => {
  const f = fixture();
  const sql = (f.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'governance_relations'").get() as any).sql;
  assert.match(sql, /'agreement'/, 'the rebuilt table allows the agreement kind');
  const a = await call(f, 'POST', `/documents/${OA}/related`, { kind: 'agreement', ref: 'doc-lpa' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual([a.body.relation.kind, a.body.relation.title, a.body.relation.status], ['agreement', 'Fund I LPA', 'signed']);
  assert.equal((await call(f, 'POST', `/documents/${OA}/related`, { kind: 'agreement', ref: 'env-sub' })).status, 201);
  const bad = await call(f, 'POST', `/documents/${OA}/related`, { kind: 'agreement', ref: 'no-such' });
  assert.equal(bad.status, 422); assert.equal(bad.body.error, 'relation_target_not_found');
  assert.equal((await call(f, 'POST', `/documents/${OA}/related`, { kind: 'agreement', ref: 'doc-lpa' })).body.error, 'relation_exists');
});

test('a newer approved version flags the agreement; its workspace reads who governs it; a confidential governor is restricted', async () => {
  const f = fixture();
  await call(f, 'POST', `/documents/${OA}/related`, { kind: 'agreement', ref: 'doc-lpa' });
  assert.equal((await call(f, 'POST', `/documents/${OA}/versions`, undefined, upload())).status, 201);
  for (const s of ['review', 'approved']) assert.equal((await call(f, 'PATCH', `/documents/${OA}`, { status: s })).status, 200);
  const g = await call(f, 'GET', '/governing?kind=agreement&ref=doc-lpa');
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.governing.map((r: any) => [r.title, r.state]), [['GP OA', 'review_suggested']]);
  f.db.prepare("INSERT INTO governance_relations (governing_uid, dependent_kind, dependent_ref) VALUES (?, 'agreement', 'doc-lpa')").run(SECRET_REC);
  const again = await call(f, 'GET', '/governing?kind=agreement&ref=doc-lpa');
  assert.equal(again.body.governing.length, 2);
  const hidden = again.body.governing.find((r: any) => r.restricted);
  assert.ok(hidden, 'the confidential governor is counted');
  assert.equal(hidden.title, null); assert.equal(hidden.ref, null, 'and never named');
  assert.equal((await call(f, 'GET', '/governing?kind=nope&ref=x')).body.error, 'object_required');
});
