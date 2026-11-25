/**
 * D8525 (#8525) — a venture's move and rename commit only if the scope and
 * slug they read are still current, and the step after a move is owed, not
 * lost. Every race below holds each request at its write (a barrier in the
 * test D1) until both have finished their reads and passed their checks, then
 * lets the batches run one after the other in a chosen order, as D1 would.
 * Every person, company and project is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/project_move_race_8525.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADA, NORTH, SOUTH, WEST, VENTURE, call, envOf, fixture } from './_portfolio_d1415_fixture.ts';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { COMPANY, PROJECT, SPONSOR, AGENT, fakeAgentRun, loopDeps, world } from './_agent_engine_fixture.ts';
import { load } from '../src/agents/loop.ts';
import { projectMoveStatements } from '../src/services/projectMove.ts';
import { retryMoveFollowups, runFollowup, type MovedDeps } from '../src/services/agents/transfer.ts';

test.after(() => removeMigratedDatabases());

/**
 * Holds every `batch` until `n` are waiting, then runs them one at a time,
 * first those whose statements match `first` (by SQL text). `before` runs once
 * just before the first held batch, for a change made between read and write.
 */
function hold(env: any, n: number, opts: { first?: RegExp; before?: () => void } = {}) {
  const inner = env.DB;
  const waiting: { stmts: any[]; done: (v: any) => void; fail: (e: unknown) => void }[] = [];
  const sqlOf = (stmts: any[]) => stmts.map((s) => s.__sql ?? '').join('\n');
  env.DB = {
    ...inner,
    prepare(sql: string) { const s = inner.prepare(sql); s.__sql = sql; return s; },
    batch(stmts: any[]) {
      return new Promise((done, fail) => {
        waiting.push({ stmts, done, fail });
        if (waiting.length < n) return;
        const order = [...waiting].sort((a, b) => Number(!!opts.first?.test(sqlOf(b.stmts))) - Number(!!opts.first?.test(sqlOf(a.stmts))));
        opts.before?.();
        (async () => { for (const w of order) { try { w.done(await inner.batch(w.stmts)); } catch (e) { w.fail(e); } } })();
      });
    },
  };
  return env;
}

const venture = (db: any) => ({ ...(db.prepare('SELECT company_id, slug FROM projects WHERE id = ?').get(VENTURE) as any) });
const count = (db: any, sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as any).n);
const moveEvents = (db: any) => count(db, "SELECT COUNT(*) AS n FROM company_membership_events WHERE kind = 'project_move' AND project_id = ?", VENTURE);
const followups = (db: any) => count(db, 'SELECT COUNT(*) AS n FROM project_move_followups WHERE project_id = ?', VENTURE);
const retired = (db: any) => db.prepare("SELECT scope_company_id AS scope, slug FROM slug_history WHERE kind = 'project' AND target_id = ? ORDER BY id").all(VENTURE).map((r: any) => ({ ...r }));
/** Ada also belongs to Westwind, so the venture has two companies to go to besides its own. */
function world2() {
  const db = fixture();
  db.exec("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES ('l-ada-west', 4, 1, 'Member', 0, '2026-01-06')");
  return db;
}

test('move against move: one wins, the other is 409 conflict and writes nothing; one event, one owed step', async () => {
  // Mutation checked: the move's guard dropped from projectMoveStatements lets both commit (two events, the last write wins).
  const db = world2();
  const env = hold(envOf(db), 2);
  const [a, b] = await Promise.all([
    call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH }),
    call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: WEST }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const lost = a.status === 409 ? a : b;
  const won = a.status === 200 ? a : b;
  assert.equal(lost.body.code, 'conflict');
  assert.deepEqual(lost.body.project, { id: VENTURE, company_id: won.body.company_id, slug: 'venture' }, 'the loser is told where the venture is now');
  assert.equal(venture(db).company_id, won.body.company_id);
  assert.equal(moveEvents(db), 1, 'one project_move event');
  assert.equal(followups(db), 1, 'one agent transfer owed');
  assert.deepEqual(retired(db), [{ scope: NORTH, slug: 'venture' }], 'the old address retired once, where it was');
});

