import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { NEVER_READ, SCORED_SCOPES, SCOPE_ORDER, VENTURE_MODEL_V1, type Rule } from '../src/services/ventureScoring/model.ts';
import { normalise, scoreScope, type InputFacts } from '../src/services/ventureScoring/engine.ts';
import { STATEMENTS } from '../src/services/ventureScoring/collectors.ts';
import { scoreVenture, storedScorecard } from '../src/services/ventureScoring/store.ts';

// Synthetic records only; no connector may reach the network.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D1255 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const TODAY = '2026-10-26';
const secret = 'synthetic-d1255-only-'.repeat(3);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// ── The engine, per scope ────────────────────────────────────────────────────

/** A raw figure for each rule kind, and the 0–100 the test expects from it, worked out here rather than by `normalise`. */
function rawFor(rule: Rule): { raw: InputFacts['raw']; value: number } {
  switch (rule.kind) {
    case 'count': return { raw: { n: rule.full / 2 }, value: 50 };
    case 'share': return { raw: { n: rule.full * 5, of: 10 }, value: 50 };
    case 'steps': return { raw: { n: rule.steps[rule.steps.length - 1][0] }, value: 100 };
    case 'scale': return { raw: { n: (rule.zero + rule.full) / 2 }, value: 50 };
    case 'direct': return { raw: { n: 60 }, value: 60 };
  }
}
const fact = (key: string, raw: InputFacts['raw'], grade = 1, as_of: string | null = TODAY): InputFacts => ({
  key, applies: true, recorded: true, raw, grade, grade_label: grade >= 1 ? 'measured' : grade >= 0.7 ? 'sourced' : 'stated', as_of,
  source: { table: 'synthetic', rows: 1 }, words: 'synthetic', reason: null,
});
const absent = (key: string): InputFacts => ({ key, applies: true, recorded: false, raw: {}, grade: 0, grade_label: 'not_recorded', as_of: null,
  source: { table: 'synthetic', rows: 0 }, words: 'Not recorded', reason: 'synthetic' });

