/**
 * D1248 (#3263) — Due diligence part 4, the Worker, on real SQLite with the
 * mounted `/api/dd` and `/api/data-room` routers:
 *   · migration 622's columns, tables and CHECKs;
 *   · the case read's documents block: request files, reminders and item
 *     evidence, scoped as the case is, failing alone;
 *   · request due dates, remind (once a day) and withdraw (it leaves the
 *     subject's pages and takes no answer);
 *   · the subject's answer with a data-room file of their own;
 *   · item evidence, a file or a link, by the item's section;
 *   · the document link: single use, logged, the caller's alone, two minutes —
 *     a section reviewer never opens another section's NDA.
 * Every name, address and file is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_documents_d1248.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys } from './_baseline.mjs';
import dd from '../src/routes/dd.ts';
import dataRoom from '../src/routes/data_room.ts';
import { dueDateOf, markRequestAnsweredByFile, tokenHash } from '../src/services/ddRequests.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const BASELINE = read('sql/schema_baseline.sql');
const MIG622 = read('sql/migrations/622_dd_documents_due_reminders.sql');
const SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1, OWNER = 2, REV_A = 3, REV_B = 4, FOUNDER = 5, OTHER = 6;
const ROLE: Record<number, string> = { [ADMIN]: 'admin', [OWNER]: 'partner', [REV_A]: 'partner', [REV_B]: 'investor', [FOUNDER]: 'founder', [OTHER]: 'founder' };
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function world() {
  const w = makeD1(BASELINE);
  // The baseline's other links (companies, studios) are not this test's; the
  // dd rules here are the routes', not the foreign keys'.
  w.db.exec('PRAGMA foreign_keys=OFF');
  w.db.exec(read('sql/migrations/339_dd_section_signoff.sql'));
  for (const f of ['442_raise_cycle_stores.sql', '463_raise_record_stores.sql', '596_data_room_file_source.sql']) {
    addColumnsFrom(w.db, stripForeignKeys(read(`sql/migrations/${f}`)), 'data_room_files');
  }
  // The data room's requests read joins its own access requests and round calls.
  for (const f of ['436_round_calls.sql']) { try { w.db.exec(read(`sql/migrations/${f}`)); } catch { /* already in the baseline */ } }
  try { w.db.exec(read('sql/migrations/595_data_room_access_requests.sql').split('INSERT OR IGNORE')[0]); } catch { /* already in the baseline */ }
  w.db.exec(MIG622);
  const u = w.db.prepare('INSERT INTO users (id, name, email, role, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(ADMIN, 'Ada Admin', 'ada@example.test', 'admin', null);
  u.run(OWNER, 'Olu Owner', 'olu@example.test', 'partner', null);
  u.run(REV_A, 'Rin Legal', 'rin@example.test', 'partner', null);
  u.run(REV_B, 'Bo Finance', 'bo@example.test', 'investor', null);
  u.run(FOUNDER, 'Fran Founder', 'fran@example.test', 'founder', 100);
  u.run(OTHER, 'Oz Other', 'oz@example.test', 'founder', 200);
  w.db.prepare("INSERT INTO founders (id, name, email) VALUES (100, 'Fran Founder', 'fran@example.test')").run();
  w.db.prepare("INSERT INTO founders (id, name, email) VALUES (200, 'Oz Other', 'oz@example.test')").run();
  w.db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p-room', 'Roomco', 100)").run();
  w.db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (9, 'p-other', 'Otherco', 200)").run();
  w.db.prepare("INSERT INTO dd_cases (id, uid, subject_type, subject_id, subject_label, owner_user_id) VALUES (40, 'case-dd', 'project', 7, 'Roomco', ?)").run(OWNER);
  w.db.prepare("INSERT INTO dd_sections (id, case_id, section_key, title) VALUES (11, 40, 'legal', 'Legal'), (12, 40, 'financial', 'Financial')").run();
  w.db.prepare('INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (40, 11, ?), (40, 12, ?)').run(REV_A, REV_B);
  w.db.prepare("INSERT INTO dd_checklist_items (id, case_id, section_id, item_key, title) VALUES (21, 40, 11, 'legal.cap_table', 'Cap table'), (22, 40, 12, 'financial.burn', 'Burn')").run();
  const a = w.db.prepare('INSERT INTO dd_attachments (id, case_id, section_id, file_key, filename, mime_type, uploaded_by_user_id) VALUES (?, 40, ?, ?, ?, ?, ?)');
  a.run(31, 11, 'dd-ndas/40/11/a', 'legal-nda.pdf', 'application/pdf', REV_A);
  a.run(32, 12, 'dd-ndas/40/12/b', 'finance-nda.pdf', 'application/pdf', REV_B);
  a.run(33, 11, 'inline:failed:x', 'lost.pdf', 'application/pdf', REV_A);
  const r = w.db.prepare("INSERT INTO dd_requests (id, case_id, title, state, created_at) VALUES (?, 40, ?, ?, ?)");
  r.run(60, 'Board minutes', 'requested', '2026-10-20 09:00:00');
  r.run(61, 'Burn and runway', 'received', '2026-10-21 09:00:00');
  r.run(62, 'Cap table', 'reviewed', '2026-10-22 09:00:00');
  r.run(63, 'Customer contracts', 'requested', '2026-10-23 09:00:00');
  const f = w.db.prepare("INSERT INTO data_room_files (id, uid, project_id, name, r2_key, content_type, visibility, dd_request_id) VALUES (?, ?, ?, ?, ?, 'application/pdf', 'open', ?)");
  f.run(81, 'f-burn', 7, 'Burn 2026.pdf', 'data-room/p-room/burn', 61);
  f.run(82, 'f-deck', 7, 'Contracts.pdf', 'data-room/p-room/contracts', null);
  f.run(83, 'f-theirs', 9, 'Theirs.pdf', 'data-room/p-other/theirs', null);
  const store = new Map<string, Uint8Array>([
    ['dd-ndas/40/11/a', new TextEncoder().encode('LEGAL-NDA-BYTES')],
    ['dd-ndas/40/12/b', new TextEncoder().encode('FINANCE-NDA-BYTES')],
    ['data-room/p-room/burn', new TextEncoder().encode('BURN-BYTES')],
  ]);
  const FILES = {
    put: async (key: string, value: ArrayBuffer) => { store.set(key, new Uint8Array(value)); },
    get: async (key: string) => (store.has(key) ? { body: new Blob([store.get(key)!]).stream() } : null),
    delete: async (key: string) => { store.delete(key); },
  };
  return { ...w, store, env: { DB: w.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development', FILES } as any };
}

const app = new Hono();
app.route('/api/dd', dd as any);
app.route('/api/data-room', dataRoom as any);
app.onError((e, c) => c.json({ error: String((e as Error).message) }, String((e as Error).message).startsWith('Forbidden') ? 403 : 500));

async function call(w: any, userId: number, method: string, path: string, body?: unknown, raw = false) {
  const tok = await new SignJWT({ user_id: userId, role: ROLE[userId] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const isForm = body instanceof FormData;
  const res = await app.fetch(new Request(`https://example.test/api${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(isForm ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  }), w.env);
  if (raw) return { status: res.status, text: await res.text(), headers: res.headers };
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}
const one = (w: any, sql: string, ...args: any[]) => w.db.prepare(sql).get(...args);
const all = (w: any, sql: string, ...args: any[]) => w.db.prepare(sql).all(...args).map((r: any) => ({ ...r }));
const actions = (w: any) => all(w, 'SELECT action FROM dd_audit_log ORDER BY id').map((r: any) => r.action);

test('migration 622: the request columns, the three tables and their CHECKs', () => {
  const w = world();
  const cols = all(w, 'PRAGMA table_info(dd_requests)').map((c: any) => c.name);
  for (const c of ['due_date', 'withdrawn_at', 'withdrawn_by_user_id']) assert.ok(cols.includes(c), c);
  assert.throws(() => w.db.prepare("UPDATE dd_requests SET due_date = 'next week' WHERE id = 60").run(), /CHECK/);
  assert.throws(() => w.db.prepare("INSERT INTO dd_item_evidence (uid, case_id, item_id, kind) VALUES ('e1', 40, 21, 'file')").run(), /CHECK/);
  assert.throws(() => w.db.prepare("INSERT INTO dd_item_evidence (uid, case_id, item_id, kind, url, attachment_id) VALUES ('e2', 40, 21, 'link', 'https://x.test', 31)").run(), /CHECK/);
  assert.throws(() => w.db.prepare("INSERT INTO dd_downloads (uid, token_hash, case_id, user_id, kind, target_id, expires_at) VALUES ('d1', 'h', 40, 1, 'report', 1, 'x')").run(), /CHECK/);
});

test('the case read carries request files, reminders and evidence; a reviewer sees none of the requests and only their section\'s evidence; a failed block is its own', async () => {
  const w = world();
  w.db.prepare("INSERT INTO dd_item_evidence (uid, case_id, item_id, kind, url, label, added_by_user_id) VALUES ('ea', 40, 21, 'link', 'https://a.example.test', 'Register', ?), ('eb', 40, 22, 'link', 'https://b.example.test', 'Ledger', ?)").run(REV_A, REV_B);
  w.db.prepare("INSERT INTO dd_request_reminders (uid, case_id, request_id, sent_by_user_id, created_at) VALUES ('m1', 40, 60, ?, '2026-10-24 09:00:00')").run(OWNER);
  const owner = await call(w, OWNER, 'GET', '/dd/cases/case-dd');
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  const by = Object.fromEntries(owner.body.requests.map((r: any) => [r.id, r]));
  assert.deepEqual(by[61].files.map((f: any) => f.name), ['Burn 2026.pdf']);
  assert.deepEqual(by[60].reminders, { count: 1, last_at: '2026-10-24 09:00:00' });
  assert.deepEqual(by[63].reminders, { count: 0, last_at: null });
  assert.equal(by[60].due_date, null);
  assert.deepEqual(owner.body.evidence.map((e: any) => [e.uid, e.added_by_name]), [['ea', 'Rin Legal'], ['eb', 'Bo Finance']]);
  assert.equal(owner.body.documents_unreadable, false);
  const rev = await call(w, REV_A, 'GET', '/dd/cases/case-dd');
  assert.equal(rev.status, 200);
  assert.deepEqual(rev.body.requests, [], 'a section reviewer saw the requests');
  assert.deepEqual(rev.body.evidence.map((e: any) => e.uid), ['ea'], 'a reviewer saw another section\'s evidence');
  w.db.exec('DROP TABLE dd_item_evidence');
  const down = await call(w, OWNER, 'GET', '/dd/cases/case-dd');
  assert.equal(down.status, 200, 'the case still answers');
  assert.equal(down.body.documents_unreadable, true);
  assert.equal(down.body.evidence, null);
  assert.equal(down.body.requests.length, 4);
  assert.equal(down.body.requests[0].files, null, 'an unread block drew no files as none');
});

test('a request\'s due date is a real day, today or later; it can change or clear; a withdrawn request takes no change', async () => {
  assert.equal(dueDateOf('2026-02-30'), null);
  assert.equal(dueDateOf('2020-01-01'), null);
  assert.equal(dueDateOf(tomorrow()), tomorrow());
  const w = world();
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests', { title: 'Payroll', due_date: '2026-02-30' })).status, 400);
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests', { title: 'Payroll', due_date: '2020-01-01' })).status, 400);
  const made = await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests', { title: 'Payroll', due_date: tomorrow() });
  assert.equal(made.status, 201);
  assert.equal(made.body.request.due_date, tomorrow());
  const id = made.body.request.id;
  const changed = await call(w, OWNER, 'PATCH', `/dd/cases/case-dd/requests/${id}`, { due_date: null });
  assert.deepEqual([changed.status, changed.body.due_date, changed.body.state], [200, null, 'requested'], 'a due-date change marked it reviewed');
  assert.ok(actions(w).includes('request_due_date_changed'));
  assert.equal((await call(w, REV_A, 'PATCH', `/dd/cases/case-dd/requests/${id}`, { due_date: tomorrow() })).status, 403);
  await call(w, OWNER, 'POST', `/dd/cases/case-dd/requests/${id}/withdraw`, {});
  assert.equal((await call(w, OWNER, 'PATCH', `/dd/cases/case-dd/requests/${id}`, { due_date: tomorrow() })).body.code, 'withdrawn');
});

test('remind: the owner or an admin, once a day, only while the request waits; each reminder logged', async () => {
  const w = world();
  const sent = await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/60/remind');
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM dd_request_reminders WHERE request_id = 60').n, 1);
  assert.ok(actions(w).includes('request_reminded'));
  const again = await call(w, ADMIN, 'POST', '/dd/cases/case-dd/requests/60/remind');
  assert.deepEqual([again.status, again.body.code], [429, 'reminded_recently']);
  w.db.prepare("UPDATE dd_request_reminders SET created_at = '2026-01-01 09:00:00'").run();
  assert.equal((await call(w, ADMIN, 'POST', '/dd/cases/case-dd/requests/60/remind')).status, 200, 'a day later a reminder goes');
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/61/remind')).body.code, 'answered');
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/requests/63/remind')).status, 403, 'a section reviewer reminded the subject');
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/999/remind')).status, 404);
});

test('withdraw: it leaves the subject\'s pages, takes no answer and no reminder; a reviewed request stays', async () => {
  const w = world();
  const before = await call(w, FOUNDER, 'GET', '/dd/requests/mine');
  assert.ok(before.body.items.some((r: any) => r.id === 60));
  const out = await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/60/withdraw', { reason: 'Covered by the minutes book' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(one(w, 'SELECT withdrawn_by_user_id AS by FROM dd_requests WHERE id = 60').by, OWNER);
  const mine = await call(w, FOUNDER, 'GET', '/dd/requests/mine');
  assert.deepEqual(mine.body.items.map((r: any) => r.id).sort(), [61, 62, 63], 'a withdrawn request is still on the subject\'s page');
  const room = await call(w, FOUNDER, 'GET', '/data-room/p-room/requests');
  assert.equal(room.status, 200, JSON.stringify(room.body));
  assert.ok(!room.body.diligence.some((d: any) => d.id === 60), 'a withdrawn request is still in the data room');
  assert.equal((await call(w, FOUNDER, 'PATCH', '/dd/requests/60/respond', { response_note: 'Here' })).body.code, 'withdrawn');
  assert.equal((await call(w, FOUNDER, 'PATCH', '/data-room/p-room/files/f-deck', { dd_request_id: 60 })).status, 404, 'a file answered a withdrawn request');
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/60/remind')).body.code, 'withdrawn');
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/60/withdraw')).body.code, 'withdrawn');
  assert.equal((await call(w, OWNER, 'POST', '/dd/cases/case-dd/requests/62/withdraw')).body.code, 'reviewed');
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/requests/63/withdraw')).status, 403);
  assert.doesNotMatch(JSON.stringify(all(w, 'SELECT * FROM dd_requests WHERE id = 60')), /minutes book/, 'the reason was written on the request');
});

test('the subject answers with a data-room file of their own venture, by the requests page or by the data room', async () => {
  const w = world();
  const theirs = await call(w, FOUNDER, 'PATCH', '/dd/requests/63/respond', { file_uid: 'f-theirs' });
  assert.equal(theirs.status, 404, 'another venture\'s file answered');
  const ok = await call(w, FOUNDER, 'PATCH', '/dd/requests/63/respond', { file_uid: 'f-deck' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(one(w, 'SELECT dd_request_id AS r FROM data_room_files WHERE uid = ?', 'f-deck').r, 63);
  assert.equal(one(w, 'SELECT state FROM dd_requests WHERE id = 63').state, 'received');
  assert.equal((await call(w, OTHER, 'PATCH', '/dd/requests/60/respond', { file_uid: 'f-theirs' })).status, 403, 'someone else answered');
  // By the data room: matching a file to a waiting request answers it.
  const tag = await call(w, FOUNDER, 'PATCH', '/data-room/p-room/files/f-burn', { dd_request_id: 60 });
  assert.equal(tag.status, 200, JSON.stringify(tag.body));
  assert.equal(one(w, 'SELECT state FROM dd_requests WHERE id = 60').state, 'received');
  assert.ok(actions(w).includes('request_answered_by_file'));
  assert.equal(await markRequestAnsweredByFile(w.env, 62, FOUNDER), false, 'a reviewed request moved');
  assert.equal(one(w, 'SELECT state FROM dd_requests WHERE id = 62').state, 'reviewed');
});

test('D1252 (DDL15): the subject\'s requests name their own venture\'s room and the files matched to each, and nothing of the case', async () => {
  const w = world();
  const before = await call(w, FOUNDER, 'GET', '/dd/requests/mine');
  const r61 = before.body.items.find((r: any) => r.id === 61);
  assert.equal(r61.project_uid, 'p-room', 'the venture the file picker reads');
  assert.deepEqual(r61.file_names, ['Burn 2026.pdf'], 'the file already matched to it');
  assert.deepEqual(before.body.items.find((r: any) => r.id === 63).file_names, [], 'no file is none, never null');
  assert.equal((await call(w, FOUNDER, 'PATCH', '/dd/requests/63/respond', { file_uid: 'f-deck' })).status, 200);
  const after = await call(w, FOUNDER, 'GET', '/dd/requests/mine');
  assert.deepEqual(after.body.items.find((r: any) => r.id === 63).file_names, ['Contracts.pdf']);
  for (const r of after.body.items) {
    for (const k of ['case_uid', 'uid', 'risk_band', 'risk_score', 'case_id', 'subject_id']) assert.ok(!(k in r), `the subject saw ${k}`);
  }
  assert.ok(!JSON.stringify(after.body).includes('case-dd'), 'the case\'s uid reached the subject');
  const other = await call(w, OTHER, 'GET', '/dd/requests/mine');
  assert.ok(!JSON.stringify(other.body).includes('p-room'), 'another account saw this venture');
});

test('item evidence: a link or a file, by a writer of the item\'s section; another section is refused', async () => {
  const w = world();
  const link = await call(w, REV_A, 'POST', '/dd/cases/case-dd/items/21/evidence', { url: 'https://register.example.test/x', label: 'Register' });
  assert.equal(link.status, 201, JSON.stringify(link.body));
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/items/22/evidence', { url: 'https://x.example.test' })).status, 403);
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/items/21/evidence', { url: 'javascript:alert(1)' })).status, 400);
  const fd = new FormData();
  fd.append('file', new File([new TextEncoder().encode('EVIDENCE')], 'register.pdf', { type: 'application/pdf' }));
  const file = await call(w, REV_A, 'POST', '/dd/cases/case-dd/items/21/evidence', fd);
  assert.equal(file.status, 201, JSON.stringify(file.body));
  const att = one(w, 'SELECT section_id, file_key FROM dd_attachments WHERE id = ?', file.body.evidence.attachment_id);
  assert.equal(att.section_id, 11, 'the file was not filed on the item\'s section');
  assert.ok(w.store.has(att.file_key));
  assert.equal((await call(w, REV_B, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'attachment', id: file.body.evidence.attachment_id })).status, 404,
    'another section\'s reviewer opened the evidence');
  assert.deepEqual(actions(w).filter((a: string) => a === 'item_evidence_added').length, 2);
});

test('a document link: the caller\'s own, once, for two minutes, logged; a reviewer never opens another section\'s NDA', async () => {
  const w = world();
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'attachment', id: 32 })).status, 404, 'a reviewer reached another section\'s NDA');
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'request_file', id: 81 })).status, 403);
  assert.equal((await call(w, REV_A, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'attachment', id: 33 })).body.code, 'not_stored');
  assert.equal((await call(w, FOUNDER, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'attachment', id: 31 })).status, 403, 'a founder opened a DD document');
  const issued = await call(w, REV_A, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'attachment', id: 31 });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const token = issued.body.url.split('/').pop();
  assert.ok(Date.parse(issued.body.expires_at) - Date.now() <= 120_000 + 1000, 'the link lives longer than two minutes');
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM dd_downloads WHERE token_hash = ?', token).n, 0, 'the token itself was stored');
  assert.equal(one(w, 'SELECT COUNT(*) AS n FROM dd_downloads WHERE token_hash = ?', await tokenHash(token)).n, 1);
  assert.equal((await call(w, REV_B, 'GET', `/dd/documents/dl/${token}`, undefined, true)).status, 403, 'another user opened the link');
  const got = await call(w, REV_A, 'GET', `/dd/documents/dl/${token}`, undefined, true);
  assert.equal(got.status, 200);
  assert.equal(got.text, 'LEGAL-NDA-BYTES');
  assert.match(String(got.headers.get('content-disposition')), /attachment; filename="legal-nda\.pdf"/);
  assert.equal(got.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call(w, REV_A, 'GET', `/dd/documents/dl/${token}`, undefined, true)).status, 403, 'the link opened twice');
  const late = await call(w, OWNER, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'request_file', id: 81 });
  const lateToken = late.body.url.split('/').pop();
  w.db.prepare("UPDATE dd_downloads SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token_hash = ?").run(await tokenHash(lateToken));
  assert.equal((await call(w, OWNER, 'GET', `/dd/documents/dl/${lateToken}`, undefined, true)).status, 403, 'an expired link opened');
  const file = await call(w, OWNER, 'POST', '/dd/cases/case-dd/documents/download', { kind: 'request_file', id: 81 });
  assert.equal((await call(w, OWNER, 'GET', `/dd/documents/dl/${file.body.url.split('/').pop()}`, undefined, true)).text, 'BURN-BYTES');
  const log = actions(w);
  assert.equal(log.filter((a: string) => a === 'document_link_issued').length, 3);
  assert.equal(log.filter((a: string) => a === 'document_downloaded').length, 2);
  assert.doesNotMatch(JSON.stringify(all(w, 'SELECT * FROM dd_audit_log')), new RegExp(token), 'a token was logged');
});
