#!/usr/bin/env node
/**
 * D7125-p2 (#7125): the stall check's watchdog, the effects half of `lib/queueStallChecker.mjs`.
 *
 *   CHECK_OUTCOME=<steps.check.outcome> STATE_FILE=<path> node scripts/queue-stall-checker.mjs
 *
 * Runs as a later step of the `queue-stalled` job with `if: always()`. Reads the count of consecutive failed
 * checks from STATE_FILE (restored from the Actions cache), adds this run's outcome, writes it back, and opens
 * `[alert] merge queue stall check failing` at the second failure in a row or closes it at the next success.
 * Slack (SLACK_GITHUB_WEBHOOK_URL) hears the open and the close, best effort.
 *
 * It imports only `node:` modules and its pure half: a crash in the check's import graph cannot reach it.
 * GITHUB_TOKEN needs `issues: write`. A failed GitHub read or write fails this step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CHECKER_ALERT_TITLE, checkerIssueBody, checkerSlackText, checkerTransition, readCheckerState } from './lib/queueStallChecker.mjs';

const env = process.env;
const api = env.GITHUB_API_URL || 'https://api.github.com';
const repo = env.GITHUB_REPOSITORY;

async function gh(path, init = {}) {
  const res = await fetch(`${api}/repos/${repo}${path}`, {
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

/** The open checker alert, or null. Every page is read: an unreadable listing fails, never "not open". */
async function openAlert() {
  for (let page = 1; page <= 20; page++) {
    const rows = await gh(`/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw new Error('issue_listing_unreadable');
    const found = rows.find(row => !row.pull_request && row.title === CHECKER_ALERT_TITLE);
    if (found) return found;
    if (rows.length < 100) return null;
  }
  throw new Error('issue_listing_cap_reached');
}

async function slack(text) {
  if (!env.SLACK_GITHUB_WEBHOOK_URL) return console.log('::warning::SLACK_GITHUB_WEBHOOK_URL is not set; the issue changed without a Slack post');
  try {
    const res = await fetch(env.SLACK_GITHUB_WEBHOOK_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) console.log(`::warning::Slack answered ${res.status}; the issue is the record`);
  } catch (error) {
    console.log(`::warning::Slack unreachable (${error.message}); the issue is the record`);
  }
}

async function main() {
  if (!env.GITHUB_TOKEN || !repo) throw new Error('github_token_or_repository_missing');
  if (!env.STATE_FILE) throw new Error('state_file_missing');
  let saved = '';
  try { saved = readFileSync(env.STATE_FILE, 'utf8'); } catch { /* no count yet */ }
  const runUrl = /^\d+$/.test(env.GITHUB_RUN_ID || '') ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const observed = { outcome: env.CHECK_OUTCOME, runUrl, at: new Date().toISOString() }; // `at`: when a run of failures began, written on the alert
  const prev = readCheckerState(saved);
  // The count is saved before any GitHub call, so an unreadable issue listing never loses this observation.
  writeFileSync(env.STATE_FILE, JSON.stringify(checkerTransition(prev, observed).state));
  const issue = await openAlert();
  const { state, action } = checkerTransition(prev, { ...observed, issueOpen: Boolean(issue) });
  console.log(JSON.stringify({ kind: 'queue-stall-checker', outcome: env.CHECK_OUTCOME, failures: state.failures, action, issue: issue?.number ?? null }));
  if (action === 'open') {
    const created = await gh('/issues', { method: 'POST', body: JSON.stringify({ title: CHECKER_ALERT_TITLE, body: checkerIssueBody(state) }) });
    await slack(checkerSlackText('open', { issueUrl: created?.html_url, runUrl, failures: state.failures }));
  }
  if (action === 'close') {
    await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `The stall check passed${runUrl ? ` in ${runUrl}` : ''}. Closing.` }) });
    await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    await slack(checkerSlackText('close', { issueUrl: issue.html_url, runUrl }));
  }
}

main().catch(error => {
  console.log(`::error::queue-stall-checker: ${error.message}`);
  process.exitCode = 1;
});
