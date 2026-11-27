import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import company from '../src/routes/company.ts';
import { CYCLE_STORES, cyclesActive } from '../src/services/companySheet.ts';
import { tableFromBaseline, splitStatements, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const baseline = readFileSync(resolve('cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = name => readFileSync(resolve(`cloudflare-worker/sql/migrations/${name}`), 'utf8');
const newStoreFiles = {
  demand_signals: '440_validate_cycle_stores.sql',
  venture_risks: '441_build_cycle_stores.sql', formation_steps: '441_build_cycle_stores.sql',
  readiness_items: '442_raise_cycle_stores.sql',
  product_feedback: '443_grow_stores.sql', growth_channels: '443_grow_stores.sql',
  growth_partners: '443_grow_stores.sql', markets: '443_grow_stores.sql',
};
const testKey = new TextEncoder().encode('d699 local test signing key '.repeat(2));
const user = (id, founderId = id * 100, role = 'founder') => ({ id, founder_id: founderId, role, spinout_lab_active: 0 });

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const name of ['users', 'company_profiles', 'user_company_links', 'projects', ...Object.values(CYCLE_STORES).flat()]) {
    const source = newStoreFiles[name] ? migration(newStoreFiles[name]) : baseline;
    const ddl = tableFromBaseline(source, name);
    db.exec(newStoreFiles[name] ? stripForeignKeys(ddl) : ddl);
  }
  for (const stmt of splitStatements(migration('466_company_visits.sql'))) db.exec(stmt);
  db.exec("INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (1, 'founder', 'Ada Quill', 'ada@example.test', 1, 100), (2, 'founder', 'Bo Quill', 'bo@example.test', 1, 200), (3, 'admin', 'Admin Quill', 'admin@example.test', 1, NULL)");
  db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-1', 'Juniper Labs'), (2, 'co-2', 'Orchard Ops')");
  db.exec("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin) VALUES ('l-1', 1, 1, 'Founder', 1), ('l-2', 1, 2, 'Founder', 0)");
  db.exec("INSERT INTO projects (id, name, founder_id, company_id) VALUES (10, 'A', 100, 1), (20, 'B', 200, 1), (30, 'C', 100, 2), (40, 'Legacy', 100, NULL)");
  return db;
}

async function call(db, who, method, path, body, impersonated = false) {
  const token = await new SignJWT({ user_id: who, ...(impersonated ? { impersonated_by: 99 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(testKey);
  const response = await company.request(path, { method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET: new TextDecoder().decode(testKey), ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function addStoreRow(db, store, projectId) {
  const columns = db.prepare(`PRAGMA table_info(${store})`).all();
  const fields = { project_id: projectId };
  for (const col of columns) {
    if (col.name === 'id' || col.name === 'project_id' || !col.notnull || col.dflt_value != null) continue;
    fields[col.name] = col.type.includes('INT') || col.type.includes('REAL') ? 1 : 'Test';
  }
  if ('severity' in fields) fields.severity = 'high';
  if ('source' in fields) fields.source = 'customer';
  if ('utm_source' in fields) fields.utm_source = 'test';
  if ('type' in fields) fields.type = 'other';
  const names = Object.keys(fields);
  db.prepare(`INSERT INTO ${store} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...Object.values(fields));
}

test('D699 migration keeps one valid visit per member and cascades on company deletion', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(tableFromBaseline(baseline, 'company_profiles'));
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  for (const stmt of splitStatements(migration('466_company_visits.sql'))) db.exec(stmt);
  db.exec("INSERT INTO users (id) VALUES (1), (2); INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-1', 'Juniper Labs')");
  db.exec("INSERT INTO user_company_visits (uid, user_id, company_id, cycle, opened_at) VALUES ('visit-1', 1, 1, 'raise', '2026-10-12T00:00:00Z')");
  assert.throws(() => db.exec("INSERT INTO user_company_visits (uid, user_id, company_id, cycle, opened_at) VALUES ('visit-2', 1, 1, 'grow', '2026-10-12T00:00:00Z')"));
  assert.throws(() => db.exec("INSERT INTO user_company_visits (uid, user_id, company_id, cycle, opened_at) VALUES ('visit-1', 2, 1, 'grow', '2026-10-12T00:00:00Z')"));
  assert.throws(() => db.exec("INSERT INTO user_company_visits (uid, user_id, company_id, cycle, opened_at) VALUES ('visit-3', 2, 1, 'studio', '2026-10-12T00:00:00Z')"));
  db.exec('DELETE FROM company_profiles WHERE id = 1');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_company_visits').get().n, 0);
});

test('D699 every declared store lights only its cycle for the owning founder', async () => {
  for (const [cycle, stores] of Object.entries(CYCLE_STORES)) for (const store of stores) {
    const db = fixture();
    assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), []);
    addStoreRow(db, store, 10);
    assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), [cycle], store);
    assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(2, 200), 1), [], store);
  }
});

test('D699 ownership and failed reads are honest', async () => {
  const db = fixture();
  addStoreRow(db, 'discovery_interviews', 20);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), []);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(2, 200), 1), ['validate']);
  addStoreRow(db, 'pain_groups', 40);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), []);
  addStoreRow(db, 'hypotheses', 30);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), []);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(3, null, 'admin'), 1), []);
  db.exec('DROP TABLE markets');
  assert.equal(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), null);
});

test('D699 combined cycles keep canvas order and exclude deleted ventures', async () => {
  const db = fixture();
  addStoreRow(db, 'compliance_events', 10);
  addStoreRow(db, 'hypotheses', 10);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), ['validate', 'grow']);
  db.exec("UPDATE projects SET deleted_at = '2026-10-01' WHERE id = 10");
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100), 1), []);
  assert.deepEqual(await cyclesActive({ DB: d1Over(db) }, user(1, 100, 'investor'), 1), []);
});

test('D699 visit route gates membership and impersonation, and binds the caller', async () => {
  const db = fixture();
  const anonymous = await company.request('/company/visits', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: 1, cycle: 'raise' }) },
    { JWT_SECRET: new TextDecoder().decode(testKey), ENVIRONMENT: 'development', DB: d1Over(db) });
  assert.equal(anonymous.status, 401);
  assert.equal((await call(db, 1, 'PUT', '/company/visits', { company_id: 2, cycle: 'raise' })).status, 404);
  assert.equal((await call(db, 3, 'PUT', '/company/visits', { company_id: 1, cycle: 'raise' })).status, 404);
  assert.equal((await call(db, 1, 'PUT', '/company/visits', { company_id: 1, cycle: 'raise' }, true)).status, 403);
  for (const body of [{ company_id: 1, cycle: 'studio' }, { company_id: '1', cycle: 'raise' }, { company_id: 0, cycle: 'raise' }, { company_id: -1, cycle: 'raise' }, { company_id: 1 }]) {
    assert.equal((await call(db, 1, 'PUT', '/company/visits', body)).status, 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_company_visits').get().n, 0);
  assert.equal((await call(db, 1, 'PUT', '/company/visits', { company_id: 1, cycle: 'raise', user_id: 2 })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT user_id, company_id, cycle FROM user_company_visits').get() }, { user_id: 1, company_id: 1, cycle: 'raise' });
  assert.equal((await call(db, 1, 'PUT', '/company/visits', { company_id: 1, cycle: 'grow' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT user_id, company_id, cycle FROM user_company_visits').get() }, { user_id: 1, company_id: 1, cycle: 'grow' });
  const list = await call(db, 1, 'GET', '/company/memberships');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map(row => row.last_opened?.cycle), ['grow']);
  assert.deepEqual(list.body.map(row => row.cycles_active), [[]]);
  const other = await call(db, 2, 'GET', '/company/memberships');
  assert.equal(other.body[0].last_opened, null);
  await call(db, 2, 'PUT', '/company/visits', { company_id: 1, cycle: 'raise' });
  assert.equal((await call(db, 1, 'GET', '/company/memberships')).body[0].last_opened.cycle, 'grow');
  assert.deepEqual((await call(db, 1, 'GET', '/company/memberships')).body.map(row => row.id), [1]);
  db.exec('DROP TABLE user_company_visits');
  const unreadableVisit = await call(db, 1, 'GET', '/company/memberships');
  assert.equal(unreadableVisit.status, 200);
  assert.equal(unreadableVisit.body[0].last_opened, null);
});
