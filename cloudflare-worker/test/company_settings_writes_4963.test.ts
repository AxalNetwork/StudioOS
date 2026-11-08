/**
 * D4963 (#4963) — Company settings writes: compare-and-swap on the General profile, one archived rule for every
 * company write, and a field-name audit event for every committed General change.
 *
 * What is pinned:
 *   - two editors loading the same version: the first save wins, the second is a deterministic 409
 *     `version_conflict` carrying the current company, and the first editor's value is not overwritten;
 *   - a write that races in between a request's read and its update is never overwritten either (no
 *     `expected_version` needed), and leaves no event behind;
 *   - an unchanged body writes nothing and keeps the version; an invalid `expected_version` is a 400;
 *   - every committed General change writes one `profile_update` event naming the changed fields and the revision
 *     before and after, never a value;
 *   - the logo is conditioned on the same version, and a stale logo write stores nothing;
 *   - an archived company refuses every company write with the same status, code and sentence, still answers reads,
 *     and takes writes again once restored; a non-member is never told the company is archived.
 * Synthetic data only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/company_settings_writes_4963.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import companyRoutes, { VERSION_CONFLICT_MESSAGE } from '../src/routes/company.ts';
import companyLifecycle from '../src/routes/company_lifecycle.ts';
import companyLegal from '../src/routes/company_legal.ts';
import companyDocuments from '../src/routes/company_documents.ts';
import projectLifecycle from '../src/routes/project_lifecycle.ts';
import companyCompliance from '../src/routes/company_compliance.ts';
import { ARCHIVED_MESSAGE } from '../src/services/companyAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'test-secret-4963-'.padEnd(40, 'x');
const ADA = 1, BEN = 2, FAY = 3, ZED = 4;
const NORTH = 1, VENTURE = 70;
const ROLE: Record<number, string> = { [ADA]: 'founder', [BEN]: 'founder', [FAY]: 'founder', [ZED]: 'founder' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, n] of [[ADA, 'Ada'], [BEN, 'Ben'], [FAY, 'Fay'], [ZED, 'Zed']] as const) u.run(id, ROLE[id], `${n} Made-up`, `${n.toLowerCase()}@example.test`);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, description, revenue_range, created_at, updated_at) VALUES (?, 'co-north', 'Northwind', 'Original description', '1m_5m', '2026-01-01', '2026-01-01')").run(NORTH);
  const l = db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01')");
  l.run('l-1', NORTH, ADA, 'Owner', 1); l.run('l-2', NORTH, FAY, 'Founder', 0); l.run('l-3', NORTH, BEN, 'Member', 0);
  return db;
}

const r2 = () => {
  const store = new Map<string, Uint8Array>();
  return { store, async put(k: string, b: Uint8Array) { store.set(k, b); }, async get() { return null; }, async delete(k: string) { store.delete(k); } };
};
const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), COMPANY_LOGOS: r2(), ...extra });

function appFor() {
  const app = new Hono();
  app.route('/api/projects', projectLifecycle);
  app.route('/api/company', companyCompliance);
  app.route('/api', companyLifecycle);
  app.route('/api', companyLegal);
  app.route('/api', companyDocuments);
  app.route('/api', companyRoutes);
  return app;
}

async function call(env: any, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await appFor().request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: isForm ? (body as FormData) : JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const version = (db: DatabaseSync) => (db.prepare('SELECT profile_version AS v FROM company_profiles WHERE id = ?').get(NORTH) as any).v;
const row = (db: DatabaseSync) => db.prepare('SELECT * FROM company_profiles WHERE id = ?').get(NORTH) as any;
const events = (db: DatabaseSync, kind = 'profile_update') => (db.prepare('SELECT actor_user_id, before_json, after_json, created_at FROM company_membership_events WHERE company_id = ? AND kind = ? ORDER BY id').all(NORTH, kind) as any[])
  .map((e) => ({ actor: e.actor_user_id, before: JSON.parse(e.before_json), after: JSON.parse(e.after_json), at: e.created_at }));
const PATCH = '/api/company/co-north';

// ── compare-and-swap ──────────────────────────────────────────────────────

test('two editors on the same version: the first save wins, the second is a 409 with the current company', async () => {
  const db = fixture(); const env = envOf(db);
  const loaded = await call(env, ADA, 'GET', PATCH);
  assert.equal(loaded.body.profile_version, 1, 'the detail carries the token');
  const a = await call(env, ADA, 'PATCH', PATCH, { description: 'Ada wrote this', expected_version: 1 });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.profile_version, 2);
  const b = await call(env, FAY, 'PATCH', PATCH, { description: 'Fay wrote this', expected_version: 1 });
  assert.equal(b.status, 409);
  assert.deepEqual([b.body.error, b.body.code, b.body.current_version, b.body.message], ['version_conflict', 'version_conflict', 2, VERSION_CONFLICT_MESSAGE]);
  assert.equal(b.body.company.description, 'Ada wrote this', 'the conflict carries what is saved now');
  assert.equal(row(db).description, 'Ada wrote this', 'the first editor\'s value is not overwritten');
  assert.equal(version(db), 2);
  // Deterministic: the same stale save is refused the same way again.
  assert.equal((await call(env, FAY, 'PATCH', PATCH, { description: 'again', expected_version: 1 })).status, 409);
  // With the current version, Fay's save goes through.
  const ok = await call(env, FAY, 'PATCH', PATCH, { description: 'Fay wrote this', expected_version: 2 });
  assert.deepEqual([ok.status, ok.body.profile_version, row(db).description], [200, 3, 'Fay wrote this']);
});

test('a write that lands between a request\'s read and its update is never overwritten, and leaves no event', async () => {
  const db = fixture();
  const inner = d1Over(db);
  let raced = false;
  // Another editor's commit, slipped in just before this request's UPDATE runs.
  const DB = {
    ...inner,
    prepare(sql: string) {
      const st = inner.prepare(sql);
      if (!raced && /^UPDATE company_profiles SET/.test(sql.trim())) {
        raced = true;
        db.prepare("UPDATE company_profiles SET description = 'Concurrent commit', profile_version = profile_version + 1 WHERE id = ?").run(NORTH);
      }
      return st;
    },
    batch: (sts: any[]) => inner.batch(sts),
  };
  const env = envOf(db, { DB });
  const res = await call(env, ADA, 'PATCH', PATCH, { description: 'Ada, no token' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'version_conflict');
  assert.equal(row(db).description, 'Concurrent commit');
  assert.equal(version(db), 2);
  assert.deepEqual(events(db), [], 'no event outlives an update that matched no row');
});

test('an unchanged body writes nothing; an invalid expected_version is a 400', async () => {
  const db = fixture(); const env = envOf(db);
  const same = await call(env, ADA, 'PATCH', PATCH, { description: 'Original description', company_name: 'Northwind', expected_version: 1 });
  assert.deepEqual([same.status, version(db), events(db).length], [200, 1, 0]);
  for (const bad of [0, -1, 1.5, 'x', true]) {
    const r = await call(env, ADA, 'PATCH', PATCH, { description: 'y', expected_version: bad });
    assert.deepEqual([r.status, r.body.error], [400, 'invalid_expected_version'], String(bad));
  }
  assert.equal(row(db).description, 'Original description');
});

// ── the audit ─────────────────────────────────────────────────────────────

test('every committed General change records the changed field names and the revisions, never a value', async () => {
  const db = fixture(); const env = envOf(db);
  await call(env, ADA, 'PATCH', PATCH, { description: 'Confidential pipeline note', revenue_range: '5m_20m', stage: 'seed', expected_version: 1 });
  await call(env, FAY, 'PATCH', PATCH, { company_name: 'Northwind Labs', expected_version: 2 });
  const ev = events(db);
  assert.deepEqual(ev.map((e) => [e.actor, e.before, e.after]), [
    [ADA, { profile_version: 1 }, { profile_version: 2, fields: ['stage', 'revenue_range', 'description'] }],
    [FAY, { profile_version: 2 }, { profile_version: 3, fields: ['company_name'] }],
  ]);
  assert.ok(ev.every((e) => typeof e.at === 'string' && e.at.length > 0), 'each event has its time');
  const all = JSON.stringify(db.prepare("SELECT before_json, after_json FROM company_membership_events WHERE kind = 'profile_update'").all());
  assert.doesNotMatch(all, /Confidential|5m_20m|seed/, 'no value is stored');
  assert.equal(events(db, 'rename').length, 1, 'a rename keeps its own event beside it');
});

// ── the logo ──────────────────────────────────────────────────────────────

const PNG = () => {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 64); new DataView(b.buffer).setUint32(20, 64);
  return b;
};
const form = () => { const f = new FormData(); f.append('file', new File([PNG()], 'l.png', { type: 'image/png' })); return f; };

test('the logo is part of the profile: it bumps the version, and a stale logo write stores nothing', async () => {
  const db = fixture(); const env = envOf(db);
  const up = await call(env, ADA, 'POST', '/api/company/co-north/logo?expected_version=1', form());
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.profile_version, 2);
  const keys = [...env.COMPANY_LOGOS.store.keys()];
  const stale = await call(env, FAY, 'POST', '/api/company/co-north/logo?expected_version=1', form());
  assert.deepEqual([stale.status, stale.body.error], [409, 'version_conflict']);
  assert.deepEqual([...env.COMPANY_LOGOS.store.keys()], keys, 'nothing new is stored');
  const staleDel = await call(env, FAY, 'DELETE', '/api/company/co-north/logo?expected_version=1');
  assert.equal(staleDel.status, 409);
  assert.ok(row(db).logo_url, 'a stale remove removes nothing');
  // The form's sequence: logo at v1 then fields at the version the logo returned.
  const fields = await call(env, ADA, 'PATCH', PATCH, { description: 'after logo', expected_version: up.body.profile_version });
  assert.deepEqual([fields.status, fields.body.profile_version], [200, 3]);
  assert.equal(events(db, 'logo_change').length, 1);
});

// ── one archived rule ─────────────────────────────────────────────────────

const WRITES: Array<[string, string, unknown?]> = [
  ['PATCH', PATCH, { description: 'x' }],
  ['POST', '/api/company/co-north/logo', 'form'],
  ['DELETE', '/api/company/co-north/logo'],
  ['PATCH', `/api/company/co-north/members/${BEN}`, { role_in_company: 'Advisor' }],
  ['DELETE', `/api/company/co-north/members/${BEN}`],
  ['POST', '/api/company/co-north/invitations', { email: 'new@example.test', role_in_company: 'Member' }],
  ['POST', '/api/company/co-north/invitations/inv-1/resend'],
  ['DELETE', '/api/company/co-north/invitations/inv-1'],
  ['POST', '/api/company/co-north/team/people', { name: 'Pat Made-up', title: 'analyst' }],
  ['PATCH', '/api/company/co-north/team/people/p-1', { name: 'Pat' }],
  ['PUT', '/api/company/co-north/team/coverage', { items: [] }],
  ['PUT', '/api/company/co-north/team/plan', { items: [] }],
  ['PUT', '/api/company/co-north/legal', { legal_name: 'Northwind Ltd' }],
  ['PUT', '/api/company/co-north/tax-id', { tax_id: '12-3456789' }],
  ['POST', '/api/company/co-north/officers', { name: 'Pat', role: 'director' }],
  ['POST', '/api/company/co-north/locations', { kind: 'office' }],
  ['PUT', '/api/company/co-north/slug', { slug: 'northwind' }],
  ['POST', '/api/company/co-north/documents', 'form'],
  ['POST', '/api/company/co-north/compliance', { title: 'File the return' }],
  ['PATCH', '/api/company/co-north/compliance/t-1', { title: 'x' }],
  ['POST', '/api/company/co-north/transfer', { user_id: FAY }],
];

test('an archived company refuses every company write with one status, code and sentence', async () => {
  const db = fixture(); const env = envOf(db);
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/archive', {})).status, 200);
  const before = JSON.stringify(row(db));
  for (const [method, path, body] of WRITES) {
    const res = await call(env, ADA, method, path, body === 'form' ? form() : body);
    assert.deepEqual([res.status, res.body?.error, res.body?.code, res.body?.message], [409, 'archived', 'archived', ARCHIVED_MESSAGE], `${method} ${path}: ${JSON.stringify(res.body)}`);
  }
  // Leaving is a write to the company too.
  const leave = await call(env, BEN, 'POST', '/api/company/co-north/leave', {});
  assert.deepEqual([leave.status, leave.body.error], [409, 'archived']);
  assert.equal(JSON.stringify(row(db)), before, 'nothing changed');
  // Reads still answer, so the members see what they restore.
  assert.equal((await call(env, ADA, 'GET', PATCH)).status, 200);
  assert.equal((await call(env, ADA, 'GET', '/api/company/co-north/legal')).status, 200);
});

test('a venture neither joins nor leaves an archived company; after restore every write works again', async () => {
  const db = fixture(); const env = envOf(db);
  // Ada owns the venture: her account is its founder (isProjectManager's rule).
  db.prepare('UPDATE users SET founder_id = 90 WHERE id = ?').run(ADA);
  db.prepare("INSERT INTO projects (id, name, founder_id, company_id) VALUES (?, 'Made-up venture', 90, ?)").run(VENTURE, NORTH);
  await call(env, ADA, 'POST', '/api/company/co-north/archive', {});
  const out = await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: null });
  assert.deepEqual([out.status, out.body.code], [409, 'archived'], JSON.stringify(out.body));
  assert.equal((db.prepare('SELECT company_id FROM projects WHERE id = ?').get(VENTURE) as any).company_id, NORTH);
  assert.equal((await call(env, ADA, 'POST', '/api/company/co-north/restore', {})).status, 200, 'restore is the one write it takes');
  const v = version(db);
  const patched = await call(env, ADA, 'PATCH', PATCH, { description: 'Back', expected_version: v });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal((await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: null })).status, 200);
});

test('a non-member is never told a company is archived', async () => {
  const db = fixture(); const env = envOf(db);
  await call(env, ADA, 'POST', '/api/company/co-north/archive', {});
  for (const [method, path] of [['PATCH', PATCH], ['POST', '/api/company/co-north/compliance'], ['PUT', '/api/company/co-north/legal']] as const) {
    const res = await call(env, ZED, method, path, { title: 'x', description: 'x' });
    assert.notEqual(res.body?.error, 'archived', `${method} ${path}`);
    assert.ok([403, 404].includes(res.status), `${method} ${path}: ${res.status}`);
  }
});
