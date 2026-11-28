/**
 * D9050 (#9050): whether production has actually shipped, from GitHub's own run records only.
 *
 * A run of `cloudflare-worker-deploy.yml` whose publish job was skipped (admission did not verify the candidate) still
 * ends `success`, so the workflow-failure reporter never sees it. Production stood still from 2026-11-21 to 2026-11-27
 * (#8932) and only the red post-deploy smoke said so. This reads the deploy workflow's `main` runs and, newest first,
 * the jobs of each run until one published, and names what is wrong:
 *
 *   release_stale     the newest run that published started longer ago than RELEASE_MAX_AGE_MS, and the `main` tip is
 *                     not the commit it published (nothing waiting to ship is not stale);
 *   approval_pending  the deploy job has waited on the production environment's approval longer than
 *                     APPROVAL_GRACE_MS (the reason `opsScheduleHealth` already names).
 *
 * A run published when its `Deploy to Cloudflare Worker` step concluded `success` (with no steps listed, when the
 * `build and deploy studioos Worker` job did). A job that failed at `Apply pending D1 migrations` did not publish.
 *
 * Unreadable evidence is `active: null`, never a recovery: an open alert stays open until a read proves it healthy.
 */
import { APPROVAL_GRACE_MS } from './opsScheduleHealth.mjs';

export const DEPLOY_WORKFLOW = 'cloudflare-worker-deploy.yml';
export const DEPLOY_JOB = 'build and deploy studioos Worker';
export const PUBLISH_STEP = 'Deploy to Cloudflare Worker';
/** Production may stand still this long while `main` moves before the alert opens. */
export const RELEASE_MAX_AGE_MS = 24 * 60 * 60_000;
/** The runs one read lists; the jobs are read only for the runs up to the newest that published. */
export const RELEASE_RUNS_READ = 30;

const time = (value) => Date.parse(value || '');
const SHA = /^[0-9a-f]{40}$/;

/** Whether one run published: true, false, or null when its jobs could not be read. */
export function runPublished(jobs) {
  if (!Array.isArray(jobs)) return null;
  // `filter=all` lists every attempt's jobs: a re-run that published counts.
  return jobs.filter((job) => job?.name === DEPLOY_JOB).some((job) => {
    const step = Array.isArray(job.steps) ? job.steps.find((s) => s?.name === PUBLISH_STEP) : undefined;
    return step ? step.conclusion === 'success' : job.conclusion === 'success';
  });
}

/** When the run's deploy job started waiting on approval, or NaN when it is not waiting. */
function waitingSince(run, jobs) {
  const job = Array.isArray(jobs) ? jobs.find((j) => j?.name === DEPLOY_JOB && j.status === 'waiting') : undefined;
  if (job) return time(job.created_at || job.started_at || run.created_at);
  return run?.status === 'waiting' ? time(run.created_at) : NaN;
}

/**
 * `runs` is `GET /actions/workflows/cloudflare-worker-deploy.yml/runs?branch=main` newest first; `jobsByRun` maps a run
 * id to its jobs (`filter=all`), or to null when they could not be read, and has no entry for a run not read;
 * `main` is `{ sha, at }` of the `main` tip (the decision reads `sha`; `at` is reported), or null when it could not be read.
 */
export function releaseHealth({ runs, jobsByRun = {}, main = null, now }) {
  const unknown = { active: null, ageHours: null, lastPublishedSha: null, waitingApproval: false, reasons: [] };
  if (!Array.isArray(runs) || !Number.isFinite(now)) return unknown;
  const own = runs.filter((run) => run?.head_branch === 'main')
    .sort((a, b) => time(b.created_at) - time(a.created_at));
  const waitingApproval = own.some((run) => now - waitingSince(run, jobsByRun[run.id]) > APPROVAL_GRACE_MS);
  const reasons = waitingApproval ? ['approval_pending'] : [];

  let published = null;
  for (const run of own) {
    const did = runPublished(jobsByRun[run.id]);
    if (did === null) return { ...unknown, waitingApproval, reasons };
    if (did) { published = run; break; }
  }
  const tipKnown = Boolean(main && SHA.test(main.sha || ''));
  if (published) {
    const startedAt = time(published.run_started_at || published.created_at);
    if (!Number.isFinite(startedAt)) return { ...unknown, waitingApproval, reasons };
    const ageHours = Math.max(0, Math.floor((now - startedAt) / 3_600_000));
    const lastPublishedSha = SHA.test(published.head_sha || '') ? published.head_sha : null;
    if (now - startedAt <= RELEASE_MAX_AGE_MS) return { active: false, ageHours, lastPublishedSha, waitingApproval, reasons };
    if (!tipKnown) return { active: null, ageHours, lastPublishedSha, waitingApproval, reasons };
    // Nothing newer on `main` is nothing to ship, however old the release. Every push to `main` starts a run of this
    // workflow, so a tip other than the published commit is newer than it. Commit times are not compared: the merge
    // queue builds a candidate before the run ahead of it starts, so a newer commit can carry an earlier time.
    const stale = main.sha !== published.head_sha;
    return { active: stale, ageHours, lastPublishedSha, waitingApproval, reasons: stale ? ['release_stale', ...reasons] : reasons };
  }
  // No listed run published. The last release is older than every listed run, so it is stale once the oldest listed
  // run is past the bound; a listing that spans less than the bound cannot say how old it is.
  const oldest = own.length ? time(own[own.length - 1].created_at) : NaN;
  if (!Number.isFinite(oldest) || now - oldest <= RELEASE_MAX_AGE_MS || !tipKnown) return { ...unknown, waitingApproval, reasons };
  return { active: true, ageHours: null, lastPublishedSha: null, waitingApproval, reasons: ['release_stale', ...reasons] };
}

/** The release as one entry beside `workflowHealth`'s, for `opsScheduleHealth`. */
export function releaseWorkflowResult(state) {
  return { workflow: DEPLOY_WORKFLOW, label: 'production release', readable: state.active !== null, reasons: state.reasons, waiting: state.waitingApproval ? 1 : 0, ageHours: null };
}

/**
 * Read the evidence with `gh(path)` (a GitHub REST GET returning parsed JSON): the deploy runs on `main`, the jobs of
 * each run newest first until one published, and the `main` tip. A failed read leaves that piece unread, never empty.
 */
export async function readReleaseEvidence({ gh, repo }) {
  let runs = null;
  const jobsByRun = {};
  let main = null;
  try {
    const listing = await gh(`/repos/${repo}/actions/workflows/${DEPLOY_WORKFLOW}/runs?branch=main&per_page=${RELEASE_RUNS_READ}`);
    runs = Array.isArray(listing?.workflow_runs) ? listing.workflow_runs : null;
  } catch { runs = null; }
  for (const run of (runs || []).filter((r) => r?.head_branch === 'main').sort((a, b) => time(b.created_at) - time(a.created_at))) {
    if (!Number.isSafeInteger(run.id)) break;
    try {
      const body = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`);
      jobsByRun[run.id] = Array.isArray(body?.jobs) ? body.jobs : null;
    } catch { jobsByRun[run.id] = null; }
    if (runPublished(jobsByRun[run.id]) !== false) break;
  }
  try {
    const tip = await gh(`/repos/${repo}/commits/main`);
    if (SHA.test(tip?.sha || '')) main = { sha: tip.sha, at: tip.commit?.committer?.date || null };
  } catch { main = null; }
  return { runs, jobsByRun, main };
}
