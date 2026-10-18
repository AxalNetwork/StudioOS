/**
 * D721 — CodeQL and Semgrep upload to code scanning only where it takes an
 * upload, and ask on every run.
 *
 * Code scanning is free on a public repository and needs GitHub Code
 * Security on a private one, which this repository does not have. It has
 * been both: private under D672 (uploads off), public under D718 (uploads
 * on), and private again on 2026-10-18, when every refused upload turned
 * `analyze (javascript-typescript)`, `analyze (python)` and Semgrep's `Scan`
 * red on `main` and on every PR. So each workflow starts with a `visibility`
 * job that asks the repository API and answers `always` or `never`.
 *
 * This pins:
 *   - the two workflows carry the same `visibility` job, and their scanning
 *     job needs it;
 *   - its step answers `always` for a public repository, or a private one
 *     with Code Security on, `never` for a private one without it (or when
 *     the token cannot see the setting), and fails on any other answer;
 *   - its jq expression turns the API's JSON into those words.
 * code_scanning_upload_d718.test.mjs pins how each upload uses the answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CODEQL = read('.github/workflows/codeql.yml');
const SEMGREP = read('.github/workflows/semgrep.yml');

/** A top-level job's block: its `  <name>:` line up to the next job. */
function job(src, name) {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(at >= 0, `no ${name} job`);
  const end = lines.findIndex((l, i) => i > at && /^ {2}\S/.test(l));
  return lines.slice(at, end < 0 ? lines.length : end).join('\n');
}

/** The dedented `run: |` block of the visibility job's one step. */
function askBlock(src) {
  const lines = job(src, 'visibility').split('\n');
  const runAt = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.ok(runAt >= 0, 'the visibility step has a run block');
  const keyIndent = lines[runAt].search(/\S/);
  const body = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= keyIndent) break;
    body.push(l);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(indent)).join('\n');
}

/** Runs the step with a stand-in `gh` that prints `answer` and exits `rc`. */
function ask(answer, rc = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'visibility-d721-'));
  try {
    const gh = join(dir, 'gh');
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$FAKE_ANSWER"\nexit "$FAKE_RC"\n`);
    chmodSync(gh, 0o755);
    const out = join(dir, 'output');
    writeFileSync(out, '');
    const r = spawnSync('bash', ['-c', askBlock(CODEQL)], {
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'o/r', FAKE_ANSWER: answer, FAKE_RC: String(rc) },
      encoding: 'utf8',
    });
    return { status: r.status, output: readFileSync(out, 'utf8'), stdout: r.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('codeql.yml and semgrep.yml carry the same visibility job, and their scans need it', () => {
  assert.equal(job(SEMGREP, 'visibility'), job(CODEQL, 'visibility'), 'the two visibility jobs must stay identical');
  assert.match(job(CODEQL, 'analyze'), /^ {4}needs: visibility$/m);
  assert.match(job(SEMGREP, 'scan'), /^ {4}needs: visibility$/m);
  assert.match(job(CODEQL, 'visibility'), /^ {6}upload: \$\{\{ steps\.ask\.outputs\.upload \}\}$/m);
});

test('a public repository uploads, and so does a private one with Code Security on', () => {
  for (const answer of ['false unknown', 'false disabled', 'false enabled', 'true enabled']) {
    const r = ask(answer);
    assert.equal(r.status, 0, answer);
    assert.equal(r.output, 'upload=always\n', answer);
  }
});

test('a private repository without Code Security, or one whose setting is hidden, does not upload', () => {
  for (const answer of ['true disabled', 'true unknown']) {
    const r = ask(answer);
    assert.equal(r.status, 0, answer);
    assert.equal(r.output, 'upload=never\n', answer);
    assert.match(r.stdout, /::notice::.*job summary only \(D721\)/);
  }
});

test('an answer it cannot read, or a failed API call, fails the step', () => {
  for (const answer of ['', 'null unknown', 'yes']) {
    const r = ask(answer);
    assert.equal(r.status, 1, JSON.stringify(answer));
    assert.equal(r.output, '');
  }
  const refused = ask('false unknown', 1);
  assert.notEqual(refused.status, 0, 'a gh that fails must fail the step under set -e');
  assert.equal(refused.output, '');
});

test("the step's jq expression turns the repository JSON into those answers", (t) => {
  if (spawnSync('jq', ['--version']).status !== 0) return t.skip('jq is not installed');
  const expr = /--jq '([^']+)'/.exec(askBlock(CODEQL))[1];
  const jq = (obj) => spawnSync('jq', ['-r', expr], { input: JSON.stringify(obj), encoding: 'utf8' }).stdout.trim();
  assert.equal(jq({ private: false }), 'false unknown');
  assert.equal(jq({ private: true, security_and_analysis: null }), 'true unknown');
  assert.equal(jq({ private: true, security_and_analysis: { code_security: { status: 'disabled' } } }), 'true disabled');
  assert.equal(jq({ private: true, security_and_analysis: { code_security: { status: 'enabled' } } }), 'true enabled');
});
