/** D5501: disposable promotion fixtures over the real Actions admission decision. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCandidate } from '../verify-production-candidate.mjs';
import { checkProductionQueues } from '../check-production-queues.mjs';
import { classifyStartup } from '../check-worker-startup.mjs';

const repo = 'AxalNetwork/StudioOS';
const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const contexts = {
  'ci.yml': ['frontend (build)', 'worker (typecheck)', 'api ↔ worker drift', 'test:drift (full suite)'],
  'migration-immutability.yml': ['applied migrations unchanged'],
  'gitleaks.yml': ['scan'],
};

function actions({ candidate = a, main = candidate, runChange = {}, jobChange = {}, missing = false, missingJob = false, olderRun = false, onRead } = {}) {
  const files = Object.keys(contexts);
  return async path => {
    onRead?.(path);
    if (path.endsWith('/git/ref/heads/main')) return { ref: 'refs/heads/main', object: { type: 'commit', sha: main } };
    const runPath = /\/workflows\/([^/]+)\/runs\?(.*)$/.exec(path);
    if (runPath) {
      const [, file, query] = runPath;
      if (new URLSearchParams(query).get('head_sha') !== candidate) throw new Error('Unexpected candidate');
      if (file === 'ci.yml' && missing) return { workflow_runs: [] };
      const run = { id: files.indexOf(file) + 11, path: `.github/workflows/${file}`, head_sha: candidate, head_branch: 'main',
        event: 'push', head_repository: { full_name: repo }, repository: { full_name: repo }, run_attempt: 2, status: 'completed' };
      return { workflow_runs: file === 'ci.yml' ? [...(olderRun ? [{ ...run, id: run.id - 1 }] : []), { ...run, ...runChange }] : [run] };
    }
    const [, rawId, rawAttempt] = /\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?/.exec(path) ?? [];
    const id = Number(rawId), attempt = Number(rawAttempt);
    if (attempt !== 2) throw new Error('Expected current attempt');
    return { jobs: contexts[files[id - 11]].map((name, i) => ({ id: id * 10 + i, name, run_id: id, run_attempt: 2,
      head_sha: candidate, head_branch: 'main', status: 'completed', conclusion: 'success', ...(id === 11 && i === 0 ? jobChange : {}) })).filter((_, i) => !(missingJob && id === 11 && i === 0)) };
  };
}

async function rehearse({ get = actions(), recheck = get, queueNames = ['prod-jobs', 'prod-dlq'], active = 250, publishFails = false } = {}) {
  const events = [];
  if ((await verifyCandidate(a, get)).status !== 'verified') return events;
  const queues = await checkProductionQueues({ names: ['prod-jobs', 'prod-dlq'], account: a.slice(0, 32), token: 'fixture',
    fetchImpl: async () => Response.json({ success: true, result: queueNames.map(queue_name => ({ queue_name })), result_info: { page: 1, total_pages: 1 } }) });
  if (queues.status !== 'verified' || classifyStartup([active, active, active].map(activeMs => ({ activeMs }))) !== 'verified') return events;
  if ((await verifyCandidate(a, recheck)).status !== 'verified') return events;
  events.push('migrate', 'publish');
  if (!publishFails) events.push('smoke');
  return events;
}

test('only the six checks from their trusted push workflows admit a candidate', async () => {
  const result = await verifyCandidate(a, actions());
  assert.deepEqual([result.status, result.checks.flatMap(x => x.checks.map(y => y.context))], ['verified', Object.values(contexts).flat()]);
  assert.deepEqual(await rehearse(), ['migrate', 'publish', 'smoke']);
  assert.equal((await verifyCandidate(a, actions({ missingJob: true }))).status, 'waiting');
});

test('missing, pending, failed, cancelled, skipped and wrong-identity results write and publish nothing', async () => {
  const denied = [
    { missing: true }, { missingJob: true }, { runChange: { status: 'in_progress' }, jobChange: { status: 'queued' } },
    { jobChange: { conclusion: 'failure' }, olderRun: true }, { jobChange: { conclusion: 'cancelled' } },
    { jobChange: { conclusion: 'skipped' } }, { jobChange: { head_sha: b } }, { jobChange: { run_attempt: 1 } },
    { runChange: { event: 'pull_request' } }, { runChange: { event: 'merge_group', head_sha: b } },
    { runChange: { path: '.github/workflows/copied.yml' } }, { runChange: { head_repository: { full_name: 'Example/StudioOS' } } },
  ];
  assert.deepEqual(await Promise.all(denied.map(opts => rehearse({ get: actions(opts) }))), denied.map(() => []));
});

test('missing production DLQ, over-budget startup, and a newer main under the lock stop before D1', async () => {
  assert.deepEqual(await Promise.all([
    rehearse({ queueNames: ['prod-jobs', 'preview-dlq'] }), rehearse({ active: 801 }),
    rehearse({ recheck: actions({ main: b }) }),
  ]), [[], [], []]);
});

test('a publish failure leaves migrations recorded and skips smoke without an automatic D1 downgrade', async () => {
  assert.deepEqual(await rehearse({ publishFails: true }), ['migrate', 'publish']);
});

const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const steps = source => source.split(/^      - name: /m).slice(1).map(step => step.trim());

test('real workflow gates the two mutation steps, retains diagnostics, and shares the manual D1 lock', () => {
  const source = workflow('cloudflare-worker-deploy');
  const deploy = source.split('\n  deploy:\n')[1].split('\n  spa-smoke:\n')[0];
  const phase = steps(deploy).filter(x => /^(Verify required production queues|Check the prepared Worker startup budget|Confirm the candidate still owns the production release|Apply pending D1 migrations|Deploy to Cloudflare Worker)$/.test(x.split('\n')[0]));
  assert.deepEqual(phase.map(x => x.split('\n')[0]), ['Verify required production queues', 'Check the prepared Worker startup budget',
    'Confirm the candidate still owns the production release', 'Apply pending D1 migrations', 'Deploy to Cloudflare Worker']);
  assert.ok(phase.every(step => !/^        (?:if:|continue-on-error:)/m.test(step)));
  assert.match(phase[0], /node scripts\/check-production-queues\.mjs/);
  assert.match(phase[1], /bash scripts\/prepare-production-worker\.sh/);
  assert.match(deploy, /needs: admission[\s\S]*group: studioos-production-release[\s\S]*cancel-in-progress: false/);
  assert.match(deploy, /Retain release evidence on success or failure\n        if: always\(\)/);
  const manual = workflow('d1-migrate');
  assert.match(manual, /inputs\.mode == 'dry-run'.*'studioos-branch-rollout' \|\| 'studioos-production-release'/);
  const manualStages = ['Check production queues before manual D1 writes', 'Check Worker startup before manual D1 writes',
    'Confirm the manual D1 candidate is still admitted', 'Baseline the production ledger', 'Adopt the legacy ledger and baseline',
    'Verify marked rows against the live schema', 'Apply pending migrations'];
  assert.deepEqual(steps(manual).map(step => step.split('\n')[0]).filter(name => manualStages.includes(name)), manualStages);
});
