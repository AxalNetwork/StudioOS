#!/usr/bin/env node
// #6462: read-only report of effective Actions concurrency. Rebuilds jobs
// executing per minute over a window (default 24 h) from every run's job
// timestamps: the effective ceiling (the level executing sat at while jobs
// queued), peak, the highest level held for 10 minutes, share of time at the
// ceiling, queued jobs per minute, slot-minutes per workflow and per event
// (draft vs ready PRs from each PR's timeline), whether phantom queued runs
// ever held a slot, and which plan cap (20, 40, 60, 500) the ceiling matches.
// #6676: also a merge-candidate table (`merge_group` runs of `ci.yml`: minutes
// from run creation to the first job with a runner and to the first `landing
// gate` result, p50/p90 by UTC hour). GET requests only, capped (`--cap`,
// `--reserve`); prints how much of the window it covered. `--save`/`--load`
// re-render without the API. Logic in `lib/actionsConcurrency.mjs`.
//
// #6462: read-only Actions concurrency report — rebuilds jobs executing per minute over a window from job timestamps. GET requests only.
import { readFileSync, writeFileSync } from 'node:fs';
import { analyse, phantomVerdict, report } from './lib/actionsConcurrency.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
if (args.includes('--help')) {
  console.log('node scripts/actions-concurrency.mjs [--repo owner/name] [--hours 24] [--end ISO] [--lead 60] [--cap 3500] [--reserve 1000] [--parallel 8] [--phantom-hours 24] [--no-prs] [--out FILE] [--json FILE] [--save FILE | --load FILE]');
  process.exit(0);
}
const repo = option('repo', process.env.GITHUB_REPOSITORY || 'AxalNetwork/StudioOS');
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const hours = Number(option('hours', 24));
const leadMinutes = Number(option('lead', 60));
const reserve = Number(option('reserve', 1000));
const phantomHours = Number(option('phantom-hours', 24));
const parallel = Number(option('parallel', 8));
let cap = Number(option('cap', 3500));
const pageSize = 100;
const pages = { runs: 0, jobs: 0, prs: 0, phantom: 0 };
let requests = 0;

class CapReached extends Error {}

