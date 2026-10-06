/**
 * D576 (#1189) — a founder's tech-transfer answer re-sequences their Spin-Out
 * Lab Week 1: the rule table (one ordering per stored status), the recompute
 * before and after Week 1 starts, the store (migration 396), the actor on
 * every write, and who can read a plan.
 *
 * The routes run through the real routers on real `node:sqlite`, built from
 * `schema_baseline.sql` plus migrations 315, 316 and 396 from their own files
 * (the harness is D383's), so this also proves 396 runs on the production
 * schema.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import spinoutLab from '../src/routes/spinout_lab.ts';
import adminCohort from '../src/routes/admin_cohort.ts';
import { TTO_STATUSES } from '../src/services/applicationLifecycle.ts';
import { MILESTONES, OPTIONAL_MILESTONES } from '../src/services/spinoutLabCatalog.ts';
import { RULES, RULE_KEYS, WEEK1_KEYS, planSteps, planView, ruleFor, parseSteps } from '../src/services/week1Plan.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN_ID = 900;
const FOUNDER_ID = 117;
const INVESTOR_ID = 118;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const M315 = read('cloudflare-worker/sql/migrations/315_spinout_application_lifecycle.sql');
const M316 = read('cloudflare-worker/sql/migrations/316_spinout_application_interviews.sql');
const M396 = read('cloudflare-worker/sql/migrations/396_spinout_week1_plans.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const TABLES = ['users', 'user_spinout_flags', 'spinout_applications', 'spinout_lab_milestones',
  'cohort_cycles', 'cohort_applicants', 'cohort_cycle_events', 'cohort_app_notification_ledger',
  'activity_logs', 'admin_audit_log', 'week_windows'];

function freshDb({ migrate = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  db.exec(M315); db.exec(M316);
  if (migrate) db.exec(M396);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(ADMIN_ID, 'admin', 'Admin One', 'admin@example.test');
  u.run(FOUNDER_ID, 'founder', 'Ada Founder', 'ada@example.test');
  u.run(INVESTOR_ID, 'investor', 'Ivy Investor', 'ivy@example.test');
  return db;
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = x; return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // Real D1 runs a batch as one transaction; so does this.
    async batch(list: any[]) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

/**
 * `app.onError` lives in index.ts and is not in the chain for a directly
 * dispatched sub-app, so the auth refusals are mapped here as index.ts maps
 * them; anything else surfaces as the 500 it would be.
 */
const wrapped = new Map<any, any>();
function appFor(router: any) {
  if (!wrapped.has(router)) {
    const a = new Hono<any>();
    a.route('/', router);
    a.onError((err: any, c) => {
      const msg = String(err?.message || '');
      if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
      if (msg === 'Admin required') return c.json({ detail: msg }, 403);
      return c.json({ detail: msg }, 500);
    });
    wrapped.set(router, a);
  }
  return wrapped.get(router);
}

async function call(router: any, db: InstanceType<typeof DatabaseSync>, path: string, init: RequestInit = {}, as = FOUNDER_ID) {
  const role = as === ADMIN_ID ? 'admin' : as === INVESTOR_ID ? 'investor' : 'founder';
  const jwt = await new SignJWT({ user_id: as, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await appFor(router).fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db), APP_URL: 'https://example.test' } as any,
  );
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}
const lab = (db: any, path: string, init?: RequestInit, as?: number) => call(spinoutLab, db, path, init, as);
const admin = (db: any, path: string, init?: RequestInit) => call(adminCohort, db, path, init, ADMIN_ID);
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

const I = (n: number) => `customer_interview_logged_${n}`;
const BASICS = { company_name: 'Test Robotics', idea: 'Warehouse picking arms', incorporated: 'no', stage: 'Idea / pre-formation' };
const answers = (tto_status: string | null, origin = 'university') => ({
  origin, institution: 'Example University', research_group: 'Robotics Lab', tto_status, ip: [],
  team_size: 3, team_roles: 'Two researchers', commercial_lead: false, traction: '', why_axal: 'The cohort.',
});
const apply = (db: any, tto: string | null, origin = 'university') =>
  lab(db, '/apply', json('POST', { ...BASICS, answers: answers(tto, origin) }));
const planRow = (db: any) => db.prepare(`SELECT * FROM spinout_week1_plans WHERE user_id = ?`).get(FOUNDER_ID) as any;
const history = (db: any) => db.prepare(`SELECT * FROM spinout_week1_plan_history WHERE user_id = ? ORDER BY id`).all(FOUNDER_ID) as any[];

// ---------------------------------------------------------------------------
// The rules: one per status the application stores.
// ---------------------------------------------------------------------------

