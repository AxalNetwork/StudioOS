/**
 * D1256 (#3279, part 3 of #2428) — /api/venture-scores, the visibility rule,
 * logged reads, reviews, corrections, weighting, sharing and the jobs.
 *
 * Every route runs through its real router on the full schema (the baseline
 * and every migration, 626 included) over node:sqlite, with real JWTs and
 * the D1255 engine scoring synthetic records.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/venture_scores_d1256.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, compareMigrations, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import routes from '../src/routes/venture_scores.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { scoreVenture } from '../src/services/ventureScoring/store.ts';
import { ACCESS_STATEMENTS, REVIEW_CAP } from '../src/services/ventureScoring/access.ts';
import { JOB_STATEMENTS, FAIRNESS_MIN_CELL, aggregate, nightlyRecompute, previousQuarter, runFairness, syncRecompute } from '../src/services/ventureScoring/jobs.ts';
import { NEVER_FILL_RULES } from '../src/services/fills/neverFill.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D1256 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const TODAY = new Date().toISOString().slice(0, 10);
const secret = 'synthetic-d1256-only-'.repeat(3);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

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

// People: 1 founder, 2 co-founder, 3 advisor on the roster, 4 investor on the deal,
// 5 investor off it, 6 Operating Partner, 7 Super Admin, 8 Explorer, 11 Admin, 12 another advisor.
const ROLES: Record<number, string> = { 1: 'founder', 2: 'founder', 3: 'advisor', 4: 'investor', 5: 'investor', 6: 'partner', 7: 'admin', 8: 'exploring', 11: 'admin', 12: 'advisor' };

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(ddl);
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,is_active) VALUES
      (1,'private@example.test','Private Person','founder',20,1),(2,'co@example.test','Co Founder','founder',NULL,1),
      (3,'adv@example.test','Roster Advisor','advisor',NULL,1),(4,'inv@example.test','Deal Investor','investor',NULL,1),
      (5,'off@example.test','Off Investor','investor',NULL,1),(6,'op@example.test','Operating Partner','partner',NULL,1),
      (7,'hq@example.test','Super Admin','admin',NULL,1),(8,'ex@example.test','Explorer','exploring',NULL,1),
      (11,'admin@example.test','Plain Admin','admin',NULL,1),(12,'adv2@example.test','Shared Advisor','advisor',NULL,1);
    INSERT INTO super_admins(user_id) VALUES (7);
    INSERT INTO projects(id,name,founder_id,status,stage,lifecycle_stage,sector,tam,sam,entity_id,spinout_ip_meta)
      VALUES (10,'Synthetic venture',20,'spinout','seed','build','fintech',1000000000,50000000,5,'{"terms":"synthetic"}');
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (10,2,'cofounder','accepted'),(10,3,'advisor','accepted');
    INSERT INTO deals(id,project_id,status) VALUES (100,10,'active');
    INSERT INTO deal_invitations(deal_id,investor_user_id) VALUES (100,4);`);
  seed(db);
  const env: any = { DB: d1Over(db), JWT_SECRET: secret, SCORING_HMAC_SECRET: secret, ENVIRONMENT: 'development' };
  const app = new Hono().route('/vs', routes);
  app.onError((e, c) => mapError(c as any, e));
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const tok = await new SignJWT({ user_id: who, role: ROLES[who] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret));
    const res = await app.request(`/vs${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any, text: '' };
  };
  const logs = (action = 'venture_score_read') => (db.prepare('SELECT user_id, details, actor FROM activity_logs WHERE action = ? ORDER BY id').all(action) as any[])
    .map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const count = (table: string, where = '1=1') => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as any).n);
  return { db, env, call, logs, count };
}

/** Records across every scope for venture 10 (D1255's synthetic seed). */
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
    INSERT INTO ritual_runs(project_id,ritual_id,run_date,state) VALUES (10,1,'2026-10-20','done'),(10,1,'2026-10-13','missed');
    INSERT INTO hypothesis_verdict_history(project_id,hypothesis_id,verdict,lane,observed_at) VALUES
      (10,1,'testing','claims','2026-09-01'),(10,1,'invalidated','claims','2026-09-20'),(10,2,'invalidated','claims','2026-10-10'),(10,3,'validated','claims','2026-10-01'),(10,4,'invalidated','claims','2026-09-25');
    INSERT INTO validation_decisions(project_id,decision,reasoning,decided_at,decided_by,state) VALUES
      (10,'pivot','Synthetic reasoning','2026-10-01',1,'given'),(10,'stop','Synthetic reasoning','2026-10-20',1,'withheld');`);
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; }
};
/** Scores the venture once, as its founder would on a read. */
const scored = async (f: ReturnType<typeof fixture>) => { await quiet(() => scoreVenture(f.env, 10, { actorId: 1, trigger: 'read', today: TODAY })); };
const NDA = (db: DatabaseSync) => db.exec(`INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status,valid_until) VALUES (1,4,'active',NULL)`);
const PRIVATE = ['Private Person', 'private@example.test', 'Private Employer Inc', 'Private University', 'private-login', 'Privatelandia'];

test('an investor off the deal reads nothing; on it, bands and confidence only before the NDA; every read is logged', async () => {
  const f = fixture();
  await scored(f);
  const off = await f.call(5, 'GET', '/deal/100');
  assert.equal(off.status, 403);
  assert.equal(off.body.error, 'not_on_deal');
  assert.equal(off.body.scopes, undefined);
  const masked = await f.call(4, 'GET', '/deal/100');
  assert.equal(masked.status, 200, JSON.stringify(masked.body));
  assert.equal(masked.body.nda, false);
  assert.equal(masked.body.scopes.length, 11);
  for (const s of masked.body.scopes) {
    assert.equal(s.masked, true);
    assert.deepEqual(Object.keys(s).sort(), ['band', 'confidence_word', 'label', 'masked', 'review', 'scope', 'state']);
  }
  assert.ok(masked.body.scopes.some((s: any) => s.band), 'a scored scope shows its band');
  const log = f.logs().filter((l) => l.user_id === 4);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].details, { viewer: 'investor', scopes: 11, deal_id: 100, masked: true });
  assert.doesNotMatch(JSON.stringify(f.logs()), /"value"|"band"|Strong|Fair|Weak/, 'a read log carries no score');
  // An investor reads through a deal, never by venture id.
  assert.equal((await f.call(4, 'GET', '/10')).body.error, 'read_through_deal');
});

test('after an NDA an investor sees values and inputs, a personal input as a band, never its figure or words', async () => {
  const f = fixture();
  await scored(f);
  NDA(f.db);
  const r = await f.call(4, 'GET', '/deal/100');
  assert.equal(r.body.nda, true);
  const team = r.body.scopes.find((s: any) => s.scope === 'team');
  assert.equal(team.masked, false);
  const personal = team.inputs.filter((i: any) => i.personal);
  assert.ok(personal.length > 0, 'Team carries personal inputs');
  for (const i of personal) {
    assert.equal(i.shown, false);
    assert.equal(i.note, 'Counted, not shown');
    assert.ok(!('value' in i) && !('words' in i) && !('grade' in i));
  }
  const shown = r.body.scopes.flatMap((s: any) => s.inputs || []).filter((i: any) => !i.personal);
  assert.ok(shown.some((i: any) => i.value != null), 'a non-personal input shows its value');
  for (const p of PRIVATE) assert.ok(!JSON.stringify(r.body).includes(p), `never ${p}`);
  assert.equal(f.logs().at(-1).details.masked, false);
});

test("the founder's switch: on once listed, off locks investors out, and the strip with it", async () => {
  const f = fixture();
  await scored(f);
  const sharing = await f.call(1, 'GET', '/10/sharing');
  assert.deepEqual(sharing.body.investors, { on: true, set: false, default_rule: 'On once the venture is listed, until you turn it off.' });
  const off = await f.call(1, 'PUT', '/10/sharing', { investors: false });
  assert.equal(off.body.investors.on, false);
  const locked = await f.call(4, 'GET', '/deal/100');
  assert.deepEqual({ locked: locked.body.locked, scopes: locked.body.scopes }, { locked: true, scopes: undefined });
  const strip = await f.call(4, 'POST', '/batch', { deal_ids: [100] });
  assert.equal(strip.body.items[0].locked, true);
  assert.equal(strip.body.items[0].scopes, undefined);
  // Staff are not held by the switch.
  assert.equal((await f.call(6, 'POST', '/batch', { deal_ids: [100] })).body.items[0].locked, false);
  assert.equal(f.count('activity_logs', "action = 'venture_score_sharing_changed'"), 1);
  // Unlisted: no deal, no row, the switch is off.
  f.db.exec('DELETE FROM deals');
  assert.equal((await f.call(1, 'GET', '/10/sharing')).body.investors.on, false);
});

test('who reads by venture id: founder and co-founder in full and unlogged, staff logged, an advisor only when shared, an Explorer never', async () => {
  const f = fixture();
  const founder = await quiet(() => f.call(1, 'GET', '/10'));
  assert.equal(founder.status, 200, JSON.stringify(founder.body));
  assert.equal(founder.body.viewer, 'founder');
  assert.equal(founder.body.scopes.length, 11);
  assert.ok(founder.body.investor_preview.before_nda.every((s: any) => s.masked));
  assert.ok(founder.body.sharing);
  assert.equal((await quiet(() => f.call(2, 'GET', '/10'))).body.viewer, 'founder', 'an accepted co-founder');
  assert.equal(f.logs().length, 0, 'the founder\'s own reads are not logged');
  const op = await quiet(() => f.call(6, 'GET', '/10'));
  assert.equal(op.body.viewer, 'staff');
  assert.equal(op.body.sharing, undefined);
  assert.equal(f.logs().length, 1);
  assert.equal(f.logs()[0].actor, 'partner');
  assert.equal((await f.call(3, 'GET', '/10')).status, 403, 'an advisor on the roster, not shared');
  assert.equal((await f.call(12, 'GET', '/10')).status, 403);
  assert.equal((await f.call(1, 'PUT', '/10/sharing', { advisors: [12] })).status, 200);
  const adv = await f.call(12, 'GET', '/10');
  assert.equal(adv.body.viewer, 'advisor');
  assert.equal(adv.body.read_only, true);
  assert.equal(f.logs().at(-1).details.viewer, 'advisor');
  assert.equal((await f.call(1, 'PUT', '/10/sharing', { advisors: [4] })).body.error, 'not_advisor');
  assert.equal((await f.call(8, 'GET', '/10')).status, 403);
  assert.equal((await f.call(8, 'GET', '/deal/100')).status, 403);
  assert.equal((await f.call(1, 'GET', '/999')).status, 404);
});

test('a review over 15 points is refused and writes nothing; within the cap, with a reason, it is shown beside the computed value and the founder is told', async () => {
  const f = fixture();
  await scored(f);
  const scope = (f.db.prepare("SELECT scope FROM venture_scorecards WHERE project_id = 10 AND state = 'scored' AND scope <> 'pmf' ORDER BY id LIMIT 1").get() as any).scope;
  const over = await f.call(6, 'PUT', `/10/scopes/${scope}/review`, { adjustment: REVIEW_CAP + 1, reason: 'Synthetic reason over the cap' });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, 'adjustment_too_large');
  assert.equal(f.count('venture_score_reviews'), 0);
  assert.equal((await f.call(6, 'PUT', `/10/scopes/${scope}/review`, { adjustment: 5 })).body.error, 'reason_required');
  assert.equal((await f.call(1, 'PUT', `/10/scopes/${scope}/review`, { adjustment: 5, reason: 'The founder cannot review' })).status, 403);
  assert.equal((await f.call(4, 'PUT', `/10/scopes/${scope}/review`, { adjustment: 5, reason: 'An investor cannot review' })).status, 403);
  const before = Number((f.db.prepare('SELECT value FROM venture_scorecards WHERE project_id = 10 AND scope = ? ORDER BY id DESC LIMIT 1').get(scope) as any).value);
  const ok = await quiet(() => f.call(6, 'PUT', `/10/scopes/${scope}/review`, { adjustment: -REVIEW_CAP, reason: 'Synthetic reason within the cap' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.computed_value, before);
  assert.equal(ok.body.reviewed_value, Math.max(0, before - REVIEW_CAP));
  assert.equal(Number((f.db.prepare('SELECT value FROM venture_scorecards WHERE project_id = 10 AND scope = ? ORDER BY id DESC LIMIT 1').get(scope) as any).value), before, 'the computed score is never overwritten');
  const told = f.db.prepare("SELECT user_id, body FROM notifications_inbox WHERE type = 'venture_score_reviewed' ORDER BY user_id").all() as any[];
  assert.deepEqual(told.map((t) => t.user_id), [1, 2], 'the founder and co-founder are told');
  assert.match(told[0].body, /by -15 points\. Reason: Synthetic reason within the cap/);
  const audit = f.logs('venture_score_reviewed');
  assert.deepEqual(audit[0].details, { scope, kind: 'adjustment' });
  NDA(f.db);
  const inv = (await f.call(4, 'GET', '/deal/100')).body.scopes.find((s: any) => s.scope === scope);
  assert.deepEqual(inv.review, { adjustment: -REVIEW_CAP, reason: 'Synthetic reason within the cap', reviewer: 'Operating Partner' });
  assert.equal(inv.value, before, 'the investor sees the computed value, with the review beside it');
  // A note on a scope that is not scored is allowed; an adjustment is not.
  const unscored = (f.db.prepare("SELECT scope FROM venture_scorecards WHERE project_id = 10 AND state <> 'scored' AND scope <> 'pmf' LIMIT 1").get() as any)?.scope;
  assert.ok(unscored, 'the seed leaves a scope not scored');
  assert.equal((await f.call(11, 'PUT', `/10/scopes/${unscored}/review`, { adjustment: 3, reason: 'Synthetic reason here' })).status, 409);
  assert.equal((await quiet(() => f.call(11, 'PUT', `/10/scopes/${unscored}/review`, { note: 'Synthetic note' }))).status, 201);
});

test('Ask to correct: the founder names one input of a scope, once while open', async () => {
  const f = fixture();
  const ask = { scope: 'team', input_key: 'commitment', message: 'Synthetic: my co-founder is now full time.' };
  const ok = await f.call(1, 'POST', '/10/corrections', ask);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.state, 'open');
  assert.equal((await f.call(1, 'POST', '/10/corrections', ask)).body.error, 'already_open');
  assert.equal((await f.call(1, 'POST', '/10/corrections', { ...ask, input_key: 'mrr' })).body.error, 'bad_input');
  assert.equal((await f.call(1, 'POST', '/10/corrections', { ...ask, scope: 'overall' })).body.error, 'bad_scope');
  assert.equal((await f.call(1, 'POST', '/10/corrections', { ...ask, input_key: 'experience', message: 'short' })).body.error, 'message_required');
  assert.equal((await f.call(6, 'POST', '/10/corrections', ask)).status, 403);
  assert.equal((await f.call(3, 'POST', '/10/corrections', ask)).status, 403, 'a roster advisor is not a founder');
  assert.deepEqual(f.logs('venture_score_correction_asked')[0].details, { scope: 'team', input_key: 'commitment' });
  assert.equal(f.count('venture_score_corrections'), 1);
});

test('Your weighting: eleven whole numbers 0–5, reset to equal, never a founder\'s', async () => {
  const f = fixture();
  const keys = ['team', 'market', 'pmf', 'technical', 'traction', 'financial', 'risk', 'geographic', 'political', 'governance', 'legal_ip'];
  assert.deepEqual((await f.call(4, 'GET', '/weights')).body, { weights: null, equal: true, updated_at: null });
  const w = Object.fromEntries(keys.map((k, i) => [k, i % 6]));
  const put = await f.call(4, 'PUT', '/weights', { weights: w });
  assert.deepEqual(put.body.weights, w);
  assert.equal(put.body.equal, false);
  assert.equal((await f.call(4, 'PUT', '/weights', { weights: { ...w, team: 6 } })).body.error, 'bad_weights');
  assert.equal((await f.call(4, 'PUT', '/weights', { weights: { ...w, overall: 1 } })).body.error, 'bad_weights');
  const { pmf, ...missing } = w; void pmf;
  assert.equal((await f.call(4, 'PUT', '/weights', { weights: missing })).body.error, 'bad_weights');
  assert.equal((await f.call(4, 'PUT', '/weights', { weights: null })).body.equal, true);
  assert.equal((await f.call(1, 'GET', '/weights')).status, 403);
});

test('the batch strip: state, band and confidence word per scope, never a number; a deal the caller cannot read is left out', async () => {
  const f = fixture();
  await scored(f);
  f.db.exec("INSERT INTO deals(id,project_id,status) VALUES (200,10,'active')");
  const r = await f.call(4, 'POST', '/batch', { deal_ids: [100, 200, 999] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: any) => i.deal_id), [100]);
  assert.equal(r.body.not_readable, 2);
  for (const s of r.body.items[0].scopes) assert.deepEqual(Object.keys(s).sort(), ['band', 'confidence_word', 'scope', 'state']);
  assert.equal(f.logs().at(-1).details.batch, true);
  assert.equal((await f.call(1, 'POST', '/batch', { deal_ids: [100] })).status, 403, 'a founder has no deal list');
  assert.equal((await f.call(4, 'POST', '/batch', { deal_ids: Array.from({ length: 201 }, (_, i) => i + 1) })).body.error, 'bad_deals');
});

test('Re-score: the founder and staff, never an investor; models for any member', async () => {
  const f = fixture();
  const r = await quiet(() => f.call(1, 'POST', '/10/recompute'));
  assert.equal(r.status, 200);
  assert.equal(r.body.scopes.length, 11);
  assert.ok(f.count('activity_logs', "action = 'venture_score_recomputed' AND details LIKE '%rescore%'") > 0);
  assert.equal((await f.call(4, 'POST', '/10/recompute')).status, 403);
  const m = await f.call(8, 'GET', '/models');
  assert.equal(m.body.scopes.length, 11);
  assert.equal(m.body.scopes[2].scope, 'pmf');
});

test('the jobs: nightly and after a sync carry no actor; the fairness check suppresses small cells and runs once a quarter', async () => {
  const f = fixture();
  const n = await quiet(() => nightlyRecompute(f.env, new Date()));
  assert.equal(n.ventures, 1);
  assert.equal(n.failed, 0);
  assert.ok(f.count('venture_scorecards', "trigger = 'nightly' AND computed_by IS NULL") > 0);
  assert.ok(f.count('activity_logs', "actor = 'system:nightly'") > 0);
  assert.equal(f.count('activity_logs', "actor = 'system:nightly' AND user_id IS NOT NULL"), 0);
  // A second night with nothing changed writes nothing.
  const rows = f.count('venture_scorecards');
  await quiet(() => nightlyRecompute(f.env, new Date()));
  assert.equal(f.count('venture_scorecards'), rows);
  // A connector synced after the latest row picks the venture up.
  assert.equal((await quiet(() => syncRecompute(f.env))).ventures, 0);
  f.db.exec("INSERT INTO integrations(uid,user_id,provider_key,auth_type,status,last_synced_at) VALUES ('i1',1,'stripe','oauth2','active','2999-01-01 00:00:00')");
  assert.equal((await quiet(() => syncRecompute(f.env))).ventures, 1);
  await assert.rejects(scoreVenture(f.env, 10, { actorId: null, trigger: 'read', today: TODAY }), /invalid_scorecard_context/);
  await assert.rejects(scoreVenture(f.env, 10, { actorId: 1, trigger: 'nightly', today: TODAY }), /invalid_scorecard_context/);
  const first = await runFairness(f.env, new Date('2027-01-01T04:30:00Z'));
  assert.deepEqual({ quarter: first.quarter, written: first.written }, { quarter: '2026-Q4', written: true });
  assert.equal((await runFairness(f.env, new Date('2027-01-01T04:31:00Z'))).written, false, 'once a quarter');
  const stored = JSON.parse((f.db.prepare('SELECT aggregate_json FROM venture_score_fairness').get() as any).aggregate_json);
  assert.equal(stored.scopes.team.all.suppressed, true, 'one venture is under the cell minimum');
  assert.equal(stored.scopes.team.all.value, null);
  assert.equal((await f.call(7, 'GET', '/fairness')).body.run.quarter, '2026-Q4');
  assert.equal((await f.call(11, 'GET', '/fairness')).status, 403, 'a plain Admin');
  assert.equal(previousQuarter(new Date('2026-04-01T00:00:00Z')), '2026-Q1');
});

test('fairness aggregate: a cell of five shows means; a group far from all opens a model review', () => {
  const row = (id: number, value: number | null, stage: string, people = 2) => ({ project_id: id, scope: 'team', value, confidence: 0.5, state: value == null ? 'not_enough' : 'scored', stage, sector: 'x', people, connected: 0 });
  const rows = [
    ...[1, 2, 3, 4, 5].map((i) => row(i, 80, 'build')),
    ...[6, 7, 8, 9, 10].map((i) => row(i, 40, 'validate')),
    row(11, 60, 'idea'),
  ];
  const agg = aggregate(rows);
  const team = (agg.scopes as any).team;
  assert.equal(team.by.stage.build.ventures, FAIRNESS_MIN_CELL);
  assert.equal(team.by.stage.build.value, 80);
  assert.equal(team.by.stage.idea.suppressed, true);
  assert.equal(team.by.stage.idea.value, null);
  assert.ok(agg.gaps.some((g) => g.dimension === 'stage' && g.group === 'build'));
  assert.equal(agg.opens_review, true);
});

test('bias guards: every new statement is bound and reads no never-input; the new tables are never-fill', () => {
  const src = [read('../src/routes/venture_scores.ts'), read('../src/services/ventureScoring/access.ts'), read('../src/services/ventureScoring/jobs.ts')].join('\n');
  for (const stmt of [...Object.values(ACCESS_STATEMENTS), ...Object.values(JOB_STATEMENTS)]) {
    assert.doesNotMatch(stmt, /\$\{/, 'no interpolation');
    assert.doesNotMatch(stmt, /kyc_data|date_of_birth|nationality|email|photo|gender|school|employer|SELECT \*/i);
  }
  assert.doesNotMatch(src, /prepare\(`[^`]*\$\{/, 'no interpolated SQL');
  const score = NEVER_FILL_RULES.find((r) => r.category === 'score_rating')!;
  for (const t of ['venture_scorecards', 'venture_score_reviews', 'investor_scope_weights', 'venture_score_sharing']) assert.ok(score.tables.includes(t), t);
});