async function get(path, kind) {
  if (requests >= cap) throw new CapReached('request cap reached');
  requests++;
  if (kind) pages[kind]++;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`https://api.github.com/${path}`, {
        method: 'GET',
        signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      });
      if (response.status >= 500 && attempt < 4) continue;
      if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for ${path.split('?')[0]}`);
      return response.json();
    } catch (error) {
      if (attempt >= 4 || error instanceof CapReached || /HTTP 4\d\d/.test(error.message)) throw error;
    }
  }
}

/** Run up to `parallel` tasks at once; stops handing out work once the cap is hit. */
async function pool(items, task) {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      try { await task(item); } catch (error) { if (error instanceof CapReached) stopped = true; else throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  return !stopped;
}

/** List runs created in [a, b). The list API stops at 1000 results, so a slice that holds more is split in half. */
async function listRuns(a, b, out) {
  const created = encodeURIComponent(`${new Date(a).toISOString()}..${new Date(b - 1000).toISOString()}`);
  const first = await get(`repos/${repo}/actions/runs?created=${created}&per_page=${pageSize}&page=1`, 'runs');
  if (first.total_count > 1000 && b - a > 120_000) {
    const mid = a + Math.floor((b - a) / 2 / 1000) * 1000;
    await listRuns(a, mid, out);
    await listRuns(mid, b, out);
    return;
  }
  out.push(...first.workflow_runs);
  for (let page = 2; (page - 1) * pageSize < first.total_count; page++) {
    const rows = (await get(`repos/${repo}/actions/runs?created=${created}&per_page=${pageSize}&page=${page}`, 'runs')).workflow_runs;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
}

/** Page a filtered run list by its total_count; new runs shift pages, so rows are de-duplicated by id. */
async function listByStatus(query, out) {
  const seen = new Set(out.map(r => r.id));
  for (let page = 1; page <= 20; page++) {
    const body = await get(`repos/${repo}/actions/runs?${query}&per_page=${pageSize}&page=${page}`, 'runs');
    for (const r of body.workflow_runs) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    if (body.workflow_runs.length < pageSize || page * pageSize >= body.total_count) return;
  }
}

/** Every attempt's jobs (`filter=all`): earlier attempts used slots too. */
async function readJobs(run, kind) {
  const jobs = [];
  for (let page = 1; page <= 10; page++) {
    const body = await get(`repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=${pageSize}&page=${page}`, kind);
    jobs.push(...body.jobs);
    if (body.jobs.length < pageSize || jobs.length >= body.total_count) break;
  }
  run.jobs = jobs;
}

/** PR draft state at run time: the PR's current flag plus its timeline's ready/draft flips. */
async function readPrs(runs) {
  const prs = new Map();
  const numbers = new Set();
  const heads = new Set();
  for (const run of runs) if (run.event === 'pull_request') {
    const n = run.pull_requests?.[0]?.number;
    if (Number.isSafeInteger(n)) numbers.add(n); else if (run.head_branch) heads.add(run.head_branch);
  }
  if (heads.size) {
    for (let page = 1; page <= 5; page++) {
      const rows = await get(`repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`, 'prs');
      for (const pr of rows) if (heads.has(pr.head?.ref) && !prs.has(`head:${pr.head.ref}`)) { prs.set(`head:${pr.head.ref}`, pr.number); numbers.add(pr.number); }
      if (rows.length < pageSize) break;
    }
  }
  await pool([...numbers], async number => {
    const pr = await get(`repos/${repo}/pulls/${number}`, 'prs');
    const events = [];
    for (let page = 1; page <= 5; page++) {
      const rows = await get(`repos/${repo}/issues/${number}/timeline?per_page=${pageSize}&page=${page}`, 'prs');
      events.push(...rows.filter(e => e.event === 'ready_for_review' || e.event === 'convert_to_draft'));
      if (rows.length < pageSize) { prs.set(number, { draft: pr.draft, events }); return; }
    }
  });
  return prs;
}

/** Only the fields the analysis reads, so `--save` files stay small and hold no log or user data. */
const trimRun = r => ({ id: r.id, name: r.name, path: r.path, event: r.event, status: r.status, conclusion: r.conclusion,
  created_at: r.created_at, head_branch: r.head_branch, pull_requests: (r.pull_requests || []).map(p => ({ number: p.number })),
  ...(Array.isArray(r.jobs) ? { jobs: r.jobs.map(j => ({ name: j.name, status: j.status, conclusion: j.conclusion, created_at: j.created_at,
    started_at: j.started_at, completed_at: j.completed_at, runner_id: j.runner_id, runner_name: j.runner_name, labels: j.labels })) } : {}) });

async function collect() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw new Error('a repository and GH_TOKEN/GITHUB_TOKEN are required');
  if (!(hours > 0) || !(leadMinutes >= 0) || !(cap > 0)) throw new Error('--hours, --lead and --cap must be positive');
  const limit = (await get('rate_limit')).resources.core;
  cap = Math.min(cap, limit.remaining - reserve);
  if (cap < 50) throw new Error(`only ${limit.remaining} core requests remain; keeping ${reserve} in reserve leaves too few`);
  const now = Date.now();
  const end = Math.min(option('end') ? Date.parse(option('end')) : now, now);
  const start = end - hours * 3_600_000;
  const listedFrom = start - leadMinutes * 60_000;

  const listed = [];
  for (let b = end; b > listedFrom; b -= 3_600_000) await listRuns(Math.max(listedFrom, b - 3_600_000), b, listed);
  const byId = new Map(listed.map(r => [r.id, r]));
  // Long-running runs created before the lead-in still hold slots inside the window.
  const live = [];
  await listByStatus('status=in_progress', live);
  for (const run of live) if (!byId.has(run.id)) byId.set(run.id, run);
  // Phantom runs: still queued a day (`--phantom-hours`) after they were created, and older than the listed window.
  const phantomBefore = Math.min(listedFrom, now - phantomHours * 3_600_000);
  const phantoms = [];
  await listByStatus(`status=queued&created=${encodeURIComponent(`<${new Date(phantomBefore).toISOString()}`)}`, phantoms);

  // Newest first, so a cap leaves a contiguous covered window ending at `end`.
  const runs = [...byId.values()].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
  for (const r of runs) if (r.conclusion === 'skipped') r.jobs = [];
  // Hold back budget for the PR timelines and the phantom runs' job lists.
  const prBudget = args.includes('--no-prs') ? 0 : 600;
  const total = cap;
  cap = Math.max(requests, total - Math.min(phantoms.length, 300) - prBudget);
  await pool(runs.filter(r => !r.jobs), run => readJobs(run, 'jobs'));
  const oldestUnread = runs.filter(r => !r.jobs).reduce((t, r) => Math.max(t, Date.parse(r.created_at)), -Infinity);
  const from = Number.isFinite(oldestUnread) ? Math.max(start, oldestUnread + leadMinutes * 60_000) : start;
  const read = runs.filter(r => r.jobs && Date.parse(r.created_at) > oldestUnread);

  cap = total - Math.min(phantoms.length, 300);
  let prs = new Map();
  if (prBudget) prs = await readPrs(read).catch(error => { if (error instanceof CapReached) return prs; throw error; });
  cap = total;
  await pool(phantoms, run => readJobs(run, 'phantom'));
  return { now, end, from, listedFrom, runs: runs.length, read: read.map(trimRun), phantoms: phantoms.map(trimRun),
    phantomBefore, prs: [...prs], requests, cap: total, pages };
}

async function main() {
  const data = option('load') ? JSON.parse(readFileSync(option('load'), 'utf8')) : await collect();
  if (option('save')) writeFileSync(option('save'), `${JSON.stringify(data)}\n`);
  const to = Math.floor(data.end / 60_000) * 60_000;
  const measuredFrom = Math.min(to, Math.ceil(data.from / 60_000) * 60_000);
  const result = analyse({ runs: data.read, prs: new Map(data.prs), from: measuredFrom, to, now: data.now });
  const coverage = { from: measuredFrom, to, requestedHours: hours, fraction: Math.max(0, to - measuredFrom) / (hours * 3_600_000),
    listedFrom: data.listedFrom, phantomBefore: data.phantomBefore, leadMinutes, runs: data.runs, runsWithJobs: data.read.length, requests: data.requests, cap: data.cap, pages: data.pages };
  const markdown = report({ result, coverage, phantom: phantomVerdict(data.phantoms) });
  console.log(markdown);
  if (option('out')) writeFileSync(option('out'), `${markdown}\n`);
  if (option('json')) writeFileSync(option('json'), `${JSON.stringify({ coverage, result }, null, 2)}\n`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
