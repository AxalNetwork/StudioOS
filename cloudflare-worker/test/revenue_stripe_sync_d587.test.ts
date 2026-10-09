/**
 * D587 (#1214) — Stripe charges become verified revenue entries.
 *
 * Real SQLite with migrations 311 and 400 executed, the real revenue router,
 * an encrypted Stripe integration row, and a stubbed Stripe REST API over
 * global fetch. What is pinned:
 *   - one entry per succeeded charge, net of refunds; a fully refunded charge
 *     writes nothing; the date is the charge's; source 'stripe', verified;
 *   - a second import writes nothing twice (the partial unique index);
 *   - a non-USD charge is refused per row with a code and our sentence;
 *   - no personal data is stored: the customer is the Stripe customer id, or
 *     "Stripe charge";
 *   - only the startup's own founder imports, from their own account; another
 *     founder is refused; not connected is a 400, a failed Stripe read a 502,
 *     never "0 imported";
 *   - a synced entry's amount, date and customer cannot be edited.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/revenue_stripe_sync_d587.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import revenue from '../src/routes/revenue.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { chargeToEntry, STRIPE_NO_CUSTOMER } from '../src/services/revenueLedger.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (n: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${n}`), 'utf8');
const ADMIN = 1, FOUNDER_A = 10, FOUNDER_B = 20;
const ROLE: Record<number, string> = { 1: 'admin', 10: 'founder', 20: 'founder' };
const DAY = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);

async function freshEnv() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER, spinout_lab_active INTEGER);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, project_id INTEGER);
    CREATE TABLE integrations (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, user_id INTEGER NOT NULL,
      provider_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', credentials_enc TEXT, config_json TEXT,
      last_synced_at TEXT, last_error TEXT, updated_at TEXT);
    INSERT INTO users (id, role, email, founder_id) VALUES
      (1, 'admin', 'a@example.test', NULL), (10, 'founder', 'f@example.test', 1001), (20, 'founder', 'g@example.test', 1002);
    INSERT INTO projects (id, name, founder_id) VALUES (1, 'Acme', 1001), (2, 'Beta', 1002);
  `);
  db.exec(MIG('311_revenue_entries.sql'));
  db.exec(MIG('400_revenue_stripe_charge_index.sql'));
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  return { db, env };
}

async function connectStripe(env: any, db: any, userId: number) {
  const uid = `int_stripe_${userId}`;
  const enc = await encryptCredentials(env, uid, { access_token: `sk_test_${userId}` } as any);
  db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, credentials_enc) VALUES (?, ?, 'stripe', 'active', ?)`)
    .run(uid, userId, enc);
}

/** A charge as Stripe returns it, personal data included, which must never reach the ledger. */
const CH = (o: Record<string, unknown>) => ({
  object: 'charge', status: 'succeeded', paid: true, currency: 'usd', amount_refunded: 0, invoice: null,
  customer: 'cus_Alpha1', created: DAY('2026-09-01'),
  billing_details: { name: 'Ada Lovelace', email: 'ada@example.test', address: { line1: '1 Analytical Way' } },
  receipt_email: 'ada@example.test', description: 'Ada Lovelace — annual plan',
  payment_method_details: { card: { last4: '4242', brand: 'visa' } },
  ...o,
});

const CHARGES = [
  CH({ id: 'ch_1', amount: 49000, invoice: 'in_1' }),                                  // recurring, $490
  CH({ id: 'ch_2', amount: 10000, amount_refunded: 2500, created: DAY('2026-09-15') }), // net $75
  CH({ id: 'ch_3', amount: 5000, amount_refunded: 5000 }),                              // fully refunded
  CH({ id: 'ch_4', amount: 7000, currency: 'eur' }),                                    // refused
  CH({ id: 'ch_5', amount: 1200, customer: null }),                                     // no customer
  CH({ id: 'ch_6', amount: 9999, status: 'failed', paid: false }),                      // not succeeded
];

