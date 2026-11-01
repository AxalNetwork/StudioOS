/**
 * D1528 (#3847, E3 of #3742): migration 728, the agent engine's six tables,
 * over the real migrated schema. Every row is made up.
 *
 *   · 728 is additive and re-runs cleanly (every statement IF NOT EXISTS);
 *   · one live run per agent (the single-flight index), one row per
 *     (task, attempt), and only the run statuses and steps the spec names;
 *   · a duty's cadence carries its day, and one live duty per template;
 *   · a handoff chain is at most 3 deep; a memory note at most 1,000
 *     characters; a scope runs 1 to 5 at once, 2 by default;
 *   · a scope row names exactly one of a company and a project;
 *   · deleting an agent's row leaves no run, duty, note or handoff of it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/agent_engine_migration_728.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { classifyIdempotency } from '../../scripts/lib/migrationPlan.mjs';

test.after(() => removeMigratedDatabases());

const SQL = readFileSync(new URL('../sql/migrations/728_agent_engine.sql', import.meta.url), 'utf8');
const TABLES = ['agent_task_runs', 'agent_duties', 'agent_handoffs', 'agent_memory_notes', 'agent_custom_roles', 'agent_scope_settings'];

function fixture() {
  const db = migratedDatabase();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`INSERT INTO users (id, uid, role, name, email, is_active) VALUES (1, 'u-1', 'founder', 'Fay Founder', 'fay@example.test', 1);
    INSERT INTO projects (id, uid, name) VALUES (10, 'p-10', 'Kestrel Labs');`);
  const agent = (id: number, role = 'cfo') => db.prepare(`INSERT INTO team_agents (id, uid, scope_kind, project_id, role_key, model_id, sponsor_user_id, monthly_cap_microusd, created_by)
    VALUES (?, ?, 'project', 10, ?, 'm', 1, 1000000, 1)`).run(id, `a-${id}`, role);
  const task = (id: number) => db.prepare(`INSERT INTO scope_tasks (id, uid, scope_kind, project_id, title, created_by_user_id) VALUES (?, ?, 'project', 10, 'A task', 1)`).run(id, `t-${id}`);
  agent(100); agent(101, 'cmo'); task(200); task(201);
  const run = (uid: string, agentId: number, taskId: number, attempt: number, status = 'admitted') =>
    db.prepare('INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES (?, ?, ?, ?, ?)').run(uid, agentId, taskId, attempt, status);
  const close = () => { const f = db.location(); db.close(); if (f) rmSync(f, { force: true }); };
  return { db, run, close };
}

const throwsConstraint = (fn: () => unknown, re: RegExp, why: string) => assert.throws(fn, re, why);

test('728 creates the six tables, is additive, and re-runs cleanly', () => {
  const f = fixture();
  try {
    for (const t of TABLES) assert.ok(f.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t);
    f.db.exec(SQL); // a second run changes nothing and does not fail
    const code = SQL.replace(/--[^\n]*/g, '');
    assert.doesNotMatch(code, /\bALTER\s+TABLE\b|\bDROP\b|\bUPDATE\b|\bDELETE\s+FROM\b|\bINSERT\b/i, 'additive: nothing altered, dropped or rewritten');
    assert.deepEqual(classifyIdempotency(SQL), { idempotent: true, reasons: [] });
  } finally { f.close(); }
});

test('runs: one live run per agent, one row per (task, attempt), and only the named statuses and steps', () => {
  const f = fixture();
  try {
    f.run('r-1', 100, 200, 1);
    throwsConstraint(() => f.run('r-2', 100, 201, 1), /UNIQUE/, 'a second live run for the same agent');
    throwsConstraint(() => f.run('r-2', 100, 201, 1, 'running'), /UNIQUE/, 'running counts as live too');
    f.run('r-3', 101, 201, 1); // another agent is free
    f.db.prepare("UPDATE agent_task_runs SET status = 'waiting_decision' WHERE uid = 'r-1'").run();
    f.run('r-4', 100, 201, 2); // once the first is no longer admitted or running
    throwsConstraint(() => f.run('r-5', 101, 200, 1, 'done'), /UNIQUE/, 'task 200 attempt 1 exists');
    throwsConstraint(() => f.run('r-6', 101, 200, 2, 'paused'), /CHECK/, 'not a run status');
    throwsConstraint(() => f.run('r-7', 101, 200, 0, 'done'), /CHECK/, 'attempts count from 1');
    throwsConstraint(() => f.db.prepare("UPDATE agent_task_runs SET step = 'think' WHERE uid = 'r-3'").run(), /CHECK/, 'not a step');
    throwsConstraint(() => f.db.prepare("UPDATE agent_task_runs SET steps_json = '{}' WHERE uid = 'r-3'").run(), /CHECK/, 'the timeline is an array');
    for (const s of ['admitted', 'running', 'waiting_decision', 'done', 'refused', 'failed', 'cancelled', 'halted', 'scope_moved', 'step_lost']) {
      f.db.prepare('UPDATE agent_task_runs SET status = ? WHERE uid = ?').run(s, 'r-3');
    }
    const r = f.db.prepare("SELECT steps_json, status FROM agent_task_runs WHERE uid = 'r-4'").get() as any;
    assert.deepEqual([r.steps_json, r.status], ['[]', 'admitted']);
  } finally { f.close(); }
});

