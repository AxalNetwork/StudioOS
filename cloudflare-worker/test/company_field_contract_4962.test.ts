/**
 * D4962 (#4962) — a company's General fields have one contract.
 *
 * The golden cases in `fixtures/company_field_cases.json` run through the
 * validator; the same cases then run as direct API calls on real SQLite, so a
 * request that skips the page cannot persist what the page would refuse. The
 * migration's triggers are checked on their own against legacy rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_field_contract_4962.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import { validateCompanyFields, GENERAL_FIELDS, normalizeLinkedIn, normalizeWebsite } from '../src/services/companyProfileFields.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const CASES: { field: string; input: unknown; repeat?: number; ok?: unknown; okRepeat?: number; code?: string }[] = JSON.parse(
  readFileSync(new URL('./fixtures/company_field_cases.json', import.meta.url), 'utf8'),
).cases;
const inputOf = (c: (typeof CASES)[number]) => (c.repeat ? String(c.input).repeat(c.repeat) : c.input);
const okOf = (c: (typeof CASES)[number]) => (c.okRepeat ? String(c.ok).repeat(c.okRepeat) : c.ok);

const TRIGGERS = '202611072301_company_profiles_field_triggers.sql';
const ADA = 1;
const NORTH = 1;

function fixture(withTriggers = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  // #5654: install the production decision CHECK used by profile/logo batches.
  db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/202611071200_program_grant_revisions.sql', import.meta.url), 'utf8'), 'decision_guard'));
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['597_company_archive_and_events.sql', '685_company_legal_record_and_slugs.sql', '757_company_default_currency.sql', '202611031619_company_logo_change_event.sql', '202611072255_company_profile_version.sql', '202611072325_company_region_codes.sql']) db.exec(mig(m));
  if (withTriggers) db.exec(mig(TRIGGERS));
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)').run(ADA, 'founder', 'Ada Made-up', 'ada@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, stage, website, logo_url, created_at, updated_at) VALUES (?, ?, ?, 'seed', 'https://old.example', 'https://elsewhere.example/legacy.png', '2026-01-01', '2026-01-01')").run(NORTH, 'co-north', 'Northwind');
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES ('l-1', ?, ?, 'Owner', 1, '2026-01-01')").run(NORTH, ADA);
  return db;
}
const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, raw?: string) {
  const token = await new SignJWT({ user_id: ADA, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono(); app.route('/api', companyRoutes);
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }, envOf(db));
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const row = (db: DatabaseSync) => db.prepare('SELECT * FROM company_profiles WHERE id = ?').get(NORTH) as any;

test('every golden case, through the validator', () => {
  for (const c of CASES) {
    const r = validateCompanyFields({ [c.field]: inputOf(c) });
    const label = `${c.field} ← ${JSON.stringify(String(inputOf(c)).slice(0, 40))}`;
    if (c.code) {
      assert.equal(r.ok, false, label);
      assert.equal((r as any).code, c.code, label);
      assert.equal((r as any).field, c.field, label);
    } else {
      assert.equal(r.ok, true, `${label}: ${JSON.stringify(r)}`);
      assert.equal((r as any).values[c.field], okOf(c), label);
    }
  }
});

test('the same cases by direct PATCH: the good ones are stored canonical, the bad ones change nothing', async () => {
  for (const c of CASES) {
    const db = fixture();
    const before = row(db);
    const r = await call(db, 'PATCH', '/api/company/co-north', { [c.field]: inputOf(c) });
    const label = `${c.field} ← ${JSON.stringify(String(inputOf(c)).slice(0, 40))}`;
    if (c.code) {
      // Mutation checked: the validator out of the route → stage 'Seed', -1 employees and javascript: websites are stored.
      assert.deepEqual([r.status, r.body.code, r.body.field], [400, c.code, c.field], label);
      assert.deepEqual(row(db), before, `${label}: nothing was written`);
    } else {
      assert.equal(r.status, 200, `${label}: ${r.text}`);
      assert.equal(row(db)[c.field], okOf(c), label);
    }
  }
});

test('unknown fields, a link in place of an upload, and a body that is not an object are refused', async () => {
  const db = fixture(); const before = row(db);
  const unknown = await call(db, 'PATCH', '/api/company/co-north', { description: 'x', archived_at: '2026-01-01' });
  assert.deepEqual([unknown.status, unknown.body.code, unknown.body.field], [400, 'unknown_field', 'archived_at']);
  const logo = await call(db, 'PATCH', '/api/company/co-north', { logo_url: 'https://evil.example/pixel.png' });
  assert.deepEqual([logo.status, logo.body.code], [400, 'logo_url_not_writable']);
  assert.match(logo.body.detail, /POST or DELETE \/company\/:uid\/logo/);
  for (const raw of ['null', '[]', '"text"', '7']) {
    const r = await call(db, 'PATCH', '/api/company/co-north', undefined, raw);
    assert.deepEqual([r.status, r.body.code], [400, 'body_invalid'], raw);
  }
  assert.deepEqual(row(db), before, 'none of them wrote');
});

test('an existing outside logo URL stays readable and survives other edits; only the logo routes touch it', async () => {
  const db = fixture();
  assert.equal((await call(db, 'PATCH', '/api/company/co-north', { description: 'Edited' })).status, 200);
  assert.equal(row(db).logo_url, 'https://elsewhere.example/legacy.png', 'a rename or an edit leaves the legacy link alone');
  const read = await call(db, 'GET', '/api/company/co-north');
  assert.equal(read.body.logo_url, 'https://elsewhere.example/legacy.png', 'and it is still served');
  const removed = await call(db, 'DELETE', '/api/company/co-north/logo');
  assert.equal(removed.status, 200);
  assert.equal(row(db).logo_url, null, 'Remove clears it');
});

test('create takes the same contract; a logo link is refused and a new company starts with none', async () => {
  const db = fixture();
  const bad = await call(db, 'POST', '/api/company/create', { company_name: 'Southwind', stage: 'unicorn' });
  assert.deepEqual([bad.status, bad.body.code], [400, 'stage_invalid']);
  const link = await call(db, 'POST', '/api/company/create', { company_name: 'Southwind', logo_url: 'https://evil.example/pixel.png' });
  assert.deepEqual([link.status, link.body.code], [400, 'logo_url_not_writable']);
  assert.equal(await call(db, 'POST', '/api/company/create', undefined, 'null').then((r) => r.status), 400, 'a null body is a 400, not a 500');
  assert.equal((db.prepare("SELECT COUNT(*) n FROM company_profiles WHERE company_name = 'Southwind'").get() as any).n, 0, 'nothing was created');
  const ok = await call(db, 'POST', '/api/company/create', { company_name: 'Southwind', stage: 'seed', website: 'southwind.example', employee_count: '8', international_presence: 'EU, eu, US' });
  assert.equal(ok.status, 200, ok.text);
  const made = db.prepare("SELECT stage, website, employee_count, international_presence, logo_url FROM company_profiles WHERE company_name = 'Southwind'").get() as any;
  assert.deepEqual({ ...made }, { stage: 'seed', website: 'https://southwind.example', employee_count: 8, international_presence: 'EU, US', logo_url: null });
});

test('the field lists agree: the route writes exactly the General fields the validator knows', () => {
  const src = readFileSync(new URL('../src/routes/company.ts', import.meta.url), 'utf8');
  const patch = src.slice(src.indexOf("r.patch('/company/:uid'"), src.indexOf("r.get('/company/:uid'"));
  assert.ok(!patch.includes("'logo_url'") && !/const updatable/.test(patch), 'PATCH has no writable list that names logo_url');
  assert.ok(src.includes('for (const f of GENERAL_FIELDS)'), 'PATCH writes from GENERAL_FIELDS');
  assert.deepEqual([...GENERAL_FIELDS].sort(), ['company_name', 'current_products', 'default_currency', 'description', 'employee_count', 'expansion_goals', 'international_presence', 'linkedin_url', 'revenue_range', 'stage', 'website']);
  assert.equal(normalizeWebsite('example.com'), 'https://example.com');
  assert.equal(normalizeLinkedIn('https://linkedin.com/company/x'), 'https://www.linkedin.com/company/x');
});

// ── The triggers ────────────────────────────────────────────────────────────

test('the triggers refuse an unsupported stage and a bad head count on a new write, and leave legacy rows alone', () => {
  const db = fixture(false);
  // A legacy row from before any validation, written while no trigger existed.
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, stage, employee_count, created_at, updated_at) VALUES (9, 'co-old', 'Oldco', 'Series A', -3, '2026-01-01', '2026-01-01')").run();
  db.exec(mig(TRIGGERS));
  const abort = (sql: string, ...args: unknown[]) => assert.throws(() => db.prepare(sql).run(...(args as any[])), /company_profiles\./);
  // Mutation checked: a trigger dropped → its statement succeeds and this fails.
  abort("UPDATE company_profiles SET stage = 'unicorn' WHERE id = ?", NORTH);
  abort('UPDATE company_profiles SET employee_count = -1 WHERE id = ?', NORTH);
  abort('UPDATE company_profiles SET employee_count = 2.5 WHERE id = ?', NORTH);
  abort("UPDATE company_profiles SET employee_count = 'many' WHERE id = ?", NORTH);
  abort('UPDATE company_profiles SET employee_count = 1000001 WHERE id = ?', NORTH);
  abort("INSERT INTO company_profiles (uid, company_name, stage, created_at, updated_at) VALUES ('x', 'X', 'nope', 'n', 'n')");
  abort("INSERT INTO company_profiles (uid, company_name, employee_count, created_at, updated_at) VALUES ('y', 'Y', -5, 'n', 'n')");
  // Valid writes and nulls pass.
  db.prepare("UPDATE company_profiles SET stage = 'growth', employee_count = 1000000 WHERE id = ?").run(NORTH);
  db.prepare('UPDATE company_profiles SET stage = NULL, employee_count = NULL WHERE id = ?').run(NORTH);
  // The legacy row is still readable and renameable, because the triggers fire only on the column being set.
  db.prepare("UPDATE company_profiles SET company_name = 'Oldco 2', archived_at = '2026-02-01' WHERE id = 9").run();
  assert.deepEqual({ ...(db.prepare('SELECT company_name, stage, employee_count FROM company_profiles WHERE id = 9').get() as any) }, { company_name: 'Oldco 2', stage: 'Series A', employee_count: -3 });
});
