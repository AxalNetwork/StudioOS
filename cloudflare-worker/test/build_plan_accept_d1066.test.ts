/**
 * D1066 (#2936, part 3 of #2426): Accept, Edit and accept, Dismiss, Accept all
 * in a module, and the evidence trail.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, so the plan, Build and provenance SQL run against
 * production's columns. The plan comes from D1065's own preparation. Every
 * venture, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_plan_accept_d1066.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import planRoutes, { buildEvidenceRoutes } from '../src/routes/build_plan.ts';
import { preparePlan } from '../src/services/buildPlanner.ts';
import { MODULE_ACCEPT_LIMIT, NOT_SENT_YET } from '../src/services/buildPlanAccept.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'build-accept-test-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 1, OTHER = 2, ADMIN = 3, PARTNER = 4, OUTSIDER = 5;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(`INSERT INTO users(id,email,name,role,founder_id,spinout_lab_active,is_active) VALUES
    (1,'one@example.test','Founder One','founder',100,0,1),(2,'two@example.test','Founder Two','founder',200,0,1),(3,'admin@example.test','Admin','admin',NULL,0,1),
    (4,'partner@example.test','Partner','partner',NULL,0,1),(5,'outside@example.test','Outside','partner',NULL,0,1);
    INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'One',100,10),(2,'Two',200,20);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES('partner-one',10,4);
    INSERT INTO pain_groups(id,project_id,title) VALUES(1,1,'Slow setup');
    INSERT INTO pain_group_aliases(project_id,group_id,phrase_norm,display_phrase) VALUES(1,1,'slow setup','Slow setup');
    INSERT INTO hypotheses(id,project_id,code,claim) VALUES(1,1,'H1','Setup in one day'),(2,1,'H2','Self service works');
    INSERT INTO hypothesis_pain_links(id,hypothesis_id,pain_group_id,direction) VALUES(1,1,1,'supports');
    INSERT INTO validation_decisions(id,project_id,decision,state,reasoning) VALUES(1,1,'proceed','given','Private reasoning');
    INSERT INTO validation_decision_evidence(uid,decision_id,kind,ref_id,label,direction) VALUES('de1',1,'interview','pain-1-1','Snapshot','supports');
    INSERT INTO validation_decision_commitments(id,uid,decision_id,project_id,text,owner_user_id,due_date) VALUES(1,'c1',1,1,'Test the pilot',1,'2027-12-31');
    INSERT INTO demand_signals(id,project_id,kind,status,signal_date) VALUES(1,1,'would_pay','confirmed','2026-10-01');`);
  for (let id = 1; id <= 3; id++) {
    db.prepare('INSERT INTO discovery_interviews(id,project_id,interviewee_name,pains_json) VALUES(?,1,?,?)').run(id, 'Someone', '["Slow setup"]');
    db.prepare("INSERT INTO interview_pain_severities(interview_id,phrase_norm,severity) VALUES(?,'slow setup','severe')").run(id);
    db.prepare("INSERT INTO interview_findings(uid,project_id,interview_id,module,kind,key_norm,payload_json) VALUES(?,1,?,'demand-signals','objection','price',?)").run('f' + id, id, '{"about":"price"}');
  }
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/cycles/build/plan', planRoutes);
app.route('/api/cycles/build/evidence', buildEvidenceRoutes);

async function call(env: any, user: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const r = await app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  } finally { [console.warn, console.error] = saved; }
}
const item = (db: DatabaseSync, kind: string) => db.prepare(`SELECT i.*, q.status, q.payload_json FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
  WHERE i.kind = ? ORDER BY i.item_key LIMIT 1`).get(kind) as any;
const accept = (env: any, uid: string, payload?: unknown, who = FOUNDER) => call(env, who, 'POST', `/api/cycles/build/plan/items/${uid}/accept`, payload === undefined ? {} : { payload });
const count = (db: DatabaseSync, sql: string, ...args: any[]) => Number((db.prepare(sql).get(...args) as any).n);

test('accept: the feature lands through its writer with its evidence links, one provenance row per carried field and the activity line', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const f = item(db, 'feature');
    const evidence = JSON.parse(f.evidence_json);
    const before = count(db, 'SELECT COUNT(*) n FROM mvp_features');
    const r = await accept(env, f.uid);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'accepted');
    assert.equal(r.body.landed_table, 'mvp_features');
    const row: any = db.prepare('SELECT * FROM mvp_features WHERE id = ?').get(Number(r.body.landed_id));
    assert.equal(row.project_id, 1);
    assert.equal(row.title, 'Slow setup');
    assert.equal(row.pain_group_id, 1);
    assert.equal(row.hypothesis_id, 1);
    assert.equal(row.added_value, 'High');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), before + 1);
    const links: any[] = db.prepare('SELECT * FROM build_evidence_links WHERE build_table = ? AND build_id = ? ORDER BY id').all('mvp_features', r.body.landed_id);
    assert.deepEqual(links.map((l) => [l.evidence_kind, l.evidence_ref]), evidence.map((e: any) => [e.kind, e.ref]));
    assert.ok(links.every((l) => l.plan_item_uid === f.uid && l.project_id === 1));
    const prov: any[] = db.prepare('SELECT * FROM fill_provenance WHERE target_table = ? AND target_row_id = ? ORDER BY id').all('mvp_features', row.id);
    assert.deepEqual(prov.map((p) => p.target_column), ['title', 'added_value', 'pain_group_id', 'hypothesis_id']);
    const proposalId = (db.prepare('SELECT id FROM ai_rail_proposals WHERE uid = ?').get(f.proposal_uid) as any).id;
    for (const p of prov) {
      const cite = JSON.parse(p.citation_json);
      assert.equal(cite.source_kind, 'module');
      assert.equal(cite.source_ref, 'pain_group:1');
      assert.equal(cite.source_label, 'Recorded');
      assert.equal(cite.prior_value, null);
      assert.equal(p.ai_proposal_id, proposalId);
      assert.equal(p.edited, 0);
      assert.equal(p.decided_by, FOUNDER);
    }
    assert.equal((db.prepare("SELECT details FROM activity_logs WHERE action = 'build_feature_created'").get() as any) != null, true);
    assert.equal((db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(f.proposal_uid) as any).status, 'accepted');
    const again = await accept(env, f.uid);
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'decided');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), before + 1, 'a second press writes nothing');
  } finally { db.close(); }
});

test('two presses: the claim decides once, one row lands, the late press is decided', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const f = item(db, 'feature');
    const before = count(db, 'SELECT COUNT(*) n FROM mvp_features');
    assert.equal((await accept(env, f.uid)).status, 200);
    // The second press read the item before the first claim landed: only the claim's own guard stops it.
    const real = env.DB;
    const stale = { ...env, DB: { ...real, prepare: (q: string) => {
      const st = real.prepare(q);
      if (!q.includes('FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid\n    JOIN build_plans p')) return st;
      return { bind: (...v: unknown[]) => { const b = st.bind(...v); return { ...b, first: async () => ({ ...(await b.first()) as any, status: 'proposed' }) }; } };
    } } };
    const late = await accept(stale, f.uid);
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'decided');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), before + 1);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM build_evidence_links'), JSON.parse(f.evidence_json).length);
  } finally { db.close(); }
});

test('edit and accept: the saved edit and the press\'s edit land, the proposal reads edited, provenance keeps both values', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const f = item(db, 'feature');
    const saved = await call(env, FOUNDER, 'PATCH', `/api/cycles/build/plan/items/${f.uid}`, { payload: { title: 'One-day setup wizard' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.status, 'proposed');
    assert.equal(count(db, "SELECT COUNT(*) n FROM mvp_features WHERE title = 'One-day setup wizard'"), 0, 'a saved edit writes no Build row');
    const bad = await accept(env, f.uid, { pain_group_id: 9 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_edit');
    assert.equal((await accept(env, f.uid, { added_value: 'Huge' })).body.code, 'invalid_edit');
    assert.equal((await accept(env, f.uid, { lane: 'Now' })).body.code, 'invalid_edit', 'a key this kind does not take, whatever its value');
    const r = await accept(env, f.uid, { effort: 'L' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'edited');
    const row: any = db.prepare('SELECT title, effort FROM mvp_features WHERE id = ?').get(Number(r.body.landed_id));
    assert.deepEqual({ ...row }, { title: 'One-day setup wizard', effort: 'L' });
    const title: any = db.prepare("SELECT proposed_value, written_value, edited FROM fill_provenance WHERE target_column = 'title'").get();
    assert.deepEqual({ ...title }, { proposed_value: 'Slow setup', written_value: 'One-day setup wizard', edited: 1 });
    const decided: any = db.prepare('SELECT status, decided_payload_json FROM ai_rail_proposals WHERE uid = ?').get(f.proposal_uid);
    assert.equal(decided.status, 'edited');
    assert.equal(JSON.parse(decided.decided_payload_json).title, 'One-day setup wizard');
  } finally { db.close(); }
});

test('a failed batch hands the claim back and leaves no row, link or provenance', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const f = item(db, 'feature');
    const real = env.DB;
    const failing = { ...env, DB: { ...real, batch: async () => { throw new Error('D1 unavailable'); } } };
    const before = count(db, 'SELECT COUNT(*) n FROM mvp_features');
    const r = await accept(failing, f.uid);
    assert.equal(r.status, 502);
    assert.equal(r.body.code, 'writer_refused');
    assert.equal((db.prepare('SELECT status, decided_at FROM ai_rail_proposals WHERE uid = ?').get(f.proposal_uid) as any).status, 'proposed');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM mvp_features'), before);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM build_evidence_links'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM fill_provenance'), 0);
    // A writer that writes no row fails the batch too: a test of a claim retired since it was planned.
    const t = item(db, 'prototype-test');
    db.prepare("UPDATE hypotheses SET retired_at = '2026-10-20' WHERE id = ?").run(JSON.parse(t.payload_json).hypothesis_id);
    const retired = await accept(env, t.uid);
    assert.equal(retired.status, 502);
    assert.equal((db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(t.proposal_uid) as any).status, 'proposed');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM hypothesis_experiments'), 0);
    assert.equal((db.prepare('SELECT landed_id FROM build_plan_items WHERE uid = ?').get(t.uid) as any).landed_id, null);
    // The handed-back claim accepts once the store answers.
    assert.equal((await accept(env, f.uid)).status, 200);
  } finally { db.close(); }
});

test('each kind lands in its module\'s store: must-have, prototype test, risk, roadmap item, formation step; a door lands nothing', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const must = await accept(env, item(db, 'must-have').uid);
    assert.equal((db.prepare('SELECT is_must_have, hypothesis_id FROM mvp_features WHERE id = ?').get(Number(must.body.landed_id)) as any).is_must_have, 1);
    const test1 = await accept(env, item(db, 'prototype-test').uid);
    assert.equal(test1.body.landed_table, 'hypothesis_experiments');
    const x: any = db.prepare('SELECT method, target, status, hypothesis_id FROM hypothesis_experiments WHERE id = ?').get(Number(test1.body.landed_id));
    assert.equal(x.method, 'Prototype test');
    assert.equal(x.status, 'planned');
    assert.match(String(x.target), /1 confirmed demand signals to invite/);
    const risk = await accept(env, item(db, 'risk').uid);
    assert.deepEqual({ ...db.prepare('SELECT title, severity, state FROM venture_risks WHERE id = ?').get(Number(risk.body.landed_id)) as any },
      { title: 'Test the price objection', severity: 'high', state: 'open' });
    const commitment = db.prepare("SELECT i.uid FROM build_plan_items i WHERE i.item_key LIKE '%commitment-%'").get() as any;
    const road = await accept(env, commitment.uid);
    const okr: any = db.prepare('SELECT objective, kanban_status, target_date, owner_user_id FROM roadmap_okrs WHERE id = ?').get(Number(road.body.landed_id));
    assert.deepEqual({ ...okr }, { objective: 'Test the pilot', kanban_status: 'next', target_date: null, owner_user_id: null }, 'no owner or date is proposed');
    const step = await accept(env, item(db, 'formation-step').uid);
    assert.equal((db.prepare('SELECT state, due_date FROM formation_steps WHERE id = ?').get(Number(step.body.landed_id)) as any).state, 'todo');
    const door = item(db, 'connect-door');
    const opened = await accept(env, door.uid);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.landed_table, null);
    assert.equal(count(db, "SELECT COUNT(*) n FROM fill_provenance WHERE citation_json LIKE ?", `%${door.uid}%`), 0);
    assert.equal(count(db, "SELECT COUNT(*) n FROM activity_logs WHERE action = 'build_plan_door_accepted'"), 1);
  } finally { db.close(); }
});

test('dismiss: never proposed again, and a dismissed item cannot be accepted', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const r = item(db, 'risk');
    const out = await call(env, FOUNDER, 'POST', `/api/cycles/build/plan/items/${r.uid}/dismiss`, {});
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal((db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(r.proposal_uid) as any).status, 'discarded');
    assert.equal((await accept(env, r.uid)).body.code, 'decided');
    await preparePlan(env, 1, FOUNDER);
    assert.equal(count(db, `SELECT COUNT(*) n FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
      WHERE i.item_key = ? AND q.status = 'proposed'`, r.item_key), 0, 'its key is never proposed again');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM venture_risks'), 0);
  } finally { db.close(); }
});

test('who: the venture\'s founder accepts; an admin, another founder, a partner and a signed-out caller are refused', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const f = item(db, 'feature');
    assert.equal((await accept(env, f.uid, undefined, 0 as any)).status, 401);
    for (const who of [ADMIN, OTHER, PARTNER]) {
      const r = await accept(env, f.uid, undefined, who);
      assert.equal(r.status, 404, String(who));
      assert.equal(r.body.code, 'not_this_project', String(who));
    }
    assert.equal((await call(env, ADMIN, 'POST', `/api/cycles/build/plan/items/${f.uid}/dismiss`, {})).body.code, 'not_this_project');
    assert.equal((await call(env, ADMIN, 'POST', '/api/cycles/build/plan/modules/solution-design/accept?project=1&scope=venture', {})).body.code, 'not_this_project');
    assert.equal((await accept(env, 'not-a-uid')).body.code, 'not_this_project');
    assert.equal((db.prepare('SELECT status FROM ai_rail_proposals WHERE uid = ?').get(f.proposal_uid) as any).status, 'proposed');
    db.exec("UPDATE build_plans SET status = 'paused'");
    assert.equal((await accept(env, f.uid)).body.code, 'plan_paused');
  } finally { db.close(); }
});

test('accept all in a module: each item through its own claim, at most 50, each outcome reported', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const plan: any = db.prepare('SELECT id FROM build_plans').get();
    // 51 more doors in Operating systems, beside the three the plan proposed.
    for (let n = 0; n < 51; n++) {
      const q = crypto.randomUUID(), i = crypto.randomUUID();
      db.prepare(`INSERT INTO ai_rail_proposals(uid,user_id,rail_page,rail_option,record_ref,kind,payload_json,source_kind,source_ref,source_label)
        VALUES(?,1,'Founder.Build.Plan','draft:build/plan','project:1','proposal','{"title":"Connect a tool"}','module','hypothesis:1','Typed')`).run(q);
      db.prepare(`INSERT INTO build_plan_items(uid,plan_id,project_id,module,kind,item_key,proposal_uid,evidence_json,marker)
        VALUES(?,?,1,'operating-systems','connect-door',?,?,'[]',?)`).run(i, plan.id, `operating-systems:connect-door:z${String(n).padStart(2, '0')}`, q, `VB-T${n}`);
    }
    const r = await call(env, FOUNDER, 'POST', '/api/cycles/build/plan/modules/operating-systems/accept?project=1&scope=venture', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.results.length, MODULE_ACCEPT_LIMIT);
    assert.equal(r.body.accepted, MODULE_ACCEPT_LIMIT);
    assert.equal(r.body.more, true);
    assert.equal(count(db, `SELECT COUNT(*) n FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
      WHERE i.module = 'operating-systems' AND q.status = 'proposed'`), 54 - MODULE_ACCEPT_LIMIT);
    const sd = await call(env, FOUNDER, 'POST', '/api/cycles/build/plan/modules/solution-design/accept?project=1&scope=venture', {});
    assert.ok(sd.body.results.length >= 2);
    assert.ok(sd.body.results.every((x: any) => x.ok), JSON.stringify(sd.body.results));
    assert.equal((await call(env, FOUNDER, 'POST', '/api/cycles/build/plan/modules/founding-team/accept?project=1&scope=venture', {})).status, 404);
  } finally { db.close(); }
});

test('the evidence trail: evidence, the plan item and the decision for the founder; no decision for a partner; what came back', async () => {
  const { db, env } = fixture();
  try {
    await preparePlan(env, 1, FOUNDER);
    const step = await accept(env, item(db, 'formation-step').uid);
    const id = step.body.landed_id;
    db.prepare("INSERT INTO integrations(id,uid,user_id,provider_key,auth_type) VALUES(9,'int-9',1,'github','oauth2')").run();
    db.prepare("INSERT INTO connector_fed_items(integration_id,project_id,module,kind,external_id,local_table,local_id) VALUES(9,1,'company-creation','issue','gh-77','formation_steps',?)").run(Number(id));
    const path = `/api/cycles/build/evidence?project=1&table=formation_steps&id=${id}`;
    const own = await call(env, FOUNDER, 'GET', path);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(own.body.evidence.map((e: any) => [e.kind, e.label]), [['decision', 'Recorded Proceed']]);
    assert.equal(own.body.accepted.status, 'accepted');
    assert.equal(own.body.decision.decision, 'proceed');
    assert.equal(own.body.sent.recorded, false);
    assert.equal(own.body.sent.reason, NOT_SENT_YET);
    assert.deepEqual(own.body.came_back.map((b: any) => [b.source, b.kind]), [['github', 'issue']]);
    assert.equal((await call(env, ADMIN, 'GET', path)).body.decision.decision, 'proceed', 'an admin reads the decision');
    const partner = await call(env, PARTNER, 'GET', path);
    assert.equal(partner.status, 200);
    assert.equal('decision' in partner.body, false, 'a partner never reads the decision');
    assert.deepEqual(partner.body.evidence, [], 'nor the decision as evidence');
    assert.doesNotMatch(JSON.stringify(partner.body), /proceed|Private reasoning/i);
    assert.equal((await call(env, OUTSIDER, 'GET', path)).status, 404);
    assert.equal((await call(env, OTHER, 'GET', path)).status, 404);
    assert.equal((await call(env, OTHER, 'GET', `/api/cycles/build/evidence?project=2&table=formation_steps&id=${id}`)).status, 404, 'another venture\'s row, even to its own founder');
    assert.equal((await call(env, FOUNDER, 'GET', `/api/cycles/build/evidence?project=1&table=users&id=1`)).status, 400);
    assert.equal((await call(env, null, 'GET', path)).status, 401);
    db.exec('DROP TABLE build_evidence_links');
    assert.equal((await call(env, FOUNDER, 'GET', path)).status, 503, 'an unreadable store is not an empty trail');
  } finally { db.close(); }
});
