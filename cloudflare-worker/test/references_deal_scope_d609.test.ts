/**
 * D609 (#1309) — reference checks are scoped to the deal: an investor reads
 * and changes only the references on deals they can open (invited or
 * committed), an admin any deal's; founders and partners are refused; the
 * cross-deal list is gone; another deal's reference reads as a 404.
 *
 * Driven through the real router (`routes/references.ts`) on real
 * `node:sqlite`, with the tables from `schema_baseline.sql`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/references_deal_scope_d609.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import references from '../src/routes/references.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

// Users: admin, three investors (invited to deal 1, committed on deal 1, neither), a founder (owns deal 1's project), a partner.
const ADMIN = 1, INV_INVITED = 2, INV_COMMITTED = 3, INV_NONE = 4, FOUNDER = 5, PARTNER = 6;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 4: 'investor', 5: 'founder', 6: 'partner' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'deals', 'deal_invitations', 'commitments', 'reference_checks']) db.exec(ddl(t));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `User ${id}`, `u${id}@example.test`);
  db.exec(`UPDATE users SET founder_id = 50 WHERE id = ${FOUNDER}`);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (10, 'Deal one co', 50), (20, 'Deal two co', 60)`).run();
  db.prepare(`INSERT INTO deals (id, project_id) VALUES (1, 10), (2, 20)`).run();
  db.prepare(`INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (1, ?)`).run(INV_INVITED);
  db.prepare(`INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES (1, ?, 1000, 'pending')`).run(INV_COMMITTED);
  const ref = db.prepare(`INSERT INTO reference_checks (id, uid, deal_id, reference_name, reference_email, status, transcript, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, 'scheduled', 'transcript text', '2026-10-07', '2026-10-07')`);
  ref.run(101, 'r101', 1, 'Rita Reference', 'rita@example.test');
  ref.run(201, 'r201', 2, 'Other Deal Ref', 'other@example.test');
  db.exec("UPDATE reference_checks SET created_by = 2 WHERE id = 101");
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/references', references as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api/references${path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const count = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM reference_checks').get() as any).n;

test('D609: the list needs deal_id; the cross-deal list is gone', async () => {
  const db = freshDb();
  for (const who of [ADMIN, INV_INVITED]) {
    const r = await call(db, who, 'GET', '');
    assert.equal(r.status, 400, `user ${who}`);
    assert.equal(r.body.error, 'deal_id_required');
    assert.doesNotMatch(r.text, /Rita|Other Deal/);
  }
  assert.equal((await call(db, ADMIN, 'GET', '?deal_id=abc')).status, 400);
});

test('D609: the list — admin any deal; invited or committed investor their deal; anyone else 404 or 403', async () => {
  const db = freshDb();
  const names = async (who: number, deal: number) => {
    const r = await call(db, who, 'GET', `?deal_id=${deal}`);
    return [r.status, r.status === 200 ? r.body.map((x: any) => x.reference_name) : null];
  };
  assert.deepEqual(await names(ADMIN, 1), [200, ['Rita Reference']]);
  assert.deepEqual(await names(ADMIN, 2), [200, ['Other Deal Ref']]);
  assert.deepEqual(await names(INV_INVITED, 1), [200, ['Rita Reference']]);
  assert.deepEqual(await names(INV_COMMITTED, 1), [200, ['Rita Reference']]);
  assert.deepEqual(await names(INV_NONE, 1), [404, null], 'an investor with no relationship read the deal');
  assert.deepEqual(await names(INV_INVITED, 2), [404, null], 'an investor read another deal');
  assert.deepEqual(await names(ADMIN, 999), [404, null]);
  assert.equal((await call(db, FOUNDER, 'GET', '?deal_id=1')).status, 403, 'a founder reached references');
  assert.equal((await call(db, PARTNER, 'GET', '?deal_id=1')).status, 403, 'a partner reached references');
});

test('D609: one reference — another deal\'s reads as a 404, the same as a missing one', async () => {
  const db = freshDb();
  const r = await call(db, INV_INVITED, 'GET', '/101');
  assert.deepEqual([r.status, r.body.transcript], [200, 'transcript text']);
  assert.equal((await call(db, INV_COMMITTED, 'GET', '/101')).status, 200);
  assert.equal((await call(db, ADMIN, 'GET', '/201')).status, 200);
  const other = await call(db, INV_INVITED, 'GET', '/201');
  const missing = await call(db, INV_INVITED, 'GET', '/999');
  assert.deepEqual([other.status, other.body], [missing.status, missing.body], 'another deal\'s reference is told apart from a missing one');
  assert.equal(other.status, 404);
  assert.doesNotMatch(other.text, /Other Deal|other@example/);
  assert.equal((await call(db, INV_NONE, 'GET', '/101')).status, 404);
  assert.equal((await call(db, FOUNDER, 'GET', '/101')).status, 403);
  assert.equal((await call(db, PARTNER, 'GET', '/101')).status, 403);
});

test('D609: update — only on a deal the caller can open', async () => {
  const db = freshDb();
  assert.equal((await call(db, INV_INVITED, 'PATCH', '/101', { notes: 'ok' })).status, 200);
  assert.equal((await call(db, ADMIN, 'PATCH', '/201', { notes: 'admin' })).status, 200);
  assert.equal((await call(db, INV_INVITED, 'PATCH', '/201', { notes: 'nope' })).status, 404);
  assert.equal((await call(db, INV_NONE, 'PATCH', '/101', { notes: 'nope' })).status, 404);
  assert.equal((await call(db, FOUNDER, 'PATCH', '/101', { notes: 'nope' })).status, 403);
  assert.equal((await call(db, PARTNER, 'PATCH', '/101', { notes: 'nope' })).status, 403);
  const notes = (db.prepare('SELECT id, notes FROM reference_checks ORDER BY id').all() as any[]).map((r) => [r.id, r.notes]);
  assert.deepEqual(notes, [[101, 'ok'], [201, 'admin']]);
});

test('D609: consent — only on a deal the caller can open', async () => {
  const db = freshDb();
  assert.equal((await call(db, INV_COMMITTED, 'POST', '/101/consent', { consent_given: true })).status, 200);
  assert.equal((await call(db, INV_COMMITTED, 'POST', '/201/consent', { consent_given: false })).status, 404);
  assert.equal((await call(db, PARTNER, 'POST', '/101/consent', { consent_given: false })).status, 403);
  assert.equal((db.prepare('SELECT transcript FROM reference_checks WHERE id = 201').get() as any).transcript, 'transcript text',
    'another deal\'s transcript was wiped');
});

test('D609: delete — only on a deal the caller can open', async () => {
  const db = freshDb();
  assert.equal((await call(db, INV_NONE, 'DELETE', '/101')).status, 404);
  assert.equal((await call(db, INV_INVITED, 'DELETE', '/201')).status, 404);
  assert.equal((await call(db, FOUNDER, 'DELETE', '/101')).status, 403);
  assert.equal(count(db), 2, 'a refused delete removed a row');
  assert.equal((await call(db, INV_INVITED, 'DELETE', '/101')).status, 200);
  assert.equal((await call(db, ADMIN, 'DELETE', '/201')).status, 200);
  assert.equal(count(db), 0);
});

test('D609: create — the deal must exist and be one the caller can open', async () => {
  const db = freshDb();
  const make = (who: number, deal: unknown) => call(db, who, 'POST', '', { deal_id: deal, reference_name: 'New Ref' });
  assert.equal((await make(INV_INVITED, 1)).status, 200);
  assert.equal((await make(ADMIN, 2)).status, 200);
  assert.equal((await make(ADMIN, 999)).status, 404, 'a reference was created on a deal that does not exist');
  const blocked = await make(INV_INVITED, 2);
  const missing = await make(INV_INVITED, 999);
  assert.deepEqual([blocked.status, blocked.body], [missing.status, missing.body], 'a deal the caller cannot open is told apart from a missing one');
  assert.equal((await make(INV_NONE, 1)).status, 404);
  assert.equal((await make(FOUNDER, 1)).status, 403);
  assert.equal((await make(PARTNER, 1)).status, 403);
  assert.equal((await make(ADMIN, 'x')).status, 400);
  assert.equal(count(db), 4);
});
