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
  return callAs(db, FOUNDER, method, path, body);
}
async function callAs(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: userId, role: 'founder' })
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
