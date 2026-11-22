/**
 * D7820 (#7820): admin routes over the Research › Companies review ledger (`routes/research_company_reviews.ts`,
 * `services/researchCompanyReview.ts`). Real schema (`loadSchema`, so D7819's ledger and triggers are applied), the
 * real router, synthetic fixtures only: no real company, uid list or cohort.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/research_company_reviews_7820.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import reviews, { mount } from '../src/routes/research_company_reviews.ts';
import { IDENTITY_SQL, MAX_UIDS } from '../src/services/researchCompanyReview.ts';
import { COUNTED_COMPANIES, readCompanyByUid } from '../src/services/researchCompanyRead.ts';
import { MAINTENANCE_WRITERS, PENDING_READERS, checkReaders } from './research_company_read_guard_7819.test.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d7820-company-reviews-0123456789';
const ADMIN = 1, MEMBER = 2;
const PROOF = 'https://evidence.example.test/review/1';
const SELF = 'cloudflare-worker/src/services/researchCompanyReview.ts';

function fixture() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin', 'Ada', 'ada@axal.example');
  u.run(MEMBER, 'investor', 'Mia', 'mia@member.example');
  for (const uid of ['plain', 'excluded', 'withdrawn', 'gone'])
    db.prepare(`INSERT INTO research_company_directory(uid,name,website,source_url,source_name,source_license,as_of)
      VALUES (?,?,'https://example.test','https://example.test/source','Synthetic publisher','Synthetic terms','2026-01-01')`).run(`7820-${uid}`, `Synthetic ${uid}`);
  for (const status of ['excluded', 'withdrawn', 'gone'])
    db.prepare(`INSERT INTO research_company_reviews(uid,status,reason_code,admin_note,reviewer,reviewed_on)
      VALUES (?,?,'out_of_scope','PRIVATE_NOTE',9,'2026-02-01 00:00:00')`).run(`7820-${status}`, status === 'gone' ? 'excluded' : status);
  db.prepare("DELETE FROM research_company_directory WHERE uid = '7820-gone'").run();
  return db;
}

const app = new Hono<any>();
app.route(mount.path, reviews);

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role;
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t${mount.path}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) { if (e instanceof Response) res = e; else throw e; }
  const text = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const [w, e] = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { console.warn = w; console.error = e; }
};
const set = (db: DatabaseSync, body: Record<string, unknown>, who = ADMIN) => quiet(() => call(db, who, 'POST', '', { reason_code: 'quality_hold', proof_url: PROOF, ...body }));
const audit = (db: DatabaseSync) => db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'research_company_%' ORDER BY id").all() as any[];
const env = (db: DatabaseSync) => ({ DB: d1Over(db) }) as any;

test('an admin places a hold with reason and proof; the served-rows read returns it; clearing restores; history keeps both', async () => {
  const db = fixture();
  const held = await set(db, { uids: ['7820-plain'], status: 'held', admin_note: 'checking the register', run_reference: 'run-7742-abc' });
  assert.equal(held.status, 200, JSON.stringify(held.body));
  assert.equal(held.body.count, 1);
  assert.equal(held.body.batch_reference, 'run-7742-abc', 'a #7742 run id is carried as text');
  const read: any = await readCompanyByUid(env(db), '7820-plain');
  assert.equal(read.review_status, 'held');
  assert.equal(read.reason, 'This record is held while its quality is checked.');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${COUNTED_COMPANIES} WHERE uid='7820-plain'`).get().n, 0, 'held is not counted');

  const cleared = await set(db, { uids: ['7820-plain'], status: 'admitted', reason_code: 'verified' });
  assert.equal(cleared.status, 200);
  assert.equal((await readCompanyByUid(env(db), '7820-plain') as any).review_status, 'admitted');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${COUNTED_COMPANIES} WHERE uid='7820-plain'`).get().n, 1, 'cleared is counted again');

  const hist = await quiet(() => call(db, ADMIN, 'GET', '/7820-plain/history'));
  assert.equal(hist.status, 200);
  assert.deepEqual(hist.body.history.map((h: any) => [h.status, h.operation, h.reviewer]), [['held', 'created', ADMIN], ['admitted', 'updated', ADMIN]]);
  assert.ok(hist.body.history.every((h: any) => h.reviewed_on), 'each change keeps its date');
  assert.equal(hist.body.history[0].run_reference, 'run-7742-abc');
});

test('a list holding an unknown uid changes nothing and names it; the cap is enforced', async () => {
  const db = fixture();
  const before = db.prepare('SELECT COUNT(*) AS n FROM research_company_review_history').get().n;
  const res = await set(db, { uids: ['7820-plain', '7820-nowhere'], status: 'held' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'unknown_uids');
  assert.deepEqual(res.body.unknown, ['7820-nowhere']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM research_company_reviews WHERE uid='7820-plain'").get().n, 0, 'all or nothing: the known uid is not written either');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_company_review_history').get().n, before);
  const over = await set(db, { uids: Array.from({ length: MAX_UIDS + 1 }, (_, i) => `7820-x${i}`), status: 'held' });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, 'too_many_uids');
  assert.equal(MAX_UIDS, 200);
  for (const bad of [{ proof_url: 'http://insecure.test' }, { proof_url: '' }, { reason_code: 'made_up' }, { status: 'deleted' }]) {
    const r = await set(db, { uids: ['7820-plain'], status: 'held', ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(audit(db).length, 0, 'a refused write leaves no audit row');
});

test('excluded, withdrawn, and a record whose directory row is gone can each be changed and cleared', async () => {
  const db = fixture();
  for (const uid of ['7820-excluded', '7820-withdrawn', '7820-gone']) {
    const changed = await set(db, { uids: [uid], status: 'withdrawn', reason_code: 'source_withdrawn', withdrawn_on: '2026-03-01' });
    assert.equal(changed.status, 200, `${uid}: ${JSON.stringify(changed.body)}`);
    assert.equal((db.prepare('SELECT status, withdrawn_on FROM research_company_reviews WHERE uid = ?').get(uid) as any).withdrawn_on, '2026-03-01 00:00:00');
    const cleared = await set(db, { uids: [uid], status: 'admitted', reason_code: 'verified' });
    assert.equal(cleared.status, 200);
    const row: any = db.prepare('SELECT status, withdrawn_on FROM research_company_reviews WHERE uid = ?').get(uid);
    assert.deepEqual([row.status, row.withdrawn_on], ['admitted', null]);
  }
});

test('a non-admin is refused on every route; each write leaves an audit row with a count and a batch reference, never a uid', async () => {
  const db = fixture();
  for (const [method, path, body] of [
    ['POST', '', { uids: ['7820-plain'], status: 'held', reason_code: 'quality_hold', proof_url: PROOF }],
    ['POST', '/checks', { uid: '7820-plain', kind: 'website', outcome: 'ok', proof_url: PROOF }],
    ['GET', '', undefined], ['GET', '/7820-plain/history', undefined],
  ] as const) {
    const r = await quiet(() => call(db, MEMBER, method, path, body));
    assert.ok([401, 403].includes(r.status), `${method} ${path} → ${r.status}`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_company_reviews').get().n, 3, 'nothing was written');

  await set(db, { uids: ['7820-plain', '7820-excluded'], status: 'held' });
  await quiet(() => call(db, ADMIN, 'POST', '/checks', { uid: '7820-plain', kind: 'website', outcome: 'ok', proof_url: PROOF }));
  const rows = audit(db);
  assert.deepEqual(rows.map((r) => r.action), ['research_company_review_set', 'research_company_check_recorded']);
  const details = rows.map((r) => JSON.parse(r.details));
  assert.equal(details[0].count, 2);
  assert.match(details[0].batch_reference, /^batch-[0-9a-f-]{36}$/);
  assert.equal(details[1].count, 1);
  assert.ok(details[1].batch_reference);
  for (const r of rows) {
    assert.equal(r.user_id, ADMIN);
    assert.doesNotMatch(r.details, /7820-/, 'no uid in the audit trail');
  }
});

test('a failed check is recorded and the earlier good check remains', async () => {
  const db = fixture();
  const ok = await quiet(() => call(db, ADMIN, 'POST', '/checks', { uid: '7820-plain', kind: 'website', outcome: 'ok', proof_url: PROOF, checked_at: '2026-04-01T10:00:00Z' }));
  assert.equal(ok.status, 201);
  const failed = await quiet(() => call(db, ADMIN, 'POST', '/checks', { uid: '7820-plain', kind: 'website', outcome: 'failed', what_changed: 'site down', proof_url: PROOF, checked_at: '2026-05-01T10:00:00Z' }));
  assert.equal(failed.status, 201);
  assert.deepEqual(failed.body.last_good, { kind: 'website', checked_at: '2026-04-01 10:00:00', outcome: 'ok' });
  const read: any = await readCompanyByUid(env(db), '7820-plain');
  assert.deepEqual(read.checks.map((c: any) => c.outcome), ['ok', 'failed']);
  assert.equal(read.dates.last_failed_check, '2026-05-01 10:00:00');
  const unknown = await quiet(() => call(db, ADMIN, 'POST', '/checks', { uid: '7820-nowhere', kind: 'website', outcome: 'ok', proof_url: PROOF }));
  assert.equal(unknown.status, 404);
  const gone = await quiet(() => call(db, ADMIN, 'POST', '/checks', { uid: '7820-gone', kind: 'registry_status', outcome: 'changed', proof_url: PROOF }));
  assert.equal(gone.status, 201, 'a review row alone is enough');
});

test('the list returns current held, excluded and withdrawn records with reason and proof, paged; identity is never guessed', async () => {
  const db = fixture();
  await set(db, { uids: ['7820-plain'], status: 'held' });
  const all = await quiet(() => call(db, ADMIN, 'GET', ''));
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 4);
  const by = Object.fromEntries(all.body.items.map((i: any) => [i.uid, i]));
  assert.deepEqual(Object.keys(by).sort(), ['7820-excluded', '7820-gone', '7820-plain', '7820-withdrawn']);
  assert.equal(by['7820-plain'].reason_code, 'quality_hold');
  assert.equal(by['7820-plain'].proof_url, PROOF);
  for (const uid of ['7820-excluded', '7820-withdrawn']) {
    assert.equal(by[uid].name, `Synthetic ${uid.slice(5)}`);
    assert.equal(by[uid].source_name, 'Synthetic publisher');
    assert.equal(by[uid].directory_row, true);
  }
  assert.deepEqual([by['7820-gone'].name, by['7820-gone'].source_name, by['7820-gone'].directory_row], [null, null, false]);

  await set(db, { uids: ['7820-plain'], status: 'admitted', reason_code: 'verified' });
  const after = await quiet(() => call(db, ADMIN, 'GET', ''));
  assert.ok(!after.body.items.some((i: any) => i.uid === '7820-plain'), 'a record with no current hold is not in it');

  const p1 = await quiet(() => call(db, ADMIN, 'GET', '?page=1&page_size=2'));
  const p2 = await quiet(() => call(db, ADMIN, 'GET', '?page=2&page_size=2'));
  assert.equal(p1.body.items.length, 2);
  assert.equal(p2.body.items.length, 1);
  assert.equal(p1.body.total, 3);
  assert.ok(!p1.body.items.some((i: any) => p2.body.items.some((j: any) => j.uid === i.uid)));
  const only = await quiet(() => call(db, ADMIN, 'GET', '?status=withdrawn'));
  assert.deepEqual(only.body.items.map((i: any) => i.uid), ['7820-withdrawn']);
  assert.equal((await quiet(() => call(db, ADMIN, 'GET', '?status=admitted'))).status, 400);
});

test('the one statement on the company table selects uid, name and source name, and only the admin routes import that read', () => {
  const cols = IDENTITY_SQL.match(/^SELECT\s+(.+?)\s+FROM research_company_directory/s)?.[1].split(',').map((s) => s.trim());
  assert.deepEqual(cols, ['uid', 'name', 'source_name']);
  const service = readFileSync(resolve(import.meta.dirname, '../src/services/researchCompanyReview.ts'), 'utf8');
  assert.equal(service.match(/research_company_directory/g)?.length, 1, 'one statement names the table');
  assert.doesNotMatch(service, /(UPDATE|INSERT INTO|DELETE FROM)\s+research_company_directory/);

  const src = resolve(import.meta.dirname, '../src');
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(resolve(d, e.name)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [resolve(d, e.name)] : []));
  const importers = walk(src).filter((f) => /readDirectoryIdentityForAdmin/.test(readFileSync(f, 'utf8'))).map((f) => relative(src, f)).sort();
  assert.deepEqual(importers, ['services/researchCompanyReview.ts'], 'not even the route calls it directly: only through the service');
  const users = walk(src).filter((f) => /services\/researchCompanyReview['"]/.test(readFileSync(f, 'utf8'))).map((f) => relative(src, f));
  assert.deepEqual(users, ['routes/research_company_reviews.ts'], 'only the admin routes import the review service');
});

test('the guard passes with the one allowed line and fails without it; the pending list is unchanged', () => {
  assert.deepEqual(MAINTENANCE_WRITERS, [SELF]);
  assert.ok(!PENDING_READERS.includes(SELF));
  const service = readFileSync(resolve(import.meta.dirname, '../src/services/researchCompanyReview.ts'), 'utf8');
  assert.deepEqual(checkReaders({ [SELF]: service }, PENDING_READERS, [SELF]).filter((e) => e.includes('researchCompanyReview')), []);
  assert.match(checkReaders({ [SELF]: service }, PENDING_READERS, []).join('\n'), /New physical directory reference.*researchCompanyReview\.ts/);
});

test('a run is referenced as text only: no route or service writes any run table', () => {
  const both = ['../src/services/researchCompanyReview.ts', '../src/routes/research_company_reviews.ts']
    .map((p) => readFileSync(resolve(import.meta.dirname, p), 'utf8')).join('\n');
  const written = [...both.matchAll(/INSERT INTO\s+(\w+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(written)].sort(), ['research_company_checks', 'research_company_reviews']);
  assert.doesNotMatch(both, /ingestion_run|import_run|research_runs/i);
});
