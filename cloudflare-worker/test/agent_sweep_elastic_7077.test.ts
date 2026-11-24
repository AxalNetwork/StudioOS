/**
 * D7077 part 2 (#7077) — the agent sweep's per-scope discovery bound follows a
 * team's elastic ceiling (D7074).
 *
 * A fixed team keeps `DISCOVERY_PER_SCOPE_MAX` (4). An elastic team under HQ's
 * elastic ceiling is offered what admission would let it start: its parallel
 * limit less its live runs, never above `DISCOVERY_ELASTIC_SCOPE_MAX` (30).
 * With no ceiling, or a withdrawn one, every team reads as fixed and the sweep
 * is what it was. The bound is read in the one discovery statement, and the
 * rotation cursor (D4592) and #5586's boundary (fair admission per venture,
 * the model budget) are unchanged.
 *
 * The migrated schema and the real sweep. A recording runtime measures what
 * discovery offers without admission's refusals in the way; the rotation
 * cases use the real admission.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_sweep_elastic_7077.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { COMPANY, MODULE, OPTION, SPONSOR, hex, world, type World } from './_agent_engine_fixture.ts';
import { parallelLimit, DEFAULT_CAPACITY } from '../src/agents/capacity.ts';
import { putScopeSettings } from '../src/agents/engine.ts';
import {
  DISCOVERY_ELASTIC_SCOPE_MAX, DISCOVERY_PER_SCOPE_MAX, DISCOVERY_SCAN_MAX, SWEEP_MAX, sweepAgents,
} from '../src/agents/sweep.ts';

test.after(() => removeMigratedDatabases());

const NOW = new Date('2026-11-22T21:01:00.000Z');
const CURSOR = 'agents:sweep:ready-cursor:v1';

/** A project scope (team) of `count` agents with one ready task each; agent ids from `firstAgent`. */
function team(w: World, projectId: number, firstAgent: number, count: number, companyId: number = COMPANY) {
  w.db.prepare('INSERT OR IGNORE INTO projects (id, uid, name, founder_id, company_id, description) VALUES (?, ?, ?, 100, ?, ?)')
    .run(projectId, `elastic-project-${projectId}`, `Team ${projectId}`, companyId, 'Synthetic sweep team.');
  for (let n = 0; n < count; n += 1) {
    const agentId = firstAgent + n;
    w.db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, company_id, project_id, role_key, first_name, model_id, sponsor_user_id, monthly_cap_microusd, created_by, status)
      VALUES (?, ?, 'project', NULL, ?, ?, ?, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', ?, 5000000, ?, 'active')`)
      .run(agentId, hex(agentId, 'b'), projectId, `role-${agentId}`, `Agent${agentId}`, SPONSOR, SPONSOR);
    task(w, 100_000 + agentId, agentId, projectId);
  }
}
function task(w: World, taskId: number, agentId: number, projectId: number) {
  w.db.prepare(`INSERT INTO scope_tasks (id, uid, scope_kind, company_id, project_id, title, module, option,
      assignee_kind, assignee_agent_id, status, board_column, priority, created_by_user_id)
    VALUES (?, ?, 'project', NULL, ?, ?, ?, ?, 'agent', ?, 'open', 'ready', 0, ?)`)
    .run(taskId, hex(taskId, 'c'), projectId, `Task ${taskId}`, MODULE, OPTION, agentId, SPONSOR);
}
/** A live run held by an agent of the team: it counts against the team's parallel limit. */
function liveRun(w: World, agentId: number, taskId: number) {
  w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES (?, ?, ?, 1, 'running')")
    .run(`live-${agentId}-${taskId}`, agentId, taskId);
}
/** An agent of the team working on its one task (no ready task left): `count` of them from `firstAgent`. */
function busy(w: World, projectId: number, firstAgent: number, count: number) {
  team(w, projectId, firstAgent, count);
  for (let n = 0; n < count; n += 1) {
    const agentId = firstAgent + n;
    w.db.prepare("UPDATE scope_tasks SET status = 'in_progress', board_column = 'in_progress' WHERE id = ?").run(100_000 + agentId);
    liveRun(w, agentId, 100_000 + agentId);
  }
}
/** HQ's ceilings, on the one policy row. Null is not offered. */
function hq(w: World, elastic: number | null) {
  w.db.prepare(`INSERT INTO ai_agent_policy (id, elastic_runs_ceiling) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET elastic_runs_ceiling = excluded.elastic_runs_ceiling`).run(elastic);
}
const elastic = (w: World, projectId: number, max: number | null) =>
  putScopeSettings(w.env, { kind: 'project', id: projectId }, { capacity_mode: 'elastic', elastic_max_runs: max }, SPONSOR);
