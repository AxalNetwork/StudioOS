import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { copyLegacyBase, saveBaseSplit, SECTION_LABELS, UofStoreError } from '../src/services/useOfFunds/legacy.ts';
import { SECTION_KEYS } from '../src/services/useOfFunds/plan.ts';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../sql/migrations/606_use_of_funds_scenarios.sql', import.meta.url), 'utf8');
let originalFetch: typeof fetch;
beforeEach(() => { originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Mercury and all external providers are stubbed'); }; });
afterEach(() => { globalThis.fetch = originalFetch; });
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline); db.exec(migration); db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO founders(id,name,email) VALUES(11,'Synthetic owner','owner@example.test'),(22,'Other owner','other@example.test');
    INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(1,'founder','Synthetic owner','owner@example.test',11,1),(2,'founder','Other owner','other@example.test',22,1),(3,'admin','Synthetic admin','admin@example.test',11,1);
    INSERT INTO projects(id,name,founder_id) VALUES(1,'Synthetic venture',11),(2,'Other venture',22);
    INSERT INTO roadmap_okrs(id,project_id,objective) VALUES(1,1,'Synthetic product milestone'),(2,2,'Other venture milestone'),(3,1,'Infrastructure milestone'),(4,1,'Reserve milestone');`);
  const split = SECTION_KEYS.map((key, i) => ({ label: SECTION_LABELS[key], pct: i === 0 ? 100 : 0 }));
  const meta = { runway_months: 12, custom_note: 'Preserve', milestones: { product: { label: 'Product shipped', by: '2027-01' } }, milestone_costs: { 1: { bucket: 'eng', cost: 0 }, 3: { bucket: 'infra', cost: 2.34 }, 4: { bucket: 'hiring', cost: null } } };
  db.prepare('UPDATE projects SET use_of_funds = ?, funding_needed = ?, use_of_funds_meta = ? WHERE id = ?').run(JSON.stringify(split), 123.45, JSON.stringify(meta), 1);
  const DB = d1Over(db) as any;
  return { db, DB, split, meta };
}
const rows = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
test('606 applies idempotently; admits alternatives, enforces one Base, section keys, integer cents and foreign keys', () => {
  const { db } = fixture(); db.exec(migration);
  db.exec("INSERT INTO uof_scenarios(project_id,name,is_base) VALUES(1,'Base',1),(1,'Lower',0),(1,'Higher',0)");
  assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 3);
  assert.throws(() => db.exec("INSERT INTO uof_scenarios(project_id,name,is_base) VALUES(1,'Duplicate',1)"), /UNIQUE/);
  assert.throws(() => db.exec("INSERT INTO uof_scenario_lines(scenario_id,category_key) VALUES(1,'arbitrary')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO uof_milestones(scenario_id,label,cost_cents) VALUES(1,'Negative',-1)"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO uof_milestones(scenario_id,label,cost_cents) VALUES(1,'Fractional',1.1)"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO uof_milestones(scenario_id,label,okr_id) VALUES(1,'Missing OKR',999)"), /FOREIGN KEY/);
  db.exec("INSERT INTO uof_milestones(scenario_id,label,cost_cents) VALUES(1,'Unknown',NULL),(1,'Free',0)");
  assert.deepEqual(rows(db, 'SELECT cost_cents FROM uof_milestones ORDER BY id'), [{ cost_cents: null }, { cost_cents: 0 }]);
});
test('the copy preserves dollars→cents, all five shares, costs, section milestones, OKR links and provenance', async () => {
  const { db, DB, split, meta } = fixture();
  const copied = await copyLegacyBase(DB, 1, 1);
  assert.equal(copied.copied, true);
  assert.deepEqual(rows(db, 'SELECT project_id,amount_to_raise_cents,target_runway_months,start_month,raise_month,cash_cents,model_version,created_by FROM uof_scenarios'), [{ project_id: 1, amount_to_raise_cents: 12345, target_runway_months: 12, start_month: null, raise_month: null, cash_cents: null, model_version: 1, created_by: 1 }]);
  assert.deepEqual(rows(db, 'SELECT category_key,share_pct FROM uof_scenario_lines ORDER BY id'), SECTION_KEYS.map((category_key, i) => ({ category_key, share_pct: i === 0 ? 100 : 0 })));
  assert.deepEqual(rows(db, 'SELECT category_key,label,due_on,cost_cents,okr_id FROM uof_milestones ORDER BY id'), [
    { category_key: 'product', label: 'Product shipped', due_on: '2027-01', cost_cents: null, okr_id: null },
    { category_key: 'product', label: 'Synthetic product milestone', due_on: null, cost_cents: 0, okr_id: 1 },
    { category_key: 'infrastructure', label: 'Infrastructure milestone', due_on: null, cost_cents: 234, okr_id: 3 },
    { category_key: 'reserve', label: 'Reserve milestone', due_on: null, cost_cents: null, okr_id: 4 },
  ]);
  assert.deepEqual(rows(db, 'SELECT DISTINCT source_kind,source_label,updated_by FROM uof_milestones'), [{ source_kind: 'module', source_label: 'recorded', updated_by: 1 }]);
  assert.deepEqual(rows(db, 'SELECT DISTINCT source_kind,source_label,updated_by FROM uof_scenario_lines'), [{ source_kind: 'module', source_label: 'recorded', updated_by: 1 }]);
  assert.match(rows(db, 'SELECT source_ref FROM uof_scenario_lines LIMIT 1')[0].source_ref, /^projects:1:use_of_funds$/);
  const p = rows(db, 'SELECT use_of_funds,funding_needed,use_of_funds_meta FROM projects WHERE id=1')[0];
  assert.deepEqual(JSON.parse(p.use_of_funds), split); assert.deepEqual(JSON.parse(p.use_of_funds_meta), meta); assert.equal(p.funding_needed, 123.45);
});
test('missing legacy data stays nullable, while recorded zero amount is preserved', async () => {
  const { db, DB } = fixture();
  db.exec('UPDATE projects SET use_of_funds=NULL,funding_needed=0,use_of_funds_meta=NULL WHERE id=1');
  await copyLegacyBase(DB, 1, 1);
  assert.deepEqual(rows(db, 'SELECT amount_to_raise_cents,target_runway_months FROM uof_scenarios'), [{ amount_to_raise_cents: 0, target_runway_months: null }]);
  assert.deepEqual(rows(db, 'SELECT share_pct FROM uof_scenario_lines'), Array.from({ length: 5 }, () => ({ share_pct: null })));
  assert.equal(rows(db, 'SELECT id FROM uof_milestones').length, 0);
  await copyLegacyBase(DB, 2, 2);
  assert.equal(rows(db, 'SELECT amount_to_raise_cents FROM uof_scenarios WHERE project_id=2')[0].amount_to_raise_cents, null);
});
test('retry and concurrent copies preserve existing row ids and founder edits, including after malformed legacy edits', async () => {
  const { db, DB } = fixture();
  const results = await Promise.all([copyLegacyBase(DB, 1, 1), copyLegacyBase(DB, 1, 1)]);
  assert.deepEqual(results.map(r => r.copied).sort(), [false, true]); assert.equal(results[0].scenarioId, results[1].scenarioId);
  db.exec("UPDATE uof_scenario_lines SET sublabel='Founder edit'; UPDATE uof_milestones SET cost_cents=42; UPDATE projects SET use_of_funds='unreadable' WHERE id=1");
  const before = rows(db, 'SELECT * FROM uof_milestones');
  assert.equal((await copyLegacyBase(DB, 1, 1)).copied, false);
  assert.deepEqual(rows(db, 'SELECT * FROM uof_milestones'), before);
  assert.deepEqual(rows(db, 'SELECT sublabel FROM uof_scenario_lines'), Array.from({ length: 5 }, () => ({ sublabel: 'Founder edit' })));
  assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 1);
});
test('foreign owner, admin, inactive owner and deleted venture cannot copy or save', async () => {
  for (const actor of [2, 3]) {
    const { db, DB } = fixture();
    await assert.rejects(copyLegacyBase(DB, 1, actor), (e: UofStoreError) => e.code === 'not_found');
    await assert.rejects(saveBaseSplit(DB, { projectId: 1, founderUserId: actor, amountToRaiseCents: 0, targetRunwayMonths: null, lines: SECTION_KEYS.map((key, i) => ({ key, sharePct: i === 0 ? 100 : 0 })) }), (e: UofStoreError) => e.code === 'not_found');
    assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 0);
  }
  for (const mutation of ['UPDATE users SET is_active=0 WHERE id=1', "UPDATE projects SET deleted_at=datetime('now') WHERE id=1"]) {
    const { db, DB } = fixture(); db.exec(mutation);
    await assert.rejects(copyLegacyBase(DB, 1, 1), (e: UofStoreError) => e.code === 'not_found');
    assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 0);
  }
});
test('malformed JSON, invalid shares, stale/foreign OKRs and invalid costs refuse without partial rows', async () => {
  const corruptions = [
    { use_of_funds: 'not-json' }, { use_of_funds: '[{"label":"Unknown","pct":100}]' },
    { use_of_funds_meta: '[]' }, { use_of_funds_meta: '{"milestone_costs":{"2":{"bucket":"eng","cost":1}}}' },
    { use_of_funds_meta: '{"milestone_costs":{"999":{"cost":1}}}' },
    { use_of_funds_meta: '{"milestone_costs":{"1":{"bucket":"eng","cost":-1}}}' },
    { use_of_funds_meta: '{"milestone_costs":{"1":{"bucket":"constructor","cost":1}}}' },
    { use_of_funds_meta: '{"milestones":{"product":{"label":"A","by":"2026-13"}}}' },
  ];
  for (const bad of corruptions) {
    const { db, DB } = fixture();
    if (bad.use_of_funds !== undefined) db.prepare('UPDATE projects SET use_of_funds=? WHERE id=1').run(bad.use_of_funds);
    if (bad.use_of_funds_meta !== undefined) db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(bad.use_of_funds_meta);
    await assert.rejects(copyLegacyBase(DB, 1, 1), (e: UofStoreError) => e.code === 'unreadable');
    assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 0); assert.equal(rows(db, 'SELECT id FROM uof_scenario_lines').length, 0);
  }
});
test('blank legacy cost is Not costed and numeric-string zero is genuinely costed', async () => {
  const { db, DB } = fixture();
  db.prepare('UPDATE projects SET use_of_funds_meta=? WHERE id=1').run(JSON.stringify({ milestone_costs: { 1: { bucket: 'eng', cost: '  ' }, 3: { bucket: 'infra', cost: '0' } } }));
  await copyLegacyBase(DB, 1, 1);
  assert.deepEqual(rows(db, 'SELECT okr_id,cost_cents FROM uof_milestones ORDER BY id'), [{ okr_id: 1, cost_cents: null }, { okr_id: 3, cost_cents: 0 }]);
});
test('a mid-batch failure rolls back the entire copy and permits a clean retry', async () => {
  const { db, DB } = fixture();
  const fail = { ...DB, batch: (statements: any[]) => DB.batch([...statements, DB.prepare('INSERT INTO uof_scenario_lines(scenario_id,category_key) VALUES (?, ?)').bind(-1, 'product')]) };
  await assert.rejects(copyLegacyBase(fail, 1, 1), /FOREIGN KEY/);
  assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 0); assert.equal(rows(db, 'SELECT id FROM uof_milestones').length, 0);
  assert.equal((await copyLegacyBase(DB, 1, 1)).copied, true);
});
test('Base writes both stores atomically, keeps unrelated metadata, invalidates the deck and records the actor', async () => {
  const { db, DB, meta } = fixture();
  const a = { projectId: 1, founderUserId: 1, amountToRaiseCents: 0, targetRunwayMonths: 6, lines: SECTION_KEYS.map(key => ({ key, sharePct: 20, sublabel: 'Synthetic section' })) };
  await saveBaseSplit(DB, a);
  assert.deepEqual(rows(db, 'SELECT amount_to_raise_cents,target_runway_months,updated_by FROM uof_scenarios'), [{ amount_to_raise_cents: 0, target_runway_months: 6, updated_by: 1 }]);
  assert.deepEqual(rows(db, 'SELECT share_pct,source_label,updated_by FROM uof_scenario_lines'), Array.from({ length: 5 }, () => ({ share_pct: 20, source_label: 'typed', updated_by: 1 })));
  const project = rows(db, 'SELECT use_of_funds,funding_needed,use_of_funds_meta FROM projects WHERE id=1')[0];
  assert.equal(project.funding_needed, 0); assert.deepEqual(JSON.parse(project.use_of_funds), SECTION_KEYS.map(key => ({ label: SECTION_LABELS[key], pct: 20 })));
  assert.deepEqual(JSON.parse(project.use_of_funds_meta), { ...meta, runway_months: 6, deck_synced_at: null });
  await saveBaseSplit(DB, { ...a, amountToRaiseCents: null, targetRunwayMonths: null });
  assert.equal(rows(db, 'SELECT funding_needed FROM projects WHERE id=1')[0].funding_needed, null);
  assert.equal('runway_months' in JSON.parse(rows(db, 'SELECT use_of_funds_meta FROM projects WHERE id=1')[0].use_of_funds_meta), false);
  const before = rows(db, 'SELECT * FROM uof_scenarios');
  const fail = { ...DB, batch: (s: any[]) => DB.batch([...s, DB.prepare('INSERT INTO uof_scenario_lines(scenario_id,category_key) VALUES (?, ?)').bind(-1, 'product')]) };
  await assert.rejects(saveBaseSplit(fail, { ...a, amountToRaiseCents: 500 }), /FOREIGN KEY/);
  assert.deepEqual(rows(db, 'SELECT * FROM uof_scenarios'), before); assert.equal(rows(db, 'SELECT funding_needed FROM projects WHERE id=1')[0].funding_needed, null);
});
test('invalid Base inputs do not seed a scenario or change the legacy project', async () => {
  const { db, DB } = fixture();
  const before = rows(db, 'SELECT * FROM projects WHERE id=1');
  const a = { projectId: 1, founderUserId: 1, amountToRaiseCents: -1, targetRunwayMonths: 6, lines: SECTION_KEYS.map(key => ({ key, sharePct: 20 })) };
  for (const value of [a, { ...a, amountToRaiseCents: 100, targetRunwayMonths: 0 }, { ...a, amountToRaiseCents: 100, lines: a.lines.slice(1) }]) {
    await assert.rejects(saveBaseSplit(DB, value), (e: UofStoreError) => e.code === 'invalid');
    assert.deepEqual(rows(db, 'SELECT * FROM projects WHERE id=1'), before); assert.equal(rows(db, 'SELECT id FROM uof_scenarios').length, 0);
  }
});
