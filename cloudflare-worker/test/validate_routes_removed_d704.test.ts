/**
 * D704 (#1666) — Validate's Interviews, Pain map and Hypotheses pages become
 * their modules. PR 1 (this part): the spend history follows them.
 *
 * Runs already recorded on an old page path are never rewritten. The two spend
 * reads count them under the module that holds the feature now
 * (`AI_SURFACE_ALIASES`): the per-page figure of `GET /api/ai/me/spend?surface=`
 * and `/account/usage`'s By page breakdown (`by_surface`). Each counts the
 * caller's own rows only. A read of an old path itself still counts only that
 * path's rows.
 *
 * `ai_usage_logs` is the baseline's DDL plus migration 319's `surface` column,
 * so the fixture runs the migration's own SQL rather than a hand-typed copy.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_routes_removed_d704.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { makeD1, d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';
import cycleValidate from '../src/routes/cycle_validate.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { AI_SURFACE, AI_SURFACE_ALIASES } from '../src/services/aiSurfaces.ts';
import { normaliseSurface } from '../src/services/aiRouter.ts';
import { loadMyAiSpend } from '../src/services/aiSpend.ts';
import ai from '../src/routes/ai.ts';
import { createJWT } from '../src/auth.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SCHEMA = `${tableFromBaseline(read('cloudflare-worker/sql/schema_baseline.sql'), 'ai_usage_logs')}
${read('cloudflare-worker/sql/migrations/319_ai_usage_surface.sql')}`;

const OLD_TO_MODULE: Array<[string, string]> = [
  ['/validate/interviews', '/validate/customer-research'],
  ['/validate/pain-map', '/validate/problem-discovery'],
  ['/validate/hypotheses', '/validate/experiments'],
];

// ── 9 (PR 1). The alias ─────────────────────────────────────────────────────

test('9. AI_SURFACE_ALIASES is frozen and maps exactly the three retired pages to their modules', () => {
  assert.equal(Object.isFrozen(AI_SURFACE_ALIASES), true);
  assert.deepEqual(Object.entries(AI_SURFACE_ALIASES), OLD_TO_MODULE);
  for (const [, target] of OLD_TO_MODULE) {
    assert.equal(normaliseSurface(target), target, `${target} is not a path the router records unchanged`);
  }
  // Decision 8: the value moves in PR 2, with the redirects and D552.md.
  assert.equal(AI_SURFACE.validateInterviews, '/validate/interviews');
});

// ── 10. Spend alias, own rows only ──────────────────────────────────────────

const A = 21;
const B = 22;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
/** 'YYYY-MM-DD HH:MM:SS', `seconds` before now: the route reads the wall clock. */
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
const LAST_MONTH = (() => {
  const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); d.setUTCHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
})();

/** For one old page and its module: A's runs on both, B's on the old page. */
function seedFor(old: string, mod: string) {
  return `
INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at, surface) VALUES
  (${A}, 'transcribe',        'm-old',      0.0030, '${ago(60)}',   '${old}'),
  (${A}, 'transcribe',        'm-old-past', 0.5000, '${LAST_MONTH}', '${old}'),
  (${A}, 'workspace_explain', 'm-module',   0.0020, '${ago(30)}',   '${mod}'),
  (${A}, 'workspace_explain', 'm-other',    0.0040, '${ago(90)}',   '/build/board'),
  (${B}, 'transcribe',        'm-theirs',   9.0000, '${ago(10)}',   '${old}');`;
}

/** A real SQLite `ai_usage_logs`, and a stub session for `requireAuth`, as ai_surface_d552 does. */
function routeEnv(userId: number, seed: string) {
  const { DB } = makeD1(SCHEMA, seed);
  const stub = (q: string) => {
    const api: any = {
      bind: () => api,
      first: async () => (/FROM user_sessions/i.test(q) ? { revoked_at: null, step_up_due_at: null } : null),
      all: async () => ({
        results: /FROM\s+users/i.test(q)
          ? [{ id: userId, email: `u${userId}@example.test`, role: 'founder', is_active: 1, name: 'U' }]
          : [],
      }),
      run: async () => ({ meta: { changes: 0 } }),
    };
    return api;
  };
  return {
    JWT_SECRET,
    DB: {
      prepare: (q: string) => (/ai_usage_logs/.test(q) ? DB.prepare(q) : stub(q)),
      exec: async () => ({ count: 0, duration: 0 }),
    },
  } as any;
}

