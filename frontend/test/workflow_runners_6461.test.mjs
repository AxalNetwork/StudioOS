/**
 * #6461 — pull_request workflows do not waste runners, and none runs on `pull_request_target`.
 *
 *   · every workflow a pull request starts has a concurrency group that cancels a superseded run,
 *     and one that also runs on push, a merge-queue entry or a schedule cancels only pull-request runs;
 *   · a workflow that is not a required check skips drafts (every job it starts checks
 *     `pull_request.draft`) and runs again on `ready_for_review`, unless it is listed below with why;
 *   · the required `scan` and `applied migrations unchanged` run on every push, draft or not;
 *   · no workflow is triggered by `pull_request_target` (GitHub blocks it on public repositories from
 *     2026-12-02, and claude-review.yml, the one that could have needed it, runs on `pull_request`
 *     with its reviewer code taken from the base commit).
 *
 * The workflows are read as text (the repository has no YAML parser installed), with the same
 * two-space layout every file under .github/workflows uses.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/workflow_runners_6461.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../../.github/workflows/', import.meta.url);
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
const SRC = Object.fromEntries(FILES.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]));

/** The workflow with comments removed (a comment may name `pull_request_target`). */
const code = (src) => src.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
/** A top-level block: the lines after `^key:` up to the next top-level key. */
function block(src, key) {
  const lines = code(src).split('\n');
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return null;
  const out = [lines[at].slice(key.length + 1)];
  for (let i = at + 1; i < lines.length && !/^\S/.test(lines[i]); i++) out.push(lines[i]);
  return out.join('\n');
}
export function eventsOf(src) {
  const on = block(src, 'on') ?? '';
  const inline = /^\s*\[([^\]]*)\]/.exec(on) || /^\s*([a-z_]+)\s*$/.exec(on.split('\n')[0]);
  if (inline && inline[1].trim()) return inline[1].split(',').map((s) => s.trim());
  return [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}
function prTypes(src) {
  const on = block(src, 'on') ?? '';
  const pr = /^ {2}pull_request:\n((?: {4,}.*\n?)*)/m.exec(on);
  const t = pr && /^ {4}types:\s*\[([^\]]*)\]/m.exec(pr[1]);
  return t ? t[1].split(',').map((s) => s.trim()) : null; // null: GitHub's default (opened, synchronize, reopened)
}
function concurrencyOf(src) {
  const c = block(src, 'concurrency');
  if (c == null) return null;
  return { group: (/^ {2}group:\s*(.+)$/m.exec(c) || [])[1]?.trim() ?? null, cancel: (/^ {2}cancel-in-progress:\s*(.+)$/m.exec(c) || [])[1]?.trim() ?? null };
}
export function jobsOf(src) {
  const body = block(src, 'jobs') ?? '';
  const parts = body.split(/^ {2}(?=[A-Za-z0-9_-]+:\s*$)/m).slice(1);
  return parts.map((p) => {
    const [head, ...rest] = p.split('\n');
    const text = rest.join('\n');
    const ifm = /^ {4}if:\s*(.*(?:\n {6,}.*)*)/m.exec(text);
    return {
      id: head.replace(/:\s*$/, ''),
      name: (/^ {4}name:\s*(.+)$/m.exec(text) || [])[1]?.trim() ?? null,
      if: ifm ? ifm[1].replace(/\s+/g, ' ').trim() : null,
      needs: /^ {4}needs:/m.test(text),
    };
  });
}

const PR_CANCEL_ONLY = /^\$\{\{\s*github\.event_name == 'pull_request'\s*\}\}$/;
const skipsDrafts = (cond) => /pull_request\.draft/.test(cond || '');

/**
 * Pull-request workflows that run on drafts on purpose, each with why. Exact: an entry for a file
 * that is gone, or that no longer runs on pull_request, fails, so the list cannot go stale.
 */
