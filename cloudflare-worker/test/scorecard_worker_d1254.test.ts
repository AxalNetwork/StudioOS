import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import scoring from '../src/routes/scoring.ts';
import projects from '../src/routes/projects.ts';
import deals, { userMayReadDeal, userReadableDealIds } from '../src/routes/deals.ts';
import risk from '../src/routes/venture_risk.ts';
import trust from '../src/routes/trust.ts';
import { runFullScore, runScoreV2 } from '../src/services/scoring.ts';
import { REQUIRED_OFFICIAL_INPUTS, signScore } from '../src/services/scoreIntegrity.ts';
import { computeAutoLayers, mergeLayers, overallFromLayers } from '../src/services/ventureRisk.ts';

// Synthetic records only; no connector (including Mercury) may reach the network.
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D1254 fixtures'); };
after(() => { globalThis.fetch = realFetch; });
const secret = 'synthetic-d1254-only-'.repeat(3);
const high = { tam: 1e9, market_urgency: 10, market_trend: 5, team_expertise: 8, team_execution: 8,
  team_network: 4, mvp_time_days: 7, product_complexity: 0, product_dependencies: 0, cost_to_mvp: 0,
  time_to_revenue_months: 0, burn_risk: 0, fit_alignment: 10, fit_synergy: 5,
  distribution_channels: 5, distribution_virality: 5 };
const inputs = [Object.fromEntries(REQUIRED_OFFICIAL_INPUTS.map(k => [k, 0])),
  { ...high, team_network: 0, fit_alignment: 0, fit_synergy: 0, distribution_virality: 0 }, high];
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const name of readdirSync(new URL('../sql/migrations/', import.meta.url)).filter(n => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations)) {
    if (migrationNumber(name) > BASELINE_CUTOFF) db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map(r => r.sql).join(';\n');
  db.close(); return sql;
})();
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id) VALUES
    (1,'admin@example.test','Synthetic admin','admin',20),
    (2,'founder@example.test','Synthetic founder','founder',20),
    (3,'investor@example.test','Synthetic investor','investor',NULL),
    (4,'stranger@example.test','Synthetic stranger','investor',NULL),
    (5,'partner@example.test','Synthetic partner','partner',NULL),
    (6,'other@example.test','Synthetic other','founder',60);
    INSERT INTO projects(id,name,founder_id,company_id,status,stage) VALUES
      (10,'Synthetic venture',20,100,'active','build'),(20,'Unrelated venture',60,200,'intake','idea');
    INSERT INTO deals(id,project_id,status) VALUES(100,10,'active'),(200,20,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES(100,3);
    INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(6,3,'active');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: secret, SCORING_HMAC_SECRET: secret, ENVIRONMENT: 'development' } as any };
}
async function request(app: any, env: any, who: number, path: string, body?: any) {
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await app.request(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: res.status, body: await res.json() as any };
}
async function snapshot(f: ReturnType<typeof fixture>, review = 'approved', valid = true) {
  const at = '2026-10-01T00:00:00Z';
  const hash = await signScore(f.env, 10, 90, at);
  f.db.prepare(`INSERT INTO score_snapshots(project_id,total_score,tier,created_at,admin_review_status,integrity_hash,team_total,market_total)
    VALUES(10,90,'TIER_1',?,?,?,?,20)`).run(at, review, valid ? hash : 'invalid', 20);
}

