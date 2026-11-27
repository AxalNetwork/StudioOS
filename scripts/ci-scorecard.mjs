#!/usr/bin/env node
/**
 * D5603: samples the GitHub Actions and PR APIs and updates the daily scorecard
 * on #5600. D5973: also writes one classified row per merge-group candidate to
 * `$CI_SCORECARD_ROWS`.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET, LANDING_BUDGET, QUEUE_WORKFLOWS, botKind, candidateRows, evenlySpaced, greenAt, landingReport, mergeCommit, providerFromLog,
  prProvenance, pushesMissingQueueRun, queueDeadline, queueEntries, jobSample, readyAt, report, slimEvents, unionRuns } from './lib/ciScorecard.mjs';
import { dispatchable, KINDS } from './landing-bot/rules.mjs';
import { REQUIRED } from './lib/requiredChecks.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const tracker = 5600;
const marker = '<!-- studioos-ci-scorecard-5603 -->';
// D5973 part 2: one request plan for the candidate rows (D5973) and the queue listing (D6678).
const { cap } = BUDGET;
let requests = 0;
// D6479: the landing reads count against their own cap, LANDING_BUDGET.cap, so BUDGET's plan still fits the comment.
let landingRequests = 0;

async function request(path, init = {}, { landing = false, text = false } = {}) {
  if (landing ? ++landingRequests > LANDING_BUDGET.cap : ++requests > cap) throw new Error('Scorecard request cap reached');
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return text ? response.text() : response.json();
}

const get = path => request(path);
const landingGet = path => request(path, {}, { landing: true });
const pageSize = 100;

async function pages(path, limit, list = value => value, read = get) {
  const rows = [];
  for (let page = 1; page <= limit; page++) {
    const items = list(await read(`${path}${path.includes('?') ? '&' : '?'}per_page=${pageSize}&page=${page}`));
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
    // D6479: the events the landing rows read, kept small. D9027: the slot its commits' trailers name, from the same events.
    const pr = { number, mergeCommit: mergeCommit(events), mergedAt, allEntries, events: slimEvents(events), provenance: prProvenance(events),
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

/*
 * D6479: the landing reads, each phase bounded by LANDING_BUDGET and every
 * request a GET counted against LANDING_BUDGET.cap. A read that fails leaves
 * its rows empty and says so; a cap that stops a phase is named in the notes.
 */
