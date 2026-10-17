/**
 * D690 (S18-B, #1693) — every Build write logs its record (decision 15).
 *
 * #1693 ships test 10 here: each of today's writes in `cycle_build.ts` logs
 * one activity row through logCycleWrite's statement form, with the project,
 * the module's entity type and the record id, in the write's own batch. No
 * summary names a seeded founder. #1694 adds the record lines and #1695 the
 * new writes and actions.
 *
 * THE DATABASE IS THE BASELINE PLUS EVERY NUMBERED MIGRATION ABOVE THE CUTOFF,
 * IN ORDER, as migrations_fresh_build.test.ts builds one, so no table is
 * hand-written. The names are made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_writes_d690.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import build from '../src/routes/cycle_build.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const FOUNDER = 10, TEAMMATE = 11;
const P = 1, P_OTHER = 2, COMPANY = 5, ENTITY = 7;
/** Every person-shaped string seeded below: no summary may hold one. */
const PRIVATE = ['ana', 'wren', 'tomas', 'reyes', 'example.test'];

function freshBuild(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return db;
}
const BUILT_DDL = (freshBuild().prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
  ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);

function seeded() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', 1, 1001), (${TEAMMATE}, 'founder', 'Tomas Reyes', 'tomas@example.test', 1, NULL)`);
  db.exec(`INSERT INTO projects (id, name, founder_id, company_id, entity_id) VALUES (${P}, 'Kestrel Works', 1001, ${COMPANY}, ${ENTITY}), (${P_OTHER}, 'Harbour Labs', 1002, 6, NULL)`);
  db.exec(`INSERT INTO user_company_links (uid, user_id, company_id) VALUES ('l1', ${FOUNDER}, ${COMPANY}), ('l2', ${TEAMMATE}, ${COMPANY})`);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${P}, 'Manual reconciliation')`);
  db.exec(`INSERT INTO mvp_features (id, project_id, title) VALUES (3, ${P}, 'Bank feed import')`);
  db.exec(`INSERT INTO venture_risks (id, project_id, title, severity, created_by, feature_id) VALUES
    (4, ${P}, 'Bank API access', 'high', ${FOUNDER}, NULL), (5, ${P}, 'Feed outages', 'medium', ${FOUNDER}, 3)`);
  db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status) VALUES (6, ${P}, 'Ship reconciliation', 'now')`);
  db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, shares, ownership_pct, founder_role) VALUES (8, ${FOUNDER}, ${P}, 'Ana Wren', 600, 60, 'CEO')`);
  db.exec(`INSERT INTO formation_steps (id, project_id, title, due_date, state, created_by) VALUES (9, ${P}, '83(b) election · Ana Wren', '2026-12-01', 'todo', ${FOUNDER})`);
  db.exec(`INSERT INTO entities (id, name, entity_type, jurisdiction) VALUES (${ENTITY}, 'Kestrel Works Inc', 'project', 'DE')`);
  db.exec(`INSERT INTO entity_obligations (id, uid, entity_id, title, due_date, status, kind, cadence) VALUES (12, 'o12', ${ENTITY}, 'Franchise tax', '2026-11-01', 'open', 'franchise_tax', 'annual')`);
  db.exec(`INSERT INTO spinout_applications (id, user_id, company_name, idea, status, answers_json) VALUES (13, ${FOUNDER}, 'Kestrel Works', 'Reconciliation', 'accepted', '{"origin":"university","institution":"Example Institute","ip":[]}')`);
  return db;
}

const app = new Hono<any>();
app.route('/api/cycles/build', build);
app.onError((e, c) => c.json({ error: e.message }, 500));
async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(`/api/cycles/build${path}${path.includes('?') ? '&' : '?'}project=${P}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any);
  return { status: r.status, body: await r.json() as any };
}
const one = (db: DatabaseSync, sql: string) => JSON.stringify(db.prepare(sql).all());

