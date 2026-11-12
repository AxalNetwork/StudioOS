#!/usr/bin/env node
/**
 * GitHub health alerts to a Slack channel: the effects half (GitHub REST and
 * the Slack incoming webhook). The rules are `lib/githubAlerts.mjs`.
 *
 *   node scripts/github-alerts.mjs main-red        (reads the latest finished CI run on a push to main)
 *   node scripts/github-alerts.mjs review-blocked  OUTCOME, PR, RUN_URL
 *   node scripts/github-alerts.mjs queue           QUEUE_ALERT_QUEUED, QUEUE_ALERT_OLDEST_MIN (optional)
 *   node scripts/github-alerts.mjs future-clock    FUTURE_CLOCK_DAYS, FUTURE_CLOCK_LOG (a TAP file), RUN_URL
 *
 * Always: GITHUB_TOKEN (issues: write for the three alert kinds; actions: read
 * for `main-red` and `queue`), GITHUB_REPOSITORY, and SLACK_GITHUB_WEBHOOK_URL. Without the
 * webhook, the issue is still opened or closed and the job warns; an alerting
 * job never fails the thing it watches.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  ALERT_KINDS, QUEUE_DEFAULTS, failingTests, mainState, message, queueStallState, queueState, reviewState, transition,
} from './lib/githubAlerts.mjs';
import { safeGithubUrl } from './lib/ciClassify.mjs';

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
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path.split('?')[0]}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function slack(text) {
  if (!text) return;
  if (!env.SLACK_GITHUB_WEBHOOK_URL) {
    console.log(`::warning::SLACK_GITHUB_WEBHOOK_URL is not set; not posted: ${text.split('\n')[0]}`);
    return;
  }
  const res = await fetch(env.SLACK_GITHUB_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok) console.log(`::warning::Slack answered HTTP ${res.status}; the alert was not posted.`);
  else console.log(`Posted to Slack: ${text.split('\n')[0]}`);
}

/** The open alert issue for a kind, by its exact title, or null. */
async function openIssue(kind) {
  const title = ALERT_KINDS[kind].title;
  const list = await gh(`/repos/${repo}/issues?state=open&per_page=100&sort=created&direction=desc`);
  return (list || []).find((i) => !i.pull_request && i.title === title) || null;
}

async function apply(kind, active, facts) {
  const issue = await openIssue(kind);
  const action = transition(active, Boolean(issue));
  console.log(`${kind}: active=${active} issue=${issue ? `#${issue.number}` : 'none'} -> ${action}`);
  if (action === 'open') {
    const body = `${message(kind, 'open', facts)}\n\nOpened by \`.github/workflows/github-alerts.yml\` (scripts/github-alerts.mjs). It closes itself when the condition clears.`;
    const created = await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: ALERT_KINDS[kind].title, body }) });
    await slack(message(kind, 'open', { ...facts, issueUrl: created.html_url }));
  } else if (action === 'close') {
    await gh(`/repos/${repo}/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Recovered${facts.runUrl ? `: ${facts.runUrl}` : ''}. Closing.` }) });
    await gh(`/repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    await slack(message(kind, 'close', { ...facts, issueUrl: issue.html_url }));
  }
}

async function main() {
  const mode = process.argv[2];
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
    return apply('main-red', mainState(run.conclusion), { sha: run.head_sha, title: run.display_title, runUrl: run.html_url });
  }
  if (mode === 'review-blocked') {
    return apply('review-blocked', reviewState(env.OUTCOME), { outcome: env.OUTCOME, pr: env.PR, runUrl: env.RUN_URL });
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
    const file = env.FUTURE_CLOCK_LOG;
    const tap = file && existsSync(file) ? readFileSync(file, 'utf8') : '';
    const failures = failingTests(tap);
    console.log(`future-clock: ${failures.names.length + failures.more} failing test(s)`);
    // D5398: one issue, opened on the first failing night and closed on the first clean one. No log at all says
    // nothing (unknown), never "recovered".
    const active = tap.trim() ? failures.names.length + failures.more > 0 : null;
    return apply('future-clock', active, { days: Number(env.FUTURE_CLOCK_DAYS) || 0, failures, runUrl: env.RUN_URL });
  }
  throw new Error(`unknown mode "${mode}": main-red, review-blocked, queue, queue-stalled or future-clock`);
}

main().catch((e) => {
  // Never fail the run being watched over an alert: say so and exit 0.
  console.log(`::warning::github-alerts: ${e.message}`);
});