const fixed = (w: World, projectId: number, max = 5) =>
  putScopeSettings(w.env, { kind: 'project', id: projectId }, { capacity_mode: 'fixed', max_parallel_runs: max }, SPONSOR);

/** Refuses every candidate and records it: what discovery offered, per team, in order. */
function recorder() {
  const offered: Array<{ scope: string; agentId: number }> = [];
  const runtime: any = { admit: async (s: { kind: string; id: number }, t: { agentId: number }) => {
    offered.push({ scope: `${s.kind}:${s.id}`, agentId: t.agentId });
    return { ok: false, status: 409, code: 'recorded', message: 'recorded' };
  } };
  const per = () => offered.reduce<Record<string, number>>((m, o) => ({ ...m, [o.scope]: (m[o.scope] ?? 0) + 1 }), {});
  return { offered, runtime, per };
}
/** One sweep from a fresh rotation (no cursor), so each call measures the bound alone. */
async function offeredBy(w: World) {
  w.kv.m.delete(CURSOR);
  const r = recorder();
  await sweepAgents(w.env, NOW, { enqueue: async () => {}, runtime: async () => r.runtime });
  return r;
}
const admitted = (w: World, projectId: number) => Number((w.db.prepare(
  "SELECT COUNT(*) AS n FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id WHERE a.project_id = ? AND r.status = 'admitted'",
).get(projectId) as any).n);

// ── Nothing switched on ─────────────────────────────────────────────────────

test('with no elastic ceiling every team keeps the fixed bound of 4, whatever its row says, and the sweep is what it was', async () => {
  // Mutation checked: the elastic branch without `b.elastic_ceiling IS NOT NULL` → an elastic row with no ceiling is offered nothing.
  // Mutation checked: `fixed_scope_max` bound to 5 → every team here is offered 5.
  assert.equal(DISCOVERY_PER_SCOPE_MAX, 4);
  const baseline: Array<{ scope: string; agentId: number }>[] = [];
  for (const policy of ['no row', 'null ceiling'] as const) {
    for (const rows of ['none', 'elastic and fixed rows'] as const) {
      const w = world({ autonomy: 'self_start' });
      try {
        team(w, 801, 1_000, 10); team(w, 802, 2_000, 10); team(w, 803, 3_000, 10);
        if (policy === 'null ceiling') hq(w, null);
        if (rows !== 'none') { await elastic(w, 801, 40); await elastic(w, 802, null); await fixed(w, 803); }
        const r = await offeredBy(w);
        assert.deepEqual(r.per(), { 'project:801': 4, 'project:802': 4, 'project:803': 4 }, `${policy}, ${rows}`);
        baseline.push(r.offered);
      } finally { w.close(); }
    }
  }
  for (const b of baseline.slice(1)) assert.deepEqual(b, baseline[0], 'the same candidates in the same order in every case');
});

// ── Elastic under HQ's ceiling ──────────────────────────────────────────────

test('an elastic team under HQ\'s ceiling is offered its parallel limit, as admission reads it; a fixed team beside it keeps 4', async () => {
  // Mutation checked: `MIN(team, ceiling)` turned team-only → the team asking 40 under a ceiling of 9 is offered 40 → 30 (the cap).
  // Mutation checked: dropping `s.capacity_mode = 'elastic'` → the fixed team is offered the ceiling.
  // Mutation checked: `readyCandidates` passing a null ceiling → every team is offered 4.
  const w = world({ autonomy: 'self_start' });
  try {
    team(w, 811, 1_000, 20); team(w, 812, 2_000, 20); team(w, 813, 3_000, 20); team(w, 814, 4_000, 20);
    hq(w, 9);
    await elastic(w, 811, 6);    // its own number, under the ceiling
    await elastic(w, 812, null); // unset takes HQ's ceiling
    await elastic(w, 813, 40);   // never above HQ
    await fixed(w, 814);         // fixed ignores the elastic ceiling
    const r = await offeredBy(w);
    assert.deepEqual(r.per(), { 'project:811': 6, 'project:812': 9, 'project:813': 9, 'project:814': 4 });
    // The same figure admission enforces (`parallelLimit`), so discovery offers no more than can start.
    const ceil = { elastic_runs: 9, lanes: null, per_run_microusd: null };
    assert.deepEqual([6, null, 40].map((m) => parallelLimit({ ...DEFAULT_CAPACITY, capacity_mode: 'elastic', elastic_max_runs: m }, ceil)), [6, 9, 9]);
    // An elastic team past the fixed five is a team the fixed bound held back: its fifth to ninth agents are offered.
    assert.ok(r.offered.filter((o) => o.scope === 'project:812').map((o) => o.agentId).includes(2_008));
  } finally { w.close(); }
});

