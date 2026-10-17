/**
 * D690 (S18-B, #1693) — every Build write logs its record (decision 15).
 *
 * #1693 ships test 10 here: each of today's writes in `cycle_build.ts` logs
 * one activity row through logCycleWrite's statement form, with the project,
 * the module's entity type and the record id, in the write's own batch. No
 * summary names a seeded founder. #1694 adds the record lines and #1695 the
 * new writes and actions.
 *
 * #1695's first PR adds test 6 (Add feature, Add must-have and the feature
 * PATCH's new fields), test 8 (Add founder through the cap table's own code
 * and plan gate), test 9's system PUT (a body without a connector key keeps
 * the mapping; a sync reaches only its owner's connection) and test 10's rows
 * for the new writes.
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
import cycleRecords from '../src/routes/cycle_records.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ROOT = process.cwd();
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const BASELINE = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const FOUNDER = 10, TEAMMATE = 11, PARTNER = 12, ADMIN = 13, OUTSIDER = 14;
const P = 1, P_OTHER = 2, COMPANY = 5, ENTITY = 7;
/** Every person-shaped string seeded below: no summary may hold one. */
const PRIVATE = ['ana', 'wren', 'tomas', 'reyes', 'example.test', 'okafor', 'imani', 'quinn'];

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
    (${FOUNDER}, 'founder', 'Ana Wren', 'ana@example.test', 1, 1001), (${TEAMMATE}, 'founder', 'Tomas Reyes', 'tomas@example.test', 1, NULL),
    (${PARTNER}, 'partner', 'Imani Okafor', 'imani@example.test', 1, NULL), (${ADMIN}, 'admin', 'Quinn Admin', 'quinn@example.test', 1, NULL),
    (${OUTSIDER}, 'founder', 'Okafor Founder', 'okafor@example.test', 1, 1002)`);
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
// #1695: the record route serves Build's actions and form-options beside the module routes.
app.route('/api/cycles', cycleRecords);
app.route('/api/cycles/build', build);
app.onError((e, c) => c.json({ error: e.message }, 500));
/** An R2 stand-in per database, so an uploaded proof can be looked up. */
const BUCKETS = new WeakMap<DatabaseSync, Map<string, { bytes: Uint8Array; type?: string }>>();
function bucket(db: DatabaseSync) {
  if (!BUCKETS.has(db)) BUCKETS.set(db, new Map());
  const store = BUCKETS.get(db)!;
  return { store, binding: {
    async put(key: string, bytes: Uint8Array, opts?: any) { store.set(key, { bytes, type: opts?.httpMetadata?.contentType }); },
    async get(key: string) { return store.get(key) ?? null; },
    async delete(key: string) { store.delete(key); },
  } };
}
const envFor = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES: bucket(db).binding }) as any;
async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  return callAs(db, FOUNDER, method, path, body);
}
async function callAs(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown, project = P) {
  const token = await new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const multipart = body instanceof FormData;
  // A thrown Response is the response, as the Worker's entry point answers it (util/thrownResponse.ts).
  const r = await withThrownResponses(() => app.request(`/api/cycles/build${path}${path.includes('?') ? '&' : '?'}project=${project}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  }, envFor(db)));
  return { status: r.status, body: await r.json().catch(() => null) as any };
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

// ---------------------------------------------------------------------------
// #1695, first PR: the new writes.
// ---------------------------------------------------------------------------

const HYP = 30, HYP_OTHER = 31, PAIN_OTHER = 32;
function withLinks(db: DatabaseSync) {
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim) VALUES (${HYP}, ${P}, 'H1', 'Finance teams reconcile weekly'), (${HYP_OTHER}, ${P_OTHER}, 'H1', 'Another venture')`);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (${PAIN_OTHER}, ${P_OTHER}, 'Another venture')`);
  return db;
}
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as any).n);

