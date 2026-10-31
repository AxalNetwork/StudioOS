/**
 * D1415 (#3697, part 1) — a company's legal record, sealed tax ID, officers,
 * locations and slug (migration 685), on real SQLite: the baseline's tables,
 * migrations 597 and 685 over them, and the router mounted as `index.ts`
 * mounts it. Every person and company below is made up.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/company_legal_d1415.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyLegal from '../src/routes/company_legal.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M597 = readFileSync(new URL('../sql/migrations/597_company_archive_and_events.sql', import.meta.url), 'utf8');
const M685 = readFileSync(new URL('../sql/migrations/685_company_legal_record_and_slugs.sql', import.meta.url), 'utf8');
// D1593 (#3861): 749 adds the registered agent and the mailing kind, which the routes read.
const M749 = readFileSync(new URL('../sql/migrations/749_company_registered_agent_and_mailing.sql', import.meta.url), 'utf8');

// Ada is the primary admin of Northwind; Ben is a plain member; Cy is a Founder-role member (an editor);
// Dee belongs to no company; Eve is a platform admin. Southwind is Dee's own company.
const ADA = 1, BEN = 2, CY = 3, DEE = 4, EVE = 5;
const NORTH = 1, SOUTH = 2;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [CY]: 'founder', [DEE]: 'founder', [EVE]: 'admin' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M597);
  db.exec(M685);
  db.exec(M749);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [CY, 'Cy'], [DEE, 'Dee'], [EVE, 'Eve']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind'); c.run(SOUTH, 'co-south', 'Southwind');
  const l = db.prepare('INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  l.run('l-1', NORTH, ADA, 'Admin', 1, '2026-01-01');
  l.run('l-2', NORTH, BEN, 'Member', 0, '2026-01-02');
  l.run('l-3', NORTH, CY, 'Founder', 0, '2026-01-03');
  l.run('l-4', SOUTH, DEE, 'Admin', 1, '2026-01-04');
  return db;
}

const envOf = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
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

const WRITES: Array<[string, string, unknown]> = [
  ['PUT', '/api/company/co-north/legal', { legal_name: 'Northwind Holdings Inc.' }],
  ['PUT', '/api/company/co-north/tax-id', { kind: 'ein', tax_id: '12-3456789' }],
  ['POST', '/api/company/co-north/officers', { name: 'Ada Made-up', office: 'officer', title: 'CEO' }],
  ['POST', '/api/company/co-north/locations', { kind: 'office', country: 'GB' }],
  ['PUT', '/api/company/co-north/slug', { slug: 'northwind' }],
];

// ── Gates ───────────────────────────────────────────────────────────────────

test('gates: a non-member reads 404 everywhere; a member reads; a member who is not an editor gets 403 on every write', async () => {
  // Mutations checked: the member check dropped from accessOf (Dee reads 200); `editor` forced true (Ben writes 200).
  const db = fixture(); const env = envOf(db);
  for (const path of ['/api/company/co-north/legal', '/api/company/co-north/tax-id', '/api/company/co-north/officers', '/api/company/co-north/locations']) {
    assert.equal((await call(env, DEE, 'GET', path)).status, 404, `non-member on ${path}`);
    assert.equal((await call(env, BEN, 'GET', path)).status, 200, `member on ${path}`);
  }
  assert.equal((await call(env, DEE, 'GET', '/api/company/co-nowhere/legal')).status, 404, 'unknown reads the same 404 as a non-member');
  for (const [m, p, b] of WRITES) {
    assert.equal((await call(env, DEE, m, p, b)).status, 404, `non-member write ${p}`);
    assert.equal((await call(env, BEN, m, p, b)).status, 403, `plain member write ${p}`);
  }
  const legal = await call(env, BEN, 'GET', '/api/company/co-north/legal');
  assert.equal(legal.body.can_edit, false);
  assert.equal(legal.body.legal_name, null, 'nothing recorded reads null, not a placeholder');
  assert.equal(legal.body.officers.available, true);
  assert.deepEqual(legal.body.officers.value, []);
  assert.equal(legal.body.registered_address.value, null);
});

test('gates: a Founder-role member, the primary admin and a platform admin each write', async () => {
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, CY, 'PUT', '/api/company/co-north/legal', { legal_form: 'c_corp' })).status, 200);
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/legal', { jurisdiction: 'us-de' })).status, 200);
  const eve = await call(env, EVE, 'PUT', '/api/company/co-north/legal', { registration_number: '7654321' });
  assert.equal(eve.status, 200);
  const row = db.prepare('SELECT legal_form, jurisdiction, registration_number FROM company_profiles WHERE id = ?').get(NORTH) as any;
  assert.deepEqual({ ...row }, { legal_form: 'c_corp', jurisdiction: 'US-DE', registration_number: '7654321' });
  const audit = db.prepare("SELECT details FROM activity_logs WHERE action = 'company_legal_updated'").all() as any[];
  assert.equal(audit.length, 1, 'only the admin write is audited');
});

// ── Legal record ────────────────────────────────────────────────────────────

test('legal: partial writes, null clears, and every bad field is refused with its code and nothing changes', async () => {
  // Mutations checked: legal_form not checked against the list; the real-date check reduced to the shape (2026-02-30 passes).
  const db = fixture(); const env = envOf(db);
  const first = await call(env, ADA, 'PUT', '/api/company/co-north/legal', {
    legal_name: '  Northwind Holdings Inc.  ', legal_form: 'c_corp', jurisdiction: 'US-DE', registration_number: '7654321', incorporation_date: '2025-03-14',
  });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.legal_name, 'Northwind Holdings Inc.', 'trimmed');
  const cleared = await call(env, ADA, 'PUT', '/api/company/co-north/legal', { registration_number: null });
  assert.equal(cleared.body.registration_number, null);
  assert.equal(cleared.body.legal_form, 'c_corp', 'a field not sent is kept');
  for (const [body, code] of [
    [{ legal_form: 'corporation' }, 'legal_form_invalid'],
    [{ incorporation_date: '14/03/2025' }, 'incorporation_date_invalid'],
    [{ incorporation_date: '2026-02-30' }, 'incorporation_date_invalid'],
    [{ jurisdiction: 'Delaware' }, 'jurisdiction_invalid'],
    [{ legal_name: 'x'.repeat(201) }, 'text_too_long'],
    [{ legal_name: 42 }, 'field_invalid'],
  ] as const) {
    const res = await call(env, ADA, 'PUT', '/api/company/co-north/legal', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, code);
  }
  const row = db.prepare('SELECT legal_form, incorporation_date, jurisdiction FROM company_profiles WHERE id = ?').get(NORTH) as any;
  assert.deepEqual({ ...row }, { legal_form: 'c_corp', incorporation_date: '2025-03-14', jurisdiction: 'US-DE' });
});

test('an archived company is read but takes no write', async () => {
  const db = fixture(); const env = envOf(db);
  db.prepare("UPDATE company_profiles SET archived_at = '2026-05-01' WHERE id = ?").run(NORTH);
  const legal = await call(env, ADA, 'GET', '/api/company/co-north/legal');
  assert.equal(legal.status, 200);
  assert.equal(legal.body.archived, true);
  assert.equal(legal.body.can_edit, false);
  for (const [m, p, b] of WRITES) {
    const res = await call(env, ADA, m, p, b);
    assert.equal(res.status, 409, p);
    assert.equal(res.body.error, 'archived');
  }
});

// ── Tax ID ──────────────────────────────────────────────────────────────────

test('tax ID: sealed v1 only, bound to its company, the number to an editor and never to an admin, a refusal never echoes', async () => {
  // Mutations checked: `!a.admin` dropped from `full` (Eve reads the number); the AAD built with a constant
  // instead of the company id (the copied ciphertext decrypts); the value echoed in the 400 body.
  const db = fixture(); const env = envOf(db);
  const put = await call(env, ADA, 'PUT', '/api/company/co-north/tax-id', { kind: 'ein', tax_id: '12-3456789' });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual({ last4: put.body.last4, recorded: put.body.recorded }, { last4: '6789', recorded: true });
  assert.ok(!put.text.includes('3456789'), 'the write answer never carries the number');
  const row = db.prepare('SELECT tax_id_enc, tax_id_last4 FROM company_tax_ids WHERE company_id = ?').get(NORTH) as any;
  assert.match(row.tax_id_enc, /^v1\./);
  assert.ok(!row.tax_id_enc.includes('3456789'));
  assert.equal(await decryptColumn(env, 'company_tax_ids', 'tax_id_enc', NORTH, row.tax_id_enc), '12-3456789');
  assert.equal(await decryptColumn(env, 'company_tax_ids', 'tax_id_enc', SOUTH, row.tax_id_enc), null, 'a ciphertext copied to another company does not open');

  const ben = await call(env, BEN, 'GET', '/api/company/co-north/tax-id?full=1');
  assert.equal(ben.body.last4, '6789');
  assert.ok(!('tax_id' in ben.body), 'a member who is not an editor gets the last four only');
  const ada = await call(env, ADA, 'GET', '/api/company/co-north/tax-id?full=1');
  assert.equal(ada.body.tax_id, '12-3456789', 'an editor reads their own edit field');
  const eve = await call(env, EVE, 'GET', '/api/company/co-north/tax-id?full=1');
  assert.equal(eve.status, 200);
  assert.ok(!('tax_id' in eve.body), 'a platform admin never reads the number');
  assert.ok(!eve.text.includes('3456789'));

  const refused = await call(env, ADA, 'PUT', '/api/company/co-north/tax-id', { kind: 'ein', tax_id: '987654321-SECRET' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'tax_id_invalid');
  assert.ok(!refused.text.includes('987654321') && !refused.text.includes('SECRET'), 'a refused value is never echoed');
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/tax-id', { kind: 'ssn', tax_id: '12-3456789' })).body.error, 'tax_id_kind_invalid');

  const vat = await call(env, EVE, 'PUT', '/api/company/co-north/tax-id', { kind: 'vat', tax_id: 'gb 123 4567 89' });
  assert.equal(vat.status, 200, 'an admin writes');
  assert.equal(vat.body.last4, '6789');
  const audit = db.prepare("SELECT details FROM activity_logs WHERE action = 'company_tax_id_recorded'").all() as any[];
  assert.equal(audit.length, 1);
  assert.ok(!audit[0].details.includes('123456789') && !audit[0].details.includes('6789'), 'the audit row carries no digits');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM company_tax_ids').get() as any).n, 1, 'one tax ID per company, replaced');
});

// ── Officers ────────────────────────────────────────────────────────────────

test('officers: added, edited, ceased and never deleted; a second cease is 409; a linked account must be a member', async () => {
  // Mutations checked: cease written as a DELETE (the row count drops); the already-ceased check dropped;
  // the appointed/ceased order check dropped.
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/officers', { name: 'Dee', office: 'director', title: 'Chair', user_id: DEE })).body.error, 'user_not_member');
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/officers', { name: 'Ada', office: 'chief', title: 'CEO' })).body.error, 'office_invalid');
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/officers', { name: '  ', office: 'officer', title: 'CEO' })).body.error, 'name_required');
  const add = await call(env, ADA, 'POST', '/api/company/co-north/officers', { name: 'Ada Made-up', office: 'officer', title: 'CEO', appointed_on: '2025-03-14', user_id: ADA });
  assert.equal(add.status, 201, add.text);
  const uid = add.body.uid;
  const edit = await call(env, CY, 'PATCH', `/api/company/co-north/officers/${uid}`, { title: 'CEO and Secretary' });
  assert.equal(edit.body.title, 'CEO and Secretary');
  assert.equal(edit.body.appointed_on, '2025-03-14', 'a field not sent is kept');
  const early = await call(env, ADA, 'POST', `/api/company/co-north/officers/${uid}/cease`, { ceased_on: '2025-01-01' });
  assert.equal(early.body.error, 'ceased_on_before_appointed');
  const cease = await call(env, ADA, 'POST', `/api/company/co-north/officers/${uid}/cease`, { ceased_on: '2026-06-30' });
  assert.equal(cease.status, 200);
  assert.equal(cease.body.ceased_on, '2026-06-30');
  assert.equal((await call(env, ADA, 'POST', `/api/company/co-north/officers/${uid}/cease`, {})).status, 409);
  assert.equal((await call(env, ADA, 'PATCH', `/api/company/co-north/officers/${uid}`, { title: 'X' })).body.error, 'already_ceased');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM company_officers').get() as any).n, 1, 'the ceased officer is kept');
  const list = await call(env, BEN, 'GET', '/api/company/co-north/officers');
  assert.equal(list.body.officers.length, 1);
  assert.equal((await call(env, ADA, 'PATCH', '/api/company/co-south/officers/' + uid, { title: 'X' })).status, 404, 'another company\'s officer path is not found for a non-member');
});

// ── Locations ───────────────────────────────────────────────────────────────

test('locations: one open registered address, closed rather than deleted, which then frees the slot', async () => {
  // Mutations checked: the pre-check and the index fallback both removed (a second open registered address lands);
  // close written as a DELETE.
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'registered', country: 'United Kingdom' })).body.error, 'country_invalid');
  const reg = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'registered', line1: '1 Made-up Street', city: 'London', country: 'gb' });
  assert.equal(reg.status, 201, reg.text);
  assert.equal(reg.body.country, 'GB');
  const second = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'registered', country: 'US' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'registered_exists');
  const office = await call(env, ADA, 'POST', '/api/company/co-north/locations', { kind: 'office', city: 'Paris', country: 'FR' });
  assert.equal(office.status, 201);
  assert.equal((await call(env, ADA, 'PATCH', `/api/company/co-north/locations/${office.body.uid}`, { kind: 'registered' })).body.error, 'registered_exists');

  const legal = await call(env, BEN, 'GET', '/api/company/co-north/legal');
  assert.equal(legal.body.registered_address.value.uid, reg.body.uid, 'the registered address is the open registered location');

  const close = await call(env, ADA, 'POST', `/api/company/co-north/locations/${reg.body.uid}/close`, { closed_on: '2026-06-30' });
  assert.equal(close.body.closed_on, '2026-06-30');
  assert.equal((await call(env, ADA, 'POST', `/api/company/co-north/locations/${reg.body.uid}/close`, {})).body.error, 'already_closed');
  assert.equal((await call(env, ADA, 'PATCH', `/api/company/co-north/locations/${office.body.uid}`, { kind: 'registered' })).status, 200, 'the slot is free once the old one is closed');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM company_locations').get() as any).n, 2, 'the closed address is kept');
});

// ── Company slug ────────────────────────────────────────────────────────────

test('slug: shape and reserved words, unique among companies, and the old slug retired in the same batch and kept for its company', async () => {
  // Mutations checked: the history insert run after the batch instead of in it (a failing UPDATE leaves the history row);
  // slugHolder reading only current slugs (Dee claims Northwind's retired slug).
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: '-north' })).body.error, 'slug_invalid');
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'settings' })).body.error, 'slug_reserved');
  const first = await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'Northwind' });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual(first.body, { slug: 'northwind', path: '/c/northwind', previous_slug: null });
  assert.equal((await call(env, DEE, 'PUT', '/api/company/co-south/slug', { slug: 'northwind' })).body.error, 'slug_taken');

  const renamed = await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'northwind-holdings' });
  assert.equal(renamed.body.previous_slug, 'northwind');
  const history = db.prepare('SELECT kind, scope_company_id, slug, target_id, retired_by FROM slug_history').all() as any[];
  assert.deepEqual(history.map((h) => ({ ...h })), [{ kind: 'company', scope_company_id: null, slug: 'northwind', target_id: NORTH, retired_by: ADA }]);
  const taken = await call(env, DEE, 'PUT', '/api/company/co-south/slug', { slug: 'northwind' });
  assert.equal(taken.status, 409, 'a retired slug stays with its company');
  assert.equal(taken.body.error, 'slug_taken');
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'northwind' })).status, 200, 'its own company may take it back');
  assert.equal((await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'northwind-holdings' })).status, 200, 'and leave it again without a history clash');

  // The batch: when the history insert fails, the rename does not land either.
  db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON slug_history WHEN NEW.slug = 'northwind-holdings' BEGIN SELECT RAISE(ABORT, 'forced'); END;");
  const failed = await call(env, ADA, 'PUT', '/api/company/co-north/slug', { slug: 'boom' });
  assert.notEqual(failed.status, 200, 'the forced failure is not reported as a rename');
  assert.equal((db.prepare('SELECT slug FROM company_profiles WHERE id = ?').get(NORTH) as any).slug, 'northwind-holdings', 'no rename without its history');
});