test('D576: the Week 1 steps are the catalog\'s, and every rule orders all of them, each once', () => {
  const w1 = MILESTONES.find((w) => w.week === 1)!;
  assert.deepEqual(WEEK1_KEYS, [...w1.requiredAll, ...OPTIONAL_MILESTONES[1]]);
  assert.equal(WEEK1_KEYS.length, 10);
  assert.deepEqual([...RULE_KEYS].sort(), [...TTO_STATUSES, 'independent', 'not_recorded'].sort(),
    'the rules are the stored statuses plus independent and no answer');
  for (const k of RULE_KEYS) {
    assert.deepEqual([...RULES[k].order].sort(), [...WEEK1_KEYS].sort(), `${k} adds or drops a step`);
    assert.ok(RULES[k].label && RULES[k].why, `${k} has no label or reason`);
  }
});

test('D576 rule: not yet disclosed — customer and market first, research shared last', () => {
  assert.equal(ruleFor({ origin: 'university', tto_status: 'not_disclosed' }), 'not_disclosed');
  assert.deepEqual(RULES.not_disclosed.order, ['project_created', 'icp_defined', 'market_sizing_completed', I(1), I(2), I(3),
    'profiling_completed', I(4), I(5), 'market_research_shared']);
});

test('D576 rule: disclosed — interviews first', () => {
  assert.equal(ruleFor({ origin: 'university', tto_status: 'disclosed' }), 'disclosed');
  assert.deepEqual(RULES.disclosed.order, ['project_created', I(1), I(2), I(3), 'icp_defined', 'market_sizing_completed',
    'profiling_completed', I(4), I(5), 'market_research_shared']);
});

test('D576 rule: negotiating — the market sized before anything else', () => {
  assert.equal(ruleFor({ origin: 'corporate', tto_status: 'negotiating' }), 'negotiating');
  assert.deepEqual(RULES.negotiating.order, ['project_created', 'market_sizing_completed', 'icp_defined', I(1), I(2), I(3), I(4), I(5),
    'profiling_completed', 'market_research_shared']);
});

test('D576 rule: signed — every interview first', () => {
  assert.equal(ruleFor({ origin: 'university', tto_status: 'signed' }), 'signed');
  assert.deepEqual(RULES.signed.order, ['project_created', I(1), I(2), I(3), I(4), I(5), 'icp_defined', 'market_sizing_completed',
    'profiling_completed', 'market_research_shared']);
});

test('D576 rule: no transfer office, an independent build and no answer keep the standard order', () => {
  assert.equal(ruleFor({ origin: 'corporate', tto_status: 'not_applicable' }), 'not_applicable');
  assert.equal(ruleFor({ origin: 'independent', tto_status: 'signed' }), 'independent', 'an independent build is asked no TTO question');
  assert.equal(ruleFor(null), 'not_recorded');
  assert.equal(ruleFor({ origin: 'university', tto_status: null }), 'not_recorded');
  for (const k of ['not_applicable', 'independent', 'not_recorded'] as const) assert.deepEqual([...RULES[k].order], [...WEEK1_KEYS]);
});

// ---------------------------------------------------------------------------
// The recompute.
// ---------------------------------------------------------------------------

test('D576 recompute: before Week 1 starts the plan is the new rule\'s order', () => {
  assert.deepEqual(planSteps('signed', { started: false, done: ['project_created', 'icp_defined'], previous: RULES.not_disclosed.order }),
    [...RULES.signed.order]);
});

test('D576 recompute: after Week 1 starts, done steps keep their places and the rest follow the new rule', () => {
  const previous = RULES.not_disclosed.order;
  const steps = planSteps('signed', { started: true, done: ['project_created', 'icp_defined', I(2)], previous });
  assert.deepEqual(steps.slice(0, 3), ['project_created', 'icp_defined', I(2)], 'the done steps, in the previous plan\'s order');
  assert.deepEqual(steps.slice(3), [I(1), I(3), I(4), I(5), 'market_sizing_completed', 'profiling_completed', 'market_research_shared']);
  assert.deepEqual([...steps].sort(), [...WEEK1_KEYS].sort());
  const fresh = planSteps('negotiating', { started: true, done: [I(1)], previous: null });
  assert.equal(fresh[0], I(1), 'with no previous plan, a done step still leads');
});

test('D576: a stored plan that is not a list of Week 1 keys is not shown as one', () => {
  assert.equal(parseSteps('["project_created","week2_thing"]'), null);
  assert.equal(parseSteps('nope'), null);
  assert.equal(planView({ user_id: 1, rule_key: 'made_up', steps_json: JSON.stringify(WEEK1_KEYS), started: 0,
    computed_by: 'user:1', created_at: 'x', updated_at: 'x' }), null);
});

// ---------------------------------------------------------------------------
// The store and the routes.
// ---------------------------------------------------------------------------

test('D576 migration: 396 runs on the production schema and holds one plan per member', () => {
  const db = freshDb();
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  assert.deepEqual(cols('spinout_week1_plans'),
    ['user_id', 'application_id', 'rule_key', 'steps_json', 'started', 'computed_by', 'created_at', 'updated_at']);
  assert.ok(cols('spinout_week1_plan_history').includes('actor'));
  db.exec(M396);
  assert.ok(true, 'applying 396 twice is harmless');
});

