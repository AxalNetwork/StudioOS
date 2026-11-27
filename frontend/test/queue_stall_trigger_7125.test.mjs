/**
 * D7125-p2 (#7125): the merge-queue stall check runs when a merge_group CI run completes (queue-stalled.yml),
 * the 15-minute schedule stays as the fallback, and `[alert] merge queue stall check failing` opens when the check
 * itself fails twice in a row (scripts/queue-stall-checker.mjs, pure half scripts/lib/queueStallChecker.mjs).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/queue_stall_trigger_7125.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  CHECKER_ALERT_TITLE, FAILURES_TO_OPEN, checkerIssueBody, checkerSlackText, checkerTransition, readCheckerState,
} from '../../scripts/lib/queueStallChecker.mjs';
import { QUEUE_STALLED } from '../../scripts/lib/landPr.mjs';
import { BREAKER_ALERTS } from '../../scripts/landing-bot/rules.mjs';

const ROOT = process.cwd();
const wf = (name) => parse(readFileSync(resolve(ROOT, '.github/workflows', name), 'utf8'));
const AT = '2026-11-23T23:50:00.000Z';
const RUN = (n) => `https://github.com/AxalNetwork/StudioOS/actions/runs/${n}`;
const fresh = readCheckerState('');

/** Every repository file a script loads through relative imports, itself included (as workflow_sparse_imports_8314). */
function importClosure(entry) {
  const seen = new Set();
  const walk = (file) => {
    const rel = relative(ROOT, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gm)) walk(resolve(dirname(file), m[1] || m[2]));
  };
  walk(resolve(ROOT, entry));
  return [...seen];
}

test('the watchdog opens at the second failed check in a row, and only a successful check resets it', () => {
  // Mutation checked: FAILURES_TO_OPEN set to 1 (the first failure opened) and to 3 (the second did not).
  const one = checkerTransition(fresh, { outcome: 'failure', runUrl: RUN(1), at: AT });
  assert.deepEqual([one.action, one.state.failures, one.state.since], ['none', 1, AT]);
  const two = checkerTransition(one.state, { outcome: 'failure', runUrl: RUN(2), at: '2026-11-24T00:05:00.000Z' });
  assert.deepEqual([two.action, two.state.failures, two.state.since], ['open', 2, AT], 'the first failure time is kept');
  assert.deepEqual(two.state.runs, [RUN(1), RUN(2)]);
  assert.equal(FAILURES_TO_OPEN, 2);
  // Already open: no second issue.
  assert.equal(checkerTransition(two.state, { outcome: 'failure', issueOpen: true }).action, 'none');
  // Mutation checked: `issueOpen ? 'close' : 'none'` inverted.
  const ok = checkerTransition(two.state, { outcome: 'success', issueOpen: true });
  assert.deepEqual([ok.action, ok.state.failures, ok.state.runs], ['close', 0, []]);
  assert.equal(checkerTransition(two.state, { outcome: 'success' }).action, 'none');
  // A success between two failures: no alert.
  const again = checkerTransition(checkerTransition(one.state, { outcome: 'success' }).state, { outcome: 'failure' });
  assert.deepEqual([again.action, again.state.failures], ['none', 1]);
});

test('a timed-out (cancelled) or never-run (skipped) check counts as failed; any other outcome is an error', () => {
  // Mutation checked: 'cancelled' removed from the failed outcomes.
  const c = checkerTransition(fresh, { outcome: 'cancelled' });
  assert.equal(checkerTransition(c.state, { outcome: 'skipped' }).action, 'open');
  for (const bad of ['', undefined, 'neutral', 'Success']) assert.throws(() => checkerTransition(fresh, { outcome: bad }), /check_outcome_invalid/);
});

test('the saved count: garbage or a missing file starts fresh; the run list keeps the newest five', () => {
  for (const text of ['', 'not json', '{"schema":2,"failures":3}', '{"schema":1,"failures":-1}', '{"schema":1,"failures":"2"}', null]) {
    assert.deepEqual(readCheckerState(text), { schema: 1, failures: 0, since: null, runs: [] }, String(text));
  }
  assert.deepEqual(readCheckerState('{"schema":1,"failures":4,"since":"x","runs":["a",3,"b"]}'), { schema: 1, failures: 4, since: 'x', runs: ['a', 'b'] });
  let s = fresh;
  for (let i = 1; i <= 7; i++) s = checkerTransition(s, { outcome: 'failure', runUrl: RUN(i) }).state;
  assert.deepEqual(s.runs, [3, 4, 5, 6, 7].map(RUN));
});

