/**
 * #4566 (Agent capacity A0) — mode (a), the local deterministic simulator:
 * synthetic fixtures (`scripts/lib/agentSyntheticFixtures.mjs`) seeded into the
 * agent engine's own test world (the real migrated schema, a fake Workflow, a
 * fake queue and a fake `agentRun`, `_agent_engine_fixture.ts`), a run admitted
 * through the existing runtime seam (`agentRuntime`'s `AgentRuntime`), and the
 * cleanup that leaves nothing synthetic behind. No model, queue, Workflow or
 * Cloudflare call is real; every row is synthetic.
 *
 *   1. The seed lands with foreign keys ON (D1 enforces them), beside the
 *      world's own rows, inside its ceilings.
 *   2. A synthetic task is admitted through the runtime seam: one live run and
 *      one queue message, no second engine.
 *   3. Cleanup removes every synthetic row, leaves every other row, is
 *      idempotent, and works after a partial seed.
 *   4. A person with ledger rows (append-only) is kept, switched off, and named.
 *   5. The SQL file form refuses a bad run id and carries no outside text.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_execution_validation_4566.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { world } from './_agent_engine_fixture.ts';
import {
  CEILINGS, SYNTHETIC_DOMAIN, cleanupStatements, plan, residualStatements, runId, seedStatements, toSqlFile,
} from '../../scripts/lib/agentSyntheticFixtures.mjs';

test.after(() => removeMigratedDatabases());

const RUN = 'a0sim01';
type W = ReturnType<typeof world>;
const apply = (w: W, stmts: { sql: string; args: unknown[] }[]) => { for (const s of stmts) w.db.prepare(s.sql).run(...(s.args as any[])); };
const residual = (w: W, run = RUN) => Object.fromEntries(residualStatements(run).map((r) => [r.table, Number((w.db.prepare(r.sql).get(...(r.args as any[])) as any).n)]));
const count = (w: W, sql: string) => Number((w.db.prepare(sql).get() as any).n);
/** The world's own rows, which no cleanup may touch. */
const others = (w: W) => ({
  users: count(w, `SELECT COUNT(*) AS n FROM users WHERE email NOT LIKE '%@${SYNTHETIC_DOMAIN}'`),
  projects: count(w, "SELECT COUNT(*) AS n FROM projects WHERE uid NOT LIKE 'syn-%'"),
  companies: count(w, "SELECT COUNT(*) AS n FROM company_profiles WHERE uid NOT LIKE 'syn-%'"),
});

function seeded(opts: { tenants?: number; agentsPerTenant?: number; tasksPerAgent?: number } = {}) {
  const w = world();
  w.db.exec('PRAGMA foreign_keys = ON');
  // The world's own agent and task, so cleanup is seen to leave them.
  w.agent(50); w.task(500, 50);
  const before = others(w);
  apply(w, seedStatements({ run: RUN, ...opts }));
  return { w, before };
}

