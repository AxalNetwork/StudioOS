#!/usr/bin/env node
/**
 * GitHub health alerts to a Slack channel: the effects half (GitHub REST and
 * the Slack incoming webhook). The rules are `lib/githubAlerts.mjs`.
 *
 *   node scripts/github-alerts.mjs main-red        (reads the latest finished CI run on a push to main)
 *   node scripts/github-alerts.mjs review-blocked  OUTCOME, PR, RUN_URL
 *   node scripts/github-alerts.mjs queue           QUEUE_ALERT_QUEUED, QUEUE_ALERT_OLDEST_MIN (optional)
 *   node scripts/github-alerts.mjs future-clock    FUTURE_CLOCK_DAYS, FUTURE_CLOCK_DIR (attempt-bound artifacts), RUN_URL
 *
 * Always: GITHUB_TOKEN (issues: write for the three alert kinds; actions: read
 * for `main-red` and `queue`), GITHUB_REPOSITORY, and SLACK_GITHUB_WEBHOOK_URL. Without the
 * webhook, the issue is still opened or closed and the job warns; the trusted reporter fails visibly on unreadable evidence without changing the watched result.
 */
import { QUEUE_DEFAULTS, mainState, queueStallState, queueState, reviewState } from './lib/githubAlerts.mjs';
import { safeGithubUrl } from './lib/ciClassify.mjs';
import { createHealthMonitor } from './health-alert-episodes.mjs';
import { webhookDelivery } from './health-alert-transport.mjs';
import { futureClockReport } from './future-clock-report.mjs';

const env = process.env;
const api = env.GITHUB_API_URL || 'https://api.github.com';
const repo = env.GITHUB_REPOSITORY;

async function gh(path, init = {}) {
  const res = await fetch(`${api}${path}`, {
    ...init,
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
const runSource = (runId, attempt = 1) => {
  const value = Number(runId) * 1000 + Number(attempt);
  if (!Number.isSafeInteger(value) || Number(attempt) < 1 || Number(attempt) > 999) throw new Error('source_identity_invalid');
  return value;
};

async function main() {
  const mode = process.argv[2];
  if (!env.GITHUB_TOKEN) throw new Error('github_token_missing');
  monitor = createHealthMonitor({ api: gh, repo, deliver: webhookDelivery({ url: env.SLACK_GITHUB_WEBHOOK_URL }), log: value => console.log(JSON.stringify(value)) });
  if (mode === 'queue-stalled') {
    const list = await gh(`/repos/${repo}/actions/workflows/${env.CI_WORKFLOW || 'ci.yml'}/runs?event=merge_group&status=completed&per_page=30`);
    const runs = (list.workflow_runs || []).filter(run => run.head_branch?.startsWith('gh-readonly-queue/main/')).slice(0, 2);
    if (!runs[0]) return;
    const withJobs = await Promise.all(runs.map(async run => ({
      ...run,
      jobs: run.conclusion === 'failure' && Number.isSafeInteger(run.id)
        ? (await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`)).jobs
        : [],
    })));
    const state = queueStallState(withJobs);
    return apply('queue-stalled', state.active, { ...state, runUrl: safeGithubUrl(runs[0].html_url) });
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
    // Oldest first: the API lists newest first, so read the last page's last run.
    const first = await gh(`/repos/${repo}/actions/runs?status=queued&per_page=100`);
    const total = Number(first?.total_count) || 0;
    let oldest = null;
    if (total) {
      const lastPage = Math.min(10, Math.ceil(total / 100));
      const page = lastPage === 1 ? first : await gh(`/repos/${repo}/actions/runs?status=queued&per_page=100&page=${lastPage}`);
      const runs = page?.workflow_runs || [];
      oldest = runs.length ? runs[runs.length - 1].created_at : null;
    }
    const q = queueState({ queued: total, oldestCreatedAt: oldest, thresholds, issueOpen: Boolean(await openIssue('queue')) });
    return apply('queue', q.active, q);
  }
  if (mode === 'future-clock') {
    const evidence = await futureClockReport({ env, api: gh });
    console.log(JSON.stringify({ kind: 'future-clock', ...evidence }));
    const active = evidence.active;
    if (!evidence.complete) process.exitCode = 1;
    return apply('future-clock', active, { days: 7, failedCount: evidence.failed, runUrl: env.RUN_URL }, runSource(env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT));
  }
  throw new Error(`unknown mode "${mode}": main-red, review-blocked, queue, queue-stalled or future-clock`);
}

main().catch(() => {
  // This trusted monitoring job fails visibly; it cannot change the watched CI/review result.
  console.error('::error::github-alerts observation or persistence unavailable; no recovery inferred');
  process.exitCode = 1;
});
