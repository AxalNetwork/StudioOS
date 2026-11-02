// #4107 (part of #4101) — the merge queue on main. A queued pull request is
// tested on a `gh-readonly-queue/main/…` branch through the `merge_group`
// event, and the queue waits for main's required checks to report there. A
// required check whose workflow does not listen for `merge_group` never
// reports, and every queued PR waits forever; a deploy, preview or comment job
// that does listen would run on a branch nobody reviewed.
//
// The required checks are the owner's ruleset "main: required checks"
// (2026-11-02, on #4107). When the ruleset changes, change REQUIRED here.
//
// Run with:
//   node --test frontend/test/merge_queue_ci_4107.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = '.github/workflows';
const REQUIRED = Object.freeze({
  'test:drift (full suite)': 'ci.yml',
  'worker (typecheck)': 'ci.yml',
  'frontend (build)': 'ci.yml',
  'api ↔ worker drift': 'ci.yml',
  'applied migrations unchanged': 'migration-immutability.yml',
  scan: 'gitleaks.yml',
});
// The only workflows the queue runs. Adding one here is a decision: nothing in
// a queue run may deploy, post a comment or touch production.
const IN_QUEUE = Object.freeze(['ci.yml', 'gitleaks.yml', 'migration-immutability.yml']);

const code = (file) => readFileSync(`${DIR}/${file}`, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

/** The top-level `on:` block's event names. */
function events(lines) {
  const at = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (at < 0) return [];
  const inline = lines[at].replace(/^[^:]+:\s*/, '').trim();
  if (inline) return inline.replace(/[[\]]/g, '').split(',').map((e) => e.trim()).filter(Boolean);
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) break;
    const m = /^ {2}([a-z_]+):/.exec(l) || /^ {2}- ([a-z_]+)\s*$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Each job under `jobs:`: its id, display name and job-level `if:`. */
function jobs(lines) {
  const at = lines.findIndex((l) => /^jobs:/.test(l));
  const out = [];
  let job = null;
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) break;
    const id = /^ {2}([\w-]+):\s*$/.exec(l);
    if (id) { job = { id: id[1], name: id[1], if: null }; out.push(job); continue; }
    const name = /^ {4}name:\s*(.+)$/.exec(l);
    if (job && name) job.name = unquote(name[1]);
    const cond = /^ {4}if:\s*(.+)$/.exec(l);
    if (job && cond) job.if = cond[1].trim();
  }
  return out;
}

const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();

test('every required check comes from a job in its workflow, which listens for merge_group and runs there', () => {
  for (const [check, file] of Object.entries(REQUIRED)) {
    const lines = code(file);
    assert.ok(events(lines).includes('merge_group'), `${file} gives the required check "${check}" and must listen for merge_group, or every queued PR waits forever`);
    const matches = FILES.flatMap((f) => jobs(code(f)).filter((j) => j.name === check).map((j) => ({ ...j, file: f })));
    assert.deepEqual(matches.map((j) => j.file), [file], `"${check}" is one job's name, in ${file}`);
    const [job] = matches;
    // A skipped job reports as passed, so a required check that skips in the
    // queue would let anything through. It runs unconditionally.
    assert.equal(job.if, null, `"${check}" (${file}) has an if: ${job.if}; a required check never skips in the queue`);
  }
  assert.match(code('ci.yml').join('\n'), /\n {2}merge_group:\n {4}types: \[checks_requested\]\n/);
});

test('the queue runs only these workflows: no deploy, preview, review or comment workflow listens for merge_group', () => {
  const listening = FILES.filter((f) => events(code(f)).includes('merge_group'));
  assert.deepEqual(listening, [...IN_QUEUE].sort());
  for (const f of ['cloudflare-worker-deploy.yml', 'pr-preview.yml', 'claude-review.yml', 'claude-code.yml', 'changelog-gate.yml']) {
    assert.ok(FILES.includes(f), `${f} still exists; update this list if it was renamed`);
    assert.ok(!listening.includes(f), `${f} must not run in the merge queue`);
  }
});

test('in a queue workflow, every job that is not a required check is skipped under merge_group', () => {
  const required = new Set(Object.keys(REQUIRED));
  for (const f of IN_QUEUE) {
    for (const j of jobs(code(f))) {
      if (required.has(j.name)) continue;
      assert.ok(
        j.if === "github.event_name != 'merge_group'" || j.if === "github.event_name == 'pull_request'",
        `${f} › ${j.name} is not a required check, so it is skipped in the queue (if: ${j.if})`,
      );
    }
  }
});

test('the diffing gates compare against the queue entry\'s base, never the PR\'s, under merge_group', () => {
  const imm = code('migration-immutability.yml').join('\n');
  assert.match(imm, /MIGRATION_GATE_BEFORE: \$\{\{ github\.event_name == 'push' && github\.event\.before \|\| github\.event_name == 'merge_group' && github\.event\.merge_group\.base_sha \|\| '' \}\}/);
  const leaks = code('gitleaks.yml').join('\n');
  assert.match(leaks, /elif \[ "\$\{\{ github\.event_name \}\}" = "merge_group" \]; then\n\s+echo "logopts=--log-opts=\$\{\{ github\.event\.merge_group\.base_sha \}\}\.\.\$\{\{ github\.event\.merge_group\.head_sha \}\}"/);
});

test('the deploy runs on a push to main only', () => {
  const deploy = code('cloudflare-worker-deploy.yml');
  assert.ok(!events(deploy).includes('merge_group'));
  assert.ok(!events(deploy).includes('pull_request'));
});
