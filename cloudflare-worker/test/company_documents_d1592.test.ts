/**
 * D1592 (#3860) — a company's documents: read, upload and download (migration
 * 748), on real SQLite: the baseline's tables, migrations 597 and 748 over
 * them, and the router mounted as `index.ts` mounts it. R2 is an in-memory
 * stand-in. Every person, company and file below is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_documents_d1592.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyDocuments, { reads } from '../src/routes/company_documents.ts';
import legal from '../src/routes/legal.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M748 = readFileSync(new URL('../sql/migrations/748_company_documents.sql', import.meta.url), 'utf8');

// Ada is Northwind's primary admin; Ben a plain member who founded the venture Kite;
// Cy a plain member with no venture; Dee belongs to no company; Eve is a platform admin.
const ADA = 1, BEN = 2, CY = 3, DEE = 4, EVE = 5;
const NORTH = 1, SOUTH = 2;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [CY]: 'founder', [DEE]: 'founder', [EVE]: 'admin' };
const KITE = 10, OWL = 11, GONE = 12;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'founders', 'projects', 'company_profiles', 'user_company_links', 'documents']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597);
  db.exec(M748);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [CY, 'Cy'], [DEE, 'Dee'], [EVE, 'Eve']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind'); c.run(SOUTH, 'co-south', 'Southwind');
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')");
  l.run('l-1', NORTH, ADA, 'Member', 1); l.run('l-2', NORTH, BEN, 'Member', 0); l.run('l-3', NORTH, CY, 'Member', 0); l.run('l-4', SOUTH, DEE, 'Admin', 1);
  return db;
}

/** Ben founds Kite, Ada founds Owl (both Northwind's); a trashed venture of Ben's too. Each holds one document. */
function seedVentures(db: DatabaseSync) {
  // A founder's projects are theirs through `users.founder_id` (canAccessFounderResource).
  const fBen = 20, fAda = 21;
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?), (?, ?, ?)').run(fBen, 'Ben Made-up', 'f-ben@example.test', fAda, 'Ada Made-up', 'f-ada@example.test');
  db.prepare('UPDATE users SET founder_id = ? WHERE id = ?').run(fBen, BEN);
  db.prepare('UPDATE users SET founder_id = ? WHERE id = ?').run(fAda, ADA);
  const p = db.prepare('INSERT INTO projects (id, name, founder_id, company_id, deleted_at) VALUES (?, ?, ?, ?, ?)');
  p.run(KITE, 'Kite', fBen, NORTH, null); p.run(OWL, 'Owl', fAda, NORTH, null); p.run(GONE, 'Gone', fBen, NORTH, '2026-02-01');
  const d = db.prepare("INSERT INTO documents (project_id, title, doc_type, status, content) VALUES (?, ?, 'other', 'draft', 'secret body')");
  d.run(KITE, 'Kite SAFE'); d.run(OWL, 'Owl NDA'); d.run(GONE, 'Gone memo');
}

function r2(opts: { failPut?: boolean } = {}) {
  const store = new Map<string, { bytes: Uint8Array; type: string }>();
  const order: string[] = [];
  return {
    store, order,
    async put(key: string, bytes: Uint8Array, o: any) {
      order.push(`put ${key}`);
      if (opts.failPut) throw new Error('r2 down');
      store.set(key, { bytes: new Uint8Array(bytes), type: o?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const v = store.get(key);
      return v ? { body: new Blob([v.bytes]).stream(), httpMetadata: { contentType: v.type } } : null;
    },
  };
}

/** `files: null` is a deployment with no bucket bound. */
const envOf = (db: DatabaseSync, files: any = r2()): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: files ?? undefined });