test('D576: saving the answer computes the plan, records the actor, and /state sends it', async () => {
  const db = freshDb();
  const r = await apply(db, 'negotiating');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = planRow(db);
  assert.deepEqual([row.rule_key, JSON.parse(row.steps_json), row.started, row.computed_by],
    ['negotiating', [...RULES.negotiating.order], 0, `user:${FOUNDER_ID}`]);
  assert.deepEqual(history(db).map((h) => [h.reason, h.actor, h.rule_key]), [['applied', `user:${FOUNDER_ID}`, 'negotiating']]);
  const s = await lab(db, '/state');
  assert.equal(s.body.week1_plan.rule, 'negotiating');
  assert.equal(s.body.week1_plan.label, 'Licence under negotiation');
  assert.deepEqual(s.body.week1_plan.steps, [...RULES.negotiating.order]);
  assert.equal(s.body.week1_plan_unreadable, false);
});

test('D576: a changed answer before Week 1 starts recomputes the plan', async () => {
  const db = freshDb();
  await apply(db, 'not_disclosed');
  await lab(db, '/apply/withdraw', json('POST'));
  const r = await apply(db, 'signed');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([planRow(db).rule_key, JSON.parse(planRow(db).steps_json)], ['signed', [...RULES.signed.order]]);
  assert.deepEqual(history(db).map((h) => h.rule_key), ['not_disclosed', 'signed'], 'the replaced plan is kept in the history');
});

test('D576: after Week 1 starts, a changed answer keeps the done steps in place', async () => {
  const db = freshDb();
  await apply(db, 'not_disclosed');
  db.prepare(`UPDATE users SET spinout_lab_active = 1, spinout_lab_week = 1, spinout_lab_started_at = datetime('now') WHERE id = ?`).run(FOUNDER_ID);
  const m = db.prepare(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key) VALUES (?, 1, ?)`);
  m.run(FOUNDER_ID, 'project_created');
  m.run(FOUNDER_ID, 'icp_defined');
  // A new answer reaches the store the way /apply writes one.
  db.prepare(`UPDATE spinout_applications SET status = 'refused' WHERE user_id = ?`).run(FOUNDER_ID);
  const r = await apply(db, 'signed');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const steps = JSON.parse(planRow(db).steps_json);
  assert.deepEqual(steps.slice(0, 2), ['project_created', 'icp_defined']);
  assert.deepEqual(steps.slice(2), [I(1), I(2), I(3), I(4), I(5), 'market_sizing_completed', 'profiling_completed', 'market_research_shared']);
  assert.equal(planRow(db).started, 1);
});

test('D576: Week 1 starting computes a plan only when none is stored', async () => {
  const db = freshDb();
  // An application from before this change: no plan stored.
  db.prepare(`INSERT INTO spinout_applications (user_id, company_name, idea, cohort, status, answers_json) VALUES (?, 'Co', 'Idea', 'C', 'accepted', ?)`)
    .run(FOUNDER_ID, JSON.stringify(answers('disclosed')));
  const s = await lab(db, '/start', json('POST'));
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual([planRow(db).rule_key, planRow(db).computed_by], ['disclosed', `user:${FOUNDER_ID}`]);
  assert.deepEqual(history(db).map((h) => h.reason), ['started']);
  await lab(db, '/start', json('POST'));
  assert.equal(history(db).length, 1, 'starting again writes nothing');
});

test('D576 access: the plan reaches only its member and an admin; a founder cannot list applicants', async () => {
  const db = freshDb();
  await apply(db, 'signed');
  const other = await lab(db, '/state', undefined, INVESTOR_ID);
  assert.equal(other.body.week1_plan, null, 'another account\'s /state carries no one else\'s plan');
  const refused = await call(adminCohort, db, '/applications', {}, FOUNDER_ID);
  assert.equal(refused.status, 403);
  assert.equal(JSON.stringify(refused.body).includes('steps'), false);
  const l = await admin(db, '/applications');
  assert.equal(l.status, 200);
  const a = l.body.cycles.flatMap((c: any) => c.applicants).find((x: any) => x.user_id === FOUNDER_ID);
  assert.deepEqual([a.week1_plan.rule, a.week1_plan.computed_by, a.week1_plan_unreadable], ['signed', `user:${FOUNDER_ID}`, false]);
});

test('D576: on a database without 396, the plan is Unreadable, never the standard order', async () => {
  const db = freshDb({ migrate: false });
  const r = await apply(db, 'signed');
  assert.equal(r.status, 200, 'a plan that cannot be written never refuses the application');
  const s = await lab(db, '/state');
  assert.deepEqual([s.body.week1_plan, s.body.week1_plan_unreadable], [null, true]);
});
