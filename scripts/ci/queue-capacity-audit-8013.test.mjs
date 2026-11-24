/** D8013: snapshot and GET transport fixtures for operator review, never live cancellation evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSnapshot, collectSnapshot, githubGet, main, LIMITS, PREFIX, REPOSITORY } from './queue-capacity-audit.mjs';

import { AT, SHA, MAIN, NEW, PR, branch, refPath, current, observation, run, pr, fixture } from './queue-capacity-audit-8013.fixture.mjs';

test('current attempt and newly queued aggregate waiting are distinct from original run age', () => {
  const result = auditSnapshot(fixture());
  const row = result.runs[0];
  assert.equal(row.originalRunAgeSeconds, 10 * 86400);
  assert.equal(row.currentAttempt.number, 2);
  assert.equal(row.currentAttempt.startedAgeSeconds, 300);
  assert.equal(row.currentAttempt.queueWaitSeconds, null);
  assert.equal(row.jobs[0].waitingSeconds, 60);
  assert.equal(result.cancellationReviewManifest.length, 1);
  const entry = result.cancellationReviewManifest[0];
  assert.equal(entry.runId, 11);
  assert.equal(entry.attempt, 2);
  assert.equal(entry.exactRef.path, refPath(branch));
  assert.equal(entry.exactRef.status, 404);
  assert.equal(entry.permissionToCancel, false);
  assert.equal(entry.remainingConsumers.externalDelegation, 'unknown_requires_operator_check');
  assert.ok(entry.requiresFreshGets.includes(current(11)));
  assert.ok(entry.requiresFreshGets.includes(refPath(branch)));
});

test('live refs and ref-SHA mismatch have distinct classifications and never become review targets', () => {
  for (const [sha, classification] of [[SHA, 'active_candidate'], [NEW, 'superseded_candidate']]) {
    const s = fixture();
    s.requests[refPath(branch)] = observation({ ref: `refs/heads/${branch}`, object: { type: 'commit', sha } });
    const result = auditSnapshot(s);
    assert.equal(result.runs[0].classification, classification);
    assert.equal(result.cancellationReviewManifest.length, 0);
  }
});

test('403, 5xx, timeout, absent evidence and partial ref data stay unknown', () => {
  for (const status of [403, 500, 503, 'timeout', 'unreadable', 'not_observed']) {
    const s = fixture();
    s.requests[refPath(branch)] = observation(null, status, { complete: status === 403 });
    const result = auditSnapshot(s);
    assert.equal(result.runs[0].classification, 'unknown_evidence', String(status));
    assert.equal(result.cancellationReviewManifest.length, 0);
  }
  for (const path of [PREFIX, refPath('main')]) {
    const s = fixture(); s.requests[path] = observation(null, 403);
    assert.equal(auditSnapshot(s).cancellationReviewManifest.length, 0);
  }
  const s = fixture(); s.requests[refPath(branch)] = observation(null, 404, { complete: false });
  assert.equal(auditSnapshot(s).runs[0].classification, 'unknown_evidence');
});

test('main pushes, PR-head work, unapproved workflows and terminal runs are excluded', () => {
  const cases = [
    [{ event: 'push', head_branch: 'main' }, 'protected_main_push'],
    [{ event: 'pull_request' }, 'protected_pr_head'],
    [{ head_sha: PR }, 'protected_pr_head'],
    [{ head_sha: MAIN }, 'protected_main_head'],
    [{ path: '.github/workflows/deploy.yml' }, 'unknown_evidence'],
    [{ status: 'completed', conclusion: 'success' }, 'terminal_work'],
  ];
  for (const [input, expected] of cases) {
    const result = auditSnapshot(fixture(input));
    assert.equal(result.runs[0].classification, expected);
    assert.equal(result.cancellationReviewManifest.length, 0);
  }
});

test('merged PR state is evidence; unreadable or ambiguous PR state blocks review', () => {
  const s = fixture();
  s.requests[`${PREFIX}/pulls/42`] = observation(pr({ state: 'closed', merged: true, merged_at: AT }));
  const result = auditSnapshot(s);
  assert.equal(result.runs[0].pullRequest.merged, true);
  assert.equal(result.cancellationReviewManifest.length, 1);
  for (const value of [observation(null, 403), observation(pr({ state: 'closed', merged: undefined }))]) {
    s.requests[`${PREFIX}/pulls/42`] = value;
    const blocked = auditSnapshot(s);
    assert.equal(blocked.cancellationReviewManifest.length, 0);
    assert.equal(blocked.heldForEvidence[0].remainingConsumers.complete, false);
  }
});

test('partial pages and known remaining consumers hold the exact-ref-missing candidate', () => {
  for (const path of [`${PREFIX}/pulls?state=open&per_page=100&page=1`, `${PREFIX}/actions/runs?status=waiting&per_page=100&page=1`]) {
    const s = fixture(); s.requests[path] = observation(null, 503, { complete: false });
    const result = auditSnapshot(s);
    assert.equal(result.cancellationReviewManifest.length, 0);
    assert.equal(result.heldForEvidence.length, 1);
  }
  const s = fixture();
  s.requests[`${PREFIX}/actions/runs?status=in_progress&per_page=100&page=1`] = observation({ total_count: 1, workflow_runs: [run({ id: 12, event: 'workflow_run', status: 'in_progress' })] });
  let result = auditSnapshot(s);
  assert.equal(result.cancellationReviewManifest.length, 0);
  assert.equal(result.heldForEvidence[0].remainingConsumers.otherActiveConsumers[0].runId, 12);
  s.requests[`${PREFIX}/actions/runs?status=in_progress&per_page=100&page=1`] = observation({ total_count: 0, workflow_runs: [] });
  s.requests[`${PREFIX}/git/matching-refs/heads/gh-readonly-queue/main/`] = observation([{ ref: 'refs/heads/gh-readonly-queue/main/other', object: { type: 'commit', sha: SHA } }]);
  result = auditSnapshot(s);
  assert.equal(result.cancellationReviewManifest.length, 0);
  assert.equal(result.heldForEvidence[0].remainingConsumers.liveRefs.length, 1);
});

test('a timestamped missing-ref snapshot becomes stale when the exact ref reappears', () => {
  const before = fixture();
  const after = structuredClone(before);
  after.observedAt = '2026-11-21T13:01:00.000Z';
  after.requests[refPath(branch)] = observation({ ref: `refs/heads/${branch}`, object: { type: 'commit', sha: SHA } }, 200, { observedAt: after.observedAt });
  assert.equal(auditSnapshot(before).cancellationReviewManifest.length, 1);
  assert.equal(auditSnapshot(after).runs[0].classification, 'active_candidate');
  assert.equal(auditSnapshot(after).cancellationReviewManifest.length, 0);
});

test('latest-attempt changes, foreign job identities, missing jobs and contradictory ref evidence cannot inherit proof', () => {
  const a = fixture(); a.requests[current(11)] = observation(run({ run_attempt: 3 }));
  assert.equal(auditSnapshot(a).runs[0].classification, 'unknown_evidence');
  const b = fixture(); b.requests[`${current(11)}/attempts/2/jobs?per_page=100&page=1`].data.jobs[0].run_attempt = 1;
  assert.equal(auditSnapshot(b).runs[0].jobsComplete, false);
  assert.equal(auditSnapshot(b).cancellationReviewManifest.length, 0);
  const c = fixture(); c.requests[`${current(11)}/attempts/2/jobs?per_page=100&page=1`].data.total_count = 2;
  assert.equal(auditSnapshot(c).cancellationReviewManifest.length, 0);
  assert.equal(auditSnapshot(c).runs[0].jobsComplete, false);
  const d = fixture(); d.requests[`${PREFIX}/git/matching-refs/heads/gh-readonly-queue/main/`] = observation([{ ref: `refs/heads/${branch}`, object: { type: 'commit', sha: NEW } }]);
  assert.equal(auditSnapshot(d).cancellationReviewManifest.length, 0);
});

test('the collector only asks for bounded read paths and exhausts requests conservatively', async () => {
  const source = fixture(); const paths = [];
  const snapshot = await collectSnapshot({ runIds: [11], now: () => AT, get: async path => { paths.push(path); return source.requests[path] ?? observation(null, 404); } });
  assert.equal(auditSnapshot(snapshot).cancellationReviewManifest.length, 1);
  assert.ok(paths.some(path => path.endsWith('/attempts/2/jobs?per_page=100&page=1')));
  assert.equal(paths.filter(path => path === current(11)).length, 2);
  const limited = await collectSnapshot({ runIds: [11], limits: { requests: 3 }, now: () => AT,
    get: async path => source.requests[path] ?? observation(null, 404) });
  const report = auditSnapshot(limited);
  assert.equal(limited.requestCount, 3);
  assert.equal(report.sample.requestBudgetExhausted, true);
  assert.equal(report.cancellationReviewManifest.length, 0);
  assert.equal(report.runs[0].classification, 'unknown_evidence');
});

test('GET transport refuses endpoint injection and redirects, bounds bodies, and never emits credentials', async () => {
  const calls = [];
  const get = githubGet({ token: 'synthetic-credential', now: () => AT, limits: { ...LIMITS, requests: 2 }, fetchImpl: async (url, init) => {
    calls.push([url, init]);
    return Response.json({ id: 10, full_name: REPOSITORY, private_field: 'not retained' });
  } });
  await assert.rejects(get(`${PREFIX}/actions/runs/11/cancel`), /read_path_refused/);
  await assert.rejects(get('https://elsewhere.invalid/steal'), /read_path_refused/);
  const response = await get(PREFIX);
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].redirect, 'error');
  assert.deepEqual(response.data, { id: 10, full_name: REPOSITORY });
  assert.doesNotMatch(JSON.stringify(response), /synthetic-credential|private_field/);
  await get(PREFIX);
  assert.equal((await get(PREFIX)).status, 'budget_exceeded');
  assert.equal(calls.length, 2);
  const tooBig = githubGet({ now: () => AT, limits: { ...LIMITS, responseBytes: 4 }, fetchImpl: async () => new Response('123456') });
  assert.equal((await tooBig(PREFIX)).status, 'response_bound');
  const timed = githubGet({ now: () => AT, fetchImpl: async () => { throw new DOMException('private', 'TimeoutError'); } });
  assert.equal((await timed(PREFIX)).status, 'timeout');
});

test('saved-snapshot CLI produces review evidence; mutation or write flags are rejected', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'queue-audit-8013-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'snapshot.json'); writeFileSync(path, JSON.stringify(fixture()));
  let output = '';
  assert.equal(await main(['--snapshot', path], { stdout: value => { output += value; } }), 0);
  assert.equal(JSON.parse(output).evidenceKind, 'timestamped_snapshot_not_live_authority');
  for (const flag of ['--cancel', '--write', '--dispatch']) await assert.rejects(main(['--snapshot', path, flag]), /usage/);
  assert.equal(readFileSync(path, 'utf8'), JSON.stringify(fixture()));
});

test('missing totals, bounded pagination and future observation times stay incomplete', () => {
  for (const mutate of [
    s => { delete s.requests[`${current(11)}/attempts/2/jobs?per_page=100&page=1`].data.total_count; },
    s => { s.requests[`${PREFIX}/pulls?state=open&per_page=100&page=1`].nextPage = true; },
    s => { s.requests[refPath(branch)].observedAt = '2026-11-21T13:02:00.000Z'; },
  ]) {
    const s = fixture(); mutate(s);
    assert.equal(auditSnapshot(s).cancellationReviewManifest.length, 0);
  }
  assert.throws(() => githubGet({ limits: { requests: 201 } }), /invalid_limits/);
});

test('co-reviewed missing-ref runs retain every exact attempt proof; a newer attempt holds its peer', () => {
  const s = fixture();
  const peer = run({ id: 12, workflow_id: 6, path: '.github/workflows/gitleaks.yml' });
  s.runIds.push(12);
  s.requests[current(12)] = observation(peer);
  s.requests[`${current(12)}/attempts/2`] = observation(peer);
  s.requests[`${current(12)}/attempts/2/jobs?per_page=100&page=1`] = observation({ total_count: 0, jobs: [] });
  s.requests[`${PREFIX}/actions/runs?status=queued&per_page=100&page=1`].data.workflow_runs.push(peer);
  s.requests[`${PREFIX}/actions/runs?status=queued&per_page=100&page=1`].data.total_count++;
  const reviewed = auditSnapshot(s);
  assert.equal(reviewed.cancellationReviewManifest.length, 2);
  assert.ok(reviewed.cancellationReviewManifest[0].requiresFreshGets.includes(`${current(12)}/attempts/2`));
  s.requests[current(12)] = observation({ ...peer, run_attempt: 3 });
  const changed = auditSnapshot(s);
  assert.equal(changed.cancellationReviewManifest.length, 0);
  assert.equal(changed.heldForEvidence[0].remainingConsumers.otherActiveConsumers[0].runId, 12);
});
