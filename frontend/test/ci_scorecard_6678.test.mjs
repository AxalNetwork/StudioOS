// D6678 (#6678): the scorecard's queue clock from the first entry, entries per merged PR,
// ready and green to merged, candidate start wait, merges per hour, and queue runs per PR.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as m from '../../scripts/lib/ciScorecard.mjs';

const at = (h, min = 0) => `2026-11-11T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`;
const start = Date.parse(at(0));
const now = Date.parse(at(6));
const queueRun = (pr, created, jobs, extra = {}) => ({
  id: Math.random(), event: 'merge_group', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success',
  head_branch: `gh-readonly-queue/main/pr-${pr}-abc`, created_at: created, jobs, ...extra,
});
const job = (started, runner = 7) => ({ name: 'suite', created_at: started, started_at: started, runner_id: runner });

// PR 1 was ejected once: queued 01:00-02:00, again 03:00 to its merge at 04:00.
const ejected = { number: 1, mergedAt: at(4), allEntries: [{ start: at(1), end: at(2) }, { start: at(3), end: at(4) }],
  entries: [{ start: at(1), end: at(2) }, { start: at(3), end: at(4) }] };
const once = { number: 2, mergedAt: at(5), allEntries: [{ start: at(4, 30), end: at(5) }], entries: [{ start: at(4, 30), end: at(5) }] };

test('queue to merge from the first entry keeps the time before an ejection; the last-entry row stays beside it', () => {
  assert.deepEqual(m.queueToMergeFirst([ejected, once]).p90, { value: 180, n: 2 });
  assert.deepEqual(m.queueToMerge([ejected, once]).p90, { value: 60, n: 2 });
  // An entry that ended before the window still counts as the first one.
  const early = { ...ejected, entries: [{ start: at(3), end: at(4) }] };
  assert.equal(m.queueToMergeFirst([early]).p50.value, 180);
  assert.equal(m.queueToMergeFirst([{ number: 3, mergedAt: null, allEntries: [{ start: at(1) }], entries: [] }]).p50.n, 0);
});

test('entries per merged PR: p50, p90 and the share merged on the first entry', () => {
  const again = { ...once, number: 5 };
  const result = m.entriesPerMergedPr([ejected, once, again, { number: 4, mergedAt: null, allEntries: [{ start: at(1) }], entries: [] }]);
  assert.deepEqual(result.p50, { value: 1, n: 3 });
  assert.deepEqual(result.p90, { value: 2, n: 3 });
  assert.deepEqual(result.firstEntry, { value: 2 / 3, n: 3 });
});

test('ready is the last ready_for_review before the merge, or creation for a PR never a draft', () => {
  const merge = { createdAt: at(0), mergedAt: at(5) };
  assert.equal(m.readyAt([], merge), at(0));
  assert.equal(m.readyAt([{ event: 'ready_for_review', created_at: at(1) }, { event: 'convert_to_draft', created_at: at(2) },
    { event: 'ready_for_review', created_at: at(3) }, { event: 'ready_for_review', created_at: at(6) }], merge), at(3));
  assert.equal(m.readyAt([{ event: 'convert_to_draft', created_at: at(2) }], merge), null);
  assert.equal(m.readyAt([], { mergedAt: at(5) }), null);
});

test('green is the last required workflow to succeed on the merged head; anything less is not measurable', () => {
  const sha = 'a'.repeat(40);
  const pr = (path, updated, extra = {}) => ({ event: 'pull_request', head_sha: sha, path, created_at: at(1), updated_at: updated,
    status: 'completed', conclusion: 'success', ...extra });
  const all = m.REQUIRED_WORKFLOWS.map((path, i) => pr(path, at(2, i * 10)));
  assert.equal(m.greenAt(all, sha), at(2, 20));
  assert.equal(m.greenAt(all.slice(1), sha), null, 'a required workflow with no run');
  assert.equal(m.greenAt([...all.slice(1), pr(all[0].path, at(2), { conclusion: 'failure' })], sha), null);
  // A later re-run that succeeded replaces the failed one.
  assert.equal(m.greenAt([...all, pr(all[0].path, at(2, 50), { created_at: at(2, 40) })], sha), at(2, 50));
  assert.equal(m.greenAt([...all.slice(1), pr(all[0].path, at(2), { head_sha: 'b'.repeat(40) })], sha), null);
  assert.equal(m.greenAt([...all.slice(1), pr(all[0].path, at(2), { event: 'merge_group' })], sha), null);
});