test('the seed lands with foreign keys on, beside the world\'s own rows, inside its ceilings', () => {
  const { w } = seeded({ tenants: 2, agentsPerTenant: 2, tasksPerAgent: 3 });
  try {
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM team_agents WHERE uid LIKE 'syn-a0sim01-%'"), 4);
    assert.equal(count(w, "SELECT COUNT(*) AS n FROM scope_tasks WHERE uid LIKE 'syn-a0sim01-%'"), 12);
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@${SYNTHETIC_DOMAIN}'`), 2);
    assert.equal(Number((w.db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys), 1, 'every insert ran with foreign keys enforced, as D1 enforces them');
    const dangling = [
      "SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@synthetic.invalid' AND founder_id NOT IN (SELECT id FROM founders)",
      "SELECT COUNT(*) AS n FROM projects WHERE uid LIKE 'syn-%' AND (founder_id NOT IN (SELECT id FROM founders) OR company_id NOT IN (SELECT id FROM company_profiles))",
      "SELECT COUNT(*) AS n FROM team_agents WHERE uid LIKE 'syn-%' AND (project_id NOT IN (SELECT id FROM projects) OR sponsor_user_id NOT IN (SELECT id FROM users))",
      "SELECT COUNT(*) AS n FROM scope_tasks WHERE uid LIKE 'syn-%' AND (project_id NOT IN (SELECT id FROM projects) OR assignee_agent_id NOT IN (SELECT id FROM team_agents))",
    ].map((q) => count(w, q));
    assert.deepEqual(dangling, [0, 0, 0, 0], 'no synthetic row has a dangling reference');
    // Synthetic money: integer microusd, at the ceiling.
    const caps = (w.db.prepare("SELECT DISTINCT monthly_cap_microusd AS c, typeof(monthly_cap_microusd) AS t FROM team_agents WHERE uid LIKE 'syn-%'").all() as any[]).map((r) => ({ ...r }));
    assert.deepEqual(caps, [{ c: CEILINGS.monthlyCapMicrousd, t: 'integer' }]);
    // Each tenant's agents and tasks are its own project's.
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM scope_tasks t JOIN team_agents a ON a.id = t.assignee_agent_id WHERE t.uid LIKE 'syn-%' AND t.project_id <> a.project_id`), 0, 'no cross-tenant task');
  } finally { w.close(); }
  for (const bad of [{ tenants: 11 }, { agentsPerTenant: 4 }, { tasksPerAgent: 6 }, { tenants: 0 }]) {
    assert.throws(() => plan({ run: RUN, ...bad }), /synthetic ceiling/, JSON.stringify(bad));
  }
});

test('a synthetic task is admitted through the runtime seam: one live run and one queue message', async () => {
  // Mutation checked: the seed's task without board_column 'ready' → admission answers not_ready.
  const { w } = seeded();
  try {
    const agent = w.db.prepare("SELECT id, project_id FROM team_agents WHERE uid = 'syn-a0sim01-t0-a0'").get() as any;
    const task = w.db.prepare("SELECT id FROM scope_tasks WHERE uid = 'syn-a0sim01-t0-a0-k0'").get() as any;
    const sponsor = w.db.prepare("SELECT id FROM users WHERE uid = 'syn-a0sim01-t0-user'").get() as any;
    const r = await w.runtime.admit({ kind: 'project', id: agent.project_id }, { agentId: agent.id, taskId: task.id, by: sponsor.id, source: 'person' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ${agent.id} AND status IN ('admitted', 'running')`), 1);
    assert.equal(w.queue.length, 1, 'one message on the fake AGENT_QUEUE');
    // A second start of the same agent is refused by the existing single-flight rule, not by anything new here.
    const again = await w.runtime.admit({ kind: 'project', id: agent.project_id }, { agentId: agent.id, taskId: task.id, by: sponsor.id, source: 'person' });
    assert.equal(again.ok, false);
  } finally { w.close(); }
});

