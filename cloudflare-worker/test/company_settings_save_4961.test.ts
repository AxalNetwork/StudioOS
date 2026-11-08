/**
 * D4961 (#4961) — Save is one operation: the fields and the logo commit together or not at all.
 *
 * `POST /company/:uid/settings` against real SQLite with an in-memory R2. The case the issue
 * names — a logo that commits and a field that then fails — is the second test: it must now
 * change nothing, not leave the logo behind.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_settings_save_4961.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import companyRoutes from '../src/routes/company.ts';
import { storedLogoOf } from '../src/services/companyLogo.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');

const ADA = 1, BEN = 2, EVE = 3;
const NORTH = 1;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [EVE]: 'admin' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'company_profiles', 'user_company_links', 'activity_logs', 'incorporations']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['597_company_archive_and_events.sql', '685_company_legal_record_and_slugs.sql', '757_company_default_currency.sql', '202611031619_company_logo_change_event.sql', '202611072255_company_profile_version.sql']) db.exec(mig(m));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [EVE, 'Eve']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, description, created_at, updated_at) VALUES (?, 'co-north', 'Northwind', 'Before', '2026-01-01', '2026-01-01')").run(NORTH);
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')");
  l.run('l-1', NORTH, ADA, 'Owner', 1); l.run('l-2', NORTH, BEN, 'Member', 0);
  return db;
}

function r2() {
  const store = new Map<string, Uint8Array>(); const deleted: string[] = [];
  return {
    store, deleted,
    async put(k: string, b: Uint8Array) { store.set(k, new Uint8Array(b)); },
    async get() { return null; },
    async delete(k: string) { deleted.push(k); store.delete(k); },
  };
}

/** D1 whose batch can be made to fail once, to stand for the database refusing the write after the object was stored. */
function envOf(db: DatabaseSync, objects: ReturnType<typeof r2> | null = r2(), failBatch = { on: false }): any {
  const d1: any = d1Over(db);
  const realBatch = d1.batch.bind(d1);
  d1.batch = async (stmts: any[]) => { if (failBatch.on) throw new Error('synthetic D1 failure'); return realBatch(stmts); };
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: d1, ...(objects ? { COMPANY_LOGOS: objects } : {}) };
}

const png = (size = 64) => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer); dv.setUint32(16, size); dv.setUint32(20, size); b.set([8, 6, 0, 0, 0], 24);
  return new File([b], 'logo.png', { type: 'image/png' });
};
function settings(parts: { fields?: unknown; logo?: File; remove?: boolean; extra?: Record<string, string> }) {
  const f = new FormData();
  if (parts.fields !== undefined) f.append('fields', typeof parts.fields === 'string' ? parts.fields : JSON.stringify(parts.fields));
  if (parts.logo) f.append('logo', parts.logo);
  if (parts.remove) f.append('logo_action', 'remove');
  for (const [k, v] of Object.entries(parts.extra ?? {})) f.append(k, v);
  return f;
}