test('ready and green to merged starts at the later of the two and counts the unmeasurable, never as zero', () => {
  const rows = [
    { mergedAt: at(5), readyAt: at(1), greenAt: at(3) },
    { mergedAt: at(5), readyAt: at(4), greenAt: at(2) },
    { mergedAt: at(5), readyAt: at(1), greenAt: null },
    { mergedAt: at(5), readyAt: null, greenAt: at(1) },
    { mergedAt: null, readyAt: at(1), greenAt: at(1) },
  ];
  const result = m.readyGreenToMerged(rows);
  assert.deepEqual(result.p50, { value: 60, n: 2 });
  assert.deepEqual(result.p90, { value: 120, n: 2 });
  assert.equal(result.notMeasurable, 2);
});

test('candidate start wait runs to the first job with a runner; queued and skipped jobs have not started', () => {
  const runs = [
    queueRun(1, at(1), [job(at(1, 5), 0), job(at(1, 20)), job(at(1, 30))]),
    queueRun(2, at(2), [job(at(2), null), job(at(2), 0)]),
    queueRun(3, at(3), [job(at(3, 40))]),
    queueRun(4, at(3), undefined),
    queueRun(5, at(3), [job(at(3, 1))], { path: '.github/workflows/gitleaks.yml' }),
  ];
  const result = m.candidateStartWait(runs);
  assert.deepEqual(result.p50, { value: 20, n: 2 });
  assert.deepEqual(result.p90, { value: 40, n: 2 });
  assert.equal(result.noRunner, 1);
  assert.equal(result.sampled, 3);
});

test('merges per hour: the peak hour and the median of every whole hour, empty hours included', () => {
  const merged = [at(0, 10), at(0, 20), at(0, 50), at(2, 5), at(5, 59), at(6, 10)].map((mergedAt, number) => ({ number, mergedAt }));
  assert.deepEqual(m.mergesPerHour([...merged, { number: 9, mergedAt: null }], start, now), { n: 5, hours: 6, peak: 3, median: 0.5 });
  assert.deepEqual(m.mergesPerHour(merged, start, start + 60_000), { n: 0, peak: null, median: null, hours: 0 });
});

test('queue runs per PR read the merge-queue listing and only PRs whose entries all started in the window', () => {
  const runs = [queueRun(2, at(4, 40), []), queueRun(2, at(4, 50), []), queueRun(2, at(5, 30), []), queueRun(1, at(3, 10), [])];
  assert.deepEqual(m.runsPerQueuedPr(runs, [ejected, once], start), { value: 1.5, n: 2 });
  assert.deepEqual(m.runsPerQueuedPr(runs, [ejected, once], Date.parse(at(2))), { value: 2, n: 1 });
});

test('the report shows each new row, labelled, and the collector reads the queue listing and stays within its cap', () => {
  const output = m.report({ runs: [], queueRuns: [], prs: [ejected, once], start, now, requests: 3 });
  for (const row of ['Queue to merge, from the first entry (min)', 'Queue to merge, from the last entry (min)', 'Entries per merged PR',
    'Ready and green to merged (min) | p50 n/a (n=0), p90 n/a (n=0); not measurable 2', 'Candidate start wait (min)', 'Merges per hour | peak 1, median 0',
    'Queue CI runs per PR (entries inside the window)']) assert.ok(output.includes(row), row);
  assert.doesNotMatch(output, /\| Runs per queued PR \|/);
  const cli = readFileSync(new URL('../../scripts/ci-scorecard.mjs', import.meta.url), 'utf8');
  assert.match(cli, /actions\/workflows\/ci\.yml\/runs\?event=merge_group/);
  assert.match(cli, /actions\/runs\?head_sha=\$\{sha\}&event=pull_request/);
  // D5973 part 2: the cap and phase lines live in one object, BUDGET; ci_scorecard_candidates_5973 holds its arithmetic.
  const { cap, jobsUntil, timelinesUntil, timelinePages, queuePages, queueCiRuns } = m.BUDGET;
  assert.match(cli, /actions\/workflows\/ci\.yml\/runs\?event=merge_group&created=\$\{created\}`, BUDGET\.queuePages,/);
  assert.equal(queuePages, 5);
  assert.equal(queueCiRuns, 74);
  assert.equal(timelinePages, 3);
  // Timelines take up to three pages and one head listing; the tracker comment up to ten pages and one write.
  assert.ok(jobsUntil < timelinesUntil && timelinesUntil - 1 + 4 + 11 <= cap, `${jobsUntil} < ${timelinesUntil}, ${timelinesUntil} + 14 <= ${cap}`);
});

test('every required workflow exists and runs on pull_request', () => {
  for (const path of m.REQUIRED_WORKFLOWS) {
    const yml = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.match(yml, /^\s*pull_request:/m, path);
  }
});