test('the checker alert is its own title: it closes no landing gate', () => {
  // A crashed check means "unknown", never a stall (D7125); gate 7, the feeder breaker and the ejection handler match exact titles.
  assert.equal(CHECKER_ALERT_TITLE, '[alert] merge queue stall check failing');
  assert.notEqual(CHECKER_ALERT_TITLE, QUEUE_STALLED);
  assert.ok(!BREAKER_ALERTS.includes(CHECKER_ALERT_TITLE));
  const body = checkerIssueBody({ schema: 1, failures: 2, since: AT, runs: [RUN(1), RUN(2)] });
  assert.match(body, /has failed 2 times in a row, the first at 2026-11-23T23:50:00\.000Z/);
  assert.match(body, /- https:\/\/github\.com\/AxalNetwork\/StudioOS\/actions\/runs\/2/);
  assert.match(checkerSlackText('open', { failures: 2, runUrl: RUN(2), issueUrl: 'https://github.com/AxalNetwork/StudioOS/issues/9' }), /failed 2 times in a row\.\* <https:\/\/github\.com\/AxalNetwork\/StudioOS\/actions\/runs\/2\|run> <https:\/\/github\.com\/AxalNetwork\/StudioOS\/issues\/9\|issue>/);
  assert.match(checkerSlackText('close'), /recovered/);
});

test('the watchdog imports nothing the check imports: only node: modules and its import-free pure half', () => {
  // Mutation checked: `import { SUMMARY_JOBS } from './ciClassify.mjs'` added to lib/queueStallChecker.mjs.
  assert.deepEqual(importClosure('scripts/queue-stall-checker.mjs').sort(), ['scripts/lib/queueStallChecker.mjs', 'scripts/queue-stall-checker.mjs']);
  for (const f of ['scripts/queue-stall-checker.mjs', 'scripts/lib/queueStallChecker.mjs']) {
    const specifiers = [...readFileSync(resolve(ROOT, f), 'utf8').matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.deepEqual(specifiers.filter((s) => !s.startsWith('node:') && s !== './lib/queueStallChecker.mjs'), [], f);
  }
});

/** Runs the watchdog against a simulated GitHub and Slack; returns its output, the calls and the saved count. */
function runWatchdog({ outcome, saved, issues = [], listing = 'ok' }) {
  const dir = mkdtempSync(join(tmpdir(), 'q7125p2-'));
  const file = join(dir, 'state.json');
  if (saved !== undefined) writeFileSync(file, saved);
  const code = `
    const { issues, listing } = JSON.parse(process.env.Q_FIXTURE);
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      console.log('CALL ' + (init.method || 'GET') + ' ' + u.host + u.pathname + (init.body ? ' ' + init.body : ''));
      if (u.host === 'hooks.example') return new Response('ok');
      if (!init.method && u.pathname.endsWith('/issues')) return listing === 'fail' ? new Response('', { status: 502 }) : Response.json(issues);
      if (init.method === 'POST' && u.pathname.endsWith('/issues')) return Response.json({ number: 77, html_url: 'https://github.com/AxalNetwork/StudioOS/issues/77' });
      return Response.json({});
    };`;
  const child = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(code), 'scripts/queue-stall-checker.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_TOKEN: 'fixture', GITHUB_RUN_ID: '45000000001', GITHUB_SERVER_URL: 'https://github.com',
      SLACK_GITHUB_WEBHOOK_URL: 'https://hooks.example/x', CHECK_OUTCOME: outcome, STATE_FILE: file, Q_FIXTURE: JSON.stringify({ issues, listing }) },
  });
  let state = null;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none written */ }
  rmSync(dir, { recursive: true, force: true });
  return { status: child.status, out: child.stdout, calls: child.stdout.split('\n').filter((l) => l.startsWith('CALL ')), state };
}

test('CLI: the second failure opens the issue with the exact title and tells Slack; the first does not', () => {
  const first = runWatchdog({ outcome: 'failure' });
  assert.equal(first.status, 0);
  assert.equal(first.state.failures, 1);
  assert.ok(!first.calls.some((c) => c.startsWith('CALL POST')), first.out);
  const second = runWatchdog({ outcome: 'failure', saved: JSON.stringify(first.state) });
  assert.equal(second.status, 0, second.out);
  assert.equal(second.state.failures, 2);
  const post = second.calls.find((c) => c.startsWith('CALL POST api.github.com/repos/AxalNetwork/StudioOS/issues '));
  assert.ok(post, second.out);
  assert.equal(JSON.parse(post.slice(post.indexOf('{'))).title, '[alert] merge queue stall check failing');
  assert.ok(second.calls.some((c) => c.startsWith('CALL POST hooks.example/x') && /failed 2 times in a row/.test(c)));
});

test('CLI: a successful check closes the open checker alert; an unrelated open alert is left alone', () => {
  const open = [{ number: 5, title: QUEUE_STALLED }, { number: 66, title: CHECKER_ALERT_TITLE, html_url: 'https://github.com/AxalNetwork/StudioOS/issues/66' }];
  const r = runWatchdog({ outcome: 'success', saved: '{"schema":1,"failures":3,"since":null,"runs":[]}', issues: open });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.state.failures, 0);
  assert.ok(r.calls.some((c) => c.startsWith('CALL POST api.github.com/repos/AxalNetwork/StudioOS/issues/66/comments')));
  assert.ok(r.calls.some((c) => c === 'CALL PATCH api.github.com/repos/AxalNetwork/StudioOS/issues/66 {"state":"closed","state_reason":"completed"}'));
  assert.ok(!r.calls.some((c) => /issues\/5\b/.test(c)));
  // Still failing while open: no new issue.
  const still = runWatchdog({ outcome: 'failure', saved: '{"schema":1,"failures":2,"since":null,"runs":[]}', issues: open });
  assert.ok(!still.calls.some((c) => c.startsWith('CALL POST')), still.out);
});