test('duties: the cadence carries its day; one live duty per agent and template', () => {
  const f = fixture();
  const duty = (uid: string, cadence: string, weekday: number | null, day: number | null, template = 'cfo.weekly_runway_note') =>
    f.db.prepare(`INSERT INTO agent_duties (uid, agent_id, template_key, title, cadence, weekday, day_of_month, hour_utc, next_due_at)
      VALUES (?, 100, ?, 'Runway note', ?, ?, ?, 8, '2026-11-02 08:00:00')`).run(uid, template, cadence, weekday, day);
  try {
    duty('d-1', 'weekly', 1, null);
    throwsConstraint(() => duty('d-2', 'weekly', 1, null), /UNIQUE/, 'duty_exists');
    throwsConstraint(() => duty('d-3', 'weekly', null, null, 'cfo.other'), /CHECK/, 'weekly needs a weekday');
    throwsConstraint(() => duty('d-4', 'daily', 2, null, 'cfo.other'), /CHECK/, 'daily takes no weekday');
    throwsConstraint(() => duty('d-5', 'monthly', null, null, 'cfo.other'), /CHECK/, 'monthly needs a day');
    throwsConstraint(() => duty('d-6', 'hourly', null, null, 'cfo.other'), /CHECK/, 'not a cadence');
    duty('d-7', 'monthly', null, 1, 'cfo.monthly');
    f.db.prepare("UPDATE agent_duties SET status = 'removed' WHERE uid = 'd-1'").run();
    duty('d-8', 'weekly', 1, null); // a removed duty frees its template
  } finally { f.close(); }
});

test('handoffs at most 3 deep; notes at most 1,000 characters; a scope runs 1 to 5 at once, 2 by default; one scope per row', () => {
  const f = fixture();
  const hand = (uid: string, depth: number) => f.db.prepare(`INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, title) VALUES (?, 'c-1', ?, 100, 'cmo', 'Pass it on')`).run(uid, depth);
  const note = (uid: string, body: string, scope = "'project', NULL, 10") =>
    f.db.prepare(`INSERT INTO agent_memory_notes (uid, agent_id, scope_kind, company_id, project_id, kind, body) VALUES (?, 100, ${scope}, 'decision', ?)`).run(uid, body);
  try {
    hand('h-1', 1); hand('h-3', 3);
    throwsConstraint(() => hand('h-4', 4), /CHECK/, 'depth 4');
    throwsConstraint(() => hand('h-1b', 1), /UNIQUE/, 'one step per depth in a chain');
    note('n-1', 'x'.repeat(1000));
    throwsConstraint(() => note('n-2', 'x'.repeat(1001)), /CHECK/, 'note_too_long');
    throwsConstraint(() => note('n-3', ''), /CHECK/, 'an empty note');
    throwsConstraint(() => note('n-4', 'ok', "'project', NULL, NULL"), /CHECK/, 'a project note names its project');
    f.db.exec("INSERT INTO agent_scope_settings (scope_kind, project_id) VALUES ('project', 10)");
    const s = f.db.prepare('SELECT engine_paused, max_parallel_runs FROM agent_scope_settings').get() as any;
    assert.deepEqual([s.engine_paused, s.max_parallel_runs], [0, 2]);
    throwsConstraint(() => f.db.exec("INSERT INTO agent_scope_settings (scope_kind, project_id) VALUES ('project', 10)"), /UNIQUE/, 'one row per scope');
    throwsConstraint(() => f.db.exec('UPDATE agent_scope_settings SET max_parallel_runs = 6'), /CHECK/, 'at most 5');
    throwsConstraint(() => f.db.exec('UPDATE agent_scope_settings SET max_parallel_runs = 0'), /CHECK/, 'at least 1');
    const role = (uid: string, name: string, scope = "'project', NULL, 10") =>
      f.db.prepare(`INSERT INTO agent_custom_roles (uid, scope_kind, company_id, project_id, name, mission, created_by) VALUES (?, ${scope}, ?, 'Keep the books', 1)`).run(uid, name);
    role('cr-1', 'Bookkeeper');
    throwsConstraint(() => role('cr-2', 'x'.repeat(61)), /CHECK/, 'name at most 60');
    throwsConstraint(() => role('cr-3', 'Both', "'company', 5, 10"), /CHECK/, 'one scope only');
    throwsConstraint(() => f.db.exec("UPDATE agent_custom_roles SET reads_json = 'nope'"), /CHECK/, 'reads is a JSON array');
  } finally { f.close(); }
});

test('deleting an agent row leaves none of its runs, duties, notes or handoffs', () => {
  const f = fixture();
  try {
    f.run('r-1', 100, 200, 1);
    f.db.exec(`INSERT INTO agent_duties (uid, agent_id, template_key, title, cadence, hour_utc, next_due_at) VALUES ('d-1', 100, 'cfo.daily', 'Daily', 'daily', 8, '2026-11-02 08:00:00');
      INSERT INTO agent_memory_notes (uid, agent_id, scope_kind, project_id, kind, body) VALUES ('n-1', 100, 'project', 10, 'fact', 'A fact');
      INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, to_agent_id, title) VALUES ('h-1', 'c-1', 1, 101, 'cfo', 100, 'To the CFO');
      INSERT INTO agent_handoffs (uid, chain_uid, depth, from_agent_id, to_role_key, title) VALUES ('h-2', 'c-2', 1, 100, 'cmo', 'From the CFO');`);
    f.db.exec('DELETE FROM team_agents WHERE id = 100');
    for (const t of ['agent_task_runs', 'agent_duties', 'agent_memory_notes']) {
      assert.equal(Number((f.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n), 0, t);
    }
    const left = f.db.prepare('SELECT uid, to_agent_id FROM agent_handoffs ORDER BY uid').all().map((r: any) => [r.uid, r.to_agent_id]);
    assert.deepEqual(left, [['h-1', null]], 'its own handoffs go; one handed to it keeps its row without the agent');
  } finally { f.close(); }
});