test('an elastic team\'s live runs come off its bound; a team at its limit is offered nothing and the others are unaffected', async () => {
  // Mutation checked: dropping `- IFNULL(sl.n, 0)` → the team with 5 live is offered 12 and the full team 12.
  // Mutation checked: `MAX(0, …)` turned `MAX(1, …)` → the full team is offered one candidate admission must refuse.
  const w = world({ autonomy: 'self_start' });
  try {
    team(w, 821, 1_000, 20); team(w, 822, 2_000, 20); team(w, 823, 3_000, 10);
    hq(w, 50);
    await elastic(w, 821, 12); await elastic(w, 822, 12);
    // Five live runs in 821 held by agents with no ready task left; twelve in 822, its whole limit.
    busy(w, 821, 1_500, 5);
    busy(w, 822, 2_500, 12);
    // A fixed team's live runs change nothing: its bound stays 4 (as before this change).
    liveRun(w, 3_000, 100_000 + 3_000);
    const r = await offeredBy(w);
    assert.deepEqual(r.per(), { 'project:821': 7, 'project:823': 4 });
  } finally { w.close(); }
});

test('withdrawing HQ\'s ceiling takes effect at the next sweep, with no team row rewritten', async () => {
  // Mutation checked: the elastic branch without `b.elastic_ceiling IS NOT NULL` → after the withdrawal the team is offered nothing.
  const w = world({ autonomy: 'self_start' });
  try {
    team(w, 831, 1_000, 20);
    await elastic(w, 831, 15);
    hq(w, 20);
    assert.deepEqual((await offeredBy(w)).per(), { 'project:831': 15 });
    hq(w, null);
    assert.deepEqual((await offeredBy(w)).per(), { 'project:831': 4 }, 'withdrawn reads as fixed');
    assert.equal((w.db.prepare("SELECT capacity_mode, elastic_max_runs FROM agent_scope_settings WHERE project_id = 831").get() as any).elastic_max_runs, 15);
    w.db.prepare('DELETE FROM ai_agent_policy').run();
    assert.deepEqual((await offeredBy(w)).per(), { 'project:831': 4 }, 'no policy row reads as fixed');
  } finally { w.close(); }
});

// ── The caps and the rotation ───────────────────────────────────────────────

test('one elastic team never takes more than 30 inspections, and the scan stays at 120 however many elastic teams there are', async () => {
  // Mutation checked: `DISCOVERY_ELASTIC_SCOPE_MAX` bound as 500 → the big team is offered 60 and the scan reaches the cold team late.
  // Mutation checked: the outer `LIMIT ?` bound as 500 → six elastic teams are offered 180 candidates.
  assert.equal(DISCOVERY_ELASTIC_SCOPE_MAX, SWEEP_MAX / 2);
  assert.equal(DISCOVERY_SCAN_MAX, 120);
  const w = world({ autonomy: 'self_start' });
  try {
    hq(w, 500);
    team(w, 841, 1_000, 60); await elastic(w, 841, null);
    team(w, 842, 9_000, 1); // a cold fixed team after it in id order
    const r = await offeredBy(w);
    assert.deepEqual(r.per(), { 'project:841': DISCOVERY_ELASTIC_SCOPE_MAX, 'project:842': 1 }, 'the cold team is in the same scan');
  } finally { w.close(); }
  const many = world({ autonomy: 'self_start' });
  try {
    hq(many, 500);
    for (let n = 0; n < 6; n += 1) { team(many, 850 + n, 10_000 + n * 100, 40); await elastic(many, 850 + n, null); }
    const r = await offeredBy(many);
    assert.equal(r.offered.length, DISCOVERY_SCAN_MAX);
    assert.ok(Object.values(r.per()).every((n) => n <= DISCOVERY_ELASTIC_SCOPE_MAX));
  } finally { many.close(); }
});

