/**
 * D5398 (#5398) — one broken merge must not make every PR chase the same failure.
 *
 *  · the classifier labels a PR's red CI as inherited only when every failed part is red on main too, calls anything
 *    else the PR's own, and says "unknown" when main's state cannot be read: it never turns a failure green;
 *  · the gate job runs it only after a PR failure, read-only, unable to change the result;
 *  · the future-clock alert is one issue, opened on the first failing night and closed on the first clean one;
 *  · an open queue alert clears only well below its thresholds (hysteresis);
 *  · the red-main protocol is written where every agent reads it.
 *
 *   node --test frontend/test/ci_reliability_5398.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classify, summary, VERDICTS } from '../../scripts/lib/ciClassify.mjs';
import { ALERT_KINDS, QUEUE_CLEAR_RATIO, QUEUE_DEFAULTS, message, queueState, transition } from '../../scripts/lib/githubAlerts.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const job = (name, conclusion) => ({ name, conclusion });
const W1 = 'suite (worker-1-of-6)'; const F2 = 'suite (frontend-2-of-2)'; const GATE = 'test:drift (full suite)';

test('inherited only when every failed part is red on main too', () => {
  const main = { conclusion: 'failure', jobs: [job(W1, 'failure'), job(F2, 'failure'), job(GATE, 'failure'), job('worker (typecheck)', 'success')] };
  const r = classify({ pr: [job(W1, 'failure'), job(GATE, 'failure'), job(F2, 'success')], main, incident: 'https://github.com/o/r/issues/1' });
  assert.equal(r.verdict, 'inherited_main_failure');
  assert.deepEqual([r.shared, r.own], [[W1], []]);
  const text = summary(r, { mainRunUrl: 'https://github.com/o/r/actions/runs/2' });
  assert.match(text, /inherited_main_failure/);
  assert.match(text, /issues\/1/);
  assert.match(text, /can still hide a PR-only failure/, 'the label says what it cannot prove');
});

test('a part that passed on main is the PR\'s own, even beside inherited ones', () => {
  const main = { conclusion: 'failure', jobs: [job(W1, 'failure'), job(F2, 'success')] };
  const r = classify({ pr: [job(W1, 'failure'), job(F2, 'failure')], main });
  assert.equal(r.verdict, 'pr_failure');
  assert.deepEqual([r.own, r.shared], [[F2], [W1]]);
  assert.match(summary(r), /This PR's own: `suite \(frontend-2-of-2\)`/);
  // Main green: every failure is the PR's.
  assert.equal(classify({ pr: [job(W1, 'failure')], main: { conclusion: 'success', jobs: [job(W1, 'success')] } }).verdict, 'pr_failure');
});

test('main unread, unfinished or cancelled is unknown, never inherited', () => {
  const pr = [job(W1, 'failure')];
  for (const main of [null, { conclusion: 'cancelled', jobs: [job(W1, 'failure')] }, { conclusion: null, jobs: [] }, { conclusion: 'failure' }]) {
    assert.equal(classify({ pr, main }).verdict, 'main_health_unknown', JSON.stringify(main));
  }
  assert.equal(classify({ pr: [], main: { conclusion: 'failure', jobs: [job(W1, 'failure')] } }).verdict, 'pr_failure', 'no failed part found: read it, never inherited');
  assert.deepEqual(VERDICTS, ['pr_failure', 'inherited_main_failure', 'main_health_unknown']);
});

test('the classifier is its own job, after a PR failure only, read-only, outside the gate and unable to fail', () => {
  const ci = read('.github/workflows/ci.yml');
  const gate = ci.slice(ci.indexOf('  gate:\n'), ci.indexOf('\n  classify:'));
  assert.ok(!gate.includes('ci-classify'), 'the required gate is untouched');
  const job = ci.slice(ci.indexOf('  classify:\n'), ci.indexOf('\n  visual:'));
  assert.match(job, /needs: suite\n\s+if: failure\(\) && github\.event_name == 'pull_request'/);
  assert.match(job, /continue-on-error: true/);
  assert.match(job, /permissions:\n\s+contents: read\n\s+actions: read\n\s+issues: read\n\s+steps:/);
  assert.ok(!/: write/.test(job), 'no write permission');
  assert.match(job, /run: node scripts\/ci-classify\.mjs/);
  assert.match(read('scripts/ci-classify.mjs'), /main\(\)\.catch\(\(e\) => console\.log\(`::warning::/, 'every error exits 0');
});

test('the future-clock alert is one issue: open on the first failure, quiet while failing, closed on recovery', () => {
  assert.equal(ALERT_KINDS['future-clock'].title, '[alert] future-clock tests failing');
  assert.equal(transition(true, false), 'open');
  assert.equal(transition(true, true), 'none', 'a second failing night posts nothing');
  assert.equal(transition(false, true), 'close');
  assert.equal(transition(null, true), 'none', 'no log is unknown, never recovered');
  assert.match(message('future-clock', 'open', { days: 7, failures: { names: ['a test'], more: 0 }, issueUrl: 'https://i' }), /a test[\s\S]*<https:\/\/i\|issue>/);
  const cli = read('scripts/github-alerts.mjs');
  assert.match(cli, /const active = tap\.trim\(\) \? failures\.names\.length \+ failures\.more > 0 : null;/);
  assert.match(cli, /return apply\('future-clock', active,/);
});

test('queue hysteresis: open at the thresholds, clear only below half of both', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  assert.equal(QUEUE_CLEAR_RATIO, 0.5);
  assert.equal(queueState({ queued: QUEUE_DEFAULTS.queued, oldestCreatedAt: ago(1), now }).active, true, 'opens at the threshold');
  assert.equal(queueState({ queued: 30, oldestCreatedAt: ago(30), now }).active, false, 'closed: under the line stays closed');
  assert.equal(queueState({ queued: 30, oldestCreatedAt: ago(30), now, issueOpen: true }).active, true, 'open: hovering under the line stays open');
  assert.equal(queueState({ queued: 19, oldestCreatedAt: ago(22), now, issueOpen: true }).active, false, 'open: clears below half of both');
  assert.equal(queueState({ queued: 19, oldestCreatedAt: ago(23), now, issueOpen: true }).active, true, 'one figure still high keeps it open');
  assert.match(read('scripts/github-alerts.mjs'), /issueOpen: Boolean\(await openIssue\('queue'\)\)/);
});

test('the red-main and queue protocol is where every agent reads it', () => {
  const agents = read('AGENTS.md');
  for (const rule of [/### Red main and a backed-up queue \(D5398\)/, /exactly one repair PR/i, /never port/i, /never merge `main` into/i, /re-run/i]) assert.match(agents, rule);
  assert.match(read('CLAUDE.md'), /YYYYMMDDHHMM_<issue>_<slug>\.sql/);
  assert.match(read('AGENTS.md'), /YYYYMMDDHHMM_<issue>_<slug>\.sql/);
});

test('only safe job names and github.com links reach the job summary (CodeQL: network data written to a file)', async () => {
  const { safeJobName, safeGithubUrl } = await import('../../scripts/lib/ciClassify.mjs');
  assert.equal(safeJobName('suite (worker-1-of-6)'), 'suite (worker-1-of-6)');
  assert.equal(safeJobName('api ↔ worker drift'), 'api ↔ worker drift');
  for (const bad of ['x\n## injected', '<img src=x>', '[a](https://evil.example)', 'a'.repeat(101), '`code`']) assert.equal(safeJobName(bad), '', bad);
  assert.equal(safeGithubUrl('https://github.com/o/r/issues/12'), 'https://github.com/o/r/issues/12');
  assert.equal(safeGithubUrl('https://github.com/o/r/actions/runs/42'), 'https://github.com/o/r/actions/runs/42');
  for (const bad of ['https://evil.example/o/r/issues/1', 'javascript:alert(1)', 'https://github.com/o/r/issues/1)\n# x', null]) assert.equal(safeGithubUrl(bad), null, String(bad));
  const r = classify({ pr: [job('x\n## injected', 'failure'), job(W1, 'failure')], main: { conclusion: 'failure', jobs: [job(W1, 'failure')] }, incident: 'https://evil.example/x' });
  const text = summary(r, { mainRunUrl: 'javascript:alert(1)' });
  assert.ok(!text.includes('injected') && !text.includes('evil.example') && !text.includes('javascript:'), text);
  assert.equal(r.verdict, 'pr_failure', 'a job whose name is not shown is never called inherited');
  assert.deepEqual(r.own, ['(a job whose name is not shown)']);
});
