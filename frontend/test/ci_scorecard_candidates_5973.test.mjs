// #5973 (part of #5506): one row per merge-group head SHA, so a deadline
// expiry can be told apart from a failed check, a superseded candidate and a
// candidate whose evidence was not sampled. `deadline-expired` is never a guess.
//
// Run with:
//   node --test frontend/test/ci_scorecard_candidates_5973.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as m from '../../scripts/lib/ciScorecard.mjs';
import { REQUIRED } from '../../scripts/lib/requiredChecks.mjs';

const T0 = Date.parse('2026-11-10T17:00:00Z');
const t = min => new Date(T0 + min * 60_000).toISOString();
const sha = c => c.repeat(40);
const CI = ['test:drift (full suite)', 'worker (typecheck)', 'frontend (build)', 'api ↔ worker drift'];

/** A required job: queued at the request, started at `start`, done at `end` (null = still running). */
const job = (name, at, start, end, conclusion = end === null ? null : 'success') => ({
  name, created_at: t(at), started_at: t(start), completed_at: end === null ? null : t(end),
  status: end === null ? 'in_progress' : 'completed', conclusion,
});
/** The three queue workflow runs of one candidate. `jobs(name)` gives [start, end, conclusion?]; `sampled: false` leaves every run without jobs. */
function candidate(c, pr, at, jobs, { sampled = true, status = 'completed', conclusion = 'success' } = {}) {
  const head_branch = `gh-readonly-queue/main/pr-${pr}-${sha('9')}`;
  const run = (path, names, id) => ({
    id, event: 'merge_group', path: `.github/workflows/${path}`, name: path, head_sha: sha(c), head_branch,
    created_at: t(at), updated_at: t(at + 1), status, conclusion,
    ...(sampled ? { jobs: names.map(n => job(n, at, ...jobs(n))) } : {}),
  });
  return [run('ci.yml', CI, 1), run('gitleaks.yml', ['scan'], 2), run('migration-immutability.yml', ['applied migrations unchanged'], 3)];
}
const pr = (number, entries, mergeCommit = null) => ({ number, mergeCommit, mergedAt: null, entries });
const removed = (start, end, reason = null) => ({ start: t(start), end: t(end), endEvent: 'removed_from_merge_queue', reason });

// A healthy late candidate (#5506's c6db2e00 timings): first job 46 min after
// the request, the aggregate last at 100 min, merged as this very commit.
const late = candidate('a', 101, 0, n => n === 'test:drift (full suite)' ? [85, 100] : [46, 70]);
// A failed candidate: frontend (build) fails at 30 min, removal one minute later.
const red = candidate('b', 102, 0, n => n === 'frontend (build)' ? [20, 30, 'failure'] : [20, 25]);
// #5444's shape: entered 17:39:22, the candidate requested 17:51:13, removed
// 17:51:16 and the PR merged 8 s later as 8f1dbd0c, a commit with no queue run;
// the candidate's own checks all passed 100 min later.
const early = candidate('c', 103, 51 + 13 / 60, n => n === 'test:drift (full suite)' ? [137, 160] : [97, 125]);
// No job sample at all, removed 95 min after the request: past the deadline, but nothing shows a check pending.
const blind = candidate('d', 104, 0, () => [0, 0], { sampled: false, status: 'in_progress', conclusion: null });
// Every job sampled, the aggregate still running when GitHub removed it 91 min after the request.
const expired = candidate('e', 105, 0, n => n === 'test:drift (full suite)' ? [80, null] : [30, 60], { status: 'in_progress', conclusion: null });

const runs = [...late, ...red, ...early, ...blind, ...expired];
const prs = [
  pr(101, [{ start: t(-5), end: t(101), endEvent: 'merged', reason: null }], sha('a')),
  pr(102, [removed(-2, 31)]),
  pr(103, [{ start: t(39 + 22 / 60), end: t(51 + 16 / 60), endEvent: 'removed_from_merge_queue', reason: null }], sha('8')),
  pr(104, [removed(-1, 95)]),
  pr(105, [removed(-1, 91)]),
];
const rows = m.candidateRows({ runs, prs, deadline: 90 });
const row = c => rows.find(r => r.headSha === sha(c));