async function collectLanding({ created, runs, queueAll, prs }) {
  const notes = [];
  const listing = async (what, path, limit, list) => {
    try {
      const result = await pages(path, limit, list, landingGet);
      if (!result.complete) notes.push(`${what} reached its ${limit}-page limit.`);
      return result.rows;
    } catch {
      notes.push(`${what} could not be read.`);
      return [];
    }
  };
  const runsOf = value => value.workflow_runs;

  // Pushes to main, and the PR of each push with no green queue run whose timeline the scorecard has not read.
  const pushRuns = unionRuns(await listing('The ci.yml push listing on main', `actions/workflows/ci.yml/runs?event=push&branch=main&created=${created}`,
    LANDING_BUDGET.pushPages, runsOf), runs);
  const pullsBySha = new Map();
  const pushStart = landingRequests;
  const unread = pushesMissingQueueRun(pushRuns, queueAll).filter(sha => !prs.some(p => p.mergeCommit === sha));
  for (const sha of unread) {
    if (landingRequests - pushStart + 1 + BUDGET.timelinePages > LANDING_BUDGET.pushReads) {
      notes.push(`Push PR reads stopped at their cap of ${LANDING_BUDGET.pushReads} requests: ${pullsBySha.size} of ${unread.length} pushes read.`);
      break;
    }
    try {
      const pr = (await landingGet(`commits/${sha}/pulls`)).find(p => p.merged_at && Number.isSafeInteger(p.number));
      if (!pr) { pullsBySha.set(sha, { number: null }); continue; }
      const timeline = await pages(`issues/${pr.number}/timeline`, BUDGET.timelinePages, value => value, landingGet);
      pullsBySha.set(sha, { number: pr.number, events: timeline.complete ? slimEvents(timeline.rows) : null });
    } catch {
      notes.push('One push PR could not be read.');
    }
  }

  // Open PRs, and the mergeable state of up to mergeableReads of them, evenly spaced from oldest to newest.
  const open = await listing('The open PR list', 'pulls?state=open&sort=created&direction=asc', LANDING_BUDGET.openPages, value => value);
  const openDetails = new Map();
  const picked = evenlySpaced(open, LANDING_BUDGET.mergeableReads);
  if (picked.length < open.length) notes.push(`Mergeable state read for ${picked.length} of ${open.length} open PRs (cap ${LANDING_BUDGET.mergeableReads}).`);
  for (const p of picked) {
    if (!Number.isSafeInteger(p.number)) continue;
    try {
      const d = await landingGet(`pulls/${p.number}`);
      openDetails.set(p.number, { mergeable: d.mergeable, mergeable_state: d.mergeable_state });
    } catch {
      notes.push('One open PR could not be read.');
    }
  }

  // The landing bot workflows on main, their runs, and for runs of a model kind their jobs and the provider.
  let present = [];
  try {
    const listed = (await landingGet('actions/workflows?per_page=100')).workflows || [];
    present = dispatchable.filter(path => listed.some(w => w.path === path));
  } catch {
    notes.push('The workflow list could not be read.');
  }
  const botWorkflowRuns = [];
  for (const path of present) {
    const file = path.split('/').pop();
    botWorkflowRuns.push(...(await listing(`The ${file} run listing`, `actions/workflows/${file}/runs?created=${created}`, LANDING_BUDGET.botRunPages, runsOf))
      .map(r => ({ ...r, path })));
  }
  const modelKind = botWorkflowRuns.filter(r => KINDS[botKind(r.path)]?.model && r.status === 'completed' && r.conclusion !== 'skipped' && Number.isSafeInteger(r.id));
  const jobRuns = modelKind.slice(0, LANDING_BUDGET.botJobs);
  if (jobRuns.length < modelKind.length) notes.push(`Jobs read for ${jobRuns.length} of ${modelKind.length} model-kind bot runs (cap ${LANDING_BUDGET.botJobs}).`);
  let logs = 0, skippedLogs = 0;
  for (const run of jobRuns) {
    try {
      const { jobs, total_count: total } = await landingGet(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if (total > jobs.length) continue;
      run.jobs = jobs;
      const edit = jobs.filter(j => /(?:^|\/ )Edit \(round \d\)$/.test(String(j.name)) && j.conclusion && j.conclusion !== 'skipped').at(-1);
      if (!edit || !Number.isSafeInteger(edit.id)) continue;
      if (logs >= LANDING_BUDGET.modelLogs) { skippedLogs++; continue; }
      logs++;
      run.provider = providerFromLog(await request(`actions/jobs/${edit.id}/logs`, {}, { landing: true, text: true }));
    } catch {
      notes.push('One bot run\'s jobs or log could not be read.');
    }
  }
  if (skippedLogs) notes.push(`Provider logs read for ${logs} model runs (cap ${LANDING_BUDGET.modelLogs}); ${skippedLogs} read as unread.`);

  // ci.yml pull_request runs: jobs for up to prCiJobs more of them, evenly spaced, beside those the scorecard sampled.
  // Copies, so these job reads never change the scorecard's own rows above.
  const byId = new Map(runs.map(r => [r.id, r]));
  const ciPrRuns = (await listing('The ci.yml pull_request listing', `actions/workflows/ci.yml/runs?event=pull_request&created=${created}`,
    LANDING_BUDGET.prCiPages, runsOf)).map(r => (Array.isArray(byId.get(r.id)?.jobs) ? byId.get(r.id) : { ...r }));
  for (const run of evenlySpaced(ciPrRuns.filter(r => !Array.isArray(r.jobs) && Number.isSafeInteger(r.id)), LANDING_BUDGET.prCiJobs)) {
    try {
      const { jobs, total_count: total } = await landingGet(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if (total <= jobs.length) run.jobs = jobs;
    } catch {
      notes.push('One ci.yml pull_request job listing could not be read.');
    }
  }
  return { pushRuns, pullsBySha, open, openDetails, botWorkflowRuns, ciPrRuns: unionRuns(ciPrRuns), notes: [...new Set(notes)] };
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
  const landing = await collectLanding({ created, runs, queueAll, prs });
  const markdown = report({ runs, queueRuns, prs, start, now, requests, queueListingComplete: queue.complete, rows, deadline })
    + (notes.length ? `\n\n${notes.join('\n')}` : '')
    + `\n\n${landingReport({ ...landing, runs, queueRuns: queueAll, prs, start, now,
      modelCap: process.env.LANDING_BOT_DAILY_MODEL_RUNS, requests: landingRequests })}`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  console.log(markdown);
  await publishComment(markdown);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
