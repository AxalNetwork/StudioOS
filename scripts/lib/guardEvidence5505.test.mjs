/** D5505 (#5505): guard report ingestion, exact-base identity and unchanged shard failure status. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardReports, compareEvidence, identity, failureReport, renderEvidence } from './ciFailures.mjs';
import { runPart, reportHeadSha } from '../test-drift-parts.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sha = 'a'.repeat(40);
const row = (id, status, extra = {}) => ({ id, kind: 'guard', file: `scripts/${id}.mjs`, command: ['node', `scripts/${id}.mjs`], status, exitCode: status === 'passed' ? 0 : status === 'failed' ? 7 : null, ...extra });
const result = rows => ({ version: 1, scope: 'guards', mode: 'full', complete: true, exitCode: rows.every(r => r.status === 'passed') ? 0 : 1, results: rows });
const meta = { testedSha: sha, part: 'rest', runId: '1', attempt: '1' };
test('all guard failures and blocked states retain identity, source file, exit code and safe reproduction', () => {
  const reports = guardReports(result([row('first', 'failed'), row('second', 'failed'), row('third', 'blocked')]), meta, 1);
  assert.deepEqual(reports.map(r => r.failures[0].test), ['first', 'second', 'third']);
  assert.equal(reports[0].failures[0].exitCode, 7); assert.equal(reports[0].failures[0].file, 'scripts/first.mjs');
  assert.equal(reports[2].complete, false);
  assert.match(reports[0].failures[0].repro, /npm run build && node scripts\/run-guards\.mjs --guard 'first'/);
  assert.match(renderEvidence(compareEvidence({ current: reports, base: [], baseSha: sha })), /scripts\/first/);
});
test('exact guard and command coverage supports inherited, independent and unknown results', () => {
  const current = guardReports(result([row('first', 'failed'), row('second', 'failed')]), meta, 1);
  const base = guardReports(result([row('first', 'failed'), row('second', 'passed')]), meta, 1);
  const r = compareEvidence({ current, base, baseSha: sha });
  assert.equal(r.verdict, 'pr_failure'); assert.equal(r.shared.length, 1); assert.equal(r.own.length, 1);
  const changed = guardReports(result([row('first', 'failed', { command: ['node', 'scripts/first.mjs', '--new-flag'] })]), meta, 1);
  assert.notEqual(identity(changed[0].failures[0]), identity(current[0].failures[0]));
  assert.equal(compareEvidence({ current: changed, base, baseSha: sha }).verdict, 'main_health_unknown');
  assert.equal(failureReport(current[0]).failures[0].kind, 'guard');
});
test('malformed, partial, preflight and exit-inconsistent reports cannot provide full guard evidence', () => {
  for (const bad of [{}, { ...result([row('first', 'failed')]), mode: 'preflight' }, { ...result([row('first', 'failed')]), version: 2 }, result([row('first', 'failed', { command: ['node', 'scripts/first.mjs', '$(unsafe)'] })]), { ...result([row('first', 'failed')]), complete: false }, result([row('../bad', 'failed')]), result([row('first', 'passed', { exitCode: 7 })])]) assert.throws(() => guardReports(bad, meta, 1));
});
test('the shard clears stale guard records, retains original exit status and emits bounded guard annotations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards5505-')), output = join(dir, 'guard-results.json'), evidence = join(dir, 'evidence');
  try {
    mkdirSync(join(dir, 'scripts'));
    writeFileSync(join(dir, 'scripts/guard-commands.json'), JSON.stringify([row('first', 'failed'), row('second', 'failed')]));
    writeFileSync(output, JSON.stringify(result([row('stale', 'failed')])));
    const lines = [];
    const status = runPart({ commands: ['npm run test:guards'], root: dir, env: { CI_FAILURE_DIR: evidence, CI_FAILURE_PART: 'rest', GITHUB_EVENT_NAME: 'merge_group', GITHUB_SHA: sha, GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' },
      sh: () => { assert.equal(existsSync(output), false); writeFileSync(output, JSON.stringify(result([row('first', 'failed'), row('second', 'failed')]))); return { status: 1 }; }, log: s => lines.push(s), error() {} });
    assert.equal(status, 1);
    const reports = JSON.parse(readFileSync(join(evidence, 'failures.json'), 'utf8'));
    assert.deepEqual(reports.flatMap(r => r.failures.map(f => f.test)), ['first', 'second']);
    assert.equal(lines.filter(s => s.startsWith('::error title=ci-failure-id::guard › ')).length, 2);
    const noEvidence = runPart({ commands: ['npm run test:guards'], root: dir, env: {}, sh: () => ({ status: 7 }), log() {}, error() {} });
    assert.equal(noEvidence, 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rest continues independent commands after a failure, runs guards, and returns the first original status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards5505-rest-')), seen = [];
  try {
    mkdirSync(join(dir, 'scripts')); writeFileSync(join(dir, 'scripts/guard-commands.json'), JSON.stringify([row('first', 'failed')]));
    const code = runPart({ commands: ['npm run first', 'npm run test:guards', 'npm run last'], root: dir, env: {}, continueIndependent: true,
      sh: command => { seen.push(command); if (command === 'npm run test:guards') writeFileSync(join(dir, 'guard-results.json'), JSON.stringify(result([row('first', 'failed')]))); return { status: command.endsWith('first') ? 7 : command.endsWith('guards') ? 1 : 0 }; }, log() {}, error() {} });
    assert.equal(code, 7); assert.deepEqual(seen, ['npm run first', 'npm run test:guards', 'npm run last']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a valid JSON report that omits a planned guard or changes its flags supplies no complete coverage', () => {
  const report = result([row('first', 'failed')]);
  assert.throws(() => guardReports(report, meta, 1, [row('first', 'failed'), row('second', 'passed')]));
  assert.throws(() => guardReports(report, meta, 1, [row('first', 'failed', { command: ['node', 'scripts/first.mjs', '--other'] })]));
  assert.throws(() => guardReports({ ...report, exitCode: 0 }, meta, 0));
});
test('missing guard output cannot reuse an old node reporter file as current failure evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards5505-stale-')), stale = join(tmpdir(), `ci-evidence-${process.pid}-0.jsonl`);
  try {
    writeFileSync(stale, `${JSON.stringify({ file: 'scripts/stale.test.mjs', test: 'old failure' })}\n${JSON.stringify({ end: true, complete: true, files: ['scripts/stale.test.mjs'] })}\n`);
    const code = runPart({ commands: ['npm run test:guards'], root: dir, env: { CI_FAILURE_DIR: dir }, sh: () => ({ status: 1 }), log() {}, error() {} });
    assert.equal(code, 1);
    const report = JSON.parse(readFileSync(join(dir, 'failures.json'), 'utf8'))[0];
    assert.equal(report.complete, false); assert.deepEqual(report.failures, []);
  } finally { rmSync(stale, { force: true }); rmSync(dir, { recursive: true, force: true }); }
});
test('guard coverage cannot be mistaken for execution of a node:test in the same source file', () => {
  const base = guardReports(result([row('first', 'passed')]), meta, 0);
  const current = failureReport({ ...meta, complete: true, status: 1, files: ['scripts/first.mjs'], failures: [{ file: 'scripts/first.mjs', test: 'new test' }] });
  assert.equal(base[0].scope, 'guards'); assert.equal(failureReport(base[0]).scope, 'guards');
  assert.equal(compareEvidence({ current: [current], base, baseSha: sha }).verdict, 'main_health_unknown');
});

test('producer records the frozen PR head independently of GITHUB_SHA and refuses an unreadable event', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guards5505-head-')), path = join(dir, 'event.json');
  const head = 'b'.repeat(40), merge = 'c'.repeat(40);
  try {
    writeFileSync(path, JSON.stringify({ pull_request: { head: { sha: head } } }));
    const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: merge, GITHUB_EVENT_PATH: path };
    assert.equal(reportHeadSha(env), head);
    writeFileSync(path, '{bad json'); assert.equal(reportHeadSha(env), null);
    assert.equal(reportHeadSha({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: merge }), merge);
    assert.equal(failureReport({ headSha: head, testedSha: merge }).headSha, head);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
