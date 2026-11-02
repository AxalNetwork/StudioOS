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

import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
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

/** Each job under `jobs:`: its id, display name, job-level `if:`, `needs:` and its lines. */
function jobs(lines) {
  const at = lines.findIndex((l) => /^jobs:/.test(l));
  const out = [];
  let job = null;
  for (const l of lines.slice(at + 1)) {
    if (/^\S/.test(l)) break;
    const id = /^ {2}([\w-]+):\s*$/.exec(l);
    if (id) { job = { id: id[1], name: id[1], if: null, needs: [], body: [] }; out.push(job); continue; }
    if (job) job.body.push(l);
    const name = /^ {4}name:\s*(.+)$/.exec(l);
    if (job && name) job.name = unquote(name[1]);
    const cond = /^ {4}if:\s*(.+)$/.exec(l);
    if (job && cond) job.if = cond[1].trim();
    const needs = /^ {4}needs:\s*(.+)$/.exec(l);
    if (job && needs) job.needs = needs[1].replace(/[[\]]/g, '').split(',').map((n) => n.trim()).filter(Boolean);
  }
  return out;
}

// D4130 (#4130): the one required check that is an aggregator. Its parts run
// as other jobs it `needs`, so it must run even when one of them failed —
// a job whose need failed is SKIPPED by default, and a skipped required check
// reports as passed. It is the only required check allowed `if: always()`, and
// its own step must fail unless every part passed.
const AGGREGATOR = 'test:drift (full suite)';

// The forms of job-level `if:` that skip a job under merge_group.
const SKIPS_IN_QUEUE = Object.freeze([
  "github.event_name != 'merge_group'",
  "github.event_name == 'pull_request'",
  "github.event_name == 'push'",
]);

const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort(compareMigrations);

test('every required check comes from a job in its workflow, which listens for merge_group and runs there', () => {
  for (const [check, file] of Object.entries(REQUIRED)) {
    const lines = code(file);
    assert.ok(events(lines).includes('merge_group'), `${file} gives the required check "${check}" and must listen for merge_group, or every queued PR waits forever`);
    const matches = FILES.flatMap((f) => jobs(code(f)).filter((j) => j.name === check).map((j) => ({ ...j, file: f })));
    assert.deepEqual(matches.map((j) => j.file), [file], `"${check}" is one job's name, in ${file}`);
    const [job] = matches;
    // A skipped job reports as passed, so a required check that skips in the
    // queue would let anything through. It runs unconditionally — or, for the
    // aggregator, `always()`, which never skips.
    if (check === AGGREGATOR) {
      assert.equal(job.if, 'always()', `"${check}" needs its parts, so it runs on always(); without it a failed part would skip it, and a skipped required check passes`);
    } else {
      assert.equal(job.if, null, `"${check}" (${file}) has an if: ${job.if}; a required check never skips in the queue`);
    }
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

test('in a queue workflow, every job that is not a required check is skipped under merge_group, unless a required check needs it', () => {
  const required = new Set(Object.keys(REQUIRED));
  for (const f of IN_QUEUE) {
    const all = jobs(code(f));
    // What the required checks wait on. Such a job feeds a required check, so
    // it must RUN in the queue; the others already ran on the pull request.
    const fed = new Set(all.filter((j) => required.has(j.name)).flatMap((j) => j.needs));
    for (const j of all) {
      if (required.has(j.name)) continue;
      if (fed.has(j.id) && !SKIPS_IN_QUEUE.includes(j.if)) continue;
      assert.ok(
        SKIPS_IN_QUEUE.includes(j.if),
        `${f} › ${j.name} is not a required check and no required check needs it, so it is skipped in the queue (if: ${j.if})`,
      );
    }
  }
});

test('D4130: the full-suite check passes only when every part passed, and trusts a queue run only on a push to main', () => {
  const all = jobs(code('ci.yml'));
  const gate = all.find((j) => j.name === AGGREGATOR);
  const body = gate.body.join('\n');
  assert.deepEqual(gate.needs, ['verified', 'suite']);
  // The two ways to pass, and nothing else.
  assert.match(body, /if \[ "\$EVENT" = "push" \] && \[ -n "\$VERIFIED_RUN" \] && \[ "\$SUITE" = "skipped" \]; then\n\s+echo [^\n]+\n\s+exit 0\n\s+fi/);
  assert.match(body, /if \[ "\$SUITE" = "success" \]; then\n\s+echo [^\n]+\n\s+exit 0\n\s+fi/);
  assert.match(body, /exit 0\n\s+fi\n\s+echo "::error::[^\n]+"\n\s+exit 1\s*$/, 'anything else fails');
  assert.equal((body.match(/exit 0/g) || []).length, 2, 'exactly two ways to pass');
  assert.match(body, /SUITE: \$\{\{ needs\.suite\.result \}\}/);
  assert.match(body, /EVENT: \$\{\{ github\.event_name \}\}/);
  assert.match(body, /VERIFIED_RUN: \$\{\{ needs\.verified\.outputs\.run \}\}/, 'the gate reads the queue run from the lookup');
  // The lookup: only a merge_group run of THIS workflow, on THIS commit, that succeeded.
  const verified = all.find((j) => j.id === 'verified');
  assert.equal(verified.if, "github.event_name == 'push'", 'a pull request or a queue entry never skips the suite');
  const v = verified.body.join('\n');
  assert.match(v, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$SHA&event=merge_group&status=success/);
  assert.match(v, /select\(\.head_sha == env\.SHA and \.event == "merge_group" and \.conclusion == "success"\)/);
  assert.match(v, /SHA: \$\{\{ github\.sha \}\}/);
  assert.match(v, /permissions:\n\s+actions: read\n/, 'it reads run history and nothing else');
  assert.match(v, /outputs:\n\s+run: \$\{\{ steps\.lookup\.outputs\.run \}\}/, 'the job output is the lookup step\'s');
  assert.match(v, /id: lookup\n/);
  // The parts run unless that lookup found a run — including when it failed.
  const suite = all.find((j) => j.id === 'suite');
  assert.equal(suite.if, "${{ !cancelled() && needs.verified.outputs.run == '' }}");
  assert.match(suite.body.join('\n'), /fail-fast: false/);
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