async function call(env: any, who: number, method: string, path: string, body?: FormData) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono();
  app.route('/api', companyDocuments);
  app.route('/api/legal', legal);
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}` }, ...(body ? { body } : {}) }, env);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text, bytes: buf, headers: res.headers };
}

function upload(bytes: Uint8Array, kind: string, opts: { type?: string; title?: string; name?: string } = {}) {
  const f = new FormData();
  f.append('file', new File([bytes], opts.name ?? 'doc.pdf', { type: opts.type ?? 'application/pdf' }));
  f.append('kind', kind);
  if (opts.title) f.append('title', opts.title);
  return f;
}

const LIST = '/api/company/co-north/documents';
const docCount = (db: DatabaseSync) => Number((db.prepare('SELECT COUNT(*) AS n FROM documents WHERE company_id IS NOT NULL').get() as any).n);

// ── Gates ───────────────────────────────────────────────────────────────────

test('gates: a non-member and an unknown uid read the same 404; a member reads; a plain member cannot upload; an archived company refuses', async () => {
  const db = fixture(); const env = envOf(db);
  const outsider = await call(env, DEE, 'GET', LIST);
  const unknown = await call(env, DEE, 'GET', '/api/company/co-nowhere/documents');
  assert.equal(outsider.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(outsider.body, unknown.body, 'a non-member learns nothing an unknown uid would not say');
  assert.equal((await call(env, DEE, 'POST', LIST, upload(PDF, 'bylaws'))).status, 404);
  assert.equal((await call(env, DEE, 'GET', `${LIST}/x/file`)).status, 404);

  const read = await call(env, CY, 'GET', LIST);
  assert.equal(read.status, 200);
  assert.equal(read.body.can_upload, false);
  assert.deepEqual(read.body.slots.map((s: any) => [s.kind, s.document, s.earlier]), [
    ['certificate_of_incorporation', null, 0], ['bylaws', null, 0], ['tax_id_letter', null, 0], ['registered_agent_agreement', null, 0]]);
  const no = await call(env, CY, 'POST', LIST, upload(PDF, 'bylaws'));
  assert.equal(no.status, 403);
  assert.equal(no.body.error, 'not_editor');
  assert.equal(docCount(db), 0);

  assert.equal((await call(env, ADA, 'GET', LIST)).body.can_upload, true, 'the primary admin is an editor');
  assert.equal((await call(env, EVE, 'GET', LIST)).status, 200, 'a platform admin reads');
  db.prepare("UPDATE company_profiles SET archived_at = '2026-03-01' WHERE id = ?").run(NORTH);
  const archived = await call(env, ADA, 'POST', LIST, upload(PDF, 'bylaws'));
  assert.equal(archived.status, 409);
  assert.equal(archived.body.error, 'archived');
  assert.equal((await call(env, ADA, 'GET', LIST)).body.can_upload, false);
});

// ── Uploads ─────────────────────────────────────────────────────────────────

test('uploads: a PDF is in R2 before its row exists, with a key under the company, and the answer says only what a reader may see', async () => {
  const db = fixture();
  const files = r2();
  let rowsAtPut = -1;
  const put = files.put.bind(files);
  files.put = async (k: string, b: Uint8Array, o: any) => { rowsAtPut = docCount(db); return put(k, b, o); };
  const res = await call(envOf(db, files), ADA, 'POST', LIST, upload(PDF, 'bylaws', { title: 'Bylaws as adopted' }));
  assert.equal(res.status, 201);
  assert.equal(rowsAtPut, 0, 'the bytes were stored before any row');
  const [key] = [...files.store.keys()];
  assert.match(key, /^company-documents\/co-north\/[0-9a-f-]{36}$/);
  assert.equal(files.store.get(key)!.type, 'application/pdf');
  const row = db.prepare('SELECT * FROM documents WHERE company_id = ?').get(NORTH) as any;
  assert.equal(row.project_id, null);
  assert.equal(row.uploaded_by, ADA);
  assert.equal(row.status, 'generated');
  assert.equal(row.template_name, 'company_upload');
  assert.equal(row.doc_type, 'bylaws');
  assert.equal(JSON.parse(row.content).r2_key, key);
  assert.deepEqual(Object.keys(res.body).sort(), ['created_at', 'has_file', 'kind', 'status', 'title', 'uid', 'uploaded_by']);
  assert.equal(res.body.title, 'Bylaws as adopted');
  assert.deepEqual(res.body.uploaded_by, { name: 'Ada Made-up' });
  assert.equal(res.body.has_file, true);
});

test('uploads: a failed put writes no row; an unbound bucket is 503; the bytes decide the type; over 10 MB is 413; the kind and the file are checked', async () => {
  const db = fixture();
  const failedPut = await call(envOf(db, r2({ failPut: true })), ADA, 'POST', LIST, upload(PDF, 'bylaws'));
  assert.equal(failedPut.status, 502);
  assert.equal(failedPut.body.error, 'storage_failed');
  assert.doesNotMatch(failedPut.text, /r2 down/, 'the storage error stays in the log');
  assert.equal(docCount(db), 0, 'no row without its bytes');

  const unbound = await call(envOf(db, null), ADA, 'POST', LIST, upload(PDF, 'bylaws'));
  assert.equal(unbound.status, 503);
  assert.equal(unbound.body.error, 'storage_unconfigured');

  const files = r2(); const env = envOf(db, files);
  const exe = await call(env, ADA, 'POST', LIST, upload(EXE, 'bylaws', { type: 'application/pdf', name: 'bylaws.pdf' }));
  assert.equal(exe.status, 400);
  assert.equal(exe.body.error, 'file_type_invalid', 'a renamed .exe declared as a PDF is refused by its bytes');
  const declared = await call(env, ADA, 'POST', LIST, upload(PDF, 'bylaws', { type: 'text/html' }));
  assert.equal(declared.body.error, 'file_type_invalid', 'a declared type outside the three is refused');
  const big = new Uint8Array(10 * 1024 * 1024 + 1); big.set(PDF);
  const tooBig = await call(env, ADA, 'POST', LIST, upload(big, 'bylaws'));
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.error, 'file_too_large');
  assert.equal((await call(env, ADA, 'POST', LIST, upload(new Uint8Array(0), 'bylaws'))).body.error, 'file_empty');
  assert.equal((await call(env, ADA, 'POST', LIST, upload(PDF, 'deed'))).body.error, 'kind_invalid');
  const none = new FormData(); none.append('kind', 'bylaws');
  assert.equal((await call(env, ADA, 'POST', LIST, none)).body.error, 'file_required');
  assert.equal(files.store.size, 0);
  assert.equal(docCount(db), 0);
  assert.equal((await call(env, ADA, 'POST', LIST, upload(PNG, 'other', { type: 'image/png', title: 'Office lease' }))).status, 201, 'a PNG is taken');
});

// ── Slots and other ─────────────────────────────────────────────────────────

test('slots: a second bylaws upload becomes the slot\'s document with earlier 1, both rows kept; other lists the rest', async () => {
  const db = fixture(); const env = envOf(db);
  const first = await call(env, ADA, 'POST', LIST, upload(PDF, 'bylaws', { title: 'Bylaws 2025' }));
  db.prepare("UPDATE documents SET created_at = '2026-01-01 00:00:00' WHERE uid = ?").run(first.body.uid);
  const second = await call(env, ADA, 'POST', LIST, upload(PDF, 'bylaws', { title: 'Bylaws 2026' }));
  await call(env, ADA, 'POST', LIST, upload(PDF, 'other', { title: 'Board minutes' }));
  const read = await call(env, CY, 'GET', LIST);
  const bylaws = read.body.slots.find((s: any) => s.kind === 'bylaws');
  assert.equal(bylaws.label, 'Bylaws');
  assert.equal(bylaws.document.uid, second.body.uid);
  assert.equal(bylaws.earlier, 1);
  assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM documents WHERE doc_type = 'bylaws'").get() as any).n), 2, 'nothing is deleted');
  assert.equal(read.body.other.available, true);
  assert.deepEqual(read.body.other.value.map((d: any) => d.title), ['Board minutes']);
});

// ── Ventures ────────────────────────────────────────────────────────────────

test('ventures: only what the caller may already read, grouped; a trashed venture is left out', async () => {
  const db = fixture(); seedVentures(db); const env = envOf(db);
  const cy = await call(env, CY, 'GET', LIST);
  assert.deepEqual(cy.body.ventures, { available: true, value: [] }, 'a member who founded no venture sees none of their documents');
  const ben = await call(env, BEN, 'GET', LIST);
  assert.deepEqual(ben.body.ventures.value.map((v: any) => [v.project.name, v.documents.map((d: any) => d.title)]), [['Kite', ['Kite SAFE']]]);
  const eve = await call(env, EVE, 'GET', LIST);
  assert.deepEqual(eve.body.ventures.value.map((v: any) => v.project.name), ['Kite', 'Owl'], 'the trashed venture is left out');
});

test('ventures: a failed read fails alone, and the slots still read', async () => {
  const db = fixture(); const env = envOf(db);
  await call(env, ADA, 'POST', LIST, upload(PDF, 'tax_id_letter'));
  const real = reads.readVentures;
  reads.readVentures = async () => { throw new Error('projects table locked'); };
  try {
    const res = await call(env, ADA, 'GET', LIST);
    assert.equal(res.status, 200);
    assert.equal(res.body.ventures.available, false);
    assert.match(res.body.ventures.reason, /could not be read/);
    assert.doesNotMatch(res.text, /locked/);
    assert.ok(res.body.slots.find((s: any) => s.kind === 'tax_id_letter').document, 'the slots still read');
    assert.equal(res.body.other.available, true);
  } finally { reads.readVentures = real; }
});

// ── Nothing stored leaves ───────────────────────────────────────────────────

test('nothing stored leaves the Worker, and a company document never appears in the legal list for a non-admin', async () => {
  const db = fixture(); seedVentures(db); const files = r2(); const env = envOf(db, files);
  await call(env, ADA, 'POST', LIST, upload(PDF, 'certificate_of_incorporation'));
  await call(env, ADA, 'POST', LIST, upload(PDF, 'other'));
  const [key] = [...files.store.keys()];
  for (const who of [ADA, BEN, CY, EVE]) {
    const res = await call(env, who, 'GET', LIST);
    for (const banned of ['content', 'r2_key', 'sha256', 'secret body', '@example.test', key]) assert.ok(!res.text.includes(banned), `${who} sees ${banned}`);
  }
  for (const who of [ADA, BEN, CY]) {
    const list = await call(env, who, 'GET', '/api/legal/documents');
    assert.equal(list.status, 200);
    assert.ok(!list.body.some((d: any) => d.company_id === NORTH || d.template_name === 'company_upload'), `${who} reads a company document through /legal`);
  }
});

// ── Downloads ───────────────────────────────────────────────────────────────

test('downloads: the bytes with their stored type, as an attachment; another company\'s document or a fileless row is 404', async () => {
  const db = fixture(); const env = envOf(db);
  const up = await call(env, ADA, 'POST', LIST, upload(PDF, 'bylaws', { title: 'Bylaws' }));
  const res = await call(env, CY, 'GET', `${LIST}/${up.body.uid}/file`);
  assert.equal(res.status, 200);
  assert.deepEqual([...res.bytes], [...PDF]);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') || '', /^attachment; filename="Bylaws\.pdf"$/);
  assert.equal((await call(env, DEE, 'GET', `/api/company/co-south/documents/${up.body.uid}/file`)).status, 404, 'a document of another company');
  db.prepare("INSERT INTO documents (uid, company_id, title, doc_type, status) VALUES ('nofile', ?, 'Paper only', 'other', 'draft')").run(NORTH);
  assert.equal((await call(env, CY, 'GET', `${LIST}/nofile/file`)).status, 404, 'a row with no stored file');
  assert.equal((await call(env, CY, 'GET', `${LIST}/missing/file`)).status, 404);
});

test('the mount: before companyRoutes in index.ts, and the gates come from one place', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const docs = index.indexOf("app.route('/api', companyDocuments)");
  assert.ok(docs > 0 && docs < index.indexOf("app.route('/api', companyRoutes)"));
  const company = readFileSync(new URL('../src/routes/company.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(company, /async function (viewerIsMember|canEdit)\(/, 'the gates are copied back into company.ts');
  assert.match(company, /from '\.\.\/services\/companyAccess'/);
});