export const RUNS_ON_DRAFTS = {
  'ci.yml': 'ci.yml is #6460\'s (draft tiering, PR #6486); #6461 does not touch it',
  'gitleaks.yml': 'its `scan` is a required check and reports on every push',
  'migration-immutability.yml': 'its `applied migrations unchanged` is a required check and reports on every push',
  'codeql.yml': 'CodeQL is D5602\'s, out of #6461\'s scope',
  'semgrep.yml': 'Semgrep is D5602\'s, out of #6461\'s scope',
  'landing-policy.yml': 'it reports the landing tier a pull request is heading for; #6461 gives it concurrency only',
  'agent-compute-image.yml': 'path-filtered to the agent-compute image\'s own files, so a draft that touches them is checking them',
  'meeting-bot-image.yml': 'path-filtered to the meeting bot\'s own files, so a draft that touches them is checking them',
  'dependency-review.yml': 'D7899 checks newly introduced vulnerable dependencies on every PR and merge group, including drafts, without checking out candidate code',
  'ownership.yml': 'D8075 reports coordination overlaps before work leaves draft; bounded read-only issue/file scan and parser tests only',
};
/** Jobs that run on drafts inside a workflow that otherwise skips them, each with why. */
export const JOB_RUNS_ON_DRAFTS = {
  'claude-review.yml': { review: 'the reviewer decides on drafts itself (CLAUDE_REVIEW_DRAFTS), and is off until enabled' },
};
const REQUIRED = [['gitleaks.yml', 'scan'], ['migration-immutability.yml', 'applied migrations unchanged']];

export function problems(src) {
  const out = [];
  for (const [file, s] of Object.entries(src)) {
    const events = eventsOf(s);
    if (/^\s+pull_request_target:|^on:.*pull_request_target/m.test(code(s))) out.push(`${file}: triggered by pull_request_target`);
    if (!events.includes('pull_request')) continue;
    const c = concurrencyOf(s);
    if (!c || !c.group) { out.push(`${file}: no concurrency group for pull_request runs`); continue; }
    const others = events.filter((e) => ['push', 'merge_group', 'schedule'].includes(e));
    if (others.length ? !PR_CANCEL_ONLY.test(c.cancel || '') : !(c.cancel === 'true' || PR_CANCEL_ONLY.test(c.cancel || ''))) {
      out.push(`${file}: cancel-in-progress is ${c.cancel}; ${others.length ? `it also runs on ${others.join(', ')}, which must never be cancelled` : 'a superseded pull_request run is not cancelled'}`);
    }
    if (RUNS_ON_DRAFTS[file]) continue;
    const types = prTypes(s);
    if (!types || !types.includes('ready_for_review')) out.push(`${file}: skips drafts but does not run on ready_for_review`);
    for (const job of jobsOf(s)) {
      if (job.needs || JOB_RUNS_ON_DRAFTS[file]?.[job.id]) continue;
      if (!skipsDrafts(job.if)) out.push(`${file}: job ${job.id} runs on a draft`);
    }
  }
  for (const [file, name] of REQUIRED) {
    const job = src[file] && jobsOf(src[file]).find((j) => j.name === name || j.id === name);
    if (!job) out.push(`${file}: the required ${name} is gone`);
    else if (skipsDrafts(job.if)) out.push(`${file}: the required ${name} skips drafts`);
  }
  for (const file of Object.keys(RUNS_ON_DRAFTS)) {
    if (!src[file]) out.push(`RUNS_ON_DRAFTS names ${file}, which does not exist`);
    else if (!eventsOf(src[file]).includes('pull_request')) out.push(`RUNS_ON_DRAFTS names ${file}, which no pull request starts`);
  }
  return out;
}

test('#6461: every pull_request workflow cancels superseded runs, skips drafts unless listed, and none uses pull_request_target', () => {
  assert.deepEqual(problems(SRC), []);
});