async function call(env: any, who: number, body: FormData | string | undefined, claims: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const app = new Hono(); app.route('/api', companyRoutes);
  const res = await app.request('/api/company/co-north/settings', { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: body as any }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const row = (db: DatabaseSync) => db.prepare('SELECT * FROM company_profiles WHERE id = ?').get(NORTH) as any;
const events = (db: DatabaseSync) => (db.prepare("SELECT kind FROM company_membership_events WHERE company_id = ? ORDER BY id").all(NORTH) as any[]).map((r) => r.kind);

test('the fields and a new logo commit together, with their events, and the answer is the company as it now is', async () => {
  const db = fixture(); const objects = r2(); const env = envOf(db, objects);
  const r = await call(env, ADA, settings({ fields: { description: 'After', company_name: 'Northwind Labs' }, logo: png() }));
  assert.equal(r.status, 200, r.text);
  assert.equal(row(db).description, 'After');
  assert.equal(row(db).company_name, 'Northwind Labs');
  assert.ok(storedLogoOf('co-north', row(db).logo_url), 'the logo is the stored one');
  assert.equal(objects.store.size, 1);
  assert.deepEqual(events(db), ['profile_update', 'rename', 'logo_change'], 'one batch wrote the field audit, the rename and the logo');
  assert.equal(r.body.description, 'After');
  assert.equal(r.body.logo_url, row(db).logo_url, 'the answer carries the committed logo');
  assert.equal(r.body.viewer.can_edit, true);
});

test('a valid logo with an invalid field changes NOTHING: no logo is stored, no row changes', async () => {
  const db = fixture(); const objects = r2(); const env = envOf(db, objects);
  const before = row(db);
  // Mutation checked: write the logo before checking the fields → the logo commits and the fields do not (the issue's failure).
  const r = await call(env, ADA, settings({ fields: { description: 'After', stage: 'unicorn' }, logo: png() }));
  assert.deepEqual([r.status, r.body.code], [400, 'stage_invalid']);
  assert.equal(objects.store.size, 0, 'nothing was stored');
  assert.deepEqual(row(db), before);
  assert.deepEqual(events(db), []);
});

test('a name clash or a bad logo also changes nothing', async () => {
  const db = fixture(); const objects = r2(); const env = envOf(db, objects);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (2, 'co-south', 'Southwind', 'n', 'n')").run();
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES ('l-9', 2, ?, 'Owner', 1, 'n')").run(ADA);
  const clash = await call(env, ADA, settings({ fields: { company_name: 'southwind', description: 'After' }, logo: png() }));
  assert.deepEqual([clash.status, clash.body.code], [409, 'company_name_clash']);
  const wide = await call(env, ADA, settings({ fields: { description: 'After' }, logo: png(0) }));
  assert.equal(wide.status, 400, 'a logo the Worker refuses refuses the whole save');
  assert.equal(objects.store.size, 0);
  assert.equal(row(db).description, 'Before');
});

test('if the database refuses the batch after the object is stored, the object is removed and nothing changed', async () => {
  const db = fixture(); const objects = r2(); const failing = { on: true }; const env = envOf(db, objects, failing);
  const before = row(db);
  const r = await call(env, ADA, settings({ fields: { description: 'After' }, logo: png() }));
  assert.notEqual(r.status, 200, 'the save did not report success');
  assert.equal(objects.store.size, 0, 'the new object was dropped');
  assert.deepEqual(row(db), before);
});

test('replacing and removing: the previous object goes, one stored logo at a time; Remove with fields', async () => {
  const db = fixture(); const objects = r2(); const env = envOf(db, objects);
  await call(env, ADA, settings({ logo: png() }));
  const first = storedLogoOf('co-north', row(db).logo_url)!.key;
  const second = await call(env, ADA, settings({ fields: { description: 'Two' }, logo: png() }));
  assert.equal(second.status, 200);
  assert.notEqual(storedLogoOf('co-north', row(db).logo_url)!.key, first);
  assert.deepEqual([...objects.store.keys()].length, 1, 'only the current logo is stored');
  assert.ok(objects.deleted.includes(first));
  const removed = await call(env, ADA, settings({ fields: { description: 'Three' }, remove: true }));
  assert.equal(removed.status, 200);
  assert.equal(row(db).logo_url, null);
  assert.equal(row(db).description, 'Three');
  assert.equal(objects.store.size, 0);
});

test('a retry of the same save is idempotent: the same values, and still one stored logo', async () => {
  const db = fixture(); const objects = r2(); const env = envOf(db, objects);
  const send = () => call(env, ADA, settings({ fields: { description: 'Same', website: 'northwind.example' }, logo: png() }));
  assert.equal((await send()).status, 200);
  const once = { ...row(db), logo_url: undefined, updated_at: undefined, profile_version: undefined };
  assert.equal((await send()).status, 200);
  assert.deepEqual({ ...row(db), logo_url: undefined, updated_at: undefined, profile_version: undefined }, once, 'the fields are the same values');
  assert.equal(objects.store.size, 1, 'the retry replaced the logo, it did not add a second');
});

test('HQ without a seat, a support session and a plain member are refused and store nothing', async () => {
  const db = fixture(); const objects = r2(); const env = envOf(db, objects);
  const hq = await call(env, EVE, settings({ fields: { description: 'x' }, logo: png() }));
  assert.deepEqual([hq.status, hq.body.code], [403, 'company_read_only']);
  const support = await call(env, ADA, settings({ fields: { description: 'x' } }), { impersonated_by: EVE });
  assert.deepEqual([support.status, support.body.code], [403, 'support_session_refused']);
  assert.equal((await call(env, BEN, settings({ fields: { description: 'x' } }))).status, 403);
  assert.equal(objects.store.size, 0);
  assert.equal(row(db).description, 'Before');
});

test('malformed saves are 400: not multipart, a stray part, fields that are not an object, a logo and a remove together', async () => {
  const db = fixture(); const env = envOf(db);
  const code = async (b: FormData | string, headers: Record<string, string> = {}) => (await call(env, ADA, b, {}, headers)).body?.code;
  assert.equal(await code('{"description":"x"}', { 'Content-Type': 'application/json' }), 'multipart_required');
  assert.equal(await code(settings({ extra: { archived_at: 'x' } })), 'unknown_field');
  assert.equal(await code(settings({ fields: '[1,2]' })), 'body_invalid');
  assert.equal(await code(settings({ fields: 'not json' })), 'body_invalid');
  assert.equal(await code(settings({ logo: png(), remove: true })), 'logo_conflict');
  assert.equal(await code(settings({ fields: { logo_url: 'https://evil.example/p.png' } })), 'logo_url_not_writable');
  assert.equal(row(db).description, 'Before');
});

test('an empty save changes nothing and still answers the company', async () => {
  const db = fixture(); const env = envOf(db);
  const r = await call(env, ADA, settings({}));
  assert.equal(r.status, 200);
  assert.equal(r.body.company_name, 'Northwind');
  assert.deepEqual(events(db), []);
});

test('no storage configured: a save with a logo is a 503 that changes nothing; a fields-only save still works', async () => {
  const db = fixture(); const env = envOf(db, null);
  const withLogo = await call(env, ADA, settings({ fields: { description: 'After' }, logo: png() }));
  assert.deepEqual([withLogo.status, withLogo.body.code ?? withLogo.body.error], [503, 'storage_unconfigured']);
  assert.equal(row(db).description, 'Before');
  assert.equal((await call(env, ADA, settings({ fields: { description: 'After' } }))).status, 200);
  assert.equal(row(db).description, 'After');
});
