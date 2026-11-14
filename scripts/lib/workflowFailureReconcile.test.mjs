// D6387: exact delivery hints, paginated reconciliation and durable progress after a successful scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reportAttempt, reconcileFailures, requestedAttempts } from '../workflow-failure-reconcile.mjs';

const repo = 'AxalNetwork/StudioOS';
const root = '/repos/' + repo + '/actions/runs';
const now = Date.parse('2026-11-14T12:00:00Z');
const hr = 3_600_000;
const iso = time => new Date(time).toISOString();
function run(id, extra = {}) {
  return { id, repository: { full_name: repo }, workflow_id: 31, run_attempt: 1, status: 'completed',
    created_at: iso(now - 1000), updated_at: iso(now), conclusion: 'failure', ...extra };
}
function fixture(runs, attempts = [], custom = {}) {
  const calls = [], reports = [], evidence = [];
  const api = async path => {
    calls.push(path);
    if (custom.api) {
      const result = await custom.api(path);
      if (result !== undefined) return result;
    }
    const url = new URL('https://api.github.com' + path);
    if (url.pathname === root) {
      const [from, to] = url.searchParams.get('created').split('..').map(Date.parse);
      const start = (Number(url.searchParams.get('page')) - 1) * 100;
      const rows = runs.filter(r => from <= Date.parse(r.created_at) && Date.parse(r.created_at) <= to);
      return { total_count: rows.length, workflow_runs: rows.slice(start, start + 100) };
    }
    const [, id, attempt, jobs] = path.match(/\/runs\/(\d+)(?:\/attempts\/(\d+))?(\/jobs)?/);
    if (jobs) return { total_count: 0, jobs: [] };
    const exact = [...runs, ...attempts].find(r => r.id === Number(id) && (!attempt || Number(attempt) === r.run_attempt));
    if (!exact) throw Object.assign(new Error('not_found'), { status: 404 });
    return exact;
  };
  return { api, calls, reports, evidence,
    reporter: { report: async input => { reports.push(input); return { action: 'created', issueNumber: 21 }; } },
    hints: async input => { evidence.push(input); return { inheritedIssueNumber: 7 }; },
  };
}

test('input selects a bounded, deduplicated list of exact attempts or the scheduled sweep', () => {
  assert.deepEqual(requestedAttempts({}), []);
  assert.deepEqual(requestedAttempts({ RUN_ID: '82', RUN_ATTEMPT: '2' }), [[82, 2]]);
  assert.deepEqual(requestedAttempts({ ATTEMPTS: '[[82,2],[82,2],[82,3]]' }), [[82, 2], [82, 3]]);
  for (const env of [{ RUN_ID: '2; echo' }, { RUN_ATTEMPT: '2' }, { ATTEMPTS: '{}'}, {ATTEMPTS:'[]'},
    { ATTEMPTS: '[[1,0]]' }, { ATTEMPTS: '[[1,"2"]]' }, { ATTEMPTS: '[[1,2]]', RUN_ID: '1' },
    { ATTEMPTS: JSON.stringify(Array(21).fill([1, 2])) }]) assert.throws(() => requestedAttempts(env));
});

test('targeted delivery validates exact attempt, all job pages and trusted hints before writing', async () => {
  const current = run(11, { run_attempt: 3 });
  const jobs = Array.from({ length: 101 }, (_, i) => ({ id: 400 + i, run_id: 11, run_attempt: 3 }));
  const f = fixture([current], [], { api: path => {
    if (path.includes('/jobs?')) return { total_count: 101, jobs: path.endsWith('page=1') ? jobs.slice(0, 100) : jobs.slice(100) };
  } });
  assert.deepEqual(await reportAttempt(f, 11, 3), { action: 'created', issueNumber: 21 });
  assert.equal(f.reports[0].jobs.length, 101);
  assert.equal(f.reports[0].inheritedIssueNumber, 7);
  assert.deepEqual(f.evidence[0].run, current);
  const invalid = fixture([current], [], { api: () => ({ ...current, id: 17 }) });
  await assert.rejects(reportAttempt(invalid, 11, 3), /unverified_run_identity/);
  assert.equal(invalid.reports.length, 0);
  const missing = fixture([current], [], { api: p => p.includes('/jobs?') ? { total_count: 3, jobs: [] } : undefined });
  await assert.rejects(reportAttempt(missing, 11, 3), /incomplete_jobs/);
});

test('paginated bootstrap reports actionable terminal states and preserves unfinished runs', async () => {
  const rows = Array.from({ length: 105 }, (_, i) => run(i + 1, { conclusion: 'success' }));
  rows[0] = run(1, { run_attempt: 2, conclusion: 'cancelled' });
  rows[4] = run(5, { status: 'in_progress', conclusion: null });
  rows[104] = run(105, { conclusion: 'timed_out' });
  const f = fixture(rows, [run(1)]);
  const state = await reconcileFailures(f, undefined, now);
  assert.equal(state.until, now);
  assert.deepEqual(f.reports.map(o => [o.run.id, o.run.run_attempt]), [[1, 1], [105, 1]]);
  assert.equal(state.tracked.find(row => row.id === 5).pending, true);
  assert.ok(f.calls.some(p => p.endsWith('page=2')));
  rows[4] = run(5, { conclusion: 'action_required' });
  f.reports.length = 0;
  const next = await reconcileFailures(f, state, now + hr);
  assert.deepEqual(f.reports.map(o => o.run.id), [5]);
  assert.deepEqual(next.tracked, []);
});