test('rotation stays fair with the real admission: two elastic teams fill a sweep, the cold team is reached on the next, and the rotation wraps', async () => {
  // Mutation checked: not saving the cursor (`saveReadyCursor` skipped) → the second sweep starts again at the elastic teams and the cold team waits.
  const w = world({ autonomy: 'self_start' });
  try {
    hq(w, 100);
    team(w, 861, 1_000, 40); await elastic(w, 861, null);
    team(w, 862, 2_000, 40); await elastic(w, 862, null);
    team(w, 863, 3_000, 1);
    const first = await sweepAgents(w.env, NOW, { enqueue: async () => {}, runtime: async () => w.runtime });
    assert.equal(first.admitted, SWEEP_MAX, 'the new-work budget is unchanged');
    assert.deepEqual([admitted(w, 861), admitted(w, 862), admitted(w, 863)], [30, 30, 0], 'each elastic team at most half a sweep');
    const second = await sweepAgents(w.env, new Date(NOW.getTime() + 5 * 60_000), { enqueue: async () => {}, runtime: async () => w.runtime });
    // The cursor resumes after the last agent examined: 862's other ten (its limit less its 30 live), then the cold team.
    assert.equal(second.admitted, 11);
    assert.deepEqual([admitted(w, 861), admitted(w, 862), admitted(w, 863)], [30, 40, 1], 'the cold team waits no more than one sweep');
    assert.equal(w.kv.m.get(CURSOR), '3000');
    // The rotation wraps: 861's other ten are offered next.
    const third = await sweepAgents(w.env, new Date(NOW.getTime() + 10 * 60_000), { enqueue: async () => {}, runtime: async () => w.runtime });
    assert.equal(third.admitted, 10);
    assert.deepEqual([admitted(w, 861), admitted(w, 862)], [40, 40]);
    assert.equal(w.kv.m.get(CURSOR), '1039');
  } finally { w.close(); }
});

// ── One statement, and #5586's boundary ─────────────────────────────────────

test('the bound is read in the one discovery statement: no statement per team, and the elastic case adds none', async () => {
  // Mutation checked: a per-team settings read added in `readyCandidates` → the elastic world makes more statements than the default one.
  const count = async (setup: (w: World) => Promise<void>) => {
    const w = world({ autonomy: 'self_start' });
    try {
      await setup(w);
      const prepare = w.env.DB.prepare.bind(w.env.DB);
      const seen = { all: 0, discovery: 0 };
      w.env.DB.prepare = (q: string) => { seen.all += 1; if (/fairly_scoped/.test(q)) seen.discovery += 1; return prepare(q); };
      await sweepAgents(w.env, NOW, { enqueue: async () => {}, runtime: async () => recorder().runtime });
      return seen;
    } finally { w.close(); }
  };
  const plain = await count(async (w) => { team(w, 871, 1_000, 3); });
  const busy = await count(async (w) => {
    hq(w, 50);
    for (let n = 0; n < 8; n += 1) { team(w, 880 + n, 10_000 + n * 100, 3); await elastic(w, 880 + n, 20); }
  });
  assert.equal(plain.discovery, 1);
  assert.equal(busy.discovery, 1);
  assert.equal(busy.all, plain.all, 'eight elastic teams make the statements one fixed team makes');
});

test('#5586 boundary: the bound is per team, not per venture, and the model budget does not shape discovery', async () => {
  // Mutation checked: `scope_live` joined without the project → one team's live runs come off the other team's bound.
  // Mutation checked: `fairly_scoped` partitioned without the project → the two teams share one bound.
  const w = world({ autonomy: 'self_start' });
  try {
    hq(w, 50);
    // Two teams of the same venture (company 1), each elastic at 10: each gets its own 10.
    team(w, 891, 1_000, 15); await elastic(w, 891, 10);
    team(w, 892, 2_000, 15); await elastic(w, 892, 10);
    // Live runs in one team never come off the other's bound.
    busy(w, 891, 1_500, 4);
    // A tiny model budget is dispatch's throttle (D7077 §2): discovery and admission do not read it.
    w.env.AGENT_MODEL_RPM = '{"*": 1}';
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    const discovery: string[] = [];
    w.env.DB.prepare = (q: string) => { if (/fairly_scoped/.test(q)) discovery.push(q); return prepare(q); };
    const r = await offeredBy(w);
    assert.deepEqual(r.per(), { 'project:891': 6, 'project:892': 10 });
    assert.equal(discovery.length, 1);
    assert.doesNotMatch(discovery[0], /agent_model_admissions|company_profiles|projects\b/, 'discovery reads no venture or model-budget state');
  } finally { w.close(); }
});