test('#6461: the reader sees every workflow a pull request starts, and each job of the ones it checks', () => {
  const pr = FILES.filter((f) => eventsOf(SRC[f]).includes('pull_request'));
  assert.ok(pr.length >= 20, `only ${pr.length} pull_request workflows read`);
  for (const f of ['gitleaks.yml', 'landing-policy.yml', 'prompt-eval-gate.yml', 'changelog-gate.yml', 'claude-review.yml', 'deck-visual.yml', 'record-page-contracts.yml', 'form-lightbox-contracts.yml']) {
    assert.ok(pr.includes(f), f);
  }
  assert.deepEqual(jobsOf(SRC['claude-review.yml']).map((j) => j.id), ['selftest', 'review', 'alert-needed', 'alert']);
  for (const f of FILES.filter((x) => x.endsWith('-contracts.yml'))) {
    assert.ok(pr.includes(f), f);
    assert.ok(!RUNS_ON_DRAFTS[f], `${f} is not exempt`);
  }
});

// Mutation checked: each mutant below is a real way back to the waste, and each must be refused.
test('#6461: the guard refuses each way back', () => {
  const mutate = (file, from, to) => {
    assert.ok(SRC[file].includes(from), `${file} no longer holds: ${from}`);
    return { ...SRC, [file]: SRC[file].replace(from, to) };
  };
  const refused = (src, pattern) => assert.ok(problems(src).some((p) => pattern.test(p)), `not refused: ${pattern}`);
  // gitleaks without its group; gitleaks cancelling push and queue runs too.
  refused(mutate('gitleaks.yml', 'concurrency:\n', 'x-concurrency:\n'), /gitleaks\.yml: no concurrency group/);
  refused(mutate('gitleaks.yml', "cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: true'), /gitleaks\.yml: cancel-in-progress is true; it also runs on push, merge_group/);
  refused(mutate('landing-policy.yml', "cancel-in-progress: ${{ github.event_name == 'pull_request' }}", 'cancel-in-progress: false'), /landing-policy\.yml: cancel-in-progress is false/);
  // A contracts job back on drafts; a gate that never re-runs when the PR is marked ready.
  refused(mutate('record-page-contracts.yml', '    if: ${{ !github.event.pull_request.draft }}\n', ''), /record-page-contracts\.yml: job contracts runs on a draft/);
  // #9056: the release rehearsal back on drafts (D8532's cloudflare-worker/src/** path matches most PRs),
  // or skipping drafts but never running when the PR is marked ready.
  refused(mutate('release-rehearsal.yml', '    if: ${{ !github.event.pull_request.draft }}\n', ''), /release-rehearsal\.yml: job changes runs on a draft/);
  refused(mutate('release-rehearsal.yml', ', ready_for_review]', ']'), /release-rehearsal\.yml: skips drafts but does not run on ready_for_review/);
  refused(mutate('changelog-gate.yml', ', ready_for_review]', ']'), /changelog-gate\.yml: skips drafts but does not run on ready_for_review/);
  refused(mutate('claude-review.yml', '    if: ${{ !github.event.pull_request.draft }}\n', ''), /claude-review\.yml: job selftest runs on a draft/);
  // pull_request_target back in a trigger (a comment naming it is fine).
  refused(mutate('claude-review.yml', 'on:\n  pull_request:\n', 'on:\n  pull_request_target:\n  pull_request:\n'), /claude-review\.yml: triggered by pull_request_target/);
  assert.deepEqual(problems(mutate('claude-review.yml', 'on:\n', '# pull_request_target is not used\non:\n')), []);
  // The required scan skipping drafts.
  refused(mutate('gitleaks.yml', '    name: scan\n', '    name: scan\n    if: ${{ !github.event.pull_request.draft }}\n'), /the required scan skips drafts/);
  // A stale exemption.
  const { 'dependency-review.yml': _gone, ...withoutOne } = SRC;
  refused(withoutOne, /RUNS_ON_DRAFTS names dependency-review\.yml, which does not exist/);
});