for (const winner of ['move', 'rename'] as const) {
  test(`move against rename, the ${winner} first: the slug is unique in the final scope and the retired slug sits where it was retired`, async () => {
    // Mutation checked: the rename's guard dropped, or the move's slug condition dropped, lets the loser commit too.
    const db = world2();
    // Southwind already has a project at the address the rename wants, so a rename that lands after the move would clash.
    db.exec("INSERT INTO projects (id, uid, name, founder_id, company_id, slug, created_at) VALUES (30, 'p-south', 'South', 101, 2, 'renamed', '2026-02-06')");
    const env = hold(envOf(db), 2, { first: winner === 'move' ? /company_id = \? WHERE id = \? AND company_id IS/ : /SET slug = \?/ });
    const [m, r] = await Promise.all([
      call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH }),
      call(env, ADA, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'renamed' }),
    ]);
    const now = venture(db);
    if (winner === 'move') {
      assert.deepEqual([m.status, r.status, r.body.code], [200, 409, 'conflict']);
      assert.deepEqual(now, { company_id: SOUTH, slug: 'venture' });
      assert.deepEqual(retired(db), [{ scope: NORTH, slug: 'venture' }]);
    } else {
      assert.deepEqual([r.status, m.status, m.body.code], [200, 409, 'conflict']);
      assert.deepEqual(now, { company_id: NORTH, slug: 'renamed' });
      assert.deepEqual(retired(db), [{ scope: NORTH, slug: 'venture' }]);
      assert.equal(moveEvents(db), 0);
    }
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM projects WHERE company_id IS ? AND slug = ?', now.company_id, now.slug), 1, 'one project at that address in the final scope');
  });
}

