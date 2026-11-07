/**
 * D4563 (#4563) — HQ Contracts › Corporate Governance: the three entities'
 * collections, the status rule (never executed unsigned), versions (upload,
 * preview, download, append-only), links to the template library and signed
 * envelopes, confidential documents and the ownership metadata (Super Admin
 * only), the audit rows, and a branch Worker refused. Real migrated schema,
 * in-memory R2; every person and file is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_governance_d4563.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { DOCX, PDF, canMove, dateOf, ownershipOf, sniffDocument } from '../src/services/governance.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const scratch = mkdtempSync(join(tmpdir(), 'governance-d4563-'));
const seed = join(scratch, 'schema.sqlite');
{ const db = new DatabaseSync(seed, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); loadSchema(db); db.close(); }
after(() => rmSync(scratch, { recursive: true, force: true }));
const JWT_SECRET = 'synthetic-d4563-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, FOUNDER = 3;

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
const DOCX_BYTES = (() => {
  const t = new TextEncoder().encode('PK\u0003\u0004....[Content_Types].xml....word/document.xml....');
  t[2] = 0x03; t[3] = 0x04; return t;
})();
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x78, 0x6c]);

let n = 0;
function fixture({ branch = false } = {}) {
  const file = join(scratch, `case-${++n}.sqlite`);
  copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sam Made-up', 'sam@example.test');
  u.run(ADMIN, 'admin', 'Alex Made-up', 'alex@example.test');
  u.run(FOUNDER, 'founder', 'Fay Made-up', 'fay@example.test');
  // The Super Admin is an elevation on admin: a super_admins row (migration 199).
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md) VALUES ('operating_agreement_v1', 'Operating Agreement', 'gp', 'x')").run();
  db.prepare("INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status) VALUES (40, 'env-40', 'other', 'Holdings OA', 'synthetic', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 'completed'), (41, 'env-41', 'other', 'GP consent', 'synthetic', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 'sent')").run();
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const FILES = {
    async put(key: string, bytes: Uint8Array, o: any) { files.set(key, { bytes: new Uint8Array(bytes), type: o?.httpMetadata?.contentType }); },
    async get(key: string) { const v = files.get(key); return v ? { body: new Blob([v.bytes]).stream() } : null; },
    async head(key: string) { return files.has(key) ? {} : null; },
    async delete(key: string) { files.delete(key); },
  };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES, ...(branch ? { BRANCH_CODE: 'north' } : {}) };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const audits = () => (db.prepare('SELECT action, details FROM activity_logs ORDER BY id').all() as any[]).map((r) => ({ action: r.action, details: JSON.parse(r.details) }));
  return { db, app, env, files, audits };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) return { status: res.status, body: await res.json() as any, headers: res.headers };
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers, body: null as any };
}
const upload = (bytes: Uint8Array, o: { signed?: boolean; note?: string } = {}) => {
  const fd = new FormData();
  fd.append('file', new File([bytes], 'up.bin'));
  if (o.signed) fd.append('signed', 'true');
  if (o.note) fd.append('note', o.note);
  return fd;
};

// ─────────────────────────────────────────────────────────── pure

test('the rules: a PDF or a .docx by its bytes, real dates, the status moves, and ownership rows', () => {
  assert.equal(sniffDocument(PDF_BYTES), PDF);
  assert.equal(sniffDocument(DOCX_BYTES), DOCX);
  assert.equal(sniffDocument(ZIP_BYTES), null, 'a plain zip is not a Word document');
  assert.equal(sniffDocument(new TextEncoder().encode('MZ....')), null);
  assert.equal(dateOf('2026-02-28'), '2026-02-28');
  assert.equal(dateOf('2026-02-30'), null, 'a date that is not on the calendar');
  assert.equal(dateOf('28/02/2026'), null);
  assert.equal(canMove('draft', 'executed'), false, 'a draft never jumps to executed');
  assert.equal(canMove('approved', 'executed'), true);
  assert.equal(canMove('executed', 'draft'), false, 'an executed document only archives');
  assert.equal(canMove('archived', 'draft'), true);
  assert.deepEqual(ownershipOf([{ holder: ' Axal VC Holdings LLC ', percent: '100', interest: 'Member' }]),
    { ok: true, rows: [{ holder: 'Axal VC Holdings LLC', interest: 'Member', percent: 100, note: null }] });
  assert.equal(ownershipOf([{ holder: 'A', percent: 60 }, { holder: 'B', percent: 50 }]).ok, false, 'over 100%');
  assert.equal(ownershipOf([{ percent: 10 }]).ok, false, 'a row with no holder');
  assert.equal(ownershipOf({}).ok, false);
});

// ─────────────────────────────────────────────────────────── the routes

test('three entity collections; a document is created as a draft, linked to the library without copying it', async () => {
  const f = fixture();
  const list = await call(f, ADMIN, 'GET', '');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.entities.map((e: any) => [e.key, e.name]), [['holdings', 'Axal VC Holdings LLC'], ['management', 'Axal VC Management LLC'], ['gp', 'Axal VC GP LLC']]);
  assert.deepEqual(list.body.categories.map((x: any) => x.key), ['operating_agreement', 'formation_certificate', 'member_register', 'resolution', 'signing_authority']);
  const templates = () => (f.db.prepare('SELECT COUNT(*) AS n FROM legal_templates').get() as any).n;
  const before = templates();
  const made = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'holdings', category: 'operating_agreement', title: 'Holdings Operating Agreement', effective_date: '2026-01-15', template_slug: 'operating_agreement_v1' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual([made.body.document.status, made.body.document.confidential, made.body.document.template_slug], ['draft', false, 'operating_agreement_v1']);
  assert.equal(templates(), before, 'the template is linked, not copied');
  const bad = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'holdings', category: 'operating_agreement', title: 'x', template_slug: 'no_such_template' });
  assert.equal(bad.status, 422);
  assert.equal((await call(f, ADMIN, 'POST', '/documents', { entity_key: 'fund', category: 'resolution', title: 'x' })).status, 400, 'only the three LLCs');
  assert.equal((await call(f, ADMIN, 'POST', '/documents', { entity_key: 'gp', category: 'tax_return', title: 'x' })).status, 400);
  const again = await call(f, ADMIN, 'GET', '');
  assert.equal(again.body.entities[0].documents.length, 1);
  assert.deepEqual(f.audits().map((a) => a.action), ['governance_document_created']);
  assert.doesNotMatch(JSON.stringify(f.audits()), /Holdings Operating Agreement/, 'the audit row names no title');
});

test('versions: upload a PDF and a .docx, preview inline, download as a file, every version kept and none rewritten', async () => {
  const f = fixture();
  const { body: { document: d } } = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'Written consent' });
  const v1 = await call(f, ADMIN, 'POST', `/documents/${d.uid}/versions`, undefined, upload(PDF_BYTES, { note: 'First draft' }));
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  assert.deepEqual([v1.body.version.version, v1.body.version.content_type, v1.body.version.signed], [1, PDF, false]);
  const v2 = await call(f, ADMIN, 'POST', `/documents/${d.uid}/versions`, undefined, upload(DOCX_BYTES));
  assert.deepEqual([v2.body.version.version, v2.body.version.content_type], [2, DOCX]);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${d.uid}/versions`, undefined, upload(ZIP_BYTES))).status, 415);
  assert.equal(f.files.size, 2);
  const read = await call(f, ADMIN, 'GET', `/documents/${d.uid}`);
  assert.deepEqual(read.body.versions.map((v: any) => v.version), [2, 1], 'the history, newest first');
  const preview = await call(f, ADMIN, 'GET', `/documents/${d.uid}/versions/1/file`);
  assert.equal(preview.status, 200);
  assert.match(String(preview.headers.get('content-disposition')), /^inline;/);
  assert.deepEqual(preview.bytes, PDF_BYTES);
  const down = await call(f, ADMIN, 'GET', `/documents/${d.uid}/versions/1/file?download=1`);
  assert.match(String(down.headers.get('content-disposition')), /^attachment; filename="gp-resolution-v1\.pdf"/);
  assert.equal(down.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call(f, ADMIN, 'GET', `/documents/${d.uid}/versions/9/file`)).status, 404);
  assert.throws(() => f.db.prepare('UPDATE governance_document_versions SET note = ? WHERE version = 1').run('x'), /append-only/);
  assert.throws(() => f.db.prepare('DELETE FROM governance_document_versions').run(), /append-only/);
  assert.deepEqual(f.audits().map((a) => a.action), ['governance_document_created', 'governance_version_uploaded', 'governance_version_uploaded', 'governance_file_previewed', 'governance_file_downloaded']);
});

test('never executed unsigned: a draft cannot jump, an approved one needs a signed version or a completed envelope', async () => {
  const f = fixture();
  const { body: { document: d } } = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'management', category: 'signing_authority', title: 'Signing authority' });
  const jump = await call(f, ADMIN, 'PATCH', `/documents/${d.uid}`, { status: 'executed' });
  assert.equal(jump.status, 409);
  assert.equal(jump.body.error, 'status_move_refused');
  for (const s of ['review', 'approved']) assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${d.uid}`, { status: s })).status, 200, s);
  await call(f, ADMIN, 'POST', `/documents/${d.uid}/versions`, undefined, upload(PDF_BYTES));
  const unsigned = await call(f, ADMIN, 'PATCH', `/documents/${d.uid}`, { status: 'executed' });
  assert.equal(unsigned.status, 409);
  assert.equal(unsigned.body.error, 'not_signed', 'an unsigned upload is not a signature');
  const pending = await call(f, ADMIN, 'PATCH', `/documents/${d.uid}`, { status: 'executed', envelope_id: 41 });
  assert.equal(pending.body.error, 'not_signed', 'an envelope that has not completed is not a signature');
  await call(f, ADMIN, 'POST', `/documents/${d.uid}/versions`, undefined, upload(PDF_BYTES, { signed: true }));
  const done = await call(f, ADMIN, 'PATCH', `/documents/${d.uid}`, { status: 'executed' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.document.status, done.body.document.executed_version], ['executed', 2]);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${d.uid}/versions`, undefined, upload(PDF_BYTES))).status, 409, 'an executed document takes no new version');
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${d.uid}`, { status: 'draft' })).status, 409);
  // A completed envelope is evidence too.
  const { body: { document: e } } = await call(f, ADMIN, 'POST', '/documents', { entity_key: 'holdings', category: 'operating_agreement', title: 'OA' });
  for (const s of ['review', 'approved']) await call(f, ADMIN, 'PATCH', `/documents/${e.uid}`, { status: s });
  const viaEnvelope = await call(f, ADMIN, 'PATCH', `/documents/${e.uid}`, { status: 'executed', envelope_id: 40 });
  assert.deepEqual([viaEnvelope.status, viaEnvelope.body.document.envelope_id, viaEnvelope.body.document.executed_version], [200, 40, null]);
  // The envelope it was signed in stays while it is executed: unlinking it is refused, not a table error.
  const unlink = await call(f, ADMIN, 'PATCH', `/documents/${e.uid}`, { envelope_id: null });
  assert.deepEqual([unlink.status, unlink.body.error], [409, 'executed_link_locked']);
  assert.equal((f.db.prepare('SELECT envelope_id FROM governance_documents WHERE uid = ?').get(e.uid) as any).envelope_id, 40);
  const kept = await call(f, ADMIN, 'PATCH', `/documents/${e.uid}`, { envelope_id: 40, template_slug: null });
  assert.equal(kept.status, 200, 'resending the same envelope is no change to it');
  const archived = await call(f, ADMIN, 'PATCH', `/documents/${e.uid}`, { status: 'archived' });
  assert.equal(archived.status, 200);
  assert.throws(() => f.db.prepare("UPDATE governance_documents SET status = 'executed', executed_version = NULL, envelope_id = NULL WHERE uid = ?").run(d.uid), /CHECK/, 'the table refuses an executed row with no evidence too');
});

test('confidential documents and the ownership metadata are the Super Admin\'s alone, on every route', async () => {
  const f = fixture();
  const conf = await call(f, SUPER, 'POST', '/documents', { entity_key: 'holdings', category: 'member_register', title: 'Member register' });
  assert.equal(conf.body.document.confidential, true, 'the Super Admin\'s documents are confidential by default');
  const uid = conf.body.document.uid;
  await call(f, SUPER, 'POST', `/documents/${uid}/versions`, undefined, upload(PDF_BYTES));
  const theirs = await call(f, ADMIN, 'GET', '');
  assert.deepEqual([theirs.body.entities[0].documents.length, theirs.body.entities[0].withheld], [0, 1], 'listed only as withheld');
  for (const [m, p, b] of [['GET', `/documents/${uid}`], ['PATCH', `/documents/${uid}`, { title: 'x' }], ['GET', `/documents/${uid}/versions/1/file`]] as const) {
    assert.equal((await call(f, ADMIN, m, p, b)).status, 404, `${m} ${p}`);
  }
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${uid}/versions`, undefined, upload(PDF_BYTES))).status, 404);
  assert.equal((await call(f, ADMIN, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'x', confidential: true })).status, 403);
  assert.equal((await call(f, SUPER, 'GET', `/documents/${uid}/versions/1/file`)).status, 200);
  // Ownership: restricted, editable, never hard-coded.
  assert.equal((await call(f, ADMIN, 'GET', '/ownership')).status, 403);
  assert.equal((await call(f, ADMIN, 'PUT', '/ownership/gp', { ownership: [{ holder: 'x', percent: 100 }] })).status, 403);
  const put = await call(f, SUPER, 'PUT', '/ownership/gp', { ownership: [{ holder: 'Axal VC Holdings LLC', interest: 'Sole member', percent: 100 }] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const read = await call(f, SUPER, 'GET', '/ownership');
  assert.deepEqual(read.body.entities.find((e: any) => e.key === 'gp').ownership, [{ holder: 'Axal VC Holdings LLC', interest: 'Sole member', percent: 100, note: null }]);
  assert.equal(read.body.entities.find((e: any) => e.key === 'holdings').updated_at, null, 'not recorded is null, never a made-up owner');
  assert.ok(f.audits().some((a) => a.action === 'governance_ownership_updated' && a.details.entity === 'gp' && a.details.rows === 1));
  assert.doesNotMatch(JSON.stringify(f.audits()), /Sole member/, 'the audit row names no holder');
});

test('who: a founder is refused, and a branch Worker answers HQ only, before anything is read or written', async () => {
  const f = fixture();
  assert.equal((await call(f, FOUNDER, 'GET', '')).status, 403);
  assert.equal((await call(f, FOUNDER, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'x' })).status, 403);
  const b = fixture({ branch: true });
  assert.equal((await call(b, SUPER, 'GET', '')).status, 403);
  assert.equal((await call(b, SUPER, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'x' })).status, 403);
  assert.equal((b.db.prepare('SELECT COUNT(*) AS n FROM governance_documents').get() as any).n, 0);
});
