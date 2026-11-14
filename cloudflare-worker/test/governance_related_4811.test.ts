/**
 * D4811 (#4811) part 8 — related documents of a governance record (board
 * CT-11, migration 202611091201): links to the records and templates it
 * governs; a move to Approved or Executed at a newer version flags each
 * dependant "may require review" and changes nothing in it; a person marks
 * each reviewed, against that version, with an optional note; "Dismiss for
 * me" hides the banner for that admin only. A confidential dependant is
 * Restricted for anyone but the Super Admin. Real migrated schema, in memory;
 * every person and file is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_related_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { bannerOf, flagOf, noteOf, triggerVersion } from '../src/services/governanceRelations.ts';
import { eventOf } from '../src/services/governanceActivity.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-related-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, OTHER = 3;
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');

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
  db.prepare(`INSERT INTO legal_templates(slug,title,category,body_md,merge_fields,version,is_active,is_stub)
    VALUES('made_up_retired_4811','Made-up Retired Notice','fund','Body','[]',1,0,0)`).run();
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
async function approve(f: F, uid: string) {
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${uid}/versions`, undefined, upload())).status, 201);
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${uid}`, { status: 'review' })).status, 200);
  const r = await call(f, ADMIN, 'PATCH', `/documents/${uid}`, { status: 'approved' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

test('the rules: which moves raise a flag, at which version; flag states; the banner; the note', () => {
  assert.equal(triggerVersion('approved', null, 3), 3);
  assert.equal(triggerVersion('approved', null, null), 0, 'an approved record with no file raises at 0, never at a guessed number');
  assert.equal(triggerVersion('executed', 2, 3), 2, 'executed raises at the signed version it names');
  assert.equal(triggerVersion('executed', null, 3), 3);
  for (const s of ['draft', 'review', 'archived']) assert.equal(triggerVersion(s, 1, 1), null, `${s} raises nothing`);
  assert.equal(flagOf({ flag_version: null, reviewed_version: null }), 'not_affected');
  assert.equal(flagOf({ flag_version: 2, reviewed_version: null }), 'review_suggested');
  assert.equal(flagOf({ flag_version: 2, reviewed_version: 1 }), 'review_suggested');
  assert.equal(flagOf({ flag_version: 2, reviewed_version: 2 }), 'reviewed');
  assert.equal(flagOf({ flag_version: 0, reviewed_version: null }), 'review_suggested', 'version 0 is a version, not "none"');
  const rows = [{ flag_version: 2, reviewed_version: null }, { flag_version: 3, reviewed_version: 1 }, { flag_version: 3, reviewed_version: 3 }, { flag_version: null, reviewed_version: null }];
  assert.deepEqual(bannerOf(rows, null), { affected: 2, version: 3, dismissed: false });
  assert.deepEqual(bannerOf(rows, 2), { affected: 2, version: 3, dismissed: false }, 'a dismissal of an older version does not hide a newer one');
  assert.deepEqual(bannerOf(rows, 3), { affected: 2, version: 3, dismissed: true });
  assert.deepEqual(bannerOf([], 5), { affected: 0, version: null, dismissed: false });
  assert.equal(noteOf(undefined), null); assert.equal(noteOf('  '), null); assert.equal(noteOf(' checked §9.2 '), 'checked §9.2');
  assert.equal(noteOf(5), false); assert.equal(noteOf('x'.repeat(501)), false); assert.equal(noteOf('x'.repeat(500)), 'x'.repeat(500));
  assert.equal(eventOf({ action: 'governance_relation_reviewed', details: JSON.stringify({ version: 2 }), created_at: null })!.line, 'Marked a related document reviewed against v2');
  assert.equal(eventOf({ action: 'governance_relation_added', details: JSON.stringify({ kind: 'template' }), created_at: null })!.line, 'Linked a template it governs');
});

test('linking: records and templates; refused for itself, a duplicate, an unknown or retired target', async () => {
  const f = fixture();
  const lpa = await made(f, ADMIN, { title: 'GP operating agreement', confidential: false });
  const dep = await made(f, ADMIN, { category: 'resolution', title: 'GP resolution', confidential: false });
  let r = await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'governance', ref: dep });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.relation.title, r.body.relation.state, r.body.relation.kind], ['GP resolution', 'not_affected', 'governance']);
  r = await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' });
  assert.equal(r.status, 201); assert.equal(r.body.relation.title, 'Made-up Notice');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' })).body.error, 'relation_exists');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'governance', ref: lpa })).body.error, 'relation_self');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_retired_4811' })).body.error, 'relation_target_not_found');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'governance', ref: '00000000-0000-0000-0000-000000000000' })).body.error, 'relation_target_not_found');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'contract', ref: 'x' })).status, 400);
  // D4811 part 19: an agreement is a kind now; one that is not on the desk is refused by name.
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'agreement', ref: 'x' })).status, 422);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: '  ' })).status, 400);
  const g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  assert.equal(g.body.dependants.length, 2);
  assert.deepEqual(g.body.banner, { affected: 0, version: null, dismissed: false }, 'linking alone flags nothing');
  const up = await call(f, ADMIN, 'GET', `/documents/${dep}/related`);
  assert.deepEqual(up.body.governed_by.map((x: any) => x.title), ['GP operating agreement'], 'the dependant names what governs it');
  const n = f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'governance_relation_added'").get() as any;
  assert.equal(n.n, 2, 'each link is audited');
});

test('a change flags each dependant, changes nothing in it, and a person marks each reviewed against that version', async () => {
  const f = fixture();
  const lpa = await made(f, ADMIN, { confidential: false });
  const dep = await made(f, ADMIN, { category: 'resolution', title: 'GP resolution', confidential: false });
  await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'governance', ref: dep });
  await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' });
  const before = JSON.stringify([f.db.prepare('SELECT * FROM governance_documents WHERE uid = ?').get(dep), f.db.prepare("SELECT * FROM legal_templates WHERE slug = 'made_up_notice_4811'").get()]);
  assert.deepEqual((await call(f, ADMIN, 'GET', `/documents/${lpa}/related`)).body.banner.affected, 0, 'a draft and a review raise nothing');
  await approve(f, lpa);
  let g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  assert.deepEqual(g.body.banner, { affected: 2, version: 1, dismissed: false });
  assert.deepEqual(g.body.dependants.map((d: any) => d.state), ['review_suggested', 'review_suggested']);
  const after = JSON.stringify([f.db.prepare('SELECT * FROM governance_documents WHERE uid = ?').get(dep), f.db.prepare("SELECT * FROM legal_templates WHERE slug = 'made_up_notice_4811'").get()]);
  assert.equal(after, before, 'nothing in a dependant is rewritten');
  const id = g.body.dependants[0].id;
  const m = await call(f, OTHER, 'POST', `/documents/${lpa}/related/${id}/reviewed`, { note: 'Checked against the new §9.2' });
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.deepEqual([m.body.relation.state, m.body.relation.reviewed_version, m.body.relation.reviewed_by, m.body.relation.review_note], ['reviewed', 1, 'Kim Made-up', 'Checked against the new §9.2']);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related/${id}/reviewed`, {})).body.error, 'relation_not_flagged', 'reviewed once per version');
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related/${g.body.dependants[1].id}/reviewed`, { note: 7 })).status, 400);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${dep}/related/${id}/reviewed`, {})).status, 404, 'a relation is reached through its governing record only');
  g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  assert.equal(g.body.banner.affected, 1);
  const audit = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_relation_reviewed'").get() as any;
  assert.equal(JSON.parse(audit.details).version, 1);
  assert.ok(!audit.details.includes('§9.2'), 'the audit row carries no note text');
  // Back to review and approved again at the same version: nothing new to review.
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'review' })).status, 200);
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'approved' })).status, 200);
  assert.equal((await call(f, ADMIN, 'GET', `/documents/${lpa}/related`)).body.dependants[0].state, 'reviewed', 'the same version raises no new flag');
  // A newer version approved flags the reviewed dependant again.
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'review' })).status, 200);
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/versions`, undefined, upload())).status, 201);
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'approved' })).status, 200);
  g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  assert.deepEqual(g.body.dependants.map((d: any) => [d.state, d.flag_version]), [['review_suggested', 2], ['review_suggested', 2]]);
  assert.deepEqual(g.body.banner, { affected: 2, version: 2, dismissed: false });
});

test('a link made while the record is approved starts as checked against that version', async () => {
  const f = fixture();
  const lpa = await made(f, ADMIN, { confidential: false });
  await approve(f, lpa);
  await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' });
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'review' })).status, 200);
  assert.equal((await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'approved' })).status, 200);
  const g = await call(f, ADMIN, 'GET', `/documents/${lpa}/related`);
  assert.equal(g.body.banner.affected, 0);
  assert.deepEqual([g.body.dependants[0].state, g.body.dependants[0].flag_version, g.body.dependants[0].reviewed_by], ['not_affected', null, null],
    'not affected, never "reviewed" by nobody');
});

test('Dismiss for me hides the banner for that admin only, until a newer version', async () => {
  const f = fixture();
  const lpa = await made(f, ADMIN, { confidential: false });
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${lpa}/related/dismiss`)).body.error, 'nothing_to_dismiss');
  await call(f, ADMIN, 'POST', `/documents/${lpa}/related`, { kind: 'template', ref: 'made_up_notice_4811' });
  await approve(f, lpa);
  const d = await call(f, ADMIN, 'POST', `/documents/${lpa}/related/dismiss`);
  assert.equal(d.status, 200); assert.equal(d.body.banner.dismissed, true);
  assert.deepEqual((await call(f, ADMIN, 'GET', `/documents/${lpa}/related`)).body.banner, { affected: 1, version: 1, dismissed: true });
  assert.deepEqual((await call(f, OTHER, 'GET', `/documents/${lpa}/related`)).body.banner, { affected: 1, version: 1, dismissed: false }, 'another admin still sees it');
  assert.equal((await call(f, ADMIN, 'GET', `/documents/${lpa}/related`)).body.dependants[0].state, 'review_suggested', 'dismissing clears no flag');
  await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'review' });
  await call(f, ADMIN, 'POST', `/documents/${lpa}/versions`, undefined, upload());
  await call(f, ADMIN, 'PATCH', `/documents/${lpa}`, { status: 'approved' });
  assert.deepEqual((await call(f, ADMIN, 'GET', `/documents/${lpa}/related`)).body.banner, { affected: 1, version: 2, dismissed: false }, 'a newer version raises it again');
});

test('confidential: the record is 404 to all but the Super Admin; a confidential dependant is Restricted, and cannot be linked or marked by them', async () => {
  const f = fixture();
  const open = await made(f, SUPER, { title: 'Open record', confidential: false });
  const secret = await made(f, SUPER, { category: 'resolution', title: 'Secret resolution', confidential: true });
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${open}/related`, { kind: 'governance', ref: secret })).body.error, 'relation_target_not_found', 'an admin cannot link what they cannot open');
  assert.equal((await call(f, SUPER, 'POST', `/documents/${open}/related`, { kind: 'governance', ref: secret })).status, 201);
  await approve(f, open);
  const g = await call(f, ADMIN, 'GET', `/documents/${open}/related`);
  const row = g.body.dependants[0];
  assert.deepEqual([row.restricted, row.title, row.ref, row.state], [true, null, null, 'review_suggested']);
  assert.ok(!JSON.stringify(g.body).includes('Secret resolution'));
  assert.equal((await call(f, ADMIN, 'POST', `/documents/${open}/related/${row.id}/reviewed`, {})).status, 404, 'an admin cannot say they checked what they cannot open');
  assert.equal((await call(f, SUPER, 'POST', `/documents/${open}/related/${row.id}/reviewed`, { note: 'Made-up private note' })).status, 200);
  const after = await call(f, ADMIN, 'GET', `/documents/${open}/related`);
  assert.deepEqual([after.body.dependants[0].state, after.body.dependants[0].review_note], ['reviewed', null], 'a restricted row carries no note');
  assert.ok(!JSON.stringify(after.body).includes('Made-up private note'));
  assert.equal((await call(f, ADMIN, 'GET', `/documents/${secret}/related`)).status, 404);
  const s = await call(f, SUPER, 'GET', `/documents/${secret}/related`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.governed_by.map((x: any) => x.title), ['Open record']);
  const views = f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'governance_document_viewed'").get() as any;
  assert.ok(views.n >= 1, 'reading a confidential record\'s links is logged as a view');
});
