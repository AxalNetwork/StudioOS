// #4107 (part of #4101) — the merge queue on main. A queued pull request is
// tested on a `gh-readonly-queue/main/…` branch through the `merge_group`
// event, and the queue waits for main's required checks to report there. A
// required check whose workflow does not listen for `merge_group` never
// reports, and every queued PR waits forever; a deploy, preview or comment job
// that does listen would run on a branch nobody reviewed.
//
// The required checks are the owner's ruleset "main: required checks"
// (2026-11-02, on #4107). REQUIRED lives in scripts/lib/requiredChecks.mjs
// (#5973) because the CI scorecard reads it too; change it there.
//
// Run with:
//   node --test frontend/test/merge_queue_ci_4107.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { REQUIRED } from '../../scripts/lib/requiredChecks.mjs';
const DIR = '.github/workflows';
const SHADOW = Object.freeze({ 'landing gate': 'ci.yml' });
// The only workflows the queue runs. Adding one here is a decision: nothing in
// a queue run may deploy, post a comment or touch production.
// D7899: Dependency Review also runs in the queue, comparing the queue's own
// base and head; it reads only and is advisory until its required-check
// activation, so its job is exempt from the skip-in-queue rule below.
// D8068: Agent provenance reads the queued PR's own commits and is advisory
// (continue-on-error) until the owner makes `provenance` a required check.
const IN_QUEUE = Object.freeze(['agent-provenance.yml', 'ci.yml', 'dependency-review.yml', 'gitleaks.yml', 'migration-immutability.yml']);
const ADVISORY_QUEUE_WORKFLOWS = Object.freeze({ 'agent-provenance.yml': 'D8068', 'dependency-review.yml': 'D7899' });

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
// reports as passed. Both aggregators use `if: always()` so their own steps can report failure.
const AGGREGATOR = 'test:drift (full suite)';
const GATE_NAME = "${{ github.event_name == 'pull_request' && github.event.pull_request.draft && 'test:drift (draft fast tier)' || 'test:drift (full suite)' }}";
const DRAFT_SKIP = "github.event_name != 'merge_group' && (github.event_name != 'pull_request' || !github.event.pull_request.draft)";
const PLAN_IF = "${{ !cancelled() && needs.verified.outputs.run == '' && github.event_name != 'merge_group' }}";
const queueName = job => job.id === 'gate' && job.name === GATE_NAME ? AGGREGATOR : job.name;

// The forms of job-level `if:` that skip a job under merge_group.
const SKIPS_IN_QUEUE = Object.freeze([
  "github.event_name != 'merge_group'",
  DRAFT_SKIP,
  "github.event_name == 'pull_request'",
  "github.event_name == 'push'",
  // D5398: the failure classifier runs only after a PR's suite failed; it is a pull_request-only job, so never in the queue.
  "failure() && github.event_name == 'pull_request'",
  "always() && github.event_name == 'pull_request'",
  // D7108 part 2: `plan` feeds the full-suite check but is skipped in the
  // queue, where each suite part plans for itself; the gate requires that skip.
  PLAN_IF,
  // D7909: optional capacity submission is main-push only, independently of the hosted gate.
  "${{ !cancelled() && github.event_name != 'merge_group' && github.event_name == 'push' && github.repository == 'AxalNetwork/StudioOS' && vars.CI_CAPACITY_ENABLED == 'true' && needs.plan.outputs.capacity_submission != '' }}",
]);

// Jobs that run in the queue although no required check needs them, each with
// why. D5608: `test-deps` merges the suite parts' traces into one artifact per
// commit; a push that `verified` skips has none, so the queue run must make it.
// test_tracer_5608.test.mjs keeps it advisory: neither gate needs it.
// D5502: bounded read-only failure diagnostics also run after a queue failure.
const QUEUE_ADVISORY = Object.freeze({ 'test-deps': 'D5608', classify: 'D5502' });
// D8626: `route` feeds `capacity-route`, which the full-suite check needs. Both run in the queue only while
// vars.CI_CAPACITY_QUEUE_ROUTING is 'true'; with it off they are skipped before they start.
const QUEUE_ROUTING = Object.freeze({ route: 'D8626' });

const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort(compareMigrations);

