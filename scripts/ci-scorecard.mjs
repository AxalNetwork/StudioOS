#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { report } from './lib/ciScorecard.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const tracker = 5600;
const marker = '<!-- studioos-ci-scorecard-5603 -->';
const cap = 150;
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

function queueEntries(events) {
  const entries = [];
  let current = null;
  for (const event of [...events].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (event.event === 'added_to_merge_queue' && !current) {
      current = { start: event.created_at, end: null };
      entries.push(current);
    } else if (['removed_from_merge_queue', 'merged', 'closed'].includes(event.event) && current) {
      current.end = event.created_at;
      current = null;
    }
  }
  return entries;
}

function evenlySpaced(rows, size) {
  if (rows.length <= size) return rows;
  return Array.from({ length: size }, (_, i) => rows[Math.round(i * (rows.length - 1) / (size - 1))]);
}

async function collectJobs(runs) {
  const candidates = ['merge_group', 'pull_request', 'push', 'other'].flatMap(event => {
    const group = runs.filter(r => event === 'other'
      ? !['pull_request', 'push'].includes(r.event) && !(r.event === 'merge_group' && r.path === '.github/workflows/ci.yml')
      : r.event === event && (event !== 'merge_group' || r.path === '.github/workflows/ci.yml'));
    return evenlySpaced(group, event === 'merge_group' ? 74 : 12);
  });
  for (const run of candidates) {
    if (requests >= 105 || !Number.isSafeInteger(run.id)) break;
    try {
      const jobs = await get(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if (jobs.total_count > jobs.jobs.length) continue;
      run.jobs = jobs.jobs;
      if (Number.isSafeInteger(run.run_attempt) && run.run_attempt > 1 && requests < 105) {
        const earlier = await get(`actions/runs/${run.id}/attempts/${run.run_attempt - 1}/jobs?per_page=100`);
        if (earlier.total_count <= earlier.jobs.length) runs.push({ ...run, jobs: earlier.jobs, laterJobs: run.jobs, priorAttempt: true });
      }
    } catch {
      console.log('::notice::One workflow job sample could not be read.');
    }
  }
}

async function collectPrs(runs, start, now) {
  const { rows } = await pages('pulls?state=all&sort=updated&direction=desc', 2);
  const fromRuns = runs.map(r => Number(/^gh-readonly-queue\/main\/pr-(\d+)(?:-|$)/.exec(r.head_branch || '')?.[1])).filter(Number.isSafeInteger);
  const merged = rows.filter(p => Date.parse(p.merged_at) >= start && Date.parse(p.merged_at) <= now);
  const candidates = [...new Set([...merged.map(p => p.number), ...fromRuns])];
  const prs = [];
  for (const number of candidates) {
    if (requests >= 135 || !Number.isSafeInteger(number)) break;
    const { rows: events, complete } = await pages(`issues/${number}/timeline`, 1);
    if (!complete) continue;
    const mergedAt = merged.find(p => p.number === number)?.merged_at
      || events.findLast(e => e.event === 'merged')?.created_at;
    prs.push({ number, mergedAt: Date.parse(mergedAt) >= start && Date.parse(mergedAt) <= now ? mergedAt : null,
      entries: queueEntries(events).filter(e => Date.parse(e.start) <= now && (!e.end || Date.parse(e.end) >= start)) });
  }
  return prs;
}

/** The sole write path. GitHub Actions owns one comment marked with this identifier. */
async function publishComment(markdown) {
  const { rows, complete } = await pages(`issues/${tracker}/comments`, 10);
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
  const { rows: runs, complete } = await pages(`actions/runs?created=${created}`, 10, value => value.workflow_runs);
  await collectJobs(runs);
  const prs = await collectPrs(runs, start, now);
  const markdown = report({ runs, prs, start, now, requests }) + (complete ? '' : '\n\nRun listing reached the page limit.');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(markdown);
  await publishComment(markdown);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