test('one row per merge-group head SHA, each with exactly one outcome', () => {
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.headSha).sort(), ['a', 'b', 'c', 'd', 'e'].map(sha));
  for (const r of rows) assert.ok(m.OUTCOMES.includes(r.outcome), r.outcome);
  assert.deepEqual(m.outcomeCounts(rows), { n: 5, counts: {
    'deadline-expired': 1, 'failed-check': 1, 'cancelled-or-superseded': 1, merged: 1, 'missing-evidence': 1 } });
});

test('a healthy late candidate is merged, with its request, first start and last required check', () => {
  const r = row('a');
  assert.equal(r.outcome, 'merged');
  assert.equal(r.pr, 101);
  assert.equal(r.requestedAt, t(0));
  assert.equal(r.firstRunnerStartedAt, t(46));
  assert.deepEqual(r.lastRequired, { name: 'test:drift (full suite)', completedAt: t(100), waitMinutes: 85, runtimeMinutes: 15 });
  assert.equal(r.queueEnteredAt, t(-5));
  assert.equal(r.queueRemovedAt, t(101));
  assert.equal(r.removalEvent, 'merged');
});

test('a failed candidate is failed-check, naming the check', () => {
  assert.equal(row('b').outcome, 'failed-check');
  assert.match(row('b').evidence, /^frontend \(build\) concluded failure$/);
  assert.equal(row('b').lastRequired.name, 'frontend (build)');
});

test('a candidate removed before its checks finished (#5444) is superseded, not expired', () => {
  const r = row('c');
  assert.equal(r.outcome, 'cancelled-or-superseded');
  assert.equal(r.evidence, 'removed, and the PR merged as another commit');
  assert.equal(r.queueRemovedAt, t(51 + 16 / 60));
  assert.equal(r.removalReason, null, 'the REST timeline records no reason; none is invented');
  assert.equal(r.lastRequired.completedAt, t(160));
  // Without the merge elsewhere it still reads as removed before the deadline.
  const alone = m.candidateRows({ runs: early, prs: [{ ...prs[2], mergeCommit: null }], deadline: 90 })[0];
  assert.equal(alone.outcome, 'cancelled-or-superseded');
  assert.match(alone.evidence, /before the 90 min deadline/);
});

test('a run with no job sample is missing-evidence even when removed past the deadline', () => {
  const r = row('d');
  assert.equal(r.outcome, 'missing-evidence');
  assert.match(r.evidence, /required jobs not sampled/);
  assert.equal(r.firstRunnerStartedAt, null);
  assert.equal(r.lastRequired, null);
});

test('deadline-expired only on evidence: a pending check at a removal at the deadline, or a recorded timeout reason', () => {
  assert.equal(row('e').outcome, 'deadline-expired');
  assert.match(row('e').evidence, /past the 90 min deadline, with test:drift \(full suite\) pending/);
  assert.equal(row('e').lastRequired, null);
  // The same candidate with the deadline unread, or removed long after it, is missing evidence.
  assert.equal(m.candidateRows({ runs: expired, prs: [prs[4]], deadline: null })[0].outcome, 'missing-evidence');
  assert.equal(m.candidateRows({ runs: expired, prs: [pr(105, [removed(-1, 90 + m.DEADLINE_SLACK_MIN + 1)])], deadline: 90 })[0].outcome, 'missing-evidence');
  // No timeline at all: missing evidence.
  assert.equal(m.candidateRows({ runs: expired, prs: [], deadline: 90 })[0].outcome, 'missing-evidence');
  // A reason GitHub recorded is enough, sampled or not.
  const reasoned = m.candidateRows({ runs: blind, prs: [pr(104, [removed(-1, 30, 'CI checks timed out')])], deadline: null })[0];
  assert.equal(reasoned.outcome, 'deadline-expired');
  assert.equal(reasoned.removalReason, 'CI checks timed out');
});