test('a rerun on an old creation is discovered in the history sweep without backfilling pre-activation failures', async () => {
  const creation = iso(now - 8 * hr);
  const current = run(3, { run_attempt: 2, created_at: creation, updated_at: iso(now - hr), conclusion: 'failure' });
  const other = run(4, { created_at: creation, updated_at: iso(now - 7 * hr) });
  const f = fixture([current, other], [run(3, { created_at: creation, updated_at: iso(now - 8 * hr) })]);
  const state = { version: 1, activation: now - 2 * hr, until: now - 300000, auditBefore: now - 7 * hr, tracked: [] };
  await reconcileFailures(f, state, now);
  assert.deepEqual(f.reports.map(x => [x.run.id, x.run.run_attempt]), [[3, 2]]);
});

test('an incomplete source or rejected write never advances the input checkpoint', async () => {
  const state = { version: 1, activation: now - hr, until: now - 300000, tracked: [] };
  const f = fixture([run(1)]);
  f.reporter.report = async () => { throw new Error('issues_unavailable'); };
  await assert.rejects(reconcileFailures(f, state, now), /issues_unavailable/);
  assert.equal(state.until, now - 300000);
  const truncated = fixture([], [], { api: () => ({ total_count: 2, workflow_runs: [run(1)] }) });
  await assert.rejects(reconcileFailures(truncated, state, now), /incomplete_run_window/);
  assert.equal(truncated.reports.length, 0);
});

test('trusted job checks out main, serializes all writers, and passes dispatch values through environment', () => {
  const yaml = readFileSync(new URL('../../.github/workflows/github-alerts.yml', import.meta.url), 'utf8');
  const job = yaml.split('\n  workflow-failures:\n')[1].split('\n  queue-stalled:\n')[0];
  assert.match(job, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job, /ref: refs\/heads\/main/);
  const mainRed = yaml.split('\n  main-red:\n')[1].split('\n  queue:\n')[0];
  for (const writer of [job, mainRed]) assert.match(writer, /group: github-health-main-red\n      queue: max/);
  assert.match(job, /checks: read\n      issues: write/);
  assert.match(job, /ATTEMPTS: \$\{\{ inputs\.attempts \}\}/);
  assert.doesNotMatch(job, /run:.*\$\{\{|contents: write|secrets\./);
});

test('dense pending cohorts are re-read by hour, preserving waiters without one request per queued run', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => run(i + 1, { created_at: iso(now - 3 * hr), conclusion: 'cancelled' }));
  rows[0].conclusion = 'failure';
  rows[3].status = 'queued';
  rows[3].conclusion = null;
  const state = { version: 1, until: now - 300000, activation: now - 4 * hr,
    tracked: rows.map(r => ({ id: r.id, created: Date.parse(r.created_at), done: 0, pending: true })) };
  const f = fixture(rows);
  const next = await reconcileFailures(f, state, now);
  assert.deepEqual(next.tracked.map(row => row.id), [4]);
  assert.deepEqual(f.reports.map(input => input.run.id), [1]);
  assert.equal(f.calls.filter(p => /\/runs\/\d+$/.test(p)).length, 0);
});

test('creation windows split at the GitHub 1,000-result limit and keep every eligible attempt', async () => {
  const rows = Array.from({ length: 1002 }, (_, i) => run(i + 1, {
    created_at: iso(now - hr + (i + 1) * 1000),
    conclusion: i === 1001 ? 'failure' : 'success',
  }));
  const f = fixture(rows);
  await reconcileFailures(f, undefined, now);
  assert.deepEqual(f.reports.map(input => input.run.id), [1002]);
  assert.ok(f.calls.filter(p => p.includes('created=') && p.endsWith('page=1')).length >= 3);
});

test('a still-running dispatch hint leaves an explicit failure for replay', async () => {
  const f = fixture([run(17, { status: 'in_progress', conclusion: null })]);
  await assert.rejects(reportAttempt(f, 17, 1), /attempt_not_terminal/);
  assert.deepEqual(f.reports, []);
});

test('corrupt checkpoint data cannot drive API calls or write issues', async () => {
  const f = fixture([]);
  await assert.rejects(reconcileFailures(f, { version: 1, activation: now, until: now, auditBefore: now + hr, tracked: [] }, now), /invalid_failure_checkpoint/);
  await assert.rejects(reconcileFailures(f, { version: 1, activation: now - hr, until: now,
    tracked: [{ id: 'user-control', done: 0, pending: true, created: now - hr }] }, now), /invalid_failure_checkpoint/);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reports, []);
});