test('cleanup removes every synthetic row, leaves every other row, and a second cleanup deletes nothing', async () => {
  // Mutation checked: cleanup deleting synthetic users without the ledger guard turns the ledger case red (below).
  const { w, before } = seeded({ tenants: 2, agentsPerTenant: 2, tasksPerAgent: 2 });
  try {
    const agent = w.db.prepare("SELECT id, project_id FROM team_agents WHERE uid = 'syn-a0sim01-t1-a1'").get() as any;
    const task = w.db.prepare("SELECT id FROM scope_tasks WHERE uid = 'syn-a0sim01-t1-a1-k0'").get() as any;
    const sponsor = w.db.prepare("SELECT id FROM users WHERE uid = 'syn-a0sim01-t1-user'").get() as any;
    assert.equal((await w.runtime.admit({ kind: 'project', id: agent.project_id }, { agentId: agent.id, taskId: task.id, by: sponsor.id, source: 'person' })).ok, true);
    apply(w, cleanupStatements(RUN));
    assert.deepEqual(residual(w), { scope_tasks: 0, team_agents: 0, projects: 0, company_profiles: 0, users_active: 0, users_kept_for_ledger: 0 });
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM founders WHERE email LIKE '%@${SYNTHETIC_DOMAIN}'`), 0);
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id NOT IN (SELECT id FROM team_agents)'), 0);
    assert.deepEqual(others(w), before, 'the world\'s own rows are untouched');
    assert.equal(count(w, 'SELECT COUNT(*) AS n FROM team_agents WHERE id = 50'), 1);
    const changes = cleanupStatements(RUN).reduce((n, s) => n + Number(w.db.prepare(s.sql).run(...(s.args as any[])).changes), 0);
    assert.equal(changes, 0, 'idempotent');
  } finally { w.close(); }
});

test('with foreign keys off (a local SQLite copy), cleanup still removes the run\'s admitted runs', async () => {
  // Mutation checked: cleanup without the agent_task_runs statement → the run row is left behind.
  // With foreign keys on, D1 would cascade it from team_agents; this case has nothing to cascade.
  const w = world();
  try {
    apply(w, seedStatements({ run: RUN }));
    const agent = w.db.prepare("SELECT id, project_id FROM team_agents WHERE uid = 'syn-a0sim01-t0-a0'").get() as any;
    const task = w.db.prepare("SELECT id FROM scope_tasks WHERE uid = 'syn-a0sim01-t0-a0-k0'").get() as any;
    const sponsor = w.db.prepare("SELECT id FROM users WHERE uid = 'syn-a0sim01-t0-user'").get() as any;
    assert.equal((await w.runtime.admit({ kind: 'project', id: agent.project_id }, { agentId: agent.id, taskId: task.id, by: sponsor.id, source: 'person' })).ok, true);
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ${agent.id}`), 1);
    apply(w, cleanupStatements(RUN));
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM agent_task_runs WHERE agent_id = ${agent.id}`), 0);
  } finally { w.close(); }
});

test('cleanup after a partial seed, and another run\'s rows are not this run\'s', () => {
  const w = world();
  w.db.exec('PRAGMA foreign_keys = ON');
  try {
    const all = seedStatements({ run: RUN, tenants: 2, agentsPerTenant: 2, tasksPerAgent: 2 });
    apply(w, all.slice(0, Math.floor(all.length / 2)));
    apply(w, seedStatements({ run: 'otherrun2', tenants: 1 }));
    apply(w, cleanupStatements(RUN));
    assert.deepEqual(residual(w), { scope_tasks: 0, team_agents: 0, projects: 0, company_profiles: 0, users_active: 0, users_kept_for_ledger: 0 });
    assert.equal(residual(w, 'otherrun2').team_agents, 1, 'a run cleans only its own rows');
  } finally { w.close(); }
});

test('a person whose run wrote ledger rows is kept, switched off, and named; the ledger stays whole', () => {
  // Mutation checked: deleting users without the ledger guard → the ledger's foreign key refuses the cleanup.
  const { w } = seeded();
  try {
    const sponsor = w.db.prepare("SELECT id FROM users WHERE uid = 'syn-a0sim01-t0-user'").get() as any;
    w.db.prepare("INSERT INTO ai_credit_ledger (user_id, kind, delta_microusd, source_ref, actor) VALUES (?, 'bonus', 1000, 'synthetic:a0sim01', 'system')").run(sponsor.id);
    apply(w, cleanupStatements(RUN));
    const r = residual(w);
    assert.equal(r.users_active, 0);
    assert.equal(r.users_kept_for_ledger, 1, 'kept for its append-only ledger row');
    assert.equal(r.team_agents, 0);
    assert.equal(count(w, `SELECT COUNT(*) AS n FROM ai_credit_ledger WHERE user_id = ${sponsor.id}`), 1, 'the ledger row is untouched');
  } finally { w.close(); }
});

test('the SQL file form: a bad run id is refused; every literal is synthetic', () => {
  for (const bad of ['', 'x', "a0'; DROP TABLE users; --", 'A0SIM01', 'a0sim01%', 'a'.repeat(21)]) assert.throws(() => runId(bad), /run id/);
  const file = toSqlFile([...seedStatements({ run: RUN }), ...cleanupStatements(RUN)]);
  assert.doesNotMatch(file, /\?/, 'every placeholder is filled');
  for (const m of file.matchAll(/'([^']*)'/g)) {
    assert.ok(/^(syn-a0sim01-|Synthetic|founder$|project$|agent$|open$|ready$|active$|ceo$|cto$|cpo$|draft:build\/plan$|product-roadmap$|@cf\/)/.test(m[1]) || m[1].endsWith(`@${SYNTHETIC_DOMAIN}`) || m[1] === 'Synthetic venture for agent validation.',
      `an unexpected literal: ${m[1]}`);
  }
  // The file applies as written.
  const w = world();
  try {
    w.db.exec('PRAGMA foreign_keys = ON');
    w.db.exec(toSqlFile(seedStatements({ run: RUN })));
    assert.equal(residual(w).team_agents, 1);
    w.db.exec(toSqlFile(cleanupStatements(RUN)));
    assert.equal(residual(w).team_agents, 0);
  } finally { w.close(); }
});
