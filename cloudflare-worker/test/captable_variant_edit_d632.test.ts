/**
 * D632 (#1390) — a draft variant is renamed and edited in place, the main cap
 * table stays one per company, and every write records its actor.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_variant_edit_d632.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import captable from '../src/routes/captable.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MAIN = { founders: [{ name: 'Ada', shares: 8_000_000 }], option_pool_pct: 10 };
const DRAFT = {
  founders: [{ name: 'Ada', shares: 6_000_000 }, { name: 'Grace', shares: 4_000_000 }],
  option_pool_pct: 12,
  safes: [{ name: 'Angel', amount: 250_000, cap: 8_000_000, discount: 0.2 }],
  rounds: [{ name: 'Seed', pre_money: 6_000_000, investment: 1_500_000 }],
  exit_value: 40_000_000,
};

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER);
    CREATE TABLE cap_table_scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, owner_user_id INTEGER NOT NULL,
      project_id INTEGER, name TEXT NOT NULL, inputs_json TEXT NOT NULL, result_json TEXT, computed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_variant INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX one_main ON cap_table_scenarios(project_id) WHERE project_id IS NOT NULL AND is_variant = 0;
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
      action TEXT NOT NULL, details TEXT, actor TEXT);
  `);
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (1, 'admin@x.test', 'Admin', 'admin')`).run();
  db.prepare(`INSERT INTO projects (id, founder_id) VALUES (1, 7)`).run();
  return db;
}

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: 1, role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await captable.request(path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const logs = (db: DatabaseSync) => db.prepare('SELECT project_id, user_id, action, details, actor FROM activity_logs ORDER BY id').all() as any[];

test('D632: a variant is renamed and edited in place; the main table is untouched', async () => {
  const db = freshDb();
  const main = await call(db, 'POST', '/scenarios', { name: 'Main', project_id: 1, inputs: MAIN });
  assert.equal(main.status, 200);
  const made = await call(db, 'POST', '/scenarios/by-project/1/variants', { name: 'Draft A', inputs: MAIN });
  assert.equal(made.status, 200);

  const edited = await call(db, 'PUT', `/scenarios/${made.body.uid}`, { name: 'Bigger seed', inputs: DRAFT, project_id: 1 });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.uid, made.body.uid, 'the same row, edited in place');
  assert.equal(edited.body.name, 'Bigger seed');
  assert.equal(edited.body.is_variant, 1);
  assert.deepEqual(edited.body.inputs, DRAFT);
  assert.equal(edited.body.result.rounds.length, 1, 'the edit is simulated again');

  const cmp = await call(db, 'GET', '/scenarios/by-project/1/compare');
  assert.equal(cmp.body.canonical.uid, main.body.uid);
  assert.deepEqual(cmp.body.canonical.inputs, MAIN, 'the main cap table did not move');
  assert.deepEqual(cmp.body.variants.map((v: any) => v.name), ['Bigger seed']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cap_table_scenarios WHERE is_variant = 0').get() as any).n, 1);
});

test('D632: every variant write records its actor and project', async () => {
  const db = freshDb();
  const made = await call(db, 'POST', '/scenarios/by-project/1/variants', { name: 'Draft A', inputs: MAIN });
  await call(db, 'PUT', `/scenarios/${made.body.uid}`, { name: 'Draft B', inputs: DRAFT });
  await call(db, 'PUT', `/scenarios/${made.body.uid}`, { name: 'Draft B', inputs: MAIN });
  await call(db, 'DELETE', `/scenarios/${made.body.uid}`);
  const rows = logs(db);
  assert.deepEqual(rows.map((r) => r.action), [
    'captable_variant_created', 'captable_scenario_updated', 'captable_scenario_updated', 'captable_scenario_deleted',
  ]);
  for (const r of rows) {
    assert.equal(r.user_id, 1);
    assert.equal(r.project_id, 1);
    assert.match(r.actor, /^[0-9a-f]{16,}$/);
    const d = JSON.parse(r.details);
    assert.equal(d.scenario_uid, made.body.uid);
    assert.equal(d.is_variant, 1);
  }
  assert.equal(JSON.parse(rows[1].details).renamed_from, 'Draft A', 'a rename says what it was');
  assert.equal('renamed_from' in JSON.parse(rows[2].details), false, 'an edit without a rename does not claim one');
});

test('D632: an invalid edit is refused as sentences and changes nothing', async () => {
  const db = freshDb();
  const made = await call(db, 'POST', '/scenarios/by-project/1/variants', { name: 'Draft A', inputs: MAIN });
  const bad = await call(db, 'PUT', `/scenarios/${made.body.uid}`, { name: 'Draft A', inputs: { founders: [] } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.detail.errors, ['At least one founder is required.']);
  const after = await call(db, 'GET', `/scenarios/${made.body.uid}`);
  assert.deepEqual(after.body.inputs, MAIN);
  assert.equal(logs(db).filter((r) => r.action === 'captable_scenario_updated').length, 0);
});

test('D632: a failed log line never undoes the edit', async () => {
  const db = freshDb();
  const made = await call(db, 'POST', '/scenarios/by-project/1/variants', { name: 'Draft A', inputs: MAIN });
  db.exec('DROP TABLE activity_logs');
  const edited = await call(db, 'PUT', `/scenarios/${made.body.uid}`, { name: 'Renamed', inputs: MAIN });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.name, 'Renamed');
});
