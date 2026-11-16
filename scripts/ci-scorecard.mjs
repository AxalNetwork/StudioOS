#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET, QUEUE_WORKFLOWS, candidateRows, greenAt, mergeCommit, queueDeadline, queueEntries, jobSample, readyAt, report, unionRuns } from './lib/ciScorecard.mjs';
import { REQUIRED } from './lib/requiredChecks.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const tracker = 5600;
const marker = '<!-- studioos-ci-scorecard-5603 -->';
// D5973 part 2: one request plan for the candidate rows (D5973) and the queue listing (D6678).
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

async function collectJobs(runs, queueRuns) {
  const candidates = jobSample({ runs, queueRuns });
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
  let skipped = 0;
  for (const number of candidates) {
    if (requests >= BUDGET.timelinesUntil || !Number.isSafeInteger(number)) break;
    const { rows: events, complete } = await pages(`issues/${number}/timeline`, BUDGET.timelinePages);
    if (!complete) { skipped++; continue; }
    const row = merged.find(p => p.number === number);
    const at = row?.merged_at || events.findLast(e => e.event === 'merged')?.created_at;
    const mergedAt = Date.parse(at) >= start && Date.parse(at) <= now ? at : null;
    const allEntries = queueEntries(events);
    const pr = { number, mergeCommit: mergeCommit(events), mergedAt, allEntries,
      entries: allEntries.filter(e => Date.parse(e.start) <= now && (!e.end || Date.parse(e.end) >= start)),
      readyAt: mergedAt ? readyAt(events, { createdAt: row?.created_at, mergedAt }) : null, greenAt: null };
    // One read per merged PR: the pull_request runs on its merged head, for the time it went green.
    const sha = row?.head?.sha;
    if (mergedAt && /^[0-9a-f]{40}$/.test(sha || '')) {
      try { pr.greenAt = greenAt((await get(`actions/runs?head_sha=${sha}&event=pull_request&per_page=100`)).workflow_runs, sha); }
      catch { console.log('::notice::One head-SHA run listing could not be read.'); }
    }
    prs.push(pr);
  }
  return { prs, read: prs.length, skipped, candidates: candidates.length };
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
  const CI = '.github/workflows/ci.yml';
  // D6678: merge-queue CI on its own listing; the all-workflow one above stops at 1000 runs, a few hours of a busy day.
  const queue = await pages(`actions/workflows/ci.yml/runs?event=merge_group&created=${created}`, BUDGET.queuePages, value => value.workflow_runs);
  // D5973 part 2: the other queue workflows too, so a candidate's required checks are listed all day, not only in the capped span.
  const others = [];
  for (const path of QUEUE_WORKFLOWS.filter(p => p !== CI)) {
    const file = path.split('/').pop();
    others.push({ file, ...await pages(`actions/workflows/${file}/runs?event=merge_group&created=${created}`, BUDGET.queuePages, value => value.workflow_runs) });
  }
  // One object per run id, so jobs sampled through one listing show in every listing that holds the run.
  const byId = new Map(runs.map(r => [r.id, r]));
  const shared = rows => rows.map(r => byId.get(r.id) || r);
  const queueRuns = shared(queue.rows);
  const queueAll = unionRuns(queueRuns, ...others.map(o => shared(o.rows)),
    runs.filter(r => r.event === 'merge_group' && QUEUE_WORKFLOWS.includes(r.path)));
  let deadline = null;
  try {
    deadline = queueDeadline(await get('rules/branches/main'));
  } catch {
    console.log('::notice::Main branch rules could not be read; no deadline expiry can be confirmed from run data.');
  }
  await collectJobs(runs, queueAll);
  const { prs, read, skipped, candidates } = await collectPrs([...runs, ...queueAll], start, now);
  const rows = candidateRows({ runs: unionRuns(runs, queueAll), prs, deadline });
  // D5973: the per-candidate rows, uploaded by the workflow as an artifact.
  const out = process.env.CI_SCORECARD_ROWS || join(process.env.RUNNER_TEMP || '.', 'ci-scorecard-candidates.json');
  writeFileSync(out, `${JSON.stringify({ window: { start: new Date(start).toISOString(), end: new Date(now).toISOString() },
    deadlineMinutes: deadline, requiredChecks: Object.keys(REQUIRED), rows }, null, 2)}\n`);
  const notes = [complete ? '' : 'Run listing reached the page limit.',
    ...others.filter(o => !o.complete).map(o => `The merge_group listing of ${o.file} reached the page limit; its earliest candidates read as missing evidence.`),
    read + skipped < candidates ? `PR timelines stopped at the request budget: ${read} of ${candidates} read.` : '',
    skipped ? `${skipped} PR timelines over ${BUDGET.timelinePages * 100} events were skipped.` : ''].filter(Boolean);
  const markdown = report({ runs, queueRuns, prs, start, now, requests, queueListingComplete: queue.complete, rows, deadline })
    + (notes.length ? `\n\n${notes.join('\n')}` : '');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(markdown);
  await publishComment(markdown);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
