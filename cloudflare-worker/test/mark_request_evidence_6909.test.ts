/**
 * D6909 (#6909, Worker part): evidence on a mark request (a link or a file,
 * optional, owner answer A on D6228), HQ's queue across companies oldest first,
 * and the evidence file's own route (`routes/mark_requests.ts`).
 *
 * Real schema (`loadSchema`, so migrations 202611141523_6205 and
 * 202611161239_6909 are applied), real route, synthetic fixtures and an
 * in-memory R2:
 *   ADMIN     platform admin
 *   HOLDER    investor holding ventures 7 and 9 (confirmed commitments)
 *   OTHER     investor holding venture 8
 *
 * Mutation-checked (each fails a named assertion below):
 *   · the "not both" check dropped → "a link and a file together: 400"
 *   · /queue ordered newest first → "the queue reads oldest first"
 *   · /:uid/evidence without the requester check → "another investor reads 404"
 *   · the orphan erase dropped from the insert's catch → "a refused insert leaves no file"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/mark_request_evidence_6909.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import markRequests, { evidenceUrl, EVIDENCE_MAX_BYTES } from '../src/routes/mark_requests.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6909-mark-evidence-0123456789';
const ADMIN = 1, HOLDER = 2, OTHER = 3;

function fakeR2() {
  const objects = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    objects,
    async put(key: string, bytes: ArrayBuffer, opts?: any) { objects.set(key, { bytes: new Uint8Array(bytes), type: opts?.httpMetadata?.contentType ?? '' }); },
    async get(key: string) { const o = objects.get(key); return o ? { body: o.bytes } : null; },
    async delete(key: string) { objects.delete(key); },
  };
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example', 'free');
  u.run(HOLDER, 'investor', null, 'Hal', 'hal@angel.example', 'professional');
  u.run(OTHER, 'investor', null, 'Oli', 'oli@angel.example', 'professional');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80), (9, 'p9', 'Venture Nine', 90);
    INSERT INTO deals (id, project_id) VALUES (70, 7), (80, 8), (90, 9);
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70), (${HOLDER}, 90), (${OTHER}, 80);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES
      (1, 70, ${HOLDER}, 1000, 'confirmed'), (2, 80, ${OTHER}, 1000, 'confirmed'), (3, 90, ${HOLDER}, 1000, 'confirmed');
    INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis) VALUES
      ('m7old', 7, '2025-12-31', 800, 'cost'), ('m7', 7, '2026-06-30', 900, 'round_price'), ('m8', 8, '2026-06-30', 400, 'gp_estimate');
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/mark-requests', markRequests);

async function token(db: DatabaseSync, userId: number) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  return new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function send(db: DatabaseSync, files: any, userId: number, method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(db, userId)}` };
  if (!form && body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api/mark-requests${path}`, {
      method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), FILES: files } as any);
  } catch (e) {
    if (e instanceof Response) res = e; else throw e;
  }
  return res;
}
async function call(db: DatabaseSync, files: any, userId: number, method: string, path: string, body?: unknown, form?: FormData) {
  const res = await send(db, files, userId, method, path, body, form);
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [w, e] = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { console.warn = w; console.error = e; }
};
const pdf = (n = 8, name = 'term-sheet.pdf') => new File([new Uint8Array(n).fill(37)], name, { type: 'application/pdf' });
function formOf(fields: Record<string, string>, file?: File) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (file) f.set('evidence_file', file);
  return f;
}
const count = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM portfolio_mark_requests').get() as any).n;

test('evidenceUrl: http and https only, no credentials, at most 2,000 characters', () => {
  assert.equal(evidenceUrl(' https://example.com/round '), 'https://example.com/round');
  assert.equal(evidenceUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1');
  for (const bad of ['javascript:alert(1)', 'ftp://example.com/x', 'https://u:p@example.com/x', 'not a url', '', `https://example.com/${'a'.repeat(2001)}`, 42]) {
    assert.equal(evidenceUrl(bad), null, String(bad).slice(0, 40));
  }
});

test('POST: a link is stored and read back; no evidence reads null; JSON without evidence works as before', async () => {
  const db = fixture(); const files = fakeR2();
  const a = await quiet(() => call(db, files, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'Series A closed.', evidence_url: 'https://example.com/press/series-a' }));
  assert.equal(a.status, 201);
  assert.deepEqual(a.body.evidence, { kind: 'link', url: 'https://example.com/press/series-a' });
  const b = await quiet(() => call(db, files, HOLDER, 'POST', '', { project_uid: 'p9', kind: 'mark', reason: 'Stale.' }));
  assert.equal(b.status, 201);
  assert.equal(b.body.evidence, null);
  const bad = await call(db, files, OTHER, 'POST', '', { project_uid: 'p8', kind: 'mark', reason: 'x', evidence_url: 'javascript:alert(1)' });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'bad_evidence_url');
  assert.equal(count(db), 2);
});

test('POST multipart: a file is stored under its prefix, read back as a file, and opened by the asker and HQ only', async () => {
  const db = fixture(); const files = fakeR2();
  const res = await quiet(() => call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'correction', reason: 'The basis is wrong.' }, pdf(12))));
  assert.equal(res.status, 201);
  const ev = res.body.evidence;
  assert.equal(ev.kind, 'file'); assert.equal(ev.name, 'term-sheet.pdf'); assert.equal(ev.size_bytes, 12); assert.equal(ev.mime, 'application/pdf');
  assert.equal(ev.href, `/api/mark-requests/${res.body.uid}/evidence`);
  assert.equal('key' in ev, false, 'the storage key is never handed out');
  const keys = [...files.objects.keys()];
  assert.equal(keys.length, 1); assert.match(keys[0], new RegExp(`^mark-request-evidence/7/${res.body.uid}\\.pdf$`));

  const mine = await send(db, files, HOLDER, 'GET', `/${res.body.uid}/evidence`);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('content-type'), 'application/pdf');
  assert.match(mine.headers.get('content-disposition') || '', /attachment; filename="term-sheet.pdf"/);
  assert.equal(mine.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await mine.arrayBuffer()).byteLength, 12);
  assert.equal((await send(db, files, ADMIN, 'GET', `/${res.body.uid}/evidence`)).status, 200, 'HQ opens it');
  // mutation: requester check dropped → 200 here.
  assert.equal((await send(db, files, OTHER, 'GET', `/${res.body.uid}/evidence`)).status, 404, 'another investor reads 404');
  assert.equal((await send(db, files, OTHER, 'GET', '/nope/evidence')).status, 404);
});

test('POST: a link and a file together, a wrong type, an empty or too large file are refused and store nothing', async () => {
  const db = fixture(); const files = fakeR2();
  const both = await call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'mark', reason: 'x', evidence_url: 'https://example.com' }, pdf()));
  // mutation: "not both" dropped → 201 here.
  assert.equal(both.status, 400, 'a link and a file together: 400'); assert.equal(both.body.code, 'one_evidence');
  const exe = new File([new Uint8Array(4)], 'x.exe', { type: 'application/x-msdownload' });
  assert.equal((await call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'mark', reason: 'x' }, exe))).status, 415);
  const empty = new File([], 'e.pdf', { type: 'application/pdf' });
  assert.equal((await call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'mark', reason: 'x' }, empty))).body.code, 'evidence_empty');
  assert.equal((await call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'mark', reason: 'x' }, pdf(EVIDENCE_MAX_BYTES + 1)))).status, 413);
  const noStore = await call(db, null, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'mark', reason: 'x' }, pdf()));
  assert.equal(noStore.status, 503); assert.equal(noStore.body.code, 'storage_unavailable');
  // A file for a company not held is refused before anything is stored.
  assert.equal((await call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p8', kind: 'mark', reason: 'x' }, pdf()))).status, 403);
  assert.equal(count(db), 0);
  assert.equal(files.objects.size, 0);
});

test('POST: a second open request is 409 before the file is stored; a refused insert leaves no file', async () => {
  const db = fixture(); const files = fakeR2();
  assert.equal((await quiet(() => call(db, files, HOLDER, 'POST', '', { project_uid: 'p7', kind: 'mark', reason: 'first' }))).status, 201);
  const again = await call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p7', kind: 'mark', reason: 'second' }, pdf()));
  assert.equal(again.status, 409);
  assert.equal(files.objects.size, 0, 'the open-request check runs before the upload');
  // Force the insert to fail after the upload: the stored file, named by no row, is erased as `unreferenced` (D6651).
  db.exec(`CREATE TRIGGER t_fail BEFORE INSERT ON portfolio_mark_requests BEGIN SELECT RAISE(ABORT, 'synthetic_insert_failure'); END;`);
  const failed = await quiet(() => call(db, files, HOLDER, 'POST', '', undefined, formOf({ project_uid: 'p9', kind: 'mark', reason: 'x' }, pdf())));
  assert.notEqual(failed.status, 201, 'the insert was refused');
  assert.equal(count(db), 1, 'only the first request is stored');
  // mutation: orphan erase dropped → one object left.
  assert.equal(files.objects.size, 0, 'a refused insert leaves no file');
});

test('the store: evidence is one kind, all-or-nothing for a file, and frozen once written', () => {
  const db = fixture();
  const ins = (extra: string, vals: string) => db.exec(`INSERT INTO portfolio_mark_requests (uid, project_id, requester_user_id, kind, reason, state, created_at, updated_at${extra})
    VALUES ('r${Math.random().toString(36).slice(2)}', 7, ${HOLDER}, 'mark', 'x', 'open', '2026-11-01', '2026-11-01'${vals})`);
  assert.throws(() => ins(', evidence_url, evidence_file_key, evidence_file_name, evidence_file_size, evidence_file_mime', ", 'https://e.x', 'mark-request-evidence/7/a.pdf', 'a.pdf', 1, 'application/pdf'"), /evidence_shape/);
  assert.throws(() => ins(', evidence_file_key', ", 'mark-request-evidence/7/a.pdf'"), /evidence_shape/);
  assert.throws(() => ins(', evidence_url', ", 'javascript:x'"), /CHECK/);
  assert.throws(() => ins(', evidence_file_key, evidence_file_name, evidence_file_size, evidence_file_mime', ", 'elsewhere/a.pdf', 'a.pdf', 1, 'application/pdf'"), /CHECK/);
  db.exec(`INSERT INTO portfolio_mark_requests (uid, project_id, requester_user_id, kind, reason, state, created_at, updated_at, evidence_url)
    VALUES ('fixed', 7, ${HOLDER}, 'mark', 'x', 'open', '2026-11-01', '2026-11-01', 'https://e.x/a')`);
  assert.throws(() => db.exec(`UPDATE portfolio_mark_requests SET evidence_url = 'https://e.x/b' WHERE uid = 'fixed'`), /evidence_frozen/);
  db.exec(`UPDATE portfolio_mark_requests SET state = 'declined', resolved_by = ${ADMIN}, resolved_at = '2026-11-02', resolution_note = 'no' WHERE uid = 'fixed'`);
  assert.equal((db.prepare(`SELECT evidence_url FROM portfolio_mark_requests WHERE uid = 'fixed'`).get() as any).evidence_url, 'https://e.x/a', 'answering keeps the evidence');
});

test('GET /queue: HQ only; open requests across companies, oldest first, each with its latest mark', async () => {
  const db = fixture(); const files = fakeR2();
  db.exec(`INSERT INTO portfolio_mark_requests (uid, project_id, requester_user_id, kind, reason, state, created_at, updated_at, evidence_url) VALUES
    ('q-new', 7, ${HOLDER}, 'mark', 'newer', 'open', '2026-11-10T09:00:00Z', '2026-11-10T09:00:00Z', 'https://e.x/1'),
    ('q-old', 8, ${OTHER}, 'correction', 'older', 'open', '2026-11-01T09:00:00Z', '2026-11-01T09:00:00Z', NULL),
    ('q-mid', 9, ${HOLDER}, 'follow_on', 'middle', 'open', '2026-11-05T09:00:00Z', '2026-11-05T09:00:00Z', NULL);
    INSERT INTO portfolio_mark_requests (uid, project_id, requester_user_id, kind, reason, state, created_at, updated_at, resolved_by, resolved_at, resolution_note) VALUES
    ('q-done', 7, ${OTHER}, 'mark', 'answered', 'declined', '2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z', ${ADMIN}, '2026-10-02T09:00:00Z', 'no');`);
  const q = await call(db, files, ADMIN, 'GET', '/queue');
  assert.equal(q.status, 200);
  assert.equal(q.body.order, 'oldest_first');
  // mutation: ordered newest first → ['q-new', …].
  assert.deepEqual(q.body.items.map((x: any) => x.uid), ['q-old', 'q-mid', 'q-new'], 'the queue reads oldest first');
  const [old, mid, nw] = q.body.items;
  assert.deepEqual(old.latest_mark, { uid: 'm8', as_of_date: '2026-06-30', fmv: 400, basis: 'gp_estimate' });
  assert.equal(mid.latest_mark, null, 'a company with no mark reads null, never an invented one');
  assert.equal(nw.latest_mark.uid, 'm7', 'the latest mark, not an older one');
  assert.deepEqual(nw.evidence, { kind: 'link', url: 'https://e.x/1' });
  assert.deepEqual(old.requester, { id: OTHER, name: 'Oli' });
  assert.equal((await call(db, files, HOLDER, 'GET', '/queue')).status, 403, 'an investor cannot read the queue');
});
