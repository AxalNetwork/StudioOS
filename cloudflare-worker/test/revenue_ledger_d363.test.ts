/**
 * D363 — the revenue ledger (migration 311, routes/revenue.ts).
 *
 * Real SQLite (node:sqlite through _d1_sqlite.mjs's d1Over), with migration 311
 * itself executed, so the table's CHECKs, the route's binds and the scoping
 * predicate decide what comes back — not a string-matching stub.
 *
 * WHAT IS PINNED.
 *   - Money is integer cents in and out; a CSV cell is parsed as text, never
 *     through a float, and a value the ledger cannot read exactly is refused.
 *   - Verification is the Worker's: a request asking for 'verified' is ignored;
 *     a proof document makes an entry 'supported', none leaves it 'manual'.
 *   - A proof document must belong to the same project.
 *   - Only the founder (or an admin) writes; another founder gets 403 on write
 *     and cannot read; an entry on another project is a 404.
 *   - An import checks every row first, writes the valid ones in one batch and
 *     reports each refused row with its code.
 *   - Migration 311 declares every object ensureRevenueEntriesSchema creates.
 *
 * Run:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/revenue_ledger_d363.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import revenue from '../src/routes/revenue.ts';
import {
  parseAmountToCents,
  normalizeRevenueType,
  verificationFor,
  validateEntry,
} from '../src/services/revenueLedger.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/311_revenue_entries.sql'), 'utf8');
const TODAY = new Date().toISOString().slice(0, 10);

const ADMIN = 1, FOUNDER_A = 10, FOUNDER_B = 20;

function freshEnv() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER, spinout_lab_active INTEGER);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
    INSERT INTO users (id, role, email, founder_id) VALUES
      (1, 'admin', 'a@example.test', NULL), (10, 'founder', 'f@example.test', 1001), (20, 'founder', 'g@example.test', 1002);
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002);
    INSERT INTO documents (id, project_id) VALUES (500, 1), (600, 2);
  `);
  db.exec(MIGRATION);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } };
}

async function token(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const ROLE: Record<number, string> = { 1: 'admin', 10: 'founder', 20: 'founder' };

async function call(env: any, method: string, path: string, who: number, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await token(who, ROLE[who])}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const res = await revenue.request(path, init, env);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

const ENTRY = { customer: 'Northwind Ops', amount_cents: 49000, revenue_type: 'recurring', received_on: TODAY };

test('amounts parse as text into integer cents; anything inexact is refused', () => {
  assert.equal(parseAmountToCents('1,200.50'), 120050);
  assert.equal(parseAmountToCents('$490'), 49000);
  assert.equal(parseAmountToCents('0.1'), 10);
  assert.equal(parseAmountToCents('19.99'), 1999);
  assert.equal(parseAmountToCents(1999.5), 199950);
  for (const bad of ['', '0', '-5', '1.005', 'abc', '1e3', '12.3.4', null, undefined, Number.NaN]) {
    assert.equal(parseAmountToCents(bad as any), null, `refused: ${String(bad)}`);
  }
  assert.equal(normalizeRevenueType('One-time'), 'one_time');
  assert.equal(normalizeRevenueType('Paid pilot'), 'pilot');
  assert.equal(normalizeRevenueType('Recurring'), 'recurring');
  assert.equal(normalizeRevenueType('grant'), null, 'grants are not customer revenue');
});

test('verification is derived from the row, never chosen', () => {
  assert.equal(verificationFor({ source: 'manual', proof_document_id: null }), 'manual');
  assert.equal(verificationFor({ source: 'csv', proof_document_id: 5 }), 'supported');
  assert.equal(verificationFor({ source: 'stripe', proof_document_id: null }), 'verified');
  const v = validateEntry({ ...ENTRY, amount_cents: 10.5 }, TODAY);
  assert.equal(v.ok, false, 'a fractional cent is not an amount');
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  assert.equal((validateEntry({ ...ENTRY, received_on: future }, TODAY) as any).code, 'received_on_in_future');
  assert.equal((validateEntry({ ...ENTRY, currency: 'eur' }, TODAY) as any).code, 'currency_unsupported');
});

test('create stores cents, and a request cannot mark its own entry verified', async () => {
  const { env, db } = freshEnv();
  const r = await call(env, 'POST', '/projects/1/entries', FOUNDER_A, { ...ENTRY, verification: 'verified', source: 'stripe' });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.amount_cents, 49000);
  assert.equal(r.body.entry.verification, 'manual');
  assert.equal(r.body.entry.source, 'manual');
  const row = db.prepare('SELECT amount_cents, typeof(amount_cents) AS t FROM revenue_entries').get() as any;
  assert.equal(row.t, 'integer');
});

test('a proof document makes an entry supported, and must be the project\'s own', async () => {
  const { env } = freshEnv();
  const own = await call(env, 'POST', '/projects/1/entries', FOUNDER_A, { ...ENTRY, proof_document_id: 500 });
  assert.equal(own.status, 200);
  assert.equal(own.body.entry.verification, 'supported');
  const foreign = await call(env, 'POST', '/projects/1/entries', FOUNDER_A, { ...ENTRY, proof_document_id: 600 });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, 'invalid_proof_document');
  // Attaching proof later flips manual → supported; removing it flips back.
  const bare = await call(env, 'POST', '/projects/1/entries', FOUNDER_A, ENTRY);
  const uid = bare.body.entry.uid;
  const attached = await call(env, 'PATCH', `/projects/1/entries/${uid}`, FOUNDER_A, { proof_document_id: 500 });
  assert.equal(attached.body.entry.verification, 'supported');
  const removed = await call(env, 'PATCH', `/projects/1/entries/${uid}`, FOUNDER_A, { proof_document_id: null });
  assert.equal(removed.body.entry.verification, 'manual');
  assert.equal(removed.body.entry.amount_cents, 49000, 'an unrelated PATCH keeps the stored amount');
});

test('only the owner or an admin writes; another founder reads nothing and writes nothing', async () => {
  const { env } = freshEnv();
  await call(env, 'POST', '/projects/1/entries', FOUNDER_A, ENTRY);
  const otherWrite = await call(env, 'POST', '/projects/1/entries', FOUNDER_B, ENTRY);
  assert.equal(otherWrite.status, 403);
  const otherRead = await call(env, 'GET', '/projects/1/entries', FOUNDER_B);
  assert.equal(otherRead.status, 403);
  const adminWrite = await call(env, 'POST', '/projects/1/entries', ADMIN, ENTRY);
  assert.equal(adminWrite.status, 200);
  const list = await call(env, 'GET', '/projects/1/entries', FOUNDER_A);
  assert.equal(list.status, 200);
  assert.equal(list.body.entries.length, 2);
  // An entry reached through another project is not there.
  const uid = list.body.entries[0].uid;
  const cross = await call(env, 'DELETE', `/projects/2/entries/${uid}`, FOUNDER_B);
  assert.equal(cross.status, 404);
  const own = await call(env, 'DELETE', `/projects/1/entries/${uid}`, FOUNDER_A);
  assert.equal(own.status, 200);
});

test('an import writes every valid row and names each refused one', async () => {
  const { env, db } = freshEnv();
  const r = await call(env, 'POST', '/projects/1/entries/import', FOUNDER_A, {
    rows: [
      { customer: 'Meridian Labs', amount: '1,500', revenue_type: 'Pilot', received_on: TODAY },
      { customer: 'Cedar & Co.', amount: '300.00', revenue_type: 'One-time', received_on: TODAY },
      { customer: 'Bad Amount', amount: '12.345', revenue_type: 'Pilot', received_on: TODAY },
      { customer: 'Grant Office', amount: '5000', revenue_type: 'Grant', received_on: TODAY },
      { customer: 'Sneaky', amount: '10', revenue_type: 'Pilot', received_on: TODAY, proof_document_id: 500, verification: 'verified' },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.inserted, 3);
  assert.deepEqual(r.body.rejected.map((x: any) => [x.index, x.code]), [[2, 'invalid_amount'], [3, 'invalid_revenue_type']]);
  const rows = db.prepare('SELECT customer, amount_cents, source, verification, proof_document_id FROM revenue_entries ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((x) => x.amount_cents), [150000, 30000, 1000]);
  assert.ok(rows.every((x) => x.source === 'csv' && x.verification === 'manual' && x.proof_document_id === null),
    'an imported row carries no proof and no verification it was not given by the Worker');
  const none = await call(env, 'POST', '/projects/1/entries/import', FOUNDER_A, { rows: [{ customer: 'x', amount: 'y' }] });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'no_valid_rows');
});

test('migration 311 declares every object the runtime bootstrap can create (D235)', () => {
  const svc = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/revenueLedger.ts'), 'utf8');
  for (const name of [...svc.matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS (\w+)/g)].map((m) => m[1])) {
    assert.match(MIGRATION, new RegExp(`CREATE (?:TABLE|INDEX) IF NOT EXISTS ${name}\\b`), `${name} has no migration`);
  }
});
