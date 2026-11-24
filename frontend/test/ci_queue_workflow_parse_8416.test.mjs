/**
 * D8416 (#8416): in the merge queue every suite part checks, before its own
 * commands, that the candidate's workflows parse.
 *
 * On 2026-11-24 a candidate whose codeql.yml and semgrep.yml each held one job
 * key twice failed `rest` 5 min 50 s in, twice, with nine other candidates
 * built on it. This file pins when the early check runs, what a failure
 * leaves behind, where `main` calls it, and that each early command is still
 * one of test:guards' commands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUEUE_PREFLIGHT, queuePreflight, failureAnnotation } from '../../scripts/test-drift-parts.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const GUARD = 'node scripts/check-production-credentials.mjs';

function run(event, status = 0, extra = {}) {
  const calls = [];
  const lines = [];
  const result = queuePreflight({
    env: { GITHUB_EVENT_NAME: event, ...extra }, root: '/nowhere',
    sh: (command) => { calls.push(command); return { status }; },
    log: (line) => lines.push(line), error: (line) => lines.push(line),
  });
  return { result, calls, lines };
}

test('outside the merge queue the early check runs nothing', () => {
  for (const event of ['pull_request', 'push', 'workflow_dispatch', undefined]) {
    assert.deepEqual(run(event, 1), { result: 0, calls: [], lines: [] }, String(event));
  }
});

test('in the merge queue it runs the workflow guard once and passes when the guard does', () => {
  assert.deepEqual(QUEUE_PREFLIGHT, [GUARD]);
  assert.ok(Object.isFrozen(QUEUE_PREFLIGHT));
  const { result, calls } = run('merge_group');
  assert.equal(result, 0);
  assert.deepEqual(calls, [GUARD]);
});

test('a failing guard ends the part with its status, an identity annotation and failure evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'queue-preflight-'));
  try {
    const { result, calls, lines } = run('merge_group', 3, { CI_FAILURE_DIR: dir, CI_FAILURE_PART: 'worker-2-of-6' });
    assert.equal(result, 3);
    assert.deepEqual(calls, [GUARD]);
    assert.ok(lines.includes(failureAnnotation(`guard › ${GUARD}`)), lines.join('\n'));
    const reports = JSON.parse(readFileSync(join(dir, 'failures.json'), 'utf8'));
    assert.equal(reports.length, 1);
    assert.equal(reports[0].part, 'worker-2-of-6');
    assert.equal(reports[0].status, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('main runs it for the chosen part before generation failures and the part\'s own commands', () => {
  const source = read('scripts/test-drift-parts.mjs');
  const call = source.indexOf('const early = queuePreflight({ env: { ...env, CI_FAILURE_PART: part.name }, root, sh });');
  assert.ok(call > 0, 'main calls queuePreflight with the part\'s environment');
  assert.equal(source.slice(call).split('\n')[1].trim(), 'if (early !== 0) return early;');
  assert.ok(call < source.indexOf('if (generated !== 0) {'));
  assert.ok(call < source.indexOf('return runPart({ commands: part.commands'));
  assert.ok(call > source.indexOf('const part = planned.find('));
});

test('every early command is still one of the full suite\'s guards, and the queue is fail-fast', () => {
  const guards = JSON.parse(read('scripts/guard-commands.json')).filter((guard) => guard.full !== false);
  for (const command of QUEUE_PREFLIGHT) {
    assert.equal(guards.filter((guard) => guard.command.join(' ') === command).length, 1, command);
  }
  assert.match(read('.github/workflows/ci.yml'), /^      fail-fast: \$\{\{ github\.event_name == 'merge_group' \}\}$/m);
});
