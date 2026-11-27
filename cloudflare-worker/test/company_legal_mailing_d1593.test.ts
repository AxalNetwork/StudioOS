/**
 * D1593 (#3861, migration 749) — the company's registered agent and one open
 * mailing address, on real SQLite: the baseline's tables, migrations 597, 685
 * and 749 over them, and the router mounted as `index.ts` mounts it. Every
 * person and company below is made up.
 *
 *   · the migration keeps every location row and its id, re-creates the
 *     registered index and adds the mailing one;
 *   · an editor sets and clears the agent; a member reads it; a member who is
 *     not an editor gets 403; an archived company takes no write;
 *   · `mailing_address` is a block beside `registered_address`: null when none
 *     is open, unavailable (never null) when the locations read fails;
 *   · a second open mailing address is 409 `mailing_exists`; closing frees it.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_legal_mailing_d1593.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyLegal from '../src/routes/company_legal.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');
const M749 = readFileSync(new URL('../sql/migrations/749_company_registered_agent_and_mailing.sql', import.meta.url), 'utf8');

// Ada is Northwind's primary admin (an editor); Ben is a plain member.
const ADA = 1, BEN = 2;
const NORTH = 1;

/** The schema up to 685; `upgrade` runs 749 over it, after any rows the caller seeds. */
function base() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597);
  db.exec(M685);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', ?, ?, 1)");
  u.run(ADA, 'Ada Made-up', 'ada@example.test'); u.run(BEN, 'Ben Made-up', 'ben@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, 'co-north', 'Northwind', '2026-01-01', '2026-01-01')").run(NORTH);
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  l.run('l-1', NORTH, ADA, 'Admin', 1, '2026-01-01');
  l.run('l-2', NORTH, BEN, 'Member', 0, '2026-01-02');
  return db;
}
const upgrade = (db: DatabaseSync) => { db.exec(M749); return db; };
const fixture = () => upgrade(base());
const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono();
  app.route('/api', companyLegal);
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