test('D1254: both pure engines ignore injected adjustments, while both HTTP paths reserve them', async () => {
  for (const adjustment of [1000, -1000, NaN, Infinity]) {
    assert.deepEqual(runFullScore({ ...high, ai_adjustment: adjustment }), runFullScore(high));
    assert.deepEqual(runScoreV2({ ...high, ai_adjustment: adjustment } as any), runScoreV2(high));
  }
  const f = fixture();
  try {
    for (const [app, path] of [[scoring, '/score'], [projects, '/submit']] as const) {
      const result = await request(app, f.env, 1, path, { ...high, ai_adjustment: 10 });
      assert.equal(result.status, 400);
      assert.equal(result.body.code, 'reserved_field');
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM score_snapshots').get()!.n, 0);
  } finally { f.db.close(); }
});

test('D1254: low, medium and high official/practice runs preserve project and deal statuses', async () => {
  for (const input of inputs) for (const sandbox of [false, true]) {
    const f = fixture();
    try {
      const result = await request(scoring, f.env, 1, '/score', { ...input, project_id: 10, is_sandbox: sandbox });
      assert.equal(result.status, 200);
      assert.deepEqual({ ...f.db.prepare('SELECT status,stage FROM projects WHERE id=10').get() }, { status: 'active', stage: 'build' });
      assert.equal(f.db.prepare('SELECT status FROM deals WHERE id=100').get()!.status, 'active');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM score_snapshots').get()!.n, 1);
    } finally { f.db.close(); }
  }
});

test('D1254: intake always records an application at the initial venture stage, irrespective of score', async () => {
  for (const input of inputs) {
    const f = fixture();
    try {
      const result = await request(projects, f.env, 1, '/submit', { ...input, name: 'Synthetic intake', founder_name: 'Synthetic applicant', founder_email: 'applicant@example.test' });
      assert.equal(result.status, 200);
      assert.equal(result.body.project.stage, 'idea');
      assert.equal(result.body.project.status, 'intake');
      const row = f.db.prepare('SELECT status FROM deals WHERE project_id=?').get(result.body.project.id)!;
      assert.equal(row.status, 'applied');
      const audit: any = f.db.prepare("SELECT details FROM activity_logs WHERE action='auto_scored' ORDER BY id DESC LIMIT 1").get();
      assert.equal(JSON.parse(audit.details).outcome, 'recorded');
      assert.equal('total_score' in JSON.parse(audit.details), false);
    } finally { f.db.close(); }
  }
});

test('D1254: investor Screening contains only readable deals and audited verified snapshots', async () => {
  for (const review of ['approved', 'flagged', 'rejected', 'tampered']) {
    const f = fixture();
    try {
      await snapshot(f, review === 'tampered' ? 'approved' : review, review !== 'tampered');
      // Relationship filtering precedes the queue limit: unrelated newer deals
      // cannot crowd an entitled old deal out of the investor's first page.
      const unrelated = f.db.prepare("INSERT INTO deals(id,project_id,status,created_at) VALUES(?,20,'active','2099-01-01')");
      for (let i = 0; i < 201; i++) unrelated.run(1000 + i);
      const result = await request(deals, f.env, 3, '/screening');
      assert.equal(result.status, 200);
      // D1260 (#3283): the desk keeps D1254's reader rule and carries no Lab score, whatever the snapshot's review.
      assert.deepEqual(Object.keys(result.body).sort(), ['desk', 'scores', 'source_quality', 'stage_history']);
      assert.deepEqual(result.body.desk, {
        available: true, total_deals: 1,
        rows: [{ deal_id: 100, company: 'Synthetic venture', sector: null, deal_status: 'active' }],
      });
      const logs: any[] = f.db.prepare("SELECT user_id,project_id FROM activity_logs WHERE action='score_read'").all();
      assert.equal(logs.length, 0, 'Screening read a snapshot');
      const stranger = await request(deals, f.env, 4, '/screening');
      assert.deepEqual(stranger.body.desk.rows, []);
      assert.equal(stranger.body.desk.total_deals, 0);
      assert.equal((await request(risk, f.env, 3, '/by-project/20')).status, 403);
      assert.equal((await request(risk, f.env, 3, '/matrix')).status, 403);
    } finally { f.db.close(); }
  }
});

test('D1254: Screening mirrors canonical single/bulk deal permissions, including historical commitments', async () => {
  for (const status of ['active', 'funded', 'rejected']) {
    const f = fixture();
    try {
      f.db.prepare('UPDATE deals SET status=? WHERE id=200').run(status);
      f.db.exec("INSERT INTO commitments(deal_id,investor_user_id,amount,status) VALUES(200,3,1,'withdrawn')");
      const user: any = { id: 3, role: 'investor' };
      assert.equal(await userMayReadDeal(f.env, user, 200), true);
      const allowed = await userReadableDealIds(f.env, user, [100, 200]);
      const result = await request(deals, f.env, 3, '/screening');
      assert.deepEqual(result.body.desk.rows.map((row: any) => row.deal_id).sort((a: number, b: number) => a - b), [...allowed].sort((a, b) => a - b));
      assert.deepEqual([...allowed].sort((a, b) => a - b), [100, 200]);
    } finally { f.db.close(); }
  }
});

test('D1254: no-data risk layers are absent from the average, but a measured zero is counted', () => {
  const auto = computeAutoLayers({ snapshot: { team_total: 0 }, project: null });
  const layers = mergeLayers(auto, new Map([['market', { layer_key: 'market', analyst_score: 100 }]]));
  const result = overallFromLayers(layers);
  assert.deepEqual([result.score, result.covered_layers, result.total_layers], [33.3, 3, 10]);
  assert.equal(layers.find(l => l.key === 'founder')!.score, 0);
  assert.equal(layers.find(l => l.key === 'competition')!.score, null);
  const empty = overallFromLayers(mergeLayers(computeAutoLayers({ snapshot: null, project: null }), new Map()));
  assert.deepEqual([empty.score, empty.covered_layers, empty.total_layers], [null, 0, 10]);
});

test('D1254: trust requires a shared deal for investors; an intro alone cannot authorize single or batch reads', async () => {
  const f = fixture();
  try {
    for (const [path, body] of [['/score/6', undefined], ['/score/batch', { user_ids: [2, 6] }]] as const) {
      assert.equal((await request(trust, f.env, 3, path, body)).status, 403);
    }
    const batch = await request(trust, f.env, 3, '/score/batch', { user_ids: [2] });
    assert.deepEqual(batch.body.scores, [{ user_id: 2, score: null, status: 'not_recorded', reason: 'No trust obligations recorded' }]);
    f.db.exec("INSERT INTO legal_obligations(user_id,obligation_key,required,status) VALUES(2,'synthetic',1,'pending')");
    assert.equal((await request(trust, f.env, 3, '/score/batch', { user_ids: [2] })).body.scores[0].score, 0);
    f.db.exec("UPDATE legal_obligations SET status='satisfied' WHERE user_id=2");
    assert.equal((await request(trust, f.env, 3, '/score/batch', { user_ids: [2] })).body.scores[0].score, 100);
  } finally { f.db.close(); }
});
