/**
 * D4536 part 4 (#4536) — the HQ library read's `executions` block: completed runs per skill and executed version.
 *
 * What is held:
 *   - a run is a skill-tagged parent usage row (`guard_for IS NULL`); guard rows, untagged rows (evaluation runs) and
 *     rows outside the window are not runs;
 *   - tokens and charge cover the parent and its guard rows; a NULL charge is `unrecorded`, a run whose event names an
 *     earlier account attempt is `incomplete`, and neither is summed, so the total is never an estimate;
 *   - cost per completed run is over the fully recorded runs only, else `{ available: false }`;
 *   - p50 and p95 of the model call's latency are nearest-rank, over rows with a latency;
 *   - the path is scheduled when an `agent_task_runs` row names the usage row, else manual;
 *   - a company skill's runs are counted by scope only; outcome rates, run latency and workflows are unavailable;
 *   - adoption (pins) is not usage: a pinned skill with no completed run is named as such;
 *   - an unreadable history is `{ available: false }`, never zeros; #3851's proposal board is not read.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/skill_executions_4536.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { mount } from '../src/routes/admin_hq_skills.ts';
import { CATALOGUE } from '../src/services/ai/catalogue.ts';
import { MODEL_CONNECTIONS } from '../src/services/ai/moduleConnections.ts';
import {
  EXECUTION_LATENCY_SQL, EXECUTIONS_DEFAULT_DAYS, EXECUTIONS_SQL, executionsWindow, skillExecutions, type ExecutionRow,
} from '../src/services/agents/skillExecutions.ts';
import { parseSkillFilters } from '../src/services/agents/skillCoverage.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
const SUPER = 1, EDITOR = 10;
const HQ = '/api/admin/ai-agents/skills';
const [M1, M2] = CATALOGUE.filter((m) => MODEL_CONNECTIONS[m.id]?.operation === 'chat').map((m) => m.id);
const UID_A = 'a'.repeat(32), UID_B = 'b'.repeat(32), UID_C = 'c'.repeat(32);

// ── The pure block ───────────────────────────────────────────────────────────

const CATEGORY = new Map([['investor_reporting', 'finance_ops']]);
const WINDOW = { since: '2026-11-01 00:00:00', until: '2026-11-21 00:00:00', days: 20, source: 'filter' as const };
const row = (o: Partial<ExecutionRow> = {}): ExecutionRow => ({
  skill_id: 1, scope: 'hq', status: 'published', current_version: 2, uid: UID_A,
  published_roles_json: JSON.stringify(['cfo']), published_tags_json: JSON.stringify([{ slug: 'investor_reporting', level: 'proficient' }]),
  version: 2, model: 'm-1', role_key: 'cfo', scheduled: 0,
  completed: 1, tokens: 100, charge_recorded: 1, charge_unrecorded: 0, charge_incomplete: 0, charge_microusd: 300, ...o,
});
const block = (rows: ExecutionRow[], o: { filters?: any; published?: any[] } = {}) =>
  skillExecutions(rows, [], { filters: o.filters ?? null, category: CATEGORY, window: WINDOW, published: o.published ?? [] });

test('D4536-p4: counts completed runs per skill, version, model, role and path; the charge is the recorded runs only', () => {
  const e = block([
    row({ completed: 3, tokens: 900, charge_recorded: 2, charge_unrecorded: 1, charge_microusd: 1000 }),
    row({ version: 1, model: 'm-2', scheduled: 1, completed: 2, tokens: 50, charge_recorded: 1, charge_incomplete: 1, charge_microusd: 7 }),
  ]);
  assert.equal(e.available, true);
  assert.equal(e.counts, 'completed_runs');
  // Mutation checked: summing charge_unrecorded or charge_incomplete runs into runs_recorded changes these.
  assert.deepEqual(e.totals.charge, { microusd: 1007, runs_recorded: 3, runs_unrecorded: 1, runs_incomplete: 1 });
  assert.equal(e.totals.completed, 5);
  assert.equal(e.totals.tokens, 950);
  assert.equal(e.totals.cost_per_completed_microusd, 336, 'round(1007 / 3): over fully recorded runs, never over all 5');
  assert.deepEqual(e.totals.by_path, { scheduled: 2, manual: 3 });
  const [s] = e.skills;
  assert.equal(s.skill_uid, UID_A);
  assert.deepEqual(s.by_model, { 'm-1': 3, 'm-2': 2 });
  assert.deepEqual(s.by_role, { cfo: 5 });
  assert.deepEqual(s.by_version.map((v) => [v.version, v.completed, v.cost_per_completed_microusd]), [[2, 3, 500], [1, 2, 7]]);
});

test('D4536-p4: no recorded charge is "not recorded", never a cost of 0; an observed zero charge is 0', () => {
  const none = block([row({ charge_recorded: 0, charge_unrecorded: 1, charge_microusd: 0 })]);
  assert.equal((none.totals.cost_per_completed_microusd as any).available, false);
  const zero = block([row({ charge_microusd: 0 })]);
  assert.equal(zero.totals.cost_per_completed_microusd, 0, 'a recorded 0 is an observed zero');
  const empty = block([]);
  assert.equal(empty.totals.completed, 0, 'no run in the window is an observed 0 of completed runs');
  assert.equal((empty.totals.model_latency_ms as any).available, false);
});

test('D4536-p4: rates, run latency and workflows are unavailable; a company skill is counted by scope only', () => {
  const e = block([row(), row({ scope: 'company', uid: null, skill_id: 9, published_roles_json: null, published_tags_json: null, completed: 4 })]);
  for (const m of [e.outcomes, e.run_latency, e.workflows]) assert.equal((m as any).available, false);
  assert.match((e.outcomes as any).reason, /no skill/);
  assert.match((e.workflows as any).reason, /#4535/);
  assert.deepEqual(e.by_scope, { hq: { completed: 1 }, company: { completed: 4 } });
  assert.equal(e.totals.completed, 1, 'totals are HQ skills only');
  assert.deepEqual(e.skills.map((s) => s.skill_uid), [UID_A], 'no company skill is listed');
});

test('D4536-p4: filters keep skills by their current version, and `version` keeps the EXECUTED version', () => {
  const parsed = (q: Record<string, string>) => {
    const p = parseSkillFilters(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, [v]])), {
      categories: ['finance_ops', 'engineering'], tags: CATEGORY, roleKeys: ['cfo', 'cto'], modelIds: ['m-1'], allowed: [],
    });
    assert.ok(p.ok);
    return p.filters;
  };
  const rows = [row(), row({ version: 1, completed: 2 }), row({ skill_id: 2, uid: UID_B, published_roles_json: JSON.stringify(['cto']), completed: 5 })];
  const cfo = block(rows, { filters: parsed({ role: 'cfo' }) });
  assert.deepEqual(cfo.skills.map((s) => [s.skill_uid, s.completed]), [[UID_A, 3]]);
  assert.equal((cfo.by_scope.company as any).available, false, 'a filter cannot match a company skill, so it is not a 0');
  // Mutation checked: applying matchesSkill's current-version rule to `version` would drop every v1 row and the v2 skill A.
  const v1 = block(rows, { filters: parsed({ version: '1' }) });
  assert.deepEqual(v1.skills.map((s) => [s.skill_uid, s.completed, s.by_version.map((x) => x.version)]), [[UID_A, 2, [1]]]);
});

test('D4536-p4: adoption is not usage: a published skill nobody ran is named, whatever its pins', () => {
  const e = block([row()], { published: [
    { scope: 'hq', status: 'published', uid: UID_A }, { scope: 'hq', status: 'published', uid: UID_B },
    { scope: 'hq', status: 'retired', uid: UID_C }, { scope: 'company', status: 'published', uid: null },
  ] });
  assert.deepEqual(e.published_without_completed_runs, { count: 1, skill_uids: [UID_B] });
});

test('D4536-p4: with no date filter the window is the last 30 UTC days, today included', () => {
  const w = executionsWindow(null, new Date('2026-11-20T15:00:00Z'));
  assert.deepEqual(w, { since: '2026-10-22 00:00:00', until: '2026-11-21 00:00:00', days: EXECUTIONS_DEFAULT_DAYS, source: 'default' });
});

// ── The reads, over the migrated schema ─────────────────────────────────────

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'activity_logs'].map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n')
    + AI_LOG_SCHEMA + sql('migrations/506_ai_rail_proposals.sql'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const m of ['199_super_admin.sql', '089_skills_values_taxonomy.sql', '712_team_agents.sql', '759_agent_skills.sql',
    '202611022326_agent_skill_context_tokens.sql', '202611022055_agent_skill_moderation.sql', '202611022140_hq_skill_lifecycle.sql',
    '202611090904_skill_eval_result_identity.sql', '202611081919_skill_release_evidence.sql', '202611092030_skill_version_release_note.sql',
    '202611022313_agent_skill_runs.sql', '202611090905_skill_version_eval_identity.sql', '202611062149_skill_eval_campaigns.sql']) db.exec(sql(`migrations/${m}`));
  // The engine's run table, as migration 728 creates it (its other tables are not read here).
  db.exec(sql('migrations/728_agent_engine.sql').match(/CREATE TABLE IF NOT EXISTS agent_task_runs \([\s\S]*?\n\);/)![0].replace(/REFERENCES \w+\([^)]*\)( ON DELETE CASCADE)?/g, ''));
  const user = db.prepare("INSERT INTO users (id, uid, email, name, role, founder_id, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, ?, ?, 'growth', 'active')");
  user.run(SUPER, 'u-super', 'super@example.test', 'Sue Super', 'admin', null);
  user.run(EDITOR, 'u-editor', 'editor@example.test', 'Eve Editor', 'founder', 100);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.exec(`INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-uid-1', 'Acme')`);
  db.exec(`INSERT INTO skills (slug, category_slug, label) VALUES ('investor_reporting', 'finance_ops', 'Investor reporting')`);
  const agent = db.prepare(`INSERT INTO team_agents (uid, scope_kind, company_id, role_key, first_name, model_id, tool_grants_json, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, 'company', 1, ?, 'Carla', ?, '[]', ${EDITOR}, 5000000, ${EDITOR})`);
  const cfo = Number(agent.run('9'.repeat(32), 'cfo', M1).lastInsertRowid);
  const skill = db.prepare(`INSERT INTO agent_skills (uid, scope, company_id, slug, name, purpose, output_kind, status, current_version, created_by)
    VALUES (?, ?, ?, ?, ?, 'A fixture.', 'brief', ?, ?, ${SUPER})`);
  const version = db.prepare(`INSERT INTO agent_skill_versions (skill_id, version, skill_md, name, purpose, steps_json, allowed_tools_json, output_kind, taxonomy_json, roles_json, published_by)
    VALUES (?, ?, '---', 'n', 'p', '[]', '[]', 'brief', ?, ?, ${SUPER})`);
  const fin = JSON.stringify([{ slug: 'investor_reporting', level: 'proficient' }]);
  const a = Number(skill.run(UID_A, 'hq', null, 'fixture-a', 'A', 'published', 2).lastInsertRowid);
  version.run(a, 1, fin, JSON.stringify(['cfo'])); version.run(a, 2, fin, JSON.stringify(['cfo']));
  const b = Number(skill.run(UID_B, 'hq', null, 'fixture-b', 'B', 'published', 1).lastInsertRowid);
  version.run(b, 1, fin, JSON.stringify(['cfo']));
  const co = Number(skill.run(UID_C, 'company', 1, 'acme-private', 'Acme', 'published', 1).lastInsertRowid);
  db.prepare(`INSERT INTO agent_skill_links (agent_id, skill_id, version, linked_by) VALUES (?, ?, 1, ${EDITOR})`).run(cfo, b);

  const usage = db.prepare(`INSERT INTO ai_usage_logs (user_id, task, model, latency_ms, prompt_tokens, completion_tokens, charged_microusd, guard_for, agent_id, skill_id, skill_version, created_at)
    VALUES (${EDITOR}, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const use = (o: { model?: string; latency?: number; tokens?: [number, number]; charge?: number | null; guard?: number | null; skill?: number | null; version?: number | null; at?: string }) =>
    Number(usage.run(o.model ?? M1, o.latency ?? 100, ...(o.tokens ?? [10, 5]), o.charge === undefined ? 1000 : o.charge, o.guard ?? null, cfo,
      o.skill === undefined ? a : o.skill, o.version === undefined ? 2 : o.version, o.at ?? '2026-11-10 12:00:00').lastInsertRowid);
  const event = db.prepare(`INSERT INTO team_agent_events (agent_id, actor_user_id, kind, usage_log_id, detail_json) VALUES (?, ${EDITOR}, 'run', ?, ?)`);
  const taskRun = db.prepare(`INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status, usage_log_id) VALUES (?, ?, ?, 1, 'done', ?)`);
  let n = 0;

  // A v2, manual, a guard row charged 200: one run of 15 + 15 tokens, charge 1200.
  const r1 = use({ latency: 100 }); use({ guard: r1, charge: 200, tokens: [10, 5] }); event.run(cfo, r1, JSON.stringify({ skill: { uid: UID_A, version: 2 } }));
  // A v2, scheduled (a task run names it), charge 1000.
  const r2 = use({ latency: 200 }); taskRun.run(`run-${++n}`, cfo, n, r2);
  // A v2, manual, a guard row whose charge is NULL: unrecorded.
  const r3 = use({ latency: 300 }); use({ guard: r3, charge: null });
  // A v2, manual on the account path after one failed attempt: incomplete.
  const r4 = use({ latency: 400, model: M2 }); event.run(cfo, r4, JSON.stringify({ accounts_tried: 2 }));
  // A v1, manual, no latency recorded.
  use({ version: 1, latency: 0 });
  // Not runs: an evaluation run (untagged), a run outside the window, B's usage on another day outside it.
  use({ skill: null, version: null });
  use({ at: '2026-10-01 00:00:00' });
  // The company skill's run.
  use({ skill: co, version: 1 });
  const env: any = { DB, JWT_SECRET: 'd4536-p4-fixture-only-secret', ENVIRONMENT: 'development', TEAM_AGENTS_ENABLED: 'true' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const h = new Hono();
  h.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  h.route(mount.path, mount.router);
  return h;
}
async function get(w: W, path: string, who = SUPER) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { headers: { Authorization: `Bearer ${jwt}` } }, w.env);
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}
const RANGE = '?from=2026-11-01&to=2026-11-20';

test('D4536-p4: the route serves completed runs from the run-time tags, over the migrated schema', async () => {
  const w = world();
  const r = await get(w, `${HQ}${RANGE}`);
  assert.equal(r.status, 200, r.text);
  const e = r.body.executions;
  assert.equal(e.available, true);
  assert.deepEqual(e.window, { since: '2026-11-01 00:00:00', until: '2026-11-21 00:00:00', days: 20, source: 'filter' });
  // Mutation checked: dropping `guard_for IS NULL` counts the two guard rows as runs; dropping the window counts the
  // October row. Dropping `skill_id IS NOT NULL` is equivalent: the join to agent_skills drops the untagged row.
  assert.equal(e.totals.completed, 5);
  assert.equal(e.totals.tokens, 5 * 15 + 2 * 15, 'each run and its guard rows');
  // r1 1200 + r2 1000 + the v1 run 1000; r3 unrecorded (NULL guard charge); r4 incomplete (an earlier attempt).
  assert.deepEqual(e.totals.charge, { microusd: 3200, runs_recorded: 3, runs_unrecorded: 1, runs_incomplete: 1 });
  assert.equal(e.totals.cost_per_completed_microusd, 1067);
  assert.deepEqual(e.totals.by_path, { scheduled: 1, manual: 4 });
  assert.deepEqual(e.by_scope.company, { completed: 1 }, 'a date window is not a skill filter: the company run is still counted');
  const [a] = e.skills;
  assert.equal(a.skill_uid, UID_A);
  assert.deepEqual(a.by_model, { [M1]: 4, [M2]: 1 });
  assert.deepEqual(a.by_version.map((v: any) => [v.version, v.completed]), [[2, 4], [1, 1]]);
  // Latencies 100, 200, 300, 400 on v2: nearest rank p50 = 2nd, p95 = 4th. The v1 run recorded none.
  assert.deepEqual(a.by_version[0].model_latency_ms, { p50: 200, p95: 400, runs_measured: 4 });
  assert.equal(a.by_version[1].model_latency_ms.available, false);
  assert.deepEqual(e.totals.model_latency_ms, { p50: 200, p95: 400, runs_measured: 4 });
  // B is pinned (adoption) but never ran: named, not counted as a 0-run "usage".
  assert.equal(r.body.coverage.adoption.links, 1);
  assert.deepEqual(e.published_without_completed_runs, { count: 1, skill_uids: [UID_B] });
  assert.deepEqual(r.body.filters.executions, { applied: ['from', 'to'], not_applicable: [] });
  assert.ok(!JSON.stringify(e).includes(UID_C) && !JSON.stringify(e).includes('acme-private'), 'no company skill is named');
});

test('D4536-p4: a model filter narrows runs and their latency; an unreadable history is unavailable, never zeros', async () => {
  const w = world();
  const m2 = (await get(w, `${HQ}${RANGE}&model=${encodeURIComponent(M2)}`)).body.executions;
  assert.equal(m2.totals.completed, 1);
  assert.deepEqual(m2.totals.charge, { microusd: 0, runs_recorded: 0, runs_unrecorded: 0, runs_incomplete: 1 });
  assert.equal(m2.totals.cost_per_completed_microusd.available, false);
  assert.deepEqual(m2.totals.model_latency_ms, { p50: 400, p95: 400, runs_measured: 1 });

  w.db.exec('DROP TABLE agent_task_runs');
  const broken = await get(w, `${HQ}${RANGE}`);
  assert.equal(broken.status, 200, 'the library still answers');
  assert.equal(broken.body.executions.available, false);
  assert.ok(!('totals' in broken.body.executions), 'no number stands in for the unreadable history');
});

test('D4536-p4: the reads name no proposal table, so #3851 is not reused as skill quality', () => {
  for (const text of [EXECUTIONS_SQL, EXECUTION_LATENCY_SQL]) {
    assert.doesNotMatch(text, /ai_rail_proposals|proposal_decided|acceptance/i);
  }
});
