#!/usr/bin/env node
/**
 * GitHub health alerts to a Slack channel: the effects half (GitHub REST and
 * the Slack incoming webhook). The rules are `lib/githubAlerts.mjs`.
 *
 *   node scripts/github-alerts.mjs main-red        (reads the latest finished CI run on a push to main)
 *   node scripts/github-alerts.mjs review-blocked  OUTCOME, PR, RUN_URL
 *   node scripts/github-alerts.mjs queue           QUEUE_ALERT_QUEUED, QUEUE_ALERT_OLDEST_MIN, QUEUE_ALERT_IGNORE_BEFORE (optional)
 *   node scripts/github-alerts.mjs future-clock    FUTURE_CLOCK_DAYS, FUTURE_CLOCK_DIR (attempt-bound artifacts), RUN_URL;
 *                                                  failing test names to the job log and GITHUB_STEP_SUMMARY only (D7124)
 *   node scripts/github-alerts.mjs queue-stalled   (reads merge_group runs, their jobs and `ci-failure-id` annotations: checks: read, D7125)
 *   node scripts/github-alerts.mjs ops-schedules   (reads the D1 backup, magic-link probe and admin drift runs, and the
 *                                                  Worker deploy's runs, jobs and the main tip: actions: read, D8754, D9050)
 *
 * Always: GITHUB_TOKEN (issues: write for the three alert kinds; actions: read
 * for `main-red` and `queue`), GITHUB_REPOSITORY, and SLACK_GITHUB_WEBHOOK_URL. Without the
 * webhook, the issue is still opened or closed and the job warns; the trusted reporter fails visibly on unreadable evidence without changing the watched result.
 */
import { ALERT_KINDS, FAILURE_ID_TITLE, QUEUE_DEFAULTS, mainState, parseQueueCutoff, parseDeadlineWarnShare, possibleRepairs, message, queueAfterCutoff, queueDeadlineState, safeDeadlineCandidates, queueStallState, queueState, reviewState, stallEvidence, stallRunsToRead, stallTestFile, withQueueCutoffLine } from './lib/githubAlerts.mjs';
import { SUMMARY_JOBS, safeGithubUrl } from './lib/ciClassify.mjs';
import { appendFileSync, readFileSync } from 'node:fs';
import { readScanAlert, scanAlertBody, scanFacts } from './lib/scanScope.mjs';
import { createHealthMonitor, runSource } from './health-alert-episodes.mjs';
import { webhookDelivery } from './health-alert-transport.mjs';
import { fileRecoveryHealth, latestFileSnapshotRun } from './lib/fileRecoveryHealth.mjs';
import { WATCHED, opsScheduleHealth, workflowHealth } from './lib/opsScheduleHealth.mjs';
import { readReleaseEvidence, releaseHealth, releaseWorkflowResult } from './lib/releaseHealth.mjs';
import { futureClockReport } from './future-clock-report.mjs';
import { breakDate, futureClockLogLines, futureClockSummary, withFutureClockRunLine } from './lib/futureClockNames.mjs';

import { readDeadlineEvidence } from './lib/queueDeadline.mjs';

const env = process.env;
const api = env.GITHUB_API_URL || 'https://api.github.com';
const repo = env.GITHUB_REPOSITORY;

async function gh(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`github_http_${res.status}`);
  return res.status === 204 ? null : res.json();
}

let monitor;
const openIssue = kind => monitor.openIssue(kind);
const apply = async (kind, active, facts, source) => {
  const result = await monitor.apply(kind, active, facts, source);
  if (result.delivery.some(i => i.state !== 'acknowledged')) process.exitCode = 1;
  return result;
};

/**
 * D7125: a queue run's jobs, each failed job outside the summaries with its `ci-failure-id` annotation messages.
 * An annotation read that fails leaves that job's `annotations` null: its run is unknown, never a transition.
 */