test('rename against rename: one wins, the other is 409 conflict and retires nothing', async () => {
  // Mutation checked: the rename's `AND slug IS ?` and its guard both dropped lets both commit and retire twice.
  const db = world2();
  const env = hold(envOf(db), 2);
  const [a, b] = await Promise.all([
    call(env, ADA, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'first' }),
    call(env, ADA, 'PUT', `/api/projects/${VENTURE}/slug`, { slug: 'second' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const won = a.status === 200 ? a : b;
  assert.equal((a.status === 409 ? a : b).body.code, 'conflict');
  assert.equal(venture(db).slug, won.body.slug);
  assert.deepEqual(retired(db), [{ scope: NORTH, slug: 'venture' }], 'the old slug retired once');
});

for (const change of ['the destination is archived', 'the owner leaves the destination'] as const) {
  test(`a move where ${change} between its read and its write is refused, nothing written`, async () => {
    // Mutation checked: the guard's destination clause dropped lets the move land in the archived company / without the owner.
    const db = world2();
    const env = hold(envOf(db), 1, {
      before: () => db.exec(change === 'the destination is archived'
        ? "UPDATE company_profiles SET archived_at = '2026-11-25' WHERE id = 2"
        : 'DELETE FROM user_company_links WHERE user_id = 1 AND company_id = 2'),
    });
    const m = await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH });
    assert.deepEqual([m.status, m.body.code], [409, 'conflict']);
    assert.deepEqual(venture(db), { company_id: NORTH, slug: 'venture' });
    assert.equal(moveEvents(db), 0);
    assert.equal(followups(db), 0);
    assert.deepEqual(retired(db), []);
  });
}

test('a plain move still commits, and its owed step is done once it ran', async () => {
  const db = world2();
  const env = envOf(db);
  const m = await call(env, ADA, 'POST', `/api/projects/${VENTURE}/move`, { company_id: SOUTH });
  assert.equal(m.status, 200);
  assert.deepEqual(db.prepare('SELECT from_company_id, to_company_id, status, attempts FROM project_move_followups').all().map((r: any) => ({ ...r })),
    [{ from_company_id: NORTH, to_company_id: SOUTH, status: 'done', attempts: 1 }]);
});

test('the after-move step fails once and the tick retries it: runs end exactly once, the step is done', async () => {
  // Mutation checked: runFollowup marking the row done on failure leaves the run in flight after the tick;
  // the tick not selecting pending rows does too.
  const w = world();
  try {
    w.db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (2, 'co-2', 'Borealis')");
    w.agent(AGENT);
    w.task(300, AGENT);
    const a = await w.runtime.admit({ kind: 'project', id: PROJECT }, { agentId: AGENT, taskId: 300, by: SPONSOR, source: 'person' });
    assert.ok(a.ok, JSON.stringify(a));
    assert.ok((await load(loopDeps(w, fakeAgentRun(w).fn), a.run.uid)).go);
    const results = await w.DB.batch(projectMoveStatements(w.env, { projectId: PROJECT, from: COMPANY, to: 2, actorUserId: SPONSOR }));
    const id = Number(results.at(-1).meta.last_row_id);
    const deps: MovedDeps = { tell: async () => {}, notify: async () => {} };
    // The step's first read fails: the move has committed, the step is owed.
    const broken = { ...w.env, DB: { ...w.env.DB, prepare: (sql: string) => { if (/FROM agent_task_runs r JOIN/.test(sql)) throw new Error('D1 down'); return w.env.DB.prepare(sql); } } };
    assert.equal(await runFollowup(broken, id, deps), false);
    const row = () => w.db.prepare('SELECT status, attempts, last_error FROM project_move_followups WHERE id = ?').get(id) as any;
    assert.deepEqual({ ...row() }, { status: 'pending', attempts: 1, last_error: 'Error' });
    assert.equal((w.db.prepare('SELECT status FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any).status, 'running', 'the run still goes on');
    // Five minutes after the move, the tick.
    const created = (w.db.prepare('SELECT created_at FROM project_move_followups WHERE id = ?').get(id) as any).created_at as string;
    const later = new Date(new Date(created.replace(' ', 'T') + 'Z').getTime() + 5 * 60_000);
    assert.deepEqual(await retryMoveFollowups(w.env, later, deps), { done: 1, failed: 0 });
    assert.deepEqual({ ...row() }, { status: 'done', attempts: 2, last_error: null });
    const run = w.db.prepare('SELECT status, steps_json FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any;
    assert.equal(run.status, 'scope_moved');
    assert.equal(JSON.parse(run.steps_json).filter((s: any) => s.summary === 'The project moved to another company.').length, 1, 'ended once');
    // Once done, neither the tick nor a second run touches it again.
    assert.deepEqual(await retryMoveFollowups(w.env, later, deps), { done: 0, failed: 0 });
    assert.equal(await runFollowup(w.env, id, deps), false);
    assert.equal(JSON.parse((w.db.prepare('SELECT steps_json FROM agent_task_runs WHERE uid = ?').get(a.run.uid) as any).steps_json)
      .filter((s: any) => s.summary === 'The project moved to another company.').length, 1, 'still once');
  } finally { w.close?.(); }
});

test('the tick leaves a step younger than a minute to the move\'s own attempt', async () => {
  // Mutation checked: the age condition dropped makes the tick run a step the route is still running.
  const w = world();
  try {
    w.db.exec("INSERT INTO company_profiles (id, uid, company_name) VALUES (2, 'co-2', 'Borealis')");
    await w.DB.batch(projectMoveStatements(w.env, { projectId: PROJECT, from: COMPANY, to: 2, actorUserId: SPONSOR }));
    const deps: MovedDeps = { tell: async () => {}, notify: async () => {} };
    const created = (w.db.prepare('SELECT created_at FROM project_move_followups').get() as any).created_at as string;
    const at = new Date(created.replace(' ', 'T') + 'Z');
    assert.deepEqual(await retryMoveFollowups(w.env, new Date(at.getTime() + 30_000), deps), { done: 0, failed: 0 });
    assert.deepEqual(await retryMoveFollowups(w.env, new Date(at.getTime() + 61_000), deps), { done: 1, failed: 0 });
  } finally { w.close?.(); }
});