/** Each of today's Build writes: its call, the row it must log, and the state it changes. */
const WRITES: Array<{ name: string; method: string; path: string; body: unknown; action: string; entityType: string; entityId: string | ((r: any) => string); state: string }> = [
  { name: 'MVP target date', method: 'PATCH', path: '/project/target', body: { mvp_target_date: '2027-03-01' },
    action: 'build_mvp_target_changed', entityType: 'build.solution-design', entityId: 'project', state: `SELECT mvp_target_date FROM projects WHERE id = ${P}` },
  { name: 'IP copy', method: 'POST', path: '/project/ip-copy', body: { application_id: 13 },
    action: 'build_ip_copied', entityType: 'build.company-creation', entityId: 'project', state: `SELECT spinout_ip_meta FROM projects WHERE id = ${P}` },
  { name: 'feature details', method: 'PATCH', path: '/features/3', body: { pain_group_id: 1, is_must_have: true },
    action: 'build_feature_details_changed', entityType: 'build.solution-design', entityId: '3', state: 'SELECT pain_group_id, is_must_have FROM mvp_features WHERE id = 3' },
  { name: 'risk create (no feature)', method: 'POST', path: '/risks', body: { title: 'Key-person dependency', severity: 'low' },
    action: 'build_risk_created', entityType: 'build.solution-design', entityId: 'project', state: 'SELECT COUNT(*) AS n FROM venture_risks' },
  { name: 'risk edit (no feature)', method: 'PATCH', path: '/risks/4', body: { state: 'mitigating' },
    action: 'build_risk_changed', entityType: 'build.solution-design', entityId: 'project', state: 'SELECT state FROM venture_risks WHERE id = 4' },
  { name: 'risk edit (tied to a feature)', method: 'PATCH', path: '/risks/5', body: { state: 'closed' },
    action: 'build_risk_changed', entityType: 'build.solution-design', entityId: '3', state: 'SELECT state FROM venture_risks WHERE id = 5' },
  { name: 'roadmap item', method: 'PATCH', path: '/roadmap/6', body: { kpi_key: 'mrr', target_date: '2027-01-15' },
    action: 'build_roadmap_details_changed', entityType: 'build.product-roadmap', entityId: '6', state: 'SELECT kpi_key, target_date FROM roadmap_okrs WHERE id = 6' },
  { name: 'founder role', method: 'PATCH', path: '/founders/8', body: { role: 'CTO' },
    action: 'build_founder_role_changed', entityType: 'build.founding-team', entityId: 'h-8', state: 'SELECT founder_role FROM cap_table_holders WHERE id = 8' },
  { name: 'filing create', method: 'POST', path: '/formation-steps', body: { title: 'File certificate', due_date: '2026-12-15' },
    action: 'build_formation_step_created', entityType: 'build.company-creation', entityId: (r) => `step-${r.id}`, state: 'SELECT COUNT(*) AS n FROM formation_steps' },
  { name: 'filing edit', method: 'PATCH', path: '/formation-steps/9', body: { state: 'done' },
    action: 'build_formation_step_changed', entityType: 'build.company-creation', entityId: 'step-9', state: 'SELECT state FROM formation_steps WHERE id = 9' },
  { name: 'obligation proof', method: 'PATCH', path: '/obligations/12/proof', body: { proof_file_key: 'typed-key-1' },
    action: 'build_obligation_proof_changed', entityType: 'build.company-creation', entityId: 'obligation-12', state: 'SELECT proof_file_key FROM entity_obligations WHERE id = 12' },
  { name: 'system mapping', method: 'PUT', path: '/systems/bank', body: { used_by: 'Finance' },
    action: 'build_system_mapping_changed', entityType: 'build.operating-systems', entityId: 'bank', state: `SELECT used_by FROM project_core_systems WHERE project_id = ${P} AND kind = 'bank'` },
];

test('test 10: each Build write logs one row with its project, entity type and record id', async () => {
  for (const w of WRITES) {
    const db = seeded();
    const before = one(db, w.state);
    const r = await call(db, w.method, w.path, w.body);
    assert.ok(r.status === 200 || r.status === 201, `${w.name}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.notEqual(one(db, w.state), before, `${w.name} changed its store`);
    const rows = db.prepare('SELECT project_id, user_id, entity_type, entity_id, action, actor FROM activity_logs').all() as any[];
    const id = typeof w.entityId === 'function' ? w.entityId(r.body) : w.entityId;
    assert.deepEqual(rows.map((x) => ({ ...x })), [{ project_id: P, user_id: FOUNDER, entity_type: w.entityType, entity_id: id, action: w.action, actor: `user:${FOUNDER}` }], w.name);
    db.close();
  }
});

test('test 10: a log that fails takes its write with it, as one batch', async () => {
  for (const w of WRITES) {
    const db = seeded();
    db.exec(`CREATE TRIGGER reject_log BEFORE INSERT ON activity_logs WHEN NEW.action = '${w.action}' BEGIN SELECT RAISE(ABORT, 'log failure'); END`);
    const before = one(db, w.state);
    const r = await call(db, w.method, w.path, w.body);
    assert.equal(r.status, 500, w.name);
    assert.equal(one(db, w.state), before, `${w.name}: the write did not land without its log`);
    db.close();
  }
});

test('test 10: no summary names a seeded founder or holds an email', async () => {
  const db = seeded();
  for (const w of WRITES) assert.ok([200, 201].includes((await call(db, w.method, w.path, w.body)).status), w.name);
  const summaries = (db.prepare('SELECT action, details FROM activity_logs').all() as any[]);
  assert.equal(summaries.length, WRITES.length);
  for (const s of summaries) {
    assert.ok(s.details && s.details.trim(), `${s.action} has a summary`);
    for (const p of PRIVATE) assert.ok(!s.details.toLowerCase().includes(p), `${s.action}: "${s.details}" holds "${p}"`);
  }
  // The role PATCH names its record by role.
  assert.equal(summaries.find((s) => s.action === 'build_founder_role_changed').details, 'Role set to CTO');
  db.close();
});

test('test 10: another venture\'s record logs nothing', async () => {
  const db = seeded();
  db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, founder_role) VALUES (20, ${TEAMMATE}, ${P_OTHER}, 'Tomas Reyes', 'CEO')`);
  assert.equal((await call(db, 'PATCH', '/founders/20', { role: 'CFO' })).status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0);
  db.close();
});