test('required checks come from the shared list, which the workflows check holds to the ruleset', () => {
  assert.deepEqual(m.QUEUE_WORKFLOWS, ['.github/workflows/ci.yml', '.github/workflows/gitleaks.yml', '.github/workflows/migration-immutability.yml']);
  const lib = readFileSync(new URL('../../scripts/lib/ciScorecard.mjs', import.meta.url), 'utf8');
  const wf = readFileSync(new URL('merge_queue_ci_4107.test.mjs', import.meta.url), 'utf8');
  for (const src of [lib, wf]) assert.match(src, /import \{ REQUIRED \} from '(?:\.\/|(?:\.\.\/)+scripts\/lib\/)requiredChecks\.mjs';/);
  assert.doesNotMatch(wf, /const REQUIRED =/);
  // A sample that lacks one of REQUIRED's checks is not a whole sample.
  const partial = expired.map(r => ({ ...r, jobs: r.jobs.filter(j => j.name !== Object.keys(REQUIRED).at(-1)) }));
  assert.equal(m.candidateRows({ runs: partial, prs: [prs[4]], deadline: 90 })[0].outcome, 'missing-evidence');
});

test('timeline parsing keeps the ending event, the merged commit and only a string reason', () => {
  const events = [
    { event: 'added_to_merge_queue', created_at: '2026-11-10T17:39:22Z' },
    { event: 'removed_from_merge_queue', created_at: '2026-11-10T17:51:16Z' },
    { event: 'merged', created_at: '2026-11-10T17:51:24Z', commit_id: '8f1dbd0c18fea1d6e8fe27ce51fe9213d22ffea6' },
    { event: 'added_to_merge_queue', created_at: '2026-11-10T18:00:00Z' },
    { event: 'removed_from_merge_queue', created_at: '2026-11-10T19:31:00Z', reason: { not: 'text' } },
  ];
  assert.deepEqual(m.queueEntries(events), [
    { start: '2026-11-10T17:39:22Z', end: '2026-11-10T17:51:16Z', endEvent: 'removed_from_merge_queue', reason: null },
    { start: '2026-11-10T18:00:00Z', end: '2026-11-10T19:31:00Z', endEvent: 'removed_from_merge_queue', reason: null },
  ]);
  assert.equal(m.mergeCommit(events), '8f1dbd0c18fea1d6e8fe27ce51fe9213d22ffea6');
  assert.equal(m.mergeCommit([{ event: 'merged', commit_id: 'not-a-sha' }]), null);
  assert.equal(m.queueDeadline([{ type: 'merge_queue', parameters: { check_response_timeout_minutes: 90 } }]), 90);
  assert.equal(m.queueDeadline([{ type: 'merge_queue', parameters: {} }]), null);
  assert.equal(m.queueDeadline(null), null);
});

test('the Markdown counts rows per class and the request plan fits under the stated cap', () => {
  const md = m.report({ runs, prs, start: T0, now: T0 + 86_400_000, requests: 0, rows, deadline: 90 });
  assert.match(md, /\| Merge-group candidates by outcome \| deadline-expired 1, failed-check 1, cancelled-or-superseded 1, merged 1, missing-evidence 1 \(n=5\); deadline 90 min;/);
  const b = m.BUDGET;
  assert.equal(b.cap, 200);
  assert.ok(b.runPages + b.rules <= b.jobsUntil);
  assert.ok(b.jobsUntil + b.prPages <= b.timelinesUntil);
  assert.ok(b.timelinesUntil + b.commentPages + b.writes <= b.cap, 'the comment always fits');
  const cli = readFileSync(new URL('../../scripts/ci-scorecard.mjs', import.meta.url), 'utf8');
  assert.match(cli, /const \{ cap \} = BUDGET;/);
  assert.doesNotMatch(cli, /requests [<>]=? \d/, 'every phase line comes from BUDGET');
  // Every page limit comes from BUDGET but a timeline's one page, which counts against timelinesUntil.
  assert.deepEqual(cli.match(/await pages\([^)]*, \d+\)/g), ['await pages(`issues/${number}/timeline`, 1)']);
  const yml = readFileSync(new URL('../../.github/workflows/ci-scorecard.yml', import.meta.url), 'utf8');
  assert.match(yml, /CI_SCORECARD_ROWS: \$\{\{ runner\.temp \}\}\/ci-scorecard-candidates\.json\n/);
  assert.match(yml, /if: always\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+name: ci-scorecard-candidates\n\s+path: \$\{\{ runner\.temp \}\}\/ci-scorecard-candidates\.json\n/);
});
