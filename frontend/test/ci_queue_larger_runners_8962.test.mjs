/** D8962 (#8962): the proposed merge-queue larger-runner route, its disjointness from #7909 and the Mac, and its measurement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  CONDITION, FALLBACK, LIMITS, MAC_PART, SUITE_RUNS_ON, TARGET, VARIABLE,
  collect, evaluate, main, report, runnerKind, shardRow, summarise,
} from '../../scripts/ci/queue-larger-runners.mjs';
import { PART as MACBOOK_PART } from '../../scripts/ci/macbook-worker.mjs';
import { capacitySubmission } from '../../scripts/ci/capacity-submission.mjs';
import { executionTarget } from '../../scripts/ci/runner-admission.mjs';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';
import { partsOf } from '../../scripts/test-drift-parts.mjs';

const YAML = createRequire(new URL('../../cloudflare-worker/package.json', import.meta.url))('yaml');
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const CI = YAML.parse(read('.github/workflows/ci.yml'));
const SUITE = CI.jobs.suite;
const PARTS = partsOf(JSON.parse(read('package.json')).scripts).map(p => p.name);

test('D8962 the proposed runs-on is the catalog github-8 target in the canary form, with ubuntu-latest otherwise', () => {
  assert.deepEqual(TARGET, executionTarget(resolveCatalogProfile('github-8')));
  assert.deepEqual(TARGET, { group: 'StudioOS Included Compute', labels: ['studioos-bench-linux-8'] });
  assert.equal(VARIABLE, 'CI_QUEUE_LARGE_RUNNERS');
  assert.equal(MAC_PART, MACBOOK_PART, 'the excluded part is the one the Mac controller takes');
  // Pinned verbatim: this is the line D8962 asks the owner to put in ci.yml.
  assert.equal(SUITE_RUNS_ON,
    `\${{ fromJSON(github.event_name == 'merge_group' && startsWith(matrix.part, 'worker-') && vars.CI_QUEUE_LARGE_RUNNERS == 'true' && needs.capacity-route.outputs.accepted != 'true' && !(matrix.part == 'worker-1-of-6' && vars.MACBOOK_WORKER_ENABLED == 'true') && '{"group":"StudioOS Included Compute","labels":["studioos-bench-linux-8"]}' || '"ubuntu-latest"') }}`);
  // Same shape as the canary's expression (included_compute_7907 pins that one).
  const canary = read('.github/workflows/included-compute-canary.yml');
  assert.ok(canary.includes(`runs-on: \${{ fromJSON(matrix.lane == 'github-8' && '${JSON.stringify(TARGET)}' || '"${FALLBACK}"') }}`));
  assert.ok(SUITE_RUNS_ON.endsWith(`&& '${JSON.stringify(TARGET)}' || '"${FALLBACK}"') }}`));
});

test('D8962 ci.yml suite runs on ubuntu-latest, or on exactly the reviewed expression once the owner applies it', () => {
  const runsOn = SUITE['runs-on'];
  assert.ok(runsOn === FALLBACK || runsOn === SUITE_RUNS_ON, `suite runs-on is neither ${FALLBACK} nor D8962's expression: ${JSON.stringify(runsOn)}`);
  // runs-on reads needs.capacity-route, so suite must wait for it (it already does, D8626).
  assert.ok([].concat(SUITE.needs).includes('capacity-route'));
  assert.deepEqual(SUITE.strategy.matrix.part.includes('worker-1-of-6'), true);
});

test('D8962 evaluate reads the routing expressions and refuses anything else', () => {
  const ctx = { github: { event_name: 'merge_group' }, matrix: { part: 'worker-2-of-6' }, vars: {}, needs: { 'capacity-route': { outputs: { accepted: 'true' } } } };
  assert.equal(evaluate("${{ needs.capacity-route.outputs.accepted == 'true' }}", ctx), true);
  assert.equal(evaluate("startsWith(matrix.part, 'WORKER-')", ctx), true);
  assert.deepEqual(evaluate(`fromJSON(github.event_name == 'push' && '{"a":1}' || '"b"')`, ctx), 'b');
  for (const bad of ['process.exit(1)', "this.constructor`x`", "github.constructor.constructor('x')", 'vars.A = 1', 'vars; vars', "vars.A == 'it''s'", 'vars[0]']) {
    assert.throws(() => evaluate(bad, ctx), /unsupported/, bad);
  }
});

// Every case the three routes can meet: event, part, the two switches, and capacity-route's output
// ('' when it was skipped, which is every run while queue routing is off).
function* cases() {
  for (const event_name of ['pull_request', 'push', 'merge_group', 'workflow_dispatch'])
    for (const part of PARTS)
      for (const large of ['true', 'false', '', undefined])
        for (const mac of ['true', 'false', undefined])
          for (const accepted of ['true', 'false', ''])
            yield { event_name, part, large, mac, accepted };
}
const context = c => ({
  github: { event_name: c.event_name, ref: c.event_name === 'merge_group' ? 'refs/heads/gh-readonly-queue/main/pr-1-abc' : 'refs/heads/main' },
  matrix: { part: c.part },
  vars: { [VARIABLE]: c.large, MACBOOK_WORKER_ENABLED: c.mac },
  needs: { 'capacity-route': { outputs: { accepted: c.accepted } }, verified: { outputs: { run: '' } } },
});

test('D8962 the larger-runner route, #7909 capacity-route and the Mac never claim the same shard', async () => {
  // capacity-route cannot accept a queue candidate while the Mac is on: the submission is refused first
  // (D7881/D8626), so `accepted == 'true'` with MACBOOK_WORKER_ENABLED 'true' never reaches `suite`.
  const queueEnv = { CI_CAPACITY_ENABLED: 'true', CI_CAPACITY_QUEUE_ROUTING: 'true', MACBOOK_WORKER_ENABLED: 'true', GITHUB_EVENT_NAME: 'merge_group' };
  assert.deepEqual(await capacitySubmission(queueEnv, async () => assert.fail('a refused submission reads nothing')), { accepted: false, reason: 'macbook_worker_enabled' });
  assert.ok(PARTS.filter(p => p.startsWith('worker-')).length === 6 && PARTS.includes('rest'));
  // The other two routes are read from ci.yml as it is on this commit.
  const routed = SUITE.env.CAPACITY_ROUTED;
  const macStep = SUITE.steps.find(s => s.id === 'macbook');
  assert.match(routed, /needs\.capacity-route\.outputs\.accepted == 'true'/);
  let seen = { larger: 0, capacity: 0, mac: 0 };
  let n = 0;
  for (const c of cases()) {
    n++;
    if (c.event_name === 'merge_group' && c.accepted === 'true' && c.mac === 'true') continue; // unreachable, above
    const ctx = context(c);
    const larger = runnerKind(evaluate(SUITE_RUNS_ON, ctx)) === 'larger';
    const capacity = evaluate(routed, ctx) === true;
    const mac = Boolean(evaluate(macStep.if, ctx)) && c.part === MACBOOK_PART;
    const claims = [larger, capacity, mac].filter(Boolean).length;
    assert.ok(claims <= 1, `two routes claim ${JSON.stringify(c)}: larger ${larger}, capacity ${capacity}, mac ${mac}`);
    // Written out independently of CONDITION: the issue's rule, plus the two exclusions.
    const want = c.event_name === 'merge_group' && c.part.startsWith('worker-') && c.large === 'true'
      && c.accepted !== 'true' && !(c.part === MACBOOK_PART && c.mac === 'true');
    assert.equal(larger, want, JSON.stringify(c));
    // Anything that is not the larger group is exactly the standard hosted label.
    if (!larger) assert.equal(evaluate(SUITE_RUNS_ON, ctx), FALLBACK);
    seen = { larger: seen.larger + larger, capacity: seen.capacity + capacity, mac: seen.mac + mac };
  }
  assert.equal(n, 4 * PARTS.length * 4 * 3 * 3);
  // Each route really is reachable in the grid, so "never together" is not vacuous.
  assert.ok(seen.larger > 0 && seen.capacity > 0 && seen.mac > 0, JSON.stringify(seen));
  assert.ok(CONDITION.includes(`vars.${VARIABLE} == 'true'`));
});

// ---------------------------------------------------------------- measurement

const job = (part, over = {}) => ({
  name: `suite (${part})`, status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'], runner_group_name: 'GitHub Actions',
  created_at: '2026-11-27T10:00:00Z', started_at: '2026-11-27T10:05:00Z', completed_at: '2026-11-27T10:20:00Z',
  steps: [{ name: `Run node scripts/test-drift-parts.mjs ${part} --plan-file suite-plan.json`, conclusion: 'success', started_at: '2026-11-27T10:06:00Z', completed_at: '2026-11-27T10:19:00Z' }],
  ...over,
});
function api(runs, jobsByRun) {
  const calls = [];
  const read = path => {
    calls.push(path);
    if (path.includes('/workflows/ci.yml/runs?')) return { workflow_runs: runs };
    const id = Number(/runs\/(\d+)\/attempts/.exec(path)[1]);
    return { jobs: jobsByRun[id] };
  };
  return { read, calls };
}
const run = (id, over = {}) => ({ id, run_attempt: 1, event: 'merge_group', path: '.github/workflows/ci.yml', conclusion: 'success', head_sha: 'a'.repeat(40), created_at: '2026-11-27T10:00:00Z', ...over });

test('D8962 shard rows: runner kind from group and label, test step time, unmeasured values stay null', () => {
  const hosted = shardRow({ id: 1 }, job('worker-1-of-6'));
  assert.deepEqual(hosted, { run: 1, part: 'worker-1-of-6', runner: 'hosted', wait: 300, job: 900, tests: 780 });
  const larger = shardRow({ id: 1 }, job('worker-2-of-6', { labels: ['studioos-bench-linux-8'], runner_group_name: 'StudioOS Included Compute' }));
  assert.equal(larger.runner, 'larger');
  // The label alone is not the group.
  assert.equal(shardRow({ id: 1 }, job('worker-2-of-6', { labels: ['studioos-bench-linux-8'] })).runner, 'hosted');
  // A routed or delegated part skips its test step: not recorded, never 0.
  const skipped = shardRow({ id: 1 }, job('worker-3-of-6', { steps: [{ ...job('worker-3-of-6').steps[0], conclusion: 'skipped' }] }));
  assert.equal(skipped.tests, null);
  assert.equal(shardRow({ id: 1 }, job('worker-3-of-6', { conclusion: 'cancelled' })), null);
  assert.equal(shardRow({ id: 1 }, { ...job('rest'), name: 'test deps' }), null);
  assert.equal(shardRow({ id: 1 }, job('rest', { started_at: 'garbage' })).wait, null);
});

test('D8962 collect reads only successful merge_group ci.yml runs, GET-only allowlisted paths, bounded', () => {
  const runs = [run(11), run(12, { event: 'push' }), run(13, { conclusion: 'failure' }), run(14, { run_attempt: 2 }), run(15)];
  const jobsByRun = { 11: [job('worker-1-of-6'), job('rest')], 14: [job('worker-1-of-6', { completed_at: '2026-11-27T10:40:00Z' })], 15: [job('worker-2-of-6')] };
  const { read, calls } = api(runs, jobsByRun);
  const data = collect(read, { runs: 2 });
  assert.deepEqual(data.runs.map(r => r.run), [11, 14]);
  assert.deepEqual(calls, [
    'repos/AxalNetwork/StudioOS/actions/workflows/ci.yml/runs?event=merge_group&status=success&per_page=100&page=1',
    'repos/AxalNetwork/StudioOS/actions/runs/11/attempts/1/jobs?per_page=100&page=1',
    'repos/AxalNetwork/StudioOS/actions/runs/14/attempts/2/jobs?per_page=100&page=1',
  ]);
  assert.deepEqual(data.runs.map(r => r.workerWall), [1200, 2400]);
  assert.equal(data.rows.length, 3);
  for (const bad of [0, LIMITS.runs + 1, 1.5, NaN]) assert.throws(() => collect(read, { runs: bad }), /runs must be/);
  assert.throws(() => collect(() => ({ workflow_runs: [run('1/../../x')] }), { runs: 1 }), /path refused/);
});

test('D8962 summary: nearest-rank median and p90 per part and runner, all worker-* together, Not recorded in the table', () => {
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push({ run: i, part: 'worker-1-of-6', runner: 'hosted', wait: i * 60, job: i * 60, tests: i * 60 });
  rows.push({ run: 1, part: 'worker-2-of-6', runner: 'larger', wait: 30, job: 600, tests: null });
  const data = { runs: [{ run: 1, workerWall: 2100 }, { run: 2, workerWall: null }], rows };
  const s = summarise(data);
  const w1 = s.parts.find(p => p.part === 'worker-1-of-6');
  assert.deepEqual(w1.job, { n: 10, median: 300, p90: 540 });
  assert.deepEqual(s.parts.find(p => p.runner === 'larger').tests, { n: 0, median: null, p90: null });
  assert.deepEqual(s.workers.map(w => [w.runner, w.job.n]), [['hosted', 10], ['larger', 1]]);
  assert.deepEqual(s.workerWall, { n: 1, median: 2100, p90: 2100 });
  const text = report(data);
  assert.match(text, /\| worker-1-of-6 \| hosted \| 10 \| 5\.0 \/ 9\.0 \| 5\.0 \/ 9\.0 \| 5\.0 \/ 9\.0 \|/);
  assert.match(text, /\| worker-2-of-6 \| larger \| 1 \| 0\.5 \/ 0\.5 \| 10\.0 \/ 10\.0 \| Not recorded \/ Not recorded \|/);
  assert.match(text, /Worker wall per run .*: 35\.0 \/ 35\.0 \(n 1\)/);
});

test('D8962 the CLI rejects unknown options and prints JSON with a summary', t => {
  const out = [];
  t.mock.method(console, 'log', line => out.push(line));
  t.mock.method(console, 'error', () => {});
  assert.equal(main(['--bogus']), 2);
  const { read } = api([run(21)], { 21: [job('worker-4-of-6')] });
  assert.equal(main(['--runs', '1', '--json'], read), 0);
  const parsed = JSON.parse(out.at(-1));
  assert.equal(parsed.summary.parts[0].part, 'worker-4-of-6');
  assert.equal(parsed.workflow, 'ci.yml');
});