test('every required and shadow check comes from a job in its workflow, which listens for merge_group and runs there', () => {
  for (const [check, file] of Object.entries({ ...REQUIRED, ...SHADOW })) {
    const lines = code(file);
    assert.ok(events(lines).includes('merge_group'), `${file} gives the required check "${check}" and must listen for merge_group, or every queued PR waits forever`);
    const matches = FILES.flatMap((f) => jobs(code(f)).filter((j) => queueName(j) === check).map((j) => ({ ...j, file: f })));
    assert.deepEqual(matches.map((j) => j.file), [file], `"${check}" is one job's name, in ${file}`);
    const [job] = matches;
    // A skipped job reports as passed, so a required check that skips in the
    // queue would let anything through. It runs unconditionally — or, for the
    // aggregator, `always()`, which never skips.
    if (check === AGGREGATOR || check in SHADOW) {
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

test('in a queue workflow, jobs outside the required and shadow checks skip under merge_group unless needed', () => {
  const required = new Set([...Object.keys(REQUIRED), ...Object.keys(SHADOW)]);
  for (const f of IN_QUEUE) {
    const all = jobs(code(f));
    // What the required checks wait on. Such a job feeds a required check, so
    // it must RUN in the queue; the others already ran on the pull request.
    const fed = new Set(all.filter((j) => required.has(queueName(j))).flatMap((j) => j.needs));
    for (const j of all) {
      if (required.has(queueName(j))) continue;
      if (fed.has(j.id) && !SKIPS_IN_QUEUE.includes(j.if)) continue;
      if (f === 'ci.yml' && Object.hasOwn(QUEUE_ADVISORY, j.id)) continue;
      if (f === 'ci.yml' && Object.hasOwn(QUEUE_ROUTING, j.id)) {
        assert.match(j.if, /github\.event_name == 'merge_group' && .*vars\.CI_CAPACITY_QUEUE_ROUTING == 'true'/, `${j.name} runs only under queue routing`);
        continue;
      }
      if (Object.hasOwn(ADVISORY_QUEUE_WORKFLOWS, f)) continue;
      assert.ok(
        SKIPS_IN_QUEUE.includes(j.if),
        `${f} › ${j.name} is not a required check and no required check needs it, so it is skipped in the queue (if: ${j.if})`,
      );
    }
  }
});

test('D4130: the full-suite check passes only when every part passed, and trusts a queue run only on a push to main', () => {
  const all = jobs(code('ci.yml'));
  const gate = all.find((j) => queueName(j) === AGGREGATOR);
  const body = gate.body.join('\n');
  // D8626: `capacity-route` is read only to refuse a routed candidate whose Worker result main does not require.
  assert.deepEqual(gate.needs, ['verified', 'plan', 'capacity-route', 'suite']);
  // The two ways to pass, and nothing else.
  assert.match(body, /if \[ "\$EVENT" = "push" \] && \[ -n "\$VERIFIED_RUN" \] && \[ "\$SUITE" = "skipped" \]; then\n\s+echo [^\n]+\n\s+exit 0\n\s+fi/);
  // D7108 part 2: `plan` succeeded off the queue, or was skipped in it.
  assert.match(body, /if \{ \{ \[ "\$PLAN" = "success" \] && \[ "\$EVENT" != "merge_group" \]; \} \|\| \{ \[ "\$PLAN" = "skipped" \] && \[ "\$EVENT" = "merge_group" \]; \}; \} && \[ "\$SUITE" = "success" \]; then\n\s+if \[ "\$EVENT" = "pull_request" \] && \[ "\$DRAFT" = "true" \]; then\n\s+echo [^\n]+\n\s+else\n\s+echo [^\n]+\n\s+fi\n\s+exit 0\n\s+fi/);
  assert.match(body, /exit 0\n\s+fi\n\s+echo "::error::[^\n]+"\n\s+exit 1\s*$/, 'anything else fails');
  assert.equal((body.match(/exit 0/g) || []).length, 2, 'exactly two ways to pass');
  assert.match(body, /SUITE: \$\{\{ needs\.suite\.result \}\}/);
  assert.match(body, /PLAN: \$\{\{ needs\.plan\.result \}\}/);
  assert.equal(all.find((j) => j.id === 'plan').if, PLAN_IF, 'plan runs on a pull request and a push, never in the queue');
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
  assert.match(suite.body.join('\n'), /fail-fast: \$\{\{ github\.event_name == 'merge_group' \}\}/);
});

test('D7108 part 2: the full-suite gate, executed, needs a skipped plan in the queue and a successful one elsewhere', () => {
  const raw = readFileSync(`${DIR}/ci.yml`, 'utf8');
  const gate = raw.slice(raw.indexOf('\n  gate:\n'));
  const script = gate.match(/ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/)[1].replace(/^ {10}/gm, '');
  const verdict = (EVENT, PLAN, SUITE, VERIFIED_RUN = '', DRAFT = '') =>
    spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, EVENT, PLAN, SUITE, VERIFIED_RUN, DRAFT } }).status;
  for (const [event, plan, suite, status] of [
    ['merge_group', 'skipped', 'success', 0],
    ['merge_group', 'success', 'success', 1],
    ['merge_group', 'skipped', 'failure', 1],
    ['merge_group', 'skipped', 'skipped', 1],
    ['merge_group', 'skipped', 'cancelled', 1],
    ['merge_group', 'failure', 'success', 1],
    ['pull_request', 'success', 'success', 0],
    ['pull_request', 'skipped', 'success', 1],
    ['pull_request', 'success', 'failure', 1],
    ['push', 'success', 'success', 0],
    ['push', 'skipped', 'success', 1],
    ['push', 'failure', 'success', 1],
  ]) assert.equal(verdict(event, plan, suite), status, `${event} plan=${plan} suite=${suite}`);
  assert.equal(verdict('push', 'skipped', 'skipped', 'https://example.test/run/1'), 0, 'a push the queue already verified');
  assert.equal(verdict('merge_group', 'skipped', 'skipped', 'https://example.test/run/1'), 1, 'only a push may rely on a queue run');
  assert.equal(verdict('pull_request', 'success', 'success', '', 'true'), 0, 'the draft tier');
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
