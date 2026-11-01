/**
 * #3932 (#3696 Q4, migration 757) — a company's default currency, on real
 * SQLite: the baseline's tables, migrations 597, 685 and 757 over them, and
 * `company.ts` mounted at /api as `index.ts` mounts it. Every person and
 * company below is made up.
 *
 *   · 757 keeps every company event with its id and indexes, adds the column
 *     unset, and lets the event log take 'currency_change';
 *   · unset reads null ("Not recorded"), never 'USD';
 *   · an editor sets it, and the change is one company event in the same batch;
 *   · a code off the ISO 4217 list, or not three uppercase letters, is 422
 *     `currency_invalid` with a sentence, and nothing is written;
 *   · a member who is not an editor gets 403 and nothing is written; a
 *     non-member reads 404;
 *   · null clears it; writing the same code again records no event.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_default_currency_3932.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import { ISO_4217_CODES, currencyCode, CURRENCY_INVALID_MESSAGE } from '../src/services/currencies.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');
const M757 = readFileSync(new URL('../sql/migrations/757_company_default_currency.sql', import.meta.url), 'utf8');

// Ada is Northwind's primary admin (an editor); Ben is a plain member; Cy belongs elsewhere.
const ADA = 1, BEN = 2, CY = 3;
const NORTH = 1;

function base() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597);
  db.exec(M685);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', ?, ?, 1)");
  u.run(ADA, 'Ada Made-up', 'ada@example.test'); u.run(BEN, 'Ben Made-up', 'ben@example.test'); u.run(CY, 'Cy Made-up', 'cy@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, 'co-north', 'Northwind', '2026-01-01', '2026-01-01')").run(NORTH);
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  l.run('l-1', NORTH, ADA, 'Admin', 1, '2026-01-01');
  l.run('l-2', NORTH, BEN, 'Member', 0, '2026-01-02');
  return db;
}
const upgrade = (db: DatabaseSync) => { db.exec(M757); return db; };
const fixture = () => upgrade(base());
const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono();
  app.route('/api', companyRoutes);
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
const stored = (db: DatabaseSync) => (db.prepare('SELECT default_currency FROM company_profiles WHERE id = ?').get(NORTH) as any).default_currency;
const events = (db: DatabaseSync) => db.prepare("SELECT kind, actor_user_id, before_json, after_json FROM company_membership_events WHERE kind = 'currency_change' ORDER BY id").all().map((r: any) => ({ ...r }));

test('757 keeps every company event with its id and indexes, adds the column unset, and takes currency_change', () => {
  const db = base();
  const ins = db.prepare('INSERT INTO company_membership_events (id, company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run(5, NORTH, null, ADA, ADA, 'join', null, '{"role_in_company":"Admin"}', '2026-01-01 10:00:00');
  ins.run(19, NORTH, null, ADA, null, 'rename', '{"company_name":"North"}', '{"company_name":"Northwind"}', '2026-02-01 10:00:00');
  const before = db.prepare('SELECT * FROM company_membership_events ORDER BY id').all();
  assert.throws(() => ins.run(20, NORTH, null, ADA, null, 'currency_change', null, null, '2026-03-01'), /CHECK/, 'before 757 the kind is refused');
  upgrade(db);
  assert.deepEqual(db.prepare('SELECT * FROM company_membership_events ORDER BY id').all(), before, 'every row, id and column as it was');
  const idx = (db.prepare("PRAGMA index_list('company_membership_events')").all() as any[]).map((i) => i.name).sort();
  assert.deepEqual(idx, ['idx_company_membership_events_company', 'idx_company_membership_events_project']);
  ins.run(20, NORTH, null, ADA, null, 'currency_change', null, '{"default_currency":"EUR"}', '2026-03-01');
  assert.throws(() => ins.run(21, NORTH, null, ADA, null, 'renamed', null, null, '2026-03-01'), /CHECK/, 'the kind is still checked');
  assert.throws(() => ins.run(22, null, null, ADA, null, 'currency_change', null, null, '2026-03-01'), /CHECK/, 'an event still names a company or a venture');
  assert.equal(stored(db), null, 'nothing is backfilled');
});

test('unset reads null, never USD; a non-member reads 404', async () => {
  const db = fixture(); const env = envOf(db);
  const read = await call(env, BEN, 'GET', '/api/company/co-north');
  assert.equal(read.status, 200, read.text);
  assert.ok('default_currency' in read.body, 'the field is served');
  assert.equal(read.body.default_currency, null);
  assert.equal((await call(env, CY, 'GET', '/api/company/co-north')).status, 404);
});

test('an editor sets it; the change is one company event; a member reads it back', async () => {
  const db = fixture(); const env = envOf(db);
  const set = await call(env, ADA, 'PATCH', '/api/company/co-north', { default_currency: 'EUR' });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.body.default_currency, 'EUR');
  assert.equal(stored(db), 'EUR');
  assert.equal((await call(env, BEN, 'GET', '/api/company/co-north')).body.default_currency, 'EUR');
  assert.deepEqual(events(db), [{ kind: 'currency_change', actor_user_id: ADA, before_json: '{"default_currency":null}', after_json: '{"default_currency":"EUR"}' }]);
  // The same code again changes nothing and records nothing.
  await call(env, ADA, 'PATCH', '/api/company/co-north', { default_currency: 'EUR' });
  assert.equal(events(db).length, 1);
  // Another field's write leaves the currency and the log as they were.
  await call(env, ADA, 'PATCH', '/api/company/co-north', { website: 'https://northwind.example' });
  assert.equal(stored(db), 'EUR');
  assert.equal(events(db).length, 1);
  // A change records before and after; null clears it, and that is an event too.
  await call(env, ADA, 'PATCH', '/api/company/co-north', { default_currency: 'GBP' });
  const cleared = await call(env, ADA, 'PATCH', '/api/company/co-north', { default_currency: null });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.body.default_currency, null);
  assert.deepEqual(events(db).map((e) => [e.before_json, e.after_json]), [
    ['{"default_currency":null}', '{"default_currency":"EUR"}'],
    ['{"default_currency":"EUR"}', '{"default_currency":"GBP"}'],
    ['{"default_currency":"GBP"}', '{"default_currency":null}'],
  ]);
});

test('a code off the list or of the wrong shape is 422 currency_invalid with a sentence, and nothing is written', async () => {
  const db = fixture(); const env = envOf(db);
  await call(env, ADA, 'PATCH', '/api/company/co-north', { default_currency: 'USD' });
  const n = events(db).length;
  for (const bad of ['ABC', 'usd', 'EURO', 'US', ' USD', 'XAU', 'XXX', 840, true, {}]) {
    const r = await call(env, ADA, 'PATCH', '/api/company/co-north', { default_currency: bad, website: 'https://changed.example' });
    assert.equal(r.status, 422, `${JSON.stringify(bad)}: ${r.text}`);
    assert.equal(r.body.code, 'currency_invalid');
    // One fixed sentence: the refusal never echoes what was sent.
    assert.equal(r.body.detail, CURRENCY_INVALID_MESSAGE);
  }
  assert.equal(stored(db), 'USD', 'the stored code is unchanged');
  assert.equal((db.prepare('SELECT website FROM company_profiles WHERE id = ?').get(NORTH) as any).website, null, 'no other field in the refused request is written');
  assert.equal(events(db).length, n, 'no event');
});

test('a member who is not an editor gets 403, and nothing is written', async () => {
  const db = fixture(); const env = envOf(db);
  const r = await call(env, BEN, 'PATCH', '/api/company/co-north', { default_currency: 'EUR' });
  assert.equal(r.status, 403, r.text);
  assert.equal(stored(db), null);
  assert.equal(events(db).length, 0);
  assert.equal((await call(env, CY, 'PATCH', '/api/company/co-north', { default_currency: 'EUR' })).status, 403);
  assert.equal(stored(db), null);
});

test('the list: real currencies in, fund units and metals out', () => {
  for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'XOF', 'XAF']) assert.equal(currencyCode(c), c);
  for (const c of ['XAU', 'XDR', 'XTS', 'XXX', 'USN', 'CHE', 'ABC']) assert.equal(currencyCode(c), null, c);
  for (const c of ISO_4217_CODES) assert.match(c, /^[A-Z]{3}$/);
});