async function spendOf(userId: number, surface: string, seed: string) {
  const env = routeEnv(userId, seed);
  const token = await createJWT(env, userId, `u${userId}@example.test`, 'founder', undefined, `jti-${userId}`);
  const res = await ai.request(`/me/spend?surface=${encodeURIComponent(surface)}`, { headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200, surface);
  return res.json() as Promise<any>;
}

for (const [old, mod] of OLD_TO_MODULE) {
  test(`10. ${mod} counts the caller's runs on ${old}, this month, and only the caller's`, async () => {
    const seed = seedFor(old, mod);
    const a = await spendOf(A, mod, seed);
    assert.equal(a.recorded, true);
    assert.equal(a.month.calls, 2, 'A\'s two this-month runs: the old page\'s and the module\'s');
    assert.equal(Number(a.month.spend_usd.toFixed(4)), 0.005);
    assert.equal(a.last_run.model, 'm-module', 'the newer of the two is the last run');

    const b = await spendOf(B, mod, seed);
    assert.equal(b.month.calls, 1, 'B counts B\'s own old-page run only');
    assert.equal(b.last_run.model, 'm-theirs');

    const oldItself = await spendOf(A, old, seed);
    assert.equal(oldItself.month.calls, 1, 'a read of the old path counts that path only, not the module');
    assert.equal(oldItself.last_run.model, 'm-old');
  });

  test(`10. /account/usage's By page folds ${old} into ${mod}, and still adds up to the month`, async () => {
    const { DB } = makeD1(SCHEMA, seedFor(old, mod));
    const r = await loadMyAiSpend({ DB } as any, { id: A, role: 'founder' }, new Date());
    assert.equal(r.by_surface_recorded, true);
    const by = new Map(r.by_surface.map((s) => [s.surface, s]));
    assert.equal(by.has(old), false, 'the retired page keeps its own entry');
    assert.equal(by.get(mod)?.calls, 2);
    assert.equal(Number(by.get(mod)!.spend_usd.toFixed(4)), 0.005);
    // The query orders board ($0.004), old page ($0.003), module ($0.002); folded, the module ($0.005) leads.
    assert.deepEqual(r.by_surface.map((s) => s.surface), [mod, '/build/board'], 're-sorted by spend after the fold');
    const sum = r.by_surface.reduce((s, x) => s + x.spend_usd, 0);
    assert.equal(Number(sum.toFixed(4)), Number(r.month.spend_usd!.toFixed(4)), 'the breakdown does not add up to the month');
  });
}

test('10. the reads bind the alias: no value is interpolated into SQL', () => {
  const src = read('cloudflare-worker/src/services/aiSpend.ts');
  assert.equal((src.match(/u\.surface IN \(\?, \?\)/g) || []).length, 2, 'the month sum and the last run');
  assert.match(src, /\.bind\(\.\.\.scope\.binds, surface, also, mKey\)/);
  assert.match(src, /\.bind\(\.\.\.scope\.binds, surface, also, asAt\)/);
  assert.doesNotMatch(read('cloudflare-worker/src/services/aiRouter.ts'), /AI_SURFACE_ALIASES/, 'the router records the path it is given');
});

// ── 11 and 13: a Validate venture on real SQLite ──────────────────────────
// The baseline's tables with migrations 255, 311, 438, 440, 447, 453 and 459,
// as `validate_lists_d690.test.ts` builds them. Every name is made up.

const V_KEY = ['fixture', 'key', 'for', 'd704', 'history'].join('-');
const V_FOUNDER = 10;
const V_A = 1;
const V_B = 2;
const sqlOf = (file: string) => read(`cloudflare-worker/sql/migrations/${file}`);

function venture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of [
    'users', 'projects', 'activity_logs', 'discovery_interviews', 'interview_pain_severities', 'pain_groups',
    'pain_group_aliases', 'hypotheses', 'hypothesis_pain_links', 'waitlist_signups', 'metric_targets',
    'competitor_analyses', 'competitor_candidates', 'competitor_sources', 'competitor_signals', 'validate_proposals',
    'mvp_features', 'roadmap_okrs',
  ]) db.exec(tableFromBaseline(baseline, t));
  db.exec('ALTER TABLE projects ADD COLUMN icp_definition_meta TEXT');
  db.exec(sqlOf('255_hypothesis_verdict_history.sql'));
  db.exec(sqlOf('311_revenue_entries.sql').replace(/REFERENCES documents\(id\)/, ''));
  for (const m of ['440_validate_cycle_stores.sql', '438_interview_sessions.sql', '447_assistant_interviews.sql',
    '453_interview_processing.sql', '459_cycle_activity_convention.sql']) db.exec(sqlOf(m));
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_active) VALUES (?, 'founder', 'Juniper Lane', 'juniper@example.test', 1, 1001, 0)").run(V_FOUNDER);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${V_A}, 'Orchard Ops', 1001), (${V_B}, 'Quill Freight', 1001)`);
  return db;
}

