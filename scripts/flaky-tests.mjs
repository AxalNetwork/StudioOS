#!/usr/bin/env node
/**
 * D6464 (#6464): build the known-flaky test list from recent CI runs.
 *
 *   node scripts/flaky-tests.mjs [--days 7] [--write] [--open-issues] [--json] [--why]
 *
 * Reads ci.yml runs of the last --days: failed merge_group runs (their failed
 * `suite (<part>)` job logs and the PR's changed files) and successful runs
 * (merge_group and pushes to main). `lib/flakyTests.mjs` classifies them.
 * Prints the list and how many failed queue runs the retry would have turned
 * green. --write updates scripts/flaky-tests.json, the only place the list
 * lives: the suite runner reads it and never writes it, so the list changes
 * only through a PR that commits this script's output. --open-issues opens
 * one `ci` issue per listed test whose title has no issue yet.
 *
 * GitHub access: in GitHub Actions, GITHUB_TOKEN (or GH_TOKEN) with fetch;
 * anywhere else, the `gh` CLI and its own credential.
 * Reads only, except --open-issues, which creates issues.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPIRY_DAYS, classify, issueTitle, mergeList, parseFailures, queuePr, stillDefined, wouldTurnGreen } from './lib/flakyTests.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DATA = resolve(root, 'scripts/flaky-tests.json');
const repo = process.env.GITHUB_REPOSITORY || 'AxalNetwork/StudioOS';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

async function api(path, { method = 'GET', body, text = false } = {}) {
  // In Actions the job token goes straight to the API; elsewhere `gh` holds the credential.
  if (token && process.env.GITHUB_ACTIONS === 'true') {
    const res = await fetch(`https://api.github.com/${path}`, {
      method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    });
    if (!res.ok) throw new Error(`GitHub API ${method} ${path.split('?')[0]} returned HTTP ${res.status}`);
    return text ? res.text() : res.json();
  }
  const args = ['api', path, '--method', method, ...(body ? ['--input', '-'] : [])];
  const r = spawnSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh api ${method} ${path.split('?')[0]} failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  return text ? r.stdout : JSON.parse(r.stdout);
}

async function runsSince(event, since, status) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const q = `repos/${repo}/actions/workflows/ci.yml/runs?event=${event}&status=${status}&created=%3E%3D${since}&per_page=100&page=${page}`;
    const { workflow_runs: rows } = await api(q);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

async function collect(days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const [failed, queueGreen, mainGreen] = await Promise.all([
    runsSince('merge_group', since, 'failure'), runsSince('merge_group', since, 'success'), runsSince('push', since, 'success'),
  ]);
  const greens = [...queueGreen.map((r) => ({ sha: r.head_sha, at: r.created_at, event: 'merge_group' })),
    ...mainGreen.filter((r) => r.head_branch === 'main').map((r) => ({ sha: r.head_sha, at: r.created_at, event: 'push' }))];
  const changed = new Map();
  const runs = [];
  for (const run of failed) {
    const { jobs } = await api(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    const failedJobs = jobs.filter((j) => j.conclusion === 'failure');
    const suites = failedJobs.filter((j) => j.name.startsWith('suite ('));
    // The required roll-ups fail whenever a suite part does; they are not a second failure.
    const rollups = new Set(['test:drift (full suite)', 'landing gate']);
    const otherJobsFailed = failedJobs.some((j) => !j.name.startsWith('suite (') && !rollups.has(j.name));
    const failures = [];
    for (const job of suites) {
      try { failures.push(...parseFailures(await api(`repos/${repo}/actions/jobs/${job.id}/logs`, { text: true }))); }
      catch (e) { console.error(`flaky-tests: job ${job.id} log unreadable: ${e.message}`); }
    }
    const pr = queuePr(run.head_branch);
    if (pr && !changed.has(pr)) {
      try {
        const files = [];
        for (let page = 1; page <= 30; page++) {
          const rows = await api(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`);
          files.push(...rows.map((f) => f.filename));
          if (rows.length < 100) break;
        }
        changed.set(pr, files);
      } catch { changed.set(pr, null); }
    }
    // A PR whose changes cannot be read gives no evidence either way.
    if (pr && changed.get(pr) === null) continue;
    runs.push({ id: run.id, sha: run.head_sha, at: run.created_at, pr, failures, otherJobsFailed, suiteFailed: suites.length > 0, changedFiles: changed.get(pr) || [] });
  }
  return { runs, greens, failedCount: failed.length };
}

/**
 * Each failed test across the runs, before the rules: in how many runs, how
 * many were its PR's own file, how many had a same-commit pass or a main pass
 * within a day, the days it failed on, and whether it was listed (`counted`).
 */
