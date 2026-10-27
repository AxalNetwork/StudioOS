/**
 * D1258 (#3281, part 5 of #2428) — the Worker half of the founder's page: the
 * trajectory read (SC12), the advisors a founder may share with, and the notice
 * an advisor gets when a founder shares (SC21). Same full schema and synthetic
 * seed as D1256's test; every person, email and figure is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/venture_scores_d1258.test.ts
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
import { ACCESS_STATEMENTS } from '../src/services/ventureScoring/access.ts';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network disabled in D1258 fixtures'); };
after(() => { globalThis.fetch = realFetch; });

const TODAY = new Date().toISOString().slice(0, 10);
const secret = 'synthetic-d1258-only-'.repeat(3);
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

const inbox = (f: ReturnType<typeof fixture>, type: string) =>
  (f.db.prepare('SELECT user_id, link FROM notifications_inbox WHERE type = ? ORDER BY id').all(type) as any[]).map((r) => ({ ...r }));

test('the trajectory: each scope’s stored rows oldest first with its model; a row with no value is a gap, never a zero', async () => {
  const f = fixture();
  await scored(f);
  // Traction moves: a newer month of revenue writes a new row (rows are written only on a change).
  f.db.exec(`INSERT INTO project_metrics(project_id,snapshot_date,mrr,paying_accounts,net_burn,nrr_pct,source) VALUES (10,'2026-10-20',30000,32,38000,108,'stripe')`);
  await scored(f);
  const r = await f.call(1, 'GET', '/10/trajectory');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.scopes.map((s: any) => s.scope),
    ['team', 'market', 'pmf', 'technical', 'traction', 'financial', 'risk', 'geographic', 'political', 'governance', 'legal_ip']);
  const traction = r.body.scopes.find((s: any) => s.scope === 'traction');
  assert.ok(traction.points.length >= 2, 'a change is a new point');
  assert.ok(traction.points.every((p: any) => p.model && p.at), 'each point names its model and time');
  const stored = f.db.prepare(`SELECT COUNT(*) AS n FROM venture_scorecards WHERE project_id = 10`).get() as any;
  assert.equal(r.body.rows, Number(stored.n));
  assert.ok(r.body.models.length >= 1 && r.body.models[0].version);
  for (const s of r.body.scopes) for (const p of s.points) {
    if (p.state !== 'scored') assert.equal(p.value, null, `${s.scope}: an unscored row is a gap, not 0`);
    assert.equal(p.inputs, undefined, 'no inputs in the trajectory');
    assert.equal(p.signature, undefined);
  }
  assert.equal(f.logs().filter((l) => l.user_id === 1).length, 0, 'the founder’s own read is not logged');
  // Staff read, logged; an advisor (even shared), an investor and an Explorer are refused.
  assert.equal((await f.call(6, 'GET', '/10/trajectory')).status, 200);
  assert.deepEqual(f.logs().filter((l) => l.user_id === 6).map((l) => l.details.trajectory), [true]);
  f.db.exec(`INSERT INTO venture_score_sharing(project_id,audience,user_id,enabled,updated_by,updated_at) VALUES (10,'advisor',12,1,1,'2026-10-26')`);
  for (const who of [3, 12, 4, 8]) assert.equal((await f.call(who, 'GET', '/10/trajectory')).status, 403, String(who));
  assert.equal((await f.call(1, 'GET', '/99/trajectory')).status, 404);
});

test('a venture with nothing stored has an empty trajectory, not a line at zero', async () => {
  const f = fixture();
  const r = await f.call(1, 'GET', '/10/trajectory');
  assert.equal(r.status, 200);
  assert.equal(r.body.rows, 0);
  assert.ok(r.body.scopes.every((s: any) => s.points.length === 0));
  assert.deepEqual(r.body.models, []);
});

test('sharing: the founder chooses from the venture’s own advisors; one newly shared with is told, once', async () => {
  const f = fixture();
  f.db.exec(`INSERT INTO project_members(project_id,user_id,role,status,removed_at) VALUES (10,12,'advisor','accepted','2026-10-01')`);
  const s = await f.call(1, 'GET', '/10/sharing');
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.candidates, { readable: true, items: [{ user_id: 3, name: 'Roster Advisor' }] },
    'the roster advisor, not a removed one, not an advisor elsewhere');
  const full = await quiet(() => f.call(1, 'GET', '/10'));
  assert.deepEqual(full.body.sharing.candidates.items.map((c: any) => c.user_id), [3], 'the founder’s full read carries them too');
  assert.equal((await f.call(2, 'GET', '/10/sharing')).body.candidates.items.length, 1, 'a co-founder sees the same list');
  assert.equal((await f.call(3, 'GET', '/10/sharing')).status, 403, 'an advisor never sees who else is shared with');

  const on = await f.call(1, 'PUT', '/10/sharing', { advisors: [3] });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.advisors.map((a: any) => a.user_id), [3]);
  assert.deepEqual(inbox(f, 'venture_score_shared'), [{ user_id: 3, link: '/practice/scorecards/10' }]);
  await f.call(1, 'PUT', '/10/sharing', { advisors: [3] });
  assert.equal(inbox(f, 'venture_score_shared').length, 1, 'sharing again tells no one again');
  await f.call(1, 'PUT', '/10/sharing', { advisors: [] });
  await f.call(1, 'PUT', '/10/sharing', { investors: false });
  assert.equal(inbox(f, 'venture_score_shared').length, 1, 'stopping, or the investors’ switch, notifies no advisor');
  // The shared advisor's read is the stored scorecard, read-only, inputs as stored.
  await f.call(1, 'PUT', '/10/sharing', { advisors: [3] });
  await scored(f);
  const adv = await f.call(3, 'GET', '/10');
  assert.equal(adv.status, 200);
  assert.equal(adv.body.read_only, true);
  assert.equal(adv.body.sharing, undefined, 'an advisor never reads the sharing list');
  assert.equal(adv.body.investor_preview, undefined);
});

test('advisors that cannot be read say so; they never read as none', async () => {
  const f = fixture();
  f.db.exec('ALTER TABLE project_members RENAME TO project_members_gone');
  const s = await quiet(() => f.call(1, 'GET', '/10/sharing'));
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(s.body.candidates, { readable: false, items: [] });
});

test('bias guards: the new statements are bound, read no never-input and no signature', () => {
  for (const k of ['candidates', 'trajectory'] as const) {
    const stmt = (ACCESS_STATEMENTS as any)[k];
    assert.doesNotMatch(stmt, /\$\{/);
    assert.doesNotMatch(stmt, /kyc_data|date_of_birth|nationality|email|photo|gender|school|employer|SELECT \*|signature|inputs_json/i, k);
  }
});