test('CLI: an unreadable issue listing fails the step, and the count is saved first', () => {
  // Mutation checked: the early writeFileSync removed (the count stayed at 1).
  const r = runWatchdog({ outcome: 'failure', saved: '{"schema":1,"failures":1,"since":null,"runs":[]}', listing: 'fail' });
  assert.equal(r.status, 1);
  assert.match(r.out, /::error::queue-stall-checker: github_http_502/);
  assert.equal(r.state.failures, 2);
});

test('queue-stalled.yml: workflow_run on CI completion only, merge_group runs of this repository, no cancelled or skipped run', () => {
  const src = readFileSync(resolve(ROOT, '.github/workflows/queue-stalled.yml'), 'utf8');
  const y = wf('queue-stalled.yml');
  assert.deepEqual(y.on, { workflow_run: { workflows: ['CI'], types: ['completed'] } });
  assert.equal(wf('ci.yml').name, 'CI', 'workflows: [CI] names ci.yml');
  assert.deepEqual(y.permissions, {});
  assert.deepEqual(Object.keys(y.jobs), ['queue-stalled']);
  const cond = y.jobs['queue-stalled'].if;
  // Mutation checked: `merge_group` → `pull_request` in the job's if.
  for (const part of ["github.event.workflow_run.event == 'merge_group'", 'github.event.workflow_run.head_repository.full_name == github.repository',
    "github.event.workflow_run.conclusion != 'cancelled'", "github.event.workflow_run.conclusion != 'skipped'", "github.repository == 'AxalNetwork/StudioOS'"]) {
    assert.ok(cond.includes(part), part);
  }
  assert.doesNotMatch(src, /workflow_run\.(head_branch|head_sha|display_title|head_commit|pull_requests|id)\b/, 'nothing of the run is read but its event, repository and conclusion');
});

test('both queue-stalled jobs: the same steps, token and concurrency group; the schedule stays as the fallback', () => {
  const sched = wf('github-alerts.yml');
  const a = sched.jobs['queue-stalled'], b = wf('queue-stalled.yml').jobs['queue-stalled'];
  // Mutation checked: queue-stalled.yml's check step timeout changed to 5.
  assert.deepEqual(b.steps, a.steps);
  assert.deepEqual(b.permissions, a.permissions);
  assert.deepEqual(a.permissions, { contents: 'read', actions: 'read', checks: 'read', 'pull-requests': 'read', issues: 'write' });
  assert.equal(b['timeout-minutes'], a['timeout-minutes']);
  // Mutation checked: queue-stalled.yml's group renamed (a burst then ran beside the schedule).
  for (const j of [a, b]) assert.deepEqual(j.concurrency, { group: 'github-alerts-queue-stalled', 'cancel-in-progress': false });
  assert.match(a.if, /github\.event\.schedule == '\*\/15 \* \* \* \*'/);
  assert.ok(sched.on.schedule.some((s) => s.cron === '*/15 * * * *'));

  const names = a.steps.map((s) => s.id || s.name || s.uses);
  const at = (n) => names.indexOf(n);
  const check = a.steps.find((s) => s.id === 'check');
  assert.equal(check.run, 'node scripts/github-alerts.mjs queue-stalled');
  assert.ok(check['timeout-minutes'] < a['timeout-minutes'], 'a hung check leaves the job time for the watchdog');
  const watch = a.steps.find((s) => s.run === 'node scripts/queue-stall-checker.mjs');
  // Mutation checked: the watchdog's `always() &&` removed (it would be skipped when the check fails).
  assert.match(watch.if, /^always\(\) && github\.ref == 'refs\/heads\/main'$/);
  assert.equal(watch.env.CHECK_OUTCOME, '${{ steps.check.outcome }}');
  assert.equal(watch.env.STATE_FILE, '${{ runner.temp }}/queue-stall-checker.json');
  const restore = a.steps.find((s) => /actions\/cache\/restore@/.test(s.uses || ''));
  const save = a.steps.find((s) => /actions\/cache\/save@/.test(s.uses || ''));
  assert.ok(at(restore.name) < at('check') && at('check') < at(watch.name) && at(watch.name) < at(save.name));
  for (const s of [restore, save]) {
    assert.match(s.if, /^always\(\)/);
    assert.equal(s.with.path, watch.env.STATE_FILE);
    assert.equal(s.with.key, 'queue-stall-checker-v1-${{ github.run_id }}-${{ github.run_attempt }}');
  }
  assert.equal(restore.with['restore-keys'], 'queue-stall-checker-v1-');
});
