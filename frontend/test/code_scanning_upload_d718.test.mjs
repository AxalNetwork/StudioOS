/**
 * D718 — CodeQL and Semgrep upload to code scanning again, and still report
 * in the job summary.
 *
 * D672 (#1542) stopped both uploads while the repository was private, because
 * code scanning there needs GitHub Code Security, which was off. D718 put
 * them back once the repository was public, where code scanning is free.
 * Uploading is also what lets Copilot Autofix propose fixes for CodeQL
 * alerts. The job-summary report from D672 stays, because the agents that
 * fix findings cannot read the code-scanning API. Since D721 each workflow's
 * `visibility` job decides whether to upload (code_scanning_visibility_d721
 * runs it).
 *
 * This pins:
 *   - both workflows upload when the visibility job says so: CodeQL's
 *     analyze takes `upload` from it; Semgrep uploads its stripped SARIF,
 *     after the strip, with an `if:` that names only the visibility job (no
 *     status function, so the default success() still applies: an upload
 *     replaces the alert set, so a resultless SARIF from a crashed scan would
 *     close every open alert), and with no `category`, so it replaces the
 *     alert set the pre-D672 uploads left;
 *   - each workflow still ends with the report step;
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

test('CodeQL uploads its analysis when code scanning takes it, and still writes the SARIF the report reads', () => {
  const analyze = CODEQL.slice(CODEQL.indexOf('codeql-action/analyze'));
  assert.match(analyze, /^\s*upload:\s*\$\{\{ needs\.visibility\.outputs\.upload \}\}\s*$/m, 'CodeQL analyze must take `upload` from the visibility job (D721): a fixed `never` is D672 and drops the alerts on a public repository; no `upload` is D718 and goes red on a private one');
  assert.match(analyze, /^\s*output:\s*codeql-results\s*$/m, 'CodeQL must write its SARIF where the report step reads it');
});

test('Semgrep uploads the stripped SARIF, only after a scan that succeeded', () => {
  const at = (re) => SEMGREP.search(re);
  const strip = at(/- name: Drop nosemgrep/);
  const upload = at(/- name: Upload SARIF/);
  const report = at(/- name: Report findings/);
  assert.ok(upload > -1, 'semgrep.yml must upload its SARIF to code scanning (D718)');
  assert.ok(strip > -1 && strip < upload && upload < report, 'order must be strip -> upload -> report');
  const step = SEMGREP.slice(upload, report);
  assert.match(step, /uses: github\/codeql-action\/upload-sarif@[0-9a-f]{40}\b/, 'the upload action must be pinned by commit SHA');
  assert.match(step, /^\s*sarif_file:\s*semgrep\.sarif\s*$/m, 'the upload must send the stripped SARIF');
  const cond = step.match(/^\s*if:\s*(.+?)\s*$/m);
  assert.ok(cond, 'the upload must run only when code scanning takes uploads (D721)');
  assert.equal(cond[1], "needs.visibility.outputs.upload == 'always'", 'the upload\'s if: names only the visibility job, with no status function, so the default success() still applies; always() would upload the resultless SARIF a crashed scan leaves and close every alert');
  assert.doesNotMatch(step, /^\s*category:/m, 'no category, so the upload replaces the alert set the pre-D672 uploads left open');
});

test('each workflow lists its findings in the job summary', () => {
  assert.match(CODEQL, /- name: Report findings\n\s+run: python3 scripts\/sarif-summary\.py "CodeQL \(\$\{\{ matrix\.language \}\}\)" codeql-results/);
  assert.match(SEMGREP, /- name: Report findings\n[\s\S]*scripts\/sarif-summary\.py "Semgrep" semgrep\.sarif/);
});

function run(args, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sarif-d718-'));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const r = spawnSync('python3', [SCRIPT, ...args(dir)], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary, ...env }, encoding: 'utf8' });
  return { status: r.status, summary: readFileSync(summary, 'utf8'), stdout: r.stdout, stderr: r.stderr };
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

test('the job log lists every unsuppressed finding with its message, past the summary cap', () => {
  // The summary is not readable through the REST API; the log is. So the log
  // carries the whole list, one tab-separated line each.
  const r = run((dir) => {
    const f = join(dir, 'many.sarif');
    const many = Array.from({ length: 60 }, (_, i) => result('js/xss', `frontend/src/f${i}.js`, i + 1, { message: { text: `Finding ${i}\nsecond line` } }));
    many.push(result('py/sql', 'backend/c.py', 7, { suppressions: [{ kind: 'inSource' }] }));
    writeFileSync(f, JSON.stringify({ runs: [{ results: many }] }));
    return ['Semgrep', f];
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('finding\t'));
  assert.equal(lines.length, 60, 'every unsuppressed finding is in the log, not only the first 50');
  assert.equal(lines[59], 'finding\twarning\tjs/xss\tfrontend/src/f59.js:60\tFinding 59');
  assert.doesNotMatch(r.stdout, /py\/sql/, 'a suppressed result stays out of the log');
  assert.match(r.summary, /10 more not listed/, 'the summary keeps its cap');
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
