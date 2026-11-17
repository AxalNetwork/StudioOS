/**
 * D7076 (#7076) — a run builds its role context once. The `context` step is a
 * preflight: the checks that can refuse a run (scope, sponsor, a moved
 * project, a reader the book names but nobody built) and the note count, with
 * no reader called and no prompt made. The `run` step does the one full
 * build, checks access again, and writes what was read and left out on its own
 * timeline line. The prompt is never a step's output, a timeline line or a
 * log. Readers run together in a small fixed pool (`READ_CONCURRENCY`).
 *
 * The counts here are this fixture's (a ceo's default book: five reads), not a
 * production measurement.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_context_once_7076.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, SPONSOR, fakeAgentRun, harness, loopDeps, world, type World } from './_agent_engine_fixture.ts';
import { context, load, runStep, runTaskLoop } from '../src/agents/loop.ts';
import { READERS, READ_CONCURRENCY, readAll } from '../src/services/agents/reads.ts';
import { sourcesOf } from '../src/services/agents/runActivity.ts';

test.after(() => removeMigratedDatabases());

const P = { kind: 'project' as const, id: PROJECT };
const BOOK = ['project.summary', 'company.profile', 'team.roster', 'build.records', 'grow.records'];
const SECRET = 'Kestrel builds drones.'; // the project's description: project.summary puts it in the prompt
const runRow = (w: World, uid: string) => w.db.prepare('SELECT * FROM agent_task_runs WHERE uid = ?').get(uid) as any;

/** READERS with every call counted by key, and D1 `prepare` calls counted. */
function counted(w: World) {
  const calls = new Map<string, number>();
  const readers: typeof READERS = {};
  for (const [k, f] of Object.entries(READERS)) {
    readers[k] = async (env, c) => { calls.set(k, (calls.get(k) ?? 0) + 1); return f!(env, c); };
  }
  const db = w.env.DB;
  const prepare = db.prepare.bind(db);
  const n = { prepares: 0 };
  db.prepare = (sql: string) => { n.prepares += 1; return prepare(sql); };
  const total = () => [...calls.values()].reduce((a, b) => a + b, 0);
  const reset = () => { calls.clear(); n.prepares = 0; };
  return { readers, calls, n, total, reset };
}

test('one full build per run: the context step calls no reader, the run step calls each book read once', async () => {
  // Mutation checked: `context` calling `buildContext` again (the old shape) makes the context-step count 5, not 0.
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    const c = counted(w);
    const ar = fakeAgentRun(w);
    const d = loopDeps(w, ar.fn, c.readers);
    assert.ok((await load(d, a.run.uid)).go);

    c.reset();
    const out = await context(d, a.run.uid);
    const contextStep = { readers: c.total(), prepares: c.n.prepares };
    assert.deepEqual(out, { go: true, reads: BOOK, notes: 0 }, 'the preflight answers the book and the note count, nothing else');
    assert.equal(contextStep.readers, 0, 'the context step calls no reader');

    c.reset();
    assert.ok((await runStep(d, a.run.uid)).go);
    const runStepCounts = { readers: c.total(), prepares: c.n.prepares };
    assert.deepEqual(Object.fromEntries(c.calls), Object.fromEntries(BOOK.map((k) => [k, 1])), 'each read once, in the run step');
    assert.ok(ar.state.prompts[0].includes(SECRET), 'the run step built the full prompt');

    // The fixture's counts, recorded in D7076 (a test count, not a production measurement).
    console.log(`[d7076] reads per run: context step ${contextStep.readers} readers / ${contextStep.prepares} prepares; `
      + `run step ${runStepCounts.readers} readers / ${runStepCounts.prepares} prepares`);
  } finally { w.close(); }
});

test('the whole loop calls each reader once, and the prompt is in no step output, timeline line or log', async () => {
  const w = world();
  const logged: string[] = [];
  const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    const c = counted(w);
    const ar = fakeAgentRun(w);
    const h = harness();
    h.opts.decision = { status: 'accepted' };
    for (const m of ['log', 'warn', 'error', 'info'] as const) console[m] = (...xs: unknown[]) => { logged.push(xs.map(String).join(' ')); };
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, ar.fn, c.readers));
    Object.assign(console, keep);
    assert.deepEqual(out, { go: true, decision: 'accepted' });
    assert.equal(c.total(), BOOK.length, 'one full build per run');
    assert.ok(ar.state.prompts[0].includes(SECRET));
    assert.ok(!JSON.stringify([...h.saved.values()]).includes(SECRET), 'no Workflow step output holds the prompt');
    const r = runRow(w, a.run.uid);
    assert.ok(!r.steps_json.includes(SECRET), 'no timeline line holds the prompt');
    assert.ok(!logged.some((l) => l.includes(SECRET)), 'no log holds the prompt');

    // The timeline: the preflight's line, then the run step's own line naming what was read; the sources still come out.
    const steps = JSON.parse(r.steps_json);
    assert.deepEqual(steps.map((s: any) => s.name), ['load', 'context', 'run', 'run', 'propose', 'after']);
    assert.doesNotMatch(steps[1].summary, /^Read /);
    assert.equal(steps[2].summary, `Read ${BOOK.join(', ')} and 0 notes.`);
    assert.deepEqual(sourcesOf(steps), BOOK);
  } finally { Object.assign(console, keep); w.close(); }
});

test('access is checked again at the run step: a sponsor gone after the preflight ends the run there', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    const c = counted(w);
    const ar = fakeAgentRun(w);
    const d = loopDeps(w, ar.fn, c.readers);
    assert.ok((await load(d, a.run.uid)).go);
    assert.ok((await context(d, a.run.uid)).go);
    w.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SPONSOR);
    assert.deepEqual(await runStep(d, a.run.uid), { go: false, status: 'refused', refusal: 'sponsor_lost_access' });
    assert.equal(c.total(), 0, 'nothing is read for a run that is refused');
    assert.equal(ar.state.calls, 0);
  } finally { w.close(); }
});

test('a retried run step writes its read line once', async () => {
  const w = world();
  try {
    w.agent(AGENT); w.task(200, AGENT);
    const a = await w.runtime.admit(P, { agentId: AGENT, taskId: 200, by: SPONSOR, source: 'person' });
    assert.ok(a.ok);
    const h = harness();
    h.opts.decision = { status: 'accepted' };
    const lost = fakeAgentRun(w, { loseOnce: true });
    const out = await runTaskLoop(a.run.uid, h.step, loopDeps(w, lost.fn));
    assert.deepEqual(out, { go: false, status: 'step_lost', refusal: 'step_lost' });
    const lines = JSON.parse(runRow(w, a.run.uid).steps_json).filter((s: any) => /^Read /.test(s.summary));
    assert.equal(lines.length, 1);
  } finally { w.close(); }
});

test('readAll keeps the book\'s order and never has more than READ_CONCURRENCY reads in flight', async () => {
  let live = 0, peak = 0;
  const keys = Array.from({ length: 11 }, (_, i) => `k${i}`);
  const readers: typeof READERS = {};
  for (const [i, k] of keys.entries()) {
    readers[k] = async () => {
      live += 1; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, (11 - i) % 4));
      live -= 1;
      return { key: k };
    };
  }
  const out = await readAll({} as any, keys, {} as any, readers);
  assert.deepEqual(out.map((r) => (r.data as any).key), keys);
  assert.equal(peak, READ_CONCURRENCY);
  // A reader that throws rejects the build, as a sequential read did: the Workflow retries the step.
  readers.k3 = async () => { throw new Error('d1_down'); };
  await assert.rejects(readAll({} as any, keys, {} as any, readers), /d1_down/);
});
