/**
 * D4557 (#4557, Part of) — agent compute's host-independent parts: the job
 * table, the signed single-use run grant, the callback checks and the
 * server-side quotas. The container host waits on D4554; nothing here binds,
 * routes or enables anything. Real migrated schema; every row is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agent_compute_4557.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { removeMigratedDatabases } from './_storage_schema.ts';
import { AGENT, PROJECT, world } from './_agent_engine_fixture.ts';
import {
  LIMITS, MAX_LIVE_JOBS_PER_SCOPE, artifactPrefix, cancelJob, claimGrant, computeEnabled, createJob, inputsRefusal, mintGrant,
  recordResult, safeName, verifyGrant, type JobRow,
} from '../src/services/agents/compute.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 'x'.repeat(48);
const NOW = new Date('2027-01-10T10:00:00Z');

function computeWorld(o: { on?: boolean } = {}) {
  const w = world();
  w.agent(AGENT);
  w.task(200, AGENT);
  w.task(201, AGENT);
  w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES ('run-a', ?, 200, 1, 'running')").run(AGENT);
  const env: any = { ...w.env, ...(o.on === false ? {} : { AGENT_COMPUTE: 'on', AGENT_COMPUTE_SECRET: SECRET }) };
  const agent = w.db.prepare('SELECT * FROM team_agents WHERE id = ?').get(AGENT) as any;
  return { w, env, agent };
}
const inputs = [{ name: 'metrics.csv', bytes: 2048 }];
const job = async (c: ReturnType<typeof computeWorld>, key = 'agent:run-a:compute:1', more: Record<string, unknown> = {}) => {
  const r = await createJob(c.env, { runUid: 'run-a', agent: c.agent, workload: 'python', inputs, idempotencyKey: key, ...more } as any);
  assert.ok(r.ok, JSON.stringify(r));
  return (r as any).job as JobRow;
};
const reload = (c: ReturnType<typeof computeWorld>, uid: string) => c.w.db.prepare('SELECT * FROM agent_compute_jobs WHERE uid = ?').get(uid) as any as JobRow;
const result = (j: JobRow, over: Record<string, unknown> = {}) => ({
  outcome: 'succeeded', output_bytes: 900, artifacts: [`${artifactPrefix(j)}summary.json`], cpu_ms: 1200, wall_ms: 3400, peak_rss_bytes: 50_000_000, exit_code: 0, ...over,
}) as any;

test('off by default: no flag, a flag without a strong secret, or anything but on, refuses every entry point', async () => {
  assert.equal(computeEnabled({} as any), false);
  assert.equal(computeEnabled({ AGENT_COMPUTE: 'on' } as any), false);
  assert.equal(computeEnabled({ AGENT_COMPUTE: 'on', AGENT_COMPUTE_SECRET: 'short' } as any), false);
  assert.equal(computeEnabled({ AGENT_COMPUTE: 'true', AGENT_COMPUTE_SECRET: SECRET } as any), false);
  assert.equal(computeEnabled({ AGENT_COMPUTE: 'on', AGENT_COMPUTE_SECRET: SECRET } as any), true);
  const c = computeWorld({ on: false });
  try {
    const r = await createJob(c.env, { runUid: 'run-a', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-a:compute:1' });
    assert.deepEqual([r.ok, (r as any).code], [false, 'compute_off']);
    assert.equal((c.w.db.prepare('SELECT COUNT(*) AS n FROM agent_compute_jobs').get() as any).n, 0);
    assert.equal((await verifyGrant(c.env, 'a.b', 'f'.repeat(32)) as any).code, 'compute_off');
  } finally { c.w.close(); }
  // Declared nowhere: no wrangler table sets either name.
  const toml = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(toml, /AGENT_COMPUTE/);
});

test('inputs: path traversal, odd names, refused types, too many and too large are refused before anything is written', () => {
  for (const n of ['../x.csv', '/etc/passwd', 'a/b.csv', 'a\\b.csv', 'x..csv', '.hidden.csv', 'a\u0000.csv', 'a\nb.csv', '']) assert.equal(safeName(n), false, JSON.stringify(n));
  assert.equal(safeName('Q3 metrics (final).csv'), true);
  assert.equal(inputsRefusal('shell', inputs)?.code, 'workload_unknown');
  assert.equal(inputsRefusal('python', [{ name: '../x.csv', bytes: 1 }])?.code, 'input_name_invalid');
  assert.equal(inputsRefusal('python', [{ name: 'a.zip', bytes: 1 }])?.code, 'input_type_refused', 'archives are not inputs in v1');
  assert.equal(inputsRefusal('python', [{ name: 'a.csv', bytes: 1 }, { name: 'a.csv', bytes: 1 }])?.code, 'input_name_invalid');
  assert.equal(inputsRefusal('python', Array.from({ length: LIMITS.python.max_inputs + 1 }, (_, i) => ({ name: `f${i}.csv`, bytes: 1 })))?.code, 'inputs_invalid');
  assert.equal(inputsRefusal('python', [{ name: 'big.csv', bytes: LIMITS.python.max_input_bytes + 1 }])?.code, 'inputs_too_large');
  assert.equal(inputsRefusal('python', [{ name: 'a.csv', bytes: -1 }])?.code, 'inputs_invalid');
  assert.equal(inputsRefusal('document_convert', [{ name: 'deck.pdf', bytes: 1000 }]), null);
});

test('a job belongs to a running step of this agent; a redelivered dispatch is the same job; a reused key for another run is refused', async () => {
  const c = computeWorld();
  try {
    const a = await job(c);
    const again = await createJob(c.env, { runUid: 'run-a', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-a:compute:1' });
    assert.ok(again.ok && again.replayed && again.job.uid === a.uid);
    assert.equal((c.w.db.prepare('SELECT COUNT(*) AS n FROM agent_compute_jobs').get() as any).n, 1, 'one job, one charge');
    assert.deepEqual([a.scope_kind, a.scope_id, a.status], ['project', PROJECT, 'queued']);
    c.w.db.prepare("INSERT INTO agent_task_runs (uid, agent_id, task_id, attempt, status) VALUES ('run-b', ?, 201, 1, 'running')").run(AGENT + 1);
    const reuse = await createJob(c.env, { runUid: 'run-b', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-a:compute:1' });
    assert.equal((reuse as any).code, 'idempotency_key_reused');
    const other = await createJob(c.env, { runUid: 'run-b', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-b:compute:1' });
    assert.equal((other as any).code, 'run_not_found', 'another agent\'s run');
    c.w.db.prepare("UPDATE agent_task_runs SET status = 'waiting_decision' WHERE uid = 'run-a'").run();
    assert.equal((await createJob(c.env, { runUid: 'run-a', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-a:compute:2' }) as any).code, 'run_not_running');
  } finally { c.w.close(); }
});

test(`per-scope concurrency: at ${MAX_LIVE_JOBS_PER_SCOPE} live jobs the next is refused; an ended one frees a place`, async () => {
  const c = computeWorld();
  try {
    const live = [];
    for (let i = 1; i <= MAX_LIVE_JOBS_PER_SCOPE; i += 1) live.push(await job(c, `agent:run-a:compute:${i}`));
    const busy = await createJob(c.env, { runUid: 'run-a', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-a:compute:9' });
    assert.deepEqual([(busy as any).status, (busy as any).code], [429, 'compute_busy']);
    assert.ok((await cancelJob(c.env, live[0].uid)).ok);
    assert.ok((await createJob(c.env, { runUid: 'run-a', agent: c.agent, workload: 'python', inputs, idempotencyKey: 'agent:run-a:compute:9' })).ok);
  } finally { c.w.close(); }
});

test('the run grant: signed per job, scoped, expiring and spent once; forged, expired, other-job, cross-tenant and replayed grants are refused', async () => {
  const c = computeWorld();
  try {
    const a = await job(c);
    const g = await mintGrant(c.env, a, NOW);
    assert.ok(g.ok);
    const { token, claims } = g as any;
    assert.equal((await mintGrant(c.env, reload(c, a.uid), NOW) as any).code, 'already_dispatched', 'one grant per job');
    assert.ok(!JSON.stringify(reload(c, a.uid)).includes(token.split('.')[1]), 'the signature is not stored');
    const ok = await verifyGrant(c.env, token, a.uid, NOW);
    assert.ok(ok.ok, JSON.stringify(ok));
    // Forged: a changed body, a changed signature, a token signed with the master key itself, garbage.
    const [body, sig] = token.split('.');
    const tamperedBody = Buffer.from(JSON.stringify({ ...claims, scope: { kind: 'project', id: 999 } })).toString('base64url');
    for (const bad of [`${tamperedBody}.${sig}`, `${body}.${'0'.repeat(64)}`, 'nonsense', `${body}`, 42]) {
      assert.equal((await verifyGrant(c.env, bad, a.uid, NOW) as any).code, 'grant_invalid', String(bad).slice(0, 20));
    }
    assert.equal((await verifyGrant({ ...c.env, AGENT_COMPUTE_SECRET: 'y'.repeat(48) }, token, a.uid, NOW) as any).code, 'grant_invalid', 'another master key');
    assert.equal((await verifyGrant(c.env, token, 'f'.repeat(32), NOW) as any).code, 'grant_wrong_job');
    assert.equal((await verifyGrant(c.env, token, a.uid, new Date(NOW.getTime() + 16 * 60_000)) as any).code, 'grant_expired');
    // Cross-tenant: the job moved to another scope after the grant was signed.
    c.w.db.prepare('UPDATE agent_compute_jobs SET scope_id = ? WHERE uid = ?').run(PROJECT + 1, a.uid);
    assert.equal((await verifyGrant(c.env, token, a.uid, NOW) as any).code, 'grant_wrong_scope');
    c.w.db.prepare('UPDATE agent_compute_jobs SET scope_id = ? WHERE uid = ?').run(PROJECT, a.uid);
    // Spent once, even when two claims race.
    const j = reload(c, a.uid);
    const [x, y] = await Promise.all([claimGrant(c.env, j, NOW), claimGrant(c.env, j, NOW)]);
    assert.deepEqual([x.ok, y.ok].sort(), [false, true]);
    assert.equal(((x.ok ? y : x) as any).code, 'grant_replayed');
    assert.equal(reload(c, a.uid).status, 'running');
  } finally { c.w.close(); }
});

test('the result: recorded once, bounded, artifacts only under the job\'s prefix; nothing after a cancel or a second callback', async () => {
  const c = computeWorld();
  try {
    const a = await job(c);
    const g = await mintGrant(c.env, a, NOW) as any;
    assert.ok((await claimGrant(c.env, reload(c, a.uid), NOW)).ok);
    const j = reload(c, a.uid);
    assert.equal((await recordResult(c.env, j, result(j, { artifacts: ['agent-compute/project/999/run-a/x.json'] }), NOW) as any).code, 'artifact_outside_job', 'another tenant\'s prefix');
    assert.equal((await recordResult(c.env, j, result(j, { artifacts: [`${artifactPrefix(j)}../escape.json`] }), NOW) as any).code, 'artifact_outside_job');
    // Same length, another run's prefix: only the prefix check can refuse it.
    assert.equal((await recordResult(c.env, j, result(j, { artifacts: [`${artifactPrefix({ ...j, run_uid: 'run-b' })}x.json`] }), NOW) as any).code, 'artifact_outside_job');
    assert.equal((await recordResult(c.env, j, result(j, { output_bytes: LIMITS.python.max_output_bytes + 1 }), NOW) as any).code, 'output_too_large');
    assert.equal((await recordResult(c.env, j, result(j, { artifacts: Array.from({ length: 9 }, (_, i) => `${artifactPrefix(j)}a${i}.json`) }), NOW) as any).code, 'too_many_artifacts');
    assert.equal((await recordResult(c.env, j, result(j, { failure_code: 'Traceback: secret stdout' }), NOW) as any).code, 'result_invalid', 'a code, never text');
    assert.equal(reload(c, a.uid).status, 'running', 'a refused result changes nothing');
    assert.ok((await recordResult(c.env, j, result(j), NOW)).ok);
    const done = reload(c, a.uid);
    assert.deepEqual([done.status, done.output_bytes, done.exit_code, JSON.parse(done.artifact_keys_json!)], ['succeeded', 900, 0, [`${artifactPrefix(j)}summary.json`]]);
    assert.equal((await recordResult(c.env, j, result(j, { outcome: 'failed', exit_code: 1 }), NOW) as any).code, 'already_recorded', 'a duplicate callback');
    assert.equal(reload(c, a.uid).status, 'succeeded');
    assert.equal((await verifyGrant(c.env, g.token, a.uid, NOW) as any).code, 'job_ended', 'a late callback after the end');
  } finally { c.w.close(); }
});

test('cancel: a cancelled job refuses its grant\'s claim and any late result; a timeout is recorded as such', async () => {
  const c = computeWorld();
  try {
    const a = await job(c);
    const g = await mintGrant(c.env, a, NOW) as any;
    assert.ok((await cancelJob(c.env, a.uid, NOW)).ok);
    assert.equal((await verifyGrant(c.env, g.token, a.uid, NOW) as any).code, 'job_ended');
    assert.equal((await claimGrant(c.env, reload(c, a.uid), NOW) as any).code, 'grant_replayed');
    assert.equal((await recordResult(c.env, reload(c, a.uid), result(reload(c, a.uid)), NOW) as any).code, 'already_recorded');
    assert.equal((await cancelJob(c.env, a.uid, NOW) as any).code, 'job_ended');
    const b = await job(c, 'agent:run-a:compute:2');
    await mintGrant(c.env, b, NOW);
    assert.ok((await claimGrant(c.env, reload(c, b.uid), NOW)).ok);
    assert.ok((await recordResult(c.env, reload(c, b.uid), result(reload(c, b.uid), { outcome: 'timed_out', exit_code: 137, failure_code: 'wall_clock' }), NOW)).ok);
    assert.deepEqual([reload(c, b.uid).status, reload(c, b.uid).failure_code], ['timed_out', 'wall_clock']);
  } finally { c.w.close(); }
});

test('nothing binds, routes or enables compute yet, and the job table holds no content column', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(index, /services\/agents\/compute/);
  const migration = readFileSync(new URL('../sql/migrations/202611070924_agent_compute_jobs.sql', import.meta.url), 'utf8');
  const columns = [...migration.matchAll(/^\s{2}([a-z_]+) (?:INTEGER|TEXT)/gm)].map((m) => m[1]);
  for (const forbidden of ['stdout', 'stderr', 'output', 'prompt', 'content', 'token', 'body']) assert.ok(!columns.includes(forbidden), forbidden);
});
