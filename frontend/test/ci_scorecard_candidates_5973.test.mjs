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
/** The four queue workflow runs of one candidate. `jobs(name)` gives [start, end, conclusion?]; `sampled: false` leaves every run without jobs. */
function candidate(c, pr, at, jobs, { sampled = true, status = 'completed', conclusion = 'success' } = {}) {
  const head_branch = `gh-readonly-queue/main/pr-${pr}-${sha('9')}`;
  const run = (path, names, id) => ({
    id, event: 'merge_group', path: `.github/workflows/${path}`, name: path, head_sha: sha(c), head_branch,
    created_at: t(at), updated_at: t(at + 1), status, conclusion,
    ...(sampled ? { jobs: names.map(n => job(n, at, ...jobs(n))) } : {}),
  });
  return [run('ci.yml', CI, 1), run('gitleaks.yml', ['scan'], 2), run('migration-immutability.yml', ['applied migrations unchanged'], 3), run('dependency-review.yml', ['Dependency Review'], 4)];
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
  assert.deepEqual(m.QUEUE_WORKFLOWS, ['.github/workflows/ci.yml', '.github/workflows/dependency-review.yml', '.github/workflows/gitleaks.yml', '.github/workflows/migration-immutability.yml']);
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
  // D5973 part 2: one plan for D5973's candidates and D6678's queue listing.
  const b = m.BUDGET;
  const plan = m.requestPlan();
  assert.equal(b.cap, 385);
  // Listings before the sample: 10 run pages + 4 queue workflows x 5 pages + 1 rules read = 31 (D8641: Dependency Review is the fourth).
  assert.equal(plan.listings, 31);
  // The sample: 23 SHAs x 4 queue workflows + (74 - 23) more ci.yml queue runs + 3 events x 12 = 179 job reads,
  // exactly 210 - 31 = 179 (D8641), so prior-attempt reads get only what the sample leaves unread.
  assert.equal(plan.sample, 179);
  assert.equal(plan.jobRoom, 179);
  assert.ok(plan.sample <= plan.jobRoom, 'the whole job sample fits before jobsUntil');
  // Timelines and head listings keep D6678's room: 370 - 210 - 2 PR-list pages = 158.
  assert.equal(plan.timelineRoom, 158);
  // Worst case: a timeline step starts at 369 and takes 3 pages + 1 head listing (373), then 10 comment pages + 1 write = 384.
  assert.equal(plan.worst, 384);
  assert.ok(plan.worst <= b.cap, 'the comment always fits');
  const cli = readFileSync(new URL('../../scripts/ci-scorecard.mjs', import.meta.url), 'utf8');
  assert.match(cli, /const \{ cap \} = BUDGET;/);
  assert.doesNotMatch(cli, /requests [<>]=? \d/, 'every phase line comes from BUDGET');
  // Every page limit and sample size comes from BUDGET.
  assert.equal(cli.match(/await pages\([^)]*, \d+\)/g), null);
  assert.doesNotMatch(cli, /evenlySpaced\([^)]*, \d+\)|slice\(0, \d+\)/);
  assert.match(cli, /actions\/workflows\/\$\{file\}\/runs\?event=merge_group&created=\$\{created\}`, BUDGET\.queuePages,/);
  const yml = readFileSync(new URL('../../.github/workflows/ci-scorecard.yml', import.meta.url), 'utf8');
  assert.match(yml, /CI_SCORECARD_ROWS: \$\{\{ runner\.temp \}\}\/ci-scorecard-candidates\.json\n/);
  assert.match(yml, /if: always\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+name: ci-scorecard-candidates\n\s+path: \$\{\{ runner\.temp \}\}\/ci-scorecard-candidates\.json\n/);
});

test('the rows read every listing: a candidate split across the queue listing and the all-workflow listing is classified whole', () => {
  // D5973 part 2: ci.yml's queue run from its own listing, the other two from the capped all-workflow listing.
  const ids = (list, base) => list.map((r, i) => ({ ...r, id: base + i }));
  const [ci, gitleaks, migrations] = ids(candidate('f', 106, 0, n => n === 'frontend (build)' ? [20, 30, 'failure'] : [20, 25]), 60);
  const split = pr(106, [removed(-2, 31)]);
  // A prior attempt pushed beside its run (same id) never stands in for it.
  const union = m.unionRuns([gitleaks, migrations], [{ ...ci, priorAttempt: true, jobs: [] }], [ci]);
  assert.deepEqual(union.map(r => r.id), [61, 62, 60]);
  assert.equal(m.candidateRows({ runs: union, prs: [split], deadline: 90 })[0].outcome, 'failed-check');
  // The report's own default reads both listings too.
  assert.match(m.report({ runs: [gitleaks, migrations], queueRuns: [ci], prs: [split], start: T0, now: T0 + 86_400_000, requests: 0 }),
    /\| Merge-group candidates by outcome \| deadline-expired 0, failed-check 1, cancelled-or-superseded 0, merged 0, missing-evidence 0 \(n=1\)/);
  // A row with jobs wins over the same id without; a candidate missing one workflow's run is missing evidence, never guessed.
  const bare = { ...gitleaks, jobs: undefined };
  assert.equal(m.unionRuns([bare], [gitleaks])[0], gitleaks);
  const [eci, egl] = ids(candidate('7', 107, 0, n => n === 'test:drift (full suite)' ? [80, null] : [30, 60], { status: 'in_progress', conclusion: null }), 70);
  const partial = m.candidateRows({ runs: m.unionRuns([egl], [eci]), prs: [pr(107, [removed(-1, 91)])], deadline: 90 })[0];
  assert.equal(partial.outcome, 'missing-evidence');
  assert.match(partial.evidence, /required jobs not sampled/);
});

test('the job sample takes whole SHAs first, listed ones first, then more ci.yml queue runs, then the other events', () => {
  // D5973 part 2: queue runs of four head SHAs, four workflows each; only SHA 1's ci.yml run is in the capped listing.
  const q = (c, path, id) => ({ id, event: 'merge_group', path: `.github/workflows/${path}`, head_sha: sha(c) });
  const queueRuns = ['4', '3', '2', '1'].flatMap((c, i) => ['migration-immutability.yml', 'ci.yml', 'dependency-review.yml', 'gitleaks.yml'].map((p, j) => q(c, p, 10 * i + j)));
  const listedCi = queueRuns.find(r => r.head_sha === sha('1') && r.path.endsWith('/ci.yml'));
  const other = (event, id) => ({ id, event, path: '.github/workflows/x.yml', head_sha: sha('0') });
  const runs = [listedCi, other('pull_request', 100), other('pull_request', 101), other('push', 102), other('schedule', 103),
    queueRuns.find(r => r.head_sha === sha('2') && r.path.endsWith('gitleaks.yml'))];
  const budget = { ...m.BUDGET, wholeShas: 2, queueCiRuns: 3, perEvent: 1 };
  const pick = m.jobSample({ runs, queueRuns, budget }).map(r => `${r.head_sha[0]}:${r.path.split('/').pop()}:${r.event}`);
  assert.deepEqual(pick, [
    // The listed SHA first, whole; then the rest, evenly spaced (one slot: the first, SHA 4), whole.
    '1:ci.yml:merge_group', '1:dependency-review.yml:merge_group', '1:gitleaks.yml:merge_group', '1:migration-immutability.yml:merge_group',
    '4:ci.yml:merge_group', '4:dependency-review.yml:merge_group', '4:gitleaks.yml:merge_group', '4:migration-immutability.yml:merge_group',
    // One more ci.yml queue run brings ci.yml to queueCiRuns = 3.
    '3:ci.yml:merge_group',
    // One each of pull_request, push and other; SHA 2's listed gitleaks queue run is not "other".
    '0:x.yml:pull_request', '0:x.yml:push', '0:x.yml:schedule',
  ]);
  // At the stated sizes a busy day fills the plan exactly: 23 x 4 + (74 - 23) + 3 x 12 = 179.
  const busy = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0')).flatMap((c, i) =>
    ['ci.yml', 'dependency-review.yml', 'gitleaks.yml', 'migration-immutability.yml'].map((p, j) => ({ ...q('a', p, 1000 + 4 * i + j), head_sha: c.repeat(20) })));
  const events = ['pull_request', 'push', 'schedule'].flatMap((e, i) => Array.from({ length: 20 }, (_, k) => other(e, 5000 + 100 * i + k)));
  const full = m.jobSample({ runs: events, queueRuns: busy });
  assert.equal(full.length, m.requestPlan().sample);
  assert.equal(full.filter(r => r.event === 'merge_group' && r.path.endsWith('/ci.yml')).length, 74);
  assert.equal(new Set(full.filter(r => r.event === 'merge_group' && !r.path.endsWith('/ci.yml')).map(r => r.head_sha)).size, 23);
});
