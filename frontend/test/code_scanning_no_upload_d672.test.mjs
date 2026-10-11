/**
 * D672 (#1542) — CodeQL and Semgrep scan without uploading to code scanning.
 *
 * The repository is private, and code scanning on a private repository needs
 * GitHub Code Security, which is not on. From 2026-10-10 every SARIF upload
 * was refused ("Code Security must be enabled for this repository to use code
 * scanning"), so all three scanning checks went red on every PR with no repo
 * change. Both workflows now keep their SARIF in the workspace and list the
 * findings in the job summary through scripts/sarif-summary.py.
 *
 * This pins:
 *   - neither workflow uploads (no upload-sarif, CodeQL's analyze says
 *     `upload: never`), and each ends with the report step;
 *   - the report counts what the scanner did not suppress, and fails only
 *     when it has no readable SARIF, since an empty report reads as clean.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const code = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const CODEQL = code(read('.github/workflows/codeql.yml'));
const SEMGREP = code(read('.github/workflows/semgrep.yml'));
const SCRIPT = resolve(process.cwd(), 'scripts/sarif-summary.py');

test('neither workflow uploads SARIF to code scanning', () => {
  for (const [name, src] of [['codeql.yml', CODEQL], ['semgrep.yml', SEMGREP]]) {
    assert.doesNotMatch(src, /upload-sarif/, `${name} uploads SARIF again; code scanning is off on this private repository`);
  }
  const analyze = CODEQL.slice(CODEQL.indexOf('codeql-action/analyze'));
  assert.match(analyze, /^\s*upload:\s*never\s*$/m, 'CodeQL analyze must say `upload: never`');
  assert.match(analyze, /^\s*output:\s*codeql-results\s*$/m, 'CodeQL must write its SARIF where the report step reads it');
});

test('each workflow lists its findings in the job summary', () => {
  assert.match(CODEQL, /- name: Report findings\n\s+run: python3 scripts\/sarif-summary\.py "CodeQL \(\$\{\{ matrix\.language \}\}\)" codeql-results/);
  assert.match(SEMGREP, /- name: Report findings\n[\s\S]*scripts\/sarif-summary\.py "Semgrep" semgrep\.sarif/);
});

function run(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sarif-d672-'));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const r = spawnSync('python3', [SCRIPT, ...args(dir)], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary, ...env }, encoding: 'utf8' });
  return { status: r.status, summary: readFileSync(summary, 'utf8'), stderr: r.stderr };
}

const result = (ruleId, uri, line, extra = {}) => ({
  ruleId, level: 'warning',
  locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }],
  ...extra,
});

test('the report counts unsuppressed results and lists where they are', () => {
  const r = run((dir) => {
    const f = join(dir, 'x.sarif');
    writeFileSync(f, JSON.stringify({ runs: [{ results: [
      result('js/xss', 'frontend/src/a.js', 12),
      result('js/xss', 'frontend/src/b.js', 3, { level: 'error' }),
      result('py/sql', 'backend/c.py', 7, { suppressions: [{ kind: 'inSource' }] }),
      result('py/eval', 'backend/d.py', 9, { suppressions: [] }),
    ] }] }));
    return ['Semgrep', f];
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.summary, /### Semgrep: 3 findings/);
  assert.match(r.summary, /1 suppressed in the source are not counted/);
  assert.match(r.summary, /\| `js\/xss` \| 2 \|/);
  assert.match(r.summary, /\| `py\/eval` \| 1 \|/, 'an EMPTY suppressions array means not suppressed');
  assert.doesNotMatch(r.summary, /py\/sql/);
  assert.match(r.summary, /`frontend\/src\/a\.js:12`/);
});

test('a clean scan reports zero, and no SARIF at all fails', () => {
  const clean = run((dir) => {
    const f = join(dir, 'clean.sarif');
    writeFileSync(f, JSON.stringify({ runs: [{ results: [] }] }));
    return ['CodeQL (python)', dir];
  });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.summary, /### CodeQL \(python\): 0 findings/);
  const missing = run((dir) => ['Semgrep', join(dir, 'nope.sarif')]);
  assert.equal(missing.status, 1, 'a missing SARIF must fail the step, not read as a clean scan');
  const emptyDir = run((dir) => ['CodeQL (python)', dir]);
  assert.equal(emptyDir.status, 1, 'a results directory with no SARIF must fail too');
});
