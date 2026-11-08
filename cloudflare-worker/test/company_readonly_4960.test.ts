/**
 * D4960 (#4960) — HQ and support read a company; its seats write it.
 *
 * Every case below is a direct API call against `company.ts`, `company_legal.ts`
 * and `company_documents.ts` mounted as `index.ts` mounts them, on real SQLite.
 * None depends on whether the page hides a link.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_readonly_4960.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import legalRoutes from '../src/routes/company_legal.ts';
import documentRoutes from '../src/routes/company_documents.ts';
import { companyWriteDenial, viewerCapability } from '../src/services/companyAccess.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');

// Ada: Northwind's primary admin. Ben: a plain member. Fay: a Founder by role. Eve: a platform admin with NO seat.
// Gus: a platform admin who also holds an Admin seat at Northwind. Cy: runs Southwind only.
const ADA = 1, BEN = 2, CY = 3, EVE = 4, FAY = 5, GUS = 6;
const NORTH = 1, SOUTH = 2;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [CY]: 'founder', [EVE]: 'admin', [FAY]: 'founder', [GUS]: 'admin' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['597_company_archive_and_events.sql', '685_company_legal_record_and_slugs.sql', '749_company_registered_agent_and_mailing.sql', '757_company_default_currency.sql', '202611031619_company_logo_change_event.sql', '202611072255_company_profile_version.sql', '202611072325_company_region_codes.sql']) db.exec(mig(m));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [CY, 'Cy'], [EVE, 'Eve'], [FAY, 'Fay'], [GUS, 'Gus']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  const c = db.prepare("INSERT INTO company_profiles (id, uid, company_name, description, created_at, updated_at) VALUES (?, ?, ?, 'Before', '2026-01-01', '2026-01-01')");
  c.run(NORTH, 'co-north', 'Northwind'); c.run(SOUTH, 'co-south', 'Southwind');
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')");
  l.run('l-1', NORTH, ADA, 'Member', 1); l.run('l-2', NORTH, BEN, 'Member', 0); l.run('l-5', NORTH, FAY, 'Founder', 0); l.run('l-6', NORTH, GUS, 'Admin', 0);
  l.run('l-3', SOUTH, CY, 'Admin', 1);
  return db;
}

const logos = () => {
  const store = new Map<string, Uint8Array>();
  return { store, async put(k: string, b: Uint8Array) { store.set(k, new Uint8Array(b)); }, async get() { return null; }, async delete(k: string) { store.delete(k); } };
};
const envOf = (db: DatabaseSync, store: any = logos()): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), COMPANY_LOGOS: store });

async function call(env: any, who: number, method: string, path: string, body?: unknown, claims: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono();
  app.route('/api', companyRoutes); app.route('/api', legalRoutes); app.route('/api', documentRoutes);
  const isForm = body instanceof FormData;
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: isForm ? body : JSON.stringify(body) } : {}),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}

const description = (db: DatabaseSync) => (db.prepare('SELECT description FROM company_profiles WHERE id = ?').get(NORTH) as any).description;
const png = () => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer); dv.setUint32(16, 64); dv.setUint32(20, 64); b.set([8, 6, 0, 0, 0], 24);
  const f = new FormData(); f.append('file', new File([b], 'logo.png', { type: 'image/png' })); return f;
};

const SUPPORT = { impersonated_by: EVE };

test('the rule itself: a seat that edits, a seat that does not, HQ without a seat, a support session', async () => {
  const env = envOf(fixture());
  const users: Record<string, any> = { ada: { id: ADA, role: 'founder' }, ben: { id: BEN, role: 'founder' }, fay: { id: FAY, role: 'founder' }, eve: { id: EVE, role: 'admin' }, gus: { id: GUS, role: 'admin' }, cy: { id: CY, role: 'founder' } };
  const reason = async (who: string, support = false) => (await companyWriteDenial(env, { id: NORTH }, users[who], support))?.reason ?? null;
  assert.deepEqual(
    [await reason('ada'), await reason('fay'), await reason('gus'), await reason('ben'), await reason('eve'), await reason('cy'), await reason('ada', true)],
    [null, null, null, 'not_an_editor', 'hq_access', 'not_an_editor', 'support_session'],
  );
  assert.deepEqual(await viewerCapability(env, { id: NORTH }, users.eve, false), { member: false, can_edit: false, read_only: true, read_only_reason: 'hq_access' });
  assert.deepEqual(await viewerCapability(env, { id: NORTH }, users.gus, false), { member: true, can_edit: true, read_only: false, read_only_reason: null });
});

test('General settings by direct API: HQ without a seat is refused and nothing changes; seats keep their write', async () => {
  const db = fixture(); const env = envOf(db);
  // Mutation checked: `canEdit` back in the gate → Eve's PATCH is 200 and the description changes.
  const eve = await call(env, EVE, 'PATCH', '/api/company/co-north', { description: 'HQ wrote this' });
  assert.deepEqual([eve.status, eve.body.code, eve.body.reason], [403, 'company_read_only', 'hq_access']);
  assert.equal(description(db), 'Before');
  assert.equal((await call(env, BEN, 'PATCH', '/api/company/co-north', { description: 'x' })).status, 403, 'a plain member');
  assert.equal((await call(env, CY, 'PATCH', '/api/company/co-north', { description: 'x' })).status, 403, 'another company\'s admin');
  assert.equal(description(db), 'Before');
  assert.equal((await call(env, ADA, 'PATCH', '/api/company/co-north', { description: 'Primary admin' })).status, 200);
  assert.equal((await call(env, FAY, 'PATCH', '/api/company/co-north', { description: 'Founder' })).status, 200);
  assert.equal((await call(env, GUS, 'PATCH', '/api/company/co-north', { description: 'Admin with a seat' })).status, 200, 'an admin who holds a qualifying seat keeps member behaviour');
  assert.equal(description(db), 'Admin with a seat');
});

test('the logo by direct API: HQ without a seat cannot upload or remove; nothing is stored', async () => {
  const db = fixture(); const objects = logos(); const env = envOf(db, objects);
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/logo', png())).status, 200);
  const stored = [...objects.store.keys()];
  const up = await call(env, EVE, 'POST', '/api/company/co-north/logo', png());
  assert.deepEqual([up.status, up.body.code], [403, 'company_read_only']);
  const del = await call(env, EVE, 'DELETE', '/api/company/co-north/logo');
  assert.deepEqual([del.status, del.body.reason], [403, 'hq_access']);
  assert.deepEqual([...objects.store.keys()], stored, 'HQ neither added nor removed an object');
  assert.notEqual((db.prepare('SELECT logo_url FROM company_profiles WHERE id = ?').get(NORTH) as any).logo_url, null);
});

test('a support session cannot change settings, even as an editor; it still reads', async () => {
  const db = fixture(); const env = envOf(db);
  for (const [method, path, body] of [
    ['PATCH', '/api/company/co-north', { description: 'support wrote this' }],
    ['POST', '/api/company/co-north/logo', png()],
    ['DELETE', '/api/company/co-north/logo', undefined],
    ['PUT', '/api/company/co-north/legal', { legal_form: 'c_corp' }],
    ['PATCH', '/api/company/co-north/members/2', { role_in_company: 'Admin' }],
    ['DELETE', '/api/company/co-north/members/2', undefined],
    ['POST', '/api/company/co-north/invitations', { email: 'new@example.test', role_in_company: 'Member' }],
    ['POST', '/api/company/co-north/team/people', { name: 'X' }],
    ['POST', '/api/company/co-north/documents', png()],
  ] as const) {
    // Mutation checked: no support check → the editor's session writes on at least the PATCH.
    const r = await call(env, ADA, method, path, body, SUPPORT);
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.match(String(r.body?.code ?? r.body?.error), /support_session_refused/, `${method} ${path}`);
  }
  assert.equal(description(db), 'Before');
  const read = await call(env, ADA, 'GET', '/api/company/co-north', undefined, SUPPORT);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.viewer, { member: true, can_edit: false, read_only: true, read_only_reason: 'support_session' }, 'the read says it is read-only');
});

test('Legal, members, invitations, team and documents by direct API refuse HQ without a seat', async () => {
  const db = fixture(); const env = envOf(db);
  for (const [method, path, body] of [
    ['PUT', '/api/company/co-north/legal', { legal_form: 'c_corp' }],
    ['PUT', '/api/company/co-north/tax-id', { kind: 'ein', tax_id: '12-3456789' }],
    ['POST', '/api/company/co-north/officers', { name: 'Made-up Person', role: 'director' }],
    ['PUT', '/api/company/co-north/slug', { slug: 'northwind-hq' }],
    ['PATCH', '/api/company/co-north/members/2', { role_in_company: 'Admin' }],
    ['DELETE', '/api/company/co-north/members/2', undefined],
    ['POST', '/api/company/co-north/invitations', { email: 'new@example.test', role_in_company: 'Member' }],
    ['POST', '/api/company/co-north/team/people', { name: 'X' }],
    ['PUT', '/api/company/co-north/team/plan', {}],
    ['POST', '/api/company/co-north/documents', png()],
  ] as const) {
    const r = await call(env, EVE, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}: ${r.text}`);
    assert.match(String(r.body?.code ?? r.body?.error), /company_read_only/, `${method} ${path}`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) n FROM user_company_links WHERE company_id = ?').get(NORTH) as any).n, 4, 'no member was changed');
  assert.equal((db.prepare('SELECT legal_form FROM company_profiles WHERE id = ?').get(NORTH) as any).legal_form, null);
});

test('the company read tells each viewer what the server will accept', async () => {
  const env = envOf(fixture());
  const cap = async (who: number, claims = {}) => (await call(env, who, 'GET', '/api/company/co-north', undefined, claims)).body.viewer;
  assert.deepEqual(await cap(ADA), { member: true, can_edit: true, read_only: false, read_only_reason: null });
  assert.deepEqual(await cap(BEN), { member: true, can_edit: false, read_only: true, read_only_reason: 'not_an_editor' });
  assert.deepEqual(await cap(EVE), { member: false, can_edit: false, read_only: true, read_only_reason: 'hq_access' });
  assert.deepEqual(await cap(GUS), { member: true, can_edit: true, read_only: false, read_only_reason: null });
});

test('reads are unchanged: HQ still reads the company, and a non-member still gets 404', async () => {
  const env = envOf(fixture());
  assert.equal((await call(env, EVE, 'GET', '/api/company/co-north')).status, 200);
  assert.equal((await call(env, CY, 'GET', '/api/company/co-north')).status, 404);
  assert.equal((await call(env, EVE, 'GET', '/api/company/co-north/legal')).status, 200);
});