async function readValidate(db: DatabaseSync, path: string, wrap: (d: any) => any = (d) => d) {
  const app = new Hono<any>();
  app.route('/api/cycles/validate', cycleValidate);
  app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
  const token = await new SignJWT({ user_id: V_FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(V_KEY));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(`/api/cycles/validate${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { DB: wrap(d1Over(db)), JWT_SECRET: V_KEY, ENVIRONMENT: 'development' } as any);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const experiments = (db: DatabaseSync, query = '', pid = V_A, wrap?: (d: any) => any) => readValidate(db, `/modules/experiments?project=${pid}${query}`, wrap);

let vSeq = 0;
function vInterview(db: DatabaseSync, pid: number, pains: string[], fit: string | null = 'strong', name?: string) {
  vSeq += 1;
  const r = db.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interview_date, pains_json, icp_fit)
     VALUES (?, ?, date('now'), ?, ?) RETURNING id`,
  ).get(pid, name ?? `Ada Quill ${vSeq}`, JSON.stringify(pains), fit) as any;
  return Number(r.id);
}
function vGroup(db: DatabaseSync, pid: number, id: number, title: string, phrase: string) {
  db.prepare('INSERT INTO pain_groups (id, project_id, title) VALUES (?, ?, ?)').run(id, pid, title);
  db.prepare('INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (?, ?, ?, ?)').run(pid, id, phrase.toLowerCase(), phrase);
}
function vClaim(db: DatabaseSync, pid: number, id: number, code: string, claim = `Claim ${code}`) {
  db.prepare('INSERT INTO hypotheses (id, project_id, code, claim, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, pid, code, claim, id);
}
const historyRows = (db: DatabaseSync, pid = V_A) =>
  db.prepare('SELECT hypothesis_id, verdict, lane FROM hypothesis_verdict_history WHERE project_id = ? ORDER BY id').all(pid).map((r: any) => ({ ...r })) as any[];

// ── 11. Review focus ──────────────────────────────────────────────────────

test('11. the review focus opens the interview\'s record on its session, and no overview link starts with an old page path', async () => {
  const db = venture();
  const iv = vInterview(db, V_A, ['slow dispatch'], 'strong', 'Robin Reyes');
  const session = Number((db.prepare(
    "INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status) VALUES ('s-1', ?, ?, ?, 'in_person', 'transcribed') RETURNING id",
  ).get(iv, V_A, V_FOUNDER) as any).id);
  const r = await readValidate(db, `/overview?project=${V_A}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.focus.rule, 'review');
  assert.deepEqual(r.body.focus.cta, { label: 'Review the interview', href: `/validate/customer-research/${iv}?session=${session}` });
  const OLD = /^\/validate\/(interviews|pain-map|hypotheses)(?=$|[/?#])/;
  const hrefs = [r.body.focus?.cta?.href, ...(Array.isArray(r.body.index) ? r.body.index.map((x: any) => x.href) : []),
    ...r.body.cards.map((c: any) => c.next?.href)].filter(Boolean);
  for (const href of hrefs) assert.doesNotMatch(href, OLD, href);
  // The services that build any cycle's focus, index or card next name no old page in code.
  for (const f of ['validateFocus.ts', 'cycleFocus.ts', 'cycleValidate.ts', 'cycleCards.ts']) {
    assert.doesNotMatch(codeOnly(read(`cloudflare-worker/src/services/${f}`)), /['"`]\/validate\/(interviews|pain-map|hypotheses)\b/, f);
  }
});