function explain(runs, greens, found) {
  const rows = new Map();
  const listed = new Map(found.map((f) => [`${f.file}\u0000${f.test}`, f.runs.length]));
  for (const run of runs) {
    const at = Date.parse(run.at);
    const sameCommit = greens.some((g) => g.sha === run.sha && Date.parse(g.at) >= at);
    const mainSoon = greens.some((g) => g.event === 'push' && Date.parse(g.at) >= at && Date.parse(g.at) - at <= 86400_000);
    for (const f of run.failures) {
      const key = `${f.file}\u0000${f.test}`;
      const row = rows.get(key) || { file: f.file, test: f.test, runs: 0, ownFile: 0, sameCommitPassed: 0, mainPassedWithinDay: 0, days: [], counted: listed.get(key) || 0 };
      row.runs += 1;
      if ((run.changedFiles || []).includes(f.file)) row.ownFile += 1;
      if (sameCommit) row.sameCommitPassed += 1;
      if (mainSoon) row.mainPassedWithinDay += 1;
      if (!row.days.includes(run.at.slice(0, 10))) row.days.push(run.at.slice(0, 10));
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.runs - a.runs).slice(0, 40);
}

function readData() {
  try { return JSON.parse(readFileSync(DATA, 'utf8')); } catch { return { expiryDays: EXPIRY_DAYS, tests: [] }; }
}

async function openIssues(list) {
  const titles = new Set();
  for (let page = 1; page <= 10; page++) {
    const rows = await api(`repos/${repo}/issues?state=all&labels=ci&per_page=100&page=${page}`);
    for (const r of rows) titles.add(r.title);
    if (rows.length < 100) break;
  }
  const opened = [];
  for (const e of list) {
    const title = issueTitle(e);
    if (titles.has(title)) continue;
    const body = [`\`${e.test}\` in \`${e.file}\` is on the flaky list (\`scripts/flaky-tests.json\`, D6464).`, '',
      `It failed in ${e.count} merge-queue runs between ${e.firstSeen} and ${e.lastSeen} on PRs that did not change its file, and the same code passed it.`,
      'Under merge_group its file now runs once more when it fails; every retry is written to the job summary.',
      'Fix the test, then remove its entry from the list in the same PR.', '', 'Part of #5600.', '', '---', '_Generated by [Claude Code](https://claude.ai/code)_'].join('\n');
    const issue = await api(`repos/${repo}/issues`, { method: 'POST', body: { title, body, labels: ['ci'] } });
    titles.add(title);
    opened.push(issue.html_url);
  }
  return opened;
}

async function main(argv) {
  const flag = (name) => argv.includes(name);
  const days = Number(argv[argv.indexOf('--days') + 1]) || 7;
  const { runs, greens, failedCount } = await collect(days);
  const found = classify(runs, greens);
  const data = readData();
  const now = new Date().toISOString();
  // A test renamed or removed since it failed is not listed: nothing could match it, and its fix may be why it is gone.
  const source = (file) => { try { return readFileSync(resolve(root, file), 'utf8'); } catch { return null; } };
  const tests = mergeList(data.tests, found, now, { expiryDays: data.expiryDays || EXPIRY_DAYS })
    .filter((e) => stillDefined(source(e.file), e.test));
  const suiteRuns = runs.filter((r) => r.suiteFailed);
  const green = runs.filter((r) => wouldTurnGreen(r, tests)).length;
  const result = { days, failedQueueRuns: failedCount, failedWithSuiteParts: suiteRuns.length, wouldTurnGreen: green, tests };
  // --why: every failed test before the rules, with how many runs each rule set aside, to check the list by hand.
  if (flag('--why')) result.why = explain(runs, greens, found);
  if (flag('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Failed merge-queue runs in ${days} days: ${failedCount}; with a failed suite part: ${suiteRuns.length}.`);
    console.log(`With the retry, ${green} of them would have passed.`);
    for (const e of tests) console.log(`${String(e.count).padStart(3)}  ${e.file} › ${e.test}  (${e.firstSeen} to ${e.lastSeen})`);
  }
  if (flag('--write')) writeFileSync(DATA, `${JSON.stringify({ expiryDays: data.expiryDays || EXPIRY_DAYS, tests }, null, 2)}\n`);
  if (flag('--open-issues')) for (const url of await openIssues(tests)) console.log(`opened ${url}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`flaky-tests: ${e.message}`); process.exit(1); });
}
