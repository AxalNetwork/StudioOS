/**
 * D615 (#1313) — saving a draft for a published contract document type
 * leaves the live values. Publishing applies the pending draft, clears it,
 * and is audited. A draft-only type still saves into the live columns.
 * The hub and the doc-types read return both.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contract_doc_type_draft_d615.test.ts
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

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: SUPER, role: 'admin', jti: 'jti-super' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const rowOf = (db: DatabaseSync, docType: string) =>
  db.prepare('SELECT title, layer, party_roles_json, required_fields_json, status, draft_title, draft_layer, draft_party_roles_json, draft_required_fields_json FROM contract_doc_type_registry WHERE doc_type = ?').get(docType) as any;

const itemOf = (body: any, docType: string) => {
  const row = (body.items || []).find((i: any) => i.doc_type === docType);
  assert.ok(row, `missing ${docType} in ${JSON.stringify(body).slice(0, 240)}`);
  return row;
};

const publishes = (db: DatabaseSync) =>
  db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action = 'registry.type.publish' ORDER BY id").all() as any[];

test('D615: a draft-only type saves into the live columns, and both reads show no pending draft', async () => {
  const db = freshDb();
  const first = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: 'side_letter_axal', title: 'Side letter', layer: 'gp', party_roles: ['axal'], required_fields: ['date'],
  });
  assert.equal(first.status, 201, first.text);
  const second = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: 'side_letter_axal', title: 'Side letter revised', layer: 'fund', party_roles: ['investor'], required_fields: ['amount'],
  });
  assert.equal(second.status, 201, second.text);

  const stored = rowOf(db, 'side_letter_axal');
  assert.equal(stored.status, 'draft');
  assert.equal(stored.title, 'Side letter revised');
  assert.equal(stored.layer, 'fund');
  assert.deepEqual(JSON.parse(stored.party_roles_json), ['investor']);
  assert.deepEqual(JSON.parse(stored.required_fields_json), ['amount']);
  assert.equal(stored.draft_title, null);

  for (const path of ['/api/admin/contracts/registry', '/api/admin/contracts/registry/doc-types']) {
    const read = await call(db, 'GET', path);
    assert.equal(read.status, 200, read.text);
    const item = itemOf(read.body, 'side_letter_axal');
    assert.equal(item.title, 'Side letter revised');
    assert.equal(item.layer, 'fund');
    assert.deepEqual(item.party_roles, ['investor']);
    assert.deepEqual(item.required_fields, ['amount']);
    assert.equal(item.registry_status, 'draft');
    assert.equal(item.pending_draft, null);
  }
});

test('D615: a draft save on a published type keeps the live values, and publishing applies it and is audited', async () => {
  const db = freshDb();
  const created = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: 'side_letter_axal', title: 'Side letter', layer: 'gp', party_roles: ['axal'], required_fields: ['date'],
  });
  assert.equal(created.status, 201, created.text);
  const published = await call(db, 'POST', '/api/admin/contracts/registry/side_letter_axal/publish', { reason: REASON });
  assert.equal(published.status, 200, published.text);
  assert.equal(publishes(db).length, 1);

  const saved = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: 'side_letter_axal', title: 'Side letter next', layer: 'portfolio', party_roles: ['founder'], required_fields: ['closing'],
  });
  assert.equal(saved.status, 201, saved.text);
  assert.equal(publishes(db).length, 1, 'a draft save is not a publish');

  const held = rowOf(db, 'side_letter_axal');
  assert.equal(held.status, 'published');
  assert.equal(held.title, 'Side letter');
  assert.equal(held.layer, 'gp');
  assert.deepEqual(JSON.parse(held.party_roles_json), ['axal']);
  assert.deepEqual(JSON.parse(held.required_fields_json), ['date']);
  assert.equal(held.draft_title, 'Side letter next');
  assert.equal(held.draft_layer, 'portfolio');
  assert.deepEqual(JSON.parse(held.draft_party_roles_json), ['founder']);
  assert.deepEqual(JSON.parse(held.draft_required_fields_json), ['closing']);

  for (const path of ['/api/admin/contracts/registry', '/api/admin/contracts/registry/doc-types']) {
    const read = await call(db, 'GET', path);
    assert.equal(read.status, 200, read.text);
    const item = itemOf(read.body, 'side_letter_axal');
    assert.equal(item.title, 'Side letter');
    assert.equal(item.layer, 'gp');
    assert.deepEqual(item.party_roles, ['axal']);
    assert.deepEqual(item.required_fields, ['date']);
    assert.equal(item.registry_status, 'published');
    assert.equal(item.pending_draft.title, 'Side letter next');
    assert.equal(item.pending_draft.layer, 'portfolio');
    assert.deepEqual(item.pending_draft.party_roles, ['founder']);
    assert.deepEqual(item.pending_draft.required_fields, ['closing']);
  }

  const refused = await call(db, 'POST', '/api/admin/contracts/registry/side_letter_axal/publish', { reason: 'too short' });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(rowOf(db, 'side_letter_axal').draft_title, 'Side letter next');
  assert.equal(publishes(db).length, 1);

  const applied = await call(db, 'POST', '/api/admin/contracts/registry/side_letter_axal/publish', { reason: REASON });
  assert.equal(applied.status, 200, applied.text);
  const live = rowOf(db, 'side_letter_axal');
  assert.equal(live.status, 'published');
  assert.equal(live.title, 'Side letter next');
  assert.equal(live.layer, 'portfolio');
  assert.deepEqual(JSON.parse(live.party_roles_json), ['founder']);
  assert.deepEqual(JSON.parse(live.required_fields_json), ['closing']);
  assert.equal(live.draft_title, null);
  assert.equal(live.draft_layer, null);
  assert.equal(live.draft_party_roles_json, null);
  assert.equal(live.draft_required_fields_json, null);

  const hub = await call(db, 'GET', '/api/admin/contracts/registry');
  const item = itemOf(hub.body, 'side_letter_axal');
  assert.equal(item.title, 'Side letter next');
  assert.equal(item.pending_draft, null);

  const audit = publishes(db);
  assert.equal(audit.length, 2);
  assert.equal(audit[1].user_id, SUPER);
  const details = JSON.parse(audit[1].details);
  assert.equal(details.doc_type, 'side_letter_axal');
  assert.equal(details.reason, REASON);
  assert.equal(String(audit[1].details).includes('Side letter next'), false);
});

test('D615: a published code type keeps its live title when a later draft is saved', async () => {
  const db = freshDb();
  const drafted = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: 'operating_agreement', title: 'OA live custom', layer: 'gp', party_roles: ['axal'], required_fields: ['date'],
  });
  assert.equal(drafted.status, 201, drafted.text);
  const before = await call(db, 'GET', '/api/admin/contracts/registry');
  const codeItem = itemOf(before.body, 'operating_agreement');
  assert.equal(codeItem.title, 'Operating Agreement (LLC)');
  assert.equal(codeItem.registry_status, 'draft');
  assert.equal(codeItem.draft.title, 'OA live custom');
  assert.equal(codeItem.pending_draft, null);

  const published = await call(db, 'POST', '/api/admin/contracts/registry/operating_agreement/publish', { reason: REASON });
  assert.equal(published.status, 200, published.text);
  const next = await call(db, 'POST', '/api/admin/contracts/registry/draft', {
    doc_type: 'operating_agreement', title: 'OA next', layer: 'fund', party_roles: ['investor'], required_fields: ['amount'],
  });
  assert.equal(next.status, 201, next.text);

  const hub = await call(db, 'GET', '/api/admin/contracts/registry');
  const item = itemOf(hub.body, 'operating_agreement');
  assert.equal(item.title, 'OA live custom');
  assert.equal(item.layer, 'gp');
  assert.equal(item.registry_status, 'published');
  assert.equal(item.pending_draft.title, 'OA next');
  assert.equal(item.pending_draft.layer, 'fund');
  const stored = rowOf(db, 'operating_agreement');
  assert.equal(stored.title, 'OA live custom');
  assert.equal(stored.status, 'published');
  assert.equal(stored.draft_title, 'OA next');
});
