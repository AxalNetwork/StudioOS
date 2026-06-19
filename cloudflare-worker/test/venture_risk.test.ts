// Venture Risk Rating — unit tests for the 10-layer scoring engine.
//
// Exercises services/ventureRisk.ts against an in-memory node:sqlite DB wired
// through the same tiny D1 adapter the other worker tests use. Verifies: a
// strong project scores lower risk than an empty one; every assessment yields
// all 10 layers with valid bands; analyst overrides lower the layer + aggregate
// and flip source to 'analyst'; serialize round-trips a persisted row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  LAYERS,
  bandFromScore,
  computeVentureRisk,
  applyOverrides,
  serializeAssessment,
} from '../src/services/ventureRisk.ts';

function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { binds = coerce(a); return api; },
        async first() { return db.prepare(sql).get(...binds) ?? null; },
        async all() { return { results: db.prepare(sql).all(...binds) }; },
        async run() {
          const r = db.prepare(sql).run(...binds);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}
function makeEnv(db: InstanceType<typeof DatabaseSync>): any {
  return { DB: makeD1(db) };
}

// Minimal schema — only the tables the engine reads in this focused test. The
// rest (metrics_snapshots, deals, discovery_interviews, …) are intentionally
// absent so we also prove the engine degrades to 'unknown'/'missing' instead
// of throwing when a source table doesn't exist.
function freshDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, stage TEXT, sector TEXT, founder_id INTEGER,
      solution TEXT, why_now TEXT, growth_signals TEXT, use_of_funds TEXT,
      tam REAL, revenue REAL, users_count INTEGER, cost_to_mvp REAL, funding_needed REAL,
      total_funding REAL, employee_count TEXT, last_funding_round TEXT, crunchbase_data_json TEXT,
      deleted_at TEXT
    );
    CREATE TABLE founders (id INTEGER PRIMARY KEY, experience_years INTEGER);
    CREATE TABLE founder_risk_pulls (id INTEGER PRIMARY KEY, founder_id INTEGER, score REAL, created_at TEXT DEFAULT '2026-01-01');
    CREATE TABLE score_snapshots (
      id INTEGER PRIMARY KEY, project_id INTEGER, is_sandbox INTEGER DEFAULT 0, created_at TEXT DEFAULT '2026-01-01',
      market_total REAL, team_total REAL, product_total REAL, capital_total REAL, fit_total REAL,
      distribution_total REAL, distribution_virality REAL, team_network REAL
    );
  `);
  return db;
}

function insert(db: InstanceType<typeof DatabaseSync>, table: string, row: Record<string, any>) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...coerce(cols.map((c) => row[c])));
}

test('bandFromScore maps the 0-100 scale to low/medium/high', () => {
  assert.equal(bandFromScore(0), 'low');
  assert.equal(bandFromScore(33), 'low');
  assert.equal(bandFromScore(34), 'medium');
  assert.equal(bandFromScore(66), 'medium');
  assert.equal(bandFromScore(67), 'high');
  assert.equal(bandFromScore(100), 'high');
});

test('compute returns all 10 layers with valid bands and a consistent aggregate', async () => {
  const db = freshDb();
  insert(db, 'projects', { id: 1, name: 'Acme', stage: 'seed', founder_id: 1, solution: 'x' });
  const env = makeEnv(db);
  const a = await computeVentureRisk(env, 1);
  assert.ok(a, 'assessment computed');
  assert.equal(a!.layers.length, 10);
  assert.deepEqual(a!.layers.map((l) => l.key), LAYERS.map((l) => l.key));
  for (const l of a!.layers) {
    assert.ok(['low', 'medium', 'high'].includes(l.band));
    assert.ok(Array.isArray(l.signals) && l.signals.length > 0);
    assert.ok(l.risk >= 0 && l.risk <= 100);
  }
  // derisk_score is the mirror of overall_risk.
  assert.equal(a!.derisk_score, 100 - a!.overall_risk);
  assert.equal(a!.overall_band, bandFromScore(a!.overall_risk));
});

test('a well-evidenced project scores lower risk than an empty one', async () => {
  const db = freshDb();
  // Strong: paying users + revenue, articulated narrative, funded, strong scores, low founder risk.
  insert(db, 'founders', { id: 1, experience_years: 12 });
  insert(db, 'founder_risk_pulls', { id: 1, founder_id: 1, score: 20 });
  insert(db, 'projects', {
    id: 1, name: 'Strong', stage: 'seed', sector: 'fintech', founder_id: 1,
    solution: 'A'.repeat(200), why_now: 'B'.repeat(160), growth_signals: 'C'.repeat(80),
    use_of_funds: 'D'.repeat(80), tam: 1e9, revenue: 50000, users_count: 1500,
    cost_to_mvp: 100000, funding_needed: 200000, total_funding: 300000,
    employee_count: '11-50', last_funding_round: 'seed', crunchbase_data_json: '{"competitors":[1,2]}',
  });
  insert(db, 'score_snapshots', {
    id: 1, project_id: 1, market_total: 22, team_total: 18, product_total: 13,
    capital_total: 13, fit_total: 13, distribution_total: 9, distribution_virality: 4, team_network: 6,
  });
  // Empty: a bare intake project with nothing proven.
  insert(db, 'projects', { id: 2, name: 'Empty', stage: 'idea' });

  const env = makeEnv(db);
  const strong = await computeVentureRisk(env, 1);
  const empty = await computeVentureRisk(env, 2);
  assert.ok(strong!.overall_risk < empty!.overall_risk, `strong ${strong!.overall_risk} < empty ${empty!.overall_risk}`);
  assert.ok(strong!.derisk_score > empty!.derisk_score);
  assert.ok(strong!.derisk_pct > empty!.derisk_pct);
  // The strong project should land out of the high-risk band overall.
  assert.notEqual(strong!.overall_band, 'high');
});

test('analyst override lowers the layer + aggregate and flips source to analyst', async () => {
  const db = freshDb();
  insert(db, 'projects', { id: 1, name: 'Acme', stage: 'idea' }); // empty → high risk
  const env = makeEnv(db);
  const auto = await computeVentureRisk(env, 1);
  const beforeRisk = auto!.overall_risk;
  const founderBefore = auto!.layers.find((l) => l.key === 'founder')!.risk;

  const merged = applyOverrides(auto!, [
    { layer_key: 'founder', band: 'low', score: 0, status: 'cleared', note: 'Met team; strong', owner_user_id: 7, updated_at: '2026-06-19' },
  ]);
  const founderLayer = merged.layers.find((l) => l.key === 'founder')!;
  assert.equal(founderLayer.risk, 0);
  assert.equal(founderLayer.band, 'low');
  assert.equal(founderLayer.status, 'cleared');
  assert.equal(founderLayer.overridden, true);
  assert.ok(founderLayer.risk < founderBefore);
  assert.ok(merged.overall_risk < beforeRisk, 'aggregate dropped after clearing a layer');
  assert.equal(merged.source, 'analyst');
});

test('serializeAssessment round-trips a persisted row', () => {
  const layers = [{ key: 'founder', label: 'Founder Risk', risk: 10, band: 'low', signals: [] }];
  const row = {
    project_id: 5, project_name: 'X', stage: 'seed', overall_risk: 25, overall_band: 'low',
    derisk_score: 75, derisk_pct: 60, layers_json: JSON.stringify(layers), source: 'analyst',
    created_at: '2026-06-19T00:00:00Z',
  };
  const a = serializeAssessment(row as any);
  assert.equal(a.project_id, 5);
  assert.equal(a.overall_risk, 25);
  assert.equal(a.derisk_score, 75);
  assert.equal(a.saved, true);
  assert.equal(a.layers.length, 1);
  assert.equal(a.computed_at, '2026-06-19T00:00:00Z');
});