test('749 keeps every location row with its id, re-creates the registered index, and adds one open mailing per company', () => {
  const db = base();
  const ins = db.prepare(`INSERT INTO company_locations (id, uid, company_id, kind, label, line1, city, country, closed_on, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run(7, 'loc-a', NORTH, 'registered', 'Registered', '1 Made-up Street', 'London', 'GB', null, ADA, null, '2026-02-01', '2026-02-01');
  ins.run(12, 'loc-b', NORTH, 'office', 'Paris office', null, 'Paris', 'FR', null, ADA, BEN, '2026-02-02', '2026-03-01');
  ins.run(40, 'loc-c', NORTH, 'registered', 'Old registered', null, null, 'US', '2026-01-31', ADA, null, '2026-01-01', '2026-01-31');
  const before = db.prepare('SELECT * FROM company_locations ORDER BY id').all();
  upgrade(db);
  assert.deepEqual(db.prepare('SELECT * FROM company_locations ORDER BY id').all(), before, 'every row, id and column as it was');
  assert.equal((db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'company_locations'").get() as any)?.seq ?? 40, 40);
  const idx = (db.prepare("PRAGMA index_list('company_locations')").all() as any[]).map((i) => i.name).sort();
  assert.ok(idx.includes('idx_company_locations_one_registered'), 'the registered index is re-created');
  assert.ok(idx.includes('idx_company_locations_one_mailing'));
  const add = db.prepare("INSERT INTO company_locations (uid, company_id, kind, country, created_by) VALUES (?, ?, ?, 'GB', ?)");
  assert.throws(() => add.run('loc-d', NORTH, 'registered', ADA), /UNIQUE/, 'still one open registered address');
  add.run('loc-e', NORTH, 'mailing', ADA);
  assert.throws(() => add.run('loc-f', NORTH, 'mailing', ADA), /UNIQUE/, 'one open mailing address');
  assert.throws(() => add.run('loc-g', NORTH, 'postal', ADA), /CHECK/, 'the kind is still checked');
  assert.equal((db.prepare('SELECT registered_agent_name FROM company_profiles WHERE id = ?').get(NORTH) as any).registered_agent_name, null, 'nothing is backfilled');
  // The next id continues after the copied ones.
  assert.ok((db.prepare("SELECT id FROM company_locations WHERE uid = 'loc-e'").get() as any).id > 40);
});

test('the registered agent: an editor sets and clears it, a member reads it, a non-editor and an archived company take no write', async () => {
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, BEN, 'GET', '/api/company/co-north/legal')).body.registered_agent_name, null, 'not recorded is null');
  const set = await call(env, ADA, 'PUT', '/api/company/co-north/legal', { registered_agent_name: '  Made-up Agents LLC ' });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.body.registered_agent_name, 'Made-up Agents LLC');
  assert.deepEqual(set.body.changed, ['registered_agent_name']);
  assert.equal((await call(env, BEN, 'GET', '/api/company/co-north/legal')).body.registered_agent_name, 'Made-up Agents LLC');
  // Another field's write leaves the agent as it was.
  await call(env, ADA, 'PUT', '/api/company/co-north/legal', { legal_name: 'Northwind Holdings Inc.' });
  assert.equal((db.prepare('SELECT registered_agent_name FROM company_profiles WHERE id = ?').get(NORTH) as any).registered_agent_name, 'Made-up Agents LLC');
  const tooLong = await call(env, ADA, 'PUT', '/api/company/co-north/legal', { registered_agent_name: 'x'.repeat(201) });
  assert.deepEqual([tooLong.status, tooLong.body.error], [400, 'text_too_long']);
  assert.equal((await call(env, BEN, 'PUT', '/api/company/co-north/legal', { registered_agent_name: 'Ben' })).status, 403);
  const cleared = await call(env, ADA, 'PUT', '/api/company/co-north/legal', { registered_agent_name: null });
  assert.equal(cleared.body.registered_agent_name, null, 'null clears it');
  db.prepare("UPDATE company_profiles SET archived_at = '2026-05-01' WHERE id = ?").run(NORTH);
  const archived = await call(env, ADA, 'PUT', '/api/company/co-north/legal', { registered_agent_name: 'Late Agent' });
  assert.deepEqual([archived.status, archived.body.error], [409, 'archived']);
});

test('the mailing address: a block beside the registered one; one open; closing frees it; a failed read is unavailable, never null', async () => {
  const db = fixture(); const env = envOf(db);
  const empty = await call(env, BEN, 'GET', '/api/company/co-north/legal');
  assert.deepEqual(empty.body.mailing_address, { available: true, value: null }, 'none open is null inside an available block');
  const bad = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'postal', country: 'GB' });
  assert.equal(bad.body.error, 'kind_invalid');
  assert.match(bad.body.message, /mailing/, 'the refusal lists mailing');
  const mail = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'mailing', label: 'PO box', line1: 'PO Box 1', city: 'London', country: 'GB' });
  assert.equal(mail.status, 201, mail.text);
  const reg = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'registered', line1: '1 Made-up Street', country: 'GB' });
  assert.equal(reg.status, 201, 'a mailing address does not take the registered slot');
  const second = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'mailing', country: 'US' });
  assert.deepEqual([second.status, second.body.error], [409, 'mailing_exists']);
  const office = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'office', city: 'Paris', country: 'FR' });
  const moved = await call(env, ADA, 'PATCH', `/api/company/co-north/locations/${office.body.uid}`, { kind: 'mailing' });
  assert.deepEqual([moved.status, moved.body.error], [409, 'mailing_exists'], 'an edit cannot make a second one either');

  const read = await call(env, BEN, 'GET', '/api/company/co-north/legal');
  assert.equal(read.body.mailing_address.value.uid, mail.body.uid);
  assert.equal(read.body.registered_address.value.uid, reg.body.uid);

  await call(env, ADA, 'POST', `/api/company/co-north/locations/${mail.body.uid}/close`, { closed_on: '2026-06-30' });
  assert.deepEqual((await call(env, BEN, 'GET', '/api/company/co-north/legal')).body.mailing_address, { available: true, value: null }, 'a closed one is not the mailing address');
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'mailing', country: 'GB' })).status, 201, 'closing frees the slot');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM company_locations WHERE kind = 'mailing'").get() as any).n, 2, 'nothing deleted');

  db.exec('DROP TABLE company_locations');
  const failed = await call(env, BEN, 'GET', '/api/company/co-north/legal');
  assert.equal(failed.status, 200);
  assert.equal(failed.body.mailing_address.available, false, 'a failed read is unavailable');
  assert.equal(failed.body.registered_address.available, false);
});
