#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET, QUEUE_WORKFLOWS, candidateRows, mergeCommit, queueDeadline, queueEntries, report } from './lib/ciScorecard.mjs';
import { REQUIRED } from './lib/requiredChecks.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const tracker = 5600;
const marker = '<!-- studioos-ci-scorecard-5603 -->';
const { cap } = BUDGET;
let requests = 0;

async function request(path, init = {}) {
  if (++requests > cap) throw new Error('Scorecard request cap reached');
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

const get = path => request(path);
const pageSize = 100;

async function pages(path, limit, list = value => value) {
  const rows = [];
  for (let page = 1; page <= limit; page++) {
    const items = list(await get(`${path}${path.includes('?') ? '&' : '?'}per_page=${pageSize}&page=${page}`));
    if (!Array.isArray(items)) throw new Error('GitHub returned an unexpected list response');
    rows.push(...items);
    if (items.length < pageSize) return { rows, complete: true };
  }
  return { rows, complete: false };
}

function evenlySpaced(rows, size) {
  if (rows.length <= size) return rows;
  return Array.from({ length: size }, (_, i) => rows[Math.round(i * (rows.length - 1) / (size - 1))]);
}

async function collectJobs(runs) {
  // D5973: merge-group candidates first, every queue workflow of each sampled
  // head SHA together, so a candidate's required checks are sampled whole.
  const queue = r => r.event === 'merge_group' && QUEUE_WORKFLOWS.includes(r.path);
  const shas = new Set(evenlySpaced([...new Set(runs.filter(queue).map(r => r.head_sha))], 32));
  const candidates = [
    ...runs.filter(r => queue(r) && shas.has(r.head_sha)).sort((a, b) => String(a.head_sha).localeCompare(String(b.head_sha))),
    ...['pull_request', 'push', 'other'].flatMap(event => evenlySpaced(runs.filter(r => event === 'other'
      ? !['pull_request', 'push'].includes(r.event) && !queue(r) : r.event === event), 12)),
  ];
  for (const run of candidates) {
    if (requests >= BUDGET.jobsUntil || !Number.isSafeInteger(run.id)) break;
    try {
      const jobs = await get(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if (jobs.total_count > jobs.jobs.length) continue;
      run.jobs = jobs.jobs;
      if (Number.isSafeInteger(run.run_attempt) && run.run_attempt > 1 && requests < BUDGET.jobsUntil) {
        const earlier = await get(`actions/runs/${run.id}/attempts/${run.run_attempt - 1}/jobs?per_page=100`);
        if (earlier.total_count <= earlier.jobs.length) runs.push({ ...run, jobs: earlier.jobs, laterJobs: run.jobs, priorAttempt: true });
      }
    } catch {
      console.log('::notice::One workflow job sample could not be read.');
    }
  }
}

async function collectPrs(runs, start, now) {
  const { rows } = await pages('pulls?state=all&sort=updated&direction=desc', BUDGET.prPages);
  const fromRuns = runs.map(r => Number(/^gh-readonly-queue\/main\/pr-(\d+)(?:-|$)/.exec(r.head_branch || '')?.[1])).filter(Number.isSafeInteger);
  const merged = rows.filter(p => Date.parse(p.merged_at) >= start && Date.parse(p.merged_at) <= now);
  const candidates = [...new Set([...merged.map(p => p.number), ...fromRuns])];
  const prs = [];
  for (const number of candidates) {
    if (requests >= BUDGET.timelinesUntil || !Number.isSafeInteger(number)) break;
    const { rows: events, complete } = await pages(`issues/${number}/timeline`, 1);
    if (!complete) continue;
    const mergedAt = merged.find(p => p.number === number)?.merged_at
      || events.findLast(e => e.event === 'merged')?.created_at;
    prs.push({ number, mergeCommit: mergeCommit(events), mergedAt: Date.parse(mergedAt) >= start && Date.parse(mergedAt) <= now ? mergedAt : null,
      entries: queueEntries(events).filter(e => Date.parse(e.start) <= now && (!e.end || Date.parse(e.end) >= start)) });
  }
  return prs;
}

/** The sole write path. GitHub Actions owns one comment marked with this identifier. */
async function publishComment(markdown) {
  const { rows, complete } = await pages(`issues/${tracker}/comments`, BUDGET.commentPages);
  const existing = rows.find(c => c.user?.login === 'github-actions[bot]' && c.body?.startsWith(marker));
  if (!existing && !complete) throw new Error('Tracker comment history incomplete; skipping creation');
  const body = JSON.stringify({ body: `${marker}\n${markdown}` });
  if (Number.isSafeInteger(existing?.id)) {
    return request(`issues/comments/${existing.id}`, { method: 'PATCH', body });
  }
  return request(`issues/${tracker}/comments`, { method: 'POST', body });
}

async function main() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !token) throw new Error('GitHub repository and token are required');
  const now = Date.now();
  const start = now - 86_400_000;
  const created = encodeURIComponent(`${new Date(start).toISOString()}..${new Date(now).toISOString()}`);
  const { rows: runs, complete } = await pages(`actions/runs?created=${created}`, BUDGET.runPages, value => value.workflow_runs);
  let deadline = null;
  try {
    deadline = queueDeadline(await get('rules/branches/main'));
  } catch {
    console.log('::notice::Main branch rules could not be read; no deadline expiry can be confirmed from run data.');
  }
  await collectJobs(runs);
  const prs = await collectPrs(runs, start, now);
  const rows = candidateRows({ runs, prs, deadline });
  // D5973: the per-candidate rows, uploaded by the workflow as an artifact.
  const out = process.env.CI_SCORECARD_ROWS || join(process.env.RUNNER_TEMP || '.', 'ci-scorecard-candidates.json');
  writeFileSync(out, `${JSON.stringify({ window: { start: new Date(start).toISOString(), end: new Date(now).toISOString() },
    deadlineMinutes: deadline, requiredChecks: Object.keys(REQUIRED), rows }, null, 2)}\n`);
  const markdown = report({ runs, prs, start, now, requests, rows, deadline }) + (complete ? '' : '\n\nRun listing reached the page limit.');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(markdown);
  await publishComment(markdown);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
