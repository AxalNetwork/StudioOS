/** D9050 (#9050): production that has not shipped is a `release_stale` reason in the scheduled-operations alert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOY_JOB, DEPLOY_WORKFLOW, PUBLISH_STEP, RELEASE_MAX_AGE_MS, readReleaseEvidence, releaseHealth, releaseWorkflowResult, runPublished,
} from './releaseHealth.mjs';
import { APPROVAL_GRACE_MS, OPS_REASONS, opsScheduleHealth } from './opsScheduleHealth.mjs';
import { safeHealthFacts } from '../health-alert-episodes.mjs';
import { message } from './githubAlerts.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-27T12:00:00Z');
const sha = (n) => String(n).padStart(2, '0').repeat(20);
const iso = (ms) => new Date(ms).toISOString();
const run = (id, createdAt, patch = {}) => ({
  id, head_branch: 'main', event: 'push', head_sha: sha(id), created_at: iso(createdAt), run_started_at: iso(createdAt),
  status: 'completed', conclusion: 'success', ...patch,
});
const steps = (publish) => [
  { name: 'Apply pending D1 migrations', conclusion: publish === 'migrations' ? 'failure' : 'success' },
  { name: PUBLISH_STEP, conclusion: publish === true ? 'success' : 'skipped' },
];
const job = (conclusion, patch = {}) => ({ name: DEPLOY_JOB, status: 'completed', conclusion, ...patch });
const admission = { name: 'Verify the exact main candidate', status: 'completed', conclusion: 'success' };
const published = [admission, job('success', { steps: steps(true) })];
const skipped = [admission, job('skipped', { steps: [] })];
const cancelled = [admission, job('cancelled', { steps: [] })];
const migrationFailed = [admission, job('failure', { steps: steps('migrations') })];

test('a deploy run published only when its publish step succeeded', () => {
  // Mutations checked: a skipped job counted as published (conclusion ignored); a failed migration counted (step ignored).
  assert.equal(runPublished(published), true);
  assert.equal(runPublished(skipped), false, 'a skipped publish job still ends the run success, but did not publish');
  assert.equal(runPublished(cancelled), false);
  assert.equal(runPublished(migrationFailed), false, 'a job that failed at the migrations step did not publish');
  assert.equal(runPublished([admission, job('failure', { steps: [{ name: PUBLISH_STEP, conclusion: 'success' }, { name: 'Record release phase outcomes', conclusion: 'failure' }] })]), true,
    'a step after the publish failing does not undo the publish');
  assert.equal(runPublished(null), null, 'unread jobs are not evidence');
});

test('a recent publish is healthy', () => {
  // Mutations checked: RELEASE_MAX_AGE_MS compared with >= (still healthy at 23 h); the age read from created_at of the newest run.
  assert.equal(RELEASE_MAX_AGE_MS, 24 * H, '#9050 starts the bound at 24 hours');
  const runs = [run(3, NOW - 2 * H), run(2, NOW - 23 * H)];
  const s = releaseHealth({ runs, jobsByRun: { 3: skipped, 2: published }, main: { sha: sha(3), at: iso(NOW - 2 * H) }, now: NOW });
  assert.deepEqual(s, { active: false, ageHours: 23, lastPublishedSha: sha(2), waitingApproval: false, reasons: [] });
});

test('only skipped and cancelled deploys for more than 24 h, with newer main commits, is release_stale', () => {
  // Mutations checked: the tip decided by commit time (the queue-built commit read as older); the reason dropped;
  // release_stale left out of OPS_REASONS; no listed publish read as unknown.
  const runs = [run(9, NOW - 1 * H), run(8, NOW - 10 * H), run(7, NOW - 20 * H, { conclusion: 'cancelled' }), run(6, NOW - 30 * H)];
  const jobsByRun = { 9: skipped, 8: skipped, 7: cancelled, 6: published };
  const s = releaseHealth({ runs, jobsByRun, main: { sha: sha(9), at: iso(NOW - 1 * H) }, now: NOW });
  assert.deepEqual(s, { active: true, ageHours: 30, lastPublishedSha: sha(6), waitingApproval: false, reasons: ['release_stale'] });
  // A merge-queue commit built before the published run started still waits to ship: the SHA decides, not its time.
  assert.equal(releaseHealth({ runs, jobsByRun, main: { sha: sha(9), at: iso(NOW - 31 * H) }, now: NOW }).active, true);
  assert.ok(OPS_REASONS.includes('release_stale'));
  const ops = opsScheduleHealth([{ workflow: 'backup-d1.yml', readable: true, reasons: [], ageHours: 3 }, releaseWorkflowResult(s)]);
  assert.deepEqual([ops.active, ops.reasons, ops.workflows], [true, ['release_stale'], [DEPLOY_WORKFLOW]]);
  // No listed run published, and the listing reaches past the bound: older than every listed run, so stale.
  const none = releaseHealth({ runs: runs.slice(0, 4), jobsByRun: { ...jobsByRun, 6: skipped }, main: { sha: sha(9), at: iso(NOW - H) }, now: NOW });
  assert.deepEqual([none.active, none.reasons, none.lastPublishedSha], [true, ['release_stale'], null]);
});

test('an old publish with no newer main commit is healthy: nothing to ship', () => {
  // Mutations checked: the tip test dropped (an old release with the published commit at the tip read as stale).
  const runs = [run(5, NOW - 40 * H)];
  const s = releaseHealth({ runs, jobsByRun: { 5: published }, main: { sha: sha(5), at: iso(NOW - 41 * H) }, now: NOW });
  assert.deepEqual([s.active, s.reasons, s.ageHours], [false, [], 40]);
});

test('a deploy waiting on approval for more than an hour is approval_pending', () => {
  // Mutations checked: APPROVAL_GRACE_MS not applied (a 30-minute wait counted); the waiting job's own time ignored.
  const runs = [run(4, NOW - 3 * H, { status: 'waiting', conclusion: null }), run(3, NOW - 5 * H)];
  const waitingJob = [admission, job(null, { status: 'waiting', created_at: iso(NOW - APPROVAL_GRACE_MS - 60_000) })];
  const s = releaseHealth({ runs, jobsByRun: { 4: waitingJob, 3: published }, main: { sha: sha(4), at: iso(NOW - 3 * H) }, now: NOW });
  assert.deepEqual(s, { active: false, ageHours: 5, lastPublishedSha: sha(3), waitingApproval: true, reasons: ['approval_pending'] });
  const ops = opsScheduleHealth([releaseWorkflowResult(s)]);
  assert.deepEqual([ops.active, ops.reasons], [true, ['approval_pending']]);
  const fresh = [admission, job(null, { status: 'waiting', created_at: iso(NOW - 30 * 60_000) })];
  assert.equal(releaseHealth({ runs, jobsByRun: { 4: fresh, 3: published }, main: null, now: NOW }).waitingApproval, false,
    'a wait shorter than the grace is not yet an alert, though the run itself is three hours old');
});

test('an unreadable listing is null and keeps the open alert open', () => {
  // Mutations checked: an unread run's jobs read as not published; an unreadable tip read as nothing to ship.
  assert.deepEqual(releaseHealth({ runs: null, now: NOW }).active, null);
  const runs = [run(2, NOW - 2 * H), run(1, NOW - 30 * H)];
  assert.equal(releaseHealth({ runs, jobsByRun: { 2: null }, main: { sha: sha(2), at: iso(NOW - 2 * H) }, now: NOW }).active, null,
    'jobs that could not be read are not a skipped publish');
  assert.equal(releaseHealth({ runs, jobsByRun: { 2: skipped, 1: published }, main: null, now: NOW }).active, null,
    'an old publish with an unreadable main tip cannot say whether anything waits');
  const ops = opsScheduleHealth([{ workflow: 'backup-d1.yml', readable: true, reasons: [], ageHours: 3 }, releaseWorkflowResult(releaseHealth({ runs: null, now: NOW }))]);
  assert.equal(ops.active, null, 'no observation, never a recovery');
});

test('the episode carries the last published SHA and its age, and nothing else from the run', () => {
  // Mutations checked: releaseSha or releaseAgeHours dropped by safeHealthFacts; the message not naming them.
  const facts = safeHealthFacts({ opsReasons: ['release_stale'], opsWorkflows: [DEPLOY_WORKFLOW], releaseSha: sha(6), releaseAgeHours: 30, releaseLog: 'x' });
  assert.deepEqual(facts, { opsReasons: ['release_stale'], opsWorkflows: [DEPLOY_WORKFLOW], releaseSha: sha(6), releaseAgeHours: 30 });
  assert.deepEqual(safeHealthFacts({ releaseSha: 'not-a-sha' }), {});
  const text = message('ops-schedules', 'open', facts);
  assert.match(text, /release_stale/);
  assert.match(text, new RegExp(`${sha(6).slice(0, 12)}[^\\n]*30 h`));
  assert.doesNotMatch(message('ops-schedules', 'open', { opsReasons: ['backup_stale'], ageHours: 30 }), /published/);
});

test('the evidence read stops at the newest run that published and never reads a failure as empty', async () => {
  // Mutations checked: jobs read for every listed run; a failed jobs read stored as [] (read as not published).
  const calls = [];
  const runs = [run(3, NOW - H), run(2, NOW - 2 * H), run(1, NOW - 3 * H)];
  const gh = async (path) => {
    calls.push(path);
    if (path.includes('/workflows/')) return { workflow_runs: runs };
    if (path.endsWith('/runs/3/jobs?filter=all&per_page=100')) return { jobs: skipped };
    if (path.endsWith('/runs/2/jobs?filter=all&per_page=100')) return { jobs: published };
    if (path.endsWith('/commits/main')) return { sha: sha(3), commit: { committer: { date: iso(NOW - H) } } };
    throw new Error('github_http_404');
  };
  const ev = await readReleaseEvidence({ gh, repo: 'o/r' });
  assert.deepEqual(Object.keys(ev.jobsByRun), ['2', '3']);
  assert.ok(!calls.some((p) => p.includes('/runs/1/')), 'run 1 is older than the newest publish and is not read');
  assert.deepEqual(ev.main, { sha: sha(3), at: iso(NOW - H) });
  const failing = await readReleaseEvidence({ gh: async (p) => { if (p.includes('/workflows/')) return { workflow_runs: runs }; throw new Error('github_http_500'); }, repo: 'o/r' });
  assert.deepEqual([failing.jobsByRun[3], failing.main, Object.keys(failing.jobsByRun)], [null, null, ['3']]);
});