async function stallJobs(runId) {
  const { jobs } = await gh(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&filter=latest`);
  return Promise.all((jobs || []).map(async job => {
    if (!['failure', 'timed_out'].includes(job?.conclusion) || SUMMARY_JOBS.has(job.name) || !Number.isSafeInteger(job.id)) return job;
    try {
      const rows = await gh(`/repos/${repo}/check-runs/${job.id}/annotations?per_page=50`);
      return { ...job, annotations: Array.isArray(rows) ? rows.filter(a => a?.title === FAILURE_ID_TITLE).map(a => String(a.message || '')) : null };
    } catch {
      return { ...job, annotations: null };
    }
  }));
}

/** D7125, best effort at open only: open PRs that change a failing test file and whose required checks are green. */
async function withRepairs(identities) {
  try {
    const files = new Set(identities.map(i => stallTestFile(i.id)).filter(Boolean));
    if (!files.size) return identities;
    const rules = await gh('/repos/' + repo + '/rules/branches/main');
    const required = (Array.isArray(rules) ? rules : []).filter(r => r?.type === 'required_status_checks')
      .flatMap(r => r.parameters?.required_status_checks || []).map(c => c?.context).filter(Boolean);
    const open = await gh(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=30`);
    const prs = [];
    for (const pr of (Array.isArray(open) ? open : []).slice(0, 30)) {
      if (!Number.isSafeInteger(pr?.number) || !/^[0-9a-f]{40}$/.test(pr.head?.sha || '')) continue;
      const changed = (await gh(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`) || []).map(f => f?.filename);
      if (!changed.some(f => files.has(f))) continue;
      const checks = await gh(`/repos/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`);
      prs.push({ number: pr.number, files: changed, checks: checks?.check_runs || [] });
    }
    return possibleRepairs(identities, prs, required);
  } catch {
    return identities;
  }
}

async function main() {
  const mode = process.argv[2];
  if (!env.GITHUB_TOKEN) throw new Error('github_token_missing');
  if (mode === 'scan') {
    const facts = scanFacts(JSON.parse(readFileSync(env.SCAN_FACTS_FILE, 'utf8')));
    if (!facts.baseline) return console.log('scan: no known baseline; no alert transition');
    // Separate scanners share one issue. Their short report jobs are serialized;
    // resolving one scanner cannot close the other's outstanding findings.
    let issue = null;
    for (let page = 1; page <= 100; page++) {
      const rows = await gh(`/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error('Unreadable scan alert inventory');
      issue = rows.find(row => !row.pull_request && row.title === ALERT_KINDS.scan.title);
      if (issue || rows.length < 100) break;
      if (page === 100) throw new Error('Scan alert inventory cap reached');
    }
    const states = issue ? readScanAlert(issue.body) : {};
    states[facts.scanner] = facts;
    const active = Object.values(states).some(state => Object.keys(state.counts).length > 0);
    if (!active && !issue) return;
    const body = scanAlertBody(states);
    if (!issue) return gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: ALERT_KINDS.scan.title, body }) });
    if (body !== issue.body) await gh(`/repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    if (!active) await gh(`/repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    return;
  }
  monitor = createHealthMonitor({ api: gh, repo, deliver: webhookDelivery({ url: env.SLACK_GITHUB_WEBHOOK_URL }), log: value => console.log(JSON.stringify(value)) });
  if (mode === 'file-backup') {
    if (env.FILE_RECOVERY_ENABLED !== 'true') return console.log('file-backup: disabled; no observation or transition');
    let observation;
    try { observation = JSON.parse(readFileSync(env.FILE_RECOVERY_HEARTBEAT_FILE, 'utf8')); }
    catch { observation = { read: 'unavailable' }; }
    const listing = await gh(`/repos/${repo}/actions/workflows/file-recovery.yml/runs?branch=main&status=completed&per_page=10`);
    if (!Array.isArray(listing?.workflow_runs)) throw new Error('file_backup_run_inventory_unreadable');
    const latestRun = latestFileSnapshotRun(listing.workflow_runs);
    const state = fileRecoveryHealth({ enabled: true, independentRequired: env.FILE_DR_SECOND_COPY_ENABLED === 'true',
      observation, latestRun, now: Date.now() });
    if (state.active === null) process.exitCode = 1;
    return apply('file-backup', state.active, { ...state, backupReason: state.reason, runUrl: safeGithubUrl(latestRun?.html_url) }, runSource(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT));
  }
  if (mode === 'ops-schedules') {
    // D8754: GitHub's run records only (actions: read). An unreadable listing is no observation, never a recovery.
    const now = Date.now();
    const results = [];
    for (const spec of WATCHED) {
      let runs = null, failedSteps = null;
      try {
        const listing = await gh(`/repos/${repo}/actions/workflows/${spec.workflow}/runs?branch=main&per_page=30`);
        runs = Array.isArray(listing?.workflow_runs) ? listing.workflow_runs : null;
        const finished = runs?.find(run => ['schedule', 'workflow_dispatch'].includes(run.event) && run.status === 'completed');
        if (finished?.conclusion === 'failure') {
          const jobs = await gh(`/repos/${repo}/actions/runs/${finished.id}/jobs?per_page=50`);
          failedSteps = Array.isArray(jobs?.jobs) ? jobs.jobs.flatMap(j => (j.steps || []).filter(st => st.conclusion === 'failure').map(st => String(st.name))) : null;
        }
      } catch (error) { console.log(JSON.stringify({ event: 'ops_schedule_unreadable', workflow: spec.workflow, error: String(error.message) })); }
      results.push(workflowHealth(spec, runs, failedSteps, now));
    }
    // D9050: whether the deploy workflow actually published, beside the scheduled jobs (same permissions).
    const release = releaseHealth({ ...(await readReleaseEvidence({ gh, repo })), now });
    results.push(releaseWorkflowResult(release));
    const state = opsScheduleHealth(results);
    console.log(JSON.stringify({ event: 'ops_schedule_state', active: state.active, reasons: state.reasons, workflows: state.workflows, ageHours: state.ageHours,
      release: { active: release.active, ageHours: release.ageHours, lastPublishedSha: release.lastPublishedSha, waitingApproval: release.waitingApproval } }));
    if (state.active === null) process.exitCode = 1;
    return apply('ops-schedules', state.active, { opsReasons: state.reasons, opsWorkflows: state.workflows, ageHours: state.ageHours ?? undefined,
      releaseSha: release.lastPublishedSha ?? undefined, releaseAgeHours: release.ageHours ?? undefined },
      runSource(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT));
  }
  if (mode === 'queue-deadline') {
    const warnShare = parseDeadlineWarnShare(env.QUEUE_DEADLINE_WARN_SHARE);
    const evidence=await readDeadlineEvidence({repo,
      rest:path=>gh(`/repos/${repo}/${path}`),
      graph:async(query,variables)=>{const r=await gh('/graphql',{method:'POST',body:JSON.stringify({query,variables})});if(r.errors?.length||!r.data)throw new Error('queue_membership_unreadable');return r.data;},
    });
    const open=await openIssue('queue-deadline');
    const state=queueDeadlineState({...evidence,now:Date.now(),issueOpen:Boolean(open),warnShare});
    if(state.active===null) process.exitCode=1;
    console.log(JSON.stringify({kind:'queue-deadline',active:state.active,deadlineMinutes:evidence.deadlineMinutes,candidates:safeDeadlineCandidates(state.candidates)}));
    if(env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, state.active===true ? `${message('queue-deadline','open',{deadlineCandidates:state.candidates})}\n` : `Queue deadline: ${state.active===false?'no near-deadline candidates':'unknown evidence; no recovery inferred'}.\n`);
    return apply('queue-deadline',state.active,{deadlineCandidates:state.candidates,runUrl:env.GITHUB_RUN_ID?`https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}`:undefined},runSource(env.GITHUB_RUN_ID,env.GITHUB_RUN_ATTEMPT));
  }
  if (mode === 'queue-stalled') {
    // D7125: every status, so a chain links through candidates still running or green; the newest 100 runs.
    const list = await gh(`/repos/${repo}/actions/workflows/${env.CI_WORKFLOW || 'ci.yml'}/runs?event=merge_group&per_page=100`);
    const runs = (list.workflow_runs || []).filter(run => run.head_branch?.startsWith('gh-readonly-queue/main/'));
    const newest = runs.find(run => run.status === 'completed');
    if (!newest) return;
    const read = new Set(stallRunsToRead(runs).map(run => run.id));
    const withJobs = await Promise.all(runs.map(async run => (read.has(run.id) && Number.isSafeInteger(run.id) ? { ...run, jobs: await stallJobs(run.id) } : run)));
    const state = queueStallState(withJobs);
    const evidence = stallEvidence(withJobs);
    console.log(JSON.stringify({ kind: 'queue-stalled', read: read.size, unknown: evidence.unknown, chains: evidence.chains,
      identities: evidence.identities.map(({ id, active, candidates, chains, heads, start }) => ({ id, active, candidates, chains, heads, start })) }));
    let identities = state.identities || [];
    if (state.active && identities.length && !(await openIssue('queue-stalled'))) identities = await withRepairs(identities);
    return apply('queue-stalled', state.active, { ...state, identities, identityCount: identities.length, runUrl: safeGithubUrl(newest.html_url) });
  }
  if (mode === 'main-red') {
    const list = await gh(`/repos/${repo}/actions/workflows/${env.CI_WORKFLOW || 'ci.yml'}/runs?branch=main&event=push&status=completed&per_page=1`);
    const run = list?.workflow_runs?.[0];
    if (!run) return console.log('main-red: no finished CI run on main yet');
    return apply('main-red', mainState(run.conclusion), { sha: run.head_sha, runUrl: run.html_url }, runSource(run.id, run.run_attempt));
  }
  if (mode === 'review-blocked') {
    return apply('review-blocked', reviewState(env.OUTCOME), { outcome: env.OUTCOME, pr: env.PR, runUrl: env.RUN_URL }, runSource(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT));
  }
  if (mode === 'queue') {
    const thresholds = {
      queued: Number(env.QUEUE_ALERT_QUEUED) || QUEUE_DEFAULTS.queued,
      oldestMinutes: Number(env.QUEUE_ALERT_OLDEST_MIN) || QUEUE_DEFAULTS.oldestMinutes,
    };
    // #6463: runs created before QUEUE_ALERT_IGNORE_BEFORE are left out. An invalid date fails the job loudly and
    // ignores nothing; unset reads only what today's alert read.
    let cutoff = null;
    try { cutoff = parseQueueCutoff(env.QUEUE_ALERT_IGNORE_BEFORE); } catch {
      console.error('::error::QUEUE_ALERT_IGNORE_BEFORE is not an ISO date; no queued run is ignored');
      process.exitCode = 1;
    }
    // The API lists newest first. Without a cutoff, the oldest run is the last page's last run. With one, every page
    // up to the API's 10-page window is read, so each run left out was seen to predate the cutoff.
    const first = await gh(`/repos/${repo}/actions/runs?status=queued&per_page=100`);
    if (!Number.isSafeInteger(first?.total_count) || first.total_count < 0 || !Array.isArray(first.workflow_runs)) throw new Error('queue_evidence_unreadable');
    const total = first.total_count;
    const lastPage = Math.min(10, Math.ceil(total / 100));
    const pages = [first];
    for (let n = 2; n <= lastPage; n++) {
      if (!cutoff && n < lastPage) continue;
      const page = await gh(`/repos/${repo}/actions/runs?status=queued&per_page=100&page=${n}`);
      if (!Array.isArray(page?.workflow_runs)) throw new Error('queue_evidence_unreadable');
      pages[n - 1] = page;
    }
    const last = pages[lastPage - 1]?.workflow_runs || [];
    const read = queueAfterCutoff({ total, runs: cutoff ? pages.flatMap(p => p.workflow_runs) : last.slice(-1), cutoff });
    if (read.queued && !Number.isFinite(Date.parse(read.oldestCreatedAt || ''))) throw new Error('queue_age_unreadable');
    const open = await openIssue('queue');
    if (open && cutoff) {
      const body = withQueueCutoffLine(open.body, read);
      if (body !== open.body) await gh(`/repos/${repo}/issues/${open.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    }
    const q = queueState({ queued: read.queued, oldestCreatedAt: read.oldestCreatedAt, thresholds, issueOpen: Boolean(open) });
    return apply('queue', q.active, { ...q, ignored: read.ignored, cutoff: read.cutoff });
  }
  if (mode === 'future-clock') {
    const { failures, startedAt, ...evidence } = await futureClockReport({ env, api: gh });
    console.log(JSON.stringify({ kind: 'future-clock', ...evidence }));
    const active = evidence.active;
    if (!evidence.complete) process.exitCode = 1;
    // D7124: the names go to this job's log and step summary only; the issue and Slack get the break date (D5663).
    const broke = breakDate(startedAt, 7);
    const runUrl = safeGithubUrl(env.RUN_URL);
    for (const line of futureClockLogLines({ failures, broke })) console.log(line);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, futureClockSummary({ failures, failed: evidence.failed, broke, runUrl, complete: evidence.complete }));
    const open = active === true ? await openIssue('future-clock') : null;
    if (open) {
      const body = withFutureClockRunLine(open.body, { runUrl, broke });
      if (body !== open.body) await gh(`/repos/${repo}/issues/${open.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    }
    return apply('future-clock', active, { days: 7, failedCount: evidence.failed, runUrl: env.RUN_URL, breakDate: broke }, runSource(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT));
  }
  throw new Error(`unknown mode "${mode}": main-red, review-blocked, queue, queue-stalled, queue-deadline, future-clock, file-backup or scan`);
}

main().catch(() => {
  // This trusted monitoring job fails visibly; it cannot change the watched CI/review result.
  console.error('::error::github-alerts observation or persistence unavailable; no recovery inferred');
  process.exitCode = 1;
});
