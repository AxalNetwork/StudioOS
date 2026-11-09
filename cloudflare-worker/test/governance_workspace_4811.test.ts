/**
 * D4811 (#4811) part 5 — a governance record's workspace (board CT-07):
 * `GET /api/admin/governance/documents/:uid/activity`, the record's own audit
 * trail in words, newest first; the same visibility as the record (a
 * confidential one is the Super Admin's alone, 404 for anyone else, and
 * reading its trail is logged as a view); another record's rows never mix in.
 * Real migrated schema, in memory; every person and file is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_workspace_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { eventOf } from '../src/services/governanceActivity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-workspace-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2;
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sam Made-up', 'sam@example.test');
  u.run(ADMIN, 'admin', 'Alex Made-up', 'alex@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const files = new Map<string, Uint8Array>();
  const FILES = {
    async put(key: string, bytes: Uint8Array) { files.set(key, new Uint8Array(bytes)); },
    async get(key: string) { const v = files.get(key); return v ? { body: new Blob([v]).stream() } : null; },
    async head(key: string) { return files.has(key) ? {} : null; },
    async delete(key: string) { files.delete(key); },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, env };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() as any : null };
}
const upload = (o: { signed?: boolean } = {}) => { const fd = new FormData(); fd.append('file', new File([PDF_BYTES], 'up.pdf')); if (o.signed) fd.append('signed', 'true'); return fd; };

test('the words: each governance action as a sentence; anything else is not this record\'s', () => {
  const e = (action: string, details: unknown) => eventOf({ action, details: JSON.stringify(details), created_at: '2026-11-09 10:00:00', actor_name: 'Alex' });
  assert.equal(e('governance_document_created', {})!.line, 'Created as a draft');
  assert.equal(e('governance_document_status', { from: 'review', status: 'approved' })!.line, 'Moved from In review to Approved');
  assert.equal(e('governance_document_updated', { fields: ['title', 'effective_date'] })!.line, 'Changed title, effective date');
  assert.equal(e('governance_version_uploaded', { version: 2, signed: true })!.line, 'Uploaded v2 as the signed copy');
  assert.equal(e('governance_file_downloaded', { version: 1 })!.line, 'Downloaded v1');
  assert.equal(e('governance_file_previewed', { version: 'x' })!.line, 'Previewed a file', 'a malformed version is not guessed');
  assert.equal(e('governance_file_previewed', { version: 'x' })!.version, null, 'an unknown version is null, never 0');
  assert.equal(e('governance_ownership_updated', {}), null);
  assert.equal(eventOf({ action: 'governance_document_created', details: 'not json', created_at: null })!.actor, null, 'an unknown actor stays unknown');
});

test('the trail: the record\'s own events, newest first, with who did each; another record\'s never mix in', async () => {
  const f = fixture();
  const made = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'GP resolution 2026-07' });
  const other = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'holdings', category: 'resolution', title: 'Other' });
  const uid = made.body.document.uid;
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${uid}/versions`, undefined, upload())).status, 201);
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${uid}`, { status: 'review' })).status, 200);
  await call(f, ADMIN, 'POST', `/documents/${other.body.document.uid}/versions`, undefined, upload());
  const r = await call(f, ADMIN, 'GET', `/documents/${uid}/activity`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.events.map((e: any) => e.line), ['Moved from Draft to In review', 'Uploaded v1', 'Created as a draft']);
  assert.ok(r.body.events.every((e: any) => e.actor === 'Alex Made-up'));
  assert.equal(r.body.events[1].version, 1);
  assert.doesNotMatch(JSON.stringify(r.body), /GP resolution 2026-07|up\.pdf/, 'the trail carries no title or file name');
});

test('a confidential record\'s trail is the Super Admin\'s alone, and reading it is logged as a view', async () => {
  const f = fixture();
  const made = await call(f, SUPER, 'POST', '/documents', { entity_key: 'holdings', category: 'member_register', title: 'Register' });
  assert.equal(made.body.document.confidential, true);
  const uid = made.body.document.uid;
  assert.equal((await call(f, ADMIN, 'GET', `/documents/${uid}/activity`)).status, 404, 'as if it did not exist');
  const before = (f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'governance_document_viewed'").get() as any).n;
  const r = await call(f, SUPER, 'GET', `/documents/${uid}/activity`);
  assert.equal(r.status, 200);
  const after = (f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'governance_document_viewed'").get() as any).n;
  assert.equal(after, before + 1);
  assert.equal((await call(f, SUPER, 'GET', '/documents/not-a-uid/activity')).status, 404);
});
