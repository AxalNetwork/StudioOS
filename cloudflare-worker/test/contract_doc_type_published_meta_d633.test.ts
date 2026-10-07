/**
 * D633 (#1391, Q1) — the HQ Contracts hub says when, by whom and why each
 * published doc type went live, so the registry can show it; a draft or a
 * code-only type carries none. Setup as D622's test.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contract_doc_type_published_meta_d633.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import registry from '../src/routes/admin_contract_doc_registry.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const REASON = 'Publish the revised party roles';
const ADMIN = 2;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents', 'esign_envelopes', 'esign_recipients']) {
    db.exec(ddl(t));
  }
  db.exec(read('cloudflare-worker/sql/migrations/332_contract_doc_type_registry.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/416_contract_doc_type_pending_draft.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(SUPER, 'admin', 'Sam Super', 'super@axal.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(ADMIN, 'admin', 'Ada Admin', 'admin@axal.test');
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES ('jti-admin', ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  ).run(ADMIN);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES ('jti-super', ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  ).run(SUPER);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/admin/contracts/registry', registry as any);
  a.onError((err: any, c) => {
    const msg = String(err?.message ?? '');
    if (msg === 'step_up_required') return c.json({ detail: msg }, 403);
    const mapped = (AUTH_ERROR_STATUSES as Record<string, number>)[msg];
    if (mapped) return c.json({ detail: msg }, mapped as any);
    return c.json({ detail: 'Internal server error', msg }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, who = SUPER, dbBinding?: any) {
  const tok = await new SignJWT({ user_id: who, role: 'admin', jti: who === SUPER ? 'jti-super' : 'jti-admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: dbBinding || d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const itemOf = (body: any, docType: string) => {
  const row = (body.items || []).find((i: any) => i.doc_type === docType);
  assert.ok(row, `missing ${docType}`);
  return row;
};
const draft = (db: DatabaseSync) => call(db, 'POST', '/api/admin/contracts/registry/draft', {
  doc_type: 'side_letter_axal', title: 'Side letter', layer: 'gp', party_roles: ['founder'], required_fields: ['closing'],
});
const hub = async (db: DatabaseSync, dbBinding?: any) => (await call(db, 'GET', '/api/admin/contracts/registry', undefined, SUPER, dbBinding)).body;

test('a published type says when, by whom and why it went live; a draft and a code-only type say nothing', async () => {
  const db = freshDb();
  assert.equal((await draft(db)).status, 201);
  const asDraft = itemOf(await hub(db), 'side_letter_axal');
  assert.equal(asDraft.registry_status, 'draft');
  assert.equal(asDraft.published ?? null, null);
  const pub = await call(db, 'POST', '/api/admin/contracts/registry/side_letter_axal/publish', { reason: REASON });
  assert.equal(pub.status, 200, pub.text);
  const item = itemOf(await hub(db), 'side_letter_axal');
  assert.equal(item.registry_status, 'published');
  assert.equal(item.published.by, SUPER);
  assert.equal(item.published.by_name, 'Sam Super');
  assert.equal(item.published.reason, REASON);
  assert.match(String(item.published.at), /^\d{4}-\d{2}-\d{2}/);
  const code = (await hub(db)).items.find((i: any) => i.registry_status === 'code');
  assert.ok(code, 'the code catalog still lists types with no store row');
  assert.equal(code.published ?? null, null);
});

test('a publisher name that cannot be read is left out, and the hub still answers', async () => {
  const db = freshDb();
  await draft(db);
  await call(db, 'POST', '/api/admin/contracts/registry/side_letter_axal/publish', { reason: REASON });
  const base = d1Over(db);
  const failing = { ...base, prepare: (sql: string) => {
    if (/FROM users WHERE id IN \(SELECT value FROM json_each/.test(sql)) throw new Error('users unreadable');
    return base.prepare(sql);
  } };
  const w = console.warn; console.warn = () => {};
  try {
    const item = itemOf(await hub(db, failing), 'side_letter_axal');
    assert.deepEqual([item.published.by, item.published.by_name, item.published.reason], [SUPER, null, REASON]);
  } finally { console.warn = w; }
});

test('a code-catalog type, once published from the store, carries the same line', async () => {
  const db = freshDb();
  const code = (await hub(db)).items.find((i: any) => i.registry_status === 'code');
  const d = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: code.doc_type, title: code.title, layer: code.layer, party_roles: code.party_roles, required_fields: [],
  });
  assert.equal(d.status, 201, d.text);
  const pub = await call(db, 'POST', `/api/admin/contracts/registry/${code.doc_type}/publish`, { reason: REASON });
  assert.equal(pub.status, 200, pub.text);
  const item = itemOf(await hub(db), code.doc_type);
  assert.equal(item.registry_status, 'published');
  assert.deepEqual([item.published.by_name, item.published.reason], ['Sam Super', REASON]);
});