async function withStripe(charges: any[] | 'fail', fn: (calls: string[]) => Promise<void>) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    calls.push(`${u} ${init?.headers?.Authorization || ''}`);
    if (charges === 'fail') return new Response('{"error":{"message":"invalid api key"}}', { status: 401 });
    if (u.startsWith('https://api.stripe.com/v1/charges')) {
      return new Response(JSON.stringify({ object: 'list', data: charges, has_more: false }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as any;
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

async function call(env: any, method: string, path: string, who: number, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const res = await revenue.request(path, init, env);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const importStripe = (env: any, who: number, project = 1) => call(env, 'POST', `/projects/${project}/entries/import-stripe`, who);
const rows = (db: any, project = 1) => db.prepare(
  `SELECT customer, amount_cents, currency, revenue_type, received_on, source, source_ref, verification, notes
     FROM revenue_entries WHERE project_id = ? ORDER BY source_ref`).all(project).map((r: any) => ({ ...r }));
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

test('a charge becomes one verified entry, net of refunds, dated by Stripe, with no personal data', async () => {
  const { db, env } = await freshEnv();
  await connectStripe(env, db, FOUNDER_A);
  await withStripe(CHARGES, async (calls) => {
    const r = await quiet(() => importStripe(env, FOUNDER_A));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.charges, 5, 'the failed charge was counted');
    assert.equal(r.body.inserted, 3);
    assert.equal(r.body.already_imported, 0);
    assert.equal(r.body.refunded, 1);
    assert.deepEqual(r.body.rejected, [{ charge_id: 'ch_4', code: 'currency_unsupported', message: 'Only US dollar charges can be recorded for now.' }]);
    assert.ok(calls.every((c) => c.endsWith('Bearer sk_test_10')), 'the import read an account that is not the caller\'s');
    assert.ok(calls.some((c) => c.includes('/v1/charges')), 'Stripe was not read');
  });
  assert.deepEqual(rows(db), [
    { customer: 'cus_Alpha1', amount_cents: 49000, currency: 'usd', revenue_type: 'recurring', received_on: '2026-09-01', source: 'stripe', source_ref: 'ch_1', verification: 'verified', notes: null },
    { customer: 'cus_Alpha1', amount_cents: 7500, currency: 'usd', revenue_type: 'one_time', received_on: '2026-09-15', source: 'stripe', source_ref: 'ch_2', verification: 'verified', notes: null },
    { customer: STRIPE_NO_CUSTOMER, amount_cents: 1200, currency: 'usd', revenue_type: 'one_time', received_on: '2026-09-01', source: 'stripe', source_ref: 'ch_5', verification: 'verified', notes: null },
  ]);
  // The random columns (`uid`, `import_batch`) and the timestamps are left out:
  // they carry no Stripe data, and a random hex uid contains '4242' often enough
  // to fail this test about once in a few hundred runs. Every other column is checked.
  const everything = JSON.stringify(db.prepare('SELECT * FROM revenue_entries').all()
    .map(({ uid, import_batch, created_at, updated_at, ...rest }) => rest));
  for (const pii of ['Ada', 'Lovelace', 'ada@example.test', 'Analytical', '4242', 'visa']) {
    assert.ok(!everything.includes(pii), `personal data stored: ${pii}`);
  }
});

test('a second import writes nothing twice', async () => {
  const { db, env } = await freshEnv();
  await connectStripe(env, db, FOUNDER_A);
  await withStripe(CHARGES, async () => {
    await quiet(() => importStripe(env, FOUNDER_A));
    const again = await quiet(() => importStripe(env, FOUNDER_A));
    assert.equal(again.status, 200);
    assert.equal(again.body.inserted, 0);
    assert.equal(again.body.already_imported, 3);
    assert.equal(again.body.import_batch, null);
  });
  assert.equal(rows(db).length, 3);
  // The index is what refuses the duplicate, not the route reading first.
  assert.throws(() => db.prepare(
    `INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, source_ref, verification)
     VALUES ('x', 1, 'c', 1, 'one_time', '2026-09-01', 'stripe', 'ch_1', 'verified')`).run(), /UNIQUE/);
  // A manual or CSV row with the same ref is untouched by it.
  db.prepare(`INSERT INTO revenue_entries (uid, project_id, customer, amount_cents, revenue_type, received_on, source, source_ref)
     VALUES ('y', 1, 'c', 1, 'one_time', '2026-09-01', 'csv', 'ch_1')`).run();
});

test('who may import: the founder, from their own account; a failed read is a refusal, never zero', async () => {
  const { db, env } = await freshEnv();
  await withStripe(CHARGES, async () => {
    const notConnected = await quiet(() => importStripe(env, FOUNDER_A));
    assert.equal(notConnected.status, 400);
    assert.equal(notConnected.body.error, 'stripe_not_connected');
    await connectStripe(env, db, ADMIN);
    const admin = await quiet(() => importStripe(env, ADMIN));
    assert.equal(admin.status, 403, 'an admin imported their own Stripe account into a founder\'s ledger');
    assert.equal(admin.body.error, 'stripe_owner_only');
    await connectStripe(env, db, FOUNDER_B);
    const other = await quiet(() => importStripe(env, FOUNDER_B));
    assert.notEqual(other.status, 200, 'another founder imported into this startup');
  });
  assert.equal(rows(db).length, 0);
  await connectStripe(env, db, FOUNDER_A);
  await withStripe('fail', async () => {
    const failed = await quiet(() => importStripe(env, FOUNDER_A));
    assert.equal(failed.status, 502);
    assert.equal(failed.body.error, 'stripe_read_failed');
    assert.equal(failed.body.inserted, undefined, 'a failed read reported a count');
  });
  assert.equal(rows(db).length, 0);
});

test('a synced entry keeps the amount, date and customer Stripe reported; its type, notes and proof may change', async () => {
  const { db, env } = await freshEnv();
  db.prepare('INSERT INTO documents (id, project_id) VALUES (500, 1)').run();
  await connectStripe(env, db, FOUNDER_A);
  await withStripe(CHARGES, async () => { await quiet(() => importStripe(env, FOUNDER_A)); });
  const uid = (db.prepare(`SELECT uid FROM revenue_entries WHERE source_ref = 'ch_2'`).get() as any).uid;
  for (const patch of [{ amount_cents: 9999 }, { amount: '99.99' }, { received_on: '2026-09-02' }, { customer: 'Somebody' }]) {
    const r = await quiet(() => call(env, 'PATCH', `/projects/1/entries/${uid}`, FOUNDER_A, patch));
    assert.equal(r.status, 409, `a synced entry accepted ${JSON.stringify(patch)}`);
    assert.equal(r.body.error, 'synced_entry_locked');
  }
  const same = await quiet(() => call(env, 'PATCH', `/projects/1/entries/${uid}`, FOUNDER_A,
    { amount_cents: 7500, received_on: '2026-09-15', customer: 'cus_Alpha1', revenue_type: 'pilot', notes: 'Pilot fee', proof_document_id: 500 }));
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.entry.revenue_type, 'pilot');
  assert.equal(same.body.entry.verification, 'verified', 'attaching proof demoted a Stripe entry');
  assert.equal(same.body.entry.amount_cents, 7500);
  // A manual entry stays editable.
  const m = await quiet(() => call(env, 'POST', '/projects/1/entries', FOUNDER_A,
    { customer: 'Northwind', amount_cents: 1000, revenue_type: 'one_time', received_on: '2026-09-01' }));
  const edited = await quiet(() => call(env, 'PATCH', `/projects/1/entries/${m.body.entry.uid}`, FOUNDER_A, { amount_cents: 2000 }));
  assert.equal(edited.status, 200);
});

test('chargeToEntry: refunds, currency, customer, type and date', () => {
  const base = { id: 'ch_x', amount: 1000, amount_refunded: 0, currency: 'usd', created: DAY('2026-12-31'), customer: 'cus_X1', invoice: false };
  assert.deepEqual(chargeToEntry(base), { kind: 'entry', entry: { source_ref: 'ch_x', customer: 'cus_X1', amount_cents: 1000, revenue_type: 'one_time', received_on: '2026-12-31' } });
  assert.deepEqual(chargeToEntry({ ...base, amount_refunded: 1000 }), { kind: 'skip', reason: 'fully_refunded' });
  assert.equal((chargeToEntry({ ...base, amount_refunded: 999 }) as any).entry.amount_cents, 1);
  assert.equal(chargeToEntry({ ...base, currency: 'USD' }).kind, 'entry');
  assert.equal((chargeToEntry({ ...base, currency: 'gbp' }) as any).code, 'currency_unsupported');
  assert.equal((chargeToEntry({ ...base, customer: 'Ada Lovelace' }) as any).entry.customer, STRIPE_NO_CUSTOMER, 'a name was stored as the customer');
  assert.equal((chargeToEntry({ ...base, invoice: true }) as any).entry.revenue_type, 'recurring');
  assert.equal((chargeToEntry({ ...base, created: 0 }) as any).code, 'invalid_received_on');
});

test('migration 400 declares the index the Worker heals', () => {
  const mig = MIG('400_revenue_stripe_charge_index.sql');
  assert.match(mig, /CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_entries_stripe_charge\s+ON revenue_entries\(project_id, source_ref\) WHERE source = 'stripe'/);
  const svc = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/revenueLedger.ts'), 'utf8');
  assert.match(svc, /CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_entries_stripe_charge\s+ON revenue_entries\(project_id, source_ref\) WHERE source = 'stripe'/);
});