test('model v1: the ten scopes carry D1253\'s keys and order, and each scope\'s weights sum to 100', () => {
  const frontend = read('../../frontend/src/components/scoring/scorecard/scorecardModel.js');
  const block = frontend.slice(frontend.indexOf('export const SCOPES'), frontend.indexOf(']);', frontend.indexOf('export const SCOPES')));
  const keys = [...block.matchAll(/\{ key: '([a-z_]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual([...SCOPE_ORDER], keys, 'the Worker\'s scope order is the canvas\'s');
  assert.deepEqual([...SCORED_SCOPES], keys.filter((k) => k !== 'pmf'));
  for (const scope of SCORED_SCOPES) {
    const inputs = VENTURE_MODEL_V1.scopes[scope].inputs;
    assert.equal(inputs.reduce((a, i) => a + i.weight, 0), 100, scope);
    assert.equal(new Set(inputs.map((i) => i.key)).size, inputs.length, `${scope}: input keys are unique`);
  }
  const all = SCORED_SCOPES.flatMap((s) => VENTURE_MODEL_V1.scopes[s].inputs.map((i) => i.key));
  assert.equal(new Set(all).size, all.length, 'each input feeds one scope only');
});

for (const scope of SCORED_SCOPES) {
  test(`engine · ${scope}: renormalisation, grade, stale and the floor`, () => {
    const inputs = VENTURE_MODEL_V1.scopes[scope].inputs;
    const full = inputs.map((i) => fact(i.key, rawFor(i.rule).raw));
    const expected = (keep: typeof inputs) => Math.round(keep.reduce((a, i) => a + i.weight * rawFor(i.rule).value, 0) / keep.reduce((a, i) => a + i.weight, 0));

    const all = scoreScope(scope, full, TODAY);
    assert.equal(all.state, 'scored');
    assert.equal(all.value, expected(inputs));
    assert.equal(all.confidence, 1);
    assert.deepEqual(all.coverage, { present: inputs.length, applies: inputs.length });

    // Renormalisation: the heaviest input missing leaves the value the mean of the rest, never pulled to 0 or 50.
    const heaviest = [...inputs].sort((a, b) => b.weight - a.weight)[0];
    const rest = inputs.filter((i) => i !== heaviest);
    const without = scoreScope(scope, full.map((f) => (f.key === heaviest.key ? absent(f.key) : f)), TODAY);
    assert.equal(without.value, expected(rest), 'the weights renormalise over the inputs present');
    assert.equal(without.coverage.present, inputs.length - 1);
    assert.equal(without.confidence, Math.round(((100 - heaviest.weight) / 100) * 100) / 100, 'a missing input lowers confidence, not the value');
    assert.equal(without.inputs.find((i) => i.key === heaviest.key)!.value, null, 'Not recorded is no value');

    // The grade sets confidence, never the value.
    const stated = scoreScope(scope, full.map((f) => ({ ...f, grade: 0.4, grade_label: 'stated' as const })), TODAY);
    assert.equal(stated.value, all.value);
    assert.equal(stated.confidence, 0.4);
    assert.equal(stated.confidence_word, 'Low');

    // Stale halves a factor.
    const old = scoreScope(scope, full.map((f) => ({ ...f, as_of: '2020-01-01' })), TODAY);
    assert.equal(old.value, all.value);
    assert.equal(old.confidence, 0.5);
    assert.ok(old.inputs.every((i) => i.stale && i.grade_factor === 0.5));

    // Below the floor: "Not enough recorded", no number and no band.
    const lightest = [...inputs].sort((a, b) => a.weight - b.weight)[0];
    const thin = scoreScope(scope, full.map((f) => (f.key === lightest.key ? { ...f, grade: 0.4 } : absent(f.key))), TODAY);
    assert.equal(thin.state, 'not_enough');
    assert.equal(thin.value, null);
    assert.equal(thin.band, null);

    // Nothing recorded: no value at all — never a 0, never a neutral 50.
    const none = scoreScope(scope, inputs.map((i) => absent(i.key)), TODAY);
    assert.equal(none.state, 'not_enough');
    assert.equal(none.value, null);
    assert.equal(none.confidence, 0);
  });
}

test('engine: a recorded 0 is a value; an input that does not apply leaves every sum; a stage that does not expect the scope says so', () => {
  const zero = scoreScope('governance', VENTURE_MODEL_V1.scopes.governance.inputs.map((i) => fact(i.key, i.rule.kind === 'direct' ? { n: 0 } : { n: 0, of: 4 })), TODAY);
  assert.equal(zero.state, 'scored');
  assert.equal(zero.value, 0, 'a recorded 0 scores 0');
  const team = VENTURE_MODEL_V1.scopes.team.inputs;
  const solo = scoreScope('team', team.map((i) => (i.key === 'values_alignment'
    ? { ...absent(i.key), applies: false } : fact(i.key, rawFor(i.rule).raw))), TODAY);
  assert.deepEqual(solo.coverage, { present: 5, applies: 5 }, 'a solo founder\'s values are not applicable, not zero');
  assert.equal(solo.confidence, 1);
  for (const scope of ['traction', 'financial'] as const) {
    const early = scoreScope(scope, VENTURE_MODEL_V1.scopes[scope].inputs.map((i) => fact(i.key, rawFor(i.rule).raw)), TODAY, { stage: 'validate' });
    assert.equal(early.state, 'not_expected');
    assert.equal(early.value, null);
    assert.equal(scoreScope(scope, [], TODAY, { stage: 'build' }).state, 'not_enough');
  }
  assert.equal(normalise({ kind: 'share', full: 1 }, { n: 3, of: 0 }), null, 'a share of nothing is no figure');
  const down = scoreScope('market', VENTURE_MODEL_V1.scopes.market.inputs.map((i) => (i.key === 'competitors'
    ? { ...absent(i.key), unreadable: true } : fact(i.key, rawFor(i.rule).raw))), TODAY);
  assert.equal(down.partial, true, 'an unreadable input makes the scope partial');
  assert.equal(down.inputs.find((i) => i.key === 'competitors')!.state, 'unreadable');
});

// ── The bias guards ──────────────────────────────────────────────────────────

const flatten = (x: unknown): string[] => (typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(flatten) : []);

test('bias guards: no collector statement reads a never-input, and kyc_data is never read', () => {
  const statements = flatten(STATEMENTS);
  assert.ok(statements.length > 30);
  for (const sql of statements) {
    for (const word of NEVER_READ) assert.doesNotMatch(sql, new RegExp(`\\b${word}\\b`, 'i'), `${word} in: ${sql.slice(0, 80)}`);
    assert.doesNotMatch(sql, /\b(u|p|f|pm|h|e|a)?\.?name\b(?!_)/i, `a name column in: ${sql.slice(0, 80)}`);
    assert.doesNotMatch(sql, /\bkyc/i);
    assert.doesNotMatch(sql, /SELECT\s+\*/i, 'every collector names its columns');
  }
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = code('../src/services/ventureScoring/collectors.ts') + code('../src/services/ventureScoring/store.ts') + code('../src/services/ventureScoring/engine.ts');
  assert.doesNotMatch(src, /kyc_data|date_of_birth|nationality/);
  assert.doesNotMatch(src, /\$\{[^}]*\}[^`]*\b(FROM|WHERE)\b/, 'no interpolated SQL');
});

// ── Collectors and the store, on the full schema ─────────────────────────────

const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('../sql/schema_baseline.sql'));
  for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(read(`../sql/migrations/${name}`));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close();
  return sql;
})();

const PRIVATE = ['Private Person', 'private@example.test', 'Private Employer Inc', 'Private University', '1990-01-01', 'Privatelandia'];

function fixture(stage = 'build') {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
      (1,'private@example.test','Private Person','founder',20,1),
      (2,'cofounder@example.test','Synthetic cofounder','founder',NULL,1),
      (3,'advisor@example.test','Synthetic advisor','advisor',NULL,1),
      (9,'other@example.test','Other founder','founder',90,1);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector,tam,sam,entity_id,spinout_ip_meta)
      VALUES (10,'Synthetic venture',20,'spinout','seed','${stage}','fintech',1000000000,50000000,5,'{"terms":"synthetic"}'),
             (20,'Empty venture',90,'active','idea','idea',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (10,2,'cofounder','accepted'),(10,3,'advisor','accepted');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: secret, SCORING_HMAC_SECRET: secret, ENVIRONMENT: 'development' } as any };
}

/** Records across every scope for venture 10, with private values the scorecard must never carry. */
function seed(db: DatabaseSync) {
  db.exec(`
    UPDATE users SET kyc_data = '{"date_of_birth":"1990-01-01","nationality":"Privatelandia"}' WHERE id = 1;
    INSERT INTO skill_evidence(user_id,axis,source,count_lifetime,count_window,weighted,first_at,last_at,computed_at) VALUES
      (1,'product','pitch_decks',12,12,12,'2026-01-01','2026-10-20','2026-10-20'),(1,'engineering','roadmap_okrs',30,30,30,'2026-01-01','2026-10-20','2026-10-20'),
      (2,'gtm_sales','discovery_interviews',8,8,8,'2026-01-01','2026-10-20','2026-10-20'),(3,'finance_ops','financial_models',4,4,4,'2026-01-01','2026-10-20','2026-10-20');
    INSERT INTO cofounder_profiles(user_id,commitment) VALUES (1,'full_time'),(2,'part_time');
    INSERT INTO user_profile_ext(user_id,experience) VALUES
      (1,'[{"title":"Engineer","company":"Private Employer Inc"},{"title":"Student","org":"Private University"}]');
    INSERT INTO competitor_tracking(uid,project_id,name_norm) VALUES ('c1',10,'rival one'),('c2',10,'rival two'),('c3',10,'rival three');
    INSERT INTO market_sources(project_id,title,url) VALUES (10,'Synthetic report','https://example.test/report');
    INSERT INTO market_intel_indexes(sector,geo,period_key,dimension,value) VALUES ('fintech','global','2026-10','composite',64);
    INSERT INTO mvp_features(project_id,title,is_must_have,delivery_status,done_at,merge_commit_sha) VALUES
      (10,'Synthetic feature A',1,'Done','2026-10-01','abc123'),(10,'Synthetic feature B',1,'Planned',NULL,NULL);
    INSERT INTO github_contributors(integration_id,project_id,repository,login,commits_90d) VALUES (1,10,'org/repo','private-login',90);
    INSERT INTO github_repo_facts(integration_id,project_id,repository,owner_kind,owner_login,licence) VALUES (1,10,'org/repo','organisation','private-org','MIT');
    INSERT INTO project_metrics(project_id,snapshot_date,mrr,paying_accounts,net_burn,nrr_pct,source) VALUES
      (10,'2026-10-01',20000,25,40000,104,'stripe'),(10,'2026-07-01',10000,12,50000,NULL,'stripe');
    INSERT INTO venture_risks(project_id,title,severity,owner_user_id,mitigation,state,created_by) VALUES (10,'Synthetic risk','high',1,'Synthetic plan','open',1);
    INSERT INTO venture_risk_overrides(project_id,layer_key,analyst_score) VALUES (10,'market',72);
    INSERT INTO markets(uid,project_id,name,state,demand_score,demand_source,regulation_score,regulation_source)
      VALUES ('m1',10,'Synthetic market','entering',7,'Synthetic study',6,'Synthetic counsel');
    INSERT INTO cap_table_holders(user_id,project_id,name,kind,source) VALUES (1,10,'Private Person','founder','manual');
    INSERT INTO formation_steps(project_id,title,state,kind,created_by) VALUES (10,'Incorporate','done','formation',1),(10,'Assign IP to the company','done','other',1);
    INSERT INTO ritual_runs(project_id,ritual_id,run_date,state) VALUES (10,1,'2026-10-20','done'),(10,1,'2026-10-13','missed');`);
}
const count = (db: DatabaseSync, table: string, where = '1=1') => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as any).n);

test('collectors: every scope reads its stores, and Traction and Financial wait for Build', async () => {
  const f = fixture('build');
  seed(f.db);
  const card = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  assert.deepEqual(card.scopes.map((s) => s.scope), [...SCOPE_ORDER]);
  const by = Object.fromEntries(card.scopes.map((s) => [s.scope, s])) as Record<string, any>;
  for (const s of card.scopes) assert.notEqual(s.state, 'unreadable', `${s.scope} reads`);
  const team = by.team;
  assert.equal(team.inputs.find((i: any) => i.key === 'function_coverage').words, '3.5 of 8 axes with evidence', 'an advisor-only axis counts half');
  assert.equal(team.inputs.find((i: any) => i.key === 'commitment').words, '1 of 2 founders full time');
  assert.equal(team.inputs.find((i: any) => i.key === 'values_alignment').state, 'not_recorded', 'two founders: values apply, and no consent store is read');
  assert.equal(by.technical.inputs.find((i: any) => i.key === 'build_activity').value, 75);
  assert.equal(by.traction.state, 'scored');
  assert.equal(by.traction.inputs.find((i: any) => i.key === 'growth').value, 100, 'MRR doubled over three months');
  assert.equal(by.legal_ip.inputs.find((i: any) => i.key === 'spinout_ip').state, 'recorded');
  assert.equal(by.geographic.inputs.find((i: any) => i.key === 'country_environment').reason, 'Facts only: no country index is chosen (owner question 4)');

  const early = fixture('validate');
  seed(early.db);
  const v = await scoreVenture(early.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  for (const k of ['traction', 'financial']) {
    const s = v.scopes.find((x) => x.scope === k)!;
    assert.equal(s.state, 'not_expected', `${k} is not expected before Build`);
    assert.equal(s.value, null);
  }
  assert.equal(count(early.db, 'venture_scorecards', "scope = 'traction' AND state = 'not_expected' AND value IS NULL"), 1);
});

test('a venture with nothing recorded scores no scope at all: never a 0 and never a neutral 50', async () => {
  const f = fixture();
  const card = await scoreVenture(f.env, 20, { actorId: 9, trigger: 'read', today: TODAY });
  for (const s of card.scopes) {
    assert.ok(['not_enough', 'not_expected'].includes(s.state), `${s.scope}: ${s.state}`);
    assert.equal(s.value, null, s.scope);
    assert.notEqual(s.value, 0);
    assert.notEqual(s.value, 50);
  }
  const solo = card.scopes.find((s) => s.scope === 'team') as any;
  assert.equal(solo.inputs.find((i: any) => i.key === 'values_alignment').state, 'not_applicable', 'a solo founder: values do not apply');
  const values = f.db.prepare("SELECT value FROM venture_scorecards WHERE project_id = 20").all() as any[];
  assert.ok(values.length > 0 && values.every((r) => r.value === null));
});

test('recompute on read is idempotent: an unchanged read writes nothing; a newer input writes only its scope', async () => {
  const f = fixture();
  seed(f.db);
  const first = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  assert.ok(first.scopes.filter((s) => s.scope !== 'pmf').every((s) => s.changed));
  const rows = count(f.db, 'venture_scorecards');
  const models = count(f.db, 'scoring_model_versions');
  assert.equal(models, 11, 'one frozen model row per scope, PMF\'s included');
  const again = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'rescore', today: TODAY });
  assert.ok(again.scopes.every((s) => !s.changed), 'nothing changed');
  assert.equal(count(f.db, 'venture_scorecards'), rows);
  assert.equal(count(f.db, 'scoring_model_versions'), models);

  f.db.exec("INSERT INTO competitor_tracking(uid,project_id,name_norm) VALUES ('c4',10,'rival four'),('c5',10,'rival five')");
  const after = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  assert.deepEqual(after.scopes.filter((s) => s.changed).map((s) => s.scope), ['market']);
  assert.equal(count(f.db, 'venture_scorecards'), rows + 1);

  // Crossing a freshness window is a change, even with the same records.
  const later = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: '2027-12-01' });
  assert.ok(later.scopes.some((s) => s.changed));
});

test('rows are signed; a tampered row is unreadable; the audit carries no figure and nothing private is stored', async () => {
  const f = fixture();
  seed(f.db);
  await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  const stored = await storedScorecard(f.env, 10);
  assert.deepEqual(stored.map((s) => s.scope), [...SCOPE_ORDER]);
  const audit = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'venture_score_recomputed'").all() as any[];
  assert.equal(audit.length, 10);
  for (const a of audit) assert.deepEqual(Object.keys(JSON.parse(a.details)).sort(), ['inputs_hash', 'model_version', 'scope', 'trigger']);
  const everything = (f.db.prepare("SELECT inputs_json || ' ' || COALESCE(details, '') AS t FROM venture_scorecards LEFT JOIN activity_logs ON 1=0").all() as any[]).map((r) => r.t).join(' ')
    + (f.db.prepare("SELECT group_concat(details, ' ') AS t FROM activity_logs").get() as any).t;
  for (const p of PRIVATE) assert.equal(everything.includes(p), false, `${p} is never stored`);
  assert.equal(everything.includes('private-login'), false, 'no GitHub login is stored');
  f.db.exec("UPDATE venture_scorecards SET value = 99 WHERE scope = 'market'");
  await assert.rejects(storedScorecard(f.env, 10), /scorecard_unreadable/);
});

test('a scope whose store cannot be read is drawn Unreadable and never stored; the others still are', async () => {
  const f = fixture();
  seed(f.db);
  f.db.exec('DROP TABLE competitor_tracking');
  const card = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  const market = card.scopes.find((s) => s.scope === 'market')!;
  assert.equal(market.state, 'unreadable');
  assert.equal(market.changed, false);
  assert.equal(count(f.db, 'venture_scorecards', "scope = 'market'"), 0);
  assert.ok(count(f.db, 'venture_scorecards', "scope = 'team'") === 1);
});

test('an input whose store cannot be read makes its scope partial: drawn without it, never stored', async () => {
  const f = fixture();
  seed(f.db);
  f.db.exec("INSERT INTO deals(id,project_id,status,target_raise,capital_committed) VALUES (30,10,'active',1000000,250000)");
  f.db.exec('DROP TABLE mercury_raise_facts');
  const card = await scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY });
  const fin = card.scopes.find((s) => s.scope === 'financial') as any;
  assert.equal(fin.partial, true);
  assert.equal(fin.inputs.find((i: any) => i.key === 'runway').state, 'unreadable');
  assert.equal(fin.changed, false);
  assert.equal(count(f.db, 'venture_scorecards', "scope = 'financial'"), 0, 'a partial scope is never stored');
  assert.equal(count(f.db, 'venture_scorecards', "scope = 'traction'"), 1);
});

test('the context is checked: a bad trigger, actor or venture is refused before anything is read', async () => {
  const f = fixture();
  await assert.rejects(scoreVenture(f.env, 10, { actorId: 1, trigger: 'eadwyn' as any, today: TODAY }), /invalid_scorecard_context/);
  await assert.rejects(scoreVenture(f.env, 10, { actorId: 0, trigger: 'read', today: TODAY }), /invalid_scorecard_context/);
  await assert.rejects(scoreVenture(f.env, 999, { actorId: 1, trigger: 'read', today: TODAY }), /venture_not_found/);
  assert.equal(count(f.db, 'venture_scorecards'), 0);
});