test('test 6: Add feature writes its theme, hypothesis, Impact and Effort; another venture\'s theme is a 404', async () => {
  const db = withLinks(seeded());
  const r = await call(db, 'POST', '/features', { title: 'CSV export', description: 'Export a month', pain_group_id: 1, hypothesis_id: HYP, impact: 'High', effort: 'Low', scope: 'core' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ...db.prepare('SELECT project_id, title, description, added_value, effort, scope, pain_group_id, hypothesis_id, is_must_have, delivery_status, created_by FROM mvp_features WHERE id = ?').get(r.body.id) },
    { project_id: P, title: 'CSV export', description: 'Export a month', added_value: 'High', effort: 'S', scope: 'core', pain_group_id: 1, hypothesis_id: HYP, is_must_have: 0, delivery_status: 'Backlog', created_by: FOUNDER });
  // With neither, MVP scope's own defaults; the stored words pass as they are.
  const plain = await call(db, 'POST', '/features', { title: 'Audit trail' });
  assert.deepEqual({ ...db.prepare('SELECT added_value, effort FROM mvp_features WHERE id = ?').get(plain.body.id) }, { added_value: 'Medium', effort: 'M' });
  const stored = await call(db, 'POST', '/features', { title: 'Rules', impact: 'Low', effort: 'XL' });
  assert.deepEqual({ ...db.prepare('SELECT added_value, effort FROM mvp_features WHERE id = ?').get(stored.body.id) }, { added_value: 'Low', effort: 'XL' });
  const before = count(db, 'SELECT COUNT(*) AS n FROM mvp_features');
  assert.equal((await call(db, 'POST', '/features', { title: 'Leak', pain_group_id: PAIN_OTHER })).status, 404);
  assert.equal((await call(db, 'POST', '/features', { title: 'Leak', hypothesis_id: HYP_OTHER })).status, 404);
  for (const bad of [{ title: '' }, { title: 'X', impact: 'Huge' }, { title: 'X', effort: 'tiny' }, { title: 'X', scope: 'later' }, { title: 'X', pain_group_id: 'one' }]) {
    assert.equal((await call(db, 'POST', '/features', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM mvp_features'), before, 'a refused feature writes nothing');
  db.close();
});

test('test 6: Add must-have maps its state, stores up to two links and keys a GitHub issue', async () => {
  const db = withLinks(seeded());
  const r = await call(db, 'POST', '/must-haves', { title: 'Bank sync', hypothesis_id: HYP, state: 'In progress', owner_user_id: TEAMMATE, due_date: '2027-02-01',
    links: ['https://www.figma.com/file/abc/Flows', 'https://github.com/kestrel/app/issues/42'] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ...db.prepare('SELECT title, hypothesis_id, is_must_have, delivery_status, done_at, owner_user_id, due_date, added_value FROM mvp_features WHERE id = ?').get(r.body.id) },
    { title: 'Bank sync', hypothesis_id: HYP, is_must_have: 1, delivery_status: 'In Progress', done_at: null, owner_user_id: TEAMMATE, due_date: '2027-02-01', added_value: 'High' });
  assert.deepEqual((db.prepare('SELECT feature_id, kind, url, external_ref, created_by FROM mvp_feature_links ORDER BY id').all() as any[]).map((x) => ({ ...x })), [
    { feature_id: r.body.id, kind: 'figma', url: 'https://www.figma.com/file/abc/Flows', external_ref: null, created_by: FOUNDER },
    { feature_id: r.body.id, kind: 'github', url: 'https://github.com/kestrel/app/issues/42', external_ref: 'issue:kestrel/app#42', created_by: FOUNDER },
  ]);
  const done = await call(db, 'POST', '/must-haves', { title: 'Login', state: 'done', links: ['https://github.com/kestrel/app/pull/7'] });
  assert.equal(done.status, 201);
  assert.equal((db.prepare('SELECT delivery_status, done_at IS NOT NULL AS dated FROM mvp_features WHERE id = ?').get(done.body.id) as any).dated, 1);
  assert.equal((db.prepare('SELECT external_ref FROM mvp_feature_links WHERE feature_id = ?').get(done.body.id) as any).external_ref, 'pull:kestrel/app#7');
  const features = count(db, 'SELECT COUNT(*) AS n FROM mvp_features'), links = count(db, 'SELECT COUNT(*) AS n FROM mvp_feature_links');
  for (const bad of [
    { title: 'X', links: ['https://evil.example/kestrel/app/issues/1'] },
    { title: 'X', links: ['http://github.com/kestrel/app/issues/1'] },
    { title: 'X', links: ['https://github.com.evil.example/a/b/issues/1'] },
    { title: 'X', links: ['https://figma.com/a', 'https://figma.com/b', 'https://figma.com/c'] },
    { title: 'X', state: 'shipped' },
    { title: 'X', owner_user_id: 99 },
  ]) assert.equal((await call(db, 'POST', '/must-haves', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await call(db, 'POST', '/must-haves', { title: 'X', hypothesis_id: HYP_OTHER })).status, 404);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM mvp_features'), features, 'a refused must-have writes no feature');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM mvp_feature_links'), links, 'and no link');
  db.close();
});

test('test 6: the feature PATCH sets title, description, Impact, Effort, state and scope; Done keeps its date', async () => {
  const db = withLinks(seeded());
  const r = await call(db, 'PATCH', '/features/3', { title: 'Bank feeds', description: 'Daily import', impact: 'low', effort: 'high', state: 'done', scope: 'out', hypothesis_id: HYP });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.prepare('SELECT title, description, added_value, effort, delivery_status, scope, hypothesis_id, done_at FROM mvp_features WHERE id = 3').get() as any;
  assert.deepEqual({ ...row, done_at: row.done_at != null }, { title: 'Bank feeds', description: 'Daily import', added_value: 'Low', effort: 'L', delivery_status: 'Done', scope: 'out', hypothesis_id: HYP, done_at: true });
  db.exec(`UPDATE mvp_features SET done_at = '2026-10-01 09:00:00' WHERE id = 3`);
  assert.equal((await call(db, 'PATCH', '/features/3', { state: 'Done', title: 'Bank feeds v2' })).status, 200);
  assert.equal((db.prepare('SELECT done_at FROM mvp_features WHERE id = 3').get() as any).done_at, '2026-10-01 09:00:00', 'Done keeps its first date');
  // A field the body leaves out stays.
  assert.equal((await call(db, 'PATCH', '/features/3', { scope: null })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT title, added_value, scope FROM mvp_features WHERE id = 3').get() }, { title: 'Bank feeds v2', added_value: 'Low', scope: null });
  const before = one(db, 'SELECT * FROM mvp_features WHERE id = 3');
  assert.equal((await call(db, 'PATCH', '/features/3', { hypothesis_id: HYP_OTHER })).status, 404);
  for (const bad of [{ title: '' }, { impact: 'Huge' }, { state: 'shipped' }, { effort: 7 }]) assert.equal((await call(db, 'PATCH', '/features/3', bad)).status, 400, JSON.stringify(bad));
  assert.equal(one(db, 'SELECT * FROM mvp_features WHERE id = 3'), before);
  db.close();
});

test('test 8: Add founder writes the holder, its role and its vesting through the cap table, and names the agreement next', async () => {
  const db = seeded();
  db.exec(`UPDATE users SET subscription_tier = 'studio' WHERE id = ${FOUNDER}`);
  const r = await call(db, 'POST', '/founders', { name: 'Lee Park', email: 'lee@example.test', role: 'CTO', equity_pct: 25, vesting: '4y_1y_cliff', vesting_start: '2026-11-01' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.id, /^h-\d+$/);
  assert.deepEqual(r.body.next, { label: 'Draft the co-founder agreement', href: '/raise/legal-engine/founders' });
  const holderId = Number(r.body.id.slice(2));
  assert.deepEqual({ ...db.prepare('SELECT user_id, project_id, name, email, founder_role, ownership_pct, kind FROM cap_table_holders WHERE id = ?').get(holderId) },
    { user_id: FOUNDER, project_id: P, name: 'Lee Park', email: 'lee@example.test', founder_role: 'CTO', ownership_pct: 25, kind: 'founder' });
  assert.deepEqual({ ...db.prepare('SELECT user_id, start_date, total_months, cliff_months FROM cap_table_vesting WHERE holder_id = ?').get(holderId) },
    { user_id: FOUNDER, start_date: '2026-11-01', total_months: 48, cliff_months: 12 });
  const read = await call(db, 'GET', '/modules/founding-team');
  const listed = read.body.records.rows.find((x: any) => x.id === r.body.id);
  assert.ok(listed, 'the module read lists the new founder');
  assert.equal(listed.cells.role, 'CTO');
  assert.match(String(listed.cells.vesting), /^4y.*cliff 1 Nov 2027/, 'with its vesting');
  // The split, changed through updateHolder(), keeps the other holders' share in view.
  assert.equal((await call(db, 'PATCH', `/founders/${r.body.id}`, { equity_pct: 40 })).status, 200);
  assert.equal((db.prepare('SELECT ownership_pct FROM cap_table_holders WHERE id = ?').get(holderId) as any).ownership_pct, 40);
  // Decision 15's exceptions: neither call logs in the holder's batch, and each still logs one row.
  assert.deepEqual((db.prepare('SELECT entity_type, entity_id, action, details FROM activity_logs ORDER BY id').all() as any[]).map((x) => ({ ...x })), [
    { entity_type: 'build.founding-team', entity_id: r.body.id, action: 'build_founder_created', details: 'Founder added as CTO' },
    { entity_type: 'build.founding-team', entity_id: r.body.id, action: 'build_founder_role_changed', details: 'Split or vesting changed' },
  ]);
  db.close();
});

test('test 8: equity over the unallocated share is refused with the share left', async () => {
  const db = seeded();
  db.exec(`UPDATE users SET subscription_tier = 'studio' WHERE id = ${FOUNDER}`);
  const r = await call(db, 'POST', '/founders', { name: 'Lee Park', role: 'CTO', equity_pct: 45 });
  assert.equal(r.status, 400);
  assert.equal(r.body.detail, 'That takes the cap table over 100%. The unallocated share is 40%.');
  assert.equal((await call(db, 'PATCH', '/founders/h-8', { equity_pct: 100.5 })).status, 400);
  assert.equal((await call(db, 'PATCH', '/founders/h-8', { equity_pct: 90 })).status, 200, 'holder 8 may take what it holds plus the 40% left');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cap_table_holders'), 1);
  db.close();
});

test('test 8: below the Studio plan, Add founder is the cap table\'s 402 and writes nothing; a role alone still saves', async () => {
  const db = seeded();
  db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${FOUNDER}`);
  const r = await call(db, 'POST', '/founders', { name: 'Lee Park', role: 'CTO', equity_pct: 20, vesting: '4y_no_cliff', vesting_start: '2026-11-01' });
  assert.equal(r.status, 402);
  assert.equal(r.body.error, 'tier_required');
  assert.equal(r.body.required, 'studio');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cap_table_holders'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM cap_table_vesting'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM activity_logs'), 0);
  assert.equal((await call(db, 'PATCH', '/founders/h-8', { equity_pct: 30 })).status, 402);
  assert.equal((db.prepare('SELECT ownership_pct FROM cap_table_holders WHERE id = 8').get() as any).ownership_pct, 60);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM activity_logs'), 0);
  const role = await call(db, 'PATCH', '/founders/h-8', { role: 'COO' });
  assert.equal(role.status, 200);
  assert.equal(role.body.id, 'h-8');
  assert.equal((db.prepare('SELECT founder_role FROM cap_table_holders WHERE id = 8').get() as any).founder_role, 'COO');
  db.close();
});

/** Two members' HubSpot connections, both enabled for the company. */
function withConnections(db: DatabaseSync) {
  db.exec(`UPDATE users SET founder_id = 1001 WHERE id = ${TEAMMATE}`); // a co-founder who may write
  db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, display_name, status, auth_type, config_json) VALUES
    (21, 'own-crm', ${FOUNDER}, 'hubspot', 'CRM one', 'active', 'oauth2', NULL), (22, 'mate-crm', ${TEAMMATE}, 'hubspot', 'CRM two', 'active', 'oauth2', '{"sync_frequency":"daily"}')`);
  db.exec(`INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (21, ${COMPANY}, 1), (22, ${COMPANY}, 1)`);
  return db;
}
const crm = (db: DatabaseSync) => ({ ...db.prepare(`SELECT integration_id, used_by, feeds_json, sync_request, sync_request_by, updated_by FROM project_core_systems WHERE project_id = ${P} AND kind = 'crm'`).get() as any });
const config = (db: DatabaseSync, id: number) => (db.prepare('SELECT config_json FROM integrations WHERE id = ?').get(id) as any).config_json;

test('test 9: a system PUT without a connector key keeps the mapping and Used by, and stores Feeds and a waiting sync', async () => {
  const db = withConnections(seeded());
  db.exec(`INSERT INTO project_core_systems (project_id, kind, integration_id, used_by, updated_by) VALUES (${P}, 'crm', 22, 'Sales', ${TEAMMATE})`);
  const r = await call(db, 'PUT', '/systems/crm', { feeds: ['kpis', 'team', 'kpis'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(crm(db), { integration_id: 22, used_by: 'Sales', feeds_json: '["kpis","team"]', sync_request: null, sync_request_by: null, updated_by: FOUNDER });
  assert.equal(config(db, 22), '{"sync_frequency":"daily"}', 'a feeds-only PUT leaves the connection alone');
  assert.equal((await call(db, 'PUT', '/systems/crm', { used_by: 'Revenue', feeds: ['kpis', 'team'] })).status, 200);
  assert.deepEqual([crm(db).integration_id, crm(db).used_by], [22, 'Revenue']);
  assert.equal(config(db, 22), '{"sync_frequency":"daily"}', 'and so does one with Used by and Feeds');
  // Only the connection's owner sets its sync.
  const theirs = await call(db, 'PUT', '/systems/crm', { sync: 'live' });
  assert.equal(theirs.status, 403);
  assert.equal(theirs.body.error, 'not_your_connection');
  assert.equal(config(db, 22), '{"sync_frequency":"daily"}');
  assert.equal((await callAs(db, TEAMMATE, 'PUT', '/systems/crm', { sync: 'hourly' })).status, 200);
  assert.equal(JSON.parse(config(db, 22)).sync_frequency, 'hourly');
  assert.equal(crm(db).feeds_json, '["kpis","team"]', 'a PUT without feeds keeps them');
  // Feeds come back as they were sent; null clears them.
  assert.equal((await call(db, 'PUT', '/systems/crm', { feeds: null })).status, 200);
  assert.equal(crm(db).feeds_json, null);
  for (const bad of [{ feeds: ['payroll'] }, { feeds: 'kpis' }, { sync: 'weekly' }, { sync: 1 }]) assert.equal((await call(db, 'PUT', '/systems/crm', bad)).status, 400, JSON.stringify(bad));
  db.close();
});

test('test 9: with no connection a sync waits; mapping your own connection writes your own waiting choice', async () => {
  const db = withConnections(seeded());
  const r = await call(db, 'PUT', '/systems/crm', { sync: 'hourly', used_by: 'Sales' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(crm(db), { integration_id: null, used_by: 'Sales', feeds_json: null, sync_request: 'hourly', sync_request_by: FOUNDER, updated_by: FOUNDER });
  // Mapping without used_by keeps Used by.
  assert.equal((await call(db, 'PUT', '/systems/crm', { integration_uid: 'own-crm' })).status, 200);
  assert.deepEqual(crm(db), { integration_id: 21, used_by: 'Sales', feeds_json: null, sync_request: null, sync_request_by: null, updated_by: FOUNDER });
  assert.equal(JSON.parse(config(db, 21)).sync_frequency, 'hourly');
  // The owner changes it with no key; a null key unmaps and keeps Used by.
  assert.equal((await call(db, 'PUT', '/systems/crm', { sync: 'manual' })).status, 200);
  assert.equal(JSON.parse(config(db, 21)).sync_frequency, 'manual');
  assert.equal((await call(db, 'PUT', '/systems/crm', { integration_uid: null })).status, 200);
  assert.deepEqual(crm(db), { integration_id: null, used_by: 'Sales', feeds_json: null, sync_request: null, sync_request_by: null, updated_by: FOUNDER });
  // A mapping that carries its own sync writes that one.
  assert.equal((await call(db, 'PUT', '/systems/crm', { integration_uid: 'own-crm', sync: 'live' })).status, 200);
  assert.equal(JSON.parse(config(db, 21)).sync_frequency, 'live');
  db.close();
});

test('test 9: a co-founder\'s waiting sync is cleared, not written, when someone else maps a connection', async () => {
  const db = withConnections(seeded());
  assert.equal((await callAs(db, TEAMMATE, 'PUT', '/systems/crm', { sync: 'live' })).status, 200);
  assert.equal(crm(db).sync_request_by, TEAMMATE);
  assert.equal((await call(db, 'PUT', '/systems/crm', { integration_uid: 'own-crm' })).status, 200);
  assert.equal(config(db, 21), null, 'the founder\'s connection keeps its own setting');
  assert.deepEqual([crm(db).integration_id, crm(db).sync_request, crm(db).sync_request_by], [21, null, null]);
  // The co-founder may still change the Feeds on a mapping they do not own.
  assert.equal((await callAs(db, TEAMMATE, 'PUT', '/systems/crm', { feeds: ['use_of_funds'] })).status, 200);
  assert.equal(crm(db).feeds_json, '["use_of_funds"]');
  assert.equal(config(db, 21), null);
  db.close();
});

test('test 9: a keyless Workspace PUT with no row stores nothing', async () => {
  const db = withConnections(seeded());
  const r = await call(db, 'PUT', '/systems/workspace', { feeds: ['team'] });
  assert.deepEqual([r.status, r.body], [200, { ok: true, kind: 'workspace', stored: false }]);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM project_core_systems WHERE kind = 'workspace'`), 0);
  db.exec(`INSERT INTO google_oauth_tokens (user_id, refresh_token) VALUES (${FOUNDER}, 'enc-placeholder')`);
  assert.equal((await call(db, 'PUT', '/systems/workspace', { provider_key: 'google_calendar', used_by: 'Everyone' })).status, 200);
  assert.equal((await call(db, 'PUT', '/systems/workspace', { feeds: ['team'] })).status, 200);
  assert.deepEqual({ ...db.prepare(`SELECT provider_key, used_by, feeds_json FROM project_core_systems WHERE kind = 'workspace'`).get() },
    { provider_key: 'google_calendar', used_by: 'Everyone', feeds_json: '["team"]' });
  assert.equal((await call(db, 'PUT', '/systems/workspace', { provider_key: null })).status, 200);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM project_core_systems WHERE kind = 'workspace'`), 0);
  db.close();
});

/** #1695's new writes: each logs its row, in its own batch where it owns one. */
const NEW_WRITES: Array<{ name: string; path: string; body: unknown; action: string; entityType: string; entityId: (r: any) => string; state: string; batched: boolean }> = [
  { name: 'Add feature', path: '/features', body: { title: 'CSV export', impact: 'High' }, action: 'build_feature_created', entityType: 'build.solution-design',
    entityId: (r) => String(r.id), state: 'SELECT COUNT(*) AS n FROM mvp_features', batched: true },
  { name: 'Add must-have', path: '/must-haves', body: { title: 'Bank sync', links: ['https://github.com/kestrel/app/issues/42'] }, action: 'build_must_have_created', entityType: 'build.solution-design',
    entityId: (r) => String(r.id), state: 'SELECT (SELECT COUNT(*) FROM mvp_features) || \'/\' || (SELECT COUNT(*) FROM mvp_feature_links) AS n', batched: true },
  { name: 'Add founder', path: '/founders', body: { name: 'Lee Park', email: 'lee@example.test', role: 'CTO', equity_pct: 20 }, action: 'build_founder_created', entityType: 'build.founding-team',
    entityId: (r) => r.id, state: 'SELECT COUNT(*) AS n FROM cap_table_holders', batched: false },
];

test('test 10: the new writes log one row each, with the new record\'s id', async () => {
  for (const w of NEW_WRITES) {
    const db = seeded();
    db.exec(`UPDATE users SET subscription_tier = 'studio' WHERE id = ${FOUNDER}`);
    const r = await call(db, 'POST', w.path, w.body);
    assert.equal(r.status, 201, `${w.name}: ${JSON.stringify(r.body)}`);
    const rows = (db.prepare('SELECT project_id, user_id, entity_type, entity_id, action, details FROM activity_logs').all() as any[]).map((x) => ({ ...x }));
    assert.equal(rows.length, 1, w.name);
    assert.deepEqual({ ...rows[0], details: undefined }, { project_id: P, user_id: FOUNDER, entity_type: w.entityType, entity_id: w.entityId(r.body), action: w.action, details: undefined }, w.name);
    for (const p of PRIVATE.concat(['lee', 'park'])) assert.ok(!rows[0].details.toLowerCase().includes(p), `${w.name}: "${rows[0].details}" holds "${p}"`);
    db.close();
  }
});

test('test 10: a feature or must-have whose log fails is not written', async () => {
  for (const w of NEW_WRITES.filter((x) => x.batched)) {
    const db = seeded();
    db.exec(`CREATE TRIGGER reject_log BEFORE INSERT ON activity_logs WHEN NEW.action = '${w.action}' BEGIN SELECT RAISE(ABORT, 'log failure'); END`);
    const before = one(db, w.state);
    assert.equal((await call(db, 'POST', w.path, w.body)).status, 500, w.name);
    assert.equal(one(db, w.state), before, w.name);
    db.close();
  }
});

// ---------------------------------------------------------------------------
// #1695, closing PR: the roadmap and filing routes, every record action and
// Build's form-options, through the one record route (D-n(6)).
// ---------------------------------------------------------------------------

const rec = (db: DatabaseSync, slug: string, id: string, user = FOUNDER, project = P) =>
  callAs(db, user, 'GET', `/modules/${slug}/records/${id}`, undefined, project);
const act = (db: DatabaseSync, slug: string, id: string, key: string, body: unknown = {}, user = FOUNDER, project = P) =>
  callAs(db, user, 'POST', `/modules/${slug}/records/${id}/actions/${key}`, body, project);
const formOptions = (db: DatabaseSync, slug: string, user = FOUNDER) => callAs(db, user, 'GET', `/modules/${slug}/form-options`);
const keysOf = (r: any) => r.body.actions.map((a: any) => a.key);
const actionOf = (r: any, key: string) => r.body.actions.find((a: any) => a.key === key);
const valuesOf = (r: any, key = 'edit') => Object.fromEntries(actionOf(r, key).form.fields.map((f: any) => [f.key, f.value]));
const logCount = (db: DatabaseSync) => count(db, 'SELECT COUNT(*) AS n FROM activity_logs');
const PDF = () => new TextEncoder().encode('%PDF-1.4\n% a made-up receipt\n');
function proofForm(bytes: Uint8Array, name: string, type = 'application/pdf') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return form;
}
/** Venture A's records beyond the seed: a must-have with a session and a check, a second item, and a lab order. */
function recordsA(db: DatabaseSync) {
  withLinks(db);
  db.exec(`UPDATE mvp_features SET is_must_have = 1, delivery_status = 'Backlog' WHERE id = 3`);
  db.exec(`INSERT INTO mvp_test_sessions (id, project_id, feature_id, title) VALUES (50, ${P}, 3, 'Usability pass')`);
  db.exec(`INSERT INTO mvp_release_checks (id, feature_id, label) VALUES (51, 3, 'Error states reviewed')`);
  db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status, sort_order) VALUES (7, ${P}, 'Pilot bank feeds', 'next', 1)`);
  db.exec(`INSERT INTO incorporations (id, user_id, project_id, jurisdiction_id, company_name, amount_cents, status, paid_at) VALUES (8, ${FOUNDER}, ${P}, 'DE', 'Kestrel Works Inc', 50000, 'paid', '2026-09-01')`);
  db.exec(`INSERT INTO custom_kpis (uid, project_id, label) VALUES ('ownkpi', ${P}, 'Activation rate'), ('otherkpi', ${P_OTHER}, 'Another venture')`);
  return db;
}
/** Venture B's rows, one per store an action can name. */
function recordsB(db: DatabaseSync) {
  db.exec(`INSERT INTO mvp_features (id, project_id, title, is_must_have) VALUES (40, ${P_OTHER}, 'Another feature', 1)`);
  db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status) VALUES (41, ${P_OTHER}, 'Another item', 'now')`);
  db.exec(`INSERT INTO cap_table_holders (id, user_id, project_id, name, ownership_pct, founder_role) VALUES (42, ${OUTSIDER}, ${P_OTHER}, 'Okafor Founder', 50, 'CEO')`);
  db.exec(`INSERT INTO formation_steps (id, project_id, title, state, proof_file_key, created_by) VALUES (43, ${P_OTHER}, 'Another filing', 'todo', 'build-proof/${P_OTHER}/abc.pdf', ${OUTSIDER})`);
  db.exec(`INSERT INTO mvp_test_sessions (id, project_id, feature_id, title) VALUES (46, ${P_OTHER}, 40, 'Another session')`);
  db.exec(`INSERT INTO mvp_release_checks (id, feature_id, label) VALUES (47, 40, 'Another check')`);
  return db;
}
const A: Record<string, string> = { 'solution-design': '3', 'prototype-mvp': '3', 'product-roadmap': '6', 'founding-team': 'h-8', 'company-creation': 'step-9', 'operating-systems': 'crm' };
const B: Record<string, string> = { 'solution-design': '40', 'prototype-mvp': '40', 'product-roadmap': '41', 'founding-team': 'h-42', 'company-creation': 'step-43' };

test('test 2: an obligation- row declares Upload proof and no Mark filed; a lab- row declares no action', async () => {
  const db = recordsA(seeded());
  const obligation = await rec(db, 'company-creation', 'obligation-12');
  assert.equal(obligation.status, 200, JSON.stringify(obligation.body));
  assert.deepEqual(keysOf(obligation), ['upload-proof']);
  const step = await rec(db, 'company-creation', 'step-9');
  assert.deepEqual(keysOf(step), ['mark-filed', 'step-check', 'edit', 'upload-proof']);
  const lab = await rec(db, 'company-creation', 'lab-8-0');
  assert.equal(lab.status, 200);
  assert.deepEqual(lab.body.actions, []);
  assert.equal((await act(db, 'company-creation', 'obligation-12', 'mark-filed')).status, 404);
  assert.equal((await act(db, 'company-creation', 'lab-8-0', 'upload-proof', proofForm(PDF(), 'x.pdf'))).status, 404);
  db.close();
});

test('test 5: the role table for actions, writes and form-options', async () => {
  const db = recordsA(seeded());
  for (const user of [FOUNDER, ADMIN]) {
    const r = await rec(db, 'solution-design', '3', user);
    assert.equal(r.status, 200, `user ${user}`);
    assert.ok(keysOf(r).includes('edit'), `user ${user} is offered the writes`);
    assert.equal((await formOptions(db, 'solution-design', user)).status, 200, `user ${user}`);
  }
  assert.equal((await act(db, 'solution-design', '3', 'scope-out', {}, ADMIN)).status, 200, 'an admin writes');
  const partner = await rec(db, 'solution-design', '3', PARTNER);
  assert.equal(partner.status, 200, 'a partner reads');
  assert.deepEqual(partner.body.actions, [], 'and is offered nothing');
  const before = logCount(db);
  assert.equal((await act(db, 'solution-design', '3', 'mark-must-have', {}, PARTNER)).status, 403);
  assert.equal((await callAs(db, PARTNER, 'PATCH', '/modules/solution-design/records/3', { title: 'Renamed' })).status, 403);
  assert.equal((await formOptions(db, 'solution-design', PARTNER)).status, 403);
  // Another venture's founder: 403 under this venture, 404 for this venture's id under their own.
  assert.equal((await rec(db, 'solution-design', '3', OUTSIDER)).status, 403);
  assert.equal((await act(db, 'solution-design', '3', 'mark-must-have', {}, OUTSIDER)).status, 403);
  assert.equal((await formOptions(db, 'solution-design', OUTSIDER)).status, 403);
  assert.equal((await act(db, 'solution-design', '3', 'mark-must-have', {}, OUTSIDER, P_OTHER)).status, 404);
  assert.equal(logCount(db), before, 'no refused call logged anything');
  db.close();
});

test('test 5: a venture-B id under ?project=A is a 404 on every action, PATCH, upload and open-proof', async () => {
  const db = recordsB(recordsA(seeded()));
  db.exec(`UPDATE formation_steps SET proof_file_key = 'build-proof/${P}/0123456789abcdef0123456789abcdef.pdf' WHERE id = 9`);
  for (const slug of Object.keys(B)) {
    const own = await rec(db, slug, A[slug]);
    assert.equal(own.status, 200, slug);
    for (const key of keysOf(own)) {
      const r = await act(db, slug, B[slug], key, key === 'upload-proof' ? proofForm(PDF(), 'x.pdf') : {});
      assert.equal(r.status, 404, `${slug} ${key} on venture B's id`);
    }
    assert.equal((await callAs(db, FOUNDER, 'PATCH', `/modules/${slug}/records/${B[slug]}`, {})).status, 404, `${slug} PATCH`);
  }
  assert.equal(logCount(db), 0);
  assert.equal(bucket(db).store.size, 0, 'no proof was stored');
  // Venture A's own: each module's Edit sent back unchanged answers 200.
  for (const slug of Object.keys(A)) {
    const own = await rec(db, slug, A[slug]);
    const r = await act(db, slug, A[slug], 'edit', valuesOf(own));
    assert.equal(r.status, 200, `${slug}: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await act(db, 'company-creation', 'step-9', 'open-proof')).status, 200);
  db.close();
});

test('test 5: a venture-B id inside a body is a 404 and writes nothing; venture A\'s own is 200', async () => {
  const db = recordsB(recordsA(seeded()));
  const cases: Array<[string, string, string, unknown, unknown]> = [
    ['solution-design', '3', 'edit', { pain_group_id: String(PAIN_OTHER) }, { pain_group_id: '1' }],
    ['solution-design', '3', 'edit', { hypothesis_id: String(HYP_OTHER) }, { hypothesis_id: String(HYP) }],
    ['prototype-mvp', '3', 'edit', { hypothesis_id: String(HYP_OTHER) }, { hypothesis_id: String(HYP) }],
    ['prototype-mvp', '3', 'add-finding', { session_id: '46', text: 'Found it' }, { session_id: '50', text: 'Found it' }],
    ['prototype-mvp', '3', 'add-finding', { session_id: '50', text: 'Found it', hypothesis_id: String(HYP_OTHER) }, { session_id: '50', text: 'Found it', hypothesis_id: String(HYP) }],
    ['prototype-mvp', '3', 'check', { check_id: '47' }, { check_id: '51' }],
    ['product-roadmap', '6', 'add-dependency', { waits_on_id: '41' }, { waits_on_id: '7' }],
    ['product-roadmap', '6', 'edit', { feature_id: '40' }, { feature_id: '3' }],
    ['product-roadmap', '6', 'edit', { kpi_key: 'custom-otherkpi' }, { kpi_key: 'custom-ownkpi' }],
    ['company-creation', 'step-9', 'edit', { for_holder_id: 'h-42' }, { for_holder_id: 'h-8' }],
  ];
  for (const [slug, id, key, foreign, own] of cases) {
    const before = logCount(db);
    const refused = await act(db, slug, id, key, foreign);
    assert.equal(refused.status, 404, `${slug} ${key} ${JSON.stringify(foreign)}: ${JSON.stringify(refused.body)}`);
    assert.equal(logCount(db), before, `${slug} ${key}: nothing written`);
    const allowed = await act(db, slug, id, key, own);
    assert.equal(allowed.status, 200, `${slug} ${key} ${JSON.stringify(own)}: ${JSON.stringify(allowed.body)}`);
  }
  // The routes refuse the same ids.
  const items = count(db, 'SELECT COUNT(*) AS n FROM roadmap_okrs'), steps = count(db, 'SELECT COUNT(*) AS n FROM formation_steps');
  assert.equal((await call(db, 'POST', '/roadmap', { title: 'Leak', feature_id: 40 })).status, 404);
  assert.equal((await call(db, 'POST', '/roadmap', { title: 'Leak', waits_on_id: 41 })).status, 404);
  assert.equal((await call(db, 'POST', '/roadmap', { title: 'Leak', kpi_key: 'custom-otherkpi' })).status, 404);
  assert.equal((await call(db, 'POST', '/formation-steps', { kind: '83b', for_holder_id: 'h-42' })).status, 404);
  assert.equal((await call(db, 'POST', '/risks', { title: 'Leak', severity: 'low', feature_id: 40 })).status, 404);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM roadmap_okrs'), items);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM formation_steps'), steps);
  db.close();
});

test('test 5: an undeclared action is refused, and open-proof answers only for this venture\'s own key', async () => {
  const db = recordsA(seeded());
  assert.equal((await act(db, 'solution-design', '3', 'fly')).status, 404);
  assert.equal((await act(db, 'solution-design', '3', 'mark-must-have')).status, 404, 'a must-have is not offered Mark as must-have again');
  db.exec(`UPDATE mvp_features SET is_must_have = 0 WHERE id = 3`);
  assert.equal((await act(db, 'solution-design', '3', 'mark-must-have')).status, 200);
  assert.equal(count(db, 'SELECT is_must_have AS n FROM mvp_features WHERE id = 3'), 1);
  for (const key of ['typed-key-1', `build-proof/${P_OTHER}/0123456789abcdef0123456789abcdef.pdf`, `xbuild-proof/${P}/a.pdf`]) {
    db.exec(`UPDATE formation_steps SET proof_file_key = '${key}' WHERE id = 9`);
    assert.ok(!keysOf(await rec(db, 'company-creation', 'step-9')).includes('open-proof'), key);
    assert.equal((await act(db, 'company-creation', 'step-9', 'open-proof')).status, 404, key);
  }
  db.exec(`UPDATE formation_steps SET proof_file_key = 'build-proof/${P}/0123456789abcdef0123456789abcdef.pdf' WHERE id = 9`);
  const open = await act(db, 'company-creation', 'step-9', 'open-proof');
  assert.equal(open.status, 200);
  assert.match(open.body.open.url, /^\/api\/files\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  db.close();
});

test('test 6: a GitHub link reads synced only when this venture\'s ledger holds it', async () => {
  const db = seeded();
  const r = await call(db, 'POST', '/must-haves', { title: 'Bank sync', links: ['https://github.com/kestrel/app/issues/42'] });
  assert.equal(r.status, 201);
  const linked = async () => (await rec(db, 'prototype-mvp', String(r.body.id))).body.side.find((x: any) => x.key === 'linked').rows.map((x: any) => x.b);
  assert.deepEqual(await linked(), ['issue #42 · Not synced']);
  db.exec(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, last_seen_at) VALUES (1, ${P_OTHER}, 'build', 'issue', 'issue:kestrel/app#42', '2026-10-12 08:00:00')`);
  assert.deepEqual(await linked(), ['issue #42 · Not synced'], 'another venture\'s ledger row does not count');
  db.exec(`INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, last_seen_at) VALUES (2, ${P}, 'build', 'issue', 'issue:kestrel/app#42', '2026-10-12 08:00:00')`);
  assert.deepEqual(await linked(), ['issue #42 · synced 12 Oct 2026']);
  db.close();
});

test('test 6: the feature and must-have actions write their stores', async () => {
  const db = recordsA(seeded());
  assert.equal((await act(db, 'solution-design', '3', 'add-risk', { title: 'Bank rate limits', severity: 'high' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT title, severity, feature_id FROM venture_risks ORDER BY id DESC LIMIT 1').get() }, { title: 'Bank rate limits', severity: 'high', feature_id: 3 });
  assert.equal((await act(db, 'solution-design', '3', 'edit-description', { description: 'Daily import from the bank' })).status, 200);
  assert.equal((await act(db, 'solution-design', '3', 'scope-out')).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT description, scope FROM mvp_features WHERE id = 3').get() }, { description: 'Daily import from the bank', scope: 'out' });
  assert.ok(keysOf(await rec(db, 'solution-design', '3')).includes('scope-in'), 'an out-of-scope feature offers Move into scope');
  assert.equal((await act(db, 'solution-design', '3', 'add-to-roadmap', { title: 'Bank feeds GA', column: 'later' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT objective, kanban_status, feature_id FROM roadmap_okrs ORDER BY id DESC LIMIT 1').get() }, { objective: 'Bank feeds GA', kanban_status: 'later', feature_id: 3 });
  // Prototype / MVP.
  assert.equal((await act(db, 'prototype-mvp', '3', 'add-session', { title: 'Second pass', held_on: '2026-10-20', status: 'done', owner_user_id: String(TEAMMATE) })).status, 200);
  assert.equal((await act(db, 'prototype-mvp', '3', 'add-session', { title: 'X', owner_user_id: '99' })).status, 400, 'an owner outside the company');
  assert.equal((await act(db, 'prototype-mvp', '3', 'add-finding', { session_id: '50', text: 'Users skip the import', hypothesis_id: String(HYP), direction: 'contradicts', kept: false })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT session_id, text, hypothesis_id, direction, kept FROM mvp_test_findings').get() }, { session_id: 50, text: 'Users skip the import', hypothesis_id: HYP, direction: 'contradicts', kept: 0 });
  // A session or check of this venture's other feature is not this record's.
  db.exec(`INSERT INTO mvp_features (id, project_id, title, is_must_have) VALUES (60, ${P}, 'Audit export', 1)`);
  db.exec(`INSERT INTO mvp_test_sessions (id, project_id, feature_id, title) VALUES (61, ${P}, 60, 'Export pass')`);
  db.exec(`INSERT INTO mvp_release_checks (id, feature_id, label) VALUES (62, 60, 'Export reviewed')`);
  assert.equal((await act(db, 'prototype-mvp', '3', 'add-finding', { session_id: '61', text: 'Elsewhere' })).status, 404);
  assert.equal((await act(db, 'prototype-mvp', '3', 'check', { check_id: '62' })).status, 404);
  assert.equal(db.prepare('SELECT done_at FROM mvp_release_checks WHERE id = 62').get()!.done_at, null);
  assert.equal((await act(db, 'prototype-mvp', '3', 'link', { url: 'https://www.figma.com/file/abc' })).status, 200);
  assert.equal((await act(db, 'prototype-mvp', '3', 'link', { url: 'https://www.figma.com/file/abc' })).status, 409, 'the same link twice');
  assert.equal((await act(db, 'prototype-mvp', '3', 'link', { url: 'https://evil.example/file' })).status, 400);
  assert.equal((await act(db, 'prototype-mvp', '3', 'add-check', { label: 'Copy reviewed' })).status, 200);
  assert.equal((await act(db, 'prototype-mvp', '3', 'check', { check_id: '51', done: true })).status, 200);
  assert.ok(db.prepare('SELECT done_at FROM mvp_release_checks WHERE id = 51').get()!.done_at);
  assert.equal((await act(db, 'prototype-mvp', '3', 'check', { check_id: '51', done: false })).status, 200);
  assert.equal(db.prepare('SELECT done_at FROM mvp_release_checks WHERE id = 51').get()!.done_at, null);
  assert.equal((await act(db, 'prototype-mvp', '3', 'mark-blocked')).status, 200);
  assert.equal(db.prepare('SELECT delivery_status FROM mvp_features WHERE id = 3').get()!.delivery_status, 'Blocked');
  assert.ok(!keysOf(await rec(db, 'prototype-mvp', '3')).includes('mark-blocked'), 'a blocked must-have is not offered Mark blocked');
  assert.equal((await act(db, 'prototype-mvp', '3', 'mark-done')).status, 200);
  const done = db.prepare('SELECT delivery_status, done_at FROM mvp_features WHERE id = 3').get() as any;
  assert.deepEqual([done.delivery_status, !!done.done_at], ['Done', true], 'migration 441 dates the move to Done');
  const after = await rec(db, 'prototype-mvp', '3');
  assert.ok(!keysOf(after).includes('mark-done'));
  assert.deepEqual(after.body.facts.find((f: any) => f.label === 'Tests run').value, 1);
  db.close();
});

test('test 7: Add item writes its edge, links its theme\'s open rows, and keeps the free-tier cap', async () => {
  const db = withLinks(seeded());
  db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, theme, status, roadmap_item_ref) VALUES
    ('f1', ${P}, 'Import is slow', 'customer', 'Onboarding', 'open', NULL),
    ('f2', ${P}, 'Already planned', 'customer', 'Onboarding', 'planned', NULL),
    ('f3', ${P}, 'Answered elsewhere', 'customer', 'Onboarding', 'open', '99'),
    ('f4', ${P_OTHER}, 'Another venture', 'customer', 'Onboarding', 'open', NULL),
    ('f5', ${P}, 'Too pricey', 'customer', 'Pricing', 'open', NULL)`);
  db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${FOUNDER}`);
  const r = await call(db, 'POST', '/roadmap', { title: 'Faster import', column: 'now', waits_on_id: 6, kpi_key: 'mrr', feedback_theme: 'Onboarding',
    owner_user_id: TEAMMATE, target_date: '2027-01-31', feature_id: 3 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ...db.prepare('SELECT objective, kanban_status, kpi_key, feedback_theme, owner_user_id, target_date, feature_id, created_by FROM roadmap_okrs WHERE id = ?').get(r.body.id) },
    { objective: 'Faster import', kanban_status: 'now', kpi_key: 'mrr', feedback_theme: 'Onboarding', owner_user_id: TEAMMATE, target_date: '2027-01-31', feature_id: 3, created_by: FOUNDER });
  assert.deepEqual((db.prepare('SELECT okr_id, blocks_okr_id FROM okr_dependencies').all() as any[]).map((x) => ({ ...x })), [{ okr_id: 6, blocks_okr_id: r.body.id }]);
  assert.deepEqual((db.prepare('SELECT uid, roadmap_item_ref, roadmap_item_label FROM product_feedback ORDER BY uid').all() as any[]).map((x) => ({ ...x })), [
    { uid: 'f1', roadmap_item_ref: String(r.body.id), roadmap_item_label: 'Faster import' },
    { uid: 'f2', roadmap_item_ref: null, roadmap_item_label: null },
    { uid: 'f3', roadmap_item_ref: '99', roadmap_item_label: null },
    { uid: 'f4', roadmap_item_ref: null, roadmap_item_label: null },
    { uid: 'f5', roadmap_item_ref: null, roadmap_item_label: null },
  ]);
  // A cycle is refused, and leaves neither an edge nor a log row.
  const logs = logCount(db);
  const cycle = await act(db, 'product-roadmap', '6', 'add-dependency', { waits_on_id: String(r.body.id) });
  assert.equal(cycle.status, 409);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM okr_dependencies'), 1);
  assert.equal(logCount(db), logs);
  assert.equal((await act(db, 'product-roadmap', '6', 'add-dependency', { waits_on_id: String(r.body.id), blocks_id: '6' })).status, 400, 'exactly one end');
  // The column defaults to Next; a KPI off the list is refused.
  const plain = await call(db, 'POST', '/roadmap', { title: 'Audit log' });
  assert.equal(db.prepare('SELECT kanban_status FROM roadmap_okrs WHERE id = ?').get(plain.body.id)!.kanban_status, 'next');
  assert.equal((await call(db, 'POST', '/roadmap', { title: 'X', kpi_key: 'activation' })).status, 400);
  assert.equal((await call(db, 'PATCH', '/roadmap/6', { kpi_key: 'activation' })).status, 400);
  assert.equal((await call(db, 'PATCH', '/roadmap/6', { kpi_key: 'paying_accounts' })).status, 200);
  assert.equal((await call(db, 'POST', '/roadmap', { title: 'X', column: 'done' })).status, 400, 'an item is added to Now, Next or Later');
  db.close();
});

test('test 7: the free-tier cap still applies to Add item', async () => {
  const db = seeded();
  db.exec(`INSERT INTO roadmap_okrs (id, project_id, objective, kanban_status) VALUES (20, ${P}, 'Two', 'next'), (21, ${P}, 'Three', 'later')`);
  const capped = await call(db, 'POST', '/roadmap', { title: 'Four' });
  assert.equal(capped.status, 402);
  assert.equal(capped.body.error, 'tier_required');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM roadmap_okrs'), 3);
  db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${FOUNDER}`);
  assert.equal((await call(db, 'POST', '/roadmap', { title: 'Four' })).status, 201);
  db.close();
});

test('test 7: move writes okr_column_moves, and is offered as "Move to <the next column>"', async () => {
  const db = recordsA(seeded());
  const item = await rec(db, 'product-roadmap', '6');
  const move = actionOf(item, 'move');
  assert.equal(move.label, 'Move to Next');
  assert.equal(move.form.fields[0].value, 'next');
  assert.deepEqual(move.form.fields[0].options.map((o: any) => o.value), ['next', 'later', 'done']);
  assert.equal((await act(db, 'product-roadmap', '6', 'move', { to: 'now' })).status, 400, 'its own column');
  assert.equal((await act(db, 'product-roadmap', '6', 'move', { to: 'done' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT okr_id, from_status, to_status FROM okr_column_moves').get() }, { okr_id: 6, from_status: 'now', to_status: 'done' });
  assert.equal(db.prepare('SELECT kanban_status FROM roadmap_okrs WHERE id = 6').get()!.kanban_status, 'done');
  assert.ok(!keysOf(await rec(db, 'product-roadmap', '6')).includes('move'), 'a Done item offers none');
  // Edit reopens it, through the same move.
  assert.equal((await act(db, 'product-roadmap', '6', 'edit', { column: 'later' })).status, 200);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM okr_column_moves'), 2);
  // An Edit that renames and moves logs the move under the item's new name.
  assert.equal((await act(db, 'product-roadmap', '6', 'edit', { title: 'Ship reconciliation v2', column: 'next' })).status, 200);
  assert.equal(db.prepare(`SELECT details FROM activity_logs WHERE action = 'roadmap_moved' ORDER BY id DESC LIMIT 1`).get()!.details,
    'Ship reconciliation v2 moved to next');
  assert.equal(actionOf(await rec(db, 'product-roadmap', '7'), 'move').label, 'Move to Later');
  db.close();
});

test('test 9: Add filing stores kind, jurisdiction and founder; an 83(b) is titled for its founder', async () => {
  const db = seeded();
  const r = await call(db, 'POST', '/formation-steps', { kind: '83b', for_holder_id: 'h-8', jurisdiction: 'DE', due_date: '2026-12-20', state: 'due_soon' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ ...db.prepare('SELECT title, kind, jurisdiction, for_holder_id, due_date, state FROM formation_steps WHERE id = ?').get(r.body.id) },
    { title: '83(b) election · Ana Wren', kind: '83b', jurisdiction: 'DE', for_holder_id: 8, due_date: '2026-12-20', state: 'todo' });
  const ein = await call(db, 'POST', '/formation-steps', { kind: 'ein', state: 'filed' });
  assert.deepEqual({ ...db.prepare('SELECT title, state FROM formation_steps WHERE id = ?').get(ein.body.id) }, { title: 'EIN', state: 'done' });
  const before = count(db, 'SELECT COUNT(*) AS n FROM formation_steps');
  assert.equal((await call(db, 'POST', '/formation-steps', { kind: 'formation', state: 'due_soon' })).status, 400, 'Due soon needs a date');
  assert.equal((await call(db, 'POST', '/formation-steps', {})).status, 400, 'neither a title nor a kind');
  assert.equal((await call(db, 'POST', '/formation-steps', { kind: 'llc' })).status, 400);
  assert.equal((await call(db, 'POST', '/formation-steps', { kind: 'formation', state: 'sent' })).status, 400);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM formation_steps'), before);
  // Today's Edit still sends todo, doing and done.
  assert.equal((await call(db, 'PATCH', '/formation-steps/9', { state: 'doing' })).status, 200);
  assert.equal((await call(db, 'PATCH', '/formation-steps/9', { kind: 'franchise_tax', jurisdiction: 'DE' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT title, kind, jurisdiction, state FROM formation_steps WHERE id = 9').get() },
    { title: '83(b) election · Ana Wren', kind: 'franchise_tax', jurisdiction: 'DE', state: 'doing' }, 'the Filing cell stays the stored title');
  db.close();
});

test('test 9: Mark filed, the step checks and Upload proof, which stores a key without the file name', async () => {
  const db = recordsA(seeded());
  const step = await rec(db, 'company-creation', 'step-9');
  assert.deepEqual(valuesOf(step), { title: '83(b) election · Ana Wren', kind: '', jurisdiction: '', for_holder_id: '', due_date: '2026-12-01', state: 'upcoming' });
  assert.equal((await act(db, 'company-creation', 'step-9', 'edit', { kind: '83b', for_holder_id: 'h-8', jurisdiction: 'DE' })).status, 200);
  assert.deepEqual(valuesOf(await rec(db, 'company-creation', 'step-9')),
    { title: '83(b) election · Ana Wren', kind: '83b', jurisdiction: 'DE', for_holder_id: 'h-8', due_date: '2026-12-01', state: 'upcoming' });
  assert.equal((await act(db, 'company-creation', 'step-9', 'step-check', { key: 'fill' })).status, 200);
  assert.equal((await act(db, 'company-creation', 'step-9', 'step-check', { key: 'proof' })).status, 400, 'the last step is the proof');
  // A renamed text file is refused, and stores nothing.
  const fake = await act(db, 'company-creation', 'step-9', 'upload-proof', proofForm(new TextEncoder().encode('not a pdf'), 'receipt.pdf'));
  assert.equal(fake.status, 400);
  assert.equal(db.prepare('SELECT proof_file_key FROM formation_steps WHERE id = 9').get()!.proof_file_key, null);
  assert.equal(bucket(db).store.size, 0);
  assert.equal((await act(db, 'company-creation', 'step-9', 'upload-proof', proofForm(new Uint8Array(10 * 1024 * 1024 + 1), 'big.pdf'))).status, 413);
  assert.equal((await act(db, 'company-creation', 'step-9', 'upload-proof', { file: 'x' })).status, 400, 'a JSON body is not an upload');
  const up = await act(db, 'company-creation', 'step-9', 'upload-proof', proofForm(PDF(), 'Ana Wren 83b receipt.pdf', 'text/plain'));
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const key = db.prepare('SELECT proof_file_key FROM formation_steps WHERE id = 9').get()!.proof_file_key as string;
  assert.match(key, new RegExp(`^build-proof/${P}/[0-9a-f]{32}\\.pdf$`));
  assert.deepEqual([...bucket(db).store.keys()], [key]);
  assert.equal(bucket(db).store.get(key)!.type, 'application/pdf', 'the sniffed type, not the declared one');
  const after = await rec(db, 'company-creation', 'step-9');
  assert.deepEqual(after.body.main.find((x: any) => x.key === 'steps').rows.map((x: any) => [x.a, x.c]),
    [['Fill the election', 'Done'], ['Mail by certified post', 'Open'], ['Upload proof of mailing', 'Done']]);
  assert.equal(db.prepare('SELECT state FROM formation_steps WHERE id = 9').get()!.state, 'todo', 'the upload does not mark it filed');
  // A second upload replaces the object.
  assert.equal((await act(db, 'company-creation', 'step-9', 'upload-proof', proofForm(PDF(), 'again.pdf'))).status, 200);
  assert.equal(bucket(db).store.size, 1);
  assert.equal((await act(db, 'company-creation', 'step-9', 'mark-filed')).status, 200);
  assert.equal(db.prepare('SELECT state FROM formation_steps WHERE id = 9').get()!.state, 'done');
  assert.ok(!keysOf(await rec(db, 'company-creation', 'step-9')).includes('mark-filed'));
  // An obligation's proof goes on its own row.
  assert.equal((await act(db, 'company-creation', 'obligation-12', 'upload-proof', proofForm(PDF(), 'tax.pdf'))).status, 200);
  assert.match(db.prepare('SELECT proof_file_key FROM entity_obligations WHERE id = 12').get()!.proof_file_key as string, new RegExp(`^build-proof/${P}/`));
  db.close();
});

test('test 9: sync_editable and the form-options providers', async () => {
  const db = withConnections(seeded());
  const kinds = async (user = FOUNDER) => Object.fromEntries((await formOptions(db, 'operating-systems', user)).body.kinds.map((k: any) => [k.kind, k]));
  const fresh = await kinds();
  assert.deepEqual(Object.values(fresh).map((k: any) => [k.kind, k.providers.map((p: any) => p.provider_key), k.connections.map((x: any) => x.uid ?? x.provider_key), k.sync_editable]), [
    ['bank', [], [], true], ['accounting', [], [], true], ['payroll', [], [], true],
    ['crm', ['hubspot'], ['own-crm'], true],
    ['workspace', ['google_calendar', 'microsoft_365'], [], false],
  ]);
  const all = JSON.stringify(fresh);
  for (const hidden of ['salesforce', 'affinity', 'mate-crm', 'CRM two']) assert.ok(!all.includes(hidden), hidden);
  const opts = (await formOptions(db, 'operating-systems')).body;
  assert.deepEqual(opts.sync.options.map((o: any) => o.value), ['live', 'hourly', 'daily', 'manual']);
  assert.deepEqual(opts.feeds.options.map((o: any) => o.value), ['use_of_funds', 'kpis', 'team']);
  // Mapped to the caller's own connection, true; to another member's, false for the caller.
  db.exec(`INSERT INTO project_core_systems (project_id, kind, integration_id, used_by, feeds_json, updated_by) VALUES (${P}, 'crm', 22, 'Sales', '["kpis"]', ${TEAMMATE})`);
  assert.equal((await kinds()).crm.sync_editable, false);
  assert.equal((await kinds(TEAMMATE)).crm.sync_editable, true);
  assert.equal((await formOptions(db, 'operating-systems', PARTNER)).status, 403);
  db.close();
});

test('test 9: a system record declares Choose connector with its values, and Sync only while it may be set', async () => {
  const db = withConnections(seeded());
  db.exec(`INSERT INTO project_core_systems (project_id, kind, integration_id, used_by, feeds_json, updated_by) VALUES (${P}, 'crm', 22, 'Sales', '["kpis"]', ${TEAMMATE})`);
  const mine = await rec(db, 'operating-systems', 'crm');
  assert.deepEqual(valuesOf(mine), { connector: '', used_by: 'Sales', feeds: ['kpis'] }, 'no Sync on another member\'s connection');
  assert.deepEqual(actionOf(mine, 'edit').form.fields[0].options.map((o: any) => o.value), ['uid:own-crm']);
  assert.deepEqual(valuesOf(await rec(db, 'operating-systems', 'crm', TEAMMATE)), { connector: '', used_by: 'Sales', feeds: ['kpis'], sync: 'daily' });
  // The co-founder's Edit sent back unchanged keeps the mapping and the connection's setting.
  assert.equal((await act(db, 'operating-systems', 'crm', 'edit', valuesOf(mine))).status, 200);
  assert.deepEqual([crm(db).integration_id, crm(db).used_by, crm(db).feeds_json], [22, 'Sales', '["kpis"]']);
  assert.equal(config(db, 22), '{"sync_frequency":"daily"}');
  assert.equal((await act(db, 'operating-systems', 'crm', 'edit', { connector: 'uid:own-crm', used_by: 'Revenue' })).status, 200);
  assert.deepEqual([crm(db).integration_id, crm(db).used_by], [21, 'Revenue']);
  assert.equal((await act(db, 'operating-systems', 'crm', 'edit', { connector: 'uid:mate-crm' })).status, 403, 'never another member\'s connection');
  assert.equal((await act(db, 'operating-systems', 'crm', 'edit', { connector: 'own-crm' })).status, 400, 'a connector off the list');
  // Disconnect keeps Used by and Feeds and clears the connector.
  const disconnect = actionOf(await rec(db, 'operating-systems', 'crm'), 'disconnect');
  assert.deepEqual([disconnect.tone, disconnect.confirm], ['danger', 'Disconnect CRM from this venture? The connection stays in Connect a tool.']);
  assert.equal((await act(db, 'operating-systems', 'crm', 'disconnect')).status, 200);
  assert.deepEqual([crm(db).integration_id, crm(db).used_by, crm(db).feeds_json], [null, 'Revenue', '["kpis"]']);
  assert.ok(!keysOf(await rec(db, 'operating-systems', 'crm')).includes('disconnect'), 'declared only while the kind names a connector');
  // It deletes a Workspace row.
  db.exec(`INSERT INTO google_oauth_tokens (user_id, refresh_token) VALUES (${FOUNDER}, 'enc-placeholder')`);
  assert.equal((await call(db, 'PUT', '/systems/workspace', { provider_key: 'google_calendar' })).status, 200);
  assert.ok(!('sync' in valuesOf(await rec(db, 'operating-systems', 'workspace'))), 'Workspace has no Sync');
  assert.equal((await act(db, 'operating-systems', 'workspace', 'disconnect')).status, 200);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM project_core_systems WHERE kind = 'workspace'`), 0);
  db.close();
});

test('test 8: the founder Edit carries the Add fields; a role-only change keeps the role write\'s gate', async () => {
  const db = seeded();
  db.exec(`INSERT INTO cap_table_vesting (user_id, holder_id, start_date, cliff_months, total_months, total_shares, source) VALUES (${FOUNDER}, 8, '2026-01-15', 12, 48, 600, 'manual')`);
  const r = await rec(db, 'founding-team', 'h-8');
  assert.deepEqual(valuesOf(r), { name: 'Ana Wren', email: '', role: 'CEO', equity_pct: 60, vesting: '4y_1y_cliff', vesting_start: '2026-01-15', total_months: 48, cliff_months: 12 });
  // Free plan: the unchanged Edit writes nothing, and one that changes only the role saves.
  assert.equal((await act(db, 'founding-team', 'h-8', 'edit', valuesOf(r))).status, 200);
  assert.equal(logCount(db), 0, 'an unchanged Edit writes nothing');
  assert.equal((await act(db, 'founding-team', 'h-8', 'edit', { ...valuesOf(r), role: 'CTO' })).status, 200);
  assert.equal(db.prepare('SELECT founder_role FROM cap_table_holders WHERE id = 8').get()!.founder_role, 'CTO');
  assert.equal((await act(db, 'founding-team', 'h-8', 'edit', { ...valuesOf(r), equity_pct: '55' })).status, 402, 'the split goes through the cap table\'s gate');
  assert.equal((await act(db, 'founding-team', 'h-8', 'log-contribution', { text: 'Signed the first pilot', on_date: '2026-10-09' })).status, 200);
  assert.deepEqual({ ...db.prepare('SELECT holder_id, text, on_date FROM founder_contributions').get() }, { holder_id: 8, text: 'Signed the first pilot', on_date: '2026-10-09' });
  const opts = (await formOptions(db, 'founding-team')).body;
  assert.deepEqual(opts.unallocated, { value: 40 });
  assert.deepEqual(opts.vesting.options.map((o: any) => o.value), ['4y_1y_cliff', '4y_no_cliff', 'custom']);
  db.exec('UPDATE cap_table_holders SET ownership_pct = NULL');
  assert.equal((await formOptions(db, 'founding-team')).body.unallocated.value, null, 'Not recorded with no percentage');
  db.close();
});

test('form-options: themes, hypotheses, owners, KPIs, feedback themes, items, kinds, jurisdictions and founders', async () => {
  const db = recordsA(seeded());
  db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, theme, status) VALUES ('f1', ${P}, 'Slow', 'customer', 'Onboarding', 'open'), ('f2', ${P}, 'Fine', 'customer', 'Onboarding', 'shipped'), ('f3', ${P_OTHER}, 'Other', 'customer', 'Leak', 'open')`);
  const sd = (await formOptions(db, 'solution-design')).body;
  assert.deepEqual(sd.pain_group_id.options, [{ value: '1', label: 'Manual reconciliation' }]);
  assert.deepEqual(sd.hypothesis_id.options.map((o: any) => o.value), [String(HYP)]);
  const mvp = (await formOptions(db, 'prototype-mvp')).body;
  assert.deepEqual(mvp.owner_user_id.options.map((o: any) => o.value).sort(), [String(FOUNDER), String(TEAMMATE)].sort());
  const road = (await formOptions(db, 'product-roadmap')).body;
  assert.deepEqual(road.kpi_key.options.map((o: any) => o.value), ['mrr', 'paying_accounts', 'new_mrr', 'expansion_mrr', 'churn', 'net_burn', 'runway', 'custom-ownkpi']);
  assert.deepEqual(road.feedback_theme.options, [{ value: 'Onboarding', label: 'Onboarding', open_unlinked: 1 }]);
  assert.deepEqual(road.waits_on_id.options.map((o: any) => o.value), ['6', '7']);
  const cc = (await formOptions(db, 'company-creation')).body;
  assert.deepEqual(cc.kind.options.map((o: any) => o.value), ['formation', 'ein', '83b', 'annual_report', 'franchise_tax', 'other']);
  assert.deepEqual(cc.jurisdiction.options.map((o: any) => o.value), ['DE', 'Federal']);
  assert.deepEqual(cc.for_holder_id.options, [{ value: 'h-8', label: 'Ana Wren' }]);
  db.exec(`DELETE FROM pain_groups`);
  assert.deepEqual((await formOptions(db, 'solution-design')).body.pain_group_id, { options: [], empty: 'None yet' }, 'an empty set offers None yet');
  db.close();
});

/** #1695's closing writes: each logs one row with its record's id, in its own batch. */
const CLOSING: Array<{ name: string; run: (db: DatabaseSync) => Promise<{ status: number; body: any }>; action: string; entityType: string; entityId: (r: any) => string; state: string }> = [
  { name: 'Add item', run: (db) => call(db, 'POST', '/roadmap', { title: 'Faster import', waits_on_id: 6, feedback_theme: 'Onboarding' }), action: 'build_roadmap_item_created',
    entityType: 'build.product-roadmap', entityId: (r) => String(r.id), state: 'SELECT (SELECT COUNT(*) FROM roadmap_okrs) || \'/\' || (SELECT COUNT(*) FROM okr_dependencies) AS n' },
  { name: 'item edit', run: (db) => call(db, 'PATCH', '/roadmap/6', { title: 'Ship it', feature_id: 3 }), action: 'build_roadmap_details_changed',
    entityType: 'build.product-roadmap', entityId: () => '6', state: 'SELECT objective, feature_id FROM roadmap_okrs WHERE id = 6' },
  { name: 'Add filing (83(b))', run: (db) => call(db, 'POST', '/formation-steps', { kind: '83b', for_holder_id: 'h-8' }), action: 'build_formation_step_created',
    entityType: 'build.company-creation', entityId: (r) => `step-${r.id}`, state: 'SELECT COUNT(*) AS n FROM formation_steps' },
  { name: 'a feature\'s risk', run: (db) => act(db, 'solution-design', '3', 'add-risk', { title: 'Rate limits', severity: 'low' }), action: 'build_risk_created',
    entityType: 'build.solution-design', entityId: () => '3', state: 'SELECT COUNT(*) AS n FROM venture_risks' },
  { name: 'test session', run: (db) => act(db, 'prototype-mvp', '3', 'add-session', { title: 'Third pass' }), action: 'build_test_session_added',
    entityType: 'build.solution-design', entityId: () => '3', state: 'SELECT COUNT(*) AS n FROM mvp_test_sessions' },
  { name: 'finding', run: (db) => act(db, 'prototype-mvp', '3', 'add-finding', { session_id: '50', text: 'Users hesitate' }), action: 'build_test_finding_added',
    entityType: 'build.solution-design', entityId: () => '3', state: 'SELECT COUNT(*) AS n FROM mvp_test_findings' },
  { name: 'link', run: (db) => act(db, 'prototype-mvp', '3', 'link', { url: 'https://github.com/kestrel/app/pull/9' }), action: 'build_feature_link_added',
    entityType: 'build.solution-design', entityId: () => '3', state: 'SELECT COUNT(*) AS n FROM mvp_feature_links' },
  { name: 'release check', run: (db) => act(db, 'prototype-mvp', '3', 'add-check', { label: 'Docs' }), action: 'build_release_check_added',
    entityType: 'build.solution-design', entityId: () => '3', state: 'SELECT COUNT(*) AS n FROM mvp_release_checks' },
  { name: 'check', run: (db) => act(db, 'prototype-mvp', '3', 'check', { check_id: '51' }), action: 'build_release_check_changed',
    entityType: 'build.solution-design', entityId: () => '3', state: 'SELECT done_at IS NOT NULL AS n FROM mvp_release_checks WHERE id = 51' },
  { name: 'dependency', run: (db) => act(db, 'product-roadmap', '6', 'add-dependency', { waits_on_id: '7' }), action: 'build_roadmap_dependency_added',
    entityType: 'build.product-roadmap', entityId: () => '6', state: 'SELECT COUNT(*) AS n FROM okr_dependencies' },
  { name: 'contribution', run: (db) => act(db, 'founding-team', 'h-8', 'log-contribution', { text: 'Closed a pilot' }), action: 'build_contribution_logged',
    entityType: 'build.founding-team', entityId: () => 'h-8', state: 'SELECT COUNT(*) AS n FROM founder_contributions' },
  { name: 'filing step', run: (db) => act(db, 'company-creation', 'step-9', 'step-check', { key: 'submit' }), action: 'build_filing_step_checked',
    entityType: 'build.company-creation', entityId: () => 'step-9', state: 'SELECT COUNT(*) AS n FROM formation_step_checks' },
  { name: 'proof', run: (db) => act(db, 'company-creation', 'step-9', 'upload-proof', proofForm(PDF(), 'Ana Wren receipt.pdf')), action: 'build_proof_uploaded',
    entityType: 'build.company-creation', entityId: () => 'step-9', state: 'SELECT proof_file_key AS n FROM formation_steps WHERE id = 9' },
];

test('test 10: each closing write logs one row with its project, entity type and record id, and no name', async () => {
  for (const w of CLOSING) {
    const db = recordsA(seeded());
    db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${FOUNDER}`);
    db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, theme) VALUES ('f1', ${P}, 'Slow', 'customer', 'Onboarding')`);
    const before = one(db, w.state);
    const r = await w.run(db);
    assert.ok([200, 201].includes(r.status), `${w.name}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.notEqual(one(db, w.state), before, `${w.name} changed its store`);
    const rows = (db.prepare('SELECT project_id, user_id, entity_type, entity_id, action, details FROM activity_logs').all() as any[]).map((x) => ({ ...x }));
    assert.equal(rows.length, 1, `${w.name}: ${JSON.stringify(rows)}`);
    const { details, ...row } = rows[0];
    assert.deepEqual(row, { project_id: P, user_id: FOUNDER, entity_type: w.entityType, entity_id: w.entityId(r.body?.record ?? r.body), action: w.action }, w.name);
    assert.ok(details && details.trim(), `${w.name} has a summary`);
    for (const p of [...PRIVATE, 'http', 'github.com', '.pdf', 'receipt']) assert.ok(!details.toLowerCase().includes(p), `${w.name}: "${details}" holds "${p}"`);
    db.close();
  }
});

test('test 10: a closing write whose log fails is not written, and an upload leaves no object', async () => {
  for (const w of CLOSING) {
    const db = recordsA(seeded());
    db.exec(`UPDATE users SET subscription_tier = 'growth' WHERE id = ${FOUNDER}`);
    db.exec(`CREATE TRIGGER reject_log BEFORE INSERT ON activity_logs WHEN NEW.action = '${w.action}' BEGIN SELECT RAISE(ABORT, 'log failure'); END`);
    const before = one(db, w.state);
    const r = await w.run(db);
    assert.equal(r.status, 500, `${w.name}: ${JSON.stringify(r.body)}`);
    assert.equal(one(db, w.state), before, `${w.name}: the write did not land without its log`);
    assert.equal(bucket(db).store.size, 0, `${w.name}: no stored object is left behind`);
    db.close();
  }
});