// ── 13. History written by the module read ────────────────────────────────

function supported(db: DatabaseSync, pid: number, n: number) {
  for (let i = 0; i < n; i += 1) vInterview(db, pid, ['slow dispatch']);
}

test('13. a claim whose evidence changes gets one history row on the next Experiments read, and none on an unchanged re-read', async () => {
  const db = venture();
  vGroup(db, V_A, 400, 'Dispatch', 'slow dispatch');
  vClaim(db, V_A, 1, 'H1', 'Fleets pay for dispatch');
  db.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 400, 'supports')");
  assert.equal((await experiments(db)).status, 200);
  assert.deepEqual(historyRows(db), [{ hypothesis_id: 1, verdict: 'unproven', lane: 'none' }], 'the first read records the claim');
  await experiments(db);
  assert.equal(historyRows(db).length, 1, 'an unchanged re-read writes nothing');
  vInterview(db, V_A, ['slow dispatch']);
  await experiments(db);
  assert.deepEqual(historyRows(db).at(-1), { hypothesis_id: 1, verdict: 'unproven', lane: 'testing' });
  assert.equal(historyRows(db).length, 2, 'one row for the change');
  await experiments(db);
  assert.equal(historyRows(db).length, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get() as any).n, 0, 'no activity row is logged');
});

test('13. a read with a search, a filter or a later page still records every live claim, and never another venture\'s', async () => {
  for (const q of ['&q=nothing-matches', '&filter=status:supported', '&page=2', '&filter=moved:recent', '&filter=status:retired']) {
    const db = venture();
    for (let i = 1; i <= 3; i += 1) vClaim(db, V_A, i, `H${i}`);
    vClaim(db, V_B, 9, 'H9');
    db.exec("UPDATE hypotheses SET retired_at = '2026-09-01 10:00:00' WHERE id = 3");
    const r = await experiments(db, q);
    assert.equal(r.status, 200, q);
    assert.deepEqual(historyRows(db).map((x) => x.hypothesis_id), [1, 2], `${q}: every live claim, before search, filters and paging`);
    assert.deepEqual(historyRows(db, V_B), [], `${q}: venture B is not written`);
  }
});

test('13. the read records before it reads the history: a claim Supported now is listed by that read\'s Changed this month', async () => {
  const db = venture();
  vGroup(db, V_A, 400, 'Dispatch', 'slow dispatch');
  vClaim(db, V_A, 1, 'H1');
  db.exec("INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (1, 400, 'supports')");
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  // Observed at Testing earlier this month (or at the month's first second, on the 1st).
  const earlier = new Date(Math.max(monthStart, Date.now() - 3_600_000)).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare("INSERT INTO hypothesis_verdict_history (project_id, hypothesis_id, verdict, lane, observed_at) VALUES (?, 1, 'unproven', 'testing', ?)").run(V_A, earlier);
  supported(db, V_A, 5);
  const r = await experiments(db, '&filter=history:this_month');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.records.rows.map((x: any) => x.id), [1], 'the change this read wrote is in its own view');
  assert.equal(r.body.records.rows[0].status, 'supported');
  // A venture's first read with a live claim sends a history start.
  const fresh = venture();
  vClaim(fresh, V_A, 1, 'H1');
  const first = await experiments(fresh);
  assert.match(String(first.body.parts.stats.history_since), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('13. a failing history write still returns the records', async () => {
  const db = venture();
  vClaim(db, V_A, 1, 'H1', 'Fleets pay for dispatch');
  // The writer's own first query throws, so `recordVerdictChanges` itself rejects.
  const failing = (d: any) => ({ ...d, prepare: (sql: string) => {
    if (/JOIN \(SELECT hypothesis_id, MAX\(id\) AS id/.test(sql)) throw new Error('history unavailable');
    return d.prepare(sql);
  } });
  const r = await experiments(db, '', V_A, failing);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.records.rows.map((x: any) => x.id), [1]);
  assert.deepEqual(historyRows(db), []);
});
