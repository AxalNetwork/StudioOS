/**
 * D4811 (#4811) part 21 — unlinking a related document (board CT-11; part 8
 * left "there is no unlink yet"). `POST /documents/:uid/related/:id/unlink
 * { reason }` removes one link and nothing else: neither document is
 * rewritten, the audit rows of the link's history stay, and the per-admin
 * banner dismissals stay. A reason of 10 to 500 characters is required and
 * kept in the audit row. A confidential dependant is unlinked by the Super
 * Admin alone; anyone else gets the answer a missing link gets. Real migrated
 * schema, in memory; every person and file is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_unlink_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { unlinkReasonOf } from '../src/services/governanceRelations.ts';
import { GOVERNANCE_ACTIONS, eventOf } from '../src/services/governanceActivity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-unlink-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, OTHER = 3;
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
const REASON = 'Linked to the wrong resolution by mistake';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sam Made-up', 'sam@example.test');
  u.run(ADMIN, 'admin', 'Alex Made-up', 'alex@example.test');
  u.run(OTHER, 'admin', 'Kim Made-up', 'kim@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare(`INSERT INTO legal_templates(slug,title,category,body_md,merge_fields,version,is_active,is_stub)
    VALUES('made_up_notice_4811','Made-up Notice','fund','Body','[]',1,1,0)`).run();
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
const upload = () => { const fd = new FormData(); fd.append('file', new File([PDF_BYTES], 'up.pdf')); return fd; };
async function made(f: F, who: number, body: Record<string, unknown>) {
  const r = await call(f, who, 'POST', '/documents', { entity_key: 'gp', category: 'operating_agreement', title: 'Made-up record', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.document.uid as string;
}
async function approve(f: F, who: number, uid: string) {
  assert.equal((await call(f, who, 'POST', `/documents/${uid}/versions`, undefined, upload())).status, 201);
  assert.equal((await call(f, who, 'PATCH', `/documents/${uid}`, { status: 'review' })).status, 200);
  assert.equal((await call(f, who, 'PATCH', `/documents/${uid}`, { status: 'approved' })).status, 200);
}
const unlink = (f: F, who: number, uid: string, id: number, body: unknown = { reason: REASON }) =>
  call(f, who, 'POST', `/documents/${uid}/related/${id}/unlink`, body);
const count = (f: F, sql: string, ...args: unknown[]) => Number((f.db.prepare(sql).get(...(args as any[])) as any).n);

test('the rules: the reason is 10 to 500 characters of text; the Activity tab names an unlink', () => {
  assert.equal(unlinkReasonOf(undefined), null);
  assert.equal(unlinkReasonOf(42), null);
  assert.equal(unlinkReasonOf('too short'), null, '9 characters is too short');
  assert.equal(unlinkReasonOf('ten chars!'), 'ten chars!');
  assert.equal(unlinkReasonOf('  wrong   link  made  '), 'wrong link made', 'whitespace is folded');
  assert.equal(unlinkReasonOf('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(unlinkReasonOf('x'.repeat(501)), null);
  assert.ok((GOVERNANCE_ACTIONS as readonly string[]).includes('governance_relation_unlinked'), 'the Activity tab reads unlinks');
  assert.equal(eventOf({ action: 'governance_relation_unlinked', details: JSON.stringify({ kind: 'template', reason: REASON }), created_at: null })!.line, 'Unlinked a template it governed');
  assert.equal(eventOf({ action: 'governance_relation_unlinked', details: JSON.stringify({ kind: 'agreement' }), created_at: null })!.line, 'Unlinked an agreement it governed');
  assert.equal(eventOf({ action: 'governance_relation_unlinked', details: JSON.stringify({ kind: 'governance' }), created_at: null })!.line, 'Unlinked a record it governed');
});

test('unlink removes the reference only: both documents unchanged, audited with both ends and the version, history kept', async () => {
  const f = fixture();
  const lpa = await made(f, ADMIN, { title: 'GP operating agreement', confidential: false });
  const dep = await made(f, ADMIN, { category: 'resolution', title: 'GP resolution', confidential: false });
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'governance', ref: dep })).status, 201);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' })).status, 201);
  await approve(f, ADMIN, lpa);
  let g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  const [toDep, toTpl] = g.body.dependants;
  assert.equal((await call(f, OTHER, 'POST', `/documents/${lpa}/related/${toDep.id}/reviewed`, { note: 'Made-up review note' })).status, 200);
  const before = JSON.stringify([
    f.db.prepare('SELECT * FROM governance_documents WHERE uid = ?').get(lpa), f.db.prepare('SELECT * FROM governance_documents WHERE uid = ?').get(dep),
    f.db.prepare('SELECT * FROM governance_document_versions ORDER BY id').all(), f.db.prepare("SELECT * FROM legal_templates WHERE slug = 'made_up_notice_4811'").get()]);

  // Refusals change nothing.
  assert.equal((await unlink(f, ADMIN, lpa, toDep.id, {})).body.error, 'reason_required');
  assert.equal((await unlink(f, ADMIN, lpa, toDep.id, { reason: 'short' })).status, 422);
  assert.equal((await unlink(f, ADMIN, lpa, toDep.id, { reason: 'x'.repeat(501) })).status, 422);
  assert.equal((await unlink(f, ADMIN, dep, toDep.id)).status, 404, 'a link is reached through its governing record only');
  assert.equal((await unlink(f, ADMIN, lpa, 999)).body.error, 'relation_not_found');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM governance_relations WHERE governing_uid = ?', lpa), 2, 'a refusal removes nothing');

  const r = await unlink(f, ADMIN, lpa, toDep.id, { reason: `  ${REASON}  ` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.unlinked, { id: toDep.id, kind: 'governance' });
  assert.deepEqual(r.body.banner, { affected: 1, version: 1, dismissed: false }, 'the banner counts what is still linked and flagged');
  const after = JSON.stringify([
    f.db.prepare('SELECT * FROM governance_documents WHERE uid = ?').get(lpa), f.db.prepare('SELECT * FROM governance_documents WHERE uid = ?').get(dep),
    f.db.prepare('SELECT * FROM governance_document_versions ORDER BY id').all(), f.db.prepare("SELECT * FROM legal_templates WHERE slug = 'made_up_notice_4811'").get()]);
  assert.equal(after, before, 'neither document, nor any version, is rewritten');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM governance_relations WHERE id = ?', toDep.id), 0, 'the link row is gone');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM governance_relations WHERE id = ?', toTpl.id), 1, 'only that link');

  const audit = JSON.parse((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_relation_unlinked'").get() as any).details);
  assert.deepEqual([audit.uid, audit.kind, audit.ref, audit.relation, audit.version, audit.flag_version, audit.reviewed_version, audit.reason],
    [lpa, 'governance', dep, toDep.id, 1, 1, 1, REASON], 'both ends, the version and the reason are recorded');
  assert.ok(!JSON.stringify(audit).includes('Made-up review note'), 'no note text in the audit row');
  assert.ok(!JSON.stringify(audit).includes('GP resolution'), 'no title in the audit row');
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('governance_relation_added','governance_relation_reviewed')"), 3, 'the link and review history stays');
  const act = await call(f, ADMIN, 'GET', `/documents/${lpa}/activity`);
  assert.deepEqual(act.body.events.filter((e: any) => /^(Linked|Marked|Unlinked)/.test(e.line)).map((e: any) => e.line),
    ['Unlinked a record it governed', 'Marked a related document reviewed against v1', 'Linked a template it governs', 'Linked a record it governs']);

  g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  assert.deepEqual(g.body.dependants.map((d: any) => d.id), [toTpl.id]);
  assert.deepEqual((await call(f, ADMIN, 'GET', `/documents/${dep}/related`)).body.governed_by, [], 'the other side no longer names it');
  assert.equal((await unlink(f, ADMIN, lpa, toDep.id)).status, 404, 'unlinked once');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'governance', ref: dep })).status, 201, 'it can be linked again');
});

test('the banner: unlinking the last flagged link ends it; a dismissal is per record and stays', async () => {
  const f = fixture();
  const lpa = await made(f, ADMIN, { confidential: false });
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' })).status, 201);
  await approve(f, ADMIN, lpa);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related/dismiss`)).status, 200);
  const id = (await call(f, ADMIN, 'GET', `/documents/${lpa}/related`)).body.dependants[0].id;
  const r = await unlink(f, OTHER, lpa, id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.banner, { affected: 0, version: null, dismissed: false }, 'nothing flagged: no banner');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM governance_relation_dismissals WHERE governing_uid = ?', lpa), 1, 'the dismissal row stays');
});

test('confidential: only the Super Admin unlinks a confidential dependant; a confidential record is 404 to the rest', async () => {
  const f = fixture();
  const open = await made(f, SUPER, { title: 'Open record', confidential: false });
  const secret = await made(f, SUPER, { category: 'resolution', title: 'Secret resolution', confidential: true });
  const secretGov = await made(f, SUPER, { title: 'Secret agreement', confidential: true });
  assert.equal((await call(f, SUPER, 'POST', `/documents/${open}/related`, { kind: 'governance', ref: secret })).status, 201);
  assert.equal((await call(f, SUPER, 'POST', `/documents/${secretGov}/related`, { kind: 'template', ref: 'made_up_notice_4811' })).status, 201);
  const row = (await call(f, ADMIN, 'GET', `/documents/${open}/related`)).body.dependants[0];
  assert.equal(row.restricted, true);
  const refused = await unlink(f, ADMIN, open, row.id);
  const absent = await unlink(f, ADMIN, open, row.id + 1000);
  assert.deepEqual([refused.status, refused.body], [absent.status, absent.body], 'a restricted link answers exactly as a missing one');
  assert.equal((await unlink(f, ADMIN, open, row.id, {})).status, 404, 'even without a reason, nothing tells it apart');
  const hiddenId = (await call(f, SUPER, 'GET', `/documents/${secretGov}/related`)).body.dependants[0].id;
  assert.equal((await unlink(f, ADMIN, secretGov, hiddenId)).body.error, 'document_not_found', 'a confidential governing record is not found');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM governance_relations'), 2, 'nothing removed');
  assert.equal((await unlink(f, SUPER, open, row.id)).status, 200);
  assert.equal((await unlink(f, SUPER, secretGov, hiddenId)).status, 200);
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM governance_relations'), 0);
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'governance_relation_unlinked' AND user_id = ?", SUPER), 2);
});
